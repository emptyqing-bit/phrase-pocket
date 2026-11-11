// The extension's library works without the optional Windows bridge.
const LocalPocket = (() => {
  const normalize = text => text.normalize('NFKC').trim().replace(/[’‘]/g, "'").toLowerCase().replace(/[.!?…]+$/g,'').trim().replace(/\s+/g, ' ');
  const clean = (value, limit) => typeof value === 'string' ? value.replace(/\0/g, '').trim().slice(0, limit).replace(/[\uD800-\uDBFF]$/, '') : '';
  const match = (kind,a,b) => kind === 'word' ? normalize(a) === normalize(b) : a === b;
  const bad = {ok:false, code:'bad_request'};
  let lexicon;
  function unpack(stored) {
    if (Array.isArray(stored)) return stored;
    return [...stored.words, ...stored.notes];
  }
  function store(entries, extra = {}) {
    if (entries.some(entry => !entry || (entry.kind !== 'word' && entry.kind !== 'note')))
      throw Error('Invalid collection entry.');
    return chrome.storage.local.set({...extra, entries:{
      words:entries.filter(entry => entry.kind === 'word'),
      notes:entries.filter(entry => entry.kind === 'note')
    }});
  }
  async function define(text, context) {
    lexicon ??= fetch(chrome.runtime.getURL('lexicon.json')).then(r => {
      if (!r.ok) throw Error('lexicon');
      return r.json();
    }).catch(() => {lexicon = null; return {};});
    const terms = await lexicon;
    const key = normalize(text);
    const lookup = key === "i'm down" && normalize(context || '').includes("i'm down for that") ? "i'm down for that" : key;
    return Object.hasOwn(terms, lookup) ? terms[lookup] : '';
  }
  async function handle(request, entries) {
    const existing = entries.find(x => x.id === request.id);
    const text = clean(request.text,240);
    const commit = async result => {
      await store(entries);
      return result;
    };
    switch (request.op) {
      case 'list': {
        const offset = Math.max(0, Number.isInteger(request.offset) ? request.offset : 0);
        const query = clean(request.query,120).toLocaleLowerCase();
        const selected = entries.filter(entry => (!['word','note'].includes(request.kind) || entry.kind === request.kind) &&
          (!query || (entry.text + '\n' + (entry.meaning || '')).toLocaleLowerCase().includes(query)));
        return {ok:true, entries:selected.reverse().slice(offset,offset+100), total:selected.length};
      }
      case 'save': {
        const kind = request.kind;
        if (!['word','note'].includes(kind) || !text || (kind === 'word' && !normalize(text))) return bad;
        const duplicate = entries.find(x => x.kind === kind && match(kind,x.text,text));
        if (duplicate) return {ok:true, entry:duplicate, duplicate:true};
        const meaning = kind === 'word' ? await define(text,clean(request.context,360)) : '';
        const entry = {id:crypto.randomUUID(), kind, text, meaning, source:meaning ? 'builtin' : '', createdAt:new Date().toISOString()};
        entries.push(entry);
        return commit({ok:true, entry, duplicate:false});
      }
      case 'update': {
        if (!existing) return {ok:false, code:'not_found'};
        if (!text || (existing.kind === 'word' && !normalize(text))) return bad;
        if (entries.some(x => x.id !== existing.id && x.kind === existing.kind && match(x.kind,x.text,text))) return {ok:false, code:'duplicate'};
        const changed = !match(existing.kind,existing.text,text);
        existing.text = text;
        if (existing.kind === 'word') {
          const meaning = clean(request.meaning,320);
          if (meaning !== existing.meaning) {
            existing.meaning = meaning;
            existing.source = meaning ? 'manual' : '';
          } else if (changed) {
            existing.meaning = await define(text,'');
            existing.source = existing.meaning ? 'builtin' : '';
          }
        }
        return commit({ok:true, entry:existing});
      }
      case 'retry': {
        if (existing?.kind !== 'word') return {ok:false, code:'not_found'};
        if (!existing.meaning) {
          existing.meaning = await define(existing.text,'');
          existing.source = existing.meaning ? 'builtin' : '';
        }
        return commit({ok:true, entry:existing});
      }
      case 'delete':
        if (!existing) return {ok:false, code:'not_found'};
        entries.splice(entries.indexOf(existing),1);
        return commit({ok:true});
      case 'import': {
        if (!Array.isArray(request.entries) || request.entries.length > 4) return bad;
        for (const entry of request.entries) {
          if (!entry || !['word','note'].includes(entry.kind) || !clean(entry.text,240) ||
            (entry.kind === 'word' && !normalize(clean(entry.text,240)))) return bad;
        }
        for (const value of request.entries) {
          const text = clean(value.text,240);
          const meaning = value.kind === 'word' ? clean(value.meaning,320) : '';
          const source = ['builtin','ecdict','model'].includes(value.source) ? value.source : 'manual';
          const previous = entries.find(entry => entry.kind === value.kind && match(value.kind,entry.text,text));
          if (previous) {
            if (meaning && (!previous.meaning || (source === 'manual' && previous.source !== 'manual'))) {
              previous.meaning = meaning;
              previous.source = source;
            }
            continue;
          }
          const entry = {id:crypto.randomUUID(), kind:value.kind, text, meaning, source:meaning ? source : '',
            createdAt:Number.isFinite(Date.parse(value.createdAt)) ? new Date(value.createdAt).toISOString() : new Date().toISOString()};
          if (entry.kind === 'word' && !meaning) {
            entry.meaning = await define(text,'');
            entry.source = entry.meaning ? 'builtin' : '';
          }
          if (entry.kind === 'word' && ['known','again'].includes(value.review) && Number.isFinite(Date.parse(value.reviewedAt))) {
            entry.review = value.review;
            entry.reviewedAt = new Date(value.reviewedAt).toISOString();
          }
          entries.push(entry);
        }
        return commit({ok:true});
      }
      default: return bad;
    }
  }
  return {handle, unpack, store};
})();
