import { firebaseConfig, db } from "./firebase.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { initializeAuth, inMemoryPersistence, createUserWithEmailAndPassword, deleteUser, signOut as secondarySignOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { collection, getDocs, doc, serverTimestamp, writeBatch, updateDoc, setDoc, addDoc, query, where } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setHead } from "./app.js";
import { AREA_NAMES, esc, syntheticEmail, ROLE_LABELS, toast, initials } from "./utils.js";
import { renderPersonalakte } from "./personalakte.js";
import { ADMIN_PERMISSION_DEFS, DEFAULT_ADMIN_PERMISSIONS, hasAdminPermission, hasAnyAdminPermission, normalizedAdminPermissions } from "./permissions.js";
import { randomToken, sha256Hex, nfcSupported, writeEmployeeNfcTag } from "./nfc-utils.js";
import { getEmployeePhotoUrls, uploadEmployeePhoto, deleteEmployeePhoto } from "./employee-photos.js";
import { sameTrainingSelection, upsertTrainingAssignmentHistory } from "./training-utils.js";
import { calculateDailyTimeValues, wasStartLimited } from "./time-utils.js";

const PUBLIC_HISTORY_FIELDS=[
  "name","companyId","email","username","hasRealEmail","role","adminPermissions","supervisorId","supervisorId2","active","startDate","endDate","weeklyHours","vacationDays","earliestStartTime","employeeNumber","businessAreaId","projectTimeTracking","department","position","contractType","probationEndDate","fixedTermEndDate","costCenter","workDays","firstAider","firstAiderValidUntil","fireWarden","fireWardenValidUntil","forkliftPermit","forkliftPermitValidUntil","aerialLiftPermit","aerialLiftPermitValidUntil","drivingLicenseClasses","nextDrivingLicenseCheck","occupationalMedicalNotes","bereiche","extraTrainings","trainingAssignments"
];
const PRIVATE_HISTORY_FIELDS=[
  "birthDate","birthdayList","maritalStatus","marriageDate","street","postalCode","city","privateEmail","phone","mobile","emergencyContactName","emergencyContactPhone","taxId","taxClass","childAllowance","religion","socialSecurityNumber","healthInsuranceId","insuranceType","personGroup","contributionGroup","iban","bic","bankId","accountHolder","grossSalary","hourlyRate","salaryValidFrom"
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


function bookingToDate(value){
  if(!value)return null;
  if(value?.toDate)return value.toDate();
  const d=new Date(value);
  return Number.isNaN(d.getTime())?null:d;
}
function bookingPad(v){return String(v).padStart(2,'0')}
function bookingDateKey(record){
  if(record.recordType==='adjustment')return String(record.adjustmentDate||'');
  const d=bookingToDate(record.startAt);
  if(d)return `${d.getFullYear()}-${bookingPad(d.getMonth()+1)}-${bookingPad(d.getDate())}`;
  return String(record.date||'');
}
function bookingTime(record,kind){
  const d=bookingToDate(kind==='start'?record.startAt:record.endAt);
  if(d)return `${bookingPad(d.getHours())}:${bookingPad(d.getMinutes())}`;
  return String(record[kind]||'');
}
function bookingMinutesText(minutes,{signed=false}={}){
  const value=Math.round(Number(minutes)||0);
  const sign=signed?(value>0?'+':value<0?'−':''):'';
  const abs=Math.abs(value);
  return `${sign}${Math.floor(abs/60)}:${bookingPad(abs%60)} h`;
}
function bookingNetMinutes(record){
  if(record.recordType==='adjustment')return Number(record.adjustmentMinutes)||0;
  const start=bookingToDate(record.startAt),end=bookingToDate(record.endAt);
  if(!start||!end||end<start)return null;
  const gross=Math.max(0,Math.round((end-start)/60000));
  const pause=gross>540?45:gross>360?30:0;
  return Math.max(0,gross-pause);
}
function bookingSourceLabel(record){
  if(record.recordType==='adjustment')return 'Stundenkorrektur';
  if(record.source==='nfc_terminal')return 'NFC-Terminal';
  if(record.source==='approved_request')return 'genehmigter Antrag';
  if(record.source==='desktop_stamp')return 'Personalmanagement';
  return record.source?String(record.source):'Buchung';
}
function bookingMonthLabel(date){
  return date.toLocaleDateString('de-DE',{month:'long',year:'numeric'});
}

export async function renderMitarbeiter(el,ctx){
  setHead("Mitarbeiter","Digitale Mitarbeiterkartei, Zugang, Organisation, Arbeitssicherheit und Personalakte verwalten.");
  const canView=hasAdminPermission(ctx.profile,'employeesView');
  const canCreate=hasAdminPermission(ctx.profile,'employeesCreate');
  const canEdit=hasAdminPermission(ctx.profile,'employeesEdit');
  const canDelete=hasAdminPermission(ctx.profile,'employeesDelete');
  const canManageDocs=hasAdminPermission(ctx.profile,'personnelDocuments');
  const canManagePermissions=hasAdminPermission(ctx.profile,'permissionsManage');
  const canManageNfc=hasAdminPermission(ctx.profile,'terminalManage');
  const canViewBookings=hasAnyAdminPermission(ctx.profile,['timeAdjustment','timeApprove','hoursExport','backup']);
  const canManageNotes=hasAdminPermission(ctx.profile,'employeeNotes');
  if(!hasAnyAdminPermission(ctx.profile,['employeesView','employeesCreate','employeesEdit','employeesDelete'])){
    el.innerHTML='<div class="error-card">Für diesen Admin-Zugang ist keine Berechtigung zur Mitarbeiterverwaltung freigeschaltet.</div>';
    return;
  }
  const [uSnap,cSnap,tSnap,pSnap,hSnap,bSnap,rSnap,aSnap,nfcSnap]=await Promise.all([
    getDocs(collection(db,'users')),getDocs(collection(db,'companies')),getDocs(collection(db,'trainings')),(canView||canEdit?getDocs(collection(db,'employeePrivate')):Promise.resolve({docs:[]})),getDocs(collection(db,'healthInsurers')),getDocs(collection(db,'banks')),getDocs(collection(db,'religionTaxCodes')),getDocs(collection(db,'businessAreas')),(canManageNfc?getDocs(collection(db,'nfcCredentials')):Promise.resolve({docs:[]}))
  ]);
  const users=uSnap.docs.map(d=>({id:d.id,...d.data()})),activeUsers=users.filter(u=>u.archived!==true),companies=cSnap.docs.map(d=>({id:d.id,...d.data()})),trainings=tSnap.docs.map(d=>({id:d.id,...d.data()}));
  let photoUrls={};
  try{photoUrls=await getEmployeePhotoUrls(ctx,activeUsers.map(u=>u.id))}catch(err){console.warn('Mitarbeiterfotos konnten nicht geladen werden',err)}
  const privateMap=new Map(pSnap.docs.map(d=>[d.id,{id:d.id,...d.data()}]));
  const insurers=hSnap.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.active!==false).sort((a,b)=>(a.name||'').localeCompare(b.name||'','de'));
  const banks=bSnap.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.active!==false).sort((a,b)=>(a.name||'').localeCompare(b.name||'','de'));
  const religions=rSnap.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.active!==false).sort((a,b)=>String(a.code||a.name||'').localeCompare(String(b.code||b.name||''),'de'));
  const supervisors=activeUsers.filter(u=>u.role==='supervisor'||u.role==='admin');
  const businessAreas=aSnap.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.active!==false).sort((a,b)=>String(a.code||'').localeCompare(String(b.code||''),'de'));
  const businessAreaMap=new Map(businessAreas.map(x=>[x.id,x]));
  const nfcCredentials=nfcSnap.docs.map(d=>({id:d.id,...d.data()}));

  const personalBody=`
    <label class="field"><span>Name</span><input name="name" required></label><div class="field birthday-date-field"><span>Geburtsdatum</span><div class="birthday-date-line"><input name="birthDate" type="date"><label class="inline-check compact"><input name="birthdayList" type="checkbox"><span>Geburtstagsliste ja</span></label></div><small>Nur bei Zustimmung wird der Geburtstag in der Geburtstagsliste ausgegeben.</small></div>
    <label class="field full"><span>Straße / Hausnummer</span><input name="street"></label><label class="field"><span>PLZ</span><input name="postalCode" inputmode="numeric"></label><label class="field"><span>Ort</span><input name="city"></label>
    <label class="field"><span>Private E-Mail</span><input name="privateEmail" type="email"></label><label class="field"><span>Telefon</span><input name="phone" type="tel"></label><label class="field"><span>Mobil</span><input name="mobile" type="tel"></label><div></div>
    <label class="field"><span>Notfallkontakt</span><input name="emergencyContactName"></label><label class="field"><span>Telefon Notfallkontakt</span><input name="emergencyContactPhone" type="tel"></label>`;

  const employmentBody=`
    <label class="field"><span>Firma</span><select name="companyId" required><option value="">– auswählen –</option>${companies.map(c=>opt(c.id,`${c.name}${c.companyNumber?` · ${c.companyNumber}`:''}`)).join('')}</select></label><label class="field"><span>Mitarbeiternummer</span><input name="employeeNumber" inputmode="numeric" maxlength="5" pattern="[0-9]{5}" placeholder="5-stellig, z. B. 40190" required></label>
    <label class="field"><span>Geschäftsbereich</span><select name="businessAreaId" required><option value="">– auswählen –</option>${businessAreas.map(a=>opt(a.id,`${a.code} · ${a.name}`)).join('')}</select></label><label class="field"><span>Abteilung</span><input name="department"></label>
    <label class="field"><span>Position / Tätigkeit</span><input name="position"></label><label class="field"><span>Kostenstelle</span><input name="costCenter"></label>
    <label class="field"><span>1. Vorgesetzter</span><select name="supervisorId"><option value="">Kein Vorgesetzter</option>${supervisors.map(u=>opt(u.id,u.name||u.email)).join('')}</select></label><label class="field"><span>2. Vorgesetzter</span><select name="supervisorId2"><option value="">Kein zweiter Vorgesetzter</option>${supervisors.map(u=>opt(u.id,u.name||u.email)).join('')}</select><small>Optional. Beide Vorgesetzte erhalten dieselben organisatorischen Zugriffsrechte.</small></label><label class="field"><span>Beschäftigungsart</span><select name="contractType"><option value="">– auswählen –</option><option>Vollzeit</option><option>Teilzeit</option><option>Minijob</option><option>Werkstudent</option><option>Ausbildung</option><option>Befristet</option><option>Sonstiges</option></select></label>
    <label class="field"><span>Eintritt</span><input name="startDate" type="date"></label><label class="field"><span>Austritt</span><input name="endDate" type="date"></label><label class="field"><span>Probezeit bis</span><input name="probationEndDate" type="date"></label><label class="field"><span>Befristung bis</span><input name="fixedTermEndDate" type="date"></label>`;

  const taxBody=`
    <label class="field"><span>Familienstand</span><select name="maritalStatus"><option value="">– auswählen –</option>${['ledig','verheiratet','geschieden','verwitwet'].map(x=>opt(x,x)).join('')}</select></label><label class="field"><span>Heirat am</span><input name="marriageDate" type="date"></label>
    <label class="field"><span>Steuer-ID</span><input name="taxId" autocomplete="off"></label><label class="field"><span>Steuerklasse</span><select name="taxClass"><option value="">– auswählen –</option>${['I','II','III','IV','IV mit Faktor','V','VI'].map(x=>opt(x,x)).join('')}</select></label>
    <label class="field"><span>Kinderfreibetrag</span><input name="childAllowance" type="number" step="0.5" min="0"></label><label class="field"><span>Religion / Kirchensteuer</span><select name="religion"><option value="">– auswählen –</option>${religions.map(x=>opt(x.code,`${x.code} · ${x.name}`)).join('')}</select></label>
    <label class="field"><span>Sozialversicherungsnummer</span><input name="socialSecurityNumber" autocomplete="off"></label><label class="field"><span>Krankenkasse</span><select name="healthInsuranceId"><option value="">– auswählen –</option>${insurers.map(x=>opt(x.id,`${x.name}${x.code?` · ${x.code}`:''}`)).join('')}</select></label>
    <label class="field"><span>Versicherungsart</span><select name="insuranceType"><option value="">– auswählen –</option><option>gesetzlich pflichtversichert</option><option>gesetzlich freiwillig</option><option>privat versichert</option><option>familienversichert</option><option>sonstiges</option></select></label><label class="field"><span>Personengruppe</span><input name="personGroup" placeholder="z. B. 101"></label>
    <label class="field"><span>Beitragsgruppe</span><input name="contributionGroup" placeholder="optional"></label>`;

  const bankBody=`
    <label class="field full"><span>IBAN</span><input name="iban" autocomplete="off"></label><label class="field"><span>Bank</span><select name="bankId"><option value="">– auswählen –</option>${banks.map(x=>opt(x.id,`${x.name}${x.bic?` · ${x.bic}`:''}`)).join('')}</select></label><label class="field"><span>BIC</span><input name="bic" maxlength="11"></label><label class="field full"><span>Kontoinhaber</span><input name="accountHolder"></label>`;

  const salaryBody=`
    <label class="field"><span>Bruttogehalt / Monat (€)</span><input name="grossSalary" type="number" step="0.01" min="0"></label>
    <label class="field"><span>Stundenlohn (€)</span><input name="hourlyRate" type="number" step="0.01" min="0"></label>
    <label class="field"><span>Gültig ab</span><input name="salaryValidFrom" type="date"></label>
    <div class="field"><span>&nbsp;</span><button type="button" class="btn secondary" id="salary-history-add">Übernehmen</button><small>Monatsgehalt und Stundenlohn können gleichzeitig gepflegt werden. „Übernehmen“ legt einen unveränderlichen Historieneintrag an.</small></div>
    <div class="field full"><span>Vergütungshistorie</span><div id="salary-history-list" class="history-inline-list"><span class="muted">Mitarbeiter zuerst öffnen.</span></div></div>`;

  const timeBody=`
    <label class="field"><span>Wochenstunden</span><input name="weeklyHours" type="number" step="0.25" value="40"></label><label class="field"><span>Urlaubstage/Jahr</span><input name="vacationDays" type="number" step="1" value="30"></label><label class="field"><span>Frühester anrechenbarer Arbeitsbeginn</span><input name="earliestStartTime" type="time"><small>Optional. Ein früherer echter KOMMEN-Stempel bleibt sichtbar, wird aber erst ab dieser Uhrzeit angerechnet.</small></label><label class="field"><span>Zeiterfassung auf Projekte</span><select name="projectTimeTracking"><option value="false">Nein</option><option value="true">Ja</option></select></label>
    <div class="field full"><span>Regelmäßige Arbeitstage</span><div class="weekday-grid">${[['1','Mo'],['2','Di'],['3','Mi'],['4','Do'],['5','Fr'],['6','Sa'],['0','So']].map(([v,l])=>`<label><input type="checkbox" name="workDay" value="${v}" ${['1','2','3','4','5'].includes(v)?'checked':''}><span>${l}</span></label>`).join('')}</div></div>`;

  const nfcBody=`<div class="field full"><div id="nfc-credential-box" class="nfc-credential-box"><span class="muted">Mitarbeiter zuerst anlegen bzw. öffnen.</span></div></div>`;

  const bookingsBody=`<div class="field full"><div id="employee-bookings-box" class="employee-bookings-box"><span class="muted">Mitarbeiter zuerst öffnen.</span></div></div>`;

  const notesBody=`<label class="field full"><span>Notiz</span><textarea name="adminNoteText" placeholder="Freitext zur internen Dokumentation"></textarea></label><label class="field"><span>Datum</span><input name="adminNoteDate" type="date"></label><div class="field"><span>&nbsp;</span><button type="button" class="btn secondary" id="employee-note-add">Übernehmen</button><small>Admins mit der Berechtigung „Mitarbeiternotizen“ sehen alle Einträge. Vorgesetzte sehen ausschließlich ihre eigenen Notizen.</small></div><div class="field full"><span>Notizhistorie</span><div id="employee-notes-list" class="history-inline-list"><span class="muted">Mitarbeiter zuerst öffnen.</span></div></div>`;

  const safetyBody=`
    <label class="field safety-toggle"><span>Ersthelfer</span><select name="firstAider"><option value="false">Nein</option><option value="true">Ja</option></select></label><label class="field"><span>gültig / Auffrischung bis</span><input name="firstAiderValidUntil" type="date"></label>
    <label class="field safety-toggle"><span>Brandschutzhelfer</span><select name="fireWarden"><option value="false">Nein</option><option value="true">Ja</option></select></label><label class="field"><span>gültig / Auffrischung bis</span><input name="fireWardenValidUntil" type="date"></label>
    <label class="field safety-toggle"><span>Staplerschein</span><select name="forkliftPermit"><option value="false">Nein</option><option value="true">Ja</option></select></label><label class="field"><span>gültig bis</span><input name="forkliftPermitValidUntil" type="date"></label>
    <label class="field safety-toggle"><span>Hubarbeitsbühne</span><select name="aerialLiftPermit"><option value="false">Nein</option><option value="true">Ja</option></select></label><label class="field"><span>gültig bis</span><input name="aerialLiftPermitValidUntil" type="date"></label>
    <label class="field"><span>Führerscheinklassen</span><input name="drivingLicenseClasses" placeholder="z. B. B, BE, C1"></label><label class="field"><span>Nächste Führerscheinkontrolle</span><input name="nextDrivingLicenseCheck" type="date"></label>
    <label class="field full"><span>Arbeitsmedizinische Vorsorgen / Hinweise</span><textarea name="occupationalMedicalNotes" placeholder="z. B. G25, G41 bzw. interne Bezeichnung und Gültigkeit"></textarea></label>`;

  const trainingBody=`<label class="field"><span>Neue Schulungszuordnung gültig ab</span><input type="date" name="trainingValidFrom"></label><div class="field"><span>&nbsp;</span><div class="info-strip compact">Das Datum wird nur verwendet, wenn sich Schulungsbereiche oder Zusatzschulungen ändern. Frühere Schulungsjahre und Bearbeitungsstände bleiben unverändert.</div></div><div class="field full"><span>Schulungsbereiche</span><div class="check-grid">${Object.entries(AREA_NAMES).map(([id,n])=>`<label><input type="checkbox" name="bereich" value="${id}"><span><b>Bereich ${id}</b>${esc(n)}</span></label>`).join('')}</div></div><div class="field full"><span>Individuelle Zusatzschulungen</span><div class="check-grid compact">${trainings.length?trainings.map(t=>`<label><input type="checkbox" name="extraTraining" value="${t.id}"><span>${esc(t.title)}</span></label>`).join(''):'<div class="muted">Noch keine Schulungen vorhanden.</div>'}</div></div>`;

  const permissionGroups=[...new Set(ADMIN_PERMISSION_DEFS.map(x=>x.group))];
  const adminPermissionBody=`<div class="field full admin-permissions-box" id="admin-permissions-box"><span>Admin-Berechtigungen</span><p class="muted small">Nur bei Rolle „Personalabteilung / Admin“. Bestehende Admins besitzen nach dem Update zunächst alle Rechte.</p>${permissionGroups.map(group=>`<div class="permission-group"><strong>${esc(group)}</strong><div class="permission-grid">${ADMIN_PERMISSION_DEFS.filter(x=>x.group===group).map(x=>`<label><input type="checkbox" name="adminPermission" value="${x.key}" checked><span>${esc(x.label)}</span></label>`).join('')}</div></div>`).join('')}</div>`;
  const systemBody=`
    <label class="field"><span>Login-Art</span><select name="loginType"><option value="email">E-Mail-Adresse</option><option value="username">Benutzername</option></select></label><label class="field"><span>E-Mail / Benutzername</span><input name="login" required></label><label class="field"><span>Startpasswort</span><input name="password" type="text" placeholder="nur bei Neuanlage"></label><label class="field"><span>Rolle</span><select name="role"><option value="employee">Mitarbeiter</option><option value="supervisor">Vorgesetzter</option><option value="admin">Personalabteilung / Admin</option></select></label><label class="field"><span>Status</span><select name="active"><option value="true">aktiv</option><option value="false">inaktiv</option></select></label>${adminPermissionBody}`;

  el.innerHTML=`<div class="admin-choice-grid">${(canView||canEdit||canDelete)?`<button class="choice-card active" data-tab="show"><span>♙</span><strong>Benutzer anzeigen</strong><small>Alle vorhandenen Mitarbeiter direkt anzeigen</small></button>`:''}${canCreate?`<button class="choice-card ${(canView||canEdit||canDelete)?'':'active'}" data-tab="create"><span>＋</span><strong>Benutzer anlegen</strong><small>Neue Mitarbeiterkartei und Zugang anlegen</small></button>`:''}</div>
  <section id="user-show"><article class="card"><div class="card-head"><div><h2>Benutzerübersicht</h2><p>${activeUsers.length} aktive Benutzer vorhanden</p></div></div><div class="table-wrap"><table><thead><tr><th>Foto</th><th>Name</th><th>Mitarb.-Nr.</th><th>Firma</th><th>Abteilung / Bereich</th><th>Rolle</th><th>Login</th><th>Status</th><th></th></tr></thead><tbody>${activeUsers.length?activeUsers.sort((a,b)=>(a.name||'').localeCompare(b.name||'')).map(u=>`<tr><td><span class="employee-list-photo">${photoUrls[u.id]?`<img src="${esc(photoUrls[u.id])}" alt="Foto von ${esc(u.name||'Mitarbeiter')}">`:`<span>${esc(initials(u.name||u.email||'MA'))}</span>`}</span></td><td><strong>${esc(u.name||'')}</strong><div class="small muted">${esc(u.position||'')}</div></td><td>${esc(u.employeeNumber||'–')}</td><td>${esc(companies.find(c=>c.id===u.companyId)?.short||companies.find(c=>c.id===u.companyId)?.name||'–')}</td><td>${esc(u.department||(businessAreaMap.get(u.businessAreaId)?.code&&`${businessAreaMap.get(u.businessAreaId).code} · ${businessAreaMap.get(u.businessAreaId).name}`)||u.companyAreaNumber||'–')}</td><td>${esc(ROLE_LABELS[u.role]||u.role||'–')}</td><td>${esc(u.hasRealEmail===false?(u.username||'Benutzername'):(u.email||'–'))}</td><td><span class="pill ${u.active===false?'red':'green'}">${u.active===false?'inaktiv':'aktiv'}</span></td><td><div class="actions">${(canView||canEdit)?`<button class="btn secondary small edit-user" data-id="${u.id}">${canEdit?'Mitarbeiterkartei':'Anzeigen'}</button>`:''}${canDelete&&u.id!==ctx.profile.id?`<button class="btn danger small remove-user" data-id="${u.id}">Entfernen</button>`:""}</div></td></tr>`).join(''):`<tr><td colspan="9" class="empty">Noch keine Benutzer angelegt.</td></tr>`}</tbody></table></div></article></section>
  <section id="user-create" class="hidden"><form id="user-form" class="employee-file"><input type="hidden" name="id">
    <div class="employee-file-head"><div class="employee-file-identity"><div id="employee-photo-editor" class="employee-photo-editor"><span class="employee-profile-photo large"><span>MA</span></span><small>Foto nach dem ersten Speichern möglich</small></div><div><span class="eyebrow">Digitale Mitarbeiterkartei</span><h2 id="employee-form-title">Mitarbeiter anlegen</h2><p>Die Bereiche sind fachlich getrennt. Sensible Steuer-, Bank- und Entgeltdaten sind besonders geschützt.</p></div></div><div class="employee-file-actions"><button class="btn primary" type="submit">Mitarbeiter speichern</button><button class="btn secondary" id="cancel-user" type="button">Abbrechen</button></div></div>
    ${section('⌂','Persönliche Daten & Kontakt','Kontaktdaten und Notfallkontakt.',personalBody)}
    ${section('▦','Beschäftigung & Organisation','Zuordnung im Unternehmen und Vertragsrahmen.',employmentBody)}
    ${section('§','Steuer & Sozialversicherung','Nur Personalabteilung/Admin und der Mitarbeiter selbst können diese Daten lesen.',taxBody,'sensitive-section admin-role-hide')}
    ${section('€','Bankverbindung','Geschützte Zahlungsdaten des Mitarbeiters.',bankBody,'sensitive-section admin-role-hide')}
    ${section('↗','Lohn & Gehalt','Monatsgehalt und Stundenlohn mit datierter Vergütungshistorie.',salaryBody,'sensitive-section admin-role-hide')}
    ${section('◷','Urlaub & Arbeitszeit','Arbeitszeitmodell, Urlaub und Projektzeiterfassung.',timeBody,'admin-role-hide')}
    ${canManageNfc?section('⌁','NFC-Transponder','Persönlichen NFC-Transponder für die einfache Terminal-Zeiterfassung zuweisen oder sperren.',nfcBody):''}
    ${canViewBookings?section('◴','Buchungen','Arbeitszeitbuchungen des Mitarbeiters kontrollieren. Angezeigt werden auch Projekt, Buchungsart und verwendetes NFC-Terminal.',bookingsBody):''}
    ${canManageNotes?section('✎','Notizen','Interne, rollenbezogene Notizen zum Mitarbeiter.',notesBody):''}
    ${section('⚑','Arbeitssicherheit & Befähigungen','Qualifikationen, Befähigungen und fällige Kontrollen.',safetyBody,'safety-section admin-role-hide')}
    ${section('▤','Schulungen','Bereichsschulungen und individuelle Zusatzschulungen.',trainingBody,'admin-role-hide')}
    ${section('⚙','System & Berechtigungen','Login, Rolle und Kontostatus.',systemBody)}
    <section class="employee-section documents-section"><div class="employee-section-head"><span class="employee-section-icon">▧</span><div><h3>Digitale Personalakte</h3><p>Verträge, Bescheinigungen, Zeugnisse, Zertifikate und weitere Personaldokumente.</p></div></div><div id="personalakte-container"></div></section>
    <div class="employee-savebar"><p id="user-message" class="message"></p><div class="actions"><button class="btn primary" type="submit">Mitarbeiter speichern</button><button class="btn secondary" id="cancel-user-bottom" type="button">Abbrechen</button></div></div>
  </form></section>`;

  const show=el.querySelector('#user-show'),create=el.querySelector('#user-create'),form=el.querySelector('#user-form'),akte=el.querySelector('#personalakte-container');
  function syncAdminRoleSections(){
    const isAdmin=form.elements.role?.value==='admin';
    form.querySelectorAll('.admin-role-hide').forEach(section=>section.classList.toggle('hidden',isAdmin));
  }
  async function renderBookingBox(employee,initialMonth=new Date()){
    const box=el.querySelector('#employee-bookings-box');if(!box)return;
    if(!employee){box.innerHTML='<span class="muted">Die Buchungen können nach dem Öffnen eines Mitarbeiters angezeigt werden.</span>';return;}
    let records=[];
    try{
      const snap=await getDocs(query(collection(db,'timeRecords'),where('userId','==',employee.id)));
      records=snap.docs.map(d=>({id:d.id,...d.data()}));
    }catch(err){
      console.error('Buchungen konnten nicht geladen werden',err);
      box.innerHTML='<div class="error-card compact">Die Buchungen konnten nicht geladen werden. Bitte die Zeit-Berechtigungen dieses Adminzugangs prüfen.</div>';
      return;
    }
    const bookingValues=calculateDailyTimeValues(records,employee.earliestStartTime||'',{includeOpen:true});
    let month=new Date(initialMonth.getFullYear(),initialMonth.getMonth(),1,12);
    const renderMonth=()=>{
      const year=month.getFullYear(),monthNo=month.getMonth()+1;
      const monthRecords=records.filter(r=>{
        const key=bookingDateKey(r);
        return key.startsWith(`${year}-${bookingPad(monthNo)}-`);
      }).sort((a,b)=>{
        const ak=bookingDateKey(a),bk=bookingDateKey(b);
        const at=bookingTime(a,'start'),bt=bookingTime(b,'start');
        return (bk+bt).localeCompare(ak+at);
      });
      box.innerHTML=`
        <div class="employee-bookings-toolbar">
          <div class="actions">
            <button class="btn secondary small" type="button" id="bookings-prev">← Vorheriger Monat</button>
            <button class="btn secondary small" type="button" id="bookings-current">Aktueller Monat</button>
            <button class="btn secondary small" type="button" id="bookings-next">Nächster Monat →</button>
          </div>
          <strong>${esc(bookingMonthLabel(month))}</strong>
        </div>
        <div class="table-wrap"><table class="employee-bookings-table">
          <thead><tr><th>Datum</th><th>Projekt</th><th>KOMMEN</th><th>GEHEN</th><th>Arbeitszeit</th><th>Buchungsart</th><th>Terminal / Hinweis</th></tr></thead>
          <tbody>${monthRecords.length?monthRecords.map(r=>{
            if(r.recordType==='adjustment'){
              const note=[r.adjustmentReason,r.adjustmentDetails].filter(Boolean).join(' · ');
              return `<tr class="adjustment-row"><td>${esc(bookingDateKey(r).split('-').reverse().join('.'))}</td><td>${esc(r.projectNumber||'–')}</td><td colspan="2"><strong>Stundenkorrektur</strong></td><td><strong>${esc(bookingMinutesText(r.adjustmentMinutes,{signed:true}))}</strong></td><td>${esc(bookingSourceLabel(r))}</td><td>${esc(note||r.createdByName||'Personalabteilung')}</td></tr>`;
            }
            const calc=bookingValues.get(r.id);const net=calc?calc.net:bookingNetMinutes(r);
            const terminal=[r.terminalName||r.terminalId,r.terminalEndId&&r.terminalEndId!==(r.terminalId||'')?`GEHEN: ${r.terminalEndId}`:''].filter(Boolean).join(' · ');
            const open=!bookingToDate(r.endAt)&&r.status!=='closed';
            return `<tr><td>${esc(bookingDateKey(r).split('-').reverse().join('.'))}</td><td>${esc(r.projectNumber||'–')}</td><td>${esc(bookingTime(r,'start')||'–')}${wasStartLimited(r,employee.earliestStartTime||'')?`<small class="booking-note start-limit-note">anrechenbar ab ${esc(employee.earliestStartTime)} Uhr</small>`:''}</td><td>${esc(bookingTime(r,'end')||'–')}</td><td>${net===null?(open?'<span class="pill yellow">läuft</span>':'–'):esc(bookingMinutesText(net))}</td><td>${esc(bookingSourceLabel(r))}</td><td>${esc(terminal|| (open?'offene Buchung':'–'))}</td></tr>`;
          }).join(''):`<tr><td colspan="7" class="empty">Für ${esc(bookingMonthLabel(month))} sind keine Buchungen vorhanden.</td></tr>`}</tbody>
        </table></div>`;
      box.querySelector('#bookings-prev').onclick=()=>{month=new Date(month.getFullYear(),month.getMonth()-1,1,12);renderMonth()};
      box.querySelector('#bookings-current').onclick=()=>{const n=new Date();month=new Date(n.getFullYear(),n.getMonth(),1,12);renderMonth()};
      box.querySelector('#bookings-next').onclick=()=>{month=new Date(month.getFullYear(),month.getMonth()+1,1,12);renderMonth()};
    };
    renderMonth();
  }

  async function renderNfcBox(employee){
    const box=el.querySelector('#nfc-credential-box');if(!box)return;
    if(!employee){box.innerHTML='<span class="muted">Der NFC-Transponder kann nach dem Anlegen des Mitarbeiters zugewiesen werden.</span>';return;}
    const active=nfcCredentials.filter(x=>x.userId===employee.id&&x.active!==false);
    box.innerHTML=`<div class="nfc-status-row"><div><strong>${active.length?'NFC-Transponder aktiv':'Kein NFC-Transponder zugewiesen'}</strong><span>${active.length?'Der Mitarbeiter kann sich an freigeschalteten Terminals identifizieren.':'Für die Terminal-Zeiterfassung zunächst einen Transponder programmieren.'}</span></div><span class="pill ${active.length?'green':'yellow'}">${active.length?'aktiv':'nicht eingerichtet'}</span></div><div class="actions"><button class="btn primary small" type="button" id="assign-nfc">${active.length?'Neuen Transponder zuweisen':'Transponder zuweisen'}</button>${active.length?'<button class="btn danger small" type="button" id="disable-nfc">Transponder sperren</button>':''}</div><small class="nfc-browser-note">${nfcSupported()?'Web NFC ist auf diesem Gerät verfügbar.':'Zum Programmieren bitte diese Mitarbeiterkartei in Google Chrome auf einem NFC-fähigen Android-Gerät öffnen.'}</small>`;
    const assign=box.querySelector('#assign-nfc');if(assign)assign.onclick=async()=>{
      if(!nfcSupported()){toast('Bitte Google Chrome auf einem NFC-fähigen Android-Gerät verwenden.');return;}
      if(active.length&&!confirm('Der bisherige NFC-Transponder wird nach erfolgreicher Zuweisung gesperrt. Fortfahren?'))return;
      const token=randomToken(24);assign.disabled=true;assign.textContent='Transponder bereithalten …';
      try{
        await writeEmployeeNfcTag(token);
        const hash=await sha256Hex(token);const batch=writeBatch(db);
        active.forEach(c=>batch.update(doc(db,'nfcCredentials',c.id),{active:false,disabledAt:serverTimestamp(),updatedAt:serverTimestamp()}));
        batch.set(doc(db,'nfcCredentials',hash),{userId:employee.id,userName:employee.name||'',employeeNumber:employee.employeeNumber||'',active:true,createdAt:serverTimestamp(),createdBy:ctx.profile.id});
        await batch.commit();toast(`NFC-Transponder für ${employee.name||'Mitarbeiter'} wurde erfolgreich zugewiesen.`);
        box.innerHTML='<div class="success-box"><strong>NFC-Transponder zugewiesen</strong><span>Der Transponder ist jetzt für die Terminal-Zeiterfassung freigeschaltet.</span></div>';
      }catch(err){console.error(err);toast(err?.message||'NFC-Transponder konnte nicht programmiert werden.');assign.disabled=false;assign.textContent=active.length?'Neuen Transponder zuweisen':'Transponder zuweisen';}
    };
    const disable=box.querySelector('#disable-nfc');if(disable)disable.onclick=async()=>{if(!confirm('Den NFC-Transponder dieses Mitarbeiters wirklich sperren?'))return;try{const batch=writeBatch(db);active.forEach(c=>batch.update(doc(db,'nfcCredentials',c.id),{active:false,disabledAt:serverTimestamp(),updatedAt:serverTimestamp()}));await batch.commit();box.innerHTML='<div class="warning-box"><strong>Transponder gesperrt</strong><span>Der bisherige NFC-Transponder kann nicht mehr zum Stempeln verwendet werden.</span></div>';toast('NFC-Transponder wurde gesperrt.');}catch(err){console.error(err);toast('Transponder konnte nicht gesperrt werden.');}};
  }
  if(!(canView||canEdit||canDelete)&&canCreate){show?.classList.add('hidden');create?.classList.remove('hidden');}
  function tab(t){show.classList.toggle('hidden',t!=='show');create.classList.toggle('hidden',t!=='create');el.querySelectorAll('.choice-card').forEach(x=>x.classList.toggle('active',x.dataset.tab===t))}
  async function prepareNew(){if(!canCreate){toast('Keine Berechtigung zum Anlegen von Mitarbeitern.');return;}form.reset();form.elements.loginType.disabled=false;form.elements.login.disabled=false;form.elements.role.disabled=false;form.querySelectorAll('[name=adminPermission]').forEach(x=>{x.checked=true;x.disabled=!canManagePermissions});const adminOption=[...form.elements.role.options].find(o=>o.value==='admin');if(adminOption)adminOption.disabled=!canManagePermissions;form.querySelectorAll('[name=workDay]').forEach(x=>x.checked=['1','2','3','4','5'].includes(x.value));setVal(form,'weeklyHours',40);setVal(form,'vacationDays',30);setVal(form,'projectTimeTracking','false');setVal(form,'earliestStartTime','');setVal(form,'active','true');setVal(form,'trainingValidFrom',new Date().toISOString().slice(0,10));el.querySelector('#employee-form-title').textContent='Mitarbeiter anlegen';form.querySelectorAll('input,select,textarea').forEach(x=>x.disabled=false);form.querySelectorAll('button[type=submit]').forEach(x=>x.classList.remove('hidden'));const box=form.querySelector('#admin-permissions-box');if(box)box.classList.add('hidden');syncAdminRoleSections();renderPhotoEditor(null);await renderPersonalakte(akte,ctx,null,{readOnly:false,canManage:canManageDocs});await renderNfcBox(null);if(canViewBookings)await renderBookingBox(null)}
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


  function formatMoney(value){
    if(value===null||value===undefined||value==='')return '–';
    const n=Number(value);
    return Number.isFinite(n)?new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(n):'–';
  }
  function formatHistoryDate(value){
    if(!value)return '–';
    if(value?.toDate)return value.toDate().toLocaleString('de-DE');
    const s=String(value);
    if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s.split('-').reverse().join('.');
    const d=new Date(value);
    return Number.isNaN(d.getTime())?s:d.toLocaleString('de-DE');
  }
  async function renderSalaryHistory(employee){
    const box=el.querySelector('#salary-history-list');if(!box)return;
    if(!employee?.id){box.innerHTML='<span class="muted">Mitarbeiter zuerst öffnen.</span>';return}
    box.innerHTML='<span class="muted">Vergütungshistorie wird geladen …</span>';
    try{
      const snap=await getDocs(query(collection(db,'salaryHistory'),where('userId','==',employee.id)));
      const rows=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(b.validFrom||'').localeCompare(String(a.validFrom||''))||((b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0)));
      box.innerHTML=rows.length?`<div class="table-wrap"><table class="compact-table"><thead><tr><th>Gültig ab</th><th>Monatsgehalt</th><th>Stundenlohn</th><th>Übernommen von</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(formatHistoryDate(r.validFrom))}</td><td>${esc(formatMoney(r.grossSalary))}</td><td>${esc(r.hourlyRate==null?'–':`${formatMoney(r.hourlyRate)} / h`)}</td><td>${esc(r.createdByName||r.createdBy||'–')}<small class="history-meta">${esc(formatHistoryDate(r.createdAt))}</small></td></tr>`).join('')}</tbody></table></div>`:'<span class="muted">Noch keine Vergütungshistorie vorhanden.</span>';
    }catch(err){console.error(err);box.innerHTML='<span class="error-text">Vergütungshistorie konnte nicht geladen werden.</span>'}
  }
  async function renderEmployeeNotes(employee){
    const box=el.querySelector('#employee-notes-list');if(!box)return;
    if(!employee?.id){box.innerHTML='<span class="muted">Mitarbeiter zuerst öffnen.</span>';return}
    box.innerHTML='<span class="muted">Notizen werden geladen …</span>';
    try{
      const snap=await getDocs(query(collection(db,'employeeNotes'),where('employeeId','==',employee.id)));
      const rows=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(b.noteDate||'').localeCompare(String(a.noteDate||''))||((b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0)));
      box.innerHTML=rows.length?`<div class="note-history-list">${rows.map(r=>`<article class="note-history-entry"><div class="note-history-head"><strong>${esc(formatHistoryDate(r.noteDate))}</strong><span>${esc(r.authorName||'–')} · ${r.authorRole==='supervisor'?'Vorgesetzter':'Personalabteilung / Admin'}</span></div><p>${esc(r.text||'')}</p><small>erfasst ${esc(formatHistoryDate(r.createdAt))}</small></article>`).join('')}</div>`:'<span class="muted">Noch keine Notizen vorhanden.</span>';
    }catch(err){console.error(err);box.innerHTML='<span class="error-text">Notizen konnten nicht geladen werden.</span>'}
  }
  function wireEmployeeHistoryActions(employee){
    const salaryBtn=el.querySelector('#salary-history-add');
    if(salaryBtn){
      salaryBtn.disabled=!canEdit||!employee?.id;
      salaryBtn.onclick=async()=>{
        if(!canEdit||!employee?.id)return;
        const gross=numberOrNull(form.elements.grossSalary.value),hourly=numberOrNull(form.elements.hourlyRate.value),validFrom=form.elements.salaryValidFrom.value;
        if(gross===null&&hourly===null){toast('Bitte Monatsgehalt und/oder Stundenlohn eingeben.');return}
        if(!validFrom){toast('Bitte das Datum „Gültig ab“ angeben.');return}
        try{
          salaryBtn.disabled=true;
          const ref=doc(collection(db,'salaryHistory')),batch=writeBatch(db);
          batch.set(ref,{userId:employee.id,employeeName:employee.name||'',grossSalary:gross,hourlyRate:hourly,validFrom,createdBy:ctx.profile.id,createdByName:ctx.profile.name||ctx.profile.email||'',createdAt:serverTimestamp()});
          batch.set(doc(db,'employeePrivate',employee.id),{grossSalary:gross,hourlyRate:hourly,salaryValidFrom:validFrom,updatedAt:serverTimestamp()},{merge:true});
          batch.set(doc(collection(db,'employeeHistory')),historyRecord(ctx,employee.id,employee,'salary_history_add',[{field:'private.compensationHistory',oldValue:null,newValue:{validFrom,grossSalary:gross,hourlyRate:hourly}}]));
          await batch.commit();
          const pm=privateMap.get(employee.id)||{};Object.assign(pm,{grossSalary:gross,hourlyRate:hourly,salaryValidFrom:validFrom});privateMap.set(employee.id,pm);
          toast('Vergütung in die Historie übernommen.');
          await renderSalaryHistory(employee);
        }catch(err){console.error(err);toast(err?.message||'Vergütung konnte nicht übernommen werden.')}finally{salaryBtn.disabled=false}
      };
    }
    const noteBtn=el.querySelector('#employee-note-add');
    if(noteBtn){
      noteBtn.disabled=!canManageNotes||!employee?.id;
      noteBtn.onclick=async()=>{
        if(!canManageNotes||!employee?.id)return;
        const textValue=form.elements.adminNoteText?.value.trim()||'',noteDate=form.elements.adminNoteDate?.value||'';
        if(!textValue){toast('Bitte einen Notiztext eingeben.');return}
        if(!noteDate){toast('Bitte ein Datum für die Notiz angeben.');return}
        try{
          noteBtn.disabled=true;
          await addDoc(collection(db,'employeeNotes'),{employeeId:employee.id,employeeName:employee.name||'',text:textValue,noteDate,authorId:ctx.profile.id,authorName:ctx.profile.name||ctx.profile.email||'',authorRole:'admin',createdAt:serverTimestamp()});
          form.elements.adminNoteText.value='';
          toast('Notiz übernommen.');
          await renderEmployeeNotes(employee);
        }catch(err){console.error(err);toast(err?.message||'Notiz konnte nicht gespeichert werden.')}finally{noteBtn.disabled=false}
      };
    }
  }

const renderPhotoEditor=(u)=>{
  const box=el.querySelector('#employee-photo-editor');if(!box)return;
  if(!u?.id){box.innerHTML='<span class="employee-profile-photo large"><span>MA</span></span><small>Foto nach dem ersten Speichern möglich</small>';return}
  const photo=photoUrls[u.id]||'';
  box.innerHTML=`<span class="employee-profile-photo large">${photo?`<img src="${esc(photo)}" alt="Foto von ${esc(u.name||'Mitarbeiter')}">`:`<span>${esc(initials(u.name||u.email||'MA'))}</span>`}</span>${canEdit?`<label class="btn secondary small employee-photo-upload">Foto ${photo?'ändern':'hochladen'}<input type="file" accept="image/jpeg,image/png,image/webp"></label>${photo?'<button type="button" class="btn danger small employee-photo-delete">Foto entfernen</button>':''}`:'<small>Nur Anzeige</small>'}`;
  const input=box.querySelector('input[type=file]');if(input)input.onchange=async()=>{const file=input.files?.[0];if(!file)return;try{toast('Foto wird hochgeladen …');const result=await uploadEmployeePhoto(ctx,u.id,file);if(result.url)photoUrls[u.id]=result.url;toast('Mitarbeiterfoto gespeichert.');renderPhotoEditor(u)}catch(err){console.error(err);toast(err?.message||'Foto konnte nicht gespeichert werden.')}};
  const del=box.querySelector('.employee-photo-delete');if(del)del.onclick=async()=>{if(!confirm('Mitarbeiterfoto wirklich entfernen?'))return;try{await deleteEmployeePhoto(ctx,u.id);delete photoUrls[u.id];toast('Mitarbeiterfoto entfernt.');renderPhotoEditor(u)}catch(err){console.error(err);toast(err?.message||'Foto konnte nicht entfernt werden.')}};
};

el.querySelectorAll('.edit-user').forEach(b=>b.onclick=async()=>{
    const u=users.find(x=>x.id===b.dataset.id),p=privateMap.get(u.id)||{};form.reset();setVal(form,'id',u.id);setVal(form,'name',u.name);setVal(form,'companyId',u.companyId);const usernameMode=u.hasRealEmail===false||String(u.email||'').endsWith('@portal.local');setVal(form,'loginType',usernameMode?'username':'email');setVal(form,'login',usernameMode?(u.username||String(u.email||'').replace(/@portal\.local$/,'')):(u.email||''));form.elements.loginType.disabled=true;form.elements.login.disabled=true;setVal(form,'role',u.role||'employee');setVal(form,'supervisorId',u.supervisorId||'');setVal(form,'supervisorId2',u.supervisorId2||'');setVal(form,'active',String(u.active!==false));setVal(form,'startDate',u.startDate||'');setVal(form,'endDate',u.endDate||'');setVal(form,'weeklyHours',u.weeklyHours??40);setVal(form,'vacationDays',u.vacationDays??30);setVal(form,'employeeNumber',u.employeeNumber||'');let areaValue=u.businessAreaId||businessAreas.find(a=>a.code===u.companyAreaNumber)?.id||'';if(!areaValue&&u.companyAreaNumber){const select=form.elements.businessAreaId;select.add(new Option(`${u.companyAreaNumber} · bisheriger Wert`,`legacy:${u.companyAreaNumber}`));areaValue=`legacy:${u.companyAreaNumber}`;}setVal(form,'businessAreaId',areaValue);setVal(form,'projectTimeTracking',String(u.projectTimeTracking===true));setVal(form,'earliestStartTime',u.earliestStartTime||'');
    ['department','position','contractType','probationEndDate','fixedTermEndDate','costCenter','firstAiderValidUntil','fireWardenValidUntil','forkliftPermitValidUntil','aerialLiftPermitValidUntil','drivingLicenseClasses','nextDrivingLicenseCheck','occupationalMedicalNotes'].forEach(k=>setVal(form,k,u[k]||''));['firstAider','fireWarden','forkliftPermit','aerialLiftPermit'].forEach(k=>boolVal(form,k,u[k]));
    const workDays=Array.isArray(u.workDays)&&u.workDays.length?u.workDays.map(String):['1','2','3','4','5'];form.querySelectorAll('[name=workDay]').forEach(x=>x.checked=workDays.includes(x.value));
    ['birthDate','maritalStatus','marriageDate','street','postalCode','city','privateEmail','phone','mobile','emergencyContactName','emergencyContactPhone','taxId','taxClass','religion','socialSecurityNumber','healthInsuranceId','insuranceType','personGroup','contributionGroup','iban','bic','bankId','accountHolder','salaryValidFrom'].forEach(k=>setVal(form,k,p[k]||''));setVal(form,'childAllowance',p.childAllowance??'');setVal(form,'grossSalary',p.grossSalary??'');setVal(form,'hourlyRate',p.hourlyRate??'');boolVal(form,'birthdayList',p.birthdayList===true);
    form.querySelectorAll('[name=bereich]').forEach(x=>x.checked=(u.bereiche||[]).includes(x.value));form.querySelectorAll('[name=extraTraining]').forEach(x=>x.checked=(u.extraTrainings||[]).includes(x.value));setVal(form,'trainingValidFrom',new Date().toISOString().slice(0,10));
    const loadedPermissions=normalizedAdminPermissions(u);form.querySelectorAll('[name=adminPermission]').forEach(x=>x.checked=loadedPermissions[x.value]!==false);
    const syncAdminPermissionVisibility=()=>{const box=form.querySelector('#admin-permissions-box');if(box)box.classList.toggle('hidden',form.elements.role.value!=='admin')};syncAdminPermissionVisibility();syncAdminRoleSections();
    const readOnly=!canEdit;form.querySelectorAll('input,select,textarea').forEach(x=>{if(x.name==='id')return;const noteField=['adminNoteText','adminNoteDate'].includes(x.name);x.disabled=(noteField?!canManageNotes:readOnly)||(['loginType','login'].includes(x.name));});
    if(!readOnly&&!canManagePermissions){form.querySelectorAll('[name=adminPermission]').forEach(x=>x.disabled=true);if(u.role==='admin')form.elements.role.disabled=true;}
    form.querySelectorAll('button[type=submit]').forEach(x=>x.classList.toggle('hidden',readOnly));
    el.querySelector('#employee-form-title').textContent=`Mitarbeiterkartei · ${u.name||'Mitarbeiter'}`;renderPhotoEditor(u);setVal(form,'adminNoteDate',new Date().toISOString().slice(0,10));tab('create');await renderPersonalakte(akte,ctx,u,{readOnly,canManage:canManageDocs});await renderNfcBox(u);if(canViewBookings)await renderBookingBox(u);await renderSalaryHistory(u);if(canManageNotes)await renderEmployeeNotes(u);wireEmployeeHistoryActions(u);window.scrollTo({top:0,behavior:'smooth'});
  });

  form.elements.role?.addEventListener('change',()=>{const box=form.querySelector('#admin-permissions-box');if(box)box.classList.toggle('hidden',form.elements.role.value!=='admin');syncAdminRoleSections();if(form.elements.role.value==='admin'&&![...form.querySelectorAll('[name=adminPermission]')].some(x=>x.checked))form.querySelectorAll('[name=adminPermission]').forEach(x=>x.checked=true)});

  form.onsubmit=async e=>{
    e.preventDefault();
    const f=e.currentTarget,id=f.elements.id.value;
    if(id&&!canEdit){toast('Keine Berechtigung zum Bearbeiten von Mitarbeitern.');return}
    if(!id&&!canCreate){toast('Keine Berechtigung zum Anlegen von Mitarbeitern.');return}
    const loginType=f.elements.loginType.value,login=f.elements.login.value.trim(),password=f.elements.password.value,email=loginType==='username'?syntheticEmail(login):login.toLowerCase();
    const previousUser=id?users.find(x=>x.id===id):null;
    if(id&&!canManagePermissions&&previousUser&&(previousUser.role==='admin'||f.elements.role.value==='admin')&&f.elements.role.value!==previousUser.role){toast('Keine Berechtigung zum Ändern von Admin-Rollen.');return}
    if(!id&&f.elements.role.value==='admin'&&!canManagePermissions){toast('Keine Berechtigung zum Anlegen von Admin-Zugängen.');return}
    const primarySupervisor=f.elements.supervisorId.value||'',secondarySupervisor=f.elements.supervisorId2.value||'';if(secondarySupervisor&&!primarySupervisor){el.querySelector('#user-message').textContent='Bitte zuerst einen 1. Vorgesetzten auswählen.';return;}if(primarySupervisor&&secondarySupervisor&&primarySupervisor===secondarySupervisor){el.querySelector('#user-message').textContent='1. und 2. Vorgesetzter müssen unterschiedliche Personen sein.';return;}if(id&&(primarySupervisor===id||secondarySupervisor===id)){el.querySelector('#user-message').textContent='Ein Mitarbeiter kann nicht sein eigener Vorgesetzter sein.';return;}const areaSelection=f.elements.businessAreaId.value,selectedArea=businessAreaMap.get(areaSelection),legacyArea=areaSelection.startsWith('legacy:')?areaSelection.slice(7):'';const employeeNumber=f.elements.employeeNumber.value.trim();if(!/^\d{5}$/.test(employeeNumber)){el.querySelector('#user-message').textContent='Die Mitarbeiternummer muss genau fünfstellig numerisch sein.';return;}const companyAreaNumber=selectedArea?.code||legacyArea;if(!/^\d{3}$/.test(companyAreaNumber)){el.querySelector('#user-message').textContent='Bitte einen gültigen dreistelligen Geschäftsbereich auswählen.';return;}const publicData={name:f.elements.name.value.trim(),companyId:f.elements.companyId.value,email,username:loginType==='username'?login.toLowerCase():'',hasRealEmail:loginType==='email',role:f.elements.role.value,adminPermissions:f.elements.role.value==='admin'?(canManagePermissions?Object.fromEntries(ADMIN_PERMISSION_DEFS.map(x=>[x.key,[...f.querySelectorAll('[name=adminPermission]')].find(c=>c.value===x.key)?.checked===true])):(previousUser?.adminPermissions||DEFAULT_ADMIN_PERMISSIONS)):{},supervisorId:f.elements.supervisorId.value||null,supervisorId2:f.elements.supervisorId2.value||null,active:f.elements.active.value==='true',startDate:f.elements.startDate.value||null,endDate:f.elements.endDate.value||null,weeklyHours:Number(f.elements.weeklyHours.value||40),vacationDays:Number(f.elements.vacationDays.value||30),earliestStartTime:f.elements.earliestStartTime.value||'',employeeNumber,businessAreaId:selectedArea?.id||'',companyAreaNumber,projectTimeTracking:f.elements.projectTimeTracking.value==='true',department:f.elements.department.value.trim(),position:f.elements.position.value.trim(),contractType:f.elements.contractType.value,probationEndDate:f.elements.probationEndDate.value||null,fixedTermEndDate:f.elements.fixedTermEndDate.value||null,costCenter:f.elements.costCenter.value.trim(),workDays:[...f.querySelectorAll('[name=workDay]:checked')].map(x=>x.value),firstAider:f.elements.firstAider.value==='true',firstAiderValidUntil:f.elements.firstAiderValidUntil.value||null,fireWarden:f.elements.fireWarden.value==='true',fireWardenValidUntil:f.elements.fireWardenValidUntil.value||null,forkliftPermit:f.elements.forkliftPermit.value==='true',forkliftPermitValidUntil:f.elements.forkliftPermitValidUntil.value||null,aerialLiftPermit:f.elements.aerialLiftPermit.value==='true',aerialLiftPermitValidUntil:f.elements.aerialLiftPermitValidUntil.value||null,drivingLicenseClasses:f.elements.drivingLicenseClasses.value.trim(),nextDrivingLicenseCheck:f.elements.nextDrivingLicenseCheck.value||null,occupationalMedicalNotes:f.elements.occupationalMedicalNotes.value.trim(),bereiche:[...f.querySelectorAll('[name=bereich]:checked')].map(x=>x.value),extraTrainings:[...f.querySelectorAll('[name=extraTraining]:checked')].map(x=>x.value),updatedAt:serverTimestamp()};
    const newTrainingAreas=[...f.querySelectorAll('[name=bereich]:checked')].map(x=>x.value),newExtraTrainings=[...f.querySelectorAll('[name=extraTraining]:checked')].map(x=>x.value);publicData.bereiche=newTrainingAreas;publicData.extraTrainings=newExtraTrainings;
    if(id&&previousUser){
      const selectionChanged=!sameTrainingSelection(previousUser.bereiche,previousUser.extraTrainings,newTrainingAreas,newExtraTrainings);
      if(selectionChanged){
        const validFrom=f.elements.trainingValidFrom.value;
        if(!validFrom){el.querySelector('#user-message').textContent='Bitte bei einer geänderten Schulungszuordnung das Datum „gültig ab“ angeben.';return;}
        publicData.trainingAssignments=upsertTrainingAssignmentHistory(previousUser,newTrainingAreas,newExtraTrainings,validFrom);
      }else if(Array.isArray(previousUser.trainingAssignments)&&previousUser.trainingAssignments.length){
        publicData.trainingAssignments=previousUser.trainingAssignments;
      }
    }else if(!id){
      const validFrom=f.elements.trainingValidFrom.value||f.elements.startDate.value||new Date().toISOString().slice(0,10);
      publicData.trainingAssignments=[{validFrom,bereiche:newTrainingAreas,extraTrainings:newExtraTrainings}];
    }
    const privateData={birthDate:f.elements.birthDate.value||null,birthdayList:f.elements.birthdayList.checked===true,maritalStatus:f.elements.maritalStatus.value,marriageDate:f.elements.marriageDate.value||null,street:f.elements.street.value.trim(),postalCode:f.elements.postalCode.value.trim(),city:f.elements.city.value.trim(),privateEmail:f.elements.privateEmail.value.trim().toLowerCase(),phone:f.elements.phone.value.trim(),mobile:f.elements.mobile.value.trim(),emergencyContactName:f.elements.emergencyContactName.value.trim(),emergencyContactPhone:f.elements.emergencyContactPhone.value.trim(),taxId:f.elements.taxId.value.trim(),taxClass:f.elements.taxClass.value,childAllowance:numberOrNull(f.elements.childAllowance.value),religion:f.elements.religion.value,socialSecurityNumber:f.elements.socialSecurityNumber.value.trim(),healthInsuranceId:f.elements.healthInsuranceId.value,insuranceType:f.elements.insuranceType.value,personGroup:f.elements.personGroup.value.trim(),contributionGroup:f.elements.contributionGroup.value.trim(),iban:f.elements.iban.value.replace(/\s+/g,'').toUpperCase(),bic:f.elements.bic.value.replace(/\s+/g,'').toUpperCase(),bankId:f.elements.bankId.value,accountHolder:f.elements.accountHolder.value.trim(),grossSalary:numberOrNull(f.elements.grossSalary.value),hourlyRate:numberOrNull(f.elements.hourlyRate.value),salaryValidFrom:f.elements.salaryValidFrom.value||null,updatedAt:serverTimestamp()};
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
