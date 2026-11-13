// Blog: posts em Markdown simples, convertidos para HTML com segurança (sem HTML livre)
import { db, lerJson, produtoPublico } from './db.js';
import { normalizar } from './catalogo.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const urlSegura = (u) => (/^(https?:\/\/|\/)[^\s"'<>]*$/i.test(u) && !/^\/\//.test(u) ? u : '#');

/** Formatação dentro da linha: **negrito**, *itálico*, `código`, [link](url), ![imagem](url). */
function inline(t) {
  let s = esc(t);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, u) => `<img src="${urlSegura(u)}" alt="${alt}" loading="lazy">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, txt, u) => {
    const url = urlSegura(u);
    const externo = /^https?:/i.test(url);
    return `<a href="${url}"${externo ? ' target="_blank" rel="noopener nofollow"' : ''}>${txt}</a>`;
  });
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1<em>$2</em>').replace(/`([^`]+)`/g, '<code>$1</code>');
  return s;
}

/** Markdown → HTML: # títulos, parágrafos, listas (- e 1.), > citações, --- linha, imagens. */
export function markdownParaHtml(md) {
  const linhas = String(md || '').replace(/\r/g, '').split('\n');
  const out = [];
  let lista = null, para = [];
  const fecharPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  const fecharLista = () => { if (lista) { out.push(`<${lista.tipo}>${lista.itens.map((i) => `<li>${inline(i)}</li>`).join('')}</${lista.tipo}>`); lista = null; } };
  for (const bruta of linhas) {
    const l = bruta.trimEnd();
    let m;
    if (!l.trim()) { fecharPara(); fecharLista(); continue; }
    if ((m = /^(#{1,3})\s+(.+)/.exec(l))) { fecharPara(); fecharLista(); const n = m[1].length === 3 ? 3 : 2; out.push(`<h${n}>${inline(m[2])}</h${n}>`); continue; }
    if (/^---+$/.test(l)) { fecharPara(); fecharLista(); out.push('<hr>'); continue; }
    if ((m = /^>\s?(.*)/.exec(l))) { fecharPara(); fecharLista(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
    if ((m = /^\s*[-*]\s+(.+)/.exec(l))) { fecharPara(); if (lista?.tipo !== 'ul') { fecharLista(); lista = { tipo: 'ul', itens: [] }; } lista.itens.push(m[1]); continue; }
    if ((m = /^\s*\d+[.)]\s+(.+)/.exec(l))) { fecharPara(); if (lista?.tipo !== 'ol') { fecharLista(); lista = { tipo: 'ol', itens: [] }; } lista.itens.push(m[1]); continue; }
    if (/^!\[[^\]]*\]\([^)]+\)$/.test(l.trim())) { fecharPara(); fecharLista(); out.push(`<figure>${inline(l.trim())}</figure>`); continue; }
    fecharLista();
    para.push(l);
  }
  fecharPara(); fecharLista();
  return out.join('\n');
}

export const tempoLeitura = (md) => Math.max(1, Math.round(String(md || '').split(/\s+/).length / 200));

export function postPublico(p, { completo = false } = {}) {
  const base = {
    slug: p.slug, titulo: p.titulo, resumo: p.resumo || String(p.conteudo).replace(/[#*_>`!\[\]()-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 180),
    capa: p.capa ? `/uploads/${p.capa}` : '', categoria: p.categoria, publicado_em: p.publicado_em, leitura_min: tempoLeitura(p.conteudo),
  };
  if (!completo) return base;
  const ids = lerJson(p.produtos);
  const produtos = ids.length ? db.prepare(`SELECT * FROM produtos WHERE ativo = 1 AND id IN (${ids.map(() => '?').join(',')})`).all(...ids).map((x) => produtoPublico(x)) : [];
  return { ...base, html: markdownParaHtml(p.conteudo), produtos };
}

export function postsPublicados(limite = 50, categoria = '') {
  const args = [];
  let sql = 'SELECT * FROM posts WHERE publicado = 1';
  if (categoria) { sql += ' AND categoria = ?'; args.push(categoria); }
  sql += ' ORDER BY publicado_em DESC, id DESC LIMIT ?';
  args.push(limite);
  return db.prepare(sql).all(...args).map((p) => postPublico(p));
}

export function buscarPosts(q) {
  const termos = normalizar(q).split(' ').filter(Boolean);
  if (!termos.length) return [];
  return db.prepare('SELECT * FROM posts WHERE publicado = 1 ORDER BY publicado_em DESC LIMIT 200').all()
    .filter((p) => { const t = normalizar(`${p.titulo} ${p.resumo} ${p.conteudo} ${p.categoria}`); return termos.every((x) => t.includes(x)); })
    .map((p) => postPublico(p));
}
