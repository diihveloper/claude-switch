'use strict';
const fs = require('fs');
const path = require('path');
const store = require('./store');
const env = require('./env');

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function validateName(name) {
  if (!name) throw new Error('Informe o nome da conta.');
  if (!NAME_RE.test(name)) throw new Error(`Nome inválido "${name}". Use letras, números, ".", "_" ou "-".`);
}

// Lista todas as contas, com "default" (~/.claude) sempre primeiro.
function all() {
  const { accounts } = store.load();
  return [
    { name: store.DEFAULT_NAME, dir: store.DEFAULT_DIR, isDefault: true },
    ...Object.entries(accounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, a]) => ({ name, ...a, isDefault: false })),
  ];
}

function get(name) {
  const acc = all().find((a) => a.name.toLowerCase() === String(name).toLowerCase());
  if (!acc) throw new Error(`Conta "${name}" não encontrada. Veja "csw list".`);
  return acc;
}

// Valor de CLAUDE_CONFIG_DIR correspondente à conta (null = remover a variável).
function envValue(acc) {
  return acc.isDefault ? null : acc.dir;
}

// Descobre qual conta corresponde a um valor de CLAUDE_CONFIG_DIR.
function byEnvValue(value) {
  if (!value) return all()[0];
  return all().find((a) => env.samePath(a.dir, value)) || null;
}

function add(name, dir) {
  validateName(name);
  const data = store.load();
  if (name.toLowerCase() === store.DEFAULT_NAME || Object.keys(data.accounts).some((n) => n.toLowerCase() === name.toLowerCase())) {
    throw new Error(`A conta "${name}" já existe.`);
  }
  const target = path.resolve(dir || path.join(store.ACCOUNTS_DIR, name));
  if (env.samePath(target, store.DEFAULT_DIR)) {
    throw new Error(`${store.DEFAULT_DIR} já é a conta "${store.DEFAULT_NAME}".`);
  }
  const clash = all().find((a) => env.samePath(a.dir, target));
  if (clash) throw new Error(`A pasta ${target} já pertence à conta "${clash.name}".`);

  fs.mkdirSync(target, { recursive: true });
  data.accounts[name] = { dir: target, createdAt: new Date().toISOString() };
  store.save(data);
  return { name, dir: target, isDefault: false };
}

function isManagedDir(acc) {
  return !acc.isDefault && env.samePath(path.dirname(acc.dir), store.ACCOUNTS_DIR);
}

function rename(oldName, newName) {
  const acc = get(oldName);
  if (acc.isDefault) throw new Error(`A conta "${store.DEFAULT_NAME}" não pode ser renomeada.`);
  validateName(newName);
  const data = store.load();
  const taken = newName.toLowerCase() === store.DEFAULT_NAME ||
    Object.keys(data.accounts).some((n) => n.toLowerCase() === newName.toLowerCase() && n !== acc.name);
  if (taken) throw new Error(`A conta "${newName}" já existe.`);

  const entry = data.accounts[acc.name];
  let newDir = acc.dir;
  // Só movemos a pasta quando ela está no local padrão e segue o nome da conta.
  if (isManagedDir(acc) && path.basename(acc.dir).toLowerCase() === acc.name.toLowerCase()) {
    newDir = path.join(store.ACCOUNTS_DIR, newName);
    if (!env.samePath(newDir, acc.dir)) {
      if (fs.existsSync(newDir)) throw new Error(`A pasta ${newDir} já existe.`);
      if (fs.existsSync(acc.dir)) fs.renameSync(acc.dir, newDir);
    }
  }
  delete data.accounts[acc.name];
  data.accounts[newName] = { ...entry, dir: newDir };
  store.save(data);
  return { before: acc, after: { name: newName, dir: newDir, isDefault: false } };
}

function remove(name, { deleteFiles }) {
  const acc = get(name);
  if (acc.isDefault) throw new Error(`A conta "${store.DEFAULT_NAME}" não pode ser removida.`);
  const data = store.load();
  delete data.accounts[acc.name];
  store.save(data);
  let deleted = false;
  if (deleteFiles && fs.existsSync(acc.dir)) {
    // Desfaz os links antes de apagar, para nunca tocar no histórico compartilhado da base.
    require('./share').unshare(acc);
    fs.rmSync(acc.dir, { recursive: true, force: true });
    deleted = true;
  }
  return { acc, deleted };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// Sem CLAUDE_CONFIG_DIR o Claude guarda o estado em ~/.claude.json; com ela, dentro da pasta.
function stateFile(acc) {
  return acc.isDefault ? path.join(store.HOME, '.claude.json') : path.join(acc.dir, '.claude.json');
}

function credentials(acc) {
  return readJson(path.join(acc.dir, '.credentials.json'))?.claudeAiOauth || null;
}

function details(acc) {
  const state = readJson(stateFile(acc));
  const creds = credentials(acc);
  return {
    email: state?.oauthAccount?.emailAddress || null,
    org: state?.oauthAccount?.organizationName || null,
    plan: creds?.subscriptionType || null,
    loggedIn: !!creds?.accessToken,
  };
}

module.exports = { all, get, add, rename, remove, envValue, byEnvValue, isManagedDir, details, credentials };
