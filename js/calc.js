function entryCode(){
  const s = "ABCDEFGHJKLMNPRSTUWXYZ2345679";
  const n = s.length;
  if(!(window.crypto && crypto.getRandomValues)){
    throw new Error("このブラウザは安全な記入コードの生成に対応していません。ブラウザを最新に更新するか、別のブラウザでお試しください。");
  }
  const limit = Math.floor(256/n)*n;   // これ以上の値は切り捨てて取り直す＝剰余バイアスを避ける
  const buf = new Uint8Array(1);
  let r = "";
  while(r.length < 6){
    crypto.getRandomValues(buf);
    if(buf[0] >= limit) continue;
    r += s[buf[0] % n];
  }
  return r;
}

/* ==========================================================================
   大会ロジック
   ========================================================================== */
const sportOf = t => SPORTS[t?.sport] || SPORTS.soccer;
const cfgOf   = t => Object.assign({ win:3, draw:1, lose:0, groups:["A"], advance:2,
                                     advanceBy:{}, wildcards:[], wcRule:"total", brackets:null,
                                     venues:[], koSize:8, thirdPlace:false, duration:20 }, t?.settings||{});

/* ブロック（部・組）: 新形式 settings.blocks=[{id,name}]。旧 groups(文字)も読めるように */
function blocksOf(t){
  const s = t?.settings || {};
  if(Array.isArray(s.blocks) && s.blocks.length) return s.blocks;
  const gs = Array.isArray(s.groups) ? s.groups : [];
  return gs.map(g=>({ id:g, name:/^[A-H]$/.test(g)? g+"組" : g }));
}
function blockName(t, id){ return (blocksOf(t).find(b=>b.id===id)||{}).name || ""; }

/* ==========================================================================
   トーナメント（櫓）を複数持てるようにする（1位トーナメント・2位トーナメント…）
   KOマッチの grp 列に櫓のidを入れる。旧データは grp=null → 先頭（main）の櫓とみなす。
   ========================================================================== */
const KO_MAIN = "main";
function bracketsOf(t){
  const s = t?.settings || {};
  if(Array.isArray(s.brackets) && s.brackets.length) return s.brackets;
  return [{ id:KO_MAIN, name: t?.format==="league_ko" ? "決勝トーナメント" : "トーナメント" }];
}
function bracketIdOf(m){ return m?.grp || KO_MAIN; }
function bracketName(t, id){ return (bracketsOf(t).find(b=>b.id===id)||{}).name || ""; }
/* いま表示・編集している櫓のid（消えた櫓を指していたら先頭に戻す） */
function curBracketId(){
  const bs = bracketsOf(state.t);
  return bs.some(b=>b.id===state.bracket) ? state.bracket : bs[0].id;
}
/* 櫓ごとのKOマッチ。bid省略＝いま表示中の櫓。cons=true で順位決定戦（slot99）も含む */
function koMatchesOf(bid, cons){
  const id = bid || curBracketId();
  return state.matches.filter(m=> m.stage==="ko" && bracketIdOf(m)===id && (cons || m.slot!==99));
}
function setBracket(id){ state.bracket = id; render(); }

/* ---------- 予選リーグからの勝ち上がり（ブロックごとに数を変えられる） ---------- */
/* このブロックから決勝トーナメントへ上がる数（未設定なら全体の advance） */
function advanceOf(blockId){
  const cfg = cfgOf(state.t);
  const v = (cfg.advanceBy||{})[blockId];
  return (v==null || v==="") ? Math.max(0, num(cfg.advance)) : Math.max(0, num(v));
}
/* 枠の選択肢に出す最大順位＝いちばんチーム数の多いブロックの数 */
function maxRankOf(){
  const bs = blocksOf(state.t);
  if(!bs.length) return 0;
  return Math.max(1, ...bs.map(b=> state.teams.filter(t=>t.grp===b.id).length));
}
/* そのブロックの予選が全部終わったか */
function blockDone(blockId){
  const gm = state.matches.filter(x=>x.stage==="league" && x.grp===blockId);
  return !!gm.length && gm.every(isDone);
}
function allBlocksDone(){
  const bs = blocksOf(state.t);
  return !!bs.length && bs.every(b=>blockDone(b.id));
}
/* --- ワイルドカード：各ブロックの<rank>位どうしを横に並べて比べる ---
   そのブロックが<rank>位まで直接勝ち上がる場合、そのチームはもう枠を持っているので対象から外す
   （例：1部は2位まで勝ち上がり＋「各組2位から1チーム」なら、1部の2位は拾わず2部・3部の2位だけで競う）。
   ブロックのチーム数が違う大会では「1試合平均」で比べる設定（wcRule="avg"）も使える。 */
