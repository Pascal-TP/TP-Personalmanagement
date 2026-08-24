import { db } from "./firebase.js";
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setHead } from "./app.js";
import { esc, fmtDate } from "./utils.js";
export async function renderAbrechnungen(el,ctx){
  setHead("Lohn-/Gehaltsabrechnung","Persönliche Abrechnungen sicher abrufen, herunterladen und ausdrucken.");
  let rows=[];try{const s=await getDocs(query(collection(db,"payrollDocuments"),where("userId","==",ctx.profile.id)));rows=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.period||'').localeCompare(a.period||''))}catch{}
  el.innerHTML=`<div class="info-strip">Dieser Bereich ist in V1.0 bereits in die Navigation und Datenstruktur integriert. Der eigentliche Dokument-Upload der Personalabteilung wird als nächster Ausbauschritt an den KalkPro-Storage angebunden.</div><article class="card"><div class="card-head"><div><h2>Meine Abrechnungen</h2><p>Nur für den jeweils angemeldeten Mitarbeiter sichtbar.</p></div></div><div class="table-wrap"><table><thead><tr><th>Abrechnungsmonat</th><th>Dokument</th><th>Bereitgestellt</th><th>Aktion</th></tr></thead><tbody>${rows.length?rows.map(r=>`<tr><td>${esc(r.period||'–')}</td><td>${esc(r.fileName||'Abrechnung')}</td><td>${fmtDate(r.createdAt)}</td><td>${r.downloadUrl?`<a class="btn small" href="${esc(r.downloadUrl)}" target="_blank" rel="noopener">Öffnen / Drucken</a>`:'Noch nicht hinterlegt'}</td></tr>`).join(''):`<tr><td colspan="4" class="empty">Noch keine Abrechnungen hinterlegt.</td></tr>`}</tbody></table></div></article>`;
}
