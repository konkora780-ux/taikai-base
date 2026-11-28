// 公式記録の枠を矢印キー・Enterで移動できるかを、にせSupabaseで確かめるスクリプト。
// 実行： node tests/official-keynav.js   （ネットワーク不要）
"use strict";
const { chromium } = require("playwright");
const { serve, fixture, FAKE } = require("./poll-traffic");

(async()=>{
  const fx = fixture();
  const srv = await serve(47812);
  const browser = await chromium.launch();
  const out = {}; let ok = true;
  const check = (name, cond, extra) => { out[name] = cond ? "OK" : "NG " + (extra||""); if(!cond) ok = false; };
  for(const vp of [{ name:"PC", viewport:{ width:1400, height:900 } }, { name:"スマホ", viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true }]){
    const page = await (await browser.newContext({ viewport:vp.viewport, isMobile:!!vp.isMobile, hasTouch:!!vp.hasTouch })).newPage();
    const errors = [];
    page.on("pageerror", e=> errors.push(e.message));
    await page.route(/cdn\.jsdelivr\.net\/npm\/@supabase/, r=> r.fulfill({ status:200, contentType:"text/javascript", body:FAKE }));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r=> r.fulfill({ status:200, body:"" }));
    await page.addInitScript(([d, user])=>{ window.__fakeDb = d; window.__fakeUser = user; }, [fx.db, { id:fx.ORG, email:"test@taikai.invalid" }]);
    await page.goto(`http://localhost:${srv.address().port}/index.html#t=${fx.TID}`);
    await page.waitForFunction(()=> typeof state!=="undefined" && !state.loading && state.view==="t" && state.matches.length===36, null, { timeout:15000 });
    await page.evaluate(id=> openOfficial(id), fx.db.gn_matches[0].id); await page.waitForTimeout(300);
    const cur = ()=> page.evaluate(()=> document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.p : null);
    const focus = p => page.evaluate(p=> document.querySelector(`.fx[data-p="${p}"]`).focus(), p);   // （フォーカスのみ。カーソル位置はブラウザ任せ）
    const press = async (k, p)=> { if(p) await focus(p); await page.keyboard.press(k); return cur(); };
    const T = s => vp.name + "：" + s;

    check(T("↓ 選手名→次の行の選手名"), await press("ArrowDown", "H.lineup.0.name") === "H.lineup.1.name");
    check(T("↑ で戻る"), await press("ArrowUp") === "H.lineup.0.name");
    check(T("→ 選手名（選ぶ枠）→番号"), await press("ArrowRight", "H.lineup.0.name") === "H.lineup.0.no");
    check(T("← 空の番号→選手名"), await press("ArrowLeft", "H.lineup.0.no") === "H.lineup.0.name");
    // 文字の途中では←→はカーソル移動、端に来たら枠移動
    await page.evaluate(()=>{ const el=document.querySelector('.fx[data-p="H.lineup.0.subTime"]'); el.focus(); el.value="12"; el.setSelectionRange(2,2); });
    check(T("文字の途中の← はカーソル移動"), await press("ArrowLeft") === "H.lineup.0.subTime" && await press("ArrowLeft") === "H.lineup.0.subTime");
    check(T("先頭で← は左の枠へ"), await press("ArrowLeft") === "H.lineup.0.subNo");
    check(T("全選択中の→ は右の枠へ"), await press("ArrowRight") === "H.lineup.0.subTime" && await press("ArrowRight") !== "H.lineup.0.subTime");
    check(T("Shift+← は範囲選択（移動しない）"), await press("Shift+ArrowLeft", "H.lineup.0.no") === "H.lineup.0.no");
    // 日本語変換中は移動しない
    const moved = await page.evaluate(()=>{ const el=document.querySelector('.fx[data-p="H.lineup.0.no"]'); el.focus();
      el.dispatchEvent(new KeyboardEvent("keydown",{ key:"ArrowDown", isComposing:true, bubbles:true, cancelable:true })); return document.activeElement.dataset.p; });
    check(T("変換中の↓ は移動しない"), moved === "H.lineup.0.no");
    // 審判（結合した枠）
    check(T("副審1→↓副審2"), await press("ArrowDown", "ar1") === "ar2");
    check(T("副審2→←主審"), await press("ArrowLeft") === "referee");
    check(T("主審→→ 元の行（副審2）に戻る"), await press("ArrowRight") === "ar2");
    // Enter
    check(T("Enter で下の枠へ"), await press("Enter", "ar1") === "ar2");
    check(T("Shift+Enter で上の枠へ"), await press("Shift+Enter") === "ar1");
    await focus("H.lineup.0.name"); await page.keyboard.press("Enter"); await page.waitForTimeout(100);
    check(T("選ぶ枠で Enter → リストが開く"), await page.evaluate(()=> !!document.querySelector(".modal .picklist")));
    await page.evaluate(()=> document.querySelectorAll(".modal").forEach(m=>m.remove()));
    // チーム名（折り返しの枠）
    const nm = await press("ArrowDown", "H.name");
    check(T("チーム名から↓ で移動できる"), nm && nm !== "H.name", nm);
    // 選手名の連続移動：結合セルをまたいでも同じ列を保つ（警告・退場の欄まで）
    await focus("H.lineup.0.no"); let last=null; for(let i=0;i<40;i++){ last = await press("ArrowDown"); }
    check(T("↓ を続けても止まらずに下へ進む"), last && !/^H\.lineup\.0\./.test(last), last);
    // 表示の大きさ 60% でも動く
    await page.evaluate(()=>{ state.sheetZoom=0.6; render(); }); await page.waitForTimeout(200);
    check(T("60%表示でも↓"), await press("ArrowDown", "H.lineup.3.name") === "H.lineup.4.name");
    // 入力した内容が保存データに入る（既存の動き）
    await focus("H.lineup.5.subTime"); await page.keyboard.type("45"); await page.keyboard.press("ArrowDown");
    check(T("入力内容が残る"), await page.evaluate(()=> state.official.H.lineup[5].subTime) === "45");
    // 数字の枠：全角で入っても半角に（日本語入力がオンのまま打った場合）
    const hw = await page.evaluate(()=>{
      const q = p=> document.querySelector(`.fx[data-p="${p}"]`);
      const put = (p, v, ev)=>{ const el=q(p); el.focus(); el.value=v; el.dispatchEvent(ev==="comp" ? new CompositionEvent("compositionend",{bubbles:true}) : new Event("input",{bubbles:true})); };
      put("H.lineup.2.no", "１２");
      put("H.lineup.2.subTime", "４５＋２分", "comp");
      put("temp", "ー３");
      put("referee", "１２３");   // 名前の枠はそのまま
      return new Promise(r=> setTimeout(()=> r({ no:state.official.H.lineup[2].no, noDom:q("H.lineup.2.no").value, sub:state.official.H.lineup[2].subTime,
        temp:state.official.temp, ref:state.official.referee,
        imNo:q("H.lineup.2.no").inputMode, imSub:q("H.lineup.2.subTime").inputMode, imName:q("H.lineup.2.name").inputMode,
        sc:q("H.scores.0").inputMode, crowd:q("crowd").inputMode }), 50));
    });
    check(T("全角の数字→半角（番号）"), hw.no==="12" && hw.noDom==="12", JSON.stringify(hw));
    check(T("確定後も半角（交代時間 45+2分）"), hw.sub==="45+2分", JSON.stringify(hw));
    check(T("気温のマイナス"), hw.temp==="-3", JSON.stringify(hw));
    check(T("名前の枠は変えない"), hw.ref==="１２３", JSON.stringify(hw));
    check(T("数字だけの枠は数字キーボード"), hw.imNo==="numeric" && hw.sc==="numeric" && hw.crowd==="numeric" && hw.imSub==="" && hw.imName==="", JSON.stringify(hw));
    // 自動計算の合計欄：入力できない・矢印キーで飛ばす・内訳から計算
    check(T("→ でシュートの計を飛ばす"), await press("ArrowRight", "H.lineup.0.s1") === "H.lineup.0.g");
    check(T("← でも飛ばす"), await press("ArrowLeft", "H.lineup.0.g") === "H.lineup.0.s1");
    const tk = await page.evaluate(()=> TOTAL_KEYS[1]);
    await focus(`H.tot.${tk}.0`); await page.keyboard.type("3"); await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowLeft");   // 1回目は文字の先頭へ、2回目で隣の枠へ
    const after = await cur();
    await page.keyboard.type("2");
    const calc = await page.evaluate(k=>{ const el=document.querySelector(`.fx[data-p="H.tot.${k}.2"]`);
      return { v:el.value, st:state.official.H.tot[k][2], ro:el.readOnly, ti:el.tabIndex, pe:getComputedStyle(el).pointerEvents,
        stRo:document.querySelector('.fx[data-p="A.lineup.0.st"]').readOnly }; }, tk);
    check(T("チーム合計の計＝前半＋後半（自動）"), calc.v==="5" && calc.st==="5", JSON.stringify(calc)+" "+after);
    check(T("計の枠は入力できない"), calc.ro && calc.ti===-1 && calc.pe==="none" && calc.stRo, JSON.stringify(calc));
    check(T("前半→← で後半へ（用紙の並びどおり）"), after === `H.tot.${tk}.1`, after);
    check(T("前半→→ は計を飛ばして相手チームの前半へ"), await page.evaluate(k=>{ const el=document.querySelector(`.fx[data-p="H.tot.${k}.0"]`); el.focus(); el.select(); }, tk) || await press("ArrowRight") === `A.tot.${tk}.0`);
    // 選手のシュート：PCは数字を直接入力、スマホはリストから選ぶ
    if(vp.name==="PC"){
      const s1 = await page.evaluate(()=>{ const el=document.querySelector('.fx[data-p="H.lineup.8.s1"]'); return { pick:el.classList.contains("pickable"), ro:el.readOnly }; });
      check(T("シュート欄は手入力できる"), !s1.pick && !s1.ro, JSON.stringify(s1));
      await focus("H.lineup.8.s1"); await page.keyboard.type("2"); await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowLeft");   // 1回目は文字の先頭へ、2回目で左（後半）の枠へ
      const nx = await cur(); await page.keyboard.type("1");
      const r = await page.evaluate(()=>({ st:state.official.H.lineup[8].st, stDom:document.querySelector('.fx[data-p="H.lineup.8.st"]').value,
        f:state.official.H.tot.shot[0], h:state.official.H.tot.shot[1], t:state.official.H.tot.shot[2] }));
      check(T("前半2・後半1 → 計3（チーム合計も自動）"), nx==="H.lineup.8.s2" && r.st==="3" && r.stDom==="3" && r.f==="2" && r.h==="1" && r.t==="3", nx+" "+JSON.stringify(r));
      await page.evaluate(()=>{ const el=document.querySelector('.fx[data-p="A.lineup.8.s1"]'); el.focus(); el.value="４"; el.dispatchEvent(new Event("input",{bubbles:true})); });
      check(T("シュートも全角→半角"), await page.evaluate(()=> state.official.A.lineup[8].s1==="4" && state.official.A.lineup[8].st==="4"));
      await page.keyboard.press("Enter");
      check(T("シュート欄で Enter はリストを開かず下へ"), !(await page.evaluate(()=> !!document.querySelector(".modal .picklist"))) && await cur()==="A.lineup.9.s1");
    } else {
      const pk = await page.evaluate(()=> document.querySelector('.fx[data-p="H.lineup.8.s1"]').classList.contains("pickable"));
      check(T("シュート欄はリストから選ぶ（従来どおり）"), pk);
      await page.evaluate(()=> document.querySelector('.fx[data-p="H.lineup.8.s1"]').click()); await page.waitForTimeout(100);
      check(T("タップでシュートのリストが開く"), await page.evaluate(()=> /シュート/.test((document.querySelector(".modal h3")||{}).textContent||"")));
      await page.evaluate(()=> document.querySelectorAll(".modal").forEach(m=>m.remove()));
    }
    check(T("JSエラーなし"), !errors.length, errors.join(" / "));
    if(vp.name==="PC"){ await page.evaluate(()=>{ state.sheetZoom=1; render(); }); await focus("ar1");
      await page.screenshot({ path: process.env.SHOT || "/tmp/keynav.png" }); }
  }
  console.log(JSON.stringify(out, null, 1));
  await browser.close(); srv.close();
  process.exit(ok ? 0 : 1);
})().catch(e=>{ console.error(e); process.exit(1); });
