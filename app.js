/* ============================================================
   PB 고객관리시스템 — Supabase 연동 로직
   ============================================================ */
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const CATS = ["주식","채권","해외","ELS","랩","펀드","부동산"];
const CAT_STYLE = {"주식":["--tag-stock","--tag-stock-t"],"채권":["--tag-bond","--tag-bond-t"],"해외":["--tag-ovs","--tag-ovs-t"],"ELS":["--tag-els","--tag-els-t"],"랩":["--tag-wrap","--tag-wrap-t"],"펀드":["--tag-fund","--tag-fund-t"],"부동산":["--tag-re","--tag-re-t"]};

let me = null;                 // {id, name}
let managers = [];             // 가입한 팀원 이름 목록 (담당자 선택지)
let clients = [], returns = [], prospects = [], holdings = [];
let filters = {q:"", manager:"", type:"", cat:"", family:""};

/* ---------- 유틸 ---------- */
const $ = id => document.getElementById(id);
function esc(s){return (s??"").toString().replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function fmt(n){return n==null||n===""?"-":Number(n).toLocaleString("ko-KR")}
function today(){return new Date().toISOString().slice(0,10)}
function catTag(c){const s=CAT_STYLE[c]||["--tag-re","--tag-re-t"];return `<span class="tag" style="background:var(${s[0]});color:var(${s[1]})">${c}</span>`}
function rateHtml(r){if(r==null)return"-";const n=Number(r);return `<span class="${n>=0?"pos":"neg"}">${n>=0?"+":""}${n.toFixed(2)}%</span>`}
function clientReturns(cid){return returns.filter(r=>r.client_id===cid).sort((a,b)=>b.base_date.localeCompare(a.base_date))}
function lastReturn(cid){const rs=clientReturns(cid);return rs.length?rs[0]:null}
function nextContact(p){if(!p.last_contact)return null;const d=new Date(p.last_contact);d.setDate(d.getDate()+Number(p.cycle||30));return d.toISOString().slice(0,10)}
function showMsg(id,txt,ok){const el=$(id);el.textContent=txt;el.className="msg "+(ok?"ok":"err");if(ok)setTimeout(()=>el.className="msg",2500)}
function err(e){alert("오류: "+(e?.message||e))}

/* ---------- 인증 ---------- */
async function boot(){
  const {data:{session}} = await db.auth.getSession();
  $("loading").style.display="none";
  if(session){await enter(session.user)}
  else{$("authView").style.display=""}
}
function showAuth(which){
  $("loginPanel").style.display = which==="login"?"":"none";
  $("signupPanel").style.display = which==="signup"?"":"none";
}
async function signup(){
  const name=$("s_name").value.trim(), email=$("s_email").value.trim(), pw=$("s_pw").value;
  if(!name||!email||pw.length<6){showMsg("signupMsg","모든 항목을 입력하세요. (비밀번호 6자 이상)");return}
  const {data,error} = await db.auth.signUp({email,password:pw});
  if(error){showMsg("signupMsg",error.message.includes("already")?"이미 가입된 이메일입니다.":error.message);return}
  if(!data.session){
    // 이메일 확인이 켜져 있는 경우
    showMsg("signupMsg","확인 메일이 발송되었습니다. 메일의 링크를 누른 뒤 로그인하세요. (README의 이메일 확인 끄기 설정 참고)",true);
    return;
  }
  const {error:pErr} = await db.from("profiles").insert({id:data.user.id,name});
  if(pErr){
    showMsg("signupMsg", pErr.message.includes("정원")?"가입 정원(3명)이 모두 찼습니다.":pErr.message);
    await db.auth.signOut(); return;
  }
  await enter(data.user);
}
async function login(){
  const email=$("l_email").value.trim(), pw=$("l_pw").value;
  const {data,error} = await db.auth.signInWithPassword({email,password:pw});
  if(error){showMsg("loginMsg","이메일 또는 비밀번호가 올바르지 않습니다.");return}
  // 프로필이 없으면(가입 도중 중단된 경우) 생성 시도
  const {data:prof} = await db.from("profiles").select("id").eq("id",data.user.id).maybeSingle();
  if(!prof){
    const nm = prompt("표시할 이름을 입력하세요 (예: 서재영)") || data.user.email.split("@")[0];
    const {error:pErr} = await db.from("profiles").insert({id:data.user.id,name:nm});
    if(pErr){showMsg("loginMsg", pErr.message.includes("정원")?"가입 정원(3명)이 모두 찼습니다.":pErr.message);await db.auth.signOut();return}
  }
  await enter(data.user);
}
async function logout(){
  await db.auth.signOut();
  location.reload();
}
async function enter(user){
  const {data:prof} = await db.from("profiles").select("*").eq("id",user.id).maybeSingle();
  me = {id:user.id, name:prof?prof.name:user.email};
  $("authView").style.display="none";
  $("appView").style.display="";
  $("whoami").textContent = me.name+" 님";
  await loadAll();
}

/* ---------- 데이터 로드 ---------- */
async function loadAll(manual){
  const [p,c,r,s,h] = await Promise.all([
    db.from("profiles").select("name").order("created_at"),
    db.from("clients").select("*").order("created_at"),
    db.from("returns").select("*"),
    db.from("prospects").select("*").order("created_at"),
    db.from("holdings").select("*"),
  ]);
  if(p.error||c.error||r.error||s.error){err(p.error||c.error||r.error||s.error);return}
  managers = p.data.map(x=>x.name);
  clients = c.data; returns = r.data; prospects = s.data;
  holdings = h.error ? [] : h.data;   // holdings 테이블 미생성 시에도 앱은 동작
  $("teamSub").textContent = "팀원: "+(managers.join(" · ")||"-");
  renderAll();
  if(manual){const el=$("teamSub");el.style.color="#ffd166";setTimeout(()=>el.style.color="",700)}
}

/* ---------- 탭 ---------- */
function showTab(t){
  document.querySelectorAll("nav button").forEach(b=>b.classList.toggle("active",b.dataset.tab===t));
  ["dash","clients","returns","wrap","prospects"].forEach(x=>$("tab-"+x).style.display=x===t?"":"none");
}

/* ---------- 대시보드 ---------- */
function renderDash(){
  const totalAum = clients.reduce((s,c)=>s+Number(c.aum||0),0);
  const byMgr = managers.map(m=>({m,n:clients.filter(c=>c.manager===m).length,aum:clients.filter(c=>c.manager===m).reduce((s,c)=>s+Number(c.aum||0),0)}));
  const byCat = CATS.map(c=>({c,n:clients.filter(x=>(x.categories||[]).includes(c)).length})).filter(x=>x.n>0);
  const maxCat = Math.max(1,...byCat.map(x=>x.n));
  const fams = [...new Set(clients.map(c=>c.family).filter(Boolean))];
  const t = today();
  const dueP = prospects.filter(p=>{const n=nextContact(p);return !p.last_contact||(n&&n<=t)});
  const staleR = clients.filter(c=>{const r=lastReturn(c.id);if(!r)return true;return (new Date(t)-new Date(r.base_date))>1000*60*60*24*30});
  const wrapC = clients.filter(c=>(c.categories||[]).includes("랩"));
  const staleH = wrapC.filter(c=>{const d=clientHoldingDates(c.id)[0];if(!d)return true;return (new Date(t)-new Date(d))>1000*60*60*24*30});

  $("tab-dash").innerHTML = `
  <div class="cards">
    <div class="card"><div class="lbl">총 고객</div><div class="val">${clients.length}<small>명</small></div></div>
    <div class="card"><div class="lbl">총 자산</div><div class="val">${fmt(totalAum)}<small>억원</small></div></div>
    <div class="card"><div class="lbl">패밀리 그룹</div><div class="val">${fams.length}<small>개</small></div></div>
    <div class="card"><div class="lbl">랩 고객</div><div class="val">${clients.filter(c=>(c.categories||[]).includes("랩")).length}<small>명</small></div></div>
    <div class="card"><div class="lbl">잠재고객</div><div class="val">${prospects.length}<small>명</small></div></div>
  </div>
  <div class="panel"><h2>오늘 할 일</h2>
    ${dueP.length===0&&staleR.length===0&&staleH.length===0?'<div class="empty">모두 처리되었습니다 ✓</div>':`
    ${dueP.length?`<p style="margin-bottom:8px"><span class="due-badge">접촉 필요</span> <b>${dueP.length}명</b>의 잠재고객 — ${dueP.slice(0,5).map(p=>esc(p.name)).join(", ")}${dueP.length>5?" 외":""} <span class="clickable" onclick="showTab('prospects')">→ 이동</span></p>`:""}
    ${staleR.length?`<p style="margin-bottom:8px"><span class="due-badge">수익률 갱신</span> 30일 이상 미입력 <b>${staleR.length}명</b> — ${staleR.slice(0,5).map(c=>esc(c.name)).join(", ")}${staleR.length>5?" 외":""} <span class="clickable" onclick="showTab('returns')">→ 이동</span></p>`:""}
    ${staleH.length?`<p><span class="due-badge">편입종목 갱신</span> 랩고객 <b>${staleH.length}명</b> — ${staleH.slice(0,5).map(c=>esc(c.name)).join(", ")}${staleH.length>5?" 외":""} <span class="clickable" onclick="showTab('wrap')">→ 이동</span></p>`:""}`}
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px" class="dash-grid">
    <div class="panel"><h2>담당자별 현황</h2>
      <table><thead><tr><th>담당자</th><th>고객수</th><th>자산(억원)</th></tr></thead><tbody>
      ${byMgr.map(x=>`<tr><td>${esc(x.m)}</td><td>${x.n}</td><td>${fmt(x.aum)}</td></tr>`).join("")||'<tr><td colspan="3"><div class="empty">팀원이 가입하면 표시됩니다</div></td></tr>'}
      </tbody></table>
    </div>
    <div class="panel"><h2>유형별 분포</h2>
      ${byCat.length?byCat.map(x=>`<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px"><span style="width:52px">${catTag(x.c)}</span><div class="bar" style="flex:1"><div style="width:${x.n/maxCat*100}%"></div></div><span class="mini" style="width:34px;text-align:right">${x.n}명</span></div>`).join(""):'<div class="empty">등록된 고객이 없습니다</div>'}
    </div>
  </div>`;
}

/* ---------- 고객관리 ---------- */
function filteredClients(){
  return clients.filter(c=>{
    if(filters.q){
      const headName=c.family_head?((clients.find(x=>x.id===c.family_head)||{}).name||""):"";
      if(!((c.name||"")+(c.family||"")+headName).includes(filters.q))return false;
    }
    if(filters.manager && c.manager!==filters.manager)return false;
    if(filters.type && c.type!==filters.type)return false;
    if(filters.cat && !(c.categories||[]).includes(filters.cat))return false;
    if(filters.family && c.family!==filters.family)return false;
    return true;
  }).sort((a,b)=>Number(b.aum||0)-Number(a.aum||0));
}
function familyMembers(cid){return clients.filter(c=>c.family_head===cid)}
function familyCell(c){
  const members=familyMembers(c.id);
  if(members.length){
    const names=members.map(m=>esc(m.name)).slice(0,3).join(", ");
    return `<b>주고객</b><div class="mini">${names}${members.length>3?" 외 "+(members.length-3)+"명":""}</div>`;
  }
  if(c.family_head){
    const head=clients.find(x=>x.id===c.family_head);
    return head?`<span class="mini">⤷ ${esc(head.name)} 패밀리</span>`:"-";
  }
  return esc(c.family||"-");
}
function renderClients(){
  const fams=[...new Set(clients.map(c=>c.family).filter(Boolean))];
  const list=filteredClients();
  $("tab-clients").innerHTML=`
  <div class="toolbar">
    <input type="text" placeholder="고객명/패밀리 검색" value="${esc(filters.q)}" oninput="filters.q=this.value;renderClients()">
    <select onchange="filters.manager=this.value;renderClients()"><option value="">담당자 전체</option>${managers.map(m=>`<option ${filters.manager===m?"selected":""}>${esc(m)}</option>`).join("")}</select>
    <select onchange="filters.type=this.value;renderClients()"><option value="">개인/법인</option><option ${filters.type==="개인"?"selected":""}>개인</option><option ${filters.type==="법인"?"selected":""}>법인</option></select>
    <select onchange="filters.cat=this.value;renderClients()"><option value="">유형 전체</option>${CATS.map(c=>`<option ${filters.cat===c?"selected":""}>${c}</option>`).join("")}</select>
    <select onchange="filters.family=this.value;renderClients()"><option value="">패밀리 전체</option>${fams.map(f=>`<option ${filters.family===f?"selected":""}>${esc(f)}</option>`).join("")}</select>
    <div style="flex:1"></div>
    <button class="btn btn-s" onclick="openImportModal()">📄 Excel 업로드</button>
    <button class="btn btn-p" onclick="openClientModal()">+ 고객 등록</button>
  </div>
  <div class="panel" style="padding:0;overflow-x:auto">
    <table><thead><tr><th>고객명</th><th>구분</th><th>등급</th><th>패밀리</th><th>유형</th><th>담당자</th><th>자산(억원)</th><th>최근수익률</th><th></th></tr></thead><tbody>
    ${list.length?list.map(c=>{const r=lastReturn(c.id);return `<tr>
      <td><b>${esc(c.name)}</b>${c.memo?`<div class="mini">${esc(c.memo).slice(0,30)}</div>`:""}</td>
      <td>${c.type||"-"}</td>
      <td><span class="grade g-${c.grade||"C"}">${c.grade||"-"}</span></td>
      <td>${familyCell(c)}</td>
      <td>${(c.categories||[]).map(catTag).join("")||"-"}</td>
      <td>${esc(c.manager||"-")}</td>
      <td>${fmt(c.aum)}</td>
      <td>${r?rateHtml(r.rate)+`<div class="mini">${r.base_date}</div>`:'<span class="mini">미입력</span>'}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-s btn-sm" onclick="openFamilyModal('${c.id}')">패밀리</button>
        <button class="btn btn-s btn-sm" onclick="openClientModal('${c.id}')">수정</button>
        <button class="btn btn-s btn-sm" onclick="openReturnModal('${c.id}')">수익률</button>
        <button class="btn btn-d btn-sm" onclick="delClient('${c.id}')">삭제</button>
      </td></tr>`}).join(""):'<tr><td colspan="9"><div class="empty">조건에 맞는 고객이 없습니다</div></td></tr>'}
    </tbody></table>
  </div>`;
}

/* ---------- 패밀리 고객 관리 ---------- */
function openFamilyModal(cid){
  const c=clients.find(x=>x.id===cid);if(!c)return;
  if(c.family_head){
    const head=clients.find(x=>x.id===c.family_head);
    if(head&&confirm(`'${c.name}' 고객은 '${head.name}' 고객의 패밀리로 연결되어 있습니다.\n주고객 '${head.name}'의 패밀리 화면을 열까요?`)){
      openFamilyModal(head.id);
    }
    return;
  }
  $("f_headId").value=cid;
  $("f_headName").textContent=c.name;
  renderFamily();
  $("familyModal").classList.add("open");
}
function renderFamily(){
  const hid=$("f_headId").value;
  // 연결 후보: 본인 제외, 이미 다른 패밀리에 속하지 않고, 본인이 주고객이 아닌 고객
  const candidates=clients.filter(c=>c.id!==hid&&!c.family_head&&familyMembers(c.id).length===0);
  $("f_pick").innerHTML='<option value="">— 고객 선택 —</option>'+
    candidates.map(c=>`<option value="${c.id}">${esc(c.name)} (${c.type||"개인"}${c.manager?" · "+esc(c.manager):""})</option>`).join("");
  const members=familyMembers(hid);
  $("f_list").innerHTML=members.length?`
    <p class="mini" style="margin-bottom:6px">연결된 패밀리 고객 (${members.length}명)</p>
    <table><thead><tr><th>이름</th><th>구분</th><th>담당자</th><th>자산(억원)</th><th></th></tr></thead><tbody>
    ${members.map(m=>`<tr>
      <td><b>${esc(m.name)}</b></td><td>${m.type||"-"}</td><td>${esc(m.manager||"-")}</td><td>${fmt(m.aum)}</td>
      <td><button class="btn btn-d btn-sm" onclick="unlinkFamily('${m.id}')">연결해제</button></td>
    </tr>`).join("")}
    <tr style="background:#f8f9fb;font-weight:700"><td>패밀리 합산</td><td></td><td></td>
      <td>${fmt(members.reduce((s,m)=>s+Number(m.aum||0),0)+Number((clients.find(x=>x.id===hid)||{}).aum||0))}</td><td class="mini" style="font-weight:400">주고객 포함</td></tr>
    </tbody></table>`
    :'<div class="empty">아직 연결된 패밀리 고객이 없습니다.<br>위에서 기존 고객을 연결하거나 새로 등록하세요.</div>';
}
async function linkFamily(){
  const hid=$("f_headId").value;
  const mid=$("f_pick").value;
  if(!mid){alert("연결할 고객을 선택하세요.");return}
  const {error}=await db.from("clients").update({family_head:hid}).eq("id",mid);
  if(error){err(error);return}
  await loadAll();
  renderFamily();
}
async function createFamily(){
  const hid=$("f_headId").value;
  const head=clients.find(x=>x.id===hid);
  const name=$("f_newName").value.trim();
  if(!name){alert("이름을 입력하세요.");return}
  const {error}=await db.from("clients").insert({
    name, type:"개인", manager:head?head.manager:me.name, grade:"B",
    family_head:hid, categories:[]
  });
  if(error){err(error);return}
  $("f_newName").value="";
  await loadAll();
  renderFamily();
}
async function unlinkFamily(mid){
  const m=clients.find(x=>x.id===mid);
  if(!confirm(`'${m.name}' 고객의 패밀리 연결을 해제할까요? (고객 자체는 삭제되지 않습니다)`))return;
  const {error}=await db.from("clients").update({family_head:null}).eq("id",mid);
  if(error){err(error);return}
  await loadAll();
  renderFamily();
}
function buildCatChecks(elId,selected){
  $(elId).innerHTML=CATS.map(c=>`<label><input type="checkbox" value="${c}" ${selected.includes(c)?"checked":""} ${elId==="c_cats"?'onchange="toggleWrapFields()"':""}>${c}</label>`).join("");
}
function toggleWrapFields(){
  const on=[...document.querySelectorAll("#c_cats input:checked")].some(i=>i.value==="랩");
  $("wrapFields").style.display=on?"":"none";
}
function mgrOptions(sel){return managers.map(m=>`<option ${m===sel?"selected":""}>${esc(m)}</option>`).join("")}
function openClientModal(id,presetWrap){
  const c=id?clients.find(x=>x.id===id):null;
  $("clientModalTitle").textContent=c?"고객 수정":(presetWrap?"랩고객 등록":"고객 등록");
  $("c_id").value=c?c.id:"";
  $("c_name").value=c?c.name:"";
  $("c_type").value=c?c.type:"개인";
  $("c_family").value=c?(c.family||""):"";
  $("c_manager").innerHTML=mgrOptions(c?c.manager:me.name);
  $("c_grade").value=c?(c.grade||"B"):"B";
  $("c_aum").value=c?(c.aum??""):"";
  $("c_phone").value=c?(c.phone||""):"";
  $("c_email").value=c?(c.email||""):"";
  $("c_memo").value=c?(c.memo||""):"";
  buildCatChecks("c_cats",c?(c.categories||[]):(presetWrap?["랩"]:[]));
  const w=c&&c.wrap?c.wrap:{};
  $("c_wrapCompany").value=w.company||"";
  $("c_wrapAmount").value=w.amount||"";
  $("c_wrapDate").value=w.date||"";
  toggleWrapFields();
  $("clientModal").classList.add("open");
}
async function saveClient(){
  const name=$("c_name").value.trim();
  if(!name){alert("고객명을 입력하세요.");return}
  const id=$("c_id").value;
  const cats=[...document.querySelectorAll("#c_cats input:checked")].map(i=>i.value);
  const row={
    name, type:$("c_type").value, family:$("c_family").value.trim()||null,
    manager:$("c_manager").value, grade:$("c_grade").value,
    aum:$("c_aum").value===""?null:Number($("c_aum").value),
    phone:$("c_phone").value.trim()||null, email:$("c_email").value.trim()||null,
    memo:$("c_memo").value.trim()||null, categories:cats,
    wrap:cats.includes("랩")?{company:$("c_wrapCompany").value.trim(),amount:$("c_wrapAmount").value,date:$("c_wrapDate").value,curValue:(id?(clients.find(x=>x.id===id)?.wrap?.curValue??null):null)}:null
  };
  const q = id ? db.from("clients").update(row).eq("id",id) : db.from("clients").insert(row);
  const {error} = await q;
  if(error){err(error);return}
  closeModal("clientModal");
  await loadAll();
}
async function delClient(id){
  const c=clients.find(x=>x.id===id);
  if(!confirm(`'${c.name}' 고객을 삭제할까요? 수익률 이력도 함께 삭제됩니다.`))return;
  const {error}=await db.from("clients").delete().eq("id",id);
  if(error){err(error);return}
  await loadAll();
}

/* ---------- 수익률관리 ---------- */
function renderReturns(){
  const t=today();
  const cs=clients.slice().sort((a,b)=>{
    const ra=lastReturn(a.id),rb=lastReturn(b.id);
    return (ra?ra.base_date:"0000").localeCompare(rb?rb.base_date:"0000");
  });
  $("tab-returns").innerHTML=`
  <div class="panel" style="padding:0;overflow-x:auto">
    <table><thead><tr><th>고객명</th><th>담당자</th><th>자산(억원)</th><th>최근 기준일</th><th>수익률</th><th>평가금액(백만)</th><th>상태</th><th></th></tr></thead><tbody>
    ${cs.length?cs.map(c=>{
      const r=lastReturn(c.id);
      const stale=!r||((new Date(t)-new Date(r.base_date))>1000*60*60*24*30);
      return `<tr class="${stale?"due":""}">
        <td><b>${esc(c.name)}</b></td><td>${esc(c.manager||"-")}</td><td>${fmt(c.aum)}</td>
        <td>${r?r.base_date:"-"}</td><td>${r?rateHtml(r.rate):"-"}</td><td>${r?fmt(r.value):"-"}</td>
        <td>${stale?'<span class="due-badge">갱신 필요</span>':'<span class="ok-badge">최신</span>'}</td>
        <td><button class="btn btn-p btn-sm" onclick="openReturnModal('${c.id}')">입력/이력</button></td>
      </tr>`}).join(""):'<tr><td colspan="8"><div class="empty">고객을 먼저 등록하세요</div></td></tr>'}
    </tbody></table>
  </div>
  <p class="mini" style="margin-top:8px">※ 최근 입력일이 30일을 초과하면 '갱신 필요'로 표시됩니다.</p>`;
}
function openReturnModal(id){
  const c=clients.find(x=>x.id===id);if(!c)return;
  $("r_clientId").value=id;
  $("r_clientName").textContent=c.name;
  $("r_date").value=today();
  $("r_rate").value="";$("r_value").value="";$("r_memo").value="";
  renderReturnHistory(id);
  $("returnModal").classList.add("open");
}
function renderReturnHistory(cid){
  const rows=clientReturns(cid);
  $("r_history").innerHTML=rows.length?`
    <table><thead><tr><th>기준일</th><th>수익률</th><th>평가금액</th><th>메모</th><th></th></tr></thead><tbody>
    ${rows.map(r=>`<tr><td>${r.base_date}</td><td>${rateHtml(r.rate)}</td><td>${fmt(r.value)}</td><td class="mini">${esc(r.memo||"")}</td>
    <td><button class="btn btn-d btn-sm" onclick="delReturn('${r.id}','${cid}')">삭제</button></td></tr>`).join("")}
    </tbody></table>`:'<div class="empty">입력된 이력이 없습니다</div>';
}
async function saveReturn(){
  const cid=$("r_clientId").value;
  const base_date=$("r_date").value, rate=$("r_rate").value;
  if(!base_date||rate===""){alert("기준일과 수익률을 입력하세요.");return}
  const {error}=await db.from("returns").insert({
    client_id:cid, base_date, rate:Number(rate),
    value:$("r_value").value===""?null:Number($("r_value").value),
    memo:$("r_memo").value.trim()||null
  });
  if(error){err(error);return}
  $("r_rate").value="";$("r_value").value="";$("r_memo").value="";
  await loadAll();
  renderReturnHistory(cid);
}
async function delReturn(rid,cid){
  const {error}=await db.from("returns").delete().eq("id",rid);
  if(error){err(error);return}
  await loadAll();
  renderReturnHistory(cid);
}

/* ---------- 랩고객 ---------- */
function clientHoldingDates(cid){
  return [...new Set(holdings.filter(x=>x.client_id===cid).map(x=>x.base_date))].sort().reverse();
}
function wrapRate(w){
  if(!w||!w.amount||!w.curValue)return null;
  const a=Number(w.amount),v=Number(w.curValue);
  if(!a||isNaN(a)||isNaN(v))return null;
  return (v/a-1)*100;
}
function renderWrap(){
  const list=clients.filter(c=>(c.categories||[]).includes("랩"));
  const t=today();
  $("tab-wrap").innerHTML=`
  <div class="toolbar">
    <span class="mini">랩정보 버튼으로 계약·평가 정보를, 편입종목 버튼으로 포트폴리오를 관리하세요.</span>
    <div style="flex:1"></div>
    <button class="btn btn-p" onclick="openClientModal(null,true)">+ 랩고객 등록</button>
  </div>
  <div class="panel" style="padding:0;overflow-x:auto">
    <table><thead><tr><th>고객명</th><th>담당자</th><th>계약일</th><th>계약금액(백만)</th><th>현재평가액(백만)</th><th>수익률</th><th>편입종목</th><th></th></tr></thead><tbody>
    ${list.length?list.map(c=>{
      const w=c.wrap||{};
      const wr=wrapRate(w);
      const dates=clientHoldingDates(c.id);
      const hd=dates[0]||null;
      const cnt=hd?holdings.filter(x=>x.client_id===c.id&&x.base_date===hd).length:0;
      const hStale=!hd||((new Date(t)-new Date(hd))>1000*60*60*24*30);
      return `<tr>
      <td><b>${esc(c.name)}</b>${w.company?`<div class="mini">${esc(w.company)}</div>`:""}</td>
      <td>${esc(c.manager||"-")}</td>
      <td>${w.date||"-"}</td>
      <td>${fmt(w.amount)}</td>
      <td>${fmt(w.curValue)}</td>
      <td>${wr!=null?rateHtml(wr):'<span class="mini">평가액 미입력</span>'}</td>
      <td>${hd?`${cnt}종목<div class="mini">${hd}</div>`:'<span class="mini">미입력</span>'} ${hStale?'<span class="due-badge">갱신</span>':''}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-p btn-sm" onclick="openWrapModal('${c.id}')">랩정보</button>
        <button class="btn btn-p btn-sm" onclick="openHoldModal('${c.id}')">편입종목</button>
        <button class="btn btn-s btn-sm" onclick="openReturnModal('${c.id}')">수익률이력</button>
      </td></tr>`}).join(""):'<tr><td colspan="8"><div class="empty">아직 랩고객이 없습니다. \'+ 랩고객 등록\' 버튼으로 시작하세요.<br>(기존 고객은 고객관리에서 수정 → 유형에 \'랩\' 체크)</div></td></tr>'}
    </tbody></table>
  </div>
  <p class="mini" style="margin-top:8px">※ 수익률 = 현재평가액 ÷ 계약금액 − 1 로 자동 계산됩니다. 편입종목 기준일이 30일을 초과하면 '갱신' 배지가 표시됩니다.</p>`;
}

/* ---------- 랩 정보 입력 ---------- */
function openWrapModal(cid){
  const c=clients.find(x=>x.id===cid);if(!c)return;
  const w=c.wrap||{};
  $("w_clientId").value=cid;
  $("w_clientName").textContent=c.name;
  $("w_manager").innerHTML=mgrOptions(c.manager||me.name);
  $("w_date").value=w.date||"";
  $("w_company").value=w.company||"";
  $("w_amount").value=w.amount??"";
  $("w_curValue").value=w.curValue??"";
  calcWrapRate();
  $("wrapModal").classList.add("open");
}
function calcWrapRate(){
  const r=wrapRate({amount:$("w_amount").value,curValue:$("w_curValue").value});
  $("w_rateView").innerHTML=r==null?'<span class="mini" style="font-weight:400">계약금액과 현재평가액을 입력하면 자동 계산됩니다</span>':rateHtml(r);
}
async function saveWrap(){
  const cid=$("w_clientId").value;
  const c=clients.find(x=>x.id===cid);if(!c)return;
  const cats=c.categories||[];
  const wrap={
    company:$("w_company").value.trim(),
    amount:$("w_amount").value===""?null:Number($("w_amount").value),
    curValue:$("w_curValue").value===""?null:Number($("w_curValue").value),
    date:$("w_date").value||null
  };
  const {error}=await db.from("clients").update({
    manager:$("w_manager").value,
    wrap,
    categories:cats.includes("랩")?cats:[...cats,"랩"]
  }).eq("id",cid);
  if(error){err(error);return}
  closeModal("wrapModal");
  await loadAll();
}

/* ---------- 랩 편입종목 ---------- */
function openHoldModal(cid){
  const c=clients.find(x=>x.id===cid);if(!c)return;
  $("h_clientId").value=cid;
  $("h_clientName").textContent=c.name;
  const dates=clientHoldingDates(cid);
  $("h_date").value=dates[0]||today();
  renderHoldings();
  $("holdModal").classList.add("open");
}
function renderHoldings(){
  const cid=$("h_clientId").value;
  const date=$("h_date").value;
  const dates=clientHoldingDates(cid);
  $("h_dates").innerHTML=dates.slice(0,8).map(d=>
    `<button class="btn btn-sm ${d===date?"btn-p":"btn-s"}" onclick="$('h_date').value='${d}';renderHoldings()">${d.slice(2)}</button>`
  ).join("");
  const rows=holdings.filter(x=>x.client_id===cid&&x.base_date===date)
    .sort((a,b)=>Number(b.weight||0)-Number(a.weight||0));
  const wSum=rows.reduce((s,x)=>s+Number(x.weight||0),0);
  const vSum=rows.reduce((s,x)=>s+Number(x.value||0),0);
  $("h_table").innerHTML=rows.length?`
    <table><thead><tr><th>종목명</th><th>코드</th><th>비중(%)</th><th>평가금액(백만)</th><th>수익률</th><th>메모</th><th></th></tr></thead><tbody>
    ${rows.map(x=>`<tr>
      <td><b>${esc(x.stock_name)}</b></td><td class="mini">${esc(x.stock_code||"-")}</td>
      <td>${x.weight==null?"-":Number(x.weight).toFixed(1)}</td>
      <td>${fmt(x.value)}</td>
      <td>${x.rate==null?"-":rateHtml(x.rate)}</td>
      <td class="mini">${esc(x.memo||"")}</td>
      <td><button class="btn btn-d btn-sm" onclick="delHolding('${x.id}')">삭제</button></td>
    </tr>`).join("")}
    <tr style="background:#f8f9fb;font-weight:700"><td>합계 (${rows.length}종목)</td><td></td>
      <td class="${Math.abs(wSum-100)<=0.5?"":"pos"}">${wSum.toFixed(1)}</td>
      <td>${fmt(vSum)}</td><td colspan="3"></td></tr>
    </tbody></table>
    ${Math.abs(wSum-100)>0.5&&wSum>0?'<p class="mini" style="margin-top:6px;color:#c2570c">※ 비중 합계가 100%가 아닙니다.</p>':""}`
    :'<div class="empty">이 기준일에 등록된 종목이 없습니다.<br>위에서 종목을 추가하거나 \'직전 기준일 종목 복사\'를 눌러 시작하세요.</div>';
}
async function addHolding(){
  const cid=$("h_clientId").value;
  const base_date=$("h_date").value;
  const stock_name=$("hi_name").value.trim();
  if(!base_date){alert("기준일을 선택하세요.");return}
  if(!stock_name){alert("종목명을 입력하세요.");return}
  const {error}=await db.from("holdings").insert({
    client_id:cid, base_date, stock_name,
    stock_code:$("hi_code").value.trim()||null,
    weight:$("hi_weight").value===""?null:Number($("hi_weight").value),
    value:$("hi_value").value===""?null:Number($("hi_value").value),
    rate:$("hi_rate").value===""?null:Number($("hi_rate").value),
    memo:$("hi_memo").value.trim()||null
  });
  if(error){err(error);return}
  ["hi_name","hi_code","hi_weight","hi_value","hi_rate","hi_memo"].forEach(i=>$(i).value="");
  $("hi_name").focus();
  await loadAll();
  renderHoldings();
}
async function delHolding(id){
  const {error}=await db.from("holdings").delete().eq("id",id);
  if(error){err(error);return}
  await loadAll();
  renderHoldings();
}
async function copyPrevHoldings(){
  const cid=$("h_clientId").value;
  const date=$("h_date").value;
  if(!date){alert("기준일을 먼저 선택하세요.");return}
  if(holdings.some(x=>x.client_id===cid&&x.base_date===date)){
    alert("선택한 기준일에 이미 종목이 있습니다. 빈 기준일에서만 복사할 수 있습니다.");return;
  }
  const prevDates=clientHoldingDates(cid).filter(d=>d<date);
  if(!prevDates.length){alert("복사할 이전 기준일 데이터가 없습니다.");return}
  const src=holdings.filter(x=>x.client_id===cid&&x.base_date===prevDates[0]);
  if(!confirm(`${prevDates[0]} 기준 ${src.length}종목을 ${date}(으)로 복사할까요?\n복사 후 비중·평가금액·수익률만 수정하면 됩니다.`))return;
  const rows=src.map(x=>({client_id:cid,base_date:date,stock_name:x.stock_name,stock_code:x.stock_code,weight:x.weight,value:x.value,rate:x.rate,memo:null}));
  const {error}=await db.from("holdings").insert(rows);
  if(error){err(error);return}
  await loadAll();
  renderHoldings();
}

/* ---------- 잠재고객 ---------- */
function renderProspects(){
  const t=today();
  const list=prospects.slice().sort((a,b)=>{
    const na=nextContact(a)||"0000",nb=nextContact(b)||"0000";
    return na.localeCompare(nb);
  });
  $("tab-prospects").innerHTML=`
  <div class="toolbar">
    <span class="mini">접촉 예정일이 지난 고객은 강조 표시됩니다.</span>
    <div style="flex:1"></div>
    <button class="btn btn-p" onclick="openProspectModal()">+ 잠재고객 등록</button>
  </div>
  <div class="panel" style="padding:0;overflow-x:auto">
    <table><thead><tr><th>이름</th><th>연락처</th><th>이메일</th><th>담당자</th><th>예상자산(백만)</th><th>관심유형</th><th>주기</th><th>최근접촉</th><th>다음접촉</th><th>상태</th><th></th></tr></thead><tbody>
    ${list.length?list.map(p=>{
      const nc=nextContact(p);
      const due=!p.last_contact||(nc&&nc<=t);
      const cyc={7:"주간",30:"월간",90:"분기"}[p.cycle]||"월간";
      return `<tr class="${due?"due":""}">
        <td><b>${esc(p.name)}</b>${p.source?`<div class="mini">${esc(p.source)}</div>`:""}</td>
        <td>${esc(p.phone||"-")}</td><td>${esc(p.email||"-")}</td>
        <td>${esc(p.manager||"-")}</td><td>${fmt(p.expected_asset)}</td>
        <td>${(p.interests||[]).map(catTag).join("")||"-"}</td>
        <td>${cyc}</td><td>${p.last_contact||"-"}</td><td>${nc||"-"}</td>
        <td>${due?'<span class="due-badge">접촉 필요</span>':'<span class="ok-badge">양호</span>'}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-p btn-sm" onclick="contactNow('${p.id}')">접촉완료</button>
          <button class="btn btn-s btn-sm" onclick="openProspectModal('${p.id}')">수정</button>
          <button class="btn btn-s btn-sm" onclick="convertProspect('${p.id}')">고객전환</button>
          <button class="btn btn-d btn-sm" onclick="delProspect('${p.id}')">삭제</button>
        </td></tr>`}).join(""):'<tr><td colspan="11"><div class="empty">등록된 잠재고객이 없습니다</div></td></tr>'}
    </tbody></table>
  </div>`;
}
function openProspectModal(id){
  const p=id?prospects.find(x=>x.id===id):null;
  $("prospectModalTitle").textContent=p?"잠재고객 수정":"잠재고객 등록";
  $("p_id").value=p?p.id:"";
  $("p_name").value=p?p.name:"";
  $("p_manager").innerHTML=mgrOptions(p?p.manager:me.name);
  $("p_phone").value=p?(p.phone||""):"";
  $("p_email").value=p?(p.email||""):"";
  $("p_asset").value=p?(p.expected_asset??""):"";
  $("p_cycle").value=p?(p.cycle||30):30;
  $("p_last").value=p?(p.last_contact||""):"";
  $("p_source").value=p?(p.source||""):"";
  $("p_memo").value=p?(p.memo||""):"";
  buildCatChecks("p_cats",p?(p.interests||[]):[]);
  $("prospectModal").classList.add("open");
}
async function saveProspect(){
  const name=$("p_name").value.trim();
  if(!name){alert("이름을 입력하세요.");return}
  const id=$("p_id").value;
  const row={
    name, manager:$("p_manager").value,
    phone:$("p_phone").value.trim()||null,
    email:$("p_email").value.trim()||null,
    expected_asset:$("p_asset").value===""?null:Number($("p_asset").value),
    cycle:Number($("p_cycle").value),
    last_contact:$("p_last").value||null,
    source:$("p_source").value.trim()||null,
    memo:$("p_memo").value.trim()||null,
    interests:[...document.querySelectorAll("#p_cats input:checked")].map(i=>i.value)
  };
  const q = id ? db.from("prospects").update(row).eq("id",id) : db.from("prospects").insert(row);
  const {error}=await q;
  if(error){err(error);return}
  closeModal("prospectModal");
  await loadAll();
}
async function contactNow(id){
  const {error}=await db.from("prospects").update({last_contact:today()}).eq("id",id);
  if(error){err(error);return}
  await loadAll();
}
async function convertProspect(id){
  const p=prospects.find(x=>x.id===id);if(!p)return;
  if(!confirm(`'${p.name}' 잠재고객을 정식 고객으로 전환할까요?`))return;
  const {error:e1}=await db.from("clients").insert({
    name:p.name, type:"개인", manager:p.manager, grade:"C",
    phone:p.phone||null, email:p.email||null,
    aum:p.expected_asset, categories:p.interests||[],
    memo:(p.memo?p.memo+" / ":"")+"잠재고객 전환("+today()+")"
  });
  if(e1){err(e1);return}
  const {error:e2}=await db.from("prospects").delete().eq("id",id);
  if(e2){err(e2);return}
  await loadAll();
  showTab("clients");
}
async function delProspect(id){
  const p=prospects.find(x=>x.id===id);
  if(!confirm(`'${p.name}' 잠재고객을 삭제할까요?`))return;
  const {error}=await db.from("prospects").delete().eq("id",id);
  if(error){err(error);return}
  await loadAll();
}

/* ---------- Excel 일괄 업로드 ---------- */
const IMPORT_FIELDS = [
  {key:"name",      label:"고객명 (필수)",        hints:["고객명","이름","성명","고객"]},
  {key:"type",      label:"구분(개인/법인)",      hints:["구분","개인/법인","법인여부"]},
  {key:"family",    label:"패밀리 그룹",          hints:["패밀리","가족","패밀리그룹","family"]},
  {key:"manager",   label:"담당자",               hints:["담당자","담당","pb","rm"]},
  {key:"grade",     label:"등급",                 hints:["등급","grade","고객등급"]},
  {key:"aum",       label:"자산(억원)",          hints:["aum","자산","금액","평가금액","잔고","예탁"]},
  {key:"phone",     label:"연락처",               hints:["연락처","전화","휴대폰","핸드폰","hp","tel"]},
  {key:"email",     label:"이메일",               hints:["이메일","메일","email","e-mail"]},
  {key:"categories",label:"투자유형(쉼표 구분)",  hints:["유형","투자유형","카테고리","관심","상품"]},
  {key:"memo",      label:"메모",                 hints:["메모","비고","note","참고"]},
];
let importHeaders=[], importRows=[];

function openImportModal(){
  importHeaders=[];importRows=[];
  $("importFile").value="";
  $("mapArea").style.display="none";
  $("importRunBtn").style.display="none";
  $("importMsg").className="msg";
  $("importModal").classList.add("open");
}
function handleImportFile(ev){
  const f=ev.target.files[0];if(!f)return;
  const rd=new FileReader();
  rd.onload=e=>{
    try{
      const wb=XLSX.read(e.target.result,{type:"array"});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const arr=XLSX.utils.sheet_to_json(ws,{header:1,defval:""});
      // 빈 행 제거
      const rows=arr.filter(r=>r.some(c=>String(c).trim()!==""));
      if(rows.length<2){showMsg("importMsg","데이터가 없습니다. 첫 행에 열 제목, 둘째 행부터 고객 데이터가 있어야 합니다.");return}
      importHeaders=rows[0].map(h=>String(h).trim());
      importRows=rows.slice(1);
      buildMappingUI();
      $("mapArea").style.display="";
      $("importRunBtn").style.display="";
      showMsg("importMsg",`${importRows.length}건을 읽었습니다. 아래에서 열 연결을 확인하세요.`,true);
    }catch(err2){showMsg("importMsg","파일을 읽지 못했습니다: "+err2.message)}
  };
  rd.readAsArrayBuffer(f);
}
function autoGuess(field){
  const idx=importHeaders.findIndex(h=>{
    const low=h.toLowerCase().replace(/\s/g,"");
    return field.hints.some(k=>low.includes(k.toLowerCase()));
  });
  return idx;
}
function buildMappingUI(){
  $("mapRows").innerHTML=IMPORT_FIELDS.map(f=>{
    const guess=autoGuess(f);
    return `<div class="fg"><label>${f.label}</label>
      <select id="map_${f.key}" onchange="renderImportPreview()">
        <option value="-1">— 사용 안 함 —</option>
        ${importHeaders.map((h,i)=>`<option value="${i}" ${i===guess?"selected":""}>${esc(h)}</option>`).join("")}
      </select></div>`;
  }).join("");
  renderImportPreview();
}
function mappedRow(r){
  const get=k=>{const i=Number($("map_"+k).value);return i>=0?String(r[i]??"").trim():""};
  const row={};
  row.name=get("name");
  const t=get("type"); row.type=t.includes("법")?"법인":"개인";
  row.family=get("family")||null;
  row.manager=get("manager")||me.name;
  const g=get("grade").toUpperCase(); row.grade=["VIP","A","B","C"].includes(g)?g:"B";
  const a=get("aum").replace(/[,\s원]/g,""); row.aum=a===""||isNaN(Number(a))?null:Number(a);
  row.phone=get("phone")||null;
  row.email=get("email")||null;
  row.memo=get("memo")||null;
  const cats=get("categories").split(/[,\/·;|]/).map(s=>s.trim()).filter(s=>CATS.includes(s));
  row.categories=cats;
  return row;
}
function renderImportPreview(){
  const sample=importRows.slice(0,5).map(mappedRow);
  $("importPreview").innerHTML=`
    <p class="mini" style="margin-bottom:6px">미리보기 (상위 5건) — 이렇게 등록됩니다:</p>
    <table><thead><tr><th>고객명</th><th>구분</th><th>패밀리</th><th>담당자</th><th>등급</th><th>자산(억원)</th><th>유형</th></tr></thead><tbody>
    ${sample.map(r=>`<tr>
      <td>${r.name?`<b>${esc(r.name)}</b>`:'<span style="color:#c0392b">비어있음!</span>'}</td>
      <td>${r.type}</td><td>${esc(r.family||"-")}</td><td>${esc(r.manager)}</td>
      <td>${r.grade}</td><td>${fmt(r.aum)}</td><td>${r.categories.map(catTag).join("")||"-"}</td>
    </tr>`).join("")}
    </tbody></table>`;
}
async function runImport(){
  if(Number($("map_name").value)<0){showMsg("importMsg","'고객명' 열은 반드시 지정해야 합니다.");return}
  const skipDup=$("skipDup").checked;
  const existing=new Set(clients.map(c=>c.name));
  let rows=importRows.map(mappedRow).filter(r=>r.name);
  const total=rows.length;
  let skipped=0;
  if(skipDup){
    const before=rows.length;
    rows=rows.filter(r=>!existing.has(r.name));
    skipped=before-rows.length;
  }
  if(rows.length===0){showMsg("importMsg",`등록할 신규 고객이 없습니다. (중복 제외 ${skipped}건)`);return}
  if(!confirm(`${rows.length}건을 등록합니다.${skipped?` (중복 ${skipped}건 제외)`:""} 진행할까요?`))return;
  $("importRunBtn").disabled=true;
  let done=0, failed=0;
  for(let i=0;i<rows.length;i+=100){
    const chunk=rows.slice(i,i+100);
    const {error}=await db.from("clients").insert(chunk);
    if(error){failed+=chunk.length;console.error(error)}
    else{done+=chunk.length}
    showMsg("importMsg",`진행 중... ${done+failed}/${rows.length}`,true);
  }
  $("importRunBtn").disabled=false;
  await loadAll();
  showMsg("importMsg",`완료: ${done}건 등록${skipped?`, 중복 ${skipped}건 건너뜀`:""}${failed?`, 실패 ${failed}건`:""}`,!failed);
  if(!failed)setTimeout(()=>closeModal("importModal"),1800);
}

/* ---------- 공통 ---------- */
function closeModal(id){$(id).classList.remove("open")}
document.querySelectorAll(".modal-bg").forEach(m=>m.addEventListener("click",e=>{if(e.target===m)m.classList.remove("open")}));
function renderAll(){renderDash();renderClients();renderReturns();renderWrap();renderProspects()}
boot();
