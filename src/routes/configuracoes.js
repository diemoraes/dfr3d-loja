// Painel → Configurações: lê e grava as configurações da loja no banco (sem mexer no .env)
import { config, aplicarAjustes, valorCampo, origemCampo } from '../config.js';
import { SECOES, CAMPOS } from '../campos-config.js';
import { lerAjuste, salvarAjuste } from '../db.js';
import { sendJson, readJson, HttpError, limpar, emailValido } from '../http.js';
import { exigirAdmin, trocarSenha, renovarSessao } from '../auth.js';
import { emitir } from '../eventos.js';
import { enviarEmail, emailAtivo, avisarCelular, celularAtivo } from '../notificacoes.js';
import { apiMelhorEnvio } from '../frete.js';

const mascarar = (v) => (!v ? '' : v.length >= 12 ? `••••••${v.slice(-4)}` : '••••••');

function normalizar(campo, bruto) {
  let v = limpar(bruto, 1000);
  const erro = (msg) => { throw new HttpError(400, `${campo.rotulo}: ${msg}`); };
  if (v === '') return '';
  switch (campo.tipo) {
    case 'url':
      v = v.replace(/\/+$/, '');
      if (!/^https?:\/\/[^\s/]+\.[^\s/]+(:\d+)?$|^http:\/\/localhost(:\d+)?$/i.test(v)) erro('use o endereço completo, ex.: https://www.dfr3d.com.br');
      return v;
    case 'email':
      if (!emailValido(v)) erro('e-mail inválido.');
      return v.toLowerCase();
    case 'telefone': {
      const d = v.replace(/\D/g, '');
      if (d.length < 10 || d.length > 13) erro('use DDD + número (ex.: 12 98102-0949).');
      return d.length <= 11 ? `55${d}` : d; // acrescenta o código do Brasil
    }
    case 'cep': {
      const d = v.replace(/\D/g, '');
      if (d.length !== 8) erro('o CEP precisa ter 8 números.');
      return d;
    }
    case 'numero': {
      const n = Number(v.replace(',', '.'));
      if (!Number.isFinite(n)) erro('número inválido.');
      if (campo.min !== undefined && n < campo.min) erro(`mínimo ${campo.min}.`);
      if (campo.max !== undefined && n > campo.max) erro(`máximo ${campo.max}.`);
      return String(n);
    }
    case 'dinheiro': {
      const n = parseFloat(v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v);
      if (!Number.isFinite(n) || n < 0) erro('valor inválido (ex.: 25,00).');
      return n.toFixed(2).replace('.', ',');
    }
    case 'sim_nao':
      return v === 'true' || v === true ? 'true' : 'false';
    default:
      return v;
  }
}

function estado() {
  const salvos = lerAjuste('config', {});
  return {
    secoes: SECOES.map((s) => ({
      ...s,
      campos: s.campos.map((c) => {
        const valor = valorCampo(c.chave);
        return { ...c, origem: origemCampo(c.chave), definido: Boolean(valor), valor: c.tipo === 'segredo' ? mascarar(valor) : valor };
      }),
    })),
    base_url: config.baseUrl,
    senha_trocada_em: lerAjuste('admin_senha', null)?.em || null,
    total_salvos: Object.keys(salvos).length,
  };
}

async function testar(servico) {
  const ok = (msg) => ({ ok: true, msg }), falha = (msg) => ({ ok: false, msg });
  const req = async (url, headers) => {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    return { ok: r.ok, status: r.status, dados: await r.json().catch(() => ({})) };
  };
  switch (servico) {
    case 'pagamento': {
      if (!config.mp.accessToken) return falha('Preencha o Access Token.');
      const r = await req('https://api.mercadopago.com/users/me', { Authorization: `Bearer ${config.mp.accessToken}` });
      return r.ok ? ok(`Conectado à conta ${r.dados.nickname || r.dados.email || r.dados.id}${String(config.mp.accessToken).startsWith('TEST-') ? ' (credencial de TESTE)' : ''}.`) : falha(`O Mercado Pago recusou o token (erro ${r.status}).`);
    }
    case 'frete': {
      if (!config.melhorEnvio.token) return falha('Preencha o token do Melhor Envio.');
      const r = await req(`${apiMelhorEnvio()}/api/v2/me`, { Authorization: `Bearer ${config.melhorEnvio.token}`, Accept: 'application/json', 'User-Agent': `DFR 3D Loja (${config.melhorEnvio.email})` });
      if (!r.ok) return falha(`O Melhor Envio recusou o token (erro ${r.status}).${config.melhorEnvio.sandbox ? ' Atenção: modo sandbox ligado — o token precisa ser do sandbox.' : ''}`);
      return ok(`Conectado como ${[r.dados.firstname, r.dados.lastname].filter(Boolean).join(' ') || r.dados.email}${config.cepOrigem ? '' : ' — falta o CEP de origem'}.`);
    }
    case 'email': {
      if (!emailAtivo()) return falha('Preencha a chave do Brevo ou Resend e o remetente.');
      await enviarEmail({ para: config.email.admin, assunto: '✅ Teste de e-mail da loja DFR 3D', html: '<p>Funcionou! Os avisos da loja chegarão neste e-mail.</p>' });
      return ok(`E-mail de teste enviado para ${config.email.admin}. Confira a caixa de entrada (e o spam).`);
    }
    case 'celular': {
      if (!celularAtivo()) return falha('Preencha o Telegram ou o CallMeBot.');
      await avisarCelular('✅ Teste da loja DFR 3D: os avisos chegarão aqui.');
      return ok('Mensagem de teste enviada. Confira o celular.');
    }
    default:
      return falha('Este item não tem teste automático.');
  }
}

export function rotasConfiguracoes(r) {
  r.get('/api/admin/config', (req, res) => { exigirAdmin(req); sendJson(res, 200, estado()); });

  // Recebe só os campos alterados. Segredos: enviar '' apaga; não enviar mantém o atual.
  r.put('/api/admin/config', async (req, res) => {
    exigirAdmin(req);
    const { valores = {} } = await readJson(req);
    const salvos = lerAjuste('config', {});
    const alterados = [];
    for (const [chave, bruto] of Object.entries(valores)) {
      const campo = CAMPOS[chave];
      if (!campo) continue;
      const novo = normalizar(campo, bruto);
      if (valorCampo(chave) !== novo || !(chave in salvos)) {
        salvos[chave] = novo;
        if (valorCampo(chave) !== novo) alterados.push(campo.rotulo);
      }
    }
    salvarAjuste('config', salvos);
    aplicarAjustes(salvos);
    if (alterados.length) emitir('config:alterada', { campos: alterados });
    sendJson(res, 200, { ...estado(), alterados });
  });

  r.post('/api/admin/config/testar/:servico', async (req, res, { params }) => {
    exigirAdmin(req);
    try { sendJson(res, 200, await testar(params.servico)); }
    catch (e) { sendJson(res, 200, { ok: false, msg: e.message }); }
  });

  r.post('/api/admin/senha', async (req, res) => {
    exigirAdmin(req);
    const b = await readJson(req);
    trocarSenha(b.atual, b.nova);
    emitir('admin:senha', {});
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': renovarSessao() });
  });
}
