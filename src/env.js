'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const store = require('./store');

const VAR = 'CLAUDE_CONFIG_DIR';
const isWin = process.platform === 'win32';

// Normaliza caminhos para comparação: aceita "/c/Users/..." (Git Bash), "C:/..." e "C:\...".
function norm(p) {
  if (!p) return '';
  let s = String(p).trim();
  if (isWin) {
    const m = s.match(/^\/([a-zA-Z])(?:\/(.*))?$/);
    if (m) s = `${m[1]}:\\${m[2] || ''}`;
  }
  s = path.resolve(s);
  return isWin ? s.toLowerCase() : s;
}

function samePath(a, b) {
  return norm(a) === norm(b);
}

function getSession() {
  return process.env[VAR] || null;
}

// Fora do Windows, a conta global fica num arquivo que a função "csw" aplica ao abrir o shell.
const GLOBAL_FILE = path.join(store.STORE_DIR, 'global');

// Lê a conta global: variável persistente do usuário (HKCU\Environment) no Windows, arquivo nos demais.
function getGlobal() {
  if (!isWin) {
    try {
      return fs.readFileSync(GLOBAL_FILE, 'utf8').trim() || null;
    } catch {
      return null;
    }
  }
  const r = spawnSync('reg', ['query', 'HKCU\\Environment', '/v', VAR], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) return null;
  const m = r.stdout.match(new RegExp(`${VAR}\\s+REG_(?:EXPAND_)?SZ\\s+(.*)`));
  return m ? m[1].trim() || null : null;
}

// Grava (ou remove, se dir for null) a conta global.
function setGlobal(dir) {
  if (!isWin) {
    if (dir) {
      fs.mkdirSync(store.STORE_DIR, { recursive: true });
      fs.writeFileSync(GLOBAL_FILE, dir + '\n');
    } else {
      fs.rmSync(GLOBAL_FILE, { force: true });
    }
    return;
  }
  // Via .NET para disparar o WM_SETTINGCHANGE (novos terminais enxergam a mudança).
  const value = dir ? `'${dir.replace(/'/g, "''")}'` : '$null';
  const script = `[Environment]::SetEnvironmentVariable('${VAR}', ${value}, 'User')`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`Falha ao gravar ${VAR} global: ${r.stderr.trim()}`);
}

// Gera o código de shell que o wrapper (csw) avalia no terminal atual.
function emit(shell, dir) {
  if (shell === 'pwsh') {
    return dir
      ? `$env:${VAR} = '${dir.replace(/'/g, "''")}'`
      : `Remove-Item Env:${VAR} -ErrorAction SilentlyContinue`;
  }
  if (shell === 'bash') {
    // Barras normais: o Node/Claude no Windows aceita e o MSYS não tenta converter.
    const v = isWin ? dir && dir.replace(/\\/g, '/') : dir;
    return v ? `export ${VAR}='${v.replace(/'/g, `'\\''`)}'` : `unset ${VAR}`;
  }
  return '';
}

module.exports = { VAR, isWin, GLOBAL_FILE, norm, samePath, getSession, getGlobal, setGlobal, emit };
