/* ==========================================================================
   紙様式の縦型トーナメント表
   下にチーム名を縦書きで並べ、上に向かって勝ち上がる（県大会の組み合わせ表ふう）。
   ・試合日ごとに段を色分け／各試合に【試合番号】・会場の略称・時刻（終了後はスコア）
   ・下部に会場一覧（略称＝正式名）
   横型（views-match.js の layoutBracket / drawLinks）とは別に動く。画面の寸法を測らず
   計算だけでSVGを作るので、スマホでも線がずれない。
   ========================================================================== */
const PB_COLW = 38, PB_ROWH = 70, PB_TOP = 22, PB_LABELW = 58;
const PB_COLORS = ["#fff59d","#ffe0b2","#c8e6c9","#bbdefb","#e1bee7","#ffcdd2"];
const PB_LINE = "#333", PB_WIN = "#d32f2f";

/* 表示の向き（横型/縦型）は見る人ごとに端末へ覚えておく */
function curBracketView(){
  if(state.bracketView) return state.bracketView;
  try{ return localStorage.getItem("gn_bracketView") || "yoko"; }catch(e){ return "yoko"; }
}
function setBracketView(v){
  state.bracketView = v;
  try{ localStorage.setItem("gn_bracketView", v); }catch(e){}
  render();
}
function bracketViewToggle(){
  const v = curBracketView();
  return `<div class="seg noprint" style="margin-bottom:10px">
    <button class="${v!=="tate"?"on":""}" onclick="setBracketView('yoko')">横型</button>
    <button class="${v==="tate"?"on":""}" onclick="setBracketView('tate')">縦型（紙の表ふう）</button></div>`;
}

/* --- 会場の略称（大会設定 venueShort に保存。未設定なら名前の先頭から自動） --- */
function pbVenueShorts(names){
  const saved = cfgOf(state.t).venueShort || {};
  const out = {}, used = new Set();
  names.forEach(n=>{ if(saved[n]){ out[n] = saved[n]; used.add(saved[n]); } });
  names.forEach(n=>{
    if(out[n]) return;
    // 先頭2文字。ほかの会場とかぶるときは番号を付ける（例：YD1・YD2）
    const head = n.slice(0,2);
    const twins = names.filter(x=>!saved[x] && x.slice(0,2)===head);
    let s = twins.length>1 ? head + (twins.indexOf(n)+1) : head;
    while(used.has(s)) s += "'";
    out[n] = s; used.add(s);
  });
  return out;
}
function openVenueShortEditor(){
  const names = [...new Set(koMatchesOf(curBracketId(), true).map(m=>m.venue).filter(Boolean))];
  if(!names.length) return toast("まだ試合に会場が入っていません");
  const cur = pbVenueShorts(names);
  const el = document.createElement("div");
  el.className = "modal";
  el.innerHTML = `<div class="sheet">
    <h3>会場の略称</h3>
    <p class="hint" style="margin-bottom:8px">縦型トーナメント表の各試合に出す短い名前です（例：YA、高松）。空欄にすると自動に戻ります。</p>
    ${names.map((n,i)=>`<div style="margin-bottom:8px"><label class="f">${esc(n)}</label>
      <input class="in" data-i="${i}" value="${esc(cur[n])}" maxlength="6"></div>`).join("")}
    <div class="btnrow">
      <button class="btn ghost" onclick="this.closest('.modal').remove()">やめる</button>
      <button class="btn" id="vs-ok">保存する</button>
    </div></div>`;
  document.body.appendChild(el);
  $("#vs-ok").onclick = async ()=>{
    const map = Object.assign({}, cfgOf(state.t).venueShort || {});
    el.querySelectorAll("input[data-i]").forEach(inp=>{
      const n = names[+inp.dataset.i], v = inp.value.trim();
      if(v) map[n] = v; else delete map[n];
    });
    el.remove();
    cfg_set("venueShort", map);
    try{ await saveTournamentSettings(); toast("保存しました"); }
    catch(e){ toast("保存できませんでした: "+(e.message||e)); }
    render();
  };
}

/* --- 櫓を木の形にする。シード（片側が空）の試合はそのまま上へ通す --- */
function pbBuildForest(bid){
  const ko = koMatchesOf(bid);
  if(!ko.length) return [];
  const byId = new Map(ko.map(m=>[m.id,m]));
  const usedAsChild = new Set();
  ko.forEach(m=>["home_src","away_src"].forEach(k=>{
    const s = m[k]; if(s && s[0]==="W" && byId.has(s.slice(2))) usedAsChild.add(s.slice(2));
  }));
  const seen = new Set();
  const side = (m, sd)=>{
    const pre = sd==="H" ? "home" : "away", src = m[pre+"_src"];
    if(!m[pre+"_team"] && src && src[0]==="W"){
      const c = byId.get(src.slice(2));
      if(c && !seen.has(c.id)) return node(c);
    }
    return { leaf:true, m, sd };
  };
  const node = m=>{
    seen.add(m.id);
    if(isSeedMatch(m)) return side(m, isEmptySide(m,"H") ? "A" : "H");
    if(isEmptySide(m,"H") && isEmptySide(m,"A")) return { leaf:true, m, sd:null };
    return { m, kids:[side(m,"H"), side(m,"A")] };
  };
  return ko.filter(m=>!usedAsChild.has(m.id))
           .sort((a,b)=>b.round-a.round || a.slot-b.slot)
           .map(node);
}

