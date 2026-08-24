import { firebaseConfig, db } from "./firebase.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { initializeAuth, inMemoryPersistence, createUserWithEmailAndPassword, signOut as secondarySignOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { collection, getDocs, doc, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setHead } from "./app.js";
import { AREA_NAMES, esc, fmtDate, syntheticEmail, ROLE_LABELS, toast } from "./utils.js";


const HISTORY_FIELDS = [
  "name","companyId","email","username","hasRealEmail","role","supervisorId",
  "active","startDate","endDate","weeklyHours","vacationDays","employeeNumber","companyAreaNumber","projectTimeTracking","bereiche","extraTrainings"
];
function comparable(value){
  if(Array.isArray(value)) return [...value].map(String).sort();
  return value ?? null;
}
function sameValue(a,b){return JSON.stringify(comparable(a))===JSON.stringify(comparable(b))}
function getChanges(before,after){
  return HISTORY_FIELDS.filter(field=>!sameValue(before?.[field],after?.[field])).map(field=>({
    field, oldValue: comparable(before?.[field]), newValue: comparable(after?.[field])
  }));
}
function historyRecord(ctx,employeeId,employee,action,changes=[]){
  return {
    employeeId,
    employeeName: employee.name || "",
    employeeEmail: employee.hasRealEmail===false ? (employee.username || "") : (employee.email || ""),
    action,
    changes,
    actorId: ctx.user?.uid || "",
    actorName: ctx.profile?.name || "",
    actorEmail: ctx.profile?.email || ctx.user?.email || "",
    createdAt: serverTimestamp()
  };
}

