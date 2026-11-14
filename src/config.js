// Configuração lida das variáveis de ambiente (arquivo .env ou painel da Hostinger)
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile) && !process.env.DFR_SEM_ENV) {
  try { process.loadEnvFile(envFile); } catch (e) { console.warn('Não consegui ler o .env:', e.message); }
}

const env = (k, d = '') => (process.env[k] ?? d).toString().trim();
const reaisParaCentavos = (v) => (v === '' ? null : Math.round(parseFloat(v.replace(',', '.')) * 100));
const digitos = (v) => v.replace(/\D/g, '');

const DATA_DIR = path.resolve(ROOT, env('DATA_DIR', './data'));

export const config = {
  port: Number(env('PORT', '3000')),
  baseUrl: env('BASE_URL', 'http://localhost:3000').replace(/\/$/, ''),
  production: env('NODE_ENV') === 'production',
  adminPassword: env('ADMIN_PASSWORD'),
  sessionSecret: env('SESSION_SECRET'),
  dataDir: DATA_DIR,
  uploadsDir: path.join(DATA_DIR, 'uploads'),
  backupDir: path.join(DATA_DIR, 'backups'),
  dbFile: path.join(DATA_DIR, 'loja.db'),

  // Identificação obrigatória da loja (Decreto 7.962/2013)
  loja: {
    nome: env('LOJA_NOME', 'DFR 3D Impressão'),
    responsavel: env('LOJA_RESPONSAVEL'),
    cidade: env('LOJA_CIDADE', 'São José dos Campos - SP'), // única localização exibida no site
    cidadeForo: env('LOJA_CIDADE', 'São José dos Campos - SP'),
  },

  mp: {
    accessToken: env('MP_ACCESS_TOKEN'),
    webhookSecret: env('MP_WEBHOOK_SECRET'),
  },
  pixDescontoPct: Math.min(Math.max(Number(env('PIX_DESCONTO', '5').replace(',', '.')) || 0, 0), 50),
  pedidoExpiraHoras: Math.max(Number(env('PEDIDO_EXPIRA_HORAS', '72')) || 72, 1),

  melhorEnvio: {
    token: env('MELHOR_ENVIO_TOKEN'),
    sandbox: env('MELHOR_ENVIO_SANDBOX') === 'true',
    email: env('MELHOR_ENVIO_EMAIL', 'contato@dfr3d.com.br'),
    servicos: env('MELHOR_ENVIO_SERVICOS').split(',').map((s) => s.trim()).filter(Boolean),
  },
  // Remetente impresso na etiqueta do Melhor Envio
  remetente: {
    nome: env('REMETENTE_NOME', env('LOJA_NOME', 'DFR 3D Impressão')),
    telefone: digitos(env('REMETENTE_TELEFONE', env('WHATSAPP', '5512981020949'))),
    email: env('REMETENTE_EMAIL', env('EMAIL_CONTATO')),
    documento: digitos(env('REMETENTE_DOCUMENTO')), // só vai na etiqueta, nunca aparece no site
    endereco: env('REMETENTE_RUA'),
    numero: env('REMETENTE_NUMERO'),
    complemento: env('REMETENTE_COMPLEMENTO'),
    bairro: env('REMETENTE_BAIRRO'),
    cidade: env('REMETENTE_CIDADE'),
    uf: env('REMETENTE_UF'),
  },
  cepOrigem: digitos(env('CEP_ORIGEM')),
  freteFixoCents: reaisParaCentavos(env('FRETE_FIXO')),
  freteGratisAcimaCents: reaisParaCentavos(env('FRETE_GRATIS_ACIMA')),

  retirada: {
    ativa: env('RETIRADA_ATIVA', 'true') !== 'false',
    endereco: env('RETIRADA_ENDERECO', 'Combinar pelo WhatsApp'),
  },
  contato: {
    whatsapp: digitos(env('WHATSAPP', '5512981020949')),
    email: env('EMAIL_CONTATO'),
    instagram: env('INSTAGRAM').replace(/^@/, ''),
  },

  // E-mails transacionais: Resend (resend.com) ou Brevo (brevo.com)
  email: {
    resendKey: env('RESEND_API_KEY'),
    brevoKey: env('BREVO_API_KEY'),
    remetente: env('EMAIL_REMETENTE'), // ex.: DFR 3D <pedidos@dfr3d.com.br>
    admin: env('EMAIL_ADMIN', 'difere.3d@gmail.com'), // recebe um e-mail a cada acontecimento do site
  },
  // Avisos no celular
  telegram: { token: env('TELEGRAM_BOT_TOKEN'), chatId: env('TELEGRAM_CHAT_ID') },
  callmebot: { telefone: digitos(env('CALLMEBOT_TELEFONE')), apikey: env('CALLMEBOT_APIKEY') },

  analytics: { ga: env('GA_ID'), metaPixel: env('META_PIXEL_ID') },

  backup: {
    manterDias: Math.max(Number(env('BACKUP_MANTER_DIAS', '14')) || 14, 1),
    porEmail: env('BACKUP_POR_EMAIL') === 'true',
  },

  // Captcha do login do painel (opcional: Cloudflare Turnstile; sem isso usa o captcha próprio)
  turnstile: { siteKey: env('TURNSTILE_SITE_KEY'), secret: env('TURNSTILE_SECRET') },

  // Login de clientes com Google (console.cloud.google.com → Credenciais → ID do cliente OAuth)
  google: {
    clientId: env('GOOGLE_CLIENT_ID'),
    clientSecret: env('GOOGLE_CLIENT_SECRET'),
  },

  mercadoLivre: {
    clientId: env('ML_CLIENT_ID'),
    clientSecret: env('ML_CLIENT_SECRET'),
  },
};

for (const d of [config.uploadsDir, config.backupDir]) fs.mkdirSync(d, { recursive: true });

if (!config.adminPassword || !config.sessionSecret || config.sessionSecret.length < 32) {
  const msg = 'Defina ADMIN_PASSWORD e SESSION_SECRET (32+ caracteres) no .env para usar o painel.';
  if (config.production) throw new Error(msg);
  console.warn('⚠ ' + msg);
}
