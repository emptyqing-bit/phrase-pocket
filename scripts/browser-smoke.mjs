import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const files = new Map(await Promise.all(['local.js','worker.js','lexicon.json'].map(async name =>
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
env.importScripts = name => vm.runInContext(files.get(name),env,{filename:name});
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
console.log('Passed: browser-only capture, two concurrent saves, no subtitle history, optional desktop connection and disconnect.');
