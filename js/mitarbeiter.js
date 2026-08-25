import { firebaseConfig, db } from "./firebase.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { initializeAuth, inMemoryPersistence, createUserWithEmailAndPassword, deleteUser, signOut as secondarySignOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { collection, getDocs, doc, serverTimestamp, writeBatch, updateDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setHead } from "./app.js";
import { AREA_NAMES, esc, syntheticEmail, ROLE_LABELS, toast } from "./utils.js";
import { renderPersonalakte } from "./personalakte.js";
import { ADMIN_PERMISSION_DEFS, DEFAULT_ADMIN_PERMISSIONS, hasAdminPermission, hasAnyAdminPermission, normalizedAdminPermissions } from "./permissions.js";

const PUBLIC_HISTORY_FIELDS=[
  "name","companyId","email","username","hasRealEmail","role","adminPermissions","supervisorId","active","startDate","endDate","weeklyHours","vacationDays","employeeNumber","businessAreaId","projectTimeTracking","department","position","contractType","probationEndDate","fixedTermEndDate","costCenter","workDays","firstAider","firstAiderValidUntil","fireWarden","fireWardenValidUntil","forkliftPermit","forkliftPermitValidUntil","aerialLiftPermit","aerialLiftPermitValidUntil","drivingLicenseClasses","nextDrivingLicenseCheck","occupationalMedicalNotes","bereiche","extraTrainings"
];
const PRIVATE_HISTORY_FIELDS=[
  "birthDate","street","postalCode","city","privateEmail","phone","mobile","emergencyContactName","emergencyContactPhone","taxId","taxClass","childAllowance","religion","socialSecurityNumber","healthInsuranceId","insuranceType","personGroup","contributionGroup","iban","bic","bankId","accountHolder","compensationType","grossSalary","hourlyRate","salaryValidFrom"
];
function comparable(value){if(Array.isArray(value))return [...value].map(String).sort();return value??null}
function sameValue(a,b){return JSON.stringify(comparable(a))===JSON.stringify(comparable(b))}
const REDACTED_HISTORY_FIELDS=new Set(["taxId","socialSecurityNumber","iban"]);
function historyValue(field,value){if(REDACTED_HISTORY_FIELDS.has(field))return value?"[hinterlegt]":"[leer]";return comparable(value)}
function changesFor(fields,before,after,prefix=""){return fields.filter(field=>!sameValue(before?.[field],after?.[field])).map(field=>({field:`${prefix}${field}`,oldValue:historyValue(field,before?.[field]),newValue:historyValue(field,after?.[field])}))}
function historyRecord(ctx,employeeId,employee,action,changes=[]){return {employeeId,employeeName:employee.name||"",employeeEmail:employee.hasRealEmail===false?(employee.username||""):(employee.email||""),action,changes,actorId:ctx.user?.uid||"",actorName:ctx.profile?.name||"",actorEmail:ctx.profile?.email||ctx.user?.email||"",createdAt:serverTimestamp()}}
async function createAuthAccount(email,password){
  const name=`creator-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const app=initializeApp(firebaseConfig,name);
  const auth=initializeAuth(app,{persistence:inMemoryPersistence});
  const cred=await createUserWithEmailAndPassword(auth,email,password);
  return {uid:cred.user.uid,user:cred.user,auth,app};
}
async function closeSecondaryAuth(handle,{rollback=false}={}){
  if(!handle)return;
  try{if(rollback&&handle.user)await deleteUser(handle.user)}catch(err){console.error("Rollback des Authentication-Benutzers fehlgeschlagen",err)}
  try{await secondarySignOut(handle.auth)}catch(_){}
  try{await deleteApp(handle.app)}catch(_){}
}
function opt(value,label){return `<option value="${esc(value)}">${esc(label)}</option>`}
function section(icon,title,text,body,extraClass=""){return `<section class="employee-section ${extraClass}"><div class="employee-section-head"><span class="employee-section-icon">${icon}</span><div><h3>${title}</h3><p>${text}</p></div></div><div class="form-grid">${body}</div></section>`}
function setVal(form,name,value){const field=form.elements[name];if(!field)return;const normalized=value??'';if(field.tagName==='SELECT'&&normalized!==''&&![...field.options].some(o=>o.value===String(normalized))){field.add(new Option(String(normalized),String(normalized)));}field.value=normalized}
function boolVal(form,name,value){setVal(form,name,String(value===true))}
function numberOrNull(v){const s=String(v??'').trim();return s===''?null:Number(s)}

export async function renderMitarbeiter(el,ctx){
  setHead("Mitarbeiter","Digitale Mitarbeiterkartei, Zugang, Organisation, Arbeitssicherheit und Personalakte verwalten.");
  const canView=hasAdminPermission(ctx.profile,'employeesView');
  const canCreate=hasAdminPermission(ctx.profile,'employeesCreate');
  const canEdit=hasAdminPermission(ctx.profile,'employeesEdit');
  const canDelete=hasAdminPermission(ctx.profile,'employeesDelete');
  const canManageDocs=hasAdminPermission(ctx.profile,'personnelDocuments');
  const canManagePermissions=hasAdminPermission(ctx.profile,'permissionsManage');
  if(!hasAnyAdminPermission(ctx.profile,['employeesView','employeesCreate','employeesEdit','employeesDelete'])){
    el.innerHTML='<div class="error-card">Für diesen Admin-Zugang ist keine Berechtigung zur Mitarbeiterverwaltung freigeschaltet.</div>';
    return;
  }
  const [uSnap,cSnap,tSnap,pSnap,hSnap,bSnap,rSnap,aSnap]=await Promise.all([
    getDocs(collection(db,'users')),getDocs(collection(db,'companies')),getDocs(collection(db,'trainings')),(canView||canEdit?getDocs(collection(db,'employeePrivate')):Promise.resolve({docs:[]})),getDocs(collection(db,'healthInsurers')),getDocs(collection(db,'banks')),getDocs(collection(db,'religionTaxCodes')),getDocs(collection(db,'businessAreas'))
  ]);
  const users=uSnap.docs.map(d=>({id:d.id,...d.data()})),activeUsers=users.filter(u=>u.archived!==true),companies=cSnap.docs.map(d=>({id:d.id,...d.data()})),trainings=tSnap.docs.map(d=>({id:d.id,...d.data()}));
  const privateMap=new Map(pSnap.docs.map(d=>[d.id,{id:d.id,...d.data()}]));
  const insurers=hSnap.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.active!==false).sort((a,b)=>(a.name||'').localeCompare(b.name||'','de'));
  const banks=bSnap.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.active!==false).sort((a,b)=>(a.name||'').localeCompare(b.name||'','de'));
  const religions=rSnap.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.active!==false).sort((a,b)=>String(a.code||a.name||'').localeCompare(String(b.code||b.name||''),'de'));
  const supervisors=activeUsers.filter(u=>u.role==='supervisor'||u.role==='admin');
  const businessAreas=aSnap.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.active!==false).sort((a,b)=>String(a.code||'').localeCompare(String(b.code||''),'de'));
  const businessAreaMap=new Map(businessAreas.map(x=>[x.id,x]));

  const personalBody=`
    <label class="field"><span>Name</span><input name="name" required></label><label class="field"><span>Geburtsdatum</span><input name="birthDate" type="date"></label>
    <label class="field full"><span>Straße / Hausnummer</span><input name="street"></label><label class="field"><span>PLZ</span><input name="postalCode" inputmode="numeric"></label><label class="field"><span>Ort</span><input name="city"></label>
    <label class="field"><span>Private E-Mail</span><input name="privateEmail" type="email"></label><label class="field"><span>Telefon</span><input name="phone" type="tel"></label><label class="field"><span>Mobil</span><input name="mobile" type="tel"></label><div></div>
    <label class="field"><span>Notfallkontakt</span><input name="emergencyContactName"></label><label class="field"><span>Telefon Notfallkontakt</span><input name="emergencyContactPhone" type="tel"></label>`;

  const employmentBody=`
    <label class="field"><span>Firma</span><select name="companyId" required><option value="">– auswählen –</option>${companies.map(c=>opt(c.id,`${c.name}${c.companyNumber?` · ${c.companyNumber}`:''}`)).join('')}</select></label><label class="field"><span>Mitarbeiternummer</span><input name="employeeNumber" inputmode="numeric" maxlength="5" pattern="[0-9]{5}" placeholder="5-stellig, z. B. 40190" required></label>
    <label class="field"><span>Geschäftsbereich</span><select name="businessAreaId" required><option value="">– auswählen –</option>${businessAreas.map(a=>opt(a.id,`${a.code} · ${a.name}`)).join('')}</select></label><label class="field"><span>Abteilung</span><input name="department"></label>
    <label class="field"><span>Position / Tätigkeit</span><input name="position"></label><label class="field"><span>Kostenstelle</span><input name="costCenter"></label>
    <label class="field"><span>Vorgesetzter</span><select name="supervisorId"><option value="">Kein Vorgesetzter</option>${supervisors.map(u=>opt(u.id,u.name||u.email)).join('')}</select></label><label class="field"><span>Beschäftigungsart</span><select name="contractType"><option value="">– auswählen –</option><option>Vollzeit</option><option>Teilzeit</option><option>Minijob</option><option>Werkstudent</option><option>Ausbildung</option><option>Befristet</option><option>Sonstiges</option></select></label>
    <label class="field"><span>Eintritt</span><input name="startDate" type="date"></label><label class="field"><span>Austritt</span><input name="endDate" type="date"></label><label class="field"><span>Probezeit bis</span><input name="probationEndDate" type="date"></label><label class="field"><span>Befristung bis</span><input name="fixedTermEndDate" type="date"></label>`;

  const taxBody=`
    <label class="field"><span>Steuer-ID</span><input name="taxId" autocomplete="off"></label><label class="field"><span>Steuerklasse</span><select name="taxClass"><option value="">– auswählen –</option>${['I','II','III','IV','IV mit Faktor','V','VI'].map(x=>opt(x,x)).join('')}</select></label>
    <label class="field"><span>Kinderfreibetrag</span><input name="childAllowance" type="number" step="0.5" min="0"></label><label class="field"><span>Religion / Kirchensteuer</span><select name="religion"><option value="">– auswählen –</option>${religions.map(x=>opt(x.code,`${x.code} · ${x.name}`)).join('')}</select></label>
    <label class="field"><span>Sozialversicherungsnummer</span><input name="socialSecurityNumber" autocomplete="off"></label><label class="field"><span>Krankenkasse</span><select name="healthInsuranceId"><option value="">– auswählen –</option>${insurers.map(x=>opt(x.id,`${x.name}${x.code?` · ${x.code}`:''}`)).join('')}</select></label>
    <label class="field"><span>Versicherungsart</span><select name="insuranceType"><option value="">– auswählen –</option><option>gesetzlich pflichtversichert</option><option>gesetzlich freiwillig</option><option>privat versichert</option><option>familienversichert</option><option>sonstiges</option></select></label><label class="field"><span>Personengruppe</span><input name="personGroup" placeholder="z. B. 101"></label>
    <label class="field"><span>Beitragsgruppe</span><input name="contributionGroup" placeholder="optional"></label>`;

  const bankBody=`
    <label class="field full"><span>IBAN</span><input name="iban" autocomplete="off"></label><label class="field"><span>Bank</span><select name="bankId"><option value="">– auswählen –</option>${banks.map(x=>opt(x.id,`${x.name}${x.bic?` · ${x.bic}`:''}`)).join('')}</select></label><label class="field"><span>BIC</span><input name="bic" maxlength="11"></label><label class="field full"><span>Kontoinhaber</span><input name="accountHolder"></label>`;

  const salaryBody=`
    <label class="field"><span>Entgeltart</span><select name="compensationType"><option value="">– auswählen –</option><option value="salary">Monatsgehalt</option><option value="hourly">Stundenlohn</option></select></label><label class="field"><span>Gültig ab</span><input name="salaryValidFrom" type="date"></label><label class="field"><span>Bruttogehalt / Monat (€)</span><input name="grossSalary" type="number" step="0.01" min="0"></label><label class="field"><span>Stundenlohn (€)</span><input name="hourlyRate" type="number" step="0.01" min="0"></label>`;

  const timeBody=`
    <label class="field"><span>Wochenstunden</span><input name="weeklyHours" type="number" step="0.25" value="40"></label><label class="field"><span>Urlaubstage/Jahr</span><input name="vacationDays" type="number" step="1" value="30"></label><label class="field"><span>Zeiterfassung auf Projekte</span><select name="projectTimeTracking"><option value="false">Nein</option><option value="true">Ja</option></select></label><div></div>
    <div class="field full"><span>Regelmäßige Arbeitstage</span><div class="weekday-grid">${[['1','Mo'],['2','Di'],['3','Mi'],['4','Do'],['5','Fr'],['6','Sa'],['0','So']].map(([v,l])=>`<label><input type="checkbox" name="workDay" value="${v}" ${['1','2','3','4','5'].includes(v)?'checked':''}><span>${l}</span></label>`).join('')}</div></div>`;

  const safetyBody=`
    <label class="field safety-toggle"><span>Ersthelfer</span><select name="firstAider"><option value="false">Nein</option><option value="true">Ja</option></select></label><label class="field"><span>gültig / Auffrischung bis</span><input name="firstAiderValidUntil" type="date"></label>
    <label class="field safety-toggle"><span>Brandschutzhelfer</span><select name="fireWarden"><option value="false">Nein</option><option value="true">Ja</option></select></label><label class="field"><span>gültig / Auffrischung bis</span><input name="fireWardenValidUntil" type="date"></label>
    <label class="field safety-toggle"><span>Staplerschein</span><select name="forkliftPermit"><option value="false">Nein</option><option value="true">Ja</option></select></label><label class="field"><span>gültig bis</span><input name="forkliftPermitValidUntil" type="date"></label>
    <label class="field safety-toggle"><span>Hubarbeitsbühne</span><select name="aerialLiftPermit"><option value="false">Nein</option><option value="true">Ja</option></select></label><label class="field"><span>gültig bis</span><input name="aerialLiftPermitValidUntil" type="date"></label>
    <label class="field"><span>Führerscheinklassen</span><input name="drivingLicenseClasses" placeholder="z. B. B, BE, C1"></label><label class="field"><span>Nächste Führerscheinkontrolle</span><input name="nextDrivingLicenseCheck" type="date"></label>
    <label class="field full"><span>Arbeitsmedizinische Vorsorgen / Hinweise</span><textarea name="occupationalMedicalNotes" placeholder="z. B. G25, G41 bzw. interne Bezeichnung und Gültigkeit"></textarea></label>`;

  const trainingBody=`<div class="field full"><span>Schulungsbereiche</span><div class="check-grid">${Object.entries(AREA_NAMES).map(([id,n])=>`<label><input type="checkbox" name="bereich" value="${id}"><span><b>Bereich ${id}</b>${esc(n)}</span></label>`).join('')}</div></div><div class="field full"><span>Individuelle Zusatzschulungen</span><div class="check-grid compact">${trainings.length?trainings.map(t=>`<label><input type="checkbox" name="extraTraining" value="${t.id}"><span>${esc(t.title)}</span></label>`).join(''):'<div class="muted">Noch keine Schulungen vorhanden.</div>'}</div></div>`;

  const permissionGroups=[...new Set(ADMIN_PERMISSION_DEFS.map(x=>x.group))];
  const adminPermissionBody=`<div class="field full admin-permissions-box" id="admin-permissions-box"><span>Admin-Berechtigungen</span><p class="muted small">Nur bei Rolle „Personalabteilung / Admin“. Bestehende Admins besitzen nach dem Update zunächst alle Rechte.</p>${permissionGroups.map(group=>`<div class="permission-group"><strong>${esc(group)}</strong><div class="permission-grid">${ADMIN_PERMISSION_DEFS.filter(x=>x.group===group).map(x=>`<label><input type="checkbox" name="adminPermission" value="${x.key}" checked><span>${esc(x.label)}</span></label>`).join('')}</div></div>`).join('')}</div>`;
  const systemBody=`
    <label class="field"><span>Login-Art</span><select name="loginType"><option value="email">E-Mail-Adresse</option><option value="username">Benutzername</option></select></label><label class="field"><span>E-Mail / Benutzername</span><input name="login" required></label><label class="field"><span>Startpasswort</span><input name="password" type="text" placeholder="nur bei Neuanlage"></label><label class="field"><span>Rolle</span><select name="role"><option value="employee">Mitarbeiter</option><option value="supervisor">Vorgesetzter</option><option value="admin">Personalabteilung / Admin</option></select></label><label class="field"><span>Status</span><select name="active"><option value="true">aktiv</option><option value="false">inaktiv</option></select></label>${adminPermissionBody}`;

  el.innerHTML=`<div class="admin-choice-grid">${(canView||canEdit||canDelete)?`<button class="choice-card active" data-tab="show"><span>♙</span><strong>Benutzer anzeigen</strong><small>Alle vorhandenen Mitarbeiter direkt anzeigen</small></button>`:''}${canCreate?`<button class="choice-card ${(canView||canEdit||canDelete)?'':'active'}" data-tab="create"><span>＋</span><strong>Benutzer anlegen</strong><small>Neue Mitarbeiterkartei und Zugang anlegen</small></button>`:''}</div>
  <section id="user-show"><article class="card"><div class="card-head"><div><h2>Benutzerübersicht</h2><p>${activeUsers.length} aktive Benutzer vorhanden</p></div></div><div class="table-wrap"><table><thead><tr><th>Name</th><th>Mitarb.-Nr.</th><th>Firma</th><th>Abteilung / Bereich</th><th>Rolle</th><th>Login</th><th>Status</th><th></th></tr></thead><tbody>${activeUsers.length?activeUsers.sort((a,b)=>(a.name||'').localeCompare(b.name||'')).map(u=>`<tr><td><strong>${esc(u.name||'')}</strong><div class="small muted">${esc(u.position||'')}</div></td><td>${esc(u.employeeNumber||'–')}</td><td>${esc(companies.find(c=>c.id===u.companyId)?.short||companies.find(c=>c.id===u.companyId)?.name||'–')}</td><td>${esc(u.department||(businessAreaMap.get(u.businessAreaId)?.code&&`${businessAreaMap.get(u.businessAreaId).code} · ${businessAreaMap.get(u.businessAreaId).name}`)||u.companyAreaNumber||'–')}</td><td>${esc(ROLE_LABELS[u.role]||u.role||'–')}</td><td>${esc(u.hasRealEmail===false?(u.username||'Benutzername'):(u.email||'–'))}</td><td><span class="pill ${u.active===false?'red':'green'}">${u.active===false?'inaktiv':'aktiv'}</span></td><td><div class="actions">${(canView||canEdit)?`<button class="btn secondary small edit-user" data-id="${u.id}">${canEdit?'Mitarbeiterkartei':'Anzeigen'}</button>`:''}${canDelete&&u.id!==ctx.profile.id?`<button class="btn danger small remove-user" data-id="${u.id}">Entfernen</button>`:""}</div></td></tr>`).join(''):`<tr><td colspan="8" class="empty">Noch keine Benutzer angelegt.</td></tr>`}</tbody></table></div></article></section>
  <section id="user-create" class="hidden"><form id="user-form" class="employee-file"><input type="hidden" name="id">
    <div class="employee-file-head"><div><span class="eyebrow">Digitale Mitarbeiterkartei</span><h2 id="employee-form-title">Mitarbeiter anlegen</h2><p>Die Bereiche sind fachlich getrennt. Sensible Steuer-, Bank- und Entgeltdaten sind besonders geschützt.</p></div><div class="employee-file-actions"><button class="btn primary" type="submit">Mitarbeiter speichern</button><button class="btn secondary" id="cancel-user" type="button">Abbrechen</button></div></div>
    ${section('⌂','Persönliche Daten & Kontakt','Kontaktdaten und Notfallkontakt.',personalBody)}
    ${section('▦','Beschäftigung & Organisation','Zuordnung im Unternehmen und Vertragsrahmen.',employmentBody)}
    ${section('§','Steuer & Sozialversicherung','Nur Personalabteilung/Admin und der Mitarbeiter selbst können diese Daten lesen.',taxBody,'sensitive-section')}
    ${section('€','Bankverbindung','Geschützte Zahlungsdaten des Mitarbeiters.',bankBody,'sensitive-section')}
    ${section('↗','Lohn & Gehalt','Grunddaten zur Vergütung. Eine zeitliche Gehaltsentwicklung kann später ergänzt werden.',salaryBody,'sensitive-section')}
    ${section('◷','Urlaub & Arbeitszeit','Arbeitszeitmodell, Urlaub und Projektzeiterfassung.',timeBody)}
    ${section('⚑','Arbeitssicherheit & Befähigungen','Qualifikationen, Befähigungen und fällige Kontrollen.',safetyBody,'safety-section')}
    ${section('▤','Schulungen','Bereichsschulungen und individuelle Zusatzschulungen.',trainingBody)}
    ${section('⚙','System & Berechtigungen','Login, Rolle und Kontostatus.',systemBody)}
    <section class="employee-section documents-section"><div class="employee-section-head"><span class="employee-section-icon">▧</span><div><h3>Digitale Personalakte</h3><p>Verträge, Bescheinigungen, Zeugnisse, Zertifikate und weitere Personaldokumente.</p></div></div><div id="personalakte-container"></div></section>
    <div class="employee-savebar"><p id="user-message" class="message"></p><div class="actions"><button class="btn primary" type="submit">Mitarbeiter speichern</button><button class="btn secondary" id="cancel-user-bottom" type="button">Abbrechen</button></div></div>
  </form></section>`;

  const show=el.querySelector('#user-show'),create=el.querySelector('#user-create'),form=el.querySelector('#user-form'),akte=el.querySelector('#personalakte-container');
  if(!(canView||canEdit||canDelete)&&canCreate){show?.classList.add('hidden');create?.classList.remove('hidden');}
  function tab(t){show.classList.toggle('hidden',t!=='show');create.classList.toggle('hidden',t!=='create');el.querySelectorAll('.choice-card').forEach(x=>x.classList.toggle('active',x.dataset.tab===t))}
  async function prepareNew(){if(!canCreate){toast('Keine Berechtigung zum Anlegen von Mitarbeitern.');return;}form.reset();form.elements.loginType.disabled=false;form.elements.login.disabled=false;form.elements.role.disabled=false;form.querySelectorAll('[name=adminPermission]').forEach(x=>{x.checked=true;x.disabled=!canManagePermissions});const adminOption=[...form.elements.role.options].find(o=>o.value==='admin');if(adminOption)adminOption.disabled=!canManagePermissions;form.querySelectorAll('[name=workDay]').forEach(x=>x.checked=['1','2','3','4','5'].includes(x.value));setVal(form,'weeklyHours',40);setVal(form,'vacationDays',30);setVal(form,'projectTimeTracking','false');setVal(form,'active','true');el.querySelector('#employee-form-title').textContent='Mitarbeiter anlegen';form.querySelectorAll('input,select,textarea').forEach(x=>x.disabled=false);form.querySelectorAll('button[type=submit]').forEach(x=>x.classList.remove('hidden'));const box=form.querySelector('#admin-permissions-box');if(box)box.classList.add('hidden');await renderPersonalakte(akte,ctx,null,{readOnly:false,canManage:canManageDocs})}
  el.querySelectorAll('.choice-card').forEach(b=>b.onclick=async()=>{if(b.dataset.tab==='create')await prepareNew();tab(b.dataset.tab)});
  const cancel=()=>tab('show');el.querySelector('#cancel-user').onclick=cancel;el.querySelector('#cancel-user-bottom').onclick=cancel;

    el.querySelectorAll('.remove-user').forEach(b=>b.onclick=async()=>{if(!canDelete){toast('Keine Berechtigung zum Entfernen von Mitarbeitern.');return;}
    const u=users.find(x=>x.id===b.dataset.id);
    if(!u)return;
    if(!confirm(`Mitarbeiter „${u.name||u.email||u.username}“ wirklich entfernen?\n\nDer Zugang wird deaktiviert und aus der aktiven Mitarbeiterübersicht entfernt. Zeit-, Schulungs-, Abrechnungs- und Historiendaten bleiben aus Nachweisgründen erhalten.`))return;
    try{
      const changes=[{field:'archived',oldValue:false,newValue:true},{field:'active',oldValue:u.active!==false,newValue:false}];
      const batch=writeBatch(db);
      batch.update(doc(db,'users',u.id),{archived:true,active:false,archivedAt:serverTimestamp(),archivedBy:ctx.profile.id,updatedAt:serverTimestamp()});
      batch.set(doc(collection(db,'employeeHistory')),historyRecord(ctx,u.id,{...u,active:false},'archive',changes));
      await batch.commit();
      toast('Mitarbeiter wurde entfernt und der Zugang deaktiviert.');
      await renderMitarbeiter(el,ctx);
    }catch(err){console.error(err);toast(err.message||'Mitarbeiter konnte nicht entfernt werden.')}
  });

el.querySelectorAll('.edit-user').forEach(b=>b.onclick=async()=>{
    const u=users.find(x=>x.id===b.dataset.id),p=privateMap.get(u.id)||{};form.reset();setVal(form,'id',u.id);setVal(form,'name',u.name);setVal(form,'companyId',u.companyId);const usernameMode=u.hasRealEmail===false||String(u.email||'').endsWith('@portal.local');setVal(form,'loginType',usernameMode?'username':'email');setVal(form,'login',usernameMode?(u.username||String(u.email||'').replace(/@portal\.local$/,'')):(u.email||''));form.elements.loginType.disabled=true;form.elements.login.disabled=true;setVal(form,'role',u.role||'employee');setVal(form,'supervisorId',u.supervisorId||'');setVal(form,'active',String(u.active!==false));setVal(form,'startDate',u.startDate||'');setVal(form,'endDate',u.endDate||'');setVal(form,'weeklyHours',u.weeklyHours??40);setVal(form,'vacationDays',u.vacationDays??30);setVal(form,'employeeNumber',u.employeeNumber||'');let areaValue=u.businessAreaId||businessAreas.find(a=>a.code===u.companyAreaNumber)?.id||'';if(!areaValue&&u.companyAreaNumber){const select=form.elements.businessAreaId;select.add(new Option(`${u.companyAreaNumber} · bisheriger Wert`,`legacy:${u.companyAreaNumber}`));areaValue=`legacy:${u.companyAreaNumber}`;}setVal(form,'businessAreaId',areaValue);setVal(form,'projectTimeTracking',String(u.projectTimeTracking===true));
    ['department','position','contractType','probationEndDate','fixedTermEndDate','costCenter','firstAiderValidUntil','fireWardenValidUntil','forkliftPermitValidUntil','aerialLiftPermitValidUntil','drivingLicenseClasses','nextDrivingLicenseCheck','occupationalMedicalNotes'].forEach(k=>setVal(form,k,u[k]||''));['firstAider','fireWarden','forkliftPermit','aerialLiftPermit'].forEach(k=>boolVal(form,k,u[k]));
    const workDays=Array.isArray(u.workDays)&&u.workDays.length?u.workDays.map(String):['1','2','3','4','5'];form.querySelectorAll('[name=workDay]').forEach(x=>x.checked=workDays.includes(x.value));
    ['birthDate','street','postalCode','city','privateEmail','phone','mobile','emergencyContactName','emergencyContactPhone','taxId','taxClass','religion','socialSecurityNumber','healthInsuranceId','insuranceType','personGroup','contributionGroup','iban','bic','bankId','accountHolder','compensationType','salaryValidFrom'].forEach(k=>setVal(form,k,p[k]||''));setVal(form,'childAllowance',p.childAllowance??'');setVal(form,'grossSalary',p.grossSalary??'');setVal(form,'hourlyRate',p.hourlyRate??'');
    form.querySelectorAll('[name=bereich]').forEach(x=>x.checked=(u.bereiche||[]).includes(x.value));form.querySelectorAll('[name=extraTraining]').forEach(x=>x.checked=(u.extraTrainings||[]).includes(x.value));
    const loadedPermissions=normalizedAdminPermissions(u);form.querySelectorAll('[name=adminPermission]').forEach(x=>x.checked=loadedPermissions[x.value]!==false);
    const syncAdminPermissionVisibility=()=>{const box=form.querySelector('#admin-permissions-box');if(box)box.classList.toggle('hidden',form.elements.role.value!=='admin')};syncAdminPermissionVisibility();
    const readOnly=!canEdit;form.querySelectorAll('input,select,textarea').forEach(x=>{if(x.name!=='id')x.disabled=readOnly||(['loginType','login'].includes(x.name));});
    if(!readOnly&&!canManagePermissions){form.querySelectorAll('[name=adminPermission]').forEach(x=>x.disabled=true);if(u.role==='admin')form.elements.role.disabled=true;}
    form.querySelectorAll('button[type=submit]').forEach(x=>x.classList.toggle('hidden',readOnly));
    el.querySelector('#employee-form-title').textContent=`Mitarbeiterkartei · ${u.name||'Mitarbeiter'}`;tab('create');await renderPersonalakte(akte,ctx,u,{readOnly,canManage:canManageDocs});window.scrollTo({top:0,behavior:'smooth'});
  });

  form.elements.role?.addEventListener('change',()=>{const box=form.querySelector('#admin-permissions-box');if(box)box.classList.toggle('hidden',form.elements.role.value!=='admin');if(form.elements.role.value==='admin'&&![...form.querySelectorAll('[name=adminPermission]')].some(x=>x.checked))form.querySelectorAll('[name=adminPermission]').forEach(x=>x.checked=true)});

  form.onsubmit=async e=>{
    e.preventDefault();
    const f=e.currentTarget,id=f.elements.id.value;
    if(id&&!canEdit){toast('Keine Berechtigung zum Bearbeiten von Mitarbeitern.');return}
    if(!id&&!canCreate){toast('Keine Berechtigung zum Anlegen von Mitarbeitern.');return}
    const loginType=f.elements.loginType.value,login=f.elements.login.value.trim(),password=f.elements.password.value,email=loginType==='username'?syntheticEmail(login):login.toLowerCase();
    const previousUser=id?users.find(x=>x.id===id):null;
    if(id&&!canManagePermissions&&previousUser&&(previousUser.role==='admin'||f.elements.role.value==='admin')&&f.elements.role.value!==previousUser.role){toast('Keine Berechtigung zum Ändern von Admin-Rollen.');return}
    if(!id&&f.elements.role.value==='admin'&&!canManagePermissions){toast('Keine Berechtigung zum Anlegen von Admin-Zugängen.');return}
    const areaSelection=f.elements.businessAreaId.value,selectedArea=businessAreaMap.get(areaSelection),legacyArea=areaSelection.startsWith('legacy:')?areaSelection.slice(7):'';const employeeNumber=f.elements.employeeNumber.value.trim();if(!/^\d{5}$/.test(employeeNumber)){el.querySelector('#user-message').textContent='Die Mitarbeiternummer muss genau fünfstellig numerisch sein.';return;}const companyAreaNumber=selectedArea?.code||legacyArea;if(!/^\d{3}$/.test(companyAreaNumber)){el.querySelector('#user-message').textContent='Bitte einen gültigen dreistelligen Geschäftsbereich auswählen.';return;}const publicData={name:f.elements.name.value.trim(),companyId:f.elements.companyId.value,email,username:loginType==='username'?login.toLowerCase():'',hasRealEmail:loginType==='email',role:f.elements.role.value,adminPermissions:f.elements.role.value==='admin'?(canManagePermissions?Object.fromEntries(ADMIN_PERMISSION_DEFS.map(x=>[x.key,[...f.querySelectorAll('[name=adminPermission]')].find(c=>c.value===x.key)?.checked===true])):(previousUser?.adminPermissions||DEFAULT_ADMIN_PERMISSIONS)):{},supervisorId:f.elements.supervisorId.value||null,active:f.elements.active.value==='true',startDate:f.elements.startDate.value||null,endDate:f.elements.endDate.value||null,weeklyHours:Number(f.elements.weeklyHours.value||40),vacationDays:Number(f.elements.vacationDays.value||30),employeeNumber,businessAreaId:selectedArea?.id||'',companyAreaNumber,projectTimeTracking:f.elements.projectTimeTracking.value==='true',department:f.elements.department.value.trim(),position:f.elements.position.value.trim(),contractType:f.elements.contractType.value,probationEndDate:f.elements.probationEndDate.value||null,fixedTermEndDate:f.elements.fixedTermEndDate.value||null,costCenter:f.elements.costCenter.value.trim(),workDays:[...f.querySelectorAll('[name=workDay]:checked')].map(x=>x.value),firstAider:f.elements.firstAider.value==='true',firstAiderValidUntil:f.elements.firstAiderValidUntil.value||null,fireWarden:f.elements.fireWarden.value==='true',fireWardenValidUntil:f.elements.fireWardenValidUntil.value||null,forkliftPermit:f.elements.forkliftPermit.value==='true',forkliftPermitValidUntil:f.elements.forkliftPermitValidUntil.value||null,aerialLiftPermit:f.elements.aerialLiftPermit.value==='true',aerialLiftPermitValidUntil:f.elements.aerialLiftPermitValidUntil.value||null,drivingLicenseClasses:f.elements.drivingLicenseClasses.value.trim(),nextDrivingLicenseCheck:f.elements.nextDrivingLicenseCheck.value||null,occupationalMedicalNotes:f.elements.occupationalMedicalNotes.value.trim(),bereiche:[...f.querySelectorAll('[name=bereich]:checked')].map(x=>x.value),extraTrainings:[...f.querySelectorAll('[name=extraTraining]:checked')].map(x=>x.value),updatedAt:serverTimestamp()};
    const privateData={birthDate:f.elements.birthDate.value||null,street:f.elements.street.value.trim(),postalCode:f.elements.postalCode.value.trim(),city:f.elements.city.value.trim(),privateEmail:f.elements.privateEmail.value.trim().toLowerCase(),phone:f.elements.phone.value.trim(),mobile:f.elements.mobile.value.trim(),emergencyContactName:f.elements.emergencyContactName.value.trim(),emergencyContactPhone:f.elements.emergencyContactPhone.value.trim(),taxId:f.elements.taxId.value.trim(),taxClass:f.elements.taxClass.value,childAllowance:numberOrNull(f.elements.childAllowance.value),religion:f.elements.religion.value,socialSecurityNumber:f.elements.socialSecurityNumber.value.trim(),healthInsuranceId:f.elements.healthInsuranceId.value,insuranceType:f.elements.insuranceType.value,personGroup:f.elements.personGroup.value.trim(),contributionGroup:f.elements.contributionGroup.value.trim(),iban:f.elements.iban.value.replace(/\s+/g,'').toUpperCase(),bic:f.elements.bic.value.replace(/\s+/g,'').toUpperCase(),bankId:f.elements.bankId.value,accountHolder:f.elements.accountHolder.value.trim(),compensationType:f.elements.compensationType.value,grossSalary:numberOrNull(f.elements.grossSalary.value),hourlyRate:numberOrNull(f.elements.hourlyRate.value),salaryValidFrom:f.elements.salaryValidFrom.value||null,updatedAt:serverTimestamp()};
    try{
      const batch=writeBatch(db);
      if(id){
        const prev=users.find(x=>x.id===id)||{},prevPrivate=privateMap.get(id)||{},changes=[...changesFor(PUBLIC_HISTORY_FIELDS,prev,publicData),...changesFor(PRIVATE_HISTORY_FIELDS,prevPrivate,privateData,'private.')];
        const ownAdminRoleChange=id===ctx.profile.id&&prev.role==='admin'&&publicData.role!=='admin';
        if(ownAdminRoleChange){
          throw new Error('Die Rolle des aktuell angemeldeten Admin-Zugangs kann nicht selbst herabgestuft werden. Bitte mit einem anderen Admin anmelden und die Rolle dort ändern.');
        }
        batch.update(doc(db,'users',id),publicData);
        batch.set(doc(db,'employeePrivate',id),privateData,{merge:true});
        if(changes.length)batch.set(doc(collection(db,'employeeHistory')),historyRecord(ctx,id,publicData,'update',changes));
        await batch.commit();
      }
      else{
        if(!password||password.length<6)throw new Error('Für neue Benutzer wird ein Startpasswort mit mindestens 6 Zeichen benötigt.');
        if(activeUsers.some(u=>String(u.email||'').toLowerCase()===email.toLowerCase()||(!publicData.hasRealEmail&&String(u.username||'').toLowerCase()===publicData.username)))throw new Error('Dieser Login ist bereits einem Benutzer zugeordnet.');
        let authHandle=null;
        try{
          authHandle=await createAuthAccount(email,password);
          const uid=authHandle.uid;
          batch.set(doc(db,'users',uid),{...publicData,email,createdAt:serverTimestamp()});
          batch.set(doc(db,'employeePrivate',uid),{...privateData,createdAt:serverTimestamp()});
          batch.set(doc(collection(db,'employeeHistory')),historyRecord(ctx,uid,{...publicData,email},'create',[]));
          await batch.commit();
          await closeSecondaryAuth(authHandle);
          authHandle=null;
        }catch(createErr){
          if(authHandle)await closeSecondaryAuth(authHandle,{rollback:true});
          throw createErr;
        }
      }
      toast('Mitarbeiter gespeichert.');await renderMitarbeiter(el,ctx);
    }catch(err){console.error(err);el.querySelector('#user-message').textContent=err.message||'Mitarbeiter konnte nicht gespeichert werden.'}
  };
}
