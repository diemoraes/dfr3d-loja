// Rotas do painel administrativo (/admin)
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { db, gerarCodigo, produtoPublico, registrarHistorico, atualizarStatusPedido, lerJson, lerAjuste, salvarAjuste, STATUS_PEDIDO, STATUS_ENCOMENDA } from '../db.js';
import { sendJson, readJson, HttpError, limpar, soDigitos, exigir, slugify, serveFile, redirect } from '../http.js';
import { login, logoutCookie, estaLogado, exigirAdmin } from '../auth.js';
import { emitir } from '../eventos.js';
import { salvarImagem, apagarImagem, privadoDir } from '../uploads.js';
import { mpAtivo, criarPagamento } from '../mercadopago.js';
import { emailAtivo, celularAtivo, enviarEmail, avisarCelular } from '../notificacoes.js';
import { etiquetaAtiva, gerarEtiqueta, buscarRastreio } from '../etiqueta.js';
import { fazerBackup, listarBackups } from '../tarefas.js';
import * as ML from '../mercadolivre.js';
import { gerarCaptcha, exigirCaptcha, turnstileAtivo } from '../captcha.js';

const reais = (v) => {
  if (typeof v === 'number') return Math.round(v * 100);
  const s = String(v ?? '').trim();
  const n = Math.round(parseFloat(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s) * 100);
  return Number.isFinite(n) ? n : NaN;
};
const inteiroOuNulo = (v) => (v === '' || v === null || v === undefined ? null : Math.max(0, Math.floor(Number(v))));

function dadosProduto(b) {
  const nome = limpar(b.nome, 120);
  exigir(nome, 'Informe o nome do produto.');
  const variacoes = (Array.isArray(b.variacoes) ? b.variacoes : [])
    .map((v) => ({ nome: limpar(v.nome, 60), preco_cents: reais(v.preco) }))
    .filter((v) => v.nome);
  for (const v of variacoes) exigir(Number.isFinite(v.preco_cents) && v.preco_cents > 0, `Preço inválido na opção "${v.nome}".`);
  exigir(new Set(variacoes.map((v) => v.nome)).size === variacoes.length, 'Há opções com o mesmo nome.');
  const preco = variacoes.length ? Math.min(...variacoes.map((v) => v.preco_cents)) : reais(b.preco);
  exigir(Number.isFinite(preco) && preco > 0, 'Informe um preço válido.');
  const num = (v, d) => Math.max(1, Math.floor(Number(v) || d));
  const mlId = limpar(b.ml_item_id, 30).toUpperCase().replace(/[^A-Z0-9]/g, '');
  exigir(!mlId || /^MLB\d+$/.test(mlId), 'Código do anúncio do Mercado Livre inválido (ex.: MLB1234567890).');
  return {
    nome,
    descricao: limpar(b.descricao, 5000),
    categoria: limpar(b.categoria, 60),
    preco_cents: preco,
    estoque: inteiroOuNulo(b.estoque),
    prazo_dias: Math.max(0, Math.floor(Number(b.prazo_dias) || 0)),
    cores: limpar(b.cores, 400).split(',').map((c) => c.trim()).filter(Boolean).join(', '),
    peso_g: num(b.peso_g, 200),
    largura_cm: num(b.largura_cm, 10),
    altura_cm: num(b.altura_cm, 10),
    comprimento_cm: num(b.comprimento_cm, 10),
    ativo: b.ativo === false || b.ativo === 0 ? 0 : 1,
    destaque: b.destaque ? 1 : 0,
    variacoes: JSON.stringify(variacoes),
    variacao_rotulo: limpar(b.variacao_rotulo, 30) || 'Tamanho',
    personalizacao: limpar(b.personalizacao, 60),
    personalizacao_max: Math.min(Math.max(Math.floor(Number(b.personalizacao_max) || 20), 1), 200),
    ml_item_id: mlId,
    promo_pct: Math.min(Math.max(Math.floor(Number(b.promo_pct) || 0), 0), 90),
    promo_ate: /^\d{4}-\d{2}-\d{2}$/.test(b.promo_ate || '') ? b.promo_ate : '',
  };
}
const CAMPOS = ['nome', 'descricao', 'categoria', 'preco_cents', 'estoque', 'prazo_dias', 'cores', 'peso_g', 'largura_cm', 'altura_cm', 'comprimento_cm',
  'ativo', 'destaque', 'variacoes', 'variacao_rotulo', 'personalizacao', 'personalizacao_max', 'ml_item_id', 'promo_pct', 'promo_ate'];

