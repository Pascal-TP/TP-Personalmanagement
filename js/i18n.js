import { LANGUAGES, TRANSLATIONS } from './translations.js';

const STORAGE_KEY='tpPreferredLanguage';
let current='de';
let observer=null;
let applying=false;
const listeners=new Set();
const textSources=new WeakMap();
const attrSources=new WeakMap();

export { LANGUAGES };
export function getLanguage(){return current}
export function getStoredLanguage(){const x=localStorage.getItem(STORAGE_KEY);return LANGUAGES[x]?x:null}
export function t(text,lang=current){if(text==null)return '';const value=String(text);return TRANSLATIONS[lang]?.[value]||value}

function sourceForText(node){
  const raw=node.nodeValue||'';
  let src=textSources.get(node);
  if(src==null){src=raw;textSources.set(node,src);return src}
  const expected=translateRaw(src,current);
  if(!applying&&raw!==expected){src=raw;textSources.set(node,src)}
  return src;
}
function translateRaw(raw,lang){
  const trimmed=String(raw).trim();
  if(!trimmed)return raw;
  const translated=t(trimmed,lang);
  return translated===trimmed?raw:String(raw).replace(trimmed,translated);
}
function translateTextNode(node){
  if(!node?.nodeValue||!node.parentElement)return;
  if(node.parentElement.closest('[data-i18n-skip],script,style,textarea'))return;
  const source=sourceForText(node);
  const target=translateRaw(source,current);
  if(node.nodeValue!==target)node.nodeValue=target;
}
function sourceAttrs(el){
  let map=attrSources.get(el);
  if(!map){map={};attrSources.set(el,map)}
  return map;
}
function translateElement(el){
  if(!(el instanceof Element)||el.closest('[data-i18n-skip]'))return;
  const sources=sourceAttrs(el);
  ['placeholder','title','aria-label'].forEach(attr=>{
    const now=el.getAttribute(attr);if(now==null)return;
    if(!(attr in sources))sources[attr]=now;
    else{
      const expected=t(sources[attr],current);
      if(!applying&&now!==expected)sources[attr]=now;
    }
    const nv=t(sources[attr],current);
    if(now!==nv)el.setAttribute(attr,nv);
  });
  for(const node of el.childNodes){if(node.nodeType===Node.TEXT_NODE)translateTextNode(node)}
}
export function translateDom(root=document.body){
  if(!root)return;
  applying=true;
  try{
    if(root.nodeType===Node.TEXT_NODE)translateTextNode(root);
    else if(root instanceof Element||root===document){
      if(root instanceof Element)translateElement(root);
      root.querySelectorAll?.('*').forEach(translateElement);
    }
  }finally{applying=false}
}
export function setLanguage(lang,{store=false,notify=true}={}){
  current=LANGUAGES[lang]?lang:'de';
  if(store)localStorage.setItem(STORAGE_KEY,current);
  document.documentElement.lang=current;
  document.querySelectorAll('[data-language-select]').forEach(x=>x.value=current);
  translateDom(document.body);
  if(notify)listeners.forEach(fn=>fn(current));
  return current;
}
export function clearStoredLanguage(){localStorage.removeItem(STORAGE_KEY)}
export function resolveLanguage(profile){return getStoredLanguage()||profile?.preferredLanguage||'de'}
export function onLanguageChange(fn){listeners.add(fn);return()=>listeners.delete(fn)}
export function startI18nObserver(){
  if(observer)return;
  observer=new MutationObserver(mutations=>{
    if(applying)return;
    for(const m of mutations){
      if(m.type==='characterData'){textSources.set(m.target,m.target.nodeValue||'');translateTextNode(m.target)}
      for(const n of m.addedNodes){if(n.nodeType===Node.TEXT_NODE){textSources.set(n,n.nodeValue||'');translateTextNode(n)}else if(n.nodeType===Node.ELEMENT_NODE)translateDom(n)}
    }
  });
  observer.observe(document.body,{subtree:true,childList:true,characterData:true});
}
