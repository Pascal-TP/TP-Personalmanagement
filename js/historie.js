import { db } from "./firebase.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setHead } from "./app.js";
import { esc, fmtDate, ROLE_LABELS } from "./utils.js";

const FIELD_LABELS = {
  name:"Name", companyId:"Firma", email:"E-Mail / Login", username:"Benutzername", hasRealEmail:"Login-Art", role:"Rolle", supervisorId:"Vorgesetzter", active:"Status",
  startDate:"Eintritt", endDate:"Austritt", weeklyHours:"Wochenstunden", vacationDays:"Urlaubstage/Jahr", employeeNumber:"Mitarbeiternummer", companyAreaNumber:"Firmenbereich-Nr.", projectTimeTracking:"Zeiterfassung auf Projekte",
  department:"Abteilung", position:"Position / Tätigkeit", contractType:"Beschäftigungsart", probationEndDate:"Probezeit bis", fixedTermEndDate:"Befristung bis", costCenter:"Kostenstelle", workDays:"Arbeitstage",
  firstAider:"Ersthelfer", firstAiderValidUntil:"Ersthelfer gültig bis", fireWarden:"Brandschutzhelfer", fireWardenValidUntil:"Brandschutzhelfer gültig bis", forkliftPermit:"Staplerschein", forkliftPermitValidUntil:"Staplerschein gültig bis", aerialLiftPermit:"Hubarbeitsbühne", aerialLiftPermitValidUntil:"Hubarbeitsbühne gültig bis", drivingLicenseClasses:"Führerscheinklassen", nextDrivingLicenseCheck:"Nächste Führerscheinkontrolle", occupationalMedicalNotes:"Arbeitsmedizinische Vorsorgen / Hinweise",
  bereiche:"Schulungsbereiche", extraTrainings:"Zusatzschulungen",
  "private.birthDate":"Geburtsdatum", "private.street":"Straße / Hausnummer", "private.postalCode":"PLZ", "private.city":"Ort", "private.privateEmail":"Private E-Mail", "private.phone":"Telefon", "private.mobile":"Mobil", "private.emergencyContactName":"Notfallkontakt", "private.emergencyContactPhone":"Telefon Notfallkontakt",
  "private.taxId":"Steuer-ID", "private.taxClass":"Steuerklasse", "private.childAllowance":"Kinderfreibetrag", "private.religion":"Religion / Kirchensteuer", "private.socialSecurityNumber":"Sozialversicherungsnummer", "private.healthInsuranceId":"Krankenkasse", "private.insuranceType":"Versicherungsart", "private.personGroup":"Personengruppe", "private.contributionGroup":"Beitragsgruppe",
  "private.iban":"IBAN", "private.bic":"BIC", "private.bankId":"Bank", "private.accountHolder":"Kontoinhaber", "private.compensationType":"Entgeltart", "private.grossSalary":"Bruttogehalt", "private.hourlyRate":"Stundenlohn", "private.salaryValidFrom":"Vergütung gültig ab"
};

function toMillis(value){
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value.seconds) return value.seconds * 1000;
  const n = new Date(value).getTime();
  return Number.isFinite(n) ? n : 0;
}
function dateTime(value){
  const ms=toMillis(value);
  if(!ms) return "–";
  return new Intl.DateTimeFormat("de-DE",{dateStyle:"short",timeStyle:"short"}).format(new Date(ms));
}
function displayValue(key,value,companies,userMap,trainingMap,religionMap){
  if(value===null||value===undefined||value==="") return "–";
  if(key==="companyId") return companies.get(value)?.name || value;
  if(key==="supervisorId") return userMap.get(value)?.name || userMap.get(value)?.email || value;
  if(key==="role") return ROLE_LABELS[value] || value;
  if(key==="active") return value===false ? "inaktiv" : "aktiv";
  if(key==="hasRealEmail") return value===false ? "Benutzername" : "E-Mail-Adresse";
  if(key==="projectTimeTracking" || ["firstAider","fireWarden","forkliftPermit","aerialLiftPermit"].includes(key)) return value===true ? "Ja" : "Nein";
  if(key==="private.religion"){const r=religionMap?.get(String(value));return r?`${r.code} · ${r.name}`:String(value);}
  if(key==="workDays") return Array.isArray(value) ? value.join(", ") : String(value);
  if(["startDate","endDate","probationEndDate","fixedTermEndDate","firstAiderValidUntil","fireWardenValidUntil","forkliftPermitValidUntil","aerialLiftPermitValidUntil","nextDrivingLicenseCheck","private.birthDate","private.salaryValidFrom"].includes(key)) return fmtDate(value);
  if(key.startsWith("private.")) return key.includes("grossSalary")||key.includes("hourlyRate") ? (Number(value).toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2})+" €") : String(value);
  if(key==="bereiche") return Array.isArray(value) && value.length ? value.join(", ") : "–";
  if(key==="extraTrainings") return Array.isArray(value) && value.length ? value.map(id=>trainingMap.get(id)?.title||id).join(", ") : "–";
  return String(value);
}

