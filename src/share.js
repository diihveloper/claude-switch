'use strict';
// Compartilha histórico e sessões entre contas: os itens abaixo, dentro da pasta de cada conta,
// viram links para os mesmos itens em ~/.claude (a conta "default", que funciona como base).
// Credenciais (.credentials.json) e estado da conta (.claude.json) continuam separados.
const fs = require('fs');
const path = require('path');
const store = require('./store');
const env = require('./env');

const HUB = store.DEFAULT_DIR;

const ITEMS = [
  { name: 'projects', dir: true }, // transcrições das sessões (/resume, --continue)
  { name: 'file-history', dir: true }, // checkpoints para /rewind
  { name: 'paste-cache', dir: true }, // conteúdo colado referenciado pelo histórico
  { name: 'plans', dir: true },
  { name: 'todos', dir: true },
  { name: 'session-env', dir: true },
  { name: 'history.jsonl', dir: false }, // histórico de prompts (seta para cima)
];

function lstat(p) {
  try {
    return fs.lstatSync(p, { bigint: true });
  } catch {
    return null;
  }
}

// 'shared' | 'local' | 'missing' | 'foreign' (link para outro lugar ou quebrado)
function itemStatus(acc, item) {
  const dst = path.join(acc.dir, item.name);
  const src = path.join(HUB, item.name);
  const st = lstat(dst);
  if (!st) return 'missing';
  if (st.isSymbolicLink()) {
    try {
      return env.samePath(fs.realpathSync(dst), fs.realpathSync(src)) ? 'shared' : 'foreign';
    } catch {
      return 'foreign';
    }
  }
  // O histórico é um hardlink: mesmo arquivo físico que o da base.
  if (!item.dir) {
    const hub = lstat(src);
    if (hub && st.ino === hub.ino && st.dev === hub.dev) return 'shared';
  }
  return 'local';
}

// 'base' (a própria ~/.claude) | 'shared' | 'isolated' | 'partial'
function status(acc) {
  if (acc.isDefault) return 'base';
  const states = ITEMS.map((item) => itemStatus(acc, item));
  if (states.every((s) => s === 'shared')) return 'shared';
  if (states.some((s) => s === 'shared')) return 'partial';
  return 'isolated';
}

function move(from, to) {
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.cpSync(from, to, { recursive: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

function sameContent(a, b) {
  try {
    const sa = fs.statSync(a);
    const sb = fs.statSync(b);
    return sa.isFile() && sb.isFile() && sa.size === sb.size && fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch {
    return false;
  }
}

function freeName(target, tag) {
  const { dir, name, ext } = path.parse(target);
  for (let i = 1; ; i++) {
    const candidate = path.join(dir, `${name}.${tag}${i > 1 ? '-' + i : ''}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
}

// Move o conteúdo de "from" para "to" sem sobrescrever nada; conflitos ganham o sufixo da conta.
function mergeDir(from, to, tag) {
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    const f = path.join(from, ent.name);
    const t = path.join(to, ent.name);
    const ts = lstat(t);
    if (!ts) move(f, t);
    else if (ent.isDirectory() && ts.isDirectory()) mergeDir(f, t, tag);
    else if (!sameContent(f, t)) move(f, freeName(t, tag));
  }
}

// Acrescenta à base as linhas do histórico local que ela ainda não tem (append é seguro com o Claude aberto).
function mergeHistory(from, to) {
  const local = fs.readFileSync(from, 'utf8').split(/\r?\n/).filter(Boolean);
  if (!local.length) return;
  const known = new Set(fs.readFileSync(to, 'utf8').split(/\r?\n/));
  const missing = local.filter((line) => !known.has(line));
  if (missing.length) fs.appendFileSync(to, missing.join('\n') + '\n');
}

function link(src, dst, item) {
  if (item.dir) {
    // Junction no Windows não exige admin/modo desenvolvedor; nos demais SOs vira symlink comum.
    fs.symlinkSync(src, dst, 'junction');
    return;
  }
  // Hardlink: no Windows symlink de arquivo exige privilégio, e o Claude recusa histórico via symlink no Linux.
  try {
    fs.linkSync(src, dst);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.symlinkSync(src, dst, 'file');
  }
}

function ensureHubItem(item) {
  const src = path.join(HUB, item.name);
  if (item.dir) fs.mkdirSync(src, { recursive: true });
  else {
    fs.mkdirSync(HUB, { recursive: true });
    fs.closeSync(fs.openSync(src, 'a'));
  }
  return src;
}

// Liga a conta à base, levando para a base o que já existia localmente. Retorna os itens alterados.
function share(acc) {
  if (acc.isDefault) throw new Error(`A conta "${acc.name}" já é a base do histórico compartilhado.`);
  fs.mkdirSync(acc.dir, { recursive: true });
  const changed = [];
  for (const item of ITEMS) {
    const st = itemStatus(acc, item);
    if (st === 'shared') continue;
    const src = ensureHubItem(item);
    const dst = path.join(acc.dir, item.name);
    if (st === 'foreign') fs.rmSync(dst);
    if (st === 'local') {
      if (item.dir) {
        mergeDir(dst, src, acc.name);
        fs.rmSync(dst, { recursive: true, force: true });
      } else {
        mergeHistory(dst, src);
        fs.rmSync(dst);
      }
    }
    link(src, dst, item);
    changed.push(item.name);
  }
  return changed;
}

// Desfaz os links. Com copy, a conta fica com uma cópia do histórico atual; sem, começa vazia.
function unshare(acc, { copy = false } = {}) {
  const changed = [];
  for (const item of ITEMS) {
    if (itemStatus(acc, item) !== 'shared') continue;
    const dst = path.join(acc.dir, item.name);
    const src = path.join(HUB, item.name);
    fs.rmSync(dst); // remove só o link (junction/symlink/hardlink), nunca o conteúdo da base
    if (copy) {
      if (item.dir) fs.cpSync(src, dst, { recursive: true });
      else fs.copyFileSync(src, dst);
    }
    changed.push(item.name);
  }
  return changed;
}

module.exports = { HUB, ITEMS, itemStatus, status, share, unshare };
