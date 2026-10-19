// Presentation-only locale. Physical states, protocols and stored data never
// pass through this module. Source strings remain the canonical Chinese UI.
export const LANGUAGE_STORAGE_KEY='roadster-language';
const translations=new Map(),dynamicPatterns=[],listeners=new Set(),missing=new Set();
const normalise=value=>String(value).replace(/\s+/g,' ').trim();
const hasHan=value=>/[\u3400-\u9fff]/u.test(value);
let language='zh';
try{if(globalThis.localStorage?.getItem(LANGUAGE_STORAGE_KEY)==='en')language='en';}catch{}

export function getLanguage(){return language;}
export function registerTranslations(entries={},patterns=[]){
  for(const [source,english]of Object.entries(entries)){
    if(typeof english!=='string')throw new TypeError('Translation must be a string');
    translations.set(normalise(source),english);
  }
  for(const [pattern,replacement]of patterns){
    if(!(pattern instanceof RegExp)||pattern.global||pattern.sticky)throw new TypeError('Use non-global translation patterns');
    dynamicPatterns.push([pattern,replacement]);
  }
}
export function t(value){
  if(value===null||value===undefined)return '';
  const source=String(value);if(language==='zh'||!hasHan(source))return source;
  const text=normalise(source),direct=translations.get(text);
  if(direct!==undefined)return source.match(/^\s*/)[0]+direct+source.match(/\s*$/)[0];
  for(const [pattern,replacement]of dynamicPatterns)if(pattern.test(text))return text.replace(pattern,replacement);
  // Independent UI rows and dot-separated telemetry keep their boundaries.
  if(/\n|\s+·\s+/.test(source)){const parts=source.split(/(\r?\n|\s+·\s+)/);if(parts.length>1){const rendered=parts.map((part,i)=>i%2?part:t(part)).join('');if(rendered!==source)return rendered;}}
  // Preserve unknown/user-supplied strings; never manufacture an English
  // label or alter a stored experiment name. QA can inspect the missing set.
  if(missing.size<2000)missing.add(text);return source;
}
export function onLanguageChange(listener){listeners.add(listener);return()=>listeners.delete(listener);}
export function setLanguage(value,{persist=true}={}){
  if(value!=='zh'&&value!=='en')throw new RangeError('Unsupported language');
  const changed=value!==language;language=value;
  if(persist)try{globalThis.localStorage?.setItem(LANGUAGE_STORAGE_KEY,value);}catch{}
  if(globalThis.document){document.documentElement.lang=value==='zh'?'zh-CN':'en';document.documentElement.dataset.language=value;}
  if(changed){missing.clear();for(const listener of [...listeners])listener(value);}
  for(const controller of observers)controller.refresh();
  return language;
}
export function getTranslationDiagnostics(){return{language,entries:translations.size,patterns:dynamicPatterns.length,missing:[...missing]};}
export function resetTranslationDiagnostics(){missing.clear();}

const observers=new Set(),sourceText=new WeakMap(),sourceAttributes=new WeakMap();
const skip='script,style,pre,code,textarea,input,[data-no-i18n],[translate="no"]';
const skipAttributes='script,style,pre,code,[data-no-i18n],[translate="no"]';
const attributes=['title','aria-label','aria-description','placeholder','alt','label'];
function ignored(node){return!!(node.nodeType===1?node:node.parentElement)?.closest?.(skip);}
function translateText(node){
  if(ignored(node))return;const current=node.nodeValue;
  if(!current?.trim())return;
  const previous=sourceText.get(node);
  const source=previous&&current===previous.rendered?previous.source:current;
  if(!hasHan(source))return;
  const rendered=t(source);sourceText.set(node,{source,rendered});
  if(current!==rendered)node.nodeValue=rendered;
}
function translateAttributes(element){
  if(element.closest?.(skipAttributes))return;
  let values=sourceAttributes.get(element);if(!values){values=new Map();sourceAttributes.set(element,values);}
  for(const key of attributes){
    const current=element.getAttribute(key);if(current===null)continue;
    const previous=values.get(key),source=previous&&current===previous.rendered?previous.source:current;
    if(!hasHan(source))continue;
    const rendered=t(source);values.set(key,{source,rendered});if(current!==rendered)element.setAttribute(key,rendered);
  }
}
export function localizeTree(root=globalThis.document?.body){
  if(!root)return;if(root.nodeType===3){translateText(root);return;}
  if(root.nodeType===1){translateAttributes(root);if(ignored(root))return;}
  const doc=root.ownerDocument||root;
  if(!doc.createTreeWalker)return;
  // Numeric constants keep this usable in a JSDOM realm without borrowing
  // another realm's Node/NodeFilter constructors.
  const walk=doc.createTreeWalker(root,1|4);let node;
  while((node=walk.nextNode())){if(node.nodeType===3)translateText(node);else translateAttributes(node);}
}
export function observeTranslations(root=globalThis.document?.body){
  if(!root)return()=>{};
  const doc=root.ownerDocument,Observer=doc.defaultView?.MutationObserver;
  if(!Observer){localizeTree(root);return()=>{};}
  let scheduled=false,disposed=false;const pending=new Set();
  const flush=()=>{scheduled=false;if(disposed)return;observer.disconnect();for(const node of pending)if(node.isConnected)localizeTree(node);pending.clear();observer.observe(root,options);};
  const options={subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:attributes};
  const observer=new Observer(changes=>{
    for(const change of changes){
      if(change.type==='childList')for(const node of change.addedNodes)pending.add(node);
      else pending.add(change.target);
    }
    if(!scheduled&&pending.size){scheduled=true;queueMicrotask(flush);}
  });
  const controller={refresh(){observer.disconnect();localizeTree(root);observer.observe(root,options);}};
  observers.add(controller);controller.refresh();
  return()=>{disposed=true;observer.disconnect();pending.clear();observers.delete(controller);};
}

export function bindLanguageSelectors(root=globalThis.document){
  if(!root)return()=>{};
  const sync=()=>{for(const select of root.querySelectorAll('[data-language-select]'))select.value=language;};
  const change=event=>{if(event.target?.matches?.('[data-language-select]'))setLanguage(event.target.value);};
  root.addEventListener('change',change);const off=onLanguageChange(sync);sync();setLanguage(language,{persist:false});
  return()=>{root.removeEventListener('change',change);off();};
}
