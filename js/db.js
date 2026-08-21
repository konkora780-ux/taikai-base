const DB = {
  online(){ return !!sb; },

  async listTournaments(){
    if(!sb) return local.read().t.slice().sort((a,b)=> (b.created_at||"").localeCompare(a.created_at||""));
    const { data, error } = await sb.from("gn_tournaments").select("*").order("created_at",{ascending:false}).limit(200);
    if(error) throw error;
    return data || [];
  },

  async loadTournament(id){
    if(!sb){
      const d = local.read();
      return {
        t: d.t.find(x=>x.id===id) || null,
        teams: d.teams.filter(x=>x.tournament_id===id),
        matches: d.matches.filter(x=>x.tournament_id===id),
      };
    }
    const rt = await sb.from("gn_tournaments").select("*").eq("id",id).maybeSingle();
    if(rt.error) throw rt.error;
    const t = rt.data;
    // 自分の団体の大会を運営者として見ているときだけ生のgn_matches（公式記録の中身も含む）を読む。
    // それ以外（ゲスト・他団体の大会を見ている運営者）は、非公開の公式記録を除いた公開用の窓口(gn_matches_public)を読む。
    const isOwner = !!(state.user && t && t.org_id === state.user.id);
    const [rteams, rmatches] = await Promise.all([
      sb.from("gn_teams").select("*").eq("tournament_id",id),
      sb.from(isOwner ? "gn_matches" : "gn_matches_public").select("*").eq("tournament_id",id),
    ]);
    if(rteams.error) throw rteams.error;
    if(rmatches.error) throw rmatches.error;
    return { t, teams:rteams.data||[], matches:rmatches.data||[] };
  },

  /* 公式記録の公開リンク：試合idだけで匿名に読む（大会・チームは所属大会を丸ごと読んで補う＝トーナメント枠の勝者参照も解決できるように）
     このリンクは常にゲスト向けの機能なので、公開用の窓口(gn_matches_public)だけを読む＝非公開の公式記録は最初から届かない */
  async loadMatchTarget(matchId){
    if(!sb){
      const d = local.read();
      const m = d.matches.find(x=>x.id===matchId) || null;
      if(!m) return { m:null, t:null, teams:[], matches:[] };
      const { t, teams, matches } = await this.loadTournament(m.tournament_id);
      return { m, t, teams, matches };
    }
    const rm = await sb.from("gn_matches_public").select("*").eq("id",matchId).maybeSingle();
    if(rm.error) throw rm.error;
    const m = rm.data;
    if(!m) return { m:null, t:null, teams:[], matches:[] };
    const { t, teams, matches } = await this.loadTournament(m.tournament_id);
    return { m, t, teams, matches };
  },

  /* --- 台帳（チーム・選手・団体設定）を丸ごと読む --- */
  async loadRoster(orgId){
    if(!sb){
      const d = local.read();
      return { org: d.orgs.find(o=>o.id===orgId) || null,
               clubs: d.clubs.filter(c=>c.org_id===orgId),
               members: d.members.filter(m=>m.org_id===orgId) };
    }
    const [ro, rc, rm] = await Promise.all([
      sb.from("gn_orgs").select("*").eq("id",orgId).maybeSingle(),
      sb.from("gn_clubs").select("*").eq("org_id",orgId),
      sb.from("gn_members").select("*").eq("org_id",orgId),
    ]);
    if(rc.error) throw rc.error;
    if(rm.error) throw rm.error;
    return { org: ro.error ? null : ro.data, clubs: rc.data||[], members: rm.data||[] };
  },

  /* --- 全データのバックアップ（この団体の全部をまとめて書き出す） --- */
  async exportBackup(orgId){
    if(!sb){
      const d = local.read();
      return { exported_at:new Date().toISOString(), org:d.orgs.find(o=>o.id===orgId)||null,
        tournaments:d.t.filter(x=>x.org_id===orgId), teams:d.teams.filter(x=>x.org_id===orgId),
        matches:d.matches.filter(x=>x.org_id===orgId), clubs:d.clubs.filter(x=>x.org_id===orgId),
        members:d.members.filter(x=>x.org_id===orgId), entry:d.entry.filter(x=>x.org_id===orgId),
        club_entry:d.clubEntry.filter(x=>x.org_id===orgId) };
    }
    const [ro, rt, rc, rm, re, rce] = await Promise.all([
      sb.from("gn_orgs").select("*").eq("id",orgId).maybeSingle(),
      sb.from("gn_tournaments").select("*").eq("org_id",orgId),
      sb.from("gn_clubs").select("*").eq("org_id",orgId),
      sb.from("gn_members").select("*").eq("org_id",orgId),
      sb.from("gn_entry").select("*").eq("org_id",orgId),
      sb.from("gn_club_entry").select("*").eq("org_id",orgId),
    ]);
    if(rt.error) throw rt.error;
    if(rc.error) throw rc.error;
    if(rm.error) throw rm.error;
    if(re.error) throw re.error;
    if(rce.error) throw rce.error;
    const tournaments = rt.data||[];
    const ids = tournaments.map(t=>t.id);
    const [rteams, rmatches] = await Promise.all([
      ids.length ? sb.from("gn_teams").select("*").in("tournament_id",ids) : Promise.resolve({data:[]}),
      ids.length ? sb.from("gn_matches").select("*").in("tournament_id",ids) : Promise.resolve({data:[]}),
    ]);
    if(rteams.error) throw rteams.error;
    if(rmatches.error) throw rmatches.error;
    return { exported_at:new Date().toISOString(), org: ro.error?null:ro.data,
      tournaments, teams:rteams.data||[], matches:rmatches.data||[],
      clubs:rc.data||[], members:rm.data||[], entry:re.data||[], club_entry:rce.data||[] };
  },

  /* --- バックアップからの復元（exportBackupで書き出したJSONを読み込む） ---
     安全のため、ファイルの中身に関わらずorg_idは必ず「今ログインしている団体」に付け替える
     （他団体のバックアップを間違って読み込んでも、自分の団体のデータとして復元される＝混ざらない）。
     idが一致する行は上書き、無ければ新規作成（upsert）。テーブルの参照関係の順に実行する。 */
  async importBackup(data, orgId){
    if(!data || typeof data!=="object") throw new Error("ファイルの形式が正しくありません");
    const fix = rows => (Array.isArray(rows)?rows:[]).map(r=>({ ...r, org_id:orgId }));
    const clubs=fix(data.clubs), members=fix(data.members), tournaments=fix(data.tournaments),
          teams=fix(data.teams), matches=fix(data.matches), entry=fix(data.entry), clubEntryRows=fix(data.club_entry);
    const counts = { tournaments:tournaments.length, teams:teams.length, matches:matches.length,
      clubs:clubs.length, members:members.length, entry:entry.length, club_entry:clubEntryRows.length };
    if(!sb){
      const d = local.read();
      const put = (key, rows) => rows.forEach(r=>{
        const i = d[key].findIndex(x=>x.id===r.id);
        if(i>=0) d[key][i] = {...d[key][i], ...r}; else d[key].push(r);
      });
      put("clubs",clubs); put("members",members); put("t",tournaments); put("teams",teams);
      put("matches",matches); put("entry",entry); put("clubEntry",clubEntryRows);
      local.write(d);
      return counts;
    }
    // 参照される側（台帳→大会→エントリー→試合→記入コード）の順に upsert する
    for(const [table, rows] of [
      ["gn_clubs",clubs], ["gn_members",members], ["gn_tournaments",tournaments],
      ["gn_teams",teams], ["gn_matches",matches], ["gn_entry",entry], ["gn_club_entry",clubEntryRows],
    ]){
      if(!rows.length) continue;
      const { error } = await sb.from(table).upsert(rows);
      if(error) throw new Error(`${table}: ${error.message}`);
    }
    return counts;
  },

  async upsert(table, rows){
    const arr = Array.isArray(rows) ? rows : [rows];
    if(!arr.length) return;
    if(!sb){
      const key = TBL_KEY[table];
      const d = local.read();
      arr.forEach(r=>{
        const i = d[key].findIndex(x=>x.id===r.id);
        if(i>=0) d[key][i] = {...d[key][i], ...r}; else d[key].push(r);
      });
      local.write(d);
      return;
    }
    const { error } = await sb.from(table).upsert(arr);
    if(error) throw error;
  },

  async remove(table, ids){
    const arr = Array.isArray(ids) ? ids : [ids];
    if(!arr.length) return;
    if(!sb){
      const key = TBL_KEY[table];
      const d = local.read();
      d[key] = d[key].filter(x=>!arr.includes(x.id));
      if(table==="gn_tournaments"){
        d.teams = d.teams.filter(x=>!arr.includes(x.tournament_id));
        d.matches = d.matches.filter(x=>!arr.includes(x.tournament_id));
      }
      if(table==="gn_clubs"){
        d.members = d.members.filter(x=>!arr.includes(x.club_id));
      }
      local.write(d);
      return;
    }
    const { error } = await sb.from(table).delete().in("id", arr);
    if(error) throw error;
  },

  /* --- 記入リンク（要望J）--- */
  // 本部：この大会の記入コード一覧 {team_id:{code,submitted_at}}
  async loadEntries(tournamentId){
    if(!sb){
      const d = local.read();
      const map = {};
      d.entry.filter(e=>e.tournament_id===tournamentId).forEach(e=>map[e.team_id]={code:e.code,submitted_at:e.submitted_at,expires_at:e.expires_at||null});
      return map;
    }
    const { data, error } = await sb.from("gn_entry").select("team_id,code,submitted_at,expires_at").eq("tournament_id",tournamentId);
    if(error) throw error;
    const map = {}; (data||[]).forEach(e=>map[e.team_id]={code:e.code,submitted_at:e.submitted_at,expires_at:e.expires_at||null});
    return map;
  },
  // 本部：この大会の記入コードすべてに提出期限を一括設定（nullで解除）
  async setEntriesExpiry(tournamentId, isoOrNull){
    if(!sb){
      const d = local.read();
      d.entry.filter(e=>e.tournament_id===tournamentId).forEach(e=> e.expires_at=isoOrNull);
      local.write(d); return;
    }
    const { error } = await sb.from("gn_entry").update({ expires_at:isoOrNull }).eq("tournament_id",tournamentId);
    if(error) throw error;
  },
  // 本部：コードが無いチームに発行して保存
  async ensureEntries(teams, tournamentId, orgId){
    const map = await this.loadEntries(tournamentId);
    const add = teams.filter(t=>!map[t.id]).map(t=>({
      team_id:t.id, tournament_id:tournamentId, org_id:orgId, code:entryCode(), submitted_at:null }));
    if(add.length){
      if(!sb){ const d=local.read(); d.entry.push(...add); local.write(d); }
      else { const { error } = await sb.from("gn_entry").insert(add); if(error) throw error; }
      add.forEach(e=>map[e.team_id]={code:e.code,submitted_at:null});
    }
    return map;
  },
  // チーム側：記入リンクの対象（チーム＋大会）を匿名で読む
  async loadEntryTarget(teamId){
    if(!sb){
      const d = local.read();
      const team = d.teams.find(x=>x.id===teamId) || null;
      const t = team ? (d.t.find(x=>x.id===team.tournament_id)||null) : null;
      return { team, t };
    }
    const rteam = await sb.from("gn_teams").select("id,tournament_id,name,grp,players,club_id").eq("id",teamId).maybeSingle();
    if(rteam.error) throw rteam.error;
    const team = rteam.data;
    let t = null;
    if(team){
      const rt = await sb.from("gn_tournaments").select("*").eq("id",team.tournament_id).maybeSingle();
      if(rt.error) throw rt.error; t = rt.data;
    }
    return { team, t };
  },
  // チーム側：コードを添えて自分の名簿を提出（サーバー側で照合）
  async submitRoster(teamId, code, players){
    if(!sb){
      const d = local.read();
      const e = d.entry.find(x=>x.team_id===teamId && x.code===code);
      if(!e) return false;
      const tm = d.teams.find(x=>x.id===teamId); if(tm){ tm.players = players; }
      e.submitted_at = new Date().toISOString(); local.write(d); return true;
    }
    const { data, error } = await sb.rpc("submit_team_roster", { p_team:teamId, p_code:code, p_players:players });
    if(error) throw error;
    return data === true;
  },

  /* --- 台帳の記入リンク（年度初めの登録） --- */
  // 本部：この団体の台帳記入コード一覧 {club_id:{code,submitted_at}}
  async loadClubEntries(orgId){
    if(!sb){
      const d = local.read(); const map = {};
      d.clubEntry.filter(e=>e.org_id===orgId).forEach(e=>map[e.club_id]={code:e.code,submitted_at:e.submitted_at,expires_at:e.expires_at||null});
      return map;
    }
    const { data, error } = await sb.from("gn_club_entry").select("club_id,code,submitted_at,expires_at").eq("org_id",orgId);
    if(error) throw error;
    const map = {}; (data||[]).forEach(e=>map[e.club_id]={code:e.code,submitted_at:e.submitted_at,expires_at:e.expires_at||null});
    return map;
  },
  // 本部：台帳の記入コードすべてに提出期限を一括設定（nullで解除）
  async setClubEntriesExpiry(orgId, isoOrNull){
    if(!sb){
      const d = local.read();
      d.clubEntry.filter(e=>e.org_id===orgId).forEach(e=> e.expires_at=isoOrNull);
      local.write(d); return;
    }
    const { error } = await sb.from("gn_club_entry").update({ expires_at:isoOrNull }).eq("org_id",orgId);
    if(error) throw error;
  },
  // 本部：コードが無いチームに発行して保存
  async ensureClubEntries(clubs, orgId){
    const map = await this.loadClubEntries(orgId);
    const add = clubs.filter(c=>!map[c.id]).map(c=>({ club_id:c.id, org_id:orgId, code:entryCode(), submitted_at:null }));
    if(add.length){
      if(!sb){ const d=local.read(); d.clubEntry.push(...add); local.write(d); }
      else { const { error } = await sb.from("gn_club_entry").insert(add); if(error) throw error; }
      add.forEach(e=>map[e.club_id]={code:e.code,submitted_at:null});
    }
    return map;
  },
  // チーム側：コードを添えてチーム名＋選手を提出（サーバー側で照合）
  async submitClubRoster(clubId, code, o){
    if(!sb){
      const d = local.read();
      const e = d.clubEntry.find(x=>x.club_id===clubId && x.code===code);
      if(!e) return false;
      const c = d.clubs.find(x=>x.id===clubId);
      if(c){ if(o.name) c.name=o.name; if(o.category) c.category=o.category; if(o.crest!==undefined) c.crest=o.crest; }
      d.members = d.members.filter(m=>!(m.club_id===clubId && m.status==="active"));
      (o.players||[]).forEach((p,i)=> d.members.push({ id:p.id||uid(), org_id:e.org_id, club_id:clubId,
        name:p.name, kana:null, no:p.no??null, pos:p.pos||null, grade:p.grade??null,
        prev_team:p.prev_team||null, status:"active", sort_order:i, note:null }));
      e.submitted_at = new Date().toISOString(); local.write(d); return true;
    }
    const { data, error } = await sb.rpc("submit_club_roster",
      { p_club:clubId, p_code:code, p_name:o.name||null, p_category:o.category||null, p_crest:o.crest??null, p_players:o.players||[] });
    if(error) throw error;
    return data === true;
  },
  // チーム側：コードを添えて「現在の名簿」を読む（新年度の更新用）
  async loadClubRosterByCode(clubId, code){
    if(!sb){
      const d = local.read();
      const e = d.clubEntry.find(x=>x.club_id===clubId && x.code===code);
      if(!e) return null;
      const c = d.clubs.find(x=>x.id===clubId); if(!c) return null;
      const players = d.members.filter(m=>m.club_id===clubId && m.status==="active")
        .sort((a,b)=>(a.no??999)-(b.no??999)||(a.sort_order||0)-(b.sort_order||0))
        .map(m=>({ id:m.id, no:m.no, name:m.name, pos:m.pos, grade:m.grade, prev_team:m.prev_team }));
      return { name:c.name, category:c.category, crest:c.crest||null, players };
    }
    const { data, error } = await sb.rpc("get_club_roster", { p_club:clubId, p_code:code });
    if(error) throw error;
    return data || null;
  },
  // 大会の記入リンク：そのチームの記入コードで、紐づく台帳（クラブ）の在籍選手を読む（150人などから選ぶための下ごしらえ）
  async loadTeamClubRoster(teamId, code){
    if(!sb){
      const d = local.read();
      const e = d.entry.find(x=>x.team_id===teamId && x.code===code);
      if(!e) return null;
      const team = d.teams.find(x=>x.id===teamId);
      if(!team || !team.club_id) return null;
      const c = d.clubs.find(x=>x.id===team.club_id);
      const players = d.members.filter(m=>m.club_id===team.club_id && m.status==="active")
        .sort((a,b)=>(a.no??999)-(b.no??999)||(a.sort_order||0)-(b.sort_order||0))
        .map(m=>({ id:m.id, no:m.no, name:m.name, pos:m.pos, grade:m.grade, prev_team:m.prev_team }));
      return { club_name:c?.name||"", crest:c?.crest||null, players };
    }
    const { data, error } = await sb.rpc("get_team_club_roster", { p_team:teamId, p_code:code });
    if(error) throw error;
    return data || null;
  },
};

/* 記入コード（紛らわしい文字を避けた6桁） */
/* 記入コード（6桁）の生成。児童生徒の名簿を取得・提出できる認証コードのため、
   Math.random()ではなくcrypto.getRandomValues()を使う。
   剰余だけで文字を選ぶと分布に偏りが出る（256を文字数29で割り切れないため）ので、
   余りが出る範囲の乱数は捨てて取り直す（rejection sampling）。
   暗号学的乱数が使えない環境では、弱い乱数へ黙って後退せずエラーにする
   （呼び出し元のensureEntries/ensureClubEntriesは既にtry/catchでtoast表示する設計）。 */
