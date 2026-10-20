// Authored facade orders share the original closed building envelopes. These
// are exterior shop/portal compositions, not rooms or new collision volumes.
export function streetFrontageDesign(building,frontage){
  if(!frontage)return null;
  if(frontage.family==='downtown'){
    const variants=[
      {order:'gallery',bay:8.4,wall:0x9ca69f,trim:0x3d575a,base:0x596c66,glass:0x355a64,signTiles:[6,8]},
      {order:'residential',bay:6.4,wall:0xafa18a,trim:0x4d514c,base:0x71634f,glass:0x3c525b,signTiles:[1,9]},
      {order:'workshop',bay:8.9,wall:0x839d9c,trim:0x345458,base:0x4d6869,glass:0x355d6a,signTiles:[2,7]},
      {order:'exchange',bay:10.2,wall:0xada998,trim:0x46585a,base:0x69726a,glass:0x405b66,signTiles:[8,5]},
      {order:'gallery',bay:7.3,wall:0x899d95,trim:0x3b5754,base:0x576961,glass:0x365960,signTiles:[11,3]},
    ];
    return {...variants[(Math.abs(building.style||0)+(frontage.side%2))%variants.length],family:'downtown',portalOnlyLighting:true};
  }
  const side=building.x< -200?0:1;
  if(frontage.family==='market'){
    const exchange=building.z>=-290&&building.z< -235;
    const order=exchange?'exchange':building.z< -340?(side?'workshop':'gallery'):building.z< -290?'market':'residential';
    return {order,family:'weave',bay:order==='gallery'?6.7:order==='workshop'?7.5:order==='exchange'?7.6:5.8,
      wall:order==='gallery'?0xb7aa91:order==='workshop'?0x7b9190:order==='exchange'?0xa49880:0x9caaa5,
      trim:order==='gallery'?0x536566:0x3f555a,base:order==='gallery'?0x655d52:order==='workshop'?0x4d6868:0x68695f,
      glass:order==='gallery'?0x42616a:0x375863,upperBay:order==='gallery'?4.7:order==='exchange'?6.2:3.95,
      storeyOrder:order==='gallery'?'paired-piers':order==='workshop'?'grouped-industrial':order==='exchange'?'exchange-frame':'shophouse',
      signTiles:order==='gallery'?[6,8]:order==='workshop'?[2,7]:order==='exchange'?[8,5]:order==='market'?[0,3,10]:[1,9]};
  }
  if(frontage.family==='canal')return {order:'southbank',family:'canal',bay:9.6,wall:0xc1b8a2,trim:0x56686a,base:0x706f64,glass:0x405d68,
    upperBay:6.5,storeyOrder:'vertical-civic',signTiles:[8,6]};
  if(frontage.family==='industrial')return {order:'service',family:'foundry',bay:8.2,wall:0x899d97,trim:0x41595c,base:0x667771,glass:0x3a5c67,
    upperBay:6.3,storeyOrder:'grouped-industrial',signTiles:[2,7]};
  return {order:'crosstown',family:'civic',bay:8.6,wall:0xb2b4a4,trim:0x526669,base:0x727b74,glass:0x48616b,
    upperBay:5.1,storeyOrder:'paired-piers',signTiles:[5,11]};
}

