'use strict';
// Compartilha dados entre contas: os itens abaixo, dentro da pasta de cada conta, viram links
// para os mesmos itens em ~/.claude (a conta "default", que funciona como base).
// Dois grupos: "history" (histórico e sessões) e "config" (configurações do usuário).
// Credenciais (.credentials.json), estado da conta (.claude.json), MCPs e plugins continuam separados.
const fs = require('fs');
const path = require('path');
const store = require('./store');
const env = require('./env');

const HUB = store.DEFAULT_DIR;

const GROUPS = {
  history: [
    { name: 'projects', dir: true }, // transcrições das sessões (/resume, --continue)
    { name: 'file-history', dir: true }, // checkpoints para /rewind
    { name: 'paste-cache', dir: true }, // conteúdo colado referenciado pelo histórico
    { name: 'plans', dir: true },
    { name: 'todos', dir: true },
    { name: 'session-env', dir: true },
    { name: 'history.jsonl', dir: false, kind: 'log' }, // histórico de prompts (seta para cima)
  ],
  config: [
    { name: 'settings.json', dir: false, kind: 'config', initial: '{}\n' },
    { name: 'CLAUDE.md', dir: false, kind: 'config', initial: '' },
    { name: 'skills', dir: true },
    { name: 'agents', dir: true },
    { name: 'commands', dir: true },
    { name: 'output-styles', dir: true },
  ],
};
const GROUP_NAMES = Object.keys(GROUPS);
const ITEMS = GROUP_NAMES.flatMap((g) => GROUPS[g]);
const itemsOf = (groups = GROUP_NAMES) => groups.flatMap((g) => GROUPS[g] || []);

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
  // Arquivos são hardlinks: mesmo arquivo físico que o da base.
  if (!item.dir) {
    const hub = lstat(src);
    if (hub && st.ino === hub.ino && st.dev === hub.dev) return 'shared';
  }
  return 'local';
}

// 'base' (a própria ~/.claude) | 'shared' | 'isolated' | 'partial', para um grupo.
function status(acc, group = 'history') {
  if (acc.isDefault) return 'base';
  const states = GROUPS[group].map((item) => itemStatus(acc, item));
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

// Arquivo de configuração divergente: vence o modificado por último. O conteúdo vencedor é gravado
// na base no lugar (preserva os hardlinks das outras contas) e o perdedor vai para um backup.
function mergeConfigFile(local, hub, item, tag) {
  if (sameContent(local, hub)) return;
  const backupDir = path.join(store.STORE_DIR, 'backups', `${tag}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(backupDir, { recursive: true });
  const localNewer = fs.statSync(local).mtimeMs > fs.statSync(hub).mtimeMs;
  if (localNewer) {
    fs.copyFileSync(hub, path.join(backupDir, `${item.name}.base`));
    writeInPlace(hub, fs.readFileSync(local));
  } else {
    fs.copyFileSync(local, path.join(backupDir, `${item.name}.${tag}`));
  }
}

function writeInPlace(file, content) {
  const fd = fs.openSync(file, 'r+');
  try {
    fs.ftruncateSync(fd, 0);
    fs.writeSync(fd, content, 0, content.length, 0);
  } finally {
    fs.closeSync(fd);
  }
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

// Garante o item na base. Se só a conta tem o arquivo, ele é movido para a base.
function ensureHubItem(item, localPath) {
  const src = path.join(HUB, item.name);
  if (item.dir) fs.mkdirSync(src, { recursive: true });
  else if (!fs.existsSync(src)) {
    fs.mkdirSync(HUB, { recursive: true });
    if (localPath && lstat(localPath) && !lstat(localPath).isSymbolicLink()) move(localPath, src);
    else fs.writeFileSync(src, item.initial ?? '', { flag: 'a' });
  }
  return src;
}

// Liga a conta à base, levando para a base o que já existia localmente. Retorna os itens alterados.
function share(acc, { groups = ['history'] } = {}) {
  if (acc.isDefault) throw new Error(`A conta "${acc.name}" já é a base dos dados compartilhados.`);
  fs.mkdirSync(acc.dir, { recursive: true });
  const changed = [];
  for (const item of itemsOf(groups)) {
    const dst = path.join(acc.dir, item.name);
    if (itemStatus(acc, item) === 'shared') continue;
    const src = ensureHubItem(item, dst);
    const st = itemStatus(acc, item); // pode ter mudado: o arquivo local pode ter virado a base
    if (st === 'foreign') fs.rmSync(dst);
    if (st === 'local') {
      if (item.dir) {
        mergeDir(dst, src, acc.name);
        fs.rmSync(dst, { recursive: true, force: true });
      } else {
        if (item.kind === 'log') mergeHistory(dst, src);
        else mergeConfigFile(dst, src, item, acc.name);
        fs.rmSync(dst);
      }
    }
    if (!lstat(dst)) link(src, dst, item);
    changed.push(item.name);
  }
  return changed;
}

// Desfaz os links. Com copy, a conta fica com uma cópia do histórico atual; sem, começa vazia.
function unshare(acc, { copy = false, groups = GROUP_NAMES } = {}) {
  const changed = [];
  for (const item of itemsOf(groups)) {
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

module.exports = { HUB, GROUPS, GROUP_NAMES, ITEMS, itemStatus, status, share, unshare };
