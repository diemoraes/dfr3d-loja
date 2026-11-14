// Login do painel: cookie assinado com HMAC, sem guardar sessão no servidor
import crypto from 'node:crypto';
import { config } from './config.js';
import { parseCookies, HttpError } from './http.js';
import { emitir } from './eventos.js';
import { db } from './db.js';

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
  if (t.n === 10) emitir('admin:tentativas', { ip, tentativas: t.n });
  if (t.n > 10) throw new HttpError(429, 'Muitas tentativas. Aguarde 15 minutos.');
}

// ---------- Senha do painel ----------
// Depois que você troca a senha pelo painel, ela fica guardada como hash (scrypt) no banco e
// a ADMIN_PASSWORD do ambiente deixa de valer. Trocar a senha desconecta as outras sessões.
function senhaSalva() {
  const r = db.prepare("SELECT valor FROM ajustes WHERE chave = 'admin_senha'").get();
  return r ? JSON.parse(r.valor) : null;
}
const versaoSenha = () => senhaSalva()?.sal || 'env';

export function senhaConfere(senha) {
  const salva = senhaSalva();
  if (salva) {
    const h = crypto.scryptSync(String(senha || ''), Buffer.from(salva.sal, 'base64url'), 64);
    return crypto.timingSafeEqual(h, Buffer.from(salva.hash, 'base64url'));
  }
  return Boolean(config.adminPassword) && iguais(senha || '', config.adminPassword);
}

export function trocarSenha(atual, nova) {
  if (!senhaConfere(atual)) throw new HttpError(400, 'A senha atual está incorreta.');
  nova = String(nova || '');
  if (nova.length < 10) throw new HttpError(400, 'A nova senha precisa ter pelo menos 10 caracteres.');
  if (!/[a-zA-Z]/.test(nova) || !/\d/.test(nova)) throw new HttpError(400, 'Use letras e números na nova senha.');
  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(nova, sal, 64);
  db.prepare("INSERT INTO ajustes (chave, valor) VALUES ('admin_senha', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor")
    .run(JSON.stringify({ sal: sal.toString('base64url'), hash: hash.toString('base64url'), em: new Date().toISOString() }));
}

function cookieSessao() {
  const expira = Date.now() + DURACAO_MS;
  const valor = `${expira}.${assinar(`${expira}.${versaoSenha()}`)}`;
  const seguro = config.baseUrl.startsWith('https') ? '; Secure' : '';
  return `${COOKIE}=${valor}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${DURACAO_MS / 1000}${seguro}`;
}

export function login(req, senha) {
  if (!senhaSalva() && !config.adminPassword) throw new HttpError(500, 'Defina ADMIN_PASSWORD na Hostinger para o primeiro acesso ao painel.');
  checarLimite(req.socket.remoteAddress);
  if (!senhaConfere(senha)) throw new HttpError(401, 'Senha incorreta.');
  tentativas.delete(req.socket.remoteAddress);
  return cookieSessao();
}

/** Novo cookie para a sessão atual depois de trocar a senha (as outras caem). */
export const renovarSessao = () => cookieSessao();

export function logoutCookie() {
  return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

export function estaLogado(req) {
  if (!config.sessionSecret) return false;
  const v = parseCookies(req)[COOKIE];
  if (!v) return false;
  const [expira, assinatura] = v.split('.');
  if (!expira || !assinatura || Number(expira) < Date.now()) return false;
  return iguais(assinatura, assinar(`${expira}.${versaoSenha()}`));
}

export function exigirAdmin(req) {
  if (!estaLogado(req)) throw new HttpError(401, 'Faça login no painel.');
}
