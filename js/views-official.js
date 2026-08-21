function viewOfficial(){
  const m = state.matches.find(x=>x.id===state.matchId);
  if(!m) return topbar({title:"公式記録", back:"go('t')"}) + `<div class="empty">見つかりません。</div>`;
  const z = state.sheetZoom || 1;
  return `<div class="tourwrap">`
  + topbar({ title:"公式記録", sub:state.t.name, back:"backFromOfficial()",
      act:`<button class="act" onclick="saveOfficial()">保存</button>` })
  + `<div class="twrap">${tournamentSidebar("schedule")}<div class="tmain">
    <div class="sheetbar noprint">
      <span>表示の大きさ</span>
      ${[0.6,0.8,1,1.4].map(v=>`<button class="${z===v?"on":""}" onclick="state.sheetZoom=${v};render()">${Math.round(v*100)}%</button>`).join("")}
      <button onclick="window.print()">🖨 印刷・PDF</button>
    </div>
    <div class="sheetwrap"><div class="sheetscale" style="width:${pt(SHEET.W*z)};height:${pt(SHEET.H*z)}">
      <div class="sheet-a4" style="transform:scale(${z})">${sheetLines()}${sheetFields()}</div>
    </div></div>
    ${(()=>{ const p2 = sheetPage2(state.official); return p2 ? `<div class="sheetwrap page2" style="margin-top:14px"><div class="sheetscale" style="width:${pt(SHEET.W*z)};height:${pt(SHEET.H*z)}">
      <div class="sheet-a4" style="transform:scale(${z})">${p2}</div>
    </div></div>` : ""; })()}
    <div class="screen noprint">
      <p class="hint">枠をタップするとそのまま書き込めます。<b>選手名の欄をタップ</b>すると、登録した選手からリストで選べます。いまの試合の情報（チーム名・メンバー・得点・カード）は下書きとして入れてあります。</p>
      <div class="callout ${state.official.public?"ok":""}" style="margin-bottom:12px">
        ${state.official.public
          ? `🔗 この試合の公式記録は一般公開中です。`
          : `この試合の公式記録は非公開です。`}
        公開・非公開の切り替えは、日程・結果の試合カードから行えます。
      </div>
      <div class="btnrow">
        <button class="btn sec sm" style="flex:1" onclick="saveOfficial(true).then(()=>go('lineup'))">👥 メンバー表を編集</button>
        <button class="btn sec sm" style="flex:1" onclick="importLineupToOfficial()">⬇ メンバー表から取り込む</button>
      </div>
      <div class="btnrow">
        <button class="btn sec sm" style="flex:1" onclick="resyncOfficial()">🔄 試合結果を取り込み直す</button>
      </div>
      <p class="hint" style="margin-top:2px">得点・スコア・PKは、公式記録を開くたび試合結果から自動で入れ直します（審判名・メンバー・シュート・経過記号などの手入力は残ります）。</p>
      <button class="btn" onclick="saveOfficial()">保存する</button>
    </div>
  </div></div></div>`;
}
function officialLinkFor(matchId){ return location.origin + location.pathname + "#om=" + matchId; }
/* 日程・結果カードなどから、公式記録編集画面を開かずにその場で公開/非公開を切り替える */
async function toggleMatchPublic(id){
  const m = state.matches.find(x=>x.id===id); if(!m) return;
  const of = ensureMatchOfficial(m);
  const next = !of.public;
  if(!next && !confirm("この試合の公式記録を非公開にします。よろしいですか？")) return;
  of.public = next;
  if(state.official && state.matchId===id) state.official.public = next;   // 編集画面を開いていれば表示も合わせる
  m.updated_at = new Date().toISOString();
  try{
    await DB.upsert("gn_matches", stripMatch(m));
    toast(next ? "公式記録を公開しました" : "非公開にしました");
    render();
  }catch(e){ console.error(e); toast("できませんでした: "+(e.message||e)); }
}
function backFromOfficial(){ state.official = null; go("t"); }
function openOfficial(id){
  state.matchId = id;
  state.officialReadOnly = false;
  const m = state.matches.find(x=>x.id===id);
  state.official = draftOfficial(m);
  state.sheetZoom = state.sheetZoom || 0.8;
  state.view = "official"; render();
}

/* --- 公式記録の一般公開リンク（ログイン不要・#om=試合id） --- */
async function openOfficialPublic(matchId){
  state.loading = true; state.view = "officialPublic"; state.officialPublicError = null; render();
  try{
    const { m, t, teams, matches } = await DB.loadMatchTarget(matchId);
    if(!m || !t){
      state.officialPublicError = "見つかりませんでした。リンクをご確認ください。";
    } else if(!(m.official && m.official.public)){
      state.t = t; state.matchId = m.id;
      state.officialPublicError = "この試合の公式記録は、まだ一般公開されていません。";
    } else {
      state.t = t; state.teams = teams; state.matches = matches; state.matchId = m.id;
      state.officialReadOnly = true;
      state.official = draftOfficial(m);
      state.sheetZoom = state.sheetZoom || 0.8;
    }
  }catch(e){ console.error(e); state.officialPublicError = "読み込めませんでした。少し時間をおいて開き直してください。"; }
  state.loading = false; render();
}
function viewOfficialPublic(){
  if(state.loading) return topbar({title:"公式記録"}) + `<div class="screen"><div class="empty">読み込み中…</div></div>`;
  if(state.officialPublicError) return topbar({title:"公式記録", back: state.t ? "go('t')" : undefined})
    + `<div class="screen"><div class="empty">${esc(state.officialPublicError)}</div></div>`;
  const m = state.matches.find(x=>x.id===state.matchId);
  if(!m) return topbar({title:"公式記録"}) + `<div class="screen"><div class="empty">見つかりません。</div></div>`;
  const z = state.sheetZoom || 1;
  return topbar({ title:"公式記録", sub:state.t.name, back:"go('t')" })
  + `<div class="sheetbar noprint">
      <span>表示の大きさ</span>
      ${[0.6,0.8,1,1.4].map(v=>`<button class="${z===v?"on":""}" onclick="state.sheetZoom=${v};render()">${Math.round(v*100)}%</button>`).join("")}
      <button onclick="window.print()">🖨 印刷・PDF</button>
    </div>
    <div class="sheetwrap"><div class="sheetscale" style="width:${pt(SHEET.W*z)};height:${pt(SHEET.H*z)}">
      <div class="sheet-a4" style="transform:scale(${z})">${sheetLines()}${sheetFields()}</div>
    </div></div>
    ${(()=>{ const p2 = sheetPage2(state.official); return p2 ? `<div class="sheetwrap page2" style="margin-top:14px"><div class="sheetscale" style="width:${pt(SHEET.W*z)};height:${pt(SHEET.H*z)}">
      <div class="sheet-a4" style="transform:scale(${z})">${p2}</div>
    </div></div>` : ""; })()}
    <div class="screen noprint">
      <p class="hint">運営が公開した、この試合の公式記録です。</p>
    </div>`;
}
function importLineupToOfficial(){
  const m = curMatchAny(); if(!m || !state.official) return;
  applyLineupToOfficial(state.official, m, "H", true);
  applyLineupToOfficial(state.official, m, "A", true);
  render(); toast("メンバー表から取り込みました");
}
/* 試合結果（得点・スコア・PK）を公式記録に入れ直す。今の編集内容を土台にするので手入力は残る */
function resyncOfficial(){
  const m = curMatchAny(); if(!m || !state.official) return;
  const saved = m.official;
  m.official = state.official;          // いまの編集内容を土台に
  state.official = draftOfficial(m);    // 得点・スコア・PKだけ試合結果から入れ直す
  m.official = saved;                   // DB保存はユーザーが「保存」を押すまで反映しない
  render(); toast("試合結果を取り込みました");
}
/* 公式記録の選手名セルをタップ → 登録選手から選ぶ */
function openLineupCellPicker(side, idx){
  const m = curMatchAny(); if(!m) return;
  const R = resolveSlot(m, side);
  openMemberPicker(R.id, {
    title: (R.label==="—"?"チーム":R.label) + " の選手をえらぶ",
    allowClear:true, allowManual:true,
    onPick:(p, action)=>{
      const row = state.official[side].lineup[idx];
      if(action==="clear"){ row.no=""; row.name=""; row.pos=""; row.memberId=null; render(); }
      else if(action==="manual"){
        render();
        setTimeout(()=>{ const el=document.querySelector(`.fx[data-p="${side}.lineup.${idx}.name"]`);
          if(el){ el.removeAttribute("readonly"); el.classList.remove("pickable"); el.focus(); } },0);
      } else if(p){
        row.no=p.no??""; row.name=p.name||""; row.pos=p.pos||""; row.memberId=p.memberId||p.id; render();
      }
    }
  });
}
/* どの画面からでも使う「選手をえらぶ」リスト */
function openMemberPicker(teamId, opts){
  opts = opts || {};
  const players = ((teamById(teamId)?.players)||[]).slice().sort(byNo);
  const el = document.createElement("div");
  el.className = "modal";
  el.innerHTML = `<div class="sheet">
    <h3>${esc(opts.title||"選手をえらぶ")}</h3>
    ${players.length?"":`<p class="hint">この チームには登録選手がいません。台帳から入れるか、「手で入力」で書いてください。</p>`}
    <div class="picklist">${players.map(p=>
      `<button class="pickrow" data-id="${p.id}">
        <span class="pn">${p.no?esc(String(p.no)):"—"}</span>
        <span class="pnm">${esc(p.name)}${p.grade?` <small>${esc(String(p.grade))}年</small>`:""}</span>
        <span class="pp">${esc(p.pos||"")}</span></button>`).join("")}</div>
    <div class="btnrow">
      ${opts.allowClear?`<button class="btn ghost sm" id="mp-clear">空にする</button>`:""}
      ${opts.allowManual?`<button class="btn ghost sm" id="mp-man">手で入力</button>`:""}
      <button class="btn ghost sm" onclick="this.closest('.modal').remove()">とじる</button>
    </div>
  </div>`;
  document.body.appendChild(el);
  el.querySelectorAll(".pickrow").forEach(b=> b.onclick=()=>{
    const p = players.find(x=>x.id===b.dataset.id); el.remove(); opts.onPick && opts.onPick(p,"pick"); });
  const c=el.querySelector("#mp-clear"); if(c) c.onclick=()=>{ el.remove(); opts.onPick&&opts.onPick(null,"clear"); };
  const man=el.querySelector("#mp-man"); if(man) man.onclick=()=>{ el.remove(); opts.onPick&&opts.onPick(null,"manual"); };
}

