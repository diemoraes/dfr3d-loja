// Busca e ordenação do catálogo (sem diferenciar acentos e maiúsculas: "geometrico" acha "Geométrico")
import { db, produtoPublico, ranking } from './db.js';

export const normalizar = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * @param {{busca?, categoria?, promo?, destaque?, ordem?: 'relevancia'|'vendidos'|'menor'|'maior'|'novos'|'promo'}} f
 */
export function filtrarProdutos(f = {}) {
  const vendas = ranking();
  let lista = db.prepare('SELECT * FROM produtos WHERE ativo = 1').all().map((p) => ({ linha: p, pub: produtoPublico(p, vendas[p.id] || 0) }));
  if (f.categoria) lista = lista.filter((x) => x.pub.categoria === f.categoria);
  if (f.promo) lista = lista.filter((x) => x.pub.promo_pct > 0);
  if (f.destaque) lista = lista.filter((x) => x.pub.destaque);

  const termos = normalizar(f.busca).split(' ').filter((t) => t.length > 0);
  if (termos.length) {
    lista = lista.map((x) => {
      const nome = normalizar(x.pub.nome), cat = normalizar(x.pub.categoria);
      const resto = normalizar([x.pub.descricao, x.pub.cores.join(' '), x.pub.variacoes.map((v) => v.nome).join(' ')].join(' '));
      let pontos = 0;
      for (const t of termos) {
        if (nome.split(' ').some((w) => w.startsWith(t))) pontos += 10;
        else if (nome.includes(t)) pontos += 6;
        else if (cat.includes(t)) pontos += 4;
        else if (resto.includes(t)) pontos += 2;
        else return null; // todas as palavras precisam aparecer
      }
      return { ...x, pontos };
    }).filter(Boolean);
  }

  const porDisponivel = (a, b) => Number(b.pub.disponivel) - Number(a.pub.disponivel);
  const ordens = {
    relevancia: (a, b) => porDisponivel(a, b) || (b.pontos || 0) - (a.pontos || 0) || Number(b.pub.destaque) - Number(a.pub.destaque) || b.pub.vendidos - a.pub.vendidos || b.pub.id - a.pub.id,
    vendidos: (a, b) => porDisponivel(a, b) || b.pub.vendidos - a.pub.vendidos || b.pub.id - a.pub.id,
    menor: (a, b) => porDisponivel(a, b) || a.pub.preco_cents - b.pub.preco_cents,
    maior: (a, b) => porDisponivel(a, b) || b.pub.preco_cents - a.pub.preco_cents,
    novos: (a, b) => b.pub.id - a.pub.id,
    promo: (a, b) => porDisponivel(a, b) || b.pub.promo_pct - a.pub.promo_pct,
  };
  return lista.sort(ordens[f.ordem] || ordens.relevancia).map((x) => x.pub);
}
