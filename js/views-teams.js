function viewTeams(){
  const ts = state.teams.slice().sort((a,b)=>
    (a.grp||"").localeCompare(b.grp||"") || a.sort_order-b.sort_order);
  const blocks = blocksOf(state.t);
  const f = FORMATS[state.t.format];
  const cfg = cfgOf(state.t);
  const deadline = cfg.rosterDeadline;
  const locked = !!(deadline && localDate(new Date().toISOString()) > deadline && !state.unlockTeams);
  return `<div class="tourwrap">`
  + topbar({ title:"チーム・選手", sub:state.t.name, back:"go('t')" })
  + `<div class="twrap">${tournamentSidebar("team")}<div class="tmain">
    <div class="screen">
    <p class="lead">この大会にエントリーするチームと選手です。台帳から入れると、背番号ごとそのまま入ります（この大会だけ番号を書き換えることもできます）。</p>
    ${locked?`<div class="lockmsg">🔒 選手登録の締切（${esc(fmtDate(deadline))}）を過ぎています。内容は変更できません。直すときは下の「✏ 編集する」を押してください。</div>`:""}
    <fieldset class="ovlock"${locked?" disabled":""}>
    ${(()=>{ let out="", lastGrp=undefined;
      return out + ts.map(t=>{
        let head = "";
        if(blocks.length>1 && t.grp!==lastGrp){ lastGrp=t.grp; head = `<div class="block-label">${esc(blockName(state.t,t.grp)||"（ブロック未設定）")}</div>`; }
        const club = t.club_id ? clubById(t.club_id) : null;
        return head + `<div class="card">
      <div class="row2">
        <input class="in" value="${esc(t.name)}" onchange="editTeam('${t.id}','name',this.value)">
        ${blocks.length>0 && f.hasLeague ? `<select class="in" style="max-width:120px" onchange="editTeam('${t.id}','grp',this.value)">
          ${blocks.map(b=>`<option value="${b.id}" ${t.grp===b.id?"selected":""}>${esc(b.name)}</option>`).join("")}
        </select>` : ""}
        <button class="btn danger sm" style="flex:0 0 auto;width:auto" onclick="removeTeam('${t.id}')">削除</button>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:12px">
        <label class="f" style="margin:0">選手 ${(t.players||[]).length}名${club?`　<span style="color:var(--accent)">台帳：${esc(club.name)}</span>`:""}</label>
        ${state.clubs.length?`<button class="btn sec sm" onclick="openPickClubSheet('${t.id}')">📋 台帳から入れる</button>`:""}
      </div>
      <textarea class="in" style="min-height:96px;margin-top:6px" onchange="editPlayers('${t.id}',this.value)"
        placeholder="10 山田太郎 6 FW">${esc((t.players||[]).map(p=>
          [p.no??"", p.name, p.grade??"", p.pos??""].filter(x=>x!=="" && x!=null).join(" ")).join("\n"))}</textarea>
      <p class="hint">1行に1人。「背番号 名前 学年 ポジション」の順（無いものは省略できます）。</p>
    </div>`;}).join("");
    })()}
    <div class="btnrow">
      <button class="btn sec sm" style="flex:1" onclick="addTeamToTournament()">＋ チームを追加</button>
      ${state.clubs.length?`<button class="btn sec sm" style="flex:1" onclick="openPickClubsForTournament()">📋 台帳から追加</button>`:""}
    </div>
    ${f.hasLeague?`<div class="btnrow"><button class="btn ghost sm" onclick="rebuildLeague()">🔄 リーグの対戦カードを作り直す</button></div>
      <p class="hint">チームやブロックを変えたら、対戦カードを作り直してください（入力済みの結果は消えます）。</p>`:""}
    </fieldset>
    ${locked
      ? `<button class="btn" style="margin-top:6px" onclick="state.unlockTeams=true;render()">✏ 編集する</button>`
      : `<button class="btn" style="margin-top:6px" onclick="saveTeams()">保存する</button>`}
    </div>
  </div></div></div>`;
}
function editTeam(id,k,v){
  const t = state.teams.find(x=>x.id===id); if(!t) return;
  t[k] = v; t._dirty = true;
}
/* --- チームの追加・削除（H2） --- */
function addTeamToTournament(name, clubId){
  const nm = name || prompt("追加するチーム名");
  if(!nm || !nm.trim()) return;
  const blocks = blocksOf(state.t);
  const club = clubId ? clubById(clubId) : null;
  const t = { id:uid(), tournament_id:state.t.id, org_id:state.user.id, name:nm.trim(),
    grp: blocks.length ? blocks[0].id : null,
    seed: state.teams.length+1, sort_order: state.teams.length, club_id: clubId||null, crest: club?.crest||null,
    players: club ? membersOf(clubId).map(m=>({ id:m.id, memberId:m.id, no:m.no, name:m.name, pos:m.pos, grade:m.grade })) : [],
    _dirty:true };
  state.teams.push(t);
  if(!name) render();
  return t;
}
async function removeTeam(id){
  const t = state.teams.find(x=>x.id===id); if(!t) return;
  if(!confirm(`「${t.name}」を大会から外します。\nこのチームの試合カードも消えます。よろしいですか？`)) return;
  const relatedMatches = state.matches.filter(m=> m.home_team===id || m.away_team===id);
  try{
    if(relatedMatches.length) await DB.remove("gn_matches", relatedMatches.map(m=>m.id));
    await DB.remove("gn_teams", id);
    state.teams = state.teams.filter(x=>x.id!==id);
    state.matches = state.matches.filter(m=> m.home_team!==id && m.away_team!==id);
    toast("チームを外しました"); render();
  }catch(e){ toast("外せませんでした: "+(e.message||e)); }
}
function openPickClubsForTournament(){
  const inTourn = new Set(state.teams.map(t=>t.club_id).filter(Boolean));
  const avail = state.clubs.filter(c=>!inTourn.has(c.id));
  if(!avail.length) return toast("台帳のチームは全て入っています");
  const el = document.createElement("div"); el.className="modal";
  el.innerHTML = `<div class="sheet"><h3>台帳からチームを追加</h3>
    ${avail.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),"ja")).map(c=>
      `<label class="pick" style="cursor:pointer"><span style="min-width:0"><span style="display:block">${esc(c.name)}</span>
      <span class="meta">${esc(CATEGORIES[c.category]?.label||"")}・${membersOf(c.id).length}名</span></span>
      <input type="checkbox" data-id="${c.id}" style="width:22px;height:22px;flex-shrink:0"></label>`).join("")}
    <div class="btnrow"><button class="btn ghost" onclick="this.closest('.modal').remove()">やめる</button>
      <button class="btn" id="pt-ok">追加する</button></div></div>`;
  document.body.appendChild(el);
  $("#pt-ok").onclick=()=>{
    [...el.querySelectorAll("input:checked")].forEach(i=>{
      const c=clubById(i.dataset.id); addTeamToTournament(c.name, c.id);
    });
    el.remove(); saveTeams(true); render();
  };
}
/* --- リーグの対戦カードを作り直す --- */
async function rebuildLeague(){
  if(!confirm("リーグの対戦カードを、いまのチーム・ブロックで作り直します。\n入力済みの結果は消えます。よろしいですか？")) return;
  const blockIds = blocksOf(state.t).map(b=>b.id);
  const oldLeague = state.matches.filter(m=>m.stage==="league");
  const fresh = buildLeagueMatches(state.t.id, state.teams, blockIds, !!cfgOf(state.t).doubleRound);
  fresh.forEach(m=> m.org_id = state.user.id);
  try{
    // 変更したチーム名やブロックを先に保存
    await saveTeams(true);
    if(oldLeague.length) await DB.remove("gn_matches", oldLeague.map(m=>m.id));
    if(fresh.length) await DB.upsert("gn_matches", fresh.map(stripMatch));
    state.matches = state.matches.filter(m=>m.stage!=="league").concat(fresh);
    toast("対戦カードを作り直しました"); go("t");
  }catch(e){ console.error(e); toast("作り直せませんでした: "+(e.message||e)); }
}
function editPlayers(id, text){
  const t = state.teams.find(x=>x.id===id); if(!t) return;
  const old = t.players || [];
  t.players = text.split("\n").map(parseMemberLine).filter(Boolean).map(r=>{
    const prev = old.find(p=> p.name===r.name);       // 既にいる選手はIDを引き継ぐ（記録が消えないように）
    return { id: prev?.id || uid(), memberId: prev?.memberId || null,
             no:r.no, name:r.name, pos:r.pos, grade:r.grade };
  });
  t._dirty = true;
}
async function saveTeams(silent){
  const dirty = state.teams.filter(t=>t._dirty);
  if(!dirty.length){ if(!silent){ toast("変更はありません"); go("t"); } return; }
  try{
    await DB.upsert("gn_teams", dirty.map(t=>{
      const { id,tournament_id,org_id,name,grp,seed,sort_order,players,club_id,crest } = t;
      return { id,tournament_id,org_id,name,grp,seed,sort_order,players,club_id,crest:crest||null };
    }));
    dirty.forEach(t=>delete t._dirty);
    if(!silent){ toast("保存しました"); go("t"); }
  }catch(e){ console.error(e); toast("保存できませんでした: "+(e.message||e)); }
}

/* ==========================================================================
   台帳（年度をまたいで残るチーム・選手）
   ========================================================================== */
const clubById   = id => state.clubs.find(c=>c.id===id) || null;
const membersOf  = (clubId, withGrads) => state.members
    .filter(m=> m.club_id===clubId && (withGrads || m.status!=="graduated"))
    .sort((a,b)=> (a.no??999)-(b.no??999) || (a.sort_order||0)-(b.sort_order||0)
                || String(a.name).localeCompare(String(b.name),"ja"));

/* 全データのバックアップ（JSONで書き出し・団体の管理者が手元に保存する用） */
async function doBackupExport(){
  if(!state.user) return;
  toast("バックアップを準備しています…");
  try{
    const data = await DB.exportBackup(state.user.id);
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type:"application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `大会ベース_バックアップ_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("バックアップをダウンロードしました");
  }catch(e){
    toast("バックアップに失敗しました："+(e.message||e));
  }
}

/* バックアップからの復元（ファイルを選ぶ→内容を確認→復元） */
function doBackupImport(){
  if(!state.user) return;
  const input = document.createElement("input");
  input.type = "file"; input.accept = "application/json";
  input.onchange = async ()=>{
    const f = input.files && input.files[0]; if(!f) return;
    if(f.size > 30*1024*1024) return toast("ファイルが大きすぎます");
    let data;
    try{ data = JSON.parse(await f.text()); }
    catch(e){ return toast("JSONファイルとして読み込めませんでした"); }
    const c = { t:(data.tournaments||[]).length, tm:(data.teams||[]).length, mt:(data.matches||[]).length,
      cl:(data.clubs||[]).length, mb:(data.members||[]).length };
    const ok = confirm(
      `このファイルの内容で復元します。\n\n大会 ${c.t}件・チーム ${c.tm}件・試合 ${c.mt}件\n台帳チーム ${c.cl}件・台帳選手 ${c.mb}件\n\n`+
      `今ログインしている団体（${state.user.code}）のデータとして復元されます。\n`+
      `IDが一致するデータは上書きされます。よろしいですか？`);
    if(!ok) return;
    toast("復元しています…");
    try{
      await DB.importBackup(data, state.user.id);
      await Promise.all([reloadRoster(), reloadList()]);
      toast("復元しました");
      render();
    }catch(e){ toast("復元できませんでした: "+(e.message||e)); }
  };
  input.click();
}