function slugUnico(base, ignorarId = 0) {
  let slug = slugify(base), n = 2;
  while (db.prepare('SELECT 1 FROM produtos WHERE slug = ? AND id != ?').get(slug, ignorarId)) slug = `${slugify(base)}-${n++}`;
  return slug;
}

function produtoAdmin(p) {
  return { ...produtoPublico(p), ativo: p.ativo === 1, peso_g: p.peso_g, largura_cm: p.largura_cm, altura_cm: p.altura_cm,
    comprimento_cm: p.comprimento_cm, arquivos_imagens: lerJson(p.imagens), variacoes_brutas: lerJson(p.variacoes), promo_pct_config: p.promo_pct, promo_ate_config: p.promo_ate, cores_texto: p.cores, preco_base_cents: p.preco_cents, ml_item_id: p.ml_item_id };
}

function pedidoAdmin(p) {
  return { ...p, itens: lerJson(p.itens), status_nome: STATUS_PEDIDO[p.status] || p.status,
    historico: db.prepare('SELECT * FROM historico WHERE pedido_id = ? ORDER BY id').all(p.id) };
}
const buscarPedido = (id) => {
  const p = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(Number(id));
  if (!p) throw new HttpError(404, 'Pedido não encontrado.');
  return p;
};

function sincronizarML(ids) { if (ids.length) emitir('estoque:alterado', ids); }

