import { db, auth, functions } from "./firebase.js";
import { collection, getDocs, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";
import { setHead } from "./app.js";
import { esc, fmtDate, statusPill } from "./utils.js";
import { hasAdminPermission } from "./permissions.js";
import { progressForTrainingYear, visibleTrainingsForYear } from "./training-utils.js";
import { calculateDailyTimeValues, calculateTimeAccountBalance, timeRecordStart } from "./time-utils.js";
import { getAssignedDocs } from "./supervisor-utils.js";


const getTeamMilestones=httpsCallable(functions,'getPersonnelTeamMilestones');

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

  const weeklyHours=Number(profile.weeklyHours||40);
  const dailyTargetMinutes=(weeklyHours*60)/5;
  const weekdays=workdaysBetween(calcStart,today);
  const approvedLeaveDays=vacations
    .filter(v=>v.status==="approved")
    .reduce((sum,v)=>sum+overlapWorkdays(v.from,v.to,calcStart,today),0);
  const absenceDays=absences.reduce((sum,a)=>sum+overlapWorkdays(a.from,a.to,calcStart,today),0);
  const targetMinutes=Math.max(0,Math.round((weekdays-approvedLeaveDays-absenceDays)*dailyTargetMinutes));

  const relevantRecords=timeRecords.filter(r=>{
    const start=r.recordType==="adjustment"?(r.adjustmentDate?new Date(`${r.adjustmentDate}T12:00:00`):toDate(r.createdAt)):timeRecordStart(r);
    if(!start||Number.isNaN(start.getTime()))return false;
    const day=new Date(start.getFullYear(),start.getMonth(),start.getDate(),12);
    return day>=calcStart&&day<=today;
  });
  const timeValues=calculateDailyTimeValues(relevantRecords,profile.earliestStartTime||"",{includeOpen:true,now});
  const actualMinutes=Math.round(relevantRecords.reduce((sum,r)=>sum+(timeValues.get(r.id)?.net||0),0));

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
  let news=[],trainingProgress=[],allTrainingProgress=[],allTrainingDefinitions=[],vacations=[],absences=[],timeRequests=[],timeRecords=[],teamVacations=[],hrUsers=[],personalChangeRequests=[],milestones=[],tgaOvertimeRows=[];
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
    if(p.role==="supervisor") timeRequests=await getAssignedDocs(db,"timeCorrectionRequests",p.id);
    else {const s=await getDocs(collection(db,"timeCorrectionRequests"));timeRequests=s.docs.map(d=>({id:d.id,...d.data()}))}
  }catch{}}
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
  const hours=currentMonthBalance(p,timeRecords,vacations,absences);
  const monthName=new Intl.DateTimeFormat("de-DE",{month:"long"}).format(new Date());
  const saldoClass=hours.balanceMinutes>0?"positive":hours.balanceMinutes<0?"negative":"neutral";

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
      <div class="kpi ${trainingAction?"needs-action":""}"><span>Offene Schulungen</span><strong>${p.role==="admin"&&!globalTrainingCountAvailable?"–":openTrainings}</strong><small>${p.role==="admin"?(globalTrainingCountAvailable?(trainingAction?"offene Zuordnungen im Unternehmen":"keine offenen Zuordnungen"):"Schulungsübersicht nicht freigeschaltet"):(trainingAction?"Bearbeitung erforderlich":"keine offene Aufgabe")}</small></div>
      <div class="kpi ${vacationAction?"needs-action":""}"><span>Urlaubsanträge</span><strong>${p.role==="admin"&&!canApproveVacation?"–":vacationCount}</strong><small>${p.role==="admin"?(canApproveVacation?(vacationAction?"offen im Unternehmen":"keine offenen Anträge"):"Urlaubsübersicht nicht freigeschaltet"):(canApproveVacation?(vacationAction?"zur Freigabe":"keine offene Freigabe"):"aktuell in Bearbeitung")}</small></div>
      <div class="kpi ${timeAction?"needs-action":""}"><span>Zeiterfassungsanträge</span><strong>${p.role==="admin"&&!canApproveTime?"–":pendingTime}</strong><small>${p.role==="admin"?(canApproveTime?(timeAction?"offen im Unternehmen":"keine offenen Anträge"):"Zeitfreigaben nicht freigeschaltet"):(canApproveTime?(timeAction?"zur Freigabe":"keine offene Freigabe"):"eigene offene Anträge")}</small></div>
      ${p.role!=="admin"?`<div class="kpi hours-kpi"><span>Soll / Ist · ${esc(monthName)}</span><strong>${hm(hours.targetMinutes)} / ${hm(hours.actualMinutes)}</strong><small class="hours-balance ${saldoClass}">Monatssaldo: ${hm(hours.balanceMinutes,{signed:true})}</small></div>`:""}
    </div>${changeRequestHint}${adminHint}${tgaOvertimeHtml}${milestoneHtml}${hrReminderHtml}
    <div class="two-col">
      <article class="card"><div class="card-head"><div><h2>News & Hinweise</h2><p>Aktuelle Informationen der Personalabteilung</p></div></div>
        <div class="news-list">${news.length?news.map(n=>`<div class="news-card ${n.priority==='important'?'important':''}"><div class="news-icon">${n.priority==='important'?'!':'i'}</div><div><h3>${esc(n.title||'Hinweis')}</h3><div class="rich-content">${n.html||esc(n.text||'')}</div><span>${n.validTo?`gültig bis ${fmtDate(n.validTo)}`:'interne Mitteilung'}</span></div></div>`).join(""):`<div class="empty">Aktuell liegen keine Hinweise vor.</div>`}</div>
      </article>
      <article class="card"><div class="card-head"><div><h2>Mein Status</h2><p>Wichtige Personaldaten</p></div></div>
        <div class="stat-list">
          <div class="stat-row"><span>Firma</span><strong>${esc(ctx.company?.name||'–')}</strong></div>
          <div class="stat-row"><span>Rolle</span><strong>${esc(p.role||'–')}</strong></div>
          <div class="stat-row"><span>Beschäftigt seit</span><strong>${fmtDate(p.startDate)}</strong></div>
          <div class="stat-row"><span>Status</span>${statusPill(p.active===false?'inaktiv':'aktiv',p.active===false?'red':'green')}</div>
        </div>
      </article>
    </div>`;
}
