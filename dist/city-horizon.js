// A low-cost geographic backdrop begins outside the simulation's reachable
// world (hard reset boundary ±700 m). It is explicitly distant scenery, not a
// second drivable city. The existing ±620 m physical perimeter is retained.
export const CITY_HORIZON=Object.freeze({version:'horizon-3.16-1',startM:700,endM:2100,reachable:false,collision:'Existing 620 m physical perimeter and 700 m working limit; shared banks join the floor to distant scenery.',sectors:['west-port-belt','north-upland','east-ridge','south-estuary']});
export function buildCityHorizon(THREE,parent){
  const group=new THREE.Group();group.name='Distant geography / outside simulation area';group.userData.distantScenery=true;parent.add(group);
  const positions=[],colors=[],indices=[],rings=18,segments=128,colour=new THREE.Color();
  for(let r=0;r<=rings;r++)for(let i=0;i<=segments;i++){
    const a=i/segments*Math.PI*2,dir=[Math.cos(a),Math.sin(a)],square=Math.max(Math.abs(dir[0]),Math.abs(dir[1]));
    const edge=CITY_HORIZON.startM+(CITY_HORIZON.endM-CITY_HORIZON.startM)*(r/rings),radius=edge/square,x=dir[0]*radius,z=dir[1]*radius;
    const fade=Math.min(1,(edge-CITY_HORIZON.startM)/210),east=Math.max(0,dir[0]),north=Math.max(0,dir[1]),south=Math.max(0,-dir[1]);
    const hills=fade*((30+east*120+north*65)*(0.48+.27*Math.sin(a*5+edge*.004)+.23*Math.sin(a*11-edge*.007)))*(1-.86*south);
    const y=-2.1+hills;
    positions.push(x,y,z);colour.set(south>.65?0x747d78:east>.5?0x667265:0x74776b);colour.multiplyScalar(.80+.15*Math.sin(a*9+edge*.011));colors.push(colour.r,colour.g,colour.b);
    if(r<rings&&i<segments){const k=r*(segments+1)+i;indices.push(k,k+1,k+segments+1,k+1,k+segments+2,k+segments+1);}
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();
  const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.97,metalness:0});material.name='Distant / mineral upland';
  const mesh=new THREE.Mesh(geometry,material);mesh.name='Four-sector distant terrain';mesh.receiveShadow=false;mesh.castShadow=false;mesh.userData.renderDetail='mass';group.add(mesh);
  // Low broad estuary plane is distinct from the city canal. It has no sharp
  // mirror or animated displacement and never overlaps a playable road.
  const water=new THREE.Mesh(new THREE.PlaneGeometry(4200,1150),new THREE.MeshStandardMaterial({color:0x465d61,roughness:.48,metalness:0,envMapIntensity:.50}));
  water.name='Distant estuary / not playable';water.rotation.x=-Math.PI/2;water.position.set(0,-1.6,-1430);water.castShadow=false;water.receiveShadow=false;group.add(water);
  // Port sheds and ridge utilities establish scale without copying the city's
  // repeated towers. None is counted among its 114 buildings.
  const box=new THREE.BoxGeometry(),steel=new THREE.MeshStandardMaterial({color:0x4a5a60,metalness:.25,roughness:.72});steel.name='Distant / port infrastructure';
  for(let i=0;i<7;i++){
    const shed=new THREE.Mesh(box,steel);shed.scale.set(48+i%2*24,11+i%3*5,90);shed.position.set(-830-i*85,shed.scale.y/2-1,-200+i*115);shed.name='Distant port shed';group.add(shed);
  }
  // The north exit faces a rail/utility horizon, with a long low viaduct and
  // three tapered transmission frames against the upland. This is one distant
  // infrastructure composition, rather than another array of city tower boxes.
  const infrastructure=[],beaconPositions=[],tmp=new THREE.Object3D();
  const element=(size,position,rotation=[0,0,0])=>infrastructure.push({size,position,rotation});
  element([450,4.2,17],[-150,10.4,796]);
  for(const x of [-350,-245,-140,-35,70]){element([5.2,14,6.0],[x,3.8,796]);element([22,1.4,19],[x,7.8,796]);}
  for(const [i,x]of [-285,-82,132].entries()){
    const h=[50,37,61][i],z=815+i*17;
    for(const side of [-1,1])element([1.1,h,1.4],[x+side*6.3,h/2-1.4,z],[0,0,side*.115]);
    for(const fraction of [.44,.74,.92])element([fraction>.8?15:22,1.05,2.1],[x,h*fraction-1.4,z]);
    for(let k=0;k<4;k++)element([.62,h*.20,1.1],[x+(k%2?2:-2),h*(.17+k*.19)-1.4,z],[0,0,k%2?.57:-.57]);
    beaconPositions.push([x,h*.92-.6,z]);
  }
  const belt=new THREE.InstancedMesh(box,steel,infrastructure.length);belt.name='North rail viaduct and transmission frames / distant';belt.userData.renderDetail='mass';
  infrastructure.forEach((item,i)=>{tmp.position.set(...item.position);tmp.rotation.set(...item.rotation);tmp.scale.set(...item.size);tmp.updateMatrix();belt.setMatrixAt(i,tmp.matrix);});belt.computeBoundingSphere();group.add(belt);
  const beaconMaterial=new THREE.MeshStandardMaterial({color:0xc89275,emissive:0xd5926c,emissiveIntensity:0,roughness:.7});beaconMaterial.name='Distant / fixed marker lens';
  const beacons=new THREE.InstancedMesh(box,beaconMaterial,beaconPositions.length);beacons.name='Transmission marker lenses / emissive only';beacons.userData.renderDetail='mass';
  beaconPositions.forEach((p,i)=>{tmp.position.set(...p);tmp.rotation.set(0,0,0);tmp.scale.set(1.1,.62,1.1);tmp.updateMatrix();beacons.setMatrixAt(i,tmp.matrix);});beacons.computeBoundingSphere();group.add(beacons);
  return {group,stats:{...CITY_HORIZON,triangles:indices.length/3+2+(7+infrastructure.length+beaconPositions.length)*12,renderBatches:11,nonPlayableInfrastructure:'North rail approach and three transmission frames; marker lenses are emissive scenery, not runtime street-light sources.'},setNight(night){material.color.set(night?0x7f90a2:0xffffff);beaconMaterial.emissiveIntensity=night?.5:0;}};
}
