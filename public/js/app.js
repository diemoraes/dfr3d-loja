// Código compartilhado da loja: topo, rodapé, carrinho, cookies/analytics e utilitários
const DFR = (() => {
  const CHAVE = 'dfr3d_carrinho_v2';
  const CHAVE_COOKIES = 'dfr3d_cookies';

  const brl = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, el = document) => el.querySelector(sel);
  const armazenar = { ler(k) { try { return localStorage.getItem(k); } catch { return null; } }, gravar(k, v) { try { localStorage.setItem(k, v); } catch {} } };

  async function api(caminho, opcoes = {}) {
    const res = await fetch(caminho, {
      ...opcoes,
      headers: { 'Content-Type': 'application/json', ...(opcoes.headers || {}) },
      body: opcoes.body && typeof opcoes.body !== 'string' ? JSON.stringify(opcoes.body) : opcoes.body,
    });
    const dados = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(dados.erro || 'Algo deu errado. Tente novamente.');
    return dados;
  }

  // ---------- Carrinho (fica no navegador do cliente) ----------
  const mesmoItem = (a, b) => a.produto_id === b.produto_id && a.cor === b.cor && a.variacao === b.variacao && a.personalizacao === b.personalizacao;
  const carrinho = {
    ler() { try { return JSON.parse(armazenar.ler(CHAVE)) || []; } catch { return []; } },
    salvar(itens) { armazenar.gravar(CHAVE, JSON.stringify(itens)); atualizarContador(); },
    adicionar(produto, { quantidade = 1, cor = '', variacao = '', personalizacao = '', preco_cents }) {
      const itens = carrinho.ler();
      const novo = { produto_id: produto.id, slug: produto.slug, nome: produto.nome, preco_cents, imagem: produto.imagens[0] || '', cor, variacao, personalizacao, quantidade };
      const existente = itens.find((i) => mesmoItem(i, novo));
      if (existente) existente.quantidade += quantidade; else itens.push(novo);
      carrinho.salvar(itens);
    },
    alterar(indice, quantidade) {
      const itens = carrinho.ler();
      if (quantidade <= 0) itens.splice(indice, 1); else itens[indice].quantidade = quantidade;
      carrinho.salvar(itens);
    },
    limpar() { carrinho.salvar([]); },
    quantidade() { return carrinho.ler().reduce((s, i) => s + i.quantidade, 0); },
    subtotal() { return carrinho.ler().reduce((s, i) => s + i.preco_cents * i.quantidade, 0); },
    paraApi() { return carrinho.ler().map(({ produto_id, quantidade, cor, variacao, personalizacao }) => ({ produto_id, quantidade, cor, variacao, personalizacao })); },
  };
  const detalhesItem = (i) => [i.variacao, i.cor, i.personalizacao && `“${i.personalizacao}”`].filter(Boolean).map(esc).join(' · ');

  function atualizarContador() {
    const el = document.getElementById('contador-carrinho');
    if (el) { const n = carrinho.quantidade(); el.textContent = n || ''; el.dataset.n = n; }
  }

  let contaCache = null;
  async function conta() {
    if (!contaCache) contaCache = api('/api/conta').catch(() => ({ logado: false, google: false }));
    return contaCache;
  }
  const urlLogin = (voltar = location.pathname + location.search) => `/api/conta/google?voltar=${encodeURIComponent(voltar)}`;

  let lojaConfig = null;
  async function config() {
    if (!lojaConfig) lojaConfig = await api('/api/config').catch(() => ({ loja: {} }));
    return lojaConfig;
  }

  let siteCache = null;
  function site() {
    if (!siteCache) siteCache = api('/api/site');
    return siteCache;
  }

  // ---------- Analytics (só depois do consentimento — LGPD) ----------
  const fila = [];
  let analyticsPronto = false;
  function track(evento, dados = {}) {
    if (!analyticsPronto) { fila.push([evento, dados]); return; }
    const mapaMeta = { view_item: 'ViewContent', add_to_cart: 'AddToCart', begin_checkout: 'InitiateCheckout', purchase: 'Purchase', generate_lead: 'Lead' };
    if (window.gtag) window.gtag('event', evento, { currency: 'BRL', ...dados });
    if (window.fbq && mapaMeta[evento]) window.fbq('track', mapaMeta[evento], { currency: 'BRL', value: dados.value, content_ids: (dados.items || []).map((i) => String(i.item_id)) });
  }
  function carregarAnalytics(cfg) {
    const { ga, metaPixel } = cfg.analytics || {};
    if (!ga && !metaPixel) return;
    if (ga) {
      const s = document.createElement('script'); s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga)}`; document.head.append(s);
      window.dataLayer = window.dataLayer || []; window.gtag = function () { dataLayer.push(arguments); };
      gtag('js', new Date()); gtag('config', ga);
    }
    if (metaPixel) {
      /* eslint-disable */
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
      /* eslint-enable */
      fbq('init', metaPixel); fbq('track', 'PageView');
    }
    analyticsPronto = true;
    fila.splice(0).forEach(([e, d]) => track(e, d));
  }
  function bannerCookies(cfg) {
    const { ga, metaPixel } = cfg.analytics || {};
    if (!ga && !metaPixel) return;
    const escolha = armazenar.ler(CHAVE_COOKIES);
    if (escolha === 'sim') return carregarAnalytics(cfg);
    if (escolha === 'nao') return;
    document.body.insertAdjacentHTML('beforeend', `<div class="cookies" id="cookies" role="dialog" aria-label="Cookies">
      <p>Usamos cookies para medir visitas e melhorar a loja. Veja a <a href="/politicas#privacidade">política de privacidade</a>.</p>
      <div><button class="btn pequeno contorno" data-c="nao"><span>Recusar</span></button> <button class="btn pequeno" data-c="sim"><span>Aceitar</span></button></div></div>`);
    $('#cookies').addEventListener('click', (e) => {
      const b = e.target.closest('[data-c]'); if (!b) return;
      armazenar.gravar(CHAVE_COOKIES, b.dataset.c); $('#cookies').remove();
      if (b.dataset.c === 'sim') carregarAnalytics(cfg);
    });
  }

  function toast(html, ms = 3500) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
    t.innerHTML = html;
    requestAnimationFrame(() => t.classList.add('visivel'));
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('visivel'), ms);
  }

  const fotoOuPlaceholder = (src, alt = '') => src ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy">` : '<div class="placeholder" aria-hidden="true">3D</div>';
  const estrelas = (nota) => `<span class="estrelas" aria-label="${nota} de 5 estrelas">${'★'.repeat(Math.round(nota))}<span>${'★'.repeat(5 - Math.round(nota))}</span></span>`;

  function cardProduto(p) {
    const selo = !p.disponivel ? '<span class="selo cinza">Esgotado</span>' : p.promo_pct ? `<span class="selo promo">-${p.promo_pct}%</span>` : p.vendidos >= 3 ? '<span class="selo escuro">Mais vendido</span>' : p.destaque ? '<span class="selo">Destaque</span>' : '';
    const aPartir = p.preco_max_cents > p.preco_cents ? '<small class="suave" style="font-size:.75rem;font-style:normal;font-weight:500">a partir de</small> ' : '';
    const preco = `${p.promo_pct ? `<s class="de">${brl(p.preco_original_cents)}</s>` : ''}${aPartir}${brl(p.preco_cents)}`;
    return `<a class="card" href="/produto/${esc(p.slug)}">
      <div class="foto">${fotoOuPlaceholder(p.imagens[0], p.nome)}${selo}</div>
      <div class="info">
        ${p.categoria ? `<span class="suave" style="font-size:.8rem;text-transform:uppercase;letter-spacing:.08em">${esc(p.categoria)}</span>` : ''}
        <span class="nome">${esc(p.nome)}</span>
        ${p.avaliacao?.quantidade ? `<span style="font-size:.85rem">${estrelas(p.avaliacao.media)} <span class="suave">(${p.avaliacao.quantidade})</span></span>` : ''}
        <span class="preco">${preco}</span>
      </div></a>`;
  }

  const ICONE_WHATS = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3C9 3 3.3 8.6 3.3 15.6c0 2.2.6 4.4 1.7 6.3L3 29l7.3-1.9c1.8 1 3.8 1.5 5.8 1.5 7 0 12.7-5.6 12.7-12.6S23 3 16 3zm0 23.2c-1.9 0-3.7-.5-5.3-1.4l-.4-.2-4.3 1.1 1.2-4.2-.3-.4c-1-1.6-1.5-3.5-1.5-5.4C5.4 9.9 10.1 5.3 16 5.3s10.6 4.6 10.6 10.4S21.8 26.2 16 26.2zm5.8-7.8c-.3-.2-1.9-.9-2.2-1s-.5-.2-.7.2-.8 1-1 1.2-.4.2-.7.1c-.3-.2-1.3-.5-2.6-1.6-1-.9-1.6-1.9-1.8-2.2s0-.5.1-.6l.5-.6c.2-.2.2-.4.3-.6.1-.2 0-.4 0-.6l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4s-1.2 1.1-1.2 2.7 1.2 3.1 1.4 3.4c.2.2 2.4 3.6 5.7 5 .8.3 1.4.5 1.9.7.8.2 1.5.2 2.1.1.6-.1 1.9-.8 2.2-1.5.3-.7.3-1.4.2-1.5-.1-.2-.3-.3-.6-.4z"/></svg>';

  const formatarTelefone = (n) => { const d = String(n).replace(/^55/, ''); return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d; };

  // Busca no topo com sugestões enquanto digita
  function ligarBusca() {
    const form = document.getElementById('busca-topo'), campo = document.getElementById('campo-busca'), caixa = document.getElementById('sugestoes');
    let timer, pedido = 0, indice = -1;
    const fechar = () => { caixa.hidden = true; indice = -1; };
    const marcar = (n) => { const itens = [...caixa.querySelectorAll('a')]; if (!itens.length) return; indice = (n + itens.length) % itens.length; itens.forEach((a, i) => a.classList.toggle('foco', i === indice)); };
    campo.addEventListener('input', () => {
      clearTimeout(timer);
      const q = campo.value.trim();
      if (q.length < 2) return fechar();
      timer = setTimeout(async () => {
        const n = ++pedido;
        const r = await api('/api/busca?q=' + encodeURIComponent(q)).catch(() => null);
        if (!r || n !== pedido) return;
        if (!r.produtos.length && !r.posts.length) { caixa.innerHTML = `<p class="vazio-busca">Nada encontrado para “${esc(q)}”. <a href="/encomenda">Que tal pedir sob encomenda?</a></p>`; caixa.hidden = false; return; }
        caixa.innerHTML = r.produtos.map((p) => `<a href="/produto/${esc(p.slug)}" role="option"><span class="mini">${fotoOuPlaceholder(p.imagem, p.nome)}</span><span class="txt"><strong>${esc(p.nome)}</strong><small>${esc(p.categoria)}</small></span><span class="preco-sug">${p.preco_original_cents > p.preco_cents ? `<s>${brl(p.preco_original_cents)}</s>` : ''}${brl(p.preco_cents)}</span></a>`).join('')
          + (r.posts.length ? `<div class="titulo-sug">No blog</div>${r.posts.map((p) => `<a href="/blog/${esc(p.slug)}" role="option"><span class="txt"><strong>${esc(p.titulo)}</strong></span></a>`).join('')}` : '')
          + `<a href="/produtos?busca=${encodeURIComponent(q)}" class="ver-todos" role="option">Ver todos os resultados para “${esc(q)}” →</a>`;
        caixa.hidden = false; indice = -1;
      }, 220);
    });
    campo.addEventListener('keydown', (e) => {
      if (caixa.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); marcar(indice + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); marcar(indice - 1); }
      else if (e.key === 'Escape') fechar();
      else if (e.key === 'Enter' && indice >= 0) { e.preventDefault(); caixa.querySelectorAll('a')[indice].click(); }
    });
    form.addEventListener('submit', (e) => { if (!campo.value.trim()) e.preventDefault(); });
    document.addEventListener('click', (e) => { if (!form.contains(e.target)) fechar(); });
  }

  async function montarLayout() {
    const atual = location.pathname;
    const ativo = (p) => (atual === p || (p !== '/' && atual.startsWith(p)) ? 'ativo' : '');
    const qAtual = new URLSearchParams(location.search).get('busca') || '';
    if (!document.querySelector('header.topo')) {
      document.body.insertAdjacentHTML('afterbegin', `
        <a class="sr-only" href="#conteudo">Pular para o conteúdo</a>
        <header class="topo"><div class="container linha-topo">
          <a class="marca" href="/" aria-label="DFR 3D Impressão - início"><picture><source srcset="/img/logo-transparente-sm.webp" type="image/webp"><img src="/img/logo-transparente.png" alt="DFR 3D Impressão" width="160" height="65"></picture></a>
          <form class="busca" id="busca-topo" role="search" action="/produtos">
            <label for="campo-busca" class="sr-only">Buscar produtos</label>
            <input id="campo-busca" name="busca" type="search" placeholder="Buscar produtos, presentes, ideias…" autocomplete="off" value="${esc(qAtual)}" aria-autocomplete="list" aria-controls="sugestoes">
            <button aria-label="Buscar"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="m15.5 15.5 5 5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button>
            <div class="sugestoes" id="sugestoes" role="listbox" hidden></div>
          </form>
          <nav class="acoes-topo" aria-label="Atalhos">
            <a href="#" class="icone-topo icone-whats" id="whats-topo" target="_blank" rel="noopener" aria-label="WhatsApp" hidden>${ICONE_WHATS}<span class="so-desktop">WhatsApp</span></a>
            <a href="/conta" class="icone-topo link-conta ${ativo('/conta')}" id="link-conta" aria-label="Minha conta"><span class="avatar" aria-hidden="true">👤</span><span class="so-desktop" id="nome-conta">Entrar</span></a>
            <a href="/carrinho" class="icone-topo btn-carrinho ${ativo('/carrinho')}" aria-label="Carrinho"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2.2l2.3 11.2a1.6 1.6 0 0 0 1.6 1.3h8.4a1.6 1.6 0 0 0 1.6-1.2L21 8H6.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="9.5" cy="20" r="1.5" fill="currentColor"/><circle cx="17" cy="20" r="1.5" fill="currentColor"/></svg><span class="so-desktop">Carrinho</span><span class="contador" id="contador-carrinho"></span></a>
          </nav>
        </div>
        <div class="faixa"></div>
        <nav class="menu-categorias" aria-label="Categorias"><div class="container" id="menu-categorias">
          <a href="/produtos" class="${atual === '/produtos' && !location.search ? 'ativo' : ''}"><strong>Todos</strong><small>Ver a loja</small></a>
        </div></nav></header>`);
    } else {
      const campo = document.getElementById('campo-busca');
      if (campo && !campo.value && qAtual) campo.value = qAtual;
      if (atual === '/produtos' && location.search) {
        document.querySelector('#menu-categorias a[href="/produtos"]')?.classList.remove('ativo');
      }
    }

    // Menu de categorias (editável no painel)
    site().then((s) => {
      const cat = new URLSearchParams(location.search).get('categoria');
      const itens = s.menu.map((m) => `<a href="/produtos?categoria=${encodeURIComponent(m.nome)}" class="${cat === m.nome ? 'ativo' : ''}"><strong>${esc(m.nome)}</strong><small>${esc(m.subtitulo)}</small></a>`).join('');
      document.getElementById('menu-categorias').insertAdjacentHTML('beforeend', `${itens}
        <a href="/produtos?promo=1" class="destaque-menu ${new URLSearchParams(location.search).get('promo') ? 'ativo' : ''}"><strong>Promoções</strong><small>Preços especiais</small></a>
        <a href="/encomenda" class="${ativo('/encomenda')}"><strong>Sob encomenda</strong><small>Seu projeto em 3D</small></a>
        <a href="/blog" class="${ativo('/blog')}"><strong>Blog</strong><small>Dicas e novidades</small></a>`);
      document.querySelector('.menu-categorias .ativo')?.scrollIntoView({ inline: 'center', block: 'nearest' });
    }).catch(() => {});
    ligarBusca();
    atualizarContador();
    conta().then((c) => {
      if (!c.logado) { if (!c.google) document.getElementById('nome-conta').textContent = 'Pedidos'; return; }
      document.getElementById('nome-conta').textContent = c.cliente.primeiro_nome;
      if (c.cliente.foto) document.querySelector('#link-conta .avatar').innerHTML = `<img src="${esc(c.cliente.foto)}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith('👤')">`;
    });
    const cfg = await config();
    const l = cfg.loja || {};
    if (cfg.whatsapp) { const w = document.getElementById('whats-topo'); w.href = `https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent('Olá! Vim pelo site da DFR 3D.')}`; w.hidden = false; }
    document.body.insertAdjacentHTML('beforeend', `
      <footer class="rodape"><div class="container">
        <picture><source srcset="/img/logo-transparente-sm.webp" type="image/webp"><img src="/img/logo-transparente.png" alt="DFR 3D Impressão" width="100" height="40" loading="lazy"></picture>
        <div class="links">
          <a href="/produtos">Produtos</a><a href="/produtos?promo=1">Promoções</a><a href="/encomenda">Peça sob encomenda</a><a href="/blog">Blog</a><a href="/conta">Meus pedidos</a>
          ${cfg.whatsapp ? `<a href="https://wa.me/${esc(cfg.whatsapp)}" target="_blank" rel="noopener" class="whats-rodape">${ICONE_WHATS} WhatsApp ${esc(formatarTelefone(cfg.whatsapp))}</a>` : ''}
          <a href="/politicas#trocas">Trocas e devoluções</a><a href="/politicas#privacidade">Privacidade</a>
          ${cfg.instagram ? `<a href="https://instagram.com/${esc(cfg.instagram)}" target="_blank" rel="noopener">Instagram @${esc(cfg.instagram)}</a>` : ''}
          ${cfg.email ? `<a href="mailto:${esc(cfg.email)}">${esc(cfg.email)}</a>` : ''}
        </div>
        <div class="identificacao">
          <strong>${esc(l.nome || 'DFR 3D Impressão')}</strong> · ${esc(l.cidade || 'São José dos Campos - SP')}
          <br>© ${new Date().getFullYear()} · Pagamento seguro via Mercado Pago
        </div>
      </div></footer>
      ${cfg.whatsapp ? `<a class="whats-flutuante" href="https://wa.me/${esc(cfg.whatsapp)}?text=${encodeURIComponent('Olá! Vim pelo site da DFR 3D.')}" target="_blank" rel="noopener" aria-label="Falar no WhatsApp">${ICONE_WHATS}</a>` : ''}`);
    bannerCookies(cfg);
  }

  document.addEventListener('DOMContentLoaded', montarLayout);
  window.addEventListener('storage', atualizarContador);

  return { formatarTelefone, conta, urlLogin, brl, esc, $, api, site, carrinho, detalhesItem, config, toast, cardProduto, fotoOuPlaceholder, estrelas, track, armazenar };
})();
