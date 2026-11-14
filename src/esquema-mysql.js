// Tabelas da loja no MySQL/MariaDB (mesmas colunas do SQLite).
// Colunas TEXT não têm DEFAULT (compatível com versões antigas): quando ficam NULL, a leitura devolve ''.
const OPCOES = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
const V = (n = 255) => `VARCHAR(${n}) NOT NULL DEFAULT ''`;
const AGORA = 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP';

export const TABELAS_MYSQL = [
  `CREATE TABLE IF NOT EXISTS produtos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    slug VARCHAR(190) NOT NULL UNIQUE,
    nome VARCHAR(255) NOT NULL,
    descricao TEXT,
    categoria ${V(100)},
    preco_cents INT NOT NULL,
    estoque INT NULL,
    prazo_dias INT DEFAULT 3,
    cores ${V(500)},
    peso_g INT DEFAULT 200,
    largura_cm INT DEFAULT 10,
    altura_cm INT DEFAULT 10,
    comprimento_cm INT DEFAULT 10,
    imagens TEXT,
    ativo TINYINT DEFAULT 1,
    destaque TINYINT DEFAULT 0,
    criado_em ${AGORA},
    variacoes TEXT,
    variacao_rotulo VARCHAR(60) NOT NULL DEFAULT 'Tamanho',
    personalizacao ${V(100)},
    personalizacao_max INT DEFAULT 20,
    ml_item_id ${V(40)},
    promo_pct INT DEFAULT 0,
    promo_ate ${V(20)},
    INDEX idx_produtos_ativo (ativo)
  ) ${OPCOES}`,

  `CREATE TABLE IF NOT EXISTS clientes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    google_sub VARCHAR(100) NULL UNIQUE,
    email VARCHAR(190) NOT NULL UNIQUE,
    nome VARCHAR(255) NOT NULL,
    foto ${V(500)},
    telefone ${V(20)}, cpf ${V(14)}, cep ${V(10)},
    endereco ${V()}, numero ${V(30)}, complemento ${V(120)}, bairro ${V(120)}, cidade ${V(120)}, uf ${V(2)},
    criado_em ${AGORA},
    ultimo_login ${AGORA}
  ) ${OPCOES}`,

  `CREATE TABLE IF NOT EXISTS pedidos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    codigo VARCHAR(40) NOT NULL UNIQUE,
    status VARCHAR(40) NOT NULL DEFAULT 'aguardando_pagamento',
    origem VARCHAR(20) NOT NULL DEFAULT 'loja',
    cliente_nome VARCHAR(255) NOT NULL,
    cliente_email VARCHAR(190) NOT NULL,
    cliente_telefone ${V(20)}, cliente_cpf ${V(14)}, cep ${V(10)},
    endereco ${V()}, numero ${V(30)}, complemento ${V(120)}, bairro ${V(120)}, cidade ${V(120)}, uf ${V(2)},
    entrega_tipo VARCHAR(20) NOT NULL,
    entrega_servico ${V(120)}, entrega_servico_id ${V(40)},
    entrega_prazo INT NULL,
    frete_cents INT DEFAULT 0,
    subtotal_cents INT NOT NULL,
    total_cents INT NOT NULL,
    itens TEXT NOT NULL,
    observacoes TEXT,
    pagamento_status ${V(40)}, pagamento_metodo ${V(40)},
    mp_preference_id ${V(120)}, mp_payment_id ${V(60)},
    link_pagamento TEXT,
    rastreio ${V(60)},
    notas_internas TEXT,
    estoque_baixado TINYINT DEFAULT 0,
    criado_em ${AGORA},
    atualizado_em ${AGORA},
    desconto_cents INT DEFAULT 0,
    cupom ${V(60)},
    forma_pagamento ${V(20)},
    me_order_id ${V(60)},
    etiqueta_url TEXT,
    cupom_contado TINYINT DEFAULT 0,
    cliente_id INT NULL,
    rastreio_status ${V(40)},
    rastreio_verificado ${V(20)},
    INDEX idx_pedidos_status (status),
    INDEX idx_pedidos_email (cliente_email),
    INDEX idx_pedidos_cliente (cliente_id)
  ) ${OPCOES}`,

  `CREATE TABLE IF NOT EXISTS historico (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pedido_id INT NOT NULL,
    status VARCHAR(40) NOT NULL,
    nota ${V(500)},
    criado_em ${AGORA},
    INDEX idx_historico_pedido (pedido_id),
    CONSTRAINT fk_historico_pedido FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE
  ) ${OPCOES}`,

  `CREATE TABLE IF NOT EXISTS encomendas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    codigo VARCHAR(40) NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'nova',
    nome VARCHAR(255) NOT NULL,
    email VARCHAR(190) NOT NULL,
    telefone ${V(20)},
    descricao TEXT NOT NULL,
    link_referencia ${V(600)},
    quantidade INT DEFAULT 1,
    cor ${V(100)},
    prazo_desejado ${V(100)},
    arquivos TEXT,
    valor_cents INT NULL,
    resposta TEXT,
    pedido_codigo ${V(40)},
    criado_em ${AGORA},
    cliente_id INT NULL
  ) ${OPCOES}`,

  `CREATE TABLE IF NOT EXISTS cupons (
    id INT AUTO_INCREMENT PRIMARY KEY,
    codigo VARCHAR(60) NOT NULL UNIQUE,
    tipo VARCHAR(10) NOT NULL DEFAULT 'pct',
    valor INT NOT NULL DEFAULT 0,
    minimo_cents INT DEFAULT 0,
    validade ${V(20)},
    usos_max INT NULL,
    usos INT DEFAULT 0,
    ativo TINYINT DEFAULT 1,
    criado_em ${AGORA}
  ) ${OPCOES}`,

  `CREATE TABLE IF NOT EXISTS avaliacoes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    produto_id INT NOT NULL,
    pedido_id INT NULL,
    nome VARCHAR(255) NOT NULL,
    nota INT NOT NULL,
    comentario TEXT,
    foto ${V()},
    aprovada TINYINT DEFAULT 0,
    criado_em ${AGORA},
    UNIQUE KEY uq_avaliacao (produto_id, pedido_id),
    INDEX idx_avaliacoes_produto (produto_id, aprovada),
    CONSTRAINT fk_avaliacao_produto FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE,
    CONSTRAINT fk_avaliacao_pedido FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE SET NULL
  ) ${OPCOES}`,

  `CREATE TABLE IF NOT EXISTS posts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    slug VARCHAR(190) NOT NULL UNIQUE,
    titulo VARCHAR(255) NOT NULL,
    resumo ${V(400)},
    conteudo MEDIUMTEXT,
    capa ${V()},
    categoria ${V(100)},
    produtos TEXT,
    publicado TINYINT DEFAULT 0,
    publicado_em ${V(20)},
    criado_em ${AGORA},
    atualizado_em ${AGORA}
  ) ${OPCOES}`,

  `CREATE TABLE IF NOT EXISTS perguntas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    produto_id INT NOT NULL,
    cliente_id INT NULL,
    nome VARCHAR(255) NOT NULL,
    email VARCHAR(190) NOT NULL,
    pergunta TEXT NOT NULL,
    resposta TEXT,
    publicada TINYINT DEFAULT 1,
    respondida_em ${V(20)},
    ip ${V(60)},
    criado_em ${AGORA},
    INDEX idx_perguntas_produto (produto_id, publicada),
    CONSTRAINT fk_pergunta_produto FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE
  ) ${OPCOES}`,

  `CREATE TABLE IF NOT EXISTS ajustes (
    chave VARCHAR(100) NOT NULL PRIMARY KEY,
    valor MEDIUMTEXT
  ) ${OPCOES}`,
];

/** Ordem para copiar dados (pais antes dos filhos). */
export const ORDEM_TABELAS = ['produtos', 'clientes', 'pedidos', 'historico', 'encomendas', 'cupons', 'avaliacoes', 'posts', 'perguntas', 'ajustes'];
