// Integração com o Mercado Pago (Checkout Pro): Pix, cartão em até 12x e boleto
import crypto from 'node:crypto';
import { config } from './config.js';
import { HttpError } from './http.js';

const API = 'https://api.mercadopago.com';

export const mpAtivo = () => Boolean(config.mp.accessToken);

async function mpFetch(caminho, opcoes = {}) {
  const res = await fetch(API + caminho, {
    ...opcoes,
    headers: {
      Authorization: `Bearer ${config.mp.accessToken}`,
      'Content-Type': 'application/json',
      ...(opcoes.headers || {}),
    },
    signal: AbortSignal.timeout(15000),
  });
  const dados = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('Mercado Pago erro', res.status, JSON.stringify(dados));
    const err = new HttpError(502, 'Não foi possível falar com o Mercado Pago. Tente novamente.');
    err.mpStatus = res.status;
    throw err;
  }
  return dados;
}

/** Cria a ordem de pagamento (Checkout Pro via Orders API) e devolve o link para o cliente pagar. */
export async function criarPagamento(pedido) {
  const lista = JSON.parse(pedido.itens);
  const titulo = (i) => [i.nome, i.variacao, i.cor].filter(Boolean).join(' - ').slice(0, 250);
  let itens;
  if (pedido.desconto_cents > 0) {
    // Envia um item único com o total já descontado
    const resumo = lista.map((i) => `${i.quantidade}x ${titulo(i)}`).join(', ').slice(0, 250);
    itens = [{ title: `Pedido ${pedido.codigo} - DFR 3D`, description: resumo || `Pedido ${pedido.codigo}`, category_id: 'art', quantity: 1, unit_price: (pedido.total_cents / 100).toFixed(2) }];
  } else {
    itens = lista.map((i) => ({
      title: titulo(i), description: titulo(i), category_id: 'art', quantity: i.quantidade, unit_price: (i.preco_cents / 100).toFixed(2),
    }));
    if (pedido.frete_cents > 0) {
      itens.push({ title: `Frete - ${pedido.entrega_servico}`, description: `Envio ${pedido.entrega_servico}`, category_id: 'services', quantity: 1, unit_price: (pedido.frete_cents / 100).toFixed(2) });
    }
  }
  const [nome, ...sobrenome] = pedido.cliente_nome.split(' ');
  const tel = pedido.cliente_telefone.replace(/\D/g, '');
  const corpo = {
    type: 'online',
    processing_mode: 'manual',
    total_amount: (pedido.total_cents / 100).toFixed(2),
    external_reference: pedido.codigo,
    expiration_time: `PT${config.pedidoExpiraHoras}H`,
    payer: {
      email: pedido.cliente_email,
      first_name: nome,
      last_name: sobrenome.join(' ') || nome,
      ...(tel.length >= 10 ? { phone: { area_code: tel.slice(-11, -9) || tel.slice(0, 2), number: tel.slice(-9) } } : {}),
      ...(pedido.cliente_cpf ? { identification: { type: 'CPF', number: pedido.cliente_cpf } } : {}),
    },
    items: itens,
    config: {
      statement_descriptor: 'DFR3D',
      online: {
        success_url: `${config.baseUrl}/pedido/${pedido.codigo}`,
        pending_url: `${config.baseUrl}/pedido/${pedido.codigo}`,
        failure_url: `${config.baseUrl}/pedido/${pedido.codigo}`,
        auto_return: 'approved',
      },
    },
  };

  const ord = await mpFetch('/v1/orders', {
    method: 'POST',
    body: JSON.stringify(corpo),
    headers: { 'X-Idempotency-Key': `${pedido.codigo}-${pedido.total_cents}-${Date.now()}` },
  });
  return { preferenceId: ord.id, link: ord.checkout_url };
}

export async function buscarPagamento(paymentId) {
  return mpFetch(`/v1/payments/${encodeURIComponent(paymentId)}`);
}

export async function buscarOrdem(orderId) {
  return mpFetch(`/v1/orders/${encodeURIComponent(orderId)}`);
}

/** Converte o status do Mercado Pago no status do pedido da loja. */
export function statusDoPagamento(mpStatus) {
  if (mpStatus === 'approved') return 'pago';
  if (['cancelled', 'refunded', 'charged_back'].includes(mpStatus)) return 'cancelado';
  return null; // pending, in_process, rejected: continua aguardando
}

/** Converte o status da Orders API do Mercado Pago no status do pedido da loja. */
export function statusDaOrdem(orderStatus) {
  if (orderStatus === 'processed') return 'pago';
  if (['canceled', 'cancelled', 'expired', 'refunded'].includes(orderStatus)) return 'cancelado';
  return null;
}

/** Valida a assinatura x-signature do webhook (se MP_WEBHOOK_SECRET estiver definido). */
export function assinaturaValida(req, dataId) {
  if (!config.mp.webhookSecret) return true;
  const header = req.headers['x-signature'] || '';
  const requestId = req.headers['x-request-id'] || '';
  const partes = Object.fromEntries(header.split(',').map((p) => p.trim().split('=')));
  if (!partes.ts || !partes.v1) return false;
  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  const manifesto = `id:${id};request-id:${requestId};ts:${partes.ts};`;
  const esperado = crypto.createHmac('sha256', config.mp.webhookSecret).update(manifesto).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(partes.v1));
  } catch { return false; }
}
