import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

const root = fileURLToPath(new URL('../', import.meta.url));
const binary = path.join(root, 'build', 'PhrasePocket.exe');
const buildDir = path.join(root, 'build');
const fixture = await mkdtemp(path.join(buildDir, 'smoke-'));
const home = path.join(fixture, 'home');
const manifest = JSON.parse(await readFile(path.join(root, 'extension', 'manifest.json'), 'utf8'));
const id = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex')
  .slice(0, 32).replace(/[0-9a-f]/g, c => 'abcdefghijklmnop'[parseInt(c, 16)]);
const origin = 'chrome-extension://' + id + '/';

function invoke(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      windowsHide:true, env:{...process.env, PHRASE_POCKET_HOME:home, PHRASE_POCKET_DEBUG:'1'}, stdio:['pipe','pipe','pipe']
    });
    const out = [], error = [];
    const timeout = setTimeout(() => { child.kill(); reject(Error('desktop process timed out')); }, 12000);
    child.stdout.on('data', bytes => out.push(bytes));
    child.stderr.on('data', bytes => error.push(bytes));
    child.on('error', reject);
    child.stdin.on('error', error => {if (error.code !== 'EPIPE') reject(error);});
    child.on('close', code => {
      clearTimeout(timeout);
      resolve({code, output:Buffer.concat(out), error:Buffer.concat(error).toString()});
    });
    child.stdin.end(input);
  });
}
function frame(data) {
  const body = Buffer.from(JSON.stringify(data));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}
