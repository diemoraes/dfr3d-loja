// Rotas da loja (públicas)
import { config } from '../config.js';
import { db, gerarCodigo, produtoPublico, registrarHistorico, atualizarStatusPedido, reservarEstoque, lerJson, STATUS_PEDIDO } from '../db.js';
import { sendJson, readJson, HttpError, limpar, soDigitos, emailValido, exigir } from '../http.js';
import { emitir } from '../eventos.js';
import { calcularOpcoes, confirmarOpcao } from '../frete.js';
import { carregarItens, validarCupom, calcularTotais, subtotalDe, descricaoCupom } from '../precos.js';
import { mpAtivo, criarPagamento, buscarPagamento, buscarOrdem, statusDoPagamento, statusDaOrdem, assinaturaValida } from '../mercadopago.js';
import { salvarArquivoEncomenda, salvarImagem } from '../uploads.js';
import { processarNotificacao } from '../mercadolivre.js';
import { clienteLogado, salvarDadosDoPedido, googleAtivo } from '../clientes.js';
import { STATUS_ENVIO } from '../etiqueta.js';
import { filtrarProdutos, normalizar } from '../catalogo.js';
import { postsPublicados, buscarPosts } from '../blog.js';

function cpfValido(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const t of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < t; i++) soma += Number(cpf[i]) * (t + 1 - i);
    if (((soma * 10) % 11) % 10 !== Number(cpf[t])) return false;
  }
  return true;
}

function pedidoParaCliente(p) {
  const historico = db.prepare('SELECT status, nota, criado_em FROM historico WHERE pedido_id = ? ORDER BY id').all(p.id);
  const itens = lerJson(p.itens);
  const avaliados = db.prepare('SELECT produto_id FROM avaliacoes WHERE pedido_id = ?').all(p.id).map((a) => a.produto_id);
  return {
    codigo: p.codigo,
    status: p.status,
    status_nome: STATUS_PEDIDO[p.status] || p.status,
    criado_em: p.criado_em,
    cliente_nome: p.cliente_nome.split(' ')[0],
    itens,
    entrega_tipo: p.entrega_tipo,
    entrega_servico: p.entrega_servico,
    entrega_prazo: p.entrega_prazo,
    cidade: p.cidade, uf: p.uf,
    frete_cents: p.frete_cents,
    subtotal_cents: p.subtotal_cents,
    desconto_cents: p.desconto_cents,
    cupom: p.cupom,
    forma_pagamento: p.forma_pagamento,
    total_cents: p.total_cents,
    rastreio: p.rastreio,
    rastreio_status_nome: STATUS_ENVIO[p.rastreio_status] || '',
    rastreio_verificado: p.rastreio_verificado,
    link_pagamento: p.status === 'aguardando_pagamento' ? p.link_pagamento : '',
    retirada_endereco: p.entrega_tipo === 'retirada' ? config.retirada.endereco : '',
    expira_em_horas: config.pedidoExpiraHoras,
    pode_avaliar: ['enviado', 'entregue', 'pronto_retirada'].includes(p.status),
    avaliar: itens.filter((i) => i.produto_id && !avaliados.includes(i.produto_id)).map((i) => ({ produto_id: i.produto_id, nome: i.nome }))
      .filter((v, idx, arr) => arr.findIndex((x) => x.produto_id === v.produto_id) === idx),
    historico: historico.map((h) => ({ ...h, status_nome: STATUS_PEDIDO[h.status] || h.status })),
  };
}

