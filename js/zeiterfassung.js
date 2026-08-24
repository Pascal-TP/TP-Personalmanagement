import { db } from "./firebase.js";
import { collection, addDoc, getDocs, query, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setHead } from "./app.js";
import { esc, fmtDate, toast } from "./utils.js";

function mins(t){if(!t)return 0;const[a,b]=t.split(":").map(Number);return a*60+b}
function calc(start,end){const gross=Math.max(0,mins(end)-mins(start));const pause=gross>540?45:gross>360?30:0;return{gross,pause,net:Math.max(0,gross-pause)}}
function hm(m){return `${Math.floor(m/60)}:${String(m%60).padStart(2,"0")} h`}
export async function renderZeiterfassung(el,ctx){
  setHead("Zeiterfassung","Arbeitszeiten erfassen und den persönlichen Monatsnachweis einsehen.");
  let entries=[];try{const s=await getDocs(query(collection(db,"timeRecords"),where("userId","==",ctx.profile.id)));entries=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.date||'').localeCompare(a.date||''))}catch{}
  el.innerHTML=`<div class="two-col"><article class="card"><div class="card-head"><div><h2>Arbeitszeit erfassen</h2><p>Die Pause wird nach der hinterlegten Logik automatisch abgezogen.</p></div></div>
    <form id="time-form" class="form-grid">
      <label class="field"><span>Datum</span><input name="date" type="date" required value="${new Date().toISOString().slice(0,10)}"></label>
      <label class="field"><span>Art</span><select name="type"><option value="work">Arbeitszeit</option><option value="homeoffice">Homeoffice</option><option value="business">Dienstreise</option></select></label>
      <label class="field"><span>Beginn</span><input name="start" type="time" required></label>
      <label class="field"><span>Ende</span><input name="end" type="time" required></label>
      <label class="field full"><span>Tätigkeit / Bemerkung</span><textarea name="note" placeholder="Was wurde heute erledigt?"></textarea></label>
      <div class="field full"><button class="btn primary" type="submit">Arbeitszeit speichern</button></div>
    </form></article>
    <article class="card"><div class="card-head"><div><h2>Monteur-/Terminalmodus</h2><p>Für eine spätere Ausbaustufe vorbereitet.</p></div></div><div class="terminal-preview"><button class="terminal-btn" type="button">KOMMEN</button><button class="terminal-btn outline" type="button">GEHEN</button><p>Später möglich: persönliches Smartphone, Team-Tablet, NFC-Transponder oder QR/PIN.</p></div></article></div>
    <article class="card"><div class="card-head"><div><h2>Meine Buchungen</h2><p>Aktuell gespeicherte Zeitdaten</p></div></div><div class="table-wrap"><table><thead><tr><th>Datum</th><th>Beginn</th><th>Ende</th><th>Pause</th><th>Arbeitszeit</th><th>Tätigkeit</th></tr></thead><tbody>${entries.length?entries.map(r=>{const c=calc(r.start,r.end);return`<tr><td>${fmtDate(r.date)}</td><td>${esc(r.start||'–')}</td><td>${esc(r.end||'–')}</td><td>${hm(c.pause)}</td><td><strong>${hm(c.net)}</strong></td><td>${esc(r.note||'')}</td></tr>`}).join(""):`<tr><td colspan="6" class="empty">Noch keine Buchungen vorhanden.</td></tr>`}</tbody></table></div></article>`;
  document.getElementById("time-form").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),data=Object.fromEntries(f.entries());if(mins(data.end)<=mins(data.start)){toast("Die Endzeit muss nach der Startzeit liegen.");return}await addDoc(collection(db,"timeRecords"),{...data,userId:ctx.profile.id,companyId:ctx.profile.companyId,createdAt:serverTimestamp()});toast("Arbeitszeit gespeichert.");renderZeiterfassung(el,ctx)};
}
