/**
 * Original, metre-scale urban architecture kit. Visual study: Dan Hargreaves'
 * Kabuki environment portfolio and Kacper Niepokolczycki's Kabuki breakdown.
 * No game images, logos or models are used as textures. The caller owns roads,
 * collision boxes, terrain and lighting. Buildings are conservative solid
 * collision volumes: the visible shop recesses do not imply enterable rooms.
 *
 * buildUrbanArchitecture(THREE, root, buildings) -> {group,stats,lightAnchors,dispose}
 * Building: {id,x,z,w,d,height,style,accent,seed,tier,hero,baseY?}.
 */
import {buildingMassing,buildingStoreys} from '../../dist/city-data.js';
import {buildingExtras,CITY_STREETS} from '../../dist/city-plan.js';
import {architectureDetailLevel,createCityVisibility} from '../../dist/city-render-budget.js';
import {createCityExteriorMaterials} from '../../dist/city-exterior-materials.js';
import {streetFrontageDesign,buildStreetGroundOrder,buildStreetStoreyOrder} from '../../dist/city-frontage-design.js';

// The offline bounce-light baker imports this same palette. These are authored
// sRGB material tints, not measurements of a real district or extracted assets.
export const URBAN_MATERIAL_PALETTE=Object.freeze([
  {wall:0x909b9d,trim:0x34454c,paint:0x496c76,glass:0x233e4b},
  {wall:0xb3a594,trim:0x60544c,paint:0x966149,glass:0x2c4149},
  {wall:0x8c999c,trim:0x314a52,paint:0x376a76,glass:0x243e50},
  {wall:0xa89e94,trim:0x464d53,paint:0x927455,glass:0x304149},
  {wall:0x919997,trim:0x3d4b50,paint:0x5b6f74,glass:0x293d4a},
].map(p=>Object.freeze(p)));

// One shared street plan chooses which facade actually addresses a road.
// No separate art-only road width or invented building parcel is introduced.
export function routeFacingFacade(b,side){
  if((b.baseY||0)!==0||b.z> -95||b.z< -480||b.x< -320||b.x>210)return null;
  const yaw=side*Math.PI/2,n=[Math.sin(yaw),Math.cos(yaw)],face=[b.x+n[0]*b.w/2,b.z+n[1]*b.d/2];
  let best=null;
  for(const street of CITY_STREETS.filter(s=>['weave-main','canal-link','crosstown-link','foundry-main'].includes(s.id))){
    const a=street.points[0],c=street.points[1],dx=c[0]-a[0],dz=c[2]-a[2],u=Math.max(0,Math.min(1,((face[0]-a[0])*dx+(face[1]-a[2])*dz)/(dx*dx+dz*dz))),v=[a[0]+dx*u-face[0],a[2]+dz*u-face[1]],distance=Math.hypot(...v);
    if(distance>75||distance<1|| (v[0]*n[0]+v[1]*n[1])/distance<.70)continue;
    if(!best||distance<best.distance)best={street:street.id,distance,family:street.id==='weave-main'?'market':street.id==='canal-link'?'canal':street.id==='foundry-main'?'industrial':'civic'};
  }
  return best;
}

// General streets keep their own low-rise entrance rhythms as well. This
// applies only to the ground storey; it does not promote every distant tower
// to the expensive curated upper-facade representation.
export function backgroundGroundFrontage(building,side){
  return building.id.startsWith('block-')&&(building.baseY||0)===0?{family:'downtown',side}:null;
}

