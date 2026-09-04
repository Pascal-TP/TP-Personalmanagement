import { db } from './firebase.js';
import { collection, doc, getDocs, setDoc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { setHead } from './app.js';
import { esc, toast } from './utils.js';
import { hasAdminPermission } from './permissions.js';
import { randomToken, sha256Hex } from './nfc-utils.js';

function terminalNo(t){ return Number(t.terminalNumber || String(t.id || '').replace(/\D/g,'')) || 0; }
function activationCode(){ return randomToken(16).toUpperCase(); }

export async function renderTerminals(el, ctx){
  setHead('NFC-Terminals','Gemeinsam genutzte Tablets für die NFC-Zeiterfassung verwalten.');
  if(!hasAdminPermission(ctx.profile,'terminalManage')){
    el.innerHTML='<div class="error-card">Für diesen Admin-Zugang ist die Terminalverwaltung nicht freigeschaltet.</div>';
    return;
  }

  const snap=await getDocs(collection(db,'terminals'));
  const terminals=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>terminalNo(a)-terminalNo(b));
  el.innerHTML=`
    <div class="terminal-admin-grid">
      <article class="card">
        <div class="card-head"><div><h2>Neues Terminal</h2><p>Die sichtbare Bezeichnung wird automatisch fortlaufend vergeben.</p></div></div>
        <label class="field"><span>Beschreibung</span><input id="new-terminal-description" type="text" maxlength="120" placeholder="z. B. Team Müller · Tablet Samsung A9 oder Haupteingang"></label>
        <button class="btn primary" id="create-terminal" type="button">Nächstes Terminal anlegen</button>
        <div id="terminal-activation" class="terminal-activation hidden"></div>
      </article>
      <article class="card">
        <div class="card-head"><div><h2>Terminal-App</h2><p>Diese Adresse auf jedem Android-Gerät in Chrome öffnen und anschließend zum Startbildschirm hinzufügen. Bei der Erstaktivierung ist die Speicherung einer Wiederherstellungsdatei verpflichtend.</p></div></div>
        <div class="readonly-box terminal-url" id="terminal-url"></div>
        <div class="actions"><button class="btn secondary" id="open-terminal" type="button">Terminal-App öffnen</button></div>
      </article>
    </div>
    <article class="card">
      <div class="card-head"><div><h2>Vorhandene Terminals</h2><p>${terminals.length} Terminal${terminals.length===1?'':'s'} angelegt</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>Terminal</th><th>Beschreibung</th><th>Status</th><th>Letzte Nutzung</th><th></th></tr></thead><tbody>
        ${terminals.length?terminals.map(t=>`<tr><td><strong>${esc(t.name||`Terminal ${terminalNo(t)}`)}</strong><div class="small muted">${esc(t.id)}</div></td><td><div class="terminal-description-cell"><span>${esc(t.description||'–')}</span><button class="btn secondary small edit-terminal-description" data-id="${esc(t.id)}" data-description="${esc(t.description||'')}">Bearbeiten</button></div></td><td><span class="pill ${t.active===false?'red':'green'}">${t.active===false?'gesperrt':'aktiv'}</span></td><td>${t.lastUsedAt?.toDate?t.lastUsedAt.toDate().toLocaleString('de-DE'):'–'}</td><td><div class="actions"><button class="btn secondary small reset-terminal" data-id="${esc(t.id)}">Aktivierung erneuern</button><button class="btn ${t.active===false?'secondary':'danger'} small toggle-terminal" data-id="${esc(t.id)}" data-active="${t.active!==false}">${t.active===false?'Freigeben':'Sperren'}</button></div></td></tr>`).join(''):'<tr><td colspan="5" class="empty">Noch kein Terminal angelegt.</td></tr>'}
      </tbody></table></div>
    </article>`;

  const terminalUrl=new URL('terminal.html',location.href).href;
  el.querySelector('#terminal-url').textContent=terminalUrl;
  el.querySelector('#open-terminal').onclick=()=>window.open(terminalUrl,'_blank','noopener');

  async function saveSecret(id,code){
    const secretHash=await sha256Hex(code);
    await setDoc(doc(db,'terminals',id),{secretHash,active:true,activationUpdatedAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});
    const box=el.querySelector('#terminal-activation');
    box.classList.remove('hidden');
    box.innerHTML=`<strong>Aktivierungscode für ${esc(terminals.find(t=>t.id===id)?.name||id)}</strong><p>Diesen Code einmalig auf dem betreffenden Gerät eingeben. Danach muss dort eine neue Wiederherstellungsdatei gespeichert werden. Der Code wird serverseitig aus Sicherheitsgründen nicht im Klartext gespeichert.</p><code>${esc(code)}</code><small>Bitte den Code jetzt am Gerät verwenden. Ein neuer Aktivierungscode macht eine ältere Wiederherstellungsdatei ungültig; danach muss am Gerät eine neue Datei gespeichert werden.</small>`;
  }

  el.querySelector('#create-terminal').onclick=async()=>{
    const next=Math.max(0,...terminals.map(terminalNo))+1;
    const id=`terminal-${String(next).padStart(3,'0')}`;
    const name=`Terminal ${next}`;
    const code=activationCode();
    const description=el.querySelector('#new-terminal-description')?.value.trim()||'';
    try{
      await setDoc(doc(db,'terminals',id),{terminalNumber:next,name,description,active:true,secretHash:await sha256Hex(code),createdAt:serverTimestamp(),createdBy:ctx.profile.id,updatedAt:serverTimestamp()});
      const box=el.querySelector('#terminal-activation');box.classList.remove('hidden');box.innerHTML=`<strong>${name} wurde angelegt.</strong><p>Terminal-ID: <b>${id}</b></p><p>Aktivierungscode:</p><code>${code}</code><small>Beides einmalig auf dem Gerät eingeben. Anschließend muss dort die Wiederherstellungsdatei gespeichert werden, bevor die Aktivierung abgeschlossen werden kann.</small>`;
      toast(`${name} wurde angelegt.`);
    }catch(e){console.error(e);toast('Terminal konnte nicht angelegt werden.');}
  };


  el.querySelectorAll('.edit-terminal-description').forEach(b=>b.onclick=async()=>{
    const current=b.dataset.description||'';
    const description=window.prompt('Beschreibung für dieses Terminal:',current);
    if(description===null)return;
    const clean=description.trim().slice(0,120);
    try{
      await updateDoc(doc(db,'terminals',b.dataset.id),{description:clean,updatedAt:serverTimestamp()});
      toast('Terminalbeschreibung wurde gespeichert.');
      await renderTerminals(el,ctx);
    }catch(e){console.error(e);toast('Terminalbeschreibung konnte nicht gespeichert werden.');}
  });

  el.querySelectorAll('.reset-terminal').forEach(b=>b.onclick=async()=>{const code=activationCode();try{await saveSecret(b.dataset.id,code);toast('Neuer Aktivierungscode wurde erzeugt.');}catch(e){console.error(e);toast('Aktivierungscode konnte nicht erneuert werden.');}});
  el.querySelectorAll('.toggle-terminal').forEach(b=>b.onclick=async()=>{try{await updateDoc(doc(db,'terminals',b.dataset.id),{active:b.dataset.active!=='true',updatedAt:serverTimestamp()});toast('Terminalstatus wurde geändert.');await renderTerminals(el,ctx);}catch(e){console.error(e);toast('Terminalstatus konnte nicht geändert werden.');}});
}
