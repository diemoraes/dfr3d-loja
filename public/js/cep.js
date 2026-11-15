// Busca de endereço por CEP — um só código para o checkout, a conta do cliente e o painel.
// Usa o ViaCEP e, se ele falhar, a BrasilAPI. Preenche rua, bairro, cidade e UF; tudo continua editável.
(function () {
  const soNumeros = (v) => String(v || '').replace(/\D/g, '');
  const cache = new Map();

  async function pegar(url, ms = 6000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) throw new Error(`http ${r.status}`);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  /** @returns {Promise<{ok:true,end:{rua,bairro,cidade,uf}}|{ok:false,motivo:'invalido'|'nao_encontrado'|'indisponivel'}>} */
  async function buscar(cepBruto) {
    const cep = soNumeros(cepBruto);
    if (cep.length !== 8) return { ok: false, motivo: 'invalido' };
    if (cache.has(cep)) return cache.get(cep);

    let end = null;
    let respondeu = false; // algum serviço respondeu (mesmo que dizendo "não existe")
    try {
      const d = await pegar(`https://viacep.com.br/ws/${cep}/json/`);
      respondeu = true;
      if (!d.erro) end = { rua: d.logradouro || '', bairro: d.bairro || '', cidade: d.localidade || '', uf: d.uf || '' };
    } catch { /* tenta a reserva */ }
    if (!end) {
      try {
        const d = await pegar(`https://brasilapi.com.br/api/cep/v2/${cep}`);
        respondeu = true;
        if (d && d.city) end = { rua: d.street || '', bairro: d.neighborhood || '', cidade: d.city || '', uf: d.state || '' };
      } catch { /* sem resposta ou CEP desconhecido */ }
    }

    const r = end ? { ok: true, end } : { ok: false, motivo: respondeu ? 'nao_encontrado' : 'indisponivel' };
    if (respondeu) cache.set(cep, r); // não guarda falha de rede
    return r;
  }

  const formatar = (v) => soNumeros(v).slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2');

  /**
   * Liga a busca num formulário. Ao digitar um CEP completo, preenche os campos de endereço.
   * @param {{cep,rua?,numero?,bairro?,cidade?,uf?}} campos seletores CSS ou elementos
   * @param {{dica?:string, foco?:boolean}} op dica: texto extra na mensagem · foco: pula para o número (padrão: sim)
   */
  function ligar(campos, op = {}) {
    const el = (x) => (typeof x === 'string' ? document.querySelector(x) : x);
    const c = {};
    for (const k of ['cep', 'rua', 'numero', 'bairro', 'cidade', 'uf']) c[k] = campos[k] ? el(campos[k]) : null;
    if (!c.cep) return null;

    let msg = c.cep.parentElement.querySelector('.cep-msg');
    if (!msg) {
      msg = document.createElement('div');
      msg.className = 'ajuda cep-msg';
      msg.setAttribute('aria-live', 'polite');
      c.cep.insertAdjacentElement('afterend', msg);
    }
    const dizer = (texto, estado = '') => { msg.textContent = texto; msg.dataset.estado = estado; };

    let seq = 0; // descarta respostas de buscas antigas se a pessoa digitar outro CEP
    async function consultar() {
      const cep = soNumeros(c.cep.value);
      if (cep.length !== 8) { seq++; dizer(''); return; }
      const minha = ++seq;
      dizer('Buscando endereço…', 'buscando');
      const r = await buscar(cep);
      if (minha !== seq) return;
      if (!r.ok) {
        dizer(r.motivo === 'indisponivel'
          ? 'Não consegui buscar o endereço agora. Preencha os campos manualmente.'
          : 'CEP não encontrado. Confira os números ou preencha o endereço manualmente.', 'erro');
        return;
      }
      for (const k of ['rua', 'bairro', 'cidade', 'uf']) {
        if (!c[k]) continue;
        c[k].value = r.end[k]; // CEP novo = endereço novo: não deixa sobra do CEP anterior
        c[k].dispatchEvent(new Event('input', { bubbles: true }));
      }
      const geral = !r.end.rua; // CEP único da cidade: não traz rua nem bairro
      dizer(`${geral ? 'CEP geral da cidade: informe a rua e o bairro.' : '✔ Endereço preenchido. Confira e informe o número.'}${op.dica ? ' ' + op.dica : ''}`, 'ok');
      if (op.foco !== false) {
        const alvo = geral ? c.rua : (c.numero || c.rua);
        if (alvo && alvo.offsetParent !== null) alvo.focus();
      }
    }

    c.cep.addEventListener('input', () => {
      const f = formatar(c.cep.value);
      if (c.cep.value !== f) c.cep.value = f;
      consultar();
    });
    return { consultar };
  }

  window.CEP = { buscar, ligar };
})();
