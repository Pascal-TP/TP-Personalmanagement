import { db } from "./firebase.js";
import { collection, getDocs, doc, getDoc, query, where } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setHead } from "./app.js";
import { esc, toast } from "./utils.js";
import { hasAdminPermission } from "./permissions.js";

const ABSENCE_LABELS={sick:'Krank',child_sick:'Kind krank',special_leave:'Sonderurlaub',unpaid_leave:'Unbezahlter Urlaub',release:'Freistellung',parental_leave:'Elternzeit',other:'Sonstige Abwesenheit'};
function easterSunday(y){const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),mo=Math.floor((h+l-7*m+114)/31),day=((h+l-7*m+114)%31)+1;return new Date(y,mo-1,day,12)}
function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x}
function germanNationalHolidays(y){const fixed=[[0,1,'Neujahr'],[4,1,'Tag der Arbeit'],[9,3,'Tag der Deutschen Einheit'],[11,25,'1. Weihnachtstag'],[11,26,'2. Weihnachtstag']],e=easterSunday(y),mov=[[-2,'Karfreitag'],[1,'Ostermontag'],[39,'Christi Himmelfahrt'],[50,'Pfingstmontag']];const map=new Map();fixed.forEach(([m,d,n])=>map.set(dateKey(new Date(y,m,d,12)),n));mov.forEach(([o,n])=>map.set(dateKey(addDays(e,o)),n));return map}
function daySet(from,to){const out=[];let d=new Date(`${from}T12:00:00`),e=new Date(`${to}T12:00:00`);for(;d<=e;d.setDate(d.getDate()+1))out.push(dateKey(d));return out}
function annualHtml(user,year,vacations,absences){const workDays=new Set((user.workDays?.length?user.workDays:['1','2','3','4','5']).map(String)),holidays=germanNationalHolidays(year),marks=new Map();holidays.forEach((n,k)=>marks.set(k,{code:'F',cls:'holiday',title:n}));for(let m=0;m<12;m++){const last=new Date(year,m+1,0).getDate();for(let d=1;d<=last;d++){const dt=new Date(year,m,d,12),k=dateKey(dt);if(!workDays.has(String(dt.getDay()))&&!marks.has(k))marks.set(k,{code:'–',cls:'off',title:'Regelmäßig arbeitsfrei'})}}
  vacations.filter(v=>v.userId===user.id&&v.status==='approved').forEach(v=>daySet(v.from,v.to).forEach(k=>{if(k.startsWith(String(year))&&!marks.get(k)?.cls?.includes('holiday'))marks.set(k,{code:v.type==='Freizeitausgleich'?'G':v.type==='Sonderurlaub'?'SU':'U',cls:'vacation',title:v.type||'Urlaub'})}));
  absences.filter(a=>a.userId===user.id).forEach(a=>daySet(a.from,a.to).forEach(k=>{if(k.startsWith(String(year)))marks.set(k,{code:a.type==='sick'?'K':a.type==='child_sick'?'KK':a.type==='special_leave'?'SU':a.type==='unpaid_leave'?'UU':a.type==='release'?'FR':a.type==='parental_leave'?'EZ':'A',cls:'absence',title:ABSENCE_LABELS[a.type]||'Abwesenheit'})}));
  const months=['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];let rows='';for(let d=1;d<=31;d++){rows+=`<tr><th>${String(d).padStart(2,'0')}</th>`;for(let m=0;m<12;m++){const valid=d<=new Date(year,m+1,0).getDate();if(!valid){rows+='<td class="na"></td>';continue}const k=dateKey(new Date(year,m,d,12)),x=marks.get(k);rows+=`<td class="${x?.cls||''}" title="${esc(x?.title||'')}">${esc(x?.code||'')}</td>`}rows+='</tr>'}
  const vac=user.vacationDays||30,approved=vacations.filter(v=>v.userId===user.id&&v.status==='approved'&&String(v.from||'').startsWith(String(year))).reduce((s,v)=>s+Number(v.days||0),0),sick=absences.filter(a=>a.userId===user.id&&a.type==='sick'&&String(a.from||'').startsWith(String(year))).reduce((s,a)=>s+Number(a.days||0),0);
  return `<div class="annual-sheet"><div class="annual-title"><div><small>TP-Personalmanagement</small><h2>Jahresübersicht Anwesenheit ${year}</h2><strong>${esc(user.name||user.email||'')}</strong></div><span>Stand ${deDate(new Date())}</span></div><div class="annual-calendar-wrap"><table class="annual-calendar"><thead><tr><th>Tag</th>${months.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div><div class="annual-bottom"><div class="annual-stats"><div><span>Urlaubsanspruch</span><strong>${vac}</strong></div><div><span>Genehmigter Urlaub</span><strong>${approved}</strong></div><div><span>Rest (ohne Übertrag)</span><strong>${Math.max(0,vac-approved)}</strong></div><div><span>Krankheitstage</span><strong>${sick}</strong></div></div><div class="annual-legend"><span><i class="vacation"></i>U = Urlaub / G = Gleittag</span><span><i class="absence"></i>K = krank / weitere Abwesenheit</span><span><i class="holiday"></i>F = bundesweiter Feiertag</span><span><i class="off"></i>– = regelmäßig arbeitsfrei</span></div></div><p class="annual-note">Feiertage: bundesweit geltende Feiertage. Regionale Feiertage werden in V2.2 noch nicht automatisch ergänzt.</p></div>`}


function mondayOfWeek(value=new Date()){
  const d=new Date(value.getFullYear(),value.getMonth(),value.getDate(),12);
  const day=d.getDay()||7;
  d.setDate(d.getDate()-(day-1));
  return d;
}
function isoDate(d){return dateKey(d)}
function deDayShort(d){return new Intl.DateTimeFormat('de-DE',{weekday:'short',day:'2-digit',month:'2-digit'}).format(d)}
function deWeekRange(monday){const sunday=addDays(monday,6);return `${deDate(monday)} – ${deDate(sunday)}`}
function rangeContains(from,to,key){return !!from&&!!to&&from<=key&&to>=key}
function absenceMark(type){
  const map={
    sick:{label:'Krank',code:'K',cls:'sick'},
    child_sick:{label:'Kind krank',code:'KK',cls:'child-sick'},
    special_leave:{label:'Sonderurlaub',code:'SU',cls:'special'},
    unpaid_leave:{label:'Unbez. Urlaub',code:'UU',cls:'unpaid'},
    release:{label:'Freistellung',code:'FR',cls:'release'},
    parental_leave:{label:'Elternzeit',code:'EZ',cls:'parental'},
    other:{label:'Abwesend',code:'A',cls:'other'}
  };
  return map[type]||map.other;
}
function vacationMark(v){
  const type=String(v.type||'Urlaub');
  if(type==='Freizeitausgleich')return {label:'Gleittag',code:'G',cls:'vacation'};
  if(type==='Sonderurlaub')return {label:'Sonderurlaub',code:'SU',cls:'special'};
  return {label:'Urlaub',code:'U',cls:'vacation'};
}
function teamDayMark(user,key,vacations,absences){
  const abs=absences.find(a=>a.userId===user.id&&rangeContains(a.from,a.to,key));
  if(abs)return absenceMark(abs.type);
  const vac=vacations.find(v=>v.userId===user.id&&v.status==='approved'&&rangeContains(v.from,v.to,key));
  if(vac)return vacationMark(vac);
  const d=new Date(`${key}T12:00:00`);
  const holiday=germanNationalHolidays(d.getFullYear()).get(key);
  if(holiday)return {label:'Feiertag',code:'F',cls:'holiday',title:holiday};
  const workDays=new Set((user.workDays?.length?user.workDays:['1','2','3','4','5']).map(String));
  if(!workDays.has(String(d.getDay())))return {label:'Frei',code:'–',cls:'off'};
  return null;
}
function teamWeekHtml(users,monday,vacations,absences,filter=''){
  const days=Array.from({length:7},(_,i)=>addDays(monday,i));
  const q=String(filter||'').trim().toLocaleLowerCase('de');
  const visible=users.filter(u=>!q||(u.name||u.email||'').toLocaleLowerCase('de').includes(q));
  const rows=visible.map(u=>`<tr><th class="team-name-cell"><strong>${esc(u.name||u.email||u.id)}</strong><span>${esc(u.position||u.department||'')}</span></th>${days.map(d=>{const k=isoDate(d),m=teamDayMark(u,k,vacations,absences);return `<td class="team-day-cell ${m?`state-${m.cls}`:''}" title="${esc(m?.title||m?.label||'Keine Abwesenheit hinterlegt')}">${m?`<span class="team-day-badge">${esc(m.label)}</span>`:'<span class="team-day-empty">–</span>'}</td>`}).join('')}</tr>`).join('');
  return `<div class="team-week-scroll"><table class="team-week-table"><thead><tr><th class="team-name-cell">Mitarbeiter</th>${days.map(d=>`<th><span>${esc(new Intl.DateTimeFormat('de-DE',{weekday:'short'}).format(d))}</span><strong>${esc(new Intl.DateTimeFormat('de-DE',{day:'2-digit',month:'2-digit'}).format(d))}</strong></th>`).join('')}</tr></thead><tbody>${rows||'<tr><td colspan="8" class="empty">Keine Mitarbeiter gefunden.</td></tr>'}</tbody></table></div><div class="team-attendance-legend"><span><i class="state-vacation"></i>Urlaub / Gleittag</span><span><i class="state-sick"></i>Krank</span><span><i class="state-child-sick"></i>Kind krank</span><span><i class="state-special"></i>Sonderurlaub</span><span><i class="state-release"></i>weitere Abwesenheit</span><span><i class="state-holiday"></i>Feiertag</span><span><i class="state-off"></i>regelmäßig frei</span><span class="muted">Leere Zelle = keine Abwesenheit hinterlegt</span></div>`;
}

async function renderSupervisorAttendance(el,ctx){
  setHead('Auswertungen','Anwesenheits- und Abwesenheitsübersicht für die zugeordneten Mitarbeiter.');
  const [uSnap,vSnap,aSnap]=await Promise.all([
    getDocs(query(collection(db,'users'),where('supervisorId','==',ctx.profile.id))),
    getDocs(query(collection(db,'vacationRequests'),where('supervisorId','==',ctx.profile.id))),
    getDocs(query(collection(db,'absences'),where('supervisorId','==',ctx.profile.id)))
  ]);
  const users=uSnap.docs.map(d=>({id:d.id,...d.data()})).filter(u=>u.active!==false).sort((a,b)=>(a.name||'').localeCompare(b.name||'','de'));
  const vacations=vSnap.docs.map(d=>({id:d.id,...d.data()}));
  const absences=aSnap.docs.map(d=>({id:d.id,...d.data()}));
  let currentMonday=mondayOfWeek(new Date()),activeView='team',filter='';
  const currentYear=new Date().getFullYear();

  el.innerHTML=`<div class="kpi-grid three"><div class="kpi"><span>Zugeordnete Mitarbeiter</span><strong>${users.length}</strong><small>aktive Mitarbeiter</small></div><div class="kpi"><span>Heute abwesend</span><strong id="team-away-today">0</strong><small>Urlaub / Krankheit / sonstige Abwesenheit</small></div><div class="kpi"><span>Offene Urlaubsanträge</span><strong>${vacations.filter(v=>v.status==='pending').length}</strong><small>noch zu bearbeiten</small></div></div>
  <article class="card supervisor-attendance-card">
    <div class="card-head supervisor-attendance-head"><div><h2>Anwesenheitsübersicht</h2><p>Wochenübersicht für das Team oder Jahresansicht für einzelne Mitarbeiter.</p></div><div class="attendance-view-switch"><button type="button" class="btn primary" id="attendance-team-tab">Team-Woche</button><button type="button" class="btn secondary" id="attendance-single-tab">Einzelansicht</button></div></div>
    <div id="attendance-team-view">
      <div class="attendance-toolbar"><div class="attendance-week-nav"><button type="button" class="btn secondary small" id="week-prev">‹ Vorherige Woche</button><button type="button" class="btn secondary small" id="week-today">Aktuelle Woche</button><button type="button" class="btn secondary small" id="week-next">Nächste Woche ›</button></div><strong id="week-label"></strong><label class="attendance-search"><span>Mitarbeiter suchen</span><input id="team-search" type="search" placeholder="Name eingeben …"></label></div>
      <div id="team-week-result"></div>
    </div>
    <div id="attendance-single-view" class="hidden">
      <form class="form-grid annual-controls" id="supervisor-annual-form"><label class="field"><span>Mitarbeiter</span><select name="userId" required><option value="">– auswählen –</option>${users.map(u=>`<option value="${esc(u.id)}">${esc(u.name||u.email||u.id)}</option>`).join('')}</select></label><label class="field"><span>Jahr</span><input name="year" type="number" min="2020" max="2100" value="${currentYear}" required></label><div class="field actions"><button class="btn primary" type="button" id="supervisor-annual-show">Übersicht anzeigen</button></div></form>
      <div id="supervisor-annual-result"><div class="empty">Mitarbeiter und Jahr auswählen.</div></div>
    </div>
  </article>`;

  const todayKey=dateKey(new Date());
  const awayToday=new Set();
  absences.forEach(a=>{if(rangeContains(a.from,a.to,todayKey))awayToday.add(a.userId)});
  vacations.forEach(v=>{if(v.status==='approved'&&rangeContains(v.from,v.to,todayKey))awayToday.add(v.userId)});
  el.querySelector('#team-away-today').textContent=awayToday.size;

  const teamView=el.querySelector('#attendance-team-view'),singleView=el.querySelector('#attendance-single-view');
  const teamTab=el.querySelector('#attendance-team-tab'),singleTab=el.querySelector('#attendance-single-tab');
  const weekLabel=el.querySelector('#week-label'),weekResult=el.querySelector('#team-week-result');

  function switchView(view){
    activeView=view;
    const team=view==='team';
    teamView.classList.toggle('hidden',!team);singleView.classList.toggle('hidden',team);
    teamTab.className=`btn ${team?'primary':'secondary'}`;singleTab.className=`btn ${team?'secondary':'primary'}`;
  }
  function renderWeek(){
    weekLabel.textContent=deWeekRange(currentMonday);
    weekResult.innerHTML=teamWeekHtml(users,currentMonday,vacations,absences,filter);
  }
  teamTab.onclick=()=>switchView('team');singleTab.onclick=()=>switchView('single');
  el.querySelector('#week-prev').onclick=()=>{currentMonday=addDays(currentMonday,-7);renderWeek()};
  el.querySelector('#week-next').onclick=()=>{currentMonday=addDays(currentMonday,7);renderWeek()};
  el.querySelector('#week-today').onclick=()=>{currentMonday=mondayOfWeek(new Date());renderWeek()};
  el.querySelector('#team-search').oninput=e=>{filter=e.target.value;renderWeek()};
  const form=el.querySelector('#supervisor-annual-form'),result=el.querySelector('#supervisor-annual-result');
  el.querySelector('#supervisor-annual-show').onclick=()=>{const user=users.find(u=>u.id===form.elements.userId.value),year=Number(form.elements.year.value);if(!user||year<2020||year>2100){toast('Bitte Mitarbeiter und gültiges Jahr auswählen.','error');return}result.innerHTML=annualHtml(user,year,vacations,absences)};
  renderWeek();
}


const PDS_HEADERS=['kostenstelle','kostenstelleSek','kostentraeger','kostenart','leistungsart','buchungsperiode','belegnummer','belegdatum','betrag','buchungstext','menge','bucher','datenart','planvariante','notiz','kostentraegerSek'];
function toDate(value){if(!value)return null;if(value?.toDate)return value.toDate();const d=new Date(value);return Number.isNaN(d.getTime())?null:d}
function dateKey(d){const p=v=>String(v).padStart(2,"0");return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`}
function grossMinutes(r){const a=toDate(r.startAt),b=toDate(r.endAt);return a&&b&&b>a?Math.round((b-a)/60000):0}
function csvCell(v){const s=String(v??"");return /[;"\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
function download(name,text){const blob=new Blob(["\ufeff"+text],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function isoWeek(d){const x=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));const day=x.getUTCDay()||7;x.setUTCDate(x.getUTCDate()+4-day);const yearStart=new Date(Date.UTC(x.getUTCFullYear(),0,1));return Math.ceil((((x-yearStart)/86400000)+1)/7)}
function deDate(d){return new Intl.DateTimeFormat('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'}).format(d)}
function monthBounds(period){const m=/^(\d{4})-(\d{2})$/.exec(period||'');if(!m)return null;const y=Number(m[1]),mo=Number(m[2]);const from=`${m[1]}-${m[2]}-01`;const last=new Date(y,mo,0);return {year:y,month:mo,from,to:dateKey(last),label:`${m[1]}/${m[2]}`}}
function buildBookingText(settings,period,createdAt){const prefix=String(settings.bookingTextPrefix??'$7$ZeitDritts$');if(settings.bookingTextMode==='free')return `${prefix}${String(settings.bookingTextCustom||'')}`;return `${prefix}Periode${period.label}KW${String(isoWeek(createdAt)).padStart(2,'0')}`}

function allocateNetProjectMinutes(records,from,to){
  const byDay=new Map();
  records.filter(r=>r.recordType!=="adjustment"&&r.status==="closed"&&/^\d{6}$/.test(String(r.projectNumber||""))).forEach(r=>{
    const start=toDate(r.startAt);if(!start)return;const dk=dateKey(start);if(dk<from||dk>to)return;const g=grossMinutes(r);if(g<=0)return;
    const key=`${r.userId}|${dk}`;if(!byDay.has(key))byDay.set(key,[]);byDay.get(key).push({...r,_gross:g});
  });
  const out=[];
  for(const segments of byDay.values()){
    const totalGross=segments.reduce((s,r)=>s+r._gross,0),pause=totalGross>540?45:totalGross>360?30:0;let assigned=0;
    segments.forEach((r,i)=>{const share=i===segments.length-1?pause-assigned:Math.round(pause*(r._gross/totalGross));assigned+=share;out.push({...r,_net:Math.max(0,r._gross-share)})});
  }
  // Admin-Korrekturbuchungen mit Projektnummer sind bereits Netto-Minuten und
  // werden zusätzlich dem Projekt zugeordnet. Ohne Projektnummer bleiben sie
  // reine Stundenkonto-Korrekturen und erscheinen nicht im PDS-Projektexport.
  records.filter(r=>r.recordType==="adjustment"&&/^\d{6}$/.test(String(r.projectNumber||""))).forEach(r=>{
    const dk=String(r.adjustmentDate||"");
    if(dk<from||dk>to)return;
    const minutes=Math.round(Number(r.adjustmentMinutes)||0);
    if(minutes===0)return;
    out.push({...r,_net:minutes});
  });
  return out;
}

function buildPdsExport(records,users,companies,areas,settings,period,createdAt){
  const userMap=new Map(users.map(u=>[u.id,u])),companyMap=new Map(companies.map(c=>[c.id,c])),areaMap=new Map(areas.map(a=>[a.id,a]));
  const allocated=allocateNetProjectMinutes(records,period.from,period.to),groups=new Map(),errors=[];
  allocated.forEach(r=>{
    const u=userMap.get(r.userId)||{},c=companyMap.get(r.companyId||u.companyId)||{};
    const recordCompany=String(r.companyNumber||'').trim(),currentCompany=String(c.companyNumber||'').trim();
    const companyNumber=/^\d{2}$/.test(recordCompany)?recordCompany:currentCompany;
    const recordEmployee=String(r.employeeNumber||'').trim(),currentEmployee=String(u.employeeNumber||'').trim();
    const employeeNumber=/^\d{5}$/.test(recordEmployee)?recordEmployee:currentEmployee;
    const areaById=areaMap.get(u.businessAreaId||'');
    const recordArea=String(r.companyAreaNumber||'').trim(),currentArea=String(u.companyAreaNumber||areaById?.code||'').trim();
    const areaNumber=/^\d{3}$/.test(recordArea)?recordArea:currentArea;
    const projectNumber=String(r.projectNumber||'').trim();
    const validation=[];
    if(!/^\d{2}$/.test(companyNumber))validation.push('Firmennummer fehlt/ungültig (2 Stellen)');
    if(!/^\d{3}$/.test(areaNumber))validation.push('Geschäftsbereich fehlt/ungültig (3 Stellen)');
    if(!/^\d{5}$/.test(employeeNumber))validation.push('Mitarbeiternummer fehlt/ungültig (5 Stellen)');
    if(!/^\d{6}$/.test(projectNumber))validation.push('Projektnummer fehlt/ungültig (6 Stellen)');
    if(validation.length){errors.push({userName:r.userName||u.name||r.userId,projectNumber,issues:validation});return}
    const intercompanyNumber=companyNumber; // V1.6: eigener Mandant für den reinen Stundenimport
    const kostentraeger=`${companyNumber}${areaNumber}${intercompanyNumber}${projectNumber}`;
    const kostenart=`${settings.personnelCostPrefix||'60'}${employeeNumber}`;
    const key=[kostentraeger,kostenart,r.userId].join('|');
    if(!groups.has(key))groups.set(key,{kostentraeger,kostenart,companyNumber,areaNumber,intercompanyNumber,projectNumber,employeeNumber,userName:r.userName||u.name||'',minutes:0});
    groups.get(key).minutes+=r._net;
  });
  const bookingText=buildBookingText(settings,period,createdAt),belegdatum=deDate(createdAt),dataType=String(settings.dataType||'i');
  const rows=[...groups.values()].sort((a,b)=>`${a.kostentraeger}${a.kostenart}`.localeCompare(`${b.kostentraeger}${b.kostenart}`)).map(g=>({
    ...g,buchungsperiode:period.label,belegdatum,buchungstext:bookingText,menge:(g.minutes/60).toFixed(2).replace('.',','),datenart:dataType
  }));
  return {rows,errors};
}
function pdsCsv(rows){return [PDS_HEADERS.join(';'),...rows.map(r=>['','',r.kostentraeger,r.kostenart,'',r.buchungsperiode,'',r.belegdatum,'',r.buchungstext,r.menge,'',r.datenart,'','',''].map(csvCell).join(';'))].join('\r\n')}

function splitBirthdayName(value){
  const parts=String(value||'').trim().split(/\s+/).filter(Boolean);
  if(!parts.length)return {lastName:'–',firstName:'–'};
  if(parts.length===1)return {lastName:parts[0],firstName:''};
  return {lastName:parts[parts.length-1],firstName:parts.slice(0,-1).join(' ')};
}
function birthdayRows(users,privateMap,companies){
  const companyMap=new Map(companies.map(c=>[c.id,c]));
  return users.filter(u=>u.active!==false&&u.archived!==true).map(u=>{
    const p=privateMap.get(u.id)||{};
    if(p.birthdayList!==true||!/^\d{4}-\d{2}-\d{2}$/.test(String(p.birthDate||'')))return null;
    const [,m,d]=p.birthDate.split('-').map(Number);
    const names=splitBirthdayName(u.name||u.email||u.id);
    const company=companyMap.get(u.companyId)||{};
    return {user:u,month:m,day:d,...names,company:company.short||company.name||'–'};
  }).filter(Boolean).sort((a,b)=>a.month-b.month||a.day-b.day||a.lastName.localeCompare(b.lastName,'de')||a.firstName.localeCompare(b.firstName,'de'));
}
function birthdayListHtml(users,privateMap,companies){
  const rows=birthdayRows(users,privateMap,companies),months=['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  const grouped=months.map((name,i)=>({name,items:rows.filter(r=>r.month===i+1)})).filter(g=>g.items.length);
  const content=grouped.length?grouped.map(g=>`<section class="birthday-month"><h3>${g.name}</h3><div class="birthday-lines"><div class="birthday-row birthday-head"><span>Name</span><span>Vorname</span><span>Geburtstag</span><span>Firma</span></div>${g.items.map(r=>`<div class="birthday-row"><strong>${esc(r.lastName)}</strong><span>${esc(r.firstName)}</span><span class="birthday-date">${String(r.day).padStart(2,'0')}.${String(r.month).padStart(2,'0')}.</span><span>${esc(r.company)}</span></div>`).join('')}</div></section>`).join(''):'<div class="birthday-empty">Für die Geburtstagsliste sind derzeit keine Mitarbeiter freigegeben.</div>';
  return `<div class="birthday-sheet print-sheet"><div class="birthday-title"><div><small>TP-Personalmanagement</small><h2>Geburtstagsliste</h2></div><span>Stand ${deDate(new Date())}</span></div><div class="birthday-grid">${content}</div></div>`;
}
function printReport(type){
  document.body.dataset.printReport=type;
  const cleanup=()=>{delete document.body.dataset.printReport;window.removeEventListener('afterprint',cleanup)};
  window.addEventListener('afterprint',cleanup);
  window.print();
}

export async function renderAuswertungen(el,ctx){
  if(ctx.profile.role==='supervisor')return renderSupervisorAttendance(el,ctx);
  setHead('Auswertungen','Übergreifende Übersicht und fertiger PDS-Zeiterfassungsexport.');
  const canAnnual=ctx.profile.role==='admin'&&(hasAdminPermission(ctx.profile,'absenceManage')||hasAdminPermission(ctx.profile,'hoursExport'));
  const canBirthday=ctx.profile.role==='admin'&&hasAdminPermission(ctx.profile,'employeesView');
  const [u,t,v,c,tr,a,pdsDoc,ab,priv]=await Promise.all([getDocs(collection(db,'users')),getDocs(collection(db,'trainings')),getDocs(collection(db,'vacationRequests')),getDocs(collection(db,'companies')),getDocs(collection(db,'timeRecords')),getDocs(collection(db,'businessAreas')),getDoc(doc(db,'pdsSettings','default')),canAnnual?getDocs(collection(db,'absences')):Promise.resolve({docs:[]}),canBirthday?getDocs(collection(db,'employeePrivate')):Promise.resolve({docs:[]})]);
  let users=u.docs.map(d=>({id:d.id,...d.data()}));const absences=ab.docs.map(d=>({id:d.id,...d.data()})),vacations=v.docs.map(d=>({id:d.id,...d.data()})),privateMap=new Map(priv.docs.map(d=>[d.id,{id:d.id,...d.data()}]));const companies=c.docs.map(d=>({id:d.id,...d.data()})),records=tr.docs.map(d=>({id:d.id,...d.data()})),areas=a.docs.map(d=>({id:d.id,...d.data()}));
  const settings={personnelCostPrefix:'60',bookingTextPrefix:'$7$ZeitDritts$',bookingTextMode:'period_week',bookingTextCustom:'',dataType:'i',...(pdsDoc.exists()?pdsDoc.data():{})};
  if(ctx.profile.role==='supervisor')users=users.filter(x=>x.id===ctx.profile.id||x.supervisorId===ctx.profile.id);
  const canHoursExport=hasAdminPermission(ctx.profile,'hoursExport');
  const active=users.filter(x=>x.active!==false).length,pending=v.docs.map(d=>d.data()).filter(x=>x.status==='pending'&&(ctx.profile.role==='admin'||x.supervisorId===ctx.profile.id)).length;
  const now=new Date(),p=n=>String(n).padStart(2,'0'),periodDefault=`${now.getFullYear()}-${p(now.getMonth()+1)}`;
  el.innerHTML=`<div class="kpi-grid three"><div class="kpi"><span>Aktive Mitarbeiter</span><strong>${active}</strong><small>im sichtbaren Bereich</small></div><div class="kpi"><span>Schulungen</span><strong>${t.size}</strong><small>im System angelegt</small></div><div class="kpi"><span>Offene Urlaubsfreigaben</span><strong>${pending}</strong><small>aktuell zu bearbeiten</small></div></div>
  ${canHoursExport?`<article class="card"><div class="card-head"><div><h2>PDS-Zeiterfassungsexport</h2><p>Projektzeiten automatisch im vorgegebenen 16-spaltigen PDS-Importformat erzeugen.</p></div></div>
    <div class="info-strip"><strong>Exportlogik:</strong> Kostenträger = Firma (2) + Geschäftsbereich (3) + IC-Firma (2) + Projekt (6). In V1.6 wird für den reinen Stundenimport die eigene Firmennummer auch als IC-Firma verwendet. Kostenart = <strong>${esc(settings.personnelCostPrefix||'60')}</strong> + fünfstellige Mitarbeiternummer. Die Pause wird pro Tag einmal ermittelt und anteilig auf die Projektzeiten verteilt.</div>
    <form id="pds-export-form" class="form-grid"><label class="field"><span>Buchungsperiode</span><input name="period" type="month" value="${periodDefault}" required></label><div class="field"><span>Aktueller Buchungstext</span><div class="readonly-box" id="pds-booking-text"></div></div><div class="field full actions"><button class="btn secondary" type="button" id="pds-preview">PDS-Vorschau erzeugen</button><button class="btn primary" type="button" id="pds-download">CSV für PDS herunterladen</button></div></form>
    <div id="pds-export-result" class="table-wrap"></div></article>`:''}
  ${canAnnual?`<article class="card annual-report-card"><div class="card-head"><div><h2>Jahresübersicht Anwesenheit</h2><p>Mitarbeiter und Jahr auswählen, Jahresübersicht anzeigen und drucken bzw. als PDF speichern.</p></div></div><form id="annual-form" class="form-grid annual-controls"><label class="field"><span>Mitarbeiter</span><select name="userId" required><option value="">– auswählen –</option>${users.filter(x=>x.active!==false).sort((a,b)=>(a.name||'').localeCompare(b.name||'','de')).map(x=>`<option value="${esc(x.id)}">${esc(x.name||x.email||x.id)}</option>`).join('')}</select></label><label class="field"><span>Jahr</span><input name="year" type="number" min="2020" max="2100" value="${now.getFullYear()}" required></label><div class="field actions annual-actions"><button type="button" class="btn primary" id="annual-show">Übersicht anzeigen</button><button type="button" class="btn secondary" id="annual-print" disabled>Drucken / PDF</button><span class="annual-print-hint">Hinweis: Skalierung auf 73 % einstellen und „Hintergrundgrafiken“ aktivieren.</span></div></form><div id="annual-result"></div></article>`:''}
  ${canBirthday?`<article class="card birthday-report-card"><div class="card-head"><div><h2>Geburtstagsliste</h2><p>Nach Monaten sortierte Liste aller Mitarbeiter, die der Aufnahme in die Geburtstagsliste zugestimmt haben.</p></div></div><div class="actions birthday-actions"><button type="button" class="btn primary" id="birthday-show">Liste anzeigen</button><button type="button" class="btn secondary" id="birthday-print" disabled>Drucken / PDF</button></div><div id="birthday-result"></div></article>`:''}
  <article class="card"><div class="card-head"><div><h2>Weitere Auswertungen</h2><p>Dieser Bereich bleibt modular erweiterbar.</p></div></div><div class="info-strip">Weitere Kennzahlen wie Schulungsquoten, Personalbewegungen und firmenbezogene Auswertungen können hier später ergänzt werden.</div></article>`;
  if(canAnnual){const af=el.querySelector('#annual-form'),ar=el.querySelector('#annual-result'),pb=el.querySelector('#annual-print');el.querySelector('#annual-show').onclick=()=>{const user=users.find(x=>x.id===af.elements.userId.value),year=Number(af.elements.year.value);if(!user||year<2020||year>2100){toast('Bitte Mitarbeiter und gültiges Jahr auswählen.','error');return}ar.innerHTML=annualHtml(user,year,vacations,absences);pb.disabled=false};pb.onclick=()=>printReport('annual')}
  if(canBirthday){const br=el.querySelector('#birthday-result'),bp=el.querySelector('#birthday-print');el.querySelector('#birthday-show').onclick=()=>{br.innerHTML=birthdayListHtml(users,privateMap,companies);bp.disabled=false};bp.onclick=()=>printReport('birthday')}
  if(!canHoursExport)return;
  const form=el.querySelector('#pds-export-form'),result=el.querySelector('#pds-export-result'),booking=el.querySelector('#pds-booking-text');
  function currentPeriod(){return monthBounds(form.elements.period.value)}
  function refreshBooking(){const period=currentPeriod();booking.textContent=period?buildBookingText(settings,period,new Date()):'–'}
  form.elements.period.onchange=refreshBooking;refreshBooking();
  const build=()=>{const period=currentPeriod();if(!period)return {rows:[],errors:[{userName:'Export',projectNumber:'',issues:['Ungültige Buchungsperiode']}],period:null};return {...buildPdsExport(records,users,companies,areas,settings,period,new Date()),period}};
  const render=()=>{const data=build();const errorHtml=data.errors.length?`<div class="warning-box"><strong>${data.errors.length} Buchung(en) können nicht exportiert werden.</strong><span>Bitte die Stammdaten korrigieren. Die CSV wird erst erzeugt, wenn alle betroffenen Projektzeiten vollständig zugeordnet sind.</span></div><div class="table-wrap"><table><thead><tr><th>Mitarbeiter</th><th>Projekt</th><th>Fehler</th></tr></thead><tbody>${data.errors.map(x=>`<tr><td>${esc(x.userName)}</td><td>${esc(x.projectNumber||'–')}</td><td>${esc(x.issues.join('; '))}</td></tr>`).join('')}</tbody></table></div>`:'';
    const rowsHtml=data.rows.length?`<div class="payroll-preview-summary"><span class="pill green">${data.rows.length} PDS-Buchungszeilen</span><span class="pill blue">Periode ${esc(data.period?.label||'')}</span></div><table><thead><tr><th>Kostenträger</th><th>Kostenart</th><th>Mitarbeiter</th><th>Projekt</th><th>Menge</th><th>Buchungstext</th></tr></thead><tbody>${data.rows.map(r=>`<tr><td><strong>${esc(r.kostentraeger)}</strong><div class="small muted">${esc(r.companyNumber)} · ${esc(r.areaNumber)} · ${esc(r.intercompanyNumber)} · ${esc(r.projectNumber)}</div></td><td>${esc(r.kostenart)}</td><td>${esc(r.userName)}<div class="small muted">MA ${esc(r.employeeNumber)}</div></td><td>${esc(r.projectNumber)}</td><td>${esc(r.menge)} h</td><td>${esc(r.buchungstext)}</td></tr>`).join('')}</tbody></table>`:`<div class="empty">Für diese Buchungsperiode liegen keine abgeschlossenen projektbezogenen Buchungen vor.</div>`;
    result.innerHTML=errorHtml+rowsHtml;return data};
  el.querySelector('#pds-preview').onclick=render;
  el.querySelector('#pds-download').onclick=()=>{const data=render();if(data.errors.length){toast('CSV nicht erstellt: Bitte zuerst die angezeigten Stammdatenfehler korrigieren.','error');return}if(!data.rows.length){toast('Keine Daten für den Export vorhanden.');return}const created=new Date(),period=data.period;download(`PDS_Zeiten_${period.label.replace('/','-')}_${dateKey(created)}.csv`,pdsCsv(data.rows));toast('PDS-CSV wurde erstellt.')};
}
