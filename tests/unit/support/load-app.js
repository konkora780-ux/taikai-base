// 大会ベースの js/*.js は（バンドラを使わない）ブラウザ用のグローバルスクリプトなので、
// Node.js上でも実際のコードをそのまま実行してテストできるよう、最小限のブラウザ代替
// （document.body・MutationObserver・window.addEventListener）だけを用意して vm でロードする。
// ロジックをテスト用に書き直す（＝本番と別のコードをテストしてしまう）のを避けるための方式。
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const JS_DIR = path.join(__dirname, "..", "..", "..", "js");

// 読み込む順番はindex.htmlの<script>タグの並びに合わせる（configトライアル版=Supabase未接続で読む）
const FILES = ["config.trial.js", "db.js", "calc.js", "views-home.js", "views-match.js"];

function loadApp(){
  const noop = () => {};
  const fakeEl = () => ({
    style: {}, classList: { add: noop, remove: noop, contains: () => false },
    addEventListener: noop, removeEventListener: noop, setAttribute: noop,
    querySelector: () => null, querySelectorAll: () => [], appendChild: noop, remove: noop,
    contains: () => false,
  });
  const sandbox = {
    console,
    document: {
      body: fakeEl(),
      activeElement: null,
      addEventListener: noop,
      createElement: fakeEl,
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    window: {},
    localStorage: {
      _data: {},
      getItem(k){ return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; },
      setItem(k, v){ this._data[k] = String(v); },
      removeItem(k){ delete this._data[k]; },
    },
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    location: { origin: "https://example.invalid", pathname: "/", hash: "" },
    MutationObserver: class { observe(){} disconnect(){} },
    requestAnimationFrame: noop,
  };
  sandbox.window.addEventListener = noop;
  sandbox.window.matchMedia = () => ({ matches: false });
  sandbox.globalThis = sandbox;

  const context = vm.createContext(sandbox);
  FILES.forEach(name=>{
    const code = fs.readFileSync(path.join(JS_DIR, name), "utf8");
    vm.runInContext(code, context, { filename: name });
  });
  // vmの中で const/let 宣言したものは、外からcontext.xxxで直接は読めない
  // （関数宣言だけがグローバルオブジェクトのプロパティになる）ので、
  // テストから使う分だけ明示的にglobalThisへ載せておく。
  vm.runInContext(
    `Object.assign(globalThis, { state, canEdit, cfgOf, teamById, teamName, orgYear });`,
    context
  );
  return context;
}

module.exports = { loadApp };
