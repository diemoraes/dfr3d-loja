// Avisos: e-mails para cliente e loja (Resend ou Brevo) e alertas no celular (Telegram / WhatsApp via CallMeBot)
import { config } from './config.js';
import { eventos } from './eventos.js';
import { lerJson, STATUS_PEDIDO } from './db.js';

const brl = (c) => ((c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const emailAtivo = () => Boolean((config.email.resendKey || config.email.brevoKey) && config.email.remetente);
export const celularAtivo = () => Boolean((config.telegram.token && config.telegram.chatId) || (config.callmebot.telefone && config.callmebot.apikey));

// ---------- Envio ----------
function separarRemetente(r) {
  const m = /^(.*)<(.+)>$/.exec(r);
  return m ? { name: m[1].trim(), email: m[2].trim() } : { name: config.loja.nome, email: r };
}

/** Envia um e-mail. anexos: [{ nome, conteudoBase64 }] */
export async function enviarEmail({ para, assunto, html, anexos = [] }) {
  if (!emailAtivo() || !para) return false;
  let res;
  if (config.email.resendKey) {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.email.resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.email.remetente, to: [para], subject: assunto, html, reply_to: config.contato.email || undefined,
        attachments: anexos.map((a) => ({ filename: a.nome, content: a.conteudoBase64 })) }),
      signal: AbortSignal.timeout(20000),
    });
  } else {
    res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': config.email.brevoKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sender: separarRemetente(config.email.remetente), to: [{ email: para }], subject: assunto, htmlContent: html,
        ...(config.contato.email ? { replyTo: { email: config.contato.email } } : {}),
        ...(anexos.length ? { attachment: anexos.map((a) => ({ name: a.nome, content: a.conteudoBase64 })) } : {}) }),
      signal: AbortSignal.timeout(20000),
    });
  }
  if (!res.ok) throw new Error(`E-mail não enviado (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return true;
}

/** Alerta no celular do dono da loja. */
export async function avisarCelular(texto) {
  const tarefas = [];
  if (config.telegram.token && config.telegram.chatId) {
    tarefas.push(fetch(`https://api.telegram.org/bot${config.telegram.token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.telegram.chatId, text: texto, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15000),
    }));
  }
  if (config.callmebot.telefone && config.callmebot.apikey) {
    const q = new URLSearchParams({ phone: config.callmebot.telefone, text: texto, apikey: config.callmebot.apikey });
    tarefas.push(fetch(`https://api.callmebot.com/whatsapp.php?${q}`, { signal: AbortSignal.timeout(15000) }));
  }
  const r = await Promise.allSettled(tarefas);
  r.filter((x) => x.status === 'rejected').forEach((x) => console.error('Aviso celular:', x.reason?.message));
}