function paperBracketHTML(bid, edit){
  const forest = pbBuildForest(bid);
  if(!forest.length) return `<div class="empty">このトーナメントにはまだマッチがありません。</div>`;
  // 横位置（葉＝チームを左から順に）と段（下から何段目か）を決める
  // 段は「何回戦か」で決める（シード同士の2回戦も2回戦の段に置き、1回戦の段と混ざらないように）
  const minRound = Math.min(...koMatchesOf(bid).map(m=>m.round));
  const leaves = [], nodes = [];
  const place = n=>{
    if(n.leaf){ n.x = leaves.length; n.h = 0; leaves.push(n); return; }
    n.kids.forEach(place);
    n.x = (n.kids[0].x + n.kids[1].x) / 2;
    n.h = Math.max(n.m.round - minRound + 1, 1 + Math.max(n.kids[0].h, n.kids[1].h));
    nodes.push(n);
  };
  forest.forEach(place);
  const H = Math.max(1, ...nodes.map(n=>n.h));
  const N = leaves.length;
  const W = PB_LABELW + N*PB_COLW + 6;
  const base = PB_TOP + H*PB_ROWH;               // チームの線の下端
  const X = x=> PB_LABELW + x*PB_COLW + PB_COLW/2;
  const barY = h=> base - h*PB_ROWH + 4;          // h段目の横線の高さ

  // 試合番号：入力済みならそれを使い、1つも無ければ下の段から左→右に自動で振る
  const anyNo = nodes.some(n=>n.m.matchNo);
  const autoNo = new Map(nodes.slice().sort((a,b)=>a.h-b.h || a.x-b.x).map((n,i)=>[n.m.id, i+1]));
  const noOf = m=> anyNo ? (m.matchNo || "") : autoNo.get(m.id);

  // 段ごとの日付（その段でいちばん多い日）→ 同じ日の段はまとめて1つの色帯に
  const rowDate = {}, rowLabel = {};
  for(let h=1; h<=H; h++){
    const ms = nodes.filter(n=>n.h===h).map(n=>n.m);
    const cnt = {};
    ms.forEach(m=>{ const d = localDate(m.kickoff); if(d) cnt[d]=(cnt[d]||0)+1; });
    rowDate[h] = Object.keys(cnt).sort((a,b)=>cnt[b]-cnt[a] || a.localeCompare(b))[0] || "";
    rowLabel[h] = ms[0] ? koRoundLabel(ms[0]) : "";
  }
  const bands = [];
  for(let h=1; h<=H; h++){
    const last = bands[bands.length-1];
    if(last && rowDate[h] && last.date===rowDate[h]) last.to = h;
    else bands.push({ from:h, to:h, date:rowDate[h], label:rowLabel[h] });
  }
  let svg = "";
  bands.forEach((b,i)=>{
    const y1 = base - b.to*PB_ROWH - (b.to===H ? PB_TOP-4 : 0), y2 = base - (b.from-1)*PB_ROWH;
    const col = b.date ? PB_COLORS[i % PB_COLORS.length] : "#eef2f8";
    svg += `<rect x="${PB_LABELW}" y="${y1}" width="${N*PB_COLW+6}" height="${y2-y1}" fill="${col}"/>`;
    svg += `<line x1="0" y1="${y2}" x2="${W}" y2="${y2}" stroke="#999" stroke-width=".6"/>`;
    const cy = (y1+y2)/2;
    if(b.date){
      const d = new Date(b.date+"T00:00:00");
      svg += `<text x="${PB_LABELW/2}" y="${cy-3}" class="pb-day">${d.getMonth()+1}/${d.getDate()}</text>
              <text x="${PB_LABELW/2}" y="${cy+12}" class="pb-day">(${"日月火水木金土"[d.getDay()]})</text>`;
    } else {
      svg += `<text x="${PB_LABELW/2}" y="${cy+4}" class="pb-day sm">${esc(b.label)}</text>`;
    }
  });

  // 線（勝った側は赤い太線）と試合の情報
  const topOf = n=> n.leaf ? base : barY(n.h);
  const venues = [...new Set(nodes.slice().sort((a,b)=>a.h-b.h || a.x-b.x).map(n=>n.m.venue).filter(Boolean))];
  const vs = pbVenueShorts(venues);
  nodes.forEach(n=>{
    const m = n.m, y = barY(n.h), cx = X(n.x);
    const w = isDone(m) ? winnerOf(m) : null;
    n.kids.forEach((k,i)=>{
      const won = w && w===resolveSlot(m, i===0?"H":"A").id;
      const st = won ? `stroke="${PB_WIN}" stroke-width="3"` : `stroke="${PB_LINE}" stroke-width="1.2"`;
      svg += `<path d="M${X(k.x)},${topOf(k)} V${y} H${cx}" fill="none" ${st}/>`;
    });
    const no = noOf(m);
    const lines = [];
    if(no!=="") lines.push(`<tspan class="pb-no">【${esc(no)}】</tspan>`);
    if(m.venue) lines.push(esc(vs[m.venue]));
    if(m.kickoff) lines.push(esc(fmtTime(m.kickoff)));
    if(isDone(m)){
      const pk = m.home_pk!=null && m.away_pk!=null ? `(${m.home_pk}-${m.away_pk})` : "";
      lines.push(`<tspan class="pb-sc">${m.home_score}-${m.away_score}${pk}</tspan>`);
    }
    lines.forEach((t,i)=>{ svg += `<text x="${cx}" y="${y+15+i*13}" class="pb-t">${t}</text>`; });
    const act = edit ? `openMatch('${m.id}')`
              : (m.official && m.official.public) ? `goOfficialPublic('${m.id}')` : "";
    if(act){
      const half = Math.max(PB_COLW*0.6, Math.abs(X(n.kids[1].x)-X(n.kids[0].x))/2);
      svg += `<rect x="${cx-half}" y="${y}" width="${half*2}" height="${PB_ROWH-8}" fill="transparent" style="cursor:pointer" onclick="${act}"><title>試合を開く</title></rect>`;
    }
  });
  // 優勝へ向かう線
  forest.forEach(r=>{
    if(r.leaf) return;
    const won = isDone(r.m) && winnerOf(r.m);
    svg += `<line x1="${X(r.x)}" y1="${barY(r.h)}" x2="${X(r.x)}" y2="${barY(r.h)-PB_TOP+6}" stroke="${won?PB_WIN:PB_LINE}" stroke-width="${won?3:1.2}"/>`;
  });
  // チームの番号
  leaves.forEach((l,i)=>{ svg += `<text x="${X(l.x)}" y="${base+14}" class="pb-num">${i+1}</text>`; });
  const svgH = base + 20;

  const names = leaves.map(l=>{
    const r = l.sd ? resolveSlot(l.m, l.sd) : { label:"—", kind:"tbd" };
    return `<div class="pb-name ${r.kind==="team"?"":"tbd"}" style="width:${PB_COLW}px">${esc(r.label)}</div>`;
  }).join("");

  const vlist = venues.length ? `<div class="pb-venues"><div class="pb-vh">会場一覧</div>
    ${venues.map(n=>`<div class="pb-v"><b>${esc(vs[n])}</b><span>${esc(n)}</span></div>`).join("")}</div>` : "";
  const tools = `<div class="btnrow noprint" style="margin:10px 0">
    <button class="btn ghost sm" style="flex:1" onclick="printPaperBracket()">🖨 縦型をA4横で印刷</button>
    ${edit && venues.length ? `<button class="btn ghost sm" style="flex:1" onclick="openVenueShortEditor()">会場の略称を変える</button>` : ""}</div>`;
  const multi = bracketsOf(state.t).length > 1;
  const cons = state.matches.filter(m=>m.slot===99 && bracketIdOf(m)===bid)
                            .sort((a,b)=>(a.sort_order||0)-(b.sort_order||0))
                            .map(c=>`<div class="block-label">${esc(koRoundLabel(c))}</div>` + matchCard(c)).join("");

  return `<div class="ppb" id="paperBracket">
    <div class="ppb-in" id="paperBracketIn" style="width:${W}px">
      <div class="ppb-title">${esc(state.t.name)}${multi?` ${esc(bracketName(state.t,bid))}`:""} 組み合わせ</div>
      <svg width="${W}" height="${svgH}" viewBox="0 0 ${W} ${svgH}" class="pb-svg">${svg}</svg>
      <div class="pb-names" style="padding-left:${PB_LABELW}px">${names}</div>
      ${anyNo || nodes.length ? `<div class="pb-note">【　】は試合番号</div>` : ""}
      ${vlist}
    </div></div>${tools}${cons}`;
}

/* A4横1枚に収まるよう縮小して印刷 */
function printPaperBracket(){
  const bk = document.getElementById("paperBracket"), inn = document.getElementById("paperBracketIn");
  if(!bk || !inn){ window.print(); return; }
  const w = inn.scrollWidth, h = inn.scrollHeight + 44;   // 印刷時だけ出る見出しのぶんを足す
  const PW = 1040, PH = 700;                       // A4横 印刷可能領域の目安(px・余白8mm)
  const scale = Math.min(PW/w, PH/h, 1);
  bk.style.setProperty("--pw", w+"px");
  bk.style.setProperty("--ph", h+"px");
  bk.style.setProperty("--ps", scale);
  const done = ()=>{ document.body.classList.remove("ppbk"); ["--pw","--ph","--ps"].forEach(k=>bk.style.removeProperty(k)); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  document.body.classList.add("ppbk");
  setTimeout(()=>window.print(), 60);
  setTimeout(done, 4000);
}
