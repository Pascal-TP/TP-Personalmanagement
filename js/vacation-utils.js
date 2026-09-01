function iso(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function workdays(from,to,user,limitFrom=null,limitTo=null){
  if(!from||!to)return 0; let a=new Date(`${from}T12:00:00`),b=new Date(`${to}T12:00:00`);
  if(Number.isNaN(a.getTime())||Number.isNaN(b.getTime()))return 0;
  if(limitFrom){const x=new Date(`${limitFrom}T12:00:00`);if(a<x)a=x} if(limitTo){const x=new Date(`${limitTo}T12:00:00`);if(b>x)b=x}
  if(b<a)return 0; const allowed=new Set((user?.workDays?.length?user.workDays:['1','2','3','4','5']).map(String)); let n=0;
  for(const d=new Date(a);d<=b;d.setDate(d.getDate()+1))if(allowed.has(String(d.getDay())))n++; return n;
}
function settingFor(settings,userId,year){return settings.find(x=>x.userId===userId&&Number(x.year)===Number(year))||null}
function approvedVacationDays(vacations,user,year,until=null){
  const y1=`${year}-01-01`,y2=until||`${year}-12-31`;
  return vacations.filter(v=>v.userId===user.id&&v.status==='approved'&&String(v.type||'Urlaub')==='Urlaub')
    .reduce((s,v)=>s+workdays(v.from,v.to,user,y1,y2),0);
}
export function vacationYearBalance(user,vacations,settings,year,{asOf=new Date(),depth=0}={}){
  year=Number(year); const entitlement=Number(user?.vacationDays||0); const setting=settingFor(settings,user.id,year);
  let carryover=0;
  if(year>=2026){
    if(setting&&setting.carryoverDays!==undefined&&setting.carryoverDays!==null&&setting.carryoverDays!=='') carryover=Math.max(0,Number(setting.carryoverDays)||0);
    else if(depth<15){ const prev=vacationYearBalance(user,vacations,settings,year-1,{asOf:new Date(year-1,11,31,12),depth:depth+1}); carryover=Math.max(0,prev.currentRemaining); }
  }
  const defaultExpiry=`${year}-03-31`; const extension=setting?.extensionUntil&&setting?.extensionReason?setting.extensionUntil:'';
  const expiry=extension&&extension>defaultExpiry?extension:defaultExpiry;
  const usedToExpiry=Math.min(carryover,approvedVacationDays(vacations,user,year,expiry));
  const totalApproved=approvedVacationDays(vacations,user,year);
  const currentUsed=Math.max(0,totalApproved-usedToExpiry); const currentRemaining=entitlement-currentUsed;
  const today=asOf instanceof Date?iso(asOf):String(asOf); const carryoverOpen=Math.max(0,carryover-usedToExpiry);
  const carryoverRemaining=today<=expiry?carryoverOpen:0; const expired=today>expiry?carryoverOpen:0;
  return {year,entitlement,carryover,expiry,extensionUntil:extension,extensionReason:setting?.extensionReason||'',carryoverUsed:usedToExpiry,carryoverRemaining,expired,currentUsed,currentRemaining,totalApproved,totalRemaining:currentRemaining+carryoverRemaining,setting};
}
export function vacationCarryoverDocId(userId,year){return `${userId}_${year}`}
