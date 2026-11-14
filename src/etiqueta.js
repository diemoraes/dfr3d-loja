// Etiquetas do Melhor Envio: compra o frete com o saldo da sua conta, gera e imprime a etiqueta
// Permissões do token: cart-read, cart-write, shipping-calculate, shipping-checkout,
// shipping-generate, shipping-print, shipping-tracking, orders-read
import { config } from './config.js';
import { db, lerJson, atualizarStatusPedido, dataHoraLocal } from './db.js';
import { apiMelhorEnvio } from './frete.js';
import { HttpError } from './http.js';

export const etiquetaAtiva = () => Boolean(config.melhorEnvio.token && config.cepOrigem && config.remetente.endereco && config.remetente.documento);

async function me(caminho, corpo) {
  const res = await fetch(`${apiMelhorEnvio()}${caminho}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json', 'Content-Type': 'application/json',
      Authorization: `Bearer ${config.melhorEnvio.token}`,
      'User-Agent': `DFR 3D Loja (${config.melhorEnvio.email})`,
    },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(30000),
  });
  const dados = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('Melhor Envio', caminho, res.status, JSON.stringify(dados));
    const detalhe = dados.message || dados.error || Object.values(dados.errors || {}).flat().join(' ') || `erro ${res.status}`;
    throw new HttpError(502, `Melhor Envio: ${detalhe}`);
  }
  return dados;
}

/** Calcula uma caixa única para o pedido: maior largura/comprimento, alturas somadas, pesos somados. */
function volumeDoPedido(itens) {
  let largura = 1, comprimento = 1, altura = 0, peso = 0;
  for (const i of itens) {
    const p = i.produto_id ? db.prepare('SELECT * FROM produtos WHERE id = ?').get(i.produto_id) : null;
    const d = p || { largura_cm: 15, comprimento_cm: 15, altura_cm: 10, peso_g: 300 };
    largura = Math.max(largura, d.largura_cm);
    comprimento = Math.max(comprimento, d.comprimento_cm);
    altura += d.altura_cm * i.quantidade;
    peso += d.peso_g * i.quantidade;
  }
  return { largura, comprimento, altura: Math.max(Math.min(altura, 100), 2), peso_g: Math.max(peso, 50) };
}

/**
 * Compra e gera a etiqueta de um pedido.
 * @param {object} pedido linha do banco
 * @param {{servico?: string|number, volume?: {largura, altura, comprimento, peso_g}}} opcoes
 */
export async function gerarEtiqueta(pedido, opcoes = {}) {
  if (!etiquetaAtiva()) throw new HttpError(400, 'Configure MELHOR_ENVIO_TOKEN, CEP_ORIGEM e os dados REMETENTE_* para gerar etiquetas.');
  if (pedido.entrega_tipo !== 'envio') throw new HttpError(400, 'Este pedido é para retirada.');
  if (!['pago', 'em_producao', 'pronto_retirada', 'enviado'].includes(pedido.status)) throw new HttpError(400, 'Só dá para gerar etiqueta de pedido pago.');
  if (pedido.me_order_id && pedido.etiqueta_url) return { me_order_id: pedido.me_order_id, url: pedido.etiqueta_url };
  const servico = Number(opcoes.servico || String(pedido.entrega_servico_id).replace(/^me-/, ''));
  if (!servico) throw new HttpError(400, 'Escolha o serviço de envio (ex.: 1 = PAC, 2 = SEDEX).');
  const cpf = (pedido.cliente_cpf || '').replace(/\D/g, '');
  if (cpf.length !== 11) throw new HttpError(400, 'O cliente precisa ter CPF no pedido para a declaração de conteúdo. Peça pelo WhatsApp e salve nas anotações → edite o pedido.');

  const itens = lerJson(pedido.itens);
  const v = { ...volumeDoPedido(itens), ...(opcoes.volume || {}) };
  const r = config.remetente;
  const valorProdutos = (pedido.total_cents - pedido.frete_cents) / 100;

  let meId = pedido.me_order_id;
  if (!meId) {
    const carrinho = await me('/api/v2/me/cart', {
      service: servico,
      from: { name: r.nome, phone: r.telefone, email: r.email, document: r.documento.length === 11 ? r.documento : undefined,
        company_document: r.documento.length === 14 ? r.documento : undefined,
        address: r.endereco, complement: r.complemento, number: r.numero, district: r.bairro, city: r.cidade, state_abbr: r.uf, country_id: 'BR', postal_code: config.cepOrigem },
      to: { name: pedido.cliente_nome, phone: pedido.cliente_telefone, email: pedido.cliente_email, document: cpf,
        address: pedido.endereco, complement: pedido.complemento, number: pedido.numero, district: pedido.bairro, city: pedido.cidade, state_abbr: pedido.uf, country_id: 'BR', postal_code: pedido.cep },
      products: itens.map((i) => ({ name: [i.nome, i.variacao, i.cor].filter(Boolean).join(' - ').slice(0, 100), quantity: i.quantidade, unitary_value: i.preco_cents / 100 })),
      volumes: [{ height: v.altura, width: v.largura, length: v.comprimento, weight: v.peso_g / 1000 }],
      options: { insurance_value: valorProdutos, receipt: false, own_hand: false, reverse: false, non_commercial: true, platform: 'DFR 3D Loja', tags: [{ tag: pedido.codigo, url: `${config.baseUrl}/pedido/${pedido.codigo}` }] },
    });
    meId = carrinho.id;
    db.prepare('UPDATE pedidos SET me_order_id = ? WHERE id = ?').run(meId, pedido.id);
  }
  await me('/api/v2/me/shipment/checkout', { orders: [meId] });  // paga com o saldo da carteira Melhor Envio
  await me('/api/v2/me/shipment/generate', { orders: [meId] });
  const imp = await me('/api/v2/me/shipment/print', { mode: 'private', orders: [meId] });
  db.prepare('UPDATE pedidos SET etiqueta_url = ? WHERE id = ?').run(imp.url || '', pedido.id);
  return { me_order_id: meId, url: imp.url };
}

export const STATUS_ENVIO = {
  pending: 'Etiqueta criada', released: 'Etiqueta paga', generated: 'Etiqueta gerada', posted: 'Postado — em trânsito',
  delivered: 'Entregue', undelivered: 'Não entregue — fale com a gente', canceled: 'Envio cancelado', expired: 'Etiqueta expirada',
};

/**
 * Consulta o Melhor Envio: salva o código de rastreio e a situação da entrega.
 * Se a transportadora confirmar a entrega, o pedido muda sozinho para "Entregue".
 */
export async function buscarRastreio(pedido) {
  if (!pedido.me_order_id) throw new HttpError(400, 'Este pedido ainda não tem etiqueta.');
  const r = await me('/api/v2/me/shipment/tracking', { orders: [pedido.me_order_id] });
  const info = r[pedido.me_order_id] || Object.values(r)[0] || {};
  const codigo = info.tracking || info.melhorenvio_tracking || pedido.rastreio || '';
  const status = info.status || '';
  db.prepare("UPDATE pedidos SET rastreio = ?, rastreio_status = ?, rastreio_verificado = datetime('now','localtime') WHERE id = ?").run(codigo, status, pedido.id);
  const atual = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedido.id);
  if (status === 'posted' && ['pago', 'em_producao', 'pronto_retirada'].includes(atual.status)) {
    atualizarStatusPedido(atual, 'enviado', 'Postado (confirmado pelo Melhor Envio)');
  } else if (status === 'delivered' && !['entregue', 'cancelado'].includes(atual.status)) {
    atualizarStatusPedido(atual, 'entregue', 'Entrega confirmada pela transportadora');
  }
  return { rastreio: codigo, status, status_nome: STATUS_ENVIO[status] || '' };
}

/** Atualiza o rastreio dos pedidos em trânsito (roda sozinho a cada poucas horas). */
export async function atualizarRastreios() {
  if (!config.melhorEnvio.token) return 0;
  const lista = db.prepare(`SELECT * FROM pedidos WHERE me_order_id != '' AND status IN ('pago','em_producao','enviado')
    AND (rastreio_verificado = '' OR rastreio_verificado <= ?) LIMIT 30`).all(dataHoraLocal(-3 * 3600_000));
  for (const p of lista) await buscarRastreio(p).catch((e) => console.error('Rastreio', p.codigo, e.message));
  return lista.length;
}
