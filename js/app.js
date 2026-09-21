import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, updatePassword } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, getDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { normalizeLogin, ROLE_LABELS, roleHeading, initials, toast, inputDialog } from "./utils.js";
import { renderDashboard } from "./dashboard.js";
import { renderMitarbeiter } from "./mitarbeiter.js";
import { renderSupervisorMitarbeiter } from "./mitarbeiter-vorgesetzter.js";
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
import { renderAenderungsantraege } from "./aenderungsantraege.js";
import { hasAdminPermission, hasAnyAdminPermission } from "./permissions.js";
import { beginPortalLoading, endPortalLoading } from "./loading-indicator.js";

export const ctx = { user:null, profile:null, company:null, view:"dashboard" };
const content=document.getElementById("content"), nav=document.getElementById("main-nav");
const loginPage=document.getElementById("login-page"), shell=document.getElementById("app-shell");

const views = {
  dashboard:{label:"Dashboard",icon:"⌂",roles:["employee","supervisor","admin"],render:renderDashboard},
  time:{label:"Zeiterfassung",icon:"◷",roles:["employee","supervisor","admin"],render:renderZeiterfassung},
  vacation:{label:"Urlaub & Abwesenheit",icon:"☀",roles:["employee","supervisor","admin"],render:renderUrlaub},
  payroll:{label:"Lohn-/Gehaltsabrechnung",icon:"€",roles:["employee","admin"],adminPermission:"payrollManage",render:renderAbrechnungen},
  trainings:{label:"Schulungen",icon:"▤",roles:["employee","supervisor","admin"],render:renderSchulungen},
  changes:{label:"Änderungsanträge",icon:"✎",roles:["employee","supervisor","admin"],adminPermission:"personalDataChanges",render:renderAenderungsantraege},
  employees:{label:"Mitarbeiter",icon:"♙",roles:["admin","supervisor"],adminAny:["employeesView","employeesCreate","employeesEdit","employeesDelete"],render:async(el,ctx)=>ctx.profile?.role==="supervisor"?renderSupervisorMitarbeiter(el,ctx):renderMitarbeiter(el,ctx)},
  terminals:{label:"NFC-Terminals",icon:"⌁",roles:["admin"],adminPermission:"terminalManage",render:renderTerminals},
  news:{label:"News & Hinweise",icon:"●",roles:["admin"],adminPermission:"newsManage",render:renderNews},
  companies:{label:"Firmen",icon:"▣",roles:["admin"],adminPermission:"companyManage",render:renderFirmen},
  masterdata:{label:"Stammdaten",icon:"≡",roles:["admin"],adminPermission:"masterData",render:renderStammdaten},
  reports:{label:"Auswertungen",icon:"▥",roles:["admin","supervisor"],adminPermission:"hoursExport",render:renderAuswertungen},
  history:{label:"Historie",icon:"↺",roles:["admin"],adminPermission:"historyView",render:renderHistorie},
  backup:{label:"Datensicherung",icon:"⤓",roles:["admin"],adminPermission:"backup",render:renderDatensicherung},
  applicants:{label:"Bewerbungsportal",icon:"↗",roles:["admin"],adminPermission:"applicantPortal",external:true},
  management:{label:"TP-Managementportal",icon:"↗",roles:["employee","supervisor","admin"],requiresManagementPortalAccess:true,external:true}
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
  if(view==='time'&&ctx.profile?.role==='employee'&&ctx.profile?.noTimeTracking===true){toast('Für diesen Mitarbeiter ist keine Zeiterfassung eingerichtet.');view='dashboard';}
  if(view==="applicants"){const url=localStorage.getItem("tpApplicantsUrl")||"";if(url)window.open(url,"_blank","noopener");else toast("Das Bewerbungsportal wird später als separates Tool angebunden.");return}
  if(view==="management"){if(ctx.profile?.managementPortalAccess!==true){toast("Für diesen Benutzer ist das TP-Managementportal nicht freigeschaltet.");return}window.open("https://pascal-tp.github.io/TP-Managementportal/","_blank","noopener");return}
  ctx.view=view; renderNav(); const item=views[view]||views.dashboard; content.innerHTML=`<div class="loading">Bereich wird geladen …</div>`;
  const loadingId=beginPortalLoading(`${item.label||"Bereich"} wird geladen …`);
  try{await item.render(content,ctx)}catch(e){console.error(e);content.innerHTML=`<div class="error-card"><strong>Der Bereich konnte nicht geladen werden.</strong><p>${e.message}</p></div>`}finally{endPortalLoading(loadingId)}
}
window.tpNavigate=navigate;
window.addEventListener("tp:navigate",e=>{const view=e?.detail?.view;if(view&&views[view])navigate(view)});
function renderNav(){const role=ctx.profile?.role||"employee";nav.innerHTML=Object.entries(views).filter(([k,v])=>{if(!v.roles.includes(role))return false;if(k==='time'&&role==='employee'&&ctx.profile?.noTimeTracking===true)return false;if(v.requiresManagementPortalAccess&&ctx.profile?.managementPortalAccess!==true)return false;if(role!=="admin")return true;if(v.adminPermission&&!hasAdminPermission(ctx.profile,v.adminPermission))return false;if(v.adminAny&&!hasAnyAdminPermission(ctx.profile,v.adminAny))return false;return true}).map(([k,v])=>`<button class="nav-btn ${ctx.view===k?'active':''}" data-view="${k}"><span class="icon">${v.icon}</span><span>${v.label}</span></button>`).join("");nav.querySelectorAll("button").forEach(b=>b.onclick=()=>navigate(b.dataset.view))}
function updateChrome(){
  const p=ctx.profile,c=ctx.company;document.getElementById("company-name").textContent=c?.name||"TP-Personalmanagement";
  const logo=document.querySelector("#company-logo img");logo.src=c?.logoUrl||c?.logoDataUrl||"assets/tp-logo.png";
  document.getElementById("role-heading").textContent=roleHeading(p.role);document.getElementById("user-name").textContent=p.name||p.email||"Mitarbeiter";
  const displayName=p.name||p.email||"Mitarbeiter", displayRole=ROLE_LABELS[p.role]||p.role;
  document.getElementById("user-role").textContent=displayRole;document.getElementById("user-avatar").textContent=initials(p.name||p.email);
  document.getElementById("mobile-user-name").textContent=displayName;document.getElementById("mobile-user-role").textContent=displayRole;
}

