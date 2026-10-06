#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const store = require('../src/store');
const env = require('../src/env');
const accounts = require('../src/accounts');
const usage = require('../src/usage');
const share = require('../src/share');
const status = require('../src/status');
const tray = require('../src/tray');
const project = require('../src/project');
const install = require('../src/install');
const statusline = require('../src/statusline');
const doctor = require('../src/doctor');
const refresh = require('../src/refresh');
const { c, table, bar, info } = require('../src/format');

const VALUE_FLAGS = new Set(['dir', 'emit', 'interval', 'max-age', 'threshold']);

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
  return emitCode(flags, env.emit(flags.emit, value));
}

function emitCode(flags, code) {
  if (flags.emit === 'pwsh' || flags.emit === 'bash') {
    if (code) process.stdout.write(code + '\n');
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

// Grupos de dados compartilhados escolhidos pelas flags --history/--config.
function groupsFromFlags(flags, fallback) {
  const chosen = share.GROUP_NAMES.filter((g) => flags[g]);
  return chosen.length ? chosen : fallback;
}

const GROUP_LABEL = { history: 'histórico e sessões', config: 'configurações' };

// Refaz links desfeitos (ex.: a limpeza do Claude recria o history.jsonl) nos grupos já compartilhados.
function healShares(acc) {
  for (const group of share.GROUP_NAMES) {
    if (share.status(acc, group) === 'partial') share.share(acc, { groups: [group] });
  }
}

function summaryOf(entry) {
  if (!entry) return 'sem dados';
  if (entry.status) return entry.status.replace(/\s*\(.*\)$/, '');
  const parts = [['five_hour', '5h'], ['seven_day', 'semana']]
    .map(([k, l]) => {
      const p = status.pctOf(entry, k);
      return p == null ? null : `${l} ${Math.round(p)}%`;
    })
    .filter(Boolean);
  return parts.join(' · ') || 'sem dados';
}

// ---------------------------------------------------------------- contas

const SHARE_LABEL = {
  base: c.cyan('base'),
  shared: c.green('sim'),
  isolated: c.dim('não'),
  partial: c.yellow('parcial'),
};

function cmdList() {
  const sessionAcc = accounts.byEnvValue(env.getSession());
  const globalAcc = accounts.byEnvValue(env.getGlobal());
  const rows = [[' ', 'CONTA', 'E-MAIL', 'PLANO', 'HISTÓRICO', 'CONFIG', 'PASTA'].map((h) => c.dim(h))];
  let partial = false;
  for (const acc of accounts.all()) {
    const d = accounts.details(acc);
    const active = sessionAcc && sessionAcc.name === acc.name;
    const isGlobal = globalAcc && globalAcc.name === acc.name;
    const name = (active ? c.green(acc.name) : acc.name) + (isGlobal ? c.cyan(' (global)') : '');
    const hist = share.status(acc, 'history');
    const conf = share.status(acc, 'config');
    partial ||= hist === 'partial' || conf === 'partial';
    rows.push([
      active ? c.green('*') : ' ',
      name,
      d.email || c.dim(d.loggedIn ? '?' : 'sem login'),
      d.plan || c.dim('-'),
      SHARE_LABEL[hist],
      SHARE_LABEL[conf],
      c.dim(acc.dir),
    ]);
  }
  console.log(table(rows));
  const raw = env.getSession();
  if (raw && !sessionAcc) console.log(c.yellow(`\n! CLAUDE_CONFIG_DIR aponta para uma pasta não registrada: ${raw}`));
  if (partial) console.log(c.yellow('\n! Há links parciais: rode "csw doctor --fix".'));
}

function cmdCurrent() {
  const sessionRaw = env.getSession();
  const globalRaw = env.getGlobal();
  const s = accounts.byEnvValue(sessionRaw);
  console.log(`Terminal: ${label(s)} ${c.dim(sessionRaw || '(CLAUDE_CONFIG_DIR não definida → ~/.claude)')}`);
  const g = accounts.byEnvValue(globalRaw);
  console.log(`Global:   ${label(g)} ${c.dim(globalRaw || '(CLAUDE_CONFIG_DIR não definida → ~/.claude)')}`);
  const proj = project.find();
  if (proj) console.log(`Projeto:  ${c.bold(proj.name)} ${c.dim(proj.file)}`);
}

// Mensagens via stderr: com o wrapper, o stdout do "add" é avaliado pelo shell (troca de conta).
function cmdAdd(pos, flags) {
  const acc = accounts.add(pos[0], flags.dir);
  info(`${c.green('✔')} Conta ${c.bold(acc.name)} criada em ${c.dim(acc.dir)}`);
  if (!flags.isolated) {
    const groups = flags['no-config'] ? ['history'] : ['history', 'config'];
    share.share(acc, { groups });
    info(c.dim(`  compartilhando com "${store.DEFAULT_NAME}": ${groups.map((g) => GROUP_LABEL[g]).join(' e ')} (--isolated para não compartilhar)`));
  }
  if (flags['no-switch']) {
    info(`  Próximo passo: ${c.cyan(`csw use ${acc.name}`)} e depois ${c.cyan('claude')} → ${c.cyan('/login')}`);
    return;
  }
  // Troca para a conta nova para o login; a global só com --global, para novos terminais
  // não abrirem numa conta ainda sem login.
  if (flags.global) env.setGlobal(acc.dir);
  if (applySession(flags, acc.dir)) {
    info(`${c.green('✔')} Usando ${c.bold(acc.name)} ${c.dim(flags.global ? '(global + este terminal)' : '(apenas neste terminal)')}`);
    const next = flags.global ? '' : ` Depois: ${c.cyan(`csw use ${acc.name}`)} para torná-la global.`;
    info(`  Agora rode ${c.cyan('claude')} e faça o ${c.cyan('/login')}.${next}`);
  } else {
    warnNoWrapper();
    info(`  Próximo passo: ${c.cyan(`csw use ${acc.name}`)} e depois ${c.cyan('claude')} → ${c.cyan('/login')}`);
  }
}

function switchTo(acc, flags, { sessionOnly, reason = '' }) {
  const value = accounts.envValue(acc);
  healShares(acc);
  if (!sessionOnly) env.setGlobal(value);
  const applied = applySession(flags, value);
  if (flags.project) {
    // Chamado pelo gancho de troca automática: uma linha discreta.
    info(c.dim(`csw: conta ${acc.name}${reason}`));
    return;
  }
  const scope = sessionOnly ? 'apenas neste terminal' : applied ? 'global + este terminal' : 'global (novos terminais)';
  info(`${c.green('✔')} Usando ${c.bold(acc.name)} ${c.dim(`(${scope})`)}${reason}`);
  if (!applied) warnNoWrapper();
}

async function cmdUse(pos, flags, { sessionOnly = !!flags.session, auto = !!flags.auto } = {}) {
  if (auto) return cmdNext(flags, sessionOnly);
  if (pos[0]) return switchTo(accounts.get(pos[0]), flags, { sessionOnly });

  // Sem argumento: conta do projeto (.claude-account), como o "nvm use" com .nvmrc.
  const proj = project.find();
  if (!proj) throw new Error('Uso: csw use <conta> [--session]   (ou crie um .claude-account com "csw pin <conta>")');
  if (!proj.name) throw new Error(`${proj.file} está vazio.`);
  // A conta do projeto vale só para este terminal, a menos que se peça --global.
  switchTo(accounts.get(proj.name), flags, { sessionOnly: !flags.global, reason: c.dim(` — ${proj.file}`) });
}

// Escolhe a conta com mais limite disponível (5h e semanal).
async function cmdNext(flags, sessionOnly = !!flags.session) {
  const st = await status.collect({ maxAge: 120 });
  const ranked = st.accounts.filter((a) => a.available != null).sort((a, b) => b.available - a.available);
  if (!ranked.length) throw new Error('Nenhuma conta com uso consultável (sem login ou token expirado). Veja "csw doctor".');
  for (const a of st.accounts) {
    const mark = a.name === ranked[0].name ? c.green('→') : ' ';
    const avail = a.available == null ? c.dim('—') : `${a.available}% livre`;
    info(`  ${mark} ${a.name.padEnd(14)} ${avail.padEnd(10)} ${c.dim(summaryOf(a.usage))}`);
  }
  const current = accounts.byEnvValue(sessionOnly ? env.getSession() : env.getGlobal());
  const best = accounts.get(ranked[0].name);
  if (current && current.name === best.name) info(c.dim(`  "${best.name}" já é a conta com mais limite.`));
  switchTo(best, flags, { sessionOnly });
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

// ---------------------------------------------------------------- compartilhamento

function shareTargets(pos, flags, usageText) {
  if (flags.all) return accounts.all().filter((a) => !a.isDefault);
  if (!pos[0]) throw new Error(usageText);
  return [accounts.get(pos[0])];
}

function cmdShare(pos, flags) {
  const groups = groupsFromFlags(flags, ['history']);
  const what = groups.map((g) => GROUP_LABEL[g]).join(' e ');
  for (const acc of shareTargets(pos, flags, 'Uso: csw share <conta|--all> [--history] [--config]')) {
    const changed = share.share(acc, { groups });
    info(changed.length
      ? `${c.green('✔')} ${c.bold(acc.name)} agora compartilha: ${what} ${c.dim('(' + changed.join(', ') + ')')}`
      : `${c.green('✔')} ${c.bold(acc.name)} já compartilhava: ${what}`);
  }
  if (groups.includes('config')) {
    info(c.dim(`  Arquivos de configuração divergentes: vale o mais recente; o outro fica em ${path.join(store.STORE_DIR, 'backups')}`));
  }
}

function cmdUnshare(pos, flags) {
  const groups = groupsFromFlags(flags, ['history']);
  const what = groups.map((g) => GROUP_LABEL[g]).join(' e ');
  for (const acc of shareTargets(pos, flags, 'Uso: csw unshare <conta|--all> [--history] [--config] [--copy]')) {
    const changed = share.unshare(acc, { copy: !!flags.copy, groups });
    if (!changed.length) info(`${c.dim('-')} ${c.bold(acc.name)} não compartilhava: ${what}`);
    else info(`${c.green('✔')} ${c.bold(acc.name)} deixou de compartilhar: ${what} ${c.dim(flags.copy ? '(ficou com uma cópia do atual)' : '(começa vazio)')}`);
  }
}

// ---------------------------------------------------------------- projeto, auto, prompt

function cmdPin(pos, flags) {
  if (flags.remove) {
    const file = project.unpin();
    console.log(file ? `${c.green('✔')} Removido ${c.dim(file)}` : `${c.dim('-')} Não há ${project.FILE} nesta pasta.`);
    return;
  }
  const acc = pos[0] ? accounts.get(pos[0]) : accounts.byEnvValue(env.getSession());
  if (!acc) throw new Error('Informe a conta: csw pin <conta>');
  const file = project.pin(acc.name);
  console.log(`${c.green('✔')} ${c.dim(file)} → ${c.bold(acc.name)}`);
  console.log(c.dim(`  "csw use" (sem argumento) aplica essa conta; com "csw auto on" a troca é automática ao entrar na pasta.`));
}

// Liga/desliga um recurso do wrapper: arquivo de marcação + chamada de shell para valer já neste terminal.
function toggleFeature(pos, flags, { name, file, fn, onMsg, offMsg }) {
  const flag = path.join(store.STORE_DIR, file);
  const sub = pos[0] || 'status';
  if (sub === 'status') {
    info(`${name}: ${fs.existsSync(flag) ? c.green('ligado') : c.dim('desligado')}`);
    return;
  }
  if (sub !== 'on' && sub !== 'off') throw new Error(`Uso: csw ${file === 'auto-cd' ? 'auto' : 'prompt'} on|off|status`);
  const on = sub === 'on';
  fs.mkdirSync(store.STORE_DIR, { recursive: true });
  if (on) fs.writeFileSync(flag, '');
  else fs.rmSync(flag, { force: true });
  const code = flags.emit === 'pwsh' ? `__Csw${fn.pwsh}${on ? 'Enable' : 'Disable'}` : `_csw_${fn.bash}_${on ? 'enable' : 'disable'}`;
  info(`${c.green('✔')} ${on ? onMsg : offMsg}`);
  if (!emitCode(flags, code)) info(c.dim('  Vale para os próximos terminais.'));
}

function cmdAuto(pos, flags) {
  toggleFeature(pos, flags, {
    name: 'Troca automática ao entrar em projetos',
    file: 'auto-cd',
    fn: { pwsh: 'Auto', bash: 'auto' },
    onMsg: `Troca automática ligada: ao entrar numa pasta com ${project.FILE}, o terminal muda para a conta dela.`,
    offMsg: 'Troca automática desligada.',
  });
}

function cmdPrompt(pos, flags) {
  toggleFeature(pos, flags, {
    name: 'Conta no prompt',
    file: 'prompt',
    fn: { pwsh: 'Prompt', bash: 'prompt' },
    onMsg: 'Conta e % de 5h no prompt do terminal: ligado.',
    offMsg: 'Conta no prompt: desligado.',
  });
}

// ---------------------------------------------------------------- statusline, status, doctor

function cmdStatusline(pos, flags) {
  const sub = pos[0];
  if (!sub) {
    process.stdout.write(statusline.render() + '\n');
    return;
  }
  if (sub === 'install') {
    for (const { file, result } of statusline.install({ force: !!flags.force })) {
      if (result === 'skipped') console.log(`${c.yellow('!')} ${file}: já tem outra statusLine (use --force para substituir)`);
      else console.log(`${c.green('✔')} ${file}${result === 'already' ? c.dim(' (já instalada)') : ''}`);
    }
    console.log(c.dim('  Reinicie as sessões do Claude Code para ver a conta e o uso na barra de status.'));
    return;
  }
  if (sub === 'uninstall') {
    const files = statusline.uninstall();
    console.log(files.length ? files.map((f) => `${c.green('✔')} removida de ${f}`).join('\n') : c.dim('- não estava instalada'));
    return;
  }
  throw new Error('Uso: csw statusline [install [--force]|uninstall]');
}

// Renova tokens expirados (ou todos, com --force). Sem conta: todas as contas.
async function cmdRefresh(pos, flags) {
  const targets = pos[0] ? [accounts.get(pos[0])] : accounts.all();
  const results = await Promise.all(targets.map((acc) => refresh.refreshAccount(acc, { force: !!flags.force })));
  let renewed = 0;
  let failed = 0;
  targets.forEach((acc, i) => {
    const r = results[i];
    if (r.skipped) {
      if (pos[0] || flags.verbose) console.log(`${c.dim('-')} ${acc.name}: ${c.dim(r.msg)}`);
      return;
    }
    if (r.ok) renewed++;
    else failed++;
    console.log(`${r.ok ? c.green('✔') : c.red('✖')} ${acc.name}: ${r.msg}`);
  });
  if (!renewed && !failed) console.log(c.dim('Nenhum token expirado.'));
  if (failed) process.exitCode = 1;
}

// Uso interno do ícone da bandeja e da statusline.
async function cmdStatus(flags) {
  const st = await status.collect({ maxAge: Number(flags['max-age']) || 0 });
  process.stdout.write(JSON.stringify(st) + '\n');
}

async function cmdDoctor(flags) {
  const results = doctor.run();
  const icon = { ok: c.green('✔'), info: c.cyan('i'), warn: c.yellow('!'), error: c.red('✖') };
  for (const r of results) console.log(`${icon[r.level]} ${r.msg}${r.fix && !flags.fix ? c.dim(`  (--fix: ${r.fix.label})`) : ''}`);
  const fixable = results.filter((r) => r.fix);
  if (flags.fix && fixable.length) {
    console.log();
    for (const r of fixable) {
      try {
        const out = await r.fix.run();
        if (out && out.ok === false) throw new Error(out.msg);
        console.log(`${c.green('✔')} corrigido: ${r.fix.label}`);
      } catch (err) {
        console.log(`${c.red('✖')} falhou (${r.fix.label}): ${err.message}`);
      }
    }
  }
  const problems = results.filter((r) => r.level === 'warn' || r.level === 'error').length;
  console.log(problems ? c.yellow(`\n${problems} ponto(s) de atenção.`) : c.green('\nTudo certo.'));
  if (results.some((r) => r.level === 'error') && !flags.fix) process.exitCode = 1;
}

// ---------------------------------------------------------------- bandeja

function cmdTray(pos, flags) {
  const interval = Math.max(1, Number(flags.interval) || 5);
  const threshold = Math.min(100, Math.max(1, Number(flags.threshold) || 90));
  const sub = pos[0] || 'start';
  switch (sub) {
    case 'start': {
      const { already } = tray.start({ interval, threshold });
      console.log(already
        ? `${c.dim('-')} O ícone já está rodando.`
        : `${c.green('✔')} Ícone iniciado na bandeja ${c.dim(`(uso a cada ${interval} min, alerta em ${threshold}%)`)}`);
      return;
    }
    case 'stop':
      console.log(tray.stop() ? `${c.green('✔')} Ícone encerrado.` : `${c.dim('-')} O ícone não está rodando.`);
      return;
    case 'status': {
      const pid = tray.runningPid();
      console.log(`Ícone: ${pid ? c.green(`rodando (pid ${pid})`) : c.dim('parado')}`);
      console.log(`Iniciar com o sistema: ${tray.autostartEnabled() ? c.green('sim') : c.dim('não')}`);
      return;
    }
    case 'autostart': {
      const on = pos[1] === 'on' ? true : pos[1] === 'off' ? false : null;
      if (on === null) throw new Error('Uso: csw tray autostart on|off');
      const file = tray.setAutostart(on, { interval, threshold });
      console.log(`${c.green('✔')} Iniciar com o sistema: ${on ? 'sim' : 'não'} ${c.dim(file)}`);
      return;
    }
    case 'run': // Linux: processo do ícone em primeiro plano (usado pelo start e pelo autostart)
      return tray.runLinuxForeground({ interval, threshold });
    default:
      throw new Error('Uso: csw tray [start|stop|status|autostart on|off] [--interval <min>] [--threshold <%>]');
  }
}

// ---------------------------------------------------------------- uso e run

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

function eachTarget(action) {
  let failed = false;
  for (const target of install.targets()) {
    try {
      action(target);
    } catch (err) {
      failed = true;
      info(`${c.red('✖')} ${target.file}: ${err.message}`);
    }
  }
  if (failed) process.exitCode = 1;
}

function cmdInstall() {
  eachTarget((target) => {
    install.installTarget(target);
    console.log(`${c.green('✔')} ${target.file}`);
  });
  console.log(`\nAbra um novo terminal (ou recarregue o profile) e use ${c.cyan('csw help')}.`);
}

function cmdUninstall() {
  eachTarget((target) => {
    if (install.uninstallTarget(target)) console.log(`${c.green('✔')} removido de ${target.file}`);
  });
}

// ---------------------------------------------------------------- main

const HELP = `
${c.bold('claude-switch')} — várias contas do Claude Code na mesma máquina (via CLAUDE_CONFIG_DIR)

${c.bold('Uso:')} csw <comando> [args]

${c.bold('Contas')}
  ${c.cyan('list')}, ls                        lista as contas (* = este terminal)
  ${c.cyan('current')}                         conta deste terminal, global e do projeto
  ${c.cyan('add')} <conta> [--dir <pasta>] [--isolated|--no-config] [--global|--no-switch]
                                  cria a conta e já troca para ela neste terminal, para o /login
  ${c.cyan('use')} <conta>                     troca a conta GLOBAL (novos terminais) e a deste terminal
  ${c.cyan('use')} <conta> --session           troca só neste terminal (atalho: ${c.cyan('csw shell <conta>')})
  ${c.cyan('use')}                             usa a conta do projeto (${project.FILE}), só neste terminal
  ${c.cyan('next')} [--session]                troca para a conta com mais limite (= ${c.cyan('use --auto')})
  ${c.cyan('rename')} <atual> <novo>           renomeia a conta
  ${c.cyan('remove')} <conta> [-y] [--keep-files|--purge]
  ${c.cyan('path')} [conta]                    mostra a pasta da conta
  ${c.cyan('run')} <conta> <comando...>        executa um comando com a conta sem trocar

${c.bold('Projetos')}
  ${c.cyan('pin')} [conta] | --remove          grava/remove o ${project.FILE} da pasta atual
  ${c.cyan('auto')} on|off|status              troca automática ao entrar em pastas com ${project.FILE}

${c.bold('Compartilhamento')} (com a conta "${store.DEFAULT_NAME}")
  ${c.cyan('share')} <conta|--all> [--history] [--config]
                                  --history: histórico e sessões (padrão); --config: settings.json,
                                  CLAUDE.md, skills, agents, commands e output-styles
  ${c.cyan('unshare')} <conta|--all> [--history] [--config] [--copy]

${c.bold('Uso e visibilidade')}
  ${c.cyan('usage')} [conta|--all]             uso/limites (como o /usage)
  ${c.cyan('refresh')} [conta] [--force]        renova tokens expirados (sem precisar abrir o Claude)
  ${c.cyan('statusline')} install|uninstall    conta e uso na barra de status do Claude Code
  ${c.cyan('prompt')} on|off|status            conta e uso no prompt do terminal
  ${c.cyan('tray')} [stop|status] [--interval <min>] [--threshold <%>]
                                  ícone na bandeja (Windows; Linux com yad)
  ${c.cyan('tray autostart')} on|off          inicia o ícone junto com o sistema

${c.bold('Manutenção')}
  ${c.cyan('doctor')} [--fix]                  diagnóstico (tokens, links, função csw, profiles)
  ${c.cyan('install')} / ${c.cyan('uninstall')}             instala/remove a função "csw" (PowerShell, bash, zsh)

A conta "${store.DEFAULT_NAME}" é o ~/.claude original (CLAUDE_CONFIG_DIR não definida) e guarda os dados
compartilhados. Login, MCPs e plugins ficam sempre separados por conta.
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
      return cmdUse(pos, flags);
    case 'shell':
      return cmdUse(pos, flags, { sessionOnly: true });
    case 'next':
      return cmdNext(flags);
    case 'rename':
    case 'mv':
      return cmdRename(pos, flags);
    case 'remove':
    case 'rm':
      return cmdRemove(pos, flags);
    case 'path':
      return cmdPath(pos);
    case 'share':
      return cmdShare(pos, flags);
    case 'unshare':
      return cmdUnshare(pos, flags);
    case 'pin':
      return cmdPin(pos, flags);
    case 'unpin':
      return cmdPin(pos, { ...flags, remove: true });
    case 'auto':
      return cmdAuto(pos, flags);
    case 'prompt':
      return cmdPrompt(pos, flags);
    case 'statusline':
      return cmdStatusline(pos, flags);
    case 'status':
      return cmdStatus(flags);
    case 'doctor':
      return cmdDoctor(flags);
    case 'refresh':
      return cmdRefresh(pos, flags);
    case 'tray':
      return cmdTray(pos, flags);
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
