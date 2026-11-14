# Loja DFR 3D Impressão — v4

Loja virtual em Node.js com vitrine, carrinho, Mercado Pago (Pix com desconto, cartão em até 12x e boleto), frete e etiquetas pelo Melhor Envio, retirada no local, encomendas com envio de STL/3MF, cupons, avaliações, e-mails automáticos, aviso no celular, backup diário e estoque sincronizado com o Mercado Livre.

**Não tem dependências externas.** Usa só o Node.js 22.5 ou mais novo. Não precisa rodar `npm install`.

---

## O que mudou na v2

| # | Recurso | Onde configurar |
|---|---------|-----------------|
| 1 | Página **/politicas**: trocas, privacidade (LGPD) e termos. Rodapé com o nome da loja e a cidade (São José dos Campos - SP). Aceite obrigatório no checkout. | `LOJA_NOME`, `LOJA_CIDADE` |
| 2 | **E-mails automáticos**: pedido recebido, pago, em produção, pronto, enviado (com rastreio), entregue (pede avaliação), cancelado. Você recebe novo pedido, pedido pago e encomenda. | `RESEND_API_KEY` ou `BREVO_API_KEY` |
| 3 | **Reserva de estoque** na criação do pedido (duas pessoas não compram a última peça). Pedido não pago é **cancelado sozinho** e devolve o estoque. Se o Pix cair depois do prazo, o pedido é reaberto. | `PEDIDO_EXPIRA_HORAS` |
| 4 | **SEO**: título, descrição e foto ao compartilhar no WhatsApp/Instagram; dados estruturados (preço, estoque e estrelas no Google); `sitemap.xml` e `robots.txt`. | automático |
| 5 | **Desconto no Pix**: o cliente escolhe Pix (com desconto) ou cartão/boleto. O link do Pix só aceita Pix. | `PIX_DESCONTO` |
| 6 | **Cupons**: %, valor fixo ou frete grátis; mínimo, validade e limite de usos. | painel → Cupons |
| 7 | **Variações com preço** (ex.: P/M/G) e **campo de personalização** (ex.: nome no chaveiro). | ficha do produto |
| 8 | **Avaliações** com estrelas e foto, só de quem comprou. Você aprova antes de publicar. | painel → Avaliações |
| 9 | **Google Analytics / Meta Pixel** com aviso de cookies (só carrega se o visitante aceitar). Mede visualização, carrinho, checkout e compra. | `GA_ID`, `META_PIXEL_ID` |
| 10 | **Etiqueta do Melhor Envio** no pedido: compra com o saldo da carteira, imprime e busca o rastreio. | `REMETENTE_*` |
| 11 | **Aviso no celular** quando um pedido é pago ou chega uma encomenda: Telegram e/ou WhatsApp (CallMeBot). | `TELEGRAM_*`, `CALLMEBOT_*` |
| 12 | **Backup diário** do banco (guarda 14 dias). Dá para baixar no painel e, se quiser, receber por e-mail. | `BACKUP_*` |
| 13 | **Estoque sincronizado com o Mercado Livre**: venda no site atualiza o anúncio; venda no ML baixa o estoque no site. | `ML_*` + painel → Integrações |

### Novo: todas as configurações no painel (⚙️ Configurações)
Chaves, tokens e dados da loja agora são editados em **/admin → ⚙️ Configurações**. Não precisa mais mexer nas variáveis da Hostinger.
- As seções são: Loja e contato, Mercado Pago, Frete e retirada, Remetente da etiqueta, E-mails, Aviso no celular, Login com Google, Captcha, Medição de visitas, Mercado Livre e Backup.
- **Vale na hora**, sem reiniciar a loja.
- Tem **botões de teste** para conferir na hora se a chave está certa: Mercado Pago, Melhor Envio, e-mail e celular.
- Os **segredos ficam protegidos**: aparecem só como `••••••1234`. Para trocar, digite o novo valor; para remover, clique em **Apagar**.
- O selo azul **"da Hostinger"** mostra os valores que ainda vêm das variáveis antigas. Ao salvar no painel, passa a valer o do painel.
- **Senha do painel:** troque em Configurações → Senha. Ela fica guardada de forma criptografada e desconecta os outros aparelhos. Depois disso, a `ADMIN_PASSWORD` da Hostinger deixa de valer.
- Cada alteração de configuração e cada troca de senha gera um e-mail de aviso para a loja.
- Na Hostinger ficam só `NODE_ENV`, `ADMIN_PASSWORD` (para o primeiro acesso) e `DATA_DIR`.

