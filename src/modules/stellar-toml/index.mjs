import { open, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { parseToml, TomlError } from './toml.mjs';

const REFERENCE='https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0001.md';
const MAX_BYTES=100*1024;
const HTTPS_FIELDS=['FEDERATION_SERVER','AUTH_SERVER','TRANSFER_SERVER','TRANSFER_SERVER_SEP0024','KYC_SERVER','WEB_AUTH_ENDPOINT','WEB_AUTH_FOR_CONTRACTS_ENDPOINT','DIRECT_PAYMENT_SERVER','ANCHOR_QUOTE_SERVER'];
const OTHER_URL_FIELDS=['HORIZON_URL'];
const KEY_FIELDS=['SIGNING_KEY','URI_REQUEST_SIGNING_KEY'];
const PUBLIC_KEY=/^G[A-Z2-7]{55}$/;
const isRecord=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const diagnostic=(code,severity,field,line)=>({code,severity,field,line,reference:REFERENCE});
function secureUrl(value,https) {
  if(typeof value!=='string') return null;
  try {
    const u=new URL(value);
    if ((https && u.protocol!=='https:') || (!https && !['http:','https:'].includes(u.protocol)) || !u.hostname || u.username || u.password) return null;
    // Query fragments can contain tokens; do not surface them in result data.
    return u.origin+u.pathname;
  } catch {return null;}
}
/** Validate text only; never resolve a domain or evaluate a project module. */
export function validateStellarToml(text) {
  const diagnostics=[];
  let parsed;
  try { parsed=parseToml(text,MAX_BYTES); }
  catch(e) {
    const code=e instanceof TomlError?e.code:'invalid-input';
    const unsupported=code.startsWith('unsupported-');
    return {status:unsupported?'not-evaluated':'invalid', valid:false, diagnostics:[diagnostic(code,unsupported?'review':'error','',e instanceof TomlError?e.line:0)],summary:null};
  }
  const {data,locations}=parsed;
  const add=(code,severity,field)=>diagnostics.push(diagnostic(code,severity,field,locations[field]??0));
  const endpoints=Object.create(null), fields=[];
  for(const key of Object.keys(data)) if(!['CURRENCIES','DOCUMENTATION'].includes(key)) fields.push(key);
  const checkString=(object,field,path)=>{
    if(Object.hasOwn(object,field)&&typeof object[field]!=='string')add('expected-string','error',path);
  };
  for(const key of ['NETWORK_PASSPHRASE','VERSION',...KEY_FIELDS]) checkString(data,key,key);
  if(Object.hasOwn(data,'ACCOUNTS')){
    if(!Array.isArray(data.ACCOUNTS)||data.ACCOUNTS.some(x=>typeof x!=='string')) add('expected-string-list','error','ACCOUNTS');
    else {
      if(data.ACCOUNTS.some(x=>!PUBLIC_KEY.test(x))) add('invalid-account-key-format','error','ACCOUNTS');
      if(new Set(data.ACCOUNTS).size!==data.ACCOUNTS.length) add('duplicate-account','review','ACCOUNTS');
    }
  }
  for(const key of KEY_FIELDS) if(typeof data[key]==='string'&&!PUBLIC_KEY.test(data[key]))add('invalid-public-key-format','error',key);
  for(const key of [...HTTPS_FIELDS,...OTHER_URL_FIELDS]) if(Object.hasOwn(data,key)) {
    const url=secureUrl(data[key],HTTPS_FIELDS.includes(key));
    if(!url)add('invalid-url','error',key);else endpoints[key]=url;
  }
  if(Object.hasOwn(data,'DOCUMENTATION')){
    if(!isRecord(data.DOCUMENTATION))add('expected-table','error','DOCUMENTATION');
    else {
      for(const key of ['ORG_NAME','ORG_DBA','ORG_DESCRIPTION','ORG_PHYSICAL_ADDRESS'])checkString(data.DOCUMENTATION,key,'DOCUMENTATION.'+key);
      for(const key of ['ORG_URL','ORG_LOGO','ORG_PHYSICAL_ADDRESS_ATTESTATION'])if(Object.hasOwn(data.DOCUMENTATION,key)){
        const path='DOCUMENTATION.'+key;
        if(!secureUrl(data.DOCUMENTATION[key],key!=='ORG_LOGO'))add('invalid-url','error',path);
      }
    }
  }
  let currencies=0;
  if(Object.hasOwn(data,'CURRENCIES')) {
    if(!Array.isArray(data.CURRENCIES)||data.CURRENCIES.some(x=>!isRecord(x)))add('expected-currency-tables','error','CURRENCIES');
    else {
      currencies=data.CURRENCIES.length;
      const known=new Set();
      data.CURRENCIES.forEach((currency,i)=>{
        const path=`CURRENCIES[${i}]`;
        if(Object.hasOwn(currency,'toml')) {
          if(Object.keys(currency).length!==1) add('conflicting-currency-reference','error',path);
          if(!secureUrl(currency.toml,true))add('invalid-url','error',path+'.toml');
        } else {
          if(typeof currency.code!=='string'||!/^[A-Za-z0-9]{1,12}$/.test(currency.code))add('invalid-currency-code','error',path+'.code');
          for(const key of ['issuer','contract']) if(Object.hasOwn(currency,key)&&typeof currency[key]!=='string')add('expected-string','error',path+'.'+key);
          if(typeof currency.issuer==='string'&&!PUBLIC_KEY.test(currency.issuer))add('invalid-issuer-key-format','error',path+'.issuer');
          if(Object.hasOwn(currency,'issuer')&&Object.hasOwn(currency,'contract'))add('conflicting-currency-identifiers','error',path);
          if(typeof currency.code==='string'&&currency.code&&typeof currency.issuer==='string'){
            const identity=currency.code+':'+currency.issuer;
            if(known.has(identity))add('duplicate-currency','error',path);
            known.add(identity);
          }
        }
        for(const key of ['name','desc','image','conditions']) if(Object.hasOwn(currency,key)&&typeof currency[key]!=='string')add('expected-string','error',path+'.'+key);
      });
    }
  }
  diagnostics.sort((a,b)=>a.line-b.line||a.field.localeCompare(b.field)||a.code.localeCompare(b.code));
  return {status:diagnostics.some(x=>x.severity==='error')?'invalid':'valid',valid:!diagnostics.some(x=>x.severity==='error'),diagnostics,summary:{fields:fields.sort(),currencyCount:currencies,endpoints}};
}
/** Bounded local-file variant. Refuses symbolic links; no fetch or subprocesses. */
export async function validateStellarTomlFile(path) {
  let handle;
  try {
    if((await lstat(path)).isSymbolicLink())throw new Error('link');
    handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
    const buffer=Buffer.alloc(MAX_BYTES+1);
    let n=0;
    while(n<buffer.length){const r=await handle.read(buffer,n,buffer.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead;}
    if(n>MAX_BYTES)return validateStellarToml('x'.repeat(MAX_BYTES+1));
    return validateStellarToml(buffer.subarray(0,n).toString('utf8'));
  } catch {
    return {status:'invalid',valid:false,summary:null,diagnostics:[diagnostic('unreadable-file','error','',0)]};
  } finally {await handle?.close();}
}
