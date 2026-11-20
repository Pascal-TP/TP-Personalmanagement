import { pauseRuleOn, requiredPauseMinutes, scheduledMinutesOn } from "./employment-utils.js";
import { employerGiftMinutes } from "./special-day-utils.js";

// V2.9.2 – gemeinsame Zeitberechnung.
// Echte Stempelzeiten bleiben unverändert; earliestStartTime begrenzt nur die anrechenbare Zeit.

export function timeToDate(value){
  if(!value)return null;
  if(value?.toDate)return value.toDate();
  const d=new Date(value);
  return Number.isNaN(d.getTime())?null:d;
}

const pad=v=>String(v).padStart(2,'0');
export function timeDateKey(date){return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`}

function combineLocal(dateKey,time){
  if(!dateKey||!time)return null;
  const d=new Date(`${dateKey}T${time}:00`);
  return Number.isNaN(d.getTime())?null:d;
}

export function timeRecordStart(record){
  const stamp=timeToDate(record?.startAt);
  if(stamp)return stamp;
  return record?.date&&record?.start?combineLocal(record.date,record.start):null;
}

export function timeRecordEnd(record){
  const stamp=timeToDate(record?.endAt);
  if(stamp)return stamp;
  return record?.date&&record?.end?combineLocal(record.date,record.end):null;
}

export function timeRecordDateKey(record){
  if(record?.recordType==='adjustment')return String(record.adjustmentDate||'');
  const start=timeRecordStart(record);
  return record?.date||(start?timeDateKey(start):'');
}

export function dailyPauseMinutes(totalGrossMinutes){
  return requiredPauseMinutes(totalGrossMinutes,'standard');
}

export function effectiveRecordStart(record,earliestStartTime=''){
  const actual=timeRecordStart(record);
  if(!actual||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(earliestStartTime||'')))return actual;
  const [h,m]=String(earliestStartTime).split(':').map(Number);
  const floor=new Date(actual.getFullYear(),actual.getMonth(),actual.getDate(),h,m,0,0);
  return actual<floor?floor:actual;
}

export function recordGrossMinutes(record,earliestStartTime='',{includeOpen=false,now=new Date()}={}){
  if(record?.recordType==='adjustment')return 0;
  const start=effectiveRecordStart(record,earliestStartTime);
  let end=timeRecordEnd(record);
  if(!end&&includeOpen&&timeRecordStart(record)&&record?.status!=='closed')end=now;
  if(!start||!end||end<=start)return 0;
  return Math.max(0,Math.round((end-start)/60000));
}

function recordSortValue(record){
  if(record?.recordType==='adjustment'){
    const c=timeToDate(record.createdAt);
    if(c)return c.getTime();
    const d=record.adjustmentDate?new Date(`${record.adjustmentDate}T23:59:59`):null;
    return d&&!Number.isNaN(d.getTime())?d.getTime():0;
  }
  return timeRecordStart(record)?.getTime()||0;
}

// Unterbrechungen außerhalb der Buchungen zählen nur bei Mitarbeitern ohne
// Projektzeiterfassung und nur dann, wenn der einzelne Zeitraum mindestens
// 15 Minuten umfasst. Überlappungen erzeugen keine künstlichen Pausenzeiten.
function qualifyingBreakMinutes(regular){
  let total=0,latestEnd=null;
  regular.forEach(item=>{
    if(latestEnd&&item.start>latestEnd){
      const gap=Math.max(0,Math.floor((item.start-latestEnd)/60000));
      if(gap>=15)total+=gap;
    }
    if(!latestEnd||item.end>latestEnd)latestEnd=item.end;
  });
  return total;
}

// Teilt den minutengenauen Tagesabzug auf die Buchungen auf.
// Projektzeiten verwenden das größte-Reste-Verfahren: erst Abrundung der
// exakten Anteile, anschließend deterministische Resteverteilung nach
// Nachkommaanteil und Dokument-ID. Dadurch bleibt die Summe exakt erhalten.
function allocatePauseMinutes(regular,dayPause,proportional=false){
  const allocation=new Map(),pause=Math.max(0,Math.round(Number(dayPause)||0));
  regular.forEach(item=>allocation.set(item.record.id,0));
  if(!pause||!regular.length)return allocation;

  if(proportional){
    const totalGross=regular.reduce((sum,item)=>sum+item.gross,0);
    if(!totalGross)return allocation;
    const shares=regular.map(item=>{
      const exact=pause*item.gross/totalGross,base=Math.min(item.gross,Math.floor(exact));
      allocation.set(item.record.id,base);
      return {item,remainder:exact-Math.floor(exact),key:String(item.record.id||'')};
    });
    let remaining=pause-[...allocation.values()].reduce((sum,value)=>sum+value,0);
    shares.sort((a,b)=>b.remainder-a.remainder||a.key.localeCompare(b.key));
    for(const share of shares){
      if(remaining<=0)break;
      const current=allocation.get(share.item.record.id)||0;
      if(current<share.item.gross){
        allocation.set(share.item.record.id,current+1);
        remaining--;
      }
    }
    return allocation;
  }

  // Bestehende Zuordnung möglichst erhalten: die späteste passende Buchung
  // trägt den vollständigen Abzug. Reicht keine allein aus, wird rückwärts
  // über mehrere Buchungen verteilt, ohne eine Buchung negativ zu machen.
  const fitting=regular.filter(item=>item.gross>=pause);
  const target=fitting[fitting.length-1]||null;
  if(target){
    allocation.set(target.record.id,pause);
    return allocation;
  }
  let remaining=pause;
  for(let index=regular.length-1;index>=0&&remaining>0;index--){
    const item=regular[index],portion=Math.min(remaining,item.gross);
    allocation.set(item.record.id,portion);
    remaining-=portion;
  }
  return allocation;
}

// Liefert pro Buchung Brutto, Pausenabzug, Netto und den kumulierten
// Tages-Iststand. Projektbuchungen erhalten einen proportionalen Pausenanteil.
export function calculateDailyTimeValues(records,profileOrEarliest='',{includeOpen=true,now=new Date()}={}){
  const profile=profileOrEarliest&&typeof profileOrEarliest==='object'?profileOrEarliest:null;
  const earliestStartTime=profile?String(profile.earliestStartTime||''):String(profileOrEarliest||'');
  const result=new Map();
  const groups=new Map();
  (records||[]).forEach(record=>{
    const key=timeRecordDateKey(record);
    if(!key)return;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(record);
  });

  for(const [dateKey,items] of groups.entries()){
    const regular=items.filter(r=>r.recordType!=='adjustment').map(r=>{
      const start=effectiveRecordStart(r,earliestStartTime);
      let end=timeRecordEnd(r);
      if(!end&&includeOpen&&timeRecordStart(r)&&r?.status!=='closed')end=now;
      return {record:r,gross:recordGrossMinutes(r,earliestStartTime,{includeOpen,now}),sort:recordSortValue(r),start,end};
    }).filter(x=>x.gross>0&&x.start&&x.end&&x.end>x.start).sort((a,b)=>a.sort-b.sort);
    const totalGross=regular.reduce((sum,x)=>sum+x.gross,0);
    const pauseRule=profile?pauseRuleOn(profile,dateKey):{model:'standard'};
    const requiredPause=requiredPauseMinutes(totalGross,pauseRule);
    const creditedBreak=profile&&profile.projectTimeTracking!==true?Math.min(requiredPause,qualifyingBreakMinutes(regular)):0;
    const dayPause=Math.max(0,requiredPause-creditedBreak);
    const pauseByRecord=allocatePauseMinutes(regular,dayPause,profile?.projectTimeTracking===true);

    regular.forEach(x=>{
      const pause=pauseByRecord.get(x.record.id)||0;
      result.set(x.record.id,{gross:x.gross,pause,net:Math.max(0,x.gross-pause),dayPause,totalGross,cumulative:0});
    });
    // Auch Buchungen ohne anrechenbare Minuten sollen in der Map vorhanden sein.
    items.filter(r=>r.recordType!=='adjustment'&&!result.has(r.id)).forEach(r=>result.set(r.id,{gross:0,pause:0,net:0,dayPause,totalGross,cumulative:0}));

    let cumulative=0;
    [...items].sort((a,b)=>recordSortValue(a)-recordSortValue(b)).forEach(r=>{
      if(r.recordType==='adjustment'){
        cumulative+=Math.round(Number(r.adjustmentMinutes)||0);
        result.set(r.id,{gross:0,pause:0,net:Math.round(Number(r.adjustmentMinutes)||0),dayPause,totalGross,cumulative});
      }else{
        const value=result.get(r.id)||{gross:0,pause:0,net:0,dayPause,totalGross};
        cumulative+=value.net;
        result.set(r.id,{...value,cumulative});
      }
    });
  }
  return result;
}

export function wasStartLimited(record,earliestStartTime=''){
  const actual=timeRecordStart(record),effective=effectiveRecordStart(record,earliestStartTime);
  return !!(actual&&effective&&effective.getTime()>actual.getTime());
}


function parseDateKey(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||'')))return null;
  const d=new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime())?null:d;
}

function dateRangeKeys(from,to){
  const a=parseDateKey(from),b=parseDateKey(to),out=[];
  if(!a||!b||a>b)return out;
  for(const d=new Date(a);d<=b;d.setDate(d.getDate()+1))out.push(timeDateKey(d));
  return out;
}

function coveredDateSet(items,{approvedOnly=false}={}){
  const set=new Set();
  (items||[]).forEach(item=>{
    if(item?.status==='withdrawn')return;
    if(approvedOnly&&item?.status!=='approved')return;
    dateRangeKeys(item?.from,item?.to).forEach(key=>set.add(key));
  });
  return set;
}

function coveredDateFractions(items,{approvedOnly=false}={}){
  const map=new Map();
  (items||[]).forEach(item=>{
    if(item?.status==='withdrawn')return;
    if(approvedOnly&&item?.status!=='approved')return;
    // Freizeitausgleich ist keine Sollzeitbefreiung: Das historisch gültige
    // Tagessoll bleibt bestehen und reduziert dadurch das Zeitkonto am Gleittag.
    if(approvedOnly&&item?.type==='Freizeitausgleich')return;
    const half=item?.from===item?.to&&['morning','afternoon'].includes(item?.dayPortion);
    dateRangeKeys(item?.from,item?.to).forEach(key=>map.set(key,Math.max(map.get(key)||0,half?0.5:1)));
  });
  return map;
}

// Gemeinsame Fachlogik für erreichte und zukünftige Gleittage. Pro Kalendertag
// wird höchstens ein genehmigter Freizeitausgleich berücksichtigt, auch wenn
// sich versehentlich mehrere Anträge überschneiden.
export function approvedFlexTimeDays(vacations=[],profile={}, {from='',to=''}={}){
  const byDate=new Map();
  (vacations||[]).filter(v=>v?.status==='approved'&&v?.type==='Freizeitausgleich').forEach(v=>{
    dateRangeKeys(v.from,v.to).forEach(key=>{
      if((from&&key<from)||(to&&key>to)||byDate.has(key))return;
      byDate.set(key,{date:key,minutes:scheduledMinutesOn(profile,key),requestId:String(v.id||'')});
    });
  });
  return [...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
}

export function flexTimeRequestMinutes(request={},profile={}){
  if(request?.type!=='Freizeitausgleich')return 0;
  return dateRangeKeys(request.from,request.to).reduce((sum,key)=>sum+scheduledMinutesOn(profile,key),0);
}

export function futureFlexTimeMinutes(vacations=[],profile={},today=new Date()){
  const todayKey=timeDateKey(today);
  return approvedFlexTimeDays(vacations,profile,{from:dateRangeKeys(todayKey,todayKey)[0]||todayKey})
    .filter(day=>day.date>todayKey).reduce((sum,day)=>sum+day.minutes,0);
}

export function reachedFlexTimeRecords(vacations=[],profile={},today=new Date()){
  const todayKey=timeDateKey(today);
  return approvedFlexTimeDays(vacations,profile,{to:todayKey}).map(day=>({
    id:`flex_time_${day.requestId||'request'}_${day.date}`,
    userId:profile?.id||'',recordType:'adjustment',virtualFlexTime:true,
    adjustmentDate:day.date,adjustmentMinutes:0,flexMinutes:day.minutes,
    status:'approved',source:'approved_flex_time'
  }));
}

function accountDateKey(value){
  if(value instanceof Date&&!Number.isNaN(value.getTime()))return timeDateKey(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value||''))?String(value):'';
}

function accountPeriod(items,profile,endKey=''){
  // Virtuelle Gleittagszeilen dokumentieren einen bereits erreichten Tag,
  // dürfen den Beginn des Arbeitszeitkontos aber nicht vor die erste echte
  // Zeit- oder Korrekturbuchung verschieben.
  const realKeys=items.filter(r=>!r?.virtualFlexTime).map(timeRecordDateKey).filter(Boolean).sort();
  if(!realKeys.length)return null;
  let firstKey=realKeys[0];
  const employmentStart=accountDateKey(profile?.startDate);
  if(employmentStart&&employmentStart>firstKey)firstKey=employmentStart;
  const allKeys=items.map(timeRecordDateKey).filter(Boolean).sort();
  let lastKey=endKey||allKeys[allKeys.length-1]||firstKey;
  const employmentEnd=accountDateKey(profile?.endDate);
  if(employmentEnd&&employmentEnd<lastKey)lastKey=employmentEnd;
  return firstKey<=lastKey?{firstKey,lastKey}:null;
}

function calculateTimeAccount(records,profile,vacations,absences,{includeOpen=true,now=new Date(),until=null,values=false,specialDaySettings=[]}={}){
  const result=new Map();
  const items=(records||[]).filter(r=>timeRecordDateKey(r)&&!r.cancelledAt&&!r.canceledAt);
  if(!items.length)return values?result:0;

  const dailyValues=calculateDailyTimeValues(items,profile,{includeOpen,now});
  const byDay=new Map();
  items.forEach(r=>{
    const key=timeRecordDateKey(r);
    if(!byDay.has(key))byDay.set(key,[]);
    byDay.get(key).push(r);
  });

  const itemKeys=items.map(timeRecordDateKey).filter(Boolean).sort();
  const requestedEnd=values
    ? itemKeys[itemKeys.length-1]||''
    : accountDateKey(until instanceof Date?until:now);
  const period=accountPeriod(items,profile,requestedEnd);
  if(!period)return values?result:0;

  const leaveFractions=coveredDateFractions(vacations,{approvedOnly:true});
  const absenceFractions=coveredDateFractions(absences);
  let balance=0;
  for(const key of dateRangeKeys(period.firstKey,period.lastKey)){
    const dailyTargetMinutes=scheduledMinutesOn(profile,key);
    const relief=Math.max(leaveFractions.get(key)||0,absenceFractions.get(key)||0);
    const gift=employerGiftMinutes(profile,key,specialDaySettings);
    const targetMinutes=dailyTargetMinutes>0?Math.max(0,Math.round(dailyTargetMinutes*(1-relief))-gift):0;
    balance-=targetMinutes;
    const dayItems=[...(byDay.get(key)||[])].sort((a,b)=>recordSortValue(a)-recordSortValue(b));
    for(const r of dayItems){
      balance+=Math.round(Number(dailyValues.get(r.id)?.net)||0);
      if(values)result.set(r.id,{balance,targetMinutes});
    }
  }
  return values?result:balance;
}

// V2.9.2.1 – laufendes Zeitguthaben / Minusstundenkonto.
// Das Konto startet mit dem ersten vorhandenen Zeit- oder Korrekturdatensatz und
// läuft danach minutengenau weiter. Pro Arbeitstag wird das Tagessoll einmal
// abgezogen; genehmigter Urlaub und gebuchte Abwesenheiten reduzieren das Soll
// des betreffenden Tages auf 0. Stundenkorrekturen wirken direkt auf das Konto.
export function calculateTimeAccountValues(records,profile={},vacations=[],absences=[],{includeOpen=true,now=new Date(),specialDaySettings=[]}={}){
  return calculateTimeAccount(records,profile,vacations,absences,{includeOpen,now,values:true,specialDaySettings});
}


// V2.11 – aktueller, minutengenauer Stand des Zeitkontos.
// Im Unterschied zur buchungsbezogenen Historie wird das Soll bis zum gewünschten
// Stichtag fortgeschrieben, auch wenn an einem Arbeitstag keine Buchung vorliegt.
export function calculateTimeAccountBalance(records,profile={},vacations=[],absences=[],{includeOpen=true,now=new Date(),until=null,specialDaySettings=[]}={}){
  return calculateTimeAccount(records,profile,vacations,absences,{includeOpen,now,until,values:false,specialDaySettings});
}
