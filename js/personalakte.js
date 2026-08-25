import { db, functions } from "./firebase.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { esc, fmtDateTime, toast } from "./utils.js";

const uploadPersonnelDocument=httpsCallable(functions,'uploadPersonnelDocument');
const getPersonnelDocumentUrl=httpsCallable(functions,'getPersonnelDocumentDownloadUrl');
const deletePersonnelDocumentFile=httpsCallable(functions,'deletePersonnelDocument');
const getPersonnelPayrollDocumentUrl=httpsCallable(functions,'getPersonnelPayrollDocumentDownloadUrl');

const CATEGORIES=["Arbeitsvertrag","Vertragsänderung","Personalfragebogen","Bescheinigung","Zeugnis","Steuerunterlage","Sozialversicherung","Arbeitssicherheit","Führerschein / Befähigung","Sonstiges"];
function fileBase64(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]||'');r.onerror=reject;r.readAsDataURL(file)})}
function bytes(n=0){if(n<1024)return `${n} B`;if(n<1024*1024)return `${(n/1024).toFixed(1)} KB`;return `${(n/1024/1024).toFixed(1)} MB`}

export async function renderPersonalakte(container,ctx,employee,options={}){
  const readOnly=options.readOnly===true;
  const canManage=options.canManage!==false && !readOnly;
  if(!employee?.id){container.innerHTML='<div class="info-strip">Dokumente können nach dem erstmaligen Speichern des Mitarbeiters hochgeladen werden.</div>';return}
  const [snap,payrollSnap]=await Promise.all([
    getDocs(query(collection(db,'employeeDocuments'),where('userId','==',employee.id))),
    getDocs(query(collection(db,'payrollDocuments'),where('userId','==',employee.id)))
  ]);
  const docs=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>{const am=a.createdAt?.seconds||0,bm=b.createdAt?.seconds||0;return bm-am});
  const payrollDocs=payrollSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.period||'').localeCompare(a.period||''));
  const MONTHS=['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  const payrollLabel=(period='')=>{const [y,m]=String(period).split('-');const i=Number(m)-1;return y&&i>=0&&i<12?`${MONTHS[i]} ${y}`:period||'–'};
  container.innerHTML=`${canManage?`<div class="document-upload-box"><div><strong>Dokument hochladen</strong><span>PDF, Office-Dokumente sowie JPG/PNG/WEBP · max. 10 MB</span></div><div class="document-upload-grid"><label class="field"><span>Kategorie</span><select id="personnel-doc-category">${CATEGORIES.map(x=>`<option>${esc(x)}</option>`).join('')}</select></label><label class="field"><span>Datei</span><input id="personnel-doc-file" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.jpg,.jpeg,.png,.webp"></label><label class="field full"><span>Notiz</span><input id="personnel-doc-note" maxlength="250" placeholder="optional"></label><div class="field full actions"><button class="btn primary" id="personnel-doc-upload" type="button">Datei hochladen</button></div></div></div>`:''}
  <div class="document-list">${docs.length?docs.map(d=>`<div class="document-row"><div class="document-icon">▤</div><div class="document-copy"><strong>${esc(d.fileName||'Dokument')}</strong><span>${esc(d.category||'Sonstiges')} · ${bytes(Number(d.size||0))} · ${fmtDateTime(d.createdAt)}</span>${d.note?`<small>${esc(d.note)}</small>`:''}</div><div class="actions"><button type="button" class="btn secondary small doc-download" data-id="${d.id}">Download</button>${canManage?`<button type="button" class="btn danger small doc-delete" data-id="${d.id}">Löschen</button>`:''}</div></div>`).join(''):'<div class="empty">Noch keine sonstigen Dokumente in der Personalakte.</div>'}</div><div class="personal-payroll-section"><h4>Lohn-/Gehaltsabrechnungen</h4><p>Diese Dokumente werden über den Sammelupload im Bereich Lohn-/Gehaltsabrechnung bereitgestellt.</p><div class="document-list">${payrollDocs.length?payrollDocs.map(d=>`<div class="document-row"><div class="document-icon">€</div><div class="document-copy"><strong>${esc(payrollLabel(d.period))}</strong><span>${esc(d.fileName||'Abrechnung.pdf')} · ${bytes(Number(d.size||0))} · ${fmtDateTime(d.createdAt)}</span></div><div class="actions"><button type="button" class="btn secondary small payroll-doc-download" data-id="${d.id}">Download</button></div></div>`).join(''):'<div class="empty">Noch keine Lohn-/Gehaltsabrechnungen hinterlegt.</div>'}</div></div>`;

  const uploadButton=container.querySelector('#personnel-doc-upload');
  if(uploadButton) uploadButton.onclick=async()=>{
    const file=container.querySelector('#personnel-doc-file').files[0];
    if(!file){toast('Bitte zuerst eine Datei auswählen.');return}
    if(file.size>10*1024*1024){toast('Die Datei ist größer als 10 MB.');return}
    const button=container.querySelector('#personnel-doc-upload');button.disabled=true;button.textContent='Upload läuft …';
    try{
      const token=await ctx.user.getIdToken();
      const result=await uploadPersonnelDocument({idToken:token,employeeId:employee.id,fileName:file.name,contentType:file.type||'application/octet-stream',base64Data:await fileBase64(file)});
      const f=result.data?.file;if(!f?.path)throw new Error('Storage-Pfad wurde nicht zurückgegeben.');
      await addDoc(collection(db,'employeeDocuments'),{userId:employee.id,fileName:file.name,path:f.path,size:f.size||file.size,contentType:f.contentType||file.type||'',category:container.querySelector('#personnel-doc-category').value,note:container.querySelector('#personnel-doc-note').value.trim(),uploadedById:ctx.user.uid,uploadedByName:ctx.profile?.name||'',createdAt:serverTimestamp()});
      toast('Dokument hochgeladen.');await renderPersonalakte(container,ctx,employee);
    }catch(err){console.error(err);toast(err?.message||'Dokument konnte nicht hochgeladen werden.')}finally{button.disabled=false;button.textContent='Datei hochladen'}
  };
  container.querySelectorAll('.doc-download').forEach(b=>b.onclick=async()=>{const meta=docs.find(x=>x.id===b.dataset.id);try{const token=await ctx.user.getIdToken();const result=await getPersonnelDocumentUrl({idToken:token,employeeId:employee.id,path:meta.path,fileName:meta.fileName});if(result.data?.url)window.open(result.data.url,'_blank','noopener');else throw new Error('Keine Download-URL erhalten.')}catch(err){console.error(err);toast('Dokument konnte nicht geöffnet werden.')}});
  container.querySelectorAll('.doc-delete').forEach(b=>b.onclick=async()=>{const meta=docs.find(x=>x.id===b.dataset.id);if(!confirm(`Dokument „${meta.fileName}“ wirklich löschen?`))return;try{const token=await ctx.user.getIdToken();await deletePersonnelDocumentFile({idToken:token,employeeId:employee.id,path:meta.path});await deleteDoc(doc(db,'employeeDocuments',meta.id));toast('Dokument gelöscht.');await renderPersonalakte(container,ctx,employee)}catch(err){console.error(err);toast('Dokument konnte nicht gelöscht werden.')}});
  container.querySelectorAll('.payroll-doc-download').forEach(b=>b.onclick=async()=>{const meta=payrollDocs.find(x=>x.id===b.dataset.id);try{const token=await ctx.user.getIdToken();const result=await getPersonnelPayrollDocumentUrl({idToken:token,employeeId:employee.id,path:meta.path,fileName:meta.fileName});if(result.data?.url)window.open(result.data.url,'_blank','noopener');else throw new Error('Keine Download-URL erhalten.')}catch(err){console.error(err);toast('Abrechnung konnte nicht geöffnet werden.')}});
}
