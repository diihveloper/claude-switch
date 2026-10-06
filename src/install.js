'use strict';
// Instalação da função "csw" nos profiles dos shells.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const store = require('./store');
const env = require('./env');

const ROOT = path.resolve(__dirname, '..');
// Incrementar quando shell/csw.ps1 ou shell/csw.sh mudarem de forma incompatível (o doctor avisa).
const WRAPPER_VERSION = 3;

const MARK_BEGIN = '# >>> claude-switch >>>';
const MARK_END = '# <<< claude-switch <<<';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BLOCK_RE = new RegExp(`\\r?\\n?${esc(MARK_BEGIN)}[\\s\\S]*?${esc(MARK_END)}\\r?\\n?`);

function toPosix(p) {
  return env.isWin ? p.replace(/^([A-Za-z]):/, (_, d) => '/' + d.toLowerCase()).replace(/\\/g, '/') : p;
}

function psProfiles() {
  const found = new Set();
  for (const exe of ['pwsh', 'powershell']) {
    const r = spawnSync(exe, ['-NoProfile', '-NonInteractive', '-Command', '$PROFILE.CurrentUserCurrentHost'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    const p = !r.error && r.status === 0 && r.stdout.trim();
    if (p) found.add(p);
  }
  return [...found];
}

function targets() {
  const ps1 = path.join(ROOT, 'shell', 'csw.ps1');
  const sh = toPosix(path.join(ROOT, 'shell', 'csw.sh'));
  const list = psProfiles().map((file) => ({
    file,
    block: `${MARK_BEGIN}\nif (Test-Path '${ps1}') { . '${ps1}' }\n${MARK_END}`,
  }));
  const shBlock = `${MARK_BEGIN}\n[ -f '${sh}' ] && . '${sh}'\n${MARK_END}`;
  list.push({ file: path.join(store.HOME, '.bashrc'), block: shBlock });
  const zshrc = path.join(store.HOME, '.zshrc');
  if (fs.existsSync(zshrc) || /zsh$/.test(process.env.SHELL || '')) list.push({ file: zshrc, block: shBlock });
  return list;
}

// Reescreve no lugar: no Windows, writeFileSync falha com EPERM em arquivos ocultos (ex.: ~/.zshrc),
// e reescrever no lugar também preserva hardlinks (settings.json compartilhado).
function writeInPlace(file, content) {
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return;
  }
  const buf = Buffer.from(content, 'utf8');
  const fd = fs.openSync(file, 'r+');
  try {
    fs.ftruncateSync(fd, 0);
    fs.writeSync(fd, buf, 0, buf.length, 0);
  } finally {
    fs.closeSync(fd);
  }
}

// 'ok' | 'missing' (sem bloco) | 'outdated' (bloco aponta para outra instalação)
function blockStatus({ file, block }) {
  if (!fs.existsSync(file)) return 'missing';
  const m = fs.readFileSync(file, 'utf8').match(BLOCK_RE);
  if (!m) return 'missing';
  return m[0].replace(/\r/g, '').trim() === block ? 'ok' : 'outdated';
}

function installTarget({ file, block }) {
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const stripped = current.replace(BLOCK_RE, '\n').replace(/\n+$/, '');
  writeInPlace(file, (stripped ? stripped + '\n\n' : '') + block + '\n');
}

function uninstallTarget({ file }) {
  if (!fs.existsSync(file)) return false;
  const current = fs.readFileSync(file, 'utf8');
  if (!BLOCK_RE.test(current)) return false;
  writeInPlace(file, current.replace(BLOCK_RE, '\n').replace(/\n+$/, '') + '\n');
  return true;
}

module.exports = { ROOT, WRAPPER_VERSION, targets, blockStatus, installTarget, uninstallTarget, writeInPlace };
