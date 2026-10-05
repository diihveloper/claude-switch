#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const store = require('../src/store');
const env = require('../src/env');
const accounts = require('../src/accounts');
const usage = require('../src/usage');
const { c, table, bar, info } = require('../src/format');

const ROOT = path.resolve(__dirname, '..');
const VALUE_FLAGS = new Set(['dir', 'emit']);

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      pos.push(...argv.slice(i + 1));
      break;
    }
    const long = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (long) {
      const [, k, v] = long;
      if (v !== undefined) flags[k] = v;
      else if (VALUE_FLAGS.has(k)) flags[k] = argv[++i];
      else flags[k] = true;
    } else if (a === '-y') flags.yes = true;
    else if (a === '-h') flags.help = true;
    else pos.push(a);
  }
  return { pos, flags };
}

// Aplica a mudança no terminal atual via wrapper; sem wrapper só dá para avisar.
function applySession(flags, value) {
  if (flags.emit === 'pwsh' || flags.emit === 'bash') {
    process.stdout.write(env.emit(flags.emit, value) + '\n');
    return true;
  }
  return false;
}

function warnNoWrapper() {
  info(c.yellow('! Este terminal não foi alterado: rode via função "csw" (veja "Instalação" no README).'));
}

function confirm(question) {
  if (!process.stdin.isTTY) throw new Error('Confirmação necessária: use -y para executar sem interação.');
  process.stderr.write(`${question} [s/N] `);
  const buf = Buffer.alloc(256);
  let answer = '';
  for (;;) {
    let n;
    try {
      n = fs.readSync(0, buf, 0, buf.length, null);
    } catch (err) {
      if (err.code === 'EAGAIN') continue;
      throw err;
    }
    if (n === 0) break;
    answer += buf.toString('utf8', 0, n);
    if (answer.includes('\n')) break;
  }
  return /^(s|sim|y|yes)$/i.test(answer.trim());
}

function label(acc) {
  if (!acc) return c.yellow('(pasta não registrada)');
  return c.bold(acc.name);
}

// ---------------------------------------------------------------- comandos

function cmdList() {
  const sessionAcc = accounts.byEnvValue(env.getSession());
  const globalAcc = accounts.byEnvValue(env.getGlobal());
  const rows = [[c.dim(' '), c.dim('CONTA'), c.dim('E-MAIL'), c.dim('PLANO'), c.dim('PASTA')]];
  for (const acc of accounts.all()) {
    const d = accounts.details(acc);
    const active = sessionAcc && sessionAcc.name === acc.name;
    const isGlobal = globalAcc && globalAcc.name === acc.name;
    const name = (active ? c.green(acc.name) : acc.name) + (isGlobal ? c.cyan(' (global)') : '');
    rows.push([
      active ? c.green('*') : ' ',
      name,
      d.email || c.dim(d.loggedIn ? '?' : 'sem login'),
      d.plan || c.dim('-'),
      c.dim(acc.dir),
    ]);
  }
  console.log(table(rows));
  const raw = env.getSession();
  if (raw && !sessionAcc) console.log(c.yellow(`\n! CLAUDE_CONFIG_DIR aponta para uma pasta não registrada: ${raw}`));
}

function cmdCurrent() {
  const sessionRaw = env.getSession();
  const globalRaw = env.getGlobal();
  const s = accounts.byEnvValue(sessionRaw);
  console.log(`Terminal: ${label(s)} ${c.dim(sessionRaw || '(CLAUDE_CONFIG_DIR não definida → ~/.claude)')}`);
  const g = accounts.byEnvValue(globalRaw);
  console.log(`Global:   ${label(g)} ${c.dim(globalRaw || '(CLAUDE_CONFIG_DIR não definida → ~/.claude)')}`);
}

function cmdAdd(pos, flags) {
  const acc = accounts.add(pos[0], flags.dir);
  console.log(`${c.green('✔')} Conta ${c.bold(acc.name)} criada em ${c.dim(acc.dir)}`);
  console.log(`  Próximo passo: ${c.cyan(`csw use ${acc.name}`)} e depois ${c.cyan('claude')} → ${c.cyan('/login')}`);
}

function cmdUse(pos, flags, sessionOnly) {
  if (!pos[0]) throw new Error('Uso: csw use <conta> [--session]');
  const acc = accounts.get(pos[0]);
  const value = accounts.envValue(acc);
  if (!sessionOnly) env.setGlobal(value);
  const applied = applySession(flags, value);
  const scope = sessionOnly ? 'apenas neste terminal' : applied ? 'global + este terminal' : 'global (novos terminais)';
  info(`${c.green('✔')} Usando ${c.bold(acc.name)} ${c.dim(`(${scope})`)}`);
  if (!applied) warnNoWrapper();
}