/** Consulta a ordem (Orders API) no Mercado Pago e atualiza o pedido. */
async function sincronizarOrdem(orderId) {
  const ord = await buscarOrdem(orderId);
  const pedido = db.prepare('SELECT * FROM pedidos WHERE codigo = ?').get(ord.external_reference);
  if (!pedido) return null;
  const pag = ord.transactions?.payments?.[0] || {};
  const mpPaymentId = String(pag.id || ord.id);
  const metodo = pag.payment_method?.type || pag.payment_method?.id || '';
  const pagStatus = pag.status || ord.status;
  db.prepare("UPDATE pedidos SET mp_payment_id = ?, pagamento_status = ?, pagamento_metodo = ?, atualizado_em = datetime('now','localtime') WHERE id = ?")
    .run(mpPaymentId, pagStatus, metodo, pedido.id);
  const novo = statusDaOrdem(ord.status) || statusDoPagamento(pag.status);
  if (novo === 'pago' && ['aguardando_pagamento', 'cancelado'].includes(pedido.status)) {
    const pagoCents = Math.round(Number(ord.total_paid_amount || pag.amount || 0) * 100);
    if (pagoCents < pedido.total_cents) {
      console.error(`Ordem ${ord.id} com valor menor que o pedido ${pedido.codigo}`);
      return db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedido.id);
    }
    const nota = pedido.status === 'cancelado' ? 'Pago depois do prazo — pedido reaberto, confira o estoque' : `Mercado Pago: ${metodo || ord.id}`;
    return atualizarStatusPedido({ ...pedido, pagamento_status: pagStatus }, 'pago', nota);
  }
  if ((ord.status === 'failed' || pag.status === 'rejected') && pedido.status === 'aguardando_pagamento' && pedido.mp_payment_id !== mpPaymentId) {
    emitir('pagamento:recusado', { pedido, status: pagStatus, detalhe: ord.status_detail || pag.status_detail || '' });
  }
  if (novo === 'cancelado' && ['aguardando_pagamento', 'pago'].includes(pedido.status)) {
    return atualizarStatusPedido(pedido, 'cancelado', `Mercado Pago: ${ord.status}`);
  }
  return db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedido.id);
}

/** Consulta o pagamento no Mercado Pago e atualiza o pedido (nunca confia no que o navegador manda). */
async function sincronizarPagamento(paymentId) {
  const pag = await buscarPagamento(paymentId);
  const pedido = db.prepare('SELECT * FROM pedidos WHERE codigo = ?').get(pag.external_reference);
  if (!pedido) return null;
  db.prepare("UPDATE pedidos SET mp_payment_id = ?, pagamento_status = ?, pagamento_metodo = ?, atualizado_em = datetime('now','localtime') WHERE id = ?")
    .run(String(pag.id), pag.status, pag.payment_type_id || '', pedido.id);
  const novo = statusDoPagamento(pag.status);
  if (novo === 'pago' && ['aguardando_pagamento', 'cancelado'].includes(pedido.status)) {
    if (Math.round(pag.transaction_amount * 100) < pedido.total_cents) {
      console.error(`Pagamento ${pag.id} com valor menor que o pedido ${pedido.codigo}`);
      return db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedido.id);
    }
    const nota = pedido.status === 'cancelado' ? 'Pago depois do prazo — pedido reaberto, confira o estoque' : `Mercado Pago: ${pag.payment_type_id || ''}`;
    return atualizarStatusPedido({ ...pedido, pagamento_status: pag.status }, 'pago', nota);
  }
  if (pag.status === 'rejected' && pedido.status === 'aguardando_pagamento' && pedido.mp_payment_id !== String(pag.id)) {
    emitir('pagamento:recusado', { pedido, status: pag.status, detalhe: pag.status_detail || '' });
  }
  if (novo === 'cancelado' && ['aguardando_pagamento', 'pago'].includes(pedido.status)) {
    return atualizarStatusPedido(pedido, 'cancelado', `Mercado Pago: ${pag.status}`);
  }
  return db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedido.id);
}

