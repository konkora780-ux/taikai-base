/* ==========================================================================
   大会ベース  —  リーグ/トーナメント大会の運営・結果公開アプリ
   ・保存先: Supabase（未設定でも端末内に保存して試せます）
   ・運営は「団体コード＋合言葉」でログイン、閲覧はログイン不要
   ========================================================================== */

/* ---------- 設定 ---------- */
const SUPABASE_URL      = "https://glxszbwsvembyygocekp.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdseHN6YndzdmVtYnl5Z29jZWtwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MDA5MzEsImV4cCI6MjA5NzE3NjkzMX0.Me73xDBFtOsNZ6ZRZZH8TNeXfwpiYvPBlplh4kRPsds";
const LOGIN_DOMAIN      = "taikai.invalid";
const POLL_MS           = 20000;   // 分担入力の自動反映（ミリ秒）

let sb = null;
const SUPABASE_CONFIGURED = !!(SUPABASE_URL && SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.includes("ここに"));
try{
  if(SUPABASE_CONFIGURED){
    if(typeof supabase === "undefined"){
      throw new Error("Supabaseライブラリの読み込みに失敗しました");
    }
    sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
}catch(e){ console.warn("Supabase初期化に失敗", e); }

if(SUPABASE_CONFIGURED && !sb){
  const b = document.createElement("div");
  b.className = "sb-fail-banner";
  b.innerHTML = '⚠ データベースへの接続に失敗しました。この状態では入力・結果が保存されません。'
    + '<button type="button">再読み込み</button>';
  b.querySelector("button").onclick = () => location.reload();
  document.body.prepend(b);
}

/* ---------- 競技の定義 ---------- */
const SPORTS = {
  soccer:{ label:"サッカー",         unit:"点", scorers:true,  cards:true,  pk:true,
           periods:["前半","後半","延長前半","延長後半"] },
  futsal:{ label:"フットサル",       unit:"点", scorers:true,  cards:true,  pk:true,
           periods:["第1P","第2P","延長"] },
};
const FORMATS = {
  league:    { label:"リーグ戦",              hasLeague:true,  hasKO:false },
  ko:        { label:"トーナメント戦",        hasLeague:false, hasKO:true  },
  league_ko: { label:"予選リーグ＋決勝T",     hasLeague:true,  hasKO:true  },
};
const GROUP_NAMES = "ABCDEFGH".split("");
const CARD_ICON = { yellow:"🟨", red:"🟥", green:"🟩" };
const CARD_LABEL = { yellow:"警告", red:"退場", green:"グリーン" };
/* JFA準拠の警告・退場コード表（本人提供）。理由を選ぶと自由記述欄に自動で入る（あとで書き換え可） */
const CARD_REASONS = {
  yellow: [
    { code:"C1", label:"反スポーツ的行為", note:"シミュレーション、意図的なハンドによる有利取得、有望な攻撃の阻止なども含む" },
    { code:"C2", label:"ラフプレー", note:"無謀なタックルなど相手への危険を伴うプレー" },
    { code:"C3", label:"異議" },
    { code:"C4", label:"繰り返しの違反" },
    { code:"C5", label:"遅延行為" },
    { code:"C6", label:"距離不足" },
    { code:"C7", label:"無許可で入場" },
    { code:"C8", label:"無許可で退場" },
  ],
  red: [
    { code:"S1", label:"著しく不正なプレー" },
    { code:"S2", label:"乱暴な行為" },
    { code:"S3", label:"つば吐き" },
    { code:"S4", label:"得点または決定的得点機会の阻止（ハンド）" },
    { code:"S5", label:"決定的得点機会の阻止（反則）" },
    { code:"S6", label:"侮辱的・攻撃的・下品な発言または行動" },
    { code:"S7", label:"警告2回による退場" },
  ],
};
/* 得点・交代の時間帯 */
const PERIODS    = { "1H":"前半", "2H":"後半", "1ET":"延長前", "2ET":"延長後", "HT":"HT" };
const PERIOD_REG = ["1H","2H"];      // ふつうの試合
const PERIOD_ET  = ["1ET","2ET"];    // 延長を使う試合だけ

/* ---------- 学年の区分（卒業の判定に使う） ---------- */
const CATEGORIES = {
  elem: { label:"小学生", max:6, suffix:"年" },
  jhs:  { label:"中学生", max:3, suffix:"年" },
  hs:   { label:"高校生", max:3, suffix:"年" },
  univ: { label:"大学生", max:4, suffix:"年" },
  none: { label:"学年なし", max:0, suffix:"" },
};
/* ---------- 大会の規模（全国／都道府県／地域） ---------- */
const SCOPES = {
  national: { label:"全国" },
  pref:     { label:"都道府県" },
  local:    { label:"地域" },
};
const POSITIONS = ["GK","DF","MF","FW"];

/* 日本の年度（4月始まり）。3月31日までは前年の年度 */
function fiscalYear(d){
  d = d || new Date();
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear()-1;
}
function gradeLabel(cat, grade){
  const c = CATEGORIES[cat] || CATEGORIES.none;
  if(!c.max || !grade) return "";
  return grade + c.suffix;
}

/* ---------- 小道具 ---------- */
const $ = s=>document.querySelector(s);
const uid = ()=> (crypto.randomUUID ? crypto.randomUUID()
                 : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{
                     const r=Math.random()*16|0; return (c==="x"?r:(r&3|8)).toString(16); }));
