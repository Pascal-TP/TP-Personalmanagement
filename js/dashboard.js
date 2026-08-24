import { db } from "./firebase.js";
import { collection, getDocs, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setHead } from "./app.js";
import { esc, fmtDate, statusPill } from "./utils.js";

export async function renderDashboard(el,ctx){
  setHead("Dashboard","Personalinformationen, Termine und offene Aufgaben auf einen Blick.");
  const p=ctx.profile; let news=[], trainings=[], vacations=[];
  try{const s=await getDocs(query(collection(db,"news"),orderBy("createdAt","desc"),limit(6)));news=s.docs.map(d=>({id:d.id,...d.data()})).filter(n=>n.active!==false&&(n.companyId==="all"||!n.companyId||n.companyId===p.companyId)&&(n.audience==="all"||!n.audience||n.audience===p.role))}catch{}
  try{const s=await getDocs(query(collection(db,"trainingProgress"),where("userId","==",p.id)));trainings=s.docs.map(d=>d.data())}catch{}
  try{const s=await getDocs(query(collection(db,"vacationRequests"),where("userId","==",p.id)));vacations=s.docs.map(d=>d.data())}catch{}
  const openTrainings=trainings.filter(x=>x.status!=="abgeschlossen"&&x.status!=="completed").length;
  const pendingVac=vacations.filter(x=>x.status==="pending"||x.status==="beantragt").length;
  const adminHint=p.role==="admin"?`<div class="info-strip">Die Personalabteilung kann über <strong>News & Hinweise</strong> interne Meldungen und E-Mail-Vorlagen verwalten.</div>`:"";
  el.innerHTML=`
    <div class="kpi-grid">
      <div class="kpi"><span>Offene Schulungen</span><strong>${openTrainings}</strong><small>aus Ihrem Bearbeitungsstand</small></div>
      <div class="kpi"><span>Urlaubsanträge</span><strong>${pendingVac}</strong><small>aktuell in Bearbeitung</small></div>
      <div class="kpi"><span>Wochenarbeitszeit</span><strong>${Number(p.weeklyHours||40).toLocaleString("de-DE")} h</strong><small>hinterlegtes Arbeitszeitmodell</small></div>
      <div class="kpi"><span>Urlaubsanspruch</span><strong>${Number(p.vacationDays||30)}</strong><small>Tage/Jahr</small></div>
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