function viewRoster(){
  const year = orgYear();
  return topbar({ title:"チーム・選手の台帳", sub:`${year}年度`, back:"go('home')" })
  + `<div class="screen">
    <p class="lead">年度の初めにチームと選手を登録しておくと、大会をつくるときに呼び出せます。学年は年度が変わるときにまとめて上げられます。</p>
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
        <div><b style="font-size:19px">${year}年度</b>
          <div class="hint" style="margin:2px 0 0">${year}年4月 〜 ${year+1}年3月</div></div>
        <button class="btn sm sec" onclick="openPromoteSheet()">新年度にする</button>
      </div>
    </div>
    <div class="block-label">チーム（${state.clubs.length}）</div>
    ${state.clubs.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),"ja")).map(c=>{
      const n = membersOf(c.id).length;
      const g = state.members.filter(m=>m.club_id===c.id && m.status==="graduated").length;
      return `<button class="pick" onclick="openClub('${c.id}')">
        <span style="min-width:0;display:flex;align-items:center;gap:8px;flex:1">
          ${c.crest?`<img src="${c.crest}" alt="" style="width:34px;height:34px;object-fit:contain;border-radius:6px;background:#fff;flex:0 0 auto">`:""}
          <span style="min-width:0"><span style="display:block">${esc(c.name)}</span>
          <span class="meta">${esc(CATEGORIES[c.category]?.label||"")}・在籍 ${n}名${g?`（卒業 ${g}名）`:""}</span></span>
        </span>
        <span class="chev">›</span></button>`;
    }).join("") || `<div class="empty">まだチームがありません。</div>`}
    <button class="btn" onclick="addClub()">＋ チームを追加</button>
    <div class="btnrow" style="margin-top:6px">
      <button class="btn sec sm" style="flex:1" onclick="openClubBulkAdd()">📋 チーム名をまとめて作る</button>
      <button class="btn sec sm" style="flex:1" onclick="openClubEntryLinks()">📨 記入リンクを配る</button>
    </div>
    <p class="hint">各チームに「記入リンク」を配ると、チームがログイン不要でチーム名・選手を登録できます（初年度の登録に便利）。</p>

    <div class="block-label" style="margin-top:22px">会場（${state.venues.length}）</div>
    ${state.venues.length ? `<div class="card">
      ${state.venues.slice().sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)).map(v=>`
        <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--line)">
          <button class="pick" style="flex:1;padding:4px 0" onclick="renameVenue('${v.id}')">${esc(v.name)}</button>
          <button class="btn ghost sm" onclick="removeVenue('${v.id}')">削除</button>
        </div>`).join("")}
    </div>` : `<div class="empty">まだ会場がありません。</div>`}
    <button class="btn sec sm" style="width:100%;margin-top:6px" onclick="addVenue()">＋ 会場を追加</button>
    <p class="hint">ここに登録した会場は、結果入力画面の「会場」欄で候補として選べるようになります（自由入力も引き続きできます）。</p>

    <button class="btn ghost sm" style="width:100%;margin-top:14px" onclick="doBackupExport()">🗄 全データをバックアップ（ダウンロード）</button>
    <p class="hint">大会・チーム・選手・試合結果など、この団体の全データを1つのファイルに書き出します。月に1回など決まったタイミングでダウンロードし、パソコンやクラウドストレージに保存しておくことをおすすめします。<b>選手の氏名・記入コードなど個人情報や秘密情報を含むファイルです。厳重に保管し、他人に渡さないでください。</b></p>
    <button class="btn ghost sm" style="width:100%;margin-top:6px" onclick="doBackupImport()">♻️ バックアップから復元する</button>
    <p class="hint">上のバックアップファイルを選ぶと、その内容でデータを復元します。<b>今あるデータの一部が上書きされる場合があります</b>（データが消えてしまったときの回復用です。普段は使いません）。</p>
  </div>`;
}
/* チーム名をまとめて作る（記入リンクを配る前の枠づくり） */
function openClubBulkAdd(){
  const el = document.createElement("div"); el.className="modal";
  el.innerHTML = `<div class="sheet">
    <h3>チーム名をまとめて作る</h3>
    <p class="hint" style="margin-bottom:8px">1行に1チーム名。ここで作った枠に「記入リンク」を出して各チームに配れます。区分はあとで各チームが直せます。</p>
    <textarea class="in" id="cba-tx" style="min-height:150px" placeholder="さくら小学校
みどりFC
第三小学校"></textarea>
    <label class="f">区分（とりあえずの初期値）</label>
    <div class="seg" id="cba-cat">${["elem","jhs","hs","univ"].map((k,i)=>
      `<button class="${i===0?"on":""}" data-v="${k}">${esc(CATEGORIES[k].label)}</button>`).join("")}</div>
    <div class="btnrow">
      <button class="btn ghost" onclick="this.closest('.modal').remove()">やめる</button>
      <button class="btn" id="cba-ok">作る</button>
    </div>
  </div>`;
  document.body.appendChild(el);
  let cat="elem";
  el.querySelectorAll("#cba-cat button").forEach(b=> b.onclick=()=>{
    el.querySelectorAll("#cba-cat button").forEach(x=>x.classList.remove("on"));
    b.classList.add("on"); cat=b.dataset.v; });
  $("#cba-ok").onclick = async ()=>{
    const names = $("#cba-tx").value.split("\n").map(s=>s.trim()).filter(Boolean);
    if(!names.length) return toast("チーム名を入れてください");
    names.forEach(nm=> state.clubs.push({ id:uid(), org_id:state.user.id, name:nm,
      category:cat, regions:[], crest:null, note:null, _dirty:true }));
    el.remove(); await saveRoster(true); toast(`${names.length}チームを作りました`);
  };
}

function viewClub(){
  const c = clubById(state.clubId);
  if(!c) return topbar({title:"チーム", back:"go('roster')"}) + `<div class="empty">見つかりません。</div>`;
  const cat = CATEGORIES[c.category] || CATEGORIES.none;
  const ms = membersOf(c.id, state.showGrads);
  const grads = state.members.filter(m=>m.club_id===c.id && m.status==="graduated").length;

  const row = m=>{
    const isG = m.status==="graduated";
    return `<tr style="${isG?"opacity:.5":""}">
      <td><input class="in rt-no" style="text-align:center" type="number" inputmode="numeric"
        value="${m.no??""}" onchange="editMember('${m.id}','no',this.value===''?null:+this.value)"></td>
      <td style="text-align:left"><input class="in" style="padding:7px" value="${esc(m.name)}" title="${esc(m.name)}"
        onchange="editMember('${m.id}','name',this.value)"></td>
      <td style="text-align:left"><input class="in" style="padding:7px" value="${esc(m.prev_team||'')}" title="${esc(m.prev_team||'')}"
        placeholder="前所属" onchange="editMember('${m.id}','prev_team',this.value||null)"></td>
      ${cat.max?`<td><select class="in" style="padding:7px" onchange="editMember('${m.id}','grade',+this.value)">
        <option value="0">-</option>
        ${Array.from({length:cat.max},(_,i)=>i+1).map(g=>
          `<option value="${g}" ${m.grade===g?"selected":""}>${g}${cat.suffix}</option>`).join("")}
      </select></td>`:""}
      <td><select class="in" style="padding:7px" onchange="editMember('${m.id}','pos',this.value||null)">
        <option value="">-</option>
        ${POSITIONS.map(p=>`<option value="${p}" ${m.pos===p?"selected":""}>${p}</option>`).join("")}
      </select></td>
      <td style="white-space:nowrap">
        <button class="del" style="color:${isG?"var(--accent)":"var(--bad)"};font-size:11px;font-weight:700;padding:4px 3px"
        onclick="${isG?`unGraduate('${m.id}')`:`removeMember('${m.id}')`}">${isG?"復帰":"削除"}</button></td>
    </tr>`;
  };

  return topbar({ title:c.name, sub:`${cat.label}・${orgYear()}年度`, back:"go('roster')" })
  + `<div class="screen">
    <div class="card">
      <label class="f">チーム名</label>
      <input class="in" value="${esc(c.name)}" onchange="editClub('${c.id}','name',this.value)">
      <label class="f">校章・エンブレム（任意）</label>
      <div style="display:flex;align-items:center;gap:12px">
        ${c.crest?`<img src="${c.crest}" alt="校章" style="width:56px;height:56px;object-fit:contain;border:1px solid var(--line);border-radius:8px;background:#fff">`:`<div style="width:56px;height:56px;border:1px dashed var(--line);border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--sub);font-size:11px">なし</div>`}
        <div>
          <label class="btn sec sm" style="width:auto;cursor:pointer;display:inline-block">画像を選ぶ<input type="file" accept="image/*" style="display:none" onchange="setClubCrestFromInput('${c.id}',this)"></label>
          ${c.crest?`<button class="btn ghost sm" style="width:auto;margin-left:6px" onclick="clearClubCrest('${c.id}')">消す</button>`:""}
        </div>
      </div>
      <label class="f">区分（卒業の判定に使います）</label>
      <div class="seg">${Object.entries(CATEGORIES).map(([k,v])=>
        `<button class="${c.category===k?"on":""}" onclick="editClub('${c.id}','category','${k}');render()">${esc(v.label)}</button>`).join("")}</div>

      <label class="f">出場する大会の規模（あてはまるものを選ぶ・複数OK）</label>
      <div class="seg">${Object.entries(SCOPES).map(([k,v])=>
        `<button class="${(c.regions||[]).includes(k)?"on":""}" onclick="toggleClubRegion('${c.id}','${k}');render()">${esc(v.label)}</button>`).join("")}</div>
      <p class="hint">全国・都道府県・地域のどの大会に出るか。重ねて選べます（例：全国＋都道府県）。大会をつくるとき、ここで選んだ規模に合うチームだけが呼び出せます。</p>
    </div>

    <div class="block-label">選手（${membersOf(c.id).length}名）</div>
    ${ms.length ? `<div class="tblwrap"><table class="rostertbl">
      <thead><tr><th style="width:52px">番号</th><th style="text-align:left">氏名</th><th style="text-align:left">前所属</th>${cat.max?`<th style="width:76px">学年</th>`:""}<th style="width:70px">位置</th><th style="width:48px"></th></tr></thead>
      <tbody>${ms.map(row).join("")}</tbody></table></div>`
    : `<div class="empty">まだ選手がいません。</div>`}

    <div class="btnrow">
      <button class="btn sec sm" style="flex:1" onclick="addMember('${c.id}')">＋ 1人ずつ追加</button>
      <button class="btn sec sm" style="flex:1" onclick="openBulkSheet('${c.id}')">📋 まとめて貼り付け</button>
    </div>
    ${grads?`<div class="btnrow"><button class="btn ghost sm" onclick="state.showGrads=!state.showGrads;render()">
      ${state.showGrads?"卒業した選手をかくす":`卒業した選手を見る（${grads}名）`}</button></div>`:""}

    <button class="btn" style="margin-top:14px" onclick="saveRoster()">保存する</button>
    <div class="btnrow"><button class="btn danger sm" onclick="removeClub('${c.id}')">このチームを台帳から消す</button></div>
  </div>`;
}

