// Painel administrativo da DFR 3D: pedidos, produtos e encomendas
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const brl = (c) => ((c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const reaisTexto = (c) => (c === null || c === undefined ? '' : (c / 100).toFixed(2).replace('.', ','));
  const data = (s) => (s ? new Date(s.replace(' ', 'T')).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
  const foto = (src) => (src ? `<img src="${esc(src)}" alt="">` : '<div class="placeholder">3D</div>');
  const whatsLink = (tel, texto) => { const d = String(tel || '').replace(/\D/g, ''); return d ? `https://wa.me/${d.length <= 11 ? '55' + d : d}?text=${encodeURIComponent(texto)}` : ''; };
  const extensao = (nome) => String(nome ?? '').split('.').pop().toLowerCase();

  async function api(caminho, opcoes = {}) {
    const res = await fetch(caminho, { ...opcoes, headers: { 'Content-Type': 'application/json' },
      body: opcoes.body && typeof opcoes.body !== 'string' ? JSON.stringify(opcoes.body) : opcoes.body });
    const d = await res.json().catch(() => ({}));
    if (res.status === 401 && !caminho.endsWith('/login')) { telaLogin(); throw new Error('Sessão expirada.'); }
    if (!res.ok) throw new Error(d.erro || 'Erro inesperado.');
    return d;
  }

  function toast(msg) {
    let t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.append(t); }
    t.innerHTML = esc(msg); t.classList.add('visivel');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('visivel'), 3000);
  }

  // ---------- Gaveta ----------
  const abrirGaveta = (html) => { $('#gaveta-conteudo').innerHTML = html; $('#gaveta').classList.add('aberta'); $('#fundo').classList.add('aberta'); $('#gaveta').scrollTop = 0; };
  const fecharGaveta = () => { $('#gaveta').classList.remove('aberta'); $('#fundo').classList.remove('aberta'); };
  $('#fechar').onclick = fecharGaveta; $('#fundo').onclick = fecharGaveta;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharGaveta(); });

  // ---------- Login ----------
  function telaLogin() {
    $('#app').innerHTML = `<div class="login"><form class="caixa" id="form-login">
      <img src="/img/logo-transparente.png" alt="DFR 3D Impressão">
      <div id="erro-login"></div>
      <div class="campo"><label for="senha">Senha do painel</label><input id="senha" type="password" autocomplete="current-password" autofocus></div>
      <div class="campo" id="captcha"><p class="suave" style="font-size:.85rem">Carregando verificação…</p></div>
      <button class="btn bloco"><span>Entrar</span></button></form></div>`;
    let captcha = { tipo: 'imagem' }, tokenTurnstile = '';
    async function carregarCaptcha() {
      captcha = await api('/api/admin/captcha').catch(() => ({ tipo: 'erro' }));
      const el = $('#captcha');
      if (captcha.tipo === 'turnstile') {
        el.innerHTML = '<div id="cf-turnstile"></div>';
        const montar = () => window.turnstile.render('#cf-turnstile', { sitekey: captcha.site_key, theme: 'dark', language: 'pt-br',
          callback: (t) => { tokenTurnstile = t; }, 'expired-callback': () => { tokenTurnstile = ''; } });
        if (window.turnstile) montar();
        else { const sc = document.createElement('script'); sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; sc.async = true; sc.onload = montar; document.head.append(sc); }
      } else if (captcha.tipo === 'imagem') {
        el.innerHTML = `<label for="captcha-resp">Digite o código da imagem</label>
          <div style="display:flex;gap:.6rem;align-items:center;margin-bottom:.5rem">
            <img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(captcha.svg)}" alt="Código de verificação" width="200" height="64" style="border-radius:10px;border:1px solid var(--linha)">
            <button type="button" class="btn pequeno contorno" id="novo-captcha" title="Gerar outro código" aria-label="Gerar outro código"><span>↻</span></button>
          </div>
          <input id="captcha-resp" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="8" placeholder="5 letras/números" style="text-transform:uppercase;letter-spacing:.2em">`;
        $('#novo-captcha').onclick = carregarCaptcha;
      } else {
        el.innerHTML = '<div class="aviso erro">Não foi possível carregar a verificação. Recarregue a página.</div>';
      }
    }
    carregarCaptcha();
    $('#form-login').onsubmit = async (e) => {
      e.preventDefault();
      const corpo = { senha: $('#senha').value };
      if (captcha.tipo === 'turnstile') corpo.turnstile = tokenTurnstile;
      else { corpo.captcha_token = captcha.token; corpo.captcha_resposta = $('#captcha-resp')?.value; }
      try { await api('/api/admin/login', { method: 'POST', body: corpo }); iniciar(); }
      catch (err) {
        $('#erro-login').innerHTML = `<div class="aviso erro">${esc(err.message)}</div>`;
        if (captcha.tipo === 'turnstile') { window.turnstile?.reset(); tokenTurnstile = ''; } else carregarCaptcha();
      }
    };
  }

  let aba = location.hash.slice(1).split('?')[0] || 'resumo';
  const avisoHash = new URLSearchParams(location.hash.split('?')[1] || '');
  let pagamentoOnline = false, etiquetaAtiva = false;

  async function iniciar() {
    const me = await api('/api/admin/me');
    if (!me.logado) return telaLogin();
    pagamentoOnline = me.pagamento_online; etiquetaAtiva = me.etiqueta;
    $('#app').innerHTML = `<div class="admin">
      <aside>
        <img src="/img/logo-transparente.png" alt="DFR 3D">
        <button data-aba="resumo">Resumo</button>
        <button data-aba="pedidos">Pedidos <span class="badge" id="b-pedidos" hidden></span></button>
        <button data-aba="encomendas">Encomendas <span class="badge" id="b-encomendas" hidden></span></button>
        <button data-aba="perguntas">Perguntas <span class="badge" id="b-perguntas" hidden></span></button>
        <button data-aba="produtos">Produtos</button>
        <button data-aba="clientes">Clientes</button>
        <button data-aba="blog">Blog</button>
        <button data-aba="site">Página inicial</button>
        <button data-aba="cupons">Cupons</button>
        <button data-aba="avaliacoes">Avaliações <span class="badge" id="b-avaliacoes" hidden></span></button>
        <button data-aba="integracoes">Integrações</button>
        <button data-aba="configuracoes">⚙️ Configurações</button>
        <div class="rodape-menu"><a href="/" target="_blank">Ver loja ↗</a><a href="#" id="sair">Sair</a></div>
      </aside>
      <section class="conteudo" id="conteudo"></section></div>`;
    $('aside').onclick = (e) => { const b = e.target.closest('[data-aba]'); if (b) irPara(b.dataset.aba); };
    $('#sair').onclick = async (e) => { e.preventDefault(); await api('/api/admin/logout', { method: 'POST' }); telaLogin(); };
    irPara(aba);
  }

  function irPara(nova) {
    aba = nova; location.hash = nova;
    document.querySelectorAll('aside [data-aba]').forEach((b) => b.classList.toggle('ativo', b.dataset.aba === nova));
    ({ resumo, pedidos, encomendas, perguntas, produtos, clientes, blog, site, cupons, avaliacoes, integracoes, configuracoes }[nova] || resumo)().catch?.((e) => toast(e.message));
  }

  async function atualizarBadges() {
    const r = await api('/api/admin/resumo');
    const pagos = r.porStatus.pago || 0;
    const bp = $('#b-pedidos'); if (bp) { bp.hidden = !pagos; bp.textContent = pagos; }
    const be = $('#b-encomendas'); if (be) { be.hidden = !r.encomendasNovas; be.textContent = r.encomendasNovas; }
    const bq = $('#b-perguntas'); if (bq) { bq.hidden = !r.perguntasPendentes; bq.textContent = r.perguntasPendentes; }
    const ba = $('#b-avaliacoes'); if (ba) { ba.hidden = !r.avaliacoesPendentes; ba.textContent = r.avaliacoesPendentes; }
    return r;
  }

  // ---------- Resumo ----------
  async function resumo() {
    const c = $('#conteudo');
    c.innerHTML = '<p class="carregando">Carregando…</p>';
    const r = await atualizarBadges();
    const n = (s) => r.porStatus[s] || 0;
    c.innerHTML = `
      <div class="cabecalho"><h1>Resumo</h1></div>
      ${pagamentoOnline ? '' : '<div class="aviso">Mercado Pago ainda não configurado: os pedidos ficam "Aguardando pagamento" e você confirma manualmente. Preencha MP_ACCESS_TOKEN para cobrar online.</div>'}
      <div class="cards-resumo">
        <div class="caixa"><div class="suave">Vendas no mês</div><div class="valor">${brl(r.vendasMes.total)}</div><div class="suave">${r.vendasMes.n} pedido(s)</div></div>
        <button class="caixa" data-ir="pedidos" data-status="pago"><div class="suave">Pagos — produzir</div><div class="valor vermelho">${n('pago')}</div></button>
        <button class="caixa" data-ir="pedidos" data-status="em_producao"><div class="suave">Em produção</div><div class="valor">${n('em_producao')}</div></button>
        <button class="caixa" data-ir="pedidos" data-status="aguardando_pagamento"><div class="suave">Aguardando pagamento</div><div class="valor">${n('aguardando_pagamento')}</div></button>
        <button class="caixa" data-ir="encomendas"><div class="suave">Encomendas novas</div><div class="valor vermelho">${r.encomendasNovas}</div></button>
        <button class="caixa" data-ir="perguntas"><div class="suave">Perguntas sem resposta</div><div class="valor vermelho">${r.perguntasPendentes}</div></button>
        <button class="caixa" data-ir="avaliacoes"><div class="suave">Avaliações para aprovar</div><div class="valor">${r.avaliacoesPendentes}</div></button>
      </div>
      ${r.estoqueBaixo.length ? `<div class="caixa"><h3>Estoque baixo</h3>${r.estoqueBaixo.map((p) => `<div>${esc(p.nome)}: <strong>${p.estoque}</strong></div>`).join('')}</div>` : ''}`;
    c.querySelectorAll('[data-ir]').forEach((b) => b.onclick = () => { filtroStatus = b.dataset.status || ''; irPara(b.dataset.ir); });
  }

  // ---------- Pedidos ----------
  let filtroStatus = '', buscaPedido = '';
  async function pedidos() {
    const c = $('#conteudo');
    const q = new URLSearchParams({ status: filtroStatus, busca: buscaPedido });
    const { pedidos: lista, statusNomes } = await api('/api/admin/pedidos?' + q);
    atualizarBadges();
    c.innerHTML = `
      <div class="cabecalho"><h1>Pedidos</h1>
        <div style="display:flex;gap:.6rem;flex-wrap:wrap">
          <input id="busca-p" placeholder="Buscar código, nome ou e-mail" value="${esc(buscaPedido)}" style="width:260px">
          <select id="filtro-p" style="width:auto"><option value="">Todos os status</option>${Object.entries(statusNomes).map(([k, v]) => `<option value="${k}" ${k === filtroStatus ? 'selected' : ''}>${v}</option>`).join('')}</select>
        </div></div>
      ${lista.length ? `<div class="tabela-wrap"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Itens</th><th>Entrega</th><th>Total</th><th>Status</th></tr></thead><tbody>
        ${lista.map((p) => `<tr data-id="${p.id}">
          <td><strong>${esc(p.codigo)}</strong><div class="suave" style="font-size:.8rem">${data(p.criado_em)}</div></td>
          <td>${esc(p.cliente_nome)}${p.origem === 'encomenda' ? ' <span class="suave">· encomenda</span>' : ''}</td>
          <td>${p.itens.reduce((s, i) => s + i.quantidade, 0)} item(ns)</td>
          <td>${p.entrega_tipo === 'retirada' ? 'Retirada' : esc(p.entrega_servico)}</td>
          <td><strong>${brl(p.total_cents)}</strong></td>
          <td><span class="status-pedido st-${p.status}">${esc(p.status_nome)}</span></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="caixa vazio"><p class="suave">Nenhum pedido por aqui ainda.</p></div>'}`;
    $('#filtro-p').onchange = (e) => { filtroStatus = e.target.value; pedidos(); };
    let t; $('#busca-p').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { buscaPedido = e.target.value; pedidos().then(() => { const i = $('#busca-p'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 350); };
    c.querySelectorAll('tbody tr').forEach((tr) => tr.onclick = () => abrirPedido(tr.dataset.id, statusNomes));
  }

  async function abrirPedido(id, statusNomes) {
    const p = await api('/api/admin/pedidos/' + id);
    const linkCliente = `${location.origin}/pedido/${p.codigo}`;
    const zap = whatsLink(p.cliente_telefone, `Olá ${p.cliente_nome.split(' ')[0]}! Aqui é da DFR 3D, sobre o seu pedido ${p.codigo}: ${linkCliente}`);
    const end = p.entrega_tipo === 'envio' ? `${esc(p.endereco)}, ${esc(p.numero)}${p.complemento ? ' - ' + esc(p.complemento) : ''}<br>${esc(p.bairro)} · ${esc(p.cidade)}/${esc(p.uf)} · CEP ${esc(p.cep)}` : 'Retirada no local';
    abrirGaveta(`
      <span class="etiqueta">Pedido</span><h2>${esc(p.codigo)}</h2>
      <p><span class="status-pedido st-${p.status}">${esc(p.status_nome)}</span> <span class="suave" style="font-size:.85rem">· ${data(p.criado_em)}</span></p>
      <dl class="dados">
        <dt>Cliente</dt><dd>${esc(p.cliente_nome)}</dd>
        <dt>E-mail</dt><dd><a href="mailto:${esc(p.cliente_email)}">${esc(p.cliente_email)}</a></dd>
        <dt>WhatsApp</dt><dd>${esc(p.cliente_telefone)} ${zap ? `· <a href="${zap}" target="_blank" rel="noopener">abrir conversa</a>` : ''}</dd>
        <dt>Pagamento</dt><dd>${p.forma_pagamento === 'pix' ? 'Pix (com desconto)' : p.forma_pagamento === 'cartao' ? 'Cartão/boleto' : 'Combinar (sem Mercado Pago)'}${p.cupom ? ` · cupom <b>${esc(p.cupom)}</b>` : ''}</dd>
        <dt>Entrega</dt><dd><strong>${esc(p.entrega_servico)}</strong><br>${end}</dd>
        ${p.observacoes ? `<dt>Observações</dt><dd style="white-space:pre-line">${esc(p.observacoes)}</dd>` : ''}
        ${p.mp_payment_id ? `<dt>Mercado Pago</dt><dd>Pagamento ${esc(p.mp_payment_id)} · ${esc(p.pagamento_status)} (${esc(p.pagamento_metodo)})</dd>` : ''}
      </dl>
      <div class="caixa" style="padding:1rem">
        <div class="mini-itens">${p.itens.map((i) => `<div class="item-carrinho"><div class="mini">${foto(i.imagem)}</div><div>${esc(i.nome)}${[i.variacao, i.cor].filter(Boolean).map((x) => ` <strong class="vermelho">· ${esc(x)}</strong>`).join('')}${i.personalizacao ? `<div>Personalização: <strong style="font-size:1.05rem">“${esc(i.personalizacao)}”</strong></div>` : ''}<div class="suave">${i.quantidade}× ${brl(i.preco_cents)}</div></div><span>${brl(i.preco_cents * i.quantidade)}</span></div>`).join('')}</div>
        <div class="resumo" style="position:static">
          ${p.desconto_cents ? `<div class="linha desconto"><span>Descontos</span><span>- ${brl(p.desconto_cents)}</span></div>` : ''}
          <div class="linha"><span>Frete</span><span>${brl(p.frete_cents)}</span></div>
          <div class="linha total"><span>Total</span><span>${brl(p.total_cents)}</span></div></div>
      </div>
      <form id="form-pedido" style="margin-top:1.2rem">
        <div class="linha-campos">
          <div class="campo"><label for="status">Status</label><select id="status">${Object.entries(statusNomes).map(([k, v]) => `<option value="${k}" ${k === p.status ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          <div class="campo"><label for="rastreio">Código de rastreio</label><input id="rastreio" value="${esc(p.rastreio)}" placeholder="Ex.: AA123456789BR"></div>
        </div>
        <div class="campo"><label for="cpf-cliente">CPF do cliente</label><input id="cpf-cliente" value="${esc(p.cliente_cpf)}" inputmode="numeric" placeholder="Necessário para a etiqueta"></div>
        <div class="campo"><label for="notas">Anotações internas (o cliente não vê)</label><textarea id="notas" style="min-height:70px">${esc(p.notas_internas)}</textarea></div>
        <div class="acoes-gaveta">
          <button class="btn"><span>Salvar</span></button>
          ${p.status === 'aguardando_pagamento' && pagamentoOnline ? '<button type="button" class="btn contorno" id="gerar-link"><span>Gerar link de pagamento</span></button>' : ''}
        </div>
      </form>
      ${p.link_pagamento && p.status === 'aguardando_pagamento' ? `<div class="campo" style="margin-top:1rem"><label>Link de pagamento</label><div class="copiar"><input readonly value="${esc(p.link_pagamento)}"><button type="button" class="btn pequeno contorno" data-copiar="${esc(p.link_pagamento)}"><span>Copiar</span></button></div></div>` : ''}
      ${p.entrega_tipo === 'envio' && !['aguardando_pagamento', 'cancelado'].includes(p.status) ? `<div class="caixa" style="padding:1.1rem;margin-top:1.2rem">
        <h3>Etiqueta de envio (Melhor Envio)</h3>
        ${p.rastreio_status ? `<p style="margin-top:0">Situação no Melhor Envio: <strong>${esc({ posted: 'Postado', delivered: 'Entregue', released: 'Etiqueta paga', generated: 'Etiqueta gerada', pending: 'Pendente', canceled: 'Cancelado', undelivered: 'Não entregue' }[p.rastreio_status] || p.rastreio_status)}</strong> <span class="suave" style="font-size:.85rem">· verificado ${data(p.rastreio_verificado)} · atualiza sozinho a cada 3h</span></p>` : ''}
        ${p.etiqueta_url ? `<div class="acoes-gaveta" style="margin-top:0"><a class="btn" href="${esc(p.etiqueta_url)}" target="_blank" rel="noopener"><span>Imprimir etiqueta</span></a><button type="button" class="btn contorno" id="buscar-rastreio"><span>Buscar rastreio</span></button></div>`
          : etiquetaAtiva ? `<p class="ajuda" style="margin-top:0">Compra o frete com o saldo da sua carteira no Melhor Envio. Confira as medidas da caixa.</p>
          <div class="linha-campos" style="--cols:5">
            <div class="campo"><label for="et-serv" class="suave">Serviço</label><input id="et-serv" value="${esc(String(p.entrega_servico_id || '').replace(/^me-/, ''))}" placeholder="1=PAC 2=SEDEX"></div>
            <div class="campo"><label for="et-peso" class="suave">Peso (g)</label><input id="et-peso" type="number" placeholder="auto"></div>
            <div class="campo"><label for="et-larg" class="suave">Larg.</label><input id="et-larg" type="number" placeholder="auto"></div>
            <div class="campo"><label for="et-alt" class="suave">Alt.</label><input id="et-alt" type="number" placeholder="auto"></div>
            <div class="campo"><label for="et-comp" class="suave">Comp.</label><input id="et-comp" type="number" placeholder="auto"></div>
          </div>
          <button type="button" class="btn" id="gerar-etiqueta"><span>Comprar e gerar etiqueta</span></button>`
          : '<p class="suave" style="margin:0">Configure o Melhor Envio e os dados do remetente (aba Integrações) para gerar etiquetas aqui.</p>'}
      </div>` : ''}
      <div class="campo" style="margin-top:1rem"><label>Link do cliente para acompanhar</label><div class="copiar"><input readonly value="${esc(linkCliente)}"><button type="button" class="btn pequeno contorno" data-copiar="${esc(linkCliente)}"><span>Copiar</span></button></div></div>
      <h3 style="margin-top:1.5rem">Histórico</h3>
      <ul class="linha-tempo">${p.historico.map((h) => `<li><strong>${esc(statusNomes[h.status] || h.status)}</strong> <span class="suave" style="font-size:.85rem">· ${data(h.criado_em)}${h.nota ? ' · ' + esc(h.nota) : ''}</span></li>`).join('')}</ul>`);

    $('#form-pedido').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('/api/admin/pedidos/' + p.id, { method: 'PUT', body: { status: $('#status').value, rastreio: $('#rastreio').value, notas_internas: $('#notas').value, cliente_cpf: $('#cpf-cliente').value } });
        toast('Pedido atualizado.'); fecharGaveta(); pedidos();
      } catch (err) { toast(err.message); }
    };
    $('#gerar-etiqueta')?.addEventListener('click', async (ev) => {
      if (!confirm('Comprar a etiqueta agora? O valor sai do saldo da sua carteira Melhor Envio.')) return;
      ev.currentTarget.disabled = true;
      try {
        await api(`/api/admin/pedidos/${p.id}/etiqueta`, { method: 'POST', body: { servico: $('#et-serv').value, volume: { peso_g: $('#et-peso').value, largura: $('#et-larg').value, altura: $('#et-alt').value, comprimento: $('#et-comp').value } } });
        toast('Etiqueta gerada!'); abrirPedido(p.id, statusNomes);
      } catch (err) { toast(err.message); ev.currentTarget.disabled = false; }
    });
    $('#buscar-rastreio')?.addEventListener('click', async () => {
      try { await api(`/api/admin/pedidos/${p.id}/rastreio`, { method: 'POST' }); toast('Rastreio atualizado.'); abrirPedido(p.id, statusNomes); }
      catch (err) { toast(err.message); }
    });
    $('#gerar-link')?.addEventListener('click', async () => {
      try { await api(`/api/admin/pedidos/${p.id}/link-pagamento`, { method: 'POST' }); abrirPedido(p.id, statusNomes); toast('Link gerado.'); }
      catch (err) { toast(err.message); }
    });
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-copiar]');
    if (b) navigator.clipboard.writeText(b.dataset.copiar).then(() => toast('Copiado!'));
    const v = e.target.closest('[data-visor3d]');
    if (v) window.Visor3D.abrir(v.dataset.visor3d, v.dataset.nome3d);
  });

  // ---------- Encomendas ----------
  async function encomendas() {
    const c = $('#conteudo');
    const { encomendas: lista, statusNomes } = await api('/api/admin/encomendas');
    atualizarBadges();
    c.innerHTML = `<div class="cabecalho"><h1>Encomendas</h1><a class="btn contorno pequeno" href="/encomenda" target="_blank"><span>Formulário ↗</span></a></div>
      ${lista.length ? `<div class="tabela-wrap"><table><thead><tr><th>Código</th><th>Cliente</th><th>Pedido</th><th>Qtd</th><th>Valor</th><th>Status</th></tr></thead><tbody>
        ${lista.map((e) => `<tr data-id="${e.id}"><td><strong>${esc(e.codigo)}</strong><div class="suave" style="font-size:.8rem">${data(e.criado_em)}</div></td>
          <td>${esc(e.nome)}</td><td style="max-width:320px">${esc(e.descricao.slice(0, 90))}${e.descricao.length > 90 ? '…' : ''}${e.arquivos.length ? ` <span class="suave">· 📎${e.arquivos.length}</span>` : ''}</td>
          <td>${e.quantidade}</td><td>${e.valor_cents !== null ? brl(e.valor_cents) : '—'}</td>
          <td><span class="status-pedido st-${e.status}">${esc(e.status_nome)}</span></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="caixa vazio"><p class="suave">Nenhuma encomenda ainda. Divulgue o link <strong>/encomenda</strong>!</p></div>'}`;
    c.querySelectorAll('tbody tr').forEach((tr) => tr.onclick = () => abrirEncomenda(lista.find((x) => x.id == tr.dataset.id), statusNomes));
  }

  function abrirEncomenda(e, statusNomes) {
    const primeiro = e.nome.split(' ')[0];
    abrirGaveta(`
      <span class="etiqueta">Encomenda</span><h2>${esc(e.codigo)}</h2>
      <dl class="dados">
        <dt>Cliente</dt><dd>${esc(e.nome)}</dd>
        <dt>E-mail</dt><dd><a href="mailto:${esc(e.email)}">${esc(e.email)}</a></dd>
        <dt>WhatsApp</dt><dd>${esc(e.telefone)} · <a href="${whatsLink(e.telefone, `Olá ${primeiro}! Aqui é da DFR 3D, sobre o seu pedido de orçamento ${e.codigo}.`)}" target="_blank" rel="noopener">abrir conversa</a></dd>
        <dt>Quantidade</dt><dd>${e.quantidade}</dd>
        ${e.cor ? `<dt>Cor</dt><dd>${esc(e.cor)}</dd>` : ''}
        ${e.prazo_desejado ? `<dt>Precisa até</dt><dd>${esc(e.prazo_desejado)}</dd>` : ''}
        ${e.link_referencia ? `<dt>Referência</dt><dd><a href="${esc(e.link_referencia)}" target="_blank" rel="noopener noreferrer">${esc(e.link_referencia)}</a></dd>` : ''}
        <dt>Descrição</dt><dd style="white-space:pre-line">${esc(e.descricao)}</dd>
        ${e.arquivos.length ? `<dt>Arquivos</dt><dd>${e.arquivos.map((a) => `<a href="/api/admin/arquivos/${encodeURIComponent(a.arquivo)}">${esc(a.nome)}</a> <span class="suave">(${(a.tamanho / 1048576).toFixed(1)} MB)</span>${window.Visor3D.extensoes.includes(extensao(a.nome)) ? ` · <button type="button" class="link-3d" data-visor3d="/api/admin/arquivos/${encodeURIComponent(a.arquivo)}" data-nome3d="${esc(a.nome)}">👁 Ver em 3D</button>` : ''}`).join('<br>')}</dd>` : ''}
        ${e.pedido_codigo ? `<dt>Pedido gerado</dt><dd><strong>${esc(e.pedido_codigo)}</strong></dd>` : ''}
      </dl>
      <form id="form-enc" class="caixa" style="padding:1.2rem">
        <h3>Orçamento</h3>
        <div class="linha-campos">
          <div class="campo"><label for="e-status">Status</label><select id="e-status">${Object.entries(statusNomes).map(([k, v]) => `<option value="${k}" ${k === e.status ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          <div class="campo"><label for="e-valor">Valor (R$)</label><input id="e-valor" inputmode="decimal" value="${reaisTexto(e.valor_cents)}" placeholder="0,00"></div>
        </div>
        <div class="campo"><label for="e-resp">Resposta / anotações</label><textarea id="e-resp" style="min-height:80px" placeholder="Prazo, material, observações…">${esc(e.resposta)}</textarea></div>
        <div class="acoes-gaveta"><button class="btn"><span>Salvar</span></button>
          <button type="button" class="btn contorno" id="enviar-orc"><span>Mandar orçamento no WhatsApp</span></button></div>
      </form>
      ${e.pedido_codigo ? '' : `
      <form id="form-gerar" class="caixa" style="padding:1.2rem;margin-top:1.2rem">
        <h3>Cliente aprovou? Gerar pedido${pagamentoOnline ? ' + link de pagamento' : ''}</h3>
        <div class="campo"><label for="g-titulo">Título do item</label><input id="g-titulo" value="${esc(e.descricao.slice(0, 60))}"></div>
        <div class="linha-campos" style="--cols:3">
          <div class="campo"><label for="g-valor">Valor da peça (R$)</label><input id="g-valor" inputmode="decimal" value="${reaisTexto(e.valor_cents)}"></div>
          <div class="campo"><label for="g-entrega">Entrega</label><select id="g-entrega"><option value="retirada">Retirada</option><option value="envio">Envio</option></select></div>
          <div class="campo"><label for="g-frete">Frete (R$)</label><input id="g-frete" inputmode="decimal" placeholder="0,00"></div>
        </div>
        <p class="ajuda">O frete de encomendas é informado por você (calcule no Melhor Envio e cole o valor). O endereço pode ser combinado pelo WhatsApp.</p>
        <button class="btn"><span>Gerar pedido</span></button>
        <div id="resultado-gerar"></div>
      </form>`}`);

    $('#form-enc').onsubmit = async (ev) => {
      ev.preventDefault();
      try { await api('/api/admin/encomendas/' + e.id, { method: 'PUT', body: { status: $('#e-status').value, valor: $('#e-valor').value, resposta: $('#e-resp').value } }); toast('Encomenda salva.'); encomendas(); }
      catch (err) { toast(err.message); }
    };
    $('#enviar-orc').onclick = () => {
      const v = $('#e-valor').value;
      const txt = `Olá ${primeiro}! Aqui é da DFR 3D 🔥\nSegue o orçamento do pedido ${e.codigo}:\n\n${e.descricao.slice(0, 200)}\nQuantidade: ${e.quantidade}\nValor: R$ ${v || '—'}\n${$('#e-resp').value ? '\n' + $('#e-resp').value + '\n' : ''}\nSe aprovar, te mando o link de pagamento (Pix ou cartão).`;
      window.open(whatsLink(e.telefone, txt), '_blank', 'noopener');
      if (e.status === 'nova') { $('#e-status').value = 'orcada'; $('#form-enc').requestSubmit(); }
    };
    $('#form-gerar')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        const r = await api(`/api/admin/encomendas/${e.id}/gerar-pedido`, { method: 'POST', body: { titulo: $('#g-titulo').value, valor: $('#g-valor').value, frete: $('#g-frete').value, entrega_tipo: $('#g-entrega').value } });
        const link = r.link_pagamento || `${location.origin}/pedido/${r.codigo}`;
        const zap = whatsLink(e.telefone, `Olá ${primeiro}! Seu pedido ${r.codigo} foi criado. ${r.link_pagamento ? 'Para pagar (Pix ou cartão), é só acessar' : 'Acompanhe aqui'}: ${link}`);
        $('#resultado-gerar').innerHTML = `<div class="aviso ok" style="margin-top:1rem">Pedido <strong>${esc(r.codigo)}</strong> criado.</div>
          <div class="copiar"><input readonly value="${esc(link)}"><button type="button" class="btn pequeno contorno" data-copiar="${esc(link)}"><span>Copiar</span></button></div>
          <a class="btn verde" style="margin-top:1rem" href="${zap}" target="_blank" rel="noopener"><span>Enviar no WhatsApp</span></a>`;
        encomendas();
      } catch (err) { toast(err.message); }
    });
  }

  // ---------- Produtos ----------
  const normalizarBusca = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const linhaProduto = (p) => `<tr data-id="${p.id}"><td><div class="mini-foto">${foto(p.imagens[0])}</div></td>
      <td><strong>${esc(p.nome)}</strong>${p.destaque ? ' <span class="vermelho">★</span>' : ''}${p.cores.length ? `<div class="suave" style="font-size:.8rem">${esc(p.cores.join(', '))}</div>` : ''}</td>
      <td>${esc(p.categoria)}</td><td>${p.promo_pct ? `<s class="suave">${brl(p.preco_original_cents)}</s> <strong style="color:#4ade80">${brl(p.preco_cents)}</strong>` : brl(p.preco_cents)}</td>
      <td>${p.sob_demanda ? '<span class="suave">sob demanda</span>' : p.estoque}</td>
      <td>${p.ativo ? 'À venda' : '<span class="suave">Oculto</span>'}</td></tr>`;

  async function produtos() {
    const c = $('#conteudo');
    const lista = await api('/api/admin/produtos');
    let termo = '', pagina = 1;
    let tamanho = Number(localStorage.getItem('admin-produtos-tam')) || 20;
    if (![10, 20, 50, 100].includes(tamanho)) tamanho = 20;

    const filtrados = () => {
      if (!termo.trim()) return lista;
      const t = normalizarBusca(termo);
      return lista.filter((p) => normalizarBusca(p.nome).includes(t) || normalizarBusca(p.categoria).includes(t));
    };

    const renderizar = () => {
      const dados = filtrados();
      const totalPaginas = Math.max(1, Math.ceil(dados.length / tamanho));
      pagina = Math.min(Math.max(pagina, 1), totalPaginas);
      const inicio = (pagina - 1) * tamanho;
      const pagina_atual = dados.slice(inicio, inicio + tamanho);
      $('#produtos-corpo').innerHTML = pagina_atual.length ? pagina_atual.map(linhaProduto).join('')
        : `<tr><td colspan="6" class="suave" style="text-align:center;padding:2rem 0">Nenhum produto encontrado para "${esc(termo)}".</td></tr>`;
      $('#produtos-corpo').querySelectorAll('tr[data-id]').forEach((tr) => tr.onclick = () => editarProduto(lista.find((x) => x.id == tr.dataset.id)));
      $('#p-contagem').textContent = dados.length ? `${inicio + 1}–${Math.min(inicio + tamanho, dados.length)} de ${dados.length}` : `0 de ${lista.length}`;
      $('#p-pagina-atual').textContent = `Página ${pagina} de ${totalPaginas}`;
      $('#p-anterior').disabled = pagina <= 1;
      $('#p-proxima').disabled = pagina >= totalPaginas;
    };

    c.innerHTML = `<div class="cabecalho"><h1>Produtos</h1><button class="btn" id="novo"><span>+ Novo produto</span></button></div>
      ${lista.length ? `
        <div style="display:flex;gap:.8rem;flex-wrap:wrap;align-items:center;margin-bottom:1rem">
          <input id="p-busca" placeholder="Buscar por nome ou categoria…" style="flex:1;min-width:220px">
          <label class="suave" style="display:flex;gap:.5rem;align-items:center;white-space:nowrap">Por página
            <select id="p-tam">${[10, 20, 50, 100].map((n) => `<option value="${n}" ${n === tamanho ? 'selected' : ''}>${n}</option>`).join('')}</select>
          </label>
        </div>
        <div class="tabela-wrap"><table><thead><tr><th></th><th>Produto</th><th>Categoria</th><th>Preço</th><th>Estoque</th><th>Situação</th></tr></thead>
          <tbody id="produtos-corpo"></tbody></table></div>
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.8rem;margin-top:1rem">
          <span class="suave" id="p-contagem"></span>
          <div style="display:flex;gap:.6rem;align-items:center">
            <button type="button" class="btn pequeno contorno" id="p-anterior"><span>← Anterior</span></button>
            <span class="suave" id="p-pagina-atual"></span>
            <button type="button" class="btn pequeno contorno" id="p-proxima"><span>Próxima →</span></button>
          </div>
        </div>`
        : '<div class="caixa vazio"><p class="suave">Cadastre seu primeiro produto.</p></div>'}`;
    $('#novo').onclick = () => editarProduto(null);
    if (!lista.length) return;
    renderizar();
    $('#p-busca').addEventListener('input', (e) => { termo = e.target.value; pagina = 1; renderizar(); });
    $('#p-tam').addEventListener('change', (e) => { tamanho = Number(e.target.value); localStorage.setItem('admin-produtos-tam', tamanho); pagina = 1; renderizar(); });
    $('#p-anterior').addEventListener('click', () => { pagina--; renderizar(); });
    $('#p-proxima').addEventListener('click', () => { pagina++; renderizar(); });
  }

  function editarProduto(p) {
    const novo = !p;
    p = p || { variacoes: [], variacao_rotulo: 'Tamanho', personalizacao: '', personalizacao_max: 20, ml_item_id: '', nome: '', descricao: '', categoria: '', preco_cents: null, estoque: null, sob_demanda: true, prazo_dias: 3, cores_texto: '', peso_g: 200, largura_cm: 15, altura_cm: 10, comprimento_cm: 15, ativo: true, destaque: false, imagens: [], arquivos_imagens: [] };
    abrirGaveta(`
      <span class="etiqueta">${novo ? 'Novo produto' : 'Editar produto'}</span><h2>${esc(p.nome || 'Novo produto')}</h2>
      ${novo ? '' : `<label>Fotos <span class="suave">(a primeira é a capa · clique na ★ para trocar)</span></label>
        <div class="fotos-produto" id="fotos">${p.arquivos_imagens.map((f, i) => `<div class="f"><img src="/uploads/${esc(f)}" alt="">${i === 0 ? '<span class="capa">CAPA</span>' : `<button type="button" title="Tornar capa" data-capa="${esc(f)}" style="right:32px">★</button>`}<button type="button" data-remover="${esc(f)}" title="Remover">×</button></div>`).join('')}
        <label class="add">+ Fotos<input type="file" id="nova-foto" accept="image/*" multiple hidden></label></div>`}
      <form id="form-produto">
        <div class="campo"><label for="p-nome">Nome</label><input id="p-nome" value="${esc(p.nome)}" required></div>
        <div class="linha-campos" style="--cols:3">
          <div class="campo"><label for="p-preco">Preço (R$)</label><input id="p-preco" inputmode="decimal" value="${reaisTexto(p.preco_base_cents ?? p.preco_cents)}" placeholder="0,00"></div>
          <div class="campo"><label for="p-cat">Categoria</label><input id="p-cat" value="${esc(p.categoria)}" placeholder="Ex.: Decoração" list="cats"></div>
          <div class="campo"><label for="p-prazo">Dias p/ produzir</label><input id="p-prazo" type="number" min="0" value="${p.prazo_dias}"></div>
        </div>
        <datalist id="cats">${menuCategorias.map((m) => `<option>${esc(m.nome)}`).join("")}</datalist>
        <div class="campo"><label for="p-desc">Descrição</label><textarea id="p-desc">${esc(p.descricao)}</textarea></div>
        <div class="campo"><label for="p-cores">Cores disponíveis <span class="suave">(separe por vírgula; deixe vazio se não tiver escolha)</span></label><input id="p-cores" value="${esc(p.cores_texto)}" placeholder="Preto, Branco, Vermelho"></div>
        <div class="linha-campos" style="--cols:3">
          <div class="campo"><label for="p-promo">Promoção (% de desconto)</label><input id="p-promo" type="number" min="0" max="90" value="${p.promo_pct_config || ''}" placeholder="0 = sem promoção"></div>
          <div class="campo"><label for="p-promo-ate">Promoção válida até</label><input id="p-promo-ate" type="date" value="${esc(p.promo_ate_config || '')}"></div>
          <div class="campo"><label class="suave">&nbsp;</label><div class="ajuda" style="margin-top:.7rem">${p.promo_pct ? `Em promoção agora: <strong style="color:#4ade80">-${p.promo_pct}%</strong>` : 'Aparece em “Promoções” com o preço riscado.'}</div></div>
        </div>
        <details class="caixa" style="padding:1rem;margin-bottom:1rem" ${p.variacoes.length || p.personalizacao ? 'open' : ''}>
          <summary style="cursor:pointer;font-weight:600">Opções com preço diferente e personalização</summary>
          <div class="campo" style="margin-top:1rem"><label for="p-var-rot">Nome da opção</label><input id="p-var-rot" value="${esc(p.variacao_rotulo)}" placeholder="Tamanho, Modelo, Kit…"></div>
          <div id="variacoes">${(p.variacoes_brutas || p.variacoes).map((v) => linhaVariacao(v.nome, reaisTexto(v.preco_cents))).join('')}</div>
          <button type="button" class="link-btn" id="add-var">+ adicionar opção (ex.: P / M / G)</button>
          <p class="ajuda">Com opções cadastradas, o preço de cada uma substitui o preço acima.</p>
          <div class="linha-campos" style="margin-top:1rem">
            <div class="campo"><label for="p-pers">Campo de personalização <span class="suave">(opcional)</span></label><input id="p-pers" value="${esc(p.personalizacao)}" placeholder="Ex.: Nome no chaveiro"></div>
            <div class="campo"><label for="p-pers-max">Máx. de caracteres</label><input id="p-pers-max" type="number" min="1" max="200" value="${p.personalizacao_max}"></div>
          </div>
        </details>
        <div class="linha-campos">
          <div class="campo"><label class="toggle"><input type="checkbox" id="p-sob" ${p.sob_demanda ? 'checked' : ''}> Feito sob demanda (sem limite de estoque)</label></div>
          <div class="campo"><label for="p-estoque">Estoque</label><input id="p-estoque" type="number" min="0" value="${p.estoque ?? ''}" ${p.sob_demanda ? 'disabled' : ''}></div>
        </div>
        <label>Embalagem para o frete</label>
        <div class="linha-campos" style="--cols:4">
          <div class="campo"><label for="p-peso" class="suave">Peso (g)</label><input id="p-peso" type="number" min="1" value="${p.peso_g}"></div>
          <div class="campo"><label for="p-larg" class="suave">Largura (cm)</label><input id="p-larg" type="number" min="1" value="${p.largura_cm}"></div>
          <div class="campo"><label for="p-alt" class="suave">Altura (cm)</label><input id="p-alt" type="number" min="1" value="${p.altura_cm}"></div>
          <div class="campo"><label for="p-comp" class="suave">Comprimento (cm)</label><input id="p-comp" type="number" min="1" value="${p.comprimento_cm}"></div>
        </div>
        <div class="campo"><label for="p-ml">Anúncio no Mercado Livre <span class="suave">(opcional — sincroniza o estoque)</span></label>
          <div class="copiar"><input id="p-ml" value="${esc(p.ml_item_id)}" placeholder="MLB1234567890"><button type="button" class="btn pequeno contorno" id="ver-ml"><span>Verificar</span></button></div>
          <div class="ajuda" id="ml-info">Só sincroniza produtos com estoque controlado (não "sob demanda").</div></div>
        <div style="display:flex;gap:1.5rem;flex-wrap:wrap;margin:.5rem 0 1rem">
          <label class="toggle"><input type="checkbox" id="p-ativo" ${p.ativo ? 'checked' : ''}> À venda na loja</label>
          <label class="toggle"><input type="checkbox" id="p-dest" ${p.destaque ? 'checked' : ''}> Destaque na página inicial</label>
        </div>
        <div class="acoes-gaveta">
          <button class="btn"><span>${novo ? 'Criar e adicionar fotos' : 'Salvar'}</span></button>
          ${novo ? '' : `<a class="btn contorno" href="/produto/${esc(p.slug)}" target="_blank"><span>Ver na loja ↗</span></a><button type="button" class="link-btn" id="excluir" style="margin-left:auto">Excluir produto</button>`}
        </div>
      </form>`);

    $('#add-var').onclick = () => { $('#variacoes').insertAdjacentHTML('beforeend', linhaVariacao('', '')); $('#variacoes .var:last-child input').focus(); };
    $('#variacoes').onclick = (e) => { const b = e.target.closest('[data-rm]'); if (b) b.closest('.var').remove(); };
    $('#ver-ml').onclick = async () => {
      const id = $('#p-ml').value.trim(); if (!id) return;
      $('#ml-info').textContent = 'Consultando…';
      try { const a = await api('/api/admin/ml/anuncio/' + encodeURIComponent(id)); $('#ml-info').innerHTML = `✔ <a href="${esc(a.link)}" target="_blank">${esc(a.titulo)}</a> · ${a.quantidade} disponível(is) · ${esc(a.status)}`; }
      catch (err) { $('#ml-info').textContent = err.message; }
    };
    $('#p-sob').onchange = (e) => { $('#p-estoque').disabled = e.target.checked; if (!e.target.checked && !$('#p-estoque').value) $('#p-estoque').value = 1; };
    $('#form-produto').onsubmit = async (ev) => {
      ev.preventDefault();
      const corpo = {
        nome: $('#p-nome').value, preco: $('#p-preco').value, categoria: $('#p-cat').value, prazo_dias: $('#p-prazo').value,
        descricao: $('#p-desc').value, cores: $('#p-cores').value, estoque: $('#p-sob').checked ? '' : $('#p-estoque').value,
        peso_g: $('#p-peso').value, largura_cm: $('#p-larg').value, altura_cm: $('#p-alt').value, comprimento_cm: $('#p-comp').value,
        ativo: $('#p-ativo').checked, destaque: $('#p-dest').checked,
        promo_pct: $('#p-promo').value, promo_ate: $('#p-promo-ate').value,
        variacao_rotulo: $('#p-var-rot').value, personalizacao: $('#p-pers').value, personalizacao_max: $('#p-pers-max').value, ml_item_id: $('#p-ml').value,
        variacoes: [...document.querySelectorAll('#variacoes .var')].map((l) => ({ nome: l.querySelector('[name=vn]').value, preco: l.querySelector('[name=vp]').value })).filter((v) => v.nome.trim()),
      };
      try {
        const salvo = await api(novo ? '/api/admin/produtos' : '/api/admin/produtos/' + p.id, { method: novo ? 'POST' : 'PUT', body: corpo });
        toast(novo ? 'Produto criado! Agora adicione as fotos.' : 'Produto salvo.');
        produtos();
        if (novo) editarProduto(salvo); else fecharGaveta();
      } catch (err) { toast(err.message); }
    };
    $('#excluir')?.addEventListener('click', async () => {
      if (!confirm(`Excluir "${p.nome}"? Isso não pode ser desfeito. (Para só esconder, desmarque "À venda".)`)) return;
      await api('/api/admin/produtos/' + p.id, { method: 'DELETE' }); toast('Produto excluído.'); fecharGaveta(); produtos();
    });
    $('#nova-foto')?.addEventListener('change', async (ev) => {
      let atual = p;
      for (const arquivo of ev.target.files) {
        try { atual = await api(`/api/admin/produtos/${p.id}/imagens`, { method: 'POST', body: { dados: await reduzirFoto(arquivo) } }); }
        catch (err) { toast(err.message); }
      }
      editarProduto(atual); produtos();
    });
    $('#fotos')?.addEventListener('click', async (ev) => {
      const rem = ev.target.closest('[data-remover]'), capa = ev.target.closest('[data-capa]');
      if (!rem && !capa) return;
      let lista = [...p.arquivos_imagens];
      if (rem) lista = lista.filter((f) => f !== rem.dataset.remover);
      if (capa) lista = [capa.dataset.capa, ...lista.filter((f) => f !== capa.dataset.capa)];
      const atual = await api(`/api/admin/produtos/${p.id}/imagens`, { method: 'PUT', body: { imagens: lista } });
      editarProduto(atual); produtos();
    });
  }

  function linhaVariacao(nome, preco) {
    return `<div class="var linha-campos" style="--cols:3;align-items:end;margin-top:.5rem"><div class="campo" style="margin:0"><input name="vn" value="${esc(nome)}" placeholder="Ex.: Médio (15 cm)"></div>
      <div class="campo" style="margin:0"><input name="vp" value="${esc(preco)}" inputmode="decimal" placeholder="Preço R$"></div><div><button type="button" class="link-btn" data-rm>remover</button></div></div>`;
  }

  /** Reduz a foto no navegador (máx. 1600px, JPEG) antes de enviar. */
  function reduzirFoto(arquivo) {
    return new Promise((ok, falha) => {
      const img = new Image();
      img.onload = () => {
        const escala = Math.min(1, 1600 / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * escala); cv.height = Math.round(img.height * escala);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(img.src);
        ok(cv.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => falha(new Error('Não consegui abrir essa imagem.'));
      img.src = URL.createObjectURL(arquivo);
    });
  }

  // ---------- Perguntas dos clientes ----------
  let filtroPerguntas = 'pendentes';
  async function perguntas() {
    const c = $('#conteudo');
    const lista = await api('/api/admin/perguntas?filtro=' + filtroPerguntas);
    atualizarBadges();
    c.innerHTML = `<div class="cabecalho"><h1>Perguntas</h1>
        <select id="f-perg" style="width:auto">${[['pendentes', 'Sem resposta'], ['respondidas', 'Respondidas'], ['todas', 'Todas']].map(([v, t]) => `<option value="${v}" ${v === filtroPerguntas ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      ${lista.length ? lista.map((q) => `<div class="caixa" data-id="${q.id}">
        <div style="display:flex;gap:1rem;align-items:flex-start">
          <a href="/produto/${esc(q.produto_slug)}#perguntas" target="_blank" class="mini-foto" style="flex-shrink:0">${foto(q.produto_imagem)}</a>
          <div style="flex:1;min-width:0">
            <div class="suave" style="font-size:.82rem"><a href="/produto/${esc(q.produto_slug)}" target="_blank">${esc(q.produto_nome)}</a> · ${esc(q.nome)} (${esc(q.email)}) · ${data(q.criado_em)}${!q.publicada ? ' · <strong class="vermelho">oculta</strong>' : ''}</div>
            <p style="margin:.4rem 0 .8rem;font-weight:600;white-space:pre-line">${esc(q.pergunta)}</p>
            <textarea name="resposta" style="min-height:70px" placeholder="Escreva a resposta. Ela fica pública no produto e vai por e-mail para o cliente.">${esc(q.resposta)}</textarea>
            <div class="acoes-gaveta" style="margin-top:.6rem;align-items:center">
              <button class="btn pequeno" data-responder><span>${q.resposta ? 'Atualizar resposta' : 'Responder'}</span></button>
              <button class="btn pequeno contorno" data-ocultar data-v="${q.publicada ? 0 : 1}"><span>${q.publicada ? 'Ocultar' : 'Mostrar'}</span></button>
              <button class="link-btn" data-apagar>excluir</button>
              ${q.respondida_em ? `<span class="suave" style="font-size:.8rem;margin-left:auto">Respondida em ${data(q.respondida_em)}</span>` : ''}
            </div>
          </div></div></div>`).join('')
        : `<div class="caixa vazio"><p class="suave">${filtroPerguntas === 'pendentes' ? 'Nenhuma pergunta esperando resposta. 🎉' : 'Nenhuma pergunta ainda.'}</p></div>`}
      <p class="ajuda">Perguntas só aparecem no site depois de respondidas. Você recebe aviso no celular/e-mail a cada pergunta nova.</p>`;
    $('#f-perg').onchange = (e) => { filtroPerguntas = e.target.value; perguntas(); };
    c.onclick = async (e) => {
      const card = e.target.closest('[data-id]'); if (!card) return;
      const id = card.dataset.id;
      try {
        if (e.target.closest('[data-responder]')) {
          const resposta = card.querySelector('[name=resposta]').value.trim();
          if (!resposta) return toast('Escreva a resposta.');
          await api('/api/admin/perguntas/' + id, { method: 'PUT', body: { resposta } }); toast('Resposta publicada e enviada ao cliente.'); perguntas();
        } else if (e.target.closest('[data-ocultar]')) {
          await api('/api/admin/perguntas/' + id, { method: 'PUT', body: { publicada: e.target.closest('[data-ocultar]').dataset.v === '1' } }); perguntas();
        } else if (e.target.closest('[data-apagar]') && confirm('Excluir esta pergunta?')) {
          await api('/api/admin/perguntas/' + id, { method: 'DELETE' }); perguntas();
        }
      } catch (err) { toast(err.message); }
    };
  }

  // ---------- Blog ----------
  let menuCategorias = [];
  api('/api/site').then((s) => { menuCategorias = s.menu; }).catch(() => {});

  async function blog() {
    const c = $('#conteudo');
    const lista = await api('/api/admin/posts');
    c.innerHTML = `<div class="cabecalho"><h1>Blog</h1><div style="display:flex;gap:.6rem"><a class="btn contorno pequeno" href="/blog" target="_blank"><span>Ver blog ↗</span></a><button class="btn" id="novo-post"><span>+ Novo post</span></button></div></div>
      ${lista.length ? `<div class="tabela-wrap"><table><thead><tr><th></th><th>Título</th><th>Categoria</th><th>Publicado em</th><th>Situação</th></tr></thead><tbody>
        ${lista.map((p) => `<tr data-id="${p.id}"><td><div class="mini-foto">${foto(p.capa_url)}</div></td><td><strong>${esc(p.titulo)}</strong><div class="suave" style="font-size:.8rem">/blog/${esc(p.slug)}</div></td>
          <td>${esc(p.categoria)}</td><td>${p.publicado_em ? new Date(p.publicado_em + 'T12:00').toLocaleDateString('pt-BR') : '—'}</td><td>${p.publicado ? '<span class="status-pedido st-entregue">Publicado</span>' : '<span class="status-pedido st-nova">Rascunho</span>'}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="caixa vazio"><p class="suave">Escreva o primeiro post! Ideias: “PLA ou PETG: qual escolher?”, “10 presentes impressos em 3D”, “Como cuidar da sua peça impressa”, bastidores da oficina.</p></div>`}
      <p class="ajuda">Posts aparecem no Google e na página inicial. Vincule produtos ao post para vender mais.</p>`;
    $('#novo-post').onclick = () => editarPost(null);
    c.querySelectorAll('tbody tr').forEach((tr) => tr.onclick = () => editarPost(lista.find((x) => x.id == tr.dataset.id)));
  }

  async function editarPost(post) {
    const novo = !post;
    post = post || { titulo: '', resumo: '', conteudo: '', categoria: '', produtos: [], publicado: 0, capa_url: '' };
    const produtosLoja = await api('/api/admin/produtos');
    abrirGaveta(`<span class="etiqueta">${novo ? 'Novo post' : 'Editar post'}</span><h2>${esc(post.titulo || 'Novo post')}</h2>
      ${novo ? '<p class="ajuda">Salve o rascunho para adicionar a foto de capa e imagens no texto.</p>' : `
        <label>Foto de capa</label>
        <div class="fotos-produto"><label class="add" style="width:180px;height:100px;overflow:hidden">${post.capa_url ? `<img src="${esc(post.capa_url)}" alt="" style="width:100%;height:100%;object-fit:cover">` : '+ Capa (16:9)'}<input type="file" id="capa" accept="image/*" hidden></label></div>`}
      <form id="form-post">
        <div class="campo"><label for="b-titulo">Título</label><input id="b-titulo" value="${esc(post.titulo)}" required placeholder="Ex.: PLA ou PETG: qual filamento escolher?"></div>
        <div class="linha-campos">
          <div class="campo"><label for="b-cat">Categoria</label><input id="b-cat" value="${esc(post.categoria)}" list="cats-blog" placeholder="Dicas, Ideias de presente…"><datalist id="cats-blog"><option>Dicas<option>Ideias de presente<option>Bastidores<option>Materiais<option>Novidades</datalist></div>
          <div class="campo"><label for="b-resumo">Resumo <span class="suave">(aparece no Google)</span></label><input id="b-resumo" value="${esc(post.resumo)}" maxlength="300"></div>
        </div>
        <label for="b-conteudo">Texto</label>
        <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-bottom:.4rem" id="barra">
          <button type="button" class="btn pequeno contorno" data-md="## " title="Subtítulo"><span>Título</span></button>
          <button type="button" class="btn pequeno contorno" data-md="**" title="Negrito"><span>B</span></button>
          <button type="button" class="btn pequeno contorno" data-md="*" title="Itálico"><span>I</span></button>
          <button type="button" class="btn pequeno contorno" data-md="- " title="Lista"><span>• Lista</span></button>
          <button type="button" class="btn pequeno contorno" data-md="> " title="Citação"><span>“ ”</span></button>
          <button type="button" class="btn pequeno contorno" data-md="link" title="Link"><span>Link</span></button>
          ${novo ? '' : '<label class="btn pequeno contorno" style="margin:0"><span>📷 Foto</span><input type="file" id="img-texto" accept="image/*" hidden></label>'}
          <button type="button" class="btn pequeno contorno" id="ver-previa" style="margin-left:auto"><span>Prévia</span></button>
        </div>
        <textarea id="b-conteudo" style="min-height:320px;font-family:ui-monospace,monospace;font-size:.92rem" placeholder="Escreva aqui. Use ## para subtítulos, **negrito**, - para listas.">${esc(post.conteudo)}</textarea>
        <div id="previa" class="caixa post-corpo" style="margin-top:.8rem" hidden></div>
        <div class="campo" style="margin-top:1rem"><label>Produtos relacionados <span class="suave">(aparecem no fim do post)</span></label>
          <div style="max-height:180px;overflow-y:auto;border:1px solid var(--linha);border-radius:10px;padding:.6rem">${produtosLoja.map((x) => `<label class="toggle" style="margin:.2rem 0"><input type="checkbox" name="prod" value="${x.id}" ${post.produtos.includes(x.id) ? 'checked' : ''}> ${esc(x.nome)}</label>`).join('') || '<span class="suave">Cadastre produtos primeiro.</span>'}</div></div>
        <label class="toggle" style="margin:.5rem 0 1rem"><input type="checkbox" id="b-pub" ${post.publicado ? 'checked' : ''}> Publicado (visível no site)</label>
        <div class="acoes-gaveta"><button class="btn"><span>${novo ? 'Salvar rascunho' : 'Salvar'}</span></button>
          ${!novo && post.publicado ? `<a class="btn contorno" href="/blog/${esc(post.slug)}" target="_blank"><span>Ver no site ↗</span></a>` : ''}
          ${novo ? '' : '<button type="button" class="link-btn" id="b-excluir" style="margin-left:auto">Excluir</button>'}</div>
      </form>`);
    const ta = $('#b-conteudo');
    const inserir = (antes, depois = '', padrao = 'texto') => {
      const [i, f] = [ta.selectionStart, ta.selectionEnd];
      const sel = ta.value.slice(i, f) || padrao;
      ta.setRangeText(antes + sel + depois, i, f, 'end'); ta.focus();
    };
    $('#barra').onclick = (e) => {
      const b = e.target.closest('[data-md]'); if (!b) return;
      const md = b.dataset.md;
      if (md === '**' || md === '*') inserir(md, md);
      else if (md === 'link') { const url = prompt('Endereço do link (https://... ou /produto/...)'); if (url) inserir('[', `](${url})`, 'texto do link'); }
      else { const i = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1; ta.setRangeText(md, i, i, 'end'); ta.focus(); }
    };
    $('#ver-previa').onclick = async () => {
      const pv = $('#previa');
      if (!pv.hidden) { pv.hidden = true; return; }
      pv.innerHTML = (await api('/api/admin/previa-markdown', { method: 'POST', body: { conteudo: ta.value } })).html || '<p class="suave">Nada ainda.</p>';
      pv.hidden = false;
    };
    $('#capa')?.addEventListener('change', async (e) => {
      try { await api(`/api/admin/posts/${post.id}/capa`, { method: 'POST', body: { dados: await reduzirFoto(e.target.files[0]) } }); toast('Capa salva.'); reabrir(); }
      catch (err) { toast(err.message); }
    });
    $('#img-texto')?.addEventListener('change', async (e) => {
      try { const r = await api('/api/admin/imagens', { method: 'POST', body: { dados: await reduzirFoto(e.target.files[0]) } }); inserir('\n' + r.markdown + '\n', '', ''); toast('Foto inserida no texto.'); }
      catch (err) { toast(err.message); }
    });
    const corpo = () => ({ titulo: $('#b-titulo').value, resumo: $('#b-resumo').value, categoria: $('#b-cat').value, conteudo: ta.value,
      publicado: $('#b-pub').checked, produtos: [...document.querySelectorAll('input[name=prod]:checked')].map((x) => Number(x.value)) });
    const reabrir = async () => { const l = await api('/api/admin/posts'); editarPost(l.find((x) => x.id === post.id)); blog(); };
    $('#form-post').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const salvo = await api(novo ? '/api/admin/posts' : '/api/admin/posts/' + post.id, { method: novo ? 'POST' : 'PUT', body: corpo() });
        toast(novo ? 'Rascunho salvo! Agora adicione a capa.' : 'Post salvo.');
        post = { ...post, id: salvo.id }; blog();
        if (novo) reabrir(); else fecharGaveta();
      } catch (err) { toast(err.message); }
    };
    $('#b-excluir')?.addEventListener('click', async () => {
      if (!confirm(`Excluir o post "${post.titulo}"?`)) return;
      await api('/api/admin/posts/' + post.id, { method: 'DELETE' }); toast('Post excluído.'); fecharGaveta(); blog();
    });
  }

  // ---------- Página inicial: banner, selos, menu e FAQ ----------
  async function site() {
    const c = $('#conteudo');
    const [s, produtosLoja] = await Promise.all([api('/api/admin/site'), api('/api/admin/produtos')]);
    const h = s.home;
    const linha = (cls, a, b, pa, pb) => `<div class="${cls} linha-campos" style="--cols:3;align-items:end;margin-top:.5rem"><div class="campo" style="margin:0"><input name="a" value="${esc(a)}" placeholder="${pa}"></div>
      <div class="campo" style="margin:0;grid-column:span 1"><input name="b" value="${esc(b)}" placeholder="${pb}"></div><div><button type="button" class="link-btn" data-rm>remover</button></div></div>`;
    c.innerHTML = `<div class="cabecalho"><h1>Página inicial</h1><a class="btn contorno pequeno" href="/" target="_blank"><span>Ver site ↗</span></a></div>
      <form id="form-site">
        <div class="caixa"><h3>Banner principal</h3>
          <div class="campo"><label for="s-etq">Etiqueta (texto pequeno vermelho)</label><input id="s-etq" value="${esc(h.etiqueta)}"></div>
          <div class="campo"><label for="s-tit">Título <span class="suave">(use | para quebrar: a 2ª parte fica vermelha)</span></label><input id="s-tit" value="${esc(h.titulo)}"></div>
          <div class="campo"><label for="s-sub">Texto</label><textarea id="s-sub" style="min-height:70px">${esc(h.subtitulo)}</textarea></div>
          <div class="campo"><label for="s-prod">Produto em destaque no banner</label><select id="s-prod"><option value="">— Mostrar o logo —</option>${produtosLoja.filter((x) => x.ativo).map((x) => `<option value="${esc(x.slug)}" ${x.slug === h.produto_destaque ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select></div>
        </div>
        <div class="caixa"><h3>Selos de vantagens (até 4)</h3><div id="selos">${h.selos.map((x) => linha('selo-l', x.titulo, x.texto, 'Título', 'Texto')).join('')}</div>
          <button type="button" class="link-btn" data-add="selos">+ adicionar selo</button></div>
        <div class="caixa"><h3>Menu de categorias</h3><p class="ajuda" style="margin-top:0">O nome precisa ser igual à categoria cadastrada nos produtos. Promoções, Sob encomenda e Blog entram sozinhos no fim.</p>
          <div id="menu">${s.menu.map((x) => linha('menu-l', x.nome, x.subtitulo, 'Categoria', 'Subtítulo')).join('')}</div>
          <button type="button" class="link-btn" data-add="menu">+ adicionar categoria</button></div>
        <div class="caixa"><h3>Perguntas frequentes</h3><div id="faq">${s.faq.map((f) => `<div class="faq-l" style="border-top:1px solid var(--linha);padding:.8rem 0"><input name="a" value="${esc(f.p)}" placeholder="Pergunta" style="margin-bottom:.4rem"><textarea name="b" style="min-height:60px" placeholder="Resposta">${esc(f.r)}</textarea><button type="button" class="link-btn" data-rm>remover</button></div>`).join('')}</div>
          <button type="button" class="link-btn" data-add="faq">+ adicionar pergunta</button></div>
        <div class="acoes-gaveta" style="position:sticky;bottom:0;background:var(--preto);padding:1rem 0"><button class="btn"><span>Salvar página inicial</span></button></div>
      </form>`;
    c.querySelector('#form-site').addEventListener('click', (e) => {
      const rm = e.target.closest('[data-rm]'); if (rm) { rm.closest('.selo-l, .menu-l, .faq-l').remove(); return; }
      const add = e.target.closest('[data-add]'); if (!add) return;
      const alvo = add.dataset.add;
      if (alvo === 'faq') $('#faq').insertAdjacentHTML('beforeend', '<div class="faq-l" style="border-top:1px solid var(--linha);padding:.8rem 0"><input name="a" placeholder="Pergunta" style="margin-bottom:.4rem"><textarea name="b" style="min-height:60px" placeholder="Resposta"></textarea><button type="button" class="link-btn" data-rm>remover</button></div>');
      else $('#' + alvo).insertAdjacentHTML('beforeend', alvo === 'selos' ? linha('selo-l', '', '', 'Título', 'Texto') : linha('menu-l', '', '', 'Categoria', 'Subtítulo'));
    });
    const ler = (cls) => [...c.querySelectorAll('.' + cls)].map((l) => [l.querySelector('[name=a]').value, l.querySelector('[name=b]').value]);
    $('#form-site').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await api('/api/admin/site', { method: 'PUT', body: {
          home: { etiqueta: $('#s-etq').value, titulo: $('#s-tit').value, subtitulo: $('#s-sub').value, produto_destaque: $('#s-prod').value, selos: ler('selo-l').map(([titulo, texto]) => ({ titulo, texto })) },
          menu: ler('menu-l').map(([nome, subtitulo]) => ({ nome, subtitulo })),
          faq: ler('faq-l').map(([p, r2]) => ({ p, r: r2 })),
        } });
        menuCategorias = r.menu; toast('Página inicial salva!');
      } catch (err) { toast(err.message); }
    };
  }

  // ---------- Clientes ----------
  async function clientes() {
    const c = $('#conteudo');
    const lista = await api('/api/admin/clientes');
    c.innerHTML = `<div class="cabecalho"><h1>Clientes</h1><span class="suave">${lista.length} conta(s) criada(s) com Google</span></div>
      ${lista.length ? `<div class="tabela-wrap"><table><thead><tr><th>Cliente</th><th>WhatsApp</th><th>Cidade</th><th>Pedidos</th><th>Total comprado</th><th>Último acesso</th></tr></thead><tbody>
        ${lista.map((x) => `<tr style="cursor:default"><td><strong>${esc(x.nome)}</strong><div class="suave" style="font-size:.8rem">${esc(x.email)}</div></td>
          <td>${x.telefone ? `<a href="${whatsLink(x.telefone, `Olá ${x.nome.split(' ')[0]}! Aqui é da DFR 3D.`)}" target="_blank" rel="noopener">${esc(x.telefone)}</a>` : '—'}</td>
          <td>${esc([x.cidade, x.uf].filter(Boolean).join('/')) || '—'}</td><td>${x.pedidos}</td><td><strong>${brl(x.total_cents)}</strong></td><td>${data(x.ultimo_login)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="caixa vazio"><p class="suave">Quando os clientes entrarem com Google, eles aparecem aqui.</p></div>'}`;
  }

  // ---------- Cupons ----------
  const tipoCupom = (c) => (c.tipo === 'pct' ? `${c.valor}%` : c.tipo === 'valor' ? brl(c.valor) : 'Frete grátis');
  async function cupons() {
    const c = $('#conteudo');
    const lista = await api('/api/admin/cupons');
    const hoje = new Date().toISOString().slice(0, 10);
    c.innerHTML = `<div class="cabecalho"><h1>Cupons</h1><button class="btn" id="novo-cupom"><span>+ Novo cupom</span></button></div>
      ${lista.length ? `<div class="tabela-wrap"><table><thead><tr><th>Código</th><th>Desconto</th><th>Mínimo</th><th>Validade</th><th>Usos</th><th>Situação</th></tr></thead><tbody>
        ${lista.map((x) => `<tr data-id="${x.id}"><td><strong>${esc(x.codigo)}</strong></td><td>${tipoCupom(x)}</td><td>${x.minimo_cents ? brl(x.minimo_cents) : '—'}</td>
          <td>${x.validade ? new Date(x.validade + 'T12:00').toLocaleDateString('pt-BR') : 'sem prazo'}</td><td>${x.usos}${x.usos_max !== null ? ` / ${x.usos_max}` : ''}</td>
          <td>${!x.ativo ? '<span class="suave">Desativado</span>' : x.validade && x.validade < hoje ? '<span class="suave">Expirado</span>' : x.usos_max !== null && x.usos >= x.usos_max ? '<span class="suave">Esgotado</span>' : 'Ativo'}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="caixa vazio"><p class="suave">Crie cupons para Instagram, clientes fiéis ou datas especiais. Ex.: <strong>BEMVINDO10</strong>.</p></div>'}
      <p class="ajuda">O uso só conta quando o pedido é pago. O desconto do Pix é somado ao do cupom.</p>`;
    $('#novo-cupom').onclick = () => editarCupom(null);
    c.querySelectorAll('tbody tr').forEach((tr) => tr.onclick = () => editarCupom(lista.find((x) => x.id == tr.dataset.id)));
  }

  function editarCupom(cp) {
    const novo = !cp;
    cp = cp || { codigo: '', tipo: 'pct', valor: 10, minimo_cents: 0, validade: '', usos_max: null, ativo: 1 };
    abrirGaveta(`<span class="etiqueta">${novo ? 'Novo cupom' : 'Editar cupom'}</span><h2>${esc(cp.codigo || 'Novo cupom')}</h2>
      <form id="form-cupom">
        <div class="campo"><label for="c-cod">Código</label><input id="c-cod" value="${esc(cp.codigo)}" placeholder="BEMVINDO10" style="text-transform:uppercase" required></div>
        <div class="linha-campos">
          <div class="campo"><label for="c-tipo">Tipo</label><select id="c-tipo"><option value="pct" ${cp.tipo === 'pct' ? 'selected' : ''}>Percentual (%)</option><option value="valor" ${cp.tipo === 'valor' ? 'selected' : ''}>Valor fixo (R$)</option><option value="frete" ${cp.tipo === 'frete' ? 'selected' : ''}>Frete grátis</option></select></div>
          <div class="campo" id="c-valor-campo"><label for="c-valor">Desconto</label><input id="c-valor" inputmode="decimal" value="${cp.tipo === 'valor' ? reaisTexto(cp.valor) : cp.valor}"></div>
        </div>
        <div class="linha-campos" style="--cols:3">
          <div class="campo"><label for="c-min">Compra mínima (R$)</label><input id="c-min" inputmode="decimal" value="${cp.minimo_cents ? reaisTexto(cp.minimo_cents) : ''}" placeholder="sem mínimo"></div>
          <div class="campo"><label for="c-val">Válido até</label><input id="c-val" type="date" value="${esc(cp.validade)}"></div>
          <div class="campo"><label for="c-usos">Limite de usos</label><input id="c-usos" type="number" min="1" value="${cp.usos_max ?? ''}" placeholder="ilimitado"></div>
        </div>
        <label class="toggle" style="margin-bottom:1rem"><input type="checkbox" id="c-ativo" ${cp.ativo ? 'checked' : ''}> Ativo</label>
        <div class="acoes-gaveta"><button class="btn"><span>Salvar</span></button>${novo ? '' : '<button type="button" class="link-btn" id="c-excluir" style="margin-left:auto">Excluir</button>'}</div>
      </form>`);
    const ajustar = () => { $('#c-valor-campo').hidden = $('#c-tipo').value === 'frete'; };
    $('#c-tipo').onchange = ajustar; ajustar();
    $('#form-cupom').onsubmit = async (e) => {
      e.preventDefault();
      const corpo = { codigo: $('#c-cod').value, tipo: $('#c-tipo').value, valor: $('#c-valor').value, minimo: $('#c-min').value, validade: $('#c-val').value, usos_max: $('#c-usos').value, ativo: $('#c-ativo').checked };
      try { await api(novo ? '/api/admin/cupons' : '/api/admin/cupons/' + cp.id, { method: novo ? 'POST' : 'PUT', body: corpo }); toast('Cupom salvo.'); fecharGaveta(); cupons(); }
      catch (err) { toast(err.message); }
    };
    $('#c-excluir')?.addEventListener('click', async () => {
      if (!confirm(`Excluir o cupom ${cp.codigo}?`)) return;
      await api('/api/admin/cupons/' + cp.id, { method: 'DELETE' }); toast('Cupom excluído.'); fecharGaveta(); cupons();
    });
  }

  // ---------- Avaliações ----------
  async function avaliacoes() {
    const c = $('#conteudo');
    const lista = await api('/api/admin/avaliacoes');
    atualizarBadges();
    const estrelas = (n) => `<span style="color:var(--amarelo)">${'★'.repeat(n)}</span><span style="color:#3f3f46">${'★'.repeat(5 - n)}</span>`;
    c.innerHTML = `<div class="cabecalho"><h1>Avaliações</h1></div>
      ${lista.length ? lista.map((a) => `<div class="caixa" style="display:flex;gap:1rem;align-items:flex-start;flex-wrap:wrap">
        ${a.foto ? `<a href="${esc(a.foto)}" target="_blank"><img src="${esc(a.foto)}" alt="" style="width:90px;height:90px;object-fit:cover;border-radius:10px"></a>` : ''}
        <div style="flex:1;min-width:220px">${estrelas(a.nota)} <strong>${esc(a.nome)}</strong> <span class="suave" style="font-size:.85rem">· ${data(a.criado_em)} · pedido ${esc(a.pedido_codigo || '—')}</span>
          <div class="suave" style="font-size:.88rem">em <a href="/produto/${esc(a.produto_slug)}" target="_blank">${esc(a.produto_nome)}</a></div>
          ${a.comentario ? `<p style="margin:.5rem 0 0;white-space:pre-line">${esc(a.comentario)}</p>` : ''}</div>
        <div style="display:flex;gap:.6rem;align-items:center">${a.aprovada ? '<span class="status-pedido st-entregue">Publicada</span>' : '<span class="status-pedido st-nova">Aguardando</span>'}
          <button class="btn pequeno ${a.aprovada ? 'contorno' : 'verde'}" data-aprovar="${a.id}" data-v="${a.aprovada ? 0 : 1}"><span>${a.aprovada ? 'Ocultar' : 'Publicar'}</span></button>
          <button class="link-btn" data-apagar="${a.id}">excluir</button></div></div>`).join('')
        : '<div class="caixa vazio"><p class="suave">Nenhuma avaliação ainda. Quando você marcar um pedido como <strong>Entregue</strong>, o cliente recebe um e-mail pedindo a avaliação.</p></div>'}`;
    c.onclick = async (e) => {
      const ap = e.target.closest('[data-aprovar]'), del = e.target.closest('[data-apagar]');
      try {
        if (ap) { await api('/api/admin/avaliacoes/' + ap.dataset.aprovar, { method: 'PUT', body: { aprovada: ap.dataset.v === '1' } }); avaliacoes(); }
        if (del && confirm('Excluir esta avaliação?')) { await api('/api/admin/avaliacoes/' + del.dataset.apagar, { method: 'DELETE' }); avaliacoes(); }
      } catch (err) { toast(err.message); }
    };
  }

  // ---------- Configurações (tudo que antes ficava no .env) ----------
  const TESTAVEIS = { pagamento: 'Testar conexão', frete: 'Testar conexão', email: 'Enviar e-mail de teste', celular: 'Enviar aviso de teste' };
  async function configuracoes() {
    const c = $('#conteudo');
    const d = await api('/api/admin/config');
    const subst = (t) => esc(t || '').replace(/\{BASE_URL\}/g, `<code>${esc(d.base_url)}</code>`);
    const origem = (o) => (o === 'ambiente' ? '<span class="tag-origem" title="Valor vindo das variáveis da Hostinger. Ao salvar aqui, passa a valer o do painel.">da Hostinger</span>' : '');
    const campoHtml = (f) => {
      const id = `cfg-${f.chave}`;
      const rot = `<label for="${id}">${esc(f.rotulo)} ${origem(f.origem)}</label>`;
      const ajuda = f.ajuda ? `<div class="ajuda">${subst(f.ajuda)}</div>` : '';
      if (f.tipo === 'sim_nao') return `<div class="campo"><label class="toggle" style="margin-top:1.6rem"><input type="checkbox" id="${id}" data-chave="${f.chave}" ${f.valor === 'true' ? 'checked' : ''}> ${esc(f.rotulo)} ${origem(f.origem)}</label>${ajuda}</div>`;
      if (f.tipo === 'segredo') return `<div class="campo">${rot}
        <div class="copiar"><input id="${id}" data-chave="${f.chave}" data-segredo="1" type="password" autocomplete="new-password" placeholder="${f.definido ? `Configurado (${esc(f.valor)}) — digite para trocar` : 'Não configurado'}">
        ${f.definido ? `<button type="button" class="btn pequeno contorno" data-limpar="${f.chave}" title="Apagar este valor"><span>Apagar</span></button>` : ''}</div>${ajuda}</div>`;
      const tipoInput = { email: 'email', url: 'url', numero: 'number' }[f.tipo] || 'text';
      return `<div class="campo">${rot}<input id="${id}" data-chave="${f.chave}" type="${tipoInput}" value="${esc(f.valor)}" placeholder="${esc(f.placeholder || '')}" ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''} ${f.tipo === 'dinheiro' ? 'inputmode="decimal"' : ''}>${ajuda}</div>`;
    };
    const pronto = (s) => s.campos.filter((f) => f.tipo === 'segredo' || ['MP_ACCESS_TOKEN', 'CEP_ORIGEM', 'GOOGLE_CLIENT_ID', 'ML_CLIENT_ID', 'TELEGRAM_CHAT_ID'].includes(f.chave)).some((f) => f.definido);
    c.innerHTML = `<div class="cabecalho"><h1>Configurações</h1><span class="suave">Tudo é salvo na hora, sem reiniciar a loja.</span></div>
      <nav class="indice-cfg">${d.secoes.map((s) => `<a href="#sec-${s.id}" data-ir-sec="${s.id}">${s.icone} ${esc(s.titulo.split(' — ')[0])}</a>`).join('')}<a href="#sec-seguranca" data-ir-sec="seguranca">🔑 Senha</a></nav>
      ${d.secoes.map((s) => `<form class="caixa secao-cfg" id="sec-${s.id}" data-secao="${s.id}">
        <div class="cab-cfg"><h3 style="margin:0">${s.icone} ${esc(s.titulo)}</h3>
          ${['loja', 'remetente', 'analytics', 'backup'].includes(s.id) ? '' : `<span class="status-pedido ${pronto(s) ? 'st-entregue' : 'st-nova'}">${pronto(s) ? 'Configurado' : 'Pendente'}</span>`}
          ${s.link ? `<a href="${esc(s.link)}" target="_blank" rel="noopener" class="suave" style="margin-left:auto;font-size:.85rem">Abrir site do serviço ↗</a>` : ''}</div>
        ${s.descricao ? `<p class="ajuda" style="margin:.4rem 0 0">${subst(s.descricao)}</p>` : ''}
        <div class="linha-campos" style="margin-top:1rem">${s.campos.map(campoHtml).join('')}</div>
        <div class="acoes-gaveta" style="margin-top:.4rem;align-items:center"><button class="btn pequeno"><span>Salvar</span></button>
          ${TESTAVEIS[s.id] ? `<button type="button" class="btn pequeno contorno" data-testar="${s.id}"><span>${TESTAVEIS[s.id]}</span></button>` : ''}
          <span class="resultado-cfg" id="res-${s.id}"></span></div>
      </form>`).join('')}
      <form class="caixa secao-cfg" id="sec-seguranca">
        <h3 style="margin:0">🔑 Senha do painel</h3>
        <p class="ajuda" style="margin:.4rem 0 1rem">${d.senha_trocada_em ? `Trocada em ${new Date(d.senha_trocada_em).toLocaleString('pt-BR')}.` : 'Você ainda usa a senha do primeiro acesso (ADMIN_PASSWORD da Hostinger). Troque por uma só sua.'} Trocar a senha desconecta outros aparelhos.</p>
        <div class="linha-campos" style="--cols:3">
          <div class="campo"><label for="s-atual">Senha atual</label><input id="s-atual" type="password" autocomplete="current-password"></div>
          <div class="campo"><label for="s-nova">Nova senha</label><input id="s-nova" type="password" autocomplete="new-password" placeholder="10+ caracteres, letras e números"></div>
          <div class="campo"><label for="s-conf">Repita a nova senha</label><input id="s-conf" type="password" autocomplete="new-password"></div>
        </div>
        <div class="acoes-gaveta" style="margin-top:.4rem;align-items:center"><button class="btn pequeno"><span>Trocar senha</span></button><span class="resultado-cfg" id="res-seguranca"></span></div>
      </form>`;

    // Busca de endereço por CEP no remetente da etiqueta. O CEP das etiquetas é o de "Frete e retirada" (CEP_ORIGEM);
    // este campo é só um atalho e não é salvo: preenche rua, bairro, cidade e UF, que a pessoa pode ajustar antes de salvar.
    {
      const origem = $('#cfg-CEP_ORIGEM');
      const linha = $('#sec-remetente .linha-campos');
      if (linha && window.CEP) {
        linha.insertAdjacentHTML('afterbegin', `<div class="campo"><label for="rem-cep">CEP do remetente</label><input id="rem-cep" type="text" inputmode="numeric" autocomplete="off" placeholder="00000-000" value="${esc(origem ? origem.value : '')}"><div class="ajuda">Digite o CEP e a rua, o bairro, a cidade e a UF são preenchidos abaixo. Este campo não é salvo: o CEP usado nas etiquetas é o de "Frete e retirada".</div></div>`);
        CEP.ligar({ cep: '#rem-cep', rua: '#cfg-REMETENTE_RUA', numero: '#cfg-REMETENTE_NUMERO', bairro: '#cfg-REMETENTE_BAIRRO', cidade: '#cfg-REMETENTE_CIDADE', uf: '#cfg-REMETENTE_UF' }, { dica: 'Depois clique em Salvar.' });
        // Ao digitar o CEP de origem (Frete), já preenche o remetente também.
        origem?.addEventListener('input', () => {
          if (origem.value.replace(/\D/g, '').length === 8) { const r = $('#rem-cep'); r.value = origem.value; r.dispatchEvent(new Event('input', { bubbles: true })); }
        });
      }
    }

    const resultado = (id, ok, msg) => { const el = $('#res-' + id); el.className = `resultado-cfg ${ok ? 'ok' : 'erro'}`; el.textContent = msg; };
    c.querySelector('.indice-cfg').onclick = (e) => { const a = e.target.closest('[data-ir-sec]'); if (!a) return; e.preventDefault(); $('#sec-' + a.dataset.irSec).scrollIntoView({ behavior: 'smooth', block: 'start' }); };

    c.querySelectorAll('form[data-secao]').forEach((form) => {
      const secao = form.dataset.secao;
      form.onsubmit = async (e) => {
        e.preventDefault();
        const valores = {};
        form.querySelectorAll('[data-chave]').forEach((el) => {
          if (el.type === 'checkbox') valores[el.dataset.chave] = el.checked ? 'true' : 'false';
          else if (el.dataset.segredo) { if (el.value.trim() || el.dataset.apagar) valores[el.dataset.chave] = el.value.trim(); }
          else valores[el.dataset.chave] = el.value;
        });
        try {
          const r = await api('/api/admin/config', { method: 'PUT', body: { valores } });
          toast(r.alterados.length ? `Salvo: ${r.alterados.join(', ')}` : 'Nada mudou.');
          await configuracoes(); $('#sec-' + secao).scrollIntoView({ block: 'start' });
          resultado(secao, true, r.alterados.length ? '✔ Salvo' : '');
        } catch (err) { resultado(secao, false, err.message); }
      };
      form.querySelectorAll('[data-limpar]').forEach((b) => b.onclick = () => {
        if (!confirm('Apagar este valor? A integração deixa de funcionar até você preencher de novo.')) return;
        const input = form.querySelector(`[data-chave="${b.dataset.limpar}"]`);
        input.value = ''; input.dataset.apagar = '1'; form.requestSubmit();
      });
      form.querySelector('[data-testar]')?.addEventListener('click', async (e) => {
        const b = e.currentTarget; b.disabled = true; resultado(secao, true, 'Testando…');
        try { const r = await api(`/api/admin/config/testar/${secao}`, { method: 'POST' }); resultado(secao, r.ok, (r.ok ? '✔ ' : '✖ ') + r.msg); }
        catch (err) { resultado(secao, false, err.message); }
        b.disabled = false;
      });
    });

    $('#sec-seguranca').onsubmit = async (e) => {
      e.preventDefault();
      if ($('#s-nova').value !== $('#s-conf').value) return resultado('seguranca', false, 'As senhas novas não são iguais.');
      try {
        await api('/api/admin/senha', { method: 'POST', body: { atual: $('#s-atual').value, nova: $('#s-nova').value } });
        e.target.reset(); resultado('seguranca', true, '✔ Senha trocada! Use a nova no próximo login.');
      } catch (err) { resultado('seguranca', false, err.message); }
    };
  }

  // ---------- Integrações ----------
  async function integracoes() {
    const c = $('#conteudo');
    c.innerHTML = '<p class="carregando">Verificando integrações…</p>';
    const i = await api('/api/admin/integracoes');
    const item = (ok, titulo, detalhe) => `<div style="display:flex;gap:.8rem;padding:.8rem 0;border-bottom:1px solid var(--linha)"><span style="font-size:1.1rem">${ok ? '✅' : '⚪'}</span><div><strong>${titulo}</strong><div class="suave" style="font-size:.88rem">${detalhe}</div></div></div>`;
    const kb = (b) => `${(b / 1024).toFixed(0)} KB`;
    c.innerHTML = `<div class="cabecalho"><h1>Integrações</h1><button class="btn pequeno" id="ir-config"><span>⚙️ Abrir Configurações</span></button></div>
      <p class="ajuda" style="margin-top:-.8rem">Aqui você vê o que está funcionando. Para preencher chaves e dados, use <b>Configurações</b>.</p>
      ${avisoHash.get('ml') === 'ok' ? '<div class="aviso ok">Mercado Livre conectado!</div>' : avisoHash.get('ml') === 'erro' ? '<div class="aviso erro">Não foi possível conectar o Mercado Livre. Tente de novo.</div>' : ''}
      <div class="caixa"><h3>Situação</h3>
        ${item(true, 'Identificação da loja', `${esc(i.loja.nome)} · ${esc(i.loja.cidade)} (altere em LOJA_NOME / LOJA_CIDADE)`)}
        ${item(i.mercado_pago, 'Mercado Pago', i.mercado_pago ? `Ativo · desconto no Pix: ${i.pix_desconto}% · webhook ${i.webhook_mp ? 'com assinatura ✔' : 'sem assinatura (preencha MP_WEBHOOK_SECRET)'}` : 'Preencha MP_ACCESS_TOKEN.')}
        ${item(i.melhor_envio, 'Melhor Envio: cálculo de frete', i.melhor_envio ? (i.sandbox_me ? 'Ativo (modo TESTE/sandbox)' : 'Ativo') : 'Preencha MELHOR_ENVIO_TOKEN e CEP_ORIGEM.')}
        ${item(i.etiqueta, 'Melhor Envio: etiquetas', i.etiqueta ? 'Ativo: gere etiquetas dentro do pedido.' : 'Preencha os dados REMETENTE_* (endereço e CPF/CNPJ de quem envia — só vão na etiqueta, não aparecem no site).')}
        ${item(i.email, 'E-mails automáticos', i.email ? `Ativo · avisos da loja vão para ${esc(i.email_admin)}` : 'Preencha RESEND_API_KEY (ou BREVO_API_KEY) e EMAIL_REMETENTE.')}
        ${item(i.celular, 'Aviso no celular de pedido pago', i.celular ? [i.telegram && 'Telegram', i.whatsapp_callmebot && 'WhatsApp (CallMeBot)'].filter(Boolean).join(' + ') : 'Preencha TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID ou CALLMEBOT_TELEFONE/CALLMEBOT_APIKEY.')}
        ${item(i.analytics.ga || i.analytics.pixel, 'Medição de visitas', [i.analytics.ga && 'Google Analytics', i.analytics.pixel && 'Meta Pixel'].filter(Boolean).join(' + ') || 'Opcional: preencha GA_ID e/ou META_PIXEL_ID.')}
        ${item(i.google, 'Login de clientes com Google', i.google ? 'Ativo: clientes entram em /conta e acompanham pedidos e rastreio.' : `Preencha GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET. URI de redirecionamento: <code>${esc(i.google_redirect)}</code>`)}
        ${item(true, 'Banco de dados', esc(i.banco))}
        ${item(true, 'Pedidos não pagos', `Cancelados automaticamente após ${i.expira_horas}h, devolvendo o estoque.`)}
        <div class="acoes-gaveta"><button class="btn contorno pequeno" id="testar"><span>Enviar aviso de teste</span></button></div>
      </div>

      <div class="caixa"><h3>Mercado Livre — estoque sincronizado</h3>
        ${!i.ml.configurado ? `<p class="suave">1. Crie um app em <a href="https://developers.mercadolivre.com.br/devcenter" target="_blank">developers.mercadolivre.com.br</a><br>2. Em "URI de redirect" use: <code>${esc(i.ml.redirect)}</code><br>3. Em "Notificações" use: <code>${esc(i.ml.webhook)}</code> e marque o tópico <b>orders_v2</b><br>4. Preencha App ID e Chave secreta em ⚙️ Configurações → Mercado Livre (vale na hora).</p>`
          : i.ml.conectado ? `<p>Conectado${i.ml.conta?.apelido ? ` como <strong>${esc(i.ml.conta.apelido)}</strong>` : ''}${i.ml.conta?.erro ? ` <span class="vermelho">(${esc(i.ml.conta.erro)})</span>` : ''}. Importe seus anúncios como produtos da loja (já ficam vinculados e com o estoque sincronizado) ou vincule um produto existente ao anúncio (MLB…) na ficha dele.</p>
            <div class="acoes-gaveta"><button class="btn pequeno" id="ml-importar"><span>📥 Importar anúncios</span></button><button class="btn pequeno contorno" id="ml-sync"><span>Enviar estoque agora</span></button><button class="link-btn" id="ml-sair">desconectar</button></div>`
          : '<a class="btn pequeno" href="/api/admin/ml/conectar"><span>Conectar conta do Mercado Livre</span></a>'}
      </div>

      <div class="caixa"><h3>Backup</h3>
        <p class="suave" style="margin-top:0">Cópia automática do banco de dados todo dia (guarda ${esc(String(i.backups.length))} arquivo(s)). Último: ${i.ultimo_backup ? new Date(i.ultimo_backup).toLocaleString('pt-BR') : 'ainda não feito'}. Baixe de vez em quando para o seu computador.</p>
        ${i.backups.slice(0, 7).map((b) => `<div><a href="/api/admin/backup/${encodeURIComponent(b.arquivo)}">${esc(b.arquivo)}</a> <span class="suave">(${kb(b.tamanho)})</span></div>`).join('')}
        <div class="acoes-gaveta"><button class="btn contorno pequeno" id="backup-agora"><span>Fazer backup agora</span></button></div>
      </div>`;
    $('#ir-config').onclick = () => irPara('configuracoes');
    $('#testar').onclick = async () => { try { const r = await api('/api/admin/testar-avisos', { method: 'POST' }); toast(Object.entries(r).map(([k, v]) => `${k}: ${v}`).join(' · ')); } catch (e) { toast(e.message); } };
    $('#backup-agora').onclick = async () => { try { await api('/api/admin/backup', { method: 'POST' }); toast('Backup feito.'); integracoes(); } catch (e) { toast(e.message); } };
    $('#ml-sync')?.addEventListener('click', async () => { try { const r = await api('/api/admin/ml/sincronizar', { method: 'POST' }); toast(`${r.enviados} anúncio(s) atualizado(s)${r.erros.length ? ` · ${r.erros.length} erro(s): ${r.erros[0]}` : ''}`); } catch (e) { toast(e.message); } });
    $('#ml-sair')?.addEventListener('click', async () => { if (confirm('Desconectar o Mercado Livre?')) { await api('/api/admin/ml/desconectar', { method: 'POST' }); integracoes(); } });
    $('#ml-importar')?.addEventListener('click', importarDoML);
  }

  // Importação de anúncios do Mercado Livre → produtos
  async function importarDoML() {
    abrirGaveta('<span class="etiqueta">Mercado Livre</span><h2>Importar anúncios</h2><p class="carregando">Buscando seus anúncios no Mercado Livre…</p>');
    let lista;
    try { lista = await api('/api/admin/ml/anuncios'); }
    catch (e) { $('#gaveta-conteudo').innerHTML = `<span class="etiqueta">Mercado Livre</span><h2>Importar anúncios</h2><div class="aviso erro">${esc(e.message)}</div>`; return; }
    // Anúncios que só mudam de cor (mesmo título, cor no final) viram 1 linha só — importam juntos como 1 produto com variação de cor
    const porGrupo = new Map();
    for (const a of lista) { if (!porGrupo.has(a.grupo)) porGrupo.set(a.grupo, []); porGrupo.get(a.grupo).push(a); }
    const grupos = [...porGrupo.values()];
    const pendentes = grupos.filter((g) => g.some((a) => !a.importado));
    const linha = (g) => {
      const base = g[0], pend = g.filter((a) => !a.importado), todoImportado = !pend.length;
      const cores = g.map((a) => a.cor).filter(Boolean);
      const titulo = g.length > 1 ? base.titulo.replace(new RegExp(`\\s+${base.cor}$`, 'i'), '') : base.titulo;
      const quantidade = g.reduce((s, a) => s + a.quantidade, 0);
      return `<label style="display:flex;gap:.8rem;align-items:center;padding:.6rem 0;border-bottom:1px solid var(--linha);${todoImportado ? 'opacity:.55' : 'cursor:pointer'}">
        <input type="checkbox" class="ml-sel" data-ids="${esc(pend.map((a) => a.id).join(','))}" ${todoImportado ? 'disabled' : 'checked'}>
        ${base.miniatura ? `<img src="${esc(base.miniatura)}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:8px;background:#222">` : '<div class="placeholder" style="width:48px;height:48px">3D</div>'}
        <div style="flex:1;min-width:0"><div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(titulo)}</div>
          <div class="suave" style="font-size:.85rem">${brl(base.preco_cents)} · ${quantidade} em estoque${base.variacoes ? ` · ${base.variacoes} variação(ões)` : ''} · ${base.status === 'active' ? 'ativo' : 'pausado'}${base.vendidos ? ` · ${base.vendidos} vendido(s)` : ''}
          ${cores.length > 1 ? ` · <strong>une ${cores.length} cores em 1 produto:</strong> ${esc(cores.join(', '))}` : ''}
          ${todoImportado ? ' · <strong>já importado</strong>' : pend.length < g.length ? ` · ${g.length - pend.length} cor(es) já importada(s)` : ''} · <a href="${esc(base.link)}" target="_blank" rel="noopener">ver</a></div></div></label>`;
    };
    $('#gaveta-conteudo').innerHTML = `<span class="etiqueta">Mercado Livre</span><h2>Importar anúncios</h2>
      ${grupos.length ? `<p class="suave" style="margin-top:0">${lista.length} anúncio(s) encontrado(s) em ${grupos.length} produto(s) (anúncios que só mudam de cor entram juntos, como 1 produto com variação de cor), ${pendentes.length} ainda não importado(s). Vêm título, preço, descrição, fotos, estoque, peso e medidas; o produto já fica vinculado ao(s) anúncio(s). Depois você pode editar tudo na ficha do produto.</p>
        <label style="display:flex;gap:.5rem;align-items:center;margin-bottom:.4rem"><input type="checkbox" id="ml-todos" ${pendentes.length ? 'checked' : 'disabled'}> Selecionar todos os pendentes</label>
        <div id="ml-lista">${grupos.map(linha).join('')}</div>
        <div class="acoes-gaveta" style="margin-top:1rem"><button class="btn" id="ml-importar-ok" ${pendentes.length ? '' : 'disabled'}><span>Importar selecionados</span></button><span class="suave" id="ml-progresso"></span></div>`
        : '<div class="aviso">Nenhum anúncio ativo ou pausado encontrado nesta conta.</div>'}`;
    const marcados = () => [...document.querySelectorAll('.ml-sel:checked')].map((c) => c.dataset.ids.split(',').filter(Boolean));
    $('#ml-todos')?.addEventListener('change', (e) => document.querySelectorAll('.ml-sel:not(:disabled)').forEach((c) => { c.checked = e.target.checked; }));
    $('#ml-importar-ok')?.addEventListener('click', async () => {
      const grupos = marcados(); // cada item é a lista de ids (1 ou mais cores) de um produto
      if (!grupos.length) return toast('Marque pelo menos um anúncio.');
      const b = $('#ml-importar-ok'); b.disabled = true;
      const prog = $('#ml-progresso');
      const resultado = { importados: [], pulados: [], erros: [] };
      // Em lotes de 3 produtos: as fotos são baixadas no servidor e cada um leva alguns segundos.
      // Um grupo (cores do mesmo produto) sempre vai inteiro no mesmo lote, pra não separar a mesclagem.
      for (let i = 0; i < grupos.length; i += 3) {
        prog.textContent = `Importando ${Math.min(i + 3, grupos.length)} de ${grupos.length}…`;
        try {
          const ids = grupos.slice(i, i + 3).flat();
          const r = await api('/api/admin/ml/importar', { method: 'POST', body: { ids } });
          resultado.importados.push(...r.importados); resultado.pulados.push(...r.pulados); resultado.erros.push(...r.erros);
        } catch (e) { resultado.erros.push(e.message); }
      }
      prog.textContent = '';
      const semFoto = resultado.importados.filter((x) => !x.fotos).length;
      $('#gaveta-conteudo').innerHTML = `<span class="etiqueta">Mercado Livre</span><h2>Importação concluída</h2>
        <div class="aviso ok">${resultado.importados.length} produto(s) criado(s)${resultado.pulados.length ? ` · ${resultado.pulados.length} já existia(m)` : ''}${semFoto ? ` · ${semFoto} sem foto (não foi possível baixar)` : ''}.</div>
        ${resultado.erros.length ? `<div class="aviso erro"><strong>${resultado.erros.length} erro(s):</strong><br>${resultado.erros.map(esc).join('<br>')}</div>` : ''}
        <ul style="padding-left:1.2rem">${resultado.importados.map((x) => `<li>${esc(x.nome)} <span class="suave">(${x.fotos} foto(s)${x.cores_unidas ? `, ${x.cores_unidas} cores unidas` : ''})</span></li>`).join('')}</ul>
        <p class="ajuda">Confira preço, prazo de produção e cores na ficha de cada produto. Anúncios pausados entraram como produtos inativos.</p>
        <div class="acoes-gaveta"><button class="btn" id="ml-ver-produtos"><span>Ver produtos</span></button></div>`;
      $('#ml-ver-produtos').onclick = () => { fecharGaveta(); irPara('produtos'); };
    });
  }

  iniciar().catch(() => telaLogin());
})();
