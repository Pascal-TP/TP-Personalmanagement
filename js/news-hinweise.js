import { db, functions } from "./firebase.js";
import { collection, addDoc, getDocs, doc, updateDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";
import { setHead } from "./app.js";
import { esc, fmtDate, toast } from "./utils.js";
import { hasAdminPermission } from "./permissions.js";
const sendPersonnelNewsEmail=httpsCallable(functions,'sendPersonnelNewsEmail');
const NEWS_ATTACHMENT_MAX_FILES=3;
const NEWS_ATTACHMENT_MAX_TOTAL_BYTES=5*1024*1024;
const NEWS_ATTACHMENT_TYPES=new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);
let newsAttachments=[];

function formatBytes(bytes=0){
  if(bytes<1024)return `${bytes} B`;
  if(bytes<1024*1024)return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/(1024*1024)).toFixed(1)} MB`;
}
function fileToBase64(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>{
      const value=String(reader.result||'');
      resolve(value.includes(',')?value.split(',').slice(1).join(','):value);
    };
    reader.onerror=()=>reject(reader.error||new Error('Datei konnte nicht gelesen werden.'));
    reader.readAsDataURL(file);
  });
}
function exec(cmd,val=null){document.execCommand(cmd,false,val);document.getElementById('news-editor')?.focus()}
export async function renderNews(el,ctx){
  if(!hasAdminPermission(ctx.profile,'newsManage')){el.innerHTML='<div class="error-card">Keine Berechtigung für News & Hinweise.</div>';return;}
  setHead("News & Hinweise","Dashboard-Mitteilungen, E-Mail-Texte und wiederverwendbare Textbausteine verwalten.");
  const [newsSnap,tplSnap]=await Promise.all([getDocs(collection(db,'news')),getDocs(collection(db,'newsTemplates'))]);
  const news=newsSnap.docs.map(d=>({id:d.id,...d.data()})),templates=tplSnap.docs.map(d=>({id:d.id,...d.data()}));
  el.innerHTML=`<div class="admin-choice-grid"><button class="choice-card active" data-tab="compose"><span>✉</span><strong>News / E-Mail erstellen</strong><small>Mitteilung erstellen und optional versenden</small></button><button class="choice-card" data-tab="show"><span>●</span><strong>Hinweise anzeigen</strong><small>Gespeicherte Dashboard-Meldungen</small></button></div>
  <section id="news-compose"><article class="card"><div class="card-head"><div><h2>Mitteilung erstellen</h2><p>Textbausteine können jederzeit geladen und neu gespeichert werden.</p></div></div><form id="news-form" class="form-grid">
    <label class="field full"><span>Textbaustein</span><select id="template-select"><option value="">– Vorlage auswählen –</option>${templates.map(t=>`<option value="${t.id}">${esc(t.title)}</option>`).join('')}</select></label>
    <label class="field"><span>Titel / Betreff</span><input name="title" required placeholder="z. B. Personalzugänge und -abgänge"></label><label class="field"><span>Priorität</span><select name="priority"><option value="info">Information</option><option value="important">Wichtig</option></select></label>
    <label class="field"><span>Zielgruppe Dashboard</span><select name="audience"><option value="all">Alle</option><option value="employee">Mitarbeiter</option><option value="supervisor">Vorgesetzte</option><option value="admin">Personalabteilung</option></select></label><label class="field"><span>Firma</span><select name="companyId" id="news-company"><option value="all">Alle Firmen</option></select></label>
    <label class="field full"><span>Empfänger-E-Mail-Adressen</span><textarea name="recipients" placeholder="max@firma.de; maria@firma.de"></textarea></label>
    <div class="field full"><span>Text</span><div class="editor-toolbar"><select id="font-size"><option value="3">Normal</option><option value="2">Klein</option><option value="4">Groß</option><option value="5">Sehr groß</option></select><button type="button" data-cmd="bold"><b>F</b></button><button type="button" data-cmd="italic"><i>K</i></button><button type="button" data-cmd="underline"><u>U</u></button><label class="image-insert">Bild<input id="editor-image" type="file" accept="image/*"></label></div><div id="news-editor" class="rich-editor" contenteditable="true"></div></div>
    <div class="field full"><span>Anhänge (optional)</span><div class="hint" style="margin-bottom:8px">Bis zu 3 Dateien, zusammen maximal 5 MB. Zulässig: PDF, JPG/JPEG, PNG, DOCX und XLSX.</div><label class="btn secondary" style="display:inline-flex;align-items:center;gap:8px;cursor:pointer">Datei auswählen<input id="news-attachments" type="file" accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx,application/pdf,image/jpeg,image/png,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" multiple style="display:none"></label><div id="news-attachment-list" style="margin-top:10px"></div></div>
    <div class="field full actions"><button class="btn secondary" id="save-template" type="button">Als Textbaustein speichern</button><button class="btn secondary" id="save-dashboard" type="button">Als Dashboard-Hinweis speichern</button><button class="btn primary" id="send-email" type="button">E-Mail versenden</button></div>
  </form></article></section>
  <section id="news-show" class="hidden"><article class="card"><div class="card-head"><div><h2>Gespeicherte Hinweise</h2></div></div>${news.length?news.map(n=>`<div class="list-row"><div><strong>${esc(n.title||'Hinweis')}</strong><span>${esc(n.audience||'all')} · ${fmtDate(n.createdAt)}</span></div><button class="btn danger small delete-news" data-id="${n.id}">Löschen</button></div>`).join(''):`<div class="empty">Keine Hinweise vorhanden.</div>`}</article></section>`;
  const cSnap=await getDocs(collection(db,'companies'));cSnap.docs.forEach(d=>{const o=document.createElement('option');o.value=d.id;o.textContent=d.data().name;document.getElementById('news-company').appendChild(o)});
  const compose=document.getElementById('news-compose'),show=document.getElementById('news-show');el.querySelectorAll('.choice-card').forEach(b=>b.onclick=()=>{const x=b.dataset.tab;compose.classList.toggle('hidden',x!=='compose');show.classList.toggle('hidden',x!=='show');el.querySelectorAll('.choice-card').forEach(y=>y.classList.toggle('active',y===b))});
  el.querySelectorAll('[data-cmd]').forEach(b=>b.onclick=()=>exec(b.dataset.cmd));document.getElementById('font-size').onchange=e=>exec('fontSize',e.target.value);
  document.getElementById('editor-image').onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>exec('insertImage',r.result);r.readAsDataURL(f)};
  const renderAttachmentList=()=>{
    const box=document.getElementById('news-attachment-list');
    if(!box)return;
    if(!newsAttachments.length){box.innerHTML='<div class="muted">Keine Anhänge ausgewählt.</div>';return;}
    box.innerHTML=newsAttachments.map((f,i)=>`<div class="list-row" style="padding:8px 0"><div><strong>${esc(f.name)}</strong><span>${formatBytes(f.size)}</span></div><button class="btn secondary small remove-news-attachment" type="button" data-i="${i}">Entfernen</button></div>`).join('');
    box.querySelectorAll('.remove-news-attachment').forEach(b=>b.onclick=()=>{newsAttachments.splice(Number(b.dataset.i),1);renderAttachmentList();});
  };
  newsAttachments=[];renderAttachmentList();
  document.getElementById('news-attachments').onchange=e=>{
    const selected=[...(e.target.files||[])];
    e.target.value='';
    if(!selected.length)return;
    const candidate=[...newsAttachments,...selected];
    if(candidate.length>NEWS_ATTACHMENT_MAX_FILES){toast(`Maximal ${NEWS_ATTACHMENT_MAX_FILES} Anhänge sind möglich.`);return;}
    const invalid=selected.find(f=>!NEWS_ATTACHMENT_TYPES.has(f.type));
    if(invalid){toast(`Dateityp nicht zulässig: ${invalid.name}`);return;}
    const total=candidate.reduce((sum,f)=>sum+Number(f.size||0),0);
    if(total>NEWS_ATTACHMENT_MAX_TOTAL_BYTES){toast('Die Anhänge dürfen zusammen maximal 5 MB groß sein.');return;}
    newsAttachments=candidate;renderAttachmentList();
  };
  document.getElementById('template-select').onchange=e=>{const t=templates.find(x=>x.id===e.target.value);if(!t)return;document.querySelector('#news-form [name=title]').value=t.title||'';document.getElementById('news-editor').innerHTML=t.html||''};
  const data=()=>{const f=document.getElementById('news-form');return{title:f.elements.title.value.trim(),priority:f.elements.priority.value,audience:f.elements.audience.value,companyId:f.elements.companyId.value,recipients:f.elements.recipients.value.trim(),html:document.getElementById('news-editor').innerHTML}};
  document.getElementById('save-template').onclick=async()=>{const d=data();if(!d.title||!d.html){toast('Bitte Titel und Text eingeben.');return}await addDoc(collection(db,'newsTemplates'),{title:d.title,html:d.html,createdAt:serverTimestamp()});toast('Textbaustein gespeichert.');renderNews(el,ctx)};
  document.getElementById('save-dashboard').onclick=async()=>{const d=data();if(!d.title||!d.html){toast('Bitte Titel und Text eingeben.');return}await addDoc(collection(db,'news'),{...d,active:true,createdAt:serverTimestamp()});toast('Dashboard-Hinweis gespeichert.');renderNews(el,ctx)};
  document.getElementById('send-email').onclick=async()=>{const d=data();if(!d.recipients||!d.title||!d.html){toast('Empfänger, Betreff und Text werden benötigt.');return}const recipients=[...new Set(d.recipients.split(/[;,\n]/).map(x=>x.trim()).filter(Boolean))];if(!recipients.length){toast('Bitte mindestens eine gültige Empfängeradresse eingeben.');return}const btn=document.getElementById('send-email');const oldText=btn.textContent;btn.disabled=true;btn.textContent='E-Mail wird versendet …';try{const attachments=[];for(const file of newsAttachments){attachments.push({name:file.name,type:file.type,size:file.size,data:await fileToBase64(file)});}const idToken=await ctx.user.getIdToken();const result=await sendPersonnelNewsEmail({idToken,recipients,subject:d.title,html:d.html,attachments});const count=Number(result.data?.attachmentCount||0);toast(`${result.data?.recipientCount===1?'E-Mail wurde versendet.':`E-Mail wurde an ${result.data?.recipientCount||recipients.length} Empfänger versendet.`}${count?` · ${count} Anhang${count===1?'':'e'}`:''}`)}catch(e){console.error(e);const msg=String(e?.message||'');if(msg.includes('Berechtigung'))toast('Keine Berechtigung zum E-Mail-Versand.');else if(msg.includes('Empfänger'))toast('Bitte die Empfänger-E-Mail-Adressen prüfen.');else if(msg.includes('Anhang')||msg.includes('Datei'))toast('Bitte die ausgewählten Anhänge prüfen (Dateityp / Größe).');else toast('E-Mail konnte nicht versendet werden. Bitte SMTP2GO/Cloud Function prüfen.')}finally{btn.disabled=false;btn.textContent=oldText}};
  el.querySelectorAll('.delete-news').forEach(b=>b.onclick=async()=>{if(confirm('Hinweis wirklich löschen?')){await deleteDoc(doc(db,'news',b.dataset.id));renderNews(el,ctx)}})
}
