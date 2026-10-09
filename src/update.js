'use strict';
// Atualiza a instalação (git pull na pasta do app) e reinicia o ícone da bandeja, se estiver rodando.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const store = require('./store');
const tray = require('./tray');

const ROOT = path.resolve(__dirname, '..');
// Recado deixado para o ícone da bandeja mostrar numa notificação (o update pode reiniciá-lo).
const NOTE_FILE = path.join(store.STORE_DIR, 'update-note.json');
const REPO_URL = 'https://github.com/diihveloper/claude-switch.git';

function git(args) {
  const r = spawnSync('git', ['-C', ROOT, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (r.error) throw new Error('O git não foi encontrado. Instale o Git (https://git-scm.com) e tente de novo.');
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

function mustGit(args, msg) {
  const r = git(args);
  if (!r.ok) throw new Error(`${msg}${r.err ? `\n${r.err}` : ''}`);
  return r.out;
}

const version = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  } catch {
    return null;
  }
};

// Retorna { updated, from, to, commits[], shellChanged, trayRestarted }.
function run({ interval, threshold } = {}) {
  if (!fs.existsSync(path.join(ROOT, '.git'))) {
    throw new Error(`A pasta ${ROOT} não é um clone do git, então não dá para atualizar automaticamente.\n` +
      `Baixe de novo com: git clone ${REPO_URL} "${ROOT}"`);
  }
  const dirty = git(['status', '--porcelain', '--untracked-files=no']).out;
  if (dirty) {
    throw new Error(`Há arquivos alterados na pasta do app (${ROOT}):\n${dirty}\n` +
      `Para descartar as alterações: git -C "${ROOT}" checkout -- .  (ou guarde com: git -C "${ROOT}" stash)`);
  }
  mustGit(['rev-parse', '--abbrev-ref', '@{u}'], 'A branch atual não acompanha uma branch remota (use a main).');
  mustGit(['fetch', '--quiet'], 'Não foi possível baixar as novidades (verifique a internet).');

  const from = { version: version(), commit: mustGit(['rev-parse', '--short', 'HEAD'], 'git rev-parse falhou') };
  const commits = mustGit(['log', '--format=%s', 'HEAD..@{u}'], 'git log falhou').split('\n').filter(Boolean);
  if (!commits.length) return { updated: false, from, to: from, commits };

  const shellChanged = !!git(['diff', '--name-only', 'HEAD', '@{u}', '--', 'shell/csw.ps1', 'shell/csw.sh']).out;
  mustGit(['merge', '--ff-only', '--quiet', '@{u}'],
    `Não foi possível atualizar: a pasta tem commits locais. Rode: git -C "${ROOT}" pull --rebase`);
  const to = { version: version(), commit: mustGit(['rev-parse', '--short', 'HEAD'], 'git rev-parse falhou') };

  // O ícone carregou o código antigo: reinicia para pegar o novo.
  let trayRestarted = false;
  if ((process.platform === 'win32' || process.platform === 'linux') && tray.runningPid()) {
    tray.stop();
    tray.start({ interval, threshold });
    trayRestarted = true;
  }
  return { updated: true, from, to, commits, shellChanged, trayRestarted };
}

function writeNote(note) {
  try {
    fs.mkdirSync(store.STORE_DIR, { recursive: true });
    fs.writeFileSync(NOTE_FILE, JSON.stringify(note));
  } catch {}
}

module.exports = { run, writeNote, NOTE_FILE, ROOT };
