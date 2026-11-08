-- ============================================================
-- 大会ベース：試合ごとのメンバー（スタメン・サブ）をチームが記入リンクで提出する（2026-11-08）
--
-- 目的：
--   各チームが、大会の記入リンク（チームごとのリンク＋6文字の記入コード）から、
--   大会登録メンバーの中で「この試合のスタメン・サブ」を選んで提出できるようにする。
--   提出した内容は運営の「メンバー表」に入り、公式記録の「メンバー表から取り込む」で使える。
--
-- 安全のしくみ（他チームに書き換えられないように）：
--   ・記入コードの照合はこの関数の中（Supabase側）で行う。コード違い・期限切れ・
--     ロック中は何も書き込まない（5回間違えると15分ロック＝既存の仕組みと同じ）。
--   ・書き込めるのは「コードが合ったチームが、その試合のどちら側か」を
--     サーバー側で確かめた、その1チーム分の欄だけ。相手チームの欄や
--     得点・結果・公式記録には触れない。
--   ・試合が「未実施」「延期」のときだけ受け付ける（試合中・終了後は運営だけが直せる）。
--   ・大会登録メンバーにいない選手は入れられない。人数は大会設定
--     （スタメン人数・サブの上限）と合っているかも確かめる。
--
-- 実行方法：Supabase の SQL Editor にこのファイルの中身を全部貼り付けて「Run」。
--   何度実行しても大丈夫です（同じ内容で上書きされるだけ）。
-- ============================================================


-- ① 試合の表に「チームが提出したメンバー」の控えの列を追加する
--    （運営の画面が古いまま保存しても、チームの提出がここに残り、次に開いたとき元に戻せるように）
alter table public.gn_matches add column if not exists entry_lineups jsonb;


-- ② トーナメントの枠（「1回戦の勝者」など）に入るチームを、サーバー側で求める補助関数
--    W:<試合id>＝その試合の勝者、L:<試合id>＝敗者。不戦勝（片側が空の枠）にも対応。
--    予選リーグの順位で決まる枠（G: / B:）は、ここでは求めない（null）。
create or replace function public.gn_slot_team(p_match uuid, p_side text, p_depth int default 0)
 returns uuid
 language plpgsql
 stable
 set search_path to 'public'
as $function$
declare
  v_team uuid; v_src text; v_kind text; v_key text;
  pm_id uuid; pm_hs numeric; pm_as numeric; pm_hp numeric; pm_ap numeric; pm_status text;
  pm_ht uuid; pm_at uuid; pm_hsrc text; pm_asrc text;
  h uuid; a uuid; w uuid; l uuid;
begin
  if p_depth > 20 then return null; end if;
  select case when p_side='H' then home_team else away_team end,
         case when p_side='H' then home_src  else away_src  end
    into v_team, v_src
    from gn_matches where id = p_match;
  if not found then return null; end if;
  if v_team is not null then return v_team; end if;
  if v_src is null or length(v_src) < 3 then return null; end if;
  v_kind := left(v_src, 1); v_key := substr(v_src, 3);
  if v_kind not in ('W','L') then return null; end if;

  select id, home_score, away_score, home_pk, away_pk, status, home_team, away_team, home_src, away_src
    into pm_id, pm_hs, pm_as, pm_hp, pm_ap, pm_status, pm_ht, pm_at, pm_hsrc, pm_asrc
    from gn_matches where id::text = v_key;
  if not found then return null; end if;

  h := gn_slot_team(pm_id, 'H', p_depth + 1);
  a := gn_slot_team(pm_id, 'A', p_depth + 1);

  if pm_status = 'done' and pm_hs is not null and pm_as is not null then
    if pm_hs > pm_as then w := h; l := a;
    elsif pm_hs < pm_as then w := a; l := h;
    elsif pm_hp is not null and pm_ap is not null and pm_hp <> pm_ap then
      if pm_hp > pm_ap then w := h; l := a; else w := a; l := h; end if;
    end if;
  else
    -- 不戦勝：片側だけが空の枠（チームも元の枠も無い）なら、もう片側が自動で勝者
    if (pm_ht is null and pm_hsrc is null) and not (pm_at is null and pm_asrc is null) then w := a;
    elsif (pm_at is null and pm_asrc is null) and not (pm_ht is null and pm_hsrc is null) then w := h;
    end if;
  end if;

  return case when v_kind = 'W' then w else l end;
end;
$function$;

-- 補助関数は外から直接呼ばせない（③の関数の中からだけ使う）
revoke all on function public.gn_slot_team(uuid, text, int) from public, anon, authenticated;