/* --- 公式記録：選択式の入力（I4-I9） --- */
/* かんたんな選択モーダル。options=[{v,label}] */
function chooseModal(title, options, onPick, opts){
  opts = opts || {};
  const el=document.createElement("div"); el.className="modal";
  el.innerHTML=`<div class="sheet"><h3>${esc(title)}</h3>
    <div class="picklist">${options.map((o,i)=>
      `<button class="pickrow" data-i="${i}"><span class="pn">${esc(o.k??"")}</span><span class="pnm">${esc(o.label)}</span></button>`).join("")}</div>
    <div class="btnrow">
      ${opts.manual?`<button class="btn ghost sm" id="cm-man">手で入力</button>`:""}
      ${opts.clear?`<button class="btn ghost sm" id="cm-clr">空にする</button>`:""}
      <button class="btn ghost sm" onclick="this.closest('.modal').remove()">とじる</button></div></div>`;
  document.body.appendChild(el);
  el.querySelectorAll(".pickrow").forEach(b=> b.onclick=()=>{ const o=options[+b.dataset.i]; el.remove(); onPick(o,"pick"); });
  const man=el.querySelector("#cm-man"); if(man) man.onclick=()=>{ el.remove(); onPick(null,"manual"); };
  const clr=el.querySelector("#cm-clr"); if(clr) clr.onclick=()=>{ el.remove(); onPick(null,"clear"); };
}
function focusCell(path){
  setTimeout(()=>{ const el=document.querySelector(`.fx[data-p="${path}"]`);
    if(el){ el.removeAttribute("readonly"); el.classList.remove("pickable"); el.focus(); } },0);
}
const stripCap = s => String(s||"").replace(/\s*\(C\)\s*$/,"");
/* 得点チーム＝対戦2チームから選ぶ */
function openGoalTeamPicker(idx){
  const o=state.official;
  const opts=[{v:"H",label:o.H.name||"ホーム"},{v:"A",label:o.A.name||"アウェイ"}];
  chooseModal("得点したチーム", opts, (pick,act)=>{
    const g=o.goals[idx];
    if(act==="manual"){ focusCell(`goals.${idx}.team`); return; }
    if(act==="clear"){ g.team=""; g.no=""; g.scorer=""; render(); return; }
    g.team = pick.v==="H" ? (o.H.name||"") : (o.A.name||"");
    g._side = pick.v; g.no=""; g.scorer=""; render();
  }, {manual:true, clear:true});
}
/* 得点者の番号＝そのチームの出場者から選ぶ→得点者を自動表示 */
function goalSide(g){
  const o=state.official;
  if(g._side) return g._side;
  if(g.team && o.A.name && g.team===o.A.name) return "A";
  return "H";
}
function openGoalNoPicker(idx){
  const o=state.official; const g=o.goals[idx];
  const side=goalSide(g);
  const rows=(o[side].lineup||[]).filter(r=>r.name||r.no);
  const opts=rows.map(r=>({ k:r.no?String(r.no):"—", label:stripCap(r.name)||"（名前なし）", v:r }));
  chooseModal(`${side==="H"?o.H.name:o.A.name||""} の背番号`, opts, (pick,act)=>{
    if(act==="manual"){ focusCell(`goals.${idx}.no`); return; }
    if(act==="clear"){ g.no=""; g.scorer=""; render(); return; }
    g.no=pick.v.no??""; g.scorer=stripCap(pick.v.name); render();
  }, {manual:true, clear:true});
}
/* 警告・退場の番号＝そのチームの出場者から選ぶ→選手名を自動表示 */
function openCardNoPicker(side, idx){
  const o=state.official; const c=o[side].cards[idx];
  const rows=(o[side].lineup||[]).filter(r=>r.name||r.no);
  const opts=rows.map(r=>({ k:r.no?String(r.no):"—", label:stripCap(r.name)||"（名前なし）", v:r }));
  chooseModal(`${side==="H"?o.H.name:o.A.name||""} の背番号`, opts, (pick,act)=>{
    if(act==="manual"){ focusCell(`${side}.cards.${idx}.no`); return; }
    if(act==="clear"){ c.no=""; c.name=""; render(); return; }
    c.no=pick.v.no??""; c.name=stripCap(pick.v.name); render();
  }, {manual:true, clear:true});
}
/* 得点経過＝記号（〜 → ↑ × S H）から選ぶ or 手書き */
const SEQ_SYMBOLS=["〜","→","↑","×","S","H"];
function openSeqPicker(gi, ci){
  const g=state.official.goals[gi];
  const opts=SEQ_SYMBOLS.map(s=>({ k:s, label:{ "〜":"ドリブル","→":"ゴロパス","↑":"浮き球パス","×":"混戦","S":"シュート","H":"ヘディング" }[s]||s }));
  chooseModal("得点経過の記号", opts, (pick,act)=>{
    if(act==="manual"){ focusCell(`goals.${gi}.seq.${ci}`); return; }
    if(act==="clear"){ g.seq[ci]=""; render(); return; }
    g.seq[ci]=pick.k; render();
  }, {manual:true, clear:true});
}
function refreshTotals(){
  const els = document.querySelectorAll(".tot");
  if(els[0]) els[0].textContent = sideTotal("H");
  if(els[1]) els[1].textContent = sideTotal("A");
}
async function saveOfficial(silent){
  const m = state.matches.find(x=>x.id===state.matchId); if(!m) return;
  m.official = state.official;
  m.updated_at = new Date().toISOString();
  try{
    await DB.upsert("gn_matches", stripMatch(m));
    if(!silent) toast("公式記録を保存しました");
  }catch(e){ console.error(e); toast("保存できませんでした: "+(e.message||e)); }
}

