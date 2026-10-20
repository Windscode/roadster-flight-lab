// Read only during an explicitly requested audit. Framebuffer status belongs
// to the *bound* WebGL framebuffer, not merely renderer.getRenderTarget().
const finite=v=>Number.isFinite(v)?v:null;
const statusNames={36053:'FRAMEBUFFER_COMPLETE',36054:'FRAMEBUFFER_INCOMPLETE_ATTACHMENT',36055:'FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT',36057:'FRAMEBUFFER_INCOMPLETE_DIMENSIONS',36061:'FRAMEBUFFER_UNSUPPORTED',36182:'FRAMEBUFFER_INCOMPLETE_MULTISAMPLE'};
export function describeRenderTarget(target,renderer){
  const texture=t=>t?{name:t.name||null,uuid:t.uuid??null,type:t.type??null,format:t.format??null,internalFormat:t.internalFormat??null,generateMipmaps:!!t.generateMipmaps,images:(Array.isArray(t.image)?t.image:[t.image]).map(i=>({width:finite(i?.width),height:finite(i?.height),depth:finite(i?.depth)}))}:null;
  return target?{kind:target.isWebGLCubeRenderTarget?'cube':'2d',name:target.texture?.name||'offscreen',width:finite(target.width),height:finite(target.height),depth:finite(target.depth),validDimensions:Number.isInteger(target.width)&&target.width>0&&Number.isInteger(target.height)&&target.height>0,face:renderer.getActiveCubeFace?.()??null,mip:renderer.getActiveMipmapLevel?.()??null,samples:target.samples??0,depthBuffer:!!target.depthBuffer,stencilBuffer:!!target.stencilBuffer,textures:(target.textures||[target.texture]).map(texture),depthTexture:texture(target.depthTexture)}:{kind:'default',name:'default-framebuffer',width:finite(renderer.domElement?.width),height:finite(renderer.domElement?.height),validDimensions:true,face:null,mip:null,samples:null};
}
export function createFramebufferInspector(gl,renderer){
  const ids=new WeakMap();let serial=0;
  const id=object=>{if(!object||typeof object!=='object')return null;if(!ids.has(object))ids.set(object,++serial);return ids.get(object);};
  return function inspect(){
    const target=describeRenderTarget(renderer.getRenderTarget?.(),renderer);
    if(typeof gl.checkFramebufferStatus!=='function')return {available:false,target,reason:'Framebuffer query unavailable in this interface'};
    const bound=gl.getParameter(gl.FRAMEBUFFER_BINDING),status=gl.checkFramebufferStatus(gl.FRAMEBUFFER),attachments=[];
    if(bound&&typeof gl.getFramebufferAttachmentParameter==='function'){
      const queries=[['color0',gl.COLOR_ATTACHMENT0],['depth',gl.DEPTH_ATTACHMENT],['stencil',gl.STENCIL_ATTACHMENT]];
      for(const [name,attachment]of queries){
        const type=gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER,attachment,gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE);
        const row={name,type,objectId:null};
        if(type!==gl.NONE){
          const object=gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER,attachment,gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME);row.objectId=id(object);
          if(type===gl.TEXTURE){row.textureLevel=gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER,attachment,gl.FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL);row.cubeFace=gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER,attachment,gl.FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE);}
          if(type===gl.RENDERBUFFER&&typeof gl.getRenderbufferParameter==='function'){
            const previous=gl.getParameter(gl.RENDERBUFFER_BINDING);
            try{gl.bindRenderbuffer(gl.RENDERBUFFER,object);row.width=gl.getRenderbufferParameter(gl.RENDERBUFFER,gl.RENDERBUFFER_WIDTH);row.height=gl.getRenderbufferParameter(gl.RENDERBUFFER,gl.RENDERBUFFER_HEIGHT);row.internalFormat=gl.getRenderbufferParameter(gl.RENDERBUFFER,gl.RENDERBUFFER_INTERNAL_FORMAT);if(gl.RENDERBUFFER_SAMPLES)row.samples=gl.getRenderbufferParameter(gl.RENDERBUFFER,gl.RENDERBUFFER_SAMPLES);}
            finally{gl.bindRenderbuffer(gl.RENDERBUFFER,previous);}
          }
        }
        attachments.push(row);
      }
    }
    return {available:true,framebufferId:bound?id(bound):'default',status,statusName:statusNames[status]||'UNKNOWN_FRAMEBUFFER_STATUS',complete:status===gl.FRAMEBUFFER_COMPLETE,target,attachments,scope:'Framebuffer status and attachment identities queried on the actual bound framebuffer. Texture dimensions are CPU allocation descriptors; renderbuffer dimensions are queried from the driver.'};
  };
}
