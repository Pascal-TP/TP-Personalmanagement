import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js';
import { blazeConfig } from './firebase.js';
import { parseEmployeeNfcPayload, readTextRecord, nfcSupported } from './nfc-utils.js';

const app=initializeApp(blazeConfig,'tp-terminal-pwa');
const functions=getFunctions(app,'europe-west1');
const terminalStamp=httpsCallable(functions,'terminalStamp');

const views=['setup','home','scan','project','result'];
const $=id=>document.getElementById(id);
let state={action:null,token:null,employee:null,projectRequired:false,returnTimer:null};
let stagedSetup=null;

function show(name){views.forEach(v=>$(v+'-view')?.classList.toggle('hidden',v!==name));}
function terminalConfig(){try{return JSON.parse(localStorage.getItem('tpTerminalConfig')||'null')}catch(_){return null}}
function saveConfig(c){localStorage.setItem('tpTerminalConfig',JSON.stringify(c));}
function clearConfig(){localStorage.removeItem('tpTerminalConfig');}
function terminalNameFromId(id){return `Terminal ${Number(String(id||'').replace(/\D/g,''))}`;}
function validTerminalCredentials(id,secret){return /^terminal-\d{3}$/.test(String(id||''))&&String(secret||'').length>=16;}
function recoveryFileName(id){return `TP-Terminal-${id}-Wiederherstellung.json`;}
function recoveryPayload(c){return {format:'TP-Personalmanagement-Terminal-Recovery',version:1,terminalId:c.id,terminalSecret:c.secret,terminalName:c.name||terminalNameFromId(c.id),createdAt:new Date().toISOString(),hinweis:'Diese Datei enthält den Terminal-Aktivierungsschlüssel. Bitte geschützt aufbewahren und nicht weitergeben.'};}
function downloadRecoveryFile(c){
  const blob=new Blob([JSON.stringify(recoveryPayload(c),null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=recoveryFileName(c.id);document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function resetSetupFlow(){stagedSetup=null;$('recovery-step')?.classList.add('hidden');if($('recovery-confirm'))$('recovery-confirm').checked=false;if($('finish-setup'))$('finish-setup').disabled=true;}
function updateClock(){const d=new Date();$('clock').textContent=d.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit',second:'2-digit'});$('date').textContent=d.toLocaleDateString('de-DE',{weekday:'long',day:'2-digit',month:'2-digit',year:'numeric'});}updateClock();setInterval(updateClock,1000);
function updateConnection(){const online=navigator.onLine;$('connection-dot').className='connection-dot '+(online?'online':'offline');$('connection-text').textContent=online?'Online · Buchungen möglich':'Keine Internetverbindung · Buchung nicht möglich';}updateConnection();addEventListener('online',updateConnection);addEventListener('offline',updateConnection);

function applyConfig(){const c=terminalConfig();if(!c){$('terminal-name').textContent='Terminal nicht eingerichtet';resetSetupFlow();show('setup');return;} $('terminal-name').textContent=c.name||c.id||'TP-Terminal';show('home');}

$('prepare-setup').onclick=()=>{
  const id=$('setup-id').value.trim();const secret=$('setup-secret').value.trim();
  if(!/^terminal-\d{3}$/.test(id)){ $('setup-message').textContent='Bitte eine gültige Terminal-ID eingeben, z. B. terminal-001.';return;}
  if(secret.length<16){$('setup-message').textContent='Bitte den vollständigen Aktivierungscode eingeben.';return;}
  stagedSetup={id,secret,name:terminalNameFromId(id)};$('setup-message').textContent='';$('recovery-step').classList.remove('hidden');$('recovery-confirm').checked=false;$('finish-setup').disabled=true;
  $('download-recovery').focus();
};
$('download-recovery').onclick=()=>{
  if(!stagedSetup)return;
  downloadRecoveryFile(stagedSetup);
  $('recovery-confirm-wrap').classList.remove('hidden');
  $('recovery-message').textContent=`Die Datei ${recoveryFileName(stagedSetup.id)} wurde zum Speichern angeboten. Bitte bewahren Sie sie geschützt auf.`;
};
$('recovery-confirm').onchange=e=>{$('finish-setup').disabled=!e.target.checked;};
$('finish-setup').onclick=()=>{
  if(!stagedSetup||!$('recovery-confirm').checked){$('recovery-message').textContent='Die Terminal-Einrichtung kann erst abgeschlossen werden, nachdem die Wiederherstellungsdatei gespeichert und bestätigt wurde.';return;}
  saveConfig(stagedSetup);stagedSetup=null;$('setup-id').value='';$('setup-secret').value='';$('setup-message').textContent='';applyConfig();
};
$('restore-file').onchange=async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{
    const data=JSON.parse(await file.text());
    const id=String(data.terminalId||'').trim();const secret=String(data.terminalSecret||'').trim();
    if(data.format!=='TP-Personalmanagement-Terminal-Recovery'||Number(data.version)!==1||!validTerminalCredentials(id,secret)) throw new Error('Ungültige Wiederherstellungsdatei.');
    saveConfig({id,secret,name:String(data.terminalName||terminalNameFromId(id))});$('setup-message').textContent='';e.target.value='';applyConfig();
  }catch(err){console.error(err);$('setup-message').textContent='Die ausgewählte Datei ist keine gültige TP-Terminal-Wiederherstellungsdatei.';e.target.value='';}
};
$('reset-terminal').onclick=()=>{if(confirm('Terminal-Einrichtung auf diesem Gerät wirklich zurücksetzen? Die Wiederherstellungsdatei bleibt davon unberührt.')){clearConfig();applyConfig();}};
$('download-current-recovery').onclick=()=>{const c=terminalConfig();if(c)downloadRecoveryFile(c);};
$('cancel-scan').onclick=resetHome;$('cancel-project').onclick=resetHome;

function resetHome(){state={action:null,token:null,employee:null,projectRequired:false,returnTimer:null};$('project-number').value='';$('book-project').disabled=true;show('home');}
function result(ok,title,message){clearTimeout(state.returnTimer);$('result-view').classList.toggle('error',!ok);$('result-icon').textContent=ok?'✓':'!';$('result-title').textContent=title;$('result-message').textContent=message;show('result');state.returnTimer=setTimeout(resetHome,ok?3000:4500);}

async function callStamp(projectNumber=''){
  const c=terminalConfig();if(!c){applyConfig();return;}
  if(!navigator.onLine){result(false,'Keine Verbindung','Die Buchung wurde nicht gespeichert. Bitte Internetverbindung prüfen und erneut stempeln.');return;}
  try{
    const response=await terminalStamp({terminalId:c.id,terminalSecret:c.secret,nfcToken:state.token,action:state.action,projectNumber});
    const data=response.data||{};
    if(data.projectRequired){state.employee=data.userName||'Mitarbeiter';state.projectRequired=true;$('project-employee').textContent=state.employee;$('project-copy').textContent=data.openProjectNumber?`Aktuell läuft Projekt ${data.openProjectNumber}. Neue sechsstellige Projektnummer eingeben.`:'Bitte die sechsstellige Projektnummer eingeben.';$('project-number').value='';$('book-project').disabled=true;show('project');setTimeout(()=>$('project-number').focus(),50);return;}
    result(true,'Buchung erfolgreich',data.message||'Die Arbeitszeit wurde erfolgreich gebucht.');
  }catch(err){console.error(err);const msg=err?.message?.replace(/^Firebase:\s*/,'')||'Buchung konnte nicht durchgeführt werden.';result(false,'Buchung nicht möglich',msg);}
}

async function startScan(action){
  if(!nfcSupported()){result(false,'NFC nicht verfügbar','Bitte Google Chrome auf einem NFC-fähigen Android-Gerät verwenden.');return;}
  if(!navigator.onLine){result(false,'Keine Verbindung','Die Buchung wurde nicht gespeichert. Bitte Internetverbindung prüfen.');return;}
  state.action=action;state.token=null;$('scan-title').textContent='Bitte NFC-Transponder an das Gerät halten.';$('scan-copy').textContent=action==='come'?'KOMMEN wird nach erfolgreicher Identifikation gebucht.':'GEHEN wird nach erfolgreicher Identifikation gebucht.';show('scan');
  try{
    const reader=new NDEFReader();
    await reader.scan();
    reader.onreadingerror=()=>result(false,'Transponder nicht lesbar','Bitte den NFC-Transponder erneut an das Gerät halten.');
    reader.onreading=async event=>{
      let token='';
      for(const record of event.message.records){const parsed=parseEmployeeNfcPayload(readTextRecord(record));if(parsed){token=parsed;break;}}
      if(!token){result(false,'Unbekannter Transponder','Auf diesem NFC-Transponder wurde kein gültiger TP-Schlüssel gefunden.');return;}
      state.token=token;$('scan-title').textContent='Transponder erkannt';$('scan-copy').textContent='Buchung wird geprüft …';await callStamp('');
    };
  }catch(err){console.error(err);if(err?.name==='NotAllowedError')result(false,'NFC-Zugriff nicht erlaubt','Bitte NFC-Berechtigung für diese Seite zulassen und erneut versuchen.');else result(false,'NFC konnte nicht gestartet werden',err?.message||'Bitte NFC am Gerät aktivieren und erneut versuchen.');}
}

document.querySelectorAll('.stamp-button').forEach(b=>b.onclick=()=>startScan(b.dataset.action));
$('project-number').addEventListener('input',e=>{e.target.value=e.target.value.replace(/\D/g,'').slice(0,6);$('book-project').disabled=!/^\d{6}$/.test(e.target.value);});
$('book-project').onclick=()=>callStamp($('project-number').value);

if('serviceWorker' in navigator){navigator.serviceWorker.register('./terminal-sw.js').catch(console.error);}
applyConfig();