/* ---------- 大会の設定 ---------- */
function viewSettings(){
  const t = state.t, cfg = cfgOf(t);
  return `<div class="tourwrap">`
  + topbar({ title:"大会の設定", sub:t.name, back:"go('t')" })
  + `<div class="twrap">${tournamentSidebar("settings")}<div class="tmain">
    <div class="screen">
    <div class="card">
      <label class="f">大会名</label>
      <input class="in" value="${esc(t.name)}" onchange="t_set('name',this.value)">
      <label class="f">主催</label>
      <input class="in" value="${esc(cfg.host||"")}" onchange="cfg_set('host',this.value)">
      <label class="f">開催期間</label>
      <div class="row2">
        <input class="in" type="date" value="${esc(cfg.dateStart||cfg.date||"")}" onchange="cfg_set('dateStart',this.value);cfg_set('date',this.value)">
        <input class="in" type="date" value="${esc(cfg.dateEnd||"")}" onchange="cfg_set('dateEnd',this.value)">
      </div>
    </div>
    ${blocksOf(t).length ? `<div class="card">
      <label class="f">リーグ（部・組）ごとの設定</label>
      <p class="hint" style="margin:0 0 10px">各リーグに <b style="color:var(--ok)">▲自動昇格</b> ／ <b style="color:#1c8f6a">△昇格入れ替え戦</b> ／ <b style="color:#b8760a">▽降格入れ替え戦</b> ／ <b style="color:var(--bad)">▼自動降格</b> の数を決められます（0でなし）。1部は降格だけ、2部は昇格だけ、のように別々にできます。自動と入れ替え戦の混在もOK。</p>
      ${blocksOf(t).map((b)=>`<div style="border:1.5px solid var(--line);border-radius:12px;padding:10px 11px;margin-bottom:10px">
        <input class="in" style="margin-bottom:8px;font-weight:700" value="${esc(b.name)}" onchange="renameBlockInTournament('${b.id}',this.value)">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div><div class="hint" style="margin:0 0 3px;color:var(--ok)">▲ 自動昇格</div><input class="in" type="number" inputmode="numeric" min="0" value="${b.up||0}" onchange="setBlockPromo('${b.id}','up',this.value)"></div>
          <div><div class="hint" style="margin:0 0 3px;color:#1c8f6a">△ 昇格入替戦</div><input class="in" type="number" inputmode="numeric" min="0" value="${b.upPo||0}" onchange="setBlockPromo('${b.id}','upPo',this.value)"></div>
          <div><div class="hint" style="margin:0 0 3px;color:#b8760a">▽ 降格入替戦</div><input class="in" type="number" inputmode="numeric" min="0" value="${b.downPo||0}" onchange="setBlockPromo('${b.id}','downPo',this.value)"></div>
          <div><div class="hint" style="margin:0 0 3px;color:var(--bad)">▼ 自動降格</div><input class="in" type="number" inputmode="numeric" min="0" value="${b.down||0}" onchange="setBlockPromo('${b.id}','down',this.value)"></div>
        </div>
      </div>`).join("")}
      <p class="hint">リーグ名も直せます。順位表に色帯で反映されます。リーグ数を増減するときは大会を作り直してください。</p>
    </div>` : ""}
    ${t.format==="league_ko" ? `<div class="card">
      <label class="f">決勝トーナメントへの勝ち上がり</label>
      <p class="hint" style="margin:0 0 10px">ブロックごとに勝ち上がる数を変えたり、「各組3位のうち成績上位2チーム」のようなワイルドカードを足せます。<b>ここを変えても組んである櫓は変わりません</b>。枠の中身は「トーナメント表」の ✎ で選び直してください。</p>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <span class="hint" style="margin:0">共通で</span>
        <input class="in" type="number" inputmode="numeric" min="0" style="max-width:88px" value="${num(cfg.advance)}" onchange="cfg_set('advance',Math.max(0,+this.value||0));render()">
        <span class="hint" style="margin:0">位まで</span>
      </div>
      ${blocksOf(t).map(b=>`<div class="lurow" style="box-shadow:none">
        <span class="lunm">${esc(b.name)}</span>
        <input class="in" type="number" inputmode="numeric" min="0" style="max-width:110px"
               placeholder="${num(cfg.advance)}" value="${(cfg.advanceBy||{})[b.id]??""}"
               onchange="setBlockAdvance('${b.id}',this.value)">
      </div>`).join("")}
      <label class="f">ワイルドカード（各組◯位から成績のよいチームを拾う）</label>
      ${wildcardsOf(t).length ? (cfg.wildcards||[]).map((w,i)=>`<div class="row2" style="margin-bottom:6px;align-items:center">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span class="hint" style="margin:0">各組</span>
          <input class="in" type="number" inputmode="numeric" min="1" style="max-width:74px" value="${num(w.rank)}" onchange="setTWildcard(${i},'rank',this.value)">
          <span class="hint" style="margin:0">位のうち　上位</span>
          <input class="in" type="number" inputmode="numeric" min="1" style="max-width:74px" value="${num(w.count)}" onchange="setTWildcard(${i},'count',this.value)">
          <span class="hint" style="margin:0">チーム</span>
        </div>
        <button class="btn ghost sm" style="flex:0 0 auto;width:auto" onclick="removeTWildcard(${i})">削除</button>
      </div>`).join("") : `<p class="hint" style="margin:0 0 8px">まだありません。</p>`}
      <button class="btn sec sm" onclick="addTWildcard()">＋ ワイルドカードを追加</button>
      ${wildcardsOf(t).length && blocksOf(t).length>1 ? `
      <label class="f">ブロックのチーム数が違うときの比べ方</label>
      <div class="seg">
        <button class="${cfg.wcRule!=="avg"?"on":""}" onclick="cfg_set('wcRule','total');render()">合計で比べる</button>
        <button class="${cfg.wcRule==="avg"?"on":""}" onclick="cfg_set('wcRule','avg');render()">1試合平均で比べる</button>
      </div>` : ""}
      <p class="hint" style="margin-top:10px">いまの設定：${esc(advanceSummary()||"（勝ち上がりなし）")}</p>
    </div>` : ""}
    <div class="card">
      <label class="f">記入リンクでチームに伝えること（任意）</label>
      <textarea class="in" style="min-height:64px" placeholder="例）背番号は1〜25。学年も入れてください。締切は8/10。" onchange="cfg_set('entryNote',this.value)">${esc(cfg.entryNote||"")}</textarea>
      <p class="hint">「記入リンクを配る」で各チームが名簿を入力するとき、この文が上に表示されます。</p>
    </div>
    <div class="card">
      <label class="f">勝ち点</label>
      <div class="row2">
        <div><div class="hint" style="margin:0 0 4px">勝ち</div><input class="in" type="number" value="${cfg.win}" onchange="cfg_set('win',+this.value)"></div>
        <div><div class="hint" style="margin:0 0 4px">引分</div><input class="in" type="number" value="${cfg.draw}" onchange="cfg_set('draw',+this.value)"></div>
        <div><div class="hint" style="margin:0 0 4px">負け</div><input class="in" type="number" value="${cfg.lose}" onchange="cfg_set('lose',+this.value)"></div>
      </div>
    </div>
    <div class="card">
      <label class="f">登録人数の上限（任意）</label>
      <input class="in" type="number" min="0" placeholder="空欄なら無制限" value="${cfg.registerLimit||""}"
        onchange="cfg_set('registerLimit',this.value===''?null:Math.max(0,+this.value))">
      <p class="hint">台帳から選手を入れるとき、この人数までしか選べなくなります（例：登録30名までのレギュレーション）。台帳の在籍選手が多いチームでも、大会ごとに必要な人数だけ選べます。</p>
    </div>
    <div class="card">
      <label class="f">選手登録の締切（任意）</label>
      <input class="in" type="date" value="${esc(cfg.rosterDeadline||"")}"
        onchange="cfg_set('rosterDeadline',this.value||null)">
      <p class="hint">この日を過ぎると、「チーム・選手」画面でチーム・選手の登録内容を編集できなくなります（誤操作防止用。運営はロック後もその場で「編集する」を押せば直せます）。空欄なら締切なし。</p>
    </div>
    ${FORMATS[t.format]?.hasLeague ? `
    <div class="card">
      <label class="f">対戦方式</label>
      <div class="seg">
        <button class="${!cfg.doubleRound?"on":""}" onclick="cfg_set('doubleRound',false);render()">1回総当たり</button>
        <button class="${cfg.doubleRound?"on":""}" onclick="cfg_set('doubleRound',true);render()">ホーム&アウェイ（2回総当たり）</button>
      </div>
      <p class="hint">変更後は「チーム」画面の「🔄 リーグの対戦カードを作り直す」を押してください（入力済みの結果は消えます）。</p>
    </div>` : ""}
    <div class="card">
      <label class="f" style="margin-top:0">大会概要（「大会概要」タブに表示されます）</label>
      <label class="f">試合時間（前後半）</label>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span class="hint" style="margin:0">前後半　各</span>
        <input class="in" type="number" inputmode="numeric" style="max-width:88px" value="${cfg.overview?.halfMin??""}" onchange="ov_set('halfMin',this.value===''?null:Math.max(0,+this.value));render()">
        <span class="hint" style="margin:0">分（計 <b>${(cfg.overview?.halfMin||0)*2}</b> 分）</span>
      </div>
      <label class="f">延長</label>
      <div class="seg">
        <button class="${!cfg.overview?.hasET?"on":""}" onclick="ov_set('hasET',false);render()">なし</button>
        <button class="${cfg.overview?.hasET?"on":""}" onclick="ov_set('hasET',true);render()">あり</button>
      </div>
      ${cfg.overview?.hasET?`
        ${FORMATS[t.format].hasKO?`<label class="f" style="margin-top:8px">延長はどの試合から</label>
        <div class="seg">${Object.entries(ET_FROM_LABEL).map(([k,l])=>
          `<button class="${(cfg.overview?.etFrom||"all")===k?"on":""}" onclick="ov_set('etFrom','${k}');render()">${esc(l)}</button>`).join("")}</div>`:""}
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px">
          <span class="hint" style="margin:0">延長　前後半　各</span>
          <input class="in" type="number" inputmode="numeric" style="max-width:88px" value="${cfg.overview?.etHalfMin??""}" onchange="ov_set('etHalfMin',this.value===''?null:Math.max(0,+this.value));render()">
          <span class="hint" style="margin:0">分（計 <b>${(cfg.overview?.etHalfMin||0)*2}</b> 分）</span>
        </div>`:""}
      <label class="f">PK戦</label>
      <div class="seg">
        <button class="${!cfg.overview?.hasPK?"on":""}" onclick="ov_set('hasPK',false);render()">なし</button>
        <button class="${cfg.overview?.hasPK?"on":""}" onclick="ov_set('hasPK',true);render()">あり</button>
      </div>
      <label class="f">順位決定方法</label>
      <textarea class="in" style="min-height:96px" onchange="ov_set('rankRule',this.value)" placeholder="(1)勝点 (2)得失点差 …">${esc(cfg.overview?.rankRule||"")}</textarea>
      <label class="f">警告の累積</label>
      <input class="in" value="${esc(cfg.overview?.cardRule||"")}" onchange="ov_set('cardRule',this.value)" placeholder="例）警告の累積が4回で出場停止処分とする。">
      <label class="f">当大会に関するお問い合わせ先</label>
      <textarea class="in" style="min-height:80px" onchange="ov_set('contact',this.value)" placeholder="実行本部／メール／電話 など">${esc(cfg.overview?.contact||"")}</textarea>
    </div>
    <button class="btn" onclick="saveSettings()">保存する</button>
    <div class="btnrow"><button class="btn sec" onclick="go('teams')">チーム・選手を編集</button></div>
    <div class="btnrow"><button class="btn danger" onclick="deleteTournament()">この大会を削除する</button></div>
    </div>
  </div></div></div>`;
}
function t_set(k,v){ state.t[k] = v; }
function cfg_set(k,v){ state.t.settings = Object.assign(cfgOf(state.t), {[k]:v}); }
function ov_set(k,v){ const s = state.t.settings = cfgOf(state.t); s.overview = Object.assign({}, s.overview||{}, {[k]:v}); }
async function setBracketDir(vert){
  const s = state.t.settings = cfgOf(state.t);
  s.overview = Object.assign({}, s.overview||{}, {bracketVert:!!vert});
  try{
    const { id,org_id,name,sport,format,settings,created_at } = state.t;
    await DB.upsert("gn_tournaments", { id,org_id,name,sport,format,settings,created_at });
  }catch(e){ toast("保存できませんでした: "+(e.message||e)); }
  render();
}
/* ===== 登録チームで自動作成（いちばん簡単・ボタン1つ） ===== */
async function autoDrawKO(){
  const cfg = cfgOf(state.t);
  const ids = state.teams.slice().sort((a,b)=>a.sort_order-b.sort_order).map(t=>t.id);
  if(ids.length < 2) return toast("チームが2つ以上必要です");
  const bid = curBracketId();
  const doneKO = koMatchesOf(bid, true).some(isDone);
  if(doneKO && !confirm("トーナメント表を作り直します。入力済みの結果は消えます。よろしいですか？")) return;
  const pow2 = n => Math.pow(2, Math.max(1, Math.ceil(Math.log2(Math.max(2, n)))));
  const size = pow2(ids.length);
  const oldKO = koMatchesOf(bid, true);
  const newKO = buildKOMatches(state.t.id, size, distributePairs(ids, size), !!cfg.thirdPlace, bid);
  newKO.forEach(m=> m.org_id = state.user.id);
  try{
    if(oldKO.length) await DB.remove("gn_matches", oldKO.map(m=>m.id));
    await DB.upsert("gn_matches", newKO.map(stripMatch));
    if(size !== cfg.koSize){
      cfg_set("koSize", size);
      const { id,org_id,name,sport,format,settings,created_at } = state.t;
      await DB.upsert("gn_tournaments", { id,org_id,name,sport,format,settings,created_at });
    }
  }catch(e){ console.error(e); return toast("作成できませんでした: "+(e.message||e)); }
  state.matches = state.matches.filter(m=>!oldKO.some(x=>x.id===m.id)).concat(newKO);
  toast(`トーナメント表を作成しました（${ids.length}チーム）`); render();
}
/* ===== 櫓メーカー：①1回戦を組む窓 ／ ②2回戦以降を組む窓 ===== */
let bmActive = null;   // いま開いている編集窓の再描画関数
function bmMatchNo(m){  // 同じ回戦の中で上から何番目のマッチか（1始まり）
  const same = koMatchesOf(bracketIdOf(m)).filter(x=>x.round===m.round).sort((a,b)=>a.slot-b.slot);
  return same.findIndex(x=>x.id===m.id) + 1;
}
function bmMaxRound(){
  const ko = koMatchesOf();
  return ko.length ? Math.max(...ko.map(m=>m.round)) : 0;
}
function bmNextSlot(round){
  const ms = koMatchesOf().filter(m=>m.round===round);
  return ms.length ? Math.max(...ms.map(m=>m.slot))+1 : 0;
}
function bmUsedTeams(cur){   // 同じトーナメント内の他の枠に入っているチーム（curは除く）
  const used = new Set();
  koMatchesOf(null, true).forEach(m=>{ if(m.home_team) used.add(m.home_team); if(m.away_team) used.add(m.away_team); });
  if(cur) used.delete(cur);
  return used;
}
/* 予選リーグからの勝ち上がり枠（G:組順位／B:ワイルドカード）を選択肢に足す */
function qualifierOpts(){
  const out = [];
  if(state.t.format!=="league_ko") return out;
  const maxRank = Math.max(maxRankOf(), 2);
  blocksOf(state.t).forEach(b=>{
    const adv = advanceOf(b.id);
    for(let r=1; r<=maxRank; r++){
      out.push({ v:`G:${b.id}#${r}`, l:`${b.name}${r}位${adv && r>adv ? "（進出枠外）" : ""}` });
    }
  });
  wildcardsOf(state.t).forEach(w=>{
    const rank = num(w.rank);
    for(let n=1; n<=num(w.count); n++) out.push({ v:`B:${rank}#${n}`, l:`各組${rank}位のうち成績${n}番目` });
  });
  return out;
}
/* --- ① 1回戦を組む --- */
function r1Opts(cur){
  const cfg = cfgOf(state.t);
  const opts = [{v:"", l:"（なし・不戦勝）"}];
  if(state.t.format==="league_ko"){
    opts.push(...qualifierOpts());
  }
  const used = bmUsedTeams(cur);
  state.teams.slice().sort((a,b)=>a.sort_order-b.sort_order).forEach(t=>{ if(!used.has(t.id)) opts.push({v:t.id, l:t.name}); });
  return opts;
}
function r1Sel(m, side){
  const cur = m[side+"_team"] || m[side+"_src"] || "";
  return `<select class="in bmslot" onchange="bmSetSlot('${m.id}','${side}',this.value)">${
    r1Opts(m[side+"_team"]||"").map(o=>`<option value="${esc(o.v)}" ${o.v===cur?"selected":""}>${esc(o.l)}</option>`).join("")
  }</select>`;
}
function r1Render(){
  const body = document.getElementById("r1Body"); if(!body) return;
  const ms = koMatchesOf().filter(m=>m.round===1).sort((a,b)=>a.slot-b.slot);
  body.innerHTML = (ms.length ? ms.map((m,i)=>`<div class="bmmatch">
      <div class="bmmhead"><span class="bmno">マッチ${i+1}</span>
        <button class="btn danger sm" onclick="bmDelMatch('${m.id}')">削除</button></div>
      ${r1Sel(m,"home")}<div class="bmvs2">vs</div>${r1Sel(m,"away")}
    </div>`).join("") : `<div class="hint" style="padding:6px 2px">まだ1回戦のマッチがありません。「＋ マッチを追加」で作ってください。</div>`)
    + `<button class="btn sec sm" onclick="bmAddMatch(1)" style="margin-top:8px">＋ マッチを追加</button>`;
}
function openR1Maker(){
  bmActive = r1Render;
  const el = document.createElement("div");
  el.className = "modal"; el.id = "r1Modal";
  el.innerHTML = `<div class="sheet" style="max-width:640px">
    <h3>① 1回戦を組む</h3>
    <p class="hint" style="margin-bottom:8px">上から順に <b>マッチ1・マッチ2 …</b> です。各マッチに戦う2チームを選びます（片方だけなら不戦勝）。<br><b>シード</b>（1回戦を戦わないチーム）はここには入れず、「② 2回戦以降を組む」で入れます。</p>
    <div id="r1Body"></div>
    <div class="btnrow"><button class="btn" onclick="this.closest('.modal').remove();bmActive=null;render()">閉じる</button></div>
  </div>`;
  document.body.appendChild(el); r1Render();
}
/* --- ② 2回戦以降を組む --- */
function laterOpts(selfId, cur){
  const cfg = cfgOf(state.t);
  const opts = [{v:"", l:"（なし・不戦勝）"}];
  if(state.t.format==="league_ko"){
    opts.push(...qualifierOpts());
  }
  const used = bmUsedTeams(cur);
  state.teams.slice().sort((a,b)=>a.sort_order-b.sort_order).forEach(t=>{ if(!used.has(t.id)) opts.push({v:t.id, l:`${t.name}（シード）`}); });
  koMatchesOf().filter(m=>m.id!==selfId)
    .sort((a,b)=> a.round-b.round || a.slot-b.slot)
    .forEach(m=> opts.push({v:`W:${m.id}`, l:`${m.round}回戦マッチ${bmMatchNo(m)}の勝者`}));
  return opts;
}
function laterSel(m, side){
  const cur = m[side+"_team"] || m[side+"_src"] || "";
  return `<select class="in bmslot" onchange="bmSetSlot('${m.id}','${side}',this.value)">${
    laterOpts(m.id, m[side+"_team"]||"").map(o=>`<option value="${esc(o.v)}" ${o.v===cur?"selected":""}>${esc(o.l)}</option>`).join("")
  }</select>`;
}
function laterRender(){
  const body = document.getElementById("ltBody"); if(!body) return;
  const maxR = Math.max(bmMaxRound(), 2);
  let h = "";
  for(let r=2; r<=maxR; r++){
    const ms = koMatchesOf().filter(m=>m.round===r).sort((a,b)=>a.slot-b.slot);
    h += `<div class="card" style="margin-bottom:8px">
      <div class="hint" style="margin:0 0 6px">${r}回戦（${ms.length}マッチ）</div>
      ${ms.map((m,i)=>`<div class="bmmatch">
        <div class="bmmhead"><span class="bmno">マッチ${i+1}</span>
          <button class="btn danger sm" onclick="bmDelMatch('${m.id}')">削除</button></div>
        ${laterSel(m,"home")}<div class="bmvs2">vs</div>${laterSel(m,"away")}
      </div>`).join("") || `<div class="hint" style="padding:4px 2px">マッチなし</div>`}
      <button class="btn sec sm" onclick="bmAddMatch(${r})">＋ この回戦にマッチを追加</button></div>`;
  }
  h += `<button class="btn sec sm" onclick="bmAddMatch(${Math.max(bmMaxRound(),1)+1})">＋ 回戦を追加</button>`;
  body.innerHTML = h;
}
function openLaterMaker(){
  bmActive = laterRender;
  const el = document.createElement("div");
  el.className = "modal"; el.id = "ltModal";
  el.innerHTML = `<div class="sheet" style="max-width:640px">
    <h3>② 2回戦以降を組む</h3>
    <p class="hint" style="margin-bottom:8px">各マッチの枠に、<b>シード</b>（1回戦を戦わず直接出るチーム）か <b>◯回戦マッチ△の勝者</b> を選べます。<br>例）第1シード 対 <b>1回戦マッチ1の勝者</b></p>
    <div id="ltBody"></div>
    <div class="btnrow"><button class="btn" onclick="this.closest('.modal').remove();bmActive=null;render()">閉じる</button></div>
  </div>`;
  document.body.appendChild(el); laterRender();
}
async function bmAddMatch(round){
  const slot = bmNextSlot(round);
  const m = newMatch(state.t.id, { stage:"ko", grp:curBracketId(), round, slot, sort_order:round*100+slot });
  state.matches.push(m);
  try{ await DB.upsert("gn_matches", [stripMatch(m)]); }catch(e){ toast("追加できませんでした: "+(e.message||e)); }
  if(bmActive) bmActive(); else render();
}
async function bmDelMatch(id){
  if(!confirm("このマッチを削除します。よろしいですか？")) return;
  state.matches = state.matches.filter(m=>m.id!==id);
  try{ await DB.remove("gn_matches", id); }catch(e){ toast("削除できませんでした: "+(e.message||e)); }
  if(bmActive) bmActive(); else render();
}
async function bmSetSlot(mid, side, v){
  const m = state.matches.find(x=>x.id===mid); if(!m) return;
  assignSide(m, side, v||null);
  try{ await DB.upsert("gn_matches", [stripMatch(m)]); }catch(e){ toast("保存できませんでした: "+(e.message||e)); }
  if(bmActive) bmActive();
}
/* ===== 櫓メーカー：枠を直接タップして中身を決める（team/予選順位/勝者/敗者/自由文字/なし） ===== */
function koSlotOptions(selfId, cur){
  const cfg = cfgOf(state.t);
  const opts = [{v:"", l:"（なし・不戦勝／シード）"}];
  const used = bmUsedTeams(cur);
  state.teams.slice().sort((a,b)=>a.sort_order-b.sort_order).forEach(t=>{ if(!used.has(t.id)||t.id===cur) opts.push({v:t.id, l:t.name}); });
  if(state.t.format==="league_ko"){
    opts.push(...qualifierOpts());
  }
  koMatchesOf().filter(m=>m.id!==selfId)
    .sort((a,b)=> a.round-b.round || a.slot-b.slot)
    .forEach(m=>{
      opts.push({v:`W:${m.id}`, l:`${koRoundLabel(m)}マッチ${koMatchNo(m)}の勝者`});
      opts.push({v:`L:${m.id}`, l:`${koRoundLabel(m)}マッチ${koMatchNo(m)}の敗者`});
    });
  return opts;
}
function openKoEditor(id){
  const m = state.matches.find(x=>x.id===id); if(!m) return;
  const sideBlock = (side, label)=>{
    const cur  = m[side+"_team"] || (m[side+"_src"]&&m[side+"_src"].slice(0,2)!=="T:" ? m[side+"_src"] : "") || "";
    const curT = (m[side+"_src"]&&m[side+"_src"].slice(0,2)==="T:") ? m[side+"_src"].slice(2) : "";
    return `<label class="fld">${label}</label>
      <select class="in" id="ke-${side}">${koSlotOptions(m.id, m[side+"_team"]||"").map(o=>
        `<option value="${esc(o.v)}" ${o.v===cur&&!curT?"selected":""}>${esc(o.l)}</option>`).join("")}</select>
      <input class="in" id="keT-${side}" style="margin-top:5px" placeholder="または自由な文字（例：抽選・未定）" value="${esc(curT)}">`;
  };
  const el = document.createElement("div"); el.className="modal"; el.id="keModal";
  el.innerHTML = `<div class="sheet">
    <h3>枠の中身を決める</h3>
    <p class="hint" style="margin:0 0 6px">${esc(koRoundLabel(m))}・マッチ${koMatchNo(m)}<br>各枠にチーム／予選順位／◯回戦マッチ△の勝者・敗者／自由文字を入れられます。相手を「なし」にするとシード（2回戦から）になります。</p>
    <div class="grid2" style="margin-top:2px">
      <div><label class="fld">回戦（列）</label><input class="in" id="ke-round" type="number" min="1" value="${m.round}"></div>
      <div><label class="fld">並び順</label><input class="in" id="ke-slot" type="number" min="0" value="${m.slot}"></div>
    </div>
    ${sideBlock("home","上の枠")}
    ${sideBlock("away","下の枠")}
    <div class="btnrow">
      <button class="btn ghost" onclick="this.closest('.modal').remove()">閉じる</button>
      <button class="btn danger" style="flex:.6" onclick="koEditorDelete('${m.id}')">削除</button>
      <button class="btn" onclick="koEditorSave('${m.id}')">保存</button>
    </div>
  </div>`;
  document.body.appendChild(el);
}
async function koEditorSave(id){
  const m = state.matches.find(x=>x.id===id); if(!m){ document.getElementById("keModal")?.remove(); return; }
  const nr = Math.max(1, num($("#ke-round").value)||m.round);
  const ns = Math.max(0, num($("#ke-slot").value));
  m.round = nr; m.slot = ns; m.sort_order = nr*100+ns;
  ["home","away"].forEach(side=>{
    const t = ($("#keT-"+side).value||"").trim();
    if(t) assignSide(m, side, "T:"+t);
    else  assignSide(m, side, $("#ke-"+side).value||null);
  });
  try{ await DB.upsert("gn_matches",[stripMatch(m)]); toast("保存しました"); }
  catch(e){ toast("保存できませんでした: "+(e.message||e)); }
  document.getElementById("keModal")?.remove(); render();
}
async function koEditorDelete(id){
  if(!confirm("このマッチを削除します。参照していた枠は空になります。よろしいですか？")) return;
  const affected=[];
  state.matches.forEach(x=>["home","away"].forEach(sd=>{ const s=x[sd+"_src"];
    if(s===`W:${id}`||s===`L:${id}`){ x[sd+"_src"]=null; if(!affected.includes(x)) affected.push(x); } }));
  state.matches = state.matches.filter(x=>x.id!==id);
  try{
    await DB.remove("gn_matches", id);
    if(affected.length) await DB.upsert("gn_matches", affected.map(stripMatch));
  }catch(e){ toast("削除できませんでした: "+(e.message||e)); }
  document.getElementById("keModal")?.remove(); render();
}
/* 順位決定戦（3位決定戦など・敗者参照のコンソレーション）を1つ足す */
async function koAddConsolation(){
  const rounds = koMaxRound();
  const m = newMatch(state.t.id, { stage:"ko", grp:curBracketId(), round:rounds, slot:99, sort_order:rounds*100+99 });
  // 準決勝が2つあれば自動で敗者同士を入れておく
  const sf = koMatchesOf().filter(x=>x.round===rounds-1).sort((a,b)=>a.slot-b.slot);
  if(sf.length>=2){ m.home_src="L:"+sf[0].id; m.away_src="L:"+sf[1].id; }
  state.matches.push(m);
  try{ await DB.upsert("gn_matches",[stripMatch(m)]); }catch(e){ toast("追加できませんでした: "+(e.message||e)); }
  render(); openKoEditor(m.id);
}
/* 回戦（列）を末尾に1つ足す＝そこにマッチを1つ作る */
async function koAddRound(){ await bmAddMatch(Math.max(bmMaxRound(),1)+1); }

