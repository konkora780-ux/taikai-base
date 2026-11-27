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

test("試合メンバーの人数：未設定ならスタメン11名・メンバー無制限。サブは「メンバー登録－スタメン」で決まる", ()=>{
  const ctx = setup();
  assert.equal(ctx.startCountOf(ctx.state.t), 11);
  assert.equal(ctx.matchLimitOf(ctx.state.t), null);
  assert.equal(ctx.subLimitOf(ctx.state.t), null);
  ctx.state.t.settings.registerLimit = 25; ctx.state.t.settings.matchLimit = 20;
  assert.equal(ctx.subLimitOf(ctx.state.t), 9);
  assert.equal(ctx.memberCountWarnings(ctx.state.t).length, 0);
  ctx.state.t.settings.matchLimit = 30;                     // 選手登録より多い
  assert.equal(ctx.memberCountWarnings(ctx.state.t).length, 1);
  ctx.state.t.settings.startCount = 8; ctx.state.t.settings.matchLimit = 18;
  assert.equal(ctx.startCountOf(ctx.state.t), 8);
  assert.equal(ctx.subLimitOf(ctx.state.t), 10);
  ctx.state.t = freshTournament(ctx, { sport:"futsal" });
  assert.equal(ctx.startCountOf(ctx.state.t), 5);
});

test("lineupSideOf：トーナメントの勝者枠も、前の試合の結果から自チームの側を判定できる", ()=>{
  const ctx = setup();
  const m1 = doneMatch("m1","A","B",2,1,{ stage:"ko", grp:null });
  const m2 = { id:"m2", tournament_id:"t1", stage:"ko", home_team:null, away_team:"C", home_src:"W:m1", away_src:null, status:"todo", events:[] };
  ctx.state.matches = [m1, m2];
  assert.equal(ctx.lineupSideOf(m2, "A"), "H");
  assert.equal(ctx.lineupSideOf(m2, "C"), "A");
  assert.equal(ctx.lineupSideOf(m2, "B"), null);   // 負けたチームは出せない
});

test("mergeEntryLineups：チームの提出を反映し、提出後に運営が直した側はそのまま", ()=>{
  const ctx = setup();
  const sub = { by:"team", submitted_at:"2026-11-08T01:00:00.000Z", coach:"監督", players:[{ pid:"p1", role:"start" }] };
  const a = { id:"x1", lineups:{ H:{ players:[{ pid:"p1", role:"sub" }] } }, entry_lineups:{ H:sub } };
  const b = { id:"x2", lineups:{ H:{ at:"2026-11-08T02:00:00.000Z", players:[{ pid:"p1", role:"out" }] } }, entry_lineups:{ H:sub } };
  ctx.mergeEntryLineups([a, b]);
  assert.equal(a.lineups.H.players[0].role, "start");
  assert.equal(a.lineups.H.coach, "監督");
  assert.equal(b.lineups.H.players[0].role, "out");
});

test("古い/欠けた試合データを読み込んでも、得点ランキングや出場記録の計算で止まらない（normalizeMatchRows）", () => {
  const ctx = setup();
  const ms = [
    doneMatch("m1","A","B",1,0,{ events:[null, {}, { type:"goal", team:"H", playerId:"p1" }],
      lineups:{ H:{ coach:"" }, A:"old", _meta:{ pk:null } }, kickoff:"xx" }),
    doneMatch("m2","B","C",0,0,{ events:null, lineups:null }),
  ];
  ctx.mergeEntryLineups(ms);
  assert.equal(ms[0].events.length, 2);               // 空の行(null)だけ捨てる
  assert.deepEqual(Array.from(ms[0].lineups.H.players), []);  // 選手一覧が無ければ空に
  assert.equal(ms[0].lineups.A, undefined);           // 読めない形のメンバー表は無しに
  assert.ok(ms[0].lineups._meta);                     // PKなどの付帯情報は残す
  assert.equal(ms[0].kickoff, null);                  // 日時として読めないキックオフは未定に
  assert.deepEqual(Array.from(ms[1].events), []);
  ctx.state.matches = ms;
  assert.doesNotThrow(() => ctx.scorerRanking(null));
});

test("ユニフォーム：FP正・副／GK正・副を1つの文字列に入れて読み戻せる（以前の「赤/白」も読める）", ()=>{
  const ctx = setup();
  const s = ctx.formatUniform({ fp1:"赤", fp2:"白", gk1:"黄", gk2:"" });
  assert.equal(s, "FP正:赤 / FP副:白 / GK正:黄");
  assert.deepEqual({ ...ctx.parseUniform(s) }, { fp1:"赤", fp2:"白", gk1:"黄", gk2:"" });
  assert.deepEqual({ ...ctx.parseUniform("赤/白") }, { fp1:"赤", fp2:"白", gk1:"", gk2:"" });
  assert.deepEqual({ ...ctx.parseUniform("青") }, { fp1:"青", fp2:"", gk1:"", gk2:"" });
  assert.equal(ctx.formatUniform({}), null);
});

