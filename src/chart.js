'use strict';
// Gráficos de uso no terminal, desenhados com blocos (▁▂▃▄▅▆▇█): cada coluna é um intervalo de tempo.
const { c } = require('./format');

const BLOCKS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

// Agrupa amostras [{t, v}] em "width" colunas entre from e to; cada coluna fica com o último valor
// do intervalo. Colunas sem amostra repetem a anterior por até "carry" colunas (senão ficam null).
function bucketize(points, from, to, width, carry = 2) {
  const step = (to - from) / width;
  const cols = new Array(width).fill(null);
  for (const p of points) {
    if (p.v == null || p.t < from || p.t > to) continue;
    cols[Math.min(width - 1, Math.floor((p.t - from) / step))] = p.v;
  }
  let last = null;
  let gap = 0;
  for (let i = 0; i < width; i++) {
    if (cols[i] != null) {
      last = cols[i];
      gap = 0;
    } else if (last != null && ++gap <= carry) cols[i] = last;
  }
  return cols;
}

const pad = (s, n) => (s.length >= n ? s : ' '.repeat(n - s.length) + s);

// cols: valores (ou null) já agrupados; max: valor do topo. color(v) escolhe a cor da coluna.
function render(cols, { height = 4, max = 100, top = `${max}%`, bottom = '0%', color = () => (s) => s, from, to, fmtTime }) {
  const labelW = Math.max(top.length, bottom.length);
  const lines = [];
  for (let row = height - 1; row >= 0; row--) {
    let line = '';
    for (const v of cols) {
      if (v == null) {
        line += row === 0 ? c.dim('·') : ' ';
        continue;
      }
      const eighths = Math.round((Math.max(0, Math.min(max, v)) / max) * height * 8) - row * 8;
      const ch = BLOCKS[Math.max(0, Math.min(8, eighths))];
      // Uso zero ainda aparece como uma linha fina, diferente de "sem dados".
      line += color(v)(row === 0 && ch === ' ' ? '▁' : ch);
    }
    const label = row === height - 1 ? top : row === 0 ? bottom : '';
    lines.push(`  ${pad(label, labelW)} ${c.dim('│')}${line}`);
  }
  const a = fmtTime(from);
  const b = 'agora';
  const axis = a + ' '.repeat(Math.max(1, cols.length - a.length - b.length)) + b;
  lines.push(`  ${' '.repeat(labelW)}  ${c.dim(axis)}`);
  return lines.join('\n');
}

const usageColor = (v) => (v >= 90 ? c.red : v >= 70 ? c.yellow : c.green);

module.exports = { bucketize, render, usageColor };
