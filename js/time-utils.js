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
  const gross=Math.max(0,Math.round(Number(totalGrossMinutes)||0));
  return gross>540?45:gross>360?30:0;
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

// Liefert pro Buchung Brutto, Tagespause, Netto und den kumulierten Tages-Iststand.
// Die Tagespause wird vollständig genau einer Buchung zugeordnet, in die sie zeitlich passt.
// Damit erscheinen in der Oberfläche nur 30 bzw. 45 Minuten statt anteiliger Kleinstpausen.
export function calculateDailyTimeValues(records,earliestStartTime='',{includeOpen=true,now=new Date()}={}){
  const result=new Map();
  const groups=new Map();
  (records||[]).forEach(record=>{
    const key=timeRecordDateKey(record);
    if(!key)return;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(record);
  });

  for(const items of groups.values()){
    const regular=items.filter(r=>r.recordType!=='adjustment').map(r=>({
      record:r,
      gross:recordGrossMinutes(r,earliestStartTime,{includeOpen,now}),
      sort:recordSortValue(r)
    })).filter(x=>x.gross>0).sort((a,b)=>a.sort-b.sort);
    const totalGross=regular.reduce((sum,x)=>sum+x.gross,0);
    const dayPause=dailyPauseMinutes(totalGross);

    let pauseTarget=null;
    if(dayPause>0&&regular.length){
      // Bevorzugt die späteste Buchung, in die die vollständige Pause hineinpasst.
      const fitting=regular.filter(x=>x.gross>=dayPause);
      pauseTarget=(fitting.length?fitting[fitting.length-1]:[...regular].sort((a,b)=>b.gross-a.gross)[0])||null;
    }

    regular.forEach(x=>{
      const pause=pauseTarget?.record?.id===x.record.id?Math.min(dayPause,x.gross):0;
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
