function viewSchedule(){
  const ms = matchesInOrder();
  if(!ms.length) return topbar({title:"日程・会場", back:"go('t')"}) + `<div class="empty">試合がありません。</div>`;
  return topbar({ title:"日程・会場", sub:state.t.name, back:"go('t')",
      act:`<button class="act" onclick="saveSchedule()">保存</button>` })
  + `<div class="screen">
    <p class="lead">各試合の日にち・時刻・会場を入れます。複数日・月をまたいでもOK。「試合番号をふり直す」で、いまの並び順に通し番号（No.）を付けます。</p>
    <div class="btnrow">
      <button class="btn sec sm" style="flex:1" onclick="renumberMatches()">🔢 試合番号をふり直す</button>
      <button class="btn sec sm" style="flex:1" onclick="openBulkDay()">📅 まとめて日付・会場</button>
    </div>
    ${ms.map((m,i)=>{
      const H=resolveSlot(m,"H"), A=resolveSlot(m,"A");
      return `<div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <b style="color:var(--gold)">${m.matchNo?`No.${m.matchNo}`:`（${i+1}）`}</b>
          <span style="font-size:11.5px;color:var(--sub)">${esc(matchStageLabel(m))}</span>
        </div>
        <div style="font-weight:700;margin:5px 0 9px">${esc(H.label)} <span style="color:var(--na);font-size:12px">vs</span> ${esc(A.label)}</div>
        <div class="row2">
          <input class="in" type="date" value="${localDate(m.kickoff)}" onchange="setSched('${m.id}','date',this.value)">
          <input class="in" type="time" value="${localTime(m.kickoff)}" onchange="setSched('${m.id}','time',this.value)">
        </div>
        <input class="in" list="venueList" style="margin-top:6px" value="${esc(m.venue||"")}" onchange="setSchedVenue('${m.id}',this.value)" placeholder="会場（例：第1グラウンド）">
      </div>`;
    }).join("")}
    <button class="btn" onclick="saveSchedule()">保存する</button>
    ${venueDatalistHTML()}
  </div>`;
}
function setSched(id, part, val){
  const m = state.matches.find(x=>x.id===id); if(!m) return;
  let d = localDate(m.kickoff), t = localTime(m.kickoff);
  if(part==="date") d=val; else t=val;
  m.kickoff = d ? new Date(`${d}T${t||"00:00"}`).toISOString() : null;
  m._sd = true;
}
function setSchedVenue(id, v){ const m=state.matches.find(x=>x.id===id); if(m){ m.venue=v; m._sd=true; } }
function renumberMatches(){
  matchesInOrder().forEach((m,i)=>{ m.matchNo=i+1; m._sd=true; });
  toast("試合番号をふり直しました"); render();
}
function openBulkDay(){
  const el=document.createElement("div"); el.className="modal";
  el.innerHTML=`<div class="sheet"><h3>まとめて入力</h3>
    <p class="hint" style="margin-bottom:8px">入れた項目だけ、まだ空の試合に一括で入ります（入力済みは変えません）。</p>
    <label class="f">日付</label><input class="in" id="bd-date" type="date">
    <label class="f">会場</label><input class="in" id="bd-venue" list="venueList" placeholder="会場名">
    <div class="btnrow"><button class="btn ghost" onclick="this.closest('.modal').remove()">やめる</button>
      <button class="btn" id="bd-ok">空いている試合に入れる</button></div></div>`;
  document.body.appendChild(el);
  $("#bd-ok").onclick=()=>{
    const d=$("#bd-date").value, v=$("#bd-venue").value.trim();
    state.matches.forEach(m=>{
      if(d && !m.kickoff){ m.kickoff=new Date(`${d}T00:00`).toISOString(); m._sd=true; }
      if(v && !m.venue){ m.venue=v; m._sd=true; }
    });
    el.remove(); toast("入れました"); render();
  };
}
async function saveSchedule(){
  const dirty = state.matches.filter(m=>m._sd);
  if(!dirty.length){ toast("変更はありません"); return go("t"); }
  try{
    await DB.upsert("gn_matches", dirty.map(stripMatch));
    dirty.forEach(m=>delete m._sd);
    toast("保存しました"); go("t");
  }catch(e){ console.error(e); toast("保存できませんでした: "+(e.message||e)); }
}

/* --- 会場アクセス（この大会の試合で実際に使われている会場だけ・保護者/一般も閲覧） --- */
function tabVenues(){
  const usedNames = [...new Set((state.matches||[]).map(m=>m.venue).filter(Boolean))];
  if(!usedNames.length) return `<div class="empty">会場情報はまだありません。</div>`;
  const byName = new Map((state.tournamentVenues||[]).map(v=>[v.name, v]));
  const card = name=>{
    const v = byName.get(name);
    return `<div class="card" style="margin-bottom:10px">
      <div style="font-weight:700">${esc(name)}</div>
      ${v && (v.address||v.phone) ? `<div class="hint" style="margin:4px 0 0">${[v.address,v.phone].filter(Boolean).map(esc).join("　")}</div>` : ""}
      ${v && v.map_url ? `<a href="${esc(v.map_url)}" target="_blank" rel="noopener" class="hint" style="margin:4px 0 0;display:inline-block">🗺 地図を開く</a>` : ""}
    </div>`;
  };
  return usedNames.map(card).join("");
}

/* --- お知らせ（テキストのみ・保護者/一般も閲覧） --- */
function announcementVisible(a){
  const now = new Date();
  return a.published
    && (!a.publish_from  || new Date(a.publish_from)  <= now)
    && (!a.publish_until || new Date(a.publish_until) >= now);
}
function tabNotice(){
  const list = state.announcements || [];
  const publicList = list.filter(announcementVisible);
  const draftList = canEdit() ? list.filter(a=>!announcementVisible(a)) : [];
  const card = a => `<div class="card" style="margin-bottom:10px${a.pinned?";border-color:var(--gold)":""}">
    ${a.pinned?`<div class="hint" style="color:var(--gold-text,var(--gold));margin:0 0 4px">📌 固定表示</div>`:""}
    <div style="font-weight:700">${esc(a.title)}</div>
    <div class="hint" style="margin:2px 0 8px">${esc(fmtDate(a.created_at))} ${esc(fmtTime(a.created_at))}</div>
    <div style="white-space:pre-wrap">${esc(a.body||"")}</div>
    ${canEdit() ? `<div class="btnrow" style="margin-top:10px">
      <button class="btn ghost sm" style="flex:1" onclick="openAnnouncementEditor('${a.id}')">編集</button>
      <button class="btn ghost sm" style="flex:1" onclick="toggleAnnouncementPublish('${a.id}')">${a.published?"非公開にする":"公開する"}</button>
      <button class="btn ghost sm" onclick="removeAnnouncement('${a.id}')">削除</button>
    </div>` : ""}
  </div>`;
  return `
    ${canEdit() ? `<button class="btn sec sm" style="width:100%;margin-bottom:12px" onclick="openAnnouncementEditor()">＋ お知らせを追加</button>` : ""}
    ${publicList.length ? publicList.map(card).join("") : `<div class="empty">お知らせはありません。</div>`}
    ${draftList.length ? `<div class="block-label" style="margin-top:18px">下書き・非公開・公開期間外（運営にだけ見えています）</div>${draftList.map(card).join("")}` : ""}
  `;
}
function openAnnouncementEditor(id){
  const a = id ? (state.announcements||[]).find(x=>x.id===id) : null;
  const el = document.createElement("div"); el.className="modal";
  const toLocal = iso => iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset()*60000).toISOString().slice(0,16) : "";
  el.innerHTML = `<div class="sheet"><h3>${a?"お知らせを編集":"お知らせを追加"}</h3>
    <label class="f">タイトル</label>
    <input class="in" id="an-title" value="${a?esc(a.title):""}" placeholder="例）雨天のため時間変更">
    <label class="f">本文</label>
    <textarea class="in" id="an-body" style="min-height:120px">${a?esc(a.body||""):""}</textarea>
    <label class="f">固定表示（先頭に常に表示）</label>
    <div class="seg" id="an-pinned">
      <button class="${!a?.pinned?"on":""}" data-v="0">しない</button>
      <button class="${a?.pinned?"on":""}" data-v="1">する</button>
    </div>
    <label class="f">公開状態</label>
    <div class="seg" id="an-published">
      <button class="${!a||!a.published?"on":""}" data-v="0">下書き（非公開）</button>
      <button class="${a?.published?"on":""}" data-v="1">公開する</button>
    </div>
    <label class="f">公開開始日時（空なら公開後すぐ）</label>
    <input class="in" id="an-from" type="datetime-local" value="${toLocal(a?.publish_from)}">
    <label class="f">公開終了日時（空なら無期限）</label>
    <input class="in" id="an-until" type="datetime-local" value="${toLocal(a?.publish_until)}">
    <div class="btnrow"><button class="btn ghost" onclick="this.closest('.modal').remove()">やめる</button>
      <button class="btn" id="an-ok">${a?"保存":"追加"}</button></div>
  </div>`;
  document.body.appendChild(el);
  let pinned = a?.pinned?1:0, published = a?.published?1:0;
  el.querySelectorAll("#an-pinned button").forEach(b=> b.onclick=()=>{
    el.querySelectorAll("#an-pinned button").forEach(x=>x.classList.remove("on")); b.classList.add("on"); pinned=+b.dataset.v; });
  el.querySelectorAll("#an-published button").forEach(b=> b.onclick=()=>{
    el.querySelectorAll("#an-published button").forEach(x=>x.classList.remove("on")); b.classList.add("on"); published=+b.dataset.v; });
  $("#an-ok").onclick = async ()=>{
    const title = $("#an-title").value.trim();
    if(!title) return toast("タイトルを入れてください");
    const fromV = $("#an-from").value, untilV = $("#an-until").value;
    const row = { id: a?a.id:uid(), org_id:state.user.id, tournament_id:state.t.id,
      title, body: $("#an-body").value, pinned: !!pinned, published: !!published,
      publish_from: fromV ? new Date(fromV).toISOString() : null,
      publish_until: untilV ? new Date(untilV).toISOString() : null,
      created_at: a ? a.created_at : new Date().toISOString(), updated_at: new Date().toISOString() };
    try{
      await DB.upsert("gn_announcements", row);
      state.announcements = await DB.loadAnnouncements(state.t.id);
      el.remove(); render(); toast(a?"保存しました":"追加しました");
    }catch(e){ toast("保存できませんでした: "+(e.message||e)); }
  };
}
async function toggleAnnouncementPublish(id){
  const a = (state.announcements||[]).find(x=>x.id===id); if(!a) return;
  try{
    await DB.upsert("gn_announcements", { ...a, published: !a.published, updated_at:new Date().toISOString() });
    a.published = !a.published; render();
  }catch(e){ toast("変更できませんでした: "+(e.message||e)); }
}
async function removeAnnouncement(id){
  if(!confirm("このお知らせを削除します。よろしいですか？")) return;
  try{
    await DB.remove("gn_announcements", id);
    state.announcements = (state.announcements||[]).filter(x=>x.id!==id);
    render(); toast("削除しました");
  }catch(e){ toast("削除できませんでした: "+(e.message||e)); }
}

