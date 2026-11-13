// SEO: título, descrição, prévia de compartilhamento (WhatsApp/Instagram), dados estruturados para o Google e sitemap
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { db, produtoPublico, lerJson } from './db.js';
import { postPublico, postsPublicados } from './blog.js';
import { dadosSite } from './routes/conteudo.js';

const PUBLIC = path.join(ROOT, 'public');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jsonLd = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
const absoluta = (u) => (u.startsWith('http') ? u : config.baseUrl + u);

const cache = new Map();
function lerPagina(arquivo) {
  if (config.production && cache.has(arquivo)) return cache.get(arquivo);
  const html = fs.readFileSync(path.join(PUBLIC, arquivo), 'utf8');
  if (config.production) cache.set(arquivo, html);
  return html;
}

function metaBasica({ titulo, descricao, imagem = '/img/logo.png', url, tipo = 'website', extra = '' }) {
  return `
  <link rel="canonical" href="${esc(url)}">
  <meta property="og:site_name" content="${esc(config.loja.nome)}">
  <meta property="og:locale" content="pt_BR">
  <meta property="og:type" content="${tipo}">
  <meta property="og:title" content="${esc(titulo)}">
  ${descricao ? `<meta property="og:description" content="${esc(descricao)}">` : ''}
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:image" content="${esc(absoluta(imagem))}">
  <meta name="twitter:card" content="summary_large_image">
  ${extra}`;
}

const DADOS_LOJA = () => ({
  '@context': 'https://schema.org', '@type': 'Store', name: config.loja.nome, url: config.baseUrl, logo: `${config.baseUrl}/img/icone-512.png`,
  image: `${config.baseUrl}/img/logo.png`,
  ...(config.contato.whatsapp ? { telephone: `+${config.contato.whatsapp}` } : {}),
  ...(config.contato.email ? { email: config.contato.email } : {}),
  ...(config.contato.instagram ? { sameAs: [`https://instagram.com/${config.contato.instagram}`] } : {}),
  address: { '@type': 'PostalAddress', addressLocality: config.loja.cidadeForo.split('-')[0].trim(), addressCountry: 'BR' },
});

/**
 * Gera o HTML de uma página com as tags de SEO. Retorna { status, html }.
 * @param {string} arquivo ex.: 'produto.html'
 * @param {string} pathname caminho pedido
 */