function renameBlockInTournament(id, name){
  const blocks = blocksOf(state.t).map(b=> b.id===id ? {...b, name} : b);
  cfg_set("blocks", blocks);
}
/* 決勝トーナメントへの勝ち上がり（あとから変更） */
function setBlockAdvance(id, val){
  const by = Object.assign({}, cfgOf(state.t).advanceBy||{});
  if(val==="" || val==null) delete by[id]; else by[id] = Math.max(0, +val||0);
  cfg_set("advanceBy", by); render();
}
function addTWildcard(){
  cfg_set("wildcards", (cfgOf(state.t).wildcards||[]).concat([{rank:3, count:1}])); render();
}
function setTWildcard(i, key, val){
  const ws = (cfgOf(state.t).wildcards||[]).map((w,j)=> j===i ? {...w, [key]:Math.max(1,+val||1)} : w);
  cfg_set("wildcards", ws); render();
}
function removeTWildcard(i){
  cfg_set("wildcards", (cfgOf(state.t).wildcards||[]).filter((_,j)=>j!==i)); render();
}
/* リーグごとの昇格・降格・入れ替え戦の数を設定 */
function setBlockPromo(id, key, val){
  const v = Math.max(0, +val||0);
  const blocks = blocksOf(state.t).map(b=> b.id===id ? {...b, [key]:v} : b);
  cfg_set("blocks", blocks);
}
async function saveSettings(){
  try{
    const { id,org_id,name,sport,format,settings,created_at } = state.t;
    await DB.upsert("gn_tournaments", { id,org_id,name,sport,format,settings,created_at });
    await reloadList(); toast("保存しました"); go("t");
  }catch(e){ toast("保存できませんでした: "+(e.message||e)); }
}
async function deleteTournament(){
  if(!confirm(`「${state.t.name}」を削除します。\n試合の記録もすべて消えます。よろしいですか？`)) return;
  try{
    await DB.remove("gn_matches", state.matches.map(m=>m.id));
    await DB.remove("gn_teams",   state.teams.map(t=>t.id));
    await DB.remove("gn_tournaments", state.t.id);
    state.t = null; await reloadList(); go("home"); toast("削除しました");
  }catch(e){ toast("削除できませんでした: "+(e.message||e)); }
}

