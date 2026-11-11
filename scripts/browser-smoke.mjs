import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const files = new Map(await Promise.all(['sites.js','local.js','worker.js','lexicon.json','transfer.js','manifest.json'].map(async name =>
  [name, await readFile(new URL('../extension/'+name, import.meta.url), 'utf8')])));
let listener, online = false;
const stored = {}, desktop = [], nativeCalls = [];
const id = 'jhioomhdcaphdijkhegcbakheknicgdc';
const extension = 'chrome-extension://'+id+'/';
const env = vm.createContext({
  crypto, fetch: async () => ({ok:true, json:async () => JSON.parse(files.get('lexicon.json'))}),
  URL,
  chrome:{
    storage:{local:{
      async setAccessLevel() {},
      async get(defaults) {return structuredClone({...defaults,...stored});},
      async set(values) {Object.assign(stored,structuredClone(values));}
    }},
    runtime:{
      id, getURL: suffix => extension+suffix,
      onMessage:{addListener:fn => {listener=fn;}},
      async sendNativeMessage(host, req) {
        nativeCalls.push(req.op);
        if (!online) throw Error('Specified native messaging host not found');
        if (req.op === 'ping') return {ok:true};
        if (req.op === 'import') {
          desktop.push(...structuredClone(req.entries).map(x => ({...x,id:crypto.randomUUID()})));
          return {ok:true};
        }
        if (req.op === 'list') return {ok:true, entries:desktop.slice().reverse().slice(req.offset,req.offset+100),total:desktop.length};
        throw Error('Unexpected native op: '+req.op);
      }
    },
    action:{onClicked:{addListener(){}}},
    commands:{onCommand:{addListener(){}}}
  }
});
env.importScripts = (...names) => names.forEach(name => vm.runInContext(files.get(name),env,{filename:name}));
vm.runInContext(files.get('worker.js'),env,{filename:'worker.js'});
const page = 'https://www.tiktok.com/foryou';
const library = extension+'library.html';
function call(message, url = library) {
  return new Promise(resolve => assert.equal(listener(message,{id,url},resolve),true));
}

const [word, note] = await Promise.all([
  call({op:'save',kind:'word',text:'I’m down',context:'Yeah, I’m down for that.'},page),
  call({op:'save',kind:'note',text:'周末逛市集',context:'private subtitle'},page)
]);
assert.match(word.entry.meaning,/爽快答应一个提议/);
assert.equal(note.entry.meaning,'');
assert.equal((await call({op:'list'})).total,2);
assert.deepEqual(nativeCalls,[]);
assert.doesNotMatch(JSON.stringify(stored),/for that|private subtitle/);
assert.equal(listener({op:'connect'},{id,url:page},() => assert.fail()),undefined);
assert.equal((await call({op:'connect'})).ok,false);
assert.equal((await call({op:'list'})).total,2);
online=true;
assert.equal((await call({op:'connect'})).mode,'desktop');
assert.equal((await call({op:'list'})).total,2);
assert.equal(desktop.find(x=>x.kind==='word').meaning,word.entry.meaning);
assert.equal((await call({op:'disconnect'})).mode,'browser');
online=false;
assert.equal((await call({op:'list'})).total,2);
assert.equal((await call({op:'save',kind:'word',text:"I'm down!"},page)).duplicate,true);
assert.equal((await call({op:'update',id:stored.entries[0].id,text:stored.entries[0].text,meaning:'口语释义'})).ok,true);
assert.match(JSON.stringify(stored),/口语释义/);
vm.runInContext(files.get('transfer.js'),env,{filename:'transfer.js'});
const exported = await call({op:'export'});
const backup = env.PocketTransfer.backup(exported.entries);
const restored = env.PocketTransfer.parseBackup(backup);
assert.equal(restored.length,2);
assert.equal(restored.find(entry => entry.kind === 'note').text,'周末逛市集');
assert.equal((await call({op:'import',expectedMode:'desktop',entries:restored})).ok,false);
assert.equal((await call({op:'import',expectedMode:'browser',entries:restored})).ok,true);
assert.equal((await call({op:'list'})).total,2);
const anki = env.PocketTransfer.anki([
  {kind:'word',text:'a "quoted"\tterm',meaning:'中文\n释义'},
  {kind:'note',text:'备忘',meaning:'不可导入词卡'},
  {kind:'word',text:'undefined meaning',meaning:''}
]);
assert.equal(anki.count,1);
assert.match(anki.text,/"a ""quoted""\tterm"/);
assert.doesNotMatch(anki.text,/备忘|不可导入词卡|undefined meaning/);
assert.throws(() => env.PocketTransfer.parseBackup('{"format":"phrase-pocket","version":1,"entries":[{"kind":"word","text":"..."}]}'));
stored.entries = [{id:'old',kind:'word',text:'oldest expression',meaning:'最早的一条释义'},
  ...Array.from({length:105},(_,i)=>({id:'item-'+i,kind:'note',text:'备忘 '+i,meaning:''}))];
const search = await call({op:'list',query:'最早',kind:'word'});
assert.equal(search.total,1);
assert.equal(search.entries[0].id,'old');
assert.equal((await call({op:'list',kind:'note'})).total,105);
assert.equal((await call({op:'list',kind:'note',offset:100})).entries.length,5);
assert.equal((await call({op:'export'})).entries.length,106);
const manifest = JSON.parse(files.get('manifest.json'));
const sites = manifest.content_scripts.flatMap(script => script.matches);
assert.equal(sites.length,6);
for (const site of sites) {
  const url = site.replace('*','video/123');
  assert.equal((await call({op:'save',kind:'note',text:url},url)).ok,true);
}
for (const url of ['https://www.douyin.com.example.org/video/1','http://www.bilibili.com/video/1','https://api.tiktok.com/video/1']) {
  assert.equal(listener({op:'save',kind:'note',text:'untrusted'},{id,url},() => assert.fail()),undefined);
}
assert.equal(listener({op:'export'},{id,url:'https://www.douyin.com/video/1'},() => assert.fail()),undefined);
console.log('Passed: collection capture on all six supported hosts and rejection of unrelated hosts.');
console.log('Passed: whole-library search, backup round-trip, merge deduplication, import-mode check and Anki text escaping.');
console.log('Passed: browser-only capture, two concurrent saves, no subtitle history, optional desktop connection and disconnect.');