### Novo: e-mail para a loja a cada acontecimento
Tudo o que acontece no site gera um e-mail para **contato@dfr3d.com.br** (variável `EMAIL_ADMIN`), com os detalhes e um botão para abrir no painel:

| Acontecimento | E-mail |
|---|---|
| Pedido feito na loja | 🛒 Novo pedido (cliente, endereço, itens, cupom, observações) |
| Pagamento aprovado | 💰 Pedido PAGO, com tudo para produzir |
| Pagamento recusado (ex.: cartão sem limite) | ⚠️ Pagamento recusado, para você chamar o cliente |
| Pedido cancelado (expirou ou estorno) | ❌ Pedido cancelado |
| Postagem e entrega confirmadas pela transportadora | 📦 Postado / ✅ Entregue |
| Mudança de status feita por você no painel | 🔄 ... (alterado por você) |
| Pedido de orçamento (encomenda) | 🛠️ Nova encomenda |
| Pergunta num produto | ❓ Pergunta, com link para responder |
| Avaliação de cliente | ⭐ Nova avaliação, com link para aprovar |
| Cliente criou conta com Google | 👤 Novo cliente |
| Estoque com 2 ou menos / esgotado (por venda no site ou no ML) | 📉 Estoque baixo / 🚨 Esgotou |
| Venda no Mercado Livre que baixou o estoque | 🟡 Venda no Mercado Livre |
| Login no painel / 10 senhas erradas seguidas | 🔐 Acesso ao painel / 🚨 Tentativas de senha |

> Os e-mails só saem com um serviço de envio configurado (`RESEND_API_KEY` ou `BREVO_API_KEY` + `EMAIL_REMETENTE`). Use o botão **Enviar aviso de teste** em painel → Integrações para conferir.

### Novo: captcha no login do painel
- O login do painel (/admin) pede senha **e** um código de verificação, o que bloqueia robôs que tentam adivinhar a senha.
- Sem configurar nada, a loja usa um captcha próprio: uma imagem com 5 letras distorcidas (o botão ↻ gera outra). Cada código vale uma vez e expira em 5 minutos.
- Opcional: o **Cloudflare Turnstile** (grátis), que quase sempre só pede um clique.
  1. Crie uma conta em https://dash.cloudflare.com e vá em **Turnstile → Adicionar widget**.
  2. Informe o domínio da loja.
  3. Copie a *Site Key* e a *Secret Key* para `TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET`.

### Novo: perguntas e respostas nos produtos
- Cada produto tem a seção **Perguntas e respostas**. O cliente pergunta informando nome e e-mail (se estiver logado com Google, já vai preenchido).
- Você recebe aviso no **celular** (Telegram/WhatsApp) e por **e-mail** na hora.
- Responda em **painel → Perguntas**, que mostra um contador das que estão sem resposta. A resposta fica pública na página do produto e o cliente recebe um e-mail avisando.
- Só aparecem no site perguntas já respondidas. O e-mail do cliente nunca é exibido, e o nome aparece abreviado (ex.: "Carla M.").
- Proteção contra spam: campo invisível contra robôs, bloqueio de links e limite de 5 perguntas por hora por pessoa. Você pode ocultar ou excluir qualquer pergunta.
- Com muitas perguntas, aparece um campo para buscar entre as já respondidas.