/* ==========================================================================
   画面遷移・読み込み
   ========================================================================== */
function go(v){
  state.view = v;
  if(v==="home"){ location.hash = ""; loadHomeStats(); }
  if(v==="t" && state.t) location.hash = "t=" + state.t.id;
  render();
}
async function openTournament(id){
  state.loading = true; render();
  try{
    const d = await DB.loadTournament(id);
    if(!d.t){ toast("大会が見つかりません"); return go("home"); }
    state.t = d.t; state.teams = d.teams; state.matches = d.matches;
    state.tab = "schedule"; state.view = "t"; state.bracket = null;   // 表示中の櫓は先頭に戻す
    state.unlockTeams = false;   // 選手登録の締切ロック解除は大会を開き直したらリセット
    initScheduleCollapse();   // 全部たたむ＋今日にいちばん近い節だけ開く＋そのブロックを選ぶ
    location.hash = "t=" + id;
  }catch(e){ console.error(e); toast("読み込めませんでした"); }
  state.loading = false; render();
}
function openMatch(id){
  state.matchId = id;
  const m = state.matches.find(x=>x.id===id);
  state.unlockMatch = (m && !isDone(m)) ? id : null;   // 開いた時点で未終了なら編集可・終了済みはロック
  state.view = "match"; render();
}
function unlockMatch(id){ state.unlockMatch = id; render(); }   // 終了した試合の編集ロックを解除
function openClub(id){ state.clubId = id; state.showGrads = false; state.view = "club"; render(); }

/* 台帳（チーム・選手・年度）を読み込む */
async function reloadRoster(){
  if(!state.user){ state.org = null; state.clubs = []; state.members = []; return; }
  try{
    const d = await DB.loadRoster(state.user.id);
    state.org = d.org || { id:state.user.id, name:state.user.code, year:fiscalYear() };
    state.clubs = d.clubs; state.members = d.members;
  }catch(e){
    console.error(e);
    state.org = { id:state.user.id, name:state.user.code, year:fiscalYear() };
    state.clubs = []; state.members = [];
  }
}
async function refresh(){
  if(!state.t) return;
  try{
    const d = await DB.loadTournament(state.t.id);
    if(d.t){ state.t = d.t; state.teams = d.teams; state.matches = d.matches; }
    render(); toast("最新にしました");
  }catch(e){ toast("更新できませんでした"); }
}
async function reloadList(){
  try{ state.list = await DB.listTournaments(); }
  catch(e){ console.error(e); state.list = []; }
}
/* ホーム画面の集計（自分が運営する大会だけ・チーム数/試合の進み具合/今日の試合など）。1クエリでまとめて取る */
let _homeStatsBusy = false;
async function loadHomeStats(){
  if(_homeStatsBusy || !state.list.length) return;
  _homeStatsBusy = true;
  try{
    // 自分の団体ぶんだけでなく一覧に出る全大会を対象にする（未ログインのゲスト表示でも開催中/終了を判定できるように）
    const ids = state.list.map(t=>t.id);
    let matches=[], teams=[];
    if(ids.length){
      if(sb){
        const [rm, rt] = await Promise.all([
          sb.from("gn_matches_public").select("id,tournament_id,status,kickoff").in("tournament_id", ids),
          sb.from("gn_teams").select("id,tournament_id").in("tournament_id", ids),
        ]);
        if(rm.error) throw rm.error;
        if(rt.error) throw rt.error;
        matches = rm.data||[]; teams = rt.data||[];
      } else {
        const d = local.read();
        matches = d.matches.filter(m=>ids.includes(m.tournament_id));
        teams   = d.teams.filter(x=>ids.includes(x.tournament_id));
      }
    }
    const today = localDate(new Date().toISOString());
    const byT = {};
    ids.forEach(id=> byT[id] = { teams:0, total:0, done:0, live:0 });
    teams.forEach(x=>{ if(byT[x.tournament_id]) byT[x.tournament_id].teams++; });
    // 上部の統計カード（進行中/本日/終了の試合数）は自分の団体ぶんだけに絞る（ゲストには表示されないので0のままでよい）
    const mineIds = new Set(state.user ? state.list.filter(t=>t.org_id===state.user.id).map(t=>t.id) : []);
    let liveAll=0, todayAll=0, doneAll=0;
    matches.forEach(m=>{
      const b = byT[m.tournament_id]; if(!b) return;
      b.total++;
      const mine = mineIds.has(m.tournament_id);
      if(m.status==="done"){ b.done++; if(mine) doneAll++; }
      if(m.status==="live"){ b.live++; if(mine) liveAll++; }
      if(mine && m.kickoff && localDate(m.kickoff)===today) todayAll++;
    });
    state.homeStats = { byT, liveAll, todayAll, doneAll };
  }catch(e){ console.error(e); }
  _homeStatsBusy = false; render();
}
function shareTournament(){
  const url = location.origin + location.pathname + "#t=" + state.t.id;
  if(navigator.share){ navigator.share({ title:state.t.name, url }).catch(()=>{}); return; }
  navigator.clipboard?.writeText(url).then(
    ()=>toast("見るためのURLをコピーしました"),
    ()=>prompt("このURLを配ってください", url));
}
function copyText(txt, msg){
  navigator.clipboard?.writeText(txt).then(()=>toast(msg||"コピーしました"), ()=>prompt("コピーしてください", txt));
}

/* ==========================================================================
   記入リンク（要望J）：本部が配る／チームが自分の名簿を提出（ログイン不要）
   ========================================================================== */
async function openEntry(teamId){
  state.loading = true; state.view="entry"; render();
  try{
    const { team, t } = await DB.loadEntryTarget(teamId);
    if(!team || !t) state.entry = { error:"このリンクは無効か、大会が見つかりません。本部にご確認ください。" };
    else state.entry = { team, t, players:(team.players||[]).map(p=>({...p})), code:"", done:false };
  }catch(e){ state.entry = { error:"読み込めませんでした。少し時間をおいて開き直してください。" }; }
  state.loading = false; render();
}
function entrySetPlayer(i, key, val){ state.entry.players[i][key]=val; }
function entryAddPlayer(){ state.entry.players.push({ id:uid(), no:null, name:"", pos:"", grade:null }); render(); }
function entryRemovePlayer(i){ state.entry.players.splice(i,1); render(); }
function openEntryBulk(){
  const el = document.createElement("div"); el.className = "modal";
  el.innerHTML = `<div class="sheet">
    <h3>選手をまとめて貼り付け</h3>
    <p class="hint" style="margin-bottom:8px">1行に1人。<b>Excelやメモからそのまま貼り付け</b>できます（番号／氏名／かな／学年／位置）。<br>
    手で打つときは「<b>10 山田太郎 6 FW</b>」のようにスペースで区切ってください。</p>
    <textarea class="in" id="ebulk-tx" style="min-height:180px" placeholder="10 山田太郎 6 FW
1 佐藤花子 5 GK
7 鈴木一郎 4"></textarea>
    <label class="f">入れ方</label>
    <div class="seg" id="ebulk-mode">
      <button class="on" data-v="add">いまの名簿に足す</button>
      <button data-v="replace">いまの名簿を入れ替える</button>
    </div>
    <div class="btnrow">
      <button class="btn ghost" onclick="this.closest('.modal').remove()">やめる</button>
      <button class="btn" id="ebulk-ok">取り込む</button>
    </div>
  </div>`;
  document.body.appendChild(el);
  let mode = "add";
  el.querySelectorAll("#ebulk-mode button").forEach(b=> b.onclick = ()=>{
    el.querySelectorAll("#ebulk-mode button").forEach(x=>x.classList.remove("on"));
    b.classList.add("on"); mode = b.dataset.v;
  });
  $("#ebulk-ok").onclick = ()=>{
    const rows = $("#ebulk-tx").value.split("\n").map(parseMemberLine).filter(Boolean);
    if(!rows.length){ toast("読み取れる行がありませんでした"); return; }
    const add = rows.map(r=>({ id:uid(), memberId:null, no:r.no, name:r.name, pos:r.pos||"", grade:r.grade||null }));
    state.entry.players = (mode==="replace") ? add : state.entry.players.concat(add);
    el.remove(); render(); toast(`${rows.length}名を取り込みました`);
  };
}
/* 台帳から選ぶ（花巻東B・花巻東Cのように、同じ台帳から複数チームを出すときに使う）
   記入コードで台帳の在籍選手を取得→チェックボックスで選んだ分だけ、今の名簿と入れ替える */
