// E-mail para a LOJA (EMAIL_ADMIN, padrão contato@dfr3d.com.br) a cada coisa que acontece no site:
// pedidos, pagamentos, cancelamentos, mudanças de status automáticas, encomendas, perguntas,
// avaliações, novos clientes, estoque acabando, vendas no Mercado Livre e acessos ao painel.
import { config } from './config.js';
import { eventos } from './eventos.js';
import { db, lerJson, lerAjuste, salvarAjuste, STATUS_PEDIDO } from './db.js';
import { enviarEmail, avisarCelular, modelo, tabelaItens } from './notificacoes.js';

const brl = (c) => ((c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const agora = () => new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
const painel = (aba) => ({ texto: 'Abrir no painel', url: `${config.baseUrl}/admin#${aba}` });
const METODOS = { bank_transfer: 'Pix', pix: 'Pix', credit_card: 'Cartão de crédito', debit_card: 'Cartão de débito', ticket: 'Boleto', account_money: 'Saldo Mercado Pago' };
const SITUACAO_MP = { approved: 'aprovado', pending: 'pendente', in_process: 'em análise', rejected: 'recusado', cancelled: 'cancelado', refunded: 'devolvido', charged_back: 'contestado' };
const metodo = (m) => METODOS[m] || m;
const linha = (rotulo, valor) => (valor ? `<tr><td style="padding:4px 12px 4px 0;color:#71717a;white-space:nowrap;vertical-align:top">${rotulo}</td><td style="padding:4px 0">${valor}</td></tr>` : '');
const tabela = (linhas) => `<table cellpadding="0" cellspacing="0" style="font-size:14px;margin:8px 0 14px">${linhas.join('')}</table>`;
const quando = () => `<p style="color:#a1a1aa;font-size:12px;margin:14px 0 0">Aconteceu em ${agora()} (horário de Brasília)</p>`;

/** Envia o aviso para a loja sem nunca derrubar a ação do cliente se o e-mail falhar. */
function avisar(assunto, titulo, corpo, botao) {
  if (!config.email.admin) return;
  enviarEmail({ para: config.email.admin, assunto, html: modelo(titulo, corpo + quando(), botao) })
    .catch((e) => console.error('Aviso para a loja:', e.message));
}

function dadosCliente(p) {
  const endereco = p.entrega_tipo === 'envio'
    ? `${esc(p.endereco)}, ${esc(p.numero)}${p.complemento ? ` - ${esc(p.complemento)}` : ''} · ${esc(p.bairro)} · ${esc(p.cidade)}/${esc(p.uf)} · CEP ${esc(p.cep)}`
    : 'Retirada no local';
  return tabela([
    linha('Cliente', `<b>${esc(p.cliente_nome)}</b>`),
    linha('WhatsApp', p.cliente_telefone ? `<a href="https://wa.me/${p.cliente_telefone.length <= 11 ? '55' : ''}${esc(p.cliente_telefone)}" style="color:#e10a14">${esc(p.cliente_telefone)}</a>` : ''),
    linha('E-mail', esc(p.cliente_email)),
    linha('Entrega', `${esc(p.entrega_servico)} — ${endereco}`),
    linha('Pagamento', { pix: 'Pix (com desconto)', cartao: 'Cartão ou boleto', combinar: 'Combinar (Pix pelo WhatsApp)' }[p.forma_pagamento] || ''),
    linha('Cupom', esc(p.cupom)),
    linha('Observações', p.observacoes ? `<span style="white-space:pre-line">${esc(p.observacoes)}</span>` : ''),
  ]);
}

// ---------- Pedidos ----------
eventos.on('pedido:criado', (p) => {
  const encomenda = p.origem === 'encomenda';
  avisar(`🛒 Novo pedido ${p.codigo} — ${brl(p.total_cents)}${p.status === 'aguardando_pagamento' ? ' (aguardando pagamento)' : ''}`,
    encomenda ? `Pedido ${p.codigo} criado a partir de encomenda` : `Novo pedido ${p.codigo}`,
    `<p>${encomenda ? 'Você gerou um pedido a partir de uma encomenda.' : 'Um cliente acabou de fazer um pedido na loja.'} ${p.status === 'aguardando_pagamento' ? `Ele ainda <b>não foi pago</b> — se não for pago em ${config.pedidoExpiraHoras}h, é cancelado sozinho.` : ''}</p>
     ${dadosCliente(p)}${tabelaItens(p)}`, painel('pedidos'));
});

const TITULOS_STATUS = {
  pago: (p) => [`💰 Pedido ${p.codigo} PAGO — ${brl(p.total_cents)}`, 'Pagamento confirmado!', 'O pagamento foi confirmado. Pode começar a produção.'],
  cancelado: (p) => [`❌ Pedido ${p.codigo} cancelado`, 'Pedido cancelado', 'O pedido foi cancelado e o estoque reservado voltou para a loja.'],
  enviado: (p) => [`📦 Pedido ${p.codigo} postado`, 'Pedido postado', `A transportadora registrou a postagem${p.rastreio ? ` (rastreio <b>${esc(p.rastreio)}</b>)` : ''}. O cliente foi avisado por e-mail.`],
  entregue: (p) => [`✅ Pedido ${p.codigo} entregue`, 'Pedido entregue', 'A entrega foi confirmada. O cliente recebeu um e-mail pedindo a avaliação.'],
};

eventos.on('pedido:status', ({ pedido: p, anterior, nota }) => {
  const doPainel = /painel/i.test(nota || '');
  const [assunto, titulo, texto] = (TITULOS_STATUS[p.status] || ((x) => [`🔄 Pedido ${x.codigo}: ${STATUS_PEDIDO[x.status]}`, `Pedido ${x.codigo} atualizado`, '']))(p);
  avisar(assunto + (doPainel ? ' (alterado por você)' : ''), titulo,
    `<p>${texto}</p>${tabela([
      linha('Pedido', `<b>${p.codigo}</b> · ${brl(p.total_cents)}`),
      linha('Status', `${esc(STATUS_PEDIDO[anterior] || anterior)} → <b>${esc(STATUS_PEDIDO[p.status])}</b>`),
      linha('Motivo', esc(String(nota || '').replace(/(bank_transfer|credit_card|debit_card|ticket|account_money|pix)/, (m) => metodo(m)))),
      linha('Mercado Pago', p.pagamento_metodo ? `${esc(metodo(p.pagamento_metodo))} — ${esc(SITUACAO_MP[p.pagamento_status] || p.pagamento_status)}` : ''),
    ])}${p.status === 'pago' ? dadosCliente(p) + tabelaItens(p) : ''}`, painel('pedidos'));
});

eventos.on('pagamento:recusado', ({ pedido: p, status, detalhe }) => {
  avisar(`⚠️ Pagamento recusado — pedido ${p.codigo}`, 'Tentativa de pagamento recusada',
    `<p>O cliente tentou pagar, mas o Mercado Pago recusou${detalhe ? ` (<i>${esc(detalhe)}</i>)` : ''}. Ele pode tentar de novo pela página do pedido — talvez valha chamar no WhatsApp.</p>
     ${tabela([linha('Pedido', `<b>${p.codigo}</b> · ${brl(p.total_cents)}`), linha('Situação', esc(SITUACAO_MP[status] || status))])}${dadosCliente(p)}`, painel('pedidos'));
});

// ---------- Encomendas, perguntas e avaliações ----------
eventos.on('encomenda:criada', (e) => {
  const arquivos = lerJson(e.arquivos);
  avisar(`🛠️ Nova encomenda ${e.codigo} — ${e.nome}`, `Pedido de orçamento ${e.codigo}`,
    `<p>Alguém pediu um orçamento de peça sob medida.</p>${tabela([
      linha('Cliente', `<b>${esc(e.nome)}</b>`),
      linha('WhatsApp', esc(e.telefone)), linha('E-mail', esc(e.email)),
      linha('Quantidade', String(e.quantidade)), linha('Cor', esc(e.cor)), linha('Precisa até', esc(e.prazo_desejado)),
      linha('Referência', e.link_referencia ? `<a href="${esc(e.link_referencia)}" style="color:#e10a14">${esc(e.link_referencia)}</a>` : ''),
      linha('Arquivos', arquivos.length ? arquivos.map((a) => esc(a.nome)).join(', ') + ' (baixe no painel)' : ''),
    ])}<p style="white-space:pre-line;background:#f4f4f5;padding:12px;border-radius:8px">${esc(e.descricao)}</p>`, painel('encomendas'));
});

eventos.on('pergunta:criada', ({ nome, email, pergunta, produto }) => {
  avisar(`❓ Pergunta sobre ${produto.nome}`, 'Nova pergunta no site',
    `<p><b>${esc(nome)}</b> (${esc(email)}) perguntou sobre <a href="${config.baseUrl}/produto/${esc(produto.slug)}" style="color:#e10a14">${esc(produto.nome)}</a>:</p>
     <blockquote style="border-left:4px solid #e10a14;margin:12px 0;padding:4px 12px;color:#3f3f46">${esc(pergunta)}</blockquote>
     <p>A pergunta só aparece no site depois que você responder.</p>`, { texto: 'Responder no painel', url: `${config.baseUrl}/admin#perguntas` });
});

eventos.on('avaliacao:criada', ({ nome, nota, produto, comentario, pedido }) => {
  avisar(`⭐ Nova avaliação ${nota}/5 — ${produto}`, 'Nova avaliação de cliente',
    `<p><b>${esc(nome)}</b> avaliou <b>${esc(produto)}</b>${pedido ? ` (pedido ${esc(pedido)})` : ''}:</p>
     <p style="font-size:22px;color:#f59e0b;margin:6px 0">${'★'.repeat(nota)}<span style="color:#d4d4d8">${'★'.repeat(5 - nota)}</span></p>
     ${comentario ? `<blockquote style="border-left:4px solid #e10a14;margin:12px 0;padding:4px 12px;color:#3f3f46">${esc(comentario)}</blockquote>` : ''}
     <p>Ela só aparece na loja depois que você aprovar.</p>`, { texto: 'Aprovar no painel', url: `${config.baseUrl}/admin#avaliacoes` });
});

// ---------- Clientes ----------
eventos.on('cliente:novo', ({ nome, email, pedidosAnteriores }) => {
  avisar(`👤 Novo cliente cadastrado — ${nome}`, 'Nova conta criada',
    `<p><b>${esc(nome)}</b> (${esc(email)}) criou uma conta na loja usando o Google.${pedidosAnteriores ? ` Ele já tinha <b>${pedidosAnteriores}</b> pedido(s) com este e-mail, que foram vinculados à conta.` : ''}</p>`, painel('clientes'));
});

// ---------- Estoque ----------
function verificarEstoque(ids, origem) {
  const avisados = lerAjuste('estoque_avisado', {});
  for (const id of new Set(ids)) {
    const p = db.prepare('SELECT id, nome, slug, estoque FROM produtos WHERE id = ?').get(id);
    if (!p || p.estoque === null) continue;
    if (p.estoque > 2) { delete avisados[id]; continue; }
    if (avisados[id] === p.estoque) continue; // já avisou deste mesmo nível
    avisados[id] = p.estoque;
    const esgotou = p.estoque === 0;
    if (esgotou) {
      avisarCelular(`🚨 PRODUTO ESGOTADO: ${p.nome}${origem ? `\nMotivo: ${origem}` : ''}\n${config.baseUrl}/admin#produtos`);
    }
    avisar(esgotou ? `🚨 Esgotou: ${p.nome}` : `📉 Estoque baixo: ${p.nome} (${p.estoque})`, esgotou ? 'Produto esgotado' : 'Estoque acabando',
      `<p><b>${esc(p.nome)}</b> ${esgotou ? 'esgotou e aparece como "Esgotado" na loja' : `tem só <b>${p.estoque}</b> unidade(s)`}${origem ? ` depois de ${origem}` : ''}. Hora de imprimir mais!</p>`, painel('produtos'));
  }
  salvarAjuste('estoque_avisado', avisados);
}
eventos.on('estoque:alterado', (ids) => verificarEstoque(ids, 'uma venda no site'));
eventos.on('estoque:alterado:ml', (ids) => verificarEstoque(ids, 'uma venda no Mercado Livre'));

eventos.on('ml:venda', ({ pedidoMl, itens }) => {
  avisar(`🟡 Venda no Mercado Livre — pedido ${pedidoMl}`, 'Venda no Mercado Livre',
    `<p>Uma venda no Mercado Livre baixou o estoque do site:</p><ul>${itens.map((i) => `<li>${i.quantidade}× ${esc(i.nome)} → restam <b>${i.restante}</b></li>`).join('')}</ul>`, painel('produtos'));
});

// ---------- Segurança ----------
eventos.on('config:alterada', ({ campos }) => {
  avisar('⚙️ Configurações da loja alteradas', 'Configurações alteradas',
    `<p>Foram alterados no painel:</p><ul>${campos.map((c) => `<li>${esc(c)}</li>`).join('')}</ul><p style="color:#71717a">Por segurança, os valores não aparecem neste e-mail.</p>`, painel('configuracoes'));
});

eventos.on('admin:senha', () => {
  avisar('🔑 Senha do painel alterada', 'Senha do painel alterada',
    '<p>A senha do painel administrativo foi trocada. As outras sessões abertas foram desconectadas.</p><p>Se <b>não foi você</b>, fale com o suporte da Hostinger e defina uma nova ADMIN_PASSWORD.</p>');
});

eventos.on('admin:login', ({ ip, navegador }) => {
  avisar('🔐 Acesso ao painel da loja', 'Alguém entrou no painel',
    `<p>Houve um login no painel administrativo.</p>${tabela([linha('IP', esc(ip)), linha('Navegador', esc(navegador))])}
     <p>Se <b>não foi você</b>, troque a senha (ADMIN_PASSWORD) e o SESSION_SECRET na Hostinger agora mesmo.</p>`);
});

eventos.on('admin:tentativas', ({ ip, tentativas }) => {
  avisar('🚨 Várias tentativas de senha no painel', 'Possível tentativa de invasão',
    `<p>Foram feitas <b>${tentativas}</b> tentativas de login com senha errada, a partir do IP <b>${esc(ip)}</b>. O acesso desse IP foi bloqueado por 15 minutos.</p>
     <p>Se não foi você, considere trocar a senha do painel.</p>`);
});