const esc = s => String(s??"").replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const num = v => { const n = parseInt(v,10); return Number.isFinite(n) ? n : 0; };
function fmtDate(iso){
  if(!iso) return "";
  const d = new Date(iso); if(isNaN(d)) return "";
  const w = "日月火水木金土"[d.getDay()];
  return `${d.getMonth()+1}/${d.getDate()}(${w})`;
}
function fmtTime(iso){
  if(!iso) return "";
  const d = new Date(iso); if(isNaN(d)) return "";
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}
function toast(msg){
  const el = document.createElement("div");
  el.className = "toast"; el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(()=>el.remove(), 2200);
}

/* ---------- モーダルのアクセシビリティ ----------
   全モーダルは class="modal" で document.body へappendされ、
   this.closest('.modal').remove() で閉じられる、という統一パターンなので、
   ここ一箇所でフォーカストラップ／Escで閉じる／閉じた後のフォーカス復帰／
   role="dialog"付与を全モーダル共通で行う。個々のモーダルの記述は変更不要。 */
(function(){
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const open = new Map();
  function onKeydown(e){
    const el = e.currentTarget;
    if(e.key === "Escape"){ e.stopPropagation(); el.remove(); return; }
    if(e.key !== "Tab") return;
    const items = [...el.querySelectorAll(FOCUSABLE)].filter(x=>x.offsetParent!==null);
    if(!items.length) return;
    const first = items[0], last = items[items.length-1];
    if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
  }
  function onAdded(el){
    el.setAttribute("role","dialog");
    el.setAttribute("aria-modal","true");
    if(!el.hasAttribute("tabindex")) el.setAttribute("tabindex","-1");
    el.addEventListener("keydown", onKeydown);
    open.set(el, { prevFocus: document.activeElement });
    const first = el.querySelector(FOCUSABLE);
    (first || el).focus();
  }
  function onRemoved(el){
    const info = open.get(el); if(!info) return;
    open.delete(el);
    const pf = info.prevFocus;
    if(pf && document.body.contains(pf) && typeof pf.focus === "function") pf.focus();
  }
  new MutationObserver(muts=>{
    for(const m of muts){
      m.addedNodes.forEach(n=>{ if(n.nodeType===1 && n.classList && n.classList.contains("modal")) onAdded(n); });
      m.removedNodes.forEach(n=>{ if(n.nodeType===1 && n.classList && n.classList.contains("modal")) onRemoved(n); });
    }
  }).observe(document.body, { childList:true });
})();

/* ---------- 状態 ---------- */
const state = {
  view:"home",      // home | login | new | t | match | teams | settings | roster | club
  user:null,        // {id, code}
  list:[],          // 大会一覧
  t:null,           // 表示中の大会
  teams:[],
  matches:[],
  tab:"schedule",
  matchId:null,
  loading:false,
  /* --- 年度をまたいで残る台帳 --- */
  org:null,         // {id, name, year}
  clubs:[],         // チーム台帳
  members:[],       // 選手台帳
  clubId:null,      // 表示中のチーム
  showGrads:false,  // 卒業した選手も表示するか
  official:null,    // 編集中の公式記録
  sheetZoom:0.8,
  bracket:null,     // 表示中のトーナメント（1位T・2位T…を複数持てる）
  scheduleCollapsed:{},   // 日程タブの節・回戦ごとの開閉状態（キー=見出し文字列）
  blockFilter:"",         // 日程・ランキング系タブで選んでいるブロック（カテゴリー）。空="すべて"
  unlockTeams:false,      // 選手登録の締切を過ぎたあと「編集する」で一時的にロック解除したか
};
const canEdit = ()=> !!(state.user && state.t && state.t.org_id === state.user.id && state.user.role!=="viewer");
const orgYear = ()=> state.org?.year ?? fiscalYear();

/* ==========================================================================
   保存まわり（Supabase / 端末内）
   ========================================================================== */
const LOCAL_KEY = "taikai_local_v1";
const EMPTY_DB  = { t:[], teams:[], matches:[], clubs:[], members:[], orgs:[], entry:[], clubEntry:[], venues:[] };
const TBL_KEY   = { gn_tournaments:"t", gn_teams:"teams", gn_matches:"matches",
                    gn_clubs:"clubs", gn_members:"members", gn_orgs:"orgs", gn_entry:"entry", gn_venues:"venues" };
const local = {
  read(){ try{ return Object.assign({}, EMPTY_DB, JSON.parse(localStorage.getItem(LOCAL_KEY))||{}); }
          catch(e){ return Object.assign({}, EMPTY_DB); } },
  write(d){ localStorage.setItem(LOCAL_KEY, JSON.stringify(d)); },
};

