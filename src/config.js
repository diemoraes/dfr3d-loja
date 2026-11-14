// Configuração da loja.
// - O essencial para ligar o servidor vem do ambiente (.env ou Hostinger): DATA_DIR, PORT, NODE_ENV e a
//   senha do primeiro acesso (ADMIN_PASSWORD).
// - Todo o resto é editado em Painel → Configurações e fica salvo no banco. Se um campo nunca foi salvo
//   no painel, vale a variável de ambiente de mesmo nome (compatível com instalações antigas).
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CAMPOS } from './campos-config.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile) && !process.env.DFR_SEM_ENV) {
  try { process.loadEnvFile(envFile); } catch (e) { console.warn('Não consegui ler o .env:', e.message); }
}

const env = (k, d = '') => (process.env[k] ?? d).toString().trim();
const reaisParaCentavos = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const s = String(v).trim();
  const n = Math.round(parseFloat(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s) * 100);
  return Number.isFinite(n) ? n : null;
};
const digitos = (v) => String(v ?? '').replace(/\D/g, '');

const DATA_DIR = path.resolve(ROOT, env('DATA_DIR', './data'));

/** Valores salvos pelo painel (carregados do banco em db.js). */
let salvos = {};

/** Valor efetivo de um campo: painel → variável de ambiente → padrão. */
export function valorCampo(chave) {
  if (Object.prototype.hasOwnProperty.call(salvos, chave)) return String(salvos[chave] ?? '').trim();
  return env(chave, CAMPOS[chave]?.padrao ?? '');
}
/** De onde vem o valor atual: 'painel' | 'ambiente' | 'padrao' */
export function origemCampo(chave) {
  if (Object.prototype.hasOwnProperty.call(salvos, chave)) return 'painel';
  if (process.env[chave] !== undefined && process.env[chave] !== '') return 'ambiente';
  return 'padrao';
}

export const config = {
  // --- Só pelo ambiente (precisam existir antes do banco abrir) ---
  port: Number(env('PORT', '3000')),
  production: env('NODE_ENV') === 'production',
  adminPassword: env('ADMIN_PASSWORD'),            // senha do primeiro acesso (depois troque no painel)
  sessionSecret: env('SESSION_SECRET'),            // se vazio, é gerado e guardado no banco
  dataDir: DATA_DIR,
  uploadsDir: path.join(DATA_DIR, 'uploads'),
  backupDir: path.join(DATA_DIR, 'backups'),
  dbFile: path.join(DATA_DIR, 'loja.db'),
};

/** Recalcula tudo o que é editável no painel. Os módulos leem `config.x` na hora do uso, então vale na hora. */
export function aplicarAjustes(novos = salvos) {
  salvos = { ...novos };
  const v = valorCampo;
  Object.assign(config, {
    baseUrl: (v('BASE_URL') || 'http://localhost:3000').replace(/\/+$/, ''),
    loja: { nome: v('LOJA_NOME') || 'DFR 3D Impressão', responsavel: v('LOJA_RESPONSAVEL'), cidade: v('LOJA_CIDADE'), cidadeForo: v('LOJA_CIDADE') },
    mp: { accessToken: v('MP_ACCESS_TOKEN'), webhookSecret: v('MP_WEBHOOK_SECRET') },
    pixDescontoPct: Math.min(Math.max(Number(v('PIX_DESCONTO').replace(',', '.')) || 0, 0), 50),
    pedidoExpiraHoras: Math.max(Number(v('PEDIDO_EXPIRA_HORAS')) || 72, 1),
    melhorEnvio: {
      token: v('MELHOR_ENVIO_TOKEN'), sandbox: v('MELHOR_ENVIO_SANDBOX') === 'true',
      email: v('MELHOR_ENVIO_EMAIL') || v('EMAIL_CONTATO') || 'contato@dfr3d.com.br',
      servicos: v('MELHOR_ENVIO_SERVICOS').split(',').map((s) => s.trim()).filter(Boolean),
    },
    remetente: {
      nome: v('REMETENTE_NOME') || v('LOJA_NOME'), telefone: digitos(v('REMETENTE_TELEFONE') || v('WHATSAPP')),
      email: v('REMETENTE_EMAIL') || v('EMAIL_CONTATO'), documento: digitos(v('REMETENTE_DOCUMENTO')),
      endereco: v('REMETENTE_RUA'), numero: v('REMETENTE_NUMERO'), complemento: v('REMETENTE_COMPLEMENTO'),
      bairro: v('REMETENTE_BAIRRO'), cidade: v('REMETENTE_CIDADE'), uf: v('REMETENTE_UF').toUpperCase(),
    },
    cepOrigem: digitos(v('CEP_ORIGEM')),
    freteFixoCents: reaisParaCentavos(v('FRETE_FIXO')),
    freteGratisAcimaCents: reaisParaCentavos(v('FRETE_GRATIS_ACIMA')),
    retirada: { ativa: v('RETIRADA_ATIVA') !== 'false', endereco: v('RETIRADA_ENDERECO') || 'Combinar pelo WhatsApp' },
    contato: { whatsapp: digitos(v('WHATSAPP')), email: v('EMAIL_CONTATO'), instagram: v('INSTAGRAM').replace(/^@/, '') },
    email: { resendKey: v('RESEND_API_KEY'), brevoKey: v('BREVO_API_KEY'), remetente: v('EMAIL_REMETENTE'), admin: v('EMAIL_ADMIN') },
    telegram: { token: v('TELEGRAM_BOT_TOKEN'), chatId: v('TELEGRAM_CHAT_ID') },
    callmebot: { telefone: digitos(v('CALLMEBOT_TELEFONE')), apikey: v('CALLMEBOT_APIKEY') },
    analytics: { ga: v('GA_ID'), metaPixel: v('META_PIXEL_ID') },
    backup: { manterDias: Math.max(Number(v('BACKUP_MANTER_DIAS')) || 14, 1), porEmail: v('BACKUP_POR_EMAIL') === 'true' },
    turnstile: { siteKey: v('TURNSTILE_SITE_KEY'), secret: v('TURNSTILE_SECRET') },
    google: { clientId: v('GOOGLE_CLIENT_ID'), clientSecret: v('GOOGLE_CLIENT_SECRET') },
    mercadoLivre: { clientId: v('ML_CLIENT_ID'), clientSecret: v('ML_CLIENT_SECRET') },
  });
}
aplicarAjustes({});

for (const d of [config.uploadsDir, config.backupDir]) fs.mkdirSync(d, { recursive: true });
