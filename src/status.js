'use strict';
// Estado (contas, conta global, uso) consumido pela bandeja, statusline, prompt e "csw next".
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const store = require('./store');
const env = require('./env');
const accounts = require('./accounts');
const usage = require('./usage');
const share = require('./share');

const CACHE_FILE = path.join(store.STORE_DIR, 'usage-cache.json');
const PROMPT_FILE = path.join(store.STORE_DIR, 'prompt.tsv');
const REFRESH_STAMP = path.join(store.STORE_DIR, 'refresh.stamp');
const CORE = path.resolve(__dirname, '..', 'bin', 'claude-switch.js');

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeCache(cache) {
  try {
    fs.mkdirSync(store.STORE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
  } catch {
    // cache é só otimização
  }
}

const iso = (d) => (d && !isNaN(d) ? d.toISOString() : null);
const pctOf = (entry, key) => {
  const w = entry?.windows?.find((x) => x.key === key);
  return w ? w.pct : null;
};

// Limite disponível (0–100) considerando as janelas de 5h e semanal; null quando não há dados.
function available(entry) {
  if (!entry || entry.status) return null;
  const pcts = ['five_hour', 'seven_day'].map((k) => pctOf(entry, k)).filter((p) => p != null);
  return pcts.length ? Math.max(0, 100 - Math.max(...pcts)) : null;
}

function level(entry) {
  const pcts = (entry?.windows || []).map((w) => w.pct);
  if (!pcts.length) return 'gray';
  const max = Math.max(...pcts);
  return max >= 90 ? 'red' : max >= 70 ? 'yellow' : 'green';
}

// Normalização usada também pelos wrappers de shell (barras "/" e minúsculas).
const promptKey = (dir) => (dir ? dir.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() : '-');

// Arquivo lido pelo prompt do shell sem chamar o node: pasta, conta, % de 5h, nível, data do dado.
function writePromptCache(cache = readCache()) {
  try {
    const lines = accounts.all().map((acc) => {
      const entry = cache[acc.name];
      const five = pctOf(entry, 'five_hour');
      return [
        acc.isDefault ? '-' : promptKey(acc.dir),
        acc.name,
        five == null || entry?.status ? '' : Math.round(five),
        level(entry?.status ? null : entry),
        entry ? Math.round(entry.fetchedAt / 1000) : 0,
      ].join('\t');
    });
    fs.mkdirSync(store.STORE_DIR, { recursive: true });
    fs.writeFileSync(PROMPT_FILE, lines.join('\n') + '\n');
  } catch {
    // o prompt só fica sem o dado
  }
}

// maxAge (segundos): reaproveita o uso consultado há menos tempo que isso; 0 = sempre consulta.
async function collect({ maxAge = 0 } = {}) {
  const list = accounts.all();
  const globalRaw = env.getGlobal();
  const globalAcc = accounts.byEnvValue(globalRaw);
  const cache = readCache();
  const now = Date.now();
  let dirty = false;

  const usages = await Promise.all(
    list.map(async (acc) => {
      const cached = cache[acc.name];
      if (cached && maxAge > 0 && now - cached.fetchedAt < maxAge * 1000) return cached;
      const r = await usage.fetchUsage(acc);
      const entry = {
        fetchedAt: now,
        status: r.status || null,
        windows: r.data
          ? usage.windows(r.data).map((w) => ({ key: w.key, label: w.label, pct: w.pct, resetsAt: iso(w.resetsAt) }))
          : [],
      };
      cache[acc.name] = entry;
      dirty = true;
      return entry;
    })
  );
  if (dirty) writeCache(cache);
  writePromptCache(cache);

  const result = list.map((acc, i) => ({
    name: acc.name,
    dir: acc.dir,
    envValue: accounts.envValue(acc),
    isGlobal: !!globalAcc && globalAcc.name === acc.name,
    ...accounts.details(acc),
    history: share.status(acc, 'history'),
    config: share.status(acc, 'config'),
    available: available(usages[i]),
    usage: usages[i],
  }));
  const ranked = result.filter((a) => a.available != null).sort((a, b) => b.available - a.available || b.isGlobal - a.isGlobal);
  return { global: globalAcc ? globalAcc.name : null, globalRaw, best: ranked[0]?.name || null, accounts: result };
}

// Dispara uma atualização do cache em segundo plano (no máximo uma por minuto).
function refreshInBackground(maxAge = 300) {
  try {
    if (Date.now() - fs.statSync(REFRESH_STAMP).mtimeMs < 60000) return;
  } catch {
    // primeira vez
  }
  try {
    fs.mkdirSync(store.STORE_DIR, { recursive: true });
    fs.writeFileSync(REFRESH_STAMP, String(Date.now()));
    spawn(process.execPath, [CORE, 'status', '--json', '--max-age', String(maxAge)], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
  } catch {
    // sem atualização desta vez
  }
}

module.exports = { collect, readCache, writePromptCache, refreshInBackground, available, level, pctOf, promptKey };
