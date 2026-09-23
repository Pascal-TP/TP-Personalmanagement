export const AREA_NAMES = {
  "1":"Büromitarbeiter(in)","2":"Büromitarbeiter(in) mit Fahrzeug","3":"Elektrotechnik","4":"Monteure TGA","5":"Monteure NDF",
  "6":"Lager und Logistik","7":"Dachdecker(in)","8":"NDF Fußbodentechnik","9":"Reinigungskraft","10":"Estrichleger"
};
export const ROLE_LABELS = { employee:"Mitarbeiter", supervisor:"Vorgesetzter", admin:"Personalabteilung / Admin" };
export const esc = (v="") => String(v).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
// Native modal dialogs enter the browser top layer, including above existing <dialog> elements.
const noticeQueue=[];
let noticeActive=false;
function notice(message,kind='info',options={}){
  return new Promise(resolve=>{
    noticeQueue.push({message:String(message),kind,options,resolve});
    if(!noticeActive)showNextNotice();
  });
}
function showNextNotice(){
  const entry=noticeQueue.shift();
  if(!entry){noticeActive=false;return;}
  noticeActive=true;
  const {message,kind,options,resolve}=entry;
  let dialog=document.getElementById('tp-notice-dialog');
  if(!dialog){dialog=document.createElement('dialog');dialog.id='tp-notice-dialog';dialog.className='tp-notice';document.body.append(dialog);}
  const titles={success:'Erfolgreich',info:'Hinweis',warning:'Bitte beachten',error:'Fehler',danger:'Wichtige Bestätigung',confirm:'Bestätigung',input:'Eingabe'};
  const tone=kind==='confirm'||kind==='input'?(options.danger?'danger':'warning'):kind;
  dialog.className=`tp-notice tp-notice--${tone}`;
  const cancelLabel=esc(options.cancelLabel||'Abbrechen'),acceptLabel=esc(options.acceptLabel||(kind==='input'?'Bestätigen':'Bestätigen'));
  dialog.innerHTML=`<form method="dialog"><div class="tp-notice-head"><span class="tp-notice-icon" aria-hidden="true">${{success:'✓',info:'i',warning:'!',error:'!',danger:'!',confirm:'?',input:'✎'}[tone]||'i'}</span><h2 id="tp-notice-title">${titles[kind]||titles.info}</h2></div><div class="tp-notice-text"></div>${kind==='input'?'<label class="tp-notice-field"><span>Ihre Eingabe</span><input id="tp-notice-value" autocomplete="off"></label>':''}<div class="tp-notice-actions">${kind==='confirm'||kind==='input'?`<button type="button" class="btn secondary" data-action="cancel">${cancelLabel}</button><button type="button" class="btn primary" data-action="accept">${acceptLabel}</button>`:'<button type="button" class="btn primary" data-action="accept">OK</button>'}</div></form>`;
  dialog.querySelector('.tp-notice-text').textContent=message;
  dialog.setAttribute('aria-labelledby','tp-notice-title');
  const input=dialog.querySelector('input');
  if(input){input.type=options.password?'password':'text';input.value=options.value||'';input.maxLength=options.maxLength||500;}
  let timer;
  const finish=value=>{clearTimeout(timer);dialog.close();dialog.remove();resolve(value);showNextNotice();};
  dialog.querySelector('form').onsubmit=e=>{e.preventDefault();finish(kind==='input'?input.value:true);};
  dialog.querySelector('[data-action="accept"]').onclick=()=>finish(kind==='input'?input.value:true);
  dialog.querySelector('[data-action="cancel"]')?.addEventListener('click',()=>finish(kind==='input'?null:false));
  dialog.oncancel=e=>{e.preventDefault();finish(kind==='input'?null:false);};
  dialog.showModal();
  if(input)input.focus();else dialog.querySelector('[data-action="accept"]').focus();
  if(kind==='success')timer=setTimeout(()=>finish(true),2800);
}
export function toast(message,type){
  const kind=type==='error'?'error':type==='warning'?'warning':type==='success'?'success':/konnte nicht|nicht möglich|nicht gespeichert|fehlgeschlagen|Fehler|abgebrochen|blockiert/i.test(String(message))?'error':/^(Bitte |Keine Berechtigung|Für diesen|Das |Die |Der |Ein |Eine |Ungültig|Maximal |Minuten |Zur Sicherheit)/i.test(String(message))?'warning':/(gespeichert|erstellt|gelöscht|gesendet|geändert|abgeschlossen|übernommen|hochgeladen|gestartet|gestempelt|zugewiesen|entfernt|zurückgezogen|gesperrt|gebucht|erzeugt|angelegt|genehmigt|abgelehnt|hergestellt)/i.test(String(message))?'success':'info';
  return notice(message,kind);
}
export function confirmDialog(message,options={}){return notice(message,'confirm',options)}
export function inputDialog(message,value='',options={}){return notice(message,'input',{...options,value})}
export function validationNotice(messages){return notice([...new Set(messages)].join('\n'),'warning')}

export function fmtDate(value){if(!value)return "–";const d=value?.toDate?value.toDate():new Date(String(value).length===10?`${value}T12:00:00`:value);return Number.isNaN(d.getTime())?"–":new Intl.DateTimeFormat("de-DE").format(d)}
export function fmtDateTime(value){if(!value)return "–";const d=value?.toDate?value.toDate():new Date(value);return Number.isNaN(d.getTime())?"–":new Intl.DateTimeFormat("de-DE",{dateStyle:"short",timeStyle:"short"}).format(d)}
export function initials(name=""){return name.split(/\s+/).filter(Boolean).map(x=>x[0]).join("").slice(0,2).toUpperCase()||"TP"}
export function syntheticEmail(username=""){return `${String(username).trim().toLowerCase()}@portal.local`}
export function normalizeLogin(value=""){const v=String(value).trim().toLowerCase();return v.includes("@")?v:syntheticEmail(v)}
export function roleHeading(role){return role==="admin"?"Adminbereich":role==="supervisor"?"Vorgesetztenbereich":"Mitarbeiterbereich"}
export function card(title,body,extra=""){return `<article class="card"><div class="card-head"><div><h2>${title}</h2>${extra}</div></div>${body}</article>`}
export function empty(text){return `<div class="empty">${text}</div>`}
export function statusPill(text,type="gray"){return `<span class="pill ${type}">${text}</span>`}

// Collect all invalid native fields once, instead of allowing the browser to show a bubble per field.
let invalidNoticeScheduled=false;
document.addEventListener('invalid',event=>{
  event.preventDefault();
  if(invalidNoticeScheduled)return;
  invalidNoticeScheduled=true;
  setTimeout(()=>{
    invalidNoticeScheduled=false;
    const form=event.target.form;if(!form)return;
    const fields=[...form.elements].filter(field=>field.willValidate&&!field.validity.valid);
    const names=fields.map(field=>{
      const label=field.labels?.[0]?.textContent?.trim()||field.getAttribute('aria-label')||field.name||'Pflichtangabe';
      return `• ${label.replace(/\s+/g,' ').slice(0,100)}${field.validity.valueMissing?' fehlt.':': '+field.validationMessage}`;
    });
    if(names.length)validationNotice(['Bitte folgende Angaben prüfen:',...names]);
  },0);
},true);