async function openEntryClubPicker(){
  const e = state.entry;
  const code = (document.getElementById("entrycode")?.value||"").trim().toUpperCase();
  if(!code) return toast("先に記入コードを入れてください");
  toast("台帳を読み込んでいます…");
  let data;
  try{ data = await DB.loadTeamClubRoster(e.team.id, code); }
  catch(err){ return toast("読み込めませんでした: "+(err.message||err)); }
  if(!data) return toast("コードが違うか、提出できる期限を過ぎている可能性があります");
  const members = (data.players||[]).slice().sort((a,b)=>(a.no??999)-(b.no??999)||String(a.name).localeCompare(String(b.name),"ja"));
  if(!members.length) return toast("台帳に選手が登録されていません");
  const limit = Math.max(0, num(cfgOf(e.t).registerLimit)||0);
  const selected = new Set();   // 台帳から選ぶときは毎回0人から選び直す（今の名簿を上書きするため）
  const el = document.createElement("div");
  el.className = "modal";
  el.innerHTML = `<div class="sheet">
    <h3>${data.club_name?esc(data.club_name)+" の台帳から選ぶ":"台帳から選ぶ"}</h3>
    <p class="hint" style="margin-bottom:8px">選んだ選手で、今の名簿と入れ替えます。</p>
    <label class="f" style="margin-top:0">背番号</label>
    <div class="seg" id="ecp-nomode">
      <button class="on" data-v="keep">台帳の番号を引き継ぐ</button>
      <button data-v="renumber">1番から振り直す</button>
    </div>
    <input class="in" id="ecp-filter" placeholder="🔍 名前で絞り込み" style="margin-bottom:8px">
    <p class="hint" id="ecp-count" style="margin-bottom:8px"></p>
    <div id="ecp-list" style="max-height:50vh;overflow-y:auto"></div>
    <div class="btnrow" style="margin-top:8px">
      <button class="btn ghost sm" id="ecp-all">全員選択</button>
      <button class="btn ghost sm" id="ecp-none">全員解除</button>
    </div>
    <div class="btnrow" style="margin-top:8px">
      <button class="btn ghost" onclick="this.closest('.modal').remove()">やめる</button>
      <button class="btn" id="ecp-ok">この${limit>0?`${limit}`:""}名で入れ替える</button>
    </div>
  </div>`;
  document.body.appendChild(el);
  let noMode = "keep";
  el.querySelectorAll("#ecp-nomode button").forEach(b=> b.onclick=()=>{
    el.querySelectorAll("#ecp-nomode button").forEach(x=>x.classList.remove("on"));
    b.classList.add("on"); noMode = b.dataset.v;
  });
  const countEl = $("#ecp-count");
  const syncCount = ()=>{ countEl.textContent = limit>0 ? `選択中：${selected.size} / 上限${limit}名` : `選択中：${selected.size}名`; };
  const rowHTML = m=>`<label class="lurow" style="cursor:pointer" data-name="${esc(m.name)}">
      <input type="checkbox" class="ecp-chk" data-id="${m.id}" style="width:18px;height:18px;flex:0 0 auto">
      <span class="lunm">${m.no?`<b>${esc(String(m.no))}</b> `:""}${esc(m.name)}${m.grade?` <small>${esc(String(m.grade))}年</small>`:""}</span>
    </label>`;
  const bindRows = ()=>{
    el.querySelectorAll(".ecp-chk").forEach(cb=> cb.onchange = ()=>{
      const id = cb.dataset.id;
      if(cb.checked){
        if(limit>0 && selected.size>=limit){ cb.checked=false; toast(`上限${limit}名までです`); return; }
        selected.add(id);
      } else selected.delete(id);
      syncCount();
    });
  };
  const renderList = ()=>{ $("#ecp-list").innerHTML = members.map(rowHTML).join(""); bindRows(); syncCount(); };
  renderList();
  $("#ecp-filter").oninput = ()=>{
    const q = $("#ecp-filter").value.trim();
    el.querySelectorAll("#ecp-list > label").forEach(row=>{ row.style.display = !q || row.dataset.name.includes(q) ? "" : "none"; });
  };
  $("#ecp-all").onclick = ()=>{
    members.forEach(m=>{ if(limit===0 || selected.size<limit) selected.add(m.id); });
    if(limit>0 && members.length>limit) toast(`上限${limit}名までです`);
    renderList();
  };
  $("#ecp-none").onclick = ()=>{ selected.clear(); renderList(); };
  $("#ecp-ok").onclick = ()=>{
    if(!selected.size) return toast("1人も選ばれていません");
    state.entry.players = members.filter(m=>selected.has(m.id)).map((m,i)=>({
      id:m.id, memberId:m.id, no: noMode==="renumber" ? i+1 : m.no, name:m.name, pos:m.pos, grade:m.grade }));
    el.remove(); render();
    toast(`${state.entry.players.length}名を入れました。最後に「この内容で提出する」を押してください`);
  };
}
async function submitEntry(){
  const e = state.entry;
  const code = (document.getElementById("entrycode")?.value||"").trim().toUpperCase();
  if(!code){ toast("記入コードを入れてください"); return; }
  const players = e.players.map(p=>({ id:p.id||uid(), memberId:p.memberId||null,
      no:(p.no===""||p.no==null)?null:num(p.no), name:(p.name||"").trim(),
      pos:p.pos||"", grade:p.grade?num(p.grade):null })).filter(p=>p.name);
  if(!players.length && !confirm("選手が1人も入力されていません。このまま提出しますか？")) return;
  try{
    const ok = await DB.submitRoster(e.team.id, code, players);
    if(!ok){ toast("記入コードが違います"); return; }
    e.players = players.map(p=>({...p})); e.done = true; render();
    toast("提出しました。ありがとうございました！");
  }catch(err){ toast("提出できませんでした: "+(err.message||err)); }
}
function viewEntry(){
  const e = state.entry;
  if(state.loading || !e) return topbar({title:"名簿の記入"}) + `<div class="empty">読み込み中…</div>`;
  if(e.error) return topbar({title:"名簿の記入"}) + `<div class="screen"><div class="empty">${esc(e.error)}</div></div>`;
  const note = cfgOf(e.t).entryNote || "";
  const POS = ["","GK","DF","MF","FW"];
  const nums = e.players.map(p=>p.no).filter(n=>n!=null && n!=="");
  const dups = [...new Set(nums.filter((n,i)=>nums.indexOf(n)!==i))];
  const dupWarn = dups.length ? `<div class="callout" style="margin-top:8px;background:var(--warnbg);border-color:#f0d9a0;color:var(--warn)">⚠️ 背番号が重なっています：${dups.join("、")}</div>` : "";
  return topbar({ title:"名簿の記入", sub:e.t.name })
  + `<div class="screen">
    <div class="card">
      <div class="lead" style="margin:0"><b style="font-size:19px">${esc(e.team.name)}</b> の出場メンバーを入力し、最後に本部からもらった<b>記入コード</b>を入れて提出してください。ログインは要りません。</div>
      ${note?`<div class="callout" style="margin-top:10px">📋 本部より：${esc(note)}</div>`:""}
    </div>
    <div class="card">
      <div class="tblwrap"><table class="rostertbl">
        <thead><tr><th style="width:52px">番号</th><th style="text-align:left">氏名</th><th style="width:76px">学年</th><th style="width:70px">位置</th><th style="width:48px"></th></tr></thead>
        <tbody>${e.players.map((p,i)=>`<tr>
          <td><input class="in rt-no" style="text-align:center" type="number" value="${p.no??""}" oninput="entrySetPlayer(${i},'no',this.value)"></td>
          <td style="text-align:left"><input class="in" value="${esc(p.name||"")}" title="${esc(p.name||"")}" oninput="entrySetPlayer(${i},'name',this.value)" placeholder="氏名"></td>
          <td><input class="in" style="text-align:center;padding:7px" type="number" value="${p.grade??""}" oninput="entrySetPlayer(${i},'grade',this.value)"></td>
          <td><select class="in" style="padding:7px" onchange="entrySetPlayer(${i},'pos',this.value)">${POS.map(o=>`<option ${o===(p.pos||"")?"selected":""}>${o||"-"}</option>`).join("")}</select></td>
          <td><button class="linkbtn" style="color:var(--bad);font-size:11px;padding:4px 2px" onclick="entryRemovePlayer(${i})">削除</button></td>
        </tr>`).join("")}</tbody>
      </table></div>
      <div class="btnrow" style="margin-top:8px">
        <button class="btn ghost" style="flex:1" onclick="entryAddPlayer()">＋ 選手を追加</button>
        <button class="btn ghost" style="flex:1" onclick="openEntryBulk()">📋 まとめて貼り付け</button>
      </div>
      ${e.team.club_id ? `<div class="btnrow" style="margin-top:8px">
        <button class="btn sec" style="flex:1" onclick="openEntryClubPicker()">📋 台帳から選ぶ（下の記入コードを先に入れてください）</button>
      </div>` : ""}
      ${dupWarn}
    </div>
    <div class="card">
      <label class="lbl">記入コード（本部からもらった6文字）</label>
      <input id="entrycode" class="in" style="text-transform:uppercase;letter-spacing:3px;font-size:18px" placeholder="ABC123" maxlength="6" value="${esc(e.code||"")}" oninput="this.value=this.value.toUpperCase()">
      <button class="btn" style="margin-top:12px" onclick="submitEntry()">この内容で提出する</button>
      ${e.done?`<div class="callout ok" style="margin-top:10px">✅ 提出できました。あとから直して再提出もできます。</div>`:""}
      <p class="hint">提出すると本部の大会に反映されます。締切や背番号の決まりは本部の連絡にしたがってください。</p>
    </div>
  </div>`;
}
/* 本部側：記入リンクを配る */
async function openEntryLinks(){
  state.view="entrylinks"; state.loading=true; render();
  try{ state.entryMap = await DB.ensureEntries(state.teams, state.t.id, state.t.org_id); }
  catch(e){ toast("記入コードを用意できませんでした: "+(e.message||e)); state.entryMap={}; }
  state.loading=false; render();
}
function entryLinkFor(teamId){ return location.origin + location.pathname + "#entry=" + teamId; }
/* 記入コードの提出期限（任意）：一覧の中の1件でも期限が入っていればそれを代表値として表示する（一括設定が前提のため） */
function entryExpiryInfo(map){
  const withExp = Object.values(map||{}).find(e=>e.expires_at);
  if(!withExp) return { text:"設定なし（いつでも提出できます）", iso:null };
  const d = new Date(withExp.expires_at);
  const label = `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日まで`;
  return { text: d.getTime() < Date.now() ? `${label}（期限切れ・提出できません）` : `${label}提出できます`, iso:withExp.expires_at };
}
async function applyEntryExpiry(){
  const v = document.getElementById("entry-exp-date")?.value;
  if(!v) return toast("日付を選んでください");
  try{
    await DB.setEntriesExpiry(state.t.id, new Date(v+"T23:59:59").toISOString());
    toast("提出期限を設定しました");
    await openEntryLinks();
  }catch(e){ toast("設定できませんでした: "+(e.message||e)); }
}
async function clearEntryExpiry(){
  if(!confirm("提出期限をなくします。よろしいですか？")) return;
  try{ await DB.setEntriesExpiry(state.t.id, null); toast("期限をなくしました"); await openEntryLinks(); }
  catch(e){ toast("解除できませんでした: "+(e.message||e)); }
}
function viewEntryLinks(){
  if(!state.t) return topbar({title:"記入リンクを配る", back:"go('home')"}) + `<div class="empty">大会が選ばれていません。</div>`;
  if(state.loading) return topbar({title:"記入リンクを配る", back:"go('t')"}) + `<div class="empty">準備中…</div>`;
  const map = state.entryMap||{};
  const total = state.teams.length;
  const done = state.teams.filter(t=>map[t.id]?.submitted_at).length;
  const exp = entryExpiryInfo(map);
  return topbar({ title:"記入リンクを配る", sub:state.t.name, back:"go('t')" })
  + `<div class="screen">
    <p class="lead">各チームに下の<b>リンク</b>と<b>記入コード</b>を配ってください。チームはログイン不要で、自分の名簿だけを入力・提出できます（他チームや結果は触れません）。</p>
    <div class="callout ${done===total&&total?"ok":""}" style="margin-bottom:10px">提出状況：<b>${done} / ${total}</b> チーム${done===total&&total?"（全チーム提出ずみ）":"が提出ずみ"}</div>
    <div class="card" style="margin-bottom:10px">
      <div class="lbl" style="margin:0 0 6px">提出期限（任意・全チーム共通）</div>
      <p class="hint" style="margin:0 0 8px">現在：${exp.text}</p>
      <div style="display:flex;gap:8px;align-items:center">
        <input type="date" class="in" id="entry-exp-date" style="flex:1">
        <button class="btn sec sm" onclick="applyEntryExpiry()">この日までに設定</button>
        ${exp.iso ? `<button class="btn ghost sm" onclick="clearEntryExpiry()">解除</button>` : ""}
      </div>
    </div>
    <button class="btn ghost sm noprint" style="margin-bottom:10px" onclick="window.print()">🖨 一覧を印刷して配る</button>
    ${state.teams.map(t=>{
      const e = map[t.id]||{}; const link = entryLinkFor(t.id);
      const guide = `【${t.name}】メンバー名簿の記入をお願いします。\n下のリンクを開いて、記入コード ${e.code||""} を入れて提出してください。\n${link}`;
      return `<div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <b style="font-size:17px">${esc(t.name)}</b>
          <span class="pill ${e.submitted_at?"ok":""}">${e.submitted_at?"提出済み":"未提出"}</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
          <span class="lbl" style="width:76px;margin:0">記入コード</span>
          <b style="font-size:20px;letter-spacing:3px">${esc(e.code||"—")}</b>
          <button class="btn ghost sm" onclick="copyText('${esc(e.code||"")}','コードをコピーしました')">コピー</button>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:6px">
          <span class="lbl" style="width:76px;margin:0">リンク</span>
          <input class="in" style="flex:1;font-size:12px" readonly value="${link}" onclick="this.select()">
          <button class="btn ghost sm" onclick="copyText('${link}','リンクをコピーしました')">コピー</button>
        </div>
        <button class="btn ghost sm" style="margin-top:8px;width:100%" onclick="copyText(${esc(JSON.stringify(guide))},'案内文をコピーしました')">📋 案内文ごとコピー</button>
      </div>`;
    }).join("")}
  </div>`;
}