export function buildStreetGroundOrder(f,design,{shopH,side,building,stats,lights}){
  const d=design,count=Math.max(2,Math.round((f.span-1.0)/d.bay)),bay=(f.span-1.0)/count;
  const central=Math.floor(count/2),service=d.order==='workshop'||d.order==='service';
  const tallOrder=d.order==='southbank'||d.order==='exchange';
  stats.designedGroundOrders??={};stats.designedGroundOrders[d.order]=(stats.designedGroundOrders[d.order]||0)+1;
  // A 22 cm continuous foot, then individually resolved openings. The old
  // 1.4 m opaque ribbon no longer cuts across the shop windows and doors.
  f.put('concrete',[f.span-.08,.22,.48],0,.23,.16,d.base,.94);
  f.put('concrete',[f.span-.10,.38,.66],0,shopH-.16,.10,d.wall,.97);
  const pier=tallOrder?.56:d.order==='gallery'?.48:.38;
  for(let j=0;j<=count;j++){
    const x=-f.span/2+.5+j*bay;
    f.put('concrete',[pier,shopH-.46,.70],x,shopH/2+.06,.09,d.wall,1);
    f.put('metal',[.055,shopH-.74,.10],x-pier*.35,shopH/2+.08,.445,d.trim,.90);
  }
  for(let j=0;j<count;j++){
    const x=-f.span/2+.5+(j+.5)*bay,w=bay-pier-.10,portal=j===central,
      closed=service?j===count-1:d.order==='market'?j===count-1&&count>5:false;
    const opaqueEnd=closed||portal&&tallOrder;
    stats.shopfronts++;
    if(closed){
      f.put('shutter',[w,shopH-.84,.12],x,shopH/2+.06,-.24,d.base,.91);stats.shutterPanels++;stats.serviceBays++;
      for(const end of [-1,1])f.put('metal',[.13,2.70,.16],x+end*(w/2-.10),1.76,.20,d.trim,.9);
      f.put('signs',[1.04,.34,1],x-w*.30,3.14,.42,0xffffff,.90,'plane',7);
    }else if(opaqueEnd){
      // Recessed broad entrance with solid jambs and an opaque glazed leaf.
      // The physical envelope remains closed immediately behind these skins.
      const opening=Math.min(3.4,w*.63),reveal=(w-opening)/2;
      for(const end of [-1,1])f.put('concrete',[reveal,shopH-.55,.64],x+end*(opening+reveal)/2,shopH/2+.04,.05,d.wall,.91);
      f.put('glass',[opening,shopH-.80,.08],x,shopH/2+.05,-.36,d.glass,.94);
      f.put('edges',[.075,shopH-.87,.15],x,shopH/2+.07,-.20,d.trim,.96);
      f.put('metal',[opening+.18,.15,.58],x,shopH-.65,.10,d.trim,.90);stats.facadePortals++;
    }else{
      const sill=d.order==='gallery'?.48:d.order==='market'?.60:.34;
      // A dim sealed display panel gives selected occupied shop bays a lower
      // luminance than the sparse upper windows. This is an exterior backing,
      // not an invented interior, and supplies no unbaked world illumination.
      f.put(!portal&&(j+side)%3!==2?'displayGlass':'glass',[w,shopH-sill-.64,.09],x,(shopH+sill)/2-.12,-.34,d.glass,.98);
      f.put(d.order==='gallery'?'concrete':'ceramic',[w,sill-.20,.36],x,(sill+.20)/2,.19,d.base,.92);
      // Shop window + offset door; proportions vary with actual business use.
      const doorX=x+(j%2?-.28:.28)*w;
      f.put('edges',[.07,shopH-.70,.17],doorX,shopH/2+.05,-.12,d.trim,.92);
      f.put('edges',[w,.085,.18],x,shopH-1.0,-.12,d.trim,.88);
      f.put('edges',[.055,.52,.08],doorX+(j%2?.46:-.46),1.36,.02,0xc0b9a2,.93);
      if(d.order==='market')f.put('ceramic',[w-.25,.16,.70],x,shopH-.90,.10,d.wall,.89);
    }
    if(portal||j===0||d.order==='market'&&j%2===0){
      const sw=portal&&tallOrder?Math.min(5.3,w):Math.min(w*.76,4.8),sy=shopH-.67;
      // The face datum is 0.50 m inside the shared closed building envelope.
      // Project the whole sign/downlight assembly beyond that envelope; moving
      // only the emitter would detach it from its lens. Two short standoffs
      // overlap both the masonry header and the sign backplate.
      f.put('metal',[sw+.14,.64,.18],x,sy,.47,d.trim,.88);
      for(const end of [-1,1])f.put('metal',[.10,.14,.34],x+end*sw*.36,sy+.27,.26,d.trim,.82);
      f.put('signs',[sw,.53,1],x,sy,.575,0xffffff,.91,'plane',d.signTiles[j%d.signTiles.length]);
      if(!d.portalOnlyLighting||portal){
        const lampWidth=Math.min(sw-.28,2.4);
        // This backing joins the sign's bottom edge and the lens top with a
        // small overlap, closing the old 37.5 mm unsupported vertical gap.
        f.put('metal',[lampWidth+.12,.04,.12],x,sy-.33875,.58,d.trim,.88);
        f.put('lamp',[lampWidth,.045,.10],x,sy-.38,.58,0xffffff,.56);
        // The source sits immediately under the actual lens and grazes the
        // portal/reveals. Source and target now also clear the bake envelope.
        lights.push({id:`frontage-${building.id}-${side}-${j}`,position:f.point(x,sy-.409,.58),target:f.point(x,.80,.62),
          color:d.order==='service'?0xd2e0e5:d.order==='exchange'?0xe7d3b4:0xf2d6ac,intensity:d.portalOnlyLighting?120:portal?180:105,range:11,angle:1.08,penumbra:.48,practical:true,role:'door',building:building.id});
      }
    }
    // Sparse upper transoms and service labels replace the repeated awning.
    if(!closed&&j%2===0&&d.order==='gallery'){
      f.put('edges',[w-.18,.045,.12],x,2.50,-.13,d.trim,.8);
      for(const end of [-1,1])f.put('edges',[.045,1.02,.12],x+end*w*.21,3.02,-.14,d.trim,.85);
    }
  }
  // The last return is deliberately weightier at the corner, tying the two
  // road-facing elevations without a new object in the turning clearance.
  for(const end of [-1,1]){
    f.put('concrete',[.66,shopH-.12,.70],end*(f.span/2-.37),shopH/2,.10,d.wall,1.02);
    f.put('ceramic',[.11,2.65,.10],end*(f.span/2-.69),1.73,.42,d.base,.93);
  }
}

