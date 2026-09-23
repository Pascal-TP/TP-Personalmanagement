import { db, auth, functions } from "./firebase.js";
import { collection, getDocs, query, where, orderBy, limit, doc, updateDoc, writeBatch, arrayUnion, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";
import { setHead } from "./app.js";
import { esc, fmtDate, statusPill, toast, confirmDialog } from "./utils.js";
import { beginPortalLoading, endPortalLoading } from "./loading-indicator.js";
import { hasAdminPermission } from "./permissions.js";
import { progressForTrainingYear, visibleTrainingsForYear } from "./training-utils.js";
import { calculateDailyTimeValues, calculateTimeAccountBalance, timeRecordStart } from "./time-utils.js";
import { getAssignedDocs } from "./supervisor-utils.js";
import { scheduledMinutesOn } from "./employment-utils.js";


const getTeamMilestones=httpsCallable(functions,'getPersonnelTeamMilestones');


const DASHBOARD_ABSENCE_LABELS={vacation:'Urlaub',sick:'Krank',child_sick:'Kind krank',special_leave:'Sonderurlaub',vocational_school:'Berufsschule',training:'Weiterbildung',university:'Uni',unpaid_leave:'Unbezahlter Urlaub',release:'Freistellung',parental_leave:'Elternzeit',other:'Sonstige Abwesenheit'};
function calendarEasterSunday(y){const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),mo=Math.floor((h+l-7*m+114)/31),day=((h+l-7*m+114)%31)+1;return new Date(y,mo-1,day,12)}
function calendarAddDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x}
function dashboardHolidays(y){const fixed=[[0,1,'Neujahr'],[4,1,'Tag der Arbeit'],[9,3,'Tag der Deutschen Einheit'],[11,25,'1. Weihnachtstag'],[11,26,'2. Weihnachtstag']],e=calendarEasterSunday(y),mov=[[-2,'Karfreitag'],[1,'Ostermontag'],[39,'Christi Himmelfahrt'],[50,'Pfingstmontag']],map=new Map();fixed.forEach(([m,d,n])=>map.set(localDateKey(new Date(y,m,d,12)),n));mov.forEach(([o,n])=>map.set(localDateKey(calendarAddDays(e,o)),n));return map}
function calendarRangeContains(from,to,key){return !!from&&!!to&&from<=key&&to>=key}
function dashboardDayMark(profile,key,vacations,absences){
  const absence=(absences||[]).find(a=>a.userId===profile.id&&a.status!=='withdrawn'&&calendarRangeContains(a.from,a.to,key));
  if(absence){const half=['morning','afternoon'].includes(absence.dayPortion);return {code:absence.type==='vacation'?(half?'½U':'U'):absence.type==='sick'?'K':absence.type==='child_sick'?'KK':absence.type==='special_leave'?'SU':absence.type==='unpaid_leave'?'UU':absence.type==='release'?'FR':absence.type==='parental_leave'?'EZ':absence.type==='vocational_school'?'BS':absence.type==='training'?'WB':absence.type==='university'?'UNI':'A',cls:absence.type==='vacation'?`vacation${absence.dayPortion==='morning'?' half-morning':absence.dayPortion==='afternoon'?' half-afternoon':''}`:'absence',title:`${DASHBOARD_ABSENCE_LABELS[absence.type]||'Abwesenheit'}${absence.dayPortion==='morning'?' – ½ Tag vormittags':absence.dayPortion==='afternoon'?' – ½ Tag nachmittags':''}`}}
  const vacation=(vacations||[]).find(v=>v.userId===profile.id&&v.status==='approved'&&calendarRangeContains(v.from,v.to,key));
  if(vacation){const half=['morning','afternoon'].includes(vacation.dayPortion);return {code:vacation.type==='Freizeitausgleich'?'G':vacation.type==='Sonderurlaub'?'SU':half?'½U':'U',cls:`vacation${vacation.dayPortion==='morning'?' half-morning':vacation.dayPortion==='afternoon'?' half-afternoon':''}`,title:`${vacation.type||'Urlaub'}${vacation.dayPortion==='morning'?' – ½ Tag vormittags':vacation.dayPortion==='afternoon'?' – ½ Tag nachmittags':''}`}}
  const d=new Date(`${key}T12:00:00`),holiday=dashboardHolidays(d.getFullYear()).get(key);if(holiday)return {code:'F',cls:'holiday',title:holiday};
  if(scheduledMinutesOn(profile,key)<=0)return {code:'–',cls:'off',title:'Regelmäßig arbeitsfrei'};return null;
}
function dashboardCalendarHtml(profile,vacations,absences,year,month){
  const first=new Date(year,month,1,12),offset=(first.getDay()+6)%7,last=new Date(year,month+1,0,12).getDate(),today=localDateKey(new Date()),monthLabel=new Intl.DateTimeFormat('de-DE',{month:'long',year:'numeric'}).format(first);let cells='';
  for(let i=0;i<42;i++){const day=i-offset+1;if(day<1||day>last){cells+='<div class="dashboard-calendar-day outside" aria-hidden="true"></div>';continue}const d=new Date(year,month,day,12),key=localDateKey(d),mark=dashboardDayMark(profile,key,vacations,absences),isToday=key===today;cells+=`<button type="button" class="dashboard-calendar-day ${mark?.cls||''} ${isToday?'today':''}" data-date="${key}" data-detail="${esc(mark?.title||'Keine Abwesenheit hinterlegt')}" aria-label="${esc(`${fmtDate(key)}${mark?.title?` – ${mark.title}`:''}${isToday?' – heute':''}`)}"><span>${day}</span>${mark?.code?`<b>${esc(mark.code)}</b>`:''}</button>`}
  return `<article class="card dashboard-calendar-card"><div class="card-head"><div><h2>Mein Kalender</h2><p>Urlaub und Abwesenheiten im Monatsüberblick</p></div></div><div class="dashboard-calendar-nav"><button type="button" class="dashboard-calendar-arrow" data-cal-step="-1" aria-label="Vorheriger Monat">‹</button><strong>${esc(monthLabel)}</strong><button type="button" class="dashboard-calendar-arrow" data-cal-step="1" aria-label="Nächster Monat">›</button></div><div class="dashboard-calendar-weekdays"><span>Mo</span><span>Di</span><span>Mi</span><span>Do</span><span>Fr</span><span>Sa</span><span>So</span></div><div class="dashboard-calendar-grid">${cells}</div><div class="dashboard-calendar-detail" aria-live="polite">Tag auswählen, um Details anzuzeigen.</div><div class="dashboard-calendar-legend"><span><i class="vacation"></i>U/G Urlaub / Gleittag</span><span><i class="vacation half-day"></i>½U halber Urlaub</span><span><i class="absence"></i>K/KK/… Abwesenheit</span><span><i class="holiday"></i>F Feiertag</span><span><i class="off"></i>– regelmäßig frei</span></div></article>`;
}


