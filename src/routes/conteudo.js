// Conteúdo editável: blog, menu de categorias, página inicial e perguntas frequentes
import { db, lerJson, lerAjuste, salvarAjuste } from '../db.js';
import { sendJson, readJson, HttpError, limpar, exigir, slugify } from '../http.js';
import { exigirAdmin } from '../auth.js';
import { salvarImagem, apagarImagem } from '../uploads.js';
import { postPublico, postsPublicados, markdownParaHtml } from '../blog.js';

// Padrões da DFR 3D (editáveis no painel → Página inicial)
export const MENU_PADRAO = [
  { nome: 'Decoração', subtitulo: 'Vasos, luminárias, quadros' },
  { nome: 'Presentes', subtitulo: 'Para todas as datas' },
  { nome: 'Personalizados', subtitulo: 'Com nome, logo ou foto' },
  { nome: 'Geek e Games', subtitulo: 'Suportes, colecionáveis' },
  { nome: 'Utilidades', subtitulo: 'Organização e casa' },
  { nome: 'Chaveiros', subtitulo: 'Brindes e lembranças' },
  { nome: 'Natal', subtitulo: 'Decoração e presentes' },
];
export const FAQ_PADRAO = [
  { p: 'Quanto tempo leva para a peça ficar pronta?', r: 'Cada produto mostra o prazo de produção na página. Em geral, peças da loja ficam prontas em 1 a 3 dias úteis; encomendas personalizadas têm o prazo combinado no orçamento.' },
  { p: 'Vocês fazem peças sob medida?', r: 'Sim! Envie o arquivo (STL, 3MF, OBJ), um link ou uma foto pela página Sob encomenda e respondemos com valor e prazo pelo WhatsApp.' },
  { p: 'Qual material vocês usam?', r: 'Trabalhamos principalmente com PLA e PETG, em várias cores e acabamentos. Para peças que vão ao sol ou precisam de resistência, indicamos o material ideal.' },
  { p: 'Como funciona o pagamento?', r: 'Pelo Mercado Pago: Pix com desconto, cartão em até 12x ou boleto. A produção começa assim que o pagamento é confirmado.' },
  { p: 'Vocês entregam para todo o Brasil?', r: 'Sim, enviamos pelos Correios e transportadoras com rastreio. Em São José dos Campos você também pode retirar sem custo.' },
  { p: 'E se a peça chegar com defeito?', r: 'Fale com a gente com fotos: refazemos, trocamos ou devolvemos o valor. Veja a política de trocas.' },
];
export const HOME_PADRAO = {
  etiqueta: 'Impressão 3D em São José dos Campos',
  titulo: 'Sua ideia,|camada por camada.',
  subtitulo: 'Peças, presentes e decoração impressos em 3D com acabamento caprichado. Escolha um produto da loja ou mande seu projeto e a gente faz o orçamento.',
  produto_destaque: '', // slug do produto do banner (vazio = logo)
  selos: [
    { titulo: 'Pix com desconto', texto: 'ou até 12x no cartão' },
    { titulo: 'Envio para todo o Brasil', texto: 'Correios e transportadoras' },
    { titulo: 'Retirada grátis', texto: 'em São José dos Campos' },
    { titulo: 'Sob medida', texto: 'mande o STL, foto ou ideia' },
  ],
};

export function dadosSite() {
  return {
    menu: lerAjuste('menu_categorias', MENU_PADRAO),
    faq: lerAjuste('faq', FAQ_PADRAO),
    home: { ...HOME_PADRAO, ...lerAjuste('home', {}) },
  };
}

function slugPostUnico(base, ignorar = 0) {
  let slug = slugify(base), n = 2;
  while (db.prepare('SELECT 1 FROM posts WHERE slug = ? AND id != ?').get(slug, ignorar)) slug = `${slugify(base)}-${n++}`;
  return slug;
}