/* --- 編集 --- */
function editClub(id,k,v){
  const c = clubById(id); if(!c) return;
  c[k] = v; c._dirty = true;
}
/* 出場する大会の規模（全国／都道府県／地域）を複数トグル */
function toggleClubRegion(id, key){
  const c = clubById(id); if(!c) return;
  const arr = Array.isArray(c.regions) ? c.regions.slice() : [];
  const i = arr.indexOf(key);
  if(i>=0) arr.splice(i,1); else arr.push(key);
  c.regions = arr; c._dirty = true;
}
/* 画像を小さくして dataURL に（校章など）。max は長辺のピクセル */
function readImageResized(file, max, cb){
  if(!file){ cb(null); return; }
  const rd = new FileReader();
  rd.onload = ()=>{
    const img = new Image();
    img.onload = ()=>{
      const s = Math.min(1, max/Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width*s)), h = Math.max(1, Math.round(img.height*s));
      const cv = document.createElement("canvas"); cv.width=w; cv.height=h;
      cv.getContext("2d").drawImage(img, 0, 0, w, h);
      try{ cb(cv.toDataURL("image/png")); }catch(e){ toast("画像を読み込めませんでした"); }
    };
    img.onerror = ()=> toast("画像を読み込めませんでした");
    img.src = rd.result;
  };
  rd.readAsDataURL(file);
}
/* 台帳チームの校章（管理側の編集画面用） */
function setClubCrestFromInput(clubId, input){
  const f = input.files && input.files[0]; if(!f) return;
  if(f.size > 6*1024*1024) return toast("画像が大きすぎます（6MBまで）");
  readImageResized(f, 128, durl=>{ const c=clubById(clubId); if(!c) return; c.crest=durl; c._dirty=true; render(); });
}
function clearClubCrest(clubId){ const c=clubById(clubId); if(!c) return; c.crest=null; c._dirty=true; render(); }
function editMember(id,k,v){
  const m = state.members.find(x=>x.id===id); if(!m) return;
  m[k] = (k==="grade" && !v) ? null : v; m._dirty = true;
}
function addClub(){
  const name = prompt("チーム名を入れてください");
  if(!name || !name.trim()) return;
  state.clubs.push({ id:uid(), org_id:state.user.id, name:name.trim(),
                     category:"elem", regions:[], crest:null, note:null, _dirty:true });
  saveRoster(true);
}
function addMember(clubId){
  const c = clubById(clubId);
  const n = membersOf(clubId).length;
  state.members.push({ id:uid(), org_id:state.user.id, club_id:clubId,
    name:"", kana:null, no:null, pos:null, prev_team:null, grade:CATEGORIES[c.category]?.max?1:null,
    status:"active", sort_order:n, note:null, _dirty:true });
  render();
}
function removeMember(id){
  const m = state.members.find(x=>x.id===id); if(!m) return;
  if(m.name && !confirm(`${m.name} を台帳から消します。よろしいですか？`)) return;
  state.members = state.members.filter(x=>x.id!==id);
  (state._deletedMembers = state._deletedMembers || []).push(id);
  render();
}
function unGraduate(id){
  const m = state.members.find(x=>x.id===id); if(!m) return;
  const c = clubById(m.club_id);
  m.status = "active";
  m.grade = CATEGORIES[c?.category]?.max || null;
  m._dirty = true; render();
}
/* 選手を別のチームへ移す（移籍・D4） */
function moveMember(id){
  const m = state.members.find(x=>x.id===id); if(!m) return;
  const others = state.clubs.filter(c=>c.id!==m.club_id);
  if(!others.length) return toast("移動先のチームがありません");
  const opts = others.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),"ja"))
    .map(c=>({ v:c.id, label:`${c.name}（${CATEGORIES[c.category]?.label||""}）` }));
  chooseModal(`${m.name} を移動する先`, opts, (pick)=>{
    if(!pick) return;
    m.club_id = pick.v; m._dirty = true;
    saveRoster(true).then(()=>{ toast(`${m.name} を移動しました`); render(); });
  });
}
async function removeClub(id){
  const c = clubById(id); if(!c) return;
  const n = state.members.filter(m=>m.club_id===id).length;
  if(!confirm(`「${c.name}」を台帳から消します。\n登録されている選手 ${n}名 も一緒に消えます。\n（過去の大会の記録は残ります）\n\nよろしいですか？`)) return;
  try{
    await DB.remove("gn_clubs", id);
    state.clubs = state.clubs.filter(x=>x.id!==id);
    state.members = state.members.filter(m=>m.club_id!==id);
    toast("消しました"); go("roster");
  }catch(e){ toast("消せませんでした: "+(e.message||e)); }
}

async function saveRoster(silent){
  const dc = state.clubs.filter(c=>c._dirty);
  const dm = state.members.filter(m=>m._dirty).filter(m=>String(m.name||"").trim());
  const dv = state.venues.filter(v=>v._dirty).filter(v=>String(v.name||"").trim());
  const del = state._deletedMembers || [];
  try{
    if(del.length){ await DB.remove("gn_members", del); state._deletedMembers = []; }
    if(dc.length) await DB.upsert("gn_clubs", dc.map(stripClub));
    if(dm.length) await DB.upsert("gn_members", dm.map(stripMember));
    if(dv.length) await DB.upsert("gn_venues", dv.map(stripVenue));
    if(state.org?._dirty){ await DB.upsert("gn_orgs", stripOrg(state.org)); delete state.org._dirty; }
    dc.forEach(c=>delete c._dirty); dm.forEach(m=>delete m._dirty); dv.forEach(v=>delete v._dirty);
    if(!silent) toast("保存しました");
    render();
  }catch(e){ console.error(e); toast("保存できませんでした: "+(e.message||e)); }
}
const stripClub  = c => ({ id:c.id, org_id:c.org_id, name:c.name, category:c.category, regions:Array.isArray(c.regions)?c.regions:[], crest:c.crest||null, note:c.note });
const stripMember= m => ({ id:m.id, org_id:m.org_id, club_id:m.club_id, name:m.name, kana:m.kana,
                           no:m.no, pos:m.pos, grade:m.grade, prev_team:m.prev_team||null,
                           status:m.status, sort_order:m.sort_order, note:m.note });
const stripOrg   = o => ({ id:o.id, name:o.name, year:o.year });
const stripVenue = v => ({ id:v.id, org_id:v.org_id, name:v.name, note:v.note||null, sort_order:v.sort_order||0 });

/* --- 会場リスト --- */
function addVenue(){
  const name = prompt("会場名を入れてください（例：第1グラウンド）");
  if(!name || !name.trim()) return;
  const maxOrder = state.venues.reduce((mx,v)=>Math.max(mx, v.sort_order||0), 0);
  state.venues.push({ id:uid(), org_id:state.user.id, name:name.trim(), note:null, sort_order:maxOrder+1, _dirty:true });
  saveRoster(true);
}
function renameVenue(id){
  const v = state.venues.find(x=>x.id===id); if(!v) return;
  const name = prompt("会場名を変更", v.name);
  if(!name || !name.trim() || name.trim()===v.name) return;
  v.name = name.trim(); v._dirty = true;
  saveRoster(true);
}
async function removeVenue(id){
  const v = state.venues.find(x=>x.id===id); if(!v) return;
  if(!confirm(`「${v.name}」を会場リストから消します。\n（すでに試合に入力済みの会場名はそのまま残ります）\n\nよろしいですか？`)) return;
  try{
    await DB.remove("gn_venues", id);
    state.venues = state.venues.filter(x=>x.id!==id);
    toast("消しました"); render();
  }catch(e){ toast("消せませんでした: "+(e.message||e)); }
}

/* --- まとめて貼り付け --- */
function parseMemberLine(line){
  if(/^(番号|No\.?|氏名|名前)([\t,\s]|$)/i.test(line.trim())) return null;  // 見出し行はとばす
  let no=null, name="", kana=null, grade=null, pos=null, prev_team=null;
  if(/[\t,]/.test(line)){                                  // Excelから貼った場合は列の位置で読む（番号／氏名／前所属／学年／位置）
    const p = line.split(/[\t,]/).map(s=>s.trim());
    no        = /^\d{1,3}$/.test(p[0]||"") ? num(p[0]) : null;
    name      = p[1] || p[0] || "";
    prev_team = p[2] || null;
    grade     = /^\d/.test(p[3]||"") ? num(p[3]) : null;
    pos       = POSITIONS.includes(String(p[4]||"").toUpperCase()) ? p[4].toUpperCase() : null;
  }else{                                                   // 「10 山田太郎 6 FW」のような書き方（前所属はスペース区切りでは読みません）
    const rest = [];
    line.split(/\s+/).filter(Boolean).forEach(x=>{
      if(no===null && /^\d{1,3}$/.test(x)){ no = num(x); return; }
      if(pos===null && POSITIONS.includes(x.toUpperCase())){ pos = x.toUpperCase(); return; }
      if(grade===null && /^\d年?$/.test(x)){ grade = num(x); return; }
      rest.push(x);
    });
    name = rest.join(" ");
  }
  return name.trim() ? { no, name:name.trim(), kana, grade, pos, prev_team } : null;
}

function openBulkSheet(clubId){
  const c = clubById(clubId);
  const cat = CATEGORIES[c.category] || CATEGORIES.none;
  const el = document.createElement("div");
  el.className = "modal";
  el.innerHTML = `<div class="sheet">
    <h3>選手をまとめて登録</h3>
    <p class="hint" style="margin-bottom:8px">1行に1人。<b>Excelからそのまま貼り付け</b>できます。列の順番は<br>
    <b>番号 / 氏名 / 前所属 / 学年 / 位置</b>（タブ・カンマ区切り）。<br>
    手で打つときは「<b>10 山田太郎 6 FW</b>」のように、番号・名前・学年・位置をスペースで区切ってください（この書き方では前所属は入りません）。番号や学年は無くてもかまいません。40人・100人でも一度に貼れます。</p>
    <textarea class="in" id="bulk-tx" style="min-height:180px" placeholder="10	山田太郎	さくら少年団	6	FW
1	佐藤花子	みどりSC	5	GK
7	鈴木一郎		4"></textarea>
    <label class="f">入れ方</label>
    <div class="seg" id="bulk-mode">
      <button class="on" data-v="add">いまの名簿に足す</button>
      <button data-v="replace">いまの名簿を入れ替える</button>
    </div>
    <div class="btnrow">
      <button class="btn ghost" onclick="this.closest('.modal').remove()">やめる</button>
      <button class="btn" id="bulk-ok">登録する</button>
    </div>
  </div>`;
  document.body.appendChild(el);
  let mode = "add";
  el.querySelectorAll("#bulk-mode button").forEach(b=> b.onclick = ()=>{
    el.querySelectorAll("#bulk-mode button").forEach(x=>x.classList.remove("on"));
    b.classList.add("on"); mode = b.dataset.v;
  });
  $("#bulk-ok").onclick = async ()=>{
    const rows = $("#bulk-tx").value.split("\n").map(parseMemberLine).filter(Boolean);
    if(!rows.length){ toast("読み取れる行がありませんでした"); return; }
    if(mode==="replace"){
      const old = state.members.filter(m=>m.club_id===clubId && m.status!=="graduated");
      (state._deletedMembers = state._deletedMembers || []).push(...old.map(m=>m.id));
      state.members = state.members.filter(m=>!(m.club_id===clubId && m.status!=="graduated"));
    }
    const base = membersOf(clubId).length;
    rows.forEach((r,i)=> state.members.push({
      id:uid(), org_id:state.user.id, club_id:clubId,
      name:r.name, kana:r.kana, no:r.no, pos:r.pos, prev_team:r.prev_team||null,
      grade: cat.max ? (r.grade && r.grade<=cat.max ? r.grade : null) : null,
      status:"active", sort_order:base+i, note:null, _dirty:true }));
    el.remove();
    await saveRoster(true);
    toast(`${rows.length}名を登録しました`);
  };
}

/* --- 新年度にする（進級・卒業） --- */
function promotionPreview(){
  const up = [], grad = [], stay = [];
  state.members.filter(m=>m.status!=="graduated").forEach(m=>{
    const cat = CATEGORIES[clubById(m.club_id)?.category] || CATEGORIES.none;
    if(!cat.max || !m.grade){ stay.push(m); return; }
    if(m.grade >= cat.max) grad.push(m); else up.push(m);
  });
  return { up, grad, stay };
}
function openPromoteSheet(){
  const year = orgYear();
  const { up, grad, stay } = promotionPreview();
  const byClub = {};
  grad.forEach(m=>{ const c = clubById(m.club_id); (byClub[c?.name||"—"] = byClub[c?.name||"—"]||[]).push(m.name); });
  const el = document.createElement("div");
  el.className = "modal";
  el.innerHTML = `<div class="sheet">
    <h3>${year}年度 → ${year+1}年度</h3>
    <p class="hint" style="margin-bottom:10px">全員の学年を1つ上げ、最終学年の選手を卒業にします。<b>この操作はもとに戻せません</b>（卒業した選手は台帳に残り、1人ずつ「復帰」できます）。</p>
    <div class="card" style="margin-bottom:8px">
      <div class="evrow"><span class="ic">⬆️</span><span class="tx">学年が1つ上がる</span><span class="mi">${up.length}名</span></div>
      <div class="evrow"><span class="ic">🎓</span><span class="tx">卒業になる</span><span class="mi">${grad.length}名</span></div>
      ${stay.length?`<div class="evrow"><span class="ic">—</span><span class="tx">学年なし（そのまま）</span><span class="mi">${stay.length}名</span></div>`:""}
    </div>
    ${grad.length?`<div class="block-label">卒業になる選手</div>
      ${Object.entries(byClub).map(([cn,names])=>`<div class="card" style="margin-bottom:8px">
        <b style="font-size:14px">${esc(cn)}</b>
        <div class="chiprow">${names.map(n=>`<span class="chip">${esc(n)}</span>`).join("")}</div></div>`).join("")}`:""}
    <div class="btnrow">
      <button class="btn ghost" onclick="this.closest('.modal').remove()">やめる</button>
      <button class="btn" id="pr-ok">${year+1}年度にする</button>
    </div>
  </div>`;
  document.body.appendChild(el);
  $("#pr-ok").onclick = async ()=>{
    const { up, grad } = promotionPreview();
    up.forEach(m=>{ m.grade++; m._dirty = true; });
    grad.forEach(m=>{ m.status = "graduated"; m._dirty = true; });
    state.org = state.org || { id:state.user.id, name:state.user.code, year };
    state.org.year = year + 1; state.org._dirty = true;
    el.remove();
    await saveRoster(true);
    toast(`${year+1}年度になりました`);
  };
}

