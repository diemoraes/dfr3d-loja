// Emissor de eventos da loja: desacopla pedidos de e-mails, avisos e integrações
import { EventEmitter } from 'node:events';

export const eventos = new EventEmitter();
eventos.setMaxListeners(30);

/** Dispara um evento sem deixar um erro de integração derrubar a requisição. */
export function emitir(nome, dados) {
  for (const fn of eventos.listeners(nome)) {
    Promise.resolve().then(() => fn(dados)).catch((e) => console.error(`Evento ${nome}:`, e.message));
  }
}
