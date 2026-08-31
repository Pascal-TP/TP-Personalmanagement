export const TRAINING_LEGACY_YEAR=2026;

function arrayStrings(value){return Array.isArray(value)?value.map(String):[]}
function dateKey(value){
  if(!value)return '';
  if(typeof value==='string')return /^\d{4}-\d{2}-\d{2}$/.test(value)?value:'';
  const d=value?.toDate?value.toDate():new Date(value);
  if(Number.isNaN(d.getTime()))return '';
  const p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}
function timestampYear(value){
  if(!value)return null;
  const d=value?.toDate?value.toDate():new Date(value);
  return Number.isNaN(d.getTime())?null:d.getFullYear();
}
export function trainingProgressYear(entry){
  const explicit=Number(entry?.year);
  if(Number.isInteger(explicit)&&explicit>=2000&&explicit<=2200)return explicit;
  return timestampYear(entry?.completedAt)||timestampYear(entry?.proofUploadedAt)||timestampYear(entry?.openedAt)||TRAINING_LEGACY_YEAR;
}
export function progressForTrainingYear(entries,year){
  return (Array.isArray(entries)?entries:[]).filter(entry=>trainingProgressYear(entry)===Number(year));
}
export function trainingProgressDocId(userId,trainingId,year,entries=[]){
  const y=Number(year);
  if(y===TRAINING_LEGACY_YEAR){
    const legacy=(Array.isArray(entries)?entries:[]).find(entry=>entry.trainingId===trainingId&&entry.id===`${userId}_${trainingId}`);
    if(legacy)return legacy.id;
  }
  return `${userId}_${y}_${trainingId}`;
}
export function normalizeTrainingAssignments(user){
  const raw=Array.isArray(user?.trainingAssignments)?user.trainingAssignments:[];
  const normalized=raw.map(entry=>({
    validFrom:dateKey(entry?.validFrom),
    bereiche:arrayStrings(entry?.bereiche),
    extraTrainings:arrayStrings(entry?.extraTrainings)
  })).filter(entry=>entry.validFrom).sort((a,b)=>a.validFrom.localeCompare(b.validFrom));
  if(normalized.length)return normalized;
  return [{
    validFrom:dateKey(user?.startDate)||'1900-01-01',
    bereiche:arrayStrings(user?.bereiche),
    extraTrainings:arrayStrings(user?.extraTrainings)
  }];
}
export function assignmentForDate(user,key){
  const wanted=dateKey(key)||String(key||'');
  const snapshots=normalizeTrainingAssignments(user);
  let result=null;
  for(const entry of snapshots){if(entry.validFrom<=wanted)result=entry;else break}
  return result;
}
export function assignmentUnionForYear(user,year,now=new Date()){
  const y=Number(year),yearStart=`${y}-01-01`,yearEnd=`${y}-12-31`;
  const currentYear=now.getFullYear();
  const today=dateKey(now);
  const effectiveEnd=y===currentYear&&today<yearEnd?today:yearEnd;
  const employedFrom=dateKey(user?.startDate)||'1900-01-01';
  const employedTo=dateKey(user?.endDate)||'9999-12-31';
  const start=employedFrom>yearStart?employedFrom:yearStart;
  const end=employedTo<effectiveEnd?employedTo:effectiveEnd;
  if(start>end)return {bereiche:[],extraTrainings:[],hasAssignment:false};
  const snapshots=normalizeTrainingAssignments(user);
  const areas=new Set(),extras=new Set();
  let hasAssignment=false;
  snapshots.forEach((entry,index)=>{
    const next=snapshots[index+1]?.validFrom||'9999-12-31';
    const intervalStart=entry.validFrom;
    const nextDate=new Date(`${next}T12:00:00`);
    nextDate.setDate(nextDate.getDate()-1);
    const p=n=>String(n).padStart(2,'0');
    const intervalEnd=next==='9999-12-31'?'9999-12-31':`${nextDate.getFullYear()}-${p(nextDate.getMonth()+1)}-${p(nextDate.getDate())}`;
    if(intervalStart<=end&&intervalEnd>=start){
      hasAssignment=true;
      entry.bereiche.forEach(x=>areas.add(String(x)));
      entry.extraTrainings.forEach(x=>extras.add(String(x)));
    }
  });
  return {bereiche:[...areas],extraTrainings:[...extras],hasAssignment};
}
export function visibleTrainingsForYear(trainings,user,year,now=new Date()){
  const assignment=assignmentUnionForYear(user,year,now);
  if(!assignment.hasAssignment)return [];
  return (Array.isArray(trainings)?trainings:[]).filter(t=>{
    if(t?.active===false)return false;
    const areas=arrayStrings(t?.bereiche);
    return areas.length===0||areas.some(a=>assignment.bereiche.includes(a))||assignment.extraTrainings.includes(String(t?.id||''));
  });
}
export function sameTrainingSelection(aAreas,aExtra,bAreas,bExtra){
  const norm=v=>[...new Set(arrayStrings(v))].sort();
  return JSON.stringify(norm(aAreas))===JSON.stringify(norm(bAreas))&&JSON.stringify(norm(aExtra))===JSON.stringify(norm(bExtra));
}
export function upsertTrainingAssignmentHistory(user,newAreas,newExtra,validFrom){
  const date=dateKey(validFrom)||String(validFrom||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('Bitte ein gültiges Datum für die Schulungszuordnung angeben.');
  let snapshots=Array.isArray(user?.trainingAssignments)&&user.trainingAssignments.length
    ? normalizeTrainingAssignments(user)
    : [{validFrom:dateKey(user?.startDate)||'1900-01-01',bereiche:arrayStrings(user?.bereiche),extraTrainings:arrayStrings(user?.extraTrainings)}];
  snapshots=snapshots.filter(entry=>entry.validFrom!==date);
  snapshots.push({validFrom:date,bereiche:arrayStrings(newAreas),extraTrainings:arrayStrings(newExtra)});
  snapshots.sort((a,b)=>a.validFrom.localeCompare(b.validFrom));
  return snapshots;
}
