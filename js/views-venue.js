/* ==========================================================================
   会場担当の入力リンク（setup-32）
   ・運営：大会の「会場×日付」ごとにリンクと6文字の入力コードを発行・無効化する
   ・会場担当：ログインせずに、その会場・その日の試合の結果だけを入れる
   書き込みの制限はSupabase側の関数（venue_save_match）で確かめる＝画面を細工しても他の試合は書けない
   ========================================================================== */

/* 日本時間の日付（YYYY-MM-DD）。サーバー側の判定（Asia/Tokyo）とそろえるため、端末の時刻設定に左右されないよう+9時間で求める */
function jstDay(iso){
  if(!iso) return "";
  const t = new Date(iso).getTime(); if(isNaN(t)) return "";
  return new Date(t + 9*3600*1000).toISOString().slice(0,10);
}
function venueDayLabel(day){
  if(!day) return "";
  const [y,mo,d] = day.split("-").map(Number);
  const w = "日月火水木金土"[new Date(Date.UTC(y,mo-1,d)).getUTCDay()];
  return `${mo}月${d}日（${w}）`;
}
/* その会場・その日の試合（サーバー側の venue_save_match と同じ条件） */
function venueMatchesOf(matches, venue, day){
  const v = String(venue||"").trim();
  return (matches||[]).filter(m=> String(m.venue||"").trim()===v && v && m.kickoff && jstDay(m.kickoff)===day)
    .sort((a,b)=> String(a.kickoff).localeCompare(String(b.kickoff)) || (a.sort_order||0)-(b.sort_order||0));
}
/* 既定の有効期限：その日の終わり（日本時間の24時）。その日のうちは会場担当が直せ、翌日以降の修正は運営が行う */
function venueDefaultExpiry(day){
  const [y,mo,d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, mo-1, d, 15, 0, 0)).toISOString();   // その日 15:00 UTC ＝ 翌日 0:00 JST
}
/* 会場担当が入れられる公式記録の欄（サインは含めない。setup-32 の venue_save_match と同じ並び） */
const VENUE_OFFICIAL_KEYS = ["format","referee","fourth","ar1","ar2","recorder","org","weather","wind","pitch","pitchCond","temp","crowd"];
function venueLinkFor(id){ return location.origin + location.pathname + "#venue=" + id; }
const isVenueMode = ()=> !!(state.venueEntry && state.venueEntry.ok);