export function rotasAdmin(r) {
  // Captcha do login: configuração e desafio (imagem nova a cada pedido)
  r.get('/api/admin/captcha', (req, res) => {
    if (turnstileAtivo()) return sendJson(res, 200, { tipo: 'turnstile', site_key: config.turnstile.siteKey });
    sendJson(res, 200, { tipo: 'imagem', ...gerarCaptcha() });
  });
  r.post('/api/admin/login', async (req, res) => {
    const b = await readJson(req);
    await exigirCaptcha(req, b);
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': login(req, b.senha) });
  });
  r.post('/api/admin/logout', (req, res) => sendJson(res, 200, { ok: true }, { 'Set-Cookie': logoutCookie() }));
  r.get('/api/admin/me', (req, res) => sendJson(res, 200, { logado: estaLogado(req), pagamento_online: mpAtivo(), etiqueta: etiquetaAtiva(), ml: ML.mlConectado() }));

  // ---------- Resumo ----------
  r.get('/api/admin/resumo', (req, res) => {
    exigirAdmin(req);
    const porStatus = Object.fromEntries(db.prepare('SELECT status, COUNT(*) n FROM pedidos GROUP BY status').all().map((x) => [x.status, x.n]));
    const vendasMes = db.prepare(`SELECT COALESCE(SUM(total_cents),0) total, COUNT(*) n FROM pedidos
      WHERE status NOT IN ('aguardando_pagamento','cancelado') AND criado_em >= date('now','localtime','start of month')`).get();
    const encomendasNovas = db.prepare("SELECT COUNT(*) n FROM encomendas WHERE status = 'nova'").get().n;
    const avaliacoesPendentes = db.prepare('SELECT COUNT(*) n FROM avaliacoes WHERE aprovada = 0').get().n;
    const perguntasPendentes = db.prepare("SELECT COUNT(*) n FROM perguntas WHERE resposta = ''").get().n;
    const estoqueBaixo = db.prepare('SELECT id, nome, estoque FROM produtos WHERE ativo = 1 AND estoque IS NOT NULL AND estoque <= 2 ORDER BY estoque').all();
    sendJson(res, 200, { porStatus, statusNomes: STATUS_PEDIDO, vendasMes, encomendasNovas, avaliacoesPendentes, perguntasPendentes, estoqueBaixo });
  });

  // ---------- Produtos ----------
  r.get('/api/admin/produtos', (req, res) => {
    exigirAdmin(req);
    sendJson(res, 200, db.prepare('SELECT * FROM produtos ORDER BY id DESC').all().map(produtoAdmin));
  });

  r.post('/api/admin/produtos', async (req, res) => {
    exigirAdmin(req);
    const d = dadosProduto(await readJson(req));
    const info = db.prepare(`INSERT INTO produtos (slug, ${CAMPOS.join(', ')}) VALUES (?, ${CAMPOS.map(() => '?').join(', ')})`)
      .run(slugUnico(d.nome), ...CAMPOS.map((c) => d[c]));
    const novo = db.prepare('SELECT * FROM produtos WHERE id = ?').get(info.lastInsertRowid);
    if (novo.ml_item_id) sincronizarML([novo.id]);
    sendJson(res, 201, produtoAdmin(novo));
  });

  r.put('/api/admin/produtos/:id', async (req, res, { params }) => {
    exigirAdmin(req);
    const atual = db.prepare('SELECT * FROM produtos WHERE id = ?').get(Number(params.id));
    if (!atual) throw new HttpError(404, 'Produto não encontrado.');
    const d = dadosProduto(await readJson(req));
    const slug = d.nome === atual.nome ? atual.slug : slugUnico(d.nome, atual.id);
    db.prepare(`UPDATE produtos SET slug = ?, ${CAMPOS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(slug, ...CAMPOS.map((c) => d[c]), atual.id);
    if (d.ml_item_id && (d.estoque !== atual.estoque || d.ml_item_id !== atual.ml_item_id)) sincronizarML([atual.id]);
    sendJson(res, 200, produtoAdmin(db.prepare('SELECT * FROM produtos WHERE id = ?').get(atual.id)));
  });

  r.delete('/api/admin/produtos/:id', (req, res, { params }) => {
    exigirAdmin(req);
    const p = db.prepare('SELECT * FROM produtos WHERE id = ?').get(Number(params.id));
    if (!p) throw new HttpError(404, 'Produto não encontrado.');
    lerJson(p.imagens).forEach(apagarImagem);
    db.prepare('DELETE FROM produtos WHERE id = ?').run(p.id);
    sendJson(res, 200, { ok: true });
  });

  r.post('/api/admin/produtos/:id/imagens', async (req, res, { params }) => {
    exigirAdmin(req);
    const p = db.prepare('SELECT * FROM produtos WHERE id = ?').get(Number(params.id));
    if (!p) throw new HttpError(404, 'Produto não encontrado.');
    const b = await readJson(req, 8 * 1024 * 1024);
    const imagens = lerJson(p.imagens);
    exigir(imagens.length < 10, 'Máximo de 10 fotos por produto.');
    imagens.push(salvarImagem(b.dados));
    db.prepare('UPDATE produtos SET imagens = ? WHERE id = ?').run(JSON.stringify(imagens), p.id);
    sendJson(res, 200, produtoAdmin(db.prepare('SELECT * FROM produtos WHERE id = ?').get(p.id)));
  });

  r.put('/api/admin/produtos/:id/imagens', async (req, res, { params }) => {
    exigirAdmin(req);
    const p = db.prepare('SELECT * FROM produtos WHERE id = ?').get(Number(params.id));
    if (!p) throw new HttpError(404, 'Produto não encontrado.');
    const atuais = lerJson(p.imagens);
    const nova = ((await readJson(req)).imagens || []).filter((f) => atuais.includes(f));
    atuais.filter((f) => !nova.includes(f)).forEach(apagarImagem);
    db.prepare('UPDATE produtos SET imagens = ? WHERE id = ?').run(JSON.stringify(nova), p.id);
    sendJson(res, 200, produtoAdmin(db.prepare('SELECT * FROM produtos WHERE id = ?').get(p.id)));
  });

  // ---------- Pedidos ----------
  r.get('/api/admin/pedidos', (req, res, { query }) => {
    exigirAdmin(req);
    const status = limpar(query.get('status'), 40);
    const busca = limpar(query.get('busca'), 80);
    let sql = 'SELECT * FROM pedidos WHERE 1=1';
    const args = [];
    if (status) { sql += ' AND status = ?'; args.push(status); }
    if (busca) { sql += ' AND (codigo LIKE ? OR cliente_nome LIKE ? OR cliente_email LIKE ?)'; args.push(`%${busca}%`, `%${busca}%`, `%${busca}%`); }
    sql += ' ORDER BY id DESC LIMIT 300';
    sendJson(res, 200, { pedidos: db.prepare(sql).all(...args).map((p) => ({ ...p, itens: lerJson(p.itens), status_nome: STATUS_PEDIDO[p.status] })), statusNomes: STATUS_PEDIDO });
  });

  r.get('/api/admin/pedidos/:id', (req, res, { params }) => {
    exigirAdmin(req);
    sendJson(res, 200, pedidoAdmin(buscarPedido(params.id)));
  });

  r.put('/api/admin/pedidos/:id', async (req, res, { params }) => {
    exigirAdmin(req);
    const p = buscarPedido(params.id);
    const b = await readJson(req);
    const cpf = b.cliente_cpf === undefined ? p.cliente_cpf : soDigitos(b.cliente_cpf).slice(0, 11);
    exigir(!cpf || cpf.length === 11, 'CPF deve ter 11 números.');
    db.prepare("UPDATE pedidos SET rastreio = ?, notas_internas = ?, cliente_cpf = ?, atualizado_em = datetime('now','localtime') WHERE id = ?")
      .run(limpar(b.rastreio ?? p.rastreio, 60), limpar(b.notas_internas ?? p.notas_internas, 3000), cpf, p.id);
    if (b.status && b.status !== p.status) {
      exigir(STATUS_PEDIDO[b.status], 'Status inválido.');
      atualizarStatusPedido(buscarPedido(p.id), b.status, limpar(b.nota, 300) || 'Alterado no painel');
    }
    sendJson(res, 200, pedidoAdmin(buscarPedido(p.id)));
  });

  r.post('/api/admin/pedidos/:id/link-pagamento', async (req, res, { params }) => {
    exigirAdmin(req);
    exigir(mpAtivo(), 'Configure o MP_ACCESS_TOKEN para gerar links do Mercado Pago.');
    const p = buscarPedido(params.id);
    exigir(p.status === 'aguardando_pagamento', 'O pedido não está aguardando pagamento.');
    const pag = await criarPagamento(p);
    db.prepare('UPDATE pedidos SET mp_preference_id = ?, link_pagamento = ? WHERE id = ?').run(pag.preferenceId, pag.link, p.id);
    sendJson(res, 200, pedidoAdmin(buscarPedido(p.id)));
  });

  r.post('/api/admin/pedidos/:id/etiqueta', async (req, res, { params }) => {
    exigirAdmin(req);
    const b = await readJson(req);
    const volume = b.volume && Object.fromEntries(Object.entries(b.volume).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)]));
    await gerarEtiqueta(buscarPedido(params.id), { servico: b.servico, volume });
    sendJson(res, 200, pedidoAdmin(buscarPedido(params.id)));
  });

  r.post('/api/admin/pedidos/:id/rastreio', async (req, res, { params }) => {
    exigirAdmin(req);
    const r2 = await buscarRastreio(buscarPedido(params.id));
    exigir(r2.rastreio, 'O código de rastreio ainda não saiu. Normalmente aparece depois da postagem.');
    sendJson(res, 200, pedidoAdmin(buscarPedido(params.id)));
  });

  // ---------- Encomendas ----------
  r.get('/api/admin/encomendas', (req, res) => {
    exigirAdmin(req);
    const lista = db.prepare('SELECT * FROM encomendas ORDER BY id DESC LIMIT 300').all()
      .map((e) => ({ ...e, arquivos: lerJson(e.arquivos), status_nome: STATUS_ENCOMENDA[e.status] }));
    sendJson(res, 200, { encomendas: lista, statusNomes: STATUS_ENCOMENDA });
  });

  r.put('/api/admin/encomendas/:id', async (req, res, { params }) => {
    exigirAdmin(req);
    const e = db.prepare('SELECT * FROM encomendas WHERE id = ?').get(Number(params.id));
    if (!e) throw new HttpError(404, 'Encomenda não encontrada.');
    const b = await readJson(req);
    const status = b.status ?? e.status;
    exigir(STATUS_ENCOMENDA[status], 'Status inválido.');
    const valor = b.valor === undefined ? e.valor_cents : (b.valor === '' ? null : reais(b.valor));
    exigir(valor === null || (Number.isFinite(valor) && valor >= 0), 'Valor inválido.');
    db.prepare('UPDATE encomendas SET status = ?, valor_cents = ?, resposta = ? WHERE id = ?').run(status, valor, limpar(b.resposta ?? e.resposta, 3000), e.id);
    sendJson(res, 200, { ok: true });
  });

  r.post('/api/admin/encomendas/:id/gerar-pedido', async (req, res, { params }) => {
    exigirAdmin(req);
    const e = db.prepare('SELECT * FROM encomendas WHERE id = ?').get(Number(params.id));
    if (!e) throw new HttpError(404, 'Encomenda não encontrada.');
    exigir(!e.pedido_codigo, `Esta encomenda já virou o pedido ${e.pedido_codigo}.`);
    const b = await readJson(req);
    const valor = reais(b.valor);
    const frete = b.frete ? reais(b.frete) : 0;
    exigir(Number.isFinite(valor) && valor > 0, 'Informe o valor da peça.');
    exigir(Number.isFinite(frete) && frete >= 0, 'Frete inválido.');
    const entregaTipo = b.entrega_tipo === 'envio' ? 'envio' : 'retirada';
    const itens = [{ produto_id: null, nome: `Encomenda ${e.codigo}: ${limpar(b.titulo, 100) || e.descricao.slice(0, 60)}`, cor: e.cor, quantidade: 1, preco_cents: valor, imagem: '' }];
    const codigo = gerarCodigo('DFR');
    const info = db.prepare(`INSERT INTO pedidos (codigo, origem, cliente_nome, cliente_email, cliente_telefone, entrega_tipo, entrega_servico, frete_cents, subtotal_cents, total_cents, itens, observacoes, cep, forma_pagamento, estoque_baixado)
      VALUES (?, 'encomenda', ?,?,?,?,?,?,?,?,?,?,?,?,1)`).run(codigo, e.nome, e.email, e.telefone, entregaTipo,
      entregaTipo === 'envio' ? limpar(b.servico, 60) || 'Correios' : 'Retirar no local', frete, valor, valor + frete, JSON.stringify(itens), e.descricao.slice(0, 1000),
      soDigitos(b.cep).slice(0, 8), mpAtivo() ? 'cartao' : 'combinar');
    const pedidoId = Number(info.lastInsertRowid);
    registrarHistorico(pedidoId, 'aguardando_pagamento', `Gerado a partir da encomenda ${e.codigo}`);
    let link = '';
    if (mpAtivo()) {
      const pag = await criarPagamento(buscarPedido(pedidoId));
      link = pag.link;
      db.prepare('UPDATE pedidos SET mp_preference_id = ?, link_pagamento = ? WHERE id = ?').run(pag.preferenceId, link, pedidoId);
    }
    db.prepare("UPDATE encomendas SET status = 'aprovada', valor_cents = ?, pedido_codigo = ? WHERE id = ?").run(valor, codigo, e.id);
    emitir('pedido:criado', buscarPedido(pedidoId));
    sendJson(res, 201, { codigo, pedido_id: pedidoId, link_pagamento: link });
  });

  r.get('/api/admin/arquivos/:nome', (req, res, { params }) => {
    exigirAdmin(req);
    if (!serveFile(req, res, privadoDir, path.basename(params.nome), { cache: 'private, no-store', download: true })) {
      throw new HttpError(404, 'Arquivo não encontrado.');
    }
  });

  // ---------- Clientes ----------
  r.get('/api/admin/clientes', (req, res) => {
    exigirAdmin(req);
    sendJson(res, 200, db.prepare(`SELECT c.id, c.nome, c.email, c.telefone, c.cidade, c.uf, c.criado_em, c.ultimo_login,
      COUNT(p.id) pedidos, COALESCE(SUM(CASE WHEN p.status NOT IN ('aguardando_pagamento','cancelado') THEN p.total_cents END), 0) total_cents
      FROM clientes c LEFT JOIN pedidos p ON p.cliente_id = c.id GROUP BY c.id ORDER BY c.id DESC LIMIT 500`).all());
  });

  // ---------- Cupons ----------
  function dadosCupom(b) {
    const codigo = limpar(b.codigo, 30).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    exigir(codigo.length >= 3, 'O código precisa ter pelo menos 3 letras/números.');
    const tipo = ['pct', 'valor', 'frete'].includes(b.tipo) ? b.tipo : 'pct';
    const valor = tipo === 'pct' ? Math.floor(Number(b.valor)) : tipo === 'valor' ? reais(b.valor) : 0;
    if (tipo === 'pct') exigir(valor >= 1 && valor <= 90, 'Percentual entre 1 e 90.');
    if (tipo === 'valor') exigir(Number.isFinite(valor) && valor > 0, 'Valor do desconto inválido.');
    const minimo = b.minimo ? reais(b.minimo) : 0;
    exigir(Number.isFinite(minimo) && minimo >= 0, 'Valor mínimo inválido.');
    const validade = limpar(b.validade, 10);
    exigir(!validade || /^\d{4}-\d{2}-\d{2}$/.test(validade), 'Validade inválida.');
    return { codigo, tipo, valor, minimo_cents: minimo, validade, usos_max: inteiroOuNulo(b.usos_max), ativo: b.ativo === false ? 0 : 1 };
  }
  r.get('/api/admin/cupons', (req, res) => { exigirAdmin(req); sendJson(res, 200, db.prepare('SELECT * FROM cupons ORDER BY id DESC').all()); });
  r.post('/api/admin/cupons', async (req, res) => {
    exigirAdmin(req);
    const c = dadosCupom(await readJson(req));
    exigir(!db.prepare('SELECT 1 FROM cupons WHERE codigo = ?').get(c.codigo), 'Já existe um cupom com esse código.');
    db.prepare('INSERT INTO cupons (codigo, tipo, valor, minimo_cents, validade, usos_max, ativo) VALUES (?,?,?,?,?,?,?)')
      .run(c.codigo, c.tipo, c.valor, c.minimo_cents, c.validade, c.usos_max, c.ativo);
    sendJson(res, 201, { ok: true });
  });
  r.put('/api/admin/cupons/:id', async (req, res, { params }) => {
    exigirAdmin(req);
    const c = dadosCupom(await readJson(req));
    exigir(!db.prepare('SELECT 1 FROM cupons WHERE codigo = ? AND id != ?').get(c.codigo, Number(params.id)), 'Já existe um cupom com esse código.');
    db.prepare('UPDATE cupons SET codigo=?, tipo=?, valor=?, minimo_cents=?, validade=?, usos_max=?, ativo=? WHERE id=?')
      .run(c.codigo, c.tipo, c.valor, c.minimo_cents, c.validade, c.usos_max, c.ativo, Number(params.id));
    sendJson(res, 200, { ok: true });
  });
  r.delete('/api/admin/cupons/:id', (req, res, { params }) => {
    exigirAdmin(req);
    db.prepare('DELETE FROM cupons WHERE id = ?').run(Number(params.id));
    sendJson(res, 200, { ok: true });
  });

  // ---------- Avaliações ----------
  r.get('/api/admin/avaliacoes', (req, res) => {
    exigirAdmin(req);
    sendJson(res, 200, db.prepare(`SELECT a.*, p.nome produto_nome, p.slug produto_slug, pe.codigo pedido_codigo FROM avaliacoes a
      JOIN produtos p ON p.id = a.produto_id LEFT JOIN pedidos pe ON pe.id = a.pedido_id ORDER BY a.aprovada, a.id DESC LIMIT 300`).all()
      .map((a) => ({ ...a, foto: a.foto ? `/uploads/${a.foto}` : '' })));
  });
  r.put('/api/admin/avaliacoes/:id', async (req, res, { params }) => {
    exigirAdmin(req);
    const b = await readJson(req);
    db.prepare('UPDATE avaliacoes SET aprovada = ? WHERE id = ?').run(b.aprovada ? 1 : 0, Number(params.id));
    sendJson(res, 200, { ok: true });
  });
  r.delete('/api/admin/avaliacoes/:id', (req, res, { params }) => {
    exigirAdmin(req);
    const a = db.prepare('SELECT foto FROM avaliacoes WHERE id = ?').get(Number(params.id));
    if (a?.foto) apagarImagem(a.foto);
    db.prepare('DELETE FROM avaliacoes WHERE id = ?').run(Number(params.id));
    sendJson(res, 200, { ok: true });
  });

  // ---------- Integrações, testes e backup ----------
  r.get('/api/admin/integracoes', async (req, res) => {
    exigirAdmin(req);
    let conta = null;
    if (ML.mlConectado()) conta = await ML.contaML().catch((e) => ({ erro: e.message }));
    sendJson(res, 200, {
      loja: { ok: true, nome: config.loja.nome, cidade: config.loja.cidade },
      mercado_pago: mpAtivo(), webhook_mp: Boolean(config.mp.webhookSecret), pix_desconto: config.pixDescontoPct,
      melhor_envio: Boolean(config.melhorEnvio.token), etiqueta: etiquetaAtiva(), sandbox_me: config.melhorEnvio.sandbox,
      email: emailAtivo(), email_admin: config.email.admin, celular: celularAtivo(),
      telegram: Boolean(config.telegram.token), whatsapp_callmebot: Boolean(config.callmebot.apikey),
      analytics: { ga: Boolean(config.analytics.ga), pixel: Boolean(config.analytics.metaPixel) },
      ml: { configurado: ML.mlConfigurado(), conectado: ML.mlConectado(), conta, webhook: `${config.baseUrl}/api/webhooks/mercadolivre`, redirect: `${config.baseUrl}/api/admin/ml/callback` },
      backups: listarBackups(), ultimo_backup: lerAjuste('ultimo_backup'),
      expira_horas: config.pedidoExpiraHoras,
      google: Boolean(config.google.clientId && config.google.clientSecret), google_redirect: `${config.baseUrl}/api/conta/google/callback`,
    });
  });

  r.post('/api/admin/testar-avisos', async (req, res) => {
    exigirAdmin(req);
    const resultado = {};
    if (emailAtivo()) resultado.email = await enviarEmail({ para: config.email.admin, assunto: 'Teste de e-mail da loja DFR 3D', html: '<p>Funcionou! Os avisos de pedido chegarão neste e-mail.</p>' }).then(() => 'enviado').catch((e) => e.message);
    if (celularAtivo()) resultado.celular = await avisarCelular('✅ Teste da loja DFR 3D: os avisos de pedido pago chegarão aqui.').then(() => 'enviado').catch((e) => e.message);
    exigir(Object.keys(resultado).length, 'Nenhum aviso configurado ainda (e-mail, Telegram ou WhatsApp).');
    sendJson(res, 200, resultado);
  });

  r.post('/api/admin/backup', async (req, res) => {
    exigirAdmin(req);
    await fazerBackup({ forcar: true });
    sendJson(res, 200, { backups: listarBackups() });
  });
  r.get('/api/admin/backup/:arquivo', (req, res, { params }) => {
    exigirAdmin(req);
    const nome = path.basename(params.arquivo);
    exigir(/^loja-[\d-]+\.db$/.test(nome), 'Arquivo inválido.');
    if (!serveFile(req, res, config.backupDir, nome, { cache: 'private, no-store', download: true })) throw new HttpError(404, 'Backup não encontrado.');
  });

  // ---------- Mercado Livre ----------
  r.get('/api/admin/ml/conectar', (req, res) => {
    exigirAdmin(req);
    exigir(ML.mlConfigurado(), 'Preencha ML_CLIENT_ID e ML_CLIENT_SECRET.');
    const state = crypto.randomBytes(16).toString('hex');
    salvarAjuste('ml_state', { state, expira: Date.now() + 10 * 60_000 });
    redirect(res, ML.urlAutorizacao(state));
  });
  // O retorno vem do site do ML (o cookie do painel não acompanha): a segurança é o "state" de uso único
  r.get('/api/admin/ml/callback', async (req, res, { query }) => {
    const salvo = lerAjuste('ml_state');
    const ok = salvo && salvo.expira > Date.now() && query.get('state') === salvo.state && query.get('code');
    salvarAjuste('ml_state', null);
    if (!ok) return redirect(res, '/admin#integracoes?ml=erro');
    try { await ML.conectar(query.get('code')); redirect(res, '/admin#integracoes?ml=ok'); }
    catch (e) { console.error(e.message); redirect(res, '/admin#integracoes?ml=erro'); }
  });
  r.post('/api/admin/ml/desconectar', (req, res) => { exigirAdmin(req); ML.desconectar(); sendJson(res, 200, { ok: true }); });
  r.get('/api/admin/ml/anuncio/:id', async (req, res, { params }) => {
    exigirAdmin(req);
    sendJson(res, 200, await ML.lerAnuncio(params.id.toUpperCase()));
  });
  r.post('/api/admin/ml/sincronizar', async (req, res) => {
    exigirAdmin(req);
    const vinculados = db.prepare("SELECT * FROM produtos WHERE ml_item_id != '' AND estoque IS NOT NULL").all();
    const erros = [];
    for (const p of vinculados) await ML.enviarEstoque(p).catch((e) => erros.push(`${p.nome}: ${e.message}`));
    sendJson(res, 200, { enviados: vinculados.length - erros.length, erros });
  });
}
