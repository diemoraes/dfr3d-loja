// Conta do cliente: login com Google (OAuth 2.0 + PKCE), "Minha conta", pedidos e rastreio
import crypto from 'node:crypto';
import { config } from './config.js';
import { db, lerJson, STATUS_PEDIDO, STATUS_ENCOMENDA } from './db.js';
import { sendJson, readJson, redirect, parseCookies, HttpError, limpar, soDigitos, exigir } from './http.js';
import { assinar, iguais } from './auth.js';
import { buscarRastreio, STATUS_ENVIO } from './etiqueta.js';
import { emitir } from './eventos.js';

const COOKIE = 'dfr_cliente';
const COOKIE_OAUTH = 'dfr_oauth';
const DURACAO_S = 60 * 60 * 24 * 30; // 30 dias logado
const seguro = () => (config.baseUrl.startsWith('https') ? '; Secure' : '');
const redirectUri = () => `${config.baseUrl}/api/conta/google/callback`;

export const googleAtivo = () => Boolean(config.google.clientId && config.google.clientSecret && config.sessionSecret);

// ---------- Sessão ----------
function cookieSessao(clienteId) {
  const expira = Date.now() + DURACAO_S * 1000;
  const dados = `${clienteId}.${expira}`;
  return `${COOKIE}=${dados}.${assinar('cliente:' + dados)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${DURACAO_S}${seguro()}`;
}
const cookieSair = () => `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${seguro()}`;

/** Retorna o cliente logado ou null. */
export function clienteLogado(req) {
  if (!config.sessionSecret) return null;
  const v = parseCookies(req)[COOKIE];
  if (!v) return null;
  const [id, expira, assinatura] = v.split('.');
  if (!id || !expira || !assinatura || Number(expira) < Date.now()) return null;
  if (!iguais(assinatura, assinar(`cliente:${id}.${expira}`))) return null;
  return db.prepare('SELECT * FROM clientes WHERE id = ?').get(Number(id)) || null;
}

function exigirCliente(req) {
  const c = clienteLogado(req);
  if (!c) throw new HttpError(401, 'Entre na sua conta.');
  return c;
}

