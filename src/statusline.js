'use strict';
// Statusline do Claude Code: mostra a conta ativa e o uso dentro da própria sessão.
// O Claude chama o comando com frequência, então ele só lê o cache e o atualiza em segundo plano.
const fs = require('fs');
const path = require('path');
const env = require('./env');
const accounts = require('./accounts');
const status = require('./status');
const { writeInPlace } = require('./install');

const CORE = path.resolve(__dirname, '..', 'bin', 'claude-switch.js');
const STALE_SECONDS = 300;

const ansi = (code, s) => (process.env.NO_COLOR ? s : `\x1b[${code}m${s}\x1b[0m`);
const COLOR = { green: '32', yellow: '33', red: '31', gray: '90' };

function render() {
  const raw = env.getSession();
  const acc = accounts.byEnvValue(raw);
  if (!acc) return ansi('33', '◆ conta não registrada');
  const entry = status.readCache()[acc.name];
  if (!entry || Date.now() - entry.fetchedAt > STALE_SECONDS * 1000) status.refreshInBackground(STALE_SECONDS);

  const parts = [ansi('1;' + COLOR[status.level(entry?.status ? null : entry)], `◆ ${acc.name}`)];
  if (entry?.status) parts.push(ansi('90', entry.status.replace(/\s*\(.*\)$/, '')));
  else if (entry) {
    for (const [key, label] of [['five_hour', '5h'], ['seven_day', 'semana']]) {
      const w = entry.windows.find((x) => x.key === key);
      if (!w) continue;
      const pct = Math.round(w.pct);
      const color = pct >= 90 ? COLOR.red : pct >= 70 ? COLOR.yellow : COLOR.green;
      const reset = key === 'five_hour' && w.resetsAt
        ? ansi('90', ` ↻${new Date(w.resetsAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`)
        : '';
      parts.push(`${label} ${ansi(color, pct + '%')}${reset}`);
    }
  } else parts.push(ansi('90', 'carregando uso…'));
  return parts.join(ansi('90', ' · '));
}

// Comando gravado no settings.json. Barras "/" funcionam tanto no Git Bash quanto no cmd.
function command() {
  const fwd = (p) => p.replace(/\\/g, '/');
  return `"${fwd(process.execPath)}" "${fwd(CORE)}" statusline`;
}

const isOurs = (sl) => !!sl && typeof sl.command === 'string' && /claude-switch(\.js)?["']?\s+statusline/.test(sl.command);

// settings.json únicos de todas as contas (os compartilhados são o mesmo arquivo físico).
function settingsFiles() {
  const seen = new Set();
  const files = [];
  for (const acc of accounts.all()) {
    const file = path.join(acc.dir, 'settings.json');
    let id = file;
    try {
      const st = fs.statSync(file, { bigint: true });
      id = `${st.dev}:${st.ino}`;
    } catch {
      // ainda não existe
    }
    if (!seen.has(id)) {
      seen.add(id);
      files.push({ acc, file });
    }
  }
  return files;
}

function readSettings(file) {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8').trim();
  return text ? JSON.parse(text) : {};
}

// Retorna [{ file, result: 'installed' | 'already' | 'skipped' (outra statusline) }].
function install({ force = false } = {}) {
  return settingsFiles().map(({ file }) => {
    const settings = readSettings(file);
    if (settings.statusLine && !isOurs(settings.statusLine) && !force) return { file, result: 'skipped' };
    const wanted = { type: 'command', command: command(), padding: 0 };
    if (isOurs(settings.statusLine) && settings.statusLine.command === wanted.command) return { file, result: 'already' };
    settings.statusLine = wanted;
    writeInPlace(file, JSON.stringify(settings, null, 2) + '\n');
    return { file, result: 'installed' };
  });
}

function uninstall() {
  return settingsFiles()
    .filter(({ file }) => isOurs(readSettings(file).statusLine))
    .map(({ file }) => {
      const settings = readSettings(file);
      delete settings.statusLine;
      writeInPlace(file, JSON.stringify(settings, null, 2) + '\n');
      return file;
    });
}

function installed() {
  return settingsFiles().some(({ file }) => {
    try {
      return isOurs(readSettings(file).statusLine);
    } catch {
      return false;
    }
  });
}

module.exports = { render, install, uninstall, installed };
