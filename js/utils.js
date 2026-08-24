export const AREA_NAMES = {
  "1":"Büromitarbeiter(in)","2":"Büromitarbeiter(in) mit Fahrzeug","3":"Elektrotechnik","4":"Monteure TGA","5":"Monteure NDF",
  "6":"Lager und Logistik","7":"Dachdecker(in)","8":"NDF Fußbodentechnik","9":"Reinigungskraft","10":"Estrichleger"
};
export const ROLE_LABELS = { employee:"Mitarbeiter", supervisor:"Vorgesetzter", admin:"Personalabteilung / Admin" };
export const esc = (v="") => String(v).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
export function toast(message){const e=document.getElementById("toast");e.textContent=message;e.classList.add("show");setTimeout(()=>e.classList.remove("show"),2500)}
export function fmtDate(value){if(!value)return "–";const d=value?.toDate?value.toDate():new Date(String(value).length===10?`${value}T12:00:00`:value);return Number.isNaN(d.getTime())?"–":new Intl.DateTimeFormat("de-DE").format(d)}
export function fmtDateTime(value){if(!value)return "–";const d=value?.toDate?value.toDate():new Date(value);return Number.isNaN(d.getTime())?"–":new Intl.DateTimeFormat("de-DE",{dateStyle:"short",timeStyle:"short"}).format(d)}
export function initials(name=""){return name.split(/\s+/).filter(Boolean).map(x=>x[0]).join("").slice(0,2).toUpperCase()||"TP"}
export function syntheticEmail(username=""){return `${String(username).trim().toLowerCase()}@portal.local`}
export function normalizeLogin(value=""){const v=String(value).trim().toLowerCase();return v.includes("@")?v:syntheticEmail(v)}
export function roleHeading(role){return role==="admin"?"Adminbereich":role==="supervisor"?"Vorgesetztenbereich":"Mitarbeiterbereich"}
export function card(title,body,extra=""){return `<article class="card"><div class="card-head"><div><h2>${title}</h2>${extra}</div></div>${body}</article>`}
export function empty(text){return `<div class="empty">${text}</div>`}
export function statusPill(text,type="gray"){return `<span class="pill ${type}">${text}</span>`}
