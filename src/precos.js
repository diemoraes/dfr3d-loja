// Cálculo do carrinho no servidor: itens, variações, cupom, desconto no Pix e frete
import { config } from './config.js';
import { db, lerJson, promoAtiva, aplicarPromo } from './db.js';
import { HttpError, exigir, limpar } from './http.js';

/** Valida os itens que vieram do navegador. O preço SEMPRE vem do banco. */
export function carregarItens(itensCliente) {
  exigir(Array.isArray(itensCliente) && itensCliente.length > 0, 'Seu carrinho está vazio.');
  exigir(itensCliente.length <= 50, 'Carrinho com itens demais.');
  const totaisPorProduto = {};
  const itens = itensCliente.map((i) => {
    const produto = db.prepare('SELECT * FROM produtos WHERE id = ? AND ativo = 1').get(Number(i.produto_id));
    if (!produto) throw new HttpError(400, 'Um dos produtos do carrinho não está mais à venda. Remova-o e tente de novo.');
    const quantidade = Math.floor(Number(i.quantidade));
    exigir(quantidade >= 1 && quantidade <= 100, `Quantidade inválida para ${produto.nome}.`);

    const cores = produto.cores ? produto.cores.split(',').map((c) => c.trim()).filter(Boolean) : [];
    const cor = limpar(i.cor, 40);
    if (cores.length) exigir(cores.includes(cor), `Escolha a cor de ${produto.nome}.`);

    const variacoes = lerJson(produto.variacoes);
    const pct = promoAtiva(produto);
    let preco = aplicarPromo(produto.preco_cents, pct);
    let variacao = '';
    if (variacoes.length) {
      const v = variacoes.find((x) => x.nome === limpar(i.variacao, 60));
      exigir(v, `Escolha ${(produto.variacao_rotulo || 'a opção').toLowerCase()} de ${produto.nome}.`);
      preco = aplicarPromo(v.preco_cents, pct);
      variacao = v.nome;
    }

    let personalizacao = '';
    if (produto.personalizacao) {
      personalizacao = limpar(i.personalizacao, produto.personalizacao_max || 20);
      exigir(personalizacao, `Preencha "${produto.personalizacao}" de ${produto.nome}.`);
    }

    totaisPorProduto[produto.id] = (totaisPorProduto[produto.id] || 0) + quantidade;
    if (produto.estoque !== null && produto.estoque < totaisPorProduto[produto.id]) {
      throw new HttpError(400, produto.estoque > 0 ? `Só temos ${produto.estoque} unidade(s) de ${produto.nome}.` : `${produto.nome} esgotou.`);
    }
    return { produto, quantidade, cor, variacao, personalizacao, preco_cents: preco };
  });
  return itens;
}

export function subtotalDe(itens) {
  return itens.reduce((s, i) => s + i.preco_cents * i.quantidade, 0);
}

/** Procura e valida um cupom. Retorna null se não informado; lança erro se inválido. */
export function validarCupom(codigo, subtotal) {
  codigo = limpar(codigo, 40).toUpperCase();
  if (!codigo) return null;
  const c = db.prepare('SELECT * FROM cupons WHERE codigo = ? AND ativo = 1').get(codigo);
  if (!c) throw new HttpError(400, 'Cupom não encontrado.');
  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  if (c.validade && c.validade < hoje) throw new HttpError(400, 'Este cupom expirou.');
  if (c.usos_max !== null && c.usos >= c.usos_max) throw new HttpError(400, 'Este cupom já atingiu o limite de usos.');
  if (subtotal < (c.minimo_cents || 0)) {
    throw new HttpError(400, `Este cupom vale para compras a partir de ${(c.minimo_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`);
  }
  return c;
}

export function descricaoCupom(c) {
  if (!c) return '';
  if (c.tipo === 'pct') return `${c.valor}% de desconto`;
  if (c.tipo === 'valor') return `${(c.valor / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} de desconto`;
  return 'Frete grátis';
}

/**
 * Monta o resumo final. Ordem: subtotal → cupom → desconto Pix (sobre os produtos) → + frete.
 * @param {{itens, cupom, formaPagamento, freteCents}} p
 */
export function calcularTotais({ itens, cupom, formaPagamento, freteCents = 0 }) {
  const subtotal = subtotalDe(itens);
  let descontoCupom = 0;
  let frete = freteCents;
  if (cupom?.tipo === 'pct') descontoCupom = Math.round(subtotal * Math.min(cupom.valor, 100) / 100);
  if (cupom?.tipo === 'valor') descontoCupom = Math.min(cupom.valor, subtotal);
  if (cupom?.tipo === 'frete') frete = 0;
  const base = subtotal - descontoCupom;
  const descontoPix = formaPagamento === 'pix' ? Math.round(base * config.pixDescontoPct / 100) : 0;
  const desconto = descontoCupom + descontoPix;
  return {
    subtotal_cents: subtotal,
    desconto_cupom_cents: descontoCupom,
    desconto_pix_cents: descontoPix,
    desconto_cents: desconto,
    frete_cents: frete,
    total_cents: Math.max(subtotal - desconto + frete, 0),
  };
}
