import { db, functions } from './firebase.js';
import { collection, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js';
import { setHead } from './app.js';
import { esc } from './utils.js';
import { getEmployeePhotoUrls } from './employee-photos.js';

const getSupervisorEmployeeContact=httpsCallable(functions,'getSupervisorEmployeeContact');
const fallback=(name='')=>{const p=String(name).trim().split(/\s+/).filter(Boolean);return (p.length>1?`${p[0][0]}${p[p.length-1][0]}`:(p[0]||'MA').slice(0,2)).toUpperCase()};
const value=v=>esc(v||'–');

export async function renderSupervisorMitarbeiter(el,ctx){
  setHead('Mitarbeiter','Ihre direkt zugeordneten Mitarbeiter und deren freigegebene Kontaktdaten.');
  const snap=await getDocs(query(collection(db,'users'),where('supervisorId','==',ctx.user.uid)));
  const employees=snap.docs.map(d=>({id:d.id,...d.data()})).filter(u=>u.active!==false&&u.archived!==true).sort((a,b)=>(a.name||'').localeCompare(b.name||'','de'));
  let photoUrls={};
  try{photoUrls=await getEmployeePhotoUrls(ctx,employees.map(x=>x.id))}catch(err){console.warn('Mitarbeiterfotos konnten nicht geladen werden',err)}
  el.innerHTML=`<article class="card"><div class="card-head"><div><h2>Meine Mitarbeiter</h2><p>${employees.length} direkt zugeordnete Mitarbeiter</p></div></div>${employees.length?`<div class="supervisor-employee-grid">${employees.map(u=>`<button type="button" class="supervisor-employee-card" data-id="${u.id}"><span class="employee-list-photo">${photoUrls[u.id]?`<img src="${esc(photoUrls[u.id])}" alt="Foto von ${esc(u.name||'Mitarbeiter')}">`:`<span>${fallback(u.name)}</span>`}</span><span class="supervisor-employee-copy"><strong>${esc(u.name||'Mitarbeiter')}</strong><small>${esc(u.position||u.department||'')}</small><em>Mitarbeiternr. ${esc(u.employeeNumber||'–')}</em></span><span class="supervisor-employee-arrow">›</span></button>`).join('')}</div>`:'<div class="empty">Ihnen sind aktuell keine Mitarbeiter direkt zugeordnet.</div>'}</article><section id="supervisor-employee-detail"></section>`;
  el.querySelectorAll('.supervisor-employee-card').forEach(button=>button.onclick=async()=>{
    const employee=employees.find(x=>x.id===button.dataset.id);if(!employee)return;
    const detail=el.querySelector('#supervisor-employee-detail');detail.innerHTML='<div class="loading">Kontaktdaten werden geladen …</div>';
    try{
      const token=await ctx.user.getIdToken();
      const result=await getSupervisorEmployeeContact({idToken:token,employeeId:employee.id});
      const p=result.data?.contact||{};
      detail.innerHTML=`<div class="employee-file supervisor-readonly-file"><div class="employee-file-head"><div class="supervisor-profile-head"><span class="employee-profile-photo large">${photoUrls[employee.id]?`<img src="${esc(photoUrls[employee.id])}" alt="Foto von ${esc(employee.name||'Mitarbeiter')}">`:`<span>${fallback(employee.name)}</span>`}</span><div><span class="eyebrow">Mitarbeiteransicht</span><h2>${esc(employee.name||'Mitarbeiter')}</h2><p>${esc(employee.position||employee.department||'')}</p></div></div></div><section class="employee-section"><div class="employee-section-head"><span class="employee-section-icon">⌂</span><div><h3>Persönliche Daten & Kontakt</h3><p>Freigegebene Kontaktdaten des zugeordneten Mitarbeiters. Nur Lesezugriff.</p></div></div><div class="readonly-contact-grid"><div><span>Geburtsdatum</span><strong>${value(p.birthDate)}</strong></div><div><span>Private E-Mail</span><strong>${value(p.privateEmail)}</strong></div><div class="full"><span>Anschrift</span><strong>${value([p.street,[p.postalCode,p.city].filter(Boolean).join(' ')].filter(Boolean).join(', '))}</strong></div><div><span>Telefon</span><strong>${value(p.phone)}</strong></div><div><span>Mobil</span><strong>${value(p.mobile)}</strong></div><div><span>Notfallkontakt</span><strong>${value(p.emergencyContactName)}</strong></div><div><span>Telefon Notfallkontakt</span><strong>${value(p.emergencyContactPhone)}</strong></div></div></section></div>`;
      detail.scrollIntoView({behavior:'smooth',block:'start'});
    }catch(err){console.error(err);detail.innerHTML=`<div class="error-card"><strong>Kontaktdaten konnten nicht geladen werden.</strong><p>${esc(err?.message||'Keine Berechtigung.')}</p></div>`}
  });
}
