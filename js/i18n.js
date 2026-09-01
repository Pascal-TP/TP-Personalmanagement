import { LANGUAGES, TRANSLATIONS } from './translations.js';
import { SYSTEM_TEXTS } from './system-texts.js';

const STORAGE_KEY='tpPreferredLanguage';
const CACHE_PREFIX='tpI18nAutoCache:';
let current='de';
let observer=null;
let applying=false;
const listeners=new Set();
const textSources=new WeakMap();
const attrSources=new WeakMap();
const translators=new Map();
const translatorPromises=new Map();
const pending=new Map();
const autoCaches=new Map();

export { LANGUAGES };
export function getLanguage(){return current}
export function getStoredLanguage(){const x=localStorage.getItem(STORAGE_KEY);return LANGUAGES[x]?x:null}
export function t(text,lang=current){if(text==null)return '';const value=String(text);return TRANSLATIONS[lang]?.[value]||value}

function loadAutoCache(lang){
  if(autoCaches.has(lang))return autoCaches.get(lang);
  let data={};
  try{data=JSON.parse(localStorage.getItem(CACHE_PREFIX+lang)||'{}')||{}}catch{}
  autoCaches.set(lang,data);return data;
}
function saveAutoCache(lang){
  try{localStorage.setItem(CACHE_PREFIX+lang,JSON.stringify(loadAutoCache(lang)))}catch{}
}
function knownRendering(source,raw){
  if(raw===source)return true;
  for(const lang of Object.keys(LANGUAGES)){
    if(t(source,lang)===raw)return true;
    const cached=loadAutoCache(lang)[source];
    if(cached&&cached===raw)return true;
  }
  return false;
}
function sourceForText(node){
  const raw=node.nodeValue||'';
  let src=textSources.get(node);
  if(src==null){src=raw;textSources.set(node,src);return src}
  if(!applying&&!knownRendering(src,raw)){src=raw;textSources.set(node,src)}
  return src;
}
function translateRawSync(raw,lang){
  const trimmed=String(raw).trim();
  if(!trimmed)return raw;
  const manual=t(trimmed,lang);
  const translated=manual!==trimmed?manual:loadAutoCache(lang)[trimmed];
  return translated&&translated!==trimmed?String(raw).replace(trimmed,translated):raw;
}
function eligibleForAuto(source){
  const s=String(source||'').trim();
  return current!=='de' && s.length>1 && SYSTEM_TEXTS.has(s) && t(s,current)===s;
}
async function getTranslator(lang){
  if(lang==='de')return null;
  if(translators.has(lang))return translators.get(lang);
  if(translatorPromises.has(lang))return translatorPromises.get(lang);
  const promise=(async()=>{
    try{
      if(typeof globalThis.Translator==='undefined')return null;
      const options={sourceLanguage:'de',targetLanguage:lang};
      if(typeof globalThis.Translator.availability==='function'){
        const state=await globalThis.Translator.availability(options);
        if(state==='unavailable')return null;
      }
      const tr=await globalThis.Translator.create(options);
      translators.set(lang,tr);return tr;
    }catch(err){console.info('Browser-Übersetzung nicht verfügbar:',lang,err);return null}
  })();
  translatorPromises.set(lang,promise);
  const result=await promise;translatorPromises.delete(lang);return result;
}
function queueAutoTranslation(source){
  const s=String(source||'').trim(),lang=current;
  if(!eligibleForAuto(s)||loadAutoCache(lang)[s])return;
  const key=lang+'\n'+s;if(pending.has(key))return;
  const job=(async()=>{
    const tr=await getTranslator(lang);if(!tr)return;
    try{
      const result=String(await tr.translate(s)||'').trim();
      if(result&&result!==s){loadAutoCache(lang)[s]=result;saveAutoCache(lang);if(current===lang)translateDom(document.body)}
    }catch(err){console.info('Systemtext konnte nicht automatisch übersetzt werden:',s,err)}
  })().finally(()=>pending.delete(key));
  pending.set(key,job);
}
function translateTextNode(node){
  if(!node?.nodeValue||!node.parentElement)return;
  if(node.parentElement.closest('[data-i18n-skip],script,style,textarea,.rich-content,.rich-editor,.note-history-entry p'))return;
  const source=sourceForText(node);
  const target=translateRawSync(source,current);
  if(node.nodeValue!==target)node.nodeValue=target;
  const trimmed=String(source).trim();
  if(target===source&&eligibleForAuto(trimmed))queueAutoTranslation(trimmed);
}
function sourceAttrs(el){let map=attrSources.get(el);if(!map){map={};attrSources.set(el,map)}return map}
function attrKnownRendering(source,raw){return knownRendering(source,raw)}
function translateElement(el){
  if(!(el instanceof Element)||el.closest('[data-i18n-skip]'))return;
  const sources=sourceAttrs(el);
  ['placeholder','title','aria-label'].forEach(attr=>{
    const now=el.getAttribute(attr);if(now==null)return;
    if(!(attr in sources))sources[attr]=now;
    else if(!applying&&!attrKnownRendering(sources[attr],now))sources[attr]=now;
    const nv=translateRawSync(sources[attr],current);if(now!==nv)el.setAttribute(attr,nv);
    const src=String(sources[attr]).trim();if(nv===sources[attr]&&eligibleForAuto(src))queueAutoTranslation(src);
  });
  for(const node of el.childNodes)if(node.nodeType===Node.TEXT_NODE)translateTextNode(node);
}
export function translateDom(root=document.body){
  if(!root)return;applying=true;
  try{
    if(root.nodeType===Node.TEXT_NODE)translateTextNode(root);
    else if(root instanceof Element||root===document){if(root instanceof Element)translateElement(root);root.querySelectorAll?.('*').forEach(translateElement)}
  }finally{applying=false}
}
export function setLanguage(lang,{store=false,notify=true}={}){
  current=LANGUAGES[lang]?lang:'de';if(store)localStorage.setItem(STORAGE_KEY,current);
  document.documentElement.lang=current;document.querySelectorAll('[data-language-select]').forEach(x=>x.value=current);
  translateDom(document.body);if(notify)listeners.forEach(fn=>fn(current));return current;
}
export function clearStoredLanguage(){localStorage.removeItem(STORAGE_KEY)}
export function resolveLanguage(profile){return getStoredLanguage()||profile?.preferredLanguage||'de'}
export function onLanguageChange(fn){listeners.add(fn);return()=>listeners.delete(fn)}
export function startI18nObserver(){
  if(observer)return;
  observer=new MutationObserver(mutations=>{
    if(applying)return;
    for(const m of mutations){
      if(m.type==='characterData'){
        const old=textSources.get(m.target),now=m.target.nodeValue||'';
        if(old==null||!knownRendering(old,now))textSources.set(m.target,now);
        translateTextNode(m.target);
      }
      for(const n of m.addedNodes){if(n.nodeType===Node.TEXT_NODE){textSources.set(n,n.nodeValue||'');translateTextNode(n)}else if(n.nodeType===Node.ELEMENT_NODE)translateDom(n)}
    }
  });
  observer.observe(document.body,{subtree:true,childList:true,characterData:true});
}