function wildcardRows(rank){
  const cfg = cfgOf(state.t);
  const avg = cfg.wcRule === "avg";
  const rows = [];
  blocksOf(state.t).forEach(b=>{
    if(!blockDone(b.id)) return;
    if(advanceOf(b.id) >= rank) return;            // すでに直接勝ち上がっている順位はワイルドカード対象外
    const r = standings(b.id)[rank-1];
    if(r) rows.push(Object.assign({}, r, { blockId:b.id, blockName:b.name }));
  });
  const k = r => (avg && r.pl) ? 1/r.pl : 1;
  rows.sort((a,b)=> (b.pts*k(b))-(a.pts*k(a)) || (b.gd*k(b))-(a.gd*k(a))
                 || (b.gf*k(b))-(a.gf*k(a)) || a.name.localeCompare(b.name,"ja"));
  return rows;
}
/* 設定されているワイルドカード枠の一覧 [{rank,count}] */
function wildcardsOf(t){
  const w = cfgOf(t).wildcards;
  return Array.isArray(w) ? w.filter(x=>x && num(x.rank)>0 && num(x.count)>0) : [];
}
/* そのチームがワイルドカードで勝ち上がるか（順位表の色分け用）→ 何番目か / 0=対象外 */
function wildcardHit(teamId){
  let n = 0;
  wildcardsOf(state.t).forEach(w=>{
    const rows = wildcardRows(num(w.rank));
    const i = rows.findIndex(r=>r.id===teamId);
    if(i >= 0 && i < num(w.count)) n = i+1;
  });
  return n;
}

const teamById = id => state.teams.find(t=>t.id===id) || null;
const teamName = id => teamById(id)?.name || "";
function playersOf(teamId){ return (teamById(teamId)?.players)||[]; }
function playerName(teamId, pid){
  const p = playersOf(teamId).find(x=>x.id===pid);
  if(!p) return "選手";
  return (p.no ? `${p.no} ` : "") + p.name;
}
/* この試合の出場選手（メンバー表があれば先発＋控えから、なければ大会登録の選手）。
   side は "H"/"A"。返す id は台帳選手id（イベントの playerId と同じ体系）。 */
function participantsOf(m, side){
  const lu = m.lineups && m.lineups[side];
  const inMatch = lu && Array.isArray(lu.players)
    ? lu.players.filter(p=>p.role==="start"||p.role==="sub")
        .map(p=>({ id:p.pid, no:p.no, name:p.name, pos:p.pos }))
    : [];
  if(inMatch.length) return inMatch;
  const R = resolveSlot(m, side);
  return playersOf(R.id);
}
/* 選手交代用：OUT＝いまピッチにいる選手 / IN＝まだ出ていない控え（交代の履歴を反映）
   excludeIdx＝この交代イベント自身を編集中のとき、その1件を計算から除く（自分がOUT/INした選手も選べるように） */
function subFieldSets(m, side, excludeIdx){
  const lu = m.lineups && m.lineups[side];
  const parts = participantsOf(m, side);
  const hasRoles = lu && Array.isArray(lu.players) && lu.players.some(p=>p.role==="start");
  if(!hasRoles) return { out: parts, in: parts };   // 先発/控えが未設定なら従来どおり全員
  const starters = lu.players.filter(p=>p.role==="start").map(p=>p.pid);
  const onSet = new Set(starters), everOn = new Set(starters);
  (m.events||[]).filter((e,j)=> e.type==="sub" && e.team===side && j!==excludeIdx).forEach(e=>{
    if(e.outId) onSet.delete(e.outId);
    if(e.playerId){ onSet.add(e.playerId); everOn.add(e.playerId); }
  });
  return {
    out: parts.filter(p=> onSet.has(p.id)),     // 今ピッチにいる11人
    in:  parts.filter(p=> !everOn.has(p.id)),   // 一度も出ていない控え
  };
}
/* 得点イベントが「どちらのチームの得点か」（オウンゴールは相手の得点） */
function scoringSideOf(ev){ return ev.type==="og" ? (ev.team==="H"?"A":"H") : ev.team; }
/* この試合のハーフ分数（決勝だけ40分など、大会の既定と違うときは試合ごとに上書きできる） */
function matchHalfMin(m, period){
  const meta = (m && m.lineups && m.lineups._meta) || {};
  const ov = cfgOf(state.t).overview || {};
  if(period==="1ET"||period==="2ET") return meta.etHalfMin!=null ? meta.etHalfMin : (ov.etHalfMin||0);
  return meta.halfMin!=null ? meta.halfMin : (ov.halfMin||0);
}
/* 時間表示：ハーフの分数を超えたら「35+1分」のようなアディショナルタイム表記にする（前後半/延長前後で長さが違う） */
function minuteText(minute, period, m){
  if(minute==null || minute==="") return "";
  const len = matchHalfMin(m, period);
  const n = num(minute);
  if(len && n>len) return `${len}+${n-len}`;
  return String(n);
}
/* 公式記録用の通し時間：後半・延長は前半（・延長前半）の長さぶんを足して「45分ハーフの後半10分＝55分」のように表示する。
   足すのは大会設定のハーフ長（ノミナルな長さ）だけで、前半の実際のアディショナルタイムは足さない。
   その代わり、いま入力されている時間帯自身がハーフ長を超えるとき（＝そのハーフのアディショナルタイム）は
   「90+2」のように＋表記を保つ。前半（1H）はオフセット0なので今までの表示と変わらない。 */
