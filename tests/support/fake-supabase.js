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
        return (db().gn_teams || []).map(t=>({ id:t.id, tournament_id:t.tournament_id, crest_hash: t.crest ? fakeHash(t.crest) : "d41d8cd98f00b204e9800998ecf8427e" }));
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
    rpc(name){
      if(name === "gn_matches_public") return new Q("gn_matches_public");
      if(name === "gn_matches_open"){
        if(window.__fakeNoOpen){ const q = new Q("__missing"); q.run = ()=>({ data:null, error:{ code:"PGRST202", message:"Could not find the function" } }); return q; }
        return new Q("gn_matches_open");
      } const q = new Q("__rpc"); q.run = ()=>({ data:null, error:null }); return q; },
    auth,
  }; } };
})();
