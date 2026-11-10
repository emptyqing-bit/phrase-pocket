const entries = document.getElementById('entries');
const status = document.getElementById('status');
let data = [], filter = 'all', editing = null, total = 0, loading = false;
const more = document.getElementById('more');
const bridge = document.getElementById('bridge');
const connection = document.getElementById('connection');
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
  const selected = data.filter(x => filter === 'all' || x.kind === filter);
  more.hidden = data.length >= total;
  status.textContent = selected.length ? '已显示 ' + selected.length + ' 条' :
    total ? '当前已加载的记录里没有这个类型。' : '这里还没有收藏。去 TikTok 记下第一条吧。';
  for (const entry of selected) {
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
      actions.append(button('编辑', () => {editing = entry.id; render();}));
      if (entry.kind === 'word' && !entry.meaning) actions.append(button('查释义', e => apply({op:'retry', id:entry.id},e.currentTarget)));
      actions.append(button('删除', e => {if (confirm('删除这条收藏？')) apply({op:'delete', id:entry.id},e.currentTarget);}));
      row.append(actions);
    }
    entries.append(row);
  }
}
async function load(append = false) {
  if (loading) return;
  loading = true;
  more.disabled = true;
  try {
    const result = await send({op:'list', offset:append ? data.length : 0});
    if (!result?.ok) {status.textContent = result?.error || '无法读取收藏。'; return;}
    data = append ? [...data, ...result.entries] : result.entries;
    total = result.total;
    render();
  } catch {status.textContent = '无法连接本机收藏。';}
  finally {loading = false; more.disabled = false;}
}
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
  render();
});
send({op:'connection'}).then(result => {
  if (result?.ok) { mode = result.mode; showConnection(); }
}, () => { connection.textContent = '无法读取保存位置。'; });
load();
