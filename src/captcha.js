// Captcha do login do painel
// - Com TURNSTILE_SITE_KEY/TURNSTILE_SECRET: usa o Cloudflare Turnstile (grátis, sem digitar letras)
// - Sem configuração: captcha próprio em imagem (letras distorcidas), sem depender de serviço externo
import crypto from 'node:crypto';
import { config } from './config.js';
import { HttpError } from './http.js';

export const turnstileAtivo = () => Boolean(config.turnstile.siteKey && config.turnstile.secret);

const LETRAS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sem 0/O, 1/I/L para não confundir
const VALIDADE_MS = 5 * 60_000;
const usados = new Map(); // token -> expira (uso único)
const segredo = () => config.sessionSecret || 'captcha-dev';
const assinar = (t) => crypto.createHmac('sha256', segredo()).update(t).digest('base64url');
const rnd = (a, b) => a + Math.random() * (b - a);

/** Gera um desafio: { token, svg }. A resposta fica embutida no token, assinada e com hash. */
export function gerarCaptcha() {
  const bytes = crypto.randomBytes(5);
  const texto = [...bytes].map((b) => LETRAS[b % LETRAS.length]).join('');
  const expira = Date.now() + VALIDADE_MS;
  const nonce = crypto.randomBytes(9).toString('base64url');
  const hash = assinar(`${nonce}.${expira}.${texto}`);
  const token = `${nonce}.${expira}.${hash}`;

  const L = 200, A = 64;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="${A}" viewBox="0 0 ${L} ${A}" role="img" aria-label="Código de verificação">`;
  svg += `<rect width="100%" height="100%" rx="10" fill="#111115"/>`;
  for (let i = 0; i < 7; i++) {
    svg += `<path d="M${rnd(0, 40)} ${rnd(5, A - 5)} Q ${rnd(50, 150)} ${rnd(0, A)} ${rnd(160, L)} ${rnd(5, A - 5)}" stroke="${i % 2 ? '#e10a14' : '#52525b'}" stroke-width="${rnd(1, 2.4).toFixed(1)}" fill="none" opacity="0.8"/>`;
  }
  for (let i = 0; i < 40; i++) svg += `<circle cx="${rnd(0, L).toFixed(0)}" cy="${rnd(0, A).toFixed(0)}" r="${rnd(0.6, 1.8).toFixed(1)}" fill="#71717a"/>`;
  [...texto].forEach((c, i) => {
    const x = 22 + i * 36 + rnd(-4, 4), y = 44 + rnd(-6, 6), ang = rnd(-28, 28);
    svg += `<text x="${x.toFixed(0)}" y="${y.toFixed(0)}" transform="rotate(${ang.toFixed(0)} ${x.toFixed(0)} ${y.toFixed(0)})" font-family="Verdana,Arial,sans-serif" font-size="${rnd(28, 34).toFixed(0)}" font-weight="700" font-style="italic" fill="${i % 2 ? '#ffffff' : '#f4f4f5'}">${c}</text>`;
  });
  svg += `<path d="M5 ${rnd(20, 44)} C 60 ${rnd(0, A)}, 140 ${rnd(0, A)}, 195 ${rnd(20, 44)}" stroke="#e10a14" stroke-width="2" fill="none"/></svg>`;
  return { token, svg };
}

function conferirProprio(token, resposta) {
  const [nonce, expira, hash] = String(token || '').split('.');
  if (!nonce || !expira || !hash || Number(expira) < Date.now()) return false;
  if (usados.has(token)) return false;
  const tentativa = String(resposta || '').trim().toUpperCase().replace(/\s/g, '').replace(/0/g, 'O').replace(/1/g, 'I');
  const esperado = Buffer.from(assinar(`${nonce}.${expira}.${tentativa}`));
  const ok = esperado.length === Buffer.from(hash).length && crypto.timingSafeEqual(esperado, Buffer.from(hash));
  usados.set(token, Number(expira)); // vale uma vez só, certo ou errado
  for (const [t, e] of usados) if (e < Date.now()) usados.delete(t);
  return ok;
}

async function conferirTurnstile(resposta, ip) {
  if (!resposta) return false;
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret: config.turnstile.secret, response: resposta, remoteip: ip || '' }),
    signal: AbortSignal.timeout(10000),
  }).then((x) => x.json()).catch(() => ({ success: false }));
  return r.success === true;
}

/** Lança erro 400 se o captcha não passar. */
export async function exigirCaptcha(req, b) {
  const ok = turnstileAtivo()
    ? await conferirTurnstile(b.turnstile, req.socket.remoteAddress)
    : conferirProprio(b.captcha_token, b.captcha_resposta);
  if (!ok) throw new HttpError(400, turnstileAtivo() ? 'Confirme que você não é um robô.' : 'Código de verificação incorreto. Tente o novo código.');
}
