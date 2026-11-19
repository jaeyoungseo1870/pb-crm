/* ============================================================
   PB 고객관리시스템 — Supabase 연동 로직
   ============================================================ */
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const CATS = ["주식","채권","해외","ELS","랩","펀드","부동산"];
const CAT_STYLE = {"주식":["--tag-stock","--tag-stock-t"],"채권":["--tag-bond","--tag-bond-t"],"해외":["--tag-ovs","--tag-ovs-t"],"ELS":["--tag-els","--tag-els-t"],"랩":["--tag-wrap","--tag-wrap-t"],"펀드":["--tag-fund","--tag-fund-t"],"부동산":["--tag-re","--tag-re-t"]};

let me = null;                 // {id, name}
let managers = [];             // 가입한 팀원 이름 목록 (담당자 선택지)
let clients = [], returns = [], prospects = [], holdings = [], funds = [], docs = [], elsList = [];
let filters = {q:"", manager:"", type:"", cat:"", family:"", imp:""};
let pFilters = {cat:"", manager:""};

/* ---------- 유틸 ---------- */
const $ = id => document.getElementById(id);
function esc(s){return (s??"").toString().replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function fmt(n){return n==null||n===""?"-":Number(n).toLocaleString("ko-KR")}
function today(){return new Date().toISOString().slice(0,10)}
function catTag(c){const s=CAT_STYLE[c]||["--tag-re","--tag-re-t"];return `<span class="tag" style="background:var(${s[0]});color:var(${s[1]})">${c}</span>`}
function rateHtml(r){if(r==null)return"-";const n=Number(r);return `<span class="${n>=0?"pos":"neg"}">${n>=0?"+":""}${n.toFixed(2)}%</span>`}
function amtHtml(r){if(r==null)return"-";const n=Number(r);return `<b>${n.toLocaleString("ko-KR",{maximumFractionDigits:2})}</b>`}
function impStars(n){n=Number(n||0);return n>0?`<span style="color:var(--brass);font-size:15px;letter-spacing:1px">${"★".repeat(n)}</span>`:'<span class="mini">-</span>'}
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
/* ---------- 데이터 로드(전체 페이징) ---------- */
async function fetchAll(table, orderCol){
  // Supabase는 요청당 최대 1,000건만 반환하므로 1,000건씩 반복해서 전부 가져온다
  let all=[], from=0; const size=1000;
  while(true){
    let q=db.from(table).select("*").range(from, from+size-1);
    if(orderCol) q=q.order(orderCol,{ascending:true});
    const {data,error}=await q;
    if(error) return {data:all,error};
    all=all.concat(data||[]);
    if(!data || data.length<size) break;
    from+=size;
  }
  return {data:all,error:null};
}
async function loadAll(manual){
  const [p,c,r,s,h,f,d,e] = await Promise.all([
    db.from("profiles").select("name").order("created_at"),
    fetchAll("clients","created_at"),
    fetchAll("returns",null),
    fetchAll("prospects","created_at"),
    fetchAll("holdings",null),
    fetchAll("funds","join_date"),
    fetchAll("documents","created_at"),
    fetchAll("els","join_date"),
  ]);
  if(p.error||c.error||r.error||s.error){err(p.error||c.error||r.error||s.error);return}
  managers = p.data.map(x=>x.name);
  clients = c.data; returns = r.data; prospects = s.data;
  holdings = h.error ? [] : h.data;   // holdings 테이블 미생성 시에도 앱은 동작
  funds = f.error ? [] : f.data;      // funds 테이블 미생성 시에도 앱은 동작
  docs = d.error ? [] : d.data;       // documents 테이블 미생성 시에도 앱은 동작
  elsList = e.error ? [] : e.data;    // els 테이블 미생성 시에도 앱은 동작
  $("teamSub").textContent = "팀원: "+(managers.join(" · ")||"-");
  renderAll();
  loadSemi();
  if(manual){const el=$("teamSub");el.style.color="#ffd166";setTimeout(()=>el.style.color="",700)}
}

/* ---------- 탭 ---------- */
function showTab(t){
  document.querySelectorAll("nav button").forEach(b=>b.classList.toggle("active",b.dataset.tab===t));
  ["dash","clients","returns","wrap","funds","prospects","els","docs","semi"].forEach(x=>$("tab-"+x).style.display=x===t?"":"none");
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
  const soon=new Date();soon.setDate(soon.getDate()+30);const soonStr=soon.toISOString().slice(0,10);
  const dueF = funds.filter(f=>f.maturity && f.maturity>=t && f.maturity<=soonStr);
  const dueE = elsList.filter(x=>x.maturity && x.maturity>=t && x.maturity<=soonStr);

  $("tab-dash").innerHTML = `
  <div class="cards">
    <div class="card"><div class="lbl">총 고객</div><div class="val">${clients.length}<small>명</small></div></div>
    <div class="card"><div class="lbl">총 자산</div><div class="val">${fmt(totalAum)}<small>억원</small></div></div>
    <div class="card"><div class="lbl">패밀리 그룹</div><div class="val">${fams.length}<small>개</small></div></div>
    <div class="card"><div class="lbl">랩 고객</div><div class="val">${clients.filter(c=>(c.categories||[]).includes("랩")).length}<small>명</small></div></div>
    <div class="card"><div class="lbl">잠재고객</div><div class="val">${prospects.length}<small>명</small></div></div>
  </div>
  <div class="panel"><h2>오늘 할 일</h2>
    ${dueP.length===0&&staleR.length===0&&staleH.length===0&&dueF.length===0&&dueE.length===0?'<div class="empty">모두 처리되었습니다 ✓</div>':`
    ${dueP.length?`<p style="margin-bottom:8px"><span class="due-badge">접촉 필요</span> <b>${dueP.length}명</b>의 잠재고객 — ${dueP.slice(0,5).map(p=>esc(p.name)).join(", ")}${dueP.length>5?" 외":""} <span class="clickable" onclick="showTab('prospects')">→ 이동</span></p>`:""}
    ${staleR.length?`<p style="margin-bottom:8px"><span class="due-badge">수익 갱신</span> 30일 이상 미입력 <b>${staleR.length}명</b> — ${staleR.slice(0,5).map(c=>esc(c.name)).join(", ")}${staleR.length>5?" 외":""} <span class="clickable" onclick="showTab('returns')">→ 이동</span></p>`:""}
    ${dueE.length?`<p style="margin-bottom:8px"><span class="due-badge">ELS 만기 임박</span> 30일 이내 <b>${dueE.length}건</b> — ${dueE.slice(0,5).map(x=>esc(x.client_name)+"("+(x.maturity||"")+")").join(", ")}${dueE.length>5?" 외":""} <span class="clickable" onclick="showTab('els')">→ 이동</span></p>`:""}
    ${dueF.length?`<p style="margin-bottom:8px"><span class="due-badge">펀드 만기 임박</span> 30일 이내 <b>${dueF.length}건</b> — ${dueF.slice(0,5).map(f=>esc(f.client_name)+"("+(f.maturity||"")+")").join(", ")}${dueF.length>5?" 외":""} <span class="clickable" onclick="showTab('funds')">→ 이동</span></p>`:""}
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
    if(filters.imp && Number(c.importance||0) < Number(filters.imp))return false;
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
    <select onchange="filters.imp=this.value;renderClients()"><option value="">중요도 전체</option>${[5,4,3,2,1].map(n=>`<option value="${n}" ${filters.imp==String(n)?"selected":""}>${"★".repeat(n)}${n<5?" 이상":""}</option>`).join("")}</select>
    <div style="flex:1"></div>
    <button class="btn btn-s" onclick="openImportModal()">📄 Excel 업로드</button>
    <button class="btn btn-p" onclick="openClientModal()">+ 고객 등록</button>
  </div>
  <div class="panel" style="padding:0;overflow-x:auto">
    <table><thead><tr><th>고객명</th><th>구분</th><th>중요도</th><th>패밀리</th><th>유형</th><th>담당자</th><th>자산(억원)</th><th>수익(억원)</th><th></th></tr></thead><tbody>
    ${list.length?list.map(c=>{const r=lastReturn(c.id);return `<tr>
      <td><b>${esc(c.name)}</b>${c.memo?`<div class="mini">${esc(c.memo).slice(0,30)}</div>`:""}</td>
      <td>${c.type||"-"}</td>
      <td>${impStars(c.importance)}</td>
      <td>${familyCell(c)}</td>
      <td>${(c.categories||[]).map(catTag).join("")||"-"}</td>
      <td>${esc(c.manager||"-")}</td>
      <td>${fmt(c.aum)}</td>
      <td>${r?amtHtml(r.rate)+`<div class="mini">${r.base_date}</div>`:'<span class="mini">미입력</span>'}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-s btn-sm" onclick="openFamilyModal('${c.id}')">패밀리</button>
        <button class="btn btn-s btn-sm" onclick="openClientModal('${c.id}')">수정</button>
        <button class="btn btn-s btn-sm" onclick="openReturnModal('${c.id}')">수익</button>
        <button class="btn btn-d btn-sm" onclick="delClient('${c.id}')">삭제</button>
      </td></tr>`}).join(""):'<tr><td colspan="9"><div class="empty">조건에 맞는 고객이 없습니다</div></td></tr>'}
    </tbody></table>
  </div>`;
}

/* ---------- 잠재고객 메시지 보내기 ---------- */
const MSG_TPL_KEY="pbcrm-msg-template";
const DEFAULT_TPL="{이름} 님, 안녕하세요.\n서재영입니다.\n\n{회사명} 관련하여 도움이 될 만한 자료가 있어 연락드립니다.\n편하신 시간에 잠시 통화 가능하실까요?\n\n감사합니다.";
let _msgs=[];
function openMsgModal(pid){
  let saved=null;
  try{saved=localStorage.getItem(MSG_TPL_KEY)}catch(e){}
  $("m_template").value=saved||DEFAULT_TPL;
  $("m_recipients").innerHTML=prospects.map(p=>
    `<label><input type="checkbox" value="${p.id}" ${pid===p.id?"checked":""}>${esc(p.name)}${p.company?" · "+esc(p.company):""}${p.phone?"":" (연락처없음)"}</label>`
  ).join("")||'<span class="mini">등록된 잠재고객이 없습니다</span>';
  $("m_out").innerHTML="";
  $("msgModal").classList.add("open");
}
function msgSelectAll(on){
  document.querySelectorAll("#m_recipients input").forEach(i=>i.checked=on);
}
function personalize(tpl,p){
  return tpl.split("{이름}").join(p.name).split("{회사명}").join(p.company||"");
}
function generateMessages(){
  const tpl=$("m_template").value;
  try{localStorage.setItem(MSG_TPL_KEY,tpl)}catch(e){}
  const ids=[...document.querySelectorAll("#m_recipients input:checked")].map(i=>i.value);
  if(!ids.length){alert("받는 사람을 선택하세요.");return}
  const sel=prospects.filter(p=>ids.includes(p.id));
  _msgs=sel.map(p=>personalize(tpl,p));
  $("m_out").innerHTML=sel.map((p,i)=>{
    const text=_msgs[i];
    const sms=p.phone?`<a class="btn btn-s btn-sm" style="text-decoration:none" href="sms:${(p.phone||"").replace(/[^0-9+]/g,"")}${text?"?body="+encodeURIComponent(text):""}">문자</a>`:"";
    return `<div style="border:1px solid var(--line);border-radius:8px;padding:12px;margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <b>${esc(p.name)}</b><span class="mini">${esc(p.company||"")} ${esc(p.phone||"연락처 없음")}</span>
        <div style="flex:1"></div>
        <button class="btn btn-p btn-sm" id="cpbtn_${i}" onclick="copyMsg(${i})">복사</button>${sms}
      </div>
      <div class="mini" style="white-space:pre-wrap;color:var(--ink)">${esc(text)}</div>
    </div>`;
  }).join("");
}
async function copyMsg(i){
  try{
    await navigator.clipboard.writeText(_msgs[i]);
    const b=$("cpbtn_"+i); b.textContent="복사됨 ✓"; b.style.background="#2e7d46";
    setTimeout(()=>{b.textContent="복사"; b.style.background="";},1500);
  }catch(e){
    prompt("자동 복사가 안 되는 환경입니다. 아래 내용을 직접 복사하세요:",_msgs[i]);
  }
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
  $("c_aum").value=c?(c.aum??""):"";
  $("c_phone").value=c?(c.phone||""):"";
  $("c_email").value=c?(c.email||""):"";
  $("c_memo").value=c?(c.memo||""):"";
  buildCatChecks("c_cats",c?(c.categories||[]):(presetWrap?["랩"]:[]));
  if($("c_importance")){ $("c_importance").value=c?(c.importance||""):""; renderImpInput(); }
  const w=c&&c.wrap?c.wrap:{};
  $("c_wrapCompany").value=w.company||"";
  $("c_wrapAmount").value=w.amount||"";
  $("c_wrapDate").value=w.date||"";
  toggleWrapFields();
  $("clientModal").classList.add("open");
}
function renderImpInput(){
  if(!$("c_imp"))return;
  const v=Number($("c_importance").value||0);
  $("c_imp").innerHTML=[1,2,3,4,5].map(n=>
    `<span onclick="setImp(${n})" style="color:${n<=v?'var(--brass)':'#d6dae2'}">★</span>`
  ).join("");
}
function setImp(n){
  const cur=Number($("c_importance").value||0);
  $("c_importance").value = (cur===n)?"":n;
  renderImpInput();
}
async function saveClient(){
  const name=$("c_name").value.trim();
  if(!name){alert("고객명을 입력하세요.");return}
  const id=$("c_id").value;
  const cats=[...document.querySelectorAll("#c_cats input:checked")].map(i=>i.value);
  const row={
    name, type:$("c_type").value, family:$("c_family").value.trim()||null,
    manager:$("c_manager").value,
    aum:$("c_aum").value===""?null:Number($("c_aum").value),
    phone:$("c_phone").value.trim()||null, email:$("c_email").value.trim()||null,
    memo:$("c_memo").value.trim()||null, categories:cats,
    importance:(!$("c_importance")||$("c_importance").value==="")?null:Number($("c_importance").value),
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
  if(!confirm(`'${c.name}' 고객을 삭제할까요? 수익 이력도 함께 삭제됩니다.`))return;
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
    <table><thead><tr><th>고객명</th><th>담당자</th><th>자산(억원)</th><th>최근 기준일</th><th>수익(억원)</th><th>평가금액(억원)</th><th></th></tr></thead><tbody>
    ${cs.length?cs.map(c=>{
      const r=lastReturn(c.id);
      const stale=!r||((new Date(t)-new Date(r.base_date))>1000*60*60*24*30);
      return `<tr class="${stale?"due":""}">
        <td><b>${esc(c.name)}</b></td><td>${esc(c.manager||"-")}</td><td>${fmt(c.aum)}</td>
        <td>${r?r.base_date:"-"}</td><td>${r?amtHtml(r.rate):"-"}</td><td>${r?fmt(r.value):"-"}</td>
        <td><button class="btn btn-p btn-sm" onclick="openReturnModal('${c.id}')">입력/이력</button></td>
      </tr>`}).join(""):'<tr><td colspan="7"><div class="empty">고객을 먼저 등록하세요</div></td></tr>'}
    </tbody></table>
  </div>
  <p class="mini" style="margin-top:8px">※ 최근 입력일이 30일을 초과한 고객은 행이 강조 표시됩니다.</p>`;
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
    <table><thead><tr><th>기준일</th><th>수익(억원)</th><th>평가금액</th><th>메모</th><th></th></tr></thead><tbody>
    ${rows.map(r=>`<tr><td>${r.base_date}</td><td>${amtHtml(r.rate)}</td><td>${fmt(r.value)}</td><td class="mini">${esc(r.memo||"")}</td>
    <td><button class="btn btn-d btn-sm" onclick="delReturn('${r.id}','${cid}')">삭제</button></td></tr>`).join("")}
    </tbody></table>`:'<div class="empty">입력된 이력이 없습니다</div>';
}
async function saveReturn(){
  const cid=$("r_clientId").value;
  const base_date=$("r_date").value, rate=$("r_rate").value;
  if(!base_date||rate===""){alert("기준일과 수익을 입력하세요.");return}
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
  const list=clients.filter(c=>(c.categories||[]).includes("랩"))
    .sort((a,b)=>((a.wrap&&a.wrap.date)||"9999-99-99").localeCompare((b.wrap&&b.wrap.date)||"9999-99-99"));
  const t=today();
  const wAmt=list.reduce((x,c)=>x+Number((c.wrap&&c.wrap.amount)||0),0);
  const wVal=list.reduce((x,c)=>x+Number((c.wrap&&c.wrap.curValue)||0),0);
  $("tab-wrap").innerHTML=`
  <div class="toolbar">
    <span class="mini">랩정보 버튼으로 계약·평가 정보를, 편입종목 버튼으로 포트폴리오를 관리하세요.</span>
    <div style="flex:1"></div>
    <button class="btn btn-p" onclick="openClientModal(null,true)">+ 랩고객 등록</button>
  </div>
  <div class="panel" style="padding:0;overflow-x:auto">
    <table><thead><tr><th>고객명</th><th>담당자</th><th>계약일</th><th>계약금액(억원)</th><th>현재평가액(억원)</th><th>수익률</th><th>편입종목</th><th></th></tr></thead><tbody>
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
        <button class="btn btn-s btn-sm" onclick="openReturnModal('${c.id}')">수익이력</button>
        <button class="btn btn-d btn-sm" onclick="delClient('${c.id}')">삭제</button>
      </td></tr>`}).join("")
      +`<tr style="background:#f8f9fb;font-weight:700"><td>합계 (${list.length}건)</td><td></td><td></td><td>${fmt(wAmt)}</td><td>${fmt(wVal)}</td><td>${wAmt>0?rateHtml((wVal/wAmt-1)*100):"-"}</td><td></td><td></td></tr>`
      :'<tr><td colspan="8"><div class="empty">아직 랩고객이 없습니다. \'+ 랩고객 등록\' 버튼으로 시작하세요.<br>(기존 고객은 고객관리에서 수정 → 유형에 \'랩\' 체크)</div></td></tr>'}
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
    <table><thead><tr><th>종목명</th><th>코드</th><th>비중(%)</th><th>평가금액(억원)</th><th>수익률</th><th>메모</th><th></th></tr></thead><tbody>
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

/* ---------- 펀드 관리 ---------- */
function fundRate(f){
  if(!f||!f.amount||f.cur_value==null)return null;
  const a=Number(f.amount),v=Number(f.cur_value);
  if(!a||isNaN(a)||isNaN(v))return null;
  return (v/a-1)*100;
}
function renderFunds(){
  const t=today();
  const soon=new Date();soon.setDate(soon.getDate()+30);const soonStr=soon.toISOString().slice(0,10);
  const list=funds.slice().sort((a,b)=>((a.join_date)||"9999-99-99").localeCompare((b.join_date)||"9999-99-99"));
  const aSum=list.reduce((x,f)=>x+Number(f.amount||0),0);
  const vSum=list.reduce((x,f)=>x+Number(f.cur_value||0),0);
  $("tab-funds").innerHTML=`
  <div class="toolbar">
    <span class="mini">만기 30일 이내인 펀드는 강조 표시됩니다. 수익률 = 평가액 ÷ 매입금액 − 1 자동 계산.</span>
    <div style="flex:1"></div>
    <button class="btn btn-p" onclick="openFundModal()">+ 펀드 등록</button>
  </div>
  <div class="panel" style="padding:0;overflow-x:auto">
    <table><thead><tr><th>고객명</th><th>담당자</th><th>펀드명</th><th>가입일</th><th>만기</th><th>매입금액(억원)</th><th>평가액(억원)</th><th>수익률</th><th></th></tr></thead><tbody>
    ${list.length?list.map(f=>{
      const r=fundRate(f);
      const due=f.maturity&&f.maturity>=t&&f.maturity<=soonStr;
      const passed=f.maturity&&f.maturity<t;
      return `<tr class="${due?"due":""}">
      <td><b>${esc(f.client_name)}</b>${f.memo?`<div class="mini">${esc(f.memo).slice(0,30)}</div>`:""}</td>
      <td>${esc(f.manager||"-")}</td>
      <td>${esc(f.fund_name||"-")}</td>
      <td>${f.join_date||"-"}</td>
      <td>${f.maturity||"-"} ${due?'<span class="due-badge">만기임박</span>':""}${passed?'<span class="due-badge">만기경과</span>':""}</td>
      <td>${fmt(f.amount)}</td>
      <td>${fmt(f.cur_value)}</td>
      <td>${r!=null?rateHtml(r):'<span class="mini">-</span>'}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-s btn-sm" onclick="openFundModal('${f.id}')">수정</button>
        <button class="btn btn-d btn-sm" onclick="delFund('${f.id}')">삭제</button>
      </td></tr>`}).join("")
      +`<tr style="background:#f8f9fb;font-weight:700"><td>합계 (${list.length}건)</td><td></td><td></td><td></td><td></td><td>${fmt(aSum)}</td><td>${fmt(vSum)}</td><td>${aSum>0?rateHtml((vSum/aSum-1)*100):"-"}</td><td></td></tr>`
      :'<tr><td colspan="9"><div class="empty">등록된 펀드가 없습니다. \'+ 펀드 등록\' 버튼으로 시작하세요.</div></td></tr>'}
    </tbody></table>
  </div>`;
}
function openFundModal(id){
  const f=id?funds.find(x=>x.id===id):null;
  $("fundModalTitle").textContent=f?"펀드 수정":"펀드 등록";
  $("fd_id").value=f?f.id:"";
  $("fd_client").value=f?f.client_name:"";
  $("fd_manager").innerHTML=mgrOptions(f?(f.manager||me.name):me.name);
  $("fd_name").value=f?(f.fund_name||""):"";
  $("fd_join").value=f?(f.join_date||""):"";
  $("fd_maturity").value=f?(f.maturity||""):"";
  $("fd_amount").value=f?(f.amount??""):"";
  $("fd_value").value=f?(f.cur_value??""):"";
  $("fd_memo").value=f?(f.memo||""):"";
  calcFundRate();
  $("fundModal").classList.add("open");
}
function calcFundRate(){
  const r=fundRate({amount:$("fd_amount").value,cur_value:$("fd_value").value===""?null:$("fd_value").value});
  $("fd_rateView").innerHTML=r==null?'<span class="mini" style="font-weight:400">매입금액과 평가액을 입력하면 자동 계산됩니다</span>':rateHtml(r);
}
async function saveFund(){
  const client_name=$("fd_client").value.trim();
  const fund_name=$("fd_name").value.trim();
  if(!client_name){alert("고객명을 입력하세요.");return}
  if(!fund_name){alert("펀드명을 입력하세요.");return}
  const id=$("fd_id").value;
  const row={
    client_name, fund_name,
    manager:$("fd_manager").value,
    join_date:$("fd_join").value||null,
    maturity:$("fd_maturity").value||null,
    amount:$("fd_amount").value===""?null:Number($("fd_amount").value),
    cur_value:$("fd_value").value===""?null:Number($("fd_value").value),
    memo:$("fd_memo").value.trim()||null
  };
  const q = id ? db.from("funds").update(row).eq("id",id) : db.from("funds").insert(row);
  const {error}=await q;
  if(error){err(error);return}
  closeModal("fundModal");
  await loadAll();
  showTab("funds");
}
async function delFund(id){
  const f=funds.find(x=>x.id===id);
  if(!confirm(`'${f.client_name}'님의 '${f.fund_name||"펀드"}'를 삭제할까요?`))return;
  const {error}=await db.from("funds").delete().eq("id",id);
  if(error){err(error);return}
  await loadAll();
  showTab("funds");
}

/* ---------- 잠재고객 ---------- */
function renderProspects(){
  const t=today();
  const list=prospects.filter(p=>{
    if(pFilters.cat && !(p.interests||[]).includes(pFilters.cat))return false;
    if(pFilters.manager && p.manager!==pFilters.manager)return false;
    return true;
  }).sort((a,b)=>{
    const na=nextContact(a)||"0000",nb=nextContact(b)||"0000";
    return na.localeCompare(nb);
  });
  $("tab-prospects").innerHTML=`
  <div class="toolbar">
    <span class="mini">접촉 예정일이 지난 고객은 강조 표시됩니다.</span>
    <select onchange="pFilters.manager=this.value;renderProspects()" style="padding:7px 10px;border:1px solid var(--line);border-radius:6px;font-size:13px;background:#fff"><option value="">담당자 전체</option>${managers.map(m=>`<option ${pFilters.manager===m?"selected":""}>${esc(m)}</option>`).join("")}</select>
    <select onchange="pFilters.cat=this.value;renderProspects()" style="padding:7px 10px;border:1px solid var(--line);border-radius:6px;font-size:13px;background:#fff"><option value="">유형 전체</option>${CATS.map(c=>`<option ${pFilters.cat===c?"selected":""}>${c}</option>`).join("")}</select>
    <div style="flex:1"></div>
    <button class="btn btn-s" onclick="openMsgModal()">✉ 메시지 보내기</button>
    <button class="btn btn-p" onclick="openProspectModal()">+ 잠재고객 등록</button>
  </div>
  <div class="panel" style="padding:0;overflow-x:auto">
    <table><thead><tr><th>이름</th><th>회사명</th><th>연락처</th><th>이메일</th><th>담당자</th><th>예상자산(억원)</th><th>관심유형</th><th>주기</th><th>최근접촉</th><th>다음접촉</th><th></th></tr></thead><tbody>
    ${list.length?list.map(p=>{
      const nc=nextContact(p);
      const due=!p.last_contact||(nc&&nc<=t);
      const cyc={7:"주간",30:"월간",90:"분기"}[p.cycle]||"월간";
      return `<tr class="${due?"due":""}">
        <td><b>${esc(p.name)}</b>${p.source?`<div class="mini">${esc(p.source)}</div>`:""}</td>
        <td style="white-space:nowrap">${esc(p.company||"-")}</td>
        <td>${esc(p.phone||"-")}</td><td>${esc(p.email||"-")}</td>
        <td>${esc(p.manager||"-")}</td><td>${fmt(p.expected_asset)}</td>
        <td>${(p.interests||[]).map(catTag).join("")||"-"}</td>
        <td>${cyc}</td><td>${p.last_contact||"-"}</td><td>${nc||"-"}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-s btn-sm" onclick="openMsgModal('${p.id}')">메시지</button>
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
  $("p_company").value=p?(p.company||""):"";
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
    company:$("p_company").value.trim()||null,
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
    memo:(p.company?"회사: "+p.company+" / ":"")+(p.memo?p.memo+" / ":"")+"잠재고객 전환("+today()+")"
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
    <table><thead><tr><th>고객명</th><th>구분</th><th>중요도</th><th>패밀리</th><th>담당자</th><th>자산(억원)</th><th>유형</th></tr></thead><tbody>
    ${sample.map(r=>`<tr>
      <td>${r.name?`<b>${esc(r.name)}</b>`:'<span style="color:#c0392b">비어있음!</span>'}</td>
      <td>${r.type}</td><td>${esc(r.family||"-")}</td><td>${esc(r.manager)}</td>
      <td>${fmt(r.aum)}</td><td>${r.categories.map(catTag).join("")||"-"}</td>
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

/* ---------- ELS 관리 ---------- */
function renderEls(){
  const t=today();
  const soon=new Date();soon.setDate(soon.getDate()+30);const soonStr=soon.toISOString().slice(0,10);
  const list=elsList.slice().sort((a,b)=>((a.join_date)||"9999-99-99").localeCompare((b.join_date)||"9999-99-99"));
  const aSum=list.reduce((x,f)=>x+Number(f.amount||0),0);
  $("tab-els").innerHTML=`
  <div class="toolbar">
    <span class="mini">만기 30일 이내인 건은 강조 표시됩니다.</span>
    <div style="flex:1"></div>
    <button class="btn btn-p" onclick="openElsModal()">+ ELS 등록</button>
  </div>
  <div class="panel" style="padding:0;overflow-x:auto">
    <table><thead><tr><th>가입고객</th><th>가입일</th><th>금액(억원)</th><th>만기일</th><th>내용</th><th></th></tr></thead><tbody>
    ${list.length?list.map(x=>{
      const due=x.maturity&&x.maturity>=t&&x.maturity<=soonStr;
      const passed=x.maturity&&x.maturity<t;
      return `<tr class="${due?"due":""}">
      <td><b>${esc(x.client_name)}</b></td>
      <td>${x.join_date||"-"}</td>
      <td>${fmt(x.amount)}</td>
      <td>${x.maturity||"-"} ${due?'<span class="due-badge">만기임박</span>':""}${passed?'<span class="due-badge">만기경과</span>':""}</td>
      <td style="white-space:pre-wrap;max-width:420px" class="mini">${esc(x.content||"-")}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-s btn-sm" onclick="openElsModal('${x.id}')">수정</button>
        <button class="btn btn-d btn-sm" onclick="delEls('${x.id}')">삭제</button>
      </td></tr>`}).join("")
      +`<tr style="background:#f8f9fb;font-weight:700"><td>합계 (${list.length}건)</td><td></td><td>${fmt(aSum)}</td><td colspan="3"></td></tr>`
      :'<tr><td colspan="6"><div class="empty">등록된 ELS가 없습니다. \'+ ELS 등록\' 버튼으로 시작하세요.</div></td></tr>'}
    </tbody></table>
  </div>`;
}
function openElsModal(id){
  const x=id?elsList.find(v=>v.id===id):null;
  $("elsModalTitle").textContent=x?"ELS 수정":"ELS 등록";
  $("e_id").value=x?x.id:"";
  $("e_client").value=x?x.client_name:"";
  $("e_join").value=x?(x.join_date||""):"";
  $("e_amount").value=x?(x.amount??""):"";
  $("e_maturity").value=x?(x.maturity||""):"";
  $("e_content").value=x?(x.content||""):"";
  $("elsModal").classList.add("open");
}
async function saveEls(){
  const client_name=$("e_client").value.trim();
  if(!client_name){alert("가입고객을 입력하세요.");return}
  const id=$("e_id").value;
  const row={
    client_name,
    join_date:$("e_join").value||null,
    amount:$("e_amount").value===""?null:Number($("e_amount").value),
    maturity:$("e_maturity").value||null,
    content:$("e_content").value.trim()||null
  };
  const q = id ? db.from("els").update(row).eq("id",id) : db.from("els").insert(row);
  const {error}=await q;
  if(error){err(error);return}
  closeModal("elsModal");
  await loadAll();
  showTab("els");
}
async function delEls(id){
  const x=elsList.find(v=>v.id===id);if(!x)return;
  if(!confirm(`'${x.client_name}'님의 ELS를 삭제할까요?`))return;
  const {error}=await db.from("els").delete().eq("id",id);
  if(error){err(error);return}
  await loadAll();
  showTab("els");
}

/* ---------- 자료실 ---------- */
function fmtSize(b){if(b==null)return"";if(b>1048576)return(b/1048576).toFixed(1)+" MB";if(b>1024)return(b/1024).toFixed(0)+" KB";return b+" B"}
function renderDocs(){
  const list=docs.slice().sort((a,b)=>(b.created_at||"").localeCompare(a.created_at||""));
  $("tab-docs").innerHTML=`
  <div class="panel">
    <h2>자료 올리기</h2>
    <div class="frow" style="grid-template-columns:1fr 1fr;gap:8px;align-items:end">
      <div class="fg"><label>제목 *</label><input id="doc_title" placeholder="예: 2026년 하반기 시장 전망"></div>
      <div class="fg"><label>파일 (선택 — PPT, PDF, Excel, Word, 이미지 등)</label><input id="doc_file" type="file"></div>
    </div>
    <div class="frow full" style="margin-bottom:8px">
      <div class="fg"><label>관심고객 (여러 줄 입력 가능)</label>
        <textarea id="doc_interest" style="min-height:90px" placeholder="이 자료를 안내할 고객들을 자유롭게 적어주세요&#10;예: 홍성천(파인테크), 김영재 — 8월 미팅 시 전달"></textarea>
      </div>
    </div>
    <button class="btn btn-p" id="doc_upBtn" onclick="uploadDoc()">업로드</button>
    <p class="mini" id="doc_msg" style="margin-top:8px"></p>
  </div>
  <div class="panel" style="padding:0;overflow-x:auto">
    <table><thead><tr><th>제목</th><th>파일명</th><th>관심고객</th><th>등록일</th><th></th></tr></thead><tbody>
    ${list.length?list.map(d=>`<tr>
      <td><b>${esc(d.title)}</b></td>
      <td class="mini">${esc(d.file_name||"-")}</td>
      <td style="white-space:pre-wrap;max-width:340px">${esc(d.interest_clients||"-")}</td>
      <td class="mini">${(d.created_at||"").slice(0,10)}</td>
      <td style="white-space:nowrap">
        ${d.file_path?`<button class="btn btn-p btn-sm" onclick="downloadDoc('${d.id}')">열기/다운로드</button>`:""}
        <button class="btn btn-s btn-sm" onclick="openDocEdit('${d.id}')">수정</button>
        <button class="btn btn-d btn-sm" onclick="delDoc('${d.id}')">삭제</button>
      </td></tr>`).join(""):'<tr><td colspan="5"><div class="empty">등록된 자료가 없습니다. 위에서 첫 자료를 올려보세요.</div></td></tr>'}
    </tbody></table>
  </div>`;
}
async function uploadDoc(){
  const title=$("doc_title").value.trim();
  const fileInput=$("doc_file");
  const file=fileInput.files[0];
  if(!title){alert("제목을 입력하세요.");return}
  if(file && file.size>50*1024*1024){alert("파일이 50MB를 넘습니다. 더 작은 파일로 올려주세요.");return}
  const btn=$("doc_upBtn"); btn.disabled=true; btn.textContent="업로드 중...";
  $("doc_msg").textContent=file?"파일을 올리는 중입니다... ("+fmtSize(file.size)+")":"등록 중입니다...";
  try{
    let path=null, fname=null;
    if(file){
      const ext=(file.name.split(".").pop()||"bin").toLowerCase().replace(/[^a-z0-9]/g,"")||"bin";
      path=Date.now()+"_"+Math.random().toString(36).slice(2,8)+"."+ext;
      const {error:upErr}=await db.storage.from("docs").upload(path,file);
      if(upErr)throw upErr;
      fname=file.name;
    }
    const {error:insErr}=await db.from("documents").insert({
      title, file_name:fname, file_path:path, uploaded_by:me.name,
      interest_clients:$("doc_interest")?$("doc_interest").value.trim()||null:null
    });
    if(insErr)throw insErr;
    $("doc_title").value=""; fileInput.value="";
    await loadAll();
    showTab("docs");
    $("doc_msg").textContent="업로드 완료 ✓";
  }catch(e){
    alert("업로드 실패: "+(e.message||e));
    $("doc_msg").textContent="";
  }
  btn.disabled=false; btn.textContent="업로드";
}
function openDocEdit(id){
  const d=docs.find(x=>x.id===id);if(!d)return;
  $("de_id").value=id;
  $("de_title").value=d.title||"";
  $("de_interest").value=d.interest_clients||"";
  $("docEditModal").classList.add("open");
}
async function saveDocEdit(){
  const id=$("de_id").value;
  const title=$("de_title").value.trim();
  if(!title){alert("제목을 입력하세요.");return}
  const {error}=await db.from("documents").update({
    title, interest_clients:$("de_interest").value.trim()||null
  }).eq("id",id);
  if(error){err(error);return}
  closeModal("docEditModal");
  await loadAll();
  showTab("docs");
}
async function downloadDoc(id){
  const d=docs.find(x=>x.id===id);if(!d||!d.file_path)return;
  const {data,error}=await db.storage.from("docs").createSignedUrl(d.file_path,3600);
  if(error){err(error);return}
  window.open(data.signedUrl,"_blank");
}
async function delDoc(id){
  const d=docs.find(x=>x.id===id);if(!d)return;
  if(!confirm(`'${d.title}' 자료를 삭제할까요?`))return;
  if(d.file_path) await db.storage.from("docs").remove([d.file_path]);
  const {error}=await db.from("documents").delete().eq("id",id);
  if(error){err(error);return}
  await loadAll();
  showTab("docs");
}

/* ---------- 반도체 인텔리전스 (팀 공유 보기 · 편집은 담당자만) ---------- */
const SEMI_OWNER = "서재영";   // 관심종목·브리핑을 편집할 수 있는 사용자 (팀원은 보기만)
const SEMI_CHAINS = ["메모리","파운드리·비메모리","팹리스·설계","장비","소재","부품","후공정·테스트","기타"];
let semiStocks = [], semiBriefs = [], semiReady = false, semiAnal = [], semiAnalReady = false, semiAnalId = null, semiAnalEdit = null, semiTechId = null, semiTechEdit = null;
let semiSub = "stocks", semiDate = null, semiEditId = null;
let semiF = {mkt:"", chain:"", q:"", nMkt:"국내", nChain:"", nImp:"", nStar:0, rMkt:"", rType:"", iType:""};

function semiAllowed(){return !!me}
function semiCanEdit(){return !!me && me.name===SEMI_OWNER}
async function loadSemi(){
  const btn=document.querySelector('nav button[data-tab="semi"]');
  if(btn) btn.style.display = semiAllowed()?"":"none";
  if(!semiAllowed()){$("tab-semi").innerHTML="";return}
  const [s,b,a]=await Promise.all([
    db.from("semi_stocks").select("*").order("created_at"),
    db.from("semi_briefs").select("*").order("brief_date",{ascending:false}),
    db.from("semi_analysis").select("*").order("analysis_date",{ascending:false}).order("created_at",{ascending:false}),
  ]);
  semiAnalReady = !a.error; semiAnal = a.error?[]:a.data;
  semiReady = !s.error && !b.error;
  semiStocks = s.error?[]:s.data; semiBriefs = b.error?[]:b.data;
  if(!semiBriefs.find(x=>x.brief_date===semiDate)) semiDate = semiBriefs[0]?.brief_date||null;
  renderSemi();
}
function semiFind(key){if(!key)return null;const k=String(key).trim().toLowerCase();return semiStocks.find(s=>(s.code||"").toLowerCase()===k||(s.name||"").toLowerCase()===k)}
function semiBrief(){return semiBriefs.find(b=>b.brief_date===semiDate)||{news:[],reports:[],issues:[]}}
function semiImpTag(v){v=v||"중립";const st=v==="호재"?"background:#fdeceb;color:var(--pos)":v==="악재"?"background:#e6eefb;color:var(--neg)":"background:#eef0f4;color:#5a6580";return `<span class="tag" style="${st}">${esc(v)}</span>`}
function semiStockTag(s){return `<span class="tag" style="background:var(--brass-soft);color:#7a5c1e">${esc(s.name)}</span>`}
function semiStars(n){n=Math.max(1,Math.min(3,Number(n)||1));return `<span style="color:var(--brass);letter-spacing:1px">${"★".repeat(n)}</span><span style="color:#d5d9e1;letter-spacing:1px">${"★".repeat(3-n)}</span>`}
function semiLink(x){return x.url?` · <a href="${esc(x.url)}" target="_blank" rel="noopener" style="color:#1d4ed8">원문</a>`:""}
function semiSel(id,opts,val,all){return `<select id="${id}" onchange="semiSet()">${all?`<option value="">${all}</option>`:""}${opts.map(o=>{const [v,l]=Array.isArray(o)?o:[o,o];return `<option value="${esc(v)}" ${String(v)===String(val)?"selected":""}>${esc(l)}</option>`}).join("")}</select>`}
function semiSet(){
  const g=id=>$(id)?$(id).value:undefined;
  ["mkt","chain","q","nMkt","nChain","nImp","nStar","rMkt","rType","iType"].forEach(k=>{const v=g("sf_"+k);if(v!==undefined)semiF[k]=v});
  if($("sf_date")) semiDate=$("sf_date").value||semiDate;
  renderSemi();
}
function semiGo(t){semiSub=t;renderSemi()}
function semiEmpty(t,s){return `<div class="empty"><b style="display:block;color:#5a6580;margin-bottom:4px">${t}</b>${s||""}</div>`}

function renderSemi(){
  if(!semiAllowed())return;
  const subs=[["stocks","관심종목",semiStocks.length],["news","종목 뉴스",null],["reports","리포트",null],["issues","산업 이슈",null],["analysis","종목분석",semiAnal.filter(x=>x.kind!=="tech").length||null],["tech","기술동향",semiAnal.filter(x=>x.kind==="tech").length||null]];
  let body="";
  if(!semiReady) body=`<div class="panel">${semiEmpty("데이터베이스 준비가 필요합니다","Supabase SQL Editor에서 upgrade-semi.sql 을 한 번 실행한 뒤 새로고침하세요.")}</div>`;
  else if(semiSub==="stocks") body=semiStocksHtml();
  else if(semiSub==="analysis") body=semiAnalHtml();
  else if(semiSub==="tech") body=semiTechHtml();
  else body=semiDateBar()+(semiSub==="news"?semiNewsHtml():semiSub==="reports"?semiRepHtml():semiIssHtml())+semiImportHtml();
  $("tab-semi").innerHTML=`
    <div class="subnav">${subs.map(([k,l,n])=>`<button class="${semiSub===k?"on":""}" onclick="semiGo('${k}')">${l}${n?` <span style="opacity:.6">${n}</span>`:""}</button>`).join("")}
      <span style="flex:1"></span><span class="mini">${semiCanEdit()?"👥 팀 공유 · 팀원은 보기만 가능":"👁 보기 전용 · 편집은 "+SEMI_OWNER+" 님"}</span></div>
    ${body}`;
}

/* 관심종목 관리 */
function semiStocksHtml(){
  const pr={"상":0,"중":1,"하":2};
  const q=(semiF.q||"").toLowerCase();
  const rows=semiStocks.filter(s=>(!semiF.mkt||s.market===semiF.mkt)&&(!semiF.chain||s.chain===semiF.chain)&&(!q||(s.name||"").toLowerCase().includes(q)||(s.code||"").toLowerCase().includes(q)))
    .sort((a,b)=>(a.market||"").localeCompare(b.market||"")||(pr[a.priority]??1)-(pr[b.priority]??1)||(a.name||"").localeCompare(b.name||""));
  const e=semiEditId?semiStocks.find(s=>s.id===semiEditId):null;
  const cnt=m=>semiStocks.filter(s=>s.market===m).length;
  return `
  <div class="cards">
    <div class="card"><div class="lbl">전체 종목</div><div class="val">${semiStocks.length}<small>개</small></div></div>
    <div class="card"><div class="lbl">국내</div><div class="val">${cnt("국내")}<small>개</small></div></div>
    <div class="card"><div class="lbl">해외</div><div class="val">${cnt("해외")}<small>개</small></div></div>
    <div class="card"><div class="lbl">우선순위 상</div><div class="val">${semiStocks.filter(s=>s.priority==="상").length}<small>개</small></div></div>
  </div>
  ${semiCanEdit()?`<div class="panel">
    <h2>${e?"종목 수정":"종목 추가"}</h2>
    <div class="frow" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
      <div class="fg"><label>종목명 *</label><input id="ss_name" value="${esc(e?.name||"")}" placeholder="SK하이닉스"></div>
      <div class="fg"><label>코드/티커 *</label><input id="ss_code" value="${esc(e?.code||"")}" placeholder="000660"></div>
      <div class="fg"><label>구분</label><select id="ss_mkt">${["국내","해외"].map(m=>`<option ${e?.market===m?"selected":""}>${m}</option>`).join("")}</select></div>
      <div class="fg"><label>밸류체인</label><select id="ss_chain">${SEMI_CHAINS.map(c=>`<option ${e?.chain===c?"selected":""}>${c}</option>`).join("")}</select></div>
      <div class="fg"><label>우선순위</label><select id="ss_pri">${["상","중","하"].map(p=>`<option ${(e?.priority||"중")===p?"selected":""}>${p}</option>`).join("")}</select></div>
      <div class="fg"><label>추적 키워드</label><input id="ss_kw" value="${esc(e?.keywords||"")}" placeholder="HBM, DDR5"></div>
    </div>
    <div class="msg" id="ss_msg"></div>
    <button class="btn btn-p" onclick="semiSaveStock()">${e?"수정 저장":"종목 추가"}</button>
    ${e?`<button class="btn btn-s" onclick="semiEditId=null;renderSemi()">취소</button>`:""}
    <details style="margin-top:14px">
      <summary style="cursor:pointer;font-size:13px;font-weight:600;color:var(--brass)">엑셀에서 일괄 등록</summary>
      <p class="mini" style="margin:8px 0">엑셀에서 6개 열을 이 순서로 복사해 붙여넣으세요 (한 줄에 한 종목). 같은 코드는 갱신됩니다.<br>종목명 · 코드 · 구분(국내/해외) · 밸류체인 · 키워드 · 우선순위(상/중/하)</p>
      <div class="fg"><textarea id="ss_bulk" style="min-height:120px;font-family:Consolas,monospace;font-size:12px" placeholder="SK하이닉스&#9;000660&#9;국내&#9;메모리&#9;HBM, DDR5&#9;상&#10;Micron&#9;MU&#9;해외&#9;메모리&#9;HBM&#9;상"></textarea></div>
      <div class="msg" id="ss_bmsg"></div>
      <button class="btn btn-p" style="margin-top:8px" onclick="semiBulk()">일괄 등록</button>
    </details>
  </div>`:""}
  <div class="toolbar">
    ${semiSel("sf_mkt",["국내","해외"],semiF.mkt,"구분 전체")}
    ${semiSel("sf_chain",SEMI_CHAINS,semiF.chain,"밸류체인 전체")}
    <input type="text" id="sf_q" value="${esc(semiF.q)}" placeholder="종목명·코드 검색" onkeydown="if(event.key==='Enter')semiSet()">
    <button class="btn btn-s" onclick="semiSet()">검색</button>
    <span style="flex:1"></span>
    <button class="btn btn-s btn-sm" onclick="semiCopyList()">종목 리스트 복사</button>
  </div>
  <div class="panel" style="padding:0;overflow-x:auto">
    <table><thead><tr><th>종목</th><th>코드</th><th>구분</th><th>밸류체인</th><th>키워드</th><th>우선</th><th></th></tr></thead><tbody>
    ${rows.length?rows.map(s=>`<tr>
      <td><b>${esc(s.name)}</b></td><td class="mini">${esc(s.code)}</td><td>${esc(s.market)}</td>
      <td><span class="tag" style="background:#eef0f4;color:#475569">${esc(s.chain)}</span></td>
      <td class="mini">${esc(s.keywords||"")}</td>
      <td>${s.priority==="상"?`<span class="grade g-VIP">상</span>`:`<span class="grade g-B">${esc(s.priority||"중")}</span>`}</td>
      <td style="white-space:nowrap">${semiCanEdit()?`<button class="btn btn-s btn-sm" onclick="semiEditId='${s.id}';renderSemi();window.scrollTo({top:0,behavior:'smooth'})">수정</button>
        <button class="btn btn-d btn-sm" onclick="semiDelStock('${s.id}')">삭제</button>`:""}</td></tr>`).join("")
      :`<tr><td colspan="7">${semiEmpty(semiStocks.length?"조건에 맞는 종목이 없습니다":"관심종목을 등록해 주세요",semiStocks.length?"":"위 입력란이나 엑셀 일괄 등록을 사용하세요")}</td></tr>`}
    </tbody></table>
  </div>`;
}
function semiNormMkt(v){return /해외|us|global|overseas|미국|일본|대만/i.test(v||"")?"해외":"국내"}
function semiNormChain(v){v=(v||"").replace(/[\s·\/]/g,"");if(!v)return "기타";return SEMI_CHAINS.find(c=>c.replace(/·/g,"").includes(v)||v.includes(c.split("·")[0]))||"기타"}
function semiNormPri(v){v=(v||"").trim();return ["상","중","하"].includes(v)?v:"중"}
async function semiSaveStock(){
  const row={name:$("ss_name").value.trim(),code:$("ss_code").value.trim(),market:$("ss_mkt").value,chain:$("ss_chain").value,priority:$("ss_pri").value,keywords:$("ss_kw").value.trim()||null};
  if(!row.name||!row.code){showMsg("ss_msg","종목명과 코드를 입력하세요.");return}
  const dup=semiStocks.find(s=>s.code.toLowerCase()===row.code.toLowerCase()&&s.id!==semiEditId);
  if(dup){showMsg("ss_msg",`이미 등록된 코드입니다 (${dup.name}).`);return}
  const {error}=semiEditId?await db.from("semi_stocks").update(row).eq("id",semiEditId):await db.from("semi_stocks").insert({...row,owner:me.id});
  if(error){err(error);return}
  semiEditId=null; await loadSemi();
}
async function semiBulk(){
  const lines=$("ss_bulk").value.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  if(!lines.length){showMsg("ss_bmsg","붙여넣은 내용이 없습니다.");return}
  const map=new Map();let skip=0;
  lines.forEach(l=>{const c=l.split(/\t|,(?![^"]*")/).map(x=>x.replace(/^"|"$/g,"").trim());
    if(c.length<2||!c[0]||!c[1]||/종목명/.test(c[0])){skip++;return}
    map.set(c[1].toLowerCase(),{owner:me.id,name:c[0],code:c[1],market:semiNormMkt(c[2]),chain:semiNormChain(c[3]),keywords:c[4]||null,priority:semiNormPri(c[5])})});
  const rows=[...map.values()];
  if(!rows.length){showMsg("ss_bmsg","인식된 종목이 없습니다. 열 순서를 확인하세요.");return}
  const upd=rows.filter(r=>semiFind(r.code)).length;
  const {error}=await db.from("semi_stocks").upsert(rows,{onConflict:"owner,code"});
  if(error){err(error);return}
  await loadSemi();
  $("ss_bulk").closest("details").open=true;
  showMsg("ss_bmsg",`추가 ${rows.length-upd} · 갱신 ${upd}${skip?` · 건너뜀 ${skip}`:""}`,true);
}
async function semiDelStock(id){
  const s=semiStocks.find(x=>x.id===id);if(!s)return;
  if(!confirm(`'${s.name}' 종목을 관심종목에서 삭제할까요?`))return;
  const {error}=await db.from("semi_stocks").delete().eq("id",id);
  if(error){err(error);return}
  await loadSemi();
}
async function semiCopyList(){
  const t=semiStocks.map(s=>[s.name,s.code,s.market,s.chain,s.keywords||"",s.priority].join("\t")).join("\n");
  try{await navigator.clipboard.writeText(t);alert(`${semiStocks.length}개 종목을 복사했습니다.`)}catch(e){alert("복사가 차단되었습니다.")}
}

/* 공통: 일자 선택 / 데이터 불러오기 */
function semiDateBar(){
  const b=semiBrief();
  return `<div class="toolbar"><span class="mini">브리핑 일자</span>
    <select id="sf_date" onchange="semiSet()">${semiBriefs.length?semiBriefs.map(x=>`<option ${x.brief_date===semiDate?"selected":""}>${x.brief_date}</option>`).join(""):"<option>데이터 없음</option>"}</select>
    ${b.generated_at?`<span class="mini">생성 ${esc(b.generated_at)}</span>`:""}</div>`;
}
function semiGuard(){
  if(!semiStocks.length) return semiEmpty("관심종목이 없습니다",(semiCanEdit()?"관심종목 메뉴에서 종목을 먼저 등록하세요.":"담당자가 관심종목을 등록하면 표시됩니다."));
  if(!semiDate) return semiEmpty("아직 브리핑이 없습니다",(semiCanEdit()?"아래 '일일 브리핑 데이터 불러오기'로 데이터를 넣으면 표시됩니다.":"매일 아침 브리핑이 올라오면 표시됩니다."));
  return null;
}
function semiImportHtml(){
  if(!semiCanEdit()) return "";
  return `<details class="panel" style="margin-top:18px">
    <summary style="cursor:pointer;font-size:13px;font-weight:600;color:var(--brass)">일일 브리핑 데이터 불러오기</summary>
    <p class="mini" style="margin:8px 0">매일 생성되는 브리핑 데이터(JSON)를 붙여넣으세요. 같은 일자는 덮어씁니다.</p>
    <div class="fg"><textarea id="sb_json" style="min-height:120px;font-family:Consolas,monospace;font-size:12px" placeholder='{"date":"2026-11-18","news":[...],"reports":[...],"issues":[...]}'></textarea></div>
    <div class="msg" id="sb_msg"></div>
    <button class="btn btn-p" style="margin-top:8px" onclick="semiImport()">불러오기</button>
    ${semiDate?`<button class="btn btn-d" style="margin-top:8px" onclick="semiDelBrief()">${esc(semiDate)} 브리핑 삭제</button>`:""}
  </details>`;
}
async function semiImport(){
  let arr;
  try{const d=JSON.parse($("sb_json").value);arr=Array.isArray(d)?d:[d];if(arr.some(b=>!/^\d{4}-\d{2}-\d{2}$/.test(b.date||"")))throw new Error("date(YYYY-MM-DD) 항목이 없습니다")}
  catch(e){showMsg("sb_msg","형식 오류: "+e.message);return}
  const rows=arr.map(b=>({owner:me.id,brief_date:b.date,news:b.news||[],reports:b.reports||[],issues:b.issues||[],generated_at:b.generated||null}));
  const {error}=await db.from("semi_briefs").upsert(rows,{onConflict:"owner,brief_date"});
  if(error){err(error);return}
  semiDate=rows[rows.length-1].brief_date;
  await loadSemi();
  $("sb_json").closest("details").open=true;
  showMsg("sb_msg",`${rows.length}일치 불러왔습니다.`,true);
}
async function semiDelBrief(){
  if(!confirm(`${semiDate} 브리핑을 삭제할까요?`))return;
  const {error}=await db.from("semi_briefs").delete().eq("brief_date",semiDate).eq("owner",me.id);
  if(error){err(error);return}
  semiDate=null; await loadSemi();
}

/* 종목 뉴스 */
function semiNewsHtml(){
  const g=semiGuard();
  const all=(semiBrief().news||[]).map(n=>({...n,st:semiFind(n.code||n.name)})).filter(n=>n.st);
  const f=all.filter(n=>n.st.market===semiF.nMkt&&(!semiF.nChain||n.st.chain===semiF.nChain)&&(!semiF.nImp||(n.impact||"중립")===semiF.nImp)&&(Number(n.importance)||1)>=Number(semiF.nStar||0));
  let list="";
  if(g) list=g;
  else if(!f.length) list=semiEmpty("해당 조건의 뉴스가 없습니다","필터를 바꿔보세요.");
  else SEMI_CHAINS.forEach(c=>{const gr=f.filter(n=>n.st.chain===c).sort((a,b)=>(b.importance||1)-(a.importance||1));if(!gr.length)return;
    list+=`<div class="panel"><h2>${c} <span class="mini" style="font-weight:500">${gr.length}건</span></h2>`+gr.map(n=>`
      <div style="padding:12px 0;border-top:1px solid #eef0f4">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${semiStockTag(n.st)}${semiImpTag(n.impact)}${semiStars(n.importance)}</div>
        <div style="font-size:14px;font-weight:700;margin:6px 0 4px">${esc(n.title)}</div>
        <div style="font-size:13px;color:var(--ink-soft);line-height:1.6">${esc(n.summary||"")}</div>
        <div class="mini" style="margin-top:6px">${esc(n.source||"")}${n.time?" · "+esc(n.time):""}${semiLink(n)}</div>
      </div>`).join("")+`</div>`});
  return `<div class="toolbar">
    ${semiSel("sf_nMkt",["국내","해외"],semiF.nMkt)}
    ${semiSel("sf_nChain",SEMI_CHAINS,semiF.nChain,"밸류체인 전체")}
    ${semiSel("sf_nImp",["호재","악재","중립"],semiF.nImp,"영향 전체")}
    ${semiSel("sf_nStar",[["3","★★★만"],["2","★★ 이상"]],semiF.nStar,"중요도 전체")}
  </div>${list}`;
}

/* 애널리스트 리포트 */
function semiChg(a,b){if(a==null||b==null||a===""||b==="")return "keep";return Number(b)>Number(a)?"up":Number(b)<Number(a)?"down":"keep"}
function semiPx(v,usd){if(v==null||v==="")return "-";const n=Number(v);return isNaN(n)?esc(v):(usd?"$":"")+n.toLocaleString("ko-KR",{maximumFractionDigits:2})}
function semiRepHtml(){
  const g=semiGuard();
  const all=(semiBrief().reports||[]).map(r=>({...r,st:semiFind(r.code||r.name)})).filter(r=>r.st);
  const f=all.filter(r=>(!semiF.rMkt||r.st.market===semiF.rMkt)&&(!semiF.rType||semiChg(r.tp_prev,r.tp_new)===semiF.rType));
  const tb=g?`<div class="panel">${g}</div>`:!f.length?`<div class="panel">${semiEmpty("해당 조건의 리포트가 없습니다","필터를 바꿔보세요.")}</div>`:
  `<div class="panel" style="padding:0;overflow-x:auto"><table><thead><tr><th>종목</th><th>기관</th><th>투자의견</th><th>목표가</th><th>현재가 대비</th><th>핵심 논리</th></tr></thead><tbody>
  ${f.map(r=>{const c=semiChg(r.tp_prev,r.tp_new);const usd=(r.currency||(r.st.market==="해외"?"USD":"KRW"))==="USD";
    const pct=r.tp_prev&&r.tp_new&&c!=="keep"?((r.tp_new/r.tp_prev-1)*100):null;
    const gap=r.tp_new&&r.price?((r.tp_new/r.price-1)*100):null;
    return `<tr><td>${semiStockTag(r.st)}</td><td class="mini">${esc(r.broker||"-")}</td>
    <td>${r.rating_prev&&r.rating_prev!==r.rating_new?esc(r.rating_prev)+" → ":""}<b>${esc(r.rating_new||"-")}</b></td>
    <td style="white-space:nowrap">${r.tp_prev&&c!=="keep"?semiPx(r.tp_prev,usd)+" → ":""}<b class="${c==="up"?"pos":c==="down"?"neg":""}">${semiPx(r.tp_new,usd)}</b>${pct!=null?` <span class="mini">(${pct>0?"+":""}${pct.toFixed(1)}%)</span>`:""}</td>
    <td>${gap==null?"-":`<span class="${gap>=0?"pos":"neg"}">${gap>=0?"+":""}${gap.toFixed(1)}%</span>`}</td>
    <td style="min-width:220px;font-size:12px;color:var(--ink-soft)">${esc(r.thesis||"")}<div class="mini">${esc(r.source||"")}${semiLink(r)}</div></td></tr>`}).join("")}
  </tbody></table></div>`;
  return `<div class="toolbar">
    ${semiSel("sf_rMkt",["국내","해외"],semiF.rMkt,"구분 전체")}
    ${semiSel("sf_rType",[["up","목표가 상향"],["down","목표가 하향"],["keep","유지·신규"]],semiF.rType,"변경 전체")}
  </div>${tb}`;
}

/* 산업·공급망 이슈 */
function semiIssHtml(){
  const g=semiGuard();
  const types=["AI·HBM 수요","빅테크 CapEx","규제·관세·정책","업황·가격","공급망"];
  const all=(semiBrief().issues||[]).map(x=>({...x,rel:(x.related||[]).map(k=>({k,s:semiFind(k)}))})).filter(x=>x.rel.some(r=>r.s));
  const f=all.filter(x=>!semiF.iType||x.type===semiF.iType);
  const list=g?`<div class="panel">${g}</div>`:!f.length?`<div class="panel">${semiEmpty("내 종목과 관련된 이슈가 없습니다","필터를 바꾸거나 다른 일자를 선택하세요.")}</div>`:
    f.map(x=>`<div class="panel">
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><span class="tag" style="background:var(--ink);color:#fff">${esc(x.type||"이슈")}</span>${semiImpTag(x.impact)}</div>
      <div style="font-size:15px;font-weight:700;margin:8px 0 4px">${esc(x.title)}</div>
      <div style="font-size:13px;color:var(--ink-soft);line-height:1.6">${esc(x.summary||"")}</div>
      <div style="margin-top:8px">${x.rel.map(r=>r.s?semiStockTag(r.s):`<span class="tag" style="background:#f4f5f7;color:#98a1b3">${esc(r.k)}</span>`).join("")}</div>
      <div class="mini" style="margin-top:6px">${esc(x.source||"")}${semiLink(x)}</div></div>`).join("");
  return `<div class="toolbar">${semiSel("sf_iType",types,semiF.iType,"이슈 유형 전체")}</div>${list}`;
}

/* 종목분석 (상세 분석·리포트 요약) */
function semiMd(t){
  const lines=(t||"").replace(/\r/g,"").split("\n"); let h="",list=false,tbl=[];
  const inl=x=>esc(x).replace(/\*\*(.+?)\*\*/g,"<b>$1</b>");
  const flushT=()=>{if(!tbl.length)return;const rows=tbl.filter(r=>!/^\|\s*:?-{2,}/.test(r)).map(r=>r.replace(/^\||\|$/g,"").split("|").map(c=>c.trim()));
    h+=`<div style="overflow-x:auto;margin:8px 0"><table><thead><tr>${rows[0].map(c=>`<th>${inl(c)}</th>`).join("")}</tr></thead><tbody>${rows.slice(1).map(r=>`<tr>${r.map(c=>`<td>${inl(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;tbl=[]};
  const endL=()=>{if(list){h+="</ul>";list=false}};
  for(const raw of lines){const l=raw.trimEnd();
    if(/^\|/.test(l.trim())){endL();tbl.push(l.trim());continue} flushT();
    if(/^###\s/.test(l)){endL();h+=`<div style="font-size:14px;font-weight:700;margin:14px 0 6px">${inl(l.slice(4))}</div>`}
    else if(/^##\s/.test(l)){endL();h+=`<div style="font-size:15px;font-weight:800;margin:18px 0 8px;padding-left:8px;border-left:3px solid var(--brass)">${inl(l.slice(3))}</div>`}
    else if(/^\s*[-•]\s/.test(l)){if(!list){h+=`<ul style="margin:4px 0 8px 18px;line-height:1.7">`;list=true}h+=`<li>${inl(l.replace(/^\s*[-•]\s/,""))}</li>`}
    else if(!l.trim()){endL()}
    else{endL();h+=`<p style="margin:6px 0;line-height:1.7">${inl(l)}</p>`}}
  endL();flushT();return h;
}
function semiAnalHtml(){
  if(!semiAnalReady) return `<div class="panel">${semiEmpty("종목분석 데이터베이스 준비가 필요합니다","Supabase SQL Editor에서 upgrade-semi-analysis.sql 을 한 번 실행한 뒤 새로고침하세요.")}</div>`;
  const cur=semiAnalId?semiAnal.find(x=>x.id===semiAnalId):null;
  if(cur) return semiAnalDetail(cur);
  const q=(semiF.aq||"").toLowerCase();
  const rows=semiAnal.filter(x=>x.kind!=="tech").filter(x=>!q||(x.code||"").toLowerCase().includes(q)||(x.title||"").toLowerCase().includes(q)||((semiFind(x.code)||{}).name||"").toLowerCase().includes(q));
  const form=semiCanEdit()?semiAnalForm():"";
  return `${form}<div class="toolbar"><input type="text" id="sf_aq" value="${esc(semiF.aq||"")}" placeholder="종목명·제목 검색" onkeydown="if(event.key==='Enter'){semiF.aq=this.value;renderSemi()}">
    <button class="btn btn-s" onclick="semiF.aq=$('sf_aq').value;renderSemi()">검색</button></div>
    ${rows.length?rows.map(x=>{const st=semiFind(x.code);return `<div class="panel" style="cursor:pointer" onclick="semiAnalId='${x.id}';renderSemi();window.scrollTo({top:0})">
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${st?semiStockTag(st):`<span class="tag" style="background:#f4f5f7;color:#5a6580">${esc(x.code)}</span>`}
        ${x.rating?`<span class="tag" style="background:var(--ink);color:#fff">${esc(x.rating)}</span>`:""}<span class="mini">${esc(x.analysis_date||"")}</span></div>
      <div style="font-size:15px;font-weight:700;margin:8px 0 4px">${esc(x.title)}</div>
      <div style="font-size:13px;color:var(--ink-soft);line-height:1.6">${esc(x.summary||"")}</div>
      <div class="mini" style="margin-top:6px;color:var(--brass)">자세히 보기 →</div></div>`}).join(""):semiEmpty("등록된 종목분석이 없습니다",semiCanEdit()?"위의 '종목분석 작성'에서 추가하세요.":"담당자가 분석을 등록하면 표시됩니다.")}`;
}
function semiAnalDetail(x){
  const st=semiFind(x.code); const src=Array.isArray(x.sources)?x.sources:[];
  return `<div class="toolbar"><button class="btn btn-s" onclick="semiAnalId=null;renderSemi()">← 목록</button><span style="flex:1"></span>
    ${semiCanEdit()?`<button class="btn btn-s btn-sm" onclick="semiAnalEdit='${x.id}';semiAnalId=null;renderSemi();window.scrollTo({top:0})">수정</button>
    <button class="btn btn-d btn-sm" onclick="semiAnalDel('${x.id}')">삭제</button>`:""}</div>
  <div class="panel">
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${st?semiStockTag(st):`<span class="tag" style="background:#f4f5f7">${esc(x.code)}</span>`}
      ${x.rating?`<span class="tag" style="background:var(--ink);color:#fff">${esc(x.rating)}</span>`:""}
      ${x.target_price?`<span class="mini">목표/기준가 ${Number(x.target_price).toLocaleString()} ${esc(x.currency||"")}</span>`:""}<span class="mini">${esc(x.analysis_date||"")}</span></div>
    <div style="font-size:18px;font-weight:800;margin:10px 0 6px">${esc(x.title)}</div>
    ${x.summary?`<div style="background:var(--brass-soft);border-radius:8px;padding:12px 14px;font-size:13px;line-height:1.7;margin-bottom:6px">${esc(x.summary)}</div>`:""}
    <div style="font-size:13px;color:var(--ink)">${semiMd(x.content)}</div>
    ${src.length?`<div style="margin-top:16px;border-top:1px solid var(--line);padding-top:10px"><div class="mini" style="font-weight:700;margin-bottom:4px">출처</div>${src.map(s=>`<div class="mini">· ${s.url?`<a href="${esc(s.url)}" target="_blank" rel="noopener" style="color:#1d4ed8">${esc(s.title||s.url)}</a>`:esc(s.title||"")}</div>`).join("")}</div>`:""}
  </div>`;
}
function semiAnalForm(){
  const e=semiAnalEdit?semiAnal.find(x=>x.id===semiAnalEdit):null;
  const opts=[...semiStocks].sort((a,b)=>(a.name||"").localeCompare(b.name||""));
  const srcTxt=e&&Array.isArray(e.sources)?e.sources.map(s=>(s.title||"")+(s.url?" | "+s.url:"")).join("\n"):"";
  return `<details class="panel" ${e?"open":""}><summary style="cursor:pointer;font-size:13px;font-weight:600;color:var(--brass)">${e?"종목분석 수정":"종목분석 작성"}</summary>
    <div class="frow" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-top:10px">
      <div class="fg"><label>종목 *</label><select id="sa_code">${opts.map(s=>`<option value="${esc(s.code)}" ${e&&e.code===s.code?"selected":""}>${esc(s.name)} (${esc(s.code)})</option>`).join("")}</select></div>
      <div class="fg"><label>작성일</label><input type="date" id="sa_date" value="${esc(e?.analysis_date||new Date().toISOString().slice(0,10))}"></div>
      <div class="fg"><label>투자의견/관점</label><input id="sa_rating" value="${esc(e?.rating||"")}" placeholder="매수 / 중립 / 관망"></div>
      <div class="fg"><label>목표·기준가</label><input id="sa_tp" type="number" step="any" value="${esc(e?.target_price??"")}"></div>
      <div class="fg"><label>통화</label><select id="sa_cur">${["KRW","USD","JPY","TWD"].map(c=>`<option ${(e?.currency||"KRW")===c?"selected":""}>${c}</option>`).join("")}</select></div>
    </div>
    <div class="fg"><label>제목 *</label><input id="sa_title" value="${esc(e?.title||"")}" placeholder="예: 앤트로픽 IPO 분석 — 상장 조건과 반도체 영향"></div>
    <div class="fg" style="margin-top:8px"><label>핵심 요약 (목록에 표시)</label><textarea id="sa_sum" style="min-height:70px">${esc(e?.summary||"")}</textarea></div>
    <div class="fg" style="margin-top:8px"><label>본문 — 리포트 요약·분석 (## 소제목, - 목록, **굵게**, | 표 | 사용 가능)</label><textarea id="sa_body" style="min-height:260px;font-family:Consolas,monospace;font-size:12px">${esc(e?.content||"")}</textarea></div>
    <div class="fg" style="margin-top:8px"><label>출처 (한 줄에 하나: 제목 | URL)</label><textarea id="sa_src" style="min-height:70px;font-size:12px">${esc(srcTxt)}</textarea></div>
    <div class="msg" id="sa_msg"></div>
    <button class="btn btn-p" style="margin-top:8px" onclick="semiAnalSave()">${e?"수정 저장":"등록"}</button>
    ${e?`<button class="btn btn-s" style="margin-top:8px" onclick="semiAnalEdit=null;renderSemi()">취소</button>`:""}
  </details>`;
}
async function semiAnalSave(){
  const v=id=>$(id).value.trim();
  if(!v("sa_title")){showMsg("sa_msg","제목을 입력하세요");return}
  const sources=v("sa_src").split("\n").map(l=>l.trim()).filter(Boolean).map(l=>{const i=l.lastIndexOf("|");return i>0?{title:l.slice(0,i).trim(),url:l.slice(i+1).trim()}:(/^https?:/.test(l)?{title:l,url:l}:{title:l})});
  const row={code:v("sa_code"),analysis_date:v("sa_date")||null,rating:v("sa_rating")||null,target_price:v("sa_tp")?Number(v("sa_tp")):null,currency:v("sa_cur"),title:v("sa_title"),summary:v("sa_sum")||null,content:$("sa_body").value,sources,updated_at:new Date().toISOString()};
  const {data,error}=semiAnalEdit?await db.from("semi_analysis").update(row).eq("id",semiAnalEdit).select():await db.from("semi_analysis").insert({...row,owner:me.id}).select();
  if(error){err(error);return}
  semiAnalEdit=null; semiAnalId=data&&data[0]?data[0].id:null; await loadSemi();
}
async function semiAnalDel(id,kind){
  if(!confirm(kind==="tech"?"이 기술동향을 삭제할까요?":"이 종목분석을 삭제할까요?"))return;
  const {error}=await db.from("semi_analysis").delete().eq("id",id);
  if(error){err(error);return}
  semiAnalId=null; semiTechId=null; await loadSemi();
}
/* 기술동향 (반도체 기술 트렌드·리포트 요약) */
const SEMI_TECH_CATS=["HBM·메모리","첨단 패키징","공정·노드","장비","소재","AI 가속기","기판·부품","기타"];
function semiRelTags(t){return (t||"").split(",").map(x=>x.trim()).filter(Boolean).map(k=>{const st=semiFind(k);return st?semiStockTag(st):`<span class="tag" style="background:#f4f5f7;color:#5a6580">${esc(k)}</span>`}).join("")}
function semiTechHtml(){
  if(!semiAnalReady) return `<div class="panel">${semiEmpty("데이터베이스 준비가 필요합니다","Supabase SQL Editor에서 upgrade-semi-analysis.sql, upgrade-semi-tech.sql 을 실행한 뒤 새로고침하세요.")}</div>`;
  const all=semiAnal.filter(x=>x.kind==="tech");
  const cur=semiTechId?all.find(x=>x.id===semiTechId):null;
  if(cur) return semiTechDetail(cur);
  const q=(semiF.tq||"").toLowerCase(), cat=semiF.tcat||"";
  const rows=all.filter(x=>(!cat||x.category===cat)&&(!q||(x.title||"").toLowerCase().includes(q)||(x.related||"").toLowerCase().includes(q)||(x.summary||"").toLowerCase().includes(q)));
  const cats=SEMI_TECH_CATS.filter(c=>all.some(x=>x.category===c));
  return `${semiCanEdit()?semiTechForm():""}
  <div class="toolbar"><select onchange="semiF.tcat=this.value;renderSemi()"><option value="">기술 분야 전체</option>${SEMI_TECH_CATS.map(c=>`<option ${cat===c?"selected":""}>${c}</option>`).join("")}</select>
    <input type="text" id="sf_tq" value="${esc(semiF.tq||"")}" placeholder="제목·관련 종목 검색" onkeydown="if(event.key==='Enter'){semiF.tq=this.value;renderSemi()}">
    <button class="btn btn-s" onclick="semiF.tq=$('sf_tq').value;renderSemi()">검색</button></div>
  ${rows.length?rows.map(x=>`<div class="panel" style="cursor:pointer" onclick="semiTechId='${x.id}';renderSemi();window.scrollTo({top:0})">
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><span class="tag" style="background:var(--ink);color:#fff">${esc(x.category||"기타")}</span><span class="mini">${esc(x.analysis_date||"")}</span></div>
      <div style="font-size:15px;font-weight:700;margin:8px 0 4px">${esc(x.title)}</div>
      <div style="font-size:13px;color:var(--ink-soft);line-height:1.6">${esc(x.summary||"")}</div>
      ${x.related?`<div style="margin-top:8px">${semiRelTags(x.related)}</div>`:""}
      <div class="mini" style="margin-top:6px;color:var(--brass)">자세히 보기 →</div></div>`).join(""):semiEmpty("등록된 기술동향이 없습니다",semiCanEdit()?"위의 '기술동향 작성'에서 추가하세요.":"담당자가 기술동향을 등록하면 표시됩니다.")}`;
}
function semiTechDetail(x){
  const src=Array.isArray(x.sources)?x.sources:[];
  return `<div class="toolbar"><button class="btn btn-s" onclick="semiTechId=null;renderSemi()">← 목록</button><span style="flex:1"></span>
    ${semiCanEdit()?`<button class="btn btn-s btn-sm" onclick="semiTechEdit='${x.id}';semiTechId=null;renderSemi();window.scrollTo({top:0})">수정</button>
    <button class="btn btn-d btn-sm" onclick="semiAnalDel('${x.id}','tech')">삭제</button>`:""}</div>
  <div class="panel">
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><span class="tag" style="background:var(--ink);color:#fff">${esc(x.category||"기타")}</span><span class="mini">${esc(x.analysis_date||"")}</span></div>
    <div style="font-size:18px;font-weight:800;margin:10px 0 6px">${esc(x.title)}</div>
    ${x.related?`<div style="margin-bottom:8px"><span class="mini" style="margin-right:4px">관련 종목</span>${semiRelTags(x.related)}</div>`:""}
    ${x.summary?`<div style="background:var(--brass-soft);border-radius:8px;padding:12px 14px;font-size:13px;line-height:1.7;margin-bottom:6px">${esc(x.summary)}</div>`:""}
    <div style="font-size:13px;color:var(--ink)">${semiMd(x.content)}</div>
    ${src.length?`<div style="margin-top:16px;border-top:1px solid var(--line);padding-top:10px"><div class="mini" style="font-weight:700;margin-bottom:4px">출처</div>${src.map(s=>`<div class="mini">· ${s.url?`<a href="${esc(s.url)}" target="_blank" rel="noopener" style="color:#1d4ed8">${esc(s.title||s.url)}</a>`:esc(s.title||"")}</div>`).join("")}</div>`:""}
  </div>`;
}
function semiTechForm(){
  const e=semiTechEdit?semiAnal.find(x=>x.id===semiTechEdit):null;
  const srcTxt=e&&Array.isArray(e.sources)?e.sources.map(s=>(s.title||"")+(s.url?" | "+s.url:"")).join("\n"):"";
  return `<details class="panel" ${e?"open":""}><summary style="cursor:pointer;font-size:13px;font-weight:600;color:var(--brass)">${e?"기술동향 수정":"기술동향 작성"}</summary>
    <div class="frow" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));margin-top:10px">
      <div class="fg"><label>기술 분야</label><select id="st_cat">${SEMI_TECH_CATS.map(c=>`<option ${(e?.category||"")===c?"selected":""}>${c}</option>`).join("")}</select></div>
      <div class="fg"><label>작성일</label><input type="date" id="st_date" value="${esc(e?.analysis_date||new Date().toISOString().slice(0,10))}"></div>
      <div class="fg"><label>관련 종목 (쉼표로 구분)</label><input id="st_rel" value="${esc(e?.related||"")}" placeholder="SK하이닉스, 한미반도체"></div>
    </div>
    <div class="fg"><label>제목 *</label><input id="st_title" value="${esc(e?.title||"")}" placeholder="예: HBM4 하이브리드 본딩 도입 일정과 장비 수혜"></div>
    <div class="fg" style="margin-top:8px"><label>핵심 요약 (목록에 표시)</label><textarea id="st_sum" style="min-height:70px">${esc(e?.summary||"")}</textarea></div>
    <div class="fg" style="margin-top:8px"><label>본문 — 기술 설명·리포트 요약 (## 소제목, - 목록, **굵게**, | 표 | 사용 가능)</label><textarea id="st_body" style="min-height:260px;font-family:Consolas,monospace;font-size:12px">${esc(e?.content||"")}</textarea></div>
    <div class="fg" style="margin-top:8px"><label>출처 (한 줄에 하나: 제목 | URL)</label><textarea id="st_src" style="min-height:70px;font-size:12px">${esc(srcTxt)}</textarea></div>
    <div class="msg" id="st_msg"></div>
    <button class="btn btn-p" style="margin-top:8px" onclick="semiTechSave()">${e?"수정 저장":"등록"}</button>
    ${e?`<button class="btn btn-s" style="margin-top:8px" onclick="semiTechEdit=null;renderSemi()">취소</button>`:""}
  </details>`;
}
async function semiTechSave(){
  const v=id=>$(id).value.trim();
  if(!v("st_title")){showMsg("st_msg","제목을 입력하세요");return}
  const sources=v("st_src").split("\n").map(l=>l.trim()).filter(Boolean).map(l=>{const i=l.lastIndexOf("|");return i>0?{title:l.slice(0,i).trim(),url:l.slice(i+1).trim()}:(/^https?:/.test(l)?{title:l,url:l}:{title:l})});
  const row={kind:"tech",code:null,category:v("st_cat"),related:v("st_rel")||null,analysis_date:v("st_date")||null,title:v("st_title"),summary:v("st_sum")||null,content:$("st_body").value,sources,updated_at:new Date().toISOString()};
  const {data,error}=semiTechEdit?await db.from("semi_analysis").update(row).eq("id",semiTechEdit).select():await db.from("semi_analysis").insert({...row,owner:me.id}).select();
  if(error){err(error);return}
  semiTechEdit=null; semiTechId=data&&data[0]?data[0].id:null; await loadSemi();
}


/* ---------- 공통 ---------- */
function closeModal(id){$(id).classList.remove("open")}
document.querySelectorAll(".modal-bg").forEach(m=>m.addEventListener("click",e=>{if(e.target===m)m.classList.remove("open")}));
function renderAll(){renderDash();renderClients();renderReturns();renderWrap();renderFunds();renderProspects();renderEls();renderDocs()}
boot();
