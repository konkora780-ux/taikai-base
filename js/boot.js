/* --- 起動 --- */
(async function boot(){
  state.loading = true; render();
  if(sb){
    const { data } = await sb.auth.getSession();
    if(data?.session?.user){
      const u = data.session.user;
      const email = u.email || "";
      if(email.endsWith("@"+LOGIN_DOMAIN)){
        state.user = { id:u.id, code:email.split("@")[0], role:"owner" };
      }else{
        await resolveStaffSession(u);   // 招待されたスタッフ（マジックリンク）のログイン
        if(!state.user && (state.staffLoginError || state.staffOrgChoices)){
          state.loginMode = "staff"; state.view = "login";
        }
      }
    }
  }else{
    const code = localStorage.getItem("taikai_local_user");
    if(code) state.user = { id:"local", code, role:"owner" };
  }
  const cm0 = location.hash.match(/croster=([0-9a-f-]{36})/i);
  if(cm0){ state.loading=false; await openClubEntry(cm0[1]); return; }   // 台帳の記入リンク（ログイン不要）
  const em = location.hash.match(/entry=([0-9a-f-]{36})/i);
  if(em){ state.loading=false; await openEntry(em[1]); return; }   // 記入リンク（ログイン不要）
  const om0 = location.hash.match(/om=([0-9a-f-]{36})/i);
  if(om0){ state.loading=false; await openOfficialPublic(om0[1]); return; }   // 公式記録の公開リンク（ログイン不要）

  await Promise.all([reloadList(), reloadRoster()]);
  state.loading = false;

  const m = location.hash.match(/t=([0-9a-f-]{36})/i);
  if(m) await openTournament(m[1]);
  else { render(); loadHomeStats(); }
})();

window.addEventListener("hashchange", ()=>{
  const cm = location.hash.match(/croster=([0-9a-f-]{36})/i);
  if(cm){ if(!state.clubEntry || state.clubEntry.clubId!==cm[1]) openClubEntry(cm[1]); return; }
  const em = location.hash.match(/entry=([0-9a-f-]{36})/i);
  if(em){ if(!state.entry || state.entry.team?.id!==em[1]) openEntry(em[1]); return; }
  const om = location.hash.match(/om=([0-9a-f-]{36})/i);
  if(om){ if(state.matchId!==om[1] || state.view!=="officialPublic") openOfficialPublic(om[1]); return; }
  const m = location.hash.match(/t=([0-9a-f-]{36})/i);
  if(m && (!state.t || state.t.id!==m[1])) openTournament(m[1]);
  else if(!m && state.view==="t") go("home");
});

/* 日付・時刻の入力欄は、枠のどこを押してもカレンダー/時計が開くようにする */
document.addEventListener("click", (e)=>{
  const el = e.target;
  if(el && el.tagName==="INPUT" && ["date","datetime-local","time","month","week"].includes(el.type)
     && typeof el.showPicker==="function"){
    try{ el.showPicker(); }catch(_){}
  }
});
