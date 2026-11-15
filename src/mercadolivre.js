// Sincronização de estoque com o Mercado Livre
// - Venda no site  → atualiza a quantidade do anúncio no ML
// - Venda no ML    → baixa o estoque no site (via notificação "orders_v2")
// Só vale para produtos com estoque controlado (não "sob demanda") e vinculados a um anúncio (MLB...).
import { config } from './config.js';
import { db, lerAjuste, salvarAjuste } from './db.js';
import { eventos, emitir } from './eventos.js';
import { HttpError } from './http.js';
import { normalizar } from './catalogo.js';

const API = 'https://api.mercadolibre.com';
export const mlConfigurado = () => Boolean(config.mercadoLivre.clientId && config.mercadoLivre.clientSecret);
export const mlConectado = () => Boolean(lerAjuste('ml_tokens'));
const redirectUri = () => `${config.baseUrl}/api/admin/ml/callback`;

export function urlAutorizacao(state) {
  const q = new URLSearchParams({ response_type: 'code', client_id: config.mercadoLivre.clientId, redirect_uri: redirectUri(), state });
  return `https://auth.mercadolivre.com.br/authorization?${q}`;
}

async function pedirToken(params) {
  const res = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: config.mercadoLivre.clientId, client_secret: config.mercadoLivre.clientSecret, ...params }),
    signal: AbortSignal.timeout(15000),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, `Mercado Livre recusou a conexão: ${d.message || res.status}`);
  const tokens = { access_token: d.access_token, refresh_token: d.refresh_token, user_id: d.user_id, expira: Date.now() + (d.expires_in - 300) * 1000 };
  salvarAjuste('ml_tokens', tokens);
  return tokens;
}

export const conectar = (code) => pedirToken({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() });
export const desconectar = () => db.prepare("DELETE FROM ajustes WHERE chave = 'ml_tokens'").run();

