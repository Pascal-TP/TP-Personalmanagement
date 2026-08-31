export const ADMIN_PERMISSION_DEFS = [
  {key:'employeesView',label:'Mitarbeiterkartei öffnen',group:'Mitarbeiter'},
  {key:'employeesCreate',label:'Mitarbeiter anlegen',group:'Mitarbeiter'},
  {key:'employeesEdit',label:'Mitarbeiter bearbeiten',group:'Mitarbeiter'},
  {key:'employeesDelete',label:'Mitarbeiter entfernen',group:'Mitarbeiter'},
  {key:'terminalManage',label:'NFC-Terminals & Transponder verwalten',group:'Mitarbeiter'},
  {key:'permissionsManage',label:'Rollen & Admin-Berechtigungen verwalten',group:'Mitarbeiter'},
  {key:'personnelDocuments',label:'Personalakten-Dokumente verwalten',group:'Mitarbeiter'},
  {key:'timeAdjustment',label:'Stundenkorrektur buchen',group:'Zeiterfassung & Urlaub'},
  {key:'timeApprove',label:'Anträge zur Zeiterfassung freigeben',group:'Zeiterfassung & Urlaub'},
  {key:'vacationApprove',label:'Urlaubsanträge freigeben',group:'Zeiterfassung & Urlaub'},
  {key:'absenceManage',label:'Abwesenheiten / Krankheit buchen',group:'Zeiterfassung & Urlaub'},
  {key:'hoursExport',label:'PDS-Stundenexport / Auswertungen',group:'Zeiterfassung & Urlaub'},
  {key:'trainingOverview',label:'Schulungsübersichten / Nachweise',group:'Schulungen'},
  {key:'trainingManage',label:'Schulungen verwalten',group:'Schulungen'},
  {key:'payrollManage',label:'Lohn-/Gehaltsabrechnungen verwalten',group:'Personalverwaltung'},
  {key:'personalDataChanges',label:'Stammdaten-Änderungsanträge bearbeiten',group:'Personalverwaltung'},
  {key:'employeeNotes',label:'Mitarbeiternotizen einsehen / verwalten',group:'Personalverwaltung'},
  {key:'masterData',label:'Stammdaten ändern',group:'Personalverwaltung'},
  {key:'companyManage',label:'Firmen verwalten',group:'Personalverwaltung'},
  {key:'newsManage',label:'News & Hinweise verwalten',group:'Personalverwaltung'},
  {key:'historyView',label:'Mitarbeiter-Historie anzeigen',group:'Personalverwaltung'},
  {key:'backup',label:'Datensicherung / Wiederherstellung',group:'System'},
  {key:'applicantPortal',label:'Bewerbungsportal öffnen',group:'System'}
];

export const DEFAULT_ADMIN_PERMISSIONS = Object.freeze(
  Object.fromEntries(ADMIN_PERMISSION_DEFS.map(x=>[x.key,true]))
);

export function normalizedAdminPermissions(profile){
  if(profile?.role!=='admin') return {};
  const stored=profile?.adminPermissions;
  // Migration: Admins aus Versionen vor V1.8 behalten zunächst alle Rechte.
  if(!stored || typeof stored!=='object') return {...DEFAULT_ADMIN_PERMISSIONS};
  return Object.fromEntries(ADMIN_PERMISSION_DEFS.map(x=>[x.key,stored[x.key]!==false]));
}

export function hasAdminPermission(profile,key){
  return profile?.role==='admin' && normalizedAdminPermissions(profile)[key]===true;
}

export function hasAnyAdminPermission(profile,keys=[]){
  return keys.some(k=>hasAdminPermission(profile,k));
}
