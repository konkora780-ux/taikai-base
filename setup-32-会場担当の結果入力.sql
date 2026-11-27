-- ============================================================
-- 大会ベース：会場担当が、ログインせずに自分の会場の試合結果を入れる（2026-11-28）
--
-- 目的：
--   複数会場で同時に試合をするとき、各会場の担当者が団体の合言葉を知らなくても、
--   「会場担当用の入力リンク＋6文字の入力コード」で、その会場・その日の試合の
--   結果（スコア・PK・試合の状態・得点・警告・交代・メモ）を入れられるようにする。
--
-- 安全のしくみ：
--   ・入力コードの照合はこの関数の中（Supabase側）で行う。コード違い・期限切れ・
--     無効にしたリンク・ロック中は何も書き込まない（5回間違えると15分ロック＝
--     チームの記入リンクと同じ仕組み）。
--   ・書き込めるのは「リンクの会場名と同じ会場」かつ「リンクの日付にキックオフ（日本時間）」
--     の試合だけ。会場名・日時・対戦チーム・公式記録の公開／非公開・メンバー表・
--     大会の設定・台帳には触れない。
--   ・会場担当用の表（gn_venue_entry）は、その団体でログインした運営（と大会管理者の
--     スタッフ）だけが読み書きできる。会場担当はこの表を直接は読めない。
--
-- 実行方法：Supabase の SQL Editor にこのファイルの中身を全部貼り付けて「Run」。
--   何度実行しても大丈夫です（同じ内容で上書きされるだけ）。
-- ============================================================


-- ① 会場担当用のリンクの表
create table if not exists public.gn_venue_entry (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  tournament_id uuid not null,
  venue         text not null,          -- 試合の「会場」欄と同じ文字
  day           date not null,          -- この日（日本時間）にキックオフする試合だけ
  code          text not null,          -- 6文字の入力コード
  active        boolean not null default true,   -- 運営が「無効にする」と false
  expires_at    timestamptz,            -- この時刻を過ぎると使えない（既定はその日の終わり＝24時。延長は運営が行う）
  fail_count    int not null default 0,
  locked_until  timestamptz,
  last_used_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists gn_venue_entry_tid on public.gn_venue_entry (tournament_id);

alter table public.gn_venue_entry enable row level security;

-- 運営（団体アカウント本人）と、その団体の「大会管理者」スタッフだけが読み書きできる
drop policy if exists "venue_entry_org" on public.gn_venue_entry;
create policy "venue_entry_org" on public.gn_venue_entry
  for all to authenticated
  using (
    org_id = auth.uid()
    or exists (select 1 from public.gn_org_members om
               where om.org_id = gn_venue_entry.org_id and om.user_id = auth.uid() and om.role = 'admin')
  )
  with check (
    org_id = auth.uid()
    or exists (select 1 from public.gn_org_members om
               where om.org_id = gn_venue_entry.org_id and om.user_id = auth.uid() and om.role = 'admin')
  );
revoke all on public.gn_venue_entry from anon;


-- ② 入力コードを確かめる補助関数（③④の中からだけ使う）
--    合っていれば リンクのid を返し、違えば null（間違えた回数を数え、5回で15分ロック）
create or replace function public.gn_venue_check(p_id uuid, p_code text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_code text;
  v_active boolean;
  v_locked_until timestamptz;
  v_expires_at timestamptz;
begin
  select code, active, locked_until, expires_at
    into v_code, v_active, v_locked_until, v_expires_at
    from gn_venue_entry where id = p_id for update;

  if not found then return null; end if;
  if not v_active then return null; end if;
  if v_locked_until is not null and v_locked_until > now() then return null; end if;
  if v_expires_at is not null and v_expires_at < now() then return null; end if;

  if v_code <> upper(coalesce(p_code, '')) then
    update gn_venue_entry
      set fail_count = fail_count + 1,
          locked_until = case when fail_count + 1 >= 5 then now() + interval '15 minutes' else locked_until end
      where id = p_id;
    return null;
  end if;

  update gn_venue_entry set fail_count = 0, locked_until = null, last_used_at = now() where id = p_id;
  return p_id;
end;
$function$;
revoke all on function public.gn_venue_check(uuid, text) from public, anon, authenticated;


-- ③ 会場担当がリンクを開いたとき：コードを確かめて、会場名・日付・大会と、
--    その会場・その日の試合の「入力に要る中身」だけを返す（通信量を抑えるため、ほかの会場・ほかの日の試合は返さない）
--    返り値：{"ok":true, "tournament_id":..., "venue":..., "day":"2026-11-30",
--             "matches":[{"id":..., "lineups":..., "official":{審判名など・サインは含めない}}]}
--            コード違い等は {"ok":false, "reason":"code"}、リンクが無い・無効・期限切れは "reason":"closed"
create or replace function public.venue_entry_open(p_id uuid, p_code text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_tid uuid; v_venue text; v_day date; v_active boolean; v_exp timestamptz; v_ms jsonb;
begin
  select tournament_id, venue, day, active, expires_at into v_tid, v_venue, v_day, v_active, v_exp
    from gn_venue_entry where id = p_id;
  if not found or not v_active or (v_exp is not null and v_exp < now()) then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  if gn_venue_check(p_id, p_code) is null then
    return jsonb_build_object('ok', false, 'reason', 'code');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id,
           'lineups', m.lineups,
           'official', case when jsonb_typeof(m.official) = 'object' then (
              select coalesce(jsonb_object_agg(k, m.official -> k), '{}'::jsonb)
                from unnest(array['format','referee','fourth','ar1','ar2','recorder','org',
                                  'weather','wind','pitch','pitchCond','temp','crowd','kickoffTeam']) k
               where m.official ? k) end)), '[]'::jsonb)
    into v_ms
    from gn_matches m
   where m.tournament_id = v_tid
     and btrim(coalesce(m.venue, '')) = btrim(v_venue)
     and m.kickoff is not null and (m.kickoff at time zone 'Asia/Tokyo')::date = v_day;
  return jsonb_build_object('ok', true, 'tournament_id', v_tid, 'venue', v_venue,
                            'day', to_char(v_day, 'YYYY-MM-DD'), 'matches', v_ms);
