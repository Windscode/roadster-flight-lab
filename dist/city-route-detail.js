// Original reusable exterior kits for the retained Weave learning route.
// Coordinates are metres. Door recesses remain sealed, bridge trim is attached
// to the existing deck/wall envelopes, and none creates a new driveable bump.
export const ROUTE_DETAIL_VERSION='weave-service-and-bridge-3.19-1';

export function routeServiceBay(building,side,bay,count){
  return bay===Math.floor(count/2)&&(
    building.id==='market-front--1-1'&&side===1||
    building.id==='market-front-1-4'&&side===0);
}

export function buildRouteServicePortal(put,{x=0,width=4.5,shopH=4.4,trim=0x405457,base=0x66736b}){
  const h=Math.min(2.85,shopH-.90),bottom=.34,top=bottom+h;
  const doorW=Math.min(2.55,width*.62),doorX=x-(width-doorW)*.43;
  const cabinetW=Math.max(.55,width-doorW-.40),cabinetX=x+width/2-cabinetW/2-.08;
  const piece=(kind,size,px,y,out,tint=trim)=>put(kind,size,px,y,out,tint);
  // The rear is 58 cm behind the face. All four reveals have thickness and
  // return into it; unlike a flat black panel, an oblique view sees the sides.
  piece('displayBack',[width,h,.04],x,bottom+h/2,-.58,0x354b4b);
  for(const side of [-1,1]){
    piece('concrete',[.14,h,.66],x+side*(width/2-.07),bottom+h/2,-.23,base);
    piece('edges',[.035,h-.08,.085],x+side*(width/2-.16),bottom+h/2,.065,0x819393);
  }
  piece('metal',[width,.15,.67],x,top-.075,-.22,trim);
  piece('concrete',[width,.085,.67],x,bottom+.0425,-.22,base);
  // Folded, paired service leaves with independent panels and a real rebate.
  for(const side of [-1,1]){
    const cx=doorX+side*doorW*.25;
    piece('metal',[doorW/2-.025,h-.20,.052],cx,bottom+h/2,-.422,0x597673);
    for(const y of [bottom+.17,bottom+h-.17])piece('edges',[doorW/2-.09,.05,.09],cx,y,-.372,trim);
    for(const y of [bottom+.62,bottom+1.48])piece('metal',[doorW/2-.10,.035,.055],cx,y,-.365,0x718783);
    piece('edges',[.035,.28,.10],doorX+side*.13,1.06,-.335,0xc0baa5);
  }
  piece('edges',[.035,h-.19,.10],doorX,bottom+h/2,-.35,trim);
  piece('metal',[.10,h-.03,.55],doorX+doorW/2+.08,bottom+h/2,-.245,trim);
  // A recessed inspection window and six thick louvers belong to the service
  // bay rather than another full-height showroom. No room atlas is used.
  piece('displayBack',[cabinetW-.12,1.04,.035],cabinetX,bottom+.69,-.525,0x304445);
  piece('displayGoods',[cabinetW*.53,.22,.16],cabinetX,bottom+.42,-.41,0x8d876a);
  piece('displayFrame',[.055,.61,.055],cabinetX-cabinetW*.19,bottom+.76,-.44,0xa2ada1);
  piece('shopGlass',[cabinetW-.10,1.10,.014],cabinetX,bottom+.70,-.11,0xadc2bd);
  for(const side of [-1,1])piece('edges',[.06,1.14,.10],cabinetX+side*(cabinetW/2-.04),bottom+.70,-.075,trim);
  for(const y of [bottom+.13,bottom+1.27])piece('edges',[cabinetW,.06,.10],cabinetX,y,-.075,trim);
  piece('displayBack',[cabinetW-.06,.80,.035],cabinetX,top-.65,-.43,0x243a3b);
  for(let n=0;n<6;n++)piece('metal',[cabinetW-.10,.055,.18],cabinetX,top-.97+n*.12,-.29,0x657c77);
  // Capped returns and the flat threshold fit inside the existing recess.
  piece('edges',[width-.12,.045,.11],x,top-.18,.07,0x80928a);
  return{version:ROUTE_DETAIL_VERSION,widthM:width,depthM:.62,doorWidthM:doorW,handleHeightM:1.06,sealed:true};
}

export function createRouteBridgeDetails(){
  const items=[],anchors=[];
  const add=(id,size,position,material='steel',shadow=false)=>items.push({id:'route-detail-'+id,size,position,material,rotation:[0,0,0],shadow,renderDetail:'street'});
  for(const z of [-320,-172]){
    // The original deck is 22 x .38 x 4 at y=5.21. These folded edge skins
    // remain within its height, with a 6 mm outer finish and capped end faces.
    for(const side of [-1,1]){
      const edge=z+side*2.006;
      add('bridge-'+z+'-edge-'+side,[21.96,.28,.012],[-200,5.21,edge]);
      for(const y of [5.055,5.365])add('bridge-'+z+'-flange-'+side+'-'+y,[21.98,.04,.11],[-200,y,z+side*1.96]);
      for(const x of [-209.65,-208,-192,-190.35]){
        add('bridge-'+z+'-splice-'+side+'-'+x,[.28,.29,.025],[x,5.21,edge+side*.013],'weathered-steel');
        for(const dx of [-.08,.08])for(const y of [5.13,5.29])add('bridge-'+z+'-bolt-'+side+'-'+x+'-'+dx+'-'+y,[.037,.037,.035],[x+dx,y,edge+side*.038]);
      }
    }
    for(const side of [-1,1]){
      const wallX=-200+side*10;
      // A faced bearing seat attaches to the existing closed building at the
      // bridge end. It is a skin of that wall, with its cap meeting the deck.
      const x=wallX+side*.075;
      add('bridge-'+z+'-bearing-'+side,[.17,.57,3.48],[x,4.745,z],'weathered-steel');
      add('bridge-'+z+'-bearing-cap-'+side,[.19,.08,3.62],[x,4.99,z]);
      for(const dz of [-1.40,1.40])add('bridge-'+z+'-bearing-return-'+side+'-'+dz,[.19,.57,.10],[x,4.745,z+dz]);
      // The small load-path joints are on the existing upper-walkway end,
      // wholly above the street clearance and joined to the slab.
      for(const dz of [-1.5,1.5])add('bridge-'+z+'-walk-seat-'+side+'-'+dz,[1.64,.05,.34],[-200+side*8,5.075,z+dz]);
      anchors.push({bridgeZ:z,wallX,seat:[x,4.745,z],deckBottomY:5.02,finishOnly:true});
    }
  }
  return{version:ROUTE_DETAIL_VERSION,items,anchors,textureBytesAdded:0,
    limits:'Folded bridge edges, wall bearing finishes and capped connections on retained solids; no altered ground height, bridge clearance, new light or new room.'};
}