/* --- 順位表 --- */
/* --- 大会概要（GoalNote風の一覧・保護者/一般も閲覧） --- */
const nl2br = s => String(s??"").replace(/\n/g,"<br>");
function tabOverview(){
  const t = state.t, cfg = cfgOf(t);
  const ov = cfg.overview || {};
  const period = [fmtDate(cfg.dateStart||cfg.date), cfg.dateEnd?("〜 "+fmtDate(cfg.dateEnd)):""].filter(Boolean).join(" ");
  const nTeams = (state.teams||[]).length;
  const cat = CATEGORIES[cfg.gradeCat]?.label, scope = SCOPES[cfg.scope]?.label;
  // 試合時間・方式：構造化データ（halfMin等）があればそれを文章化、無ければ旧テキスト
  const struct = (ov.halfMin!=null || ov.hasET!=null || ov.hasPK!=null);
  let timeLabel, ruleLabel;
  if(struct){
    const hm = ov.halfMin||0, etm = ov.etHalfMin||0;
    timeLabel = hm ? `前後半　各${hm}分（計 ${hm*2}分）` : "";
    const fromLabel = (ov.etFrom && ov.etFrom!=="all") ? ET_FROM_LABEL[ov.etFrom] : "";
    const etInner = [fromLabel, etm?`前後半 各${etm}分・計 ${etm*2}分`:""].filter(Boolean).join("・");
    const etTxt = ov.hasET ? `延長あり${etInner?`（${etInner}）`:""}` : "延長なし";
    ruleLabel = `${etTxt}　／　PK${ov.hasPK?"あり":"なし"}`;
  }else{
    timeLabel = nl2br(esc(ov.matchTime||""));
    ruleLabel = esc(ov.matchRule||"");
  }
  const rows = [
    ["名称", esc(t.name)],
    ["区分・規模", [cat,scope].filter(Boolean).map(esc).join("・")],
    ["主催", esc(cfg.host||"")],
    ["大会期間", esc(period)],
    ["参加チーム数", nTeams?`${nTeams}チーム`:""],
    ["競技", esc(SPORTS[t.sport]?.label||"")],
    ["大会方式", esc(FORMATS[t.format]?.label||"")],
    ["試合時間", timeLabel],
    ["試合方式", ruleLabel],
    ["勝点", FORMATS[t.format]?.hasLeague===false ? "" : `勝利 ${cfg.win} 点　／　引分け ${cfg.draw} 点　／　敗戦 ${cfg.lose} 点`],
    ["順位決定方法", FORMATS[t.format]?.hasLeague===false ? "" : nl2br(esc(ov.rankRule||""))],
    ["警告の累積", nl2br(esc(ov.cardRule||""))],
    ["当大会に関するお問い合わせ先", nl2br(esc(ov.contact||""))],
  ].filter(([,v])=> v!=="" && v!=null);
  return `<div class="tblwrap"><table>
    <tbody>${rows.map(([k,v])=>`<tr>
      <th style="text-align:left;white-space:nowrap;vertical-align:top;width:34%;background:#f6f8fc">${k}</th>
      <td style="text-align:left;vertical-align:top;white-space:normal;line-height:1.6">${v||"—"}</td>
    </tr>`).join("")}</tbody>
  </table></div>`
  + (canEdit()?`<div class="btnrow noprint"><button class="btn sec sm" onclick="go('settings')">⚙ 大会概要を編集</button></div>`:"");
}
/* ブロックごとの昇格・降格・入れ替え戦の設定（旧・大会全体の promote/relegate も拾う） */
function promoConfig(b, cfg){
  const g = { up:num(cfg?.promote)||0, upPo:0, down:num(cfg?.relegate)||0, downPo:0 };
  if(!b) return g;
  const has = ["up","upPo","down","downPo"].some(k=> b[k]!=null && b[k]!=="");
  if(!has) return g;
  return { up:num(b.up)||0, upPo:num(b.upPo)||0, down:num(b.down)||0, downPo:num(b.downPo)||0 };
}
/* 順位 i（0始まり）が 自動昇格／昇格入替戦／降格入替戦／自動降格 のどれか */
const STAND_ZONES = {
  up:   { bg:"rgba(31,157,85,.17)",  mark:"▲", col:"var(--ok)",   label:"自動昇格" },
  upPo: { bg:"rgba(42,157,120,.15)", mark:"△", col:"#1c8f6a",     label:"昇格入れ替え戦" },
  downPo:{ bg:"rgba(224,147,12,.17)",mark:"▽", col:"#b8760a",     label:"降格入れ替え戦" },
  down: { bg:"rgba(214,69,61,.15)",  mark:"▼", col:"var(--bad)",  label:"自動降格" },
};
function standZone(i, n, pc){
  if(pc.up   && i < pc.up)                        return "up";
  if(pc.upPo && i < pc.up + pc.upPo)              return "upPo";
  if(pc.down && i >= n - pc.down)                 return "down";
  if(pc.downPo && i >= n - pc.down - pc.downPo)   return "downPo";
  return null;
}
function tabTable(){
  const cfg = cfgOf(state.t);
  const blocks = blocksOf(state.t);
  const one = blocks.length<=1;
  const isLK = state.t.format==="league_ko";
  const hasWC = isLK && wildcardsOf(state.t).length>0;
  const usedZones = new Set();
  let wcShown = false;
  const body = (blocks.length?blocks:[null]).map(b=>{
    const rows = standings(b?b.id:null);
    if(!rows.length) return "";
    const n = rows.length;
    const pc = promoConfig(b, cfg);
    const adv = (isLK && b) ? advanceOf(b.id) : (isLK ? Math.max(0,num(cfg.advance)) : 0);
    return `${(b && !one)?`<div class="block-label">${esc(b.name)}</div>`:""}
    <div class="tblwrap"><table>
      <thead><tr><th></th><th style="text-align:left">チーム</th><th>勝点</th><th>試合</th><th>勝</th><th>分</th><th>敗</th><th>得点</th><th>失点</th><th>得失差</th></tr></thead>
      <tbody>${rows.map((r,i)=>{
        const z = standZone(i, n, pc); if(z) usedZones.add(z);
        const zc = z ? STAND_ZONES[z] : null;
        const bg = zc ? `background:${zc.bg}` : "";
        const mark = zc ? `<span title="${zc.label}" style="color:${zc.col};font-weight:800"> ${zc.mark}</span>` : "";
        const wc = (hasWC && !(adv && i<adv)) ? wildcardHit(r.id) : 0;   // 進出枠外だがワイルドカードで勝ち上がり
        if(wc) wcShown = true;
        const wcMark = wc ? `<span title="ワイルドカードで勝ち上がり" style="color:var(--accent);font-weight:800"> ◎${wc}</span>` : "";
        const adjNote = r.adj ? `<small style="color:var(--accent)"> (${r.adj>0?"+":""}${r.adj})</small>` : "";
        return `<tr class="${(adv&&i<adv)||wc?"adv":""}" style="${bg}">
        <td class="rk">${i+1}</td><td class="nm">${esc(r.name)}${mark}${wcMark}</td>
        <td class="pt">${r.pts}${adjNote}</td><td>${r.pl}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td>
        <td>${r.gf}</td><td>${r.ga}</td><td>${r.gd>0?"+":""}${r.gd}</td>
      </tr>`;}).join("")}</tbody>
    </table></div>`
    + (canEdit() ? `<div class="btnrow noprint" style="margin:6px 0 14px">
        <button class="btn ghost sm" onclick="openRankOrderEditor(${b?`'${b.id}'`:"null"})">✏ ${(cfg.rankOrder||{})[b?b.id:null]?.length ? "手動で並べ替え中（変更する）":"順位を手動で並べ替える"}</button>
      </div>` : "");
  }).join("");
  const legend = ["up","upPo","downPo","down"].filter(z=>usedZones.has(z))
    .map(z=>`<span style="color:${STAND_ZONES[z].col};font-weight:700">${STAND_ZONES[z].mark} ${STAND_ZONES[z].label}</span>`).join("　");
  return body
  + `<p class="hint">勝ち${cfg.win}点／引き分け${cfg.draw}点／負け${cfg.lose}点。同点のときは 得失点差 → 総得点 → 直接対決 の順で並べます。${isLK?`色つきが決勝トーナメント進出。${esc(advanceSummary())}`:""}${wcShown?`<br>◎ はワイルドカード（各組の同順位どうしを${cfg.wcRule==="avg"?"1試合平均":"合計"}で比べた順）で勝ち上がるチームです。`:""}${legend?`<br>${legend}`:""}<br>( )は勝点の手動調整分です。</p>`
  + (canEdit()?`<div class="btnrow noprint"><button class="btn sec sm" onclick="go('settings')">⚙ リーグごとの昇格・降格・入れ替え戦を設定</button></div>`:"");
}

/* --- 順位の手動並べ替え（同順位時の運営判断・特別な事情での補正） --- */
function openRankOrderEditor(blockId){
  const cfg = cfgOf(state.t);
  const natural = standings(blockId).map(r=>r.id);   // 現在の計算順（手動指定が既にあればそれも反映された順）
  const existing = (cfg.rankOrder||{})[blockId];
  let order = (existing && existing.length) ? existing.slice() : natural.slice();
  natural.forEach(id=>{ if(!order.includes(id)) order.push(id); });   // 新しく加わったチームなどは末尾に足す
  order = order.filter(id=> natural.includes(id));                   // 大会から外れたチームは除く

  const el = document.createElement("div"); el.className="modal";
  const render2 = ()=>{
    $("#ro-list").innerHTML = order.map((id,i)=>{
      const nm = teamName(id);
      return `<div class="lurow">
        <span class="lunm">${i+1}. ${esc(nm)}</span>
        <button class="btn ghost sm" style="width:auto" ${i===0?"disabled":""} onclick="roMove(${i},-1)">▲</button>
        <button class="btn ghost sm" style="width:auto" ${i===order.length-1?"disabled":""} onclick="roMove(${i},1)">▼</button>
      </div>`;
    }).join("");
  };
  window.roMove = (i,dir)=>{
    const j = i+dir; if(j<0||j>=order.length) return;
    [order[i],order[j]] = [order[j],order[i]];
    render2();
  };
  el.innerHTML = `<div class="sheet">
    <h3>順位を手動で並べ替え</h3>
    <p class="hint" style="margin-bottom:8px">▲▼で順番を入れ替えられます。同じ勝点・得失点差のチームの最終判断（抽選など）や、特別な事情での補正に使ってください。通常はここを使わなくても、上の自動計算のままで構いません。</p>
    <div id="ro-list" style="max-height:50vh;overflow-y:auto"></div>
    <div class="btnrow" style="margin-top:10px">
      <button class="btn ghost" onclick="this.closest('.modal').remove()">やめる</button>
      <button class="btn" id="ro-ok">この順番で保存</button>
    </div>
    ${existing && existing.length ? `<button class="btn ghost sm" style="width:100%;margin-top:8px;color:var(--bad)" id="ro-clear">手動並べ替えをやめて自動計算に戻す</button>` : ""}
  </div>`;
  document.body.appendChild(el);
  render2();
  $("#ro-ok").onclick = async ()=>{ await saveRankOrder(blockId, order); el.remove(); };
  const clearBtn = $("#ro-clear");
  if(clearBtn) clearBtn.onclick = async ()=>{ await saveRankOrder(blockId, null); el.remove(); };
}
async function saveRankOrder(blockId, orderOrNull){
  const s = state.t.settings = cfgOf(state.t);
  s.rankOrder = Object.assign({}, s.rankOrder||{});
  if(orderOrNull) s.rankOrder[blockId] = orderOrNull; else delete s.rankOrder[blockId];
  try{
    const { id,org_id,name,sport,format,settings,created_at } = state.t;
    await DB.upsert("gn_tournaments", { id,org_id,name,sport,format,settings,created_at });
    toast("保存しました"); render();
  }catch(e){ toast("保存できませんでした: "+(e.message||e)); }
}