end;
$function$;
grant execute on function public.venue_entry_open(uuid, text) to anon, authenticated;


-- ④ 会場担当が1試合の結果を保存する
--    返り値：'ok' / 'code'（コード違い・期限切れ・無効・ロック中）/ 'notyours'（この会場・この日の試合でない）/ 'bad'（中身がおかしい）
--    書き換えるのは：スコア・PK・状態・決着の種類とメモ・得点などの記録・試合のメモ・
--                    延長/PK戦の記録とこの試合だけの試合時間（lineups._meta の useET / usePK / pk / halfMin / etHalfMin だけ）・
--                    公式記録の上部の欄（回戦・審判・記録員・主催団体名・天候・風・ピッチ・気温・観衆・キックオフしたチーム）。
--    メンバー表・日時・会場・対戦チームは書き換えない（公式記録の全体とサインは ⑥ で保存）
create or replace function public.venue_save_match(p_id uuid, p_code text, p_match uuid, p_data jsonb)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_tid uuid; v_venue text; v_day date;
  m_tid uuid; m_venue text; m_kick timestamptz;
  v_hs int; v_as int; v_hp int; v_ap int;
  v_status text; v_rtype text; v_events jsonb; v_meta jsonb; v_kt text; v_of jsonb;
begin
  if gn_venue_check(p_id, p_code) is null then return 'code'; end if;
  select tournament_id, venue, day into v_tid, v_venue, v_day from gn_venue_entry where id = p_id;

  select tournament_id, venue, kickoff into m_tid, m_venue, m_kick from gn_matches where id = p_match for update;
  if not found or m_tid is distinct from v_tid
     or btrim(coalesce(m_venue, '')) <> btrim(v_venue)
     or m_kick is null or (m_kick at time zone 'Asia/Tokyo')::date <> v_day then
    return 'notyours';
  end if;

  -- 中身の確認（数字は0〜99、状態と決着の種類は決まった値だけ、記録は配列で200件まで）
  if jsonb_typeof(p_data) is distinct from 'object' then return 'bad'; end if;
  begin
    v_hs := nullif(p_data ->> 'home_score', '')::int;  v_as := nullif(p_data ->> 'away_score', '')::int;
    v_hp := nullif(p_data ->> 'home_pk', '')::int;     v_ap := nullif(p_data ->> 'away_pk', '')::int;
  exception when others then return 'bad';
  end;
  if coalesce(v_hs,0) not between 0 and 99 or coalesce(v_as,0) not between 0 and 99
     or coalesce(v_hp,0) not between 0 and 99 or coalesce(v_ap,0) not between 0 and 99 then return 'bad'; end if;

  v_status := coalesce(p_data ->> 'status', 'todo');
  if v_status not in ('todo', 'live', 'done', 'postponed', 'cancelled') then return 'bad'; end if;
  v_rtype := nullif(p_data ->> 'result_type', '');
  if v_rtype is not null and v_rtype not in ('walkover_home','walkover_away','forfeit_home','forfeit_away','awarded') then return 'bad'; end if;

  v_events := coalesce(p_data -> 'events', '[]'::jsonb);
  if jsonb_typeof(v_events) <> 'array' or jsonb_array_length(v_events) > 200 then return 'bad'; end if;

  v_meta := p_data -> 'meta';
  if v_meta is not null and jsonb_typeof(v_meta) <> 'object' then return 'bad'; end if;
  v_kt := nullif(p_data ->> 'kickoffTeam', '');
  if v_kt is not null and v_kt not in ('H', 'A') then return 'bad'; end if;

  -- 公式記録の欄：決まったキーの文字（100文字まで）だけを取り出す
  if p_data -> 'official' is not null then
    if jsonb_typeof(p_data -> 'official') <> 'object' then return 'bad'; end if;
    select coalesce(jsonb_object_agg(k, to_jsonb(left(coalesce(p_data -> 'official' ->> k, ''), 100))), '{}'::jsonb)
      into v_of
      from unnest(array['format','referee','fourth','ar1','ar2','recorder','org',
                        'weather','wind','pitch','pitchCond','temp','crowd']) k
      where (p_data -> 'official') ? k;
    v_of := v_of || jsonb_build_object('kickoffTeam', coalesce(to_jsonb(v_kt), 'null'::jsonb));
  end if;

  update gn_matches set
    home_score  = v_hs,  away_score = v_as,
    home_pk     = v_hp,  away_pk    = v_ap,
    status      = v_status,
    result_type = v_rtype,
    result_note = left(nullif(p_data ->> 'result_note', ''), 300),
    events      = v_events,
    note        = left(coalesce(p_data ->> 'note', ''), 500),
    -- 延長・PK戦の記録だけを差し替える（メンバー表・試合時間の設定などはそのまま）
    lineups = case when v_meta is null then lineups else
      jsonb_set(case when jsonb_typeof(lineups) = 'object' then lineups else '{}'::jsonb end, '{_meta}',
        (case when jsonb_typeof(lineups -> '_meta') = 'object' then lineups -> '_meta' else '{}'::jsonb end)
          || jsonb_strip_nulls(jsonb_build_object(
               'useET', case when jsonb_typeof(v_meta -> 'useET') = 'boolean' then v_meta -> 'useET' end,
               'usePK', case when jsonb_typeof(v_meta -> 'usePK') = 'boolean' then v_meta -> 'usePK' end,
               'pk',    case when jsonb_typeof(v_meta -> 'pk')    = 'object'  then v_meta -> 'pk'    end))
          -- この試合だけの試合時間（空にしたときは null で消す）
          || jsonb_build_object(
               'halfMin',   case when jsonb_typeof(v_meta -> 'halfMin')   = 'number' and (v_meta ->> 'halfMin')::numeric   between 1 and 120 then v_meta -> 'halfMin'   else 'null'::jsonb end,
               'etHalfMin', case when jsonb_typeof(v_meta -> 'etHalfMin') = 'number' and (v_meta ->> 'etHalfMin')::numeric between 1 and 120 then v_meta -> 'etHalfMin' else 'null'::jsonb end),
        true) end,
    -- 公式記録は決まった欄（回戦・審判・記録員・主催団体名・天候・風・ピッチ・気温・観衆・キックオフしたチーム）だけ。
    -- サイン・メンバー・得点経過など、ほかの欄はそのまま
    official = case when v_of is null then official else
      (case when jsonb_typeof(official) = 'object' then official else '{}'::jsonb end) || v_of end,
    updated_at = now()
  where id = p_match;
  return 'ok';
