importScripts('local.js');

const HOST = 'com.phrasepocket.desktop';
const send = message => chrome.runtime.sendNativeMessage(HOST, message);
chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}).catch(() => {});
let pending = Promise.resolve();
function serialize(task) {
  const result = pending.then(task);
  pending = result.catch(() => {});
  return result;
}
const messageFor = {
  not_found: '这条收藏不存在。',
  bad_request: '请检查输入内容。',
  duplicate: '相同内容已经在收藏里。',
  storage: '本机收藏无法读写。请检查磁盘后重试。',
  dictionary: '本地词库暂时无法读取。',
  mode_changed: '保存位置已改变，请重新选择导入。'
};

function failed(error) {
  const reason = String(error?.message || error);
  if (/not found|forbidden|not registered|access.*denied/i.test(reason)) {
    return '还没有连上桌面组件。请先运行 Windows 安装脚本，再试一次。';
  }
  return '和桌面组件的连接中断了，请重试。';
}

async function route(request) {
  const {mode, entries} = await chrome.storage.local.get({mode:'browser', entries:[]});
  if (request.op === 'import' && request.expectedMode !== mode) return {ok:false, code:'mode_changed'};
  if (request.op === 'connection') return {ok:true, mode};
  if (request.op === 'connect') {
    if (mode === 'desktop') return {ok:true, mode};
    if (!(await send({op:'ping'}))?.ok) return {ok:false, code:'storage'};
    for (let i = 0; i < entries.length; i += 4) {
      const batch = entries.slice(i,i+4).map(({kind,text,meaning,source,createdAt,review,reviewedAt}) =>
        ({kind,text,meaning,source,createdAt,review,reviewedAt}));
      const result = await send({op:'import', entries:batch});
      if (!result?.ok) return {ok:false, code:result?.code || 'storage'};
    }
    await chrome.storage.local.set({mode:'desktop'});
    return {ok:true, mode:'desktop'};
  }
  if (request.op === 'disconnect' || request.op === 'export') {
    if (request.op === 'export' && mode !== 'desktop') return {ok:true, entries};
    if (mode === 'browser') return {ok:true, mode};
    const copied = [];
    let expected;
    do {
      const page = await send({op:'list', offset:copied.length});
      if (!page?.ok || !Array.isArray(page.entries)) return {ok:false, code:page?.code || 'storage'};
      expected ??= page.total;
      if (page.total !== expected || (!page.entries.length && copied.length < expected)) return {ok:false, code:'storage'};
      copied.push(...page.entries);
    } while (copied.length < expected);
    if (new Set(copied.map(x => x.id)).size !== expected) return {ok:false, code:'storage'};
    if (request.op === 'export') return {ok:true, entries:copied.reverse()};
    await chrome.storage.local.set({mode:'browser', entries:copied.reverse()});
    return {ok:true, mode:'browser'};
  }
  return mode === 'desktop' ? send(request) : LocalPocket.handle(request,entries);
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message !== 'object') return;
  const origin = sender.url ? new URL(sender.url).origin : '';
  const page = origin === 'https://www.tiktok.com' || origin === 'https://tiktok.com';
  const library = sender.url === chrome.runtime.getURL('library.html');
  if ((!page || !['save', 'openLibrary'].includes(message.op)) &&
      (!library || !['list', 'update', 'delete', 'retry', 'connection', 'connect', 'disconnect', 'export', 'import'].includes(message.op))) return;
  if (message.op === 'openLibrary') {
    chrome.runtime.openOptionsPage().then(() => respond({ok:true}), () => respond({ok:false}));
    return true;
  }
  let request;
  if (message.op === 'save') {
    request = {op:'save', kind:message.kind, text:message.text, context:message.kind === 'word' ? message.context : ''};
  } else if (message.op === 'update') {
    request = {op:'update', id:message.id, text:message.text, meaning:message.meaning};
  } else if (message.op === 'import') {
    if (!Array.isArray(message.entries) || message.entries.length > 4) {
      respond({ok:false, error:'请检查导入的备份文件。'});
      return;
    }
    request = {op:'import', expectedMode:message.expectedMode, entries:message.entries.map(entry => ({
      kind:entry?.kind, text:entry?.text, meaning:entry?.meaning, source:entry?.source,
      createdAt:entry?.createdAt, review:entry?.review, reviewedAt:entry?.reviewedAt
    }))};
  } else {
    request = {op:message.op, id:message.id,
      offset:message.op === 'list' && Number.isInteger(message.offset) ? message.offset : 0,
      kind:message.op === 'list' ? message.kind : undefined,
      query:message.op === 'list' ? message.query : undefined};
  }
  serialize(() => route(request)).then(result => {
    if (!result?.ok) {
      respond({ok:false, error:messageFor[result?.code] || '操作没有完成，请重试。'});
      return;
    }
    respond(result);
    if (result.enrich && result.entry?.id) {
      // Once the text is saved, a slow model must never hold up the page.
      send({op:'enrich', id:result.entry.id, context:request.context || ''}).catch(() => {});
    }
  }, error => respond({ok:false, error:/quota|storage/i.test(String(error?.message)) ?
    '浏览器收藏空间不足或暂时不可写。原记录已保留。' : failed(error)}));
  return true;
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage().catch(() => {}));
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'capture') return;
  const current = tab || (await chrome.tabs.query({active:true, currentWindow:true}))[0];
  if (current?.id != null) chrome.tabs.sendMessage(current.id, {op:'capture'}).catch(() => {});
});
