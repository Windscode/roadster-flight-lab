import {buildStreetDisplay} from './street-display.js';
// Low, occupied-looking public frontages give the original open Crosstown
// forecourts a street edge. These are sealed exterior pavilions, not rooms.
// Every raised mass/column/roof is returned as the same visual/physics solid;
// the 18 m authored street and inherited 28 m crossing roads stay untouched.
export const CITY_STREET_EDGE_VERSION='crosstown-public-frontage-3.17-1';
export const CITY_SHOWCASE_VERSION='shallow-public-frontage-3.18-1';
export function createCrosstownStreetEdge(){
  const solids=[],finishes=[],signs=[],lights=[],frontages=[];
  const add=(id,size,position,material,kind='continuity-structure')=>solids.push({id:'street-edge-'+id,kind,size,position,rotation:[0,0,0],data:{material,project:CITY_STREET_EDGE_VERSION}});
  const face=(id,size,position,material)=>finishes.push({id:'street-edge-'+id,size,position,material,rotation:[0,0,0],renderDetail:'facade'});
  const rows=[
    {id:'north-reading',from:-70,to:-24,z:-117,depth:4,height:4.35,side:-1,wall:'civic-plaster',trim:'weathered-steel',title:'CENTRAL READING / 中央阅览廊',warm:false},
    {id:'north-daily',from:24,to:70,z:-117,depth:4,height:3.90,side:-1,wall:'sandstone-plaster',trim:'weathered-steel',title:'DAILY / 城市补给',warm:true},
    {id:'south-workshop',from:-66,to:-25,z:-148.8,depth:5,height:4.10,side:1,wall:'oxide-plaster',trim:'weathered-steel',title:'OPEN WORKSHOP / 街坊工坊',warm:true},
    {id:'south-gallery',from:24,to:57,z:-148.8,depth:5,height:4.65,side:1,wall:'civic-plaster',trim:'weathered-steel',title:'CROSSTOWN / 横街展廊',warm:false},
  ];
  for(const row of rows){
    const {id,from,to,z,depth,height:h,side}=row,w=to-from,x=(from+to)/2,front=z+side*depth/2;
    // Solid backing is 32 cm behind the optical face. Shop recesses never
    // imply a drive-through opening in this explicitly non-enterable shell.
    add(id+'-core',[w,h,depth-.64],[x,h/2,z-side*.32],row.wall);
    add(id+'-foot',[w,.22,depth],[x,.11,z],row.trim);
    add(id+'-roof',[w+.32,.25,depth+.38],[x,h+.125,z],row.trim);
    const count=Math.round(w/6.6),bay=w/count;
    for(let i=0;i<=count;i++)add(id+'-pier-'+i,[.36,h-.35,.70],[from+i*bay,h/2,front-.12*side],row.wall);
    for(let i=0;i<count;i++){
      const u=from+(i+.5)*bay,windowY=(h-.80)/2+.43,windowH=h-1.28;
      const recipe=id.includes('reading')?'books':id.includes('daily')?'daily':id.includes('workshop')?'workshop':'gallery';
      const materials={displayBack:row.warm?'display-warm-backing':'display-cool-backing',displayWood:'display-timber',displayGoods:'display-goods',displayFrame:row.trim,shopGlass:'display-glazing',lamp:'display-lamp'};
      let piece=0;
      buildStreetDisplay((kind,size,along,y,out,tint,_variance,_geometry,_tile,_rotation,light)=>{
        // Front's outward local direction differs on the two street sides.
        finishes.push({id:'street-edge-'+id+'-showcase-'+i+'-'+piece++,size,
          position:[along,y,front+side*out],material:materials[kind],tint,rotation:[0,side>0?0:Math.PI,0],renderDetail:'facade',showcase:true,showcaseLight:light?{position:[light.position[0],light.position[1],front+side*light.position[2]],span:[light.span[0],0,0],cool:light.cool}:null});
      },{x:u,width:bay-.55,height:windowH,sill:windowY-windowH/2,recipe,variant:i,door:i%3===1,trim:0x43595b});
      face(id+'-transom-'+i,[bay-.55,.075,.10],[u,h-1.0,front-side*.12],row.trim);
      const canopyDepth=side<0?.85:1.45,canopyZ=front+side*canopyDepth*.38;
      add(id+'-awning-'+i,[bay-.10,.13,canopyDepth],[u,h-.62,canopyZ],i%2===0?'aged-copper':row.trim);
      for(const edge of [-1,1])add(id+'-brace-'+i+'-'+edge,[.075,.55,.28],[u+edge*bay*.40,h-.84,front+side*.10],row.trim);
      // The lens is directly below its canopy. Both the online finite spot
      // and offline transport use this exact exterior source/target pair.
      // The 11 cm diffusing bar embeds 2 mm into its actual canopy. Its
      // equivalent point emitter clears both the solid and the bake's 45 mm
      // near-surface exclusion; this is a mounted source, not a moved light
      // with its visible housing left behind.
      const lampZ=front+side*.26,py=h-.738;
      lights.push({id:'street-edge-'+id+'-'+i,position:[u,py,lampZ],target:[u,.12,front+side*2.3],surfaceY:0,
        intensity:85,range:8.5,angle:1.02,penumbra:.56,color:row.warm?0xf2d3a5:0xbcd8df,practical:true,role:'door',lensSize:[1.6,.11,.12],mount:{sharedGeometryId:'street-edge-'+id+'-awning-'+i}});
    }
    const signX=from+w*.37,sy=h-.26,signZ=front+side*.18;
    signs.push({text:row.title,position:[signX,sy,signZ],width:Math.min(17,w*.62),height:.42,yaw:side>0?0:Math.PI,backed:true});
    // A narrow service datum links the bays without an emissive roof outline.
    face(id+'-datum',[w-.6,.11,.10],[x,h-.88,front+side*.12],'aged-copper');
    frontages.push({id,from,to,z,depthM:depth,heightM:h,front,side,uses:row.title,sealed:true,showcaseDepthM:.62,entranceEveryBays:3});
  }
  return {version:CITY_STREET_EDGE_VERSION,displayVersion:CITY_SHOWCASE_VERSION,solids,finishes,signs,lights,frontages,
    limits:'Four low public frontages on the original forecourts; no new tower parcels, rooms, crowds or traffic. All raised envelopes are shared with collision and light transport.'};
}
