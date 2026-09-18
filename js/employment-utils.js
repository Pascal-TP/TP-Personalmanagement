function dateKey(value){return /^\d{4}-\d{2}-\d{2}$/.test(String(value||''))?String(value):''}
function todayKey(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
export function normalizedVacationEntitlements(user={}){
  const raw=Array.isArray(user.vacationEntitlements)?user.vacationEntitlements:[];
  const rows=raw.map((x,i)=>({days:Number(x?.days),validFrom:dateKey(x?.validFrom),order:i})).filter(x=>Number.isFinite(x.days)&&x.days>=0);
  if(!rows.length)rows.push({days:Number(user.vacationDays||0),validFrom:'',order:0});
  return rows.slice(0,4);
}
export function vacationEntitlementOn(user={},date=todayKey()){
  const key=dateKey(date)||todayKey(), rows=normalizedVacationEntitlements(user);
  let active=rows[0]?.days||0;
  rows.forEach((x,i)=>{if(i===0||!x.validFrom||x.validFrom<=key)active=x.days});
  return Number(active)||0;
}
export function normalizedPositionHistory(user={}){
  const raw=Array.isArray(user.positionHistory)?user.positionHistory:[];
  const rows=raw.map((x,i)=>({position:String(x?.position||'').trim(),validFrom:dateKey(x?.validFrom),order:i})).filter(x=>x.position);
  if(!rows.length&&String(user.position||'').trim())rows.push({position:String(user.position).trim(),validFrom:dateKey(user.startDate),order:0});
  return rows.slice(0,4);
}
export function positionOn(user={},date=todayKey()){
  const key=dateKey(date)||todayKey(),rows=normalizedPositionHistory(user);let active='';
  rows.forEach((x,i)=>{if(i===0||!x.validFrom||x.validFrom<=key)active=x.position});
  return active||String(user.position||'').trim();
}
