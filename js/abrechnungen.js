import { db, functions } from "./firebase.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";
import { collection, getDocs, query, where, addDoc, deleteDoc, doc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setHead } from "./app.js";
import { esc, fmtDateTime, toast } from "./utils.js";

const uploadPayrollDocument = httpsCallable(functions, "uploadPersonnelPayrollDocument");
const getPayrollDocumentUrl = httpsCallable(functions, "getPersonnelPayrollDocumentDownloadUrl");
const deletePayrollDocumentFile = httpsCallable(functions, "deletePersonnelPayrollDocument");

const MONTHS = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];

function fileBase64(file){
  return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(",")[1]||"");r.onerror=reject;r.readAsDataURL(file)});
}
function bytes(n=0){if(n<1024)return `${n} B`;if(n<1024*1024)return `${(n/1024).toFixed(1)} KB`;return `${(n/1024/1024).toFixed(1)} MB`}
function periodKey(year,month){return `${String(year)}-${String(month).padStart(2,"0")}`}
function periodLabel(period=""){
  const [y,m]=String(period).split("-"); const mi=Number(m)-1;
  return y&&mi>=0&&mi<12?`${MONTHS[mi]} ${y}`:period||"–";
}
function normalizeEmployeeNumber(v=""){return String(v).trim()}
function filenameMatches(fileName, employeeNumber){
  if(!employeeNumber)return false;
  const base=String(fileName||"").replace(/\.pdf$/i,"");
  // Mitarbeiter-Nr. muss als eigenständiger Nummern-/Textblock vorkommen, damit z.B. 123 nicht 1234 trifft.
  const escaped=employeeNumber.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`,"i").test(base) || base===employeeNumber;
}

async function loadPayrollRowsForUser(userId){
  const s=await getDocs(query(collection(db,"payrollDocuments"),where("userId","==",userId)));
  return s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.period||"").localeCompare(a.period||"") || Number(b.createdAt?.seconds||0)-Number(a.createdAt?.seconds||0));
}

async function openPayroll(ctx,row,inline=false){
  try{
    const token=await ctx.user.getIdToken();
    const result=await getPayrollDocumentUrl({idToken:token,employeeId:row.userId,path:row.path,fileName:row.fileName,inline});
    if(!result.data?.url)throw new Error("Keine Download-URL erhalten.");
    window.open(result.data.url,"_blank","noopener");
  }catch(err){console.error(err);toast("Abrechnung konnte nicht geöffnet werden.")}
}

function renderEmployeeArchive(el,ctx,rows){
  el.innerHTML=`<article class="card payroll-my-card"><div class="card-head"><div><h2>Meine Lohn-/Gehaltsabrechnungen</h2><p>Die Dokumente sind ausschließlich für Dich und die Personalabteilung sichtbar.</p></div></div>
  <div class="payroll-years">${rows.length?Object.entries(rows.reduce((acc,r)=>{const year=String(r.period||"").slice(0,4)||"Ohne Jahr";(acc[year]??=[]).push(r);return acc},{})).sort((a,b)=>b[0].localeCompare(a[0])).map(([year,list])=>`<section class="payroll-year"><h3>${esc(year)}</h3><div class="document-list">${list.map(r=>`<div class="document-row"><div class="document-icon">€</div><div class="document-copy"><strong>${esc(periodLabel(r.period))}</strong><span>${esc(r.fileName||"Abrechnung.pdf")} · ${bytes(Number(r.size||0))}</span><small>Bereitgestellt: ${fmtDateTime(r.createdAt)}</small></div><div class="actions"><button type="button" class="btn secondary small payroll-open" data-id="${r.id}">Öffnen / Drucken</button><button type="button" class="btn secondary small payroll-download" data-id="${r.id}">Download</button></div></div>`).join("")}</div></section>`).join(""):`<div class="empty">Noch keine Lohn-/Gehaltsabrechnungen bereitgestellt.</div>`}</div></article>`;
  el.querySelectorAll(".payroll-open").forEach(b=>b.onclick=()=>openPayroll(ctx,rows.find(r=>r.id===b.dataset.id),true));
  el.querySelectorAll(".payroll-download").forEach(b=>b.onclick=()=>openPayroll(ctx,rows.find(r=>r.id===b.dataset.id),false));
}

async function renderAdminPayroll(el,ctx){
  const [userSnap,companySnap,payrollSnap]=await Promise.all([
    getDocs(collection(db,"users")),getDocs(collection(db,"companies")),getDocs(collection(db,"payrollDocuments"))
  ]);
  const users=userSnap.docs.map(d=>({id:d.id,...d.data()}));
  const companies=companySnap.docs.map(d=>({id:d.id,...d.data()}));
  let payrollRows=payrollSnap.docs.map(d=>({id:d.id,...d.data()}));
  const now=new Date();

  el.innerHTML=`<div class="admin-choice-grid payroll-choice-grid">
    <button class="choice-card active" type="button" data-payroll-view="upload"><span class="choice-icon">⇧</span><strong>Abrechnungen hochladen</strong><small>Mehrere PDF-Dateien automatisch zuordnen</small></button>
    <button class="choice-card" type="button" data-payroll-view="show"><span class="choice-icon">▤</span><strong>Abrechnungen anzeigen</strong><small>Archiv prüfen, filtern und verwalten</small></button>
  </div>
  <section id="payroll-upload-view">
    <article class="card"><div class="card-head"><div><h2>Sammelupload Lohn-/Gehaltsabrechnungen</h2><p>Monat und Jahr einmal auswählen. Die Mitarbeiterzuordnung erfolgt anschließend über die Mitarbeiternummer im PDF-Dateinamen.</p></div></div>
      <div class="payroll-upload-grid">
        <label class="field"><span>Abrechnungsmonat</span><select id="payroll-month">${MONTHS.map((m,i)=>`<option value="${i+1}" ${i===now.getMonth()?"selected":""}>${m}</option>`).join("")}</select></label>
        <label class="field"><span>Abrechnungsjahr</span><input id="payroll-year" type="number" min="2000" max="2100" value="${now.getFullYear()}"></label>
        <label class="field full"><span>PDF-Dateien</span><input id="payroll-files" type="file" accept="application/pdf,.pdf" multiple><small>Mehrfachauswahl möglich · max. 10 MB je PDF</small></label>
      </div>
      <div class="actions"><button class="btn secondary" id="payroll-preview" type="button">Zuordnung prüfen</button><button class="btn primary" id="payroll-upload" type="button" disabled>Geprüfte Abrechnungen hochladen</button></div>
      <div id="payroll-preview-result" class="payroll-preview-result"><div class="empty">Noch keine Dateien ausgewählt und geprüft.</div></div>
    </article>
  </section>
  <section id="payroll-show-view" class="hidden">
    <article class="card"><div class="card-head"><div><h2>Abrechnungen anzeigen</h2><p>Kontrolle nach Firma, Abrechnungsmonat und Mitarbeiter.</p></div></div>
      <div class="grid cols-4 payroll-filter-grid">
        <label class="field"><span>Firma</span><select id="payroll-filter-company"><option value="">Alle Firmen</option>${companies.sort((a,b)=>(a.name||"").localeCompare(b.name||"")).map(c=>`<option value="${c.id}">${esc(c.name||c.short||c.id)}</option>`).join("")}</select></label>
        <label class="field"><span>Jahr</span><select id="payroll-filter-year"><option value="">Alle Jahre</option>${[...new Set(payrollRows.map(r=>String(r.period||"").slice(0,4)).filter(Boolean))].sort().reverse().map(y=>`<option>${esc(y)}</option>`).join("")}</select></label>
        <label class="field"><span>Monat</span><select id="payroll-filter-month"><option value="">Alle Monate</option>${MONTHS.map((m,i)=>`<option value="${String(i+1).padStart(2,"0")}">${m}</option>`).join("")}</select></label>
        <label class="field"><span>Mitarbeiter suchen</span><input id="payroll-filter-search" placeholder="Name oder Mitarbeiternummer"></label>
      </div>
      <div id="payroll-admin-list"></div>
    </article>
  </section>`;

  const userById=new Map(users.map(u=>[u.id,u]));
  const companyById=new Map(companies.map(c=>[c.id,c]));
  let previewRows=[];
  const uploadBtn=el.querySelector("#payroll-upload");
  const result=el.querySelector("#payroll-preview-result");

  function currentPeriod(){return periodKey(el.querySelector("#payroll-year").value,el.querySelector("#payroll-month").value)}
  function buildPreview(){
    const files=[...el.querySelector("#payroll-files").files];
    const period=currentPeriod();
    if(!files.length){toast("Bitte mindestens eine PDF-Datei auswählen.");return}
    if(!/^\d{4}-\d{2}$/.test(period)){toast("Bitte gültigen Monat und Jahr auswählen.");return}
    previewRows=files.map((file,index)=>{
      if(!/\.pdf$/i.test(file.name)||file.type&&file.type!=="application/pdf")return {index,file,status:"error",message:"Keine PDF-Datei"};
      if(file.size>10*1024*1024)return {index,file,status:"error",message:"Größer als 10 MB"};
      const matches=users.filter(u=>normalizeEmployeeNumber(u.employeeNumber)&&filenameMatches(file.name,normalizeEmployeeNumber(u.employeeNumber)));
      if(matches.length===0)return {index,file,status:"error",message:"Keine Mitarbeiternummer im Dateinamen erkannt"};
      if(matches.length>1)return {index,file,status:"error",message:`Mehrdeutige Zuordnung (${matches.map(x=>x.employeeNumber).join(", ")})`};
      const employee=matches[0];
      const existingCount=payrollRows.filter(r=>r.userId===employee.id&&r.period===period).length;
      return {index,file,employee,existingCount,status:existingCount?"warning":"ok",message:existingCount?`Es besteht bereits ${existingCount} Abrechnung(en) für diesen Monat – zusätzlicher Upload möglich`:"Bereit zum Upload"};
    });
    const valid=previewRows.filter(r=>r.status==="ok"||r.status==="warning").length;
    const errors=previewRows.length-valid;
    uploadBtn.disabled=valid===0;
    result.innerHTML=`<div class="payroll-preview-summary"><span class="pill green">${valid} zugeordnet</span>${errors?`<span class="pill red">${errors} fehlerhaft</span>`:""}<span class="pill">${esc(periodLabel(period))}</span></div><div class="table-wrap"><table><thead><tr><th>Datei</th><th>Mitarbeiternummer</th><th>Mitarbeiter</th><th>Firma</th><th>Status</th></tr></thead><tbody>${previewRows.map(r=>`<tr><td>${esc(r.file.name)}</td><td>${esc(r.employee?.employeeNumber||"–")}</td><td>${esc(r.employee?.name||"–")}</td><td>${esc(companyById.get(r.employee?.companyId)?.short||companyById.get(r.employee?.companyId)?.name||"–")}</td><td><span class="pill ${r.status==="error"?"red":r.status==="warning"?"orange":"green"}">${esc(r.message)}</span></td></tr>`).join("")}</tbody></table></div>`;
  }
  el.querySelector("#payroll-preview").onclick=buildPreview;
  el.querySelector("#payroll-files").onchange=()=>{previewRows=[];uploadBtn.disabled=true;result.innerHTML='<div class="info-strip">Dateiauswahl geändert. Bitte die Zuordnung erneut prüfen.</div>'};
  el.querySelector("#payroll-month").onchange=()=>{if(previewRows.length)buildPreview()};
  el.querySelector("#payroll-year").onchange=()=>{if(previewRows.length)buildPreview()};

  uploadBtn.onclick=async()=>{
    const valid=previewRows.filter(r=>r.status==="ok"||r.status==="warning");
    if(!valid.length){toast("Keine gültigen Abrechnungen zum Hochladen vorhanden.");return}
    const period=currentPeriod(); const [year,month]=period.split("-");
    const warningCount=valid.filter(r=>r.status==="warning").length;
    if(warningCount&&!confirm(`Für ${warningCount} ausgewählte Abrechnung(en) besteht bereits mindestens eine Abrechnung im Monat ${periodLabel(period)}. Wirklich zusätzlich hochladen?`))return;
    uploadBtn.disabled=true; uploadBtn.textContent=`Upload 0 / ${valid.length}`;
    let ok=0,failed=0;
    for(const row of valid){
      try{
        const token=await ctx.user.getIdToken();
        const f=row.file;
        const response=await uploadPayrollDocument({idToken:token,employeeId:row.employee.id,employeeNumber:row.employee.employeeNumber||"",year:Number(year),month:Number(month),fileName:f.name,contentType:f.type||"application/pdf",base64Data:await fileBase64(f)});
        const stored=response.data?.file;if(!stored?.path)throw new Error("Storage-Pfad fehlt.");
        const meta={userId:row.employee.id,employeeNumber:row.employee.employeeNumber||"",companyId:row.employee.companyId||"",period,year:Number(year),month:Number(month),fileName:f.name,path:stored.path,size:stored.size||f.size,contentType:"application/pdf",uploadedById:ctx.user.uid,uploadedByName:ctx.profile?.name||"",createdAt:serverTimestamp()};
        const ref=await addDoc(collection(db,"payrollDocuments"),meta);
        payrollRows.push({id:ref.id,...meta});
        ok++;
      }catch(err){console.error("Payroll-Upload fehlgeschlagen",row.file.name,err);row.status="error";row.message=err?.message||"Upload fehlgeschlagen";failed++}
      uploadBtn.textContent=`Upload ${ok+failed} / ${valid.length}`;
    }
    toast(failed?`${ok} Abrechnung(en) hochgeladen, ${failed} fehlgeschlagen.`:`${ok} Abrechnung(en) erfolgreich hochgeladen.`);
    uploadBtn.textContent="Geprüfte Abrechnungen hochladen";
    uploadBtn.disabled=true;
    el.querySelector("#payroll-files").value="";
    previewRows=[];
    result.innerHTML=`<div class="info-strip">${ok} Abrechnung(en) erfolgreich verarbeitet${failed?`, ${failed} Upload(s) fehlgeschlagen`:""}. Für einen weiteren Upload bitte neue Dateien auswählen.</div>`;
    renderAdminList();
  };

  function filteredRows(){
    const company=el.querySelector("#payroll-filter-company").value;
    const year=el.querySelector("#payroll-filter-year").value;
    const month=el.querySelector("#payroll-filter-month").value;
    const search=el.querySelector("#payroll-filter-search").value.trim().toLowerCase();
    return payrollRows.filter(r=>{
      const u=userById.get(r.userId)||{};
      return (!company||r.companyId===company||u.companyId===company)&&(!year||String(r.period||"").startsWith(year+"-"))&&(!month||String(r.period||"").slice(5,7)===month)&&(!search||String(u.name||"").toLowerCase().includes(search)||String(r.employeeNumber||u.employeeNumber||"").toLowerCase().includes(search));
    }).sort((a,b)=>(b.period||"").localeCompare(a.period||"")||String(userById.get(a.userId)?.name||"").localeCompare(String(userById.get(b.userId)?.name||"")));
  }
  function renderAdminList(){
    const rows=filteredRows(); const target=el.querySelector("#payroll-admin-list");
    target.innerHTML=`<div class="payroll-list-summary"><strong>${rows.length} Abrechnung(en)</strong></div><div class="table-wrap"><table><thead><tr><th>Zeitraum</th><th>Mitarb.-Nr.</th><th>Mitarbeiter</th><th>Firma</th><th>Datei</th><th>Bereitgestellt</th><th></th></tr></thead><tbody>${rows.length?rows.map(r=>{const u=userById.get(r.userId)||{},c=companyById.get(r.companyId||u.companyId)||{};return `<tr><td>${esc(periodLabel(r.period))}</td><td>${esc(r.employeeNumber||u.employeeNumber||"–")}</td><td>${esc(u.name||"–")}</td><td>${esc(c.short||c.name||"–")}</td><td>${esc(r.fileName||"Abrechnung.pdf")}</td><td>${fmtDateTime(r.createdAt)}</td><td><div class="actions"><button class="btn secondary small payroll-admin-open" data-id="${r.id}" type="button">Download</button><button class="btn danger small payroll-admin-delete" data-id="${r.id}" type="button">Löschen</button></div></td></tr>`}).join(""):`<tr><td colspan="7" class="empty">Keine Abrechnungen für den gewählten Filter.</td></tr>`}</tbody></table></div>`;
    target.querySelectorAll(".payroll-admin-open").forEach(b=>b.onclick=()=>openPayroll(ctx,payrollRows.find(r=>r.id===b.dataset.id)));
    target.querySelectorAll(".payroll-admin-delete").forEach(b=>b.onclick=async()=>{
      const row=payrollRows.find(r=>r.id===b.dataset.id),u=userById.get(row.userId)||{};
      if(!confirm(`Abrechnung ${periodLabel(row.period)} von ${u.name||row.employeeNumber||"Mitarbeiter"} wirklich löschen?`))return;
      try{const token=await ctx.user.getIdToken();await deletePayrollDocumentFile({idToken:token,employeeId:row.userId,path:row.path});await deleteDoc(doc(db,"payrollDocuments",row.id));payrollRows=payrollRows.filter(x=>x.id!==row.id);toast("Abrechnung gelöscht.");renderAdminList()}catch(err){console.error(err);toast("Abrechnung konnte nicht gelöscht werden.")}
    });
  }
  ["#payroll-filter-company","#payroll-filter-year","#payroll-filter-month"].forEach(s=>el.querySelector(s).onchange=renderAdminList);
  el.querySelector("#payroll-filter-search").oninput=renderAdminList;
  renderAdminList();

  el.querySelectorAll("[data-payroll-view]").forEach(b=>b.onclick=()=>{
    el.querySelectorAll("[data-payroll-view]").forEach(x=>x.classList.toggle("active",x===b));
    el.querySelector("#payroll-upload-view").classList.toggle("hidden",b.dataset.payrollView!=="upload");
    el.querySelector("#payroll-show-view").classList.toggle("hidden",b.dataset.payrollView!=="show");
  });
}

export async function renderAbrechnungen(el,ctx){
  setHead("Lohn-/Gehaltsabrechnung",ctx.profile.role==="admin"?"Abrechnungen gesammelt bereitstellen und sicher verwalten.":"Persönliche Abrechnungen sicher abrufen, herunterladen und ausdrucken.");
  if(ctx.profile.role==="admin")return renderAdminPayroll(el,ctx);
  const rows=await loadPayrollRowsForUser(ctx.profile.id);
  renderEmployeeArchive(el,ctx,rows);
}
