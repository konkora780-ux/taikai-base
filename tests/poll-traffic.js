// 自動更新（20秒ごと）の通信量を、にせSupabase（tests/support/fake-supabase.js）で実測し、
// あわせて大会画面の全タブ・試合を開いてもエラーが出ないかを確かめるスクリプト。
// 実行： node tests/poll-traffic.js   （ネットワーク不要。リポジトリのファイルをその場で配信して読む）
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const FAKE = fs.readFileSync(path.join(__dirname, "support", "fake-supabase.js"), "utf8");
const TYPES = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".css":"text/css", ".png":"image/png" };

function serve(){
  const srv = http.createServer((req, res)=>{
    const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html");
    if(!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()){ res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" });
    // にせSupabaseに差し替えるため、HTMLの改ざん防止（integrity）チェックだけ外して配信する
    if(p.endsWith(".html")) return res.end(fs.readFileSync(p, "utf8").replace(/\sintegrity="[^"]*"/g, ""));
    fs.createReadStream(p).pipe(res);
  });
  return new Promise(r=> srv.listen(0, ()=> r(srv)));
}

// 岩手県の規模（約37チーム・36試合）の大会を作る。校章は約20KB、公式記録は半分の試合でサイン3枚（各約18KB）つき
function fixture(){
  const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
  const ORG = uuid(1), TID = uuid(2);
  const crest = "data:image/png;base64," + "A".repeat(20000);
  const sign  = "data:image/png;base64," + "B".repeat(18000);
  const teams = Array.from({length:37}, (_,i)=>({ id:uuid(100+i), tournament_id:TID, org_id:ORG, name:`岩手県立テスト高校${i+1}`, grp:"A", seed:null, sort_order:i, club_id:null, crest,
    players: Array.from({length:30}, (_,j)=>({ id:`p${i}_${j}`, no:String(j+1), name:"山田 太郎", kana:"やまだ たろう", grade:"2", pos:"MF" })) }));
  const matches = Array.from({length:36}, (_,i)=>{
    const h = teams[i % 37], a = teams[(i+1) % 37];
    return { id:uuid(1000+i), tournament_id:TID, org_id:ORG, stage:"league", grp:"A", round:Math.floor(i/6)+1, slot:i, matchNo:i+1,
      home_team:h.id, away_team:a.id, home_src:null, away_src:null, kickoff:`2026-10-${String(15+(i%6)).padStart(2,"0")}T10:00:00+00:00`, venue:"テスト会場",
      home_score: i<18 ? 1 : null, away_score: i<18 ? 0 : null, home_pk:null, away_pk:null, status: i<18 ? "done" : "scheduled",
      events: i<18 ? [{ id:`e${i}`, type:"goal", team:"H", min:10, playerId:`p${i%37}_9` }] : [], note:"", sort_order:i, updated_at:"2026-10-01T00:00:00+00:00",
      lineups:{}, entry_lineups:null,
      official: i<18 ? { public:true, signs:{ ref:sign, H:sign, A:sign }, title:"テスト大会", H:{ name:h.name, lineup:[] }, A:{ name:a.name, lineup:[] } } : null };
  });
  const t = { id:TID, org_id:ORG, name:"第105回 選手権 岩手県大会（テスト）", sport:"soccer", format:"league",
    settings:{ win:3, draw:1, lose:0, groups:["A"], advanceBy:{}, wildcards:[], wcRule:"total", brackets:null, venues:[], koSize:8, thirdPlace:false, duration:40, blocks:[{id:"A",name:"A"}] },
    created_at:"2026-10-01T00:00:00+00:00" };
  return { ORG, TID, db:{ gn_tournaments:[t], gn_teams:teams, gn_matches:matches, gn_orgs:[{ id:ORG, name:"テスト団体", year:2026 }],
    gn_clubs:[], gn_members:[], gn_venues:[], gn_announcements:[], gn_entry:[], gn_club_entry:[], gn_org_members:[], gn_match_history:[] } };
}

async function run(role){
  const { ORG, TID, db } = fixture();
  const srv = await serve();
  const base = `http://localhost:${srv.address().port}/`;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", e=> errors.push(e.message));
  page.on("console", m=> { if(m.type()==="error"||m.type()==="warning") errors.push("console: "+m.text()); });
  // supabase-js（CDN）の代わりに、にせSupabaseを使う（テスト中は外部へ通信しない）
  await page.route(/cdn\.jsdelivr\.net\/npm\/@supabase/, r=> r.fulfill({ status:200, contentType:"text/javascript", body:FAKE }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r=> r.fulfill({ status:200, body:"" }));
  await page.addInitScript(([d, user])=>{ window.__fakeDb = d; window.__fakeUser = user; }, [db, role==="owner" ? { id:ORG, email:"test@taikai.invalid" } : null]);
  await page.clock.install();
  await page.goto(base + "index.html#t=" + TID);
  for(let i=0;; i++){   // 時計を止めているので、待つのはテスト側で行う
    const ok = await page.evaluate(()=> typeof state !== "undefined" && state.view === "t" && state.matches.length === 36).catch(()=>false);
    if(ok) break;
    if(i > 100) throw new Error("大会画面が開きませんでした: " + errors.join(" / ") + " " + await page.evaluate(()=> JSON.stringify({v:state.view, h:location.hash, t:!!state.t, n:(state.matches||[]).length, sb:!!sb, req:window.__requests&&window.__requests.length, body:document.body.innerText.slice(0,300)})));
    await page.clock.runFor(100); await page.waitForTimeout(100);
  }
  const bytes = () => page.evaluate(()=> window.__bytes);
  const initial = await bytes();
  const tick = async n => { for(let i=0;i<n;i++){ await page.clock.runFor(20000); await page.waitForTimeout(30); } };

  // ① 何も変わらないまま 9 回（3分）
  let b0 = await bytes(); await tick(9); const idle9 = (await bytes()) - b0;
  // ② 1試合のスコアが変わる → 次の自動更新でその試合だけ読み直し、画面に出る
  await page.evaluate(()=>{ const m = window.__fakeDb.gn_matches[20]; m.home_score = 3; m.away_score = 2; m.status = "done"; m.updated_at = "2026-10-20T01:00:00+00:00"; });
  b0 = await bytes(); await tick(1); const changed1 = (await bytes()) - b0;
  const reflected = await page.evaluate(()=> state.matches[20].home_score === 3 && state.matches[20].status === "done");
  // ③ チームの組が変わる → チームを読み直す
  await page.evaluate(()=>{ window.__fakeDb.gn_teams[0].name = "名前を変えたチーム"; });
  await tick(1);
  const teamReflected = await page.evaluate(()=> state.teams.some(t=> t.name === "名前を変えたチーム"));
  // ④ 軽い列に出ない変化（チームが記入リンクで出したメンバー）→ 5分ごとの試合の読み直しで拾う
  await page.evaluate(()=>{ window.__fakeDb.gn_matches[5].lineups = { H:{ players:[{ id:"x", name:"提出された選手", role:"start" }] } }; });
  await tick(4);   // ここまでで 15 回目
  const lineupReflected = await page.evaluate(()=> !!(state.matches[5].lineups && state.matches[5].lineups.H && state.matches[5].lineups.H.players.length));
  // ⑤ 1時間（180回）の合計
  b0 = await bytes(); await tick(180); const hour = (await bytes()) - b0;
  const reqSample = await page.evaluate(()=> window.__requests.slice(-4));

  // ⑥ 大会画面の全タブ・各試合の画面を開いてエラーが出ないか
  const tabs = await page.$$eval("nav button, .tabs button", els=> els.map(e=> e.textContent.trim()));
  for(const label of tabs){
    await page.locator("nav button, .tabs button", { hasText: label }).first().click().catch(()=>{});
    await page.waitForTimeout(50);
  }
  await page.evaluate(async ()=>{ if(typeof openMatch === "function"){ setTab("schedule"); } });
  await page.clock.runFor(20000); await page.waitForTimeout(50);   // タブを切り替えたあとも自動更新が止まらない

  await browser.close(); srv.close();
  return { role, initial, idle9, perIdlePoll: Math.round(idle9/9), changed1, hour, reflected, teamReflected, lineupReflected, tabs, errors, reqSample };
}

(async()=>{
  for(const role of ["guest","owner"]){
    const r = await run(role);
    console.log(JSON.stringify(r, null, 1));
  }
})().catch(e=>{ console.error(e); process.exit(1); });
