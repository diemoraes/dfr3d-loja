// Banco de dados SQLite (embutido no Node.js 22.5+, sem instalar nada)
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { emitir } from './eventos.js';
import { HttpError } from './http.js';

export const db = new DatabaseSync(config.dbFile);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS produtos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT UNIQUE NOT NULL,
  nome          TEXT NOT NULL,
  descricao     TEXT DEFAULT '',
  categoria     TEXT DEFAULT '',
  preco_cents   INTEGER NOT NULL,
  estoque       INTEGER,              -- NULL = feito sob demanda (sem limite)
  prazo_dias    INTEGER DEFAULT 3,
  cores         TEXT DEFAULT '',
  peso_g        INTEGER DEFAULT 200,
  largura_cm    INTEGER DEFAULT 10,
  altura_cm     INTEGER DEFAULT 10,
  comprimento_cm INTEGER DEFAULT 10,
  imagens       TEXT DEFAULT '[]',
  ativo         INTEGER DEFAULT 1,
  destaque      INTEGER DEFAULT 0,
  criado_em     TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS pedidos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo          TEXT UNIQUE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'aguardando_pagamento',
  origem          TEXT DEFAULT 'loja',
  cliente_nome    TEXT NOT NULL,
  cliente_email   TEXT NOT NULL,
  cliente_telefone TEXT DEFAULT '',
  cliente_cpf     TEXT DEFAULT '',
  cep             TEXT DEFAULT '',
  endereco        TEXT DEFAULT '',
  numero          TEXT DEFAULT '',
  complemento     TEXT DEFAULT '',
  bairro          TEXT DEFAULT '',
  cidade          TEXT DEFAULT '',
  uf              TEXT DEFAULT '',
  entrega_tipo    TEXT NOT NULL,
  entrega_servico TEXT DEFAULT '',
  entrega_servico_id TEXT DEFAULT '',
  entrega_prazo   INTEGER,
  frete_cents     INTEGER DEFAULT 0,
  subtotal_cents  INTEGER NOT NULL,
  total_cents     INTEGER NOT NULL,
  itens           TEXT NOT NULL,
  observacoes     TEXT DEFAULT '',
  pagamento_status TEXT DEFAULT '',
  pagamento_metodo TEXT DEFAULT '',
  mp_preference_id TEXT DEFAULT '',
  mp_payment_id   TEXT DEFAULT '',
  link_pagamento  TEXT DEFAULT '',
  rastreio        TEXT DEFAULT '',
  notas_internas  TEXT DEFAULT '',
  estoque_baixado INTEGER DEFAULT 0,
  criado_em       TEXT DEFAULT (datetime('now','localtime')),
  atualizado_em   TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS encomendas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo        TEXT UNIQUE NOT NULL,
  status        TEXT NOT NULL DEFAULT 'nova',
  nome          TEXT NOT NULL,
  email         TEXT NOT NULL,
  telefone      TEXT DEFAULT '',
  descricao     TEXT NOT NULL,
  link_referencia TEXT DEFAULT '',
  quantidade    INTEGER DEFAULT 1,
  cor           TEXT DEFAULT '',
  prazo_desejado TEXT DEFAULT '',
  arquivos      TEXT DEFAULT '[]',
  valor_cents   INTEGER,
  resposta      TEXT DEFAULT '',
  pedido_codigo TEXT DEFAULT '',
  criado_em     TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS historico (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id  INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  status     TEXT NOT NULL,
  nota       TEXT DEFAULT '',
  criado_em  TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS cupons (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo        TEXT UNIQUE NOT NULL COLLATE NOCASE,
  tipo          TEXT NOT NULL DEFAULT 'pct',  -- pct | valor | frete
  valor         INTEGER NOT NULL DEFAULT 0,   -- % ou centavos
  minimo_cents  INTEGER DEFAULT 0,
  validade      TEXT DEFAULT '',              -- AAAA-MM-DD (vazio = sem validade)
  usos_max      INTEGER,                      -- NULL = ilimitado
  usos          INTEGER DEFAULT 0,
  ativo         INTEGER DEFAULT 1,
  criado_em     TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS avaliacoes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id  INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  pedido_id   INTEGER REFERENCES pedidos(id) ON DELETE SET NULL,
  nome        TEXT NOT NULL,
  nota        INTEGER NOT NULL,
  comentario  TEXT DEFAULT '',
  foto        TEXT DEFAULT '',
  aprovada    INTEGER DEFAULT 0,
  criado_em   TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE (produto_id, pedido_id)
);

CREATE TABLE IF NOT EXISTS clientes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  google_sub   TEXT UNIQUE,
  email        TEXT UNIQUE NOT NULL COLLATE NOCASE,
  nome         TEXT NOT NULL,
  foto         TEXT DEFAULT '',
  telefone     TEXT DEFAULT '',
  cpf          TEXT DEFAULT '',
  cep          TEXT DEFAULT '',
  endereco     TEXT DEFAULT '',
  numero       TEXT DEFAULT '',
  complemento  TEXT DEFAULT '',
  bairro       TEXT DEFAULT '',
  cidade       TEXT DEFAULT '',
  uf           TEXT DEFAULT '',
  criado_em    TEXT DEFAULT (datetime('now','localtime')),
  ultimo_login TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS posts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT UNIQUE NOT NULL,
  titulo       TEXT NOT NULL,
  resumo       TEXT DEFAULT '',
  conteudo     TEXT DEFAULT '',          -- Markdown simples
  capa         TEXT DEFAULT '',
  categoria    TEXT DEFAULT '',
  produtos     TEXT DEFAULT '[]',        -- ids de produtos relacionados
  publicado    INTEGER DEFAULT 0,
  publicado_em TEXT DEFAULT '',
  criado_em    TEXT DEFAULT (datetime('now','localtime')),
  atualizado_em TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS perguntas (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id   INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  cliente_id   INTEGER,
  nome         TEXT NOT NULL,
  email        TEXT NOT NULL,           -- nunca aparece no site
  pergunta     TEXT NOT NULL,
  resposta     TEXT DEFAULT '',
  publicada    INTEGER DEFAULT 1,       -- 0 = ocultada pelo painel
  respondida_em TEXT DEFAULT '',
  ip           TEXT DEFAULT '',
  criado_em    TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_perguntas_produto ON perguntas(produto_id, publicada);

CREATE TABLE IF NOT EXISTS ajustes (
  chave  TEXT PRIMARY KEY,
  valor  TEXT
);

CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos(status);
CREATE INDEX IF NOT EXISTS idx_produtos_ativo ON produtos(ativo);
CREATE INDEX IF NOT EXISTS idx_avaliacoes_produto ON avaliacoes(produto_id, aprovada);
`);

// ---------- Migrações: novas colunas em bancos já existentes ----------
function adicionarColuna(tabela, coluna, definicao) {
  const existe = db.prepare(`PRAGMA table_info(${tabela})`).all().some((c) => c.name === coluna);
  if (!existe) db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`);
}
adicionarColuna('produtos', 'variacoes', "TEXT DEFAULT '[]'");          // [{nome, preco_cents}]
adicionarColuna('produtos', 'variacao_rotulo', "TEXT DEFAULT 'Tamanho'");
adicionarColuna('produtos', 'personalizacao', "TEXT DEFAULT ''");       // rótulo, ex.: "Nome no chaveiro"
adicionarColuna('produtos', 'personalizacao_max', 'INTEGER DEFAULT 20');
adicionarColuna('produtos', 'ml_item_id', "TEXT DEFAULT ''");
adicionarColuna('produtos', 'promo_pct', 'INTEGER DEFAULT 0');           // % de desconto da promoção
adicionarColuna('produtos', 'promo_ate', "TEXT DEFAULT ''");             // AAAA-MM-DD (vazio = sem prazo)
adicionarColuna('pedidos', 'desconto_cents', 'INTEGER DEFAULT 0');
adicionarColuna('pedidos', 'cupom', "TEXT DEFAULT ''");
adicionarColuna('pedidos', 'forma_pagamento', "TEXT DEFAULT ''");     // pix | cartao
adicionarColuna('pedidos', 'me_order_id', "TEXT DEFAULT ''");
adicionarColuna('pedidos', 'etiqueta_url', "TEXT DEFAULT ''");
adicionarColuna('pedidos', 'cupom_contado', 'INTEGER DEFAULT 0');
adicionarColuna('pedidos', 'cliente_id', 'INTEGER');
adicionarColuna('pedidos', 'rastreio_status', "TEXT DEFAULT ''");
adicionarColuna('pedidos', 'rastreio_verificado', "TEXT DEFAULT ''");
adicionarColuna('encomendas', 'cliente_id', 'INTEGER');
db.exec('CREATE INDEX IF NOT EXISTS idx_pedidos_cliente ON pedidos(cliente_id); CREATE INDEX IF NOT EXISTS idx_pedidos_email ON pedidos(cliente_email);');