const voltarSeguro = (v) => (typeof v === 'string' && /^\/(?!\/)[\w\-/#?=&.%]*$/.test(v) ? v : '/conta');

function clientePublico(c) {
  return { nome: c.nome, primeiro_nome: c.nome.split(' ')[0], email: c.email, foto: c.foto, telefone: c.telefone, cpf: c.cpf,
    endereco: { cep: c.cep, endereco: c.endereco, numero: c.numero, complemento: c.complemento, bairro: c.bairro, cidade: c.cidade, uf: c.uf } };
}

/** Guarda os dados do último pedido na conta (para o próximo checkout já vir preenchido). */
export function salvarDadosDoPedido(clienteId, d) {
  db.prepare(`UPDATE clientes SET telefone = COALESCE(NULLIF(?, ''), telefone), cpf = COALESCE(NULLIF(?, ''), cpf),
    cep = COALESCE(NULLIF(?, ''), cep), endereco = COALESCE(NULLIF(?, ''), endereco), numero = COALESCE(NULLIF(?, ''), numero),
    complemento = ?, bairro = COALESCE(NULLIF(?, ''), bairro), cidade = COALESCE(NULLIF(?, ''), cidade), uf = COALESCE(NULLIF(?, ''), uf) WHERE id = ?`)
    .run(d.telefone || '', d.cpf || '', d.cep || '', d.endereco || '', d.numero || '', d.complemento || '', d.bairro || '', d.cidade || '', d.uf || '', clienteId);
}

/** Pedidos do cliente: os feitos logado e os antigos com o mesmo e-mail (o Google confirma o e-mail). */
function pedidosDoCliente(c) {
  return db.prepare('SELECT * FROM pedidos WHERE cliente_id = ? OR cliente_email = ? COLLATE NOCASE ORDER BY id DESC LIMIT 100').all(c.id, c.email);
}

const ETAPAS = ['aguardando_pagamento', 'pago', 'em_producao', 'enviado', 'entregue'];

function resumoPedido(p) {
  const itens = lerJson(p.itens);
  const etapas = p.entrega_tipo === 'retirada' ? ['aguardando_pagamento', 'pago', 'em_producao', 'pronto_retirada', 'entregue'] : ETAPAS;
  return {
    codigo: p.codigo, status: p.status, status_nome: STATUS_PEDIDO[p.status], criado_em: p.criado_em, total_cents: p.total_cents,
    entrega_tipo: p.entrega_tipo, entrega_servico: p.entrega_servico, rastreio: p.rastreio,
    rastreio_status: p.rastreio_status, rastreio_status_nome: STATUS_ENVIO[p.rastreio_status] || '', rastreio_verificado: p.rastreio_verificado,
    pode_atualizar_rastreio: Boolean(p.me_order_id),
    link_pagamento: p.status === 'aguardando_pagamento' ? p.link_pagamento : '',
    etapas: etapas.map((e) => ({ status: e, nome: STATUS_PEDIDO[e] })), etapa_atual: etapas.indexOf(p.status),
    itens: itens.map((i) => ({ nome: i.nome, quantidade: i.quantidade, imagem: i.imagem, detalhes: [i.variacao, i.cor, i.personalizacao && `“${i.personalizacao}”`].filter(Boolean).join(' · ') })),
  };
}

export function rotasConta(r) {
  r.get('/api/conta', (req, res) => {
    const c = clienteLogado(req);
    sendJson(res, 200, { google: googleAtivo(), logado: Boolean(c), cliente: c ? clientePublico(c) : null });
  });

  // 1) Manda o cliente para a tela de login do Google
  r.get('/api/conta/google', (req, res, { query }) => {
    if (!googleAtivo()) throw new HttpError(503, 'Login com Google ainda não configurado.');
    const state = crypto.randomBytes(16).toString('base64url');
    const verificador = crypto.randomBytes(32).toString('base64url');
    const desafio = crypto.createHash('sha256').update(verificador).digest('base64url');
    const voltar = voltarSeguro(query.get('voltar'));
    const valor = Buffer.from(JSON.stringify({ state, verificador, voltar, expira: Date.now() + 10 * 60_000 })).toString('base64url');
    res.setHeader('Set-Cookie', `${COOKIE_OAUTH}=${valor}.${assinar('oauth:' + valor)}; HttpOnly; SameSite=Lax; Path=/api/conta; Max-Age=600${seguro()}`);
    const q = new URLSearchParams({
      client_id: config.google.clientId, redirect_uri: redirectUri(), response_type: 'code', scope: 'openid email profile',
      state, code_challenge: desafio, code_challenge_method: 'S256', prompt: 'select_account',
    });
    redirect(res, `https://accounts.google.com/o/oauth2/v2/auth?${q}`);
  });

  // 2) O Google devolve o cliente aqui com um código; trocamos pelo perfil verificado
  r.get('/api/conta/google/callback', async (req, res, { query }) => {
    const falhar = (motivo) => { console.error('Login Google:', motivo); redirect(res, '/conta?erro=login'); };
    const bruto = parseCookies(req)[COOKIE_OAUTH] || '';
    const [valor, assinatura] = bruto.split('.');
    let sessao = null;
    if (valor && assinatura && iguais(assinatura, assinar('oauth:' + valor))) {
      try { sessao = JSON.parse(Buffer.from(valor, 'base64url').toString()); } catch {}
    }
    res.setHeader('Set-Cookie', `${COOKIE_OAUTH}=; HttpOnly; SameSite=Lax; Path=/api/conta; Max-Age=0${seguro()}`);
    if (query.get('error')) return redirect(res, '/conta');
    if (!sessao || sessao.expira < Date.now() || !query.get('state') || query.get('state') !== sessao.state || !query.get('code')) return falhar('state inválido');
    try {
      const tk = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code: query.get('code'), client_id: config.google.clientId, client_secret: config.google.clientSecret,
          redirect_uri: redirectUri(), grant_type: 'authorization_code', code_verifier: sessao.verificador }),
        signal: AbortSignal.timeout(15000),
      }).then((x) => x.json());
      if (!tk.access_token) return falhar(JSON.stringify(tk));
      const perfil = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${tk.access_token}` }, signal: AbortSignal.timeout(15000),
      }).then((x) => x.json());
      if (!perfil.sub || !perfil.email || perfil.email_verified === false) return falhar('e-mail não verificado');

      const email = perfil.email.toLowerCase();
      const nome = limpar(perfil.name || email.split('@')[0], 120);
      let c = db.prepare('SELECT * FROM clientes WHERE google_sub = ?').get(perfil.sub) || db.prepare('SELECT * FROM clientes WHERE email = ?').get(email);
      if (c) {
        db.prepare("UPDATE clientes SET google_sub = ?, email = ?, nome = ?, foto = ?, ultimo_login = datetime('now','localtime') WHERE id = ?")
          .run(perfil.sub, email, nome, limpar(perfil.picture, 500), c.id);
      } else {
        const info = db.prepare('INSERT INTO clientes (google_sub, email, nome, foto) VALUES (?,?,?,?)').run(perfil.sub, email, nome, limpar(perfil.picture, 500));
        c = { id: Number(info.lastInsertRowid) };
        // Puxa telefone/endereço do último pedido feito com este e-mail
        const ultimo = db.prepare('SELECT * FROM pedidos WHERE cliente_email = ? ORDER BY id DESC LIMIT 1').get(email);
        const anteriores = db.prepare('SELECT COUNT(*) n FROM pedidos WHERE cliente_email = ? COLLATE NOCASE').get(email).n;
        emitir('cliente:novo', { nome, email, pedidosAnteriores: anteriores });
        if (ultimo) salvarDadosDoPedido(c.id, { telefone: ultimo.cliente_telefone, cpf: ultimo.cliente_cpf, cep: ultimo.cep, endereco: ultimo.endereco, numero: ultimo.numero, complemento: ultimo.complemento, bairro: ultimo.bairro, cidade: ultimo.cidade, uf: ultimo.uf });
      }
      db.prepare('UPDATE pedidos SET cliente_id = ? WHERE cliente_id IS NULL AND cliente_email = ? COLLATE NOCASE').run(c.id, email);
      db.prepare('UPDATE encomendas SET cliente_id = ? WHERE cliente_id IS NULL AND email = ? COLLATE NOCASE').run(c.id, email);
      res.setHeader('Set-Cookie', [`${COOKIE_OAUTH}=; HttpOnly; SameSite=Lax; Path=/api/conta; Max-Age=0${seguro()}`, cookieSessao(c.id)]);
      redirect(res, voltarSeguro(sessao.voltar));
    } catch (e) { falhar(e.message); }
  });

  r.post('/api/conta/sair', (req, res) => sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookieSair() }));

  r.put('/api/conta', async (req, res) => {
    const c = exigirCliente(req);
    const b = await readJson(req);
    const cpf = soDigitos(b.cpf).slice(0, 11);
    exigir(!cpf || cpf.length === 11, 'CPF deve ter 11 números.');
    const e = b.endereco || {};
    db.prepare('UPDATE clientes SET telefone=?, cpf=?, cep=?, endereco=?, numero=?, complemento=?, bairro=?, cidade=?, uf=? WHERE id=?').run(
      soDigitos(b.telefone).slice(0, 13), cpf, soDigitos(e.cep).slice(0, 8), limpar(e.endereco, 160), limpar(e.numero, 20),
      limpar(e.complemento, 80), limpar(e.bairro, 80), limpar(e.cidade, 80), limpar(e.uf, 2).toUpperCase(), c.id);
    sendJson(res, 200, clientePublico(db.prepare('SELECT * FROM clientes WHERE id = ?').get(c.id)));
  });

  // LGPD: o cliente pode apagar a conta (os pedidos continuam guardados pela obrigação fiscal, mas sem vínculo)
  r.delete('/api/conta', (req, res) => {
    const c = exigirCliente(req);
    db.prepare('UPDATE pedidos SET cliente_id = NULL WHERE cliente_id = ?').run(c.id);
    db.prepare('UPDATE encomendas SET cliente_id = NULL WHERE cliente_id = ?').run(c.id);
    db.prepare('DELETE FROM clientes WHERE id = ?').run(c.id);
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookieSair() });
  });

  r.get('/api/conta/pedidos', (req, res) => {
    const c = exigirCliente(req);
    const encomendas = db.prepare('SELECT * FROM encomendas WHERE cliente_id = ? OR email = ? COLLATE NOCASE ORDER BY id DESC LIMIT 50').all(c.id, c.email)
      .map((e) => ({ codigo: e.codigo, status: e.status, status_nome: STATUS_ENCOMENDA[e.status], descricao: e.descricao, criado_em: e.criado_em,
        valor_cents: ['orcada', 'aprovada'].includes(e.status) ? e.valor_cents : null, pedido_codigo: e.pedido_codigo }));
    sendJson(res, 200, { pedidos: pedidosDoCliente(c).map(resumoPedido), encomendas });
  });

  // Rastreio atualizado na hora, a pedido do cliente (limitado a 1 consulta a cada 10 min por pedido)
  r.post('/api/conta/pedidos/:codigo/rastreio', async (req, res, { params }) => {
    const c = exigirCliente(req);
    const p = db.prepare('SELECT * FROM pedidos WHERE codigo = ? AND (cliente_id = ? OR cliente_email = ? COLLATE NOCASE)').get(params.codigo.toUpperCase(), c.id, c.email);
    if (!p) throw new HttpError(404, 'Pedido não encontrado.');
    const recente = p.rastreio_verificado && Date.now() - new Date(p.rastreio_verificado.replace(' ', 'T') + '-03:00').getTime() < 10 * 60_000;
    if (p.me_order_id && !recente) await buscarRastreio(p).catch((e) => console.error('Rastreio cliente:', e.message));
    sendJson(res, 200, resumoPedido(db.prepare('SELECT * FROM pedidos WHERE id = ?').get(p.id)));
  });
}