/* --- 大会のチームに台帳から入れる --- */
function openPickClubSheet(teamId){
  const t = state.teams.find(x=>x.id===teamId); if(!t) return;
  if(!state.clubs.length){ toast("台帳にチームがありません"); return; }
  const el = document.createElement("div");
  el.className = "modal";
  el.innerHTML = `<div class="sheet">
    <h3>台帳から選手を入れる</h3>
    <p class="hint" style="margin-bottom:8px">「${esc(t.name)}」のエントリーとして、台帳のチームから選手を選んで入れます。背番号はこの大会だけ書き換えられます。</p>
    ${state.clubs.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),"ja")).map(c=>{
      const n = membersOf(c.id).length;
      return `<button class="pick" onclick="this.closest('.modal').remove();openClubRosterPicker('${teamId}','${c.id}')">
        <span style="min-width:0"><span style="display:block">${esc(c.name)}</span>
        <span class="meta">${esc(CATEGORIES[c.category]?.label||"")}・${n}名</span></span>
        <span class="chev">›</span></button>`;
    }).join("")}
    <div class="btnrow"><button class="btn ghost" onclick="this.closest('.modal').remove()">やめる</button></div>
  </div>`;
  document.body.appendChild(el);
}
/* 台帳のチーム在籍選手（多いときは150名等）から、この大会に登録する選手だけを選ぶ。
   大会設定の「登録人数の上限」があればそこまで、無ければ全員が初期選択（従来どおり）。
   同じ選手を別チーム（別カテゴリー等）にも重複して登録できる＝ここでは止めない・見えるようにするだけ。 */
function openClubRosterPicker(teamId, clubId){
  const t = state.teams.find(x=>x.id===teamId); if(!t) return;
  const c = clubById(clubId); if(!c) return;
  const limit = Math.max(0, num(cfgOf(state.t).registerLimit)||0);   // 0=無制限
  const members = membersOf(clubId).slice().sort((a,b)=>(a.no??999)-(b.no??999)||String(a.name).localeCompare(String(b.name),"ja"));
  if(!members.length) return toast("このチームには在籍選手がいません");
  const already = new Set((t.players||[]).filter(p=>p.memberId).map(p=>p.memberId));
  const hadAny = (t.players||[]).length>0 && t.club_id===clubId;
  const usedElsewhere = new Map();   // memberId -> [team names]（この大会の他チームでの登録状況）
  state.teams.forEach(x=>{
    if(x.id===teamId) return;
    (x.players||[]).forEach(p=>{ if(p.memberId){
      if(!usedElsewhere.has(p.memberId)) usedElsewhere.set(p.memberId, []);
      usedElsewhere.get(p.memberId).push(x.name);
    }});
  });
  // 同じ台帳から別チーム（花巻東B等）が既に選手を選んでいるときは、そちらは0人から選び始める
  // （そうしないと全員初期選択のままだと同じ150人を丸ごと重複登録してしまいやすいため）
  const siblingHasPicked = state.teams.some(x=>x.id!==teamId && x.club_id===clubId && (x.players||[]).length>0);
  const selected = new Set(hadAny ? [...already] : ((limit>0 || siblingHasPicked) ? [] : members.map(m=>m.id)));
  const el = document.createElement("div");
  el.className = "modal";
  el.innerHTML = `<div class="sheet">
    <h3>${esc(c.name)} から選手を選ぶ</h3>
    <label class="f" style="margin-top:0">背番号</label>
    <div class="seg" id="crp-nomode">
      <button class="on" data-v="keep">台帳の番号を引き継ぐ</button>
      <button data-v="renumber">1番から振り直す</button>
    </div>
    <input class="in" id="crp-filter" placeholder="🔍 名前で絞り込み" style="margin-bottom:8px">
    <p class="hint" id="crp-count" style="margin-bottom:8px"></p>
    <div id="crp-list" style="max-height:50vh;overflow-y:auto"></div>
    <div class="btnrow" style="margin-top:8px">
      <button class="btn ghost sm" id="crp-all">全員選択</button>
      <button class="btn ghost sm" id="crp-none">全員解除</button>
    </div>
    <div class="btnrow" style="margin-top:8px">
      <button class="btn ghost" onclick="this.closest('.modal').remove()">やめる</button>
      <button class="btn" id="crp-ok">この${limit>0?`${limit}`:""}名で決定</button>
    </div>
  </div>`;
  document.body.appendChild(el);
  let noMode = "keep";
  el.querySelectorAll("#crp-nomode button").forEach(b=> b.onclick=()=>{
    el.querySelectorAll("#crp-nomode button").forEach(x=>x.classList.remove("on"));
    b.classList.add("on"); noMode = b.dataset.v;
  });
  const countEl = $("#crp-count");
  const syncCount = ()=>{ countEl.textContent = limit>0 ? `選択中：${selected.size} / 上限${limit}名` : `選択中：${selected.size}名`; };
  const rowHTML = m=>{
    const others = usedElsewhere.get(m.id);
    return `<label class="lurow" style="cursor:pointer" data-name="${esc(m.name)}">
      <input type="checkbox" class="crp-chk" data-id="${m.id}" ${selected.has(m.id)?"checked":""} style="width:18px;height:18px;flex:0 0 auto">
      <span class="lunm">${m.no?`<b>${esc(String(m.no))}</b> `:""}${esc(m.name)}${m.grade?` <small>${esc(String(m.grade))}年</small>`:""}</span>
      ${others?.length?`<span class="pill" style="flex:0 0 auto">他: ${esc(others.join("・"))}</span>`:""}
    </label>`;
  };
  const renderList = ()=>{ $("#crp-list").innerHTML = members.map(rowHTML).join(""); bindRows(); syncCount(); };
  const bindRows = ()=>{
    el.querySelectorAll(".crp-chk").forEach(cb=> cb.onchange = ()=>{
      const id = cb.dataset.id;
      if(cb.checked){
        if(limit>0 && selected.size>=limit){ cb.checked=false; toast(`上限${limit}名までです`); return; }
        selected.add(id);
      } else selected.delete(id);
      syncCount();
    });
  };
  renderList();
  $("#crp-filter").oninput = ()=>{
    const q = $("#crp-filter").value.trim();
    el.querySelectorAll("#crp-list > label").forEach(row=>{
      row.style.display = !q || row.dataset.name.includes(q) ? "" : "none";
    });
  };
  $("#crp-all").onclick = ()=>{
    members.forEach(m=>{ if(limit===0 || selected.size<limit) selected.add(m.id); });
    if(limit>0 && members.length>limit) toast(`上限${limit}名までです`);
    renderList();
  };
  $("#crp-none").onclick = ()=>{ selected.clear(); renderList(); };
  $("#crp-ok").onclick = ()=>{
    if(!selected.size) return toast("1人も選ばれていません");
    t.club_id = clubId;
    t.crest = c.crest || null;
    t.players = members.filter(m=>selected.has(m.id)).map((m,i)=>({
      id:m.id, memberId:m.id, no: noMode==="renumber" ? i+1 : m.no, name:m.name, pos:m.pos, grade:m.grade }));
    if(!t.name || /^チーム/.test(t.name)) t.name = c.name;
    t._dirty = true;
    el.remove();
    toast(`${c.name} から ${t.players.length}名を入れました`);
    render();
  };
}

/* ==========================================================================
   公式記録（JFA様式・A4縦）
   ・罫線とラベルの位置は、いただいた様式PDFから座標をそのまま起こしています
   ・用紙の枠がそのまま入力欄になり、そのまま印刷・PDF保存できます
   ========================================================================== */
const SHEET = { W:595.28, H:842,
  h:[[760,28.4,568.1],[747.4,28.4,568.1],[734.7,28.4,568.1],[722.1,28.4,568.1],[709.5,28.4,568.1],
     [696.9,230.7,365.7],[684.3,230.7,365.7],[671.7,230.7,365.7],[659.1,180.1,416.3],[646.4,28.4,568.1],
     [633.8,28.4,163.3],[633.8,433.1,568.1],[621.2,28.4,568.1],[608.6,28.4,568.1],[596,28.4,568.1],
     [583.4,28.4,568.1],[570.8,28.4,568.1],[558.1,28.4,568.1],[545.5,28.4,568.1],[532.9,28.4,568.1],
     [520.3,28.4,568.1],[507.7,28.4,568.1],[495.1,28.4,568.1],[482.5,28.4,568.1],[469.8,28.4,568.1],
     [457.2,28.4,568.1],[444.6,28.4,568.1],[432,28.4,568.1],[419.4,28.4,568.1],[406.8,28.4,568.1],
     [394.2,28.4,568.1],[381.5,28.4,568.1],[368.9,28.4,568.1],[356.3,28.4,568.1],[343.7,28.4,568.1],
     [331.1,28.4,197],[331.1,399.4,568.1],[318.5,28.4,568.1],[305.9,28.4,568.1],[293.2,28.4,568.1],
     [280.6,28.4,568.1],[268,28.4,568.1],[255.4,28.4,568.1],[242.8,28.4,568.1],[230.2,28.4,568.1],
     [217.6,28.4,568.1],[129.3,28.4,568.1],[116.6,28.4,568.1],[104,28.4,568.1],
     [91.4,28.4,568.1]],
  v:[[28.4,91.4,760],[45.2,368.9,633.8],[62.1,129.3,356.3],[68.8,709.5,747.4],[78.9,368.9,646.4],
     [78.9,230.2,356.3],[78.9,91.4,116.6],[95.8,747.4,760],[95.8,368.9,633.8],[95.8,230.2,356.3],
     [95.8,91.4,129.3],[112.7,368.9,633.8],[112.7,129.3,230.2],[129.5,368.9,633.8],[129.5,91.4,230.2],
     [136.3,709.5,747.4],[146.4,368.9,633.8],[163.3,368.9,646.4],[163.3,230.2,356.3],[163.3,91.4,129.3],
     [176.8,709.5,747.4],[180.1,368.9,709.5],[197,747.4,760],[197,91.4,368.9],[213.9,230.2,343.7],
     [230.7,659.1,709.5],[230.7,91.4,343.7],[244.2,709.5,747.4],[247.6,747.4,760],[247.6,230.2,343.7],
     [264.5,368.9,709.5],[264.5,230.2,343.7],[264.5,91.4,217.6],[281.3,368.9,646.4],[281.3,230.2,318.5],
     [284.7,709.5,747.4],[298.2,343.7,646.4],[298.2,91.4,217.6],[315.1,368.9,646.4],[315.1,230.2,318.5],
     [331.9,747.4,760],[331.9,368.9,709.5],[331.9,230.2,343.7],[331.9,91.4,217.6],[348.8,230.2,343.7],
     [352.2,709.5,747.4],[365.7,747.4,760],[365.7,659.1,709.5],[365.7,230.2,343.7],[365.7,91.4,217.6],
     [382.5,230.2,343.7],[392.7,722.1,747.4],[399.4,230.2,368.9],[399.4,91.4,217.6],[416.3,368.9,709.5],
     [433.1,368.9,646.4],[433.1,230.2,356.3],[450,368.9,633.8],[450,230.2,356.3],[460.1,722.1,747.4],
     [466.9,368.9,633.8],[466.9,230.2,356.3],[466.9,91.4,217.6],[483.7,368.9,633.8],[500.6,722.1,747.4],
     [500.6,368.9,633.8],[500.6,91.4,217.6],[517.5,368.9,646.4],[534.3,230.2,356.3],[534.3,91.4,217.6],
     [551.2,368.9,633.8],[568.1,91.4,760]],
  labels:[
    [278,775,"公式記録",12,1],
    [54,751,"日時",8],[206,751,"試合形式",8],[341,751,"会場",8],
    [32,739,"ﾏｯﾁｺﾐｯｼｮﾅｰ",6],[149,739,"主審",8],[252,739,"副審１",8],[360,739,"副審２",8],[464,739,"第４審判",8],
    [32,726,"運営責任者",7],[141,726,"記録担当",8],[256,726,"天候",8],[364,726,"気温",8],[472,726,"湿度",8],
    [45,713,"風",8],[145,713,"観客数",8],[248,713,"ピッチ(芝)",7],
    [290,700,"前半",8],[290,688,"後半",8],[283,676,"延長前半",7],[283,663,"延長後半",7],[293,650,"PK",8],
    /* メンバー表のヘッダー（No./時間/シュート/得点/選手名/番号/位置・延前延後）は
       セル中央そろえで memberHeaderHTML() が動的に描画（延長時のみ延前/延後） */
    [93,360,"警告・退場",8],[240,360,"監督",8],[341,360,"監督",8],[464,360,"警告・退場",8],
    [37,348,"時間",8],[65,348,"種別",6],[82,348,"番号",6],[118,348,"選手名",8],[172,348,"理由",8],
    [408,348,"時間",8],[436,348,"種別",6],[453,348,"番号",6],[489,348,"選手名",8],[543,348,"理由",8],
    [285,310,"シュート",7],[293,297,"GK",7],[293,284,"CK",7],[286,271,"直接FK",7],[286,259,"間接FK",7],
    [285,246,"(ｵﾌｻｲﾄﾞ)",6],[293,233,"PK",7],
    [32,221,"得点時間",7],[67,221,"得点チーム",7],[116,221,"No.",7],[151,221,"得点者",7],[201,221,"アシスト",7],
    [234,221,"得点経過　記録例： ～:ドリブル →:ゴロパス ↑:浮き球パス ×:混戦 S:シュート H:ヘディング",6],
    [45,120,"PKの経過",8],
    [31,76,"[試合時間]",8],[31,63,"[備考]",8],
  ],
};
"1,2,3,4,5,6,7,8,9,10,11,12,13,14".split(",").forEach((n,i)=>{
  SHEET.labels.push([[110,144,178,212,245,279,313,347,380,412,446,479,513,547][i],120,n,7]);
});

