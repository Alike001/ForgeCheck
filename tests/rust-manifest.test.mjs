import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {inspectCargoManifest,inspectCargoManifestFile}from '../src/modules/rust-manifest/index.mjs';
const codes=r=>r.diagnostics.map(d=>d.code);
test('direct Soroban dependency and lib crate types are reported',()=>{
 const r=inspectCargoManifest('[package]\nname="contract"\n[lib]\ncrate-type=["cdylib","rlib"]\n[dependencies]\nsoroban-sdk="22.0"');
 assert.equal(r.status,'inspected');assert.equal(r.packageName,'contract');assert.deepEqual(r.crateTypes,['cdylib','rlib']);
 assert.equal(r.sdk[0].versionRequirement,'22.0');assert.equal(r.sdk[0].versionResolved,null);
});
test('workspace dependency is inherited without resolving the version',()=>{
 const r=inspectCargoManifest('[workspace]\n[workspace.dependencies]\nsoroban-sdk="21"\n[dependencies]\nsoroban-sdk={workspace=true}');
 assert.equal(r.sdk[0].versionRequirement,'21');assert.equal(r.sdk[0].workspaceInherited,true);
});
test('external workspace manifest supplied explicitly',()=>{
 const r=inspectCargoManifest('[package]\nname="m"\n[dependencies]\nsoroban-sdk={workspace=true}',{workspaceToml:'[workspace.dependencies]\nsoroban-sdk={version="22",features=["testutils"]}'});
 assert.equal(r.sdk[0].versionRequirement,'22');
});
test('renamed dependency maps to soroban-sdk',()=>{
 const r=inspectCargoManifest('[dependencies]\nsteller={package="soroban-sdk",version="^21"}');
 assert.equal(r.sdk[0].name,'steller');assert.equal(r.sdk[0].package,'soroban-sdk');assert.equal(r.sdk[0].versionRequirement,'^21');
});
test('custom release profiles are summarized',()=>{
 const r=inspectCargoManifest('[profile.release]\nopt-level="z"\nlto=true\ncodegen-units=1\npanic="abort"');
 assert.deepEqual(r.profiles,[{name:'release',settings:{'opt-level':'z',lto:true,'codegen-units':1,panic:'abort'}}]);
});
test('malformed toml and invalid crate type are errors',()=>{
 assert.equal(inspectCargoManifest('[dependencies]\nsoroban-sdk={version=').status,'invalid');
 assert.ok(codes(inspectCargoManifest('[lib]\ncrate-type=123')).includes('invalid-crate-type'));
});
test('absent and unrelated dependencies never fabricate an SDK version',()=>{
 for(const manifest of ['[dependencies]\nserde="1"','[package]\nname="hello"']){
   const r=inspectCargoManifest(manifest);assert.equal(r.sdk.length,0);assert.ok(codes(r).includes('soroban-sdk-not-declared'));
 }
});
test('workspace-only dependency is not claimed to be in use',()=>{
 const r=inspectCargoManifest('[workspace.dependencies]\nsoroban-sdk="22"');
 assert.equal(r.sdk[0].scope,'workspace-only');assert.ok(codes(r).includes('workspace-only-not-consumed'));
});
test('unresolved inherited version remains unknown',()=>{
 const r=inspectCargoManifest('[dependencies]\nsoroban-sdk={workspace=true}');assert.equal(r.sdk[0].versionRequirement,null);
 assert.ok(codes(r).includes('unresolved-workspace-inheritance'));
});
test('source path dependency without version is only a review',()=>{
 const r=inspectCargoManifest('[dependencies]\nsoroban-sdk={path="../local"}');
 assert.equal(r.status,'inspected');assert.ok(codes(r).includes('version-not-declared'));
});
test('target-specific patterns are declared out of scope instead of skipped silently',()=>{
 const r=inspectCargoManifest('[target.wasm32.dependencies]\nsoroban-sdk="22"');
 assert.ok(codes(r).includes('target-specific-dependencies-not-inspected'));
});
test('file API only reads local manifest and rejects symbolic links',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'cargo-manifest-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const filename=join(dir,'Cargo.toml');await writeFile(filename,'[dependencies]\nsoroban-sdk="23"');
 assert.equal((await inspectCargoManifestFile(filename)).sdk[0].versionRequirement,'23');
 const link=join(dir,'link');try{await symlink(filename,link);assert.equal((await inspectCargoManifestFile(link)).status,'invalid');}catch(e){if(e.code!=='EPERM')throw e;}
});
test('inspection never calls fetch or executes Cargo',()=>{
 const old=globalThis.fetch;globalThis.fetch=()=>{throw Error('network forbidden');};
 try{assert.equal(inspectCargoManifest('[dependencies]\nsoroban-sdk="21"').status,'inspected');}finally{globalThis.fetch=old;}
});
test('unsupported valid TOML constructs are explicitly not evaluated',()=>{
 const r=inspectCargoManifest('[package]\ncreated=2026-10-24');assert.equal(r.status,'not-evaluated');assert.equal(r.diagnostics[0].severity,'review');
});
