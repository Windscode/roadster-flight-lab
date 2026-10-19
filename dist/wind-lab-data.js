// Shared metre-based visual and collision description. Vehicle coordinates:
// +Y is up, +Z is forward. The floor's upper surface is exactly world Y = 0.
const freezeBox=(id,kind,size,position,color)=>Object.freeze({id,kind,size:Object.freeze(size),position:Object.freeze(position),rotation:Object.freeze([0,0,0]),color});

export const WIND_LAB_DIMENSIONS=Object.freeze({
  width:70,length:110,wallHeight:26,clearHeight:24.1,
  workingBounds:Object.freeze({min:Object.freeze([-24,0,-42]),max:Object.freeze([24,24,42])}),
  flowBounds:Object.freeze({min:Object.freeze([-22,1,-44]),max:Object.freeze([22,22,44])}),
});

export const WIND_LAB_SPAWN=Object.freeze({
  position:Object.freeze([0,.74,0]),quaternion:Object.freeze([0,0,0,1]),mode:'drive',
});

const boxes=[
  freezeBox('windlab-floor','floor',[70,1,110],[0,-.5,0],0x526167),
  freezeBox('windlab-wall-west','lab-wall',[.6,26,110],[-34.7,13,0],0x849597),
  freezeBox('windlab-wall-east','lab-wall',[.6,26,110],[34.7,13,0],0x849597),
  freezeBox('windlab-wall-intake','lab-wall',[70,26,.6],[0,13,-54.7],0x6f8389),
  freezeBox('windlab-wall-exit','lab-wall',[70,26,.6],[0,13,54.7],0x849597),
  freezeBox('windlab-ceiling','lab-ceiling',[70,1,110],[0,26.5,0],0xb6c7c7),
  // Fan detail is inset within this solid backplane, so the rendered fan bank
  // cannot be driven through. The blades are a prescribed-flow instrument.
  freezeBox('windlab-fan-bank','lab-service',[60,20,3],[0,10.15,-52.85],0x1f3038),
  freezeBox('windlab-service-west','lab-service',[5,.28,84],[-29.0,.14,0],0x39474e),
  freezeBox('windlab-service-east','lab-service',[5,.28,84],[29.0,.14,0],0x39474e),
];
for(const z of [-44,-22,0,22,44]){
  for(const side of [-1,1])boxes.push(freezeBox(`windlab-column-${side<0?'west':'east'}-${z+44}`,'lab-structure',[1.2,25.6,1.2],[side*32,12.8,z],0x344950));
  boxes.push(freezeBox(`windlab-roof-frame-${z+44}`,'lab-structure',[65.4,1.5,1.2],[0,24.85,z],0x344950));
}

export const WIND_LAB_GEOMETRY=Object.freeze(boxes);