/* --- 行の位置（PDFのy座標） --- */
const ROW_PLAYER = Array.from({length:20},(_,i)=>[621.2-12.6*i, 621.2-12.6*(i+1)]);   // 先発11＋控え9
const ROW_CARD   = [[343.7,331.1],[331.1,318.5],[318.5,305.9],[305.9,293.2],[293.2,280.6],
                    [280.6,268],[268,255.4],[255.4,242.8],[242.8,230.2]];
const ROW_TOTAL  = [[318.5,305.9],[305.9,293.2],[293.2,280.6],[280.6,268],[268,255.4],[255.4,242.8],[242.8,230.2]];
const TOTAL_KEYS = ["shot","gk","ck","fk","ifk","off","pk"];
// チーム合計の列区切り（左から）：H＝延前/延後/後半/前半/計、A＝計/前半/後半/延前/延後（中央のシュート等ラベル欄281.3-315.1を挟んで左右対称）
const TOT_H = [199.9,216.18,232.46,248.74,265.02,281.3];
const TOT_A = [315.1,331.38,347.66,363.94,380.22,396.5];
const ROW_GOAL   = [[217.6,204.9],[204.9,192.3],[192.3,179.7],[179.7,167.1],[167.1,154.5],[154.5,141.9],[141.9,129.3]];
/* 得点経過の行は入った得点の数だけ動的に増やす（最低7・最大14）。同じ枠内を等分する。 */
const GOAL_TOP = 217.6, GOAL_BOT = 129.3;
function emptyGoalRow(){ return { time:"", team:"", no:"", scorer:"", assist:"", seq:Array(10).fill("") }; }
function goalRowCount(o){
  const filled = ((o&&o.goals)||[]).filter(g=> g.time||g.team||g.no||g.scorer||g.assist||(g.seq&&g.seq.some(x=>x)) ).length;
  let n = Math.max(7, filled);
  if(filled>=7) n = filled + 1;      // 満杯なら1行余分に空けておく
  return Math.min(14, Math.max(7, n));
}
function goalRows(o){
  const n = goalRowCount(o), h = (GOAL_TOP-GOAL_BOT)/n, rows = [];
  for(let i=0;i<n;i++) rows.push([GOAL_TOP-h*i, GOAL_TOP-h*(i+1)]);
  return rows;
}
const ROW_SCORE  = [[709.5,696.9],[696.9,684.3],[684.3,671.7],[671.7,659.1]];        // 前半/後半/延長前/延長後
const PK_CELLS   = [95.8,129.5,163.3,197,230.7,264.5,298.2,331.9,365.7,399.4,433.1,466.9,500.6,534.3,568.1];
const SEQ_CELLS  = [230.7,264.5,298.2,331.9,365.7,399.4,433.1,466.9,500.6,534.3,568.1];

/* --- official データの入れ物 --- */
function emptySide(){
  return { name:"", name2:"", pref:"", coach:"", pk:null,
    scores:[null,null,null,null],
    lineup:Array.from({length:20},()=>({memberId:null,no:"",name:"",pos:"",g:"",s1:"",s2:"",st:"",e1:"",e2:"",subNo:"",subTime:""})),
    cards:Array.from({length:9},()=>({time:"",kind:"",no:"",name:"",reason:""})),
    tot:Object.fromEntries(TOTAL_KEYS.map(k=>[k,["","","","",""]])),   // 0前半/1後半/2計/3延前/4延後
    pks:Array.from({length:14},()=>""),
  };
}
function emptyOfficial(){
  return { title:"", format:"", venue:"", datetime:"",
    commissioner:"", referee:"", ar1:"", ar2:"", fourth:"", admin:"", recorder:"",
    weather:"", temp:"", humid:"", wind:"", crowd:"", pitch:"",
    H:emptySide(), A:emptySide(),
    goals:Array.from({length:7},()=>({time:"",team:"",no:"",scorer:"",assist:"",seq:Array(10).fill("")})),
    timeText:"", note:"" };
}

/* --- パスで値を出し入れする --- */
function pget(o,path){ return path.split(".").reduce((a,k)=> a==null?a:a[k], o); }
function pset(o,path,v){
  const ks = path.split("."), last = ks.pop();
  let cur = o;
  ks.forEach(k=>{ if(cur[k]==null) cur[k] = /^\d+$/.test(k)?[]:{}; cur = cur[k]; });
  cur[last] = v;
}

/* ==========================================================================
   メンバー表（試合ごとの出場選手）
   ・台帳 → 大会エントリー → この試合の出場、と絞り込む「③番目の層」
   ・ここで選んだ顔ぶれを、公式記録のメンバー欄がそのまま取り込む
   ========================================================================== */
const POS_ORDER = { GK:0, DF:1, MF:2, FW:3 };
function byPosNo(a,b){ return (POS_ORDER[a.pos]??9)-(POS_ORDER[b.pos]??9) || (num(a.no)||99)-(num(b.no)||99); }
function byNo(a,b){ return (num(a.no)||99)-(num(b.no)||99); }

/* 試合にメンバー表が無ければ、大会エントリーから用意する */
function ensureLineups(m){
  if(!m.lineups) m.lineups = {};
  ["H","A"].forEach(side=>{
    const R = resolveSlot(m, side);
    const players = (teamById(R.id)?.players)||[];
    if(!m.lineups[side]){
      m.lineups[side] = { coach:"", players: players.map((p,i)=>({
        pid:p.id, memberId:p.memberId||null, no:p.no??"", name:p.name||"",
        pos:p.pos||"", grade:p.grade||null, role:"sub", captain:false, order:i })) };
    }
  });
  return m.lineups;
}
/* エントリーが後から変わったとき、追加・削除を反映する */
function syncLineup(side){
  const m = curMatchAny(); if(!m) return;
  const R = resolveSlot(m, side);
  const players = (teamById(R.id)?.players)||[];
  const lu = m.lineups[side];
  const has = new Set(lu.players.map(p=>p.pid));
  players.forEach(p=>{ if(!has.has(p.id)) lu.players.push({
    pid:p.id, memberId:p.memberId||null, no:p.no??"", name:p.name||"",
    pos:p.pos||"", grade:p.grade||null, role:"sub", captain:false, order:lu.players.length }); });
  const keep = new Set(players.map(p=>p.id));
  lu.players = lu.players.filter(p=> keep.has(p.pid));
  render(); toast("エントリーと合わせました");
}
function curMatchAny(){ return state.matches.find(x=>x.id===state.matchId); }
function orderedLineup(lu){
  const players = (lu && Array.isArray(lu.players)) ? lu.players : [];
  const st = players.filter(p=>p.role==="start").sort(byPosNo);
  const sb = players.filter(p=>p.role==="sub").sort(byNo);
  return { starters:st, subs:sb, out:players.filter(p=>p.role==="out") };
}

/* --- 編集画面 --- */
function viewLineup(){
  const m = curMatchAny();
  if(!m) return topbar({title:"メンバー表", back:"go('t')"}) + `<div class="empty">見つかりません。</div>`;
  ensureLineups(m);
  const side = state.lineupSide || "H";
  const H = resolveSlot(m,"H"), A = resolveSlot(m,"A");
  const lu = m.lineups[side];
  const { starters, subs, out } = orderedLineup(lu);
  const sp = sportOf(state.t);
  const need = sp===SPORTS.futsal ? 5 : 11;

  const teamId = side==="H" ? H.id : A.id;
  const suspHere = new Set();
  if(sp.cards){
    computeSuspensions().forEach(s=>{
      if(s.matches.some(x=>x.id===m.id)) suspHere.add(s.teamId+"/"+s.pid);
    });
  }
  const roleMap = { start:["スタメン","rl-start"], sub:["控え","rl-sub"], out:["外す","rl-out"] };
  const prow = p=>{
    const [lbl,cls] = roleMap[p.role]||roleMap.sub;
    const susp = suspHere.has(teamId+"/"+p.pid);
    return `<div class="lurow">
      <button class="rolepill ${cls}" onclick="cycleRole('${side}','${p.pid}')">${lbl}</button>
      <input class="in luno" type="number" inputmode="numeric" value="${p.no??""}"
        onchange="setLu('${side}','${p.pid}','no',this.value===''?'':+this.value)">
      <span class="lunm">${esc(p.name)}${p.grade?` <small>${esc(String(p.grade))}年</small>`:""}${susp?` <b style="color:var(--bad)" title="この試合は出場停止の対象です">⚠出停</b>`:""}</span>
      <select class="in lupos" onchange="setLu('${side}','${p.pid}','pos',this.value)">
        <option value="">-</option>${POSITIONS.map(x=>`<option ${p.pos===x?"selected":""}>${x}</option>`).join("")}
      </select>
      <button class="capbtn ${p.captain?"on":""}" onclick="setCaptain('${side}','${p.pid}')" title="キャプテン">C</button>
    </div>`;
  };
  const warn = starters.length!==need
    ? `<span style="color:var(--warn)">スタメン ${starters.length}／${need}</span>` : `スタメン ${starters.length}`;

  return `<div class="tourwrap">`
  + topbar({ title:"メンバー表", sub:`🏆 ${state.t.name} ・ ${H.label} vs ${A.label}`, back:"go('t')",
      act:`<button class="act" onclick="saveLineup()">保存</button>` })
  + `<div class="twrap">${tournamentSidebar("schedule")}<div class="tmain">
    <div class="team-switch">
      <button class="${side==="H"?"on":""}" onclick="state.lineupSide='H';render()">${esc(H.label||"ホーム")}</button>
      <button class="${side==="A"?"on":""}" onclick="state.lineupSide='A';render()">${esc(A.label||"アウェイ")}</button>
    </div>
    <div class="screen noprint">
      <p class="lead">この試合に出る選手を選びます。ボタンで「スタメン／控え／外す」を切り替え、背番号・位置・キャプテンを決めます。ここで作った顔ぶれは公式記録に取り込めます。</p>
      <div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div><b>${warn}</b> <span style="color:var(--sub)">・控え ${subs.length}</span></div>
        <button class="btn ghost sm" onclick="syncLineup('${side}')">エントリーと合わせる</button>
      </div>
      <label class="f">監督</label>
      <input class="in" value="${esc(lu.coach||"")}" onchange="setCoach('${side}',this.value)" placeholder="監督名">

      <div class="block-label">スタメン（${starters.length}）</div>
      ${starters.map(prow).join("") || `<div class="hint" style="padding:6px 2px">「控え」のボタンを押すとスタメンにできます。</div>`}
      <div class="block-label">控え（${subs.length}）</div>
      ${subs.map(prow).join("") || `<div class="hint" style="padding:6px 2px">なし</div>`}
      ${out.length?`<div class="block-label">外す（${out.length}）</div>${out.map(prow).join("")}`:""}
      ${!lu.players.length?`<div class="empty">この チームにエントリー選手がいません。<br>大会の「チーム・選手」画面で登録してください。</div>`:""}

      <button class="btn" style="margin-top:14px" onclick="saveLineup()">保存する</button>
      <div class="btnrow">
        <button class="btn sec sm" style="flex:1" onclick="window.print()">🖨 メンバー表を印刷</button>
        <button class="btn sec sm" style="flex:1" onclick="saveLineup(true).then(()=>openOfficial('${m.id}'))">📄 公式記録へ</button>
      </div>
    </div>
    ${lineupSheetHTML(m)}
  </div></div></div>`;
}