function matchMinuteText(minute, period, m){
  if(minute==null || minute==="") return "";
  const h1 = matchHalfMin(m,"1H");
  const offsets = { "1H":0, "2H":h1, "1ET":h1*2, "2ET":h1*2+matchHalfMin(m,"1ET") };
  const off = offsets[period] ?? 0;
  const len = matchHalfMin(m, period);
  const n = num(minute);
  if(len && n>len) return `${off+len}+${n-len}`;
  return String(off+n);
}
function setMatchHalfMin(key, v){
  const m = curMatch(); if(!m) return;
  m.lineups = m.lineups || {}; m.lineups._meta = m.lineups._meta || {};
  m.lineups._meta[key] = v==="" ? null : Math.max(1, num(v));
}
/* この試合の合計時間（アディショナルタイムは含めない・ノミナルな長さ） */
function matchNominalTotal(m){
  const reg = matchHalfMin(m,"1H")*2;
  const et  = matchETPlayed(m) ? matchHalfMin(m,"1ET")*2 : 0;
  return reg + et;
}
/* 前半0分始まりの通し時間に変換。アディショナルタイム（ハーフ長を超えた分）は加算しない。HTは前半終了時点として扱う */
function nominalMinuteOf(minute, period, m){
  const h1 = matchHalfMin(m,"1H");
  const offsets = { "1H":0, "HT":h1, "2H":h1, "1ET":h1*2, "2ET":h1*2+matchHalfMin(m,"1ET") };
  const per = period || "1H";
  const off = offsets[per] ?? 0;
  if(minute==null) return off;                    // HT交代など「分」未入力
  const len = matchHalfMin(m, per);
  const capped = len ? Math.min(num(minute), len) : num(minute);   // アディショナルタイムは加算しない
  return off + capped;
}
/* この試合でその選手が実際にピッチにいた分数（出場時間）。選手交代の記録から自動計算する */
function computePlayMinutes(m, side, pid){
  if(!pid || !isDone(m)) return 0;
  const lu = m.lineups && m.lineups[side];
  const row = lu && Array.isArray(lu.players) && lu.players.find(p=>p.pid===pid);
  if(!row || row.role==="out") return 0;
  const marks = [];
  if(row.role==="start") marks.push({ t:0, on:true });
  (m.events||[]).filter(e=>e.type==="sub" && e.team===side).forEach(e=>{
    if(e.playerId===pid) marks.push({ t:nominalMinuteOf(e.minute,e.period,m), on:true });
    if(e.outId===pid)    marks.push({ t:nominalMinuteOf(e.minute,e.period,m), on:false });
  });
  if(!marks.length) return 0;                      // 控えのまま一度も出ていない
  marks.sort((a,b)=>a.t-b.t);
  const total = matchNominalTotal(m);
  let onField=false, since=0, sum=0;
  marks.forEach(mk=>{
    if(mk.on && !onField){ onField=true; since=mk.t; }
    else if(!mk.on && onField){ onField=false; sum += Math.max(0, mk.t-since); }
  });
  if(onField) sum += Math.max(0, total-since);
  return sum;
}
/* この選手（チーム内pid）の、大会を通じた合計出場時間（自動計算・分） */
function autoPlayMinutes(teamId, pid){
  if(!pid) return 0;
  let sum = 0;
  state.matches.forEach(m=>{
    ["H","A"].forEach(side=>{
      if(resolveSlot(m, side).id !== teamId) return;
      sum += computePlayMinutes(m, side, pid);
    });
  });
  return sum;
}
/* 時間帯ごとの得点数（side は "H" / "A"） */
function periodScore(m, period, side){
  return (m.events||[]).filter(e=>
    (e.type==="goal"||e.type==="pk"||e.type==="og")
    && (e.period||"1H")===period && scoringSideOf(e)===side).length;
}
/* この試合が延長を使うか（明示フラグ or 延長の得点がある） */
function matchUsesET(m){
  return !!(m.lineups && m.lineups._meta && m.lineups._meta.useET)
    || (m.events||[]).some(e=> e.period==="1ET" || e.period==="2ET")
    || etAppliesToMatch(m);   // 大会概要の「延長：どの試合から」でも自動でON
}
function setMatchET(m, on){
  m.lineups = m.lineups || {};
  m.lineups._meta = m.lineups._meta || {};
  m.lineups._meta.useET = !!on;
}
/* この試合で「実際に延長を行ったか」（明示ONか、延長の得点がある場合だけ。大会設定の対象条件は含めない） */
function matchETPlayed(m){
  return !!(m.lineups && m.lineups._meta && m.lineups._meta.useET)
    || (m.events||[]).some(e=> e.period==="1ET" || e.period==="2ET");
}
/* --- PK戦：1人ずつ 〇×（成功/失敗）を記録する。系列は lineups._meta.pk に持つ --- */
function pkArr(m, side){ return (m.lineups && m.lineups._meta && m.lineups._meta.pk && m.lineups._meta.pk[side]) || []; }
function pkCount(m, side){ return pkArr(m, side).filter(v=>v==="o").length; }
/* この試合で「PK戦を追加」したか（延長と同じ方式。明示ONか、〇×の記録があれば自動でも） */
function matchPKPlayed(m){
  return !!(m.lineups && m.lineups._meta && m.lineups._meta.usePK)
    || pkArr(m,"H").length>0 || pkArr(m,"A").length>0;
}
function toggleUsePK(on){
  const m = curMatch(); if(!m) return;
  if(!on){
    const has = pkArr(m,"H").some(v=>v) || pkArr(m,"A").some(v=>v);
    if(has && !confirm("PK戦の記録が入っています。PK戦をやめると記録も消えます。よろしいですか？")) return;
    m.lineups = m.lineups||{}; m.lineups._meta = m.lineups._meta||{};
    m.lineups._meta.usePK = false;
    m.lineups._meta.pk = { H:[], A:[] };
    m.home_pk = null; m.away_pk = null;
  } else {
    ensurePK(m);
    m.lineups._meta.usePK = true;
  }
  render();
}
function ensurePK(m){
  m.lineups = m.lineups || {};
  m.lineups._meta = m.lineups._meta || {};
  m.lineups._meta.pk = m.lineups._meta.pk || { H:[], A:[] };
  m.lineups._meta.pk.H = m.lineups._meta.pk.H || [];
  m.lineups._meta.pk.A = m.lineups._meta.pk.A || [];
  return m.lineups._meta.pk;
}
function pkKick(side, idx){
  const m = curMatch(); if(!m) return;
  const pk = ensurePK(m), arr = pk[side];
  while(arr.length <= idx) arr.push("");
  arr[idx] = arr[idx]==="" ? "o" : arr[idx]==="o" ? "x" : "";   // 空→〇→×→空
  while(arr.length && arr[arr.length-1]==="") arr.pop();        // 末尾の空を落とす
  const any = pk.H.length || pk.A.length;
  m.home_pk = any ? pkCount(m,"H") : null;                      // 〇の数を勝敗判定用に反映
  m.away_pk = any ? pkCount(m,"A") : null;
  render();
}
function pkRowHTML(m, side, label){
  const arr = pkArr(m, side);
  const n = Math.min(14, Math.max(5, arr.length + 1));           // 入った数＋1（5〜14）
  let cells = "";
  for(let i=0;i<n;i++){
    const v = arr[i] || "";
    const mark = v==="o" ? "〇" : v==="x" ? "×" : String(i+1);
    cells += `<button class="pkcell ${v}" onclick="pkKick('${side}',${i})">${mark}</button>`;
  }
  return `<div class="pkrow">
    <span class="pkname">${esc(label)}</span>
    <span class="pkcells">${cells}</span>
    <span class="pkcount">〇${pkCount(m,side)}</span></div>`;
}
/* このトーナメントの総ラウンド数（実際の櫓の最大round。無ければ koSize から） */
function koTotalRounds(bid){
  const ko = koMatchesOf(bid);
  if(ko.length) return Math.max(...ko.map(m=>m.round));
  return Math.round(Math.log2(cfgOf(state.t).koSize||2)) || 1;
}
/* 延長が「この試合」に適用されるか（大会概要の 延長あり＋どの試合から） */
function etAppliesToMatch(m){
  const ov = cfgOf(state.t).overview || {};
  if(!ov.hasET || !m || m.stage!=="ko") return false;   // 延長はトーナメント戦のみ
  const left = koTotalRounds(bracketIdOf(m)) - m.round;   // 0=決勝, 1=準決勝, 2=準々決勝 …
  const thr = ({ all:99, qf:2, sf:1, final:0 })[ov.etFrom||"all"];
  return left <= thr;
}
const ET_FROM_LABEL = { all:"全試合", qf:"準々決勝から", sf:"準決勝から", final:"決勝のみ" };