/* ---------- 運営側：発行・配布 ---------- */
async function openVenueLinks(){
  state.view = "venuelinks"; state.loading = true; render();
  try{ state.venueLinks = await DB.loadVenueEntries(state.t.id); }
  catch(e){ console.error(e); toast("読み込めませんでした（setup-32 のSQLが未実行かもしれません）: "+(e.message||e)); state.venueLinks = []; }
  state.loading = false; render();
}
/* 試合に入っている「会場×日付」の組み合わせ（日付順・会場名順） */
function venueDayPairs(){
  const map = new Map();
  (state.matches||[]).forEach(m=>{
    const v = String(m.venue||"").trim(), d = jstDay(m.kickoff);
    if(!v || !d) return;
    const k = d + "\u0000" + v;
    if(!map.has(k)) map.set(k, { venue:v, day:d, n:0 });
    map.get(k).n++;
  });
  return [...map.values()].sort((a,b)=> a.day.localeCompare(b.day) || a.venue.localeCompare(b.venue, "ja"));
}
async function issueVenueLink(venue, day){
  try{
    await DB.createVenueEntry({ id:uid(), org_id:state.t.org_id, tournament_id:state.t.id, venue, day,
      code:entryCode(), active:true, expires_at:venueDefaultExpiry(day) });
    toast("発行しました");
    await openVenueLinks();
  }catch(e){ console.error(e); toast("発行できませんでした: "+(e.message||e)); }
}
async function setVenueLinkActive(id, on){
  if(!on && !confirm("このリンクを無効にします。会場担当はこのリンクで入力できなくなります（入力済みの結果は消えません）。よろしいですか？")) return;
  const row = (state.venueLinks||[]).find(x=>x.id===id); if(!row) return;
  const patch = { active:on };
  // 期限切れのリンクを「使えるようにする」ときは、期限を今日の終わり（日本時間24時）まで延ばす
  if(on && row.expires_at && new Date(row.expires_at).getTime() < Date.now())
    patch.expires_at = venueDefaultExpiry(jstDay(new Date().toISOString()));
  try{ await DB.updateVenueEntry(id, patch); toast(on ? "使えるようにしました" : "無効にしました"); await openVenueLinks(); }
  catch(e){ console.error(e); toast("変更できませんでした: "+(e.message||e)); }
}
async function renewVenueCode(id){
  if(!confirm("入力コードを新しく作り直します。前のコードは使えなくなるので、会場担当に新しいコードを伝え直してください。よろしいですか？")) return;
  try{ await DB.updateVenueEntry(id, { code:entryCode(), fail_count:0, locked_until:null }); toast("コードを作り直しました"); await openVenueLinks(); }
  catch(e){ console.error(e); toast("作り直せませんでした: "+(e.message||e)); }
}
function venueLinkStatus(row){
  if(!row.active) return { text:"無効", cls:"" };
  if(row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return { text:"期限切れ", cls:"" };
  return { text:"使えます", cls:"ok" };
}
function venueExpiryText(row){
  if(!row.expires_at) return "期限なし";
  // 日本時間で表示する（0時ちょうどは「前の日の24時」と書く方が分かりやすい）
  const j = new Date(new Date(row.expires_at).getTime() + 9*3600*1000);
  if(j.getUTCHours()===0 && j.getUTCMinutes()===0){
    const p = new Date(j.getTime() - 24*3600*1000);
    return `${p.getUTCMonth()+1}月${p.getUTCDate()}日 24時まで`;
  }
  return `${j.getUTCMonth()+1}月${j.getUTCDate()}日 ${j.getUTCHours()}時${String(j.getUTCMinutes()).padStart(2,"0")}分まで`;
}
function viewVenueLinks(){
  const title = "会場担当の入力リンク";
  if(!state.t) return topbar({title, back:"go('home')"}) + `<div class="empty">大会が選ばれていません。</div>`;
  if(state.loading) return topbar({title, back:"go('t')"}) + `<div class="empty">準備中…</div>`;
  const links = state.venueLinks || [];
  const pairs = venueDayPairs();
  const missing = (state.matches||[]).filter(m=> !!String(m.venue||"").trim() !== !!m.kickoff).length;
  const linkKey = (v,d)=> d + "\u0000" + v;
  const byPair = new Map(); links.forEach(r=>{ const k = linkKey(String(r.venue).trim(), r.day); if(!byPair.has(k)) byPair.set(k, []); byPair.get(k).push(r); });
  const orphan = links.filter(r=> !pairs.some(p=> p.venue===String(r.venue).trim() && p.day===r.day));
  const cardOf = (r, n)=>{
    const st = venueLinkStatus(r), link = venueLinkFor(r.id);
    const guide = `【${state.t.name}】${venueDayLabel(r.day)} ${r.venue} の結果入力をお願いします。\n下のリンクを開いて、入力コード ${r.code} を入れてください（ログインは要りません）。\n${link}`;
    return `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <b style="font-size:16px">${esc(r.venue)}</b>
        <span class="pill ${st.cls}">${st.text}</span>
      </div>
      <p class="hint" style="margin:4px 0 0">${esc(venueDayLabel(r.day))}・試合 ${n} 件・${esc(venueExpiryText(r))}${r.last_used_at?"・最後に使われた日時 "+esc(fmtDate(r.last_used_at))+" "+esc(fmtTime(r.last_used_at)):""}</p>
      <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
        <span class="lbl" style="width:76px;margin:0">入力コード</span>
        <b style="font-size:20px;letter-spacing:3px">${esc(r.code)}</b>
        <button class="btn ghost sm" onclick="copyText('${esc(r.code)}','コードをコピーしました')">コピー</button>
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:6px">
        <span class="lbl" style="width:76px;margin:0">リンク</span>
        <input class="in" style="flex:1;font-size:12px" readonly value="${link}" onclick="this.select()">
        <button class="btn ghost sm" onclick="copyText('${link}','リンクをコピーしました')">コピー</button>
      </div>
      <button class="btn ghost sm noprint" style="margin-top:8px;width:100%" onclick="copyText(${esc(JSON.stringify(guide))},'案内文をコピーしました')">📋 案内文ごとコピー（LINE・メールに貼れます）</button>
      <div class="btnrow noprint" style="margin-top:6px">
        ${st.text==="使えます"
          ? `<button class="btn ghost sm" style="flex:1;color:var(--bad)" onclick="setVenueLinkActive('${r.id}',false)">無効にする</button>`
          : `<button class="btn ghost sm" style="flex:1" onclick="setVenueLinkActive('${r.id}',true)">使えるようにする</button>`}
        <button class="btn ghost sm" style="flex:1" onclick="renewVenueCode('${r.id}')">コードを作り直す</button>
      </div>
    </div>`;
  };
  let body = "";
  let lastDay = null;
  pairs.forEach(p=>{
    if(p.day!==lastDay){ body += `<div class="block-label" style="margin-top:14px">${esc(venueDayLabel(p.day))}</div>`; lastDay = p.day; }
    const rows = byPair.get(linkKey(p.venue, p.day)) || [];
    if(rows.length) body += rows.map(r=>cardOf(r, p.n)).join("");
    else body += `<div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div><b>${esc(p.venue)}</b><div class="hint" style="margin:2px 0 0">試合 ${p.n} 件・まだ発行していません</div></div>
        <button class="btn sec sm noprint" style="width:auto" onclick="issueVenueLink(${esc(JSON.stringify(p.venue))},'${p.day}')">発行する</button>
      </div>`;
  });
  if(orphan.length){
    body += `<div class="block-label" style="margin-top:14px">今は該当する試合がないリンク</div>
      <p class="hint">日程・会場名を変えたため、このリンクで入力できる試合がなくなっています。必要なら新しい会場名で発行し直してください。</p>`
      + orphan.map(r=>cardOf(r, 0)).join("");
  }
  return topbar({ title, sub:state.t.name, back:"go('t')" })
  + `<div class="screen">
    <p class="lead">会場ごと・日ごとに<b>リンク</b>と<b>入力コード</b>を発行し、会場の担当者に送ってください。担当者は<b>ログイン不要</b>で、<b>その会場・その日の試合だけ</b>、スコア・得点者・警告・交代・試合の状態・メモ、公式記録（審判名・天候など）を入れ、試合後の<b>最終チェックと審判の指サイン</b>までできます。日時・会場・対戦・メンバー表・公式記録の公開／非公開・選手登録・大会の設定は変えられません。</p>
    <div class="callout" style="margin-bottom:10px">・会場名は試合の「会場」欄と<b>同じ文字</b>のものが1つの会場になります（表記がちがうと別会場になります）。<br>・リンクは<b>その日の終わり（24時）</b>で自動的に使えなくなります。翌日以降の修正は運営が行ってください（必要なら「使えるようにする」で今日の24時まで延ばせます）。<br>・キックオフの日時が入っていない試合は、どのリンクにも出ません。</div>
    ${missing ? `<div class="callout" style="margin-bottom:10px;background:var(--warnbg);border-color:#f0d9a0;color:var(--warn)">⚠️ 会場か日時の片方だけが入っている試合が ${missing} 件あります。会場担当のリンクには出ないので、「🗓 日程・会場をまとめて入力」で両方入れてください。</div>` : ""}
    <button class="btn ghost sm noprint" style="margin-bottom:10px" onclick="window.print()">🖨 一覧を印刷して配る</button>
    ${pairs.length ? body : `<div class="empty">会場と日時が入っている試合がまだありません。先に「🗓 日程・会場をまとめて入力」で入れてください。</div>${orphan.length?body:""}`}
  </div>`;
}

/* ---------- 会場担当側：コードを入れて、その会場・その日の試合を入力 ---------- */
function venueCodeKey(id){ return "gn_venue_code_" + id; }
async function openVenueEntry(id){
  let saved = "";
  try{ saved = sessionStorage.getItem(venueCodeKey(id)) || ""; }catch(_){}
  state.venueEntry = { id, code:saved, ok:false, error:null, busy:false };
  state.view = "venueentry"; render();
  if(saved) await venueEntryLogin();
}
async function venueEntryLogin(){
  const e = state.venueEntry; if(!e || e.busy) return;
  const code = String(e.code||"").trim().toUpperCase();
  if(code.length !== 6){ toast("入力コード（6文字）を入れてください"); return; }
  e.busy = true; e.error = null; e.code = code; render();
  try{
    const ok = await venueReload(true);
    if(ok){ e.ok = true; try{ sessionStorage.setItem(venueCodeKey(e.id), code); }catch(_){} }
  }catch(err){ console.error(err); e.error = "読み込めませんでした。電波のよい所で、もう一度お試しください。"; }
  e.busy = false; render();
}
/* コードを確かめ、大会（軽い列）と「この会場・この日の試合」の中身だけを読む。
   ほかの会場・ほかの日の試合のメンバー表・公式記録や、公式記録のサイン画像は読まない＝通信量を抑える */
async function venueReload(silent){
  const e = state.venueEntry; if(!e) return false;
  let r;
  try{ r = await DB.venueEntryOpen(e.id, e.code); }
  catch(err){ if(silent) throw err; console.error(err); toast("読み込めませんでした"); return false; }
  if(!r || !r.ok){
    e.ok = false;
    e.error = r && r.reason==="closed"
      ? "このリンクは使えません（無効にされたか、期限が過ぎています）。運営（本部）にご確認ください。"
      : "入力コードがちがいます。5回まちがえると15分間使えなくなります。";
    try{ sessionStorage.removeItem(venueCodeKey(e.id)); }catch(_){}
    if(!silent){ state.view = "venueentry"; render(); }
    return false;
  }
  e.venue = r.venue; e.day = r.day; e.tid = r.tournament_id;
  try{
    const d = await DB.loadVenueTournament(e.tid, (r.matches||[]).map(x=>x.id));
    const byId = new Map((r.matches||[]).map(x=>[x.id, x]));
    (d.matches||[]).forEach(m=>{ const x = byId.get(m.id); if(!x) return;
      m.lineups = x.lineups || null;
      m.official = (x.official && Object.keys(x.official).length) ? x.official : null; });
    mergeEntryLineups(d.matches||[]);
    state.heavyLoaded = true;   // 一般の閲覧のように「全部の試合の重い列」を読みに行かないように
    state.t = d.t; state.teams = d.teams || []; state.matches = d.matches || [];
    if(!silent){ toast("最新の内容にしました"); render(); }
    return true;
  }catch(err){ if(silent) throw err; console.error(err); toast("読み込めませんでした"); return false; }
}

function openVenueMatch(id){
  const m = (state.matches||[]).find(x=>x.id===id); if(!m) return;
  state.subStack = [];
  state.matchId = id;
  state.unlockMatch = !isDone(m) ? id : null;
  state.view = "match"; render(); snapSubView();
  window.scrollTo(0,0);
}
/* 結果入力から会場の試合一覧へ戻る（書き込みがあれば保存してから） */
async function venueBack(){
  if(state.view==="match" && state.subSnap != null && state.subSnap !== subViewSnapshot()){
    const ok = await saveMatch(true);
    if(ok === false) return;
  }
  state.view = "venueentry"; render(); window.scrollTo(0,0);
}
function venueStatusPill(m){
  const s = m.status || "todo";
  const label = { live:"試合中", done:"終了", postponed:"延期", cancelled:"中止" }[s] || "未実施";
  return `<span class="pill ${s==="done"?"ok":""}">${esc(label)}</span>`;
}
function viewVenueEntry(){
  const e = state.venueEntry;
  const title = "会場の結果入力";
  if(!e) return topbar({title}) + `<div class="empty">読み込み中…</div>`;
  if(!e.ok){
    return topbar({title})
    + `<div class="screen"><div class="card">
      <div class="lead" style="margin:0">運営（本部）からもらった<b>入力コード</b>（6文字）を入れてください。ログインは要りません。</div>
      <label class="lbl" style="margin-top:10px">入力コード</label>
      <input id="venuecode" class="in" style="text-transform:uppercase;letter-spacing:3px;font-size:18px" placeholder="ABC123" maxlength="6"
        value="${esc(e.code||"")}" oninput="this.value=this.value.toUpperCase();state.venueEntry.code=this.value"
        onkeydown="if(event.key==='Enter')venueEntryLogin()">
      ${e.error?`<div class="callout" style="margin-top:10px;background:var(--warnbg);border-color:#f0d9a0;color:var(--warn)">${esc(e.error)}</div>`:""}
      <button class="btn" style="margin-top:12px" ${e.busy?"disabled":""} onclick="venueEntryLogin()">${e.busy?"確認中…":"開く"}</button>
    </div></div>`;
  }
  const ms = venueMatchesOf(state.matches, e.venue, e.day);
  return topbar({ title, sub:state.t ? state.t.name : "" })
  + `<div class="screen">
    <div class="card">
      <b style="font-size:18px">📍 ${esc(e.venue)}</b>
      <div class="hint" style="margin:4px 0 0">${esc(venueDayLabel(e.day))}の試合（${ms.length}件）。試合を押すと結果を入れられます。</div>
    </div>
    ${venueDeadlineNote()}
    ${ms.length ? ms.map(m=>{
      const H = resolveSlot(m,"H"), A = resolveSlot(m,"A");
      const sc = (m.home_score!=null && m.away_score!=null) ? `${m.home_score} － ${m.away_score}${(m.home_pk!=null&&m.away_pk!=null)?`<small>（PK ${m.home_pk}－${m.away_pk}）</small>`:""}` : "－";
      return `<button class="card" style="display:block;width:100%;text-align:left;cursor:pointer" onclick="openVenueMatch('${m.id}')">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
          <span class="hint" style="margin:0">${m.matchNo?`<b>No.${esc(String(m.matchNo))}</b> `:""}${esc(fmtTime(m.kickoff))}</span>
          ${venueStatusPill(m)}
        </div>
        <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center;margin-top:6px">
          <b style="text-align:right">${esc(H.label)}</b>
          <b style="font-size:18px;white-space:nowrap">${sc}</b>
          <b>${esc(A.label)}</b>
        </div>
      </button>`;
    }).join("") : `<div class="empty">この会場・この日の試合が見つかりません。日程が変わった可能性があります。運営（本部）にご確認ください。</div>`}
    <button class="btn ghost" onclick="venueReload(false)">🔄 最新の内容にする</button>
    <p class="hint">入力した結果は、保存するとすぐに大会のページ（順位表・トーナメント表）に反映されます。試合が終わったら、結果入力の画面の「📄 公式記録（最終チェック・サイン）」から、記録者が確認して審判にサインをもらってください。このリンクは<b>今日の24時まで</b>使えます。それ以降の修正、メンバー表、日時や会場の変更は運営（本部）が行います。</p>
  </div>`;
}

/* 結果入力画面（viewMatch）からの保存：会場担当のときはサーバー側で確かめる関数を通す */
async function saveVenueMatch(stay){
  const e = state.venueEntry, m = curMatch(); if(!e || !m) return false;
  if(m.status==="done" && (m.home_score==null || m.away_score==null)){
    m.home_score = m.home_score??0; m.away_score = m.away_score??0;
  }
  try{
    const r = await DB.venueSaveMatch(e.id, e.code, m);
    if(r !== "ok"){
      toast(r==="code" ? "入力コードが使えなくなりました（無効・期限切れ）。運営にご確認ください"
          : r==="notyours" ? "この試合は、この会場・この日の試合ではなくなりました。運営にご確認ください"
          : "保存できませんでした（内容を確かめてください）");
      if(r==="code"){ e.ok = false; e.error = "このリンクは使えなくなりました。運営（本部）にご確認ください。"; state.view = "venueentry"; render(); }
      return false;
    }
    m.updated_at = new Date().toISOString();
    toast("保存しました");
    if(state.view==="match") snapSubView();
    if(!stay){ state.view = "venueentry"; render(); }
    return true;
  }catch(err){ console.error(err); toast("保存できませんでした: "+(err.message||err)); return false; }
}

/* 公式記録の画面を開く：先に結果を保存し、その試合の公式記録（サイン画像を含む）だけを読んでから開く */
async function openVenueOfficial(id){
  const e = state.venueEntry, m = (state.matches||[]).find(x=>x.id===id); if(!e || !m) return;
  if(state.subSnap != null && state.subSnap !== subViewSnapshot()){ const ok = await saveMatch(true); if(ok === false) return render(); }
  try{
    const r = await DB.venueGetOfficial(e.id, e.code, id);
    if(!r || !r.ok){ toast(r && r.reason==="notyours" ? "この試合は、この会場・この日の試合ではなくなりました" : "このリンクは使えなくなりました。運営にご確認ください"); return render(); }
    m.official = r.official || null;
  }catch(err){ console.error(err); toast("公式記録を読み込めませんでした"); return render(); }
  openOfficial(id);
}
async function saveVenueOfficial(silent){
  const e = state.venueEntry, m = curMatch(); if(!e || !m || !state.official) return false;
  try{
    const r = await DB.venueSaveOfficial(e.id, e.code, m.id, state.official);
    if(r !== "ok"){
      toast(r==="code" ? "入力コードが使えなくなりました（今日の24時を過ぎた・無効）。運営にご確認ください"
          : r==="notyours" ? "この試合は、この会場・この日の試合ではなくなりました" : "保存できませんでした");
      return false;
    }
    m.official = state.official;
    m.updated_at = new Date().toISOString();
    if(!silent) toast("公式記録を保存しました");
    if(state.view==="official") snapSubView();
    return true;
  }catch(err){ console.error(err); toast("保存できませんでした: "+(err.message||err)); return false; }
}

/* 会場担当の画面に出す注意：訂正はその日のうちに（こんちゃんの要望 2026-11-28） */
function venueDeadlineNote(){
  return `<div class="callout" style="margin-bottom:10px;background:var(--warnbg);border-color:#f0d9a0;color:var(--warn)">⚠️ <b>訂正はその日のうち（24時まで）に</b>行ってください。24時を過ぎるとこのリンクは使えなくなり、それ以降の訂正は運営（本部）への連絡が必要です。</div>`;
}
