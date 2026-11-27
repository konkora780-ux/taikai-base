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
      return db()[this.table] || (db()[this.table] = []);
    }
    run(){
      const all = this.rowsOf();
      if(this.op === "upsert" || this.op === "insert"){
        this.rows.forEach(r=>{ const i = all.findIndex(x=>x.id===r.id); if(i>=0) all[i] = {...all[i], ...r}; else all.push(JSON.parse(JSON.stringify(r))); });
        return { data:null, error:null };
      }
      const hit = all.filter(r=> this.filters.every(f=>f(r)));
      if(this.op === "update"){ hit.forEach(r=> Object.assign(r, this.val)); return { data:null, error:null }; }
      if(this.op === "delete"){ db()[this.table] = all.filter(r=> !hit.includes(r)); return { data:null, error:null }; }
      let data = hit.map(r=> pick(r, this.cols));
      if(this.single) data = data[0] || null;
      const size = JSON.stringify(data).length;
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
    rpc(name){ if(name === "gn_matches_public") return new Q("gn_matches_public"); const q = new Q("__rpc"); q.run = ()=>({ data:null, error:null }); return q; },
    auth,
  }; } };
})();
