'use strict';

const useColor = !process.env.NO_COLOR && (process.stderr.isTTY || process.stdout.isTTY);
const wrap = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));

const c = {
  bold: wrap('1'),
  dim: wrap('2'),
  red: wrap('31'),
  green: wrap('32'),
  yellow: wrap('33'),
  cyan: wrap('36'),
};

const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

function table(rows) {
  if (!rows.length) return '';
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => stripAnsi(r[i] ?? '').length)));
  return rows
    .map((r) =>
      r
        .map((cell, i) => {
          const s = String(cell ?? '');
          return i === r.length - 1 ? s : s + ' '.repeat(widths[i] - stripAnsi(s).length);
        })
        .join('  ')
        .trimEnd()
    )
    .join('\n');
}

function bar(pct, width = 20) {
  const p = Math.max(0, Math.min(100, pct));
  const filled = Math.round((p / 100) * width);
  const color = p >= 90 ? c.red : p >= 70 ? c.yellow : c.green;
  return color('█'.repeat(filled)) + c.dim('░'.repeat(width - filled));
}

// Mensagens para o usuário vão sempre para stderr; stdout fica livre para o código de shell do wrapper.
const info = (...a) => console.error(...a);

module.exports = { c, table, bar, info };