function dispatchDashboardNavigation(view){
  window.dispatchEvent(new CustomEvent("tp:navigate",{detail:{view}}));
}

function complianceAlertText(alert={}){
  const name=esc(alert.employeeName||"Mitarbeiter");
  const date=fmtDate(alert.workDate);
  if(alert.type==="over_10_hours"){
    const mins=Math.max(0,Math.round(Number(alert.workMinutes)||0));
    const hours=`${Math.floor(mins/60)}:${String(mins%60).padStart(2,"0")} h`;
    return `<strong>Achtung: Arbeitszeit über 10 Stunden</strong><p>${name} hatte am ${date} eine erfasste Arbeitszeit von <strong>${hours}</strong>. Nach § 3 Arbeitszeitgesetz (ArbZG) darf die werktägliche Arbeitszeit grundsätzlich acht Stunden nicht überschreiten und nur unter den dort genannten Ausgleichsvoraussetzungen auf bis zu zehn Stunden verlängert werden. Eine Arbeitszeit von mehr als zehn Stunden überschreitet damit grundsätzlich die gesetzliche Höchstgrenze, sofern keine zulässige Ausnahme greift. Bitte prüfen Sie den Vorgang und weisen Sie auf die Einhaltung der Arbeitszeitvorgaben hin.</p>`;
  }
  if(alert.type==="missing_time_record")return `<strong>Achtung: Zeitbuchung fehlt</strong><p>Für ${name} liegt am ${date} trotz geplanter Arbeitszeit keine Zeitbuchung und keine ganztägige Abwesenheit vor. Bitte prüfen Sie, ob eine Buchung oder Abwesenheit nachgetragen werden muss.</p>`;
  return `<strong>Achtung: Arbeitszeitende nicht gebucht</strong><p>${name} hat am ${date} vergessen, das Arbeitszeitende zu buchen. Das System hat die offene Buchung automatisch zum Tagesende um 24:00 Uhr geschlossen. Bitte prüfen Sie den Vorgang; falls die tatsächliche Endzeit abweicht, ist eine Korrektur zu veranlassen.</p>`;
}

function renderComplianceAlerts(items=[]){
  if(!items.length)return "";
  return `<article class="card compliance-alert-card"><div class="card-head"><div><h2>Arbeitszeit-Hinweise</h2><p>Diese Hinweise müssen von jedem zugeordneten Vorgesetzten persönlich zur Kenntnis genommen werden.</p></div><div class="actions"><span class="reminder-count urgent">${items.length} offen</span><button class="btn small primary compliance-ack-all-btn" type="button">Alle zur Kenntnis genommen</button></div></div><div class="compliance-alert-list">${items.map(a=>`<div class="compliance-alert-row"><div class="compliance-alert-main">${complianceAlertText(a)}<span class="compliance-alert-meta">Hinweis-ID: ${esc(a.id)}</span></div><button class="btn small primary compliance-ack-btn" type="button" data-id="${esc(a.id)}">Zur Kenntnis genommen</button></div>`).join("")}</div></article>`;
}
function formatSignedHours(minutes){
  const value=Math.round(Number(minutes)||0),sign=value>0?'+':value<0?'−':'',abs=Math.abs(value);
  return `${sign}${Math.floor(abs/60)}:${String(abs%60).padStart(2,'0')} h`;
}

