import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js';
import { blazeConfig } from './firebase.js';
import { parseEmployeeNfcPayload, readTextRecord, nfcSupported } from './nfc-utils.js';

const app=initializeApp(blazeConfig,'tp-terminal-pwa');
const functions=getFunctions(app,'europe-west1');
const terminalStamp=httpsCallable(functions,'terminalStamp');

const views=['setup','home','scan','project','result'];
const $=id=>document.getElementById(id);
let state={action:null,token:null,uid:null,employee:null,projectRequired:false,processing:false,returnTimer:null};
let hidBuffer='';
let hidTimer=null;
let hidLastAt=0;
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

function resetHome(){clearTimeout(hidTimer);hidBuffer='';state={action:null,token:null,uid:null,employee:null,projectRequired:false,processing:false,returnTimer:null};$('project-number').value='';$('book-project').disabled=true;show('home');}
function result(ok,title,message){clearTimeout(state.returnTimer);$('result-view').classList.toggle('error',!ok);$('result-icon').textContent=ok?'✓':'!';$('result-title').textContent=title;$('result-message').textContent=message;show('result');state.returnTimer=setTimeout(resetHome,ok?3000:4500);}

async function callStamp(projectNumber=''){
  const c=terminalConfig();if(!c){applyConfig();return;}
  if(!navigator.onLine){result(false,'Keine Verbindung','Die Buchung wurde nicht gespeichert. Bitte Internetverbindung prüfen und erneut stempeln.');return;}
  try{
    const response=await terminalStamp({terminalId:c.id,terminalSecret:c.secret,nfcToken:state.token||'',nfcUid:state.uid||'',action:state.action,projectNumber});
    const data=response.data||{};
    if(data.projectRequired){state.employee=data.userName||'Mitarbeiter';state.projectRequired=true;$('project-employee').textContent=state.employee;$('project-copy').textContent=data.openProjectNumber?`Aktuell läuft Projekt ${data.openProjectNumber}. Neue sechsstellige Projektnummer eingeben.`:'Bitte die sechsstellige Projektnummer eingeben.';$('project-number').value='';$('book-project').disabled=true;show('project');setTimeout(()=>$('project-number').focus(),50);return;}
    result(true,'Buchung erfolgreich',data.message||'Die Arbeitszeit wurde erfolgreich gebucht.');
  }catch(err){console.error(err);const msg=err?.message?.replace(/^Firebase:\s*/,'')||'Buchung konnte nicht durchgeführt werden.';result(false,'Buchung nicht möglich',msg);}
}

async function submitCredential({token='',uid=''}){
  if(state.processing||!state.action)return;
  state.processing=true;state.token=token;state.uid=uid;
  $('scan-title').textContent='Transponder erkannt';$('scan-copy').textContent='Buchung wird geprüft …';
  try{await callStamp('');}finally{if($('scan-view')&&!$('scan-view').classList.contains('hidden'))state.processing=false;}
}

function scanViewActive(){return !!state.action && !$('scan-view').classList.contains('hidden');}
function finishHidBuffer(){
  clearTimeout(hidTimer);hidTimer=null;
  const uid=hidBuffer.trim();hidBuffer='';
  if(!scanViewActive()||state.processing)return;
  if(/^\d{6,32}$/.test(uid))submitCredential({uid});
}
function handleHidKeydown(event){
  if(!scanViewActive()||state.processing)return;
  if(document.activeElement===$('project-number'))return;
  const now=performance.now();
  if(now-hidLastAt>350)hidBuffer='';
  hidLastAt=now;
  if(/^\d$/.test(event.key)){
    event.preventDefault();hidBuffer=(hidBuffer+event.key).slice(-32);
    clearTimeout(hidTimer);hidTimer=setTimeout(finishHidBuffer,140);return;
  }
  if(event.key==='Enter'||event.key==='Tab'){
    if(hidBuffer){event.preventDefault();finishHidBuffer();}
  }
}
document.addEventListener('keydown',handleHidKeydown,true);

async function startScan(action){
  if(!navigator.onLine){result(false,'Keine Verbindung','Die Buchung wurde nicht gespeichert. Bitte Internetverbindung prüfen.');return;}
  clearTimeout(hidTimer);hidBuffer='';state.action=action;state.token=null;state.uid=null;state.processing=false;
  $('scan-title').textContent='Bitte NFC-Transponder an das Gerät oder den USB-Leser halten.';
  $('scan-copy').textContent=action==='come'?'KOMMEN wird nach erfolgreicher Identifikation gebucht.':'GEHEN wird nach erfolgreicher Identifikation gebucht.';show('scan');
  if(!nfcSupported()){
    $('scan-copy').textContent='Externer USB-Leser bereit. Transponder bitte auf den Leser legen.';
    return;
  }
  try{
    const reader=new NDEFReader();
    await reader.scan();
    reader.onreadingerror=()=>{if(!state.processing&&scanViewActive())$('scan-copy').textContent='Interner NFC-Leser konnte den Transponder nicht lesen. Bitte erneut anhalten oder den externen USB-Leser verwenden.';};
    reader.onreading=async event=>{
      if(state.processing||!scanViewActive())return;
      let token='';
      for(const record of event.message.records){const parsed=parseEmployeeNfcPayload(readTextRecord(record));if(parsed){token=parsed;break;}}
      if(!token){$('scan-copy').textContent='Auf diesem Transponder wurde kein gültiger TP-Schlüssel gefunden. Bitte erneut anhalten oder den externen USB-Leser verwenden.';return;}
      await submitCredential({token});
    };
  }catch(err){
    console.error(err);
    if(scanViewActive())$('scan-copy').textContent=err?.name==='NotAllowedError'?'Interner NFC-Zugriff ist nicht erlaubt. Der externe USB-Leser kann weiterhin verwendet werden.':'Interner NFC-Leser konnte nicht gestartet werden. Der externe USB-Leser kann weiterhin verwendet werden.';
  }
}

document.querySelectorAll('.stamp-button').forEach(b=>b.onclick=()=>startScan(b.dataset.action));
$('project-number').addEventListener('input',e=>{e.target.value=e.target.value.replace(/\D/g,'').slice(0,6);$('book-project').disabled=!/^\d{6}$/.test(e.target.value);});
$('book-project').onclick=()=>callStamp($('project-number').value);

if('serviceWorker' in navigator){navigator.serviceWorker.register('./terminal-sw.js').catch(console.error);}
applyConfig();