/* --- 戦績表（星取表） --- */
function tabMatrix(){
  const cfg = cfgOf(state.t);
  const blocks = blocksOf(state.t);
  const one = blocks.length<=1;
  return (blocks.length?blocks:[null]).map(b=>{
    const g = b ? b.id : null;
    const ts = state.teams.filter(t=>!g||t.grp===g).sort((a,b)=>a.sort_order-b.sort_order);
    if(ts.length<2) return "";
    const double = !!cfg.doubleRound;
    const cell = (a,b)=>{
      if(a.id===b.id) return `<td class="self">—</td>`;
      // ホーム&アウェイのときは同じ相手と2試合あるので、この枠＝「行のチームの試合」だけを表示する
      const m = double
        ? state.matches.find(x=> x.stage==="league" && x.home_team===a.id && x.away_team===b.id)
        : state.matches.find(x=> x.stage==="league" &&
            ((x.home_team===a.id&&x.away_team===b.id)||(x.home_team===b.id&&x.away_team===a.id)));
      if(!m || !isDone(m)) return `<td>-</td>`;
      const own  = m.home_team===a.id ? m.home_score : m.away_score;
      const opp  = m.home_team===a.id ? m.away_score : m.home_score;
      const cls  = own>opp ? "w" : own<opp ? "l" : "";
      return `<td class="${cls}">${own}-${opp}</td>`;
    };
    return `${(b && !one)?`<div class="block-label">${esc(b.name)} 戦績表</div>`:""}
    <div class="tblwrap"><table class="mtx">
      <thead><tr><th style="text-align:left">　</th>${ts.map((t,i)=>`<th>${i+1}</th>`).join("")}</tr></thead>
      <tbody>${ts.map((a,i)=>`<tr><td class="nm">${i+1}. ${esc(a.name)}</td>${ts.map(b=>cell(a,b)).join("")}</tr>`).join("")}</tbody>
    </table></div>
    ${double?`<p class="hint">ホーム&アウェイ：各マスは「行のチームがホームで戦った試合」の結果です。</p>`:""}`;
  }).join("") || `<div class="empty">チームが足りません。</div>`;
}

/* --- トーナメント表 --- */
function tabBracket(){
  const cfg = cfgOf(state.t);
  const bid = curBracketId();
  const ko  = koMatchesOf(bid);
  const edit = canEdit();
  const head = bracketSwitcher(bid, edit);
  if(!ko.length){
    let e = head + `<div class="empty">このトーナメントにはまだマッチがありません。</div>`;
    if(edit) e += koEditBar(cfg);
    return e;
  }
  const rounds = Math.max(...ko.map(m=>m.round));
  // 櫓メーカーと同じ描画（フィーダー中間配置＋SVG曲線）。作ったとおりに一般の方も見える。
  let html = head + `<div class="kobk" id="koBracket"><div class="kobk-canvas" id="koCanvas">
    <div class="kobk-svg"><svg id="koLinks" width="100%" height="100%"></svg></div>
    <div class="kobk-rounds">`;
  for(let r=1; r<=rounds; r++){
    const ms = ko.filter(m=>m.round===r).sort((a,b)=>a.slot-b.slot);
    const rn = koRoundLabel({round:r, slot:0, grp:bid});
    html += `<div class="kobk-round" data-r="${r}">
      <div class="kobk-rhead"><span class="kobk-rname"${edit?` onclick="renameKoRound(${r})" title="タップで回戦名を変える" style="cursor:pointer"`:""}>${esc(rn)}</span>${edit?`<button class="kobk-radd" title="この回戦にマッチを足す" onclick="bmAddMatch(${r})">＋マッチ</button>`:""}</div>
      <div class="kobk-rbody">`
      + (ms.length ? ms.map(m=>koMatchHTML(m,edit)).join("")
                   : `<div class="kobk-empty">—</div>`)
      + `</div></div>`;
  }
  html += `</div></div></div>`;
  html += `<div class="btnrow noprint" style="margin-bottom:10px">
    <button class="btn ghost sm" style="flex:1" onclick="printBracket()">🖨 トーナメント表をA4印刷</button></div>`;
  if(edit) html += koEditBar(cfg);
  const consolations = state.matches.filter(m=>m.slot===99 && bracketIdOf(m)===bid)
                                    .sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
  consolations.forEach(c=>{
    html += `<div class="block-label">${esc(koRoundLabel(c))}${edit?` <button class="kobk-radd" onclick="openKoEditor('${c.id}')">✎編集</button>`:""}</div>` + matchCard(c);
  });
  // 予選からの勝ち上がり枠が実際に入っている櫓にだけ、その説明を出す
  const hasQualSlot = koMatchesOf(bid, true).some(m=>
    ["home_src","away_src"].some(k=> m[k] && /^(G|B):/.test(m[k])));
  if(state.t.format==="league_ko" && hasQualSlot){
    html += `<p class="hint">${esc(advanceSummary())}予選リーグの順位が確定すると、枠のチーム名が自動で入ります。</p>`;
  }
  return html;
}

/* 予選からの勝ち上がりを1行で説明する（ブロックごとの数＋ワイルドカード） */
function advanceSummary(){
  const bs = blocksOf(state.t);
  if(!bs.length) return "";
  const parts = bs.filter(b=>advanceOf(b.id)>0).map(b=>`${b.name}${advanceOf(b.id)}位まで`);
  wildcardsOf(state.t).forEach(w=>
    parts.push(`各組${num(w.rank)}位のうち成績上位${num(w.count)}チーム`));
  return parts.length ? parts.join("・") + "が決勝トーナメントへ進みます。" : "";
}

/* --- トーナメントの切り替え（1位T・2位T…）と追加・名前変更・削除 --- */
function bracketSwitcher(bid, edit){
  const bs = bracketsOf(state.t);
  if(bs.length<=1 && !edit) return "";
  const tabs = bs.map(b=>{
    const n = koMatchesOf(b.id, true).length;
    return `<button class="${b.id===bid?"on":""}" onclick="setBracket('${b.id}')">${esc(b.name)}${n?`<span style="opacity:.6"> ${n}</span>`:""}</button>`;
  }).join("");
  let h = "";
  if(bs.length>1) h += `<div class="seg noprint" style="margin-bottom:8px;flex-wrap:wrap">${tabs}</div>`;
  else if(edit)   h += `<div class="block-label" style="margin-top:0">${esc(bs[0].name)}</div>`;
  if(edit){
    h += `<div class="btnrow noprint" style="margin-bottom:10px">
      <button class="btn ghost sm" onclick="addBracket()">＋ トーナメントを追加</button>
      <button class="btn ghost sm" onclick="renameBracket('${bid}')">名前を変える</button>
      ${bs.length>1?`<button class="btn ghost sm" onclick="removeBracket('${bid}')">このトーナメントを削除</button>`:""}
    </div>`;
  }
  return h;
}
async function saveTournamentSettings(){
  const { id,org_id,name,sport,format,settings,created_at } = state.t;
  await DB.upsert("gn_tournaments", { id,org_id,name,sport,format,settings,created_at });
}
async function addBracket(){
  const bs = bracketsOf(state.t).slice();
  const nm = prompt("トーナメントの名前", `${bs.length+1}位トーナメント`);
  if(nm==null) return;
  // 旧データ（brackets未設定）のときは、いまの櫓を main として残したうえで足す
  const nb = { id:uid(), name:(nm.trim() || `${bs.length+1}位トーナメント`) };
  const next = bs.concat([nb]);
  const skel = emptyBracketSkeleton(state.t.id, nb.id);
  skel.forEach(m=> m.org_id = state.user?.id || null);
  cfg_set("brackets", next);
  try{
    await saveTournamentSettings();
    await DB.upsert("gn_matches", skel.map(stripMatch));
  }catch(e){ return toast("保存できませんでした: "+(e.message||e)); }
  state.matches.push(...skel);
  state.bracket = nb.id;
  toast("トーナメントを追加しました"); render();
}
async function renameBracket(id){
  const bs = bracketsOf(state.t);
  const cur = bs.find(b=>b.id===id); if(!cur) return;
  const nm = prompt("トーナメントの名前", cur.name);
  if(nm==null || !nm.trim()) return;
  cfg_set("brackets", bs.map(b=> b.id===id ? {...b, name:nm.trim()} : b));
  try{ await saveTournamentSettings(); }catch(e){ return toast("保存できませんでした: "+(e.message||e)); }
  render();
}
async function removeBracket(id){
  const bs = bracketsOf(state.t);
  if(bs.length<=1) return toast("トーナメントは1つ以上必要です");
  const ms = koMatchesOf(id, true);
  if(!confirm(`「${bracketName(state.t,id)}」を削除します。\nこのトーナメントの${ms.length}試合の記録もすべて消えます。よろしいですか？`)) return;
  const next = bs.filter(b=>b.id!==id);
  cfg_set("brackets", next);
  state.matches = state.matches.filter(m=>!ms.some(x=>x.id===m.id));
  try{
    if(ms.length) await DB.remove("gn_matches", ms.map(m=>m.id));
    await saveTournamentSettings();
  }catch(e){ return toast("削除できませんでした: "+(e.message||e)); }
  state.bracket = next[0].id;
  toast("削除しました"); render();
}

