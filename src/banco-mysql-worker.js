// Executa as consultas no MySQL numa thread separada.
// A thread principal espera a resposta de forma síncrona (Atomics.wait), o que permite manter
// o mesmo jeito simples de usar o banco em todo o código (db.prepare(...).get/all/run).
import { workerData } from 'node:worker_threads';
import mysql from 'mysql2/promise';

const { porta, sab, opcoes } = workerData;
const sinal = new Int32Array(sab);

let conexao = null;
let emTransacao = false;

async function conectar() {
  const hosts = [opcoes.host, ...(opcoes.host === '127.0.0.1' ? ['localhost'] : [])];
  let ultimoErro;
  for (const host of hosts) {
    try {
      const c = await mysql.createConnection({
        host, port: opcoes.port, user: opcoes.user, password: opcoes.password, database: opcoes.database,
        charset: 'utf8mb4', timezone: '-03:00', dateStrings: true, decimalNumbers: true, supportBigNumbers: true,
        connectTimeout: 15000, enableKeepAlive: true,
      });
      await c.query("SET time_zone = '-03:00'");
      c.on('error', () => { conexao = null; });
      return c;
    } catch (e) { ultimoErro = e; }
  }
  throw ultimoErro;
}

const TIPO_TEXT = 252; // colunas TEXT: NULL vira '' (igual ao SQLite com DEFAULT '')

async function executar({ sql, params }) {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      if (!conexao) conexao = await conectar();
      const [linhas, campos] = await conexao.query(sql, params || []);
      if (/^\s*(START TRANSACTION|BEGIN)/i.test(sql)) emTransacao = true;
      if (/^\s*(COMMIT|ROLLBACK)/i.test(sql)) emTransacao = false;
      if (Array.isArray(linhas)) {
        const textos = (campos || []).filter((f) => f.columnType === TIPO_TEXT && f.characterSet !== 63).map((f) => f.name);
        return { linhas: linhas.map((l) => { const o = { ...l }; for (const t of textos) if (o[t] === null) o[t] = ''; return o; }) };
      }
      return { changes: linhas.affectedRows, lastInsertRowid: linhas.insertId };
    } catch (e) {
      const caiu = ['PROTOCOL_CONNECTION_LOST', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT'].includes(e.code) || e.fatal;
      if (caiu && !emTransacao && tentativa === 0) { conexao = null; continue; }
      if (caiu) { conexao = null; emTransacao = false; }
      throw e;
    }
  }
}

porta.on('message', async (msg) => {
  let resposta;
  try {
    resposta = { ok: true, resultado: await executar(msg) };
  } catch (e) {
    resposta = { ok: false, erro: e.sqlMessage || e.message, codigo: e.code || '', sql: String(msg.sql).slice(0, 300) };
  }
  porta.postMessage(resposta);
  Atomics.store(sinal, 0, 1);
  Atomics.notify(sinal, 0);
});
