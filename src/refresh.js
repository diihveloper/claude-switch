'use strict';
// Renova o token OAuth de uma conta como o próprio Claude Code faz (grant_type=refresh_token).
// O Claude Code lida com outro processo renovando a mesma conta: ele relê .credentials.json e
// adota o token novo, então renovar por aqui equivale a uma segunda sessão do Claude renovando.
const fs = require('fs');
const path = require('path');
const store = require('./store');

const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const MARGIN_MS = 5 * 60 * 1000; // renova também o que expira nos próximos 5 min

const credFile = (acc) => path.join(acc.dir, '.credentials.json');

function readCreds(acc) {
  try {
    return JSON.parse(fs.readFileSync(credFile(acc), 'utf8'));
  } catch {
    return null;
  }
}

function needsRefresh(acc) {
  const o = readCreds(acc)?.claudeAiOauth;
  return !!o?.refreshToken && (!o.expiresAt || o.expiresAt - Date.now() < MARGIN_MS);
}

// Retorna { ok, skipped?, msg }.
async function refreshAccount(acc, { force = false } = {}) {
  const creds = readCreds(acc);
  const o = creds?.claudeAiOauth;
  if (!o?.refreshToken) return { ok: false, msg: 'sem login (faça /login nessa conta)' };
  if (!force && o.expiresAt && o.expiresAt - Date.now() >= MARGIN_MS) {
    return { ok: true, skipped: true, msg: `válido até ${new Date(o.expiresAt).toLocaleString('pt-BR')}` };
  }
  if (o.refreshTokenExpiresAt && o.refreshTokenExpiresAt < Date.now()) {
    return { ok: false, msg: 'login expirado (faça /login nessa conta)' };
  }

  let data;
  try {
    const body = { grant_type: 'refresh_token', refresh_token: o.refreshToken, client_id: CLIENT_ID };
    if (Array.isArray(o.scopes) && o.scopes.length) body.scope = o.scopes.join(' ');
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'claude-switch' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    if (res.status === 400 || res.status === 401) {
      return { ok: false, msg: 'refresh token recusado (faça /login nessa conta)' };
    }
    if (!res.ok) return { ok: false, msg: `erro HTTP ${res.status}` };
    data = await res.json();
  } catch (err) {
    return { ok: false, msg: `falha na requisição: ${err.message}` };
  }
  if (!data?.access_token || !data.expires_in) return { ok: false, msg: 'resposta inesperada do servidor' };

  // Relê antes de gravar: se uma sessão do Claude renovou enquanto isso, mantém a dela.
  const latest = readCreds(acc);
  if (latest?.claudeAiOauth?.refreshToken !== o.refreshToken) {
    return { ok: true, msg: 'já renovado por uma sessão do Claude' };
  }
  const now = Date.now();
  latest.claudeAiOauth = {
    ...latest.claudeAiOauth,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || o.refreshToken,
    expiresAt: now + data.expires_in * 1000,
    ...(data.refresh_token_expires_in ? { refreshTokenExpiresAt: now + data.refresh_token_expires_in * 1000 } : {}),
    ...(typeof data.scope === 'string' && data.scope ? { scopes: data.scope.split(' ') } : {}),
  };
  // Grava no próprio arquivo (preserva permissões, ex.: 0600 no Linux).
  fs.writeFileSync(credFile(acc), JSON.stringify(latest));
  invalidateUsage(acc);
  return { ok: true, msg: `renovado, válido até ${new Date(latest.claudeAiOauth.expiresAt).toLocaleString('pt-BR')}` };
}

// O uso em cache dessa conta (ex.: "token expirado") deixa de valer.
function invalidateUsage(acc) {
  const file = path.join(store.STORE_DIR, 'usage-cache.json');
  try {
    const cache = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (cache[acc.name]) {
      delete cache[acc.name];
      fs.writeFileSync(file, JSON.stringify(cache));
    }
  } catch {
    // sem cache
  }
}

module.exports = { refreshAccount, needsRefresh };
