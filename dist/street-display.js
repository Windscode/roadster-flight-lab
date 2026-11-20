// Original shallow exterior showcases, built in metres. They occupy the
// existing sealed facade recess (<= 0.62 m); none is an enterable room.
export const STREET_DISPLAY_VERSION='sealed-shopfront-3.18';
export const DISPLAY_RECIPES=Object.freeze(['books','daily','workshop','gallery','tide-survey','machine-shop','viaduct-model']);
export function displayRecipe(order){
  if(order==='southbank')return 'tide-survey';
  if(order==='service')return 'machine-shop';
  if(order==='exchange')return 'viaduct-model';
  return order==='gallery'?'books':order==='workshop'?'workshop':order==='residential'?'gallery':'daily';
}

// The adapter puts boxes in a facade's local outward frame. Shallow opaque
// objects and a separately sorted clear pane replace a single flat dark board.
export function buildStreetDisplay(put,{x=0,width=4.6,height=2.7,sill=.38,recipe='books',variant=0,door=false,trim=0x405457}){
  const doorW=door?Math.min(1.10,width*.29):0,doorSide=variant%2?-1:1,
    displayW=width-(door?doorW+.12:0),centre=x-(door?doorSide*(doorW+.12)*.5:0),top=sill+height;
  const cool=recipe==='workshop'||recipe==='machine-shop';
  const light={position:[centre,top-.075,-.17],span:[displayW*.29,0,0],cool};
  const emit=(kind,size,along,y,out,tint)=>put(kind,size,along,y,out,tint,1,'box',-1,[0,0,0],kind==='shopGlass'?null:light);
  const place=(kind,size,dx,y,out,tint=0xffffff)=>emit(kind,size,centre+dx,y,out,tint);
  // A small downward shelf bar is attached to the existing top panel. Its
  // three-sample local diffuse term reaches only this closed display's pieces.
  // The clear pane has no added emission and the street receives no new light.
  put('lamp',[displayW*.78,.025,.065],centre,top-.058,-.17,cool?0xd4e6ef:0xffe0b7);
  place('displayBack',[displayW,height,.035],0,sill+height*.5,-.59,cool?0x344646:0x777b6d);
  for(const side of [-1,1])place('displayBack',[.055,height,.53],side*(displayW/2-.027),sill+height*.5,-.31,0x344846);
  place('displayWood',[displayW,.075,.52],0,sill+.035,-.31,0x7f694b);
  place('displayBack',[displayW,.06,.52],0,top-.03,-.31,0x53605a);
  if(recipe==='books'){
    for(const level of [0,1,2]){
      const y=sill+.28+level*Math.min(.58,(height-.7)/3);
      place('displayWood',[displayW-.14,.045,.34],0,y,-.34,0x8a7758);
      const n=Math.max(3,Math.min(9,Math.floor(displayW/.36)));
      for(let k=0;k<n;k++){
        const bx=-displayW*.42+(k+.5)*displayW*.84/n,bh=.22+((k+level+variant)%3)*.065;
        place('displayGoods',[.11+((k+level)%2)*.045,bh,.19],bx,y+.03+bh*.5,-.35,[0xa48152,0x425d64,0xa8ab90,0x794e43][(k+level+variant)%4]);
      }
    }
  }else if(recipe==='viaduct-model'){
    // Exchange concourse: a section model of the overhead walk and its piers,
    // with an interchange diagram on the wall behind the model.
    const table=sill+.57,deck=table+.40;
    place('displayWood',[displayW*.86,.53,.43],0,sill+.265,-.315,0x695e50);
    place('displayFrame',[displayW*.89,.04,.46],0,table-.02,-.31,0xc6ac79);
    for(const station of [-1,0,1]){
      place('displayGoods',[displayW*.054,.35,.13],station*displayW*.29,table+.175,-.30,0xaba99b);
      place('displayFrame',[displayW*.10,.06,.20],station*displayW*.29,deck-.02,-.30,0x687873);
    }
    place('displayGoods',[displayW*.78,.08,.19],0,deck+.04,-.30,0xb39966);
    for(const out of [-.38,-.22])place('displayFrame',[displayW*.78,.065,.018],0,deck+.11,out,0x586e6c);
    const mapY=sill+height*.69;
    place('displayGoods',[displayW*.76,height*.29,.035],0,mapY,-.52,0x2b464c);
    place('displayGoods',[displayW*.58,.038,.02],0,mapY,-.494,0xe7b569);
    place('displayGoods',[.036,height*.18,.02],0,mapY,-.494,0x97c8bf);
    for(const station of [-1,0,1])place('displayGoods',[.069,.069,.025],station*displayW*.23,mapY,-.47,0xe3e6ce);
  }else if(recipe==='tide-survey'){
    // A stepped bathymetry model with a staff gauge and a brass level marker.
    const bench=sill+.35;
    place('displayWood',[displayW*.84,.29,.39],0,sill+.145,-.32,0x786752);
    place('displayFrame',[displayW*.87,.06,.43],0,bench-.03,-.32,0xb0a68c);
    for(let layer=0;layer<4;layer++){
      const width=displayW*(.69-layer*.11);
      place('displayGoods',[width,.085,.28-layer*.035],-displayW*.05+layer*displayW*.018,bench+.0425+layer*.085,-.32,[0x32636a,0x668982,0x93a392,0xb9a981][layer]);
    }
    const gaugeX=displayW*.28;
    place('displayGoods',[.24,1.50,.045],gaugeX,sill+1.20,-.53,0x223e49);
    for(let tick=0;tick<9;tick++)place('displayGoods',[tick%2?.09:.16,.025,.025],gaugeX-.02,sill+.55+tick*.16,-.493,0xe5d6ae);
    place('displayFrame',[.29,.06,.045],gaugeX,sill+.74+(variant%3)*.16,-.47,0xc28a48);
  }else if(recipe==='machine-shop'){
    // Gantry press: a steel worktable, two columns, a ram and a workpiece.
    const width=Math.min(2.5,displayW*.76),table=sill+.64;
    for(const side of [-1,1]){
      place('displayFrame',[.12,.62,.30],side*width*.40,sill+.31,-.31,0x465955);
      place('displayFrame',[.095,.89,.14],side*width*.40,table+.49,-.36,0x83938b);
    }
    place('displayWood',[width,.10,.44],0,table,-.30,0x768078);
    place('displayGoods',[width,.16,.22],0,table+.93,-.36,0xbbae78);
    place('displayGoods',[.27,.27,.20],0,table+.72,-.36,0x546963);
    const stroke=.15+(variant%3)*.065;
    place('displayFrame',[.095,stroke,.09],0,table+.585-stroke/2,-.35,0xbdc8c0);
    place('displayGoods',[.30,.11,.22],0,table+.105,-.33,0xa07750);
  }else if(recipe==='daily'){
    place('displayWood',[displayW-.18,.56,.42],0,sill+.29,-.31,0x8e7855);
    place('displayGoods',[displayW-.12,.055,.48],0,sill+.59,-.28,0x969b8c);
    for(let k=0;k<5;k++){
      const bx=(k-2)*displayW*.15,h=.17+(k%3)*.10;
      place('displayGoods',[displayW*.10,h,.23],bx,sill+.63+h/2,-.30,[0xd2be84,0x78958b,0xae7e56][(k+variant)%3]);
    }
    place('displayGoods',[Math.min(.7,displayW*.20),.65,.045],displayW*.27,sill+1.31,-.52,0x203e42);
  }else if(recipe==='workshop'){
    place('displayWood',[displayW-.16,.075,.47],0,sill+.56,-.29,0x9b8364);
    for(const sign of [-1,1])place('displayFrame',[.07,.55,.36],sign*displayW*.34,sill+.27,-.32,trim);
    for(const k of [-1,0,1]){
      place('displayGoods',[.36,.16+.11*(k===0),.28],k*displayW*.25,sill+.68,-.31,k===0?0x9f8a5b:0x516d6d);
      place('displayFrame',[.055,.53,.035],k*displayW*.21,sill+1.38,-.54,0xadb6a9);
    }
    place('displayFrame',[displayW*.68,.065,.055],0,sill+1.56,-.51,trim);
  }else{
    for(const side of [-1,1]){
      place('displayWood',[displayW*.26,.42,.32],side*displayW*.23,sill+.23,-.32,0x8d9388);
      place('displayGoods',[displayW*.16,.43+side*.08,.19],side*displayW*.23,sill+.65,-.31,side<0?0xbc9867:0x59828a);
      place('displayFrame',[displayW*.28,.62,.045],side*displayW*.23,sill+1.42,-.54,0x405351);
      place('displayGoods',[displayW*.23,.53,.022],side*displayW*.23,sill+1.42,-.508,side<0?0xb6b6a4:0x9ca4a0);
    }
  }
  // Sparse mullions at a real ~1.4 m span; a clear pane has reflection but no
  // transmission render target, and does not add an opaque shadow rectangle.
  place('shopGlass',[displayW,height,.012],0,sill+height*.5,-.055,0xa7bdba);
  if(displayW>3.5)place('displayFrame',[.045,height,.075],displayW*.12,sill+height*.5,-.03,trim);
  if(door){
    const dx=x+doorSide*(width-doorW)/2,dh=Math.min(2.28,top-.10);
    emit('displayBack',[doorW,dh,.04],dx,dh/2+.14,-.47,0x2d4648);
    for(const end of [-1,1])emit('displayFrame',[.065,dh,.43],dx+end*(doorW/2+.02),dh/2+.14,-.235,trim);
    emit('displayFrame',[doorW+.14,.085,.44],dx,dh+.18,-.23,trim);
    emit('displayFrame',[doorW-.09,.055,.07],dx,1.22,-.395,trim);
    emit('displayGoods',[.035,.28,.06],dx-doorSide*(doorW*.32),1.06,-.365,0xc1bba6);
    emit('displayWood',[doorW+.05,.045,.46],dx,.145,-.24,0x8c9283);
  }
  return {recipe,door,widthM:width,depthM:.62,glassDepthM:.055,handleHeightM:door?1.06:null,light};
}
