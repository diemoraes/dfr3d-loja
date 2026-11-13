// Sincronização de estoque com o Mercado Livre
// - Venda no site  → atualiza a quantidade do anúncio no ML
// - Venda no ML    → baixa o estoque no site (via notificação "orders_v2")
// Só vale para produtos com estoque controlado (não "sob demanda") e vinculados a um anúncio (MLB...).
import { config } from './config.js';
import { db, lerAjuste, salvarAjuste } from './db.js';
import { eventos, emitir } from './eventos.js';
import { HttpError } from './http.js';

const API = 'https://api.mercadolibre.com';
export const mlConfigurado = () => Boolean(config.mercadoLivre.clientId && config.mercadoLivre.clientSecret);
export const mlConectado = () => Boolean(lerAjuste('ml_tokens'));
const redirectUri = () => `${config.baseUrl}/api/admin/ml/callback`;

export function urlAutorizacao(state) {
  const q = new URLSearchParams({ response_type: 'code', client_id: config.mercadoLivre.clientId, redirect_uri: redirectUri(), state });
  return `https://auth.mercadolivre.com.br/authorization?${q}`;
}

async function pedirToken(params) {
  const res = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: config.mercadoLivre.clientId, client_secret: config.mercadoLivre.clientSecret, ...params }),
    signal: AbortSignal.timeout(15000),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, `Mercado Livre recusou a conexão: ${d.message || res.status}`);
  const tokens = { access_token: d.access_token, refresh_token: d.refresh_token, user_id: d.user_id, expira: Date.now() + (d.expires_in - 300) * 1000 };
  salvarAjuste('ml_tokens', tokens);
  return tokens;
}

export const conectar = (code) => pedirToken({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() });
export const desconectar = () => db.prepare("DELETE FROM ajustes WHERE chave = 'ml_tokens'").run();

async function token() {
  let t = lerAjuste('ml_tokens');
  if (!t) throw new HttpError(400, 'Mercado Livre não conectado.');
  if (Date.now() > t.expira) t = await pedirToken({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
  return t;
}

async function ml(caminho, opcoes = {}) {
  const t = await token();
  const res = await fetch(API + caminho, {
    ...opcoes,
    headers: { Authorization: `Bearer ${t.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, `Mercado Livre: ${d.message || d.error || res.status}`);
  return d;
}

export async function contaML() {
  const t = await token();
  const u = await ml(`/users/${t.user_id}`);
  return { id: u.id, apelido: u.nickname };
}

export async function lerAnuncio(itemId) {
  const it = await ml(`/items/${encodeURIComponent(itemId)}`);
  return { id: it.id, titulo: it.title, quantidade: it.available_quantity, status: it.status, link: it.permalink, tem_variacoes: (it.variations || []).length > 0 };
}

/** Envia o estoque do site para o anúncio. */
export async function enviarEstoque(produto) {
  if (!produto.ml_item_id || produto.estoque === null || !mlConectado()) return;
  const it = await ml(`/items/${produto.ml_item_id}`);
  const quantidade = Math.max(produto.estoque, 0);
  if ((it.variations || []).length) {
    // Anúncio com variações: aplica a mesma quantidade a todas (ajuste fino no ML se precisar)
    await ml(`/items/${produto.ml_item_id}`, { method: 'PUT', body: JSON.stringify({ variations: it.variations.map((v) => ({ id: v.id, available_quantity: quantidade })) }) });
  } else if (quantidade === 0) {
    await ml(`/items/${produto.ml_item_id}`, { method: 'PUT', body: JSON.stringify({ available_quantity: 0 }) }).catch(async () => {
      await ml(`/items/${produto.ml_item_id}`, { method: 'PUT', body: JSON.stringify({ status: 'paused' }) });
    });
  } else {
    await ml(`/items/${produto.ml_item_id}`, { method: 'PUT', body: JSON.stringify({ available_quantity: quantidade, ...(it.status === 'paused' ? { status: 'active' } : {}) }) });
  }
}

/** Notificação do ML: uma venda lá baixa o estoque aqui (cada pedido só uma vez). */
export async function processarNotificacao(corpo) {
  if (corpo.topic !== 'orders_v2' || !corpo.resource) return;
  const t = await token();
  if (String(corpo.user_id) !== String(t.user_id)) return;
  const pedido = await ml(corpo.resource);
  if (pedido.status !== 'paid') return;
  const processados = lerAjuste('ml_pedidos_processados', []);
  if (processados.includes(pedido.id)) return;
  const alterados = [];
  for (const item of pedido.order_items || []) {
    const p = db.prepare('SELECT * FROM produtos WHERE ml_item_id = ? AND estoque IS NOT NULL').get(item.item.id);
    if (!p) continue;
    db.prepare('UPDATE produtos SET estoque = MAX(estoque - ?, 0) WHERE id = ?').run(item.quantity, p.id);
    alterados.push(p.id);
  }
  salvarAjuste('ml_pedidos_processados', [pedido.id, ...processados].slice(0, 500));
  if (alterados.length) console.log(`Mercado Livre: venda ${pedido.id} baixou estoque de ${alterados.length} produto(s).`);
  emitir('estoque:alterado:ml', alterados);
}

// Venda/cancelamento no site → atualiza o anúncio
eventos.on('estoque:alterado', async (ids) => {
  if (!mlConectado()) return;
  for (const id of new Set(ids)) {
    const p = db.prepare('SELECT * FROM produtos WHERE id = ?').get(id);
    if (p?.ml_item_id) await enviarEstoque(p).catch((e) => console.error(`ML estoque ${p.ml_item_id}:`, e.message));
  }
});
