-- ============================================================
-- 大会ベース：書き込み(INSERT/UPDATE/DELETE)RLSポリシーの棚卸し（2026-08-21）
--
-- 目的：
--   セキュリティ監査で「読み取りポリシーはsetup-8で絞り込み済みだが、
--   書き込み側（INSERT/UPDATE/DELETE）が本当にorg_id=auth.uid()等で
--   絞られているか、ファイルだけでは確認できない」と指摘されたための
--   確認クエリ。何も変更しません（読むだけです）。
--
-- 対象テーブル：
--   アプリが画面から直接 upsert/insert/update/delete しているテーブル
--   （gn_entry / gn_club_entry は記入コードの有効期限・発行で直接書き込み、
--    それ以外は DB.upsert 経由）
--
-- 進め方：
--   このSELECTを実行して、結果をそのまま貼ってください。
--   結果を見て、緩すぎる設定があれば個別に直す提案（③のような1文ALTER POLICY）
--   をあらためてお渡しします。ここでは変更は一切行いません。
-- ============================================================

select
  tablename,
  policyname,
  cmd,           -- SELECT / INSERT / UPDATE / DELETE / ALL
  permissive,
  roles,
  qual,          -- USING句（既存行を対象にする条件）
  with_check     -- WITH CHECK句（新しく書き込む内容を対象にする条件）
from pg_policies
where schemaname = 'public'
  and tablename in (
    'gn_tournaments',
    'gn_teams',
    'gn_matches',
    'gn_clubs',
    'gn_members',
    'gn_orgs',
    'gn_entry',
    'gn_club_entry'
  )
order by tablename, cmd, policyname;


-- 参考：RLSが有効になっていないテーブルがあると上のSELECTには何も出ないのに
-- 誰でも書き込めてしまうことがあるため、念のためRLSの有効/無効も確認します。
select relname as tablename, relrowsecurity as rls_enabled
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in (
    'gn_tournaments','gn_teams','gn_matches','gn_clubs',
    'gn_members','gn_orgs','gn_entry','gn_club_entry'
  )
order by relname;
