import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const revision = '39cfb9672c0906b63569e0453c2e6abfb9ab182a';
const sourceBlob = '0e527e22e0e0d22f012b0ed251a8dddd5891773b';
const sourceSize = 66009548;
const entryLimit = 60000;
const dictionaryVersion = '1:' + sourceBlob;
const output = fileURLToPath(new URL('../build/', import.meta.url));
const target = path.join(output, 'ecdict-bundled.db');
const cache = path.join(output, 'ecdict-' + revision.slice(0, 8) + '.csv');
const urls = [
  'https://raw.githubusercontent.com/skywind3000/ECDICT/' + revision + '/ecdict.csv',
  'https://api.github.com/repos/skywind3000/ECDICT/contents/ecdict.csv?ref=' + revision
];

function validate(bytes) {
  if (bytes.length !== sourceSize) throw Error('Unexpected ECDICT download size.');
  const hash = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
  if (hash !== sourceBlob) throw Error('ECDICT download does not match the pinned Git blob.');
  return bytes;
}

async function getSource() {
  try {
    return validate(await readFile(cache));
  } catch {
    // A partial or outdated cache is replaced only after validating the new download.
  }
  const errors = [];
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/vnd.github.raw+json' },
        signal: AbortSignal.timeout(120000)
      });
      if (!response.ok) throw Error('HTTP ' + response.status);
      const bytes = validate(Buffer.from(await response.arrayBuffer()));
      await writeFile(cache, bytes);
      return bytes;
    } catch (error) {
      errors.push(error.message);
    }
  }
  throw Error('Could not download the pinned ECDICT source. ' + errors.join(' / '));
}

function* csvRows(text) {
  const field = /(?:"((?:[^"]|"")*)"|([^,"\r\n]*))(,|\r\n|\n|\r|$)/gy;
  let position = 0;
  while (position < text.length) {
    const row = [];
    let delimiter;
    do {
      field.lastIndex = position;
      const match = field.exec(text);
      if (!match) throw Error('Invalid CSV near character ' + position);
      row.push(match[1] === undefined ? match[2] : match[1].replaceAll('""', '"'));
      delimiter = match[3];
      position = field.lastIndex;
    } while (delimiter === ',');
    yield row;
  }
}

function frequencyRank(value) {
  const rank = Number(value);
  return Number.isInteger(rank) && rank > 0 ? rank : Infinity;
}

function selectEntries(bytes) {
  const rows = csvRows(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const header = rows.next().value;
  const columns = ['word', 'translation', 'frq', 'bnc'].map(name => header?.indexOf(name) ?? -1);
  if (columns.includes(-1)) throw Error('Missing ECDICT columns.');
  const [wordColumn, translationColumn, frqColumn, bncColumn] = columns;
  const entries = new Map();
  for (const row of rows) {
    const word = row[wordColumn]?.normalize('NFKC').trim().toLowerCase()
      .replace(/[’‘]/g, "'").replace(/\s+/g, ' ');
    if (!word || word.length > 64 || !/^[a-z][a-z0-9 .'-]*$/.test(word)) continue;
    const translation = row[translationColumn]?.split(/\\n|\r?\n/)
      .map(line => line.trim())
      .filter(line => /[\u3400-\u9fff]/.test(line))
      .slice(0, 2).join('\n').slice(0, 140);
    if (!translation) continue;
    const rank = Math.min(frequencyRank(row[frqColumn]), frequencyRank(row[bncColumn]));
    if (!entries.has(word) || entries.get(word).rank > rank) entries.set(word, {word, translation, rank});
  }
  return Array.from(entries.values()).sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.word < b.word ? -1 : 1;
  }).slice(0, entryLimit);
}

function isCurrent() {
  let db;
  try {
    db = new DatabaseSync(target, { readOnly: true });
    const metadata = db.prepare('SELECT version, entry_count FROM dictionary_meta').get();
    return metadata?.version === dictionaryVersion && metadata.entry_count === entryLimit;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

async function writeDictionary(entries) {
  const temporary = target + '.' + randomUUID() + '.tmp';
  try {
    const db = new DatabaseSync(temporary);
    try {
      db.exec('CREATE TABLE stardict (word TEXT PRIMARY KEY COLLATE NOCASE, translation TEXT NOT NULL) WITHOUT ROWID');
      db.exec('CREATE TABLE dictionary_meta (version TEXT NOT NULL, entry_count INTEGER NOT NULL)');
      db.exec('BEGIN');
      const insert = db.prepare('INSERT INTO stardict (word, translation) VALUES (?, ?)');
      for (const entry of entries) insert.run(entry.word, entry.translation);
      db.prepare('INSERT INTO dictionary_meta VALUES (?, ?)').run(dictionaryVersion, entries.length);
      db.exec('COMMIT');
    } finally {
      db.close();
    }
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

await mkdir(output, { recursive: true });
if (!isCurrent()) {
  const entries = selectEntries(await getSource());
  if (entries.length !== entryLimit) throw Error('The ECDICT data did not yield the expected number of entries.');
  await writeDictionary(entries);
}
console.log('Bundled ECDICT ready: ' + entryLimit + ' entries.');