export const STATUS_PEDIDO = {
  aguardando_pagamento: 'Aguardando pagamento',
  pago: 'Pago',
  em_producao: 'Em produção',
  pronto_retirada: 'Pronto para retirada',
  enviado: 'Enviado',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
};

export const STATUS_ENCOMENDA = {
  nova: 'Nova',
  orcada: 'Orçamento enviado',
  aprovada: 'Aprovada',
  recusada: 'Recusada',
};

export function gerarCodigo(prefixo) {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (const b of crypto.getRandomValues(new Uint8Array(6))) c += letras[b % letras.length];
  return `${prefixo}-${c}`;
}

export const lerJson = (s, padrao = []) => { try { return JSON.parse(s || ''); } catch { return padrao; } };

export function notaMedia(produtoId) {
  const r = db.prepare('SELECT COUNT(*) n, AVG(nota) media FROM avaliacoes WHERE produto_id = ? AND aprovada = 1').get(produtoId);
  return { quantidade: r.n, media: r.n ? Math.round(r.media * 10) / 10 : null };
}

export const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

/** % de desconto em vigor (0 se não houver promoção ou se já venceu). */
export function promoAtiva(p) {
  const pct = Math.min(Math.max(Number(p.promo_pct) || 0, 0), 90);
  if (!pct) return 0;
  if (p.promo_ate && p.promo_ate < hojeSP()) return 0;
  return pct;
}
export const aplicarPromo = (cents, pct) => (pct ? Math.round(cents * (100 - pct) / 100) : cents);

