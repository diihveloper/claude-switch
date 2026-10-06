'use strict';
const accounts = require('./accounts');

// Endpoint não documentado usado pelo /usage do Claude Code. Pode mudar sem aviso.
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

const LABELS = {
  five_hour: 'Sessão (5h)',
  seven_day: 'Semanal',
  seven_day_opus: 'Semanal Opus',
  seven_day_sonnet: 'Semanal Sonnet',
  seven_day_oauth_apps: 'Semanal apps',
};

async function fetchUsage(acc) {
  const creds = accounts.credentials(acc);
  if (!creds?.accessToken) return { status: 'sem credenciais (faça /login nessa conta)' };
  if (creds.expiresAt && creds.expiresAt < Date.now()) {
    return { status: 'token expirado (rode "csw refresh" para renovar)' };
  }
  try {
    const res = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'Content-Type': 'application/json',
        'User-Agent': 'claude-switch',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 401) return { status: 'token inválido (rode "csw refresh" para renovar)' };
    if (!res.ok) return { status: `erro HTTP ${res.status}` };
    return { data: await res.json() };
  } catch (err) {
    return { status: `falha na requisição: ${err.message}` };
  }
}

// Extrai as janelas de limite ({utilization, resets_at}) da resposta, na ordem conhecida primeiro.
function windows(data) {
  const keys = Object.keys(data).sort((a, b) => {
    const ia = Object.keys(LABELS).indexOf(a);
    const ib = Object.keys(LABELS).indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return keys
    .filter((k) => data[k] && typeof data[k] === 'object' && typeof data[k].utilization === 'number')
    .map((k) => ({
      key: k,
      label: LABELS[k] || k,
      pct: data[k].utilization,
      resetsAt: data[k].resets_at ? new Date(data[k].resets_at) : null,
    }));
}

module.exports = { fetchUsage, windows };