/* ==========================================================================
   台帳の記入リンク：本部が配る／チームが自分のチーム名・選手を登録（ログイン不要）
   ========================================================================== */
function openClubEntry(clubId){
  state.clubEntry = { clubId, name:"", category:"elem", crest:null, players:[], code:"", done:false };
  state.view = "clubentry"; render();
}
function ceSet(k,v){ state.clubEntry[k]=v; }
function cePlayer(i,k,v){ state.clubEntry.players[i][k]=v; }
function ceAdd(){ state.clubEntry.players.push({ id:uid(), no:null, name:"", pos:"", grade:null, prev_team:"" }); render(); }
function ceRemove(i){ state.clubEntry.players.splice(i,1); render(); }
function ceCrest(input){
  const f = input.files && input.files[0]; if(!f) return;
  if(f.size > 6*1024*1024) return toast("画像が大きすぎます（6MBまで）");
  readImageResized(f, 128, durl=>{ state.clubEntry.crest = durl; render(); });
}
/* 新年度の更新：記入コードを添えて「現在の名簿」を読み込み、フォームに反映 */
async function ceLoad(){
  const code = (document.getElementById("celoadcode")?.value||"").trim().toUpperCase();
  if(!code) return toast("記入コードを入れてください");
  try{
    const data = await DB.loadClubRosterByCode(state.clubEntry.clubId, code);
    if(!data) return toast("記入コードが違います");
    const e = state.clubEntry;
    e.name = data.name||""; e.category = data.category||"elem"; e.crest = data.crest||null;
    e.players = (data.players||[]).map(p=>({ id:p.id||uid(), no:p.no, name:p.name, pos:p.pos||"", grade:p.grade, prev_team:p.prev_team||"" }));
    e.code = code; e.loaded = true; render();
    toast("現在の名簿を読み込みました");
  }catch(err){ toast("読み込めませんでした: "+(err.message||err)); }
}
function ceBulk(){
  const el = document.createElement("div"); el.className="modal";
  el.innerHTML = `<div class="sheet">
    <h3>選手をまとめて貼り付け</h3>
    <p class="hint" style="margin-bottom:8px">1行に1人。番号／氏名／前所属／学年／位置（タブ・カンマ区切り）。手で打つときは「10 山田太郎 6 FW」でもOK。</p>
    <textarea class="in" id="ceb-tx" style="min-height:160px" placeholder="10	山田太郎	さくら少年団	6	FW"></textarea>
    <div class="seg" id="ceb-mode"><button class="on" data-v="add">いまの名簿に足す</button><button data-v="replace">入れ替える</button></div>
    <div class="btnrow"><button class="btn ghost" onclick="this.closest('.modal').remove()">やめる</button><button class="btn" id="ceb-ok">取り込む</button></div>
  </div>`;
  document.body.appendChild(el);
  let mode="add";
  el.querySelectorAll("#ceb-mode button").forEach(b=> b.onclick=()=>{
    el.querySelectorAll("#ceb-mode button").forEach(x=>x.classList.remove("on")); b.classList.add("on"); mode=b.dataset.v; });
  $("#ceb-ok").onclick = ()=>{
    const rows = $("#ceb-tx").value.split("\n").map(parseMemberLine).filter(Boolean);
    if(!rows.length) return toast("読み取れる行がありませんでした");
    const add = rows.map(r=>({ id:uid(), no:r.no, name:r.name, pos:r.pos||"", grade:r.grade||null, prev_team:r.prev_team||"" }));
    state.clubEntry.players = (mode==="replace") ? add : state.clubEntry.players.concat(add);
    el.remove(); render(); toast(`${rows.length}名を取り込みました`);
  };
}
async function submitClubEntry(){
  const e = state.clubEntry;
  const code = (document.getElementById("cecode")?.value||"").trim().toUpperCase();
  if(!code) return toast("記入コードを入れてください");
  if(!(e.name||"").trim()) return toast("チーム名を入れてください");
  const players = e.players.map(p=>({ id:p.id||uid(),
      no:(p.no===""||p.no==null)?null:num(p.no), name:(p.name||"").trim(),
      pos:p.pos||null, grade:p.grade?num(p.grade):null, prev_team:(p.prev_team||"").trim()||null })).filter(p=>p.name);
  if(!players.length && !confirm("選手が1人も入力されていません。このまま提出しますか？")) return;
  try{
    const ok = await DB.submitClubRoster(e.clubId, code, { name:e.name.trim(), category:e.category, crest:e.crest, players });
    if(!ok) return toast("記入コードが違います");
    e.done = true; render(); toast("提出しました。ありがとうございました！");
  }catch(err){ toast("提出できませんでした: "+(err.message||err)); }
}
function viewClubEntry(){
  const e = state.clubEntry;
  if(!e) return topbar({title:"チーム登録"}) + `<div class="empty">読み込み中…</div>`;
  const POS = ["","GK","DF","MF","FW"];
  return topbar({ title:"チーム・選手の登録" })
  + `<div class="screen">
    <div class="card">
      <div class="lead" style="margin:0">本部からの依頼で、<b>チーム名と選手</b>を登録します。ログインは要りません。最後に本部からもらった<b>記入コード</b>を入れて提出してください。</div>
    </div>
    <div class="card">
      <div class="lead" style="margin:0 0 8px"><b>新年度の更新のとき</b>は、記入コードを入れて「現在の名簿を読み込む」を押すと、いまの選手が<b>学年くり上がり済み</b>で出ます。卒業した子を「削除」、<b>新入生</b>を「＋選手を追加」で足して提出してください。</div>
      <div style="display:flex;gap:8px">
        <input id="celoadcode" class="in" style="text-transform:uppercase;letter-spacing:2px" placeholder="記入コード" maxlength="6" value="${esc(e.code||"")}" oninput="this.value=this.value.toUpperCase()">
        <button class="btn sec sm" style="width:auto;white-space:nowrap" onclick="ceLoad()">現在の名簿を読み込む</button>
      </div>
      ${e.loaded?`<div class="callout ok" style="margin-top:8px">✅ 読み込みました。卒業した子は「削除」、新入生は「＋選手を追加」で足してください。</div>`:`<p class="hint">はじめて登録するチームは、そのまま下に入力すればOK（読み込みは不要）。</p>`}
    </div>
    <div class="card">
      <label class="f">チーム名</label>
      <input class="in" value="${esc(e.name)}" oninput="ceSet('name',this.value)" placeholder="例）さくら小学校">
      <label class="f">区分</label>
      <div class="seg">${["elem","jhs","hs","univ"].map(k=>
        `<button class="${e.category===k?"on":""}" onclick="ceSet('category','${k}');render()">${esc(CATEGORIES[k].label)}</button>`).join("")}</div>
      <label class="f">校章・エンブレム（任意）</label>
      <div style="display:flex;align-items:center;gap:12px">
        ${e.crest?`<img src="${e.crest}" alt="校章" style="width:56px;height:56px;object-fit:contain;border:1px solid var(--line);border-radius:8px;background:#fff">`:`<div style="width:56px;height:56px;border:1px dashed var(--line);border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--sub);font-size:11px">なし</div>`}
        <label class="btn sec sm" style="width:auto;cursor:pointer;display:inline-block">画像を選ぶ<input type="file" accept="image/*" style="display:none" onchange="ceCrest(this)"></label>
      </div>
    </div>
    <div class="card">
      <div class="tblwrap"><table class="rostertbl">
        <thead><tr><th style="width:52px">番号</th><th style="text-align:left">氏名</th><th style="text-align:left">前所属</th><th style="width:76px">学年</th><th style="width:70px">位置</th><th style="width:48px"></th></tr></thead>
        <tbody>${e.players.map((p,i)=>`<tr>
          <td><input class="in rt-no" style="text-align:center" type="number" value="${p.no??""}" oninput="cePlayer(${i},'no',this.value)"></td>
          <td style="text-align:left"><input class="in" style="padding:7px" value="${esc(p.name||"")}" title="${esc(p.name||"")}" oninput="cePlayer(${i},'name',this.value)" placeholder="氏名"></td>
          <td style="text-align:left"><input class="in" style="padding:7px" value="${esc(p.prev_team||"")}" title="${esc(p.prev_team||"")}" oninput="cePlayer(${i},'prev_team',this.value)" placeholder="前所属"></td>
          <td><input class="in" style="text-align:center;padding:7px" type="number" value="${p.grade??""}" oninput="cePlayer(${i},'grade',this.value)"></td>
          <td><select class="in" style="padding:7px" onchange="cePlayer(${i},'pos',this.value)">${POS.map(o=>`<option ${o===(p.pos||"")?"selected":""}>${o||"-"}</option>`).join("")}</select></td>
          <td><button class="linkbtn" style="color:var(--bad);font-size:11px;padding:4px 2px" onclick="ceRemove(${i})">削除</button></td>
        </tr>`).join("")}</tbody>
      </table></div>
      <div class="btnrow" style="margin-top:8px">
        <button class="btn ghost" style="flex:1" onclick="ceAdd()">＋ 選手を追加</button>
        <button class="btn ghost" style="flex:1" onclick="ceBulk()">📋 まとめて貼り付け</button>
      </div>
    </div>
    <div class="card">
      <label class="lbl">記入コード（本部からもらった6文字）</label>
      <input id="cecode" class="in" style="text-transform:uppercase;letter-spacing:3px;font-size:18px" placeholder="ABC123" maxlength="6" value="${esc(e.code||"")}" oninput="this.value=this.value.toUpperCase()">
      <button class="btn" style="margin-top:12px" onclick="submitClubEntry()">この内容で提出する</button>
      ${e.done?`<div class="callout ok" style="margin-top:10px">✅ 提出できました。あとから直して再提出もできます。</div>`:""}
      <p class="hint">提出すると本部の台帳に反映されます。締切や決まりは本部の連絡にしたがってください。</p>
    </div>
  </div>`;
}
/* 本部側：台帳の記入リンクを配る */
async function openClubEntryLinks(){
  if(!state.user) return toast("先にログインしてください");
  if(!state.clubs.length) return toast("先にチームを作ってください（＋チームを追加）");
  state.view="clubentrylinks"; state.loading=true; render();
  try{ state.clubEntryMap = await DB.ensureClubEntries(state.clubs, state.user.id); }
  catch(e){ toast("記入コードを用意できませんでした: "+(e.message||e)); state.clubEntryMap={}; }
  state.loading=false; render();
}
function clubEntryLinkFor(clubId){ return location.origin + location.pathname + "#croster=" + clubId; }
async function applyClubEntryExpiry(){
  const v = document.getElementById("club-exp-date")?.value;
  if(!v) return toast("日付を選んでください");
  try{
    await DB.setClubEntriesExpiry(state.user.id, new Date(v+"T23:59:59").toISOString());
    toast("提出期限を設定しました");
    await openClubEntryLinks();
  }catch(e){ toast("設定できませんでした: "+(e.message||e)); }
}
async function clearClubEntryExpiry(){
  if(!confirm("提出期限をなくします。よろしいですか？")) return;
  try{ await DB.setClubEntriesExpiry(state.user.id, null); toast("期限をなくしました"); await openClubEntryLinks(); }
  catch(e){ toast("解除できませんでした: "+(e.message||e)); }
}
function viewClubEntryLinks(){
  if(state.loading) return topbar({title:"台帳の記入リンク", back:"go('roster')"}) + `<div class="empty">準備中…</div>`;
  const map = state.clubEntryMap||{};
  const clubs = state.clubs.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),"ja"));
  const total = clubs.length, done = clubs.filter(c=>map[c.id]?.submitted_at).length;
  const exp = entryExpiryInfo(map);
  return topbar({ title:"台帳の記入リンクを配る", sub:`${orgYear()}年度`, back:"go('roster')" })
  + `<div class="screen">
    <p class="lead">各チームに下の<b>リンク</b>と<b>記入コード</b>を配ってください。チームはログイン不要で、自分のチーム名・選手を登録できます。<b>新年度は先に「新年度にする」で学年をくり上げてから</b>配ると、各チームが現在の名簿を読み込んで新入生を足すだけで済みます。提出内容は台帳に反映されます。</p>
    <div class="callout ${done===total&&total?"ok":""}" style="margin-bottom:10px">提出状況：<b>${done} / ${total}</b> チームが提出ずみ</div>
    <div class="card" style="margin-bottom:10px">
      <div class="lbl" style="margin:0 0 6px">提出期限（任意・全チーム共通）</div>
      <p class="hint" style="margin:0 0 8px">現在：${exp.text}</p>
      <div style="display:flex;gap:8px;align-items:center">
        <input type="date" class="in" id="club-exp-date" style="flex:1">
        <button class="btn sec sm" onclick="applyClubEntryExpiry()">この日までに設定</button>
        ${exp.iso ? `<button class="btn ghost sm" onclick="clearClubEntryExpiry()">解除</button>` : ""}
      </div>
    </div>
    <button class="btn ghost sm noprint" style="margin-bottom:10px" onclick="window.print()">🖨 一覧を印刷して配る</button>
    ${clubs.length ? clubs.map(c=>{
      const e = map[c.id]||{}; const link = clubEntryLinkFor(c.id);
      const guide = `【${c.name}】新年度のチーム名簿の登録をお願いします。\n下のリンクを開いて、記入コード ${e.code||""} を入れてください。\n「現在の名簿を読み込む」で今の選手が出ます。卒業した子を消し、新入生を足して提出してください。\n${link}`;
      return `<div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <b style="font-size:17px">${esc(c.name)}</b>
          <span class="pill ${e.submitted_at?"ok":""}">${e.submitted_at?"提出済み":"未提出"}</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
          <span class="lbl" style="width:76px;margin:0">記入コード</span>
          <b style="font-size:20px;letter-spacing:3px">${esc(e.code||"—")}</b>
          <button class="btn ghost sm" onclick="copyText('${esc(e.code||"")}','コードをコピーしました')">コピー</button>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:6px">
          <span class="lbl" style="width:76px;margin:0">リンク</span>
          <input class="in" style="flex:1;font-size:12px" readonly value="${link}" onclick="this.select()">
          <button class="btn ghost sm" onclick="copyText('${link}','リンクをコピーしました')">コピー</button>
        </div>
        <button class="btn ghost sm" style="margin-top:8px;width:100%" onclick="copyText(${esc(JSON.stringify(guide))},'案内文をコピーしました')">📋 案内文ごとコピー</button>
      </div>`;
    }).join("") : `<div class="empty">先に「チームを追加」か「チーム名をまとめて作る」で枠を作ってください。</div>`}
  </div>`;
}

