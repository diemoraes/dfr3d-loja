// DFR 3D Impressão — servidor da loja virtual
// Rode com:  npm start   (Node.js 22.5 ou mais novo, sem dependências externas)
import http from 'node:http';
import path from 'node:path';
import { config, ROOT } from './src/config.js';
import './src/db.js';
import './src/notificacoes.js';   // e-mails e avisos no celular (escutam os eventos)
import './src/mercadolivre.js';   // sincronização de estoque com o ML
import { Router, HttpError, sendJson, serveFile } from './src/http.js';
import { rotasPublicas } from './src/routes/publico.js';
import { rotasAdmin } from './src/routes/admin.js';
import { rotasConta } from './src/clientes.js';
import { rotasConteudo } from './src/routes/conteudo.js';
import { rotasPerguntas } from './src/routes/perguntas.js';
import { renderizar, sitemap, robots } from './src/seo.js';
import { iniciarTarefas } from './src/tarefas.js';

const PUBLIC = path.join(ROOT, 'public');
const router = new Router();
rotasPublicas(router);
rotasAdmin(router);
rotasConta(router);
rotasConteudo(router);
rotasPerguntas(router);

// URLs amigáveis -> páginas HTML
const PAGINAS = [
  [/^\/$/, 'index.html'],
  [/^\/produtos\/?$/, 'produtos.html'],
  [/^\/produto\/[^/]+\/?$/, 'produto.html'],
  [/^\/carrinho\/?$/, 'carrinho.html'],
  [/^\/checkout\/?$/, 'checkout.html'],
  [/^\/pedido\/[^/]+\/?$/, 'pedido.html'],
  [/^\/encomenda\/?$/, 'encomenda.html'],
  [/^\/politicas\/?$/, 'politicas.html'],
  [/^\/conta\/?$/, 'conta.html'],
  [/^\/blog\/?$/, 'blog.html'],
  [/^\/blog\/[^/]+\/?$/, 'post.html'],
  [/^\/admin\/?$/, 'admin/index.html'],
];

const SEGURANCA = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function enviarHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(html);
}

const servidor = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SEGURANCA)) res.setHeader(k, v);
  if (config.baseUrl.startsWith('https')) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); return res.end(); }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }

  try {
    if (pathname.startsWith('/api/')) {
      // Proteção CSRF simples: chamadas que alteram dados precisam vir do próprio site
      if (req.method !== 'GET' && !pathname.startsWith('/api/webhooks/')) {
        const origem = req.headers.origin;
        if (origem && new URL(origem).host !== req.headers.host) throw new HttpError(403, 'Origem não permitida.');
      }
      const rota = router.match(req.method, pathname);
      if (!rota) throw new HttpError(404, 'Rota não encontrada.');
      return await rota.handler(req, res, { params: rota.params, query: url.searchParams });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Método não permitido.');

    if (pathname === '/sitemap.xml') {
      res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
      return res.end(sitemap());
    }
    if (pathname === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(robots());
    }

    if (pathname.startsWith('/uploads/')) {
      if (serveFile(req, res, config.uploadsDir, pathname.slice('/uploads/'.length), { cache: 'public, max-age=2592000, immutable' })) return;
      throw new HttpError(404, 'Imagem não encontrada.');
    }

    const pagina = PAGINAS.find(([re]) => re.test(pathname));
    if (pagina) {
      const { status, html } = renderizar(pagina[1], pathname);
      if (status === 404) return enviarHtml(res, 404, renderizar('404.html', pathname).html);
      return enviarHtml(res, status, html);
    }
    if (serveFile(req, res, PUBLIC, pathname)) return;

    enviarHtml(res, 404, renderizar('404.html', pathname).html);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    if (res.headersSent) return res.end();
    sendJson(res, status, { erro: status === 500 ? 'Erro interno. Tente novamente.' : err.message });
  }
});

servidor.listen(config.port, () => {
  console.log(`DFR 3D Loja rodando em ${config.baseUrl} (porta ${config.port})`);
  iniciarTarefas();
});