function cmdRename(pos, flags) {
  if (pos.length < 2) throw new Error('Uso: csw rename <atual> <novo>');
  const sessionRaw = env.getSession();
  const globalRaw = env.getGlobal();
  const { before, after } = accounts.rename(pos[0], pos[1]);
  info(`${c.green('✔')} ${before.name} → ${c.bold(after.name)}`);
  if (env.samePath(before.dir, after.dir)) return;
  info(c.dim(`  pasta movida para ${after.dir}`));
  if (globalRaw && env.samePath(globalRaw, before.dir)) env.setGlobal(after.dir);
  if (sessionRaw && env.samePath(sessionRaw, before.dir) && !applySession(flags, after.dir)) warnNoWrapper();
}

function cmdRemove(pos, flags) {
  if (!pos[0]) throw new Error('Uso: csw remove <conta> [--keep-files] [--purge] [-y]');
  const acc = accounts.get(pos[0]);
  if (acc.isDefault) throw new Error(`A conta "${store.DEFAULT_NAME}" não pode ser removida.`);
  // Só apagamos automaticamente pastas criadas pelo claude-switch; pastas externas exigem --purge.
  const deleteFiles = !flags['keep-files'] && (accounts.isManagedDir(acc) || !!flags.purge);
  if (!flags.yes) {
    const what = deleteFiles ? `e APAGAR a pasta ${acc.dir}` : `(a pasta ${acc.dir} será mantida)`;
    if (!confirm(`Remover a conta "${acc.name}" ${what}?`)) {
      info('Cancelado.');
      return;
    }
  }
  const sessionActive = env.samePath(env.getSession() || store.DEFAULT_DIR, acc.dir);
  const globalActive = env.samePath(env.getGlobal() || store.DEFAULT_DIR, acc.dir);
  const { deleted } = accounts.remove(acc.name, { deleteFiles });
  info(`${c.green('✔')} Conta ${c.bold(acc.name)} removida${deleted ? ' e pasta apagada' : ''}.`);
  if (globalActive) {
    env.setGlobal(null);
    info(c.dim(`  a conta global voltou para "${store.DEFAULT_NAME}"`));
  }
  if (sessionActive) {
    if (applySession(flags, null)) info(c.dim(`  este terminal voltou para "${store.DEFAULT_NAME}"`));
    else warnNoWrapper();
  }
}

function cmdPath(pos) {
  const acc = pos[0] ? accounts.get(pos[0]) : accounts.byEnvValue(env.getSession());
  if (!acc) throw new Error('CLAUDE_CONFIG_DIR aponta para uma pasta não registrada.');
  console.log(acc.dir);
}

function fmtReset(d) {
  if (!d || isNaN(d)) return '';
  const mins = Math.round((d - Date.now()) / 60000);
  const rel = mins < 60 ? `${Math.max(mins, 0)}min` : mins < 48 * 60 ? `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}` : `${Math.round(mins / 1440)}d`;
  const abs = d.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return c.dim(`reseta em ${rel} (${abs})`);
}

async function cmdUsage(pos, flags) {
  let targets;
  if (flags.all || pos[0] === 'all') targets = accounts.all();
  else if (pos[0]) targets = [accounts.get(pos[0])];
  else {
    const cur = accounts.byEnvValue(env.getSession());
    targets = cur ? [cur] : accounts.all();
  }
  const results = await Promise.all(targets.map((acc) => usage.fetchUsage(acc)));
  targets.forEach((acc, i) => {
    const d = accounts.details(acc);
    const meta = [d.email, d.plan].filter(Boolean).join(' · ');
    console.log(`${c.bold(acc.name)} ${c.dim(meta)}`);
    const r = results[i];
    if (r.status) {
      console.log(`  ${c.yellow(r.status)}`);
    } else {
      const wins = usage.windows(r.data);
      if (!wins.length) console.log(c.dim('  nenhum limite informado'));
      const rows = wins.map((w) => ['  ' + w.label, bar(w.pct), `${Math.round(w.pct)}%`.padStart(4), fmtReset(w.resetsAt)]);
      if (rows.length) console.log(table(rows));
      const extra = r.data.extra_usage;
      if (extra && extra.is_enabled && typeof extra.used_credits === 'number') {
        const limit = typeof extra.monthly_limit === 'number' ? ` / ${(extra.monthly_limit / 100).toFixed(2)}` : '';
        console.log(c.dim(`  Uso extra: ${(extra.used_credits / 100).toFixed(2)}${limit}`));
      }
    }
    if (i < targets.length - 1) console.log();
  });
}