export async function renderHistorie(el,ctx){
  setHead("Historie","Änderungen an Mitarbeiterdaten nachvollziehen.");
  if(ctx.profile?.role!=="admin"){
    el.innerHTML='<div class="error-card">Dieser Bereich ist ausschließlich für die Personalabteilung / Admins vorgesehen.</div>';
    return;
  }

  const [hSnap,uSnap,cSnap,tSnap,rSnap]=await Promise.all([
    getDocs(collection(db,"employeeHistory")),
    getDocs(collection(db,"users")),
    getDocs(collection(db,"companies")),
    getDocs(collection(db,"trainings")),
    getDocs(collection(db,"religionTaxCodes"))
  ]);
  const users=uSnap.docs.map(d=>({id:d.id,...d.data()}));
  const userMap=new Map(users.map(u=>[u.id,u]));
  const companies=new Map(cSnap.docs.map(d=>[d.id,{id:d.id,...d.data()}]));
  const trainingMap=new Map(tSnap.docs.map(d=>[d.id,{id:d.id,...d.data()}]));
  const religionMap=new Map(rSnap.docs.map(d=>{const x={id:d.id,...d.data()};return [String(x.code||''),x]}));
  const entries=hSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>toMillis(b.createdAt)-toMillis(a.createdAt));

  const rows=entries.map(entry=>{
    const employeeName=entry.employeeName || userMap.get(entry.employeeId)?.name || entry.employeeEmail || "Unbekannter Mitarbeiter";
    const actor=entry.actorName || entry.actorEmail || "–";
    const changes=Array.isArray(entry.changes)?entry.changes:[];
    const details=entry.action==="create"
      ? '<span class="muted">Mitarbeiter wurde neu angelegt.</span>'
      : changes.length
        ? `<div class="history-changes">${changes.map(ch=>`<div><strong>${esc(FIELD_LABELS[ch.field]||ch.field)}</strong><span>${esc(displayValue(ch.field,ch.oldValue,companies,userMap,trainingMap,religionMap))} → ${esc(displayValue(ch.field,ch.newValue,companies,userMap,trainingMap,religionMap))}</span></div>`).join("")}</div>`
        : '<span class="muted">Änderung ohne Detailangabe.</span>';
    return `<tr><td>${esc(dateTime(entry.createdAt))}</td><td><strong>${esc(employeeName)}</strong><div class="small muted">${esc(entry.employeeEmail||"")}</div></td><td><span class="pill ${entry.action==='create'?'green':'blue'}">${entry.action==='create'?'angelegt':'geändert'}</span></td><td>${details}</td><td>${esc(actor)}</td></tr>`;
  }).join("");

  el.innerHTML=`<article class="card"><div class="card-head"><div><h2>Mitarbeiter-Historie</h2><p>${entries.length} protokollierte Vorgänge. Neueste Änderungen stehen oben.</p></div></div>
    <div class="info-strip">Die Historie protokolliert Neuanlagen und Änderungen an Mitarbeiterstammdaten. Passwörter werden nicht gespeichert.</div>
    <div class="table-wrap"><table class="history-table"><thead><tr><th>Zeitpunkt</th><th>Mitarbeiter</th><th>Vorgang</th><th>Änderungen</th><th>Geändert von</th></tr></thead><tbody>${rows||'<tr><td colspan="5" class="empty">Noch keine Änderungen protokolliert.</td></tr>'}</tbody></table></div>
  </article>`;
}