async function token() {
  let t = lerAjuste('ml_tokens');
  if (!t) throw new HttpError(400, 'Mercado Livre não conectado.');
  if (Date.now() > t.expira) t = await pedirToken({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
  return t;
}

async function ml(caminho, opcoes = {}) {
  const t = await token();
  const res = await fetch(API + caminho, {
    ...opcoes,
    headers: { Authorization: `Bearer ${t.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, `Mercado Livre: ${d.message || d.error || res.status}`);
  return d;
}

export async function contaML() {
  const t = await token();
  const u = await ml(`/users/${t.user_id}`);
  return { id: u.id, apelido: u.nickname };
}

export async function lerAnuncio(itemId) {
  const it = await ml(`/items/${encodeURIComponent(itemId)}`);
  return { id: it.id, titulo: it.title, quantidade: it.available_quantity, status: it.status, link: it.permalink, tem_variacoes: (it.variations || []).length > 0 };
}

/** Um produto pode estar ligado a mais de um anúncio (cores importadas juntas como 1 produto só). */
export const idsDoProduto = (mlItemId) => String(mlItemId || '').split(',').map((s) => s.trim()).filter(Boolean);

async function enviarEstoqueParaAnuncio(itemId, quantidade) {
  const it = await ml(`/items/${itemId}`);
  if ((it.variations || []).length) {
    // Anúncio com variações: aplica a mesma quantidade a todas (ajuste fino no ML se precisar)
    await ml(`/items/${itemId}`, { method: 'PUT', body: JSON.stringify({ variations: it.variations.map((v) => ({ id: v.id, available_quantity: quantidade })) }) });
  } else if (quantidade === 0) {
    await ml(`/items/${itemId}`, { method: 'PUT', body: JSON.stringify({ available_quantity: 0 }) }).catch(async () => {
      await ml(`/items/${itemId}`, { method: 'PUT', body: JSON.stringify({ status: 'paused' }) });
    });
  } else {
    await ml(`/items/${itemId}`, { method: 'PUT', body: JSON.stringify({ available_quantity: quantidade, ...(it.status === 'paused' ? { status: 'active' } : {}) }) });
  }
}

/** Envia o estoque do site para o(s) anúncio(s) ligados ao produto (a mesma quantidade para cada cor/anúncio). */
export async function enviarEstoque(produto) {
  if (!produto.ml_item_id || produto.estoque === null || !mlConectado()) return;
  const quantidade = Math.max(produto.estoque, 0);
  for (const itemId of idsDoProduto(produto.ml_item_id)) await enviarEstoqueParaAnuncio(itemId, quantidade);
}

/** Notificação do ML: uma venda lá baixa o estoque aqui (cada pedido só uma vez). */
export async function processarNotificacao(corpo) {
  if (corpo.topic !== 'orders_v2' || !corpo.resource) return;
  const t = await token();
  if (String(corpo.user_id) !== String(t.user_id)) return;
  const pedido = await ml(corpo.resource);
  if (pedido.status !== 'paid') return;
  const processados = lerAjuste('ml_pedidos_processados', []);
  if (processados.includes(pedido.id)) return;
  const alterados = [], vendidos = [];
  for (const item of pedido.order_items || []) {
    // produto pode estar ligado a mais de um anúncio (cores importadas juntas) — compara por item, não pela coluna inteira
    const p = db.prepare("SELECT * FROM produtos WHERE estoque IS NOT NULL AND ml_item_id != ''").all()
      .find((x) => idsDoProduto(x.ml_item_id).includes(item.item.id));
    if (!p) continue;
    db.prepare('UPDATE produtos SET estoque = MAX(estoque - ?, 0) WHERE id = ?').run(item.quantity, p.id);
    alterados.push(p.id);
    vendidos.push({ nome: p.nome, quantidade: item.quantity, restante: Math.max(p.estoque - item.quantity, 0) });
  }
  salvarAjuste('ml_pedidos_processados', [pedido.id, ...processados].slice(0, 500));
  if (alterados.length) console.log(`Mercado Livre: venda ${pedido.id} baixou estoque de ${alterados.length} produto(s).`);
  if (vendidos.length) emitir('ml:venda', { pedidoMl: pedido.id, itens: vendidos });
  emitir('estoque:alterado:ml', alterados);
}

// Venda/cancelamento no site → atualiza o anúncio
async function sincronizarAnuncios(ids) {
  if (!mlConectado()) return;
  for (const id of new Set(ids)) {
    const p = db.prepare('SELECT * FROM produtos WHERE id = ?').get(id);
    if (p?.ml_item_id) await enviarEstoque(p).catch((e) => console.error(`ML estoque ${p.ml_item_id}:`, e.message));
  }
}
eventos.on('estoque:alterado', sincronizarAnuncios);   // venda/cancelamento no site
eventos.on('estoque:sincronizar', sincronizarAnuncios); // ajuste de estoque no painel

// ---------- Importação de anúncios → produtos da loja ----------

// O Mercado Livre tem uma árvore de categorias bem mais granular do que o menu da loja
// (ex.: "Suportes para Celulares", "Enfeites para Árvores"), e o filtro do menu compara o
// texto exato — por isso um anúncio importado direto nunca aparecia em "Natal", "Chaveiros"
// etc. Aqui a gente classifica pelo título do anúncio (e pela categoria do ML, como reforço)
// numa das categorias que já existem no menu da loja.
const REGRAS_CATEGORIA = [
  ['Natal', ['natal', 'noel', 'natalino', 'advento']],
  ['Chaveiros', ['chaveiro']],
  ['Geek e Games', [
    'playstation', 'ps5', 'ps4', 'xbox', 'nintendo', 'kratos', 'god of war', 'alexa', 'echo dot',
    'celular', 'notebook', 'fone de ouvido', 'headset', 'figura de acao', 'figurinha', 'colecionave',
    'apple watch', 'magic mouse', 'controle remoto', 'controles remotos', 'geek', 'gamer',
  ]],
  ['Utilidades', ['organizador', 'organizadora', 'porta ovos', 'porta copos', 'painel', 'bancada', 'cozinha', 'banheiro', 'cabo']],
  ['Decoração', ['vaso', 'luminaria', 'quadro', 'decorativ', 'enfeite', 'estatueta', 'bandeja']],
  ['Personalizados', ['personalizado', 'personalizada', 'com foto', 'gravado a laser']],
];
/** Escolhe a categoria do menu da loja mais próxima do anúncio, pelo título e pela categoria do ML. */
export function categoriaDaLoja(tituloAnuncio, nomeCategoriaMl = '') {
  const texto = normalizar(`${tituloAnuncio} ${nomeCategoriaMl}`);
  for (const [categoria, palavras] of REGRAS_CATEGORIA) {
    if (palavras.some((p) => texto.includes(normalizar(p)))) return categoria;
  }
  if (texto.includes('suporte')) return 'Utilidades'; // genérico, sem outro sinal mais específico
  return 'Presentes';
}

// Vários anúncios do mesmo produto, um para cada cor, têm o mesmo título com a cor só no final
// ("... Colmeia 3d Vermelho" / "... Colmeia 3d Verde"). Ao importar, eles viram 1 produto só com
// as cores na ficha — igual ao Mercado Livre — em vez de 3 produtos "duplicados".
const CORES_CONHECIDAS = ['vermelho', 'verde', 'azul', 'amarelo', 'branco', 'preto', 'rosa', 'roxo', 'laranja', 'cinza', 'marrom', 'dourado', 'prateado', 'bege', 'turquesa', 'vinho'];
/** Separa a última palavra do título quando é uma cor conhecida. */
export function baseSemCor(titulo) {
  const partes = String(titulo || '').trim().split(/\s+/);
  const ultima = partes[partes.length - 1] || '';
  if (partes.length > 1 && CORES_CONHECIDAS.includes(normalizar(ultima))) return { base: partes.slice(0, -1).join(' '), cor: ultima };
  return { base: String(titulo || '').trim(), cor: '' };
}

/** Converte um anúncio do ML em dados prontos para a tabela produtos (sem tocar no banco). Exportado para testes. */
export function anuncioParaProduto(it, descricao = '', nomeCategoria = '') {
  const attr = (id) => (it.attributes || []).find((a) => a.id === id)?.value_name || '';
  // Peso e medidas: vêm em shipping.dimensions ("AxLxC,peso" em cm e g) ou nos atributos do pacote
  let peso = 0, alt = 0, larg = 0, comp = 0;
  const dim = /^(\d+(?:[.,]\d+)?)x(\d+(?:[.,]\d+)?)x(\d+(?:[.,]\d+)?),(\d+(?:[.,]\d+)?)$/.exec(it.shipping?.dimensions || '');
  const n = (s) => parseFloat(String(s).replace(',', '.')) || 0;
  if (dim) { alt = n(dim[1]); larg = n(dim[2]); comp = n(dim[3]); peso = n(dim[4]); }
  const medida = (id) => { const m = /^(\d+(?:[.,]\d+)?)\s*(g|kg|cm|mm|m)?$/i.exec(attr(id).trim()); if (!m) return 0; const v = n(m[1]); const u = (m[2] || '').toLowerCase(); return u === 'kg' ? v * 1000 : u === 'mm' ? v / 10 : u === 'm' ? v * 100 : v; };
  peso = peso || medida('PACKAGE_WEIGHT') || medida('WEIGHT');
  alt = alt || medida('PACKAGE_HEIGHT') || medida('HEIGHT');
  larg = larg || medida('PACKAGE_WIDTH') || medida('WIDTH');
  comp = comp || medida('PACKAGE_LENGTH') || medida('LENGTH');

  // Variações (ex.: Cor, Tamanho) → opções com preço; cores viram a lista de cores do produto
  const vars = it.variations || [];
  const variacoes = vars.map((v) => ({
    nome: (v.attribute_combinations || []).map((c) => c.value_name).filter(Boolean).join(' / ').slice(0, 60) || `Opção ${v.id}`,
    preco_cents: Math.round((v.price ?? it.price) * 100),
    estoque: v.available_quantity ?? 0,
  }));
  const rotulo = vars[0]?.attribute_combinations?.map((c) => c.name).filter(Boolean).join(' / ').slice(0, 30) || 'Tamanho';
  const cores = [...new Set(vars.flatMap((v) => (v.attribute_combinations || []).filter((c) => /cor|color/i.test(c.id || c.name || '')).map((c) => c.value_name)).filter(Boolean))];
  const precos = variacoes.map((v) => v.preco_cents);
  const precoUnico = precos.length && precos.every((p) => p === precos[0]);
  const estoque = vars.length ? variacoes.reduce((s, v) => s + v.estoque, 0) : (it.available_quantity ?? 0);

  return {
    nome: String(it.title || '').slice(0, 120),
    descricao: String(descricao || '').slice(0, 5000),
    categoria: categoriaDaLoja(it.title || '', nomeCategoria),
    preco_cents: Math.round((it.price || 0) * 100),
    estoque,
    prazo_dias: 0,
    cores: cores.join(', ').slice(0, 400),
    peso_g: Math.max(1, Math.round(peso) || 200),
    largura_cm: Math.max(1, Math.round(larg) || 10),
    altura_cm: Math.max(1, Math.round(alt) || 10),
    comprimento_cm: Math.max(1, Math.round(comp) || 10),
    ativo: it.status === 'active' ? 1 : 0,
    destaque: 0,
    // Opções só fazem sentido se os preços diferem; se são iguais, viram só "cores" (quando for cor) e não poluem a ficha
    variacoes: JSON.stringify(precoUnico ? [] : variacoes.map(({ nome, preco_cents }) => ({ nome, preco_cents }))),
    variacao_rotulo: rotulo,
    personalizacao: '',
    personalizacao_max: 20,
    ml_item_id: it.id,
    promo_pct: 0,
    promo_ate: '',
    fotos: (it.pictures || []).map((p) => p.secure_url || p.url).filter(Boolean).slice(0, 10),
    link: it.permalink,
    status_ml: it.status,
  };
}

/** Lista os anúncios da conta conectada (ativos e pausados), com miniatura e se já foram importados. */
export async function listarAnuncios() {
  const t = await token();
  const ids = [];
  for (const status of ['active', 'paused']) {
    for (let offset = 0; offset < 1000; offset += 50) {
      const r = await ml(`/users/${t.user_id}/items/search?status=${status}&limit=50&offset=${offset}`);
      const pagina = r.results || [];
      ids.push(...pagina);
      if (pagina.length < 50) break; // última página
    }
  }
  const unicos = [...new Set(ids)];
  // produto pode estar ligado a mais de um anúncio (cores importadas juntas como 1 produto só)
  const importados = new Set(db.prepare("SELECT ml_item_id FROM produtos WHERE ml_item_id != ''").all().flatMap((p) => idsDoProduto(p.ml_item_id)));
  const lista = [];
  for (let i = 0; i < unicos.length; i += 20) {
    const lote = await ml(`/items?ids=${unicos.slice(i, i + 20).join(',')}&attributes=id,title,price,available_quantity,status,permalink,secure_thumbnail,thumbnail,variations,sold_quantity`);
    for (const r of lote) {
      const b = r.body; if (!b || r.code !== 200) continue;
      const { base, cor } = baseSemCor(b.title);
      lista.push({ id: b.id, titulo: b.title, preco_cents: Math.round((b.price || 0) * 100), quantidade: b.available_quantity ?? 0, status: b.status,
        link: b.permalink, miniatura: b.secure_thumbnail || b.thumbnail || '', variacoes: (b.variations || []).length, vendidos: b.sold_quantity || 0,
        importado: importados.has(b.id), grupo: normalizar(base), cor });
    }
  }
  lista.sort((a, b) => (a.status === b.status ? a.titulo.localeCompare(b.titulo) : a.status === 'active' ? -1 : 1));
  return lista;
}

async function baixarFoto(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`foto ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const nomesCategoria = new Map();
async function nomeCategoria(id) {
  if (!id) return '';
  if (!nomesCategoria.has(id)) nomesCategoria.set(id, await ml(`/categories/${id}`).then((c) => c.name || '').catch(() => ''));
  return nomesCategoria.get(id);
}

/**
 * Importa anúncios (por id MLB...) como produtos novos. Anúncios já vinculados a um produto são pulados.
 * @param {string[]} ids
 * @param {{salvarFoto:(buf:Buffer)=>string, inserirProduto:(d:object)=>number}} deps
 */
export async function importarAnuncios(ids, { salvarFoto, inserirProduto }) {
  const resultado = { importados: [], pulados: [], erros: [] };
  const jaLigados = new Set(db.prepare("SELECT ml_item_id FROM produtos WHERE ml_item_id != ''").all().flatMap((p) => idsDoProduto(p.ml_item_id)));

  // 1ª passada: valida e busca cada anúncio escolhido
  const buscados = [];
  for (const idBruto of ids) {
    const id = String(idBruto || '').toUpperCase().trim();
    if (!/^MLB\d+$/.test(id)) { resultado.erros.push(`${idBruto}: código inválido`); continue; }
    if (jaLigados.has(id)) { resultado.pulados.push(id); continue; }
    try {
      const it = await ml(`/items/${id}`);
      const desc = await ml(`/items/${id}/description`).then((d) => d.plain_text || '').catch(() => '');
      buscados.push({ id, it, desc, ...baseSemCor(it.title) });
    } catch (e) {
      resultado.erros.push(`${id}: ${e.message}`);
    }
  }

  // 2ª passada: agrupa pelo nome sem a cor (mesmo produto, só muda a cor) e cria 1 produto por grupo
  const grupos = new Map();
  for (const item of buscados) {
    const chave = normalizar(item.base);
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(item);
  }

  for (const grupo of grupos.values()) {
    const idsGrupo = grupo.map((g) => g.id).join(',');
    try {
      const categoria = await nomeCategoria(grupo[0].it.category_id);
      const convertidos = grupo.map((g) => ({ ...g, d: anuncioParaProduto(g.it, g.desc, categoria) }));
      const cores = [...new Set(convertidos.map((g) => g.cor).filter(Boolean))];
      const d = {
        ...convertidos[0].d,
        nome: grupo.length > 1 ? grupo[0].base.slice(0, 120) : convertidos[0].d.nome,
        cores: cores.length ? cores.join(', ').slice(0, 400) : convertidos[0].d.cores,
        estoque: convertidos.reduce((s, g) => s + (g.d.estoque || 0), 0),
        fotos: [...new Set(convertidos.flatMap((g) => g.d.fotos))].slice(0, 10),
        ml_item_id: idsGrupo,
      };
      const imagens = [];
      for (const url of d.fotos) {
        try { imagens.push(salvarFoto(await baixarFoto(url))); } catch (e) { console.error(`ML ${idsGrupo} foto:`, e.message); }
      }
      const produtoId = inserirProduto({ ...d, imagens: JSON.stringify(imagens) });
      resultado.importados.push({ id: idsGrupo, produto_id: produtoId, nome: d.nome, fotos: imagens.length, cores_unidas: grupo.length > 1 ? grupo.length : 0 });
    } catch (e) {
      resultado.erros.push(`${idsGrupo}: ${e.message}`);
    }
  }
  return resultado;
}