/* --- 総当たり表の組み合わせ（ローテーション法） --- */
function roundRobin(ids){
  const a = ids.slice();
  if(a.length % 2) a.push(null);
  const n = a.length, rounds = [];
  for(let r=0; r<n-1; r++){
    const pairs = [];
    for(let i=0;i<n/2;i++){
      const h = a[i], w = a[n-1-i];
      if(h && w) pairs.push(r%2 ? [w,h] : [h,w]);
    }
    rounds.push(pairs);
    a.splice(1,0,a.pop());
  }
  return rounds;
}

/* --- リーグ戦の対戦カードを作る --- */
function buildLeagueMatches(tid, teams, groups, doubleRound){
  const out = [];
  groups.forEach(g=>{
    const ids = teams.filter(t=>t.grp===g).sort((a,b)=>a.sort_order-b.sort_order).map(t=>t.id);
    const leg1 = roundRobin(ids);
    // ホーム&アウェイ：同じ組み合わせで2巡目をホーム/アウェイ入れ替えて続ける（節番号は通しで続ける）
    const allRounds = doubleRound ? leg1.concat(leg1.map(pairs=>pairs.map(([h,a])=>[a,h]))) : leg1;
    let n = 0;
    allRounds.forEach((pairs, ri)=>{
      pairs.forEach(([h,a])=>{
        out.push(newMatch(tid,{ stage:"league", grp:g, round:ri+1, slot:n,
                                home_team:h, away_team:a, sort_order:out.length }));
        n++;
      });
    });
  });
  return out;
}