/* --- 操作 --- */
function luPlayer(side, pid){
  const m = curMatchAny(); return m?.lineups?.[side]?.players.find(p=>p.pid===pid);
}
function cycleRole(side, pid){
  const p = luPlayer(side, pid); if(!p) return;
  p.role = { sub:"start", start:"out", out:"sub" }[p.role] || "start";
  if(p.role!=="start") p.captain = false;
  render();
}
function setLu(side, pid, k, v){ const p = luPlayer(side, pid); if(p){ p[k]=v; } }
function setCoach(side, v){ const m=curMatchAny(); if(m?.lineups?.[side]) m.lineups[side].coach = v; }
function setCaptain(side, pid){
  const m = curMatchAny(); const lu = m?.lineups?.[side]; if(!lu) return;
  const p = lu.players.find(x=>x.pid===pid); const was = p.captain;
  lu.players.forEach(x=> x.captain=false);
  if(!was){ p.captain = true; if(p.role==="out") p.role="start"; }
  render();
}
function openLineup(id){
  state.matchId = id;
  const m = state.matches.find(x=>x.id===id);
  ensureLineups(m);
  state.lineupSide = "H"; state.view = "lineup"; render();
}
async function saveLineup(stay){
  const m = curMatchAny(); if(!m) return false;
  m.updated_at = new Date().toISOString();
  try{
    await DB.upsert("gn_matches", stripMatch(m));
    if(!stay) toast("メンバー表を保存しました");
    return true;
  }catch(e){ console.error(e); toast("保存できませんでした: "+(e.message||e)); return false; }
}

/* --- 印刷用のメンバー表（両チームを1枚に） --- */
function lineupSheetHTML(m){
  const cfg = cfgOf(state.t);
  const H = resolveSlot(m,"H"), A = resolveSlot(m,"A");
  const col = side=>{
    const R = side==="H"?H:A;
    const lu = (m.lineups&&m.lineups[side]) || {players:[],coach:""};
    const { starters, subs } = orderedLineup(lu);
    const line = p=>`<tr><td class="c">${esc(p.pos||"")}</td><td class="c">${p.no?esc(String(p.no)):""}</td>
      <td>${esc(p.name)}${p.captain?' <b>(C)</b>':""}</td></tr>`;
    return `<div class="mb-col">
      <div class="mb-team">${esc(R.label==="—"?"":R.label)}</div>
      <div class="mb-coach">監督：${esc(lu.coach||"")}</div>
      <table class="mb-tbl"><thead><tr><th class="c">位置</th><th class="c">番号</th><th>選手名</th></tr></thead>
        <tbody><tr class="mb-sec"><td colspan="3">スタメン</td></tr>
        ${starters.map(line).join("") || `<tr><td colspan="3" class="mb-empty">—</td></tr>`}
        <tr class="mb-sec"><td colspan="3">控え</td></tr>
        ${subs.map(line).join("") || `<tr><td colspan="3" class="mb-empty">—</td></tr>`}
        </tbody></table></div>`;
  };
  return `<div class="mb-sheet printonly">
    <h2>メンバー表</h2>
    <div class="mb-head">
      <div>${esc([state.t.name, cfg.host].filter(Boolean).join("　"))}</div>
      <div>${esc(H.label)} 対 ${esc(A.label)}　${esc(fmtDate(m.kickoff))} ${esc(fmtTime(m.kickoff))}　${esc(m.venue||"")}</div>
    </div>
    <div class="mb-cols">${col("H")}${col("A")}</div>
  </div>`;
}

/* --- 公式記録を、いまの試合データから下書きする --- */
/* メンバー表→公式記録のメンバー欄へ写す（force=trueで上書き） */
function applyLineupToOfficial(o, m, side, force){
  const s = o[side];
  ensureLineups(m);
  const lu = m.lineups[side];
  // 監督名もメンバー表から取り込む（手で公式記録の欄に書いていればそれを優先・force時は毎回取り込み直す）
  if(force || !s.coach) s.coach = (lu && lu.coach) ? lu.coach : (force ? "" : s.coach);
  const { starters, subs } = orderedLineup(lu);
  const rows = [...starters, ...subs];
  const hasAny = s.lineup.some(r=>r.name);
  if(hasAny && !force) return;
  for(let i=0;i<20;i++){
    const p = rows[i];
    s.lineup[i].memberId = p ? (p.memberId||p.pid) : null;
    s.lineup[i].no   = p ? (p.no??"") : (force?"":s.lineup[i].no);
    s.lineup[i].name = p ? ((p.name||"") + (p.captain?" (C)":"")) : (force?"":s.lineup[i].name);
    s.lineup[i].pos  = p ? (p.pos||"") : (force?"":s.lineup[i].pos);
  }
}
function draftOfficial(m){
  const o = m.official ? JSON.parse(JSON.stringify(m.official)) : emptyOfficial();
  const cfg = cfgOf(state.t);
  const H = resolveSlot(m,"H"), A = resolveSlot(m,"A");
  if(!o.title)    o.title = [state.t.name, cfg.host].filter(Boolean).join("　");
  if(!o.venue)    o.venue = m.venue || "";
  if(!o.datetime && m.kickoff){
    const d = new Date(m.kickoff);
    o.datetime = `${d.getFullYear()}年${String(d.getMonth()+1).padStart(2,"0")}月${String(d.getDate()).padStart(2,"0")}日 ${fmtTime(m.kickoff)}`;
  }
  [["H",H],["A",A]].forEach(([side,R])=>{
    const s = o[side];
    if(!s.name) s.name = R.label==="—" ? "" : R.label;
    if(!s.name2) s.name2 = s.name;
    // 出場メンバーがまだ空なら、メンバー表（無ければエントリー）から写す
    applyLineupToOfficial(o, m, side, false);
    // 得点とカードを写す
    const evs = (m.events||[]).filter(e=>e.team===side);
    s.lineup.forEach(r=> r.g = "");   // 毎回リセットしてから数え直す（開くたび増える不具合を防止）
    evs.filter(e=>e.type==="goal"||e.type==="pk").forEach(e=>{
      const nm = e.playerId ? playerName(R.id, e.playerId).replace(/^\d+\s/,"") : "";
      const row = s.lineup.find(r=> r.name.replace(/\s*\(C\)\s*$/,"")===nm);
      if(row) row.g = String(num(row.g)+1);
    });
    let ci = 0;
    evs.filter(e=>CARD_ICON[e.type]).forEach(e=>{
      if(ci>=s.cards.length) return;
      const nm = e.playerId ? playerName(R.id, e.playerId) : "";
      const c = s.cards[ci];
      if(!c.name){
        c.time = e.minute!=null?matchMinuteText(e.minute,e.period,m)+"分":""; c.kind = {yellow:"警",red:"退",green:"緑"}[e.type]||"";
        c.no = (nm.match(/^(\d+)\s/)||[])[1]||""; c.name = nm.replace(/^\d+\s/,"");
        if(e.reason) c.reason = e.reasonCode ? `${e.reasonCode} ${e.reason}` : e.reason;
      }
      ci++;
    });
    // 選手交代：OUTした先発の行に「時間」だけ、INした控えの行に「交代した相手の背番号」だけを入れる
    //   （見本の様式どおり＝時間と番号を別の行に分けて書く。毎回リセットして選手交代の記録から入れ直す）
    s.lineup.forEach(r=>{ r.subNo=""; r.subTime=""; });
    evs.filter(e=>e.type==="sub").forEach(e=>{
      const outFull = e.outId    ? playerName(R.id, e.outId)    : "";
      const inFull  = e.playerId ? playerName(R.id, e.playerId) : "";
      const outNo   = (outFull.match(/^(\d+)\s/)||[])[1] || "";
      const outNm   = outFull.replace(/^\d+\s/,"");
      const inNm    = inFull.replace(/^\d+\s/,"");
      const outRow  = outNm && s.lineup.find(r=> r.name.replace(/\s*\(C\)\s*$/,"")===outNm);
      const inRow   = inNm  && s.lineup.find(r=> r.name.replace(/\s*\(C\)\s*$/,"")===inNm);
      if(outRow) outRow.subTime = e.period==="HT" ? "HT" : e.minute!=null ? matchMinuteText(e.minute,e.period,m)+"分" : outRow.subTime;
      if(inRow && outNo) inRow.subNo = outNo;
    });
    const keys = ["1H","2H","1ET","2ET"];               // 前半/後半/延長前/延長後 → scores[0..3]
    const etPlayed = matchETPlayed(m);                   // 「延長を追加」した試合か（0-0でも0を入れる）
    const parts = keys.map(k=> periodScore(m, k, side));
    const total = side==="H" ? m.home_score : m.away_score;
    if(etPlayed){                                        // 延長をやった → 前後半・延長を全部数字で（0でも0）
      keys.forEach((k,i)=>{ s.scores[i] = String(parts[i]); });
    } else if(parts.reduce((a,b)=>a+b,0) > 0){           // 時間帯別に得点あり → 常にその内訳を反映（修正も追従・延長欄は空）
      keys.forEach((k,i)=>{ s.scores[i] = (i>=2) ? "" : String(parts[i]); });
    } else {                                             // 時間帯内訳なし（＝このチームは無得点）→ 前後半は0、延長は延長をやった試合だけ0
      const curSum = s.scores.reduce((a,v)=>a+num(v),0);
      const allEmpty = s.scores.every(v=>v==null||v==="");
      if((allEmpty || curSum!==(total||0)) && total!=null){
        keys.forEach((k,i)=>{ s.scores[i] = (i>=2 && !etPlayed) ? "" : "0"; });
      }
    }
    // PK戦：系列があれば毎回14セルへ反映（修正も追従）＋〇の数をPK欄（チーム名の次）へ
    const pser = pkArr(m, side);
    if(pser.length){
      for(let i=0;i<14;i++) s.pks[i] = pser[i]==="o" ? "○" : pser[i]==="x" ? "×" : "";
      s.pk = String(pkCount(m, side));
    } else if(s.pk==null){
      const cnt = side==="H" ? m.home_pk : m.away_pk;
      if(cnt!=null) s.pk = String(cnt);
    }
    if(!s.name2) s.name2 = s.name;   // PK経過欄のチーム名
  });
  // 得点経過：試合結果から毎回取り込み直す（入った得点の数だけ・最大14）。
  //   経過記号(seq)と、選手を選ばず手書きした得点者名は残す。
  const goalsE = (m.events||[]).filter(e=>e.type==="goal"||e.type==="pk"||e.type==="og");
  if(goalsE.length){
    o.goals = goalsE.slice(0,28).map((e,i)=>{   // 1〜14点=1枚目 / 15〜28点=2枚目に続ける
      const R = e.team==="H"?H:A;
      const nm = e.playerId ? playerName(R.id, e.playerId) : "";
      const anm = e.assistId ? playerName(R.id, e.assistId) : "";   // アシスト欄は幅が狭いので背番号だけにする
      const suffix = e.type==="og" ? "(OG)" : e.type==="pk" ? "(PK)" : "";
      const prev = o.goals[i] || emptyGoalRow();
      return {
        time:   e.minute!=null ? matchMinuteText(e.minute,e.period,m)+"分" : (prev.time||""),
        team:   (e.type==="og" ? (e.team==="H"?A.label:H.label) : R.label) || "",
        no:     (nm.match(/^(\d+)\s/)||[])[1] || (nm?"":prev.no||""),
        scorer: nm ? (nm.replace(/^\d+\s/,"")+suffix) : (prev.scorer||suffix),
        assist: e.assistId!=null ? ((anm.match(/^(\d+)/)||[])[1] || "") : (prev.assist||""),
        seq:    (prev.seq && prev.seq.length) ? prev.seq : Array(10).fill(""),
      };
    });
  }
  return o;
}