export function rotasPublicas(r) {
  r.get('/api/config', (req, res) => sendJson(res, 200, {
    loja: { nome: config.loja.nome, cidade: config.loja.cidade },
    whatsapp: config.contato.whatsapp,
    email: config.contato.email,
    instagram: config.contato.instagram,
    retirada: config.retirada.ativa ? config.retirada.endereco : null,
    pagamento_online: mpAtivo(),
    pix_desconto: mpAtivo() ? config.pixDescontoPct : 0,
    frete_gratis_acima_cents: config.freteGratisAcimaCents,
    expira_horas: config.pedidoExpiraHoras,
    analytics: config.analytics,
    login_google: googleAtivo(),
  }));

  // Catálogo com busca sem acento, filtros e ordenação
  r.get('/api/produtos', (req, res, { query }) => {
    const ordem = limpar(query.get('ordem'), 20) || 'relevancia';
    const limite = Math.min(Math.max(Number(query.get('limite')) || 200, 1), 200);
    const lista = filtrarProdutos({
      busca: limpar(query.get('busca'), 80), categoria: limpar(query.get('categoria'), 60),
      promo: query.get('promo') === '1', destaque: query.get('destaque') === '1', ordem,
    });
    const categorias = db.prepare("SELECT DISTINCT categoria FROM produtos WHERE ativo = 1 AND categoria != '' ORDER BY categoria").all().map((c) => c.categoria);
    sendJson(res, 200, { produtos: lista.slice(0, limite), total: lista.length, categorias });
  });

  // Seções da página inicial
  r.get('/api/vitrine', (req, res) => {
    const todos = filtrarProdutos({ ordem: 'relevancia' });
    const disponiveis = todos.filter((p) => p.disponivel);
    const vendidos = [...disponiveis].filter((p) => p.vendidos > 0).sort((x, y) => y.vendidos - x.vendidos).slice(0, 8);
    sendJson(res, 200, {
      destaques: disponiveis.filter((p) => p.destaque).slice(0, 8),
      promocoes: disponiveis.filter((p) => p.promo_pct > 0).sort((x, y) => y.promo_pct - x.promo_pct).slice(0, 8),
      mais_vendidos: vendidos,
      novidades: [...disponiveis].sort((x, y) => y.id - x.id).slice(0, 8),
      posts: postsPublicados(3),
    });
  });

  // Sugestões da barra de busca (produtos + posts do blog)
  r.get('/api/busca', (req, res, { query }) => {
    const q = limpar(query.get('q'), 80);
    if (normalizar(q).length < 2) return sendJson(res, 200, { produtos: [], posts: [] });
    const produtos = filtrarProdutos({ busca: q, ordem: 'relevancia' }).slice(0, 6)
      .map((p) => ({ slug: p.slug, nome: p.nome, categoria: p.categoria, preco_cents: p.preco_cents, preco_original_cents: p.preco_original_cents, imagem: p.imagens[0] || '' }));
    sendJson(res, 200, { produtos, posts: buscarPosts(q).slice(0, 3) });
  });

  r.get('/api/produtos/:slug', (req, res, { params }) => {
    const p = db.prepare('SELECT * FROM produtos WHERE slug = ? AND ativo = 1').get(params.slug);
    if (!p) throw new HttpError(404, 'Produto não encontrado.');
    const avaliacoes = db.prepare('SELECT nome, nota, comentario, foto, criado_em FROM avaliacoes WHERE produto_id = ? AND aprovada = 1 ORDER BY id DESC LIMIT 30').all(p.id)
      .map((a) => ({ ...a, nome: a.nome.split(' ')[0] + (a.nome.split(' ')[1] ? ` ${a.nome.split(' ')[1][0]}.` : ''), foto: a.foto ? `/uploads/${a.foto}` : '' }));
    sendJson(res, 200, { ...produtoPublico(p), avaliacoes });
  });

  r.post('/api/frete', async (req, res) => {
    const body = await readJson(req);
    const cep = soDigitos(body.cep);
    exigir(cep.length === 8, 'Digite um CEP válido.');
    const itens = carregarItens(body.itens);
    sendJson(res, 200, { opcoes: await calcularOpcoes(cep, itens) });
  });

  // Resumo de valores do checkout (o navegador só exibe; quem decide é o servidor)
  r.post('/api/carrinho/resumo', async (req, res) => {
    const b = await readJson(req);
    const itens = carregarItens(b.itens);
    let cupom = null, erroCupom = '';
    try { cupom = validarCupom(b.cupom, subtotalDe(itens)); } catch (e) { erroCupom = e.message; }
    const totais = calcularTotais({ itens, cupom, formaPagamento: b.forma_pagamento, freteCents: Math.max(Number(b.frete_cents) || 0, 0) });
    sendJson(res, 200, { ...totais, cupom: cupom ? { codigo: cupom.codigo, descricao: descricaoCupom(cupom) } : null, erro_cupom: erroCupom });
  });

  r.post('/api/pedidos', async (req, res) => {
    const b = await readJson(req);
    const c = b.cliente || {};
    const nome = limpar(c.nome, 120);
    const email = limpar(c.email, 160).toLowerCase();
    const telefone = soDigitos(c.telefone).slice(0, 13);
    const cpf = soDigitos(c.cpf).slice(0, 11);
    exigir(nome.split(' ').filter(Boolean).length >= 2, 'Informe seu nome completo.');
    exigir(emailValido(email), 'Informe um e-mail válido.');
    exigir(telefone.length >= 10, 'Informe um telefone com DDD.');
    exigir(!cpf || cpfValido(cpf), 'CPF inválido. Confira os números.');
    exigir(b.aceite === true, 'Para continuar, aceite a política de trocas e privacidade.');

    const itens = carregarItens(b.itens);
    const e = b.endereco || {};
    const cep = soDigitos(e.cep);
    const entrega = await confirmarOpcao(cep.length === 8 ? cep : '', itens, limpar(b.entrega_id, 40));
    if (entrega.tipo === 'envio') {
      exigir(cep.length === 8, 'Informe o CEP.');
      exigir(cpf, 'Informe o CPF: ele é obrigatório na declaração de conteúdo do envio.');
      for (const [campo, rotulo] of [['endereco', 'a rua'], ['numero', 'o número'], ['bairro', 'o bairro'], ['cidade', 'a cidade'], ['uf', 'o estado']]) {
        exigir(limpar(e[campo]), `Informe ${rotulo} para entrega.`);
      }
    }
    const forma = mpAtivo() ? (b.forma_pagamento === 'pix' ? 'pix' : 'cartao') : 'combinar';
    const cupom = validarCupom(b.cupom, subtotalDe(itens));
    const t = calcularTotais({ itens, cupom, formaPagamento: forma, freteCents: entrega.preco_cents });

    const itensPedido = itens.map((i) => ({
      produto_id: i.produto.id, nome: i.produto.nome, slug: i.produto.slug,
      cor: i.cor, variacao: i.variacao, personalizacao: i.personalizacao,
      quantidade: i.quantidade, preco_cents: i.preco_cents,
      imagem: lerJson(i.produto.imagens)[0] ? `/uploads/${lerJson(i.produto.imagens)[0]}` : '',
    }));
    const codigo = gerarCodigo('DFR');
    const cliente = clienteLogado(req);

    db.exec('BEGIN IMMEDIATE');
    let pedidoId, alterados;
    try {
      alterados = reservarEstoque(itensPedido);
      const info = db.prepare(`INSERT INTO pedidos
        (codigo, cliente_nome, cliente_email, cliente_telefone, cliente_cpf, cep, endereco, numero, complemento, bairro, cidade, uf,
         entrega_tipo, entrega_servico, entrega_servico_id, entrega_prazo, frete_cents, subtotal_cents, desconto_cents, cupom, forma_pagamento,
         total_cents, itens, observacoes, cliente_id, estoque_baixado)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`).run(
        codigo, nome, email, telefone, cpf, cep,
        limpar(e.endereco, 160), limpar(e.numero, 20), limpar(e.complemento, 80), limpar(e.bairro, 80), limpar(e.cidade, 80), limpar(e.uf, 2).toUpperCase(),
        entrega.tipo, entrega.nome, entrega.id, entrega.prazo_dias, t.frete_cents, t.subtotal_cents, t.desconto_cents, cupom?.codigo || '', forma,
        t.total_cents, JSON.stringify(itensPedido), limpar(b.observacoes, 1000), cliente?.id ?? null,
      );
      pedidoId = Number(info.lastInsertRowid);
      registrarHistorico(pedidoId, 'aguardando_pagamento', 'Pedido criado na loja');
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    if (alterados.length) emitir('estoque:alterado', alterados);
    if (cliente) salvarDadosDoPedido(cliente.id, { telefone, cpf, cep, endereco: limpar(e.endereco, 160), numero: limpar(e.numero, 20),
      complemento: limpar(e.complemento, 80), bairro: limpar(e.bairro, 80), cidade: limpar(e.cidade, 80), uf: limpar(e.uf, 2).toUpperCase() });

    let link = '';
    if (mpAtivo()) {
      try {
        const pag = await criarPagamento(db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId));
        link = pag.link;
        db.prepare('UPDATE pedidos SET mp_preference_id = ?, link_pagamento = ? WHERE id = ?').run(pag.preferenceId, link, pedidoId);
      } catch (err) { console.error('Link de pagamento:', err.message); } // o cliente pode tentar de novo na página do pedido
    }
    emitir('pedido:criado', db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId));
    sendJson(res, 201, { codigo, link_pagamento: link, total_cents: t.total_cents });
  });

  r.get('/api/pedidos/:codigo', async (req, res, { params, query }) => {
    let pedido = db.prepare('SELECT * FROM pedidos WHERE codigo = ?').get(params.codigo.toUpperCase());
    if (!pedido) throw new HttpError(404, 'Pedido não encontrado.');
    const orderId = (query.get('order_id') || '').trim();
    const paymentId = soDigitos(query.get('payment_id'));
    if (mpAtivo() && ['aguardando_pagamento', 'cancelado'].includes(pedido.status)) {
      try {
        if (orderId && orderId !== 'null') pedido = (await sincronizarOrdem(orderId)) || pedido;
        else if (paymentId) pedido = (await sincronizarPagamento(paymentId)) || pedido;
      } catch (e) { console.error(e.message); }
    }
    sendJson(res, 200, pedidoParaCliente(pedido));
  });

  r.post('/api/pedidos/:codigo/pagar', async (req, res, { params }) => {
    const pedido = db.prepare('SELECT * FROM pedidos WHERE codigo = ?').get(params.codigo.toUpperCase());
    if (!pedido) throw new HttpError(404, 'Pedido não encontrado.');
    exigir(pedido.status === 'aguardando_pagamento', pedido.status === 'cancelado' ? 'Este pedido expirou. Faça um novo pedido na loja.' : 'Este pedido não está aguardando pagamento.');
    exigir(mpAtivo(), 'Pagamento online indisponível. Fale com a gente no WhatsApp.');
    const pag = await criarPagamento(pedido);
    db.prepare('UPDATE pedidos SET mp_preference_id = ?, link_pagamento = ? WHERE id = ?').run(pag.preferenceId, pag.link, pedido.id);
    sendJson(res, 200, { link_pagamento: pag.link });
  });

  // Avaliação: só quem tem o código do pedido (enviado/entregue) pode avaliar cada produto uma vez
  r.post('/api/pedidos/:codigo/avaliar', async (req, res, { params }) => {
    const pedido = db.prepare('SELECT * FROM pedidos WHERE codigo = ?').get(params.codigo.toUpperCase());
    if (!pedido) throw new HttpError(404, 'Pedido não encontrado.');
    exigir(['enviado', 'entregue', 'pronto_retirada'].includes(pedido.status), 'Você poderá avaliar assim que receber o pedido.');
    const b = await readJson(req, 7 * 1024 * 1024);
    const produtoId = Number(b.produto_id);
    exigir(lerJson(pedido.itens).some((i) => i.produto_id === produtoId), 'Este produto não está no pedido.');
    const nota = Math.floor(Number(b.nota));
    exigir(nota >= 1 && nota <= 5, 'Escolha de 1 a 5 estrelas.');
    exigir(!db.prepare('SELECT 1 FROM avaliacoes WHERE produto_id = ? AND pedido_id = ?').get(produtoId, pedido.id), 'Você já avaliou este produto. Obrigado!');
    const foto = b.foto ? salvarImagem(b.foto) : '';
    db.prepare('INSERT INTO avaliacoes (produto_id, pedido_id, nome, nota, comentario, foto) VALUES (?,?,?,?,?,?)')
      .run(produtoId, pedido.id, pedido.cliente_nome, nota, limpar(b.comentario, 1500), foto);
    const prod = db.prepare('SELECT nome FROM produtos WHERE id = ?').get(produtoId);
    emitir('avaliacao:criada', { nome: pedido.cliente_nome, nota, produto: prod?.nome || '', comentario: limpar(b.comentario, 1500), pedido: pedido.codigo });
    sendJson(res, 201, { ok: true });
  });

  r.post('/api/encomendas', async (req, res) => {
    const b = await readJson(req, 70 * 1024 * 1024);
    const nome = limpar(b.nome, 120);
    const email = limpar(b.email, 160).toLowerCase();
    const descricao = limpar(b.descricao, 3000);
    exigir(nome.length >= 3, 'Informe seu nome.');
    exigir(emailValido(email), 'Informe um e-mail válido.');
    exigir(soDigitos(b.telefone).length >= 10, 'Informe um WhatsApp com DDD.');
    exigir(descricao.length >= 10, 'Descreva a peça que você quer (mínimo 10 caracteres).');
    exigir(b.aceite === true, 'Para continuar, aceite a política de privacidade.');
    const link = limpar(b.link_referencia, 500);
    exigir(!link || /^https?:\/\//i.test(link), 'O link de referência deve começar com http:// ou https://');
    const arquivos = (Array.isArray(b.arquivos) ? b.arquivos.slice(0, 5) : []).map((a) => salvarArquivoEncomenda(limpar(a.nome, 160), a.dados));
    const codigo = gerarCodigo('ENC');
    db.prepare(`INSERT INTO encomendas (codigo, nome, email, telefone, descricao, link_referencia, quantidade, cor, prazo_desejado, arquivos, cliente_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      codigo, nome, email, soDigitos(b.telefone).slice(0, 13), descricao, link,
      Math.min(Math.max(Math.floor(Number(b.quantidade) || 1), 1), 10000), limpar(b.cor, 60), limpar(b.prazo_desejado, 60), JSON.stringify(arquivos), clienteLogado(req)?.id ?? null,
    );
    emitir('encomenda:criada', db.prepare('SELECT * FROM encomendas WHERE codigo = ?').get(codigo));
    sendJson(res, 201, { codigo });
  });

  // Notificação automática do Mercado Pago quando um pagamento ou ordem muda
  r.post('/api/webhooks/mercadopago', async (req, res, { query }) => {
    const body = await readJson(req).catch(() => ({}));
    const tipo = query.get('type') || query.get('topic') || body.type;
    const id = query.get('data.id') || query.get('id') || body?.data?.id;
    if ((tipo === 'order' || tipo === 'payment') && id && mpAtivo()) {
      if (!assinaturaValida(req, String(id))) return sendJson(res, 401, { ok: false });
      try {
        if (tipo === 'order') await sincronizarOrdem(String(id));
        else await sincronizarPagamento(String(id));
      } catch (e) {
        if (e.mpStatus === 404) return sendJson(res, 200, { ok: true, ignorado: 'nao encontrado' });
        console.error('Webhook MP:', e.message);
        return sendJson(res, 500, { ok: false });
      }
    }
    sendJson(res, 200, { ok: true });
  });

  // Notificação do Mercado Livre (venda lá → baixa estoque aqui). Responde rápido e processa depois.
  r.post('/api/webhooks/mercadolivre', async (req, res) => {
    const body = await readJson(req).catch(() => ({}));
    sendJson(res, 200, { ok: true });
    processarNotificacao(body).catch((e) => console.error('Webhook ML:', e.message));
  });
}
