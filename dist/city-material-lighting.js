import {injectReceiverPlaneShadows} from './receiver-plane-shadows.js';

// Uniform zero does not retire an active sampler at link time. Compile only
// the transport used in this weather, while retaining the same fields, AO,
// local lights, material textures and specular terms for the selected mode.
export function cityLightingVariant({quality='balanced',night=false,isStatic=false}={}){
  const contactAO=quality!=='balanced';
  return Object.freeze({quality,night:!!night,isStatic:!!isStatic,contactAO,
    daylightGI:!night,nightBounce:!!night,nightDirect:!!night&&!!isStatic,
    localProbeSun:!night&&quality!=='balanced',
    key:'city-lighting-3.13|'+quality+'|'+(night?'night-atlas':'day-sh')+'|'+(isStatic?'static':'dynamic')+'|ao-'+Number(contactAO)});
}

export function injectCityMaterialLighting(shader,{variant,indirect,nightIndirect,nightDirect,probeSun}){
  if(variant.daylightGI)indirect.inject(shader,{contactAO:variant.contactAO});
  else if(variant.contactAO)indirect.injectContactAO(shader);
  if(variant.nightBounce)nightIndirect.inject(shader);
  if(variant.localProbeSun)probeSun.inject(shader);
  if(variant.nightDirect)nightDirect.inject(shader);
  injectReceiverPlaneShadows(shader);
}
