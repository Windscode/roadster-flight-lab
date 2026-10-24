// Original shallow exterior showcases, built in metres. They occupy the
// existing sealed facade recess (<= 0.62 m); none is an enterable room.
export const STREET_DISPLAY_VERSION='sealed-shopfront-3.18';
export const DISPLAY_RECIPES=Object.freeze(['books','daily','workshop','gallery']);
export function displayRecipe(order){
  return ['gallery','exchange','southbank'].includes(order)?'books':
    ['workshop','service'].includes(order)?'workshop':order==='residential'?'gallery':'daily';
}

// The adapter puts boxes in a facade's local outward frame. Shallow opaque
// objects and a separately sorted clear pane replace a single flat dark board.
export function buildStreetDisplay(put,{x=0,width=4.6,height=2.7,sill=.38,recipe='books',variant=0,door=false,trim=0x405457}){
  const doorW=door?Math.min(1.10,width*.29):0,doorSide=variant%2?-1:1,
    displayW=width-(door?doorW+.12:0),centre=x-(door?doorSide*(doorW+.12)*.5:0),top=sill+height;
  const light={position:[centre,top-.075,-.17],span:[displayW*.29,0,0],cool:recipe==='workshop'};
  const emit=(kind,size,along,y,out,tint)=>put(kind,size,along,y,out,tint,1,'box',-1,[0,0,0],kind==='shopGlass'?null:light);
  const place=(kind,size,dx,y,out,tint=0xffffff)=>emit(kind,size,centre+dx,y,out,tint);
  // A small downward shelf bar is attached to the existing top panel. Its
  // three-sample local diffuse term reaches only this closed display's pieces.
  // The clear pane has no added emission and the street receives no new light.
  put('lamp',[displayW*.78,.025,.065],centre,top-.058,-.17,recipe==='workshop'?0xd4e6ef:0xffe0b7);
  place('displayBack',[displayW,height,.035],0,sill+height*.5,-.59,recipe==='workshop'?0x344646:0x777b6d);
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
