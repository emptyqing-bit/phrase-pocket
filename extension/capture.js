(() => {
  const shell = document.createElement('aside');
  shell.setAttribute('aria-label', '随手收');
  const shadow = shell.attachShadow({mode:'closed'});
  shadow.innerHTML = `
    <style>
      :host{all:initial;position:fixed;z-index:2147483647;bottom:18px;right:20px;font:14px/1.45 system-ui,sans-serif;color:#203629;--paper:#fffef7;--line:#d7dfd3;--ink:#203629;--dim:#546458;--green:#194d36;--soft:#e7efe1}
      *{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer}
      button:focus-visible,input:focus-visible{outline:2px solid #738f50;outline-offset:2px}
      [hidden]{display:none!important}
      .dock,.primary{background:var(--green);color:#fff;border:1px solid var(--green);border-radius:9px;padding:8px 13px}
      .dock{box-shadow:0 4px 18px #14291e55;border-color:#ffffff66;float:right}
      .dock span{font:italic 16px Georgia,serif;color:#d7f0bf;margin-right:6px}
      .panel{width:min(360px,calc(100vw - 40px));border-radius:16px;overflow:hidden;background:var(--paper);border:1px solid var(--line);box-shadow:0 12px 36px #172b2355}
      .head{background:var(--soft);padding:9px 12px;display:flex;justify-content:space-between;align-items:center;gap:6px}
      .name{font-weight:650}.sprig{color:#4e744b;margin-right:5px}
      .body{padding:10px 12px 11px;display:grid;gap:8px}
      .line,.modes,form{display:flex;gap:5px;align-items:center;flex-wrap:wrap}.line{justify-content:space-between}
      .plain{border:1px solid transparent;border-radius:7px;background:transparent;color:var(--ink);padding:4px 7px}
      .plain:hover,.plain[aria-pressed=true]{background:var(--soft);border-color:var(--line)}
      .icon{font-size:17px;padding:0 7px}.muted{font-size:12px;color:var(--dim);min-height:18px;margin:0;overflow-wrap:anywhere}
      input{flex:1;min-width:0;padding:8px 9px;border:1px solid var(--line);border-radius:8px;background:var(--paper);color:var(--ink)}
      input::placeholder{color:var(--dim)}
      button[disabled]{opacity:.65;cursor:default}
      @media(prefers-color-scheme:dark){:host{--paper:#222b25;--line:#425347;--ink:#e8f0e7;--dim:#bac9ba;--green:#275740;--soft:#34463a;color:var(--ink)}}
    </style>
    <button id="open" class="dock" type="button" aria-expanded="false"><span aria-hidden="true">Aa</span>随手收</button>
    <section id="panel" class="panel" hidden>
      <div class="head"><span class="name"><span class="sprig" aria-hidden="true">✦</span>随手收</span><div class="modes">
        <button type="button" id="library" class="plain">我的收藏</button><button type="button" id="close" class="plain icon" aria-label="收起">×</button>
      </div></div>
      <div class="body">
        <div class="line"><div class="modes" role="group" aria-label="记录类型">
          <button type="button" class="plain" data-kind="word" aria-pressed="true">记单词</button>
          <button type="button" class="plain" data-kind="note" aria-pressed="false">记备忘</button>
        </div><button type="button" class="plain" id="caption">取当前字幕</button></div>
        <form id="form">
          <input id="text" maxlength="240" required autocomplete="off" spellcheck="false" aria-label="英文单词或短语" placeholder="输入单词或短语">
          <button type="submit" class="primary" id="save">保存 ↵</button>
        </form>
        <p class="muted" id="status" role="status"></p>
      </div>
    </section>`;
  const by = id => shadow.getElementById(id);
  const panel = by('panel'), opener = by('open'), input = by('text'), status = by('status'), save = by('save');
  const draft = {word:'',note:''};
  let mode = 'word', context = '', busy = false;
  const hint = () => mode === 'word' ? '输入英文，或取字幕后留下想记的词' : '记下一个地点、一条信息或一个想法';

  function setMode(next) {
    draft[mode] = input.value;
    mode = next;
    input.value = draft[mode];
    input.placeholder = mode === 'word' ? '输入单词或短语' : '例如：周日去老厂房市集';
    input.setAttribute('aria-label', mode === 'word' ? '英文单词或短语' : '备忘内容');
    for (const button of shadow.querySelectorAll('[data-kind]')) button.setAttribute('aria-pressed', String(button.dataset.kind === mode));
    by('caption').hidden = mode !== 'word';
    status.textContent = hint();
    input.focus();
  }
  function open(selection) {
    panel.hidden = false;
    opener.hidden = true;
    opener.setAttribute('aria-expanded','true');
    status.textContent = hint();
    if (selection && !input.value && mode === 'word') {
      input.value = selection;
      context = '';
      status.textContent = '已带入选中的文字';
    }
    input.focus();
  }
  function close() {
    panel.hidden = true;
    opener.hidden = false;
    opener.setAttribute('aria-expanded','false');
    opener.focus();
  }
  function selection() {
    const selected = String(document.getSelection() || '').trim();
    return selected.length <= 240 && /[a-z]/i.test(selected) ? selected : '';
  }
  opener.addEventListener('pointerdown', event => { if (selection()) event.preventDefault(); });
  opener.addEventListener('click', () => open(selection()));
  by('close').addEventListener('click', close);
  by('library').addEventListener('click', () => chrome.runtime.sendMessage({op:'openLibrary'}).catch(() => {
    status.textContent = '无法打开收藏，请点击浏览器工具栏的扩展图标。';
  }));
  for (const button of shadow.querySelectorAll('[data-kind]')) button.addEventListener('click', () => {if (!busy) setMode(button.dataset.kind);});
  by('caption').addEventListener('click', () => {
    if (busy) return;
    const caption = globalThis.phrasePocketCaptions.read();
    if (!caption) {
      status.textContent = '当前没有可读取的英文字幕，直接输入也能保存。';
      input.focus();
      return;
    }
    if (input.value.trim() && input.value !== caption) {
      status.textContent = '先保存或清空输入框，再取字幕。';
      input.focus();
      return;
    }
    context = caption;
    input.value = caption.slice(0, 240);
    input.focus();
    input.select();
    status.textContent = '已带入字幕，留下要记的词再保存';
  });
  by('form').addEventListener('submit', async event => {
    event.preventDefault();
    const text = input.value.trim();
    if (busy || !text) return;
    busy = true;
    input.readOnly = save.disabled = true;
    status.textContent = '正在保存…';
    try {
      const result = await chrome.runtime.sendMessage({op:'save', kind:mode, text, context:mode === 'word' ? context : ''});
      if (!result?.ok) { status.textContent = result?.error || '没有保存成功，请重试。'; return; }
      status.textContent = result.duplicate ? '这条已在收藏里' : mode === 'note' ? '已保存备忘' :
        result.entry.meaning ? '已保存 · 已补中文释义' : result.enrich ? '已保存 · 正在补释义' : '已保存 · 可稍后补释义';
      input.value = draft[mode] = '';
      if (mode === 'word') context = '';
    } catch {
      status.textContent = '没有连上本机收藏，输入内容已保留。';
    } finally {
      busy = false;
      input.readOnly = save.disabled = false;
      if (!panel.hidden) input.focus();
    }
  });
  for (const event of ['keydown','keyup','keypress']) shadow.addEventListener(event, e => {
    if (e.key === 'Escape' && e.type === 'keydown' && !e.isComposing) {e.preventDefault(); close();}
    e.stopPropagation();
  });
  chrome.runtime.onMessage.addListener(message => {
    if (message?.op === 'capture') {
      const selected = selection();
      if (selected && mode !== 'word' && panel.hidden && !draft.word) {open(''); setMode('word'); input.value = selected;}
      else open(selected);
    }
  });
  document.documentElement.append(shell);
})();