/* --- 予選リーグの通過枠を「A組1位 vs B組2位」のように交差させて並べる ---
   adv は数値でも、ブロックidごとに数を返す関数でもよい（1部は2位まで／2部は1位だけ、など）。
   wcList=[{rank,count}] はワイルドカード枠（各組◯位のうち成績上位◯チーム）。 */
function qualifierSlots(groups, adv, wcList){
  const G = groups.length, out = [];
  const advOf = typeof adv === "function" ? (g=>Math.max(0,num(adv(g)))) : (()=>Math.max(0,num(adv)));
  if(G === 1){
    for(let r=1; r<=advOf(groups[0]); r++) out.push(`G:${groups[0]}#${r}`);
  }else{
    const maxAdv = Math.max(0, ...groups.map(advOf));
    for(let r=1; r<=maxAdv; r+=2){
      for(let i=0; i<G; i++){
        if(r <= advOf(groups[i])) out.push(`G:${groups[i]}#${r}`);
        const j = (i+1)%G;                                          // 同じ組同士が1回戦で当たらないように
        if(r+1 <= advOf(groups[j])) out.push(`G:${groups[j]}#${r+1}`);
      }
    }
  }
  (wcList||[]).forEach(w=>{
    for(let n=1; n<=num(w.count); n++) out.push(`B:${num(w.rank)}#${n}`);
  });
  // ブロックごとに勝ち上がる数が違うと、同じ組同士が1回戦で当たる並びになることがある。
  // その組だけ後ろの枠と入れ替えて直す（入れ替え先で新しい同組対決を作らないことも確認する）。
  const blkOf = s => (s||"").slice(0,2)==="G:" ? s.slice(2).split("#")[0] : null;
  for(let i=0; i+1<out.length; i+=2){
    const b = blkOf(out[i]);
    if(!b || b !== blkOf(out[i+1])) continue;
    for(let j=i+2; j<out.length; j++){
      if(blkOf(out[j]) === b) continue;
      const partner = (j%2===0) ? out[j+1] : out[j-1];         // 入れ替え先の相手
      if(partner!=null && blkOf(partner) === blkOf(out[i+1])) continue;
      const tmp = out[i+1]; out[i+1] = out[j]; out[j] = tmp;
      break;
    }
  }
  return out;
}

/* --- 参加者を1回戦の組に割り振る。足りない分は上位から不戦勝にする --- */
function distributePairs(items, koSize){
  const need = koSize/2;
  const pairs = [];
  for(let i=0; i<items.length; i+=2) pairs.push([items[i]??null, items[i+1]??null]);
  let guard = 0;
  while(pairs.length < need && guard++ < koSize){
    const idx = pairs.findIndex(p=> p[0]!=null && p[1]!=null);
    if(idx < 0) break;
    const [a,b] = pairs[idx];
    pairs.splice(idx, 1, [a,null], [b,null]);          // 上の組から順に不戦勝へ分ける
  }
  while(pairs.length < need) pairs.push([null,null]);
  return pairs.slice(0, need);
}