test("選手登録票（エクセル）の読み取り：見出しの右の値と、番号・氏名の見出しより下の選手", ()=>{
  const ctx = setup();
  const rows = [
    ["選手登録票（1チーム1枚）"], [],
    ["チーム名","一関工業","","区分","高校生"],
    ["読み仮名","いちのせき","","略称","一関工"],
    ["代表者","","","監督","監督 二郎"],
    ["コーチ","コーチ 三郎","","大会の規模","全国・都道府県"],
    ["FP（正）","赤","","FP（副）","白"],
    ["GK（正）","黄","","GK（副）",""],
    ["チーム紹介","明るいチーム"],
    ["10","山田 太郎","さくら","6","FW"],               // 記入例（見出しより上）は選手にしない
    ["番号","氏名","前所属","学年","位置","よみがな","身長","体重"],
    ["7","鈴木 一郎","","2","fw","すずき","170","60"],
    ["","","","","","","",""],
    ["x","佐藤 花子","","","監督"],
  ];
  const r = ctx.parseTeamSheet(rows);
  assert.equal(r.profile.name, "一関工業");
  assert.equal(r.profile.category, "hs");
  assert.deepEqual(Array.from(r.profile.regions), ["national","pref"]);
  assert.equal(r.profile.rep_name, undefined);       // 空欄は上書きしない
  assert.equal(r.profile.coach2_name, "コーチ 三郎");
  assert.equal(r.profile.uniform_color, "FP正:赤 / FP副:白 / GK正:黄");
  assert.equal(r.players.length, 2);
  assert.deepEqual({ ...r.players[0] }, { no:7, name:"鈴木 一郎", prev_team:null, grade:2, pos:"FW", kana:"すずき", height:"170", weight:"60" });
  assert.equal(r.players[1].no, null);
  assert.equal(r.players[1].pos, null);
  assert.equal(ctx.parseTeamSheet([["チーム名","A"]]).hasRoster, false);
});

test("コーチ：6人まで別々の欄に入れ、「、」区切りの1つの文字列で保存する", ()=>{
  const ctx = setup();
  assert.equal(ctx.formatCoaches(["佐藤","","鈴木"]), "佐藤、鈴木");
  assert.equal(ctx.formatCoaches(["","",""]), null);
  assert.deepEqual(Array.from(ctx.parseCoaches("佐藤、鈴木")), ["佐藤","鈴木","","","",""]);
  assert.deepEqual(Array.from(ctx.parseCoaches("A,B、C、D、E、F、G")), ["A","B","C","D","E","F、G"]);   // 7人目以降も消さずに残す
  const r = ctx.parseTeamSheet([["コーチ１","佐藤","","コーチ2","鈴木"],["コーチ3","田中"],["コーチ6","高橋"],["番号","氏名"]]);
  assert.equal(r.profile.coach2_name, "佐藤、鈴木、田中、高橋");
});

test("区分に合わない学年の選手を見つける（読み込み前の注意用）", ()=>{
  const ctx = setup();
  const ps = [{ name:"A", grade:3 }, { name:"B", grade:4 }, { name:"C", grade:null }, { name:"D", grade:0 }];
  assert.deepEqual(ctx.playersWithBadGrade(ps, "jhs").map(p=>p.name), ["B","D"]);
  assert.deepEqual(ctx.playersWithBadGrade(ps, "elem").map(p=>p.name), ["D"]);
  assert.deepEqual(ctx.playersWithBadGrade(ps, "none").map(p=>p.name), ["A","B","D"]);
});

// --- 自動更新を軽くする仕組み（変わった試合だけ読み直す） ---
test("自動更新：軽い列が同じ試合は読み直さず、変わった試合・新しい試合だけを選ぶ", ()=>{
  const ctx = setup();
  const cur = [
    doneMatch("m1","A","B",1,0,{updated_at:"2026-11-01T00:00:00+00:00", lineups:{H:{players:[1,2]}}, official:{signs:{x:"data:..."}}}),
    doneMatch("m2","A","C",0,0,{status:"scheduled"}),
  ];
  const light = [
    doneMatch("m1","A","B",1,0,{updated_at:"2026-11-01T00:00:00+00:00"}),   // 重い列（メンバー表・公式記録）が無くても「同じ」
    doneMatch("m2","A","C",2,0,{status:"done"}),                          // スコアが変わった
    doneMatch("m3","B","C",0,0),                                          // 新しい試合
  ];
  assert.deepEqual([...ctx.changedMatchIds(cur, light)], ["m2","m3"]);
  const fresh = [doneMatch("m2","A","C",2,0,{lineups:{}}), doneMatch("m3","B","C",0,0)];
  const merged = ctx.mergePolledMatches(cur, light, fresh);
  assert.deepEqual(merged.map(m=>m.id), ["m1","m2","m3"]);
  assert.equal(merged[0], cur[0]);                        // 変わらない試合は手元のもの（メンバー表・公式記録つき）を残す
  assert.equal(merged[1].home_score, 2);
  // 消えた試合は外れる
  assert.deepEqual(ctx.mergePolledMatches(cur, [light[1]], [fresh[0]]).map(m=>m.id), ["m2"]);
});
test("自動更新：チームは並び・組・名前が変わったときだけ読み直す（名簿・校章は比べない）", ()=>{
  const ctx = setup();
  const cur = [team(ctx,"A",{players:[{no:"1"}], crest:"data:image/png;base64,xxx"}), team(ctx,"B")];
  assert.equal(ctx.teamsLightChanged(cur, [team(ctx,"A"), team(ctx,"B")]), false);
  assert.equal(ctx.teamsLightChanged(cur, [team(ctx,"A",{grp:"B"}), team(ctx,"B")]), true);
  assert.equal(ctx.teamsLightChanged(cur, [team(ctx,"A")]), true);
});
