// Cálculo de frete: Melhor Envio (Correios, Jadlog, etc.), frete fixo e retirada no local
import { config } from './config.js';
import { HttpError } from './http.js';

export const apiMelhorEnvio = () => (config.melhorEnvio.sandbox ? 'https://sandbox.melhorenvio.com.br' : 'https://melhorenvio.com.br');

/**
 * Monta as opções de entrega para um carrinho.
 * @param {string} cep CEP de destino (8 dígitos)
 * @param {Array} itens [{produto, quantidade}] — produto vindo do banco
 * @returns {Promise<Array<{id, tipo, nome, preco_cents, prazo_dias, empresa}>>}
 */
export async function calcularOpcoes(cep, itens) {
  const subtotal = itens.reduce((s, i) => s + (i.preco_cents ?? i.produto.preco_cents) * i.quantidade, 0);
  const prazoProducao = Math.max(0, ...itens.map((i) => i.produto.prazo_dias || 0));
  const gratis = config.freteGratisAcimaCents !== null && subtotal >= config.freteGratisAcimaCents;
  const opcoes = [];

  if (config.retirada.ativa) {
    opcoes.push({ id: 'retirada', tipo: 'retirada', nome: 'Retirar no local', empresa: 'DFR 3D', preco_cents: 0, prazo_dias: prazoProducao, detalhe: config.retirada.endereco });
  }

  if (cep && config.melhorEnvio.token && config.cepOrigem) {
    try {
      const produtos = itens.map((i) => ({
        id: String(i.produto.id),
        width: i.produto.largura_cm,
        height: i.produto.altura_cm,
        length: i.produto.comprimento_cm,
        weight: Math.max(i.produto.peso_g, 10) / 1000,
        insurance_value: (i.preco_cents ?? i.produto.preco_cents) / 100,
        quantity: i.quantidade,
      }));
      const res = await fetch(`${apiMelhorEnvio()}/api/v2/me/shipment/calculate`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.melhorEnvio.token}`,
          'User-Agent': `DFR 3D Loja (${config.melhorEnvio.email})`,
        },
        body: JSON.stringify({ from: { postal_code: config.cepOrigem }, to: { postal_code: cep }, products: produtos }),
        signal: AbortSignal.timeout(15000),
      });
      const lista = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(lista));
      for (const s of lista) {
        if (s.error || !s.price) continue;
        if (config.melhorEnvio.servicos.length && !config.melhorEnvio.servicos.includes(String(s.id))) continue;
        const preco = Math.round(parseFloat(s.custom_price || s.price) * 100);
        opcoes.push({
          id: `me-${s.id}`,
          tipo: 'envio',
          nome: `${s.company?.name || ''} ${s.name}`.trim(),
          empresa: s.company?.name || '',
          preco_cents: gratis ? 0 : preco,
          prazo_dias: prazoProducao + Number(s.custom_delivery_time || s.delivery_time || 0),
        });
      }
    } catch (e) {
      console.error('Melhor Envio falhou:', e.message);
    }
  }

  // Sem Melhor Envio (ou se ele falhar), usa o frete fixo, se configurado
  if (cep && !opcoes.some((o) => o.tipo === 'envio') && config.freteFixoCents !== null) {
    opcoes.push({ id: 'fixo', tipo: 'envio', nome: 'Envio pelos Correios', empresa: 'Correios', preco_cents: gratis ? 0 : config.freteFixoCents, prazo_dias: prazoProducao + 7 });
  }

  return opcoes.sort((a, b) => (a.tipo === 'retirada' ? -1 : b.tipo === 'retirada' ? 1 : a.preco_cents - b.preco_cents));
}

/** Recalcula no servidor e confirma a opção escolhida (o cliente não consegue alterar o preço). */
export async function confirmarOpcao(cep, itens, opcaoId) {
  const opcoes = await calcularOpcoes(cep, itens);
  const escolhida = opcoes.find((o) => o.id === opcaoId);
  if (!escolhida) throw new HttpError(400, 'A opção de entrega escolhida não está mais disponível. Calcule o frete de novo.');
  return escolhida;
}