/* --- トーナメント表を作る（size=2,4,8,16,32） --- */
function assignSide(m, side, v){
  m[side+"_team"] = null; m[side+"_src"] = null;
  if(!v) return;
  if(typeof v === "string" && /^(G|B|W|L|T):/.test(v)) m[side+"_src"] = v;  // 組順位/ワイルドカード/勝者/敗者/自由文字の枠
  else m[side+"_team"] = v;
}
function buildKOMatches(tid, size, pairs, thirdPlace, bracketId){
  const bid = bracketId || KO_MAIN;
  const rounds = Math.round(Math.log2(size));
  const grid = [];                                  // grid[r][s] = match
  for(let r=1; r<=rounds; r++){
    grid[r] = [];
    const n = size / Math.pow(2,r);
    for(let s=0; s<n; s++){
      grid[r][s] = newMatch(tid,{ stage:"ko", grp:bid, round:r, slot:s, sort_order:r*100+s });
    }
  }
  // 1回戦にチーム（または「A組1位」などの枠）を配置
  for(let s=0; s<size/2; s++){
    const [h,a] = pairs[s] || [null,null];
    assignSide(grid[1][s], "home", h);
    assignSide(grid[1][s], "away", a);
  }
  // 勝者の進む先をつなぐ
  for(let r=2; r<=rounds; r++){
    grid[r].forEach((m,s)=>{
      m.home_src = "W:"+grid[r-1][s*2].id;
      m.away_src = "W:"+grid[r-1][s*2+1].id;
    });
  }
  let out = [];
  for(let r=1;r<=rounds;r++) out.push(...grid[r]);
  // 1回戦の不戦勝（片側だけ実体）は、そのままシードとして残す（相手が空→byeWinnerで2回戦へ自動）。
  //   両方空のマッチだけ削除。これで「シードのチームは2回戦から」という普通の大会表になる。
  grid[1].forEach(m=>{
    if(!m.home_team && !m.away_team && !m.home_src && !m.away_src){
      out.forEach(x=>["home","away"].forEach(sd=>{ if(x[sd+"_src"]==="W:"+m.id) x[sd+"_src"]=null; }));
      out = out.filter(x=>x.id!==m.id);
    }
  });
  if(thirdPlace && rounds>=2){
    const f = out.filter(m=>m.round===rounds-1 && m.slot!==99).sort((a,b)=>a.slot-b.slot);
    if(f.length>=2){
      out.push(newMatch(tid,{ stage:"ko", grp:bid, round:rounds, slot:99, sort_order:rounds*100+99,
        home_src:"L:"+f[0].id, away_src:"L:"+f[1].id }));
    }
  }
  return out;
}

/* 中身が空の櫓のひな形（準決勝2つ→決勝1つ）。追加したトーナメントの出発点にする */
function emptyBracketSkeleton(tid, bid){
  const a = newMatch(tid,{ stage:"ko", grp:bid, round:1, slot:0, sort_order:100 });
  const b = newMatch(tid,{ stage:"ko", grp:bid, round:1, slot:1, sort_order:101 });
  const f = newMatch(tid,{ stage:"ko", grp:bid, round:2, slot:0, sort_order:200,
                           home_src:"W:"+a.id, away_src:"W:"+b.id });
  return [a,b,f];
}

function newMatch(tid, o){
  return Object.assign({
    id:uid(), tournament_id:tid, org_id:state.user?.id||null,
    stage:"league", grp:null, round:1, slot:0, matchNo:null,
    home_team:null, away_team:null, home_src:null, away_src:null,
    kickoff:null, venue:null,
    home_score:null, away_score:null, home_pk:null, away_pk:null,
    status:"todo", events:[], note:null, sort_order:0,
  }, o);
}

