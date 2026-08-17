-- ============================================================
-- 大会ベース：公開範囲の見直し（2026-08-17）
--
-- 目的：
--   「公式記録を非公開にする」ボタンは、今は画面の表示だけを制御していて、
--   データベースに直接アクセスされた場合には中身が読めてしまう状態でした。
--   これを、データベース側でも実際に非公開が守られるように直します。
--
-- 変えないこと：
--   大会名・日程・チーム名・得点・順位表・トーナメント表・得点ランキング・
--   アシストランキング・出場記録・メンバー表（先発/控え等）は、今まで通り
--   誰でも見られます（これらは大会ベースが意図して公開している情報です）。
--
-- 変わること：
--   公式記録の詳細（審判名・天候・PKの経過・詳しいメモなど）は、
--   運営者が「公開する」ボタンを押した試合の分だけ、実際にデータが届くようになります。
--
-- 進め方：
--   ①→②→（index.html反映・動作確認）→③ の順で実行済み（2026-08-17 完了）。
--   本番で「gn_matchesへの匿名直接アクセスが空配列になる」「gn_matches_publicは今まで通り」
--   ことをcurlで直接確認済み。
-- ============================================================


-- ① 今のgn_matchesの「読み取り」設定を確認する（変更はしません・見るだけです）
--    結果に出てくる policyname（設定の名前）を、あとで③のために控えておいてください。
select policyname, cmd, qual
from pg_policies
where schemaname = 'public' and tablename = 'gn_matches';


-- ② 公開用の窓口（ビュー）を新しく作る（既存のgn_matchesテーブルはまだ変更しません）
--    「official（公式記録）」だけ、公開設定(public=true)の試合の分だけ含めます。
--    それ以外の列は今まで通りすべて含みます。
create or replace view public.gn_matches_public as
select
  id, tournament_id, org_id, stage, grp, round, slot, "matchNo",
  home_team, away_team, home_src, away_src,
  kickoff, venue,
  home_score, away_score, home_pk, away_pk,
  status, events, note, sort_order, updated_at, lineups,
  case when (official ->> 'public') = 'true' then official else null end as official
from public.gn_matches;

grant select on public.gn_matches_public to anon, authenticated;


-- ここまで実行したら、いったんSupabase側の作業は完了です。
-- 次に index.html をGitHubへアップロードし、公開ページで下記を確認してください。
--   ・保護者・選手として（ログインせず）大会を開き、日程・順位表・ランキング・
--     出場記録がこれまで通り表示される
--   ・非公開の公式記録リンクを開くと「まだ公開されていません」と出る
--   ・「公開する」を押した試合の公式記録は、これまで通り開ける
--   ・運営者としてログインしたときは、これまで通りすべて編集できる
--
-- ここまで問題なければ、③（元のテーブルへの直接アクセスを塞ぐ手順）は
-- 別途あらためてご案内します。①の結果（policyname）を教えてください。


-- ③ 元のgn_matchesテーブルを、運営者本人が自分の大会を読むときだけ直接読めるようにする（実行済み）
--    ①で確認したpolicyname「p_read」（元の定義は SELECT ... using (true) ＝誰でも読めていた）を、
--    ALTER POLICYでその場で条件を絞る形で対応（drop+createではなく1文で安全に変更）。
alter policy "p_read" on public.gn_matches using (auth.uid() = org_id);

-- 適用後、匿名アクセスで確認した結果（curlで直接検証・2026-08-17）：
--   gn_matches        → [] （空配列＝ブロック成功）
--   gn_matches_public → 公開設定(public=true)の試合の中身が今まで通り正常に返る