end;
$function$;
grant execute on function public.venue_save_match(uuid, text, uuid, jsonb) to anon, authenticated;

-- ⑤ 会場担当が公式記録の画面を開くとき：その1試合の公式記録を、サインの画像も含めて返す
--    （サインの画像は大きいので、公式記録の画面を開いたときに、その試合の分だけ読む）
--    返り値：{"ok":true, "official":{...}}／コード違い等は {"ok":false, "reason":"code"}／この会場・この日の試合でなければ "reason":"notyours"
create or replace function public.venue_get_official(p_id uuid, p_code text, p_match uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_tid uuid; v_venue text; v_day date;
  m_tid uuid; m_venue text; m_kick timestamptz; m_of jsonb;
begin
  if gn_venue_check(p_id, p_code) is null then return jsonb_build_object('ok', false, 'reason', 'code'); end if;
  select tournament_id, venue, day into v_tid, v_venue, v_day from gn_venue_entry where id = p_id;
  select tournament_id, venue, kickoff, official into m_tid, m_venue, m_kick, m_of from gn_matches where id = p_match;
  if not found or m_tid is distinct from v_tid
     or btrim(coalesce(m_venue, '')) <> btrim(v_venue)
     or m_kick is null or (m_kick at time zone 'Asia/Tokyo')::date <> v_day then
    return jsonb_build_object('ok', false, 'reason', 'notyours');
  end if;
  return jsonb_build_object('ok', true, 'official', m_of);
end;
$function$;
grant execute on function public.venue_get_official(uuid, text, uuid) to anon, authenticated;


-- ⑥ 会場担当が公式記録（最終チェックの内容・審判の指サイン）を保存する
--    返り値：'ok' / 'code' / 'notyours' / 'bad'
--    ・公式記録の中身をまるごと差し替える（記録者の最終チェック・サインのため）。
--    ・ただし「一般公開するかどうか」（public）は運営が決めるので、会場担当からは変えない（元の値のまま）。
--    ・大きすぎるデータ（2MB超）は受け付けない（サイン画像3〜4枚で通常は100KB程度）。
create or replace function public.venue_save_official(p_id uuid, p_code text, p_match uuid, p_official jsonb)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_tid uuid; v_venue text; v_day date;
  m_tid uuid; m_venue text; m_kick timestamptz; m_of jsonb;
begin
  if gn_venue_check(p_id, p_code) is null then return 'code'; end if;
  select tournament_id, venue, day into v_tid, v_venue, v_day from gn_venue_entry where id = p_id;
  select tournament_id, venue, kickoff, official into m_tid, m_venue, m_kick, m_of from gn_matches where id = p_match for update;
  if not found or m_tid is distinct from v_tid
     or btrim(coalesce(m_venue, '')) <> btrim(v_venue)
     or m_kick is null or (m_kick at time zone 'Asia/Tokyo')::date <> v_day then
    return 'notyours';
  end if;
  if jsonb_typeof(p_official) is distinct from 'object' or length(p_official::text) > 2000000 then return 'bad'; end if;

  update gn_matches set
    official = jsonb_set(p_official, '{public}',
                 case when jsonb_typeof(m_of) = 'object' and (m_of ->> 'public') = 'true' then 'true'::jsonb else 'false'::jsonb end, true),
    updated_at = now()
  where id = p_match;
  return 'ok';
end;
$function$;
grant execute on function public.venue_save_official(uuid, text, uuid, jsonb) to anon, authenticated;

-- index.html（js/）の対応する変更もあわせて反映してください。