/** Quantidade vendida por produto (pedidos pagos dos últimos 180 dias). */
export function ranking() {
  const r = {};
  for (const p of db.prepare("SELECT itens FROM pedidos WHERE status NOT IN ('aguardando_pagamento','cancelado') AND criado_em >= datetime('now','localtime','-180 days')").all()) {
    for (const i of lerJson(p.itens)) if (i.produto_id) r[i.produto_id] = (r[i.produto_id] || 0) + i.quantidade;
  }
  return r;
}

export function produtoPublico(p, vendidos = null) {
  if (!p) return null;
  const pct = promoAtiva(p);
  const brutas = lerJson(p.variacoes);
  const variacoes = brutas.map((v) => ({ nome: v.nome, preco_cents: aplicarPromo(v.preco_cents, pct), preco_original_cents: v.preco_cents }));
  const originais = brutas.length ? brutas.map((v) => v.preco_cents) : [p.preco_cents];
  const precos = originais.map((c) => aplicarPromo(c, pct));
  return {
    promo_pct: pct,
    promo_ate: pct ? p.promo_ate : '',
    preco_original_cents: Math.min(...originais),
    vendidos: vendidos ?? undefined,
    criado_em: p.criado_em,
    id: p.id,
    slug: p.slug,
    nome: p.nome,
    descricao: p.descricao,
    categoria: p.categoria,
    preco_cents: Math.min(...precos),
    preco_max_cents: Math.max(...precos),
    variacoes,
    variacao_rotulo: p.variacao_rotulo || 'Tamanho',
    personalizacao: p.personalizacao || '',
    personalizacao_max: p.personalizacao_max || 20,
    sob_demanda: p.estoque === null,
    disponivel: p.ativo === 1 && (p.estoque === null || p.estoque > 0),
    estoque: p.estoque,
    prazo_dias: p.prazo_dias,
    cores: p.cores ? p.cores.split(',').map((c) => c.trim()).filter(Boolean) : [],
    imagens: lerJson(p.imagens).map((f) => `/uploads/${f}`),
    destaque: p.destaque === 1,
    avaliacao: notaMedia(p.id),
  };
}