export function rotasConteudo(r) {
  // ---------- Público ----------
  r.get('/api/site', (req, res) => sendJson(res, 200, dadosSite()));

  r.get('/api/blog', (req, res, { query }) => {
    const categoria = limpar(query.get('categoria'), 60);
    const categorias = db.prepare("SELECT DISTINCT categoria FROM posts WHERE publicado = 1 AND categoria != '' ORDER BY categoria").all().map((c) => c.categoria);
    sendJson(res, 200, { posts: postsPublicados(60, categoria), categorias });
  });

  r.get('/api/blog/:slug', (req, res, { params }) => {
    const p = db.prepare('SELECT * FROM posts WHERE slug = ? AND publicado = 1').get(params.slug);
    if (!p) throw new HttpError(404, 'Post não encontrado.');
    const outros = postsPublicados(4).filter((x) => x.slug !== p.slug).slice(0, 3);
    sendJson(res, 200, { ...postPublico(p, { completo: true }), outros });
  });

  // ---------- Painel: blog ----------
  const dadosPost = (b) => {
    const titulo = limpar(b.titulo, 160);
    exigir(titulo, 'Informe o título.');
    const produtos = (Array.isArray(b.produtos) ? b.produtos : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 8);
    return { titulo, resumo: limpar(b.resumo, 300), conteudo: limpar(b.conteudo, 60000), categoria: limpar(b.categoria, 60), produtos: JSON.stringify(produtos), publicado: b.publicado ? 1 : 0 };
  };

  r.get('/api/admin/posts', (req, res) => {
    exigirAdmin(req);
    sendJson(res, 200, db.prepare('SELECT * FROM posts ORDER BY id DESC').all().map((p) => ({ ...p, produtos: lerJson(p.produtos), capa_url: p.capa ? `/uploads/${p.capa}` : '' })));
  });

  r.post('/api/admin/posts', async (req, res) => {
    exigirAdmin(req);
    const d = dadosPost(await readJson(req));
    const info = db.prepare(`INSERT INTO posts (slug, titulo, resumo, conteudo, categoria, produtos, publicado, publicado_em) VALUES (?,?,?,?,?,?,?,?)`)
      .run(slugPostUnico(d.titulo), d.titulo, d.resumo, d.conteudo, d.categoria, d.produtos, d.publicado, d.publicado ? new Date().toISOString().slice(0, 10) : '');
    sendJson(res, 201, db.prepare('SELECT * FROM posts WHERE id = ?').get(info.lastInsertRowid));
  });

  r.put('/api/admin/posts/:id', async (req, res, { params }) => {
    exigirAdmin(req);
    const atual = db.prepare('SELECT * FROM posts WHERE id = ?').get(Number(params.id));
    if (!atual) throw new HttpError(404, 'Post não encontrado.');
    const d = dadosPost(await readJson(req));
    const slug = d.titulo === atual.titulo ? atual.slug : slugPostUnico(d.titulo, atual.id);
    const publicadoEm = d.publicado && !atual.publicado_em ? new Date().toISOString().slice(0, 10) : atual.publicado_em;
    db.prepare("UPDATE posts SET slug=?, titulo=?, resumo=?, conteudo=?, categoria=?, produtos=?, publicado=?, publicado_em=?, atualizado_em=datetime('now','localtime') WHERE id=?")
      .run(slug, d.titulo, d.resumo, d.conteudo, d.categoria, d.produtos, d.publicado, publicadoEm, atual.id);
    sendJson(res, 200, db.prepare('SELECT * FROM posts WHERE id = ?').get(atual.id));
  });

  r.delete('/api/admin/posts/:id', (req, res, { params }) => {
    exigirAdmin(req);
    const p = db.prepare('SELECT capa FROM posts WHERE id = ?').get(Number(params.id));
    if (p?.capa) apagarImagem(p.capa);
    db.prepare('DELETE FROM posts WHERE id = ?').run(Number(params.id));
    sendJson(res, 200, { ok: true });
  });

  r.post('/api/admin/posts/:id/capa', async (req, res, { params }) => {
    exigirAdmin(req);
    const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(Number(params.id));
    if (!p) throw new HttpError(404, 'Post não encontrado.');
    const nome = salvarImagem((await readJson(req, 8 * 1024 * 1024)).dados);
    if (p.capa) apagarImagem(p.capa);
    db.prepare('UPDATE posts SET capa = ? WHERE id = ?').run(nome, p.id);
    sendJson(res, 200, { capa_url: `/uploads/${nome}` });
  });

  // Foto para usar dentro do texto do post: devolve o Markdown pronto
  r.post('/api/admin/imagens', async (req, res) => {
    exigirAdmin(req);
    const nome = salvarImagem((await readJson(req, 8 * 1024 * 1024)).dados);
    sendJson(res, 201, { url: `/uploads/${nome}`, markdown: `![](/uploads/${nome})` });
  });

  r.post('/api/admin/previa-markdown', async (req, res) => {
    exigirAdmin(req);
    sendJson(res, 200, { html: markdownParaHtml((await readJson(req)).conteudo) });
  });

  // ---------- Painel: página inicial, menu e FAQ ----------
  r.get('/api/admin/site', (req, res) => { exigirAdmin(req); sendJson(res, 200, dadosSite()); });
  r.put('/api/admin/site', async (req, res) => {
    exigirAdmin(req);
    const b = await readJson(req);
    if (Array.isArray(b.menu)) {
      salvarAjuste('menu_categorias', b.menu.map((m) => ({ nome: limpar(m.nome, 40), subtitulo: limpar(m.subtitulo, 60) })).filter((m) => m.nome).slice(0, 12));
    }
    if (Array.isArray(b.faq)) {
      salvarAjuste('faq', b.faq.map((f) => ({ p: limpar(f.p, 200), r: limpar(f.r, 1500) })).filter((f) => f.p && f.r).slice(0, 20));
    }
    if (b.home) {
      const h = b.home;
      salvarAjuste('home', {
        etiqueta: limpar(h.etiqueta, 60), titulo: limpar(h.titulo, 120), subtitulo: limpar(h.subtitulo, 300), produto_destaque: limpar(h.produto_destaque, 120),
        selos: (Array.isArray(h.selos) ? h.selos : []).map((s) => ({ titulo: limpar(s.titulo, 40), texto: limpar(s.texto, 60) })).filter((s) => s.titulo).slice(0, 4),
      });
    }
    sendJson(res, 200, dadosSite());
  });
}
