-- ============================================================
-- 大会ベース：選手名簿もスマホに覚えさせる（2026-11-28）
--
-- 目的：
--   setup-30 で作った「校章の指紋」の窓口（gn_teams_crest）に、選手名簿の指紋（md5）を足す。
--   一般の閲覧者のスマホは、名簿の指紋が前回と同じなら名簿を読み直さない（2回目以降の通信量が減る）。
--
-- 実行しても壊れないか：
--   窓口（ビュー）に列を1つ足すだけ。表のデータは変わらない。何度実行しても同じ結果になる。
--   setup-30 を先に実行しておくこと。アプリは、この SQL を実行する前でも今まで通り動く。
--
-- 実行のしかた（Supabase の画面）：
--   1. Supabase の大会ベースのプロジェクトを開き、左のメニューの「SQL Editor」→「New query」
--   2. このファイルの中身をすべて貼り付けて「Run」
--   3. 「Success. No rows returned」と出れば完了
-- ============================================================

create or replace view public.gn_teams_crest
with (security_invoker = true) as
select id, tournament_id, md5(coalesce(crest, '')) as crest_hash,
       md5(coalesce(players::text, '')) as players_hash
from public.gn_teams;

grant select on public.gn_teams_crest to anon, authenticated;

-- index.html（js/）の対応する変更もあわせて反映してください（版番号 20261128s）。