/* --- 分担入力の自動反映（開いている大会だけ、静かに更新） --- */
setInterval(async ()=>{
  if(document.hidden) return;
  if(state.view!=="t" || !state.t) return;
  try{
    const d = await DB.loadTournament(state.t.id);
    if(!d.t) return;
    // 結果（スコア・状態・メモ）に加え、名簿の提出（記入リンク）も自動で反映する
    const sig = s => JSON.stringify([
      s.matches.map(m=>[m.id,m.home_score,m.away_score,m.status,m.note]),
      s.teams.map(t=>[t.id, t.grp, (t.players||[]).length]),
    ]);
    const before = sig({matches:state.matches, teams:state.teams});
    state.t = d.t; state.teams = d.teams; state.matches = d.matches;
    if(before !== sig(d)) render();
  }catch(e){ /* 通信できないときは静かに次回へ */ }
}, POLL_MS);

/* --- 公式記録の入力を、再描画しても取りこぼさないよう #app に委譲 --- */
$("#app").addEventListener("input", e=>{
  const el = e.target.closest(".fx"); if(!el || !el.dataset.p || !state.official) return;
  const v = el.value !== undefined ? el.value : el.textContent;   // contenteditable(.fxedit)はvalueが無い
  pset(state.official, el.dataset.p, v);
  if(/^(H|A)\.scores\./.test(el.dataset.p)) refreshTotals();
  const tm = el.dataset.p.match(/^(H|A)\.tot\.(\w+)\.(0|1|3|4)$/);   // 前半/後半/延前/延後→計を自動計算（I10/I11）
  if(tm){ recomputeTotal(tm[1], tm[2]); }
  // 選手のシュート前半/後半を手入力→本人の計＋チーム合計を自動計算
  const sm = el.dataset.p.match(/^(H|A)\.lineup\.\d+\.(s1|s2|e1|e2)$/);
  if(sm){ computeShots(sm[1]); syncShotDOM(sm[1]); }
  // PK経過欄を手で直したら、チーム脇の〇の数を数え直す
  const pm = el.dataset.p.match(/^(H|A)\.pks\.\d+$/);
  if(pm){ const sp=document.getElementById("pkmaru-"+pm[1]); if(sp) sp.textContent = pkMaruCount(pm[1]); }
});
/* チーム名(.fxedit)はEnterで改行させない（折り返しはCSS任せ・手動改行は防ぐ）。押したらフォーカスを外して確定 */
$("#app").addEventListener("keydown", e=>{
  if(e.key!=="Enter") return;
  const el = e.target.closest(".fxedit"); if(!el) return;
  e.preventDefault(); el.blur();
});
$("#app").addEventListener("click", e=>{
  const el = e.target.closest(".pickable"); if(!el) return;
  const k = el.dataset.tapk;
  if(k==="lineup")   openLineupCellPicker(el.dataset.side, +el.dataset.idx);
  else if(k==="goalteam") openGoalTeamPicker(+el.dataset.idx);
  else if(k==="goalno")   openGoalNoPicker(+el.dataset.idx);
  else if(k==="cardno")   openCardNoPicker(el.dataset.side, +el.dataset.idx);
  else if(k==="seq")      openSeqPicker(+el.dataset.idx, +el.dataset.ci);
  else if(k==="shot")     openShotPicker(el.dataset.side, +el.dataset.idx, el.dataset.half);
});
/* シュート：前半/後半を選ぶ（1〜のリスト・手入力も可）。本人の計とチーム合計を自動計算 */
const SHOT_HALF_LABEL = { s1:"前半", s2:"後半", e1:"延長前半", e2:"延長後半" };
function openShotPicker(side, idx, half){
  const opts = Array.from({length:16},(_,n)=>({k:String(n), label:n+"本"}));
  chooseModal(`シュート（${SHOT_HALF_LABEL[half]||""}）`, opts, (pick,act)=>{
    const r = state.official[side].lineup[idx];
    if(act==="manual"){ focusCell(`${side}.lineup.${idx}.${half}`); return; }
    if(act==="clear"){ r[half]=""; computeShots(side); render(); return; }
    r[half]=pick.k; computeShots(side); render();
  }, {manual:true, clear:true});
}
/* 選手のシュート→本人の計＋チーム合計シュートを計算（延長時は延前e1/延後e2も計に含める） */
function computeShots(side){
  const o = state.official; if(!o) return;
  const et = matchETPlayed(curMatchAny()||{});
  const S = o[side]; let f=0, h=0, ef=0, eh=0;
  S.lineup.forEach(r=>{
    const a=num(r.s1), b=num(r.s2), c=et?num(r.e1):0, d=et?num(r.e2):0;
    const any = r.s1||r.s2||(et&&(r.e1||r.e2));
    r.st = any ? String(a+b+c+d) : "";
    f+=a; h+=b; ef+=c; eh+=d;
  });
  S.tot.shot[0] = f?String(f):"";
  S.tot.shot[1] = h?String(h):"";
  S.tot.shot[3] = ef?String(ef):"";
  S.tot.shot[4] = eh?String(eh):"";
  S.tot.shot[2] = (f||h||ef||eh) ? String(f+h+ef+eh) : "";   // 計＝前後半＋延長ぶん
}
/* 計算結果をDOMに反映（再描画せずに・手入力中のフォーカスを保つため） */
function syncShotDOM(side){
  const S = state.official[side];
  S.lineup.forEach((r,i)=>{ const el=document.querySelector(`.fx[data-p="${side}.lineup.${i}.st"]`); if(el) el.value=r.st; });
  ["0","1","2","3","4"].forEach(j=>{ const el=document.querySelector(`.fx[data-p="${side}.tot.shot.${j}"]`); if(el) el.value=S.tot.shot[j]; });
}
/* チーム合計：計 = 前半 + 後半 + 延前 + 延後 */
function recomputeTotal(side, key){
  const arr = state.official[side].tot[key];
  arr[2] = String(num(arr[0]) + num(arr[1]) + num(arr[3]) + num(arr[4]));
  const el = document.querySelector(`.fx[data-p="${side}.tot.${key}.2"]`);
  if(el) el.value = arr[2];
}

