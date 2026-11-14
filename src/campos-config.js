// Lista única de todas as configurações da loja editáveis em Painel → Configurações.
// Cada campo pode vir do banco (salvo pelo painel) ou, se nunca foi salvo, da variável de ambiente de mesmo nome.
// tipo: texto | segredo | numero | dinheiro | sim_nao | email | url | cep | telefone | lista
export const SECOES = [
  {
    id: 'loja', titulo: 'Loja e contato', icone: '🏪',
    campos: [
      { chave: 'BASE_URL', rotulo: 'Endereço do site', tipo: 'url', padrao: 'http://localhost:3000', ajuda: 'Com https:// e sem barra no final. Ex.: https://www.dfr3d.com.br. Usado nos links dos e-mails, Mercado Pago e login com Google.' },
      { chave: 'LOJA_NOME', rotulo: 'Nome da loja', tipo: 'texto', padrao: 'DFR 3D Impressão' },
      { chave: 'LOJA_RESPONSAVEL', rotulo: 'Responsável', tipo: 'texto', ajuda: 'Aparece na página de políticas.' },
      { chave: 'LOJA_CIDADE', rotulo: 'Cidade exibida no site', tipo: 'texto', padrao: 'São José dos Campos - SP' },
      { chave: 'WHATSAPP', rotulo: 'WhatsApp da loja', tipo: 'telefone', padrao: '5512981020949', ajuda: 'Com 55 + DDD + número, só dígitos. Ex.: 5512981020949' },
      { chave: 'EMAIL_CONTATO', rotulo: 'E-mail de contato (público)', tipo: 'email' },
      { chave: 'INSTAGRAM', rotulo: 'Instagram', tipo: 'texto', placeholder: 'dfr.3d' },
    ],
  },
  {
    id: 'pagamento', titulo: 'Pagamento — Mercado Pago', icone: '💳',
    link: 'https://www.mercadopago.com.br/developers/panel/app',
    campos: [
      { chave: 'MP_ACCESS_TOKEN', rotulo: 'Access Token (produção)', tipo: 'segredo', ajuda: 'Suas integrações → Credenciais de produção. Começa com APP_USR-' },
      { chave: 'MP_WEBHOOK_SECRET', rotulo: 'Assinatura secreta do Webhook', tipo: 'segredo', ajuda: 'Webhooks → evento "Pagamentos". URL: {BASE_URL}/api/webhooks/mercadopago' },
      { chave: 'PIX_DESCONTO', rotulo: 'Desconto no Pix (%)', tipo: 'numero', padrao: '5', min: 0, max: 50 },
      { chave: 'PEDIDO_EXPIRA_HORAS', rotulo: 'Cancelar pedido não pago após (horas)', tipo: 'numero', padrao: '72', min: 1, max: 720 },
    ],
  },
  {
    id: 'frete', titulo: 'Frete e retirada', icone: '📦',
    link: 'https://melhorenvio.com.br/painel/gerenciar/tokens',
    campos: [
      { chave: 'CEP_ORIGEM', rotulo: 'CEP de onde as peças saem', tipo: 'cep' },
      { chave: 'MELHOR_ENVIO_TOKEN', rotulo: 'Token do Melhor Envio', tipo: 'segredo', ajuda: 'Permissões: shipping-calculate, cart-read, cart-write, shipping-checkout, shipping-generate, shipping-print, shipping-tracking, orders-read' },
      { chave: 'MELHOR_ENVIO_SANDBOX', rotulo: 'Usar ambiente de testes (sandbox)', tipo: 'sim_nao', padrao: 'false' },
      { chave: 'MELHOR_ENVIO_EMAIL', rotulo: 'E-mail da conta Melhor Envio', tipo: 'email' },
      { chave: 'MELHOR_ENVIO_SERVICOS', rotulo: 'Serviços aceitos (IDs)', tipo: 'texto', placeholder: 'vazio = todos · ex.: 1,2 (PAC e SEDEX)' },
      { chave: 'FRETE_FIXO', rotulo: 'Frete fixo (R$)', tipo: 'dinheiro', ajuda: 'Usado quando o Melhor Envio não está configurado. Vazio = desligado.' },
      { chave: 'FRETE_GRATIS_ACIMA', rotulo: 'Frete grátis acima de (R$)', tipo: 'dinheiro', ajuda: 'Vazio = desligado.' },
      { chave: 'RETIRADA_ATIVA', rotulo: 'Permitir retirada no local', tipo: 'sim_nao', padrao: 'true' },
      { chave: 'RETIRADA_ENDERECO', rotulo: 'Texto da retirada', tipo: 'texto', padrao: 'São José dos Campos - SP (endereço enviado após a confirmação)' },
    ],
  },
  {
    id: 'remetente', titulo: 'Remetente da etiqueta', icone: '🏷️',
    descricao: 'Dados impressos na etiqueta do Melhor Envio. Não aparecem no site.',
    campos: [
      { chave: 'REMETENTE_NOME', rotulo: 'Nome', tipo: 'texto', padrao: 'DFR 3D Impressão' },
      { chave: 'REMETENTE_DOCUMENTO', rotulo: 'CPF ou CNPJ', tipo: 'texto' },
      { chave: 'REMETENTE_TELEFONE', rotulo: 'Telefone', tipo: 'telefone' },
      { chave: 'REMETENTE_EMAIL', rotulo: 'E-mail', tipo: 'email' },
      { chave: 'REMETENTE_RUA', rotulo: 'Rua', tipo: 'texto' },
      { chave: 'REMETENTE_NUMERO', rotulo: 'Número', tipo: 'texto' },
      { chave: 'REMETENTE_COMPLEMENTO', rotulo: 'Complemento', tipo: 'texto' },
      { chave: 'REMETENTE_BAIRRO', rotulo: 'Bairro', tipo: 'texto' },
      { chave: 'REMETENTE_CIDADE', rotulo: 'Cidade', tipo: 'texto', padrao: 'São José dos Campos' },
      { chave: 'REMETENTE_UF', rotulo: 'UF', tipo: 'texto', padrao: 'SP' },
    ],
  },
  {
    id: 'email', titulo: 'E-mails automáticos', icone: '✉️',
    link: 'https://app.brevo.com/settings/keys/api',
    descricao: 'Use o Brevo OU o Resend. Sem um deles, nenhum e-mail é enviado.',
    campos: [
      { chave: 'EMAIL_ADMIN', rotulo: 'E-mail que recebe os avisos da loja', tipo: 'email', padrao: 'contato@dfr3d.com.br', ajuda: 'Recebe um e-mail a cada pedido, pagamento, pergunta, encomenda etc.' },
      { chave: 'EMAIL_REMETENTE', rotulo: 'Remetente', tipo: 'texto', placeholder: 'DFR 3D <contato@dfr3d.com.br>', ajuda: 'Precisa estar verificado no Brevo/Resend.' },
      { chave: 'BREVO_API_KEY', rotulo: 'Chave de API do Brevo', tipo: 'segredo' },
      { chave: 'RESEND_API_KEY', rotulo: 'Chave de API do Resend', tipo: 'segredo' },
    ],
  },
  {
    id: 'celular', titulo: 'Aviso no celular', icone: '📱',
    descricao: 'Recebe na hora: pedido pago, encomenda nova e perguntas.',
    campos: [
      { chave: 'TELEGRAM_BOT_TOKEN', rotulo: 'Telegram: token do bot', tipo: 'segredo', ajuda: 'Crie o bot no @BotFather.' },
      { chave: 'TELEGRAM_CHAT_ID', rotulo: 'Telegram: seu chat ID', tipo: 'texto', ajuda: 'Descubra no @userinfobot.' },
      { chave: 'CALLMEBOT_TELEFONE', rotulo: 'WhatsApp (CallMeBot): telefone', tipo: 'telefone' },
      { chave: 'CALLMEBOT_APIKEY', rotulo: 'WhatsApp (CallMeBot): apikey', tipo: 'segredo' },
    ],
  },
  {
    id: 'google', titulo: 'Login de clientes com Google', icone: '👤',
    link: 'https://console.cloud.google.com/apis/credentials',
    descricao: 'URI de redirecionamento autorizado: {BASE_URL}/api/conta/google/callback',
    campos: [
      { chave: 'GOOGLE_CLIENT_ID', rotulo: 'ID do cliente', tipo: 'texto' },
      { chave: 'GOOGLE_CLIENT_SECRET', rotulo: 'Chave secreta do cliente', tipo: 'segredo' },
    ],
  },
  {
    id: 'captcha', titulo: 'Captcha do painel', icone: '🛡️',
    link: 'https://dash.cloudflare.com/?to=/:account/turnstile',
    descricao: 'Vazio = captcha próprio (imagem com letras). Preencha para usar o Cloudflare Turnstile.',
    campos: [
      { chave: 'TURNSTILE_SITE_KEY', rotulo: 'Turnstile: Site Key', tipo: 'texto' },
      { chave: 'TURNSTILE_SECRET', rotulo: 'Turnstile: Secret Key', tipo: 'segredo' },
    ],
  },
  {
    id: 'analytics', titulo: 'Medição de visitas', icone: '📊',
    campos: [
      { chave: 'GA_ID', rotulo: 'Google Analytics (ID)', tipo: 'texto', placeholder: 'G-XXXXXXXXXX' },
      { chave: 'META_PIXEL_ID', rotulo: 'Meta Pixel (ID)', tipo: 'texto' },
    ],
  },
  {
    id: 'ml', titulo: 'Mercado Livre', icone: '🟡',
    link: 'https://developers.mercadolivre.com.br/devcenter',
    descricao: 'Redirect: {BASE_URL}/api/admin/ml/callback · Notificações: {BASE_URL}/api/webhooks/mercadolivre (tópico orders_v2). Depois de salvar, conecte a conta em Integrações.',
    campos: [
      { chave: 'ML_CLIENT_ID', rotulo: 'App ID', tipo: 'texto' },
      { chave: 'ML_CLIENT_SECRET', rotulo: 'Chave secreta', tipo: 'segredo' },
    ],
  },
  {
    id: 'backup', titulo: 'Backup', icone: '💾',
    campos: [
      { chave: 'BACKUP_MANTER_DIAS', rotulo: 'Guardar backups por (dias)', tipo: 'numero', padrao: '14', min: 1, max: 365 },
      { chave: 'BACKUP_POR_EMAIL', rotulo: 'Enviar backup diário por e-mail', tipo: 'sim_nao', padrao: 'false' },
    ],
  },
];

export const CAMPOS = Object.fromEntries(SECOES.flatMap((s) => s.campos.map((c) => [c.chave, { ...c, secao: s.id }])));
