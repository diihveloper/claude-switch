'use strict';
// Ícone na bandeja do sistema.
// Windows: shell/tray.ps1 (Windows Forms, nada a instalar). Linux: este processo Node controlando o "yad".
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawn, spawnSync } = require('child_process');
const store = require('./store');
const status = require('./status');

const ROOT = path.resolve(__dirname, '..');
const CORE = path.join(ROOT, 'bin', 'claude-switch.js');
const TRAY_PS1 = path.join(ROOT, 'shell', 'tray.ps1');
const PID_FILE = path.join(store.STORE_DIR, 'tray.pid');
const isWin = process.platform === 'win32';
const isLinux = process.platform === 'linux';

function assertSupported() {
  if (!isWin && !isLinux) throw new Error('O ícone na bandeja está disponível no Windows e no Linux.');
}

function runningPid() {
  try {
    const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
    if (!pid) return null;
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- Windows

const WIN_PS = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

function winArgs(interval) {
  return ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-WindowStyle', 'Hidden', '-File', TRAY_PS1,
    '-Core', CORE, '-Node', process.execPath, '-Interval', String(interval)];
}

function runPowerShell(script, extraEnv = {}) {
  const r = spawnSync(WIN_PS, ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, ...extraEnv },
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(r.stderr.trim() || `powershell saiu com código ${r.status}`);
  return r.stdout.trim();
}

function winShortcut() {
  return path.join(runPowerShell("[Environment]::GetFolderPath('Startup')"), 'claude-switch tray.lnk');
}

// ---------------------------------------------------------------- Linux

function hasYad() {
  const r = spawnSync('yad', ['--version'], { stdio: 'ignore' });
  return !r.error;
}

const LINUX_AUTOSTART = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart', 'claude-switch-tray.desktop');

// PNG mínimo (círculo colorido) gerado sem dependências.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function circlePng([r, g, b], size = 22) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const mid = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - mid, y - mid);
      const alpha = Math.max(0, Math.min(1, mid + 0.5 - d)); // borda suavizada
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = Math.round(alpha * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const COLORS = { green: [46, 158, 91], yellow: [217, 164, 0], red: [214, 69, 69], gray: [128, 128, 128] };

function ensureIcons() {
  const dir = path.join(store.STORE_DIR, 'icons');
  fs.mkdirSync(dir, { recursive: true });
  const files = {};
  for (const [name, rgb] of Object.entries(COLORS)) {
    files[name] = path.join(dir, `${name}.png`);
    if (!fs.existsSync(files[name])) fs.writeFileSync(files[name], circlePng(rgb));
  }
  return files;
}

const pctOf = (acc, key) => {
  const w = acc?.usage?.windows?.find((x) => x.key === key);
  return w ? Math.round(w.pct) : null;
};

function level(acc) {
  const pcts = (acc?.usage?.windows || []).map((w) => w.pct);
  if (!pcts.length) return 'gray';
  const max = Math.max(...pcts);
  return max >= 90 ? 'red' : max >= 70 ? 'yellow' : 'green';
}

function summary(acc) {
  if (acc.usage?.status) return acc.usage.status.replace(/\s*\(.*\)$/, '');
  const five = pctOf(acc, 'five_hour');
  const week = pctOf(acc, 'seven_day');
  return [five != null && `5h ${five}%`, week != null && `semana ${week}%`].filter(Boolean).join(' · ') || 'sem dados';
}

// yad interpreta "!" e "|" como separadores do menu.
const yadSafe = (s) => String(s).replace(/[!|\n]/g, ' ');
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function runLinuxForeground(interval) {
  if (!hasYad()) throw new Error('Instale o "yad" para usar o ícone na bandeja (ex.: sudo apt install yad).');
  if (runningPid() && runningPid() !== process.pid) throw new Error('O ícone já está rodando.');
  fs.mkdirSync(store.STORE_DIR, { recursive: true });
  fs.writeFileSync(PID_FILE, String(process.pid));
  const icons = ensureIcons();
  const node = shq(process.execPath);
  const core = shq(CORE);
  const terminal = spawnSync('sh', ['-c', 'command -v x-terminal-emulator'], { encoding: 'utf8' }).stdout.trim();

  const yad = spawn('yad', ['--notification', '--listen', '--command=menu', '--no-middle', `--image=${icons.gray}`, '--text=claude-switch'], {
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  const send = (line) => yad.stdin.writable && yad.stdin.write(line + '\n');

  let busy = false;
  let forceFull = true;
  async function refresh() {
    if (busy) return;
    busy = true;
    try {
      const st = await status.collect({ maxAge: forceFull ? 0 : interval * 60 });
      forceFull = false;
      const g = st.accounts.find((a) => a.isGlobal) || st.accounts[0];
      send(`icon:${icons[level(g)]}`);
      send(`tooltip:${yadSafe(`Claude · ${g.name}`)}\\n${yadSafe(summary(g))}`);
      const items = st.accounts.map((a) => `${a.isGlobal ? '● ' : '○ '}${yadSafe(a.name)} — ${yadSafe(summary(a))}!${node} ${core} use ${a.name}`);
      if (terminal) {
        for (const a of st.accounts) {
          const envCmd = a.envValue ? `env CLAUDE_CONFIG_DIR=${shq(a.envValue)}` : 'env -u CLAUDE_CONFIG_DIR';
          items.push(`Abrir Claude: ${yadSafe(a.name)}!${shq(terminal)} -e ${envCmd} claude`);
        }
      }
      items.push(`Atualizar uso agora!kill -USR1 ${process.pid}`);
      items.push(`Sair!kill ${process.pid}`);
      send(`menu:${items.join('|')}`);
    } catch (err) {
      send(`tooltip:${yadSafe('claude-switch: ' + err.message)}`);
    } finally {
      busy = false;
    }
  }

  const stop = () => {
    send('quit');
    yad.kill();
    try {
      if (Number(fs.readFileSync(PID_FILE, 'utf8')) === process.pid) fs.rmSync(PID_FILE);
    } catch {}
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  process.on('SIGUSR1', () => {
    forceFull = true;
    refresh();
  });
  yad.on('exit', stop);

  refresh();
  // Estado local (conta global) a cada 15s; a API de uso só quando o cache passa do intervalo.
  setInterval(refresh, 15000);
}

// ---------------------------------------------------------------- comandos

function start({ interval = 5 } = {}) {
  assertSupported();
  if (runningPid()) return { already: true };
  if (isWin) {
    // Um spawn "detached" do Node cria o PowerShell sem console e ele encerra na hora;
    // o Start-Process cria o processo de forma independente e oculta.
    // O Windows PowerShell junta o -ArgumentList com espaços sem aspas: caminhos com espaço vão entre "".
    const args = winArgs(interval)
      .map((a) => (/\s/.test(a) ? `"${a}"` : a))
      .map((a) => `'${a.replace(/'/g, "''")}'`)
      .join(',');
    runPowerShell(`Start-Process -FilePath $env:CSW_PS -ArgumentList ${args} -WindowStyle Hidden`, { CSW_PS: WIN_PS });
  } else {
    if (!hasYad()) throw new Error('Instale o "yad" para usar o ícone na bandeja (ex.: sudo apt install yad).');
    spawn(process.execPath, [CORE, 'tray', 'run', '--interval', String(interval)], { detached: true, stdio: 'ignore' }).unref();
  }
  return { already: false };
}

function stop() {
  assertSupported();
  const pid = runningPid();
  if (!pid) return false;
  if (isWin) {
    // Sinaliza o próprio script para ele remover o ícone antes de sair; mata só se não responder.
    try {
      runPowerShell("[Threading.EventWaitHandle]::OpenExisting('Local\\claude-switch-tray-stop').Set() | Out-Null");
      const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
      for (let i = 0; i < 30 && runningPid(); i++) sleep(100);
    } catch {}
    if (runningPid()) process.kill(pid);
  } else {
    process.kill(pid, 'SIGTERM');
  }
  try {
    fs.rmSync(PID_FILE, { force: true });
  } catch {}
  return true;
}

function autostartFile() {
  return isWin ? winShortcut() : LINUX_AUTOSTART;
}

function autostartEnabled() {
  assertSupported();
  return fs.existsSync(autostartFile());
}

function setAutostart(enabled, { interval = 5 } = {}) {
  assertSupported();
  const file = autostartFile();
  if (!enabled) {
    fs.rmSync(file, { force: true });
    return file;
  }
  if (isWin) {
    const args = winArgs(interval).map((a) => (/[\s"]/.test(a) ? `"${a}"` : a)).join(' ');
    runPowerShell(
      `$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:CSW_LNK); $s.TargetPath = $env:CSW_TARGET; ` +
        `$s.Arguments = $env:CSW_ARGS; $s.WindowStyle = 7; $s.Description = 'claude-switch tray'; $s.Save()`,
      { CSW_LNK: file, CSW_TARGET: WIN_PS, CSW_ARGS: args }
    );
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      ['[Desktop Entry]', 'Type=Application', 'Name=claude-switch tray', 'Comment=Conta e uso do Claude Code',
        `Exec="${process.execPath}" "${CORE}" tray run --interval ${interval}`, 'X-GNOME-Autostart-enabled=true', ''].join('\n')
    );
  }
  return file;
}

module.exports = { start, stop, runningPid, autostartEnabled, setAutostart, runLinuxForeground, circlePng };
