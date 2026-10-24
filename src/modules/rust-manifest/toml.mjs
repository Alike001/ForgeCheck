/** A deliberately bounded TOML 1.0 subset reader. Unsupported syntax fails explicitly. */
export class TomlError extends Error {
  constructor(code, line) { super(code); this.code = code; this.line = line; }
}
const dict = () => Object.create(null);
const keyPattern = /^[A-Za-z0-9_-]+$/;
function keyParts(value, line) {
  const parts = value.trim().split('.').map(x => x.trim());
  if (!parts.length || parts.some(x => !keyPattern.test(x) || ['__proto__','constructor','prototype'].includes(x))) throw new TomlError('unsupported-key', line);
  return parts;
}
function withoutComment(s) {
  let quote = '', escape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (quote === '"' && escape) { escape = false; continue; }
      if (quote === '"' && c === '\\') { escape = true; continue; }
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '#') return s.slice(0, i);
  }
  return s;
}
function split(s, delimiter, line) {
  const chunks = [];
  let quote = '', escape = false, level = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (quote === '"' && escape) { escape = false; continue; }
      if (quote === '"' && c === '\\') { escape = true; continue; }
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '[' || c === '{') level++;
    else if (c === ']' || c === '}') { if (--level < 0) throw new TomlError('malformed-value',line); }
    else if (c === delimiter && level === 0) { chunks.push(s.slice(start,i).trim()); start=i+1; }
  }
  if (quote || level !== 0) throw new TomlError('malformed-value',line);
  chunks.push(s.slice(start).trim());
  return chunks;
}
function parseValue(raw, line) {
  const s = raw.trim();
  if ((s.startsWith('[') && !s.endsWith(']')) || (s.startsWith('{') && !s.endsWith('}'))) throw new TomlError('malformed-value',line);
  if (s.startsWith('"')) {
    if (s.startsWith('\"\"\"')) throw new TomlError('unsupported-multiline-string',line);
    if (!/^"(?:[^"\\\n]|\\["\\bfnrtu])*"$/.test(s)) throw new TomlError('malformed-string', line);
    try { return JSON.parse(s); } catch { throw new TomlError('malformed-string',line); }
  }
  if (s.startsWith("'")) {
    if (s.length < 2 || !s.endsWith("'") || s.slice(1,-1).includes("'")) throw new TomlError('unsupported-string',line);
    return s.slice(1,-1);
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^[+-]?\d(?:_?\d)*$/.test(s)) return Number(s.replaceAll('_',''));
  if (/^[+-]?\d(?:_?\d)*\.\d(?:_?\d)*$/.test(s)) return Number(s.replaceAll('_',''));
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1,-1).trim();
    if (!inner) return [];
    const items = split(inner, ',', line);
    if (items.at(-1) === '') items.pop();
    if (items.some(x => !x)) throw new TomlError('malformed-array',line);
    return items.map(x => parseValue(x,line));
  }
  if (s.startsWith('{') && s.endsWith('}')) {
    const out = dict(), inner = s.slice(1,-1).trim();
    if (!inner) return out;
    const entries = split(inner,',',line);
    for (const entry of entries) {
      const at = entry.indexOf('=');
      if (at < 1) throw new TomlError('malformed-inline-table',line);
      const keys = keyParts(entry.slice(0,at),line);
      setValue(out,keys,parseValue(entry.slice(at+1),line),line);
    }
    return out;
  }
  throw new TomlError('unsupported-value',line);
}
function setValue(obj, keys, value, line) {
  let target=obj;
  for (const key of keys.slice(0,-1)) {
    if (!Object.hasOwn(target,key)) target[key]=dict();
    target=target[key];
    if (!target || Array.isArray(target) || typeof target!=='object') throw new TomlError('conflicting-key',line);
  }
  const last=keys.at(-1);
  if (Object.hasOwn(target,last)) throw new TomlError('duplicate-key',line);
  target[last]=value;
}
export function parseToml(text, maxBytes=1024*1024) {
  if (typeof text!=='string' || Buffer.byteLength(text,'utf8')>maxBytes) throw new TomlError('size-limit',0);
  const root=dict(), locations=dict(), headers=new Set();
  let table=root, prefix='';
  const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/);
  for (let i=0;i<lines.length;i++) {
    const line=i+1, trimmed=withoutComment(lines[i]).trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('[')) {
      const array=trimmed.startsWith('[[');
      if (array ? !trimmed.endsWith(']]') : !trimmed.endsWith(']')) throw new TomlError('malformed-header',line);
      const keys=keyParts(trimmed.slice(array?2:1,array?-2:-1),line);
      let parent=root;
      for (const key of keys.slice(0,-1)) {
        if (!Object.hasOwn(parent,key)) parent[key]=dict();
        parent=parent[key];
        if (Array.isArray(parent)) parent=parent.at(-1);
        if (!parent || typeof parent!=='object') throw new TomlError('conflicting-table',line);
      }
      const key=keys.at(-1), name=keys.join('.');
      if (array) {
        if (!Object.hasOwn(parent,key)) parent[key]=[];
        if (!Array.isArray(parent[key])) throw new TomlError('conflicting-table',line);
        table=dict(); parent[key].push(table); prefix=`${name}[${parent[key].length-1}]`;
      } else {
        if (headers.has(name)) throw new TomlError('duplicate-table',line);
        if (!Object.hasOwn(parent,key)) parent[key]=dict();
        if (!parent[key] || Array.isArray(parent[key]) || typeof parent[key]!=='object') throw new TomlError('conflicting-table',line);
        headers.add(name); table=parent[key]; prefix=name;
      }
      locations[prefix]=line;
      continue;
    }
    const equal=trimmed.indexOf('=');
    if (equal<=0) throw new TomlError('malformed-assignment',line);
    const keys=keyParts(trimmed.slice(0,equal),line);
    let value=trimmed.slice(equal+1);
    // Explicitly support multiline arrays/inline tables, without supporting multiline strings.
    while (true) {
      try { const parsed=parseValue(value,line);setValue(table,keys,parsed,line);break; }
      catch(e) {
        if (!(e instanceof TomlError) || e.code!=='malformed-value' || i>=lines.length-1 || !/^[\s]*[\[{]/.test(value)) throw e;
        value+='\n'+withoutComment(lines[++i]);
      }
    }
    locations[prefix?prefix+'.'+keys.join('.'):keys.join('.')]=line;
  }
  return {data:root,locations};
}