async function call(data) {
  const result = await invoke([origin, '--parent-window=0'], frame(data));
  assert.equal(result.code, 0, result.error);
  assert.ok(result.output.length > 4, 'native host sent no response');
  assert.equal(result.output.readUInt32LE(), result.output.length - 4);
  const response = JSON.parse(result.output.subarray(4).toString());
  if (result.error) throw Error(result.error);
  return response;
}
try {
  assert.deepEqual(await call({op:'ping'}), {ok:true, version:1});
  assert.equal((await invoke(['chrome-extension://' + 'a'.repeat(32) + '/'], frame({op:'ping'}))).code, 2);
  const word = await call({op:'save', kind:'word', text:'I’m down', context:'Yeah, I’m down for that.'});
  assert.equal(word.ok, true);
  assert.match(word.entry.meaning, /答应一个提议/);
  assert.equal((await call({op:'save', kind:'word', text:"i'm DOWN!"})).entry.id, word.entry.id);
  const note = await call({op:'save', kind:'note', text:'周日去市集', context:'not collected'});
  assert.equal(note.entry.meaning, '');
  const blank = await call({op:'save', kind:'word', text:'obscure phrase for testing'});
  assert.equal(blank.entry.meaning, '');
  assert.equal(blank.enrich, false);

  // Exercise the real Windows SQLite reader and the same import path as the desktop.
  const dict = path.join(fixture, '英汉测试.db');
  const db = new DatabaseSync(dict);
  db.exec('CREATE TABLE stardict(word TEXT UNIQUE COLLATE NOCASE, translation TEXT);');
  db.prepare('INSERT INTO stardict VALUES (?,?)').run('obscure phrase for testing', '第一条中文释义\n第二条\n不该出现的第三条');
  db.close();
  assert.equal((await invoke(['--import-dictionary', dict])).code, 0);
  const found = await call({op:'retry', id:blank.entry.id});
  assert.equal(found.entry.source, 'ecdict');
  assert.equal(found.entry.meaning, '第一条中文释义；第二条');
  const revised = await call({op:'update', id:word.entry.id, text:'I’m down', meaning:'好啊，算我一个。'});
  assert.equal(revised.entry.source, 'manual');
  assert.equal((await call({op:'list'})).entries.find(x => x.id === word.entry.id).meaning, revised.entry.meaning);
  const raw = await readFile(path.join(home, 'entries.json'), 'utf8');
  assert.doesNotMatch(raw, /for that|not collected|https:\/\/|videoId/);

  const simultaneous = await Promise.all(Array.from({length:6}, (_,i) => call({op:'save', kind:'note', text:'并行记录 '+i})));
  assert.ok(simultaneous.every(x => x.ok));
  assert.equal((await call({op:'list'})).total, 9);
  assert.equal((await call({op:'delete', id:note.entry.id})).ok, true);
  assert.equal((await call({op:'list', offset:1})).entries.length, 7);
  const imported = [{kind:'word', text:'local-only expression', meaning:'浏览器里手写的释义', source:'manual'}];
  assert.equal((await call({op:'import', entries:imported})).ok, true);
  assert.equal((await call({op:'import', entries:imported})).ok, true);
  const migrated = (await call({op:'list'})).entries.filter(x => x.text === 'local-only expression');
  assert.equal(migrated.length, 1);
  assert.equal(migrated[0].meaning, imported[0].meaning);
  assert.equal((await call({op:'list',kind:'note',query:'并行记录'})).total,6);
  assert.equal((await call({op:'list',kind:'word',query:'浏览器里手写'})).entries[0].text,'local-only expression');
  const preserved = {kind:'word',text:'restored review',meaning:'恢复的手写释义',source:'manual',review:'known',reviewedAt:new Date().toISOString()};
  assert.equal((await call({op:'import',entries:[preserved]})).ok,true);
  assert.equal((await call({op:'list',query:'restored review'})).entries[0].review,'known');
  if (process.argv.includes('--bundled-dictionary')) {
    const bundled = new DatabaseSync(path.join(buildDir, 'ecdict-bundled.db'), {readOnly:true});
    try {
      assert.equal(bundled.prepare('SELECT count(*) AS count FROM stardict').get().count, 60000);
    } finally {
      bundled.close();
    }
    const bundledWord = await call({op:'save', kind:'word', text:'perseverance'});
    assert.equal(bundledWord.entry.source, 'ecdict');
    assert.match(bundledWord.entry.meaning, /[\u3400-\u9fff]/);
    console.log('Passed: built-in 60,000-entry dictionary lookup with a user-imported dictionary also present.');
  }
  if (process.argv.includes('--ui')) assert.equal((await invoke(['--ui-smoke'])).code, 0);

  if (process.argv.includes('--model-fixture')) {
    const requests = [];
    const service = createServer(async (req, res) => {
      let data = '';
      for await (const chunk of req) data += chunk;
      requests.push({url:req.url, body:JSON.parse(data)});
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({response:JSON.stringify({meaning:'看具体情况，有时指不那么明显的提示。'})}));
    });
    await new Promise((resolve, reject) => service.once('error',reject).listen(11434,'127.0.0.1',resolve));
    try {
      await writeFile(path.join(home, 'settings.json'), JSON.stringify({model:'fixture-model'}));
      const modelWord = await call({op:'save', kind:'word', text:'a quiet nudge'});
      assert.equal(modelWord.entry.meaning, '');
      assert.equal(modelWord.enrich, true);
      const lookup = await call({op:'enrich', id:modelWord.entry.id, context:'She offered a quiet nudge.'});
      assert.equal(lookup.entry.source, 'model');
      assert.match(lookup.entry.meaning, /不那么明显的提示/);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].url, '/api/generate');
      assert.deepEqual(JSON.parse(requests[0].body.prompt), {expression:'a quiet nudge', subtitle:'She offered a quiet nudge.'});
      const privateNote = await call({op:'save', kind:'note', text:'不应该触发翻译'});
      assert.equal(privateNote.enrich, false);
      assert.equal((await call({op:'enrich', id:privateNote.entry.id})).ok, false);
      assert.equal(requests.length, 1);
      console.log('Passed: local model request, durable save before inference, and exclusion of notes.');
    } finally { await new Promise(resolve => service.close(resolve)); }
  }

  const captions = await readFile(path.join(root,'extension','captions.js'), 'utf8');
  const box = (left, top, right, bottom) => ({getBoundingClientRect:() => ({left, top, right, bottom})});
  const hidden = {...box(0,800,300,1400), paused:false, readyState:4,
    textTracks:[{kind:'captions', mode:'showing', language:'en', activeCues:[{text:'Old caption'}]}]};
  const video = {...box(10,10,310,580), paused:false, readyState:4,
    textTracks:[{kind:'captions', mode:'showing', language:'en-US', activeCues:[{text:'<i>Current caption</i>'}]}]};
  const env = {document:{querySelectorAll:() => [hidden,video]},
    getComputedStyle:() => ({visibility:'visible', display:'block', opacity:'1'}), innerWidth:700, innerHeight:600};
  vm.runInNewContext(captions, env);
  assert.equal(env.phrasePocketCaptions.read(), 'Current caption');
  video.textTracks = [{kind:'captions', mode:'showing', language:'zh', activeCues:[{text:'不采集非英文字幕'}]}];
  assert.equal(env.phrasePocketCaptions.read(), '');
  const overlay = {...box(20,500,300,525), innerText:'Readable overlay'};
  video.parentElement = {querySelectorAll:selector => selector === 'video' ? [video] : [overlay]};
  assert.equal(env.phrasePocketCaptions.read(), 'Readable overlay');
  video.parentElement.querySelectorAll = selector => selector === 'video' ? [video, hidden] : [overlay];
  assert.equal(env.phrasePocketCaptions.read(), '');
  console.log('Passed: browser framing, records, concurrent writes, ECDICT import, edits, privacy, caption fallbacks' +
    (process.argv.includes('--ui') ? ', and desktop window creation.' : '.'));
} finally {
  // The child processes have exited. Only remove this build's test directory.
  if (path.dirname(fixture) === buildDir && path.basename(fixture).startsWith('smoke-')) {
    await rm(fixture, {recursive:true, force:true});
  }
}