export function registrarHistorico(pedidoId, status, nota = '') {
  db.prepare('INSERT INTO historico (pedido_id, status, nota) VALUES (?, ?, ?)').run(pedidoId, status, nota);
}

// ---------- Ajustes (chave/valor) ----------
export function lerAjuste(chave, padrao = null) {
  const r = db.prepare('SELECT valor FROM ajustes WHERE chave = ?').get(chave);
  return r ? lerJson(r.valor, padrao) : padrao;
}
export function salvarAjuste(chave, valor) {
  db.prepare('INSERT INTO ajustes (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').run(chave, JSON.stringify(valor));
}

// ---------- Estoque ----------
/** Reserva o estoque assim que o pedido é criado. Seguro contra duas compras ao mesmo tempo. */
export function reservarEstoque(itens) {
  const alterados = [];
  for (const item of itens) {
    if (!item.produto_id) continue;
    const r = db.prepare('UPDATE produtos SET estoque = estoque - ? WHERE id = ? AND estoque IS NOT NULL AND estoque >= ?')
      .run(item.quantidade, item.produto_id, item.quantidade);
    if (r.changes === 0) {
      const p = db.prepare('SELECT nome, estoque FROM produtos WHERE id = ?').get(item.produto_id);
      if (p && p.estoque !== null) throw new HttpError(409, `Acabou de esgotar: ${p.nome} (restam ${p.estoque}).`);
    } else alterados.push(item.produto_id);
  }
  return alterados;
}

function devolverEstoque(itens) {
  const alterados = [];
  for (const item of itens) {
    if (!item.produto_id) continue;
    const r = db.prepare('UPDATE produtos SET estoque = estoque + ? WHERE id = ? AND estoque IS NOT NULL').run(item.quantidade, item.produto_id);
    if (r.changes) alterados.push(item.produto_id);
  }
  return alterados;
}

function baixarEstoqueForcado(itens) {
  const alterados = [];
  for (const item of itens) {
    if (!item.produto_id) continue;
    const r = db.prepare('UPDATE produtos SET estoque = MAX(estoque - ?, 0) WHERE id = ? AND estoque IS NOT NULL').run(item.quantidade, item.produto_id);
    if (r.changes) alterados.push(item.produto_id);
  }
  return alterados;
}

/**
 * Muda o status do pedido cuidando do estoque e do contador de cupons.
 * - cancelado: devolve o estoque reservado
 * - reaberto (ex.: Pix pago depois de expirar): baixa o estoque de novo
 */
export function atualizarStatusPedido(pedido, novoStatus, nota = '') {
  if (pedido.status === novoStatus) return pedido;
  const itens = lerJson(pedido.itens);
  let alterados = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare("UPDATE pedidos SET status = ?, atualizado_em = datetime('now','localtime') WHERE id = ?").run(novoStatus, pedido.id);
    if (novoStatus === 'cancelado' && pedido.estoque_baixado) {
      alterados = devolverEstoque(itens);
      db.prepare('UPDATE pedidos SET estoque_baixado = 0 WHERE id = ?').run(pedido.id);
    } else if (novoStatus !== 'cancelado' && !pedido.estoque_baixado) {
      alterados = baixarEstoqueForcado(itens);
      db.prepare('UPDATE pedidos SET estoque_baixado = 1 WHERE id = ?').run(pedido.id);
    }
    if (novoStatus === 'pago' && pedido.cupom && !pedido.cupom_contado) {
      db.prepare('UPDATE cupons SET usos = usos + 1 WHERE codigo = ?').run(pedido.cupom);
      db.prepare('UPDATE pedidos SET cupom_contado = 1 WHERE id = ?').run(pedido.id);
    }
    registrarHistorico(pedido.id, novoStatus, nota);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  const atualizado = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedido.id);
  emitir('pedido:status', { pedido: atualizado, anterior: pedido.status, nota });
  if (alterados.length) emitir('estoque:alterado', alterados);
  return atualizado;
}