document.getElementById("login-form").addEventListener("submit",async e=>{e.preventDefault();const msg=document.getElementById("login-message");msg.textContent="Anmeldung läuft …";try{await signInWithEmailAndPassword(auth,normalizeLogin(document.getElementById("login-identifier").value),document.getElementById("login-password").value);msg.textContent=""}catch(err){console.error(err);msg.textContent="";toast("Anmeldung nicht möglich. Bitte Zugangsdaten prüfen.","error")}});
document.getElementById("forgot-password-btn").onclick=async()=>{const raw=document.getElementById("login-identifier").value.trim();if(!raw){toast("Bitte zuerst die E-Mail-Adresse eintragen.");return}if(!raw.includes("@")){toast("Bei Benutzernamen erfolgt der Passwort-Reset derzeit über die Personalabteilung.");return}try{await sendPasswordResetEmail(auth,raw);toast("Passwort-Link wurde angefordert.")}catch(e){console.error(e);toast("Passwort-Link konnte nicht angefordert werden.")}};
function passwordIssue(value){
  const p=String(value||'');
  if(p.length<8)return 'Das Passwort muss mindestens 8 Zeichen lang sein.';
  if(!/[A-ZÄÖÜ]/.test(p))return 'Das Passwort muss mindestens einen Großbuchstaben enthalten.';
  if(!/[a-zäöüß]/.test(p))return 'Das Passwort muss mindestens einen Kleinbuchstaben enthalten.';
  if(!/[0-9]/.test(p))return 'Das Passwort muss mindestens eine Zahl enthalten.';
  if(!/[^A-Za-z0-9ÄÖÜäöüß]/.test(p))return 'Das Passwort muss mindestens ein Sonderzeichen enthalten.';
  return '';
}
async function requestNewPassword({mandatory=false}={}){
  const intro=mandatory?'Sie verwenden noch Ihr Startpasswort. Bitte legen Sie jetzt ein persönliches Passwort fest.\n\nMindestens 8 Zeichen, Groß- und Kleinbuchstaben, mindestens 1 Zahl und 1 Sonderzeichen.':'Neues Passwort eingeben.\n\nMindestens 8 Zeichen, Groß- und Kleinbuchstaben, mindestens 1 Zahl und 1 Sonderzeichen.';
  const p=await inputDialog(intro,'',{title:mandatory?'Eigenes Passwort festlegen':'Passwort ändern',password:true,placeholder:'Neues Passwort'});
  if(p===null)return null;
  const issue=passwordIssue(p);if(issue){toast(issue,'error');return requestNewPassword({mandatory});}
  const confirm=await inputDialog('Neues Passwort zur Sicherheit erneut eingeben:','',{title:'Passwort bestätigen',password:true,placeholder:'Passwort wiederholen'});
  if(confirm===null)return null;
  if(String(confirm)!==String(p)){toast('Die beiden Passwörter stimmen nicht überein.','error');return requestNewPassword({mandatory});}
  return String(p);
}
async function changeOwnPassword(){const p=await requestNewPassword();if(!p)return;try{await updatePassword(auth.currentUser,p);await updateDoc(doc(db,'users',ctx.user.uid),{mustChangePassword:false,passwordChangedAt:serverTimestamp()});ctx.profile.mustChangePassword=false;toast('Passwort geändert.')}catch(e){console.error(e);toast('Passwort konnte nicht geändert werden. Ggf. erneut anmelden.','error')}}
async function enforceInitialPasswordChange(){
  if(ctx.profile?.mustChangePassword===false)return true;
  const p=await requestNewPassword({mandatory:true});
  if(!p){toast('Die Anmeldung wurde beendet. Vor der Nutzung muss ein persönliches Passwort festgelegt werden.','error');await signOut(auth);return false;}
  try{
    await updatePassword(auth.currentUser,p);
    await updateDoc(doc(db,'users',ctx.user.uid),{mustChangePassword:false,passwordChangedAt:serverTimestamp()});
    ctx.profile.mustChangePassword=false;
    toast('Persönliches Passwort gespeichert. Willkommen im TP-Personalmanagement.');
    return true;
  }catch(e){
    console.error(e);toast('Das Passwort konnte nicht gespeichert werden. Bitte erneut anmelden und noch einmal versuchen.','error');await signOut(auth);return false;
  }
}
const HELP_URLS={
  admin:"anleitungen/TP-Personalmanagement_Anleitung_Admin.pdf",
  supervisor:"anleitungen/TP-Personalmanagement_Anleitung_Vorgesetzte.pdf",
  employee:"anleitungen/TP-Personalmanagement_Anleitung_Mitarbeiter.pdf"
};
function openRoleHelp(){
  const role=ctx.profile?.role||"employee";
  const url=HELP_URLS[role]||HELP_URLS.employee;
  window.open(url,"_blank","noopener");
}
function closeMobileUserMenu(){const menu=document.getElementById("mobile-user-menu"),chip=document.getElementById("user-chip");menu.classList.remove("open");menu.setAttribute("aria-hidden","true");chip.setAttribute("aria-expanded","false")}
function toggleMobileUserMenu(){if(!window.matchMedia("(max-width: 700px)").matches)return;const menu=document.getElementById("mobile-user-menu"),chip=document.getElementById("user-chip"),open=!menu.classList.contains("open");menu.classList.toggle("open",open);menu.setAttribute("aria-hidden",String(!open));chip.setAttribute("aria-expanded",String(open))}

