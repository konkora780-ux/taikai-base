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
    const o = state.official; o.matchMin = "80"; o.etMin = ""; o.at = ["","","",""];
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
  // 既定＝「途中出場だけATを含める」：先発は試合時間（80）が上限、途中出場は実際の時間（AT込み・最低1分）
  check("既定は「途中出場だけ含める」", await page.evaluate(()=> playTimeMode()==="sub"));
  check("先発フル出場＝80（ATを足さない）", c[4]===80, JSON.stringify(c));
  check("40分に交代で退く＝40", c[0]===40);
  check("80+3分に退いた先発＝80（頭打ち）", c[1]===80, JSON.stringify(c));
  check("80+3分に入った控え＝最低1分", c[12]===1, JSON.stringify(c));
  check("25分に退場＝25", c[2]===25);
  check("HT交代：先発40・途中出場43（後半AT3分込み）", c[3]===40 && c[15]===43, JSON.stringify(c));
  check("40分から入って60分で退く＝20", c[11]===20);
  check("60分から入る＝23（後半AT込み）", c[13]===23);
  check("出ていない控え＝0", c[14]===0);
  check("画面の表示も同じ", r.h[0]==="40" && r.h[11]==="20" && r.h[4]==="80" && r.h[13]==="23", JSON.stringify(r.h));
  // 書き直すとすぐ反映
  await page.evaluate(()=>{ const el=document.querySelector('.fx[data-p="H.lineup.0.subTime"]'); el.value="50分"; el.dispatchEvent(new Event("input",{bubbles:true})); });
  check("交代の時間を直すとすぐ反映", await page.evaluate(()=> document.querySelectorAll("#ptime .ptval")[0].textContent==="50" && document.querySelectorAll("#ptime .ptval")[11].textContent==="10"));
  // アディショナルタイムの入力欄：前半2・後半5 → 試合時間の欄が「80+7」
  const at = await page.evaluate(()=>{
    const f = (i,v)=>{ const el=document.getElementById("of-at-"+i); el.value=v; el.dispatchEvent(new Event("input",{bubbles:true})); };
    f(0,"２"); f(1,"5");
    const c = officialPlayMinutes(state.official,"H");
    return { mm:state.official.matchMin, dom:document.querySelector('.fx[data-p="matchMin"]').value, full:c[4], ht:c[3], htIn:c[15], in60:c[13], at:state.official.at };
  });
  check("AT入力→試合時間「80+7」（全角も半角に）", at.mm==="80+7" && at.dom==="80+7", JSON.stringify(at));
  check("先発フル出場は80のまま", at.full===80, JSON.stringify(at));
  check("HT交代で入った控え＝後半40+AT5＝45", at.ht===40 && at.htIn===45, JSON.stringify(at));
  check("60分（前半AT2のあと）に入った控え＝25", at.in60===25, JSON.stringify(at));
  // 試合時間の欄に直接「80+4」→ 前半2のままなので後半2（ただし80+3分の交代があるので後半ATは3とみなす）
  const direct = await page.evaluate(()=>{ const el=document.querySelector('.fx[data-p="matchMin"]'); el.focus(); el.value="80+4"; el.dispatchEvent(new Event("input",{bubbles:true}));
    return { at:state.official.at.slice(), dom1:document.getElementById("of-at-1").value, in60:officialPlayMinutes(state.official,"H")[13] }; });
  check("試合時間に「80+4」と書くと内訳も合う", direct.at[0]==="2" && direct.at[1]==="2" && direct.dom1==="2" && direct.in60===23, JSON.stringify(direct));
  // 設定「全員含める」「含めない」
  const modes = await page.evaluate(()=>{ const r={}; ["all","none"].forEach(k=>{ cfg_set("playTimeMode", k); r[k]=officialPlayMinutes(state.official,"H"); }); cfg_set("playTimeMode","sub"); return r; });
  check("「全員含める」ならフル出場＝85・80+3で退く＝85", modes.all[4]===85 && modes.all[1]===85, JSON.stringify(modes.all));
  check("「含めない」なら80・80+3の交代は80・入った控えは0", modes.none[4]===80 && modes.none[1]===80 && modes.none[12]===0, JSON.stringify(modes.none));
  check("延長あり（延長20分）：先発フル出場＝100", await page.evaluate(()=>{ const o=state.official; o.etMin="20"; const m=curMatchAny();
    const save=m.lineups; m.lineups=Object.assign({}, m.lineups, { _meta:Object.assign({}, (m.lineups||{})._meta, { useET:true }) });
    const v = officialPlayMinutes(o,"H")[4]; m.lineups=save; o.etMin=""; return v===100; }));
  // 参考資料（90分・後半AT6）の例：90+1分交代で入った＝5、90+6分＝1、69分＝27、先発で90+1分に退いた＝90
  const ref = await page.evaluate(()=>{
    const o = state.official; o.matchMin="90"; o.at=["","","",""];
    const L = o.A.lineup; L.forEach((x,i)=>{ x.no=String(i+1); x.name="A"+(i+1); x.subNo=""; x.subTime=""; });
    o.A.cards.forEach(c=>{ c.time=""; c.kind=""; c.no=""; });
    L[0].subTime="90+1分"; L[11].subNo="1";
    L[1].subTime="90+6分"; L[12].subNo="2";
    L[2].subTime="69分";   L[13].subNo="3";
    return officialPlayMinutes(o,"A");
  });
  check("参考資料の例（5・1・27、先発は90）", ref[11]===5 && ref[12]===1 && ref[13]===27 && ref[0]===90 && ref[1]===90 && ref[2]===69 && ref[4]===90, JSON.stringify(ref));
  // 出場時間の列の横線が、用紙のメンバー表の横線とぴったり同じ高さ・太さか（表示の大きさ 60〜140%）
  for(const z of [0.6, 0.8, 1, 1.4]){
    const res = await page.evaluate(z=>{ state.sheetZoom = z; render();
      const sheet = document.querySelector(".sheet-a4");
      const main = [...sheet.querySelectorAll(".ln")].map(e=>e.getBoundingClientRect()).filter(r=> r.width > r.height*20);
      const tbl = sheet.querySelector('.fx[data-p="H.lineup.0.subNo"]').getBoundingClientRect();
      const pts = [...sheet.querySelectorAll("#ptime .ptln")].map(e=>e.getBoundingClientRect()).filter(r=> r.width > r.height && r.right < tbl.left);
      const bad = pts.filter(p=> !main.some(m=> Math.abs(m.top-p.top)<0.2 && Math.abs(m.height-p.height)<0.2 && m.left < tbl.left+2 && m.right > tbl.left));
      const thick = pts.filter(p=> p.height > 1.2*z).length;
      return { n:pts.length, bad:bad.length, thick };
    }, z);
    check(`横線が用紙とそろう（${Math.round(z*100)}%）`, res.n===22 && res.bad===0 && res.thick===1, JSON.stringify(res));
  }
  await page.evaluate(()=>{ state.sheetZoom = 1; render(); });
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
