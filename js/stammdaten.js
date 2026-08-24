import { db } from "./firebase.js";
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setHead } from "./app.js";
import { esc, toast } from "./utils.js";

function sortByName(items){return [...items].sort((a,b)=>(a.name||"").localeCompare(b.name||"",'de'))}

export async function renderStammdaten(el,ctx){
  setHead("Stammdaten","Zentrale Auswahllisten für die Mitarbeiterkartei pflegen.");
  if(ctx.profile?.role!=="admin"){
    el.innerHTML='<div class="error-card">Dieser Bereich ist ausschließlich für die Personalabteilung / Admins vorgesehen.</div>';
    return;
  }
  const [hSnap,bSnap,rSnap]=await Promise.all([
    getDocs(collection(db,"healthInsurers")),
    getDocs(collection(db,"banks")),
    getDocs(collection(db,"religionTaxCodes"))
  ]);
  const insurers=sortByName(hSnap.docs.map(d=>({id:d.id,...d.data()})));
  const banks=sortByName(bSnap.docs.map(d=>({id:d.id,...d.data()})));
  const religions=[...rSnap.docs.map(d=>({id:d.id,...d.data()}))].sort((a,b)=>String(a.code||a.name||"").localeCompare(String(b.code||b.name||""),'de'));

  el.innerHTML=`<div class="admin-choice-grid">
    <button class="choice-card active" data-tab="health"><span>✚</span><strong>Krankenkassen</strong><small>${insurers.length} Einträge verwalten</small></button>
    <button class="choice-card" data-tab="banks"><span>▤</span><strong>Banken</strong><small>${banks.length} Einträge verwalten</small></button>
    <button class="choice-card" data-tab="religion"><span>◇</span><strong>Religion / Kirchensteuer</strong><small>${religions.length} Einträge verwalten</small></button>
  </div>
  <section id="master-health"><article class="card"><div class="card-head"><div><h2>Krankenkassen</h2><p>Diese Einträge stehen in der Mitarbeiterkartei als Dropdown zur Verfügung.</p></div></div>
    <form id="health-form" class="form-grid master-inline"><input type="hidden" name="id"><label class="field"><span>Name der Krankenkasse</span><input name="name" required></label><label class="field"><span>Betriebsnummer / Kennung</span><input name="code"></label><label class="field"><span>Status</span><select name="active"><option value="true">aktiv</option><option value="false">inaktiv</option></select></label><div class="field actions"><button class="btn primary">Speichern</button><button class="btn secondary" type="button" id="health-cancel">Leeren</button></div></form>
    <div class="table-wrap"><table><thead><tr><th>Krankenkasse</th><th>Betriebsnummer / Kennung</th><th>Status</th><th></th></tr></thead><tbody>${insurers.length?insurers.map(x=>`<tr><td><strong>${esc(x.name)}</strong></td><td>${esc(x.code||'–')}</td><td><span class="pill ${x.active===false?'red':'green'}">${x.active===false?'inaktiv':'aktiv'}</span></td><td class="actions"><button class="btn secondary small edit-health" data-id="${x.id}">Bearbeiten</button><button class="btn danger small delete-health" data-id="${x.id}">Löschen</button></td></tr>`).join(''):'<tr><td colspan="4" class="empty">Noch keine Krankenkassen hinterlegt.</td></tr>'}</tbody></table></div>
  </article></section>
  <section id="master-banks" class="hidden"><article class="card"><div class="card-head"><div><h2>Banken</h2><p>Bankname und BIC können zentral gepflegt werden.</p></div></div>
    <form id="bank-form" class="form-grid master-inline"><input type="hidden" name="id"><label class="field"><span>Bankname</span><input name="name" required></label><label class="field"><span>BIC</span><input name="bic" maxlength="11"></label><label class="field"><span>Status</span><select name="active"><option value="true">aktiv</option><option value="false">inaktiv</option></select></label><div class="field actions"><button class="btn primary">Speichern</button><button class="btn secondary" type="button" id="bank-cancel">Leeren</button></div></form>
    <div class="table-wrap"><table><thead><tr><th>Bank</th><th>BIC</th><th>Status</th><th></th></tr></thead><tbody>${banks.length?banks.map(x=>`<tr><td><strong>${esc(x.name)}</strong></td><td>${esc(x.bic||'–')}</td><td><span class="pill ${x.active===false?'red':'green'}">${x.active===false?'inaktiv':'aktiv'}</span></td><td class="actions"><button class="btn secondary small edit-bank" data-id="${x.id}">Bearbeiten</button><button class="btn danger small delete-bank" data-id="${x.id}">Löschen</button></td></tr>`).join(''):'<tr><td colspan="4" class="empty">Noch keine Banken hinterlegt.</td></tr>'}</tbody></table></div>
  </article></section>
  <section id="master-religion" class="hidden"><article class="card"><div class="card-head"><div><h2>Religion / Kirchensteuer</h2><p>Abrechnungsrelevante Schlüssel können von der Personalabteilung selbst gepflegt werden.</p></div></div>
    <form id="religion-form" class="form-grid master-inline"><input type="hidden" name="id"><label class="field"><span>Schlüssel</span><input name="code" maxlength="20" required placeholder="z. B. ev"></label><label class="field"><span>Bezeichnung</span><input name="name" required placeholder="z. B. Evangelisch"></label><label class="field"><span>Status</span><select name="active"><option value="true">aktiv</option><option value="false">inaktiv</option></select></label><div class="field actions"><button class="btn primary">Speichern</button><button class="btn secondary" type="button" id="religion-cancel">Leeren</button></div></form>
    <div class="info-strip">Die Schlüssel werden nicht fest im Programm vorgegeben. Sobald die endgültigen PDS-/Abrechnungsvorgaben feststehen, können hier exakt die benötigten Werte gepflegt werden.</div>
    <div class="table-wrap"><table><thead><tr><th>Schlüssel</th><th>Bezeichnung</th><th>Status</th><th></th></tr></thead><tbody>${religions.length?religions.map(x=>`<tr><td><strong>${esc(x.code||'–')}</strong></td><td>${esc(x.name||'–')}</td><td><span class="pill ${x.active===false?'red':'green'}">${x.active===false?'inaktiv':'aktiv'}</span></td><td class="actions"><button class="btn secondary small edit-religion" data-id="${x.id}">Bearbeiten</button><button class="btn danger small delete-religion" data-id="${x.id}">Löschen</button></td></tr>`).join(''):'<tr><td colspan="4" class="empty">Noch keine Religions-/Kirchensteuerschlüssel hinterlegt.</td></tr>'}</tbody></table></div>
  </article></section>`;

  const healthSection=el.querySelector('#master-health'),bankSection=el.querySelector('#master-banks'),religionSection=el.querySelector('#master-religion');
  function tab(name){healthSection.classList.toggle('hidden',name!=='health');bankSection.classList.toggle('hidden',name!=='banks');religionSection.classList.toggle('hidden',name!=='religion');el.querySelectorAll('.choice-card').forEach(b=>b.classList.toggle('active',b.dataset.tab===name))}
  el.querySelectorAll('.choice-card').forEach(b=>b.onclick=()=>tab(b.dataset.tab));

  const healthForm=el.querySelector('#health-form');
  const resetHealth=()=>healthForm.reset();
  el.querySelector('#health-cancel').onclick=resetHealth;
  el.querySelectorAll('.edit-health').forEach(b=>b.onclick=()=>{const x=insurers.find(v=>v.id===b.dataset.id);healthForm.elements.id.value=x.id;healthForm.elements.name.value=x.name||'';healthForm.elements.code.value=x.code||'';healthForm.elements.active.value=String(x.active!==false);healthForm.scrollIntoView({behavior:'smooth',block:'start'})});
  el.querySelectorAll('.delete-health').forEach(b=>b.onclick=async()=>{if(!confirm('Krankenkasse wirklich löschen? Bereits gespeicherte Mitarbeiterdaten bleiben als ID erhalten.'))return;await deleteDoc(doc(db,'healthInsurers',b.dataset.id));toast('Krankenkasse gelöscht.');renderStammdaten(el,ctx)});
  healthForm.onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,id=f.elements.id.value,data={name:f.elements.name.value.trim(),code:f.elements.code.value.trim(),active:f.elements.active.value==='true',updatedAt:serverTimestamp()};if(id)await updateDoc(doc(db,'healthInsurers',id),data);else await addDoc(collection(db,'healthInsurers'),{...data,createdAt:serverTimestamp()});toast('Krankenkasse gespeichert.');renderStammdaten(el,ctx)};

  const bankForm=el.querySelector('#bank-form');
  const resetBank=()=>bankForm.reset();
  el.querySelector('#bank-cancel').onclick=resetBank;
  el.querySelectorAll('.edit-bank').forEach(b=>b.onclick=()=>{const x=banks.find(v=>v.id===b.dataset.id);bankForm.elements.id.value=x.id;bankForm.elements.name.value=x.name||'';bankForm.elements.bic.value=x.bic||'';bankForm.elements.active.value=String(x.active!==false);bankForm.scrollIntoView({behavior:'smooth',block:'start'})});
  el.querySelectorAll('.delete-bank').forEach(b=>b.onclick=async()=>{if(!confirm('Bank wirklich löschen? Bereits gespeicherte Mitarbeiterdaten bleiben als ID erhalten.'))return;await deleteDoc(doc(db,'banks',b.dataset.id));toast('Bank gelöscht.');renderStammdaten(el,ctx)});
  bankForm.onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,id=f.elements.id.value,data={name:f.elements.name.value.trim(),bic:f.elements.bic.value.trim().toUpperCase(),active:f.elements.active.value==='true',updatedAt:serverTimestamp()};if(id)await updateDoc(doc(db,'banks',id),data);else await addDoc(collection(db,'banks'),{...data,createdAt:serverTimestamp()});toast('Bank gespeichert.');renderStammdaten(el,ctx)};

  const religionForm=el.querySelector('#religion-form');
  const resetReligion=()=>religionForm.reset();
  el.querySelector('#religion-cancel').onclick=resetReligion;
  el.querySelectorAll('.edit-religion').forEach(b=>b.onclick=()=>{const x=religions.find(v=>v.id===b.dataset.id);religionForm.elements.id.value=x.id;religionForm.elements.code.value=x.code||'';religionForm.elements.name.value=x.name||'';religionForm.elements.active.value=String(x.active!==false);religionForm.scrollIntoView({behavior:'smooth',block:'start'})});
  el.querySelectorAll('.delete-religion').forEach(b=>b.onclick=async()=>{if(!confirm('Religions-/Kirchensteuerschlüssel wirklich löschen? Bereits gespeicherte Mitarbeiterwerte bleiben erhalten.'))return;await deleteDoc(doc(db,'religionTaxCodes',b.dataset.id));toast('Religions-/Kirchensteuerschlüssel gelöscht.');renderStammdaten(el,ctx)});
  religionForm.onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,id=f.elements.id.value,code=f.elements.code.value.trim().toLowerCase(),name=f.elements.name.value.trim();if(!code||!name){toast('Schlüssel und Bezeichnung sind erforderlich.','error');return;}const duplicate=religions.find(x=>x.id!==id&&String(x.code||'').trim().toLowerCase()===code);if(duplicate){toast('Dieser Schlüssel ist bereits vorhanden.','error');return;}const data={code,name,active:f.elements.active.value==='true',updatedAt:serverTimestamp()};if(id)await updateDoc(doc(db,'religionTaxCodes',id),data);else await addDoc(collection(db,'religionTaxCodes'),{...data,createdAt:serverTimestamp()});toast('Religion / Kirchensteuer gespeichert.');renderStammdaten(el,ctx)};
}
