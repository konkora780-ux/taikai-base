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
        matches: mergeEntryLineups(d.matches.filter(x=>x.tournament_id===id).map(x=>JSON.parse(JSON.stringify(x)))),
      };
    }
    const rt = await sb.from("gn_tournaments").select("*").eq("id",id).maybeSingle();
    if(rt.error) throw rt.error;
    const t = rt.data;
    // 自分の団体の大会を運営者として見ているときだけ生のgn_matches（公式記録の中身も含む）を読む。
    // それ以外（ゲスト・他団体の大会を見ている運営者）は、非公開の公式記録を除いた公開用の窓口(gn_matches_public)を読む。
    const isOwner = !!(state.user && t && t.org_id === state.user.id);
    state.heavyFailed = false;
    if(!isOwner && t){
      // 一般の閲覧：まず軽い列だけ読む（名簿・試合メンバー・公式記録は、その画面を開いたときに loadHeavy で読む）
      const lite = await this.loadGuestLite(t).catch(e=>{ console.warn("軽い読み込みに失敗。従来の読み込みに切り替えます", e); return null; });
      if(lite){ state.lazyGuest = true; state.heavyLoaded = false; return lite; }
    }
    state.lazyGuest = false; state.heavyLoaded = true;
    const matchesQuery = isOwner
      ? sb.from("gn_matches").select("*").eq("tournament_id",id)
      : sb.rpc("gn_matches_public").select("*").eq("tournament_id",id);
    const [rteams, rmatches] = await Promise.all([
      sb.from("gn_teams").select("*").eq("tournament_id",id),
      matchesQuery,
    ]);
    if(rteams.error) throw rteams.error;
    if(rmatches.error) throw rmatches.error;
    return { t, teams:rteams.data||[], matches:mergeEntryLineups(rmatches.data||[]) };
  },

  /* --- 一般の閲覧向けの軽い読み込み（setup-30 の gn_matches_open・gn_teams_crest を使う） ---
     ・試合は gn_matches_open（公式記録の指サインを含まない窓口）から、メンバー表・公式記録を除いた列だけ
     ・チームは名簿・校章を除いた列だけ。校章はスマホに覚えておき、変わったチームの分だけ読む
     setup-30 が未実行（窓口が無い）ときは null を返し、呼ぶ側は従来の読み込みに戻る */
  _openMissing: false,
  openMatches(cols){ return sb.rpc("gn_matches_open").select(cols); },
  async loadGuestLite(t){
    if(this._openMissing) return null;
    const [rm, rteams] = await Promise.all([
      this.openMatches(GUEST_MATCH_COLS).eq("tournament_id", t.id),
      sb.from("gn_teams").select(GUEST_TEAM_COLS).eq("tournament_id", t.id),
    ]);
    if(rm.error){ this._openMissing = true; return null; }
    if(rteams.error) throw rteams.error;
    const teams = rteams.data || [];
    await this.attachCached(t.id, teams);
    return { t, teams, matches:mergeEntryLineups(rm.data||[]), lazy:true };
  },
  /* 校章と選手名簿：チームごとの「中身の指紋」（md5・setup-30/31 の gn_teams_crest）だけ読み、
     スマホに覚えているものと同じなら読まない。指紋の窓口が無い（SQL未実行）ときは毎回読む */
  async attachCached(tournamentId, teams){
    if(!teams.length) return;
    let rh = await sb.from("gn_teams_crest").select("id,crest_hash,players_hash").eq("tournament_id", tournamentId);
    let hasPlayersHash = true;
    if(rh.error){ hasPlayersHash = false; rh = await sb.from("gn_teams_crest").select("id,crest_hash").eq("tournament_id", tournamentId); }
    const rows = rh.error ? [] : (rh.data || []);
    const kinds = [
      { col:"crest",   key:CREST_CACHE_KEY,   hashOf:new Map(rows.map(r=>[r.id, r.crest_hash])), ok:!rh.error },
      { col:"players", key:PLAYERS_CACHE_KEY, hashOf:new Map(rows.map(r=>[r.id, r.players_hash])), ok:!rh.error && hasPlayersHash },
    ];
    for(const k of kinds){
      const cache = teamCacheRead(k.key), need = [];
      teams.forEach(x=>{
        const h = k.ok ? k.hashOf.get(x.id) : null, c = cache[x.id];
        if(k.col === "crest" && h === EMPTY_MD5){ x.crest = null; }
        else if(h && c && c.h === h){ x[k.col] = c.c; c.at = Date.now(); }
        else need.push(x.id);
      });
      for(let i=0; i<need.length; i+=50){
        const { data, error } = await sb.from("gn_teams").select("id," + k.col).in("id", need.slice(i, i+50));
        if(error) throw error;
        (data||[]).forEach(r=>{
          const x = teams.find(y=>y.id===r.id); if(!x) return;
          x[k.col] = r[k.col] ?? null;
          const h = k.ok && k.hashOf.get(r.id);
          if(h && r[k.col] != null) cache[r.id] = { h, c:r[k.col], at:Date.now() };
        });
      }
      if(k.ok) teamCacheWrite(k.key, cache);
    }
  },
  /* 試合メンバー・公式記録（サインなし）を読んで、手元の大会データに足す */
  async loadHeavy(t, teams, matches){
    if(!sb) return;
    const rm = await this.openMatches("id,lineups,official").eq("tournament_id", t.id);
    if(rm.error) throw rm.error;
    const hv = new Map((rm.data||[]).map(r=>[r.id, r]));
    matches.forEach(m=>{ const r = hv.get(m.id); if(r){ m.lineups = r.lineups; m.official = r.official; } });
    mergeEntryLineups(matches);
  },

  /* 自動更新用の軽い読み込み：大会・試合の軽い列・チームの軽い列（運営は記入リンクの提出時刻も）だけ。
     端末内保存（お試し版）のときは通信が無いので null を返し、呼ぶ側は今まで通り丸ごと読む */
  async pollTournament(id){
    if(!sb) return null;
    const rt = await sb.from("gn_tournaments").select("*").eq("id",id).maybeSingle();
    if(rt.error) throw rt.error;
    const t = rt.data;
    if(!t) return { t:null };
    const isOwner = !!(state.user && t.org_id === state.user.id);
    const mq = isOwner
      ? sb.from("gn_matches").select(POLL_MATCH_COLS).eq("tournament_id",id)
      : (state.lazyGuest ? this.openMatches(POLL_MATCH_COLS) : sb.rpc("gn_matches_public").select(POLL_MATCH_COLS)).eq("tournament_id",id);
    const [rm, rteams, entries] = await Promise.all([
      mq,
      sb.from("gn_teams").select(POLL_TEAM_COLS).eq("tournament_id",id),
      isOwner ? this.loadEntries(id).catch(()=>null) : Promise.resolve(null),
    ]);
    if(rm.error) throw rm.error;
    if(rteams.error) throw rteams.error;
    return { t, isOwner, matches: rm.data||[], teams: rteams.data||[], entries };
  },
  /* 指定した試合だけ、全部の列を読む（自動更新で変わった試合だけ読み直す用） */
  async loadMatchesByIds(t, ids){
    if(!ids.length) return [];
    const isOwner = !!(state.user && t && t.org_id === state.user.id);
    const out = [];
    for(let i=0; i<ids.length; i+=100){   // URLが長くなりすぎないよう100件ずつ
      const part = ids.slice(i, i+100);
      const q = isOwner
        ? sb.from("gn_matches").select("*").in("id", part)
        : state.lazyGuest
          ? this.openMatches(state.heavyLoaded ? "*" : GUEST_MATCH_COLS).in("id", part)   // 重い列は、読み込み済みのときだけ
          : sb.rpc("gn_matches_public").select("*").in("id", part);
      const { data, error } = await q;
      if(error) throw error;
      out.push(...(data||[]));
    }
    return mergeEntryLineups(out);
  },
  /* メンバー表の列だけを読む（チームが記入リンクで出した試合メンバーは更新日時が変わらないので、ときどきこれで拾う） */
  async loadLineups(t){
    const isOwner = !!(state.user && t && t.org_id === state.user.id);
    if(!isOwner && state.lazyGuest && !state.heavyLoaded) return [];   // メンバー表をまだ読んでいない閲覧者は不要
    const q = isOwner
      ? sb.from("gn_matches").select("id,lineups,entry_lineups").eq("tournament_id", t.id)
      : (state.lazyGuest ? this.openMatches("id,lineups") : sb.rpc("gn_matches_public").select("id,lineups")).eq("tournament_id", t.id);
    const { data, error } = await q;
    if(error) throw error;
    return data || [];
  },
  async loadTeams(tournamentId){
    if(state.lazyGuest){
      const { data, error } = await sb.from("gn_teams").select(GUEST_TEAM_COLS).eq("tournament_id",tournamentId);
      if(error) throw error;
      const teams = data || [];
      await this.attachCached(tournamentId, teams);
      return teams;
    }
    const { data, error } = await sb.from("gn_teams").select("*").eq("tournament_id",tournamentId);
    if(error) throw error;
    return data || [];
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
    let rm = this._openMissing ? null : await this.openMatches("*").eq("id",matchId).maybeSingle();
    if(!rm || rm.error) rm = await sb.rpc("gn_matches_public").select("*").eq("id",matchId).maybeSingle();
    if(rm.error) throw rm.error;
    const m = rm.data;
    if(!m) return { m:null, t:null, teams:[], matches:[] };
    const d = await this.loadTournament(m.tournament_id);
    if(d.lazy){ await this.loadHeavy(d.t, d.teams, d.matches); state.heavyLoaded = true; }
    return { m, t:d.t, teams:d.teams, matches:d.matches };
  },

  /* --- 台帳（チーム・選手・団体設定）を丸ごと読む --- */
  async loadRoster(orgId){
    if(!sb){
      const d = local.read();
      return { org: d.orgs.find(o=>o.id===orgId) || null,
               clubs: d.clubs.filter(c=>c.org_id===orgId),
               members: d.members.filter(m=>m.org_id===orgId),
               venues: d.venues.filter(v=>v.org_id===orgId) };
    }
    const [ro, rc, rm, rv] = await Promise.all([
      sb.from("gn_orgs").select("*").eq("id",orgId).maybeSingle(),
      sb.from("gn_clubs").select("*").eq("org_id",orgId),
      sb.from("gn_members").select("*").eq("org_id",orgId),
      sb.from("gn_venues").select("*").eq("org_id",orgId).order("sort_order"),
    ]);
    if(rc.error) throw rc.error;
    if(rm.error) throw rm.error;
    // gn_venuesがまだ作られていない団体（setup-15未実行）でも台帳全体が読めなくなるのは避ける＝会場だけ空扱いにする
    const venues = rv.error ? [] : (rv.data||[]);
    return { org: ro.error ? null : ro.data, clubs: rc.data||[], members: rm.data||[], venues };
  },

  /* --- 試合(gn_matches)の変更履歴（setup-14のトリガーで自動記録されたもの） --- */
  async loadMatchHistory(matchId){
    if(!sb) return [];
    const { data, error } = await sb.from("gn_match_history").select("*")
      .eq("match_id", matchId).order("changed_at",{ascending:false}).limit(50);
    if(error) throw error;
    return data || [];
  },

  /* --- スタッフ（利用者ごとの権限管理・setup-16） --- */
  async loadOrgMembers(orgId){
    if(!sb) return [];
    const { data, error } = await sb.from("gn_org_members").select("*").eq("org_id", orgId).order("invited_at");
    if(error) throw error;
    return data || [];
  },

  /* --- 会場アクセス（公開用・setup-21）。org_idだけで読める＝ログイン不要 --- */
  async loadVenuesForOrg(orgId){
    if(!sb){
      const d = local.read();
      return d.venues.filter(v=>v.org_id===orgId).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
    }
    const { data, error } = await sb.from("gn_venues").select("*").eq("org_id", orgId).order("sort_order");
    if(error) return [];
    return data || [];
  },

  /* --- 大会のお知らせ（setup-18・テキストのみ） --- */
  async loadAnnouncements(tournamentId){
    if(!sb){
      const d = local.read();
      return d.announcements.filter(a=>a.tournament_id===tournamentId)
        .sort((a,b)=> (b.pinned?1:0)-(a.pinned?1:0) || (b.created_at||"").localeCompare(a.created_at||""));
    }
    const { data, error } = await sb.from("gn_announcements").select("*").eq("tournament_id", tournamentId)
      .order("pinned",{ascending:false}).order("created_at",{ascending:false});
    if(error) throw error;
    return data || [];
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

  // チーム側：コードを添えて、1試合の自チームのメンバー（スタメン・サブ）を提出（サーバー側で照合）
  // 返り値 "ok" / "code"(コード違い・期限切れ・ロック中) / "notyours"(このチームの試合でない・相手が未確定) /
  //        "started"(試合が始まった・終わった) / "roster"(大会登録にいない選手) / "count"(人数が設定と合わない)
  async submitMatchLineup(teamId, code, matchId, lineup){
    if(!sb){
      const d = local.read();
      const e = d.entry.find(x=>x.team_id===teamId);
      if(!e || e.code!==code) return "code";
      const m = d.matches.find(x=>x.id===matchId);
      const team = d.teams.find(x=>x.id===teamId);
      if(!m || !team) return "notyours";
      const side = lineupSideOf(m, teamId); if(!side) return "notyours";
      if(m.status && m.status!=="todo" && m.status!=="postponed") return "started";
      const rec = Object.assign({}, lineup, { by:"team", submitted_at:new Date().toISOString() });
      m.entry_lineups = Object.assign({}, m.entry_lineups||{}, { [side]:rec });
      m.lineups = Object.assign({}, m.lineups||{}, { [side]:JSON.parse(JSON.stringify(rec)) });
      local.write(d); return "ok";
    }
    const { data, error } = await sb.rpc("submit_match_lineup", { p_team:teamId, p_code:code, p_match:matchId, p_lineup:lineup });
    if(error) throw error;
    return data || "code";
  },

  /* --- 会場担当の入力リンク（setup-32） --- */
  // 会場担当：大会を軽く読む。試合は軽い列だけ、チームは名前など（校章なし）、選手名簿は「この会場の試合のチーム」だけ。
  // ログイン中の運営・お試し版は今までどおり丸ごと読む
  async loadVenueTournament(tid, venueMatchIds){
    const isOwnerish = !sb || !!state.user;
    if(isOwnerish) return this.loadTournament(tid);
    const rt = await sb.from("gn_tournaments").select("*").eq("id",tid).maybeSingle();
    if(rt.error) throw rt.error;
    const [rm, rteams] = await Promise.all([
      this.openMatches(GUEST_MATCH_COLS).eq("tournament_id", tid),
      sb.from("gn_teams").select(GUEST_TEAM_COLS).eq("tournament_id", tid),
    ]);
    if(rm.error) throw rm.error;
    if(rteams.error) throw rteams.error;
    const t = rt.data, teams = rteams.data || [], matches = rm.data || [];
    normalizeMatchRows(matches);
    // トーナメントの「勝者」枠も解決してから、要るチームの名簿だけ読む
    const prev = { t:state.t, teams:state.teams, matches:state.matches };
    state.t = t; state.teams = teams; state.matches = matches;
    const need = new Set();
    matches.filter(m=>venueMatchIds.includes(m.id)).forEach(m=>{ ["H","A"].forEach(sd=>{ const s = resolveSlot(m, sd); if(s && s.id) need.add(s.id); }); });
    Object.assign(state, prev);
    if(need.size){
      const rp = await sb.from("gn_teams").select("id,players").in("id", [...need]);
      if(rp.error) throw rp.error;
      const byId = new Map((rp.data||[]).map(r=>[r.id, r.players]));
      teams.forEach(x=>{ if(byId.has(x.id)) x.players = byId.get(x.id); });
    }
    teams.forEach(x=>{ if(!x.players) x.players = []; });
    return { t, teams, matches };
  },
  // 運営：この大会の会場担当リンクの一覧
  async loadVenueEntries(tournamentId){
    if(!sb) return local.read().venueEntry.filter(x=>x.tournament_id===tournamentId);
    const { data, error } = await sb.from("gn_venue_entry").select("*").eq("tournament_id", tournamentId).order("day").order("venue");
    if(error) throw error;
    return data || [];
  },
  async createVenueEntry(row){
    if(!sb){ const d = local.read(); d.venueEntry.push(Object.assign({ fail_count:0, locked_until:null, last_used_at:null, created_at:new Date().toISOString() }, row)); local.write(d); return; }
    const { error } = await sb.from("gn_venue_entry").insert(row);
    if(error) throw error;
  },
  async updateVenueEntry(id, patch){
    if(!sb){ const d = local.read(); const r = d.venueEntry.find(x=>x.id===id); if(r) Object.assign(r, patch); local.write(d); return; }
    const { error } = await sb.from("gn_venue_entry").update(patch).eq("id", id);
    if(error) throw error;
  },
  // 会場担当：コードを確かめて {ok, tournament_id, venue, day} を受け取る（サーバー側で照合）
  async venueEntryOpen(id, code){
    if(!sb){
      const r = local.read().venueEntry.find(x=>x.id===id);
      if(!r || !r.active || (r.expires_at && new Date(r.expires_at).getTime() < Date.now())) return { ok:false, reason:"closed" };
      if(r.code !== code) return { ok:false, reason:"code" };
      const ms = venueMatchesOf(local.read().matches.filter(x=>x.tournament_id===r.tournament_id), r.venue, r.day)
        .map(m=>({ id:m.id, lineups:m.lineups||null, official:m.official||null }));
      return { ok:true, tournament_id:r.tournament_id, venue:r.venue, day:r.day, matches:ms };
    }
    const { data, error } = await sb.rpc("venue_entry_open", { p_id:id, p_code:code });
    if(error) throw error;
    return data;
  },
  // 会場担当：1試合の結果を保存。書き換えられる欄だけを送り、サーバー側で会場・日付・中身を確かめる
  // 返り値 "ok" / "code" / "notyours" / "bad"
  async venueSaveMatch(id, code, m){
    const meta = (m.lineups && m.lineups._meta) || {};
    const payload = {
      home_score:m.home_score??null, away_score:m.away_score??null, home_pk:m.home_pk??null, away_pk:m.away_pk??null,
      status:m.status||"todo", result_type:m.result_type||null, result_note:m.result_note||null,
      events:m.events||[], note:m.note||"",
      meta:{ useET:!!meta.useET, usePK:!!meta.usePK, pk:meta.pk||{ H:[], A:[] },
             halfMin:meta.halfMin??null, etHalfMin:meta.etHalfMin??null },
      kickoffTeam:(m.official && m.official.kickoffTeam) || null,
    };
    // 公式記録は上部の決まった欄だけ（サインなどは送らない）
    if(m.official){
      payload.official = {};
      VENUE_OFFICIAL_KEYS.forEach(k=>{ if(m.official[k]!=null) payload.official[k] = String(m.official[k]); });
    }
    if(!sb){
      const d = local.read();
      const r = d.venueEntry.find(x=>x.id===id);
      if(!r || !r.active || r.code !== code || (r.expires_at && new Date(r.expires_at).getTime() < Date.now())) return "code";
      const row = d.matches.find(x=>x.id===m.id);
      if(!row || venueMatchesOf([row], r.venue, r.day).length===0) return "notyours";
      ["home_score","away_score","home_pk","away_pk","status","result_type","result_note","events","note"].forEach(k=> row[k] = payload[k]);
      row.lineups = Object.assign({}, row.lineups||{}); row.lineups._meta = Object.assign({}, row.lineups._meta||{}, payload.meta);
      row.official = Object.assign({}, row.official||{}, payload.official||{}, { kickoffTeam:payload.kickoffTeam });
      row.updated_at = new Date().toISOString();
      local.write(d); return "ok";
    }
    const { data, error } = await sb.rpc("venue_save_match", { p_id:id, p_code:code, p_match:m.id, p_data:payload });
    if(error) throw error;
    return data || "code";
  },

  // 会場担当：公式記録の画面を開くとき、その1試合の公式記録（サイン画像を含む）だけを読む
  async venueGetOfficial(id, code, matchId){
    if(!sb){
      const d = local.read(); const r = d.venueEntry.find(x=>x.id===id);
      if(!r || !r.active || r.code !== code) return { ok:false, reason:"code" };
      const m = d.matches.find(x=>x.id===matchId);
      if(!m || venueMatchesOf([m], r.venue, r.day).length===0) return { ok:false, reason:"notyours" };
      return { ok:true, official:m.official||null };
    }
    const { data, error } = await sb.rpc("venue_get_official", { p_id:id, p_code:code, p_match:matchId });
    if(error) throw error;
    return data || { ok:false, reason:"code" };
  },
  // 会場担当：公式記録（最終チェック・サイン）を保存。公開/非公開はサーバー側で元の値のまま
  async venueSaveOfficial(id, code, matchId, official){
    if(!sb){
      const d = local.read(); const r = d.venueEntry.find(x=>x.id===id);
      if(!r || !r.active || r.code !== code) return "code";
      const m = d.matches.find(x=>x.id===matchId);
      if(!m || venueMatchesOf([m], r.venue, r.day).length===0) return "notyours";
      m.official = Object.assign({}, official, { public: !!(m.official && m.official.public) });
      m.updated_at = new Date().toISOString(); local.write(d); return "ok";
    }
    const { data, error } = await sb.rpc("venue_save_official", { p_id:id, p_code:code, p_match:matchId, p_official:official });
    if(error) throw error;
    return data || "code";
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
