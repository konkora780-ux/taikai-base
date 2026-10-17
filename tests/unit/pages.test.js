// 大会ベース：HTMLページの基本チェック
// スマホで縮小表示にならないよう、各ページに文字コードと viewport（画面幅の指定）があることを確かめる。
// 実行： npm run test:unit
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const PAGES = ["index.html", "お試し版.html",
  "guide-ops.html", "guide-staff.html", "guide-team.html", "guide-viewer.html"];

for(const file of PAGES){
  test(`${file}：DOCTYPE・文字コード・viewport がある`, ()=>{
    const html = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.match(html.trimStart(), /^<!DOCTYPE html>/i, "先頭に <!DOCTYPE html> が必要");
    assert.match(html, /<meta\s+charset="UTF-8">/i, "<meta charset> が必要");
    assert.match(html, /<meta\s+name="viewport"\s+content="width=device-width/i, "viewport の指定が必要");
  });
}