export function buildStreetStoreyOrder(f,d,{bottom,centre,floorH,floor,stats}){
  const count=Math.max(2,Math.round((f.span-.9)/d.upperBay)),bay=(f.span-.9)/count,
    vertical=d.storeyOrder==='vertical-civic',paired=d.storeyOrder==='paired-piers',industrial=d.storeyOrder==='grouped-industrial';
  const wall=d.wall,trim=d.trim,glass=d.glass;
  // Primary structure reads at street distance. Horizontal members stop at
  // piers, avoiding the original unbroken concrete stripe on every storey.
  for(let j=0;j<=count;j++){
    const x=-f.span/2+.45+j*bay,heavy=vertical||paired&&j%2===0;
    // The 25–48 cm window-side returns keep their complete near geometry and
    // material but retire under the existing detail-distance budget. Broad
    // opaque bays, floor surfaces and the building core remain farther out.
    f.putDetail('concrete',[heavy?.48:.25,floorH,.58],x,centre,.15,wall,heavy?.99:.94);
    if(vertical&&j%2===0)f.put('metal',[.07,floorH,.16],x+.26,centre,.36,trim,.95);
  }
  for(let j=0;j<count;j++){
    const x=-f.span/2+.45+(j+.5)*bay,ww=bay-(vertical?.57:.38),
      opaque=vertical&&j%4===3||industrial&&j%5===4,
      wh=floorH-(paired&&floor%2===0?.80:industrial?1.15:.96),wy=centre+.08;
    if(opaque){
      f.put('concrete',[ww,floorH-.14,.30],x,centre,.14,d.base,.93);
      f.put('glass',[ww*.46,Math.max(.8,wh*.62),.09],x,wy,-.10,glass,.94);
    }else{
      const lighted=(j*5+floor*7)%17===3;
      f.put(lighted?'litGlass':'glass',[ww,wh,.08],x,wy,-.33,lighted?0x7d8176:glass,.97);stats.recessedWindows++;
      if(lighted)stats.backlitWindowPanels++;
      f.put('edges',[.055,wh,.13],x,wy,-.15,trim,.89);
      if(industrial)f.put('edges',[ww,.065,.15],x,wy+wh*.14,-.12,trim,.91);
      f.put('concrete',[ww,Math.max(.20,floorH-wh-.08),.44],x,bottom+(floorH-wh)/2,.14,wall,.91);
      f.put('edges',[ww,.08,.25],x,bottom+(floorH-wh)+.07,.30,trim,.91);
    }
    if(paired&&floor%2===1)f.putDetail('concrete',[ww,.25,.48],x,bottom+floorH-.14,.17,wall,.95);
  }
}
