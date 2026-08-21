-- ============================================================
-- 大会ベース：台帳の在籍判定を緩める（2026-08-20）
--
-- 症状：
--   記入リンクの「台帳から選ぶ」で、花巻東（在籍150名のはず）を選んだのに
--   選手が0人しか出てこなかった。
--
-- 原因：
--   setup-11で作った get_team_club_roster が「status が 'active' という
--   文字列と完全に一致する行だけ」を選手として拾う書き方になっていた。
--   一方、アプリの台帳画面（一覧の「在籍◯名」表示など）は逆に
--   「status が 'graduated'（卒業）でなければ在籍とみなす」という
--   緩い判定をしている。花巻東の150人はアプリ経由の通常登録ではなく
--   別の方法（テストデータ投入等）で作られたとみられ、status が
--   空（null）のまま入っていた可能性が高い。空だと「'active'と完全一致」
--   の判定には引っかからず、0人になっていた。
--
-- 対応：
--   get_team_club_roster と、同じ書き方をしている既存の get_club_roster
--   （台帳の記入リンクの「現在の名簿を読み込む」で使用）の両方を、
--   アプリの台帳画面と同じ「'graduated'でなければ在籍」という
--   緩い判定に統一する。
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_team_club_roster(p_team uuid, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_code text;
  v_locked_until timestamptz;
  v_expires_at timestamptz;
  v_club uuid;
  v_club_name text;
  v_crest text;
  result jsonb;
begin
  select code, locked_until, expires_at
    into v_code, v_locked_until, v_expires_at
    from gn_entry where team_id = p_team for update;

  if not found then return null; end if;
  if v_locked_until is not null and v_locked_until > now() then return null; end if;
  if v_expires_at is not null and v_expires_at < now() then return null; end if;

  if v_code <> p_code then
    update gn_entry
      set fail_count = fail_count + 1,
          locked_until = case when fail_count + 1 >= 5 then now() + interval '15 minutes' else locked_until end
      where team_id = p_team;
    return null;
  end if;

  update gn_entry set fail_count = 0, locked_until = null where team_id = p_team;

  select club_id into v_club from gn_teams where id = p_team;
  if v_club is null then return null; end if;

  select name, crest into v_club_name, v_crest from gn_clubs where id = v_club;

  select jsonb_build_object(
    'club_name', v_club_name,
    'crest', v_crest,
    'players', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', m.id, 'no', m.no, 'name', m.name, 'pos', m.pos, 'grade', m.grade, 'prev_team', m.prev_team)
        order by m.no nulls last, m.sort_order)
      from gn_members m
      where m.club_id = v_club and coalesce(m.status,'active') <> 'graduated'
    ), '[]'::jsonb)
  ) into result;

  return result;
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
      where m.club_id = p_club and coalesce(m.status,'active') <> 'graduated'
    ), '[]'::jsonb)
  ) into result
  from gn_clubs c where c.id = p_club;
  return result;
end;
$function$;

-- index.htmlの変更は無し（SQLだけの修正）。
