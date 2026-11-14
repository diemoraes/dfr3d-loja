// Escolhe o banco de dados:
//  - MySQL, quando DB_NAME/DB_USER/DB_PASSWORD estão definidos no ambiente (Hostinger)
//  - SQLite (arquivo em DATA_DIR), quando não estão — útil para testar no computador
// Os dois têm a mesma interface usada no resto do código: db.prepare(sql).get/all/run(...) e db.exec(sql).
import { DatabaseSync } from 'node:sqlite';
import { Worker, MessageChannel, receiveMessageOnPort } from 'node:worker_threads';
import { config } from './config.js';

const env = (k, d = '') => (process.env[k] ?? d).toString().trim();

export const mysqlConfigurado = () => Boolean(env('DB_NAME') && env('DB_USER'));

/** Converte as poucas expressões próprias do SQLite usadas no código para MySQL. */
export function traduzirParaMySQL(sql) {
  return sql
    .replace(/datetime\('now',\s*'localtime'\)/g, 'NOW()')
    .replace(/\s+COLLATE NOCASE/g, '')
    .replace(/ON CONFLICT\((\w+)\) DO UPDATE SET (\w+) = excluded\.(\w+)/g, 'ON DUPLICATE KEY UPDATE $2 = VALUES($3)')
    .replace(/MAX\(estoque - \?, 0\)/g, 'GREATEST(estoque - ?, 0)')
    .replace(/^\s*BEGIN(\s+IMMEDIATE)?\s*$/i, 'START TRANSACTION');
}

class BancoMySQL {
  constructor(opcoes) {
    this.tipo = 'mysql';
    this.sinal = new Int32Array(new SharedArrayBuffer(4));
    const { port1, port2 } = new MessageChannel();
    this.porta = port1;
    this.worker = new Worker(new URL('./banco-mysql-worker.js', import.meta.url), {
      workerData: { porta: port2, sab: this.sinal.buffer, opcoes }, transferList: [port2],
    });
    this.worker.on('error', (e) => console.error('Erro na conexão com o MySQL:', e.message));
    this.worker.unref();
    this.porta.unref();
    this.cache = new Map();
  }

  chamar(sql, params) {
    Atomics.store(this.sinal, 0, 0);
    this.porta.postMessage({ sql, params });
    if (Atomics.wait(this.sinal, 0, 0, 30_000) === 'timed-out') throw new Error('O MySQL não respondeu em 30 segundos.');
    const m = receiveMessageOnPort(this.porta);
    if (!m) throw new Error('Resposta do MySQL não recebida.');
    if (!m.message.ok) {
      const e = new Error(`MySQL: ${m.message.erro}`);
      e.code = m.message.codigo;
      e.sql = m.message.sql;
      throw e;
    }
    return m.message.resultado;
  }

  prepare(sql) {
    let t = this.cache.get(sql);
    if (!t) { t = traduzirParaMySQL(sql); this.cache.set(sql, t); }
    return {
      all: (...p) => this.chamar(t, p).linhas,
      get: (...p) => this.chamar(t, p).linhas?.[0],
      run: (...p) => { const r = this.chamar(t, p); return { changes: r.changes, lastInsertRowid: r.lastInsertRowid }; },
    };
  }

  exec(sql) {
    this.chamar(traduzirParaMySQL(sql.trim()), []);
  }
}

export function abrirBanco() {
  if (mysqlConfigurado()) {
    const opcoes = { host: env('DB_HOST', '127.0.0.1'), port: Number(env('DB_PORT', '3306')), user: env('DB_USER'), password: env('DB_PASSWORD'), database: env('DB_NAME') };
    const banco = new BancoMySQL(opcoes);
    try {
      const v = banco.prepare('SELECT VERSION() AS v').get();
      console.log(`Banco: MySQL ${v.v} (${opcoes.database} em ${opcoes.host})`);
    } catch (e) {
      console.error(`\n✖ Não foi possível conectar ao MySQL (${opcoes.user}@${opcoes.host}:${opcoes.port}/${opcoes.database}).\n  ${e.message}\n  Confira DB_HOST, DB_USER, DB_PASSWORD e DB_NAME nas variáveis da Hostinger.\n`);
      throw e;
    }
    return banco;
  }
  const db = new DatabaseSync(config.dbFile);
  db.tipo = 'sqlite';
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  console.log(`Banco: SQLite (${config.dbFile})`);
  return db;
}