export function renderizar(arquivo, pathname) {
  let html = lerPagina(arquivo);
  let status = 200;
  let head = '';
  const url = config.baseUrl + pathname.replace(/\/$/, '');

  if (arquivo === 'produto.html') {
    const slug = decodeURIComponent(pathname.split('/')[2] || '');
    const linha = db.prepare('SELECT * FROM produtos WHERE slug = ? AND ativo = 1').get(slug);
    if (!linha) {
      status = 404;
    } else {
      const p = produtoPublico(linha);
      const descricao = (p.descricao || `${p.nome} impresso em 3D pela ${config.loja.nome}.`).replace(/\s+/g, ' ').slice(0, 155);
      const titulo = `${p.nome} | ${config.loja.nome}`;
      const reviews = db.prepare('SELECT nome, nota, comentario, criado_em FROM avaliacoes WHERE produto_id = ? AND aprovada = 1 ORDER BY id DESC LIMIT 5').all(p.id);
      const preco = (p.preco_cents / 100).toFixed(2);
      head = metaBasica({ titulo, descricao, imagem: p.imagens[0] || '/img/logo.png', url, tipo: 'product',
        extra: `<meta property="product:price:amount" content="${preco}"><meta property="product:price:currency" content="BRL">` })
        + jsonLd({
          '@context': 'https://schema.org', '@type': 'Product', name: p.nome, description: p.descricao || descricao,
          image: p.imagens.length ? p.imagens.map(absoluta) : [`${config.baseUrl}/img/logo.png`], sku: `DFR-${p.id}`,
          brand: { '@type': 'Brand', name: config.loja.nome }, ...(p.categoria ? { category: p.categoria } : {}),
          offers: {
            '@type': p.variacoes.length ? 'AggregateOffer' : 'Offer', priceCurrency: 'BRL', url,
            ...(p.variacoes.length ? { lowPrice: preco, highPrice: (p.preco_max_cents / 100).toFixed(2), offerCount: p.variacoes.length } : { price: preco }),
            availability: p.disponivel ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
            seller: { '@type': 'Organization', name: config.loja.nome },
          },
          ...(p.avaliacao.quantidade ? {
            aggregateRating: { '@type': 'AggregateRating', ratingValue: p.avaliacao.media, reviewCount: p.avaliacao.quantidade, bestRating: 5, worstRating: 1 },
            review: reviews.map((r) => ({ '@type': 'Review', author: { '@type': 'Person', name: r.nome }, datePublished: r.criado_em.slice(0, 10),
              reviewRating: { '@type': 'Rating', ratingValue: r.nota, bestRating: 5 }, ...(r.comentario ? { reviewBody: r.comentario } : {}) })),
          } : {}),
        })
        + jsonLd({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Produtos', item: `${config.baseUrl}/produtos` },
          { '@type': 'ListItem', position: 2, name: p.nome, item: url }] });
      html = html.replace(/<title>.*?<\/title>/, `<title>${esc(titulo)}</title>\n  <meta name="description" content="${esc(descricao)}">`);
      // Conteúdo já no HTML (o JavaScript substitui depois): ajuda o Google e quem tem internet lenta
      html = html.replace('<div id="produto"><p class="carregando">Carregando…</p></div>',
        `<div id="produto"><div class="produto"><div class="galeria"><div class="principal">${p.imagens[0] ? `<img src="${esc(p.imagens[0])}" alt="${esc(p.nome)}">` : ''}</div></div>
        <div><h1>${esc(p.nome)}</h1><p class="preco-grande">${(p.preco_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p><div class="descricao">${esc(p.descricao)}</div></div></div></div>`);
    }
  } else if (arquivo === 'post.html') {
    const slug = decodeURIComponent(pathname.split('/')[2] || '');
    const linha = db.prepare('SELECT * FROM posts WHERE slug = ? AND publicado = 1').get(slug);
    if (!linha) {
      status = 404;
    } else {
      const p = postPublico(linha, { completo: true });
      const titulo = `${p.titulo} | Blog ${config.loja.nome}`;
      head = metaBasica({ titulo, descricao: p.resumo, imagem: p.capa || '/img/logo.png', url, tipo: 'article' })
        + jsonLd({ '@context': 'https://schema.org', '@type': 'BlogPosting', headline: p.titulo, description: p.resumo,
          image: p.capa ? absoluta(p.capa) : `${config.baseUrl}/img/logo.png`, datePublished: p.publicado_em, dateModified: linha.atualizado_em.slice(0, 10),
          author: { '@type': 'Organization', name: config.loja.nome }, publisher: { '@type': 'Organization', name: config.loja.nome, logo: { '@type': 'ImageObject', url: `${config.baseUrl}/img/icone-512.png` } },
          mainEntityOfPage: url });
      html = html.replace(/<title>.*?<\/title>/, `<title>${esc(titulo)}</title>\n  <meta name="description" content="${esc(p.resumo)}">`);
      html = html.replace('<article id="post"><p class="carregando">Carregando…</p></article>',
        `<article id="post"><h1>${esc(p.titulo)}</h1><div class="post-corpo">${p.html}</div></article>`);
    }
  } else {
    const titulo = (/<title>(.*?)<\/title>/.exec(html) || [])[1] || config.loja.nome;
    const descricao = (/<meta name="description" content="(.*?)">/.exec(html) || [])[1] || '';
    head = metaBasica({ titulo, descricao, url: pathname === '/' ? config.baseUrl + '/' : url });
    if (arquivo === 'index.html') {
      head += jsonLd(DADOS_LOJA());
      const faq = dadosSite().faq;
      if (faq.length) head += jsonLd({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.p, acceptedAnswer: { '@type': 'Answer', text: f.r } })) });
    }
    if (arquivo === 'blog.html') {
      const posts = postsPublicados(30);
      html = html.replace('<div class="grade-blog" id="posts"><p class="carregando">Carregando…</p></div>',
        `<div class="grade-blog" id="posts">${posts.map((p) => `<a class="card-post" href="/blog/${esc(p.slug)}"><div class="info"><h3>${esc(p.titulo)}</h3><p>${esc(p.resumo)}</p></div></a>`).join('')}</div>`);
    }
  }

  if (status === 200 && ['pedido.html', 'checkout.html', 'carrinho.html', 'conta.html', 'admin/index.html'].includes(arquivo)) {
    head += '\n  <meta name="robots" content="noindex">';
  }
  html = html.replace('</head>', `${head}\n</head>`);
  if (arquivo === 'politicas.html') html = preencherPoliticas(html);
  return { status, html };
}

