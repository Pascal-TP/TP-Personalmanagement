import { auth, db, functions } from "./firebase.js";
import { collection, addDoc, getDocs, query, where, doc, setDoc, updateDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";
import { setHead } from "./app.js";
import { AREA_NAMES, esc, fmtDateTime, toast } from "./utils.js";
import { hasAdminPermission } from "./permissions.js";
import { progressForTrainingYear, trainingProgressDocId, visibleTrainingsForYear } from "./training-utils.js";

const uploadProof=httpsCallable(functions,'uploadPersonnelTrainingProof'),deleteProof=httpsCallable(functions,'deletePersonnelTrainingProof'),proofUrl=httpsCallable(functions,'getPersonnelTrainingProofDownloadUrl'),employeeProofs=httpsCallable(functions,'getPersonnelEmployeeProofDownloads');
async function allTrainings(){const s=await getDocs(collection(db,'trainings'));return s.docs.map(d=>({id:d.id,...d.data()}))}
async function progress(userId){const s=await getDocs(query(collection(db,'trainingProgress'),where('userId','==',userId)));return s.docs.map(d=>({id:d.id,...d.data()}))}
function file64(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(',')[1]);r.onerror=rej;r.readAsDataURL(file)})}
function status(entry){if(!entry)return'<span class="pill yellow">Offen</span>';if(entry.status==='completed'||entry.status==='abgeschlossen')return'<span class="pill green">Abgeschlossen</span>';return'<span class="pill blue">Begonnen</span>'}
function yearOptions(selected){const now=new Date().getFullYear(),from=2026,to=Math.max(now+1,selected);let html='';for(let y=to;y>=from;y--)html+=`<option value="${y}" ${y===selected?'selected':''}>${y}</option>`;return html}

async function ownView(ctx,year){
  const ts=await allTrainings(),vs=visibleTrainingsForYear(ts,ctx.profile,year),allPs=await progress(ctx.profile.id),ps=progressForTrainingYear(allPs,year),current=year===new Date().getFullYear();
  return `<div class="training-year-note"><strong>Schulungsjahr ${year}</strong><span>${current?'Bearbeitung für das aktuelle Jahr möglich.':'Historische bzw. zukünftige Ansicht – Bearbeitung ist nur im aktuellen Jahr möglich.'}</span></div><div class="training-grid">${vs.length?vs.map(t=>{const p=ps.find(x=>x.trainingId===t.id);return`<article class="card training-card"><div class="training-top"><div><h2>${esc(t.title)}</h2><p>Bereiche: ${(t.bereiche||[]).join(', ')||'alle'}</p></div>${status(p)}</div><div class="training-meta"><div><span>Geöffnet</span><strong>${fmtDateTime(p?.openedAt)}</strong></div><div><span>Abgeschlossen</span><strong>${fmtDateTime(p?.completedAt)}</strong></div><div><span>Nachweis</span><strong>${esc(p?.proofName||'–')}</strong></div></div><div class="actions">${current&&t.url?`<button class="btn primary open-training" data-id="${t.id}" data-url="${esc(t.url)}">Schulung öffnen</button>`:''}${current?`<label class="btn secondary file-btn">Nachweis hochladen<input class="proof-file" data-id="${t.id}" type="file" accept="application/pdf,image/*"></label><button class="btn secondary complete-training" data-id="${t.id}">Abschließen</button>`:''}${p?.proofPath?`<button class="btn secondary download-proof" data-id="${t.id}">Nachweis</button>`:''}</div></article>`}).join(''):`<div class="empty">Für ${year} sind Ihnen keine Schulungen zugeordnet.</div>`}</div>`
}