document.getElementById("logout-btn").onclick=()=>signOut(auth);
document.getElementById("change-password-btn").onclick=changeOwnPassword;
document.getElementById("help-btn").onclick=openRoleHelp;
document.getElementById("mobile-help-btn").onclick=()=>{closeMobileUserMenu();openRoleHelp()};
document.getElementById("mobile-change-password-btn").onclick=()=>{closeMobileUserMenu();changeOwnPassword()};
document.getElementById("mobile-logout-btn").onclick=()=>{closeMobileUserMenu();signOut(auth)};
document.getElementById("user-chip").onclick=e=>{e.stopPropagation();toggleMobileUserMenu()};
document.getElementById("user-chip").onkeydown=e=>{if((e.key==="Enter"||e.key===" ")&&window.matchMedia("(max-width: 700px)").matches){e.preventDefault();toggleMobileUserMenu()}else if(e.key==="Escape")closeMobileUserMenu()};
document.addEventListener("click",e=>{if(!e.target.closest(".user-menu-wrap"))closeMobileUserMenu()});
window.addEventListener("resize",()=>{if(!window.matchMedia("(max-width: 700px)").matches)closeMobileUserMenu()});

onAuthStateChanged(auth,async user=>{ctx.user=user;if(!user){ctx.profile=null;closeMobileUserMenu();loginPage.classList.remove("hidden");shell.classList.add("hidden");return}try{const loadingId=beginPortalLoading("Benutzerprofil wird geladen …");try{await refreshProfile()}finally{endPortalLoading(loadingId)}if(!await enforceInitialPasswordChange())return;updateChrome();renderNav();loginPage.classList.add("hidden");shell.classList.remove("hidden");ctx.view="dashboard";await navigate("dashboard")}catch(e){console.error(e);await signOut(auth);toast(e.message,"error")}});