-- ③ チームが試合メンバーを提出する関数
--    返り値：'ok' / 'code'（コード違い・期限切れ・ロック中）/ 'notyours'（このチームの試合でない・対戦未確定）
--            / 'started'（試合が始まった・終わった）/ 'roster'（大会登録にいない選手）/ 'count'（人数が設定と合わない）
create or replace function public.submit_match_lineup(p_team uuid, p_code text, p_match uuid, p_lineup jsonb)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_code text;
  v_locked_until timestamptz;
  v_expires_at timestamptz;
  v_team_tid uuid;
  v_players jsonb;
  v_match_tid uuid;
  v_status text;
  v_settings jsonb;
  v_sport text;
  v_side text;
  v_need int;
  v_sub_max int;
  v_start int;
  v_sub int;
  v_rec jsonb;
begin
  -- 記入コードの照合（submit_team_roster と同じ判定）
  select code, locked_until, expires_at
    into v_code, v_locked_until, v_expires_at
    from gn_entry where team_id = p_team for update;

  if not found then return 'code'; end if;
  if v_locked_until is not null and v_locked_until > now() then return 'code'; end if;
  if v_expires_at is not null and v_expires_at < now() then return 'code'; end if;

  if v_code <> p_code then
    update gn_entry
      set fail_count = fail_count + 1,
          locked_until = case when fail_count + 1 >= 5 then now() + interval '15 minutes' else locked_until end
      where team_id = p_team;
    return 'code';
  end if;
  update gn_entry set fail_count = 0, locked_until = null where team_id = p_team;

  -- 試合とチームが同じ大会か・このチームがどちら側か
  select tournament_id, coalesce(players, '[]'::jsonb) into v_team_tid, v_players from gn_teams where id = p_team;
  select tournament_id, status into v_match_tid, v_status from gn_matches where id = p_match for update;
  if not found or v_team_tid is distinct from v_match_tid then return 'notyours'; end if;

  if gn_slot_team(p_match, 'H') = p_team then v_side := 'H';
  elsif gn_slot_team(p_match, 'A') = p_team then v_side := 'A';
  else return 'notyours';
  end if;

  if v_status is not null and v_status not in ('todo', 'postponed') then return 'started'; end if;

  -- 中身の確認：選手の配列があり、全員が大会登録メンバーにいること
  if jsonb_typeof(p_lineup -> 'players') is distinct from 'array'
     or jsonb_array_length(p_lineup -> 'players') > 100 then return 'roster'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_lineup -> 'players') x
    where not exists (select 1 from jsonb_array_elements(v_players) y where y ->> 'id' = x ->> 'pid')
  ) then return 'roster'; end if;

  -- 人数：スタメンは設定どおり（未設定ならサッカー11・フットサル5）、サブは上限以下
  select coalesce(settings, '{}'::jsonb), sport into v_settings, v_sport from gn_tournaments where id = v_match_tid;
  v_need := case when coalesce(v_settings ->> 'startCount', '') ~ '^[0-9]+$' and (v_settings ->> 'startCount')::int > 0
                 then (v_settings ->> 'startCount')::int
                 when v_sport = 'futsal' then 5 else 11 end;
  v_sub_max := case when coalesce(v_settings ->> 'subLimit', '') ~ '^[0-9]+$' then (v_settings ->> 'subLimit')::int else null end;
  select count(*) filter (where x ->> 'role' = 'start'), count(*) filter (where x ->> 'role' = 'sub')
    into v_start, v_sub
    from jsonb_array_elements(p_lineup -> 'players') x;
  if v_start <> v_need then return 'count'; end if;
  if v_sub_max is not null and v_sub > v_sub_max then return 'count'; end if;

  -- 自チーム側の欄だけを書き換える（相手側・_meta（延長/PKの設定）はそのまま）
  v_rec := jsonb_build_object(
    'coach', coalesce(p_lineup ->> 'coach', ''),
    'players', p_lineup -> 'players',
    'by', 'team',
    'submitted_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

  update gn_matches
     set entry_lineups = jsonb_set(coalesce(entry_lineups, '{}'::jsonb), array[v_side], v_rec, true),
         lineups       = jsonb_set(case when jsonb_typeof(lineups) = 'object' then lineups else '{}'::jsonb end, array[v_side], v_rec, true)
   where id = p_match;
  return 'ok';
end;
$function$;

grant execute on function public.submit_match_lineup(uuid, text, uuid, jsonb) to anon, authenticated;

-- index.html（js/）の対応する変更もあわせて反映してください（版番号 20261108e）。