### Novo na v4: vitrine completa, blog e busca
- **Topo novo:**
  - **Campo de busca** com sugestões enquanto o cliente digita. Mostra foto, preço e posts do blog, e não diferencia acentos nem maiúsculas ("arvore" acha "Árvore").
  - **Ícone do WhatsApp**, que abre a conversa com o (12) 98102-0949.
  - Entrar e Carrinho.
- **Menu de categorias** logo abaixo do topo, com um subtítulo curto em cada uma. Edite em **painel → Página inicial**. O nome precisa ser igual à categoria do produto.
- **Página inicial:** banner com produto em destaque, selos de vantagens, **Destaques**, **Promoções**, **Mais vendidos** (calculados pelos pedidos pagos dos últimos 6 meses), seção do blog e **Perguntas frequentes** (que também aparecem no Google). Tudo editável no painel.
- **Promoções:** na ficha do produto, informe a % de desconto e até quando vale. O preço aparece riscado, com o selo "-20%". O desconto vale no carrinho e no pagamento, e some sozinho quando o prazo vence.
- **/produtos:** filtros por categoria e "só promoções", e ordenação por relevância, mais vendidos, menor ou maior preço, novidades e maior desconto.
- **Blog (/blog):** posts com capa, categorias, tempo de leitura, produtos relacionados no fim do post e botão de compartilhar no WhatsApp. O editor do painel tem barra de formatação, inserção de foto no texto e prévia. Os posts aparecem no Google com dados de artigo e entram no sitemap.

### Novo na v3: conta do cliente com Google
- Botão **Entrar com Google** no topo, no checkout e em **/conta**. O cliente não cria senha.
- **Minha conta** tem três abas:
  - **Pedidos:** todos os pedidos do cliente, com barra de andamento (pago → produção → enviado → entregue).
  - **Orçamentos:** as encomendas sob medida e o valor orçado.
  - **Meus dados:** telefone, CPF e endereço, que preenchem o checkout sozinhos.
- **Rastreio** em cada pedido: código, situação da entrega e botões **Atualizar**, **Copiar** e **Rastrear**. Para etiquetas do Melhor Envio, a loja consulta o rastreio a cada 3 horas, muda o pedido para **Enviado** quando é postado e para **Entregue** quando chega. Nesse momento o cliente recebe o e-mail pedindo a avaliação.
- Pedidos antigos feitos com o mesmo e-mail aparecem automaticamente na conta.
- Quem não quiser criar conta continua comprando normalmente e pode acompanhar o pedido pelo número.
- O cliente pode excluir a própria conta (exigência da LGPD).
- O painel ganhou a aba **Clientes**, com total comprado por cliente.

A aba **Integrações** do painel mostra o que está ligado e tem um botão para **enviar um aviso de teste**.

---

## Atualizar a partir da v1

Basta substituir os arquivos e reiniciar. O banco é atualizado sozinho, e os pedidos e produtos antigos são mantidos. Depois, adicione as novas variáveis do `.env.example`.

## Testar no seu computador

