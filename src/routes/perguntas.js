// Perguntas e respostas dos produtos (estilo Mercado Livre)
// - Cliente pergunta na página do produto; a pergunta só aparece no site depois de respondida.
// - O e-mail de quem perguntou nunca é exibido.
import { db } from '../db.js';
import { sendJson, readJson, HttpError, limpar, emailValido, exigir } from '../http.js';
import { exigirAdmin } from '../auth.js';
import { emitir } from '../eventos.js';
import { clienteLogado } from '../clientes.js';

const nomeCurto = (n) => { const [a, b] = String(n).trim().split(/\s+/); return b ? `${a} ${b[0]}.` : a; };

export function perguntasPublicas(produtoId) {
  return db.prepare(`SELECT nome, pergunta, resposta, criado_em, respondida_em FROM perguntas
    WHERE produto_id = ? AND publicada = 1 AND resposta != '' ORDER BY respondida_em DESC, id DESC LIMIT 100`).all(produtoId)
    .map((p) => ({ ...p, nome: nomeCurto(p.nome) }));
}

// Limite simples anti-spam: 5 perguntas por IP a cada hora
const envios = new Map();
function checarLimite(ip) {
  const agora = Date.now();
  const lista = (envios.get(ip) || []).filter((t) => agora - t < 3600_000);
  if (lista.length >= 5) throw new HttpError(429, 'Você enviou muitas perguntas. Tente de novo mais tarde ou chame no WhatsApp.');
  lista.push(agora); envios.set(ip, lista);
}

export function rotasPerguntas(r) {
  r.get('/api/produtos/:slug/perguntas', (req, res, { params }) => {
    const p = db.prepare('SELECT id FROM produtos WHERE slug = ? AND ativo = 1').get(params.slug);
    if (!p) throw new HttpError(404, 'Produto não encontrado.');
    sendJson(res, 200, perguntasPublicas(p.id));
  });

  r.post('/api/produtos/:slug/perguntas', async (req, res, { params }) => {
    const produto = db.prepare('SELECT id, nome, slug FROM produtos WHERE slug = ? AND ativo = 1').get(params.slug);
    if (!produto) throw new HttpError(404, 'Produto não encontrado.');
    const b = await readJson(req, 20_000);
    if (b.site) return sendJson(res, 201, { ok: true }); // campo invisível: robô de spam
    const cliente = clienteLogado(req);
    const nome = limpar(cliente?.nome || b.nome, 80);
    const email = limpar(cliente?.email || b.email, 160).toLowerCase();
    const pergunta = limpar(b.pergunta, 1000);
    exigir(nome.length >= 2, 'Informe seu nome.');
    exigir(emailValido(email), 'Informe um e-mail válido para receber a resposta.');
    exigir(pergunta.length >= 5, 'Escreva sua pergunta.');
    exigir(!/https?:\/\/|www\./i.test(pergunta), 'Por segurança, não é possível enviar links nas perguntas.');
    checarLimite(req.socket.remoteAddress);
    const info = db.prepare('INSERT INTO perguntas (produto_id, cliente_id, nome, email, pergunta, ip) VALUES (?,?,?,?,?,?)')
      .run(produto.id, cliente?.id ?? null, nome, email, pergunta, String(req.socket.remoteAddress || '').slice(0, 60));
    emitir('pergunta:criada', { id: Number(info.lastInsertRowid), nome, email, pergunta, produto });
    sendJson(res, 201, { ok: true });
  });

  // ---------- Painel ----------
  r.get('/api/admin/perguntas', (req, res, { query }) => {
    exigirAdmin(req);
    const filtro = query.get('filtro') || 'pendentes';
    const onde = filtro === 'pendentes' ? "WHERE q.resposta = ''" : filtro === 'respondidas' ? "WHERE q.resposta != ''" : '';
    sendJson(res, 200, db.prepare(`SELECT q.*, p.nome produto_nome, p.slug produto_slug, p.imagens produto_imagens FROM perguntas q
      JOIN produtos p ON p.id = q.produto_id ${onde} ORDER BY (q.resposta = '') DESC, q.id DESC LIMIT 300`).all()
      .map((q) => { const img = JSON.parse(q.produto_imagens || '[]')[0]; delete q.produto_imagens; return { ...q, produto_imagem: img ? `/uploads/${img}` : '' }; }));
  });

  r.put('/api/admin/perguntas/:id', async (req, res, { params }) => {
    exigirAdmin(req);
    const q = db.prepare('SELECT * FROM perguntas WHERE id = ?').get(Number(params.id));
    if (!q) throw new HttpError(404, 'Pergunta não encontrada.');
    const b = await readJson(req);
    const resposta = b.resposta === undefined ? q.resposta : limpar(b.resposta, 2000);
    const publicada = b.publicada === undefined ? q.publicada : (b.publicada ? 1 : 0);
    const primeiraResposta = resposta && !q.resposta;
    db.prepare(`UPDATE perguntas SET resposta = ?, publicada = ?, respondida_em = CASE WHEN ? THEN datetime('now','localtime') ELSE respondida_em END WHERE id = ?`)
      .run(resposta, publicada, primeiraResposta ? 1 : 0, q.id);
    if (primeiraResposta) {
      const produto = db.prepare('SELECT nome, slug FROM produtos WHERE id = ?').get(q.produto_id);
      emitir('pergunta:respondida', { ...q, resposta, produto });
    }
    sendJson(res, 200, { ok: true });
  });

  r.delete('/api/admin/perguntas/:id', (req, res, { params }) => {
    exigirAdmin(req);
    db.prepare('DELETE FROM perguntas WHERE id = ?').run(Number(params.id));
    sendJson(res, 200, { ok: true });
  });
}