function preencherPoliticas(html) {
  const l = config.loja;
  const contatos = [
    config.contato.whatsapp && `WhatsApp <a href="https://wa.me/${config.contato.whatsapp}">${esc(config.contato.whatsapp)}</a>`,
    config.contato.email && `<a href="mailto:${esc(config.contato.email)}">${esc(config.contato.email)}</a>`,
    config.contato.instagram && `Instagram <a href="https://instagram.com/${esc(config.contato.instagram)}">@${esc(config.contato.instagram)}</a>`,
  ].filter(Boolean).join(' · ') || 'pelo site';
  const valores = {
    LOJA_NOME: esc(l.nome),
    LOJA_RESPONSAVEL: l.responsavel ? ` — responsável: ${esc(l.responsavel)}` : '',
    LOJA_CIDADE: esc(l.cidade),
    CONTATOS: contatos,
    EXPIRA: String(config.pedidoExpiraHoras),
    FORO: esc(l.cidadeForo),
    DATA: new Date(lerDataPoliticas()).toLocaleDateString('pt-BR'),
  };
  return html.replace(/\{\{(\w+)\}\}/g, (m, k) => valores[k] ?? m);
}
function lerDataPoliticas() {
  try { return fs.statSync(path.join(PUBLIC, 'politicas.html')).mtime; } catch { return new Date(); }
}

export function sitemap() {
  const urls = [
    { loc: '/', prioridade: '1.0' }, { loc: '/produtos', prioridade: '0.9' }, { loc: '/encomenda', prioridade: '0.8' }, { loc: '/blog', prioridade: '0.7' }, { loc: '/politicas', prioridade: '0.3' },
    ...db.prepare('SELECT slug, capa FROM posts WHERE publicado = 1').all().map((p) => ({ loc: `/blog/${p.slug}`, prioridade: '0.6', imagens: p.capa ? [p.capa] : [] })),
    ...db.prepare('SELECT slug, imagens, criado_em FROM produtos WHERE ativo = 1 ORDER BY id DESC').all().map((p) => ({
      loc: `/produto/${p.slug}`, prioridade: '0.8', imagens: lerJson(p.imagens),
    })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.map((u) => `  <url><loc>${esc(config.baseUrl + u.loc)}</loc><priority>${u.prioridade}</priority>${(u.imagens || []).slice(0, 5).map((i) => `<image:image><image:loc>${esc(`${config.baseUrl}/uploads/${i}`)}</image:loc></image:image>`).join('')}</url>`).join('\n')}
</urlset>`;
}

export function robots() {
  return `User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /checkout\nDisallow: /carrinho\nDisallow: /pedido/\nSitemap: ${config.baseUrl}/sitemap.xml\n`;
}
