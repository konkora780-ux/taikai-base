// テスト用の「にせSupabase」。本物と同じ書き方（from().select().eq()… / rpc()）で、
// ページ内のデータ（window.__fakeDb）を読み書きする。返したデータの大きさ（文字数）を window.__bytes に足していくので、
// 自動更新でどれだけ通信するかを実測できる。ネットワークには一切つながない。
(function(){
  window.__bytes = 0;
  window.__requests = [];
  const db = () => window.__fakeDb;
  function pick(row, cols){
    if(!cols || cols === "*") return JSON.parse(JSON.stringify(row));
    const o = {}; cols.split(",").forEach(k=>{ k=k.trim(); o[k] = row[k] === undefined ? null : JSON.parse(JSON.stringify(row[k])); });
    return o;
  }
  function publicMatch(m){
    const c = JSON.parse(JSON.stringify(m));
    delete c.entry_lineups;
    if(!(c.official && c.official.public === true)) c.official = null;
    return c;
  }
  // setup-30 の gn_matches_open と同じ：サイン画像は「署名済み」の印(true)だけにする
  function openMatch(m){
    const c = publicMatch(m);
    c.official_public = !!(m.official && m.official.public === true);
    if(c.official && c.official.signs && typeof c.official.signs === "object"){
      const o = {}; Object.keys(c.official.signs).forEach(k=> o[k] = true); c.official.signs = o;
    }
    return c;
  }
  function fakeHash(str){ let h = 0; for(let i=0;i<str.length;i++){ h = (h*31 + str.charCodeAt(i)) | 0; } return "h" + h + "_" + str.length; }
  /* setup-32 の会場担当の関数と同じ判定（会場名・日本時間の日付・コード・期限・書き換える欄） */
  const OF_KEYS = ["format","referee","fourth","ar1","ar2","recorder","org","weather","wind","pitch","pitchCond","temp","crowd"];
  const jst = iso => new Date(new Date(iso).getTime() + 9*3600*1000).toISOString().slice(0,10);
  function fakeVenueRpc(name, a){
    const out = data => { const json = JSON.stringify(data), size = json.length; if(json.includes("SIGNIMAGE")) window.__signBytes = (window.__signBytes||0) + size; window.__bytes += size; window.__requests.push({ table:name, cols:"", size }); return { data, error:null }; };
    const v = (db().gn_venue_entry || []).find(x=>x.id===a.p_id);
    const closed = !v || !v.active || (v.expires_at && new Date(v.expires_at).getTime() < Date.now());
    const codeOk = !closed && v.code === String(a.p_code||"").toUpperCase();
    if(v && !closed && !codeOk) v.fail_count = (v.fail_count||0) + 1;
    const mine = m => m.tournament_id===v.tournament_id && String(m.venue||"").trim()===String(v.venue).trim() && m.kickoff && jst(m.kickoff)===v.day;
    if(name === "venue_entry_open"){
      if(closed) return out({ ok:false, reason:"closed" });
      if(!codeOk) return out({ ok:false, reason:"code" });
      const ms = db().gn_matches.filter(mine).map(m=>{ let of = null;
        if(m.official){ of = {}; OF_KEYS.concat(["kickoffTeam"]).forEach(k=>{ if(k in m.official) of[k] = m.official[k]; }); }
        return { id:m.id, lineups:m.lineups, official:of }; });
      return out({ ok:true, tournament_id:v.tournament_id, venue:v.venue, day:v.day, matches:ms });
    }
    if(name === "venue_get_official"){
      if(!codeOk) return out({ ok:false, reason:"code" });
      const mm = db().gn_matches.find(x=>x.id===a.p_match);
      if(!mm || !mine(mm)) return out({ ok:false, reason:"notyours" });
      return out({ ok:true, official:mm.official || null });
    }
    if(name === "venue_save_official"){
      if(!codeOk) return out("code");
      const mm = db().gn_matches.find(x=>x.id===a.p_match);
      if(!mm || !mine(mm)) return out("notyours");
      mm.official = Object.assign(JSON.parse(JSON.stringify(a.p_official)), { public: !!(mm.official && mm.official.public === true) });
      mm.updated_at = new Date().toISOString();
      return out("ok");
    }
    if(!codeOk) return out("code");
    const m = db().gn_matches.find(x=>x.id===a.p_match);
    if(!m || !mine(m)) return out("notyours");
    const d = a.p_data;
    ["home_score","away_score","home_pk","away_pk","status","result_type","result_note","events","note"].forEach(k=> m[k] = d[k] ?? null);
    if(d.meta){ m.lineups = Object.assign({}, m.lineups||{}); m.lineups._meta = Object.assign({}, m.lineups._meta||{},
      { useET:d.meta.useET, usePK:d.meta.usePK, pk:d.meta.pk, halfMin:d.meta.halfMin??null, etHalfMin:d.meta.etHalfMin??null }); }
    if(d.official){ const add = {}; OF_KEYS.forEach(k=>{ if(k in d.official) add[k] = String(d.official[k]).slice(0,100); });
      m.official = Object.assign({}, m.official||{}, add, { kickoffTeam:d.kickoffTeam||null }); }
    m.updated_at = new Date().toISOString();
    return out("ok");
  }
  class Q {
    constructor(table){ this.table = table; this.filters = []; this.cols = "*"; this.single = false; this.op = "select"; }
    select(cols){ if(this.op === "select") this.cols = cols || "*"; return this; }
    eq(k,v){ this.filters.push(r=> r[k] === v); return this; }
    in(k,arr){ this.filters.push(r=> arr.includes(r[k])); return this; }
    order(){ return this; }
    limit(){ return this; }
    maybeSingle(){ this.single = true; return this; }
    upsert(rows){ this.op = "upsert"; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
    update(v){ this.op = "update"; this.val = v; return this; }
    insert(rows){ this.op = "insert"; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
    delete(){ this.op = "delete"; return this; }
    rowsOf(){
      if(this.table === "gn_matches_public") return (db().gn_matches || []).map(publicMatch);
      if(this.table === "gn_matches_open") return (db().gn_matches || []).map(openMatch);
      if(this.table === "gn_teams_crest"){
        if(window.__fakeNoOpen) throw { message:"relation does not exist" };
        if(window.__fakeNoPlayersHash && /players_hash/.test(this.cols)) throw { message:"column gn_teams_crest.players_hash does not exist" };
        return (db().gn_teams || []).map(t=>({ id:t.id, tournament_id:t.tournament_id, crest_hash: t.crest ? fakeHash(t.crest) : "d41d8cd98f00b204e9800998ecf8427e",
          players_hash: fakeHash(JSON.stringify(t.players || null)) }));
      }
      return db()[this.table] || (db()[this.table] = []);
    }
    run(){
      let all;
      try{ all = this.rowsOf(); }catch(e){ return { data:null, error:e }; }
      if(this.op === "upsert" || this.op === "insert"){
        this.rows.forEach(r=>{ const i = all.findIndex(x=>x.id===r.id); if(i>=0) all[i] = {...all[i], ...r}; else all.push(JSON.parse(JSON.stringify(r))); });
        return { data:null, error:null };
      }
      const hit = all.filter(r=> this.filters.every(f=>f(r)));
      if(this.op === "update"){ hit.forEach(r=> Object.assign(r, this.val)); return { data:null, error:null }; }
      if(this.op === "delete"){ db()[this.table] = all.filter(r=> !hit.includes(r)); return { data:null, error:null }; }
      let data = hit.map(r=> pick(r, this.cols));
      if(this.single) data = data[0] || null;
      const json = JSON.stringify(data);
      const size = json.length;
      if(json.includes("SIGNIMAGE")) window.__signBytes = (window.__signBytes||0) + size;   // サイン画像が届いたか
      window.__bytes += size;
      window.__requests.push({ table:this.table, cols:this.cols, size });
      return { data, error:null };
    }
    then(res, rej){ return Promise.resolve().then(()=> this.run()).then(res, rej); }
  }
  const auth = {
    async getSession(){ const u = window.__fakeUser; return { data:{ session: u ? { user:u } : null } }; },
    async getUser(){ return { data:{ user: window.__fakeUser || null } }; },
    async signOut(){ window.__fakeUser = null; return { error:null }; },
    async signInWithPassword(){ return { data:null, error:{ message:"test" } }; },
    onAuthStateChange(){ return { data:{ subscription:{ unsubscribe(){} } } }; },
  };
  window.supabase = { createClient(){ return {
    from(t){ return new Q(t); },
    rpc(name, args){
      if(/^venue_(entry_open|save_match|get_official|save_official)$/.test(name)){ const q = new Q("__rpc"); q.run = ()=> fakeVenueRpc(name, args||{}); return q; }
      if(name === "gn_matches_public") return new Q("gn_matches_public");
      if(name === "gn_matches_open"){
        if(window.__fakeNoOpen){ const q = new Q("__missing"); q.run = ()=>({ data:null, error:{ code:"PGRST202", message:"Could not find the function" } }); return q; }
        return new Q("gn_matches_open");
      } const q = new Q("__rpc"); q.run = ()=>({ data:null, error:null }); return q; },
    auth,
  }; } };
})();