export function buildUrbanArchitecture(THREE,root,buildings) {
  const group=new THREE.Group();group.name='Urban architecture / street-facing civic, residential and working facades';root.add(group);
  const lightAnchors=[],batches=new Map(),geometries=[],materials=[],textures=[],visibility=createCityVisibility(THREE),surfaces=createCityExteriorMaterials(THREE);
  const stats={buildings:0,heroBuildings:0,shopfronts:0,recessedWindows:0,balconies:0,mechanicalUnits:0,
    instances:0,drawBatches:0,triangles:0,textureCount:0,sectorSizeM:160,sectorCount:0,lightAnchors:0,massingTiers:0,setbackTerraces:0,structuralBraces:0,rotatedTowers:0,industrialHalls:0,sawtoothRoofs:0,civicBuildings:0,entrancePortals:0,continuousPlinths:0,shutterPanels:0,curatedWeaveFrontages:0,routeFacingFrontages:0,facadePortals:0,backlitWindowPanels:0,serviceBays:0,interiorAtlases:0,surfaces:surfaces.stats,renderBudget:visibility.stats};
  const transform=new THREE.Object3D(),colourCache=new Map(),white=new THREE.Color(0xffffff);
  const unitBox=new THREE.BoxGeometry(1,1,1),unitPlane=new THREE.PlaneGeometry(1,1),
    unitCylinder=new THREE.CylinderGeometry(.5,.5,1,12),unitCircle=new THREE.CircleGeometry(.5,16);
  const sourceGeometries={box:unitBox,plane:unitPlane,cylinder:unitCylinder,circle:unitCircle};
  geometries.push(...Object.values(sourceGeometries));
  const randFor=seed=>{let n=Math.floor((Number(seed)||.137)*4294967295)>>>0;return()=>{n=(1664525*n+1013904223)>>>0;return n/4294967296;};};
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  function colour(value){if(value?.isColor)return value;if(!colourCache.has(value))colourCache.set(value,new THREE.Color(value));return colourCache.get(value);}

  // Original exterior typography. Shop windows remain reflective facade
  // surfaces; no interior picture or room geometry is generated.
  function canvasTexture(size,paint){
    if(typeof document==='undefined')return null;
    const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
    const context=canvas.getContext('2d');if(!context)return null;paint(context,size);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;texture.anisotropy=4;
    textures.push(texture);return texture;
  }
  const signNames=[['青禾食堂','QINGHE / KITCHEN'],['栖泊旅舍','QIBO / ROOMS'],['南岸電機','SOUTH BANK / ELECTRIC'],['九街茶室','NINTH STREET / TEA'],
    ['巡游音像','ROAM / SOUND'],['晨光洗衣','DAWN / LAUNDRY'],['港灣書店','HARBOR / BOOKS'],['合力維修','UNION / REPAIR'],
    ['慢線工作室','SLOW LINE / STUDIO'],['銀杏藥房','GINKGO / PHARMACY'],['街角小館','CORNER / DINER'],['時差便利','OFFSET / DAILY'],
    ['海風理髮','SEABREEZE / BARBER'],['新町公寓','NEW TOWN / RESIDENCE'],['四季花房','FOUR SEASONS / FLORA'],['環流服務','LOOP / SERVICES']];
  const signColours=['#d0bfa0','#a9bcb5','#bcc0b5','#c6a393'];
  const signAtlas=canvasTexture(1024,(ctx,size)=>{
    const rng=randFor(.418);ctx.fillStyle='#1d2323';ctx.fillRect(0,0,size,size);
    for(let i=0;i<16;i++){
      const x=(i%4)*256,y=Math.floor(i/4)*256;ctx.save();ctx.translate(x,y);
      // Paint in the physical sign's aspect ratio, then pack into a square
      // atlas tile. This prevents wide shop signs from squashing the type.
      const vertical=i>=12,W=vertical?200:1000,H=vertical?760:160;
      ctx.scale(256/W,256/H);
      ctx.fillStyle=['#26332f','#2d3c40','#593a2d','#364044'][i%4];ctx.fillRect(2,2,W-4,H-4);
      ctx.fillStyle=signColours[i%4];ctx.fillRect(8,8,W-16,3);ctx.fillRect(8,H-10,W-16,2);
      ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#e5dac0';
      if(vertical){
        const text=['栖泊旅舍','青禾食堂','南岸電機','環流音像'][i-12];ctx.font='bold 114px sans-serif';
        [...text].forEach((character,k)=>ctx.fillText(character,W/2,115+k*160,156));
        ctx.font='22px monospace';ctx.fillText('OPEN / 24',W/2,724,176);
      }else{
        ctx.font='bold 75px sans-serif';ctx.fillText(signNames[i][0],555,65,760);
        ctx.font='22px sans-serif';ctx.fillText(signNames[i][1],555,126,760);
        ctx.textAlign='left';ctx.font='14px monospace';ctx.fillText(`NO. ${String(i+1).padStart(2,'0')}`,18,141);
        ctx.fillStyle='#ddd0ac';ctx.beginPath();ctx.arc(75,65,34,0,Math.PI*2);ctx.fill();
        ctx.fillStyle='#1e2426';ctx.fillRect(56,59,38,12);
      }
      for(let k=0;k<210;k++){
        ctx.globalAlpha=.025+rng()*.12;ctx.fillStyle=rng()>.5?'#f1e4cc':'#020705';
        ctx.fillRect(4+rng()*(W-8),4+rng()*(H-8),1+rng()*W*.04,.6+rng()*H*.007);
      }
      ctx.restore();
    }
  });

  function material(name,options={}){
    const m=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.75,metalness:0,...options});m.name='Urban / '+name;materials.push(m);return m;
  }
  const mat={
    concrete:material('aged mineral plaster',{roughness:.92}),
    darkConcrete:material('recessed concrete',{roughness:.96}),
    ceramic:material('painted enamel and tile',{roughness:.59,metalness:.08}),
    metal:material('weathered steel',{roughness:.7,metalness:.58}),
    edges:material('anodised frame',{roughness:.37,metalness:.74}),
    glass:material('sealed exterior glazing',{roughness:.16,metalness:0,envMapIntensity:1.12}),
    displayGlass:material('dim sealed street display glazing',{roughness:.25,metalness:0,emissive:0xe2c7a0,emissiveIntensity:.055,envMapIntensity:.8}),
    litGlass:material('diffused exterior window pane',{roughness:.20,metalness:0,emissive:0xffd3a0,emissiveIntensity:.21,envMapIntensity:1.0}),
    shutter:material('rolled metal shutter',{roughness:.54,metalness:.72}),
    signs:material('original painted sign atlas',{map:signAtlas,emissiveMap:signAtlas,emissive:signAtlas?0xffffff:0x000000,emissiveIntensity:.18,roughness:.6,metalness:.12}),
    lamp:material('small practical light',{color:0xffdcb1,emissive:0xffc994,emissiveIntensity:2.1,roughness:.35}),
    accent:material('restrained signage accent',{emissive:0xffffff,emissiveIntensity:1.3,roughness:.4,metalness:.15}),
  };
  mat.litGlass.userData.windowBacklight=true;
  mat.displayGlass.userData.windowBacklight=true;
  mat.accent.onBeforeCompile=shader=>{
    shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
      #if defined(USE_COLOR) || defined(USE_INSTANCING_COLOR)
        totalEmissiveRadiance*=vColor.rgb;
      #endif`);
  };
  mat.accent.customProgramCacheKey=()=> 'urban-practical-instance-colour-v1';
  for(const [key,kind]of Object.entries({concrete:'concrete',darkConcrete:'concrete',ceramic:'enamel',metal:'metal',edges:'frame',glass:'glass',displayGlass:'glass',litGlass:'glass',shutter:'shutter'}))surfaces.attach(mat[key],kind);
  // One atlas material per sector, with per-instance UV rects, rather than one
  // draw call for every sign or one material for every illuminated window.
  for(const m of [mat.signs])if(m.map){
    m.onBeforeCompile=shader=>{
      shader.vertexShader='attribute vec4 urbanUvRect;\nvarying vec4 vUrbanUvRect;\nvarying vec2 vUrbanBaseUv;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nvUrbanUvRect=urbanUvRect;vUrbanBaseUv=uv;');
      shader.fragmentShader='varying vec4 vUrbanUvRect;\nvarying vec2 vUrbanBaseUv;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#ifdef USE_MAP
        vec2 urbanAtlasUv=vUrbanUvRect.xy+vUrbanBaseUv*vUrbanUvRect.zw;
        diffuseColor*=texture2D(map,urbanAtlasUv);
        #endif`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>',`#ifdef USE_EMISSIVEMAP
        totalEmissiveRadiance*=texture2D(emissiveMap,vUrbanUvRect.xy+vUrbanBaseUv*vUrbanUvRect.zw).rgb;
        #endif`);
    };m.customProgramCacheKey=()=>`urban-original-atlas-v1-${m.name}`;
  }
  const palette=URBAN_MATERIAL_PALETTE;
  const accentColours=[0x78c4bd,0xd3a074,0xb7b597,0xb08e9d];
  let sector='';
  function add(kind,geometry,size,position,rotation=[0,0,0],tint=white,variation=1,tile=-1,levelOverride=null){
    if(size.some(n=>!Number.isFinite(n)||n<=0))return;
    // Mineral returns and tile trim share the 160 m facade-sector grid even
    // when their visibility is detail-limited. Material keys remain separate;
    // this avoids a new sparse batch for every small street-facing return.
    const level=levelOverride||(kind==='shutter'||kind==='litGlass'||kind==='displayGlass'?'facade':architectureDetailLevel(kind,geometry,size)),cellSize=level==='detail'&&kind!=='concrete'&&kind!=='ceramic'?80:160,cell=Math.floor(position[0]/cellSize)+','+Math.floor(position[2]/cellSize);
    const key=cell+'|'+kind+'|'+geometry+'|'+level;
    let batch=batches.get(key);if(!batch){batch={sector:cell,kind,geometry,level,instances:[]};batches.set(key,batch);}
    transform.position.set(...position);transform.rotation.set(...rotation,'YXZ');transform.scale.set(...size);transform.updateMatrix();
    const c=colour(tint);batch.instances.push({matrix:transform.matrix.toArray(),colour:[c.r*variation,c.g*variation,c.b*variation],tile});stats.instances++;
  }
  const box=(kind,size,p,r,c,v,t)=>add(kind,'box',size,p,r,c,v,t);
  function atlasRect(tile){const i=((tile%16)+16)%16,margin=3/1024;return[(i%4)/4+margin,1-(Math.floor(i/4)+1)/4+margin,.25-2*margin,.25-2*margin];}

  for(const building of buildings){
    const b={baseY:0,...building};
    if(![b.x,b.z,b.w,b.d,b.height].every(Number.isFinite)||b.w<4||b.d<4||b.height<5)continue;
    stats.buildings++;const hero=!!b.hero,detail=hero?2:Math.max(Math.abs(b.x),Math.abs(b.z))<385?1:0;
    if(hero)stats.heroBuildings++;
    const weaveStreet=b.id.startsWith('market-front-'),weaveBand=b.z<-340?'arrival':b.z<-290?'market':b.z<-235?'exchange':'junction';
    const rng=randFor(b.seed),p=b.archetype==='civic'?{wall:0xc3c1ad,trim:0x5e6764,paint:0x8f7959,glass:0x3e555a}:palette[Math.abs(b.style||0)%palette.length],accent=accentColours[Math.abs(b.accent||0)%4];
    sector=`${Math.floor((b.x+600)/300)},${Math.floor((b.z+600)/300)}`;
    const plasterShade=.91+rng()*.15,{shopH,floorCount,floorH}=buildingStoreys(b),massing=buildingMassing(b);
    stats.massingTiers+=massing.length;if(massing.some(v=>v.yaw!==0))stats.rotatedTowers++;
    let frame={x:0,z:0,yaw:0};
    const worldPoint=(x,y,z)=>[b.x+frame.x+Math.cos(frame.yaw)*x+Math.sin(frame.yaw)*z,b.baseY+y,b.z+frame.z-Math.sin(frame.yaw)*x+Math.cos(frame.yaw)*z];
    const localBox=(kind,size,x,y,z,tint=p.wall,variation=1,rot=[0,0,0])=>box(kind,size,worldPoint(x,y,z),[rot[0],frame.yaw+rot[1],rot[2]],tint,variation);
    function face(localYaw,w,d){
      const yaw=localYaw+frame.yaw,c=Math.cos(yaw),s=Math.sin(yaw),span=Math.abs(Math.cos(localYaw))>.5?w:d,depth=(Math.abs(Math.cos(localYaw))>.5?d:w)/2-.50;
      const point=(along,y,out)=>[b.x+frame.x+c*along+s*(depth+out),b.baseY+y,b.z+frame.z-s*along+c*(depth+out)];
      const put=(kind,size,along,y,out,tint=p.wall,variance=1,geometry='box',tile=-1,rotation=[0,0,0])=>add(kind,geometry,size,point(along,y,out),[rotation[0],yaw+rotation[1],rotation[2]],tint,variance,tile);
      const putDetail=(kind,size,along,y,out,tint=p.wall,variance=1)=>add(kind,'box',size,point(along,y,out),[0,yaw,0],tint,variance,-1,'detail');
      return {span,point,put,putDetail};
    }
    function brace(f,a,c,width=.30){
      const aa=new THREE.Vector3(...f.point(...a)),bb=new THREE.Vector3(...f.point(...c)),delta=bb.clone().sub(aa);
      const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.clone().normalize()),e=new THREE.Euler().setFromQuaternion(q,'YXZ');
      add('metal','box',[width,delta.length(),width],aa.add(bb).multiplyScalar(.5).toArray(),[e.x,e.y,e.z],p.trim,.88);stats.structuralBraces++;
    }
    if(b.archetype==='foundry'){
      stats.industrialHalls++;
      // Long low halls have deep portal frames and clerestory roof pitches,
      // not the apartment grid used by the residential street wall.
      localBox('darkConcrete',[b.w-1.3,b.height,b.d-1.3],0,b.height/2,0,0x465655,.84);
      localBox('concrete',[b.w,.45,b.d],0,.225,0,0x7a8076,.96);
      for(let side=0;side<4;side++){
        const f=face(side*Math.PI/2,b.w,b.d),count=Math.max(3,Math.round(f.span/7.4)),bay=f.span/count;
        f.put('concrete',[f.span,.55,.65],0,b.height-.27,.02,0x7c8980,.92);
        f.put('ceramic',[f.span,3.6,.25],0,2.25,-.05,0x566e6d,.94);
        for(let j=0;j<=count;j++)f.put('metal',[.40,b.height-.5,.48],-f.span/2+j*bay,b.height/2+.2,.08,0x394d4e,.9);
        for(let j=0;j<count;j++){
          const along=-f.span/2+(j+.5)*bay;
          f.put('glass',[bay-.55,3.0,.12],along,b.height-2.3,-.16,0x48656b,.92);
          f.put('edges',[.065,3.0,.11],along,b.height-2.3,-.075,0x98a7a0,.85);
          f.put('metal',[bay-.50,.35,.20],along,5.1,.02,0x936b4d,.93);
          if((side===1||side===3)&&j===Math.floor(count/2)){
            stats.shopfronts++;
            f.put('darkConcrete',[bay-.45,4.5,.14],along,2.55,.12,0x25383a,1);
            f.put('shutter',[bay-.48,4.0,.10],along,2.25,.22,0x5a7070,.94);stats.shutterPanels++;
            f.put('ceramic',[bay+.12,.55,.22],along,5.27,.20,0xb68b5b,.96);
            f.put('signs',[Math.min(4.0,bay-.8),.58,1],along,6.05,.25,0xffffff,.95,'plane',7);
          }
        }
      }
      for(const g of buildingExtras(b)){
        add(g.data.part==='clerestory'?'glass':'metal','box',g.size,g.position,g.rotation,g.data.part==='clerestory'?0x67878b:0x7f8c85,.95);
        if(g.data.part==='sawtooth-roof')stats.sawtoothRoofs++;
      }
      // A few roof extractors belong to the working hall, not every window.
      for(const z of [-b.d*.28,b.d*.28])add('metal','cylinder',[1.4,1.9,1.4],[b.x,b.baseY+b.height+3.1,b.z+z],[0,0,0],0x9a8a70,.9);
      continue;
    }
    if(b.archetype==='civic')stats.civicBuildings++;
    // A deep core, never an opaque front box under a painted-on window grid.
    // Real frame/pier geometry bounds each dark opening in front of this core.
    localBox('darkConcrete',[b.w-2.8,shopH,b.d-2.8],0,shopH/2,0,p.trim,.67);
    localBox('concrete',[b.w-.06,.22,b.d-.06],0,.20,0,p.wall,.75);
    for(let side=0;side<4;side++){
      const frontage=routeFacingFacade(b,side)||backgroundGroundFrontage(b,side),f=face(side*Math.PI/2,b.w,b.d),weaveFront=weaveStreet&&side===(b.x<-200?1:3),count=Math.max(1,Math.floor((f.span-.8)/(weaveFront?(weaveBand==='arrival'?8.0:6.4):b.archetype==='civic'?10.5:hero?5.3:8.8))),bay=(f.span-.8)/count;
      if(frontage){
        stats.routeFacingFrontages++;
        if(weaveFront)stats.curatedWeaveFrontages++;
        buildStreetGroundOrder(f,streetFrontageDesign(b,frontage),{shopH,side,building:b,stats,lights:lightAnchors});
        continue;
      }
      // Ground-floor frames are thick enough to cast real street-level shadows.
      f.put('concrete',[f.span-.04,.6,.78],0,shopH-.30,-.02,p.wall,plasterShade);
      // A continuous grounded base and deep first-storey reveals organize the
      // street wall before small signs or hardware enter the frame.
      f.put('concrete',[f.span-.03,.42,.18],0,.39,.31,p.trim,.92);stats.continuousPlinths++;
      for(let j=0;j<=count;j++)f.put('concrete',[hero?.34:.42,shopH-.55,.75],-f.span/2+.4+j*bay,(shopH-.55)/2+.2,-.02,p.wall,plasterShade);
      for(let j=0;j<count;j++){
        const x=-f.span/2+.4+(j+.5)*bay,shopWidth=bay-.48,shutter=weaveFront?(weaveBand==='arrival'?j%3!==1:weaveBand==='junction'?j%3===0:j===count-1):(j+side+Math.floor(rng()*5))%5===0;
        stats.shopfronts++;
        if(shutter){
          f.put('shutter',[shopWidth,shopH-1.0,.16],x,(shopH-.9)/2+.3,-.32,p.trim,.86);stats.shutterPanels++;
        }else{
          f.put('glass',[shopWidth,shopH-1.02,.075],x,(shopH-1.0)/2+.3,-.43,p.glass,.92+rng()*.08);
          f.put('edges',[.07,shopH-1.0,.12],x,(shopH-1)/2+.3,-.23,p.trim,.8);
          f.put('edges',[shopWidth,.07,.12],x,shopH-1.0,-.23,p.trim,.8);
          if(detail>0){
            const doorX=x+shopWidth*.23;
            f.put('edges',[.065,2.55,.15],doorX-.6,1.57,-.12,p.trim,.92);
            f.put('edges',[.065,2.55,.15],doorX+.6,1.57,-.12,p.trim,.92);
            f.put('edges',[1.27,.075,.15],doorX,2.85,-.12,p.trim,.92);
            f.put('edges',[.045,.47,.10],doorX+.38,1.45,.005,0xa5a69b,.9);
            f.put('metal',[shopWidth,.18,.32],x,.39,-.28,p.trim,.8);
            if(hero&&j===Math.floor(count/2)&&(side===1||side===3)){
              for(const edge of [-1,1])f.put('metal',[.18,2.85,.35],doorX+edge*.74,1.67,.28,p.trim,.94);
              f.put('metal',[1.66,.21,.35],doorX,3.15,.28,p.trim,.94);stats.entrancePortals++;
            }
          }
        }
        const hasSign=weaveFront?(j===0||j===Math.floor(count/2)||weaveBand==='market'):b.archetype==='civic'?j===Math.floor(count/2):hero||j%3===1;
        if(hasSign){
          const signW=Math.min(shopWidth-.15,hero?4.5:5.8),sy=shopH-.66,tile=weaveFront?(weaveBand==='arrival'?[2,7,11][j%3]:weaveBand==='exchange'?[6,8,10][j%3]:weaveBand==='junction'?[9,1,3][j%3]:[0,3,10][j%3]):(j+side*3+Math.floor(b.seed*71))%12;
          f.put('metal',[signW+.18,.82,.20],x,sy,.12,p.trim,.8);
          f.put('signs',[signW,.66,1],x,sy,.235,0xffffff,.91,'plane',tile);
          // A small practical underneath, not a neon outline on every building.
          if(hero&&j%2===0){f.put('lamp',[1.1,.045,.08],x,sy-.51,.25,0xffffff,1);}
        }
        if(weaveFront&&shutter){
          stats.serviceBays++;
          // Corner protection, head lintel, threshold and a numbered service
          // plate belong to a single working entrance. Nothing enters the lane.
          for(const edge of [-1,1])f.put('ceramic',[.22,2.6,.20],x+edge*(shopWidth/2-.10),1.64,.26,0xb9a175,.85);
          f.put('metal',[shopWidth,.16,.30],x,.42,.10,0x55686c,.83);
          f.put('signs',[1.02,.35,1],x-shopWidth*.32,3.1,.38,0xffffff,.86,'plane',7);
          f.put('lamp',[.74,.04,.08],x,shopH-.91,.33,0xffffff,1);
        }
        if(detail>0&&(weaveFront?!shutter:j%2===0)){
          const awningWidth=shopWidth+.15;
          f.put('ceramic',[awningWidth,.18,.88],x,shopH-1.1,.015,p.paint,.86, 'box',-1,[-.06,0,0]);
          f.put('metal',[awningWidth,.08,.08],x,shopH-1.16,.42,p.trim,.92);
          f.put('metal',[.045,.5,.045],x-awningWidth*.39,shopH-1.38,.27,p.trim,.7);
          f.put('metal',[.045,.5,.045],x+awningWidth*.39,shopH-1.38,.27,p.trim,.7);
        }
      }
      if((hero&&side%2===0)||(!hero&&side===0)){
        const position=f.point(0,shopH-.8,.75);
        lightAnchors.push({position,color:hero?accent:0xffd5aa,intensity:hero?78:48,range:hero?13:11,building:b.id});
      }
    }

    const widths=[];
    for(let floor=0;floor<floorCount;floor++){
      const bottom=shopH+floor*floorH,centre=bottom+floorH/2,tier=massing.find(v=>centre>=v.bottom&&centre<v.top)||massing.at(-1),{w,d}=tier;
      frame=tier;widths.push([w,d]);
      localBox('darkConcrete',[w-2.8,floorH-.13,d-2.8],0,centre,0,p.trim,.69);
      localBox('concrete',[w-.06,.19,d-.06],0,bottom+.03,0,p.wall,plasterShade*.96);
      const baseDetailed=floor<(b.archetype==='civic'?4:hero?Math.min(floorCount,8):detail?2:0);
      for(let side=0;side<4;side++){
        const frontage=routeFacingFacade(b,side),detailed=baseDetailed||!!frontage&&floor<5,f=face(side*Math.PI/2,w,d),count=Math.max(1,Math.floor((f.span-.65)/(b.style===4?4.4:3.35))),bay=(f.span-.65)/count;
        if(frontage){
          buildStreetStoreyOrder(f,streetFrontageDesign(b,frontage),{bottom,centre,floorH,floor,stats});
          continue;
        }
        f.put('concrete',[f.span-.02,.49,.66],0,bottom+.34,-.03,p.wall,plasterShade);
        const structuralBelt=floor%3===2;
        if(frontage&&floor<5){
          // Group paired storeys with alternating vertical piers rather than
          // making every facade a uniform matrix of tiny neon rectangles.
          for(const end of [-1,1])f.put('concrete',[.58,floorH-.05,.58],end*(f.span/2-.52),centre,.14,p.wall,plasterShade*.97);
          if(floor===1||floor===4)f.put('ceramic',[f.span-.85,.43,.36],0,bottom+.49,.16,frontage.family==='industrial'?0x62817e:frontage.family==='canal'?0x957559:p.paint,.90);
        }
        f.put('concrete',[f.span-.02,structuralBelt?.34:.18,structuralBelt?.66:.48],0,bottom+floorH-.20,-.02,p.wall,plasterShade);
        if(!detailed){
          f.put('glass',[f.span-.6,Math.max(.6,floorH-.92),.11],0,centre+.06,-.40,p.glass,.87+rng()*.16);
          // A few sealed panes carry diffuse backlight at night. Clusters use
          // the existing metre-scale window positions, not an emissive floor
          // ribbon, room texture or an extra light on every window.
          for(let j=0;j<count;j++)if((j*11+floor*7+side*5+Math.floor(b.seed*127))%31<3){
            const x=-f.span/2+.33+(j+.5)*bay;
            f.put('litGlass',[Math.min(bay-.30,2.9),Math.max(.7,floorH-1.18),.075],x,centre+.06,-.332,0x8d9384,.9);
            stats.backlitWindowPanels++;
          }
          for(let j=0;j<=count;j+=b.style===2?2:3)f.put(b.style===3?'edges':'concrete',[.19,floorH-.14,.46],-f.span/2+.33+j*bay,centre,-.04,b.style===3?p.trim:p.wall,plasterShade);
          continue;
        }
        for(let j=0;j<=count;j++)f.put('concrete',[.22,floorH-.15,.64],-f.span/2+.33+j*bay,centre,-.02,p.wall,plasterShade);
        for(let j=0;j<count;j++){
          stats.recessedWindows++;const x=-f.span/2+.33+(j+.5)*bay,ww=bay-.30,wh=Math.max(.7,floorH-1.0),wy=centre+.07;
          const lighted=(j*7+floor*3+side*11+Math.floor(b.seed*41))%23<3;
          f.put(lighted?'litGlass':'glass',[ww,wh,.075],x,wy,-.43,lighted?0x737872:p.glass,.94+rng()*.06);if(lighted)stats.backlitWindowPanels++;
          if(frontage&&b.style%2===0)for(const cross of [-1,1])f.put('edges',[.065,wh,.14],x+cross*ww*.29,wy,-.24,p.trim,.86);
          f.put('edges',[.055,wh,.10],x,wy,-.30,p.trim,.82);
          f.put('edges',[ww,.065,.28],x,bottom+.59,-.18,p.trim,.86);
          // Occupied apartment projections are irregular but coherent in stack.
          const balcony=hero&&floor>0&&floor<8&&(j+side*3+floor*2+Math.floor(b.seed*14))%9===1;
          if(balcony){
            stats.balconies++;const bw=ww+.12,by=bottom+.55;
            f.put('concrete',[bw,.14,.98],x,by,-.03,p.wall,plasterShade*.88);
            f.put('metal',[bw,.06,.05],x,by+.97,.405,p.trim,.77);
            f.put('metal',[bw,.045,.045],x,by+.47,.405,p.trim,.77);
            for(let post=0;post<3;post++)f.put('metal',[.032,.97,.035],x-bw/2+post*bw/2,by+.48,.405,p.trim,.77);
            for(const end of [-1,1])f.put('metal',[.04,.055,.91],x+end*bw/2,by+.97,-.02,p.trim,.77);
            if(j%2===0)f.put('ceramic',[.45,.31,.28],x+bw*.23,by+.24,.20,p.paint,.7);
          }
          if(hero&&floor<7&&(j*3+floor+side+Math.floor(b.seed*20))%11===2){
            stats.mechanicalUnits++;const hx=x-ww*.14,hy=bottom+.72;
            f.put('metal',[.86,.58,.56],hx,hy,.045,0x9a9d91,.87);
            f.put('darkConcrete',[.73,.43,.035],hx,hy,.34,0x3b4745,.9);
            if((j+floor)%2===0){
              f.put('edges',[.38,.38,1],hx-.17,hy,.366,0x606a61,.8,'circle');
              for(let blade=0;blade<3;blade++)f.put('metal',[.25,.045,.022],hx-.17,hy,.38,0x333d38,.7,'box',-1,[0,0,blade*Math.PI/3]);
            }
            f.put('shutter',[.24,.36,.035],hx+.20,hy,.38,0x7b8174,.9);
          }
        }
      }
    }
    // Substantial storey-height setbacks, offset wings and rotated upper
    // masses shape the skyline. Exposed terrace decks close every physical
    // tier; rail posts and deep cornices make that change readable in daylight.
    for(let ti=1;ti<massing.length-1;ti++){
      const tier=massing[ti],next=massing[ti+1];frame=tier;
      localBox('concrete',[tier.w-.04,.22,tier.d-.04],0,tier.top-.11,0,p.wall,plasterShade*.94);
      if(Math.abs(tier.w-next.w)+Math.abs(tier.d-next.d)>2.0||tier.yaw!==next.yaw){
        stats.setbackTerraces++;
        for(let side=0;side<4;side++){
          const f=face(side*Math.PI/2,tier.w,tier.d);
          f.put('concrete',[f.span,.32,.46],0,tier.top-.25,.04,p.wall,plasterShade*.84);
          if(hero||detail>0){
            f.put('metal',[f.span-.55,.07,.06],0,tier.top+1.02,.13,p.trim,.9);
            const posts=Math.max(3,Math.ceil(f.span/2.6));
            for(let j=0;j<=posts;j++)f.put('metal',[.055,1.04,.055],-f.span/2+.28+j*(f.span-.56)/posts,tier.top+.51,.13,p.trim,.88);
          }
        }
      }
      // Exposed diagonal members live on the opaque structural band itself,
      // not across the road or the free air outside the collider envelope.
      if((hero||b.height>100)&&(b.style===3||b.style===4||b.id.startsWith('arcology'))){
        const y0=tier.bottom+.32,y1=Math.min(tier.top-.38,y0+10.5);
        if(y1-y0>4)for(const side of [0,2]){
          const f=face(side*Math.PI/2,tier.w,tier.d),ww=f.span*.22;
          brace(f,[-ww,y0,.10],[0,y1,.10],.32);brace(f,[ww,y0,.10],[0,y1,.10],.32);
          f.put('ceramic',[.55,y1-y0+.4,.18],-ww,(y0+y1)/2,.14,p.paint,.92);
          f.put('ceramic',[.55,y1-y0+.4,.18],ww,(y0+y1)/2,.14,p.paint,.92);
        }
      }
    }
    frame=massing.at(-1);
    const [roofW,roofD]=widths.at(-1),roof=b.height;
    localBox('concrete',[roofW-.05,.24,roofD-.05],0,roof-.12,0,p.wall,plasterShade*.94);
    for(const sx of [-1,1])localBox('concrete',[.30,.64,roofD-.35],sx*(roofW/2-.22),roof+.32,0,p.wall,plasterShade*.91);
    for(const sz of [-1,1])localBox('concrete',[roofW-.35,.64,.30],0,roof+.32,sz*(roofD/2-.22),p.wall,plasterShade*.91);
    // Lift overrun, rooftop plant and elevated cylindrical water tank.
    const plantX=roofW*.19,plantZ=-roofD*.18;
    localBox('concrete',[Math.min(6.5,roofW*.25),2.8,Math.min(7.4,roofD*.27)],-roofW*.20,roof+1.4,-roofD*.18,p.wall,plasterShade*.80);
    localBox('metal',[Math.min(6.8,roofW*.26),.16,Math.min(7.7,roofD*.28)],-roofW*.20,roof+2.86,-roofD*.18,p.trim,.83);
    const mechanicalCount=hero?3:1;
    for(let k=0;k<mechanicalCount;k++){
      stats.mechanicalUnits++;const x=plantX+(k-1)*1.9,z=plantZ;
      localBox('metal',[1.55,.90,1.1],x,roof+.62,z,0x8c9285,.85);
      add('darkConcrete','circle',[.81,.81,1],worldPoint(x,roof+1.08,z),[-Math.PI/2,frame.yaw,0],0x303b37,.8);
      if(hero)for(let blade=0;blade<3;blade++)localBox('edges',[.64,.035,.06],x,roof+1.10,z,0x646d61,.9,[0,blade*Math.PI/3,0]);
    }
    if(hero||b.style===4){
      const tx=roofW*.20,tz=roofD*.21,r=clamp(Math.min(roofW,roofD)*.045,.65,1.65),tankH=r*1.6;
      for(const sx of [-1,1])for(const sz of [-1,1])localBox('metal',[.075,.90,.075],tx+sx*r*.62,roof+.46,tz+sz*r*.62,p.trim,.78);
      add('metal','cylinder',[r*2,tankH,r*2],worldPoint(tx,roof+.90+tankH/2,tz),[0,frame.yaw,0],0x9b9c8c,.87);
      add('edges','cylinder',[r*2.05,.07,r*2.05],worldPoint(tx,roof+.90+tankH*.18,tz),[0,0,0],0x626d62,.9);
      add('edges','cylinder',[r*2.05,.07,r*2.05],worldPoint(tx,roof+.90+tankH*.80,tz),[0,0,0],0x626d62,.9);
      add('metal','cylinder',[r*2.01,.10,r*2.01],worldPoint(tx,roof+.94+tankH,tz),[0,0,0],0x777f71,.9);
    }
    // Occasional vertical blade sign has an actual bracket and opaque back.
    // It occupies a small facade area; the building perimeter is never neon.
    if(hero&&rng()>.30){
      frame={x:0,z:0,yaw:0};
      const f=face((Math.floor(rng()*4))*Math.PI/2,b.w,b.d),x=-f.span*.33,sy=shopH+3.6;
      f.put('metal',[1.0,3.5,.22],x,sy,.14,p.trim,.8);
      f.put('signs',[.86,3.28,1],x,sy,.265,0xffffff,.94,'plane',12+Math.floor(rng()*4));
      f.put('accent',[.035,3.08,.045],x-.40,sy,.30,accent,1.0);
      f.put('metal',[.12,.12,.60],x,sy-1.3,-.02,p.trim,.8);
      f.put('metal',[.12,.12,.60],x,sy+1.3,-.02,p.trim,.8);
    }
  }

  const sectors=new Set();
  for(const batch of batches.values()){
    const count=batch.instances.length,g=sourceGeometries[batch.geometry].clone();geometries.push(g);
    const uvRects=new Float32Array(count*4);
    if(batch.kind==='signs'){
      for(let i=0;i<count;i++)uvRects.set(atlasRect(batch.instances[i].tile),i*4);
      g.setAttribute('urbanUvRect',new THREE.InstancedBufferAttribute(uvRects,4));
    }
    if(mat[batch.kind].userData.exteriorSurface)surfaces.installGeometry(g,batch.instances,batch.geometry);
    const mesh=new THREE.InstancedMesh(g,mat[batch.kind],count);mesh.name=`Urban ${batch.sector} / ${batch.level} / ${batch.kind} / ${batch.geometry}`;
    const c=new THREE.Color();
    for(let i=0;i<count;i++){
      transform.matrix.fromArray(batch.instances[i].matrix);mesh.setMatrixAt(i,transform.matrix);
      c.setRGB(...batch.instances[i].colour);mesh.setColorAt(i,c);
    }
    mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
    // Only substantial opaque architecture needs to enter shadow passes. Thin
    // slats and letters remain inexpensive, receive lighting and retain depth.
    mesh.castShadow=['concrete','darkConcrete','metal'].includes(batch.kind)&&batch.geometry==='box';
    mesh.receiveShadow=true;mesh.frustumCulled=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();
    mesh.userData.urbanArchitecture=true;mesh.userData.sector=batch.sector;
    group.add(mesh);visibility.add(mesh,{level:batch.level});sectors.add(batch.sector);stats.drawBatches++;
    stats.triangles+=(g.index?g.index.count:g.attributes.position.count)/3*count;
  }
  stats.textureCount=textures.length+surfaces.stats.textureCount;stats.sectorCount=sectors.size;stats.lightAnchors=lightAnchors.length;
  stats.geometryMiB=+(stats.instances*(16+3+4)*4/1048576).toFixed(2);
  group.userData.stats=stats;group.userData.referenceStudy='Original modular construction; visual study of Dan Hargreaves and Kacper Niepokolczycki Kabuki portfolios. No game assets used.';
  batches.clear();
  return {group,stats,lightAnchors,ready:surfaces.ready,setQuality(q,profile){visibility.setQuality(q,profile);surfaces.setQuality(q);},update(time,p){visibility.update(time,p);},dispose(){
    root.remove(group);for(const geometry of geometries)geometry.dispose();for(const m of materials)m.dispose();for(const texture of textures)texture.dispose();surfaces.dispose();group.clear();
  }};
}
