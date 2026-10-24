import {open, lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {parseToml, TomlError} from './toml.mjs';

const REFERENCE='https://doc.rust-lang.org/cargo/reference/specifying-dependencies.html';
const WORKSPACE_REFERENCE='https://doc.rust-lang.org/cargo/reference/workspaces.html';
const MAX_BYTES=1024*1024;
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const diag=(code,severity,field,line=0,reference=REFERENCE)=>({code,severity,field,line,reference});
/** Inspect declarations, never resolve dependency versions or execute Cargo. */
export function inspectCargoManifest(text,{workspaceToml}={}) {
  let main, workspace;
  try {main=parseToml(text,MAX_BYTES);workspace=workspaceToml===undefined?main:parseToml(workspaceToml,MAX_BYTES);}
  catch(e){const code=e instanceof TomlError?e.code:'invalid-input';const unsupported=code.startsWith('unsupported-');return {status:unsupported?'not-evaluated':'invalid',diagnostics:[diag(code,unsupported?'review':'error','',e instanceof TomlError?e.line:0)],packageName:null,crateTypes:[],profiles:[],sdk:[]};}
  const diagnostics=[],sdk=[],profiles=[];
  const {data,locations}=main;
  const place=(field)=>locations[field]??0;
  const add=(code,severity,field,reference=REFERENCE)=>diagnostics.push(diag(code,severity,field,place(field),reference));
  const packageName=typeof data.package?.name==='string'?data.package.name:null;
  if(Object.hasOwn(data,'package')&&!record(data.package))add('invalid-package','error','package');
  if(Object.hasOwn(data,'lib')&&!record(data.lib))add('invalid-lib','error','lib');
  const crateTypes=[];
  if(data.lib&&Object.hasOwn(data.lib,'crate-type')) {
    const types=data.lib['crate-type'];
    if(!Array.isArray(types)||types.some(x=>typeof x!=='string'))add('invalid-crate-type','error','lib.crate-type');
    else crateTypes.push(...types);
  }
  if(data.profile!==undefined) {
    if(!record(data.profile))add('invalid-profiles','error','profile');
    else for(const [name,profile] of Object.entries(data.profile)) {
      if(!record(profile)){add('invalid-profile','error','profile.'+name);continue;}
      const settings={};
      for(const key of ['opt-level','lto','codegen-units','panic','strip','debug']) if(Object.hasOwn(profile,key)) {
        const val=profile[key];
        if(['string','number','boolean'].includes(typeof val))settings[key]=val;
        else add('unsupported-profile-value','review',`profile.${name}.${key}`);
      }
      profiles.push({name,settings});
    }
  }
  const workspaceDeps=workspace.data.workspace?.dependencies;
  if(workspaceDeps!==undefined&&!record(workspaceDeps))add('invalid-workspace-dependencies','error','workspace.dependencies',WORKSPACE_REFERENCE);
  const decode=(key,value,path,scope)=>{
    let pkg=key,version=null,inherit=false;
    if(typeof value==='string')version=value;
    else if(record(value)){
      if(Object.hasOwn(value,'package')){
        if(typeof value.package!=='string') {add('invalid-package-alias','error',path);return;}
        pkg=value.package;
      }
      if(Object.hasOwn(value,'version')) {
        if(typeof value.version!=='string'){add('invalid-version','error',path);return;}
        version=value.version;
      }
      if(Object.hasOwn(value,'workspace')) {
        if(value.workspace!==true){add('invalid-workspace-flag','error',path);return;}
        inherit=true;
      }
      if(Object.hasOwn(value,'git')||Object.hasOwn(value,'path'))add('non-registry-dependency','review',path);
    } else {add('invalid-dependency','error',path);return;}
    if(pkg!=='soroban-sdk')return;
    if(inherit){
      const w=record(workspaceDeps)?workspaceDeps[key]:undefined;
      if(w===undefined){add('unresolved-workspace-inheritance','review',path,WORKSPACE_REFERENCE);version=null;}
      else if(typeof w==='string')version=w;
      else if(record(w)){
        if(w.package!==undefined&&w.package!=='soroban-sdk') {add('workspace-package-mismatch','error',path);return;}
        if(w.version!==undefined&&typeof w.version!=='string'){add('invalid-workspace-version','error',path);return;}
        version=typeof w.version==='string'?w.version:null;
      }else {add('invalid-workspace-dependency','error',path);return;}
    }
    if(version!==null && !version.trim()) {add('empty-version','error',path);version=null;}
    if(version===null)add('version-not-declared','review',path);
    sdk.push({name:key,package:'soroban-sdk',scope,versionRequirement:version,versionResolved:null,workspaceInherited:inherit});
  };
  for(const scope of ['dependencies','dev-dependencies','build-dependencies']) {
    const table=data[scope];
    if(table===undefined)continue;
    if(!record(table)){add('invalid-dependencies-table','error',scope);continue;}
    for(const [key,value] of Object.entries(table))decode(key,value,`${scope}.${key}`,scope);
  }
  if(data.target!==undefined) add('target-specific-dependencies-not-inspected','review','target');
  // A virtual workspace declaration does not prove a crate actually uses a dependency.
  if(sdk.length===0&&record(workspaceDeps)) {
    for(const [key,value] of Object.entries(workspaceDeps)){
      const pkg=record(value)?value.package??key:key;
      if(pkg==='soroban-sdk') {
        decode(key,value,`workspace.dependencies.${key}`,'workspace-only');
        add('workspace-only-not-consumed','review',`workspace.dependencies.${key}`,WORKSPACE_REFERENCE);
      }
    }
  }
  if(sdk.length===0)add('soroban-sdk-not-declared','review','dependencies');
  if(sdk.some(s=>s.versionRequirement!==null))add('declared-range-not-resolved','review','dependencies');
  sdk.sort((a,b)=>a.scope.localeCompare(b.scope)||a.name.localeCompare(b.name));
  profiles.sort((a,b)=>a.name.localeCompare(b.name));
  diagnostics.sort((a,b)=>a.line-b.line||a.field.localeCompare(b.field)||a.code.localeCompare(b.code));
  return {status:diagnostics.some(x=>x.severity==='error')?'invalid':'inspected',packageName,crateTypes,profiles,sdk,diagnostics};
}
async function readBounded(path){
  if((await lstat(path)).isSymbolicLink())throw new Error('symlink');
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const buffer=Buffer.alloc(MAX_BYTES+1);let n=0;
    while(n<buffer.length){const r=await handle.read(buffer,n,buffer.length-n,n);if(r.bytesRead===0)break;n+=r.bytesRead;}
    if(n>MAX_BYTES)throw new Error('oversize');
    return buffer.subarray(0,n).toString('utf8');
  } finally {await handle.close();}
}
export async function inspectCargoManifestFile(path,{workspacePath}={}) {
  try {const text=await readBounded(path);const workspaceToml=workspacePath===undefined?undefined:await readBounded(workspacePath);return inspectCargoManifest(text,{workspaceToml});}
  catch {return {status:'invalid',packageName:null,crateTypes:[],profiles:[],sdk:[],diagnostics:[diag('unreadable-file','error','')]};}
}
