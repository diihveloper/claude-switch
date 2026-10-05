'use strict';
// Retrato do estado (contas, conta global, uso) consumido pelo ícone da bandeja.
const fs = require('fs');
const path = require('path');
const store = require('./store');
const env = require('./env');
const accounts = require('./accounts');
const usage = require('./usage');
const share = require('./share');

const CACHE_FILE = path.join(store.STORE_DIR, 'usage-cache.json');

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

  return {
    global: globalAcc ? globalAcc.name : null,
    globalRaw,
    accounts: list.map((acc, i) => ({
      name: acc.name,
      dir: acc.dir,
      envValue: accounts.envValue(acc),
      isGlobal: !!globalAcc && globalAcc.name === acc.name,
      ...accounts.details(acc),
      history: share.status(acc),
      usage: usages[i],
    })),
  };
}

module.exports = { collect };
