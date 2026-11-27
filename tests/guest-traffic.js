// 一般の閲覧（ログインなし）の通信量と画面の動きを、にせSupabaseで確かめるスクリプト。
// ・最初の読み込みの通信量（30秒だけ見る使い方を想定）
// ・日程・順位表などの「軽い画面」は、名簿などを読まなくても読んだときと同じ表示になること
// ・名簿などが要る画面（得点ランキング・出場記録・試合・公式記録の公開リンク）は、開いたときに読んで表示されること
// ・指サインの画像が一般の閲覧者に届かないこと（「署名済」と表示）、運営には届くこと
// ・校章を覚えて、2回目は読まないこと
// ・setup-30 を実行していないとき（窓口が無い）でも、従来どおり動くこと
// 実行： node tests/guest-traffic.js   （ネットワーク不要）
"use strict";
const { chromium } = require("playwright");
const { serve, fixture, FAKE } = require("./poll-traffic");

async function openApp({ role="guest", noOpen=false, hash, storage }){
  const fx = fixture();
  const srv = await serve(47811);   // 校章の覚え（localStorage）を引き継ぐため、毎回同じ住所で配信する
  const base = `http://localhost:${srv.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext(storage ? { storageState:storage } : {});
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e=> errors.push(e.message));
  page.on("console", m=> { if(m.type()==="error") errors.push("console: "+m.text()); });
  await page.route(/cdn\.jsdelivr\.net\/npm\/@supabase/, r=> r.fulfill({ status:200, contentType:"text/javascript", body:FAKE }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r=> r.fulfill({ status:200, body:"" }));
  await page.addInitScript(([d, user, no])=>{ window.__fakeDb = d; window.__fakeUser = user; window.__fakeNoOpen = no; },
    [fx.db, role==="owner" ? { id:fx.ORG, email:"test@taikai.invalid" } : null, noOpen]);
  await page.goto(base + "index.html" + (hash ? hash(fx) : "#t=" + fx.TID));
  await page.waitForFunction(()=> typeof state !== "undefined" && !state.loading && (state.view==="t" ? state.matches.length===36 : !!state.t), null, { timeout:15000 });
  await page.waitForTimeout(300);
  const close = async ()=>{ await browser.close(); srv.close(); };
  return { page, ctx, errors, fx, close };
}
const kb = n => Math.round(n/1024) + "KB";
const screenHtml = page => page.evaluate(()=> (document.querySelector(".screen")||document.body).innerHTML.replace(/\s+/g," "));

(async()=>{
  const out = {}; let ok = true;
  const check = (name, cond, extra) => { out[name] = cond ? "OK" : "NG " + (extra||""); if(!cond) ok = false; };

  // ① 一般の閲覧：最初の読み込み
  let a = await openApp({});
  const first = await a.page.evaluate(()=> ({ bytes:window.__bytes, sign:window.__signBytes||0, lazy:state.lazyGuest, heavy:state.heavyLoaded }));
  out["一般・最初の読み込み"] = kb(first.bytes);
  check("一般・軽い読み込みになっている", first.lazy && !first.heavy);
  const storage = await a.ctx.storageState();

  // ② 軽い画面：名簿などを読む前と読んだ後で表示が同じか
  const LITE = await a.page.evaluate(()=> GUEST_LITE_TABS.slice());
  const tabsOf = await a.page.evaluate(()=> tournamentTabs(state.t, cfgOf(state.t)).map(x=>x[0]));
  const before = {};
  for(const k of LITE.filter(k=>tabsOf.includes(k))){ await a.page.evaluate(k=> setTab(k), k); await a.page.waitForTimeout(80); before[k] = await screenHtml(a.page); }
  const liteBytes = await a.page.evaluate(()=> window.__bytes);
  check("一般・軽い画面では追加で読まない", liteBytes === first.bytes, kb(liteBytes - first.bytes));
  // 名簿などを読む
  await a.page.evaluate(()=> ensureHeavy());
  await a.page.waitForTimeout(200);
  const heavyBytes = await a.page.evaluate(()=> window.__bytes) - liteBytes;
  out["一般・名簿などを読んだときの追加分"] = kb(heavyBytes);
  for(const k of Object.keys(before)){
    await a.page.evaluate(k=> setTab(k), k); await a.page.waitForTimeout(80);
    const after = await screenHtml(a.page);
    let at = 0; while(at < after.length && after[at] === before[k][at]) at++;
    check(`軽い画面「${k}」の表示が同じ`, after === before[k], "前:" + before[k].slice(Math.max(0,at-60), at+80) + " ／後:" + after.slice(Math.max(0,at-60), at+80));
  }
  await a.close();

  // ③ 名簿などが要る画面：開くと読み込んで表示される
  a = await openApp({});
  for(const k of tabsOf.filter(k=> !LITE.includes(k))){
    await a.page.evaluate(k=> setTab(k), k); await a.page.waitForTimeout(300);
    const txt = await a.page.evaluate(()=> document.querySelector(".screen").innerText);
    check(`重い画面「${k}」が表示される`, !/読み込み中/.test(txt) && txt.length > 20, txt.slice(0,40));
  }
  const rank = await a.page.evaluate(()=>{ setTab("scorers"); return document.querySelector(".screen").innerText; });
  check("得点ランキングに選手名が出る", /山田/.test(rank));
  await a.page.evaluate(id=> openMatch(id), a.fx.db.gn_matches[0].id); await a.page.waitForTimeout(300);
  const matchTxt = await a.page.evaluate(()=> document.body.innerText);
  check("試合の画面にメンバーが出る", /山田/.test(matchTxt));
  check("一般・サイン画像は届かない（試合を開いたあとも）", !(await a.page.evaluate(()=> window.__signBytes||0)));
  check("一般・エラーなし", !a.errors.length, a.errors.join(" / "));
  await a.close();

  // ④ 公式記録の公開リンク：「署名済」と表示され、サイン画像は届かない
  a = await openApp({ hash: fx=> "#om=" + fx.db.gn_matches[0].id });
  await a.page.waitForTimeout(300);
  const om = await a.page.evaluate(()=> ({ view:state.view, txt:document.body.innerText, imgs:[...document.querySelectorAll(".signcell img")].length, sign:window.__signBytes||0 }));
  check("公開リンク・公式記録が開く", om.view === "officialPublic" && /公式記録/.test(om.txt));
  check("公開リンク・「署名済」が3枠", (om.txt.match(/署名済/g)||[]).length === 3, (om.txt.match(/署名済/g)||[]).length);
  check("公開リンク・サイン画像が届かない", !om.sign && !om.imgs);
  check("公開リンク・エラーなし", !a.errors.length, a.errors.join(" / "));
  await a.close();

  // ⑤ 校章を覚えている2回目：校章を読まない
  a = await openApp({ storage });
  const second = await a.page.evaluate(()=> ({ bytes:window.__bytes, crestReq: window.__requests.filter(r=> r.table==="gn_teams" && r.cols==="id,crest").length,
    crests: state.teams.filter(t=>t.crest).length }));
  out["一般・2回目の読み込み（校章を覚えている）"] = kb(second.bytes);
  check("2回目は校章を読まない・校章は表示用に入っている", second.crestReq === 0 && second.crests === 37, JSON.stringify(second));
  await a.close();

  // ⑥ 運営（ログイン）：サイン画像も含め従来どおり全部読む
  a = await openApp({ role:"owner" });
  const own = await a.page.evaluate(()=> ({ bytes:window.__bytes, sign:window.__signBytes||0, lazy:state.lazyGuest }));
  out["運営・最初の読み込み"] = kb(own.bytes);
  check("運営・サイン画像が届く（従来どおり）", own.sign > 0 && !own.lazy);
  await a.page.evaluate(id=> openOfficial(id), a.fx.db.gn_matches[0].id); await a.page.waitForTimeout(300);
  check("運営・公式記録にサイン画像が出る", (await a.page.evaluate(()=> document.querySelectorAll(".signcell img").length)) === 3);
  check("運営・エラーなし", !a.errors.length, a.errors.join(" / "));
  await a.close();

  // ⑦ setup-30 を実行していないとき：従来の読み込みに戻って動く
  a = await openApp({ noOpen:true });
  const fb = await a.page.evaluate(()=> ({ bytes:window.__bytes, lazy:state.lazyGuest }));
  out["SQL未実行・一般の最初の読み込み（従来どおり）"] = kb(fb.bytes);
  await a.page.evaluate(()=> setTab("scorers")); await a.page.waitForTimeout(200);
  check("SQL未実行でも動く", !fb.lazy && /山田/.test(await a.page.evaluate(()=> document.querySelector(".screen").innerText)) && !a.errors.length, a.errors.join(" / "));
  await a.close();

  // ⑧ 記入リンク（チーム向け）：従来どおり試合メンバー・公式記録まで読んで開く
  a = await openApp({ hash: fx=> "#entry=" + fx.db.gn_teams[0].id });
  const en = await a.page.evaluate(()=> ({ view:state.view, heavy:state.heavyLoaded, err:state.entry && state.entry.error, lu: state.matches.some(m=> m.lineups && m.lineups.H) }));
  check("記入リンクが開き、試合メンバーも読んでいる", en.view === "entry" && !en.err && en.heavy && en.lu && !a.errors.length, JSON.stringify(en) + a.errors.join(" / "));
  await a.close();

  console.log(JSON.stringify(out, null, 1));
  if(!ok) process.exit(1);
})().catch(e=>{ console.error(e); process.exit(1); });
