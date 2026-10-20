// A small STORE-only ZIP writer for original rendered PNG + same-frame JSON.
// No resampling, recompression, generated pixels, network or third-party service.
const encoder=new TextEncoder();
const table=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc32(bytes){let c=0xffffffff;for(const byte of bytes)c=table[(c^byte)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
const header=n=>{const bytes=new Uint8Array(n);return{bytes,view:new DataView(bytes.buffer)};};

export async function captureArchive(files){
  if(!Array.isArray(files)||!files.length||files.length>32)throw new RangeError('Invalid capture archive');
  const local=[],central=[];let offset=0,centralSize=0;
  const names=new Set();
  for(const file of files){
    if(typeof file.name!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(file.name)||names.has(file.name))throw new Error('Invalid capture filename');
    names.add(file.name);
    const name=encoder.encode(file.name),data=typeof file.data==='string'?encoder.encode(file.data):file.data instanceof Uint8Array?file.data:new Uint8Array(await file.data.arrayBuffer());
    if(data.byteLength>256*1024*1024)throw new RangeError('Capture exceeds ZIP size budget');
    const checksum=crc32(data),a=header(30),b=header(46);
    a.view.setUint32(0,0x04034b50,true);a.view.setUint16(4,20,true);a.view.setUint16(6,0x0800,true);a.view.setUint16(12,33,true);
    a.view.setUint32(14,checksum,true);a.view.setUint32(18,data.length,true);a.view.setUint32(22,data.length,true);a.view.setUint16(26,name.length,true);
    b.view.setUint32(0,0x02014b50,true);b.view.setUint16(4,20,true);b.view.setUint16(6,20,true);b.view.setUint16(8,0x0800,true);b.view.setUint16(14,33,true);
    b.view.setUint32(16,checksum,true);b.view.setUint32(20,data.length,true);b.view.setUint32(24,data.length,true);b.view.setUint16(28,name.length,true);b.view.setUint32(42,offset,true);
    local.push(a.bytes,name,data);central.push(b.bytes,name);offset+=a.bytes.length+name.length+data.length;centralSize+=b.bytes.length+name.length;
  }
  const end=header(22);end.view.setUint32(0,0x06054b50,true);end.view.setUint16(8,files.length,true);end.view.setUint16(10,files.length,true);end.view.setUint32(12,centralSize,true);end.view.setUint32(16,offset,true);
  return new Blob([...local,...central,end.bytes],{type:'application/zip'});
}