/* --- 決勝トーナメントの枠に入るチームを解決する（循環参照ガード付き） --- */
function resolveSlot(m, side, seen){
  seen = seen || new Set();
  const direct = side==="H" ? m.home_team : m.away_team;
  if(direct) return { id:direct, label:teamName(direct), kind:"team" };
  const src = side==="H" ? m.home_src : m.away_src;
  if(!src) return { id:null, label:"—", kind:"tbd" };
  const kind = src.slice(0,1), key = src.slice(2);
  if(kind==="T") return { id:null, label:key||"（未定）", kind:"free" };  // 自由ラベル
  if(kind==="W" || kind==="L"){                     // W:試合id＝その試合の勝者、L:＝敗者
    if(seen.has(src)) return { id:null, label:"⚠", kind:"tbd" };         // 無限ループ防止
    seen.add(src);
    const pm = state.matches.find(x=>x.id===key);
    if(!pm) return { id:null, label:"—", kind:"tbd" };
    const w = winnerOf(pm, new Set(seen));
    if(!w) return { id:null, label:kind==="W" ? "勝者" : "敗者", kind:"from" };
    const H = resolveSlot(pm,"H",new Set(seen)), A = resolveSlot(pm,"A",new Set(seen));
    const hit = ((kind==="W") === (w===H.id)) ? H : A;
    return { id:hit.id, label:hit.label||"—", kind:"team" };
  }
  if(kind==="B"){                                   // B:<順位>#<n> ＝ 各組<順位>位のうち成績が<n>番目
    const p = key.split("#"), rank = num(p[0]), nth = Math.max(1, num(p[1]));
    const label = `各組${rank}位の${nth}番目`;
    if(!allBlocksDone()) return { id:null, label, kind:"from" };   // 全ブロックが終わるまでは枠のまま
    const row = wildcardRows(rank)[nth-1];
    return row ? { id:row.id, label:row.name, kind:"team" } : { id:null, label, kind:"from" };
  }
  if(kind==="G"){                                   // G:<ブロックid>#<順位>（旧: G:A1）
    let g, rank;
    if(key.includes("#")){ const p=key.split("#"); g=p[0]; rank=num(p[1]); }
    else { g=key.slice(0,1); rank=num(key.slice(1)); }   // 旧形式（1文字ブロック）
    const label = `${blockName(state.t,g)||g}${rank}位`;
    const gm = state.matches.filter(x=>x.stage==="league" && x.grp===g);
    if(!gm.length || !gm.every(isDone)) return { id:null, label, kind:"from" };   // 予選が終わるまでは枠のまま
    const row = standings(g)[rank-1];
    return row ? { id:row.id, label:row.name, kind:"team" } : { id:null, label, kind:"from" };
  }
  return { id:null, label:"—", kind:"tbd" };
}

function isDone(m){ return m.status==="done" && m.home_score!=null && m.away_score!=null; }

/* 完全に空の枠（＝不戦勝の相手側／シードの空きスロット） */
function isEmptySide(m, side){
  const pre = side==="H" ? "home" : "away";
  return !m[pre+"_team"] && !m[pre+"_src"];
}
/* 片側だけが実体＝シード（1回戦なしで直接上へ） */
function isSeedMatch(m){
  const eH = isEmptySide(m,"H"), eA = isEmptySide(m,"A");
  return eH !== eA;
}
/* 片側だけ実体があり、もう片側が空なら、その実体が自動で勝ち上がり（不戦勝） */
function byeWinner(m, seen){
  const eH = isEmptySide(m,"H"), eA = isEmptySide(m,"A");
  if(eH === eA) return null;                         // 両方空 or 両方あり → bye判定しない
  const live = eH ? "A" : "H";
  const r = resolveSlot(m, live, seen);
  return r.id || null;                               // 実体側が確定チームなら自動勝者
}
function winnerOf(m, seen){
  if(!m) return null;
  if(isDone(m)){
    const h = sideId(m,"H",seen), a = sideId(m,"A",seen);
    if(m.home_score > m.away_score) return h;
    if(m.home_score < m.away_score) return a;
    if(m.home_pk!=null && m.away_pk!=null && m.home_pk!==m.away_pk) return m.home_pk>m.away_pk ? h : a;
    return null;
  }
  return byeWinner(m, seen);                         // 未実施でも不戦勝は自動で上へ
}
function sideId(m, side, seen){
  const direct = side==="H" ? m.home_team : m.away_team;
  return direct || resolveSlot(m, side, seen).id || (side==="H"?"__H:":"__A:")+m.id;
}
function sideLabel(m, side){
  const r = resolveSlot(m, side);
  return r.label || "—";
}