function renderTgaOvertimeAlert(rows,monthName){
  if(!rows.length)return '';
  return `<article class="card tga-overtime-card">
    <div class="card-head"><div><h2>TGA · Zeitguthaben über 80 Stunden</h2><p>${esc(monthName)} · aktueller Stand. Der Anteil oberhalb von 80:00 h ist als Auszahlungsmenge ausgewiesen.</p></div><span class="reminder-count urgent">${rows.length} Mitarbeiter</span></div>
    <div class="table-wrap"><table><thead><tr><th>Mitarbeiter</th><th>Zeitguthaben</th><th>über 80 h</th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td><strong>${esc(r.name)}</strong>${r.employeeNumber?`<div class="small muted">MA ${esc(r.employeeNumber)}</div>`:''}</td><td><strong>${formatSignedHours(r.balanceMinutes)}</strong></td><td><span class="pill yellow">${formatSignedHours(r.excessMinutes)}</span></td></tr>`).join('')}
    </tbody></table></div>
  </article>`;
}

function renderMilestoneReminders(items=[]){
  if(!items.length)return '';
  return `<article class="card milestone-reminders-card">
    <div class="card-head"><div><h2>Geburtstage & Jubiläen</h2><p>Geburtstage 7 Tage im Voraus · Betriebsjubiläen 30 Tage im Voraus</p></div><span class="reminder-count">${items.length} Hinweis${items.length===1?'':'e'}</span></div>
    <div class="hr-reminder-list">${items.map(r=>`
      <div class="hr-reminder-row">
        <span class="hr-reminder-icon">${r.type==='birthday'?'G':'J'}</span>
        <div class="hr-reminder-main"><strong>${esc(r.type==='birthday'?'Geburtstag':`${r.years}. Betriebsjubiläum`)}</strong><span>${esc(r.name||'Mitarbeiter')}${r.department?` · ${esc(r.department)}`:''}</span></div>
        <div class="hr-reminder-date"><strong>${fmtDate(r.date)}</strong>${statusPill(r.days===0?'heute':`in ${r.days} Tag${r.days===1?'':'en'}`,r.days<=7?'yellow':'blue')}</div>
      </div>`).join('')}</div>
  </article>`;
}

function toDate(value){
  if(!value) return null;
  if(value?.toDate) return value.toDate();
  const d=new Date(value);
  return Number.isNaN(d.getTime())?null:d;
}

function localDateKey(date=new Date()){
  const p=v=>String(v).padStart(2,"0");
  return `${date.getFullYear()}-${p(date.getMonth()+1)}-${p(date.getDate())}`;
}

function combineLocal(dateKey,time){
  if(!dateKey||!time) return null;
  const d=new Date(`${dateKey}T${time}:00`);
  return Number.isNaN(d.getTime())?null:d;
}

function recordStart(record){
  if(record.recordType==="adjustment"){
    const d=record.adjustmentDate?new Date(`${record.adjustmentDate}T12:00:00`):null;
    return d&&!Number.isNaN(d.getTime())?d:toDate(record.createdAt);
  }
  return toDate(record.startAt)||combineLocal(record.date,record.start);
}

function recordEnd(record){
  return toDate(record.endAt)||combineLocal(record.date,record.end);
}

function recordNetMinutes(record,now=new Date()){
  if(record.recordType==="adjustment") return Number(record.adjustmentMinutes)||0;
  const start=recordStart(record);
  let end=recordEnd(record);
  if(!start) return 0;
  if(!end && record.status!=="closed") end=now;
  if(!end||end<start) return 0;
  const gross=Math.max(0,Math.round((end-start)/60000));
  const pause=gross>540?45:gross>360?30:0;
  return Math.max(0,gross-pause);
}

function workdaysBetween(start,end){
  if(!start||!end||start>end) return 0;
  const d=new Date(start.getFullYear(),start.getMonth(),start.getDate(),12);
  const last=new Date(end.getFullYear(),end.getMonth(),end.getDate(),12);
  let n=0;
  for(;d<=last;d.setDate(d.getDate()+1)) if(d.getDay()!==0&&d.getDay()!==6)n++;
  return n;
}

function overlapWorkdays(from,to,rangeStart,rangeEnd){
  if(!from||!to) return 0;
  const a=new Date(`${from}T12:00:00`),b=new Date(`${to}T12:00:00`);
  if(Number.isNaN(a.getTime())||Number.isNaN(b.getTime())) return 0;
  const start=a>rangeStart?a:rangeStart;
  const end=b<rangeEnd?b:rangeEnd;
  return workdaysBetween(start,end);
}

function hm(minutes,{signed=false}={}){
  const value=Math.round(Number(minutes)||0);
  const sign=signed?(value>0?"+":value<0?"−":""):"";
  const abs=Math.abs(value);
  return `${sign}${Math.floor(abs/60)}:${String(abs%60).padStart(2,"0")} h`;
}

function currentMonthBalance(profile,timeRecords,vacations,absences=[]){
  const now=new Date();
  const monthStart=new Date(now.getFullYear(),now.getMonth(),1,12);
  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate(),12);
  let calcStart=monthStart;
  if(profile.startDate){
    const employmentStart=new Date(`${profile.startDate}T12:00:00`);
    if(!Number.isNaN(employmentStart.getTime())&&employmentStart>calcStart)calcStart=employmentStart;
  }

  let targetMinutes=0;
  for(const day=new Date(calcStart);day<=today;day.setDate(day.getDate()+1)){
    const key=localDateKey(day),scheduled=scheduledMinutesOn(profile,key);
    const vacation=vacations.find(v=>v.status==='approved'&&calendarRangeContains(v.from,v.to,key));
    const absence=absences.find(a=>a.status!=='withdrawn'&&calendarRangeContains(a.from,a.to,key));
    const covered=vacation||absence,relief=covered?.from===covered?.to&&['morning','afternoon'].includes(covered?.dayPortion)?0.5:covered?1:0;
    targetMinutes+=Math.round(scheduled*(1-relief));
  }

  const relevantRecords=timeRecords.filter(r=>{
    const start=r.recordType==="adjustment"?(r.adjustmentDate?new Date(`${r.adjustmentDate}T12:00:00`):toDate(r.createdAt)):timeRecordStart(r);
    if(!start||Number.isNaN(start.getTime()))return false;
    const day=new Date(start.getFullYear(),start.getMonth(),start.getDate(),12);
    return day>=calcStart&&day<=today;
  });
  let actualMinutes=0;
  if(profile.flatEightHourEmployeeView===true){
    const bookedDays=new Set(relevantRecords.filter(r=>r.recordType!=="adjustment"&&timeRecordStart(r)).map(r=>localDateKey(timeRecordStart(r))));
    actualMinutes=bookedDays.size*480;
  }else{
    const timeValues=calculateDailyTimeValues(relevantRecords,profile,{includeOpen:true,now});
    actualMinutes=Math.round(relevantRecords.reduce((sum,r)=>sum+(timeValues.get(r.id)?.net||0),0));
  }

  return {targetMinutes,actualMinutes,balanceMinutes:actualMinutes-targetMinutes};
}


const HR_REMINDER_WINDOW_DAYS=90;
const DAY_MS=86400000;

function calendarDay(value){
  if(!value) return null;
  const d=value?.toDate?value.toDate():new Date(`${value}T12:00:00`);
  if(Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(),d.getMonth(),d.getDate(),12);
}

function daysFromToday(value){
  const target=calendarDay(value);
  if(!target) return null;
  const now=new Date(),today=new Date(now.getFullYear(),now.getMonth(),now.getDate(),12);
  return Math.round((target-today)/DAY_MS);
}

function reminderStatus(days){
  if(days<0) return {label:`${Math.abs(days)} Tag${Math.abs(days)===1?'':'e'} überfällig`,tone:'red',rank:0};
  if(days===0) return {label:'heute fällig',tone:'red',rank:1};
  if(days<=14) return {label:`in ${days} Tag${days===1?'':'en'}`,tone:'yellow',rank:2};
  if(days<=30) return {label:`in ${days} Tagen`,tone:'yellow',rank:3};
  return {label:`in ${days} Tagen`,tone:'blue',rank:4};
}

function buildHrReminders(users){
  const items=[];
  const defs=[
    {field:'probationEndDate',label:'Probezeit endet',icon:'P',future:60,overdue:14},
    {field:'fixedTermEndDate',label:'Befristung endet',icon:'V',future:90,overdue:3650},
    {field:'endDate',label:'Geplanter Austritt',icon:'A',future:90,overdue:30},
    {field:'firstAiderValidUntil',label:'Ersthelfer · Auffrischung',icon:'E',future:90,overdue:3650,enabled:u=>u.firstAider===true},
    {field:'fireWardenValidUntil',label:'Brandschutzhelfer · Auffrischung',icon:'B',future:90,overdue:3650,enabled:u=>u.fireWarden===true},
    {field:'forkliftPermitValidUntil',label:'Staplerschein läuft ab',icon:'S',future:90,overdue:3650,enabled:u=>u.forkliftPermit===true},
    {field:'aerialLiftPermitValidUntil',label:'Hubarbeitsbühne läuft ab',icon:'H',future:90,overdue:3650,enabled:u=>u.aerialLiftPermit===true},
    {field:'nextDrivingLicenseCheck',label:'Führerscheinkontrolle',icon:'F',future:60,overdue:3650}
  ];
  users.filter(u=>u.active!==false).forEach(u=>defs.forEach(def=>{
    if(def.enabled&&!def.enabled(u)) return;
    const value=u[def.field],days=daysFromToday(value);
    if(days===null||days>def.future||days<-(def.overdue??3650)) return;
    const status=reminderStatus(days);
    items.push({
      userId:u.id,name:u.name||u.email||'Mitarbeiter',employeeNumber:u.employeeNumber||'',
      department:u.department||'',date:value,days,label:def.label,icon:def.icon,status
    });
  }));
  return items.sort((a,b)=>a.status.rank-b.status.rank||a.days-b.days||a.name.localeCompare(b.name,'de'));
}

function renderHrReminders(items){
  const urgent=items.filter(x=>x.days<=14).length;
  return `<article class="card hr-reminders-card">
    <div class="card-head">
      <div><h2>HR-Erinnerungen & Fristen</h2><p>Automatisch aus den Fristdaten der aktiven Mitarbeiter · Vorschau auf die nächsten ${HR_REMINDER_WINDOW_DAYS} Tage</p></div>
      ${items.length?`<span class="reminder-count ${urgent?'urgent':''}">${urgent?`${urgent} dringend`:items.length+' offen'}</span>`:''}
    </div>
    ${items.length?`<div class="hr-reminder-list">${items.map(r=>`
      <div class="hr-reminder-row ${r.days<0?'overdue':''}">
        <span class="hr-reminder-icon">${esc(r.icon)}</span>
        <div class="hr-reminder-main">
          <strong>${esc(r.label)}</strong>
          <span>${esc(r.name)}${r.employeeNumber?` · MA ${esc(r.employeeNumber)}`:''}${r.department?` · ${esc(r.department)}`:''}</span>
        </div>
        <div class="hr-reminder-date"><strong>${fmtDate(r.date)}</strong>${statusPill(r.status.label,r.status.tone)}</div>
      </div>`).join('')}</div>`:
      `<div class="empty">Aktuell sind keine HR-Fristen in den vorgesehenen Vorlaufzeiträumen fällig.</div>`}
  </article>`;
}

export async function renderDashboard(el,ctx){
  setHead("Dashboard","Personalinformationen, Termine und offene Aufgaben auf einen Blick.");
  const p=ctx.profile;
  const canApproveVacation=p.role==="supervisor"||hasAdminPermission(p,"vacationApprove");
  const canApproveTime=p.role==="supervisor"||hasAdminPermission(p,"timeApprove");
  let news=[],trainingProgress=[],allTrainingProgress=[],allTrainingDefinitions=[],vacations=[],absences=[],timeRequests=[],timeRecords=[],teamVacations=[],hrUsers=[],personalChangeRequests=[],milestones=[],tgaOvertimeRows=[],complianceAlerts=[];
  try{const s=await getDocs(query(collection(db,"news"),orderBy("createdAt","desc"),limit(6)));news=s.docs.map(d=>({id:d.id,...d.data()})).filter(n=>n.active!==false&&(n.companyId==="all"||!n.companyId||n.companyId===p.companyId)&&(n.audience==="all"||!n.audience||n.audience===p.role))}catch{}
  try{const s=await getDocs(query(collection(db,"trainingProgress"),where("userId","==",p.id)));trainingProgress=s.docs.map(d=>d.data())}catch{}
  try{const s=await getDocs(collection(db,"trainings"));allTrainingDefinitions=s.docs.map(d=>({id:d.id,...d.data()}))}catch{}
  try{const s=await getDocs(query(collection(db,"vacationRequests"),where("userId","==",p.id)));vacations=s.docs.map(d=>({id:d.id,...d.data()}))}catch{}
  try{const s=await getDocs(query(collection(db,"absences"),where("userId","==",p.id)));absences=s.docs.map(d=>({id:d.id,...d.data()})).filter(a=>a.status!=='withdrawn')}catch{}
  try{const s=await getDocs(query(collection(db,"timeRecords"),where("userId","==",p.id)));timeRecords=s.docs.map(d=>({id:d.id,...d.data()}))}catch{}
  if(p.role==="admin"||p.role==="supervisor"){try{
    const token=await auth.currentUser?.getIdToken();
    if(token){const res=await getTeamMilestones({idToken:token});milestones=Array.isArray(res.data?.items)?res.data.items:[]}
  }catch(e){console.error("Geburtstags-/Jubiläumserinnerungen konnten nicht geladen werden",e)}}
  if(p.role==="supervisor"||(p.role==="admin"&&hasAdminPermission(p,"timeApprove"))){try{
    const s=p.role==="admin"?await getDocs(collection(db,"timeComplianceAlerts")):await getDocs(query(collection(db,"timeComplianceAlerts"),where("supervisorIds","array-contains",p.id)));
    complianceAlerts=s.docs.map(d=>({id:d.id,...d.data()}));
  }catch(e){console.error("Arbeitszeit-Hinweise konnten nicht geladen werden",e)}
    complianceAlerts=complianceAlerts.filter(a=>a.status!=="resolved"&&!(Array.isArray(a.acknowledgedBy)&&a.acknowledgedBy.includes(p.id))).sort((a,b)=>String(b.workDate||"").localeCompare(String(a.workDate||"")));
  }
  if(p.role==="admin"){
    try{const s=await getDocs(collection(db,"users"));hrUsers=s.docs.map(d=>({id:d.id,...d.data()}))}catch(e){console.error("HR-Fristen konnten nicht geladen werden",e)}
    if(hasAdminPermission(p,"trainingOverview")){try{const s=await getDocs(collection(db,"trainingProgress"));allTrainingProgress=s.docs.map(d=>({id:d.id,...d.data()}))}catch(e){console.error("Unternehmensweite Schulungsstände konnten nicht geladen werden",e)}}
    if(hasAdminPermission(p,"personalDataChanges")){try{const s=await getDocs(collection(db,"personalDataChangeRequests"));personalChangeRequests=s.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.status==="pending")}catch(e){console.error("Stammdaten-Änderungsanträge konnten nicht geladen werden",e)}}
    if(hasAdminPermission(p,"hoursExport")){try{
      const [cs,trs,vs,as]=await Promise.all([
        getDocs(collection(db,"companies")),getDocs(collection(db,"timeRecords")),
        getDocs(collection(db,"vacationRequests")),getDocs(collection(db,"absences"))
      ]);
      const companies=cs.docs.map(d=>({id:d.id,...d.data()}));
      const tga=companies.find(c=>String(c.name||'').trim().toLocaleLowerCase('de').includes('tga systemtechnik'));
      if(tga){
        const allRecords=trs.docs.map(d=>({id:d.id,...d.data()}));
        const allVacations=vs.docs.map(d=>({id:d.id,...d.data()}));
        const allAbsences=as.docs.map(d=>({id:d.id,...d.data()})).filter(a=>a.status!=='withdrawn');
        tgaOvertimeRows=hrUsers
          .filter(u=>u.active!==false&&u.archived!==true&&u.companyId===tga.id&&(u.role==="employee"||u.role==="supervisor"))
          .map(u=>{
            const balanceMinutes=calculateTimeAccountBalance(
              allRecords.filter(r=>r.userId===u.id),u,
              allVacations.filter(v=>v.userId===u.id),
              allAbsences.filter(a=>a.userId===u.id),
              {includeOpen:true,now:new Date()}
            );
            return {id:u.id,name:u.name||u.email||u.id,employeeNumber:u.employeeNumber||'',balanceMinutes,excessMinutes:balanceMinutes-80*60};
          })
          .filter(x=>x.balanceMinutes>80*60)
          .sort((a,b)=>b.balanceMinutes-a.balanceMinutes||a.name.localeCompare(b.name,'de'));
      }
    }catch(e){console.error("TGA-Überstundenhinweis konnte nicht geladen werden",e)}}
  }
  if(p.role==="employee"||canApproveTime){try{
    if(p.role==="employee"){const s=await getDocs(query(collection(db,"timeCorrectionRequests"),where("userId","==",p.id)));timeRequests=s.docs.map(d=>({id:d.id,...d.data()}))}
    else if(p.role==="supervisor") timeRequests=await getAssignedDocs(db,"timeCorrectionRequests",p.id);
    else {const s=await getDocs(collection(db,"timeCorrectionRequests"));timeRequests=s.docs.map(d=>({id:d.id,...d.data()}))}
  }catch(e){console.error("Zeiterfassungsanträge konnten nicht geladen werden",e)}}
  if(canApproveVacation){
    try{
      if(p.role==="admin"){
        const s=await getDocs(collection(db,"vacationRequests"));
        teamVacations=s.docs.map(d=>({id:d.id,...d.data()})).filter(v=>v.status==="pending"||(v.status==="withdrawn"&&!v.withdrawalAcknowledgedAt));
      }else{
        teamVacations=(await getAssignedDocs(db,"vacationRequests",p.id)).filter(v=>v.status==="pending"||(v.status==="withdrawn"&&!v.withdrawalAcknowledgedAt));
      }
    }catch(e){console.error("Urlaubsfreigaben konnten nicht geladen werden",e)}
  }

  const currentTrainingYear=new Date().getFullYear();
  const assignedTrainings=visibleTrainingsForYear(allTrainingDefinitions,p,currentTrainingYear);
  const completedTrainingIds=new Set(
    progressForTrainingYear(trainingProgress,currentTrainingYear)
      .filter(x=>x.status==="abgeschlossen"||x.status==="completed")
      .map(x=>x.trainingId)
      .filter(Boolean)
  );
  let openTrainings=assignedTrainings.filter(t=>!completedTrainingIds.has(t.id)).length;
  const globalTrainingCountAvailable=p.role==="admin"&&hasAdminPermission(p,"trainingOverview");
  if(globalTrainingCountAvailable){
    const relevantUsers=hrUsers.filter(u=>u.active!==false&&u.archived!==true&&(u.role==="employee"||u.role==="supervisor"));
    openTrainings=relevantUsers.reduce((sum,u)=>{
      const assigned=visibleTrainingsForYear(allTrainingDefinitions,u,currentTrainingYear);
      const done=new Set(progressForTrainingYear(allTrainingProgress.filter(x=>x.userId===u.id),currentTrainingYear)
        .filter(x=>x.status==="abgeschlossen"||x.status==="completed")
        .map(x=>x.trainingId)
        .filter(Boolean));
      return sum+assigned.filter(t=>!done.has(t.id)).length;
    },0);
  }
  const pendingOwnVac=vacations.filter(x=>x.status==="pending"||x.status==="beantragt").length;
  const pendingTeamVac=teamVacations.length;
  const vacationCount=canApproveVacation?pendingTeamVac:pendingOwnVac;
  const pendingOwnTime=timeRequests.filter(x=>x.userId===p.id&&x.status==="pending").length;
  const pendingTeamTime=p.role==="admin"&&canApproveTime
    ? timeRequests.filter(x=>x.status==="pending").length
    : p.role==="supervisor"
      ? timeRequests.filter(x=>x.status==="pending"&&(x.supervisorId===p.id||x.supervisorId2===p.id)).length
      : 0;
  const pendingTime=canApproveTime?pendingTeamTime:pendingOwnTime;
  const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);yesterday.setHours(23,59,59,999);
  const accountBalance=calculateTimeAccountBalance(timeRecords,p,vacations,absences,{includeOpen:false,now:yesterday,until:yesterday});
  const balanceClass=accountBalance>0?'positive':accountBalance<0?'negative':'neutral';
  const balanceDate=new Intl.DateTimeFormat('de-DE').format(yesterday);
  const monthName=new Intl.DateTimeFormat("de-DE",{month:"long"}).format(new Date());

  const trainingAction=p.role==="admin"?(globalTrainingCountAvailable&&openTrainings>0):openTrainings>0;
  const vacationAction=canApproveVacation&&pendingTeamVac>0;
  const timeAction=canApproveTime&&pendingTeamTime>0;
  const adminHint=hasAdminPermission(p,"newsManage")?`<div class="info-strip">Die Personalabteilung kann über <strong>News & Hinweise</strong> interne Meldungen und E-Mail-Vorlagen verwalten.</div>`:"";
  const hrReminderHtml=p.role==="admin"?renderHrReminders(buildHrReminders(hrUsers)):"";
  const milestoneHtml=(p.role==="admin"||p.role==="supervisor")?renderMilestoneReminders(milestones):"";
  const tgaOvertimeHtml=p.role==="admin"&&hasAdminPermission(p,"hoursExport")?renderTgaOvertimeAlert(tgaOvertimeRows,monthName):"";
  const changeRequestHint=p.role==="admin"&&hasAdminPermission(p,"personalDataChanges")&&personalChangeRequests.length?`<div class="info-strip"><strong>${personalChangeRequests.length}</strong> offene${personalChangeRequests.length===1?'r':''} Stammdaten-Änderungsantrag${personalChangeRequests.length===1?'':'e'} unter <strong>Änderungsanträge</strong>.</div>`:"";

  el.innerHTML=`
    <div class="kpi-grid">
      <div class="kpi is-clickable ${trainingAction?"needs-action":""}" data-nav="trainings" role="button" tabindex="0"><span>Offene Schulungen</span><strong>${p.role==="admin"&&!globalTrainingCountAvailable?"–":openTrainings}</strong><small>${p.role==="admin"?(globalTrainingCountAvailable?(trainingAction?"offene Zuordnungen im Unternehmen":"keine offenen Zuordnungen"):"Schulungsübersicht nicht freigeschaltet"):(trainingAction?"Bearbeitung erforderlich":"keine offene Aufgabe")}</small></div>
      <div class="kpi is-clickable ${vacationAction?"needs-action":""}" data-nav="vacation" role="button" tabindex="0"><span>Urlaubsanträge</span><strong>${p.role==="admin"&&!canApproveVacation?"–":vacationCount}</strong><small>${p.role==="admin"?(canApproveVacation?(vacationAction?"offen im Unternehmen":"keine offenen Anträge"):"Urlaubsübersicht nicht freigeschaltet"):(canApproveVacation?(vacationAction?"zur Freigabe":"keine offene Freigabe"):"aktuell in Bearbeitung")}</small></div>
      ${(p.role==='employee'&&p.noTimeTracking===true)?'':`<div class="kpi is-clickable ${timeAction?"needs-action":""}" data-nav="time" role="button" tabindex="0"><span>Zeiterfassungsanträge</span><strong>${p.role==="admin"&&!canApproveTime?"–":pendingTime}</strong><small>${p.role==="admin"?(canApproveTime?(timeAction?"offen im Unternehmen":"keine offenen Anträge"):"Zeitfreigaben nicht freigeschaltet"):(canApproveTime?(timeAction?"zur Freigabe":"keine offene Freigabe"):"eigene offene Anträge")}</small></div>`}
      ${p.role!=="admin"&&p.noTimeTracking!==true?`<div class="kpi hours-kpi is-clickable" data-nav="time" role="button" tabindex="0"><span>Stundenkonto</span><strong>${hm(accountBalance,{signed:true})}</strong><small class="hours-balance ${balanceClass}">Stand: ${esc(balanceDate)} · Abschluss Vortag</small></div>`:""}
    </div>${changeRequestHint}${adminHint}${renderComplianceAlerts(complianceAlerts)}${tgaOvertimeHtml}${milestoneHtml}${hrReminderHtml}
    <div class="two-col">
      <article class="card"><div class="card-head"><div><h2>News & Hinweise</h2><p>Aktuelle Informationen der Personalabteilung</p></div></div>
        <div class="news-list">${news.length?news.map(n=>`<div class="news-card ${n.priority==='important'?'important':''}"><div class="news-icon">${n.priority==='important'?'!':'i'}</div><div><h3>${esc(n.title||'Hinweis')}</h3><div class="rich-content">${n.html||esc(n.text||'')}</div><span>${n.validTo?`gültig bis ${fmtDate(n.validTo)}`:'interne Mitteilung'}</span></div></div>`).join(""):`<div class="empty">Aktuell liegen keine Hinweise vor.</div>`}</div>
      </article>
      <div id="dashboard-calendar-slot"></div>
      <article class="card"><div class="card-head"><div><h2>Mein Status</h2><p>Wichtige Personaldaten</p></div></div>
        <div class="stat-list">
          <div class="stat-row"><span>Firma</span><strong>${esc(ctx.company?.name||'–')}</strong></div>
          <div class="stat-row"><span>Rolle</span><strong>${esc(p.role||'–')}</strong></div>
          <div class="stat-row"><span>Beschäftigt seit</span><strong>${fmtDate(p.startDate)}</strong></div>
          <div class="stat-row"><span>Status</span>${statusPill(p.active===false?'inaktiv':'aktiv',p.active===false?'red':'green')}</div>
        </div>
      </article>
    </div>`;

  const calendarSlot=el.querySelector('#dashboard-calendar-slot');
  if(calendarSlot){
    const now=new Date();let calendarYear=now.getFullYear(),calendarMonth=now.getMonth();
    const paintCalendar=()=>{
      calendarSlot.innerHTML=dashboardCalendarHtml(p,vacations,absences,calendarYear,calendarMonth);
      calendarSlot.querySelectorAll('[data-cal-step]').forEach(btn=>btn.onclick=()=>{calendarMonth+=Number(btn.dataset.calStep||0);if(calendarMonth<0){calendarMonth=11;calendarYear--}if(calendarMonth>11){calendarMonth=0;calendarYear++}paintCalendar()});
      calendarSlot.querySelectorAll('.dashboard-calendar-day:not(.outside)').forEach(btn=>btn.onclick=()=>{const detail=calendarSlot.querySelector('.dashboard-calendar-detail');calendarSlot.querySelectorAll('.dashboard-calendar-day.selected').forEach(x=>x.classList.remove('selected'));btn.classList.add('selected');if(detail)detail.innerHTML=`<strong>${esc(fmtDate(btn.dataset.date))}</strong><span>${esc(btn.dataset.detail||'Keine Abwesenheit hinterlegt')}</span>`});
    };
    paintCalendar();
  }

  el.querySelectorAll(".kpi[data-nav]").forEach(card=>{
    const go=()=>dispatchDashboardNavigation(card.dataset.nav);
    card.addEventListener("click",go);
    card.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();go()}});
  });
  el.querySelectorAll(".compliance-ack-btn").forEach(btn=>btn.onclick=async()=>{
    btn.disabled=true;
    try{
      await updateDoc(doc(db,"timeComplianceAlerts",btn.dataset.id),{acknowledgedBy:arrayUnion(p.id),updatedAt:serverTimestamp()});
      toast("Hinweis wurde als zur Kenntnis genommen bestätigt.");
      renderDashboard(el,ctx);
    }catch(e){
      console.error(e);btn.disabled=false;toast("Der Hinweis konnte nicht bestätigt werden.");
    }
  });
  const acknowledgeAllButton=el.querySelector(".compliance-ack-all-btn");
  if(acknowledgeAllButton)acknowledgeAllButton.onclick=async()=>{
    const alerts=[...complianceAlerts];
    if(!alerts.length)return;
    const confirmed=await confirmDialog(`Möchten Sie wirklich alle ${alerts.length} aktuell angezeigten Arbeitszeit-Hinweise als zur Kenntnis genommen markieren?`,{acceptLabel:"Alle bestätigen"});
    if(!confirmed)return;
    acknowledgeAllButton.disabled=true;
    el.querySelectorAll(".compliance-ack-btn").forEach(button=>button.disabled=true);
    const loadingId=beginPortalLoading("Arbeitszeit-Hinweise werden bestätigt …");
    let processed=0,writeError=null,refreshError=null;
    try{
      const chunkSize=400;
      for(let start=0;start<alerts.length;start+=chunkSize){
        const chunk=alerts.slice(start,start+chunkSize),batch=writeBatch(db);
        chunk.forEach(alert=>batch.update(doc(db,"timeComplianceAlerts",alert.id),{acknowledgedBy:arrayUnion(p.id),updatedAt:serverTimestamp()}));
        await batch.commit();
        processed+=chunk.length;
        acknowledgeAllButton.textContent=`${processed} von ${alerts.length} bestätigt …`;
      }
    }catch(e){
      writeError=e;
      console.error("Sammelkenntnisnahme der Arbeitszeit-Hinweise fehlgeschlagen",e);
    }
    try{await renderDashboard(el,ctx)}catch(e){refreshError=e;console.error("Dashboard konnte nach der Sammelkenntnisnahme nicht aktualisiert werden",e)}
    endPortalLoading(loadingId);
    if(writeError)toast(`Die Sammelkenntnisnahme wurde nicht vollständig abgeschlossen. ${processed} von ${alerts.length} Hinweisen wurden bestätigt. Verbleibende Hinweise bleiben offen.${refreshError?' Bitte laden Sie das Dashboard neu.':''}`,"error");
    else if(refreshError)toast(`${processed} Arbeitszeit-Hinweise wurden bestätigt. Das Dashboard konnte anschließend nicht aktualisiert werden. Bitte laden Sie die Seite neu.`,"warning");
    else toast(`${processed} Arbeitszeit-Hinweise wurden als zur Kenntnis genommen bestätigt.`);
  };
}
