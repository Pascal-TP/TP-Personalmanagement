function dateKey(value){return /^\d{4}-\d{2}-\d{2}$/.test(String(value||''))?String(value):''}
function todayKey(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
const DEFAULT_WORK_DAYS=['1','2','3','4','5'];
function normalizedWorkDays(value){const source=Array.isArray(value)&&value.length?value:DEFAULT_WORK_DAYS;return [...new Set(source.map(String).filter(x=>['0','1','2','3','4','5','6'].includes(x)))];}
function normalizedDailyMinutes(value={}){const out={};for(const day of ['0','1','2','3','4','5','6'])out[day]=Math.max(0,Math.round(Number(value?.[day])||0));return out;}
export function normalizedWorkScheduleHistory(user={}){
  const raw=Array.isArray(user.workScheduleHistory)?user.workScheduleHistory:[];
  const rows=raw.map((row,index)=>{
    const model=row?.model==='individual'?'individual':'uniform';
    const dailyMinutes=normalizedDailyMinutes(row?.dailyMinutes);
    const selected=model==='individual'?Object.keys(dailyMinutes).filter(day=>dailyMinutes[day]>0):normalizedWorkDays(row?.workDays);
    const weeklyMinutes=model==='individual'?Object.values(dailyMinutes).reduce((sum,n)=>sum+n,0):Math.max(0,Math.round((Number(row?.weeklyHours)||0)*60));
    return {model,validFrom:dateKey(row?.validFrom),weeklyHours:weeklyMinutes/60,workDays:selected,dailyMinutes,changeType:row?.changeType==='correction'?'correction':'change',note:String(row?.note||'').trim(),order:index};
  }).filter(row=>row.weeklyHours>=0&&row.workDays.length);
  if(!rows.length){
    const weeklyHours=Number(user.weeklyHours??40);
    rows.push({model:'uniform',validFrom:'',weeklyHours:Number.isFinite(weeklyHours)?weeklyHours:40,workDays:normalizedWorkDays(user.workDays),dailyMinutes:normalizedDailyMinutes(),changeType:'change',note:'',order:0,legacy:true});
  }
  return rows.sort((a,b)=>(a.validFrom||'').localeCompare(b.validFrom||'')||a.order-b.order).slice(0,20);
}
export function workScheduleOn(user={},date=todayKey()){
  const key=dateKey(date)||todayKey(),rows=normalizedWorkScheduleHistory(user);let active=rows[0];
  rows.forEach((row,index)=>{if(index===0||!row.validFrom||row.validFrom<=key)active=row;});
  return active;
}
export function scheduledMinutesOn(user={},date=todayKey()){
  const key=dateKey(date)||todayKey(),day=new Date(`${key}T12:00:00`);if(Number.isNaN(day.getTime()))return 0;
  const schedule=workScheduleOn(user,key),weekday=String(day.getDay());
  if(schedule.model==='individual')return Math.max(0,Math.round(Number(schedule.dailyMinutes?.[weekday])||0));
  if(!schedule.workDays.includes(weekday))return 0;
  return Math.round((Number(schedule.weeklyHours)||0)*60/Math.max(1,schedule.workDays.length));
}
export function workDaysOn(user={},date=todayKey()){const schedule=workScheduleOn(user,date);return schedule.model==='individual'?Object.keys(schedule.dailyMinutes).filter(day=>schedule.dailyMinutes[day]>0):[...schedule.workDays];}
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
