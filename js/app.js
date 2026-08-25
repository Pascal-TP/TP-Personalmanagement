import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, updatePassword } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { normalizeLogin, ROLE_LABELS, roleHeading, initials, toast } from "./utils.js";
import { renderDashboard } from "./dashboard.js";
import { renderMitarbeiter } from "./mitarbeiter.js";
import { renderTerminals } from "./terminals.js";
import { renderZeiterfassung } from "./zeiterfassung.js";
import { renderUrlaub } from "./urlaub.js";
import { renderSchulungen } from "./schulungen.js";
import { renderNews } from "./news-hinweise.js";
import { renderAbrechnungen } from "./abrechnungen.js";
import { renderFirmen } from "./firmen.js";
import { renderAuswertungen } from "./auswertungen.js";
import { renderHistorie } from "./historie.js";
import { renderStammdaten } from "./stammdaten.js";
import { renderDatensicherung } from "./datensicherung.js";
import { hasAdminPermission, hasAnyAdminPermission } from "./permissions.js";

export const ctx = { user:null, profile:null, company:null, view:"dashboard" };
const content=document.getElementById("content"), nav=document.getElementById("main-nav");
const loginPage=document.getElementById("login-page"), shell=document.getElementById("app-shell");

const views = {
  dashboard:{label:"Dashboard",icon:"⌂",roles:["employee","supervisor","admin"],render:renderDashboard},
  time:{label:"Zeiterfassung",icon:"◷",roles:["employee","supervisor","admin"],render:renderZeiterfassung},
  vacation:{label:"Urlaub & Abwesenheit",icon:"☀",roles:["employee","supervisor","admin"],render:renderUrlaub},
  payroll:{label:"Lohn-/Gehaltsabrechnung",icon:"€",roles:["employee","admin"],adminPermission:"payrollManage",render:renderAbrechnungen},
  trainings:{label:"Schulungen",icon:"▤",roles:["employee","supervisor","admin"],render:renderSchulungen},
  employees:{label:"Mitarbeiter",icon:"♙",roles:["admin"],adminAny:["employeesView","employeesCreate","employeesEdit","employeesDelete"],render:renderMitarbeiter},
  terminals:{label:"NFC-Terminals",icon:"⌁",roles:["admin"],adminPermission:"terminalManage",render:renderTerminals},
  news:{label:"News & Hinweise",icon:"●",roles:["admin"],adminPermission:"newsManage",render:renderNews},
  companies:{label:"Firmen",icon:"▣",roles:["admin"],adminPermission:"companyManage",render:renderFirmen},
  masterdata:{label:"Stammdaten",icon:"≡",roles:["admin"],adminPermission:"masterData",render:renderStammdaten},
  reports:{label:"Auswertungen",icon:"▥",roles:["admin","supervisor"],adminPermission:"hoursExport",render:renderAuswertungen},
  history:{label:"Historie",icon:"↺",roles:["admin"],adminPermission:"historyView",render:renderHistorie},
  backup:{label:"Datensicherung",icon:"⤓",roles:["admin"],adminPermission:"backup",render:renderDatensicherung},
  applicants:{label:"Bewerbungsportal",icon:"↗",roles:["admin"],adminPermission:"applicantPortal",external:true}
};

