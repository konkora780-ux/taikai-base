// 大会ベース：計算ロジックの単体テスト
// js/calc.js 等の「本番と同じコード」を実際に読み込んで検証する（テスト用に書き直したロジックではない）。
// Supabase・ブラウザ不要。実行： npm run test:unit
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadApp } = require("./support/load-app");

function freshTournament(ctx, overrides){
  return Object.assign({
    id: "t1", org_id: "local", name: "テスト大会", sport: "soccer", format: "league",
    settings: { win:3, draw:1, lose:0, groups:["A"], advanceBy:{}, wildcards:[], wcRule:"total",
      brackets:null, venues:[], koSize:8, thirdPlace:false, duration:20,
      blocks:[{id:"A", name:"A"}] },
    created_at: new Date().toISOString(),
  }, overrides || {});
}
function team(ctx, id, extra){ return Object.assign({ id, tournament_id:"t1", org_id:"local", name:id, grp:"A", players:[] }, extra||{}); }
function doneMatch(id, home, away, hs, as, extra){
  return Object.assign({ id, tournament_id:"t1", org_id:"local", stage:"league", grp:"A",
    home_team:home, away_team:away, home_score:hs, away_score:as, status:"done", events:[], sort_order:1 }, extra||{});
}

function setup(){
  const ctx = loadApp();
  ctx.state.t = freshTournament(ctx);
  ctx.state.teams = [team(ctx,"A"), team(ctx,"B"), team(ctx,"C")];
  ctx.state.matches = [];
  return ctx;
}

test("standings: 勝ち3点・分け1点・負け0点で正しく集計される（回帰確認用の基準ケース）", ()=>{
  const ctx = setup();
  ctx.state.matches = [
    doneMatch("m1","A","B",2,0),
    doneMatch("m2","A","C",1,1),
    doneMatch("m3","B","C",1,0),
  ];
  const rows = ctx.standings("A");
  const byId = Object.fromEntries(rows.map(r=>[r.id,r]));
  assert.equal(byId.A.pts, 4);   // 勝(3)+分(1)
  assert.equal(byId.B.pts, 3);   // 負(0)+勝(3)
  assert.equal(byId.C.pts, 1);   // 分(1)+負(0)
  // 順位は勝点順（A→B→C）
  assert.deepEqual(rows.map(r=>r.id), ["A","B","C"]);
});

test("standings: 勝点の加算・減算（pts_adjust）が反映され、順位も入れ替わる", ()=>{
  const ctx = setup();
  ctx.state.matches = [
    doneMatch("m1","A","B",2,0),
    doneMatch("m2","A","C",1,0),
    doneMatch("m3","B","C",1,0),
  ]; // 素点：A=6, B=3, C=0
  ctx.state.teams.find(t=>t.id==="A").pts_adjust = -4;
  const rows = ctx.standings("A");
  const byId = Object.fromEntries(rows.map(r=>[r.id,r]));
  assert.equal(byId.A.pts, 2);
  assert.equal(byId.A.adj, -4);
  assert.deepEqual(rows.map(r=>r.id), ["B","A","C"]);   // B(3) > A(2) > C(0)
});

test("standings: pts_adjustが無いチームは今までどおり（既存大会への影響なしの確認）", ()=>{
  const ctx = setup();
  ctx.state.matches = [doneMatch("m1","A","B",2,0)];
  const rows = ctx.standings("A");
  rows.forEach(r=> assert.equal(r.adj, 0));
});

test("standings: 順位の手動並べ替え（rankOrder）が反映され、解除すると自動計算に戻る", ()=>{
  const ctx = setup();
  ctx.state.matches = [
    doneMatch("m1","A","B",2,0),
    doneMatch("m2","A","C",1,0),
    doneMatch("m3","B","C",1,0),
  ];
  const natural = ctx.standings("A").map(r=>r.id);
  assert.deepEqual(natural, ["A","B","C"]);

  ctx.state.t.settings.rankOrder = { A: ["C","A","B"] };
  assert.deepEqual(ctx.standings("A").map(r=>r.id), ["C","A","B"]);

  ctx.state.t.settings.rankOrder = {};
  assert.deepEqual(ctx.standings("A").map(r=>r.id), natural);
});

test("standings: 不戦勝・没収・認定スコア（result_type）はラベルに過ぎず、通常の試合と同じ計算になる", ()=>{
  const ctx = setup();
  ctx.state.matches = [
    doneMatch("m1","A","B",3,0,{ result_type:"walkover_home", result_note:"相手未到着" }),
  ];
  const rows = ctx.standings("A");
  const byId = Object.fromEntries(rows.map(r=>[r.id,r]));
  assert.equal(byId.A.pts, 3);
  assert.equal(byId.A.w, 1);
  assert.equal(byId.B.pts, 0);
  assert.equal(byId.B.l, 1);
});