/* 1マッチの櫓カード（シードは1チームのみ表示） */
function koMatchHTML(m, edit){
  const seed = isSeedMatch(m);
  const no = koMatchNo(m);
  const title = seed ? "シード" : `${esc(koRoundLabel(m))} ${no}`;
  const editBtn = edit ? `<button class="kobk-edit" title="枠の中身を編集" onclick="event.stopPropagation();openKoEditor('${m.id}')">✎</button>` : "";
  const pubBtn = (m.official && m.official.public)
    ? `<button class="kobk-edit" title="公式記録を見る" onclick="event.stopPropagation();goOfficialPublic('${m.id}')">📄</button>` : "";
  const body = seed ? koSeedSlot(m, isEmptySide(m,"H")?"A":"H")
                    : koSlot(m,"H") + koSlot(m,"A");
  const clk = edit ? ` onclick="openMatch('${m.id}')"` : "";
  return `<div class="kobk-m ${seed?"seed":""} ${edit?"clk":""}" id="komt-${m.id}" data-mid="${m.id}"${clk}>
    <div class="kobk-mt"><span class="no">${title}</span>${pubBtn}${editBtn}</div>${body}</div>`;
}
function koSlot(m, side){
  const r = resolveSlot(m, side);
  const w = winnerOf(m);
  const isWin = w && w===sideId(m,side);
  const cls = isWin ? "win" : r.kind==="team" ? "seed" : r.kind==="from" ? "from" : r.kind==="free" ? "seed" : "tbd";
  const sc = isDone(m) ? (side==="H"?m.home_score:m.away_score) : "";
  const hasPk = m.home_pk!=null && m.away_pk!=null;
  const pk = isDone(m) && hasPk ? `<small>(PK${side==="H"?m.home_pk:m.away_pk})</small>` : "";
  return `<div class="kobk-s ${cls}"><span class="dot"></span><span class="nm">${esc(r.label)}</span><span class="sc">${pk}${sc!==""?sc:""}</span></div>`;
}
function koSeedSlot(m, side){
  const r = resolveSlot(m, side);
  return `<div class="kobk-s seed"><span class="dot"></span><span class="nm">${esc(r.label)}</span><span class="kobk-seedtag">シード</span></div>`;
}
function koEditBar(cfg){
  let html = "";
  if(state.t.format==="ko"){
    html += `<button class="btn noprint" style="margin-bottom:6px" onclick="autoDrawKO()">✨ 登録チームで自動作成</button>
      <p class="hint noprint" style="margin:0 0 10px">登録チームで普通のトーナメント表を作ります（半端な人数はシードを自動で入れます）。あとは<b>枠の右上「✎」</b>で中身（チーム／勝者・敗者／自由文字）を1つずつ直せます。</p>`;
  }
  html += `<div class="btnrow noprint" style="margin-bottom:8px">
    <button class="btn sec sm" onclick="openR1Maker()">① 1回戦を組む</button>
    <button class="btn sec sm" onclick="openLaterMaker()">② 2回戦以降を組む</button></div>
  <div class="btnrow noprint" style="margin-bottom:12px">
    <button class="btn ghost sm" onclick="openSeedSheet()">組み合わせを変える</button>
    <button class="btn ghost sm" onclick="koAddRound()">＋ 回戦を足す</button>
    <button class="btn ghost sm" onclick="koAddConsolation()">＋ 順位決定戦</button></div>`;
  return html;
}

