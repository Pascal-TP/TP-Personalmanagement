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

function show(name){views.forEach(v=>$(v+'-view')?.classList.toggle('hidden',v!==name));}
function terminalConfig(){try{return JSON.parse(localStorage.getItem('tpTerminalConfig')||'null')}catch(_){return null}}
function saveConfig(c){localStorage.setItem('tpTerminalConfig',JSON.stringify(c));}
function clearConfig(){localStorage.removeItem('tpTerminalConfig');}
function updateClock(){const d=new Date();$('clock').textContent=d.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit',second:'2-digit'});$('date').textContent=d.toLocaleDateString('de-DE',{weekday:'long',day:'2-digit',month:'2-digit',year:'numeric'});}updateClock();setInterval(updateClock,1000);
function updateConnection(){const online=navigator.onLine;$('connection-dot').className='connection-dot '+(online?'online':'offline');$('connection-text').textContent=online?'Online · Buchungen möglich':'Keine Internetverbindung · Buchung nicht möglich';}updateConnection();addEventListener('online',updateConnection);addEventListener('offline',updateConnection);

function applyConfig(){const c=terminalConfig();if(!c){$('terminal-name').textContent='Terminal nicht eingerichtet';show('setup');return;} $('terminal-name').textContent=c.name||c.id||'TP-Terminal';show('home');}

$('save-setup').onclick=()=>{const id=$('setup-id').value.trim();const secret=$('setup-secret').value.trim();if(!/^terminal-\d{3}$/.test(id)){ $('setup-message').textContent='Bitte eine gültige Terminal-ID eingeben, z. B. terminal-001.';return;}if(secret.length<16){$('setup-message').textContent='Bitte den vollständigen Aktivierungscode eingeben.';return;}saveConfig({id,secret,name:`Terminal ${Number(id.replace(/\D/g,''))}`});$('setup-message').textContent='';applyConfig();};
$('reset-terminal').onclick=()=>{if(confirm('Terminal-Einrichtung auf diesem Gerät wirklich zurücksetzen?')){clearConfig();applyConfig();}};
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