export async function renderSchulungen(el,ctx){
  setHead("Schulungen","Pflichtschulungen, Bearbeitungsstände, Nachweise und Schulungsmatrix nach Schulungsjahr.");
  const admin=ctx.profile.role==='admin',supervisor=ctx.profile.role==='supervisor';
  const canOverview=supervisor||hasAdminPermission(ctx.profile,'trainingOverview');
  const canManage=hasAdminPermission(ctx.profile,'trainingManage');
  let selectedYear=new Date().getFullYear(),activeTab=admin?(canOverview?'proofs':'manage'):'mine';
  el.innerHTML=`<div class="training-nav-row"><div class="subnav">${admin?'':'<button class="subnav-btn active" data-tab="mine">Meine Schulungen</button><button class="subnav-btn" data-tab="progress">Mein Bearbeitungsstand</button>'}${canOverview?`<button class="subnav-btn ${admin?'active':''}" data-tab="proofs">Nachweise je Mitarbeiter</button>`:''}${canManage?`<button class="subnav-btn ${admin&&!canOverview?'active':''}" data-tab="manage">Schulungsverwaltung</button>`:''}${canOverview?'<button class="subnav-btn" data-tab="matrix">Tabellarische Schulungsübersicht</button>':''}</div><label class="training-year-select"><span>Schulungsjahr</span><select id="training-year">${yearOptions(selectedYear)}</select></label></div><div id="training-content"></div>`;
  const target=el.querySelector('#training-content'),yearSelect=el.querySelector('#training-year');

  async function tab(name){
    activeTab=name;
    el.querySelectorAll('.subnav-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
    target.innerHTML='<div class="loading">Schulungen werden geladen …</div>';
    try{
      if(name==='mine'){target.innerHTML=await ownView(ctx,selectedYear);bindOwn();return}
      if(name==='progress'){
        const ps=progressForTrainingYear(await progress(ctx.profile.id),selectedYear);
        target.innerHTML=`<article class="card"><div class="card-head"><div><h2>Mein Bearbeitungsstand · ${selectedYear}</h2><p>Bearbeitungsstand und Nachweise dieses Schulungsjahres.</p></div></div>${ps.length?ps.map(p=>`<div class="list-row"><div><strong>${esc(p.trainingTitle||'Schulung')}</strong><span>Geöffnet: ${fmtDateTime(p.openedAt)} · Abgeschlossen: ${fmtDateTime(p.completedAt)} · Nachweis: ${esc(p.proofName||'–')}</span></div>${status(p)}</div>`).join(''):'<div class="empty">Für dieses Schulungsjahr ist noch kein Bearbeitungsstand vorhanden.</div>'}</article>`;return
      }
      if(name==='manage')return await manage();
      if(name==='matrix')return await matrix();
      if(name==='proofs')return await proofs();
    }catch(err){
      console.error('Schulungsansicht konnte nicht geladen werden:',err);
      target.innerHTML=`<article class="card"><div class="empty">Die Schulungsdaten konnten nicht geladen werden.<br><small>${esc(err?.message||'Unbekannter Fehler')}</small></div></article>`;
    }
  }

  function bindOwn(){
    if(selectedYear!==new Date().getFullYear()){
      target.querySelectorAll('.download-proof').forEach(b=>b.onclick=async()=>{try{const idToken=await auth.currentUser.getIdToken();const r=await proofUrl({idToken,employeeId:ctx.profile.id,trainingId:b.dataset.id,year:selectedYear});if(r.data?.url)window.open(r.data.url,'_blank','noopener')}catch(e){console.error(e);toast('Nachweis konnte nicht geladen werden.')}});
      return;
    }
    target.querySelectorAll('.open-training').forEach(b=>b.onclick=async()=>{const allPs=await progress(ctx.profile.id),id=trainingProgressDocId(ctx.profile.id,b.dataset.id,selectedYear,allPs),t=(await allTrainings()).find(x=>x.id===b.dataset.id);await setDoc(doc(db,'trainingProgress',id),{userId:ctx.profile.id,trainingId:t.id,trainingTitle:t.title,year:selectedYear,status:'started',openedAt:serverTimestamp()},{merge:true});window.open(b.dataset.url,'_blank','noopener');setTimeout(()=>tab('mine'),400)});
    target.querySelectorAll('.complete-training').forEach(b=>b.onclick=async()=>{const allPs=await progress(ctx.profile.id),t=(await allTrainings()).find(x=>x.id===b.dataset.id),id=trainingProgressDocId(ctx.profile.id,t.id,selectedYear,allPs);await setDoc(doc(db,'trainingProgress',id),{userId:ctx.profile.id,trainingId:t.id,trainingTitle:t.title,year:selectedYear,status:'completed',completedAt:serverTimestamp()},{merge:true});toast(`Schulung für ${selectedYear} abgeschlossen.`);tab('mine')});
    target.querySelectorAll('.proof-file').forEach(i=>i.onchange=async()=>{const f=i.files[0];if(!f)return;if(f.size>10*1024*1024){toast('Maximal 10 MB.');return}const t=(await allTrainings()).find(x=>x.id===i.dataset.id);try{const idToken=await auth.currentUser.getIdToken();const result=await uploadProof({idToken,portalUserId:ctx.profile.id,trainingId:t.id,trainingTitle:t.title,year:selectedYear,fileName:f.name,contentType:f.type,base64Data:await file64(f)}),d=result.data||{},allPs=await progress(ctx.profile.id),id=trainingProgressDocId(ctx.profile.id,t.id,selectedYear,allPs);await setDoc(doc(db,'trainingProgress',id),{userId:ctx.profile.id,trainingId:t.id,trainingTitle:t.title,year:selectedYear,proofPath:d.proofPath||d.path||'',proofName:d.proofName||f.name,proofUploadedAt:serverTimestamp()},{merge:true});toast(`Nachweis für ${selectedYear} hochgeladen.`);tab('mine')}catch(e){console.error(e);toast(e?.message||'Nachweis konnte nicht hochgeladen werden.')}});
    target.querySelectorAll('.download-proof').forEach(b=>b.onclick=async()=>{try{const idToken=await auth.currentUser.getIdToken();const r=await proofUrl({idToken,employeeId:ctx.profile.id,trainingId:b.dataset.id,year:selectedYear});if(r.data?.url)window.open(r.data.url,'_blank','noopener')}catch(e){console.error(e);toast('Nachweis konnte nicht geladen werden.')}})
  }

  async function manage(){
    const ts=await allTrainings();
    target.innerHTML=`<div class="training-year-note"><strong>Schulungsverwaltung</strong><span>Die Schulungsdefinitionen sind jahresunabhängige Stammdaten. Die Jahresauswahl wirkt auf Zuordnungen, Bearbeitungsstände und Nachweise.</span></div><div class="admin-choice-grid"><button class="choice-card active" data-mode="show"><span>▤</span><strong>Schulungen anzeigen</strong><small>Vorhandene Schulungen direkt anzeigen</small></button><button class="choice-card" data-mode="create"><span>＋</span><strong>Schulung anlegen</strong><small>Neue Schulung und Bereichszuordnung</small></button></div><section id="training-show"><article class="card">${ts.length?ts.map(t=>`<div class="list-row"><div><strong>${esc(t.title)}</strong><span>${esc(t.url||'')} · Bereiche ${(t.bereiche||[]).join(', ')||'alle'}</span></div><div class="actions"><button class="btn secondary small edit-training" data-id="${t.id}">Bearbeiten</button><button class="btn danger small del-training" data-id="${t.id}">Löschen</button></div></div>`).join(''):'<div class="empty">Keine Schulungen vorhanden.</div>'}</article></section><section id="training-create" class="hidden"><article class="card"><form id="training-form" class="form-grid"><input type="hidden" name="id"><label class="field full"><span>Titel</span><input name="title" required></label><label class="field full"><span>URL</span><input name="url" type="url" required></label><label class="field"><span>Status</span><select name="active"><option value="true">aktiv</option><option value="false">inaktiv</option></select></label><div class="field full"><span>Bereiche</span><div class="check-grid">${Object.entries(AREA_NAMES).map(([id,n])=>`<label><input name="bereich" type="checkbox" value="${id}"><span><b>Bereich ${id}</b>${esc(n)}</span></label>`).join('')}</div></div><div class="field full actions"><button class="btn primary">Schulung speichern</button><button class="btn secondary" type="button" id="cancel-training">Abbrechen</button></div></form></article></section>`;
    const show=target.querySelector('#training-show'),create=target.querySelector('#training-create'),form=target.querySelector('#training-form');
    function mode(x){show.classList.toggle('hidden',x!=='show');create.classList.toggle('hidden',x!=='create');target.querySelectorAll('.choice-card').forEach(b=>b.classList.toggle('active',b.dataset.mode===x))}
    target.querySelectorAll('.choice-card').forEach(b=>b.onclick=()=>{if(b.dataset.mode==='create')form.reset();mode(b.dataset.mode)});target.querySelector('#cancel-training').onclick=()=>mode('show');
    target.querySelectorAll('.edit-training').forEach(b=>b.onclick=()=>{const t=ts.find(x=>x.id===b.dataset.id);form.elements.id.value=t.id;form.elements.title.value=t.title||'';form.elements.url.value=t.url||'';form.elements.active.value=String(t.active!==false);form.querySelectorAll('[name=bereich]').forEach(x=>x.checked=(t.bereiche||[]).includes(x.value));mode('create')});
    target.querySelectorAll('.del-training').forEach(b=>b.onclick=async()=>{if(confirm('Schulung wirklich löschen?')){await deleteDoc(doc(db,'trainings',b.dataset.id));manage()}});
    form.onsubmit=async e=>{e.preventDefault();const id=form.elements.id.value,d={title:form.elements.title.value.trim(),url:form.elements.url.value.trim(),active:form.elements.active.value==='true',bereiche:[...form.querySelectorAll('[name=bereich]:checked')].map(x=>x.value),updatedAt:serverTimestamp()};if(id)await updateDoc(doc(db,'trainings',id),d);else await addDoc(collection(db,'trainings'),{...d,createdAt:serverTimestamp()});toast('Schulung gespeichert.');manage()}
  }

  async function relevantUsers(){
    if(ctx.profile.role==='admin'&&!canOverview)throw new Error('Keine Berechtigung für Schulungsübersichten.');
    if(supervisor){const teamSnap=await getDocs(query(collection(db,'users'),where('supervisorId','==',ctx.profile.id)));return teamSnap.docs.map(d=>({id:d.id,...d.data()})).filter(u=>u.active!==false&&u.id!==ctx.profile.id)}
    const snap=await getDocs(collection(db,'users'));return snap.docs.map(d=>({id:d.id,...d.data()})).filter(u=>u.active!==false&&u.archived!==true&&(u.role==='employee'||u.role==='supervisor'))
  }

  async function proofs(){
    const us=await relevantUsers();
    target.innerHTML=`<article class="card"><div class="card-head"><div><h2>Nachweise je Mitarbeiter · ${selectedYear}</h2><p>Bearbeitungsstände und vorhandene Schulungsnachweise des gewählten Jahres</p></div></div><div id="proof-list"></div></article>`;
    const box=target.querySelector('#proof-list');
    for(const u of us){const ps=progressForTrainingYear(await progress(u.id),selectedYear);box.insertAdjacentHTML('beforeend',`<div class="employee-proof-block"><div class="employee-proof-head"><strong>${esc(u.name||u.email)}</strong><button class="btn secondary small all-proofs" data-id="${u.id}">Alle Nachweise ${selectedYear}</button></div>${ps.length?ps.map(p=>`<div class="list-row"><div><strong>${esc(p.trainingTitle||'Schulung')}</strong><span>${p.proofName?`Nachweis: ${esc(p.proofName)}`:'Kein Nachweis'}</span></div>${p.proofPath?`<button class="btn secondary small one-proof" data-user="${u.id}" data-training="${p.trainingId}">Download</button>`:''}</div>`).join(''):'<div class="muted small">Noch keine Bearbeitungsstände in diesem Jahr.</div>'}</div>`)}
    box.querySelectorAll('.one-proof').forEach(b=>b.onclick=async()=>{try{const idToken=await auth.currentUser.getIdToken();const r=await proofUrl({idToken,employeeId:b.dataset.user,trainingId:b.dataset.training,year:selectedYear});if(r.data?.url)window.open(r.data.url,'_blank','noopener')}catch(e){console.error(e);toast('Download nicht möglich.')}});
    box.querySelectorAll('.all-proofs').forEach(b=>b.onclick=async()=>{try{const idToken=await auth.currentUser.getIdToken();const r=await employeeProofs({idToken,employeeId:b.dataset.id,year:selectedYear});for(const f of r.data?.files||[])window.open(f.url,'_blank','noopener')}catch(e){console.error(e);toast('Sammeldownload nicht möglich.')}})
  }

  async function matrix(){
    const [ts,us]=await Promise.all([allTrainings(),relevantUsers()]),pmap={};
    for(const u of us)pmap[u.id]=progressForTrainingYear(await progress(u.id),selectedYear);
    target.innerHTML=`<article class="card"><div class="card-head"><div><h2>Tabellarische Schulungsübersicht · ${selectedYear}</h2><p>Zuordnung und Bearbeitungsstand je Mitarbeiter für das gewählte Schulungsjahr</p></div></div><div class="table-wrap"><table class="matrix"><thead><tr><th>Mitarbeiter</th>${ts.map(t=>`<th>${esc(t.title)}</th>`).join('')}</tr></thead><tbody>${us.map(u=>`<tr><td><strong>${esc(u.name||u.email)}</strong></td>${ts.map(t=>{const assigned=visibleTrainingsForYear([t],u,selectedYear).length>0,p=(pmap[u.id]||[]).find(x=>x.trainingId===t.id);return`<td class="${!assigned?'matrix-na':p?.status==='completed'||p?.status==='abgeschlossen'?'matrix-completed':p?'matrix-started':'matrix-open'}">${!assigned?'–':p?.status==='completed'||p?.status==='abgeschlossen'?'✓':p?'◐':'!'}</td>`}).join('')}</tr>`).join('')}</tbody></table></div></article>`
  }

  el.querySelectorAll('.subnav-btn').forEach(b=>b.onclick=()=>tab(b.dataset.tab));
  yearSelect.onchange=()=>{selectedYear=Number(yearSelect.value)||new Date().getFullYear();if(activeTab!=='manage'||canOverview)tab(activeTab)};
  if(admin){if(canOverview)await tab('proofs');else if(canManage)await tab('manage');else target.innerHTML='<article class="card"><div class="empty">Für diesen Admin-Zugang ist keine Schulungsübersicht oder Schulungsverwaltung freigeschaltet.</div></article>'}else await tab('mine');
}
