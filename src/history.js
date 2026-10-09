'use strict';
// Histórico do uso (% de cada janela ao longo do tempo) e previsão de quando o limite acaba.
// A API só informa o valor atual, então o histórico começa quando algo passa a consultar o uso
// (ícone da bandeja, statusline, "csw usage").
const fs = require('fs');
const path = require('path');
const store = require('./store');

const FILE = path.join(store.STORE_DIR, 'usage-history.jsonl');
const KEEP_DAYS = 35;
const MAX_BYTES = 8 * 1024 * 1024; // passando disso, descarta o que tem mais de KEEP_DAYS
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// Duração de cada janela e por quanto tempo de amostras recentes medir o ritmo (null = média desde o início).
const WINDOWS = {
  five_hour: { short: '5h', duration: 5 * HOUR, recent: 60 * MIN, minElapsed: 15 * MIN },
  seven_day: { short: 'semana', duration: 7 * 24 * HOUR, recent: null, minElapsed: 12 * HOUR },
};

const ms = (d) => (d ? new Date(d).getTime() : null);

// entry: { fetchedAt, status, windows: [{ key, pct, resetsAt }] } (formato do cache de uso).
function record(name, entry) {
  if (!entry || entry.status || !entry.windows?.length) return;
  const line = { t: entry.fetchedAt || Date.now(), a: name };
  for (const w of entry.windows) if (WINDOWS[w.key]) line[w.key] = [w.pct, ms(w.resetsAt)];
  try {
    fs.mkdirSync(store.STORE_DIR, { recursive: true });
    fs.appendFileSync(FILE, JSON.stringify(line) + '\n');
    if (fs.statSync(FILE).size > MAX_BYTES) compact();
  } catch {
    // histórico é só complemento
  }
}

function compact() {
  const cutoff = Date.now() - KEEP_DAYS * 24 * HOUR;
  const keep = readAll().filter((s) => s.t >= cutoff);
  fs.writeFileSync(FILE, keep.map((s) => JSON.stringify(s)).join('\n') + (keep.length ? '\n' : ''));
}

function parse(text) {
  const out = [];
  for (const l of text.split('\n')) {
    if (!l) continue;
    try {
      out.push(JSON.parse(l));
    } catch {
      // linha cortada (leitura parcial ou gravação concorrente)
    }
  }
  return out;
}

function readAll() {
  try {
    return parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return [];
  }
}

// Só o fim do arquivo: o suficiente para o ritmo recente, sem ler semanas de histórico.
function readTail(bytes = 256 * 1024) {
  let fd;
  try {
    fd = fs.openSync(FILE, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return parse(buf.toString('utf8'));
  } catch {
    return [];
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// Amostras a partir de "since" (ms), em ordem de tempo; name = null traz todas as contas.
function samples(name, since = 0, { all = false } = {}) {
  const list = all ? readAll() : readTail();
  return list.filter((s) => (name == null || s.a === name) && s.t >= since).sort((a, b) => a.t - b.t);
}

// Inclinação (pct/ms) por mínimos quadrados.
function slope(points) {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p[0], 0) / n;
  const my = points.reduce((s, p) => s + p[1], 0) / n;
  let num = 0;
  let den = 0;
  for (const [x, y] of points) {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  }
  return den ? num / den : null;
}

// Previsão de uma janela. Retorna null sem dados suficientes, senão:
//   { state: 'out', resetsAt }                      esgotada
//   { state: 'runsOut', eta, resetsAt, basis }      acaba antes do reset
//   { state: 'ok', atReset, resetsAt, basis }       não acaba; atReset = % previsto no reset
function forecast(key, current, history, now = Date.now()) {
  const def = WINDOWS[key];
  const resetsAt = ms(current?.resetsAt);
  if (!def || !current || !resetsAt || resetsAt <= now) return null;
  const pct = current.pct;
  if (pct >= 100) return { state: 'out', resetsAt };
  const start = resetsAt - def.duration;

  let rate = null;
  let basis = null;
  if (def.recent) {
    // Amostras da mesma janela (mesmo reset, com folga para a variação de segundos da API).
    const from = Math.max(start, now - def.recent);
    const pts = history
      .filter((s) => s[key] && s.t >= from && s.t < now && Math.abs((s[key][1] || 0) - resetsAt) < 5 * MIN)
      .map((s) => [s.t, s[key][0]]);
    pts.push([now, pct]);
    if (pts.length >= 3 && now - pts[0][0] >= def.recent / 3) {
      rate = Math.max(0, slope(pts));
      basis = 'recente';
    }
  }
  if (rate == null && now - start >= def.minElapsed) {
    rate = pct / (now - start);
    basis = 'média';
  }
  if (rate == null) return null;

  const eta = rate > 0 ? now + (100 - pct) / rate : Infinity;
  if (eta < resetsAt) return { state: 'runsOut', eta, resetsAt, basis };
  return { state: 'ok', atReset: Math.min(100, pct + rate * (resetsAt - now)), resetsAt, basis };
}

// Previsões de todas as janelas conhecidas de uma entrada de uso.
// history: amostras recentes (de qualquer conta; filtra pelo nome).
function forecastAll(name, entry, history = samples(name, Date.now() - 2 * HOUR), now = Date.now()) {
  if (!entry || entry.status) return {};
  const mine = history.filter((s) => s.a === name);
  const out = {};
  for (const w of entry.windows || []) {
    const f = forecast(w.key, w, mine, now);
    if (f) out[w.key] = f;
  }
  return out;
}

const hhmm = (t) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const when = (t, now = Date.now()) => {
  const sameDay = new Date(t).toDateString() === new Date(now).toDateString();
  return sameDay ? hhmm(t) : new Date(t).toLocaleString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
};

function duration(msLeft) {
  const mins = Math.max(0, Math.round(msLeft / MIN));
  if (mins < 60) return `${mins}min`;
  if (mins < 48 * 60) return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}`;
  return `${Math.round(mins / 1440)}d`;
}

// Texto curto (bandeja): "5h acaba ~16:40", "semana ok (~72%)", "5h esgotada até 16:19".
function shortText(key, f, now = Date.now()) {
  const label = WINDOWS[key]?.short || key;
  if (!f) return null;
  if (f.state === 'out') return `${label} esgotada até ${when(f.resetsAt, now)}`;
  if (f.state === 'runsOut') return `${label} acaba ~${when(f.eta, now)}`;
  return `${label} ok (~${Math.round(f.atReset)}% no reset)`;
}

// Texto do terminal.
function longText(f, now = Date.now()) {
  if (!f) return null;
  if (f.state === 'out') return `esgotado, libera em ${duration(f.resetsAt - now)}`;
  if (f.state === 'runsOut') return `no ritmo atual acaba ~${when(f.eta, now)} (${duration(f.resetsAt - f.eta)} antes do reset)`;
  return `no ritmo atual chega a ~${Math.round(f.atReset)}% no reset`;
}

module.exports = { FILE, WINDOWS, record, samples, forecast, forecastAll, shortText, longText, duration, HOUR };