/* --- メンバー表のヘッダー：各列のセル中央に文字をそろえる。延長時のみ延前/延後を表示 --- */
function memberHeaderHTML(et){
  const S = SHEET.H;
  const cl = (x1,x2,y,t,s)=> `<span class="lbc" style="left:${pt((x1+x2)/2)};top:${pt(S-y-s*0.82)};font-size:${pt(s)}">${esc(t)}</span>`;
  const SUB=625, MID=632, GRP=637;   // サブ見出し行 / 中央フル行 / グループ見出し行
  let o = "";
  // H側
  o += cl(28.4,45.2, SUB,"No.",7) + cl(45.2,78.9, SUB,"時間",7);
  if(et){ o += cl(78.9,95.8, SUB,"延前",6.5) + cl(95.8,112.7, SUB,"延後",6.5); }
  o += cl(112.7,129.5, SUB,"後半",7) + cl(129.5,146.4, SUB,"前半",7) + cl(146.4,163.3, SUB,"計",7);
  o += cl(28.4,78.9, GRP,"交代",8) + cl(et?78.9:112.7,163.3, GRP,"シュート",8);
  o += cl(163.3,180.1, MID,"得点",7.5) + cl(180.1,264.5, MID,"選手名",8) + cl(264.5,281.3, MID,"番号",7) + cl(281.3,298.2, MID,"位置",7);
  // A側（左右対称）
  o += cl(298.2,315.1, MID,"位置",7) + cl(315.1,331.9, MID,"番号",7) + cl(331.9,416.3, MID,"選手名",8) + cl(416.3,433.1, MID,"得点",7.5);
  o += cl(433.1,450, SUB,"計",7) + cl(450,466.9, SUB,"前半",7) + cl(466.9,483.7, SUB,"後半",7);
  if(et){ o += cl(483.7,500.6, SUB,"延前",6.5) + cl(500.6,517.5, SUB,"延後",6.5); }
  o += cl(517.5,551.2, SUB,"時間",7) + cl(551.2,568.1, SUB,"No.",7);
  o += cl(433.1,et?517.5:483.7, GRP,"シュート",8) + cl(517.5,568.1, GRP,"交代",8);
  return o;
}
/* チーム合計欄のヘッダー（延前/延後/後半/前半/計・中央にチーム合計タイトル）。中央そろえで作るので位置がずれない */
function totalsHeaderHTML(){
  const S = SHEET.H;
  const cl = (x1,x2,y,t,s)=> `<span class="lbc" style="left:${pt((x1+x2)/2)};top:${pt(S-y-s*0.82)};font-size:${pt(s)}">${esc(t)}</span>`;
  const Y = 329;
  let o = "";
  o += cl(TOT_H[0],TOT_H[1], Y,"延前",6) + cl(TOT_H[1],TOT_H[2], Y,"延後",6)
     + cl(TOT_H[2],TOT_H[3], Y,"後半",6.5) + cl(TOT_H[3],TOT_H[4], Y,"前半",6.5) + cl(TOT_H[4],TOT_H[5], Y,"計",6.5);
  o += cl(281.3,315.1, Y,"チーム合計",6.5);
  o += cl(TOT_A[0],TOT_A[1], Y,"計",6.5) + cl(TOT_A[1],TOT_A[2], Y,"前半",6.5) + cl(TOT_A[2],TOT_A[3], Y,"後半",6.5)
     + cl(TOT_A[3],TOT_A[4], Y,"延前",6) + cl(TOT_A[4],TOT_A[5], Y,"延後",6);
  return o;
}
/* --- 用紙を描く --- */
const pt = v => v.toFixed(2)+"pt";
function sheetLines(){
  let out = "";
  SHEET.h.forEach(([y,x1,x2])=> out += `<i class="ln" style="left:${pt(x1)};top:${pt(SHEET.H-y)};width:${pt(x2-x1)};height:.5pt"></i>`);
  SHEET.v.forEach(([x,y1,y2])=> out += `<i class="ln" style="left:${pt(x)};top:${pt(SHEET.H-y2)};width:.5pt;height:${pt(y2-y1)}"></i>`);
  SHEET.labels.forEach(([x,y,t,s,b])=>
    out += `<span class="lb" style="left:${pt(x)};top:${pt(SHEET.H-y-s*0.82)};font-size:${pt(s)}${b?";font-weight:700":""}">${esc(t)}</span>`);
  // 得点経過の内部横線（得点数に応じて動的に）
  const grows = goalRows(state.official || {goals:[]});
  for(let i=1;i<grows.length;i++){ const y = grows[i][0];
    out += `<i class="ln" style="left:${pt(28.4)};top:${pt(SHEET.H-y)};width:${pt(568.1-28.4)};height:.5pt"></i>`; }
  // メンバー表のヘッダー（セル中央そろえ・延長時のみ延前/延後）
  out += memberHeaderHTML(matchETPlayed(curMatchAny()||{}));
  out += totalsHeaderHTML();
  // スタメン(11人)とサブ(12人目以降)の境目を太線に（メンバー表の両チーム）
  out += `<i class="ln" style="left:${pt(28.4)};top:${pt(SHEET.H-482.5)};width:${pt(568.1-28.4)};height:1.5pt"></i>`;
  // PK経過欄：チーム名と〇の数の仕切り線
  out += `<i class="ln" style="left:${pt(80)};top:${pt(SHEET.H-116.6)};width:.5pt;height:${pt(116.6-91.4)}"></i>`;
  return out;
}
/* 1つの入力枠 */
function box(path, x1, x2, yTop, yBot, o){
  o = o || {};
  const size = o.size || 8;
  const h = yTop - yBot;
  if(state.officialReadOnly){   // 一般公開の閲覧専用ビュー：入力欄ではなく文字だけ表示（fx-ro＝縦方向も中央そろえ）
    const cls = "fx-ro" + (o.wrap?" wrap":"") + (o.align==="l"?" l":"");
    return `<div class="${cls}" data-p="${path}"
      style="left:${pt(x1+1)};top:${pt(SHEET.H-yTop)};width:${pt(x2-x1-2)};height:${pt(h)};font-size:${pt(size)}">${esc(pget(state.official,path)??"")}</div>`;
  }
  if(o.wrap){   // 折り返し可能な枠（チーム名など）＝縦方向も中央そろえにしたいのでcontenteditableのdiv
              // （textareaは中の文字を縦中央にできないため。IME変換・複数行貼り付けはEnterで改行させない）
    return `<div class="fx fxw fxedit${o.align==="l"?" l":""}" data-p="${path}" contenteditable="true"
      style="left:${pt(x1+1)};top:${pt(SHEET.H-yTop)};width:${pt(x2-x1-2)};height:${pt(h)};font-size:${pt(size)}">${esc(pget(state.official,path)??"")}</div>`;
  }
  const tap = o.tap ? ` data-tapk="${o.tap.k}"${o.tap.side?` data-side="${o.tap.side}"`:""}${o.tap.idx!=null?` data-idx="${o.tap.idx}"`:""}${o.tap.ci!=null?` data-ci="${o.tap.ci}"`:""}${o.tap.half?` data-half="${o.tap.half}"`:""} readonly` : "";
  const cls = "fx" + (o.align==="l"?" l":"") + (o.tap?" pickable":"");
  return `<input class="${cls}" data-p="${path}"${tap}
    style="left:${pt(x1+1)};top:${pt(SHEET.H-yTop)};width:${pt(x2-x1-2)};height:${pt(h)};font-size:${pt(size)}"
    value="${esc(pget(state.official,path)??"")}"${o.ph?` placeholder="${esc(o.ph)}"`:""}>`;
}

