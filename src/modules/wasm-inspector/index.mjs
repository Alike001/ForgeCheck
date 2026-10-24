import {open, lstat} from 'node:fs/promises';
import {constants} from 'node:fs';

const MAX_BYTES=16*1024*1024;
const MAX_SECTIONS=4096;
const MAX_NAME_BYTES=256;
const METADATA=['contractspecv0','contractmetav0','contractenvmetav0'];
const REFERENCE='https://www.w3.org/TR/wasm-core-2/';
const ORDER=new Map([1,2,3,4,5,6,7,8,9,12,10,11].map((id,i)=>[id,i]));
const decoder=new TextDecoder('utf-8',{fatal:true});
const diag=(code,severity,offset)=>({code,severity,offset,reference:REFERENCE});
class WasmFramingError extends Error{constructor(code,offset){super(code);this.code=code;this.offset=offset;}}
function varU32(bytes,offset,end) {
  let value=0;
  for(let i=0;i<5;i++){
    if(offset+i>=end)throw new WasmFramingError('truncated-leb128',offset);
    const b=bytes[offset+i];
    if(i===4&&(b&0xf0)!==0)throw new WasmFramingError('leb128-overflow',offset);
    value+=(b&0x7f)*2**(7*i);
    if((b&0x80)===0)return {value,offset:offset+i+1};
  }
  throw new WasmFramingError('leb128-overlong',offset);
}
/** Framing inspection only: this function does not compile, link, instantiate, or run Wasm. */
export function inspectWasmArtifact(input) {
  const empty={status:'invalid',validFraming:false,version:null,byteLength:0,sections:[],customSections:[],metadata:Object.fromEntries(METADATA.map(s=>[s,false])),diagnostics:[]};
  if(!(input instanceof Uint8Array))return {...empty,diagnostics:[diag('invalid-input','error',0)]};
  const bytes=input, size=bytes.byteLength;
  const result={...empty,byteLength:size};
  const fail=(code,offset)=>{result.diagnostics.push(diag(code,'error',offset));return result;};
  if(size>MAX_BYTES)return fail('artifact-size-limit',0);
  if(size<8)return fail('truncated-header',size);
  if(bytes[0]!==0||bytes[1]!==0x61||bytes[2]!==0x73||bytes[3]!==0x6d)return fail('invalid-magic',0);
  if(bytes[4]!==1||bytes[5]!==0||bytes[6]!==0||bytes[7]!==0)return fail('unsupported-version',4);
  result.version=1;
  let offset=8,lastOrder=-1;
  const seen=new Set();
  while(offset<size){
    if(result.sections.length>=MAX_SECTIONS)return fail('section-count-limit',offset);
    const start=offset,id=bytes[offset++];
    if(id>12)return fail('invalid-section-id',start);
    let length;
    try {const leb=varU32(bytes,offset,size);length=leb.value;offset=leb.offset;}
    catch(e){return fail(e instanceof WasmFramingError?e.code:'invalid-leb128',start);}
    if(length>MAX_BYTES)return fail('section-size-limit',start);
    if(length>size-offset)return fail('truncated-section',start);
    const end=offset+length;
    if(id!==0){
      if(seen.has(id))return fail('duplicate-section',start);
      seen.add(id);
      const order=ORDER.get(id);
      if(order<=lastOrder)return fail('out-of-order-section',start);
      lastOrder=order;
    }
    const item={id,offset:start,byteLength:length};
    if(id===0){
      let name;
      try{
        const nameLength=varU32(bytes,offset,end);
        if(nameLength.value>MAX_NAME_BYTES)throw new WasmFramingError('custom-name-limit',offset);
        if(nameLength.value>end-nameLength.offset)throw new WasmFramingError('truncated-custom-name',offset);
        name=decoder.decode(bytes.subarray(nameLength.offset,nameLength.offset+nameLength.value));
      }catch(e){return fail(e instanceof WasmFramingError?e.code:'invalid-custom-name-utf8',start);}
      item.name=name;
      result.customSections.push(name);
      if(Object.hasOwn(result.metadata,name))result.metadata[name]=true;
    }
    result.sections.push(item);offset=end;
  }
  result.validFraming=true;result.status='inspected';
  if(!METADATA.some(name=>result.metadata[name])) result.diagnostics.push(diag('contract-metadata-absent','review',8));
  else for(const name of METADATA)if(!result.metadata[name])result.diagnostics.push(diag(`metadata-absent:${name}`,'review',8));
  if(seen.has(8))result.diagnostics.push(diag('start-section-present','review',8));
  return result;
}
export async function inspectWasmArtifactFile(path) {
  let handle;
  try {
    if((await lstat(path)).isSymbolicLink())throw new Error('symlink');
    handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
    const buffer=Buffer.alloc(MAX_BYTES+1);let n=0;
    while(n<buffer.length){const r=await handle.read(buffer,n,buffer.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead;}
    return inspectWasmArtifact(buffer.subarray(0,n));
  } catch {return {...inspectWasmArtifact(new Uint8Array()),diagnostics:[diag('unreadable-file','error',0)]};}
  finally {await handle?.close();}
}
