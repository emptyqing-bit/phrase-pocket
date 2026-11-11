const entries = document.getElementById('entries');
const status = document.getElementById('status');
let data = [], filter = 'all', editing = null, total = 0, loading = false;
let requestVersion = 0, searchText = '', transferring = false;
const more = document.getElementById('more');
const bridge = document.getElementById('bridge');
const connection = document.getElementById('connection');
const search = document.getElementById('search');
let mode = 'browser';
const send = request => chrome.runtime.sendMessage(request);
function make(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(label, action, className) {
  const node = make('button', label, className);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}
const sources = {builtin:'内置词条', ecdict:'ECDICT', model:'本地模型', manual:'自己填写'};

async function apply(request, control) {
  control.disabled = true;
  try {
    const result = await send(request);
    if (!result?.ok) {status.textContent = result?.error || '没有完成，请重试。'; return;}
    editing = null;
    await load();
    if (request.op === 'retry' && result.enrich) status.textContent = '已开始查释义，稍后刷新查看。';
    else if (request.op === 'retry' && !result.entry?.meaning) status.textContent = mode === 'desktop'
      ? '当前词典里没查到。可以自己填写，或在桌面组件启用本地模型。'
      : '内置词表里没查到。可以自己填写释义。';
  } catch { status.textContent = '无法连接本机收藏。'; }
  finally { control.disabled = false; }
}
function editor(entry) {
  const form = make('form');
  const label = make('label', entry.kind === 'word' ? '英文' : '备忘');
  const text = make('input');
  text.value = entry.text; text.required = true; text.maxLength = 240;
  label.append(text); form.append(label);
  const meaning = make('textarea');
  if (entry.kind === 'word') {
    const definition = make('label','中文释义');
    meaning.value = entry.meaning || '';
    meaning.maxLength = 320;
    definition.append(meaning);
    form.append(definition);
  }
  const actions = make('div', null, 'actions');
  const submit = make('button','保存','primary');
  submit.type = 'submit';
  actions.append(submit, button('取消', () => {editing = null; render();}));
  form.append(actions);
  form.addEventListener('submit', e => {
    e.preventDefault();
    apply({op:'update', id:entry.id, text:text.value, meaning:meaning.value}, submit);
  });
  queueMicrotask(() => text.focus());
  return form;
}
function render() {
  entries.replaceChildren();
  more.hidden = data.length >= total;
  status.textContent = total ? '已显示 ' + data.length + ' / ' + total + ' 条' :
    searchText || filter !== 'all' ? '没有找到匹配的收藏。' : '这里还没有收藏。在视频网页记下第一条吧。';
  for (const entry of data) {
    const row = make('article', null, 'entry');
    row.append(make('span', entry.kind === 'word' ? '单词' : '备忘', 'badge'));
    if (editing === entry.id) row.append(editor(entry));
    else {
      row.append(make('h2', entry.text));
      if (entry.kind === 'word') {
        row.append(make('p', entry.meaning || '暂无释义', 'detail'));
        if (entry.meaning) row.append(make('p', sources[entry.source] || '', 'details'));
      }
      const actions = make('div', null, 'actions');
      if (entry.kind === 'word') actions.append(button('朗读', () => speak(entry.text)));
      actions.append(button('编辑', () => {editing = entry.id; render();}));
      if (entry.kind === 'word' && !entry.meaning) actions.append(button('查释义', e => apply({op:'retry', id:entry.id},e.currentTarget)));
      actions.append(button('删除', e => {if (confirm('删除这条收藏？')) apply({op:'delete', id:entry.id},e.currentTarget);}));
      row.append(actions);
    }
    entries.append(row);
  }
}
async function load(append = false) {
  if (append && loading) return;
  const version = ++requestVersion;
  loading = true;
  more.disabled = true;
  try {
    const result = await send({op:'list', offset:append ? data.length : 0,kind:filter,query:searchText});
    if (version !== requestVersion) return;
    if (!result?.ok) {status.textContent = result?.error || '无法读取收藏。'; return;}
    data = append ? [...data, ...result.entries] : result.entries;
    total = result.total;
    render();
  } catch {if (version === requestVersion) status.textContent = '无法连接本机收藏。';}
  finally {if (version === requestVersion) {loading = false; more.disabled = false;}}
}
function speak(text) {
  const voice = window.speechSynthesis?.getVoices().find(item => item.localService && /^en(?:-|$)/i.test(item.lang));
  if (!voice) {status.textContent = '当前系统没有可用的本地英语语音。'; return;}
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.onerror = () => {status.textContent = '朗读未能完成，请再试一次。';};
  window.speechSynthesis.speak(utterance);
}
window.speechSynthesis?.getVoices();
window.addEventListener('pagehide', () => window.speechSynthesis?.cancel());
document.getElementById('search-form').addEventListener('submit', event => {
  event.preventDefault();
  searchText = search.value.trim();
  editing = null;
  load();
});
search.addEventListener('search', () => {
  if (search.value) return;
  searchText = '';
  editing = null;
  load();
});
document.getElementById('refresh').addEventListener('click', () => load());
more.addEventListener('click', () => load(true));
function showConnection() {
  connection.textContent = mode === 'desktop' ? '保存位置：Windows 桌面收藏' : '保存位置：此浏览器 · 无需安装桌面程序';
  bridge.textContent = mode === 'desktop' ? '复制到浏览器并断开' : '连接 Windows 卡片';
  bridge.hidden = false;
}
bridge.addEventListener('click', async () => {
  bridge.disabled = true;
  try {
    if (mode === 'browser') {
      if (!await chrome.permissions.request({permissions:['nativeMessaging']})) {
        connection.textContent = '未授予连接权限，仍然保存在浏览器。';
        return;
      }
      connection.textContent = '正在连接，并复制已有的浏览器收藏…';
    } else connection.textContent = '正在把桌面收藏复制到浏览器…';
    const result = await send({op:mode === 'browser' ? 'connect' : 'disconnect'});
    if (!result?.ok) {
      connection.textContent = result?.error || '没有切换成功，原收藏仍在。';
      return;
    }
    mode = result.mode;
    if (mode === 'browser') await chrome.permissions.remove({permissions:['nativeMessaging']}).catch(() => {});
    showConnection();
    editing = null;
    await load();
  } catch {connection.textContent = '没有切换成功，原收藏仍在。';}
  finally {bridge.disabled = false;}
});
for (const node of document.querySelectorAll('[data-kind]')) node.addEventListener('click', () => {
  filter = node.dataset.kind;
  editing = null;
  for (const sibling of document.querySelectorAll('[data-kind]')) sibling.setAttribute('aria-pressed',String(sibling === node));
  load();
});
const transferButtons = ['backup','restore','anki'].map(id => document.getElementById(id));
const fileInput = document.getElementById('import-file');
function setTransfer(active) {
  transferring = active;
  transferButtons.forEach(control => {control.disabled = active;});
  bridge.disabled = active;
}
function download(text, type, name) {
  const url = URL.createObjectURL(new Blob([text],{type}));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}
async function exportCollection(anki) {
  if (transferring) return;
  setTransfer(true);
  try {
    const result = await send({op:'export'});
    if (!result?.ok) throw Error(result?.error || '无法读取完整收藏。');
    if (anki) {
      const exported = PocketTransfer.anki(result.entries);
      if (!exported.count) {status.textContent = '收藏里还没有带释义的单词。'; return;}
      download(exported.text,'text/tab-separated-values;charset=utf-8','phrase-pocket-anki.tsv');
      status.textContent = '已导出 ' + exported.count + ' 条带释义的单词。';
    } else {
      download(PocketTransfer.backup(result.entries),'application/json;charset=utf-8','phrase-pocket-backup.json');
      status.textContent = '已备份全部 ' + result.entries.length + ' 条收藏。';
    }
  } catch (error) {status.textContent = error.message;}
  finally {setTransfer(false);}
}
document.getElementById('backup').addEventListener('click', () => exportCollection(false));
document.getElementById('anki').addEventListener('click', () => exportCollection(true));
document.getElementById('restore').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  fileInput.value = '';
  if (!file || transferring) return;
  setTransfer(true);
  let restored = 0;
  try {
    if (file.size > 25 * 1024 * 1024) throw Error('请选择小于 25 MB 的备份文件。');
    const imported = PocketTransfer.parseBackup(await file.text());
    const state = await send({op:'connection'});
    if (!state?.ok) throw Error('无法读取当前保存位置。');
    for (let i = 0; i < imported.length; i += 4) {
      const result = await send({op:'import',expectedMode:state.mode,entries:imported.slice(i,i+4)});
      if (!result?.ok) throw Error(result?.error || '导入中断。');
      restored += Math.min(4,imported.length-i);
      status.textContent = '正在合并 ' + restored + ' / ' + imported.length + ' 条记录…';
    }
    editing = null;
    await load();
    status.textContent = '已合并 ' + restored + ' 条备份记录，相同内容会自动去重。';
  } catch (error) {
    status.textContent = error.message + (restored ? ' 已处理 ' + restored + ' 条，可以重新导入继续合并。' : '');
  } finally {setTransfer(false);}
});
send({op:'connection'}).then(result => {
  if (result?.ok) { mode = result.mode; showConnection(); }
}, () => { connection.textContent = '无法读取保存位置。'; });
load();