1. Instale o [Node.js 22 ou 24 (LTS)](https://nodejs.org).
2. Copie `.env.example` para `.env` e preencha pelo menos `ADMIN_PASSWORD` e `SESSION_SECRET`. Para testar localmente, troque `NODE_ENV=production` por vazio e use `BASE_URL=http://localhost:3000`.
3. Rode `npm run seed` (opcional: cria produtos de exemplo) e depois `npm start`.
4. Abra a loja em http://localhost:3000 e o painel em http://localhost:3000/admin.

## Publicar na Hostinger (plano Business/Unlimited ou Cloud)

1. Suba esta pasta para um repositório **privado** no GitHub. O `.gitignore` já impede que o `.env` e a pasta `data` sejam enviados.
2. No hPanel, abra **Websites → Adicionar site → Node.js Web App**, conecte o GitHub e escolha o repositório.
3. Configure a versão do Node como **22.x ou 24.x** e o comando de início como `npm start`. Deixe o comando de build vazio.
4. Em **Variáveis de ambiente**, cadastre as do `.env.example`. Defina `DATA_DIR` como uma pasta **fora** da pasta do app (ex.: `/home/uXXXX/dfr3d-dados`).
5. Aponte o domínio e ative o SSL.
6. No [Google Search Console](https://search.google.com/search-console), cadastre o site e envie `https://seudominio.com.br/sitemap.xml`.

---

## Passo a passo das integrações

### Mercado Pago
1. Acesse https://www.mercadopago.com.br/developers/panel/app, crie uma aplicação **Checkout Pro** e copie o **Access Token de produção** para `MP_ACCESS_TOKEN`.
2. Em **Webhooks**, cadastre a URL `https://seudominio.com.br/api/webhooks/mercadopago` com o evento **Pagamentos**. Copie a assinatura secreta para `MP_WEBHOOK_SECRET`.

### Melhor Envio (frete e etiquetas)
1. Vá em **Integrações → Permissões de acesso → Gerar token**. Marque: `shipping-calculate`, `cart-read`, `cart-write`, `shipping-checkout`, `shipping-generate`, `shipping-print`, `shipping-tracking`, `orders-read`.
2. Preencha `MELHOR_ENVIO_TOKEN`, `CEP_ORIGEM` e os campos `REMETENTE_*`.
3. Coloque saldo na carteira do Melhor Envio. As etiquetas são pagas com esse saldo.
4. Para testar sem gastar, crie uma conta em https://sandbox.melhorenvio.com.br e use `MELHOR_ENVIO_SANDBOX=true`.

Fluxo no painel: pedido pago → **Comprar e gerar etiqueta** → **Imprimir etiqueta** → depois da postagem, **Buscar rastreio** → mude o status para **Enviado**. O cliente recebe um e-mail com o código.

### E-mails (Resend — recomendado)
1. Crie uma conta em https://resend.com. O plano grátis envia 3.000 e-mails por mês.
2. Em **Domains**, adicione seu domínio e cadastre os registros DNS no hPanel.
3. Em **API Keys**, crie uma chave e preencha `RESEND_API_KEY` e `EMAIL_REMETENTE=DFR 3D <pedidos@seudominio.com.br>`.

Alternativa: Brevo (https://brevo.com), que envia 300 e-mails por dia no plano grátis. Use `BREVO_API_KEY` e um remetente verificado.

### Aviso no celular
- **Telegram (recomendado):**
  1. Fale com o **@BotFather** e use `/newbot` para criar o bot. Copie o token para `TELEGRAM_BOT_TOKEN`.
  2. Mande qualquer mensagem para o seu bot.
  3. Fale com o **@userinfobot** para descobrir seu número de ID e copie para `TELEGRAM_CHAT_ID`.
- **WhatsApp (CallMeBot):** siga https://www.callmebot.com/blog/free-api-whatsapp-messages/ para receber a apikey e preencha `CALLMEBOT_TELEFONE` (com 55 e DDD) e `CALLMEBOT_APIKEY`. É um serviço gratuito de terceiros e pode ficar instável. A API oficial do WhatsApp é paga.

### Login com Google
1. Acesse https://console.cloud.google.com e crie um projeto (ex.: "DFR 3D Loja").
2. Vá em **APIs e serviços → Tela de consentimento OAuth** (ou "Google Auth Platform → Branding"):
   - Tipo **Externo**, nome do app **DFR 3D Impressão**, e-mail de suporte, logo (pode usar `public/img/icone-512.png`) e domínio do site.
   - Links da página inicial e da política de privacidade: `https://seudominio.com.br/politicas#privacidade`.
   - Escopos: apenas `openid`, `email` e `profile`. São básicos e não exigem a análise demorada do Google.
   - Clique em **Publicar app** (status "Em produção"). Enquanto estiver em teste, só os e-mails cadastrados como testadores conseguem entrar.
3. Vá em **Credenciais → Criar credenciais → ID do cliente OAuth → Aplicativo da Web**:
   - **Origens JavaScript autorizadas:** `https://seudominio.com.br`
   - **URIs de redirecionamento autorizados:** `https://seudominio.com.br/api/conta/google/callback`
4. Copie o **ID do cliente** e a **Chave secreta** para `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` e reinicie a loja.

> O botão usa um visual neutro ("G" + "Entrar com Google"). Se quiser o botão oficial do Google, baixe os arquivos em https://developers.google.com/identity/branding-guidelines e troque o ícone em `public/conta.html` e `public/checkout.html`.

### Mercado Livre
1. Crie um aplicativo em https://developers.mercadolivre.com.br/devcenter.
2. Em **URI de redirect**, use `https://seudominio.com.br/api/admin/ml/callback`.
3. Em **Notificações**, use `https://seudominio.com.br/api/webhooks/mercadolivre` e marque o tópico **orders_v2**.
4. Preencha `ML_CLIENT_ID` e `ML_CLIENT_SECRET` e reinicie a loja.
5. No painel, vá em **Integrações → Conectar conta do Mercado Livre**.
6. Na ficha de cada produto com **estoque controlado** (não "sob demanda"), coloque o código do anúncio (MLB…) e clique em **Verificar**.

> A sincronização vale para anúncios simples. Em anúncios com variações no ML, a mesma quantidade é aplicada a todas as variações.

### Google Analytics e Meta Pixel
Preencha `GA_ID` (ex.: G-XXXXXXX) e/ou `META_PIXEL_ID`. Eles só são ativados para quem aceitar os cookies, como pede a LGPD. As compras são registradas como conversão quando o pagamento é confirmado.

---

## Importante

- **Revise a página /politicas** com calma. O texto segue o Código de Defesa do Consumidor e a LGPD, mas não substitui a orientação de um contador ou advogado, principalmente sobre devolução de peças personalizadas.
- **Backup:** além do backup automático, baixe de vez em quando um arquivo em **Integrações → Backup** e guarde no seu computador. As fotos dos produtos ficam em `DATA_DIR/uploads`.
- As integrações com Melhor Envio (etiquetas), Mercado Livre e serviços de e-mail foram testadas com respostas simuladas. Na primeira vez, teste com um pedido seu: no **sandbox** do Melhor Envio e com as **credenciais de teste** do Mercado Pago.

## Estrutura

```
server.js                servidor, páginas e SEO
src/config.js            configuração (ambiente + valores salvos no painel)
src/campos-config.js     lista de todos os campos da página Configurações
src/routes/configuracoes.js  API da página Configurações e troca de senha
src/db.js                banco SQLite, migrações, estoque e status
src/precos.js            carrinho, variações, cupons e desconto Pix
src/mercadopago.js       Checkout Pro e webhook
src/frete.js             cálculo de frete (Melhor Envio, fixo, retirada)
src/etiqueta.js          compra/impressão de etiqueta e rastreio
src/notificacoes.js      e-mails, Telegram e WhatsApp
src/mercadolivre.js      conexão e sincronização de estoque com o ML
src/tarefas.js           expiração de pedidos, rastreio automático e backup diário
src/clientes.js          login com Google, Minha conta, pedidos e rastreio do cliente
src/seo.js               meta tags, dados estruturados, sitemap e políticas
src/catalogo.js          busca sem acento, filtros e ordenação
src/blog.js              posts e conversão segura de Markdown
src/routes/conteudo.js   blog, menu, página inicial e FAQ
src/routes/perguntas.js  perguntas e respostas dos produtos
src/avisos-dono.js       e-mail para a loja a cada acontecimento do site
src/captcha.js           captcha do login (imagem própria ou Cloudflare Turnstile)
src/routes/publico.js    API da loja
src/routes/admin.js      API do painel
public/                  páginas, CSS, JS e logo
```
