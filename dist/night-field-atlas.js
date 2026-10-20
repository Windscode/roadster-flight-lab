// Preserve the original RGBA half-float coefficients. The city and route
// volumes share height/direction layers; an X atlas needs one sampler instead
// of two without changing spatial resolution or light energy.
export function packNightFieldAtlas(city,route){
  const check=(image,label)=>{
    if(!image||![image.width,image.height,image.depth].every(v=>Number.isInteger(v)&&v>0)||
      !(image.data instanceof Uint16Array)||image.data.length!==image.width*image.height*image.depth*4)
      throw Error('Invalid '+label+' night-field image');
  };
  check(city,'city');check(route,'route');
  if(city.depth!==route.depth)throw Error('Night-field atlas requires matching height/direction layers');
  const width=city.width+route.width,height=Math.max(city.height,route.height),depth=city.depth;
  const data=new Uint16Array(width*height*depth*4);
  for(const [image,offsetX]of [[city,0],[route,city.width]]){
    for(let z=0;z<depth;z++)for(let y=0;y<image.height;y++){
      const source=(z*image.height+y)*image.width*4,target=((z*height+y)*width+offsetX)*4;
      data.set(image.data.subarray(source,source+image.width*4),target);
    }
  }
  return{data,width,height,depth,routeOffsetX:city.width,
    sourceBytes:city.data.byteLength+route.data.byteLength,paddingBytes:data.byteLength-city.data.byteLength-route.data.byteLength};
}