/* --- 順位表 --- */
function standings(grp){
  const cfg = cfgOf(state.t);
  const teams = state.teams.filter(t=> grp ? t.grp===grp : true);
  const rows = teams.map(t=>({
    id:t.id, name:t.name, pl:0, w:0, d:0, l:0, gf:0, ga:0, pts:0, gd:0,
  }));
  const byId = Object.fromEntries(rows.map(r=>[r.id,r]));
  const played = state.matches.filter(m=> m.stage==="league" && isDone(m) && (!grp || m.grp===grp));
  played.forEach(m=>{
    const H = byId[m.home_team], A = byId[m.away_team];
    if(!H || !A) return;
    H.pl++; A.pl++;
    H.gf += m.home_score; H.ga += m.away_score;
    A.gf += m.away_score; A.ga += m.home_score;
    if(m.home_score > m.away_score){ H.w++; A.l++; H.pts += cfg.win; A.pts += cfg.lose; }
    else if(m.home_score < m.away_score){ A.w++; H.l++; A.pts += cfg.win; H.pts += cfg.lose; }
    else { H.d++; A.d++; H.pts += cfg.draw; A.pts += cfg.draw; }
  });
  rows.forEach(r=> r.gd = r.gf - r.ga);
  rows.sort((a,b)=>
      b.pts-a.pts || b.gd-a.gd || b.gf-a.gf || h2h(a,b,played,cfg) || a.name.localeCompare(b.name,"ja"));
  return rows;
}
/* 直接対決（勝った方を上に） */
/* 直接対決。ホーム&アウェイ（同一カード2試合）のときは両方まとめて比べる（勝ち点→得失点差の順） */
function h2h(a,b,played,cfg){
  const ms = played.filter(x=>
    (x.home_team===a.id && x.away_team===b.id) || (x.home_team===b.id && x.away_team===a.id));
  if(!ms.length) return 0;
  let aPts=0, bPts=0, aGf=0, aGa=0;
  ms.forEach(m=>{
    const aHome = m.home_team===a.id;
    const as = aHome ? m.home_score : m.away_score, bs = aHome ? m.away_score : m.home_score;
    aGf += as; aGa += bs;
    if(as>bs){ aPts += cfg.win; bPts += cfg.lose; }
    else if(as<bs){ bPts += cfg.win; aPts += cfg.lose; }
    else { aPts += cfg.draw; bPts += cfg.draw; }
  });
  if(aPts!==bPts) return aPts>bPts ? -1 : 1;
  if(aGf-aGa!==0) return (aGf-aGa)>0 ? -1 : 1;
  return 0;
}

/* --- 得点ランキング --- */
function scorerRanking(blockId){
  const map = new Map();
  state.matches.forEach(m=>{
    if(blockId && m.grp!==blockId) return;
    if(!isDone(m)) return;
    (m.events||[]).forEach(ev=>{
      if(ev.type!=="goal" && ev.type!=="pk") return;   // オウンゴールは個人記録に含めない
      if(!ev.playerId) return;
      const teamId = ev.team==="H" ? sideId(m,"H") : sideId(m,"A");
      const key = teamId + "/" + ev.playerId;
      const cur = map.get(key) || { teamId, pid:ev.playerId, n:0 };
      cur.n++; map.set(key, cur);
    });
  });
  return [...map.values()].sort((a,b)=> b.n-a.n).map(r=>({
    ...r, name:playerName(r.teamId, r.pid), team:teamName(r.teamId),
  }));
}

/* --- アシストランキング（大会設定でON/OFFできる） --- */
function assistRanking(blockId){
  const map = new Map();
  state.matches.forEach(m=>{
    if(blockId && m.grp!==blockId) return;
    if(!isDone(m)) return;
    (m.events||[]).forEach(ev=>{
      if(ev.type!=="goal" || !ev.assistId) return;   // アシストはふつうの得点だけ（PK・オウンゴールは対象外）
      const teamId = ev.team==="H" ? sideId(m,"H") : sideId(m,"A");
      const key = teamId + "/" + ev.assistId;
      const cur = map.get(key) || { teamId, pid:ev.assistId, n:0 };
      cur.n++; map.set(key, cur);
    });
  });
  return [...map.values()].sort((a,b)=> b.n-a.n).map(r=>({
    ...r, name:playerName(r.teamId, r.pid), team:teamName(r.teamId),
  }));
}

/* --- 懲罰集計 --- */
function cardRanking(blockId){
  const map = new Map();
  state.matches.forEach(m=>{
    if(blockId && m.grp!==blockId) return;
    (m.events||[]).forEach(ev=>{
      if(!CARD_ICON[ev.type] || !ev.playerId) return;
      const teamId = ev.team==="H" ? sideId(m,"H") : sideId(m,"A");
      const key = teamId + "/" + ev.playerId;
      const cur = map.get(key) || { teamId, pid:ev.playerId, yellow:0, red:0, green:0 };
      cur[ev.type]++; map.set(key, cur);
    });
  });
  return [...map.values()]
    .sort((a,b)=> (b.red*10+b.yellow)-(a.red*10+a.yellow))
    .map(r=>({ ...r, name:playerName(r.teamId,r.pid), team:teamName(r.teamId) }));
}

/* ==========================================================================
   画面
   ========================================================================== */
let _lastView = null, _lastTab = null;
