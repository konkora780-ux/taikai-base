-- ============================================================
-- 大会ベース：一般の閲覧を軽くする（2026-11-28）
--
-- 目的：
--   ① 公式記録の指サイン（画像）を、ログインしていない一般の閲覧者には送らない。
--      閲覧者には「署名済み」という印だけを返す（サイン画像は事務局＝運営ログイン時だけ読み込む）。
--   ② 閲覧者のスマホに校章を覚えさせるため、校章画像の「指紋」（md5）だけを返す窓口を作る。
--   → 閲覧者1人あたりの通信量が大きく減り、Supabase無料枠（転送量 月5GB）に収まりやすくなる。
--
-- 実行しても壊れないか：
--   新しい窓口（gn_matches_open・gn_teams_crest）を「追加」するだけ。
--   既存の表・既存の gn_matches_public は変更しない。何度実行しても同じ結果になる。
--   アプリは、この SQL を実行する前でも今まで通り動く（窓口が無ければ従来の読み込みに自動で戻る）。
--
-- 実行のしかた（Supabase の画面）：
--   1. Supabase にログインし、大会ベースのプロジェクトを開く
--   2. 左のメニューの「SQL Editor」を開き、「New query」を押す
--   3. このファイルの中身をすべて貼り付けて、右下の「Run」を押す
--   4. 下に「Success. No rows returned」と出れば完了
-- ============================================================

-- ① 試合の公開用の窓口（指サインの画像を「署名済み」の印 true に置き換える）
--    公開設定(public=true)の試合だけ公式記録を返す点・entry_lineups を返さない点は gn_matches_public と同じ。
create or replace view public.gn_matches_open
with (security_invoker = true) as
select
  id, tournament_id, org_id, stage, grp, round, slot, "matchNo",
  home_team, away_team, home_src, away_src,
  kickoff, venue,
  home_score, away_score, home_pk, away_pk,
  status, events, note, sort_order, updated_at, result_type, result_note, lineups,
  case when (official ->> 'public') = 'true' then
    case when jsonb_typeof(official -> 'signs') = 'object'
      then jsonb_set(official, '{signs}',
             coalesce((select jsonb_object_agg(k, true) from jsonb_object_keys(official -> 'signs') as k), '{}'::jsonb))
      else official end
  else null end as official,
  ((official ->> 'public') = 'true') as official_public   -- 「公式記録を見る」ボタン用の印（公式記録の中身を読まずに判断する）
from public.gn_matches;

-- ビューを直接は読ませず、下の関数（窓口）からだけ読ませる
revoke all on public.gn_matches_open from anon, authenticated;

create or replace function public.gn_matches_open()
returns setof public.gn_matches_open
language sql stable security definer
set search_path = public
as $$ select * from public.gn_matches_open $$;

revoke all on function public.gn_matches_open() from public;
grant execute on function public.gn_matches_open() to anon, authenticated;

-- ② 校章の指紋（md5）だけを返す窓口（チームの読み取り権限はこれまでと同じ＝security_invoker）
create or replace view public.gn_teams_crest
with (security_invoker = true) as
select id, tournament_id, md5(coalesce(crest, '')) as crest_hash
from public.gn_teams;

grant select on public.gn_teams_crest to anon, authenticated;

-- index.html（js/）の対応する変更もあわせて反映してください（版番号 20261128r）。
