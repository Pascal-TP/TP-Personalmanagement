// Kurzer, kontrollierter Sitzungscache für wiederholt geöffnete Ansichten.
// Schreibende Vorgänge aktualisieren oder verwerfen die betroffenen Einträge ausdrücklich.
const entries=new Map();
const DEFAULT_TTL=30000;

export async function cachedRead(key,loader,{ttl=DEFAULT_TTL}={}){
  const now=Date.now(),hit=entries.get(key);
  if(hit&&hit.expires>now)return hit.value;
  if(hit?.promise)return hit.promise;
  const promise=Promise.resolve().then(loader).then(value=>{
    entries.set(key,{value,expires:Date.now()+ttl});
    return value;
  }).catch(error=>{entries.delete(key);throw error});
  entries.set(key,{promise,expires:now+ttl});
  return promise;
}

export function updateCached(key,updater){
  const hit=entries.get(key);
  if(!hit||!Object.prototype.hasOwnProperty.call(hit,'value'))return;
  hit.value=updater(hit.value);
  hit.expires=Date.now()+DEFAULT_TTL;
}

export function invalidateCached(...prefixes){
  for(const key of entries.keys())if(prefixes.some(prefix=>key===prefix||key.startsWith(`${prefix}|`)))entries.delete(key);
}

export function clearReadCache(){entries.clear()}