/* チームのエンブレム（校章）。大会エントリー時にコピーした`t.crest`を優先し、無ければ台帳から拾う（運営ログイン時のみ有効な後方互換） */
function crestFor(teamId){
  const t = state.teams.find(x=>x.id===teamId);
  if(!t) return null;
  if(t.crest) return t.crest;
  const c = t.club_id ? clubById(t.club_id) : null;
  return c?.crest || null;
}
function sheetFields(){
  const F = [];
  const o = state.official;
  const mCur = curMatchAny()||{};
  const et = matchETPlayed(mCur);   // 延長をやった試合か（e1=延前/e2=延後 のシュート列を使う）
  const shotTap = (side,i,half)=> et ? {size:7, tap:{k:"shot",side,idx:i,half}} : {size:7};
  const hCrest = mCur.id ? crestFor(resolveSlot(mCur,"H").id) : null;
  const aCrest = mCur.id ? crestFor(resolveSlot(mCur,"A").id) : null;
  /* チーム名欄＝エンブレムがあれば左に小さく表示し、チーム名はエンブレム分を除いた残りの幅で表示する */
  const nameBox = (path, x1,x2,yTop,yBot,crest)=>{
    if(crest){
      const cw = 15, cy = (yTop+yBot)/2;
      F.push(`<img src="${esc(crest)}" style="position:absolute;left:${pt(x1+3)};top:${pt(SHEET.H-cy-cw/2)};width:${pt(cw)};height:${pt(cw)};object-fit:contain;pointer-events:none">`);
      F.push(box(path, x1+cw+4, x2, yTop, yBot, {size:9, wrap:true}));
    } else {
      F.push(box(path, x1, x2, yTop, yBot, {size:9, wrap:true}));
    }
  };
  // 見出し・基本情報
  F.push(box("title", 28.4, 568.1, 770, 757, {align:"l", size:8}));
  F.push(box("datetime", 95.8, 197, 760, 747.4, {align:"l"}));
  F.push(box("format",   247.6, 331.9, 760, 747.4, {align:"l"}));
  F.push(box("venue",    365.7, 568.1, 760, 747.4, {align:"l"}));
  [["commissioner",68.8,136.3],["referee",176.8,244.2],["ar1",284.7,352.2],["ar2",392.7,460.1],["fourth",500.6,568.1]]
    .forEach(([p,a,b])=> F.push(box(p,a,b,747.4,734.7,{align:"l"})));
  [["admin",68.8,136.3],["recorder",176.8,244.2],["weather",284.7,352.2],["temp",392.7,460.1],["humid",500.6,568.1]]
    .forEach(([p,a,b])=> F.push(box(p,a,b,734.7,722.1,{align:"l"})));
  F.push(box("wind", 68.8,136.3, 722.1,709.5, {align:"l"}));
  F.push(box("crowd",176.8,244.2, 722.1,709.5, {align:"l"}));
  F.push(box("pitch",284.7,568.1, 722.1,709.5, {align:"l"}));

  // スコア（チーム名欄はエンブレムがあれば左に添えて表示）
  nameBox("H.name", 28.4,180.1, 709.5,690, hCrest);
  F.push(box("H.pref", 28.4,180.1, 690,676,  {size:7}));
  nameBox("A.name", 416.3,568.1, 709.5,690, aCrest);
  F.push(box("A.pref", 416.3,568.1, 690,676,  {size:7}));
  F.push(`<span class="tot" style="left:${pt(180.1)};top:${pt(SHEET.H-694)};width:${pt(50.6)}">${esc(sideTotal("H"))}</span>`);
  F.push(`<span class="tot" style="left:${pt(365.7)};top:${pt(SHEET.H-694)};width:${pt(50.6)}">${esc(sideTotal("A"))}</span>`);
  ROW_SCORE.forEach(([t,b],i)=>{
    F.push(box(`H.scores.${i}`, 230.7,264.5, t,b));
    F.push(box(`A.scores.${i}`, 331.9,365.7, t,b));
  });
  F.push(box("H.pk", 230.7,264.5, 659.1,646.4));
  F.push(box("A.pk", 331.9,365.7, 659.1,646.4));
  // キックオフ（コイントスで決めたチーム側に表示位置ごと出す＝左はHチーム側・右はAチーム側）。
  //   決めるのは「結果を入れる」画面から。ここは表示だけ（タップでは変更しない）
  if(o.kickoffTeam){
    const onRight = o.kickoffTeam==="A";
    const x = onRight ? 420 : 115, w = onRight ? 140 : 112;
    F.push(`<span class="lb kicklab" style="left:${pt(x)};top:${pt(SHEET.H-662-7.5*0.82)};width:${pt(w)};font-size:${pt(7.5)}">KICK OFF</span>`);
  }

  // メンバー表
  ROW_PLAYER.forEach(([t,b],i)=>{
    F.push(box(`H.lineup.${i}.subNo`,   28.4,45.2,  t,b,{size:7}));
    F.push(box(`H.lineup.${i}.subTime`, 45.2,78.9,  t,b,{size:7}));
    F.push(box(`H.lineup.${i}.e1`,      78.9,95.8,  t,b, shotTap("H",i,"e1")));   // 延長前半シュート（延長時のみ）
    F.push(box(`H.lineup.${i}.e2`,      95.8,112.7, t,b, shotTap("H",i,"e2")));   // 延長後半シュート
    F.push(box(`H.lineup.${i}.s2`,     112.7,129.5, t,b,{size:7, tap:{k:"shot",side:"H",idx:i,half:"s2"}}));
    F.push(box(`H.lineup.${i}.s1`,     129.5,146.4, t,b,{size:7, tap:{k:"shot",side:"H",idx:i,half:"s1"}}));
    F.push(box(`H.lineup.${i}.st`,     146.4,163.3, t,b,{size:7}));
    F.push(box(`H.lineup.${i}.g`,      163.3,180.1, t,b,{size:7}));
    F.push(box(`H.lineup.${i}.name`,   180.1,264.5, t,b,{align:"l", tap:{k:"lineup",side:"H",idx:i}}));
    F.push(box(`H.lineup.${i}.no`,     264.5,281.3, t,b,{size:7}));
    F.push(box(`H.lineup.${i}.pos`,    281.3,298.2, t,b,{size:7}));
    F.push(box(`A.lineup.${i}.pos`,    298.2,315.1, t,b,{size:7}));
    F.push(box(`A.lineup.${i}.no`,     315.1,331.9, t,b,{size:7}));
    F.push(box(`A.lineup.${i}.name`,   331.9,416.3, t,b,{align:"l", tap:{k:"lineup",side:"A",idx:i}}));
    F.push(box(`A.lineup.${i}.g`,      416.3,433.1, t,b,{size:7}));
    F.push(box(`A.lineup.${i}.st`,     433.1,450,   t,b,{size:7}));
    F.push(box(`A.lineup.${i}.s1`,     450,466.9,   t,b,{size:7, tap:{k:"shot",side:"A",idx:i,half:"s1"}}));
    F.push(box(`A.lineup.${i}.s2`,     466.9,483.7, t,b,{size:7, tap:{k:"shot",side:"A",idx:i,half:"s2"}}));
    F.push(box(`A.lineup.${i}.e1`,     483.7,500.6, t,b, shotTap("A",i,"e1")));
    F.push(box(`A.lineup.${i}.e2`,     500.6,517.5, t,b, shotTap("A",i,"e2")));
    F.push(box(`A.lineup.${i}.subTime`,517.5,551.2, t,b,{size:7}));
    F.push(box(`A.lineup.${i}.subNo`,  551.2,568.1, t,b,{size:7}));
  });

  // 監督
  F.push(box("H.coach", 197,298.2, 356.3,343.7, {align:"l"}));
  F.push(box("A.coach", 298.2,399.4, 356.3,343.7, {align:"l"}));

  // 警告・退場
  ROW_CARD.forEach(([t,b],i)=>{
    F.push(box(`H.cards.${i}.time`,  28.4,62.1,  t,b,{size:7}));
    F.push(box(`H.cards.${i}.kind`,  62.1,78.9,  t,b,{size:7}));
    F.push(box(`H.cards.${i}.no`,    78.9,95.8,  t,b,{size:7, tap:{k:"cardno",side:"H",idx:i}}));
    F.push(box(`H.cards.${i}.name`,  95.8,163.3, t,b,{align:"l",size:7}));
    F.push(box(`H.cards.${i}.reason`,163.3,197,  t,b,{align:"l",size:6}));
    F.push(box(`A.cards.${i}.time`,  399.4,433.1,t,b,{size:7}));
    F.push(box(`A.cards.${i}.kind`,  433.1,450,  t,b,{size:7}));
    F.push(box(`A.cards.${i}.no`,    450,466.9,  t,b,{size:7, tap:{k:"cardno",side:"A",idx:i}}));
    F.push(box(`A.cards.${i}.name`,  466.9,534.3,t,b,{align:"l",size:7}));
    F.push(box(`A.cards.${i}.reason`,534.3,568.1,t,b,{align:"l",size:6}));
  });

  // チーム合計（延長込み・5列＝延前/延後/後半/前半/計。延長非対象は空欄のまま使わなくてOK）
  ROW_TOTAL.forEach(([t,b],i)=>{
    const k = TOTAL_KEYS[i];
    F.push(box(`H.tot.${k}.3`, TOT_H[0],TOT_H[1], t,b,{size:6.5}));   // 延前
    F.push(box(`H.tot.${k}.4`, TOT_H[1],TOT_H[2], t,b,{size:6.5}));   // 延後
    F.push(box(`H.tot.${k}.1`, TOT_H[2],TOT_H[3], t,b,{size:7}));     // 後半
    F.push(box(`H.tot.${k}.0`, TOT_H[3],TOT_H[4], t,b,{size:7}));     // 前半
    F.push(box(`H.tot.${k}.2`, TOT_H[4],TOT_H[5], t,b,{size:7}));     // 計
    F.push(box(`A.tot.${k}.2`, TOT_A[0],TOT_A[1], t,b,{size:7}));     // 計
    F.push(box(`A.tot.${k}.0`, TOT_A[1],TOT_A[2], t,b,{size:7}));     // 前半
    F.push(box(`A.tot.${k}.1`, TOT_A[2],TOT_A[3], t,b,{size:7}));     // 後半
    F.push(box(`A.tot.${k}.3`, TOT_A[3],TOT_A[4], t,b,{size:6.5}));   // 延前
    F.push(box(`A.tot.${k}.4`, TOT_A[4],TOT_A[5], t,b,{size:6.5}));   // 延後
  });

  // 得点経過（時間=手書き / チーム=選択 / 番号=出場者から選択→得点者自動 / アシスト=手書き / 経過=記号選択）
  // 入った得点の数だけ行を増やす。行が増えたら文字を少し小さくする。
  const grows = goalRows(o);
  while(o.goals.length < grows.length) o.goals.push(emptyGoalRow());
  const gs = Math.max(5, Math.min(7, (GOAL_TOP-GOAL_BOT)/grows.length * 0.6));
  grows.forEach(([t,b],i)=>{
    F.push(box(`goals.${i}.time`,   28.4,62.1,  t,b,{size:gs}));
    F.push(box(`goals.${i}.team`,   62.1,112.7, t,b,{align:"l",size:Math.min(gs,6.5), tap:{k:"goalteam",idx:i}}));
    F.push(box(`goals.${i}.no`,    112.7,129.5, t,b,{size:gs, tap:{k:"goalno",idx:i}}));
    F.push(box(`goals.${i}.scorer`,129.5,197,   t,b,{align:"l",size:gs}));
    F.push(box(`goals.${i}.assist`,197,230.7,   t,b,{size:gs}));
    for(let c=0;c<10;c++) F.push(box(`goals.${i}.seq.${c}`, SEQ_CELLS[c],SEQ_CELLS[c+1], t,b,{size:gs, tap:{k:"seq",idx:i,ci:c}}));
  });

  // PKの経過（チーム名の脇に〇の数を自動で表示）
  F.push(box("H.name2", 28.4,80, 116.6,104, {align:"l",size:7}));
  F.push(box("A.name2", 28.4,80, 104,91.4,  {align:"l",size:7}));
  F.push(`<span class="pkmaru" id="pkmaru-H" style="left:${pt(80)};top:${pt(SHEET.H-114.6)};width:${pt(15.8)};font-size:9pt">${esc(pkMaruCount("H"))}</span>`);
  F.push(`<span class="pkmaru" id="pkmaru-A" style="left:${pt(80)};top:${pt(SHEET.H-102)};width:${pt(15.8)};font-size:9pt">${esc(pkMaruCount("A"))}</span>`);
  for(let c=0;c<14;c++){
    F.push(box(`H.pks.${c}`, PK_CELLS[c],PK_CELLS[c+1], 116.6,104, {size:7}));
    F.push(box(`A.pks.${c}`, PK_CELLS[c],PK_CELLS[c+1], 104,91.4,  {size:7}));
  }

  // 試合時間・備考
  F.push(box("timeText", 78,568.1, 82,70, {align:"l"}));
  F.push(box("note",     78,568.1, 69,57, {align:"l"}));
  return F.join("");
}
/* --- 2枚目：15点目以降の「得点経過」だけを様式を保って続ける --- */
const P2_MAX = 28;                 // 1枚目14＋2枚目14
function sheetPage2(o){
  if(!o) return null;
  const START = 14;
  const overflow = Math.min((o.goals||[]).length, P2_MAX) - START;   // 15点目以降の数
  if(overflow <= 0) return null;
  const n = Math.min(14, Math.max(overflow + 1, 3));   // 表示行数（あふれ＋1・最低3）
  const TOP = 780, ROWH = 16, HEADT = TOP + 18, BOT = TOP - ROWH*n;
  const cols = [28.4,62.1,112.7,129.5,197,230.7,264.5,298.2,331.9,365.7,399.4,433.1,466.9,500.6,534.3,568.1];
  let out = "";
  // 横線（ヘッダー上・データ上・各行・下端）
  const ys = [HEADT, TOP]; for(let i=1;i<=n;i++) ys.push(TOP - ROWH*i);
  ys.forEach(y=> out += `<i class="ln" style="left:${pt(28.4)};top:${pt(SHEET.H-y)};width:${pt(568.1-28.4)};height:.5pt"></i>`);
  // 縦線
  cols.forEach(x=> out += `<i class="ln" style="left:${pt(x)};top:${pt(SHEET.H-HEADT)};width:.5pt;height:${pt(HEADT-BOT)}"></i>`);
  // タイトル・ヘッダーラベル
  out += `<span class="lb" style="left:${pt(200)};top:${pt(SHEET.H-810)};font-size:12pt;font-weight:700">公式記録　得点経過（15点目〜）</span>`;
  [[32,"得点時間",7],[67,"得点チーム",7],[116,"No.",7],[151,"得点者",7],[201,"アシスト",7],
   [234,"得点経過　記録例： 〜:ドリブル →:ゴロパス ↑:浮き球パス ×:混戦 S:シュート H:ヘディング",6]]
    .forEach(([x,t,s])=> out += `<span class="lb" style="left:${pt(x)};top:${pt(SHEET.H-(TOP+13)-s*0.82)};font-size:${pt(s)}">${esc(t)}</span>`);
  // データ行（15点目〜）
  for(let r=0;r<n;r++){
    const idx = START + r, t = TOP - ROWH*r, b = TOP - ROWH*(r+1);
    out += box(`goals.${idx}.time`,   28.4,62.1,  t,b,{size:8});
    out += box(`goals.${idx}.team`,   62.1,112.7, t,b,{align:"l",size:7, tap:{k:"goalteam",idx}});
    out += box(`goals.${idx}.no`,    112.7,129.5, t,b,{size:8, tap:{k:"goalno",idx}});
    out += box(`goals.${idx}.scorer`,129.5,197,   t,b,{align:"l",size:8});
    out += box(`goals.${idx}.assist`,197,230.7,   t,b,{size:8});
    for(let c=0;c<10;c++) out += box(`goals.${idx}.seq.${c}`, SEQ_CELLS[c],SEQ_CELLS[c+1], t,b,{size:8, tap:{k:"seq",idx,ci:c}});
  }
  return out;
}
function sideTotal(side){
  const s = state.official?.[side]; if(!s) return "";
  const n = s.scores.reduce((a,v)=> a + (String(v??"").trim()==="" ? 0 : num(v)), 0);
  return s.scores.every(v=>String(v??"").trim()==="") ? "" : String(n);
}
/* PK経過欄の〇の数を数える（○ を成功としてカウント） */
function pkMaruCount(side){
  const s = state.official?.[side]; if(!s) return "";
  const n = (s.pks||[]).filter(v=> String(v).trim()==="○" || String(v).trim().toLowerCase()==="o" || String(v).trim()==="〇").length;
  return n ? String(n) : "";
}

