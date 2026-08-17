-- ============================================================
-- 大会ベース：記入コードの総当たり対策（2026-08-17）
--
-- 目的：
--   チーム提出・台帳提出用の記入コード（6文字）に、間違えた回数の制限が
--   無かった（プログラムによる総当たりへの備えがなかった）ため、
--   「5回間違えたら15分ロックする」仕組みを追加する。
--
-- 対象の3関数（いずれもSECURITY DEFINER・元の中身は変更していない）：
--   submit_team_roster(p_team, p_code, p_players)   … 大会の記入リンク
--   get_club_roster(p_club, p_code)                  … 台帳の名簿読み込み
--   submit_club_roster(p_club, p_code, ...)           … 台帳の記入リンク
--
-- 実行済み・検証済み（2026-08-17）。追加SQLはこれで完結。
-- 有効期限(expires_at)は列だけ用意し、今回は運用（値の設定）はしていない
-- （設定するUIが別途必要なため、次の機会に）。
-- ============================================================


-- ① 列を追加（fail_count / locked_until / expires_at）
alter table public.gn_entry add column if not exists fail_count int not null default 0;
alter table public.gn_entry add column if not exists locked_until timestamptz;
alter table public.gn_entry add column if not exists expires_at timestamptz;

alter table public.gn_club_entry add column if not exists fail_count int not null default 0;
alter table public.gn_club_entry add column if not exists locked_until timestamptz;
alter table public.gn_club_entry add column if not exists expires_at timestamptz;


-- ② 3関数を「5回間違えたら15分ロック」を追加して置き換える
--    注意：`declare v_entry gn_entry;`（複合型/%rowtype）で書くと、Supabase上で
--    「record "v_entry" has no field ...」という実行時エラーになった（型キャッシュが
--    絡む問題とみられる）。個別のスカラー変数で受ける書き方にして解決したので、
--    今後similar な関数を書くときもこの方式を踏襲すること。

CREATE OR REPLACE FUNCTION public.submit_team_roster(p_team uuid, p_code text, p_players jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_code text;
  v_locked_until timestamptz;
  v_expires_at timestamptz;
begin
  select code, locked_until, expires_at
    into v_code, v_locked_until, v_expires_at
    from gn_entry where team_id = p_team for update;

  if not found then return false; end if;
  if v_locked_until is not null and v_locked_until > now() then return false; end if;
  if v_expires_at is not null and v_expires_at < now() then return false; end if;

  if v_code <> p_code then
    update gn_entry
      set fail_count = fail_count + 1,
          locked_until = case when fail_count + 1 >= 5 then now() + interval '15 minutes' else locked_until end
      where team_id = p_team;
    return false;
  end if;

  update gn_teams set players = p_players where id = p_team;
  update gn_entry set submitted_at = now(), fail_count = 0, locked_until = null where team_id = p_team;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_club_roster(p_club uuid, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_code text;
  v_locked_until timestamptz;
  v_expires_at timestamptz;
  result jsonb;
begin
  select code, locked_until, expires_at
    into v_code, v_locked_until, v_expires_at
    from gn_club_entry where club_id = p_club for update;

  if not found then return null; end if;
  if v_locked_until is not null and v_locked_until > now() then return null; end if;
  if v_expires_at is not null and v_expires_at < now() then return null; end if;

  if v_code <> p_code then
    update gn_club_entry
      set fail_count = fail_count + 1,
          locked_until = case when fail_count + 1 >= 5 then now() + interval '15 minutes' else locked_until end
      where club_id = p_club;
    return null;
  end if;

  update gn_club_entry set fail_count = 0, locked_until = null where club_id = p_club;

  select jsonb_build_object(
    'name', c.name, 'category', c.category, 'crest', c.crest,
    'players', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', m.id, 'no', m.no, 'name', m.name,
          'pos', m.pos, 'grade', m.grade, 'prev_team', m.prev_team)
        order by m.no nulls last, m.sort_order)
      from gn_members m
      where m.club_id = p_club and m.status = 'active'
    ), '[]'::jsonb)
  ) into result
  from gn_clubs c where c.id = p_club;
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_club_roster(p_club uuid, p_code text, p_name text, p_category text, p_crest text, p_players jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_code text;
  v_org uuid;
  v_locked_until timestamptz;
  v_expires_at timestamptz;
begin
  select code, org_id, locked_until, expires_at
    into v_code, v_org, v_locked_until, v_expires_at
    from gn_club_entry where club_id = p_club for update;

  if not found then return false; end if;
  if v_locked_until is not null and v_locked_until > now() then return false; end if;
  if v_expires_at is not null and v_expires_at < now() then return false; end if;

  if v_code <> p_code then
    update gn_club_entry
      set fail_count = fail_count + 1,
          locked_until = case when fail_count + 1 >= 5 then now() + interval '15 minutes' else locked_until end
      where club_id = p_club;
    return false;
  end if;

  update gn_clubs set
    name     = coalesce(nullif(p_name, ''), name),
    category = coalesce(nullif(p_category, ''), category),
    crest    = coalesce(p_crest, crest)
  where id = p_club;
  delete from gn_members where club_id = p_club and status = 'active';
  insert into gn_members (id, org_id, club_id, name, kana, no, pos, grade, prev_team, status, sort_order, note)
  select coalesce(nullif(e->>'id','')::uuid, gen_random_uuid()),
         v_org, p_club, e->>'name', null,
         nullif(e->>'no','')::int, nullif(e->>'pos',''),
         nullif(e->>'grade','')::int, nullif(e->>'prev_team',''),
         'active', (ord-1)::int, null
  from jsonb_array_elements(coalesce(p_players, '[]'::jsonb)) with ordinality as t(e, ord)
  where coalesce(e->>'name','') <> '';
  update gn_club_entry set submitted_at = now(), fail_count = 0, locked_until = null where club_id = p_club;
  return true;
end;
$function$;

-- index.htmlの変更は無し（提出時の動きは完全に同じ）。GitHubへのアップロードは不要。
