globalThis.PocketTransfer = (() => {
  function records(entries) {
    if (!Array.isArray(entries)) throw Error('备份中的收藏列表格式不正确。');
    return entries.map(entry => {
      if (!entry || !['word','note'].includes(entry.kind) || typeof entry.text !== 'string' ||
        !entry.text.trim() || entry.text.length > 240 ||
        (entry.meaning != null && (typeof entry.meaning !== 'string' || entry.meaning.length > 320))) {
        throw Error('备份中有格式不正确的记录，尚未开始导入。');
      }
      if (entry.kind === 'word' && !entry.text.normalize('NFKC').replace(/[.!?…\s]/g,'')) {
        throw Error('备份中有空白单词，尚未开始导入。');
      }
      return {kind:entry.kind, text:entry.text, meaning:entry.kind === 'word' ? entry.meaning || '' : '',
        source:['builtin','ecdict','model','manual'].includes(entry.source) ? entry.source : 'manual',
        createdAt:typeof entry.createdAt === 'string' ? entry.createdAt : undefined,
        review:['known','again'].includes(entry.review) ? entry.review : undefined,
        reviewedAt:typeof entry.reviewedAt === 'string' ? entry.reviewedAt : undefined};
    });
  }
  function parseBackup(text) {
    let value;
    try {value = JSON.parse(text);} catch {throw Error('文件内容不是有效的 JSON 备份。');}
    if (Array.isArray(value)) return records(value);
    if (value?.format !== 'phrase-pocket' || value.version !== 1) throw Error('请选择随手收导出的 JSON 备份。');
    return records(value.entries);
  }
  function backup(entries) {
    return JSON.stringify({format:'phrase-pocket',version:1,exportedAt:new Date().toISOString(),entries:records(entries)},null,2);
  }
  function anki(entries) {
    const selected = entries.filter(entry => entry.kind === 'word' && entry.meaning?.trim());
    const quote = value => '"' + value.replaceAll('"','""') + '"';
    const lines = selected.map(entry => quote(entry.text) + '\t' + quote(entry.meaning));
    return {count:selected.length,text:'#separator:Tab\n#html:false\n#columns:英文\t中文释义\n' + lines.join('\n')};
  }
  return {parseBackup,backup,anki};
})();
