import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateStellarToml,validateStellarTomlFile} from '../src/modules/stellar-toml/index.mjs';
const G='G'+'A'.repeat(55);
const codes=r=>r.diagnostics.map(d=>d.code);
test('valid minimal file does not require optional SEP-1 fields',()=>{
 const r=validateStellarToml('VERSION="2.0.0"\n'); assert.equal(r.status,'valid'); assert.equal(r.summary.currencyCount,0);assert.deepEqual(r.diagnostics,[]);
});
test('valid multi-currency, account, and endpoint declarations',()=>{
 const r=validateStellarToml(`ACCOUNTS=["${G}"]\nSIGNING_KEY="${G}"\nTRANSFER_SERVER="https://anchor.example/transfer"\nTRANSFER_SERVER_SEP0024="https://anchor.example/sep24"\nNETWORK_PASSPHRASE="Test SDF Network ; September 2015"\n[DOCUMENTATION]\nORG_URL="https://example.org"\n[[CURRENCIES]]\ncode="USD"\nissuer="${G}"\n[[CURRENCIES]]\ncode="EUR"\nissuer="${G}"\n`);
 assert.equal(r.status,'valid');assert.equal(r.summary.currencyCount,2);assert.equal(r.summary.endpoints.TRANSFER_SERVER,'https://anchor.example/transfer');
});
test('extension fields do not crash known validation',()=>assert.equal(validateStellarToml('FUTURE_EXTENSION="hello"').status,'valid'));
test('wrong field types are errors with line and source',()=>{
 const r=validateStellarToml('VERSION=1\nACCOUNTS="not a list"\n');assert.deepEqual(codes(r),['expected-string','expected-string-list']);assert.equal(r.diagnostics[0].line,1);assert.match(r.diagnostics[0].reference,/sep-0001/);
});
test('invalid URLs, credentials, and non-HTTPS transfer endpoints are errors',()=>{
 const r=validateStellarToml('TRANSFER_SERVER="http://example.org"\nTRANSFER_SERVER_SEP0024="not url"\nWEB_AUTH_ENDPOINT="https://user:password@example.org"'); assert.equal(codes(r).filter(x=>x==='invalid-url').length,3);
});
test('URL query credentials are never returned from validation',()=>{
 const r=validateStellarToml('TRANSFER_SERVER="https://example.org/api?token=supersecret#private"');assert.equal(r.status,'valid');assert.doesNotMatch(JSON.stringify(r),/supersecret|private/);
});
test('duplicate assignments and table declarations fail closed',()=>{
 assert.deepEqual(codes(validateStellarToml('VERSION="1"\nVERSION="2"')),['duplicate-key']);
 assert.deepEqual(codes(validateStellarToml('[DOCUMENTATION]\nORG_NAME="X"\n[DOCUMENTATION]\nORG_NAME="Y"')),['duplicate-table']);
});
test('bad currencies and duplicate assets fail',()=>{
 const r=validateStellarToml(`[[CURRENCIES]]\ncode="!invalid!"\n[[CURRENCIES]]\ncode="USD"\nissuer="${G}"\n[[CURRENCIES]]\ncode="USD"\nissuer="${G}"\n`);
 assert.ok(codes(r).includes('invalid-currency-code'));assert.ok(codes(r).includes('duplicate-currency'));
});
test('invalid currency structures and conflicting toml references fail',()=>{
 assert.ok(codes(validateStellarToml('CURRENCIES=["USD"]')).includes('expected-currency-tables'));
 assert.ok(codes(validateStellarToml('[[CURRENCIES]]\ntoml="https://example.org/USD.toml"\ncode="USD"')).includes('conflicting-currency-reference'));
});
test('malformed TOML does not produce a valid report',()=>{
 assert.equal(validateStellarToml('VERSION=["unterminated"').status,'invalid');
 assert.equal(validateStellarToml('VERSION="unterminated').status,'invalid');
});
test('bounded local file reads and symlink exclusion',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'sep1-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const path=join(dir,'stellar.toml');await writeFile(path,'TRANSFER_SERVER="https://example.org"');assert.equal((await validateStellarTomlFile(path)).status,'valid');
 await writeFile(path,'x'.repeat(100*1024+1));assert.ok(codes(await validateStellarTomlFile(path)).includes('size-limit'));
 const link=join(dir,'link');try{await symlink(path,link);assert.ok(codes(await validateStellarTomlFile(link)).includes('unreadable-file'));}catch(e){if(e.code!=='EPERM')throw e;}
});
test('validator never invokes a network request',()=>{
 const old=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw Error('forbidden');};
 try {validateStellarToml('TRANSFER_SERVER="https://example.org"');assert.equal(calls,0);}finally{globalThis.fetch=old;}
});
test('unsupported valid TOML syntax is not mistaken for a definite syntax error',()=>{
 const r=validateStellarToml('UPDATED=2026-10-24T10:00:00Z');assert.equal(r.status,'not-evaluated');assert.equal(r.diagnostics[0].severity,'review');
});
