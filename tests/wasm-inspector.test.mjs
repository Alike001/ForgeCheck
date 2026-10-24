import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,symlink}from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectWasmArtifact,inspectWasmArtifactFile}from '../src/modules/wasm-inspector/index.mjs';
const header=[0,97,115,109,1,0,0,0];
function leb(n){const out=[];do{let b=n%128;n=Math.floor(n/128);if(n)b|=128;out.push(b);}while(n);return out;}
function sec(id,data){return [id,...leb(data.length),...data];}
function named(name){const bytes=Array.from(new TextEncoder().encode(name));return sec(0,[...leb(bytes.length),...bytes]);}
const inspect=(...sections)=>inspectWasmArtifact(Uint8Array.from([...header,...sections.flat()]));
const codes=r=>r.diagnostics.map(x=>x.code);
test('valid minimal Wasm has review note, not invalid artifact',()=>{
 const r=inspect();assert.equal(r.status,'inspected');assert.equal(r.validFraming,true);assert.ok(codes(r).includes('contract-metadata-absent'));
});
test('metadata section names are reported, no payload interpreted',()=>{
 const r=inspect(named('contractspecv0'),named('contractmetav0'),named('contractenvmetav0'));
 assert.equal(r.status,'inspected');assert.deepEqual(r.customSections,['contractspecv0','contractmetav0','contractenvmetav0']);assert.ok(Object.values(r.metadata).every(Boolean));assert.equal(r.diagnostics.length,0);
});
test('unknown custom section names are permitted',()=>assert.deepEqual(inspect(named('producer-note')).customSections,['producer-note']));
test('invalid magic and version fail',()=>{
 assert.ok(codes(inspectWasmArtifact(Uint8Array.from([1,...header.slice(1)]))).includes('invalid-magic'));
 assert.ok(codes(inspectWasmArtifact(Uint8Array.from([0,97,115,109,2,0,0,0]))).includes('unsupported-version'));
});
test('truncated input and section payloads fail',()=>{
 assert.ok(codes(inspectWasmArtifact(Uint8Array.from(header.slice(0,6)))).includes('truncated-header'));
 assert.ok(codes(inspect([1,5,0])).includes('truncated-section'));
});
test('truncated, overflowing and overlong leb128 fail',()=>{
 assert.ok(codes(inspect([1,0x80])).includes('truncated-leb128'));
 assert.ok(codes(inspect([1,0xff,0xff,0xff,0xff,0x1f])).includes('leb128-overflow'));
 assert.ok(codes(inspect([1,0x80,0x80,0x80,0x80,0x80])).includes('leb128-overflow')||codes(inspect([1,0x80,0x80,0x80,0x80,0x80])).includes('leb128-overlong'));
});
test('maliciously huge declared sections fail without allocation',()=>{
 assert.ok(codes(inspect([1,...leb(16*1024*1024+1)])).includes('section-size-limit'));
 assert.ok(codes(inspectWasmArtifact(new Uint8Array(16*1024*1024+1))).includes('artifact-size-limit'));
});
test('duplicate and out-of-order sections rejected',()=>{
 assert.ok(codes(inspect(sec(1,[0]),sec(1,[0]))).includes('duplicate-section'));
 assert.ok(codes(inspect(sec(2,[0]),sec(1,[0]))).includes('out-of-order-section'));
});
test('data-count section can legally precede code',()=>assert.equal(inspect(sec(12,[0]),sec(10,[0])).status,'inspected'));
test('custom section name truncation, invalid utf8 and excessive name are errors',()=>{
 assert.ok(codes(inspect(sec(0,[10,65]))).includes('truncated-custom-name'));
 assert.ok(codes(inspect(sec(0,[1,255]))).includes('invalid-custom-name-utf8'));
 assert.ok(codes(inspect(sec(0,[...leb(257),...Array(257).fill(65)]))).includes('custom-name-limit'));
});
test('start section presence emits review note, not proof of execution',()=>{
 assert.ok(codes(inspect(sec(8,[0]))).includes('start-section-present'));
});
test('local file inspection and symlink refusal',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'wasm-inspect-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=join(dir,'module.wasm');await writeFile(file,Uint8Array.from(header));assert.equal((await inspectWasmArtifactFile(file)).status,'inspected');
 const link=join(dir,'alias.wasm');try{await symlink(file,link);assert.equal((await inspectWasmArtifactFile(link)).status,'invalid');}catch(e){if(e.code!=='EPERM')throw e;}
});
test('artifacts never compiled or instantiated',()=>{
 const old1=WebAssembly.compile,old2=WebAssembly.instantiate;WebAssembly.compile=()=>{throw Error('compiled');};WebAssembly.instantiate=()=>{throw Error('run');};
 try{assert.equal(inspect(named('contractspecv0')).status,'inspected');}finally{WebAssembly.compile=old1;WebAssembly.instantiate=old2;}
});