async function createAuthAccount(email,password){
  // Für die Benutzeranlage wird bewusst eine getrennte, nur temporäre Auth-Instanz
  // ohne Browser-Persistenz verwendet. createUserWithEmailAndPassword meldet den
  // neu erzeugten Benutzer automatisch an; mit inMemoryPersistence kann dieser
  // Login nicht in Local-/Session-Storage des Browsers hängen bleiben.
  const name=`creator-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const app=initializeApp(firebaseConfig,name);
  const a=initializeAuth(app,{persistence:inMemoryPersistence});
  try{
    const cred=await createUserWithEmailAndPassword(a,email,password);
    const uid=cred.user.uid;
    await secondarySignOut(a);
    return uid;
  }finally{
    await deleteApp(app);
  }
}
export async function renderMitarbeiter(el,ctx){
  setHead("Mitarbeiter","Mitarbeiter anzeigen, anlegen und Personal-/Schulungszuordnungen verwalten.");
  const [uSnap,cSnap,tSnap]=await Promise.all([getDocs(collection(db,'users')),getDocs(collection(db,'companies')),getDocs(collection(db,'trainings'))]);
  const users=uSnap.docs.map(d=>({id:d.id,...d.data()})),companies=cSnap.docs.map(d=>({id:d.id,...d.data()})),trainings=tSnap.docs.map(d=>({id:d.id,...d.data()}));
  const supervisors=users.filter(u=>u.role==='supervisor'||u.role==='admin');
  el.innerHTML=`<div class="admin-choice-grid"><button class="choice-card active" data-tab="show"><span>♙</span><strong>Benutzer anzeigen</strong><small>Alle vorhandenen Mitarbeiter direkt anzeigen</small></button><button class="choice-card" data-tab="create"><span>＋</span><strong>Benutzer anlegen</strong><small>Neuen Mitarbeiter und Zugang anlegen</small></button></div>
  <section id="user-show"><article class="card"><div class="card-head"><div><h2>Benutzerübersicht</h2><p>${users.length} Benutzer vorhanden</p></div></div><div class="table-wrap"><table><thead><tr><th>Name</th><th>Mitarb.-Nr.</th><th>Firma</th><th>Firmenbereich</th><th>Rolle</th><th>Login</th><th>Bereiche</th><th>Status</th><th></th></tr></thead><tbody>${users.length?users.sort((a,b)=>(a.name||'').localeCompare(b.name||'')).map(u=>`<tr><td><strong>${esc(u.name||'')}</strong></td><td>${esc(u.employeeNumber||'–')}</td><td>${esc(companies.find(c=>c.id===u.companyId)?.short||companies.find(c=>c.id===u.companyId)?.name||'–')}</td><td>${esc(u.companyAreaNumber||'–')}</td><td>${esc(ROLE_LABELS[u.role]||u.role||'–')}</td><td>${esc(u.hasRealEmail===false?(u.username||'Benutzername'):(u.email||'–'))}</td><td>${(u.bereiche||[]).map(x=>esc(x)).join(', ')||'–'}</td><td><span class="pill ${u.active===false?'red':'green'}">${u.active===false?'inaktiv':'aktiv'}</span></td><td><button class="btn secondary small edit-user" data-id="${u.id}">Bearbeiten</button></td></tr>`).join(''):`<tr><td colspan="9" class="empty">Noch keine Benutzer angelegt.</td></tr>`}</tbody></table></div></article></section>
  <section id="user-create" class="hidden"><article class="card"><div class="card-head"><div><h2>Benutzer anlegen / bearbeiten</h2><p>Mitarbeiterstammdaten und Schulungszuordnung in einem Formular</p></div></div><form id="user-form" class="form-grid"><input type="hidden" name="id"><label class="field"><span>Name</span><input name="name" required></label><label class="field"><span>Firma</span><select name="companyId" required><option value="">– auswählen –</option>${companies.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
  <label class="field"><span>Login-Art</span><select name="loginType"><option value="email">E-Mail-Adresse</option><option value="username">Benutzername</option></select></label><label class="field"><span>E-Mail / Benutzername</span><input name="login" required></label><label class="field"><span>Startpasswort</span><input name="password" type="text" placeholder="nur bei Neuanlage"></label><label class="field"><span>Rolle</span><select name="role"><option value="employee">Mitarbeiter</option><option value="supervisor">Vorgesetzter</option><option value="admin">Personalabteilung / Admin</option></select></label>
  <label class="field"><span>Vorgesetzter</span><select name="supervisorId"><option value="">Kein Vorgesetzter</option>${supervisors.map(u=>`<option value="${u.id}">${esc(u.name||u.email)}</option>`).join('')}</select></label><label class="field"><span>Status</span><select name="active"><option value="true">aktiv</option><option value="false">inaktiv</option></select></label><label class="field"><span>Eintritt</span><input name="startDate" type="date"></label><label class="field"><span>Austritt</span><input name="endDate" type="date"></label><label class="field"><span>Wochenstunden</span><input name="weeklyHours" type="number" step="0.25" value="40"></label><label class="field"><span>Urlaubstage/Jahr</span><input name="vacationDays" type="number" step="1" value="30"></label><label class="field"><span>Mitarbeiternummer</span><input name="employeeNumber" placeholder="Format folgt aus PDS-Vorgabe"></label><label class="field"><span>Firmenbereich-Nr.</span><input name="companyAreaNumber" placeholder="Format folgt aus PDS-Vorgabe"></label><label class="field"><span>Zeiterfassung auf Projekte</span><select name="projectTimeTracking"><option value="false">Nein</option><option value="true">Ja</option></select></label>
  <div class="field full"><span>Schulungsbereiche</span><div class="check-grid">${Object.entries(AREA_NAMES).map(([id,n])=>`<label><input type="checkbox" name="bereich" value="${id}"><span><b>Bereich ${id}</b>${esc(n)}</span></label>`).join('')}</div></div>
  <div class="field full"><span>Individuelle Zusatzschulungen</span><div class="check-grid compact">${trainings.length?trainings.map(t=>`<label><input type="checkbox" name="extraTraining" value="${t.id}"><span>${esc(t.title)}</span></label>`).join(''):'<div class="muted">Noch keine Schulungen vorhanden.</div>'}</div></div>
  <div class="field full actions"><button class="btn primary" type="submit">Benutzer speichern</button><button class="btn secondary" id="cancel-user" type="button">Abbrechen</button></div><p id="user-message" class="message field full"></p></form></article></section>`;
  const show=el.querySelector('#user-show'),create=el.querySelector('#user-create'),form=el.querySelector('#user-form');
  function tab(t){show.classList.toggle('hidden',t!=='show');create.classList.toggle('hidden',t!=='create');el.querySelectorAll('.choice-card').forEach(x=>x.classList.toggle('active',x.dataset.tab===t))}el.querySelectorAll('.choice-card').forEach(b=>b.onclick=()=>{if(b.dataset.tab==='create')form.reset();tab(b.dataset.tab)});
  el.querySelector('#cancel-user').onclick=()=>tab('show');
  el.querySelectorAll('.edit-user').forEach(b=>b.onclick=()=>{const u=users.find(x=>x.id===b.dataset.id);form.reset();form.elements.id.value=u.id;form.elements.name.value=u.name||'';form.elements.companyId.value=u.companyId||'';const usernameMode=u.hasRealEmail===false||String(u.email||'').endsWith('@portal.local');form.elements.loginType.value=usernameMode?'username':'email';form.elements.login.value=usernameMode?(u.username||String(u.email||'').replace(/@portal\.local$/,'')):(u.email||'');form.elements.role.value=u.role||'employee';form.elements.supervisorId.value=u.supervisorId||'';form.elements.active.value=String(u.active!==false);form.elements.startDate.value=u.startDate||'';form.elements.endDate.value=u.endDate||'';form.elements.weeklyHours.value=u.weeklyHours||40;form.elements.vacationDays.value=u.vacationDays||30;form.elements.employeeNumber.value=u.employeeNumber||'';form.elements.companyAreaNumber.value=u.companyAreaNumber||'';form.elements.projectTimeTracking.value=String(u.projectTimeTracking===true);form.querySelectorAll('[name=bereich]').forEach(x=>x.checked=(u.bereiche||[]).includes(x.value));form.querySelectorAll('[name=extraTraining]').forEach(x=>x.checked=(u.extraTrainings||[]).includes(x.value));tab('create')});
  form.onsubmit=async e=>{
    e.preventDefault();
    const f=e.currentTarget,id=f.elements.id.value,loginType=f.elements.loginType.value,login=f.elements.login.value.trim(),password=f.elements.password.value;
    const email=loginType==='username'?syntheticEmail(login):login.toLowerCase();
    const data={name:f.elements.name.value.trim(),companyId:f.elements.companyId.value,email,username:loginType==='username'?login.toLowerCase():'',hasRealEmail:loginType==='email',role:f.elements.role.value,supervisorId:f.elements.supervisorId.value||null,active:f.elements.active.value==='true',startDate:f.elements.startDate.value||null,endDate:f.elements.endDate.value||null,weeklyHours:Number(f.elements.weeklyHours.value||40),vacationDays:Number(f.elements.vacationDays.value||30),employeeNumber:f.elements.employeeNumber.value.trim(),companyAreaNumber:f.elements.companyAreaNumber.value.trim(),projectTimeTracking:f.elements.projectTimeTracking.value==='true',bereiche:[...f.querySelectorAll('[name=bereich]:checked')].map(x=>x.value),extraTrainings:[...f.querySelectorAll('[name=extraTraining]:checked')].map(x=>x.value),updatedAt:serverTimestamp()};
    try{
      const batch=writeBatch(db);
      if(id){
        const previous=users.find(x=>x.id===id)||{};
        const changes=getChanges(previous,data);
        batch.update(doc(db,'users',id),data);
        if(changes.length){
          const historyRef=doc(collection(db,'employeeHistory'));
          batch.set(historyRef,historyRecord(ctx,id,data,'update',changes));
        }
        await batch.commit();
      }else{
        if(!password||password.length<6) throw new Error('Für neue Benutzer wird ein Startpasswort mit mindestens 6 Zeichen benötigt.');
        const uid=await createAuthAccount(email,password);
        batch.set(doc(db,'users',uid),{...data,createdAt:serverTimestamp()});
        const historyRef=doc(collection(db,'employeeHistory'));
        batch.set(historyRef,historyRecord(ctx,uid,data,'create',[]));
        await batch.commit();
      }
      toast('Benutzer gespeichert.');
      await renderMitarbeiter(el,ctx);
    }catch(err){
      console.error(err);
      el.querySelector('#user-message').textContent=err.message||'Benutzer konnte nicht gespeichert werden.';
    }
  };
}
