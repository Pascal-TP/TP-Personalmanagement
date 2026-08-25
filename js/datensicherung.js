import { functions } from "./firebase.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";
import { setHead } from "./app.js";
import { esc, toast } from "./utils.js";
import { hasAdminPermission } from "./permissions.js";

const createBackup = httpsCallable(functions, "createPersonnelBackup", { timeout: 540000 });
const listBackups = httpsCallable(functions, "listPersonnelBackups");
const restoreBackup = httpsCallable(functions, "restorePersonnelBackup", { timeout: 540000 });
const deleteBackup = httpsCallable(functions, "deletePersonnelBackup", { timeout: 540000 });

function fmtBytes(n=0){
  const value=Number(n||0);
  if(value<1024)return `${value} B`;
  if(value<1024*1024)return `${(value/1024).toFixed(1)} KB`;
  if(value<1024*1024*1024)return `${(value/1024/1024).toFixed(1)} MB`;
  return `${(value/1024/1024/1024).toFixed(2)} GB`;
}
function fmtDate(value=""){
  if(!value)return "–";
  const d=new Date(value);
  return Number.isNaN(d.getTime())?value:d.toLocaleString("de-DE",{dateStyle:"medium",timeStyle:"short"});
}

export async function renderDatensicherung(el,ctx){
  setHead("Datensicherung","Anwendungsdaten und Personaldateien sichern und bei Bedarf wiederherstellen.");
  if(!hasAdminPermission(ctx.profile,"backup")){
    el.innerHTML='<div class="error-card"><strong>Keine Berechtigung.</strong><p>Die Datensicherung steht ausschließlich der Personalabteilung/Admin zur Verfügung.</p></div>';
    return;
  }

  el.innerHTML=`
    <div class="info-strip backup-info"><strong>Was wird gesichert?</strong><br>
      Mitarbeiter- und Firmendaten, sensible Mitarbeiterdaten, Zeiterfassung, Anträge, Urlaub, Schulungen, Bearbeitungsstände, Historie, News, Stammdaten, Personalakten-Metadaten und Lohn-/Gehaltsabrechnungs-Metadaten sowie die zugehörigen Dateien im KalkPro-Storage.<br><br>
      <strong>Hinweis:</strong> Firebase-Authentication-Konten und Passwörter werden nicht exportiert. Sie bleiben beim Wiederherstellen unverändert in Firebase Authentication bestehen.
    </div>
    <div class="two-col backup-top-grid">
      <article class="card">
        <div class="card-head"><div><h2>Neue Datensicherung</h2><p>Erstellt einen vollständigen serverseitigen Sicherungsstand.</p></div></div>
        <p class="muted backup-copy">Die Sicherung wird unter einem eigenen, datierten Ordner im KalkPro-Storage abgelegt. Je nach Anzahl und Größe der Dokumente kann der Vorgang einige Minuten dauern.</p>
        <div class="actions"><button type="button" class="btn primary" id="backup-create">Backup jetzt erstellen</button></div>
        <div id="backup-create-status" class="backup-status"></div>
      </article>
      <article class="card">
        <div class="card-head"><div><h2>Wiederherstellung</h2><p>Nur für den Fall einer notwendigen Rücksicherung.</p></div></div>
        <div class="warning-box"><strong>Wichtig</strong><span>Eine Wiederherstellung überschreibt die gesicherten Anwendungsdaten mit dem Stand des gewählten Backups. Neue Historieneinträge werden aus Gründen der Nachvollziehbarkeit nicht gelöscht.</span></div>
      </article>
    </div>
    <article class="card">
      <div class="card-head"><div><h2>Vorhandene Backups</h2><p>Gesicherte Stände des TP-Personalmanagements.</p></div><button class="btn secondary small" type="button" id="backup-refresh">Aktualisieren</button></div>
      <div id="backup-list"><div class="loading">Backups werden geladen …</div></div>
    </article>`;

  const listEl=el.querySelector("#backup-list");
  const createBtn=el.querySelector("#backup-create");
  const createStatus=el.querySelector("#backup-create-status");

  async function token(){return ctx.user.getIdToken();}
  async function load(){
    listEl.innerHTML='<div class="loading">Backups werden geladen …</div>';
    try{
      const res=await listBackups({idToken:await token()});
      const rows=res.data?.backups||[];
      if(!rows.length){listEl.innerHTML='<div class="empty">Noch keine Datensicherung vorhanden.</div>';return;}
      listEl.innerHTML=`<div class="table-wrap"><table><thead><tr><th>Erstellt</th><th>Bezeichnung</th><th>Firestore</th><th>Dateien</th><th>Dateigröße</th><th>Erstellt von</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr>
        <td>${esc(fmtDate(r.createdAt))}</td>
        <td><strong>${esc(r.label||r.backupId)}</strong><small class="booking-note">${esc(r.backupId)}</small></td>
        <td>${Number(r.firestoreDocuments||0)}</td>
        <td>${Number(r.storageFiles||0)}</td>
        <td>${esc(fmtBytes(r.storageBytes||0))}</td>
        <td>${esc(r.createdByName||r.createdByEmail||"–")}</td>
        <td><div class="actions"><button class="btn secondary small backup-restore" data-id="${esc(r.backupId)}" type="button">Wiederherstellen</button><button class="btn danger small backup-delete" data-id="${esc(r.backupId)}" type="button">Löschen</button></div></td>
      </tr>`).join("")}</tbody></table></div>`;

      listEl.querySelectorAll(".backup-restore").forEach(btn=>btn.onclick=async()=>{
        const row=rows.find(x=>x.backupId===btn.dataset.id);
        const text=`Backup vom ${fmtDate(row?.createdAt)} wirklich wiederherstellen?\n\nDie Anwendungsdaten werden auf diesen Sicherungsstand zurückgesetzt. Firebase-Login-Konten und Passwörter bleiben unverändert.`;
        if(!confirm(text))return;
        const verify=prompt('Zur Sicherheit bitte das Wort WIEDERHERSTELLEN eingeben:');
        if(verify!=="WIEDERHERSTELLEN"){toast("Wiederherstellung abgebrochen.");return;}
        btn.disabled=true;btn.textContent="Wiederherstellung läuft …";
        try{
          const res=await restoreBackup({idToken:await token(),backupId:btn.dataset.id});
          toast(`Backup wiederhergestellt: ${res.data?.firestoreDocuments||0} Datensätze, ${res.data?.storageFiles||0} Dateien.`);
          await load();
        }catch(err){console.error(err);toast(err?.message||"Backup konnte nicht wiederhergestellt werden.");btn.disabled=false;btn.textContent="Wiederherstellen";}
      });

      listEl.querySelectorAll(".backup-delete").forEach(btn=>btn.onclick=async()=>{
        const row=rows.find(x=>x.backupId===btn.dataset.id);
        if(!confirm(`Datensicherung vom ${fmtDate(row?.createdAt)} wirklich endgültig löschen?`))return;
        btn.disabled=true;
        try{await deleteBackup({idToken:await token(),backupId:btn.dataset.id});toast("Backup gelöscht.");await load();}
        catch(err){console.error(err);toast(err?.message||"Backup konnte nicht gelöscht werden.");btn.disabled=false;}
      });
    }catch(err){console.error(err);listEl.innerHTML=`<div class="error-card"><strong>Backups konnten nicht geladen werden.</strong><p>${esc(err?.message||"")}</p></div>`;}
  }

  createBtn.onclick=async()=>{
    if(!confirm("Jetzt einen vollständigen Sicherungsstand des TP-Personalmanagements erstellen?"))return;
    createBtn.disabled=true;createBtn.textContent="Backup wird erstellt …";createStatus.innerHTML='<div class="info-strip">Firestore-Daten und Dateien werden gesichert. Bitte dieses Fenster geöffnet lassen.</div>';
    try{
      const res=await createBackup({idToken:await token()});
      createStatus.innerHTML=`<div class="success-box"><strong>Datensicherung abgeschlossen.</strong><span>${Number(res.data?.firestoreDocuments||0)} Firestore-Datensätze und ${Number(res.data?.storageFiles||0)} Dateien (${fmtBytes(res.data?.storageBytes||0)}) wurden gesichert.</span></div>`;
      toast("Datensicherung erfolgreich erstellt.");
      await load();
    }catch(err){console.error(err);createStatus.innerHTML=`<div class="error-card"><strong>Datensicherung fehlgeschlagen.</strong><p>${esc(err?.message||"")}</p></div>`;}
    finally{createBtn.disabled=false;createBtn.textContent="Backup jetzt erstellen";}
  };
  el.querySelector("#backup-refresh").onclick=load;
  await load();
}
