'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();
const STORE_DIR = process.env.CLAUDE_SWITCH_HOME || path.join(HOME, '.claude-switch');
const STORE_FILE = path.join(STORE_DIR, 'accounts.json');
const ACCOUNTS_DIR = process.env.CLAUDE_SWITCH_ACCOUNTS_DIR || path.join(HOME, '.claude-accounts');

// Conta implícita: ~/.claude sem CLAUDE_CONFIG_DIR definida.
const DEFAULT_NAME = 'default';
const DEFAULT_DIR = path.join(HOME, '.claude');

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    if (!data.accounts || typeof data.accounts !== 'object') data.accounts = {};
    return data;
  } catch (err) {
    if (err.code === 'ENOENT') return { accounts: {} };
    throw new Error(`Não foi possível ler ${STORE_FILE}: ${err.message}`);
  }
}

function save(data) {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  const tmp = STORE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, STORE_FILE);
}

module.exports = { HOME, STORE_DIR, STORE_FILE, ACCOUNTS_DIR, DEFAULT_NAME, DEFAULT_DIR, load, save };