export async function refreshProfile(){
  const snap=await getDoc(doc(db,"users",ctx.user.uid));
  if(!snap.exists()) throw new Error("Für diesen Zugang wurde noch kein Mitarbeiterprofil in Firestore angelegt.");
  ctx.profile={id:snap.id,...snap.data()};
  if(ctx.profile.active===false) throw new Error("Dieser Benutzer ist deaktiviert.");
  if(ctx.profile.companyId){const c=await getDoc(doc(db,"companies",ctx.profile.companyId));ctx.company=c.exists()?{id:c.id,...c.data()}:null}else ctx.company=null;
}
export function setHead(title,subtitle=""){document.getElementById("page-title").textContent=title;document.getElementById("page-subtitle").textContent=subtitle}
export async function navigate(view){
  if(view==="applicants"){const url=localStorage.getItem("tpApplicantsUrl")||"";if(url)window.open(url,"_blank","noopener");else toast("Das Bewerbungsportal wird später als separates Tool angebunden.");return}
  ctx.view=view; renderNav(); const item=views[view]||views.dashboard; content.innerHTML=`<div class="loading">Bereich wird geladen …</div>`;
  try{await item.render(content,ctx)}catch(e){console.error(e);content.innerHTML=`<div class="error-card"><strong>Der Bereich konnte nicht geladen werden.</strong><p>${e.message}</p></div>`}
}
function renderNav(){const role=ctx.profile?.role||"employee";nav.innerHTML=Object.entries(views).filter(([,v])=>{if(!v.roles.includes(role))return false;if(role!=="admin")return true;if(v.adminPermission&&!hasAdminPermission(ctx.profile,v.adminPermission))return false;if(v.adminAny&&!hasAnyAdminPermission(ctx.profile,v.adminAny))return false;return true}).map(([k,v])=>`<button class="nav-btn ${ctx.view===k?'active':''}" data-view="${k}"><span class="icon">${v.icon}</span><span>${v.label}</span></button>`).join("");nav.querySelectorAll("button").forEach(b=>b.onclick=()=>navigate(b.dataset.view))}
function updateChrome(){
  const p=ctx.profile,c=ctx.company;document.getElementById("company-name").textContent=c?.name||"TP-Personalmanagement";
  const logo=document.querySelector("#company-logo img");logo.src=c?.logoUrl||c?.logoDataUrl||"assets/tp-logo.png";
  document.getElementById("role-heading").textContent=roleHeading(p.role);document.getElementById("user-name").textContent=p.name||p.email||"Mitarbeiter";
  document.getElementById("user-role").textContent=ROLE_LABELS[p.role]||p.role;document.getElementById("user-avatar").textContent=initials(p.name||p.email);
}

document.getElementById("login-form").addEventListener("submit",async e=>{e.preventDefault();const msg=document.getElementById("login-message");msg.textContent="Anmeldung läuft …";try{await signInWithEmailAndPassword(auth,normalizeLogin(document.getElementById("login-identifier").value),document.getElementById("login-password").value);msg.textContent=""}catch(err){console.error(err);msg.textContent="Anmeldung nicht möglich. Bitte Zugangsdaten prüfen."}});
document.getElementById("forgot-password-btn").onclick=async()=>{const raw=document.getElementById("login-identifier").value.trim();if(!raw){toast("Bitte zuerst die E-Mail-Adresse eintragen.");return}if(!raw.includes("@")){toast("Bei Benutzernamen erfolgt der Passwort-Reset derzeit über die Personalabteilung.");return}try{await sendPasswordResetEmail(auth,raw);toast("Passwort-Link wurde angefordert.")}catch(e){console.error(e);toast("Passwort-Link konnte nicht angefordert werden.")}};
document.getElementById("logout-btn").onclick=()=>signOut(auth);
document.getElementById("change-password-btn").onclick=async()=>{const p=prompt("Neues Passwort (mindestens 6 Zeichen):");if(!p)return;if(p.length<6){toast("Das Passwort ist zu kurz.");return}try{await updatePassword(auth.currentUser,p);toast("Passwort geändert.")}catch(e){toast("Passwort konnte nicht geändert werden. Ggf. erneut anmelden.")}};

onAuthStateChanged(auth,async user=>{ctx.user=user;if(!user){ctx.profile=null;loginPage.classList.remove("hidden");shell.classList.add("hidden");return}try{await refreshProfile();updateChrome();renderNav();loginPage.classList.add("hidden");shell.classList.remove("hidden");ctx.view="dashboard";await navigate("dashboard")}catch(e){console.error(e);await signOut(auth);document.getElementById("login-message").textContent=e.message}});
