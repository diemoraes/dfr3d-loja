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

/** Cria a preferência de pagamento e devolve o link para o cliente pagar. */
export async function criarPagamento(pedido) {
  const lista = JSON.parse(pedido.itens);
  const titulo = (i) => [i.nome, i.variacao, i.cor].filter(Boolean).join(' - ').slice(0, 250);
  let itens;
  if (pedido.desconto_cents > 0) {
    // O Checkout Pro não aceita linha de desconto: envia um item único com o total já descontado
    const resumo = lista.map((i) => `${i.quantidade}x ${titulo(i)}`).join(', ');
    itens = [{ id: pedido.codigo, title: `Pedido ${pedido.codigo} - DFR 3D`, description: resumo.slice(0, 250), quantity: 1, unit_price: pedido.total_cents / 100, currency_id: 'BRL' }];
  } else {
    itens = lista.map((i, idx) => ({
      id: String(i.produto_id ?? `item-${idx + 1}`), title: titulo(i), quantity: i.quantidade, unit_price: i.preco_cents / 100, currency_id: 'BRL',
    }));
    if (pedido.frete_cents > 0) {
      itens.push({ id: 'frete', title: `Frete - ${pedido.entrega_servico}`, quantity: 1, unit_price: pedido.frete_cents / 100, currency_id: 'BRL' });
    }
  }
  // Pagamento com desconto no Pix: o link só aceita Pix
  const metodos = pedido.forma_pagamento === 'pix'
    ? { excluded_payment_types: [{ id: 'credit_card' }, { id: 'debit_card' }, { id: 'ticket' }, { id: 'prepaid_card' }], installments: 1 }
    : { installments: 12 };
  const [nome, ...sobrenome] = pedido.cliente_nome.split(' ');
  const tel = pedido.cliente_telefone.replace(/\D/g, '');
  const corpo = {
    items: itens,
    external_reference: pedido.codigo,
    statement_descriptor: 'DFR3D',
    payer: {
      name: nome,
      surname: sobrenome.join(' '),
      email: pedido.cliente_email,
      ...(tel.length >= 10 ? { phone: { area_code: tel.slice(-11, -9) || tel.slice(0, 2), number: tel.slice(-9) } } : {}),
      ...(pedido.cliente_cpf ? { identification: { type: 'CPF', number: pedido.cliente_cpf } } : {}),
    },
    back_urls: {
      success: `${config.baseUrl}/pedido/${pedido.codigo}`,
      pending: `${config.baseUrl}/pedido/${pedido.codigo}`,
      failure: `${config.baseUrl}/pedido/${pedido.codigo}`,
    },
    auto_return: 'approved',
    payment_methods: metodos,
    expires: true,
    expiration_date_to: new Date(Date.now() + config.pedidoExpiraHoras * 3600 * 1000).toISOString(),
  };
  // O Mercado Pago só aceita notification_url pública (https)
  if (config.baseUrl.startsWith('https://')) corpo.notification_url = `${config.baseUrl}/api/webhooks/mercadopago`;

  const pref = await mpFetch('/checkout/preferences', {
    method: 'POST',
    body: JSON.stringify(corpo),
    headers: { 'X-Idempotency-Key': `${pedido.codigo}-${pedido.total_cents}-${Date.now()}` },
  });
  return { preferenceId: pref.id, link: pref.init_point };
}

export async function buscarPagamento(paymentId) {
  return mpFetch(`/v1/payments/${encodeURIComponent(paymentId)}`);
}

/** Converte o status do Mercado Pago no status do pedido da loja. */
export function statusDoPagamento(mpStatus) {
  if (mpStatus === 'approved') return 'pago';
  if (['cancelled', 'refunded', 'charged_back'].includes(mpStatus)) return 'cancelado';
  return null; // pending, in_process, rejected: continua aguardando
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
