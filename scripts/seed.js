// Cadastra alguns produtos de exemplo (só se a loja estiver vazia). Rode: npm run seed
import { db } from '../src/db.js';

const total = db.prepare('SELECT COUNT(*) n FROM produtos').get().n;
if (total > 0) {
  console.log(`A loja já tem ${total} produto(s). Nada foi alterado.`);
  process.exit(0);
}

const exemplos = [
  ['caixinha-de-natal-pix', 'Caixinha de Natal para presente em Pix', 'Natal', 2490, null, 2, 'Vermelho, Verde, Branco', 1,
    'Caixinha decorada de Natal com espaço para o QR Code do Pix. Um jeito divertido de dar dinheiro de presente!\n\nTamanho aproximado: 8 x 8 x 8 cm.'],
  ['suporte-headset', 'Suporte de headset para mesa', 'Geek e Games', 5990, null, 3, 'Preto, Vermelho, Branco', 1,
    'Suporte firme para headset, com base larga e acabamento liso. Impresso em PETG resistente.\n\nAltura: 25 cm.'],
  ['chaveiro-personalizado', 'Chaveiro personalizado com nome', 'Chaveiros', 1290, null, 2, 'Preto, Branco, Vermelho, Azul', 0,
    'Chaveiro com o nome que você quiser (até 10 letras). Informe o nome nas observações do pedido.'],
  ['vaso-geometrico', 'Vaso geométrico decorativo', 'Decoração', 3990, 4, 1, 'Branco, Preto', 0,
    'Vaso facetado para suculentas e plantas pequenas, com furo de drenagem.\n\nAltura: 12 cm.'],
];

const ins = db.prepare(`INSERT INTO produtos (slug, nome, categoria, preco_cents, estoque, prazo_dias, cores, destaque, descricao, peso_g, largura_cm, altura_cm, comprimento_cm)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
for (const e of exemplos) ins.run(...e, 200, 15, 12, 15);
console.log(`${exemplos.length} produtos de exemplo cadastrados. Edite ou exclua no painel /admin.`);
