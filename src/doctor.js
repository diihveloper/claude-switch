'use strict';
// Diagnóstico do claude-switch. Cada verificação gera { level: 'ok'|'info'|'warn'|'error', msg, fix? }.
const fs = require('fs');
const store = require('./store');
const env = require('./env');
const accounts = require('./accounts');
const share = require('./share');
const project = require('./project');
const install = require('./install');
const tray = require('./tray');
const statusline = require('./statusline');

function run() {
  const out = [];
  const add = (level, msg, fix) => out.push({ level, msg, fix });

  // Node
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) add('error', `Node ${process.versions.node}: o claude-switch precisa do Node 18+`);
  else add('ok', `Node ${process.versions.node}`);

  // Função csw carregada neste terminal
  const loaded = Number(process.env.CSW_WRAPPER_VERSION || 0);
  if (!loaded) add('warn', 'Este terminal não carregou a função "csw" (ou carregou uma versão antiga): abra um novo terminal');
  else if (loaded < install.WRAPPER_VERSION) add('warn', `Função "csw" deste terminal está desatualizada (v${loaded}, atual v${install.WRAPPER_VERSION}): abra um novo terminal`);
  else add('ok', `Função "csw" carregada (v${loaded})`);

  // Profiles
  for (const target of install.targets()) {
    const st = install.blockStatus(target);
    if (st === 'ok') add('ok', `Profile: ${target.file}`);
    else {
      const what = st === 'missing' ? 'sem o bloco do claude-switch' : 'aponta para outra instalação';
      add('warn', `Profile ${target.file} ${what}`, { label: 'reinstalar o bloco', run: () => install.installTarget(target) });
    }
  }

  // Contas
  const all = accounts.all();
  for (const acc of all) {
    if (!fs.existsSync(acc.dir)) {
      add('error', `${acc.name}: a pasta ${acc.dir} não existe`);
      continue;
    }
    const creds = accounts.credentials(acc);
    if (!creds?.accessToken) add('warn', `${acc.name}: sem login (rode "csw use ${acc.name} --session" e "claude" → /login)`);
    else if (creds.expiresAt && creds.expiresAt < Date.now()) {
      add('warn', `${acc.name}: token expirado — o uso não aparece até renovar ("csw refresh")`, {
        label: `renovar o token de ${acc.name}`,
        run: () => require('./refresh').refreshAccount(acc),
      });
    } else add('ok', `${acc.name}: login válido`);

    if (acc.isDefault) continue;
    for (const group of share.GROUP_NAMES) {
      const label = group === 'history' ? 'histórico' : 'configurações';
      const st = share.status(acc, group);
      const foreign = share.GROUPS[group].filter((it) => share.itemStatus(acc, it) === 'foreign').map((it) => it.name);
      if (foreign.length) {
        add('error', `${acc.name}: links de ${label} apontando para outro lugar (${foreign.join(', ')})`, {
          label: `refazer os links de ${label}`,
          run: () => share.share(acc, { groups: [group] }),
        });
      } else if (st === 'partial') {
        const local = share.GROUPS[group].filter((it) => share.itemStatus(acc, it) !== 'shared').map((it) => it.name);
        add('warn', `${acc.name}: links parciais em ${label} (${local.join(', ')} fora do link)`, {
          label: `refazer os links de ${label}`,
          run: () => share.share(acc, { groups: [group] }),
        });
      }
    }
  }

  // Conta global e do terminal
  const globalRaw = env.getGlobal();
  const globalAcc = accounts.byEnvValue(globalRaw);
  const sessionRaw = env.getSession();
  const sessionAcc = accounts.byEnvValue(sessionRaw);
  if (!globalAcc) add('error', `A conta global aponta para uma pasta não registrada: ${globalRaw}`);
  if (!sessionAcc) add('warn', `Este terminal aponta para uma pasta não registrada: ${sessionRaw}`);
  if (globalAcc && sessionAcc && globalAcc.name !== sessionAcc.name) {
    add('info', `Este terminal está na conta "${sessionAcc.name}", mas a global é "${globalAcc.name}"`);
  }

  // Conta do projeto
  const proj = project.find();
  if (proj) {
    const exists = all.find((a) => a.name.toLowerCase() === proj.name.toLowerCase());
    if (!exists) add('error', `${proj.file} pede a conta "${proj.name}", que não existe`);
    else if (!sessionAcc || sessionAcc.name !== exists.name) {
      add('warn', `Este projeto usa a conta "${exists.name}" (${proj.file}), mas o terminal está em "${sessionAcc?.name ?? '?'}": rode "csw use"`);
    } else add('ok', `Conta do projeto: ${exists.name}`);
  }

  // Extras
  if (process.platform === 'win32' || process.platform === 'linux') {
    add('info', `Ícone na bandeja: ${tray.runningPid() ? 'rodando' : 'parado'}${tray.autostartEnabled() ? ', inicia com o sistema' : ''}`);
  }
  add('info', `Statusline do Claude Code: ${statusline.installed() ? 'instalada' : 'não instalada ("csw statusline install")'}`);
  if (fs.existsSync(require('path').join(store.STORE_DIR, 'auto-cd'))) add('info', 'Troca automática ao entrar em projetos: ligada');

  return out;
}

module.exports = { run };
