// 公式記録の脇の「出場時間」（画面だけの自動計算）を、にせSupabaseで確かめるスクリプト。
// 実行： node tests/official-playtime.js   （ネットワーク不要）  SHOT=ファイル名 で画面の写真も保存
"use strict";
const { chromium } = require("playwright");
const { serve, fixture, FAKE } = require("./poll-traffic");

(async()=>{
  const fx = fixture();
  const srv = await serve(47813);
  const browser = await chromium.launch();
  const out = {}; let ok = true;
  const check = (name, cond, extra) => { out[name] = cond ? "OK" : "NG " + (extra||""); if(!cond) ok = false; };
  const page = await (await browser.newContext({ viewport:{ width:1400, height:1000 } })).newPage();
  const errors = [];
  page.on("pageerror", e=> errors.push(e.message));
  await page.route(/cdn\.jsdelivr\.net\/npm\/@supabase/, r=> r.fulfill({ status:200, contentType:"text/javascript", body:FAKE }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r=> r.fulfill({ status:200, body:"" }));
  await page.addInitScript(([d, user])=>{ window.__fakeDb = d; window.__fakeUser = user; }, [fx.db, { id:fx.ORG, email:"test@taikai.invalid" }]);
  await page.goto(`http://localhost:${srv.address().port}/index.html#t=${fx.TID}`);
  await page.waitForFunction(()=> typeof state!=="undefined" && !state.loading && state.view==="t" && state.matches.length===36, null, { timeout:15000 });
  await page.evaluate(id=> openOfficial(id), fx.db.gn_matches[0].id); await page.waitForTimeout(300);
  // 試合時間80分。H：先発1番が40分に退き(→控え12番)、先発2番が80+3分に退き(→控え13番)、先発3番は25分に退場、
  //    控え12番は60分に退く(→控え14番)、控え15番は出ていない。HT交代：先発4番(→控え16番)
  const r = await page.evaluate(()=>{
    const o = state.official; o.matchMin = "80"; o.etMin = "";
    const L = o.H.lineup;
    L.forEach((x,i)=>{ x.no = String(i+1); x.name = "選手"+(i+1); x.subNo=""; x.subTime=""; });
    L[0].subTime = "40分";  L[11].subNo = "1";
    L[1].subTime = "80+3分"; L[12].subNo = "2";
    L[11].subTime = "60分"; L[13].subNo = "12";
    L[3].subTime = "HT";    L[15].subNo = "4";
    o.H.cards.forEach(c=>{ c.time=""; c.kind=""; c.no=""; });
    o.H.cards[0].time = "25分"; o.H.cards[0].kind = "退"; o.H.cards[0].no = "3";
    render();
    const v = [...document.querySelectorAll("#ptime .ptval")].map(e=>e.textContent);
    return { calc: officialPlayMinutes(o,"H"), h: v.slice(0,20) };
  });
  const c = r.calc;
  check("先発・交代なし＝80", c[4]===80, JSON.stringify(c));
  check("40分に交代で退く＝40", c[0]===40);
  check("80+3分の交代は80（ATは数えない）", c[1]===80 && c[12]===0, JSON.stringify(c));
  check("25分に退場＝25", c[2]===25);
  check("HT交代：先発40・途中出場40", c[3]===40 && c[15]===40, JSON.stringify(c));
  check("40分から入って60分で退く＝20", c[11]===20);
  check("60分から入る＝20", c[13]===20);
  check("出ていない控え＝0", c[14]===0);
  check("画面の表示も同じ", r.h[0]==="40" && r.h[11]==="20" && r.h[4]==="80", JSON.stringify(r.h));
  // 書き直すとすぐ反映
  await page.evaluate(()=>{ const el=document.querySelector('.fx[data-p="H.lineup.0.subTime"]'); el.value="50分"; el.dispatchEvent(new Event("input",{bubbles:true})); });
  check("交代の時間を直すとすぐ反映", await page.evaluate(()=> document.querySelectorAll("#ptime .ptval")[0].textContent==="50" && document.querySelectorAll("#ptime .ptval")[11].textContent==="10"));
  // 延長あり（20分）
  check("延長あり（延長20分）なら100分まで", await page.evaluate(()=>{ const o=state.official; o.etMin="20"; const m=curMatchAny();
    const save=m.lineups; m.lineups=Object.assign({}, m.lineups, { _meta:Object.assign({}, (m.lineups||{})._meta, { useET:true }) });
    const v = officialPlayMinutes(o,"H")[4]; m.lineups=save; o.etMin=""; return v===100; }));
  // 印刷には出ない
  if(process.env.SHOT) await page.screenshot({ path:process.env.SHOT, fullPage:false });
  await page.emulateMedia({ media:"print" });
  check("印刷には出ない", await page.evaluate(()=> getComputedStyle(document.getElementById("ptime")).display==="none"));
  await page.emulateMedia({ media:"screen" });
  // 一般公開の閲覧ビューには出ない
  await page.evaluate(()=>{ state.officialReadOnly = true; render(); });
  check("一般の閲覧には出ない", await page.evaluate(()=> !document.getElementById("ptime")));
  check("JSエラーなし", !errors.length, errors.join(" / "));
  console.log(JSON.stringify(out, null, 1));
  await browser.close(); srv.close();
  process.exit(ok ? 0 : 1);
})().catch(e=>{ console.error(e); process.exit(1); });
