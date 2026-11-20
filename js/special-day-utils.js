import { scheduledMinutesOn } from "./employment-utils.js";

function dateKey(value){return /^\d{4}-\d{2}-\d{2}$/.test(String(value||''))?String(value):''}
export function specialDaySettingFor(settings=[],profile={},date=''){
  const key=dateKey(date),year=Number(key.slice(0,4));if(!key||!year)return null;
  const row=(Array.isArray(settings)?settings:[settings]).find(x=>Number(x?.year)===year&&x?.active!==false);
  if(!row)return null;
  const companies=Array.isArray(row.companyIds)?row.companyIds.filter(Boolean):[];
  if(companies.length&&!companies.includes(profile?.companyId))return null;
  const day=key.slice(5),enabled=day==='12-24'?(row.dec24===true||row.december24===true):day==='12-31'?(row.dec31===true||row.december31===true):false;
  return enabled?row:null;
}
export function employerGiftMinutes(profile={},date='',settings=[]){
  if(!specialDaySettingFor(settings,profile,date))return 0;
  return Math.round(scheduledMinutesOn(profile,date)*0.5);
}
