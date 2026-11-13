// Tarefas automáticas: cancelar pedidos não pagos e fazer backup diário
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db, atualizarStatusPedido, lerAjuste, salvarAjuste } from './db.js';
import { enviarEmail, emailAtivo } from './notificacoes.js';
import { atualizarRastreios } from './etiqueta.js';

/** Cancela pedidos aguardando pagamento há mais de PEDIDO_EXPIRA_HORAS e devolve o estoque. */
export function expirarPedidos() {
  const vencidos = db.prepare(`SELECT * FROM pedidos WHERE status = 'aguardando_pagamento'
    AND criado_em <= datetime('now','localtime', ?)`).all(`-${config.pedidoExpiraHoras} hours`);
  for (const p of vencidos) {
    try { atualizarStatusPedido(p, 'cancelado', `Pagamento não recebido em ${config.pedidoExpiraHoras}h (cancelado automaticamente)`); }
    catch (e) { console.error('Expirar pedido', p.codigo, e.message); }
  }
  if (vencidos.length) console.log(`${vencidos.length} pedido(s) não pago(s) cancelado(s).`);
  return vencidos.length;
}

const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

/** Cópia consistente do banco (VACUUM INTO) + lista das fotos. Mantém os últimos N dias. */
export async function fazerBackup({ forcar = false } = {}) {
  const dia = hojeSP();
  const arquivo = path.join(config.backupDir, `loja-${dia}.db`);
  if (!forcar && fs.existsSync(arquivo)) return arquivo;
  fs.rmSync(arquivo, { force: true });
  db.exec(`VACUUM INTO '${arquivo.replace(/'/g, "''")}'`);

  // Apaga backups antigos
  const limite = Date.now() - config.backup.manterDias * 86400_000;
  for (const f of fs.readdirSync(config.backupDir)) {
    const full = path.join(config.backupDir, f);
    if (/^loja-\d{4}-\d{2}-\d{2}\.db$/.test(f) && fs.statSync(full).mtimeMs < limite) fs.rmSync(full, { force: true });
  }

  if (config.backup.porEmail && emailAtivo() && lerAjuste('backup_email_dia') !== dia) {
    const conteudo = fs.readFileSync(arquivo);
    if (conteudo.length < 15 * 1024 * 1024) {
      await enviarEmail({ para: config.email.admin, assunto: `Backup diário da loja — ${dia}`,
        html: `<p>Backup automático do banco de dados da loja DFR 3D (${(conteudo.length / 1024).toFixed(0)} KB). Guarde este e-mail.</p><p>As fotos dos produtos ficam na pasta <code>uploads</code> do servidor.</p>`,
        anexos: [{ nome: path.basename(arquivo), conteudoBase64: conteudo.toString('base64') }] })
        .then(() => salvarAjuste('backup_email_dia', dia))
        .catch((e) => console.error('Backup por e-mail:', e.message));
    }
  }
  salvarAjuste('ultimo_backup', new Date().toISOString());
  return arquivo;
}

export function listarBackups() {
  return fs.readdirSync(config.backupDir).filter((f) => /^loja-.*\.db$/.test(f)).sort().reverse()
    .map((f) => ({ arquivo: f, tamanho: fs.statSync(path.join(config.backupDir, f)).size }));
}

export function iniciarTarefas() {
  const rodar = () => {
    try { expirarPedidos(); } catch (e) { console.error(e); }
    atualizarRastreios().catch((e) => console.error('Rastreios:', e.message));
    const hora = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }));
    if (hora >= 3) fazerBackup().catch((e) => console.error('Backup:', e.message));
  };
  setTimeout(rodar, 10_000);
  setInterval(rodar, 15 * 60_000).unref();
}
