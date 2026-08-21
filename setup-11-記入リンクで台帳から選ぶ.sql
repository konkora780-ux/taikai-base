-- ============================================================
-- 大会ベース：大会の記入リンクで「台帳から選ぶ」を可能にする（2026-08-20）
--
-- 目的：
--   花巻東のように台帳に150人登録しているチームが、大会に複数チーム
--   （花巻東／花巻東B／花巻東C）を出すとき、各チームの記入リンクを開いた
--   本人（担当のコーチ等）が、150人の中から自分のチーム分を選べるようにする。
--   運営が「チーム・選手」画面で毎回選ぶ代わりに、記入リンクを配るだけで
--   各チームに選んでもらえる（運営の作業が減り、締切ロックも既存の
--   記入コードの有効期限の仕組みがそのまま使える）。
--
-- 安全のしくみ：
--   この記入リンクの記入コード（gn_entry.code）で認証する。
--   コードが違う・期限切れ・ロック中のときは何も返さない（既存のsubmit_team_rosterと同じ判定）。
--   台帳（gn_clubs/gn_members）は匿名では直接読めない設計のため、
--   このSECURITY DEFINER関数を通してだけ、該当チームの台帳を読める。
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

  -- 正しいコードだったので失敗回数はリセット（提出時と同じ扱い。提出そのものではないのでsubmitted_atは変えない）
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
      where m.club_id = v_club and m.status = 'active'
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$function$;

-- index.htmlの対応する変更もあわせて反映してください。
