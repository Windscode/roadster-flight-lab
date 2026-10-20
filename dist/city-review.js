// Fixed review views do not move the car and are not route-driving evidence.
// They share the ordinary main camera, weather and exposure controls.
export const CITY_REVIEW_CAMERAS=Object.freeze([
  {id:'cross-east-gateway',name:'08 / 横街工业转角',position:[58,2.1,-135],target:[135,5,-146],fov:48},
  {id:'foundry-work-bay',name:'09 / 机造维护庭',position:[103,2.3,243],target:[138,2.8,246],fov:48},
  {id:'terrace-arrival',name:'10 / 台地坡顶导向',position:[270,9.5,300],target:[310,10,319],fov:48},
  {id:'forum-arrival',name:'11 / 议庭入口铺装',position:[488,10.2,342],target:[528,13,367],fov:48},
  {id:'south-arrival',name:'12 / 南岸到达与步行转换',position:[-426,2.2,-407],target:[-430,3,-444],fov:48},
  {id:'watercourt-interior',name:'13 / 水庭内部待实测视点',position:[-430,3.4,-476],target:[-430,4,-514],fov:48},
  ...[['north',[0,80,560]],['east',[560,80,0]],['south',[0,80,-560]],['west',[-560,80,0]]].map(([direction,target],i)=>({id:'sky-120-'+direction,name:(14+i)+' / 120 m · '+direction,position:[0,120,0],target,fov:60})),
]);

export const CITY_REVIEW_ROUTE=Object.freeze({
  id:'cross-district-waterfront-314',
  scope:'Navigation description on the existing road network; no teleportation or automatic-driving claim. The user physically completed the baseline 3.13 route; final-build native coverage remains separate.',
  legs:['织桥 / 交换厅 → 中央横街','中央横街 → 机造大道与服务桥','台地入口 → 原西坡道 → 议庭西入口','议庭前街 → 原坡道返程','南岸联络大道旧 canal → 新水庭到达区'],
  acceptance:'Continuous inputs and chained physical snapshots, actual main-camera video, same weather/quality/resolution, no reposition/reset. Static views do not satisfy this route gate.',
});
