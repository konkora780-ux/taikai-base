// 会場担当の入力リンク（setup-32）を、にせSupabaseで確かめるスクリプト。
// 実行： node tests/venue-entry.js   （ネットワーク不要）  SHOT=フォルダ を付けると画面の写真も保存する
"use strict";
const { chromium } = require("playwright");
const { serve, fixture, FAKE } = require("./poll-traffic");

(async()=>{
  const fx = fixture();
  // 奇数番目の試合は「第2会場」にする（別会場の試合は書けないことを確かめる）
  fx.db.gn_matches.forEach((m,i)=>{ if(i%2===1) m.venue = "第2会場"; });
  fx.db.gn_venue_entry = [];
  const srv = await serve(47813);
  const base = `http://localhost:${srv.address().port}/index.html`;
  const browser = await chromium.launch();
  const out = {}; let ok = true;
  const check = (name, cond, extra) => { out[name] = cond ? "OK" : "NG " + (extra||""); if(!cond) ok = false; };
  const shot = process.env.SHOT;
  const open = async (user, db, hash, viewport) => {
    const page = await (await browser.newContext({ viewport: viewport || { width:390, height:844 } })).newPage();
    const errors = [];
    page.on("pageerror", e=> errors.push(e.message));
    await page.route(/cdn\.jsdelivr\.net\/npm\/@supabase/, r=> r.fulfill({ status:200, contentType:"text/javascript", body:FAKE }));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r=> r.fulfill({ status:200, body:"" }));
    await page.addInitScript(([d, u])=>{ window.__fakeDb = d; window.__fakeUser = u; }, [db, user]);
    await page.goto(base + hash);
    return { page, errors };
  };

  // ① 運営：発行する
  const own = await open({ id:fx.ORG, email:"test@taikai.invalid" }, fx.db, `#t=${fx.TID}`);
  await own.page.waitForFunction(()=> typeof state!=="undefined" && !state.loading && state.view==="t" && state.matches.length===36, null, { timeout:15000 });
  await own.page.evaluate(()=> openVenueLinks()); await own.page.waitForTimeout(300);
  const pairs = await own.page.evaluate(()=> venueDayPairs().length);
  check("会場×日付の組み合わせ（各日1会場×6日）", pairs === 6, pairs);
  await own.page.evaluate(()=> issueVenueLink("テスト会場", "2026-10-15")); await own.page.waitForTimeout(300);
  const row = await own.page.evaluate(()=> window.__fakeDb.gn_venue_entry[0]);
  check("発行：コード6文字", row && /^[A-Z0-9]{6}$/.test(row.code), JSON.stringify(row));
  check("発行：期限はその日の24時（日本時間）", row && row.expires_at === "2026-10-15T15:00:00.000Z", row && row.expires_at);
  if(shot) await own.page.screenshot({ path:`${shot}/会場担当リンクの発行（運営・スマホ）.png`, fullPage:true });
  // テストでは期限を未来にする（試合の日付が過去のため）
  const db2 = await own.page.evaluate(()=>{ const d = JSON.parse(JSON.stringify(window.__fakeDb)); d.gn_venue_entry[0].expires_at = "2099-01-01T00:00:00Z"; return d; });
  check("運営の画面：エラーなし", own.errors.length===0, own.errors.join(" / "));

  // ② 会場担当：ログインなしで開く
  const g = await open(null, db2, `#venue=${row.id}`);
  await g.page.waitForFunction(()=> typeof state!=="undefined" && state.view==="venueentry", null, { timeout:15000 });
  await g.page.fill("#venuecode", "ZZZZZZ"); await g.page.click("text=開く"); await g.page.waitForTimeout(300);
  check("違うコードでは開けない", await g.page.evaluate(()=> !state.venueEntry.ok && !!state.venueEntry.error));
  await g.page.evaluate(()=> window.__bytes = 0);
  await g.page.fill("#venuecode", row.code.toLowerCase()); await g.page.click("text=開く");
  await g.page.waitForFunction(()=> state.venueEntry.ok, null, { timeout:5000 });
  const listed = await g.page.evaluate(()=> venueMatchesOf(state.matches, state.venueEntry.venue, state.venueEntry.day).map(m=>m.matchNo));
  check("その会場・その日の試合だけが出る（6件）", JSON.stringify(listed) === JSON.stringify([1,7,13,19,25,31]), JSON.stringify(listed));
  const openBytes = await g.page.evaluate(()=> window.__bytes);
  check("サイン画像は読まない", await g.page.evaluate(()=> !window.__signBytes));
  if(shot) await g.page.screenshot({ path:`${shot}/会場の試合一覧（会場担当・スマホ）.png`, fullPage:true });

  // 試合No.19（未実施）に結果を入れる
  const mid = fx.db.gn_matches[18].id;
  await g.page.evaluate(id=> openVenueMatch(id), mid); await g.page.waitForTimeout(200);
  check("結果入力の画面が開く", await g.page.evaluate(()=> state.view==="match" && !!document.querySelector(".scorebox")));
  check("日時・会場の入力欄は出ない", await g.page.evaluate(()=> !document.querySelector('input[type="datetime-local"]') && !document.querySelector('input[list="venueList"]')));
  check("メンバー表のボタンは出ない・公式記録はサイン用のボタン", await g.page.evaluate(()=> ![...document.querySelectorAll("button")].some(b=>/👥 メンバー表/.test(b.textContent))
    && [...document.querySelectorAll("button")].some(b=>/最終チェック・サイン/.test(b.textContent))));
  check("大会のメニュー（サイドバー）は出ない", await g.page.evaluate(()=> !document.querySelector(".tside, .tsidebar, .tnav")));
  await g.page.evaluate(()=>{ const m = curMatch(); const pid = state.teams.find(t=>t.id===m.home_team).players[9].id;
    m.events.push({ id:uid(), type:"goal", team:"H", period:"1H", minute:12, playerId:pid }); m.home_score = 1; m.away_score = 0;
    setOfficialField("referee", "佐藤 審判"); setOfficialField("weather", "晴"); m.note = "テストメモ"; });
  if(shot){ await g.page.evaluate(()=>{ document.querySelector("details.ofcard").open = true; }); await g.page.screenshot({ path:`${shot}/結果入力（会場担当・スマホ）.png`, fullPage:true }); }
  await g.page.evaluate(()=> setStatus("live")); await g.page.waitForTimeout(300);
  const saved = await g.page.evaluate(id=> window.__fakeDb.gn_matches.find(m=>m.id===id), mid);
  check("保存：スコア・状態・得点・メモ", saved.home_score===1 && saved.status==="live" && saved.events.length===1 && saved.note==="テストメモ", JSON.stringify([saved.home_score,saved.status,saved.events.length,saved.note]));
  check("保存：審判名・天候", saved.official && saved.official.referee==="佐藤 審判" && saved.official.weather==="晴", JSON.stringify(saved.official));
  check("保存：日時・会場は変わらない", saved.kickoff===fx.db.gn_matches[18].kickoff && saved.venue==="テスト会場");
  check("保存：公式記録のメンバー欄などは送られない", saved.official && !("H" in saved.official) && !("signs" in saved.official), Object.keys(saved.official||{}).join(","));

  // 終了済みでサインのある試合No.1：修正しても、サインは消えない
  const m0 = fx.db.gn_matches[0].id;
  await g.page.evaluate(()=>{ window.confirm = ()=> true; });
  await g.page.evaluate(async id=>{ await venueBack(); openVenueMatch(id); await unlockMatch(id); setOfficialField("referee","鈴木"); await saveMatch(true); }, m0);
  const s0 = await g.page.evaluate(id=> window.__fakeDb.gn_matches.find(m=>m.id===id), m0);
  check("終了後の修正：サインはそのまま", s0.official.signs && /SIGNIMAGE/.test(s0.official.signs.mc) && s0.official.referee==="鈴木" && s0.official.title==="テスト大会", JSON.stringify(Object.keys(s0.official)));

  // 公式記録の最終チェック・サイン（その試合の分だけサインを読む）
  await g.page.evaluate(()=> window.__signBytes = 0);
  await g.page.evaluate(async id=>{ await openVenueOfficial(id); }, m0); await g.page.waitForTimeout(300);
  check("公式記録の画面が開く", await g.page.evaluate(()=> state.view==="official" && !!document.querySelector(".sheet-a4")));
  const sb1 = await g.page.evaluate(()=> window.__signBytes||0);
  check("サイン画像はその1試合分だけ読む（約54KB）", sb1 > 50000 && sb1 < 70000, sb1);
  check("メンバー表の編集ボタンは出ない", await g.page.evaluate(()=> ![...document.querySelectorAll("button")].some(b=>/メンバー表を編集/.test(b.textContent))));
  if(shot) await g.page.screenshot({ path:`${shot}/公式記録（会場担当・スマホ）.png`, fullPage:false });
  await g.page.evaluate(async ()=>{ state.official.signs = Object.assign({}, state.official.signs, { ref:"data:image/png;base64,NEWSIGN" }); state.official.public = false; await saveOfficial(true); });
  const s1 = await g.page.evaluate(id=> window.__fakeDb.gn_matches.find(m=>m.id===id).official, m0);
  check("サインを保存できる", s1.signs.ref === "data:image/png;base64,NEWSIGN" && /SIGNIMAGE/.test(s1.signs.mc));
  check("公開・非公開は会場担当からは変わらない", s1.public === true);
  await g.page.evaluate(()=> subBack()); await g.page.waitForTimeout(200);
  check("戻ると結果入力の画面", await g.page.evaluate(()=> state.view==="match"));
  const r3 = await g.page.evaluate(([id,c,o])=> DB.venueGetOfficial(id, c, o), [row.id, row.code, fx.db.gn_matches[1].id]);
  check("別会場の公式記録は読めない", r3 && r3.ok===false && r3.reason==="notyours", JSON.stringify(r3));

  // 細工：別会場の試合・違うコード
  const other = fx.db.gn_matches[1].id;
  const r1 = await g.page.evaluate(([id,c,o])=> DB.venueSaveMatch(id, c, state.matches.find(m=>m.id===o) || { id:o }), [row.id, row.code, other]);
  check("別会場の試合は書けない", r1 === "notyours", r1);
  const r2 = await g.page.evaluate(([id,o])=> DB.venueSaveMatch(id, "AAAAAA", { id:o }), [row.id, mid]);
  check("違うコードでは書けない", r2 === "code", r2);
  check("会場担当の画面：エラーなし", g.errors.length===0, g.errors.join(" / "));

  // 参考：一般の閲覧（大会のページ）を開いたときの通信量
  const v = await open(null, db2, `#t=${fx.TID}`);
  await v.page.waitForFunction(()=> typeof state!=="undefined" && !state.loading && state.view==="t" && state.matches.length===36, null, { timeout:15000 });
  const viewBytes = await v.page.evaluate(()=> window.__bytes);
  const saveOne = await g.page.evaluate(()=>{ const r = window.__requests.filter(x=>x.table==="venue_save_match"); return r.length ? r[r.length-1].size : 0; });

  console.log(JSON.stringify(out, null, 1));
  console.log(`保存1回の返事 ${saveOne}文字`);
  console.log(`通信量の目安：会場担当がリンクを開く ${Math.round(openBytes/1024)}KB ／ 一般の閲覧で大会のページを開く ${Math.round(viewBytes/1024)}KB（どちらも初回・校章や名簿を覚える前）`);
  await browser.close(); srv.close();
  process.exit(ok ? 0 : 1);
})();