test("standings: 中止・延期の試合は集計に含まれない", ()=>{
  const ctx = setup();
  ctx.state.matches = [
    doneMatch("m1","A","B",2,0),
    { id:"m2", tournament_id:"t1", org_id:"local", stage:"league", grp:"A",
      home_team:"A", away_team:"C", home_score:null, away_score:null, status:"cancelled", events:[], sort_order:2 },
    { id:"m3", tournament_id:"t1", org_id:"local", stage:"league", grp:"A",
      home_team:"B", away_team:"C", home_score:null, away_score:null, status:"postponed", events:[], sort_order:3 },
  ];
  const rows = ctx.standings("A");
  const byId = Object.fromEntries(rows.map(r=>[r.id,r]));
  assert.equal(byId.A.pl, 1);
  assert.equal(byId.C.pl, 0);   // 中止・延期の分は「試合数」に入らない
});

test("出場停止：警告が設定枚数に達すると次の試合が対象になる（未設定なら空配列）", ()=>{
  const ctx = setup();
  ctx.state.teams = [team(ctx,"A"), team(ctx,"B")];
  ctx.state.matches = [
    doneMatch("m1","A","B",1,0,{ matchNo:1, events:[{type:"yellow", team:"H", playerId:"p1"}] }),
    doneMatch("m2","B","A",0,0,{ matchNo:2, events:[{type:"yellow", team:"A", playerId:"p1"}] }),
    { id:"m3", tournament_id:"t1", org_id:"local", stage:"league", grp:"A", matchNo:3,
      home_team:"A", away_team:"B", home_score:null, away_score:null, status:"todo", events:[], sort_order:3 },
  ];

  // 設定が無いときは何も返さない（既存大会への影響なしの確認）
  // ※ vmサンドボックス内で作られた配列はNode本体とは別レルムのオブジェクトになるため、
  //   deepEqual([], [])ではなくlengthで比較する
  assert.equal(ctx.computeSuspensions().length, 0);

  ctx.state.t.settings.suspension = { enabled:true, yellowAccum:2, yellowGames:1, redGames:1 };
  const list = ctx.computeSuspensions();
  const a = list.find(x=>x.teamId==="A");
  assert.ok(a, "警告2枚累積のAが出場停止リストに含まれる");
  assert.equal(a.yellow, 2);
  assert.equal(a.matches.length, 1);
  assert.equal(a.matches[0].id, "m3");   // 次の試合が対象
});

test("出場停止：退場は即座に次の試合が対象になる", ()=>{
  const ctx = setup();
  ctx.state.teams = [team(ctx,"A"), team(ctx,"B")];
  ctx.state.matches = [
    doneMatch("m1","A","B",1,0,{ matchNo:1, events:[{type:"red", team:"H", playerId:"p9"}] }),
    { id:"m2", tournament_id:"t1", org_id:"local", stage:"league", grp:"A", matchNo:2,
      home_team:"B", away_team:"A", home_score:null, away_score:null, status:"todo", events:[], sort_order:2 },
  ];
  ctx.state.t.settings.suspension = { enabled:true, yellowAccum:2, yellowGames:1, redGames:2 };
  const a = ctx.computeSuspensions().find(x=>x.teamId==="A");
  assert.equal(a.red, 1);
  assert.equal(a.stillPending, 1);   // redGames=2のうち1試合分はまだ消化されていない
  assert.equal(a.matches.length, 1);
});

test("canEdit: 団体代表はtrue、閲覧のみロールはfalse、他団体の大会はfalse", ()=>{
  const ctx = setup();
  ctx.state.user = { id:"local", code:"test", role:"owner" };
  assert.equal(ctx.canEdit(), true);

  ctx.state.user = { id:"local", code:"test", role:"viewer" };
  assert.equal(ctx.canEdit(), false);

  ctx.state.user = { id:"other-org", code:"test", role:"owner" };
  assert.equal(ctx.canEdit(), false);
});

test("お知らせの公開期間：公開状態と開始・終了日時の組み合わせで正しく表示可否が決まる", ()=>{
  const ctx = loadApp();
  const now = Date.now();
  const hourMs = 60*60*1000;
  const base = { title:"t", body:"", pinned:false };

  assert.equal(ctx.announcementVisible({ ...base, published:false }), false, "下書きは非表示");
  assert.equal(ctx.announcementVisible({ ...base, published:true, publish_from:null, publish_until:null }), true, "期間指定なしの公開は表示");
  assert.equal(ctx.announcementVisible({ ...base, published:true,
    publish_from: new Date(now+hourMs).toISOString(), publish_until:null }), false, "公開開始前は非表示");
  assert.equal(ctx.announcementVisible({ ...base, published:true,
    publish_from:null, publish_until: new Date(now-hourMs).toISOString() }), false, "公開終了後は非表示");
  assert.equal(ctx.announcementVisible({ ...base, published:true,
    publish_from: new Date(now-hourMs).toISOString(), publish_until: new Date(now+hourMs).toISOString() }), true, "期間内は表示");
});

// 「変更履歴」（gn_match_history）はPostgresのトリガーで記録される仕組みで、
// このテストはJSのロジックだけを検証するため対象外。setup-14.sqlの確認クエリで
// トリガー作成済みであることを確認済み（実データでの記録はSupabase側の責務）。