// ---------- Modelo visual dos e-mails ----------
function modelo(titulo, corpo, botao) {
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">
    <tr><td style="background:#070708;padding:22px;text-align:center"><img src="${config.baseUrl}/img/logo.png" alt="${esc(config.loja.nome)}" width="180" style="display:inline-block;max-width:180px"></td></tr>
    <tr><td style="height:4px;background:linear-gradient(90deg,#ffffff 0 38%,#e10a14 38%);background-color:#e10a14"></td></tr>
    <tr><td style="padding:28px 28px 8px"><h1 style="margin:0 0 14px;font-size:22px;font-style:italic;text-transform:uppercase">${titulo}</h1>${corpo}</td></tr>
    ${botao ? `<tr><td style="padding:8px 28px 28px"><a href="${esc(botao.url)}" style="display:inline-block;background:#e10a14;color:#fff;text-decoration:none;font-weight:bold;padding:13px 24px;border-radius:10px;text-transform:uppercase;font-style:italic">${esc(botao.texto)}</a></td></tr>` : ''}
    <tr><td style="padding:18px 28px;background:#fafafa;color:#71717a;font-size:12px;line-height:1.6">
      ${esc(config.loja.nome)} · ${esc(config.loja.cidade)}<br>
      ${config.contato.whatsapp ? `WhatsApp: <a href="https://wa.me/${config.contato.whatsapp}" style="color:#e10a14">${config.contato.whatsapp}</a> · ` : ''}<a href="${config.baseUrl}" style="color:#e10a14">${config.baseUrl.replace(/^https?:\/\//, '')}</a>
    </td></tr>
  </table></td></tr></table></body></html>`;
}

function tabelaItens(p) {
  const itens = lerJson(p.itens);
  const linhas = itens.map((i) => `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">${i.quantidade}× ${esc(i.nome)}${[i.variacao, i.cor, i.personalizacao && `"${i.personalizacao}"`].filter(Boolean).map((x) => ` · ${esc(x)}`).join('')}</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${brl(i.preco_cents * i.quantidade)}</td></tr>`).join('');
  return `<table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:14px 0">${linhas}
    ${p.desconto_cents ? `<tr><td style="padding:6px 0">Descontos${p.cupom ? ` (cupom ${esc(p.cupom)})` : ''}</td><td style="text-align:right">- ${brl(p.desconto_cents)}</td></tr>` : ''}
    <tr><td style="padding:6px 0">${esc(p.entrega_servico)}</td><td style="text-align:right">${p.frete_cents ? brl(p.frete_cents) : 'Grátis'}</td></tr>
    <tr><td style="padding:8px 0;font-weight:bold;font-size:16px">Total</td><td style="text-align:right;font-weight:bold;font-size:16px">${brl(p.total_cents)}</td></tr></table>`;
}

const primeiroNome = (n) => esc(String(n).split(' ')[0]);
const linkPedido = (p) => `${config.baseUrl}/pedido/${p.codigo}`;

const MENSAGENS_CLIENTE = {
  pago: (p) => [`Pagamento confirmado — pedido ${p.codigo}`, 'Pagamento confirmado! 🔥',
    `<p>Oi, ${primeiroNome(p.cliente_nome)}! Recebemos o pagamento do seu pedido <b>${p.codigo}</b>. Agora é com a gente: sua peça vai para a impressora.</p>${tabelaItens(p)}`],
  em_producao: (p) => [`Seu pedido ${p.codigo} está sendo impresso`, 'Na impressora!',
    `<p>Oi, ${primeiroNome(p.cliente_nome)}! Seu pedido <b>${p.codigo}</b> já está sendo produzido, camada por camada.</p>`],
  pronto_retirada: (p) => [`Pedido ${p.codigo} pronto para retirada`, 'Pronto para retirar!',
    `<p>Oi, ${primeiroNome(p.cliente_nome)}! Seu pedido <b>${p.codigo}</b> está pronto.</p><p><b>Retirada:</b> ${esc(config.retirada.endereco)}</p><p>Combine o melhor horário pelo WhatsApp.</p>`],
  enviado: (p) => [`Pedido ${p.codigo} enviado`, 'Seu pedido foi enviado!',
    `<p>Oi, ${primeiroNome(p.cliente_nome)}! Seu pedido <b>${p.codigo}</b> foi postado (${esc(p.entrega_servico)}).</p>${p.rastreio ? `<p>Código de rastreio: <b>${esc(p.rastreio)}</b><br><a href="https://www.melhorrastreio.com.br/rastreio/${encodeURIComponent(p.rastreio)}" style="color:#e10a14">Acompanhar entrega</a></p>` : ''}`],
  entregue: (p) => [`Conta pra gente: o que achou do pedido ${p.codigo}?`, 'Chegou! O que achou?',
    `<p>Oi, ${primeiroNome(p.cliente_nome)}! Esperamos que tenha curtido sua peça. Sua avaliação ajuda muito a nossa oficina — leva menos de 1 minuto.</p>`, 'Avaliar minha compra'],
  cancelado: (p) => [`Pedido ${p.codigo} cancelado`, 'Pedido cancelado',
    `<p>Oi, ${primeiroNome(p.cliente_nome)}. O pedido <b>${p.codigo}</b> foi cancelado${p.pagamento_status ? '' : ' porque o pagamento não foi concluído a tempo'}. Se quiser, é só fazer um novo pedido na loja ou chamar a gente no WhatsApp.</p>`],
};

// ---------- Eventos ----------
eventos.on('pedido:criado', async (p) => {
  const pago = p.status !== 'aguardando_pagamento';
  await Promise.allSettled([
    enviarEmail({
      para: p.cliente_email, assunto: `Recebemos seu pedido ${p.codigo}`,
      html: modelo('Pedido recebido!', `<p>Oi, ${primeiroNome(p.cliente_nome)}! Recebemos seu pedido <b>${p.codigo}</b>.${pago ? '' : ' Assim que o pagamento for confirmado, começamos a produção.'}</p>${tabelaItens(p)}`,
        { texto: !pago && p.link_pagamento ? 'Pagar agora' : 'Acompanhar pedido', url: !pago && p.link_pagamento ? p.link_pagamento : linkPedido(p) }),
    }),
    enviarEmail({
      para: config.email.admin, assunto: `🛒 Novo pedido ${p.codigo} — ${brl(p.total_cents)} (aguardando pagamento)`,
      html: modelo(`Novo pedido ${p.codigo}`, `<p><b>${esc(p.cliente_nome)}</b> · ${esc(p.cliente_telefone)} · ${esc(p.cliente_email)}</p>${tabelaItens(p)}`, { texto: 'Abrir painel', url: `${config.baseUrl}/admin#pedidos` }),
    }),
  ]).then((r) => r.filter((x) => x.status === 'rejected').forEach((x) => console.error(x.reason.message)));
});

eventos.on('pedido:status', async ({ pedido: p, anterior }) => {
  const tarefas = [];
  const msg = MENSAGENS_CLIENTE[p.status];
  if (msg && anterior !== p.status) {
    const [assunto, titulo, corpo, textoBotao] = msg(p);
    const botao = { texto: textoBotao || 'Ver meu pedido', url: p.status === 'entregue' ? `${linkPedido(p)}#avaliar` : linkPedido(p) };
    tarefas.push(enviarEmail({ para: p.cliente_email, assunto, html: modelo(titulo, corpo, botao) }));
  }
  if (p.status === 'pago') {
    const itens = lerJson(p.itens).map((i) => `• ${i.quantidade}x ${i.nome}${[i.variacao, i.cor, i.personalizacao && `"${i.personalizacao}"`].filter(Boolean).map((x) => ` / ${x}`).join('')}`).join('\n');
    tarefas.push(avisarCelular(`💰 PEDIDO PAGO ${p.codigo} — ${brl(p.total_cents)}\n${p.cliente_nome}\n${itens}\n${p.entrega_tipo === 'retirada' ? '📍 Retirada' : `📦 ${p.entrega_servico} → ${p.cidade}/${p.uf}`}\n${config.baseUrl}/admin#pedidos`));
    tarefas.push(enviarEmail({ para: config.email.admin, assunto: `💰 Pedido ${p.codigo} PAGO — ${brl(p.total_cents)}`,
      html: modelo(`Pedido ${p.codigo} pago`, `<p><b>${esc(p.cliente_nome)}</b> · ${esc(p.cliente_telefone)}</p>${tabelaItens(p)}`, { texto: 'Abrir painel', url: `${config.baseUrl}/admin#pedidos` }) }));
  }
  const r = await Promise.allSettled(tarefas);
  r.filter((x) => x.status === 'rejected').forEach((x) => console.error(x.reason.message));
});

eventos.on('encomenda:criada', async (e) => {
  const r = await Promise.allSettled([
    avisarCelular(`🛠️ NOVA ENCOMENDA ${e.codigo}\n${e.nome} · ${e.telefone}\n${e.descricao.slice(0, 200)}\nQtd: ${e.quantidade}\n${config.baseUrl}/admin#encomendas`),
    enviarEmail({ para: config.email.admin, assunto: `🛠️ Nova encomenda ${e.codigo} — ${e.nome}`,
      html: modelo(`Encomenda ${e.codigo}`, `<p><b>${esc(e.nome)}</b> · ${esc(e.telefone)} · ${esc(e.email)}</p><p style="white-space:pre-line">${esc(e.descricao)}</p><p>Quantidade: ${e.quantidade}${e.cor ? ` · Cor: ${esc(e.cor)}` : ''}</p>`, { texto: 'Ver no painel', url: `${config.baseUrl}/admin#encomendas` }) }),
    enviarEmail({ para: e.email, assunto: `Recebemos seu pedido de orçamento ${e.codigo}`,
      html: modelo('Orçamento solicitado!', `<p>Oi, ${primeiroNome(e.nome)}! Recebemos seu pedido de orçamento <b>${e.codigo}</b>. Vamos analisar e responder pelo WhatsApp ou por e-mail com valor e prazo.</p><p style="white-space:pre-line;color:#52525b">${esc(e.descricao)}</p>`) }),
  ]);
  r.filter((x) => x.status === 'rejected').forEach((x) => console.error(x.reason.message));
});

eventos.on('avaliacao:criada', async ({ nome, nota, produto }) => {
  await avisarCelular(`⭐ Nova avaliação (${nota}/5) de ${nome} em "${produto}". Aprove no painel: ${config.baseUrl}/admin#avaliacoes`);
});

eventos.on('pergunta:criada', async ({ nome, email, pergunta, produto }) => {
  const r = await Promise.allSettled([
    avisarCelular(`❓ NOVA PERGUNTA em "${produto.nome}"\n${nome}: ${pergunta.slice(0, 300)}\nResponder: ${config.baseUrl}/admin#perguntas`),
    enviarEmail({ para: config.email.admin, assunto: `❓ Pergunta sobre ${produto.nome}`,
      html: modelo('Nova pergunta', `<p><b>${esc(nome)}</b> (${esc(email)}) perguntou sobre <a href="${config.baseUrl}/produto/${esc(produto.slug)}" style="color:#e10a14">${esc(produto.nome)}</a>:</p><blockquote style="border-left:4px solid #e10a14;margin:12px 0;padding:4px 12px;color:#3f3f46">${esc(pergunta)}</blockquote>`, { texto: 'Responder no painel', url: `${config.baseUrl}/admin#perguntas` }) }),
  ]);
  r.filter((x) => x.status === 'rejected').forEach((x) => console.error(x.reason.message));
});

eventos.on('pergunta:respondida', async (q) => {
  await enviarEmail({ para: q.email, assunto: `Respondemos sua pergunta sobre ${q.produto.nome}`,
    html: modelo('Sua pergunta foi respondida!', `<p>Oi, ${primeiroNome(q.nome)}! Você perguntou sobre <b>${esc(q.produto.nome)}</b>:</p>
      <p style="color:#52525b;font-style:italic">“${esc(q.pergunta)}”</p><p><b>Resposta da DFR 3D:</b><br>${esc(q.resposta).replace(/\n/g, '<br>')}</p>`,
      { texto: 'Ver o produto', url: `${config.baseUrl}/produto/${q.produto.slug}#perguntas` }) }).catch((e) => console.error(e.message));
});

export { modelo, STATUS_PEDIDO };