/* --- 櫓レイアウト：フィーダー（W:/L:参照元）の中心の平均に配置。重なりは下へ押し出す --- */
const KO_GAPY = 14;
function layoutBracket(){
  const canvas = document.getElementById("koCanvas"); if(!canvas) return;
  const rounds = [...canvas.querySelectorAll(".kobk-round")];
  const center = {};                              // matchId -> 縦中心(px)
  let globalBottom = 0;
  rounds.forEach(rd=>{
    const r = +rd.dataset.r;
    const ms = koMatchesOf().filter(m=>m.round===r).sort((a,b)=>a.slot-b.slot);
    let prevBottom = -Infinity;
    ms.forEach(m=>{
      const el = document.getElementById("komt-"+m.id); if(!el) return;
      const H = el.offsetHeight || 90;
      const feeders = [];
      ["home","away"].forEach(sd=>{ const s=m[sd+"_src"]; if(s&&/^(W|L):/.test(s)){ const c=center[s.slice(2)]; if(c!=null) feeders.push(c); } });
      let c = feeders.length ? feeders.reduce((a,b)=>a+b,0)/feeders.length
                             : (prevBottom>-Infinity ? prevBottom+KO_GAPY+H/2 : H/2);
      let top = c - H/2;
      if(top < prevBottom+KO_GAPY) top = prevBottom+KO_GAPY;   // 重なり回避（単調増加）
      el.style.top = top+"px";
      center[m.id] = top+H/2; prevBottom = top+H;
      if(prevBottom>globalBottom) globalBottom = prevBottom;
    });
  });
  canvas.querySelectorAll(".kobk-rbody").forEach(b=> b.style.height=(globalBottom+6)+"px");
}
/* --- SVG曲線：前の回戦の勝者/敗者を参照する枠へ線を引く（勝者=青 / 敗者=橙） --- */
function drawLinks(){
  const svg = document.getElementById("koLinks"); if(!svg) return;
  const canvas = document.getElementById("koCanvas"); if(!canvas) return;
  const cb = canvas.getBoundingClientRect();
  svg.setAttribute("width", cb.width); svg.setAttribute("height", cb.height);
  let paths = "";
  koMatchesOf().forEach(m=>{
    ["home","away"].forEach(sd=>{
      const src = m[sd+"_src"]; if(!src || !/^(W|L):/.test(src)) return;
      const from = document.getElementById("komt-"+src.slice(2)), to = document.getElementById("komt-"+m.id);
      if(!from || !to) return;
      const fb = from.getBoundingClientRect(), tb = to.getBoundingClientRect();
      const x1 = fb.right-cb.left, y1 = fb.top+fb.height/2-cb.top;
      const x2 = tb.left-cb.left, y2 = tb.top+(sd==="home"?tb.height*0.34:tb.height*0.72)-cb.top;
      const mxx = Math.round((x1+x2)/2);
      const col = src[0]==="L" ? "#c98a2e" : "#9fb0d6";
      // 直角のカギ線（横→縦→横）＝ふつうのトーナメント表の線
      paths += `<path d="M${x1},${Math.round(y1)} H${mxx} V${Math.round(y2)} H${x2}" fill="none" stroke="${col}" stroke-width="1.5" opacity=".85" shape-rendering="crispEdges"/>`;
    });
  });
  svg.innerHTML = paths;
}
/* 回戦名を自由に変える（本部のみ・overview.roundNamesに保存） */
async function renameKoRound(r){
  const bid = curBracketId();
  const cur = koRoundLabel({round:r, slot:0, grp:bid});
  const v = prompt(`${r}回戦の表示名（空欄で自動に戻す）`, cur);
  if(v==null) return;
  const s = state.t.settings = cfgOf(state.t);
  const rn = Object.assign({}, s.overview?.roundNames||{});
  const key = `${bid}:${r}`;
  if(v.trim()===""){ delete rn[key]; if(bid===KO_MAIN) delete rn[r]; } else rn[key] = v.trim();
  s.overview = Object.assign({}, s.overview||{}, {roundNames:rn});
  try{
    const { id,org_id,name,sport,format,settings,created_at } = state.t;
    await DB.upsert("gn_tournaments", { id,org_id,name,sport,format,settings,created_at });
  }catch(e){ toast("保存できませんでした: "+(e.message||e)); }
  render();
}
/* A4横1枚に収まるよう倍率を計算して印刷 */
function printBracket(){
  const bk = document.getElementById("koBracket"), cv = document.getElementById("koCanvas");
  if(!bk || !cv){ window.print(); return; }
  layoutBracket();
  const rounds = cv.querySelector(".kobk-rounds");
  const w = rounds.scrollWidth, h = rounds.scrollHeight;
  const PW = 720, PH = 1010;                        // A4縦 印刷可能領域の目安(px・余白8mm・少し余裕)
  const scale = Math.min(PW/w, PH/h, 1);
  bk.style.setProperty("--kw", w+"px");
  bk.style.setProperty("--kh", h+"px");
  bk.style.setProperty("--ks", scale);
  const done = ()=>{ document.body.classList.remove("pbk"); bk.style.removeProperty("--kw"); bk.style.removeProperty("--kh"); bk.style.removeProperty("--ks"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  document.body.classList.add("pbk");
  setTimeout(()=>window.print(), 60);
  setTimeout(done, 4000);                           // 保険（afterprintが来ない環境用）
}

/* --- 1回戦の組み合わせを手で決める --- */
function openSeedSheet(){
  const cfg = cfgOf(state.t);
  const r1 = koMatchesOf().filter(m=>m.round===1).sort((a,b)=>a.slot-b.slot);
  const opts = [{v:"", l:"（なし・不戦勝）"}];
  if(state.t.format==="league_ko"){
    opts.push(...qualifierOpts());
  }
  state.teams.slice().sort((a,b)=>a.sort_order-b.sort_order).forEach(t=> opts.push({v:t.id, l:t.name}));
  const sel = (m,side)=>{
    const cur = m[side+"_team"] || m[side+"_src"] || "";
    return `<select class="in" data-m="${m.id}" data-s="${side}">${opts.map(o=>
      `<option value="${esc(o.v)}" ${o.v===cur?"selected":""}>${esc(o.l)}</option>`).join("")}</select>`;
  };
  const el = document.createElement("div");
  el.className = "modal";
  el.innerHTML = `<div class="sheet">
    <h3>1回戦の組み合わせ</h3>
    <p class="hint" style="margin-bottom:8px">シードのチームは「なし（不戦勝）」と組ませると2回戦から登場します。</p>
    ${r1.map((m,i)=>`<div class="card" style="margin-bottom:8px">
      <div class="hint" style="margin:0 0 6px">第${i+1}試合</div>
      ${sel(m,"home")}<div style="height:6px"></div>${sel(m,"away")}
    </div>`).join("")}
    <div class="btnrow">
      <button class="btn ghost" onclick="this.closest('.modal').remove()">やめる</button>
      <button class="btn" id="seed-ok">この組み合わせにする</button>
    </div>
  </div>`;
  document.body.appendChild(el);
  $("#seed-ok").onclick = async ()=>{
    const touched = new Map();
    el.querySelectorAll("select[data-m]").forEach(s=>{
      const m = state.matches.find(x=>x.id===s.dataset.m); if(!m) return;
      assignSide(m, s.dataset.s, s.value || null);
      touched.set(m.id, m);
    });
    el.remove();
    try{
      await DB.upsert("gn_matches", [...touched.values()].map(stripMatch));
      toast("組み合わせを保存しました");
    }catch(e){ toast("保存できませんでした: "+(e.message||e)); }
    render();
  };
}

/* --- 得点ランキング --- */
function tabScorers(){
  const sw = blockSwitcher();
  const rows = scorerRanking(curBlockFilter());
  if(!rows.length) return sw + `<div class="empty">まだ得点の記録がありません。<br>試合を開いて得点者を入れると集計されます。</div>`;
  let rank = 0, prev = null;
  return sw + rows.map((r,i)=>{
    if(r.n!==prev){ rank = i+1; prev = r.n; }
    return `<div class="rank ${rank===1?"top":""}">
      <span class="no">${rank}</span>
      <span class="who"><b>${esc(r.name)}</b><small>${esc(r.team)}</small></span>
      <span class="ct">${r.n}<small>${esc(sportOf(state.t).unit)}</small></span>
    </div>`;
  }).join("");
}

/* --- アシストランキング --- */
function tabAssists(){
  const sw = blockSwitcher();
  const rows = assistRanking(curBlockFilter());
  if(!rows.length) return sw + `<div class="empty">まだアシストの記録がありません。<br>「得点を追加」でアシストを選ぶと集計されます。</div>`;
  let rank = 0, prev = null;
  return sw + rows.map((r,i)=>{
    if(r.n!==prev){ rank = i+1; prev = r.n; }
    return `<div class="rank ${rank===1?"top":""}">
      <span class="no">${rank}</span>
      <span class="who"><b>${esc(r.name)}</b><small>${esc(r.team)}</small></span>
      <span class="ct">${r.n}<small>アシスト</small></span>
    </div>`;
  }).join("");
}

/* --- 警告・退場 --- */
function tabCards(){
  const sw = blockSwitcher();
  const rows = cardRanking(curBlockFilter());
  const susp = computeSuspensions();
  const suspHTML = susp.length ? `
    <div class="block-label" style="margin-top:18px">出場停止（この大会の中で自動計算）</div>
    <div class="card">
      ${susp.map(s=>`<div style="padding:8px 0;border-bottom:1px solid var(--line)">
        <b>${esc(s.name)}</b> <span class="meta">${esc(s.team)}</span>
        <div class="hint" style="margin-top:2px">🟨${s.yellow||0}　🟥${s.red||0}${s.stillPending?`　・残り${s.stillPending}試合分`:""}</div>
        ${s.matches.length ? `<div class="hint" style="margin-top:2px">対象：${s.matches.map(m=>`${m.done?"✔":"⏳"} ${esc(m.label)}`).join("　")}</div>` : ""}
      </div>`).join("")}
    </div>
    <p class="hint">✔は消化済み（実際に出場していないかは運営でご確認ください）・⏳はこれから迎える試合です。</p>` : "";
  if(!rows.length) return sw + `<div class="empty">まだ警告・退場の記録がありません。</div>` + suspHTML;
  return sw + `<div class="tblwrap"><table>
    <thead><tr><th style="text-align:left">選手</th><th style="text-align:left">チーム</th><th>🟨</th><th>🟥</th></tr></thead>
    <tbody>${rows.map(r=>`<tr>
      <td class="nm">${esc(r.name)}</td><td class="nm">${esc(r.team)}</td>
      <td>${r.yellow||""}</td><td>${r.red||""}</td></tr>`).join("")}</tbody>
  </table></div>
  <p class="hint">累積警告の確認にお使いください。</p>` + suspHTML;
}

/* --- 出場記録（選手ごとの 試合数・出場時間・得点。保護者・一般も閲覧可） --- */
function tabAppearances(){
  const sw = blockSwitcher();
  const bf = curBlockFilter();
  const teamsOut = [];
  state.teams.filter(t=> !bf || t.grp===bf).forEach(t=>{
    const stat = new Map();  // 選手名 -> {no, pid, games, goals}
    const ensure = (name, no, pid)=>{
      let s = stat.get(name);
      if(!s){ s = { no:no??null, pid:pid??null, games:0, goals:0 }; stat.set(name, s); }
      if(no!=null && s.no==null) s.no = no;
      if(pid!=null && s.pid==null) s.pid = pid;
      return s;
    };
    state.matches.forEach(m=>{
      ["H","A"].forEach(side=>{
        if(resolveSlot(m, side).id !== t.id) return;
        const lu = m.lineups && m.lineups[side];
        if(lu) lu.players.forEach(p=>{
          if(p.role==="out" || !p.name) return;
          const s = ensure(p.name, p.no, p.pid);
          // 試合数＝実際にピッチに立った試合だけ数える。先発は必ず・途中出場は交代の記録があるときだけ（控えのままは数えない）
          const cameOn = p.role==="start" || (m.events||[]).some(e=> e.type==="sub" && e.team===side && e.playerId===p.pid);
          if(cameOn) s.games++;
        });
        (m.events||[]).filter(e=>e.team===side && (e.type==="goal"||e.type==="pk")).forEach(e=>{
          if(!e.playerId) return;
          const full = playerName(t.id, e.playerId);
          const no = (full.match(/^(\d+)\s/)||[])[1];
          const name = full.replace(/^\d+\s/,"");
          ensure(name, no?num(no):null, e.playerId).goals++;
        });
      });
    });
    if(stat.size) teamsOut.push({ team:t.name, teamId:t.id,
      players:[...stat.entries()].map(([name,s])=>({name,...s})).sort((a,b)=>(a.no??999)-(b.no??999)) });
  });
  if(!teamsOut.length) return sw + `<div class="empty">まだ出場の記録がありません。<br>試合ごとにメンバー表を作ると、ここに出場した試合数がまとまります。</div>`;
  return sw + teamsOut.map(r=>`<details class="team-acc">
    <summary class="pick"><span style="min-width:0"><span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.team)}</span>
      <span class="meta">${r.players.length}名</span></span><span class="chev">›</span></summary>
    <div class="tblwrap"><table>
      <thead><tr><th>番号</th><th style="text-align:left">選手</th><th>試合</th><th>時間</th><th>得点</th></tr></thead>
      <tbody>${r.players.map(p=>{
        const manual = playTimeOf(r.teamId,p.name);
        const auto = p.pid!=null ? autoPlayMinutes(r.teamId, p.pid) : 0;
        const shown = manual || (auto ? String(auto) : "");
        return `<tr>
        <td>${p.no??""}</td><td class="nm">${esc(p.name)}</td>
        <td class="pt">${p.games||""}</td>
        <td>${canEdit()
          ? `<input class="in" style="padding:5px;width:58px;text-align:center" value="${esc(shown)}" placeholder="分" onchange="setPlayTime('${r.teamId}','${esc(p.name).replace(/'/g,"\\'")}',this.value)">`
          : esc(shown)}</td>
        <td>${p.goals||""}</td>
      </tr>`;}).join("")}</tbody>
    </table></div>
  </details>`).join("")
    + `<p class="hint">チーム名をタップすると出場記録が開きます。各試合のメンバー表（スタメン／控え）と得点から集計しています。<b>時間</b>は選手交代の記録から自動計算します（アディショナルタイムは含めません）。手で書き換えるとその数字が優先されます。</p>`;
}
/* 出場時間。書き換えていれば settings.playtime（チームid/選手名）の手入力を優先、無ければ自動計算値を使う */
function playTimeOf(teamId, name){
  const pt = (state.t && state.t.settings && state.t.settings.playtime) || {};
  return pt[teamId+"/"+name] || "";
}
async function setPlayTime(teamId, name, v){
  const s = state.t.settings = state.t.settings || {};
  s.playtime = s.playtime || {};
  const key = teamId+"/"+name;
  if(String(v).trim()==="") delete s.playtime[key]; else s.playtime[key] = String(v).trim();
  try{
    const { id,org_id,name:tn,sport,format,settings,created_at } = state.t;
    await DB.upsert("gn_tournaments", { id,org_id,name:tn,sport,format,settings,created_at });
  }catch(e){ console.error(e); }
}

/* --- チーム・選手 --- */
function tabTeam(){
  const ts = state.teams.slice().sort((a,b)=>
    (a.grp||"").localeCompare(b.grp||"") || a.sort_order-b.sort_order);
  return (canEdit() ? `<div class="btnrow" style="margin-bottom:12px">
      <button class="btn sec" style="flex:1" onclick="go('teams')">チーム・選手を編集する</button>
      <button class="btn ghost" style="flex:1" onclick="openEntryLinks()">📨 記入リンクを配る</button>
    </div>` : "")
  + (ts.length ? ts.map(t=>`<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <b style="font-size:15px">${esc(t.name)}</b>
        ${t.grp?`<span class="chip on">${esc(blockName(state.t,t.grp)||t.grp)}</span>`:""}
      </div>
      ${(t.players||[]).length
        ? `<div class="chiprow">${t.players.map(p=>
            `<span class="chip">${p.no?esc(String(p.no))+" ":""}${esc(p.name)}${p.grade?` <small>${esc(String(p.grade))}年</small>`:""}${p.pos?` <small>${esc(p.pos)}</small>`:""}</span>`).join("")}</div>`
        : `<div class="hint">選手が未登録です。</div>`}
    </div>`).join("")
    : `<div class="empty">チームがありません。</div>`);
}

/* ---------- 試合入力 ---------- */
function viewMatch(){
  const m = state.matches.find(x=>x.id===state.matchId);
  if(!m) return topbar({title:"試合", back:"go('t')"}) + `<div class="empty">見つかりません。</div>`;
  const sp = sportOf(state.t);
  const H = resolveSlot(m,"H"), A = resolveSlot(m,"A");
  const locked = isDone(m) && state.unlockMatch !== m.id;   // 終了した試合は変更ロック（修正ボタンで解除）
  const label = (m.matchNo?`No.${m.matchNo}・`:"") + (m.stage==="league" ? ((blockName(state.t,m.grp)||"リーグ戦")+" リーグ") : koRoundLabel(m));
  const kickoffLocal = m.kickoff ? new Date(new Date(m.kickoff).getTime()
      - new Date().getTimezoneOffset()*60000).toISOString().slice(0,16) : "";

  const periods = PERIOD_REG.concat(matchETPlayed(m)?PERIOD_ET:[]);
  const evList = (m.events||[]).map((ev,i)=>{
    const tid = ev.team==="H" ? H.id : A.id;
    const tn  = ev.team==="H" ? H.label : A.label;
    const per = ev.period ? esc(PERIODS[ev.period]||"") : "";
    const mi  = `${per}${ev.minute!=null?" "+esc(minuteText(ev.minute,ev.period,m))+"'":""}`;
    let ic, tx;
    if(ev.type==="sub"){
      ic = "🔄";
      const inN  = ev.playerId ? playerName(tid, ev.playerId) : "—";
      const outN = ev.outId    ? playerName(tid, ev.outId)    : "—";
      tx = `<b style="color:var(--ok)">IN</b> ${esc(inN)} ／ <b style="color:var(--bad)">OUT</b> ${esc(outN)} <small style="color:var(--sub)">${esc(tn)}</small>`;
    }else{
      ic = ev.type==="goal" ? "⚽" : ev.type==="pk" ? "🅿️" : ev.type==="og" ? "🔁" : CARD_ICON[ev.type]||"・";
      const nm = ev.playerId ? playerName(tid, ev.playerId) : "（選手なし）";
      const rc = ev.reasonCode ? ` <small style="color:var(--sub)">[${esc(ev.reasonCode)}]</small>` : "";
      tx = `${esc(nm)}${rc} <small style="color:var(--sub)">${esc(tn)}</small>`;
    }
    return `<div class="evrow">
      <button class="evmain" onclick="editEvent(${i})">
        <span class="ic">${ic}</span>
        <span class="tx">${tx}</span>
        <span class="mi">${mi}</span>
      </button>
      <button class="del" onclick="delEvent(${i})">削除</button>
    </div>`;
  }).join("") || `<div class="hint" style="padding:8px 2px">まだ記録がありません。</div>`;

  return `<div class="tourwrap">`
  + topbar({ title:"結果を入れる", sub:`🏆 ${state.t.name} ・ ${label}`, back:"go('t')",
      act: canEdit() ? `<button class="btn ghost sm" onclick="openMatchHistory()">🕘 履歴</button>` : "" })
  + `<div class="twrap">${tournamentSidebar("schedule")}<div class="tmain">
    <div class="screen">
    ${venueDatalistHTML()}
    ${locked?`<div class="lockmsg">🔒 この試合は「終了」です。内容は変更できません。直すときは下の「✏ 修正する」を押してください。</div>`:""}
    <fieldset class="ovlock"${locked?" disabled":""}>
    <div class="scorebox">
      <div class="scoreline">
        <div class="team">
          <div class="tn">${esc(H.label)}</div>
          <div class="stepper">
            <button onclick="bump('home',-1)">−</button>
            <span class="v">${m.home_score??0}</span>
            <button onclick="bump('home',1)">＋</button>
          </div>
        </div>
        <div class="vs">－</div>
        <div class="team">
          <div class="tn">${esc(A.label)}</div>
          <div class="stepper">
            <button onclick="bump('away',-1)">−</button>
            <span class="v">${m.away_score??0}</span>
            <button onclick="bump('away',1)">＋</button>
          </div>
        </div>
      </div>
      <div class="btnrow noprint" style="margin-top:10px">
        <button class="btn sec sm" style="width:auto;margin:0 auto" onclick="saveMatch(true)">💾 ここまでを保存（この画面のまま）</button>
      </div>
      <p class="hint" style="text-align:center;margin-top:2px">得点の＋－は画面には反映されますが、この保存を押すまでほかの人には伝わりません。</p>
      <div class="seg" style="margin-top:14px">
        ${[["todo","未実施"],["live","試合中"],["done","🏁 終了"],["postponed","延期"],["cancelled","中止"]].map(([k,l])=>
          `<button class="${m.status===k?"on":""}" onclick="${k==="done"?"setMatchDone()":`setStatus('${k}')`}">${esc(l)}</button>`).join("")}
      </div>
      ${m.status==="done" ? `
      <div style="margin-top:10px">
        <label class="f">決着の種類（任意・通常の試合なら選ばなくてOK）</label>
        <select class="in" onchange="setField('result_type',this.value||null)">
          <option value="" ${!m.result_type?"selected":""}>通常</option>
          <option value="walkover_home" ${m.result_type==="walkover_home"?"selected":""}>不戦勝：${esc(H.label)}</option>
          <option value="walkover_away" ${m.result_type==="walkover_away"?"selected":""}>不戦勝：${esc(A.label)}</option>
          <option value="forfeit_home" ${m.result_type==="forfeit_home"?"selected":""}>没収試合：${esc(H.label)}の勝ち</option>
          <option value="forfeit_away" ${m.result_type==="forfeit_away"?"selected":""}>没収試合：${esc(A.label)}の勝ち</option>
          <option value="awarded" ${m.result_type==="awarded"?"selected":""}>運営判断による認定スコア</option>
        </select>
        ${m.result_type ? `<input class="in" style="margin-top:8px" value="${esc(m.result_note||"")}" oninput="setField('result_note',this.value||null)" placeholder="理由・メモ（任意）">` : ""}
        <p class="hint">上のスコア欄に、大会の規定に沿った点数（不戦勝の既定点など）をあわせて入れてください。順位表・戦績表はこのスコアでそのまま計算されます。</p>
      </div>` : ""}
      ${(m.status==="postponed"||m.status==="cancelled") ? `
      <div style="margin-top:10px">
        <input class="in" value="${esc(m.result_note||"")}" oninput="setField('result_note',this.value||null)" placeholder="理由・メモ（任意・例：雨天のため／会場都合のため）">
      </div>` : ""}
      ${sp.scorers ? `
        <div style="margin-top:14px;border-top:1px solid var(--line);padding-top:10px">
          <div style="display:grid;grid-template-columns:1fr auto auto;gap:5px 16px;align-items:center;max-width:280px;margin:0 auto">
            <span></span>
            <span style="text-align:center;color:var(--sub);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:90px">${esc(H.label)}</span>
            <span style="text-align:center;color:var(--sub);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:90px">${esc(A.label)}</span>
            ${periods.map(p=>`<span style="color:var(--sub);font-size:12px">${esc(PERIODS[p])}</span>
              <span style="text-align:center;font-weight:700">${periodScore(m,p,"H")}</span>
              <span style="text-align:center;font-weight:700">${periodScore(m,p,"A")}</span>`).join("")}
          </div>
          ${(()=>{ const kt=(m.official&&m.official.kickoffTeam)||null; return `
          <div style="text-align:center;margin-top:12px">
            <span class="hint" style="display:block;margin-bottom:6px">キックオフ（コイントスで決めたチーム）</span>
            <div class="seg" style="max-width:280px;margin:0 auto">
              <button class="${kt==="H"?"on":""}" onclick="setKickoffTeam('H')">${esc(H.label)}</button>
              <button class="${kt==="A"?"on":""}" onclick="setKickoffTeam('A')">${esc(A.label)}</button>
            </div>
          </div>`; })()}
          <div style="text-align:center;margin-top:12px">
            ${matchETPlayed(m)
              ? `<button class="btn ghost sm" style="width:auto" onclick="toggleET(false)">延長をやめる</button>`
              : `<button class="btn ghost sm" style="width:auto" onclick="toggleET(true)">＋ 延長を追加</button>`}
          </div>
          <p class="hint" style="text-align:center;margin-top:4px">前後半の点は「得点を追加」で時間帯を選ぶと自動でここに入ります。</p>
        </div>` : ""}
      ${sp.pk && m.stage==="ko" ? `
        <div style="text-align:center;margin-top:16px">
          ${matchPKPlayed(m)
            ? `<button class="btn ghost sm" style="width:auto" onclick="toggleUsePK(false)">PK戦をやめる</button>`
            : `<button class="btn ghost sm" style="width:auto" onclick="toggleUsePK(true)">＋ PK戦を追加</button>`}
        </div>
        ${matchPKPlayed(m) ? `
        <label class="f" style="margin-top:10px">PK戦（1人ずつ 〇×）</label>
        ${pkRowHTML(m,"H",H.label)}
        ${pkRowHTML(m,"A",A.label)}
        <p class="hint">枠をタップで <b>〇（成功）→ ×（失敗）→ 空</b> に変わります。〇の数が公式記録のPK欄に入ります。</p>` : ""}` : ""}
    </div>

    ${sp.scorers ? `<div class="card">
      <label class="f">得点・選手交代・警告</label>
      <div class="btnrow">
        <button class="btn sec" style="flex:1" onclick="openEventSheet('goal')">⚽ 得点</button>
        ${sp.cards?`<button class="btn sec" style="flex:1" onclick="openEventSheet('card')">🟨 警告・退場</button>`:""}
      </div>
      <div class="btnrow">
        <button class="btn sec" style="flex:1" onclick="openSubSheet()">🔄 選手交代</button>
      </div>
      ${evList}
    </div>` : ""}

    <div class="card">
      <label class="f">キックオフ・会場</label>
      <input class="in" type="datetime-local" value="${esc(kickoffLocal)}" oninput="setKickoff(this.value)">
      <input class="in" list="venueList" style="margin-top:8px" value="${esc(m.venue||"")}" oninput="setField('venue',this.value)" placeholder="会場（例：第1グラウンド）">
      <label class="f">メモ（保護者・観覧者にも表示されます）</label>
      <input class="in" value="${esc(m.note||"")}" oninput="setField('note',this.value)" placeholder="例）雷のため30分遅延中／雨天のため時間短縮">
      <p class="hint">試合の連絡に。保存すると、結果を見ている人の画面にも 📣 で出ます。</p>
    </div>

    ${(()=>{ const of=m.official||{}; const meta=(m.lineups&&m.lineups._meta)||{}; const ov=cfgOf(state.t).overview||{}; return `<details class="card ofcard">
      <summary>📋 公式記録の詳細（審判・天候など・あとからでもOK）</summary>
      <label class="f">試合形式</label>
      <input class="in" value="${esc(of.format||"")}" oninput="setOfficialField('format',this.value)" placeholder="例）40分ハーフ / 予選リーグ">
      <label class="f">この試合だけ時間が違う場合（決勝だけ40分など・空なら大会の設定${ov.halfMin?"（"+ov.halfMin+"分ハーフ）":""}のまま）</label>
      <div class="row2">
        <div><input class="in" type="number" inputmode="numeric" placeholder="前後半 例）40" value="${meta.halfMin??""}" oninput="setMatchHalfMin('halfMin',this.value)"></div>
        <div><input class="in" type="number" inputmode="numeric" placeholder="延長 例）10" value="${meta.etHalfMin??""}" oninput="setMatchHalfMin('etHalfMin',this.value)"></div>
      </div>
      <div class="row2">
        <div><label class="f">主審</label><input class="in" value="${esc(of.referee||"")}" oninput="setOfficialField('referee',this.value)"></div>
        <div><label class="f">第4審判</label><input class="in" value="${esc(of.fourth||"")}" oninput="setOfficialField('fourth',this.value)"></div>
      </div>
      <div class="row2">
        <div><label class="f">副審1</label><input class="in" value="${esc(of.ar1||"")}" oninput="setOfficialField('ar1',this.value)"></div>
        <div><label class="f">副審2</label><input class="in" value="${esc(of.ar2||"")}" oninput="setOfficialField('ar2',this.value)"></div>
      </div>
      <div class="row2">
        <div><label class="f">運営責任者</label><input class="in" value="${esc(of.admin||"")}" oninput="setOfficialField('admin',this.value)"></div>
        <div><label class="f">記録担当</label><input class="in" value="${esc(of.recorder||"")}" oninput="setOfficialField('recorder',this.value)"></div>
      </div>
      <div class="row2">
        <div><label class="f">天候</label><input class="in" value="${esc(of.weather||"")}" oninput="setOfficialField('weather',this.value)"></div>
        <div><label class="f">気温</label><input class="in" value="${esc(of.temp||"")}" oninput="setOfficialField('temp',this.value)"></div>
      </div>
      <div class="row2">
        <div><label class="f">湿度</label><input class="in" value="${esc(of.humid||"")}" oninput="setOfficialField('humid',this.value)"></div>
        <div><label class="f">風</label><input class="in" value="${esc(of.wind||"")}" oninput="setOfficialField('wind',this.value)"></div>
      </div>
      <div class="row2">
        <div><label class="f">観客数</label><input class="in" value="${esc(of.crowd||"")}" oninput="setOfficialField('crowd',this.value)"></div>
        <div><label class="f">ピッチ(芝)</label><input class="in" value="${esc(of.pitch||"")}" oninput="setOfficialField('pitch',this.value)"></div>
      </div>
      <p class="hint">ここで入れた内容は公式記録の上部にそのまま入ります。日時・会場・得点・メンバーは下と自動で連動します。</p>
    </details>`; })()}

    </fieldset>
    ${locked
      ? `<button class="btn" onclick="unlockMatch('${m.id}')">✏ 修正する</button>`
      : `<button class="btn" onclick="saveMatch()">保存する</button>`}
    <div class="btnrow">
      <button class="btn sec sm" style="flex:1" onclick="saveMatch(true).then(()=>openLineup('${m.id}'))">👥 メンバー表</button>
      <button class="btn sec sm" style="flex:1" onclick="saveMatch(true).then(()=>openOfficial('${m.id}'))">📄 公式記録</button>
    </div>
    <div class="btnrow"><button class="btn ghost" onclick="go('t')">${locked?"戻る":"保存せずに戻る"}</button></div>
    </div>
  </div></div></div>`;
}
/* 「試合を終了する」は取り消しにくい操作なので確認する（誤タップ防止） */
async function setMatchDone(){
  const m = curMatch(); if(!m) return;
  if(m.status==="done") return;
  if(!confirm("この試合を「終了」にします。以降は内容を変更できなくなります（後から「修正する」で直せます）。よろしいですか？")) return;
  await setStatus('done');
}
/* 試合の状態（未実施/試合中/終了）はボタンを押した瞬間に保存する＝他の端末にもすぐ「0-0・試合中」等が伝わる
   （得点の＋－のような細かい操作と違い、状態の切り替えは頻度が低い意図的な操作なので毎回保存して問題ない） */
async function setStatus(k){
  const m = curMatch(); if(!m) return;
  m.status = k; render();
  await saveMatch(true);
}

function curMatch(){ return state.matches.find(x=>x.id===state.matchId); }
function bump(side, d){
  const m = curMatch(); if(!m) return;
  const k = side==="home" ? "home_score" : "away_score";
  m[k] = Math.max(0, (m[k]??0) + d);
  if(m.status==="todo") m.status = "live";
  render();
}
function setField(k,v){
  const m = curMatch(); if(!m) return;
  m[k] = v;
  if(k==="status") render();
}
/* 結果入力画面から公式記録のヘッダー項目（審判・天候など）を直接入れる */
function ensureMatchOfficial(m){ if(!m.official) m.official = draftOfficial(m); return m.official; }
function setOfficialField(path, v){ const m = curMatch(); if(!m) return; pset(ensureMatchOfficial(m), path, v); }
/* キックオフ＝コイントスで決めたチーム。もう一度押すと解除（結果を入れる画面から決める。公式記録は表示だけ） */
function setKickoffTeam(v){
  const m = curMatch(); if(!m) return;
  const of = ensureMatchOfficial(m);
  of.kickoffTeam = of.kickoffTeam===v ? null : v;
  render();
}
function setKickoff(v){
  const m = curMatch(); if(!m) return;
  m.kickoff = v ? new Date(v).toISOString() : null;
}
/* 記録の行をタップ → 種類に応じた編集シートを開く（得点者を空欄にする、時間を直すなどいろいろ変更できる） */
function editEvent(i){
  const m = curMatch(); if(!m) return;
  const ev = (m.events||[])[i]; if(!ev) return;
  if(ev.type==="sub") openSubSheet(i);
  else openEventSheet((ev.type==="goal"||ev.type==="pk"||ev.type==="og") ? "goal" : "card", i);
}
function delEvent(i){
  const m = curMatch(); if(!m) return;
  const ev = (m.events||[])[i];
  // 得点イベントを消すときは合計点も1つ戻す（前後半スコアと合計をそろえる）
  if(ev && (ev.type==="goal"||ev.type==="pk"||ev.type==="og")){
    const scoringSide = ev.type==="og" ? (ev.team==="H"?"away":"home") : (ev.team==="H"?"home":"away");
    m[scoringSide+"_score"] = Math.max(0, (m[scoringSide+"_score"]??0) - 1);
  }
  m.events = (m.events||[]).filter((_,j)=>j!==i);
  render();
}
/* 延長を使う／やめる */
function toggleET(on){
  const m = curMatch(); if(!m) return;
  if(!on && (m.events||[]).some(e=>e.period==="1ET"||e.period==="2ET"))
    return toast("延長の記録が入っています。先に消してください");
  setMatchET(m, on); render();
}

/* 警告・退場コード表（参考用に「カードを追加」シートの下に表示） */
function cardReasonLegendHTML(){
  const block = (title, list) => `<div style="margin-top:6px">
    <b style="font-size:12.5px">${esc(title)}</b>
    ${list.map(r=>`<div style="font-size:12px;color:var(--sub);margin-top:2px">
      <b style="color:var(--ink)">${r.code}</b> ${esc(r.label)}${r.note?`<br><span style="font-size:11px">${esc(r.note)}</span>`:""}
    </div>`).join("")}
  </div>`;
  return `<div class="hint" style="margin-top:14px;padding-top:10px;border-top:1px solid var(--line)">
    <b style="font-size:12.5px;color:var(--ink)">警告・退場コード表（参考）</b>
    ${block("警告（イエローカード）", CARD_REASONS.yellow)}
    ${block("退場（レッドカード）", CARD_REASONS.red)}
  </div>`;
}
/* --- 得点者・カードの追加／編集シート --- */
function openEventSheet(kind, editIdx){
  const m = curMatch(); if(!m) return;
  const editing = editIdx!=null;
  const orig = editing ? m.events[editIdx] : null;
  const H = resolveSlot(m,"H"), A = resolveSlot(m,"A");
  const sp = sportOf(state.t);
  const types = kind==="goal"
    ? [["goal","得点"],["pk","PK"],["og","オウンゴール"]]
    : [["yellow","🟨 警告"],["red","🟥 退場"]];
  const periods = PERIOD_REG.concat(matchETPlayed(m)?PERIOD_ET:[]);
  const hasAssist = kind==="goal";   // アシストは得点者と同じように毎回選べる（大会設定でのON/OFFは廃止）
  const hasReason = kind==="card";
  let team = editing ? orig.team : "H";
  let type = editing ? orig.type : types[0][0];
  let period = editing ? (orig.period || periods[0]) : periods[0];
  let reasonCode = editing ? (orig.reasonCode || "") : "";
  const el = document.createElement("div");
  el.className = "modal";
  el.innerHTML = `<div class="sheet">
    <h3>${editing ? (kind==="goal"?"得点を編集":"カードを編集") : (kind==="goal"?"得点を追加":"カードを追加")}</h3>
    <label class="f">どちらのチーム</label>
    <div class="seg" id="ev-team">
      <button class="${team==="H"?"on":""}" data-v="H">${esc(H.label)}</button>
      <button class="${team==="A"?"on":""}" data-v="A">${esc(A.label)}</button>
    </div>
    <label class="f">選手（この試合の出場選手から選べます・見つからなければ空欄でもOK）</label>
    <select class="in" id="ev-player"></select>
    ${hasAssist ? `<div id="ev-assist-wrap">
      <label class="f">アシスト（あれば選ぶ・任意）</label>
      <select class="in" id="ev-assist"></select>
    </div>` : ""}
    <label class="f">種類</label>
    <div class="seg" id="ev-type">
      ${types.map(t=>`<button class="${t[0]===type?"on":""}" data-v="${t[0]}">${esc(t[1])}</button>`).join("")}
    </div>
    <label class="f">時間帯</label>
    <div class="seg" id="ev-period">
      ${periods.map(p=>`<button class="${p===period?"on":""}" data-v="${p}">${esc(PERIODS[p])}</button>`).join("")}
    </div>
    <label class="f">分（こまかい時間・入れなくてOK）</label>
    <input class="in" id="ev-min" type="number" inputmode="numeric" placeholder="例）23" value="${editing&&orig.minute!=null?orig.minute:""}">
    ${hasReason ? `
    <label class="f">理由（コードを選ぶと下の欄に自動で入ります・任意）</label>
    <select class="in" id="ev-reason-code"></select>
    <input class="in" id="ev-reason-text" style="margin-top:6px" placeholder="理由（自由に書き換えできます）" value="${editing&&orig.reason?esc(orig.reason):""}">
    ` : ""}
    <div class="btnrow">
      ${editing?`<button class="btn danger" onclick="this.closest('.modal').remove();delEvent(${editIdx})">削除</button>`:""}
      <button class="btn ghost" onclick="this.closest('.modal').remove()">やめる</button>
      <button class="btn" id="ev-ok">${editing?"保存":"追加"}</button>
    </div>
    ${hasReason ? cardReasonLegendHTML() : ""}
  </div>`;
  document.body.appendChild(el);

  const fillPlayers = (applyOrig)=>{
    const ps = participantsOf(m, team);
    $("#ev-player").innerHTML = ps.length
      ? `<option value="">（選手を選ぶ・空欄でもOK）</option>` + ps.map(p=>
          `<option value="${p.id}">${p.no?esc(String(p.no))+" ":""}${esc(p.name)}</option>`).join("")
      : `<option value="">出場選手が未登録です</option>`;
    if(editing && applyOrig) $("#ev-player").value = orig.playerId || "";
    if(hasAssist) fillAssist(applyOrig);
  };
  const fillAssist = (applyOrig)=>{
    const box = $("#ev-assist"); if(!box) return;
    const scorer = $("#ev-player").value;
    const ps = participantsOf(m, team).filter(p=> p.id!==scorer);   // 得点者本人は除く
    box.innerHTML = `<option value="">（なし）</option>` + ps.map(p=>
      `<option value="${p.id}">${p.no?esc(String(p.no))+" ":""}${esc(p.name)}</option>`).join("");
    if(editing && applyOrig) box.value = orig.assistId || "";
  };
  const syncAssistVisibility = ()=>{
    const wrap = $("#ev-assist-wrap"); if(!wrap) return;
    wrap.style.display = type==="goal" ? "" : "none";   // PK・オウンゴールにはアシストなし
  };
  const fillReasons = (applyOrig)=>{
    const box = $("#ev-reason-code"); if(!box) return;
    const list = CARD_REASONS[type] || [];
    box.innerHTML = `<option value="">（コードを選ばない・自由に書く）</option>` + list.map(r=>
      `<option value="${r.code}">${r.code}　${esc(r.label)}</option>`).join("");
    box.value = (applyOrig && editing) ? (orig.reasonCode || "") : "";
  };
  fillPlayers(true);
  if(hasAssist){ syncAssistVisibility(); $("#ev-player").onchange = ()=>fillAssist(false); }
  if(hasReason){
    fillReasons(true);
    $("#ev-reason-code").onchange = ()=>{
      reasonCode = $("#ev-reason-code").value;
      const found = (CARD_REASONS[type]||[]).find(r=>r.code===reasonCode);
      if(found) $("#ev-reason-text").value = found.label;
    };
  }
  el.querySelectorAll("#ev-team button").forEach(b=> b.onclick = ()=>{
    el.querySelectorAll("#ev-team button").forEach(x=>x.classList.remove("on"));
    b.classList.add("on"); team = b.dataset.v; fillPlayers(false);
  });
  el.querySelectorAll("#ev-type button").forEach(b=> b.onclick = ()=>{
    el.querySelectorAll("#ev-type button").forEach(x=>x.classList.remove("on"));
    b.classList.add("on"); type = b.dataset.v;
    if(hasAssist) syncAssistVisibility();
    if(hasReason){ reasonCode=""; $("#ev-reason-text").value=""; fillReasons(false); }
  });
  el.querySelectorAll("#ev-period button").forEach(b=> b.onclick = ()=>{
    el.querySelectorAll("#ev-period button").forEach(x=>x.classList.remove("on"));
    b.classList.add("on"); period = b.dataset.v;
  });
  $("#ev-ok").onclick = ()=>{
    const pid = $("#ev-player").value || null;
    const assistId = (hasAssist && type==="goal") ? ($("#ev-assist").value || null) : null;
    const minute = $("#ev-min").value ? num($("#ev-min").value) : null;
    const reason = hasReason ? ($("#ev-reason-text").value.trim() || null) : null;
    const rCode = hasReason ? (reasonCode || null) : null;
    m.events = m.events || [];
    const isScoring = t => t==="goal"||t==="pk"||t==="og";
    if(editing){
      if(isScoring(orig.type)){   // 元の得点ぶんを一旦戻す
        const oldSide = scoringSideOf(orig)==="H" ? "home" : "away";
        m[oldSide+"_score"] = Math.max(0, (m[oldSide+"_score"]??0) - 1);
      }
      m.events[editIdx] = { type, team, playerId:pid, assistId, minute, period, reasonCode:rCode, reason };
      if(isScoring(type)){
        m.home_score = m.home_score ?? 0; m.away_score = m.away_score ?? 0;
        const newSide = scoringSideOf({type,team})==="H" ? "home" : "away";
        m[newSide+"_score"]++;
      }
    } else {
      m.events.push({ type, team, playerId:pid, assistId, minute, period, reasonCode:rCode, reason });
      if(isScoring(type)){
        m.home_score = m.home_score ?? 0; m.away_score = m.away_score ?? 0;
        const newSide = scoringSideOf({type,team})==="H" ? "home" : "away";
        m[newSide+"_score"]++;
        if(m.status==="todo") m.status = "live";
      }
    }
    sortEvents(m);
    el.remove(); render();
  };
}
/* イベントを 時間帯→分 の順に並べる */
function sortEvents(m){
  const pIdx = p => ["1H","HT","2H","1ET","2ET"].indexOf(p||"1H");
  (m.events||[]).sort((a,b)=> pIdx(a.period)-pIdx(b.period) || (a.minute??999)-(b.minute??999));
}
/* --- 選手交代の追加シート --- */
function openSubSheet(editIdx){
  const m = curMatch(); if(!m) return;
  const editing = editIdx!=null;
  const orig = editing ? m.events[editIdx] : null;
  const H = resolveSlot(m,"H"), A = resolveSlot(m,"A");
  const periods = PERIOD_REG.concat(matchETPlayed(m)?PERIOD_ET:[]);
  let team = editing ? orig.team : "H";
  let period = editing ? (orig.period || periods[0]) : periods[0];
  const el = document.createElement("div");
  el.className = "modal";
  el.innerHTML = `<div class="sheet">
    <h3>選手交代を${editing?"編集":"追加"}</h3>
    <label class="f">どちらのチーム</label>
    <div class="seg" id="sub-team">
      <button class="${team==="H"?"on":""}" data-v="H">${esc(H.label)}</button>
      <button class="${team==="A"?"on":""}" data-v="A">${esc(A.label)}</button>
    </div>
    <label class="f">OUT（下がる選手）</label>
    <select class="in" id="sub-out"></select>
    <label class="f">IN（入る選手）</label>
    <select class="in" id="sub-in"></select>
    <label class="f">時間帯</label>
    <div class="seg" id="sub-period">
      ${periods.map(p=>`<button class="${p===period?"on":""}" data-v="${p}">${esc(PERIODS[p])}</button>`).join("")}
      <button class="${period==="HT"?"on":""}" data-v="HT">HT（ハーフタイム）</button>
    </div>
    <div id="sub-min-wrap" style="${period==="HT"?"display:none":""}">
      <label class="f">分（入れなくてOK）</label>
      <input class="in" id="sub-min" type="number" inputmode="numeric" placeholder="例）60" value="${editing&&orig.minute!=null?orig.minute:""}">
    </div>
    <div class="btnrow">
      ${editing?`<button class="btn danger" onclick="this.closest('.modal').remove();delEvent(${editIdx})">削除</button>`:""}
      <button class="btn ghost" onclick="this.closest('.modal').remove()">やめる</button>
      <button class="btn" id="sub-ok">${editing?"保存":"追加"}</button>
    </div>
  </div>`;
  document.body.appendChild(el);
  const optHTML = list => `<option value="">（選手を選ぶ）</option>` + list.map(p=>
      `<option value="${p.id}">${p.no?esc(String(p.no))+" ":""}${esc(p.name)}</option>`).join("");
  const fill = (applyOrig)=>{
    const sets = subFieldSets(m, team, editing?editIdx:undefined);
    $("#sub-out").innerHTML = optHTML(sets.out);   // 今ピッチにいる選手だけ（編集中は自分自身のOUTも含む）
    $("#sub-in").innerHTML  = optHTML(sets.in);    // まだ出ていない控えだけ（編集中は自分自身のINも含む）
    if(editing && applyOrig){
      $("#sub-out").value = orig.outId || "";
      $("#sub-in").value  = orig.playerId || "";
    }
  };
  fill(true);
  el.querySelectorAll("#sub-team button").forEach(b=> b.onclick = ()=>{
    el.querySelectorAll("#sub-team button").forEach(x=>x.classList.remove("on"));
    b.classList.add("on"); team=b.dataset.v; fill(false);
  });
  el.querySelectorAll("#sub-period button").forEach(b=> b.onclick = ()=>{
    el.querySelectorAll("#sub-period button").forEach(x=>x.classList.remove("on"));
    b.classList.add("on"); period=b.dataset.v;
    $("#sub-min-wrap").style.display = period==="HT" ? "none" : "";   // HT交代は「分」を使わない
  });
  $("#sub-ok").onclick = ()=>{
    const outId = $("#sub-out").value || null;
    const inId  = $("#sub-in").value || null;
    if(!outId && !inId) return toast("OUTかINの選手を選んでください");
    const minute = (period==="HT" || !$("#sub-min").value) ? null : num($("#sub-min").value);
    m.events = m.events || [];
    const ev = { type:"sub", team, outId, playerId:inId, minute, period };
    if(editing) m.events[editIdx] = ev; else m.events.push(ev);
    sortEvents(m);
    el.remove(); render();
  };
}

async function saveMatch(stay){
  const m = curMatch(); if(!m) return false;
  if(m.status==="done" && (m.home_score==null || m.away_score==null)){
    m.home_score = m.home_score??0; m.away_score = m.away_score??0;
  }
  m.updated_at = new Date().toISOString();
  try{
    await DB.upsert("gn_matches", stripMatch(m));
    toast("保存しました");
    if(!stay) go("t");
    return true;
  }catch(e){ console.error(e); toast("保存できませんでした: "+(e.message||e)); return false; }
}
function stripMatch(m){
  const { id,tournament_id,org_id,stage,grp,round,slot,matchNo,home_team,away_team,home_src,away_src,
          kickoff,venue,home_score,away_score,home_pk,away_pk,status,events,note,sort_order,
          updated_at,official,lineups,result_type,result_note } = m;
  return { id,tournament_id,org_id,stage,grp,round,slot,matchNo,home_team,away_team,home_src,away_src,
           kickoff,venue,home_score,away_score,home_pk,away_pk,status,events,note,sort_order,
           updated_at,official,lineups,result_type:result_type||null,result_note:result_note||null };
}

/* --- 変更履歴（setup-14実行済みの本番でのみ記録される。お試し版・オフラインでは空） --- */
async function openMatchHistory(){
  const m = curMatch(); if(!m) return;
  const el = document.createElement("div"); el.className="modal";
  el.innerHTML = `<div class="sheet"><h3>変更履歴</h3>
    <div id="mh-body" class="hint">読み込み中…</div>
    <div class="btnrow"><button class="btn ghost" onclick="this.closest('.modal').remove()">閉じる</button></div>
  </div>`;
  document.body.appendChild(el);
  try{
    const rows = await DB.loadMatchHistory(m.id);
    $("#mh-body").innerHTML = rows.length ? rows.map(r=>`
      <div class="card" style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline">
          <b>${r.action==="delete"?"🗑 削除":"✏️ 更新"}</b>
          <span class="meta">${esc(fmtDate(r.changed_at))} ${esc(fmtTime(r.changed_at))}</span>
        </div>
        <div class="hint" style="margin-top:4px">${esc(summarizeMatchDiff(r.before,r.after))}</div>
        <button class="btn ghost sm" style="margin-top:6px" onclick="const p=this.nextElementSibling; p.style.display = p.style.display==='none' ? 'block' : 'none';">生データを見る</button>
        <pre style="display:none;font-size:11px;white-space:pre-wrap;background:var(--card2,#f4f4f4);padding:8px;border-radius:6px;margin-top:6px">変更前:
${esc(JSON.stringify(r.before,null,1))}

変更後:
${esc(JSON.stringify(r.after,null,1))}</pre>
      </div>`).join("") : `<div class="empty">まだ変更履歴がありません。</div>`;
  }catch(e){
    $("#mh-body").innerHTML = `<div class="empty">読み込めませんでした（${esc(e.message||String(e))}）。</div>`;
  }
}

/* ---------- チーム・選手の編集 ---------- */
