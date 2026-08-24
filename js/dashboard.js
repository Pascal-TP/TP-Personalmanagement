import { db } from "./firebase.js";
import { collection, getDocs, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setHead } from "./app.js";
import { esc, fmtDate, statusPill } from "./utils.js";

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

function currentMonthBalance(profile,timeRecords,vacations){
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
  const targetMinutes=Math.max(0,Math.round((weekdays-approvedLeaveDays)*dailyTargetMinutes));

  let adjustmentMinutes=0;
  const grossByDay=new Map();
  timeRecords.forEach(r=>{
    const start=recordStart(r);
    if(!start) return;
    const day=new Date(start.getFullYear(),start.getMonth(),start.getDate(),12);
    if(day<calcStart||day>today) return;
    if(r.recordType==="adjustment"){ adjustmentMinutes+=Number(r.adjustmentMinutes)||0; return; }
    let end=recordEnd(r);
    if(!end&&r.status!=="closed") end=now;
    if(!end||end<start) return;
    const gross=Math.max(0,Math.round((end-start)/60000));
    const key=localDateKey(start);
    grossByDay.set(key,(grossByDay.get(key)||0)+gross);
  });
  const workedMinutes=[...grossByDay.values()].reduce((sum,gross)=>{
    const pause=gross>540?45:gross>360?30:0;
    return sum+Math.max(0,gross-pause);
  },0);
  const actualMinutes=Math.round(workedMinutes+adjustmentMinutes);

  return {targetMinutes,actualMinutes,balanceMinutes:actualMinutes-targetMinutes};
}

export async function renderDashboard(el,ctx){
  setHead("Dashboard","Personalinformationen, Termine und offene Aufgaben auf einen Blick.");
  const p=ctx.profile;
  let news=[],trainingProgress=[],allTrainingDefinitions=[],vacations=[],timeRequests=[],timeRecords=[],teamVacations=[];
  try{const s=await getDocs(query(collection(db,"news"),orderBy("createdAt","desc"),limit(6)));news=s.docs.map(d=>({id:d.id,...d.data()})).filter(n=>n.active!==false&&(n.companyId==="all"||!n.companyId||n.companyId===p.companyId)&&(n.audience==="all"||!n.audience||n.audience===p.role))}catch{}
  try{const s=await getDocs(query(collection(db,"trainingProgress"),where("userId","==",p.id)));trainingProgress=s.docs.map(d=>d.data())}catch{}
  try{const s=await getDocs(collection(db,"trainings"));allTrainingDefinitions=s.docs.map(d=>({id:d.id,...d.data()}))}catch{}
  try{const s=await getDocs(query(collection(db,"vacationRequests"),where("userId","==",p.id)));vacations=s.docs.map(d=>({id:d.id,...d.data()}))}catch{}
  try{const s=await getDocs(query(collection(db,"timeRecords"),where("userId","==",p.id)));timeRecords=s.docs.map(d=>({id:d.id,...d.data()}))}catch{}
  try{const s=await getDocs(collection(db,"timeCorrectionRequests"));timeRequests=s.docs.map(d=>({id:d.id,...d.data()}))}catch{}
  if(p.role!=="employee"){
    try{const s=await getDocs(collection(db,"vacationRequests"));teamVacations=s.docs.map(d=>({id:d.id,...d.data()})).filter(v=>v.status==="pending"&&(p.role==="admin"||v.supervisorId===p.id))}catch{}
  }

  const assignedTrainings=allTrainingDefinitions.filter(t=>{
    if(t.active===false) return false;
    const trainingAreas=Array.isArray(t.bereiche)?t.bereiche:[];
    const userAreas=Array.isArray(p.bereiche)?p.bereiche:[];
    const extraTrainings=Array.isArray(p.extraTrainings)?p.extraTrainings:[];
    return trainingAreas.length===0 || trainingAreas.some(area=>userAreas.includes(area)) || extraTrainings.includes(t.id);
  });
  const completedTrainingIds=new Set(
    trainingProgress
      .filter(x=>x.status==="abgeschlossen"||x.status==="completed")
      .map(x=>x.trainingId)
      .filter(Boolean)
  );
  const openTrainings=assignedTrainings.filter(t=>!completedTrainingIds.has(t.id)).length;
  const pendingOwnVac=vacations.filter(x=>x.status==="pending"||x.status==="beantragt").length;
  const pendingTeamVac=teamVacations.length;
  const vacationCount=p.role==="employee"?pendingOwnVac:pendingTeamVac;
  const pendingOwnTime=timeRequests.filter(x=>x.userId===p.id&&x.status==="pending").length;
  const pendingTeamTime=p.role==="admin"
    ? timeRequests.filter(x=>x.status==="pending").length
    : p.role==="supervisor"
      ? timeRequests.filter(x=>x.status==="pending"&&x.supervisorId===p.id).length
      : 0;
  const pendingTime=p.role==="employee"?pendingOwnTime:pendingTeamTime;
  const hours=currentMonthBalance(p,timeRecords,vacations);
  const monthName=new Intl.DateTimeFormat("de-DE",{month:"long"}).format(new Date());
  const saldoClass=hours.balanceMinutes>0?"positive":hours.balanceMinutes<0?"negative":"neutral";

  const trainingAction=openTrainings>0;
  const vacationAction=p.role!=="employee"&&pendingTeamVac>0;
  const timeAction=p.role!=="employee"&&pendingTeamTime>0;
  const adminHint=p.role==="admin"?`<div class="info-strip">Die Personalabteilung kann über <strong>News & Hinweise</strong> interne Meldungen und E-Mail-Vorlagen verwalten.</div>`:"";

  el.innerHTML=`
    <div class="kpi-grid">
      <div class="kpi ${trainingAction?"needs-action":""}"><span>Offene Schulungen</span><strong>${openTrainings}</strong><small>${trainingAction?"Bearbeitung erforderlich":"keine offene Aufgabe"}</small></div>
      <div class="kpi ${vacationAction?"needs-action":""}"><span>Urlaubsanträge</span><strong>${vacationCount}</strong><small>${p.role==="employee"?"aktuell in Bearbeitung":vacationAction?"zur Freigabe":"keine offene Freigabe"}</small></div>
      <div class="kpi ${timeAction?"needs-action":""}"><span>Zeiterfassungsanträge</span><strong>${pendingTime}</strong><small>${p.role==="employee"?"eigene offene Anträge":timeAction?"zur Freigabe":"keine offene Freigabe"}</small></div>
      <div class="kpi hours-kpi"><span>Soll / Ist · ${esc(monthName)}</span><strong>${hm(hours.targetMinutes)} / ${hm(hours.actualMinutes)}</strong><small class="hours-balance ${saldoClass}">Monatssaldo: ${hm(hours.balanceMinutes,{signed:true})}</small></div>
    </div>${adminHint}
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