function cmdRun(argv) {
  const [name, ...rest] = argv;
  const cmd = rest[0] === '--' ? rest.slice(1) : rest;
  if (!name || !cmd.length) throw new Error('Uso: csw run <conta> <comando> [args...]   ex.: csw run trabalho claude');
  const acc = accounts.get(name);
  const childEnv = { ...process.env };
  const value = accounts.envValue(acc);
  if (value) childEnv[env.VAR] = value;
  else delete childEnv[env.VAR];
  const quote = (s) => (env.isWin && /[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
  const r = spawnSync(env.isWin ? cmd.map(quote).join(' ') : cmd[0], env.isWin ? [] : cmd.slice(1), {
    stdio: 'inherit',
    env: childEnv,
    shell: env.isWin,
  });
  if (r.error) throw r.error;
  process.exitCode = r.status ?? 1;
}

// ---------------------------------------------------------------- install

const MARK_BEGIN = '# >>> claude-switch >>>';
const MARK_END = '# <<< claude-switch <<<';

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

const BLOCK_RE = new RegExp(`\\r?\\n?${MARK_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${MARK_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\r?\\n?`);

function cmdInstall() {
  for (const { file, block } of targets()) {
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const stripped = current.replace(BLOCK_RE, '\n').replace(/\n+$/, '');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, (stripped ? stripped + '\n\n' : '') + block + '\n');
    console.log(`${c.green('✔')} ${file}`);
  }
  console.log(`\nAbra um novo terminal (ou recarregue o profile) e use ${c.cyan('csw help')}.`);
}

function cmdUninstall() {
  for (const { file } of targets()) {
    if (!fs.existsSync(file)) continue;
    const current = fs.readFileSync(file, 'utf8');
    if (!BLOCK_RE.test(current)) continue;
    fs.writeFileSync(file, current.replace(BLOCK_RE, '\n').replace(/\n+$/, '') + '\n');
    console.log(`${c.green('✔')} removido de ${file}`);
  }
}

// ---------------------------------------------------------------- main

const HELP = `
${c.bold('claude-switch')} — várias contas do Claude Code na mesma máquina (via CLAUDE_CONFIG_DIR)

${c.bold('Uso:')} csw <comando> [args]

  ${c.cyan('list')}, ls                        lista as contas (* = este terminal)
  ${c.cyan('current')}                         conta deste terminal e conta global
  ${c.cyan('add')} <conta> [--dir <pasta>]     cria uma conta (pasta padrão: ~/.claude-accounts/<conta>)
  ${c.cyan('use')} <conta>                     troca a conta GLOBAL (novos terminais) e a deste terminal
  ${c.cyan('use')} <conta> --session           troca só neste terminal (atalho: ${c.cyan('csw shell <conta>')})
  ${c.cyan('rename')} <atual> <novo>           renomeia a conta
  ${c.cyan('remove')} <conta> [-y] [--keep-files|--purge]
                                  remove a conta (apaga a pasta se foi criada pelo claude-switch)
  ${c.cyan('path')} [conta]                    mostra a pasta da conta
  ${c.cyan('usage')} [conta|--all]             uso/limites da conta (como o /usage)
  ${c.cyan('run')} <conta> <comando...>        executa um comando com a conta sem trocar (ex.: csw run trabalho claude)
  ${c.cyan('install')} / ${c.cyan('uninstall')}             instala/remove a função "csw" (PowerShell, bash, zsh)

A conta "${store.DEFAULT_NAME}" é o ~/.claude original (CLAUDE_CONFIG_DIR não definida).
`;

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (cmd === 'run') return cmdRun(argv.slice(1));
  const { pos, flags } = parseArgs(argv.slice(1));
  switch (cmd) {
    case 'list':
    case 'ls':
      return cmdList();
    case 'current':
      return cmdCurrent();
    case 'add':
    case 'create':
      return cmdAdd(pos, flags);
    case 'use':
      return cmdUse(pos, flags, !!flags.session);
    case 'shell':
      return cmdUse(pos, flags, true);
    case 'rename':
    case 'mv':
      return cmdRename(pos, flags);
    case 'remove':
    case 'rm':
      return cmdRemove(pos, flags);
    case 'path':
      return cmdPath(pos);
    case 'usage':
      return cmdUsage(pos, flags);
    case 'install':
      return cmdInstall();
    case 'uninstall':
      return cmdUninstall();
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      return console.log(HELP);
    default:
      throw new Error(`Comando desconhecido "${cmd}". Veja "csw help".`);
  }
}

main().catch((err) => {
  info(c.red(`✖ ${err.message}`));
  process.exitCode = 1;
});
