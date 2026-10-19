// Street improvements use the SAME metre-scale solids in rendering and physics.
// No road centreline or building parcel is changed. Pavements terminate before
// each junction so the original turning and flight corridors remain open.
export function createRouteCorridorPlan(streets){
  const solids=[],lights=[];
  const legs=[
    {id:'crosstown-link',from:-184,to:84,sidewalk:true,step:36,stone:'corridor-pale'},
    {id:'foundry-main',from:-383,to:-149,sidewalk:true,step:34,stone:'corridor-basalt'},
    {id:'canal-link',from:-183,to:83,sidewalk:true,step:38,stone:'corridor-pale'},
  ];
  function add(id,size,position,material,kind='corridor-paving',data={}){solids.push({id:'corridor-'+id,kind,size,position,rotation:[0,0,0],data:{material,...data}});}
  for(const leg of legs){
    const street=streets.find(s=>s.id===leg.id),vertical=street.points[0][0]===street.points[1][0],centre=vertical?street.points[0][0]:street.points[0][2],h=street.width/2;
    const point=(along,across,y)=>vertical?[centre+across,y,along]:[along,y,centre+across];
    const size=(along,across,height)=>vertical?[across,height,along]:[along,height,across];
    for(const side of [-1,1]){
      // One 12 cm support per footway, with a bevelled visual edge wholly
      // inside its contact box. A surface finish never adds hidden road steps.
      add(leg.id+'-walk-'+side,size(leg.to-leg.from,3,.12),point((leg.from+leg.to)/2,side*(h+1.5),.06),leg.stone);
      for(let along=leg.from+5,index=0;along<leg.to-3;along+=leg.step,index++){
        const outer=side*(h+2.56),inner=side*(h+.50),position=point(along,outer,3.76),poleId=leg.id+'-lamp-'+side+'-'+index;
        add(poleId,[.14,7.28,.14],position,'steel','corridor-fixture');
        add(poleId+'-arm',size(.18,2.2,.12),point(along,side*(h+1.55),7.42),'steel','corridor-fixture');
        add(poleId+'-head',size(.47,.88,.12),point(along,inner,7.40),'steel','corridor-fixture');
        lights.push({id:poleId,position:point(along,inner,7.30),target:point(along+3,side*(h*.38),.08),
          color:leg.id==='foundry-main'?0xd1deea:leg.id==='canal-link'?0xf2cc9c:0xe8d3b4,intensity:1750,range:29,practical:true,role:'street',lensSize:size(.38,.70,.035)});
      }
      // Street cabinets and seats are sparse, protected by the same pavement,
      // and backed by matching conservative furniture collision volumes.
      const cabinet=leg.from+22;
      add(leg.id+'-cabinet-'+side,size(.72,.45,1.08),point(cabinet,side*(h+2.45),.66),'steel','corridor-fixture',{part:'cabinet'});
      if(leg.id==='canal-link')for(const along of [-139,-27,59])add('canal-seat-'+side+'-'+along,size(1.8,.55,.95),point(along,side*(h+2.44),.595),'corridor-wood','corridor-fixture',{part:'bench'});
    }
  }
  return {solids,lights,legs:legs.map(l=>({...l,roadWidthM:streets.find(s=>s.id===l.id).width})),
    provenance:'Authored roadside design, outside unchanged CITY_STREETS widths; shared rendering/contact definitions.'};
}
