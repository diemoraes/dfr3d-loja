// Login do painel: cookie assinado com HMAC, sem guardar sessão no servidor
import crypto from 'node:crypto';
import { config } from './config.js';
import { parseCookies, HttpError } from './http.js';

const COOKIE = 'dfr_admin';
const DURACAO_MS = 1000 * 60 * 60 * 12; // 12 horas

export const assinar = (dados) => crypto.createHmac('sha256', config.sessionSecret).update(dados).digest('base64url');

export function iguais(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Limite simples de tentativas de login por IP
const tentativas = new Map();
function checarLimite(ip) {
  const agora = Date.now();
  const t = tentativas.get(ip) || { n: 0, desde: agora };
  if (agora - t.desde > 15 * 60_000) { t.n = 0; t.desde = agora; }
  t.n++;
  tentativas.set(ip, t);
  if (t.n > 10) throw new HttpError(429, 'Muitas tentativas. Aguarde 15 minutos.');
}

export function login(req, senha) {
  if (!config.adminPassword || !config.sessionSecret) throw new HttpError(500, 'Painel não configurado (ADMIN_PASSWORD / SESSION_SECRET).');
  checarLimite(req.socket.remoteAddress);
  if (!iguais(senha || '', config.adminPassword)) throw new HttpError(401, 'Senha incorreta.');
  tentativas.delete(req.socket.remoteAddress);
  const expira = Date.now() + DURACAO_MS;
  const valor = `${expira}.${assinar(String(expira))}`;
  const seguro = config.baseUrl.startsWith('https') ? '; Secure' : '';
  return `${COOKIE}=${valor}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${DURACAO_MS / 1000}${seguro}`;
}

export function logoutCookie() {
  return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

export function estaLogado(req) {
  if (!config.sessionSecret) return false;
  const v = parseCookies(req)[COOKIE];
  if (!v) return false;
  const [expira, assinatura] = v.split('.');
  if (!expira || !assinatura || Number(expira) < Date.now()) return false;
  return iguais(assinatura, assinar(expira));
}

export function exigirAdmin(req) {
  if (!estaLogado(req)) throw new HttpError(401, 'Faça login no painel.');
}
