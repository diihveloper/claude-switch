'use strict';
// Conta por projeto: um arquivo .claude-account (como o .nvmrc) com o nome da conta.
const fs = require('fs');
const path = require('path');

const FILE = '.claude-account';

// Procura o arquivo subindo a partir de "start". Retorna { file, name } ou null.
function find(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    const file = path.join(dir, FILE);
    try {
      if (fs.statSync(file).isFile()) {
        const name = fs.readFileSync(file, 'utf8').split(/\r?\n/)[0].trim();
        return { file, name };
      }
    } catch {
      // não existe neste nível
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function pin(name, dir = process.cwd()) {
  const file = path.join(dir, FILE);
  fs.writeFileSync(file, name + '\n');
  return file;
}

function unpin(dir = process.cwd()) {
  const file = path.join(dir, FILE);
  if (!fs.existsSync(file)) return null;
  fs.rmSync(file);
  return file;
}

module.exports = { FILE, find, pin, unpin };
