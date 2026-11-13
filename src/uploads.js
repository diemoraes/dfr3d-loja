// Salva arquivos enviados em base64 (fotos de produtos e arquivos de encomenda)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { HttpError } from './http.js';

export const privadoDir = path.join(config.dataDir, 'privado');
fs.mkdirSync(privadoDir, { recursive: true });

const ASSINATURAS = {
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8,
  png: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  webp: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
};

function decodificar(dataUrl) {
  const m = /^data:([\w/+.-]*);base64,(.+)$/s.exec(dataUrl || '');
  if (!m) throw new HttpError(400, 'Arquivo inválido.');
  return Buffer.from(m[2], 'base64');
}

const nomeAleatorio = (ext) => `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}.${ext}`;

/** Foto de produto: só JPG/PNG/WEBP, até 5 MB. Retorna o nome do arquivo salvo. */
export function salvarImagem(dataUrl) {
  const buf = decodificar(dataUrl);
  if (buf.length > 5 * 1024 * 1024) throw new HttpError(413, 'A foto passa de 5 MB.');
  const ext = Object.keys(ASSINATURAS).find((k) => ASSINATURAS[k](buf));
  if (!ext) throw new HttpError(400, 'Envie fotos em JPG, PNG ou WEBP.');
  const nome = nomeAleatorio(ext);
  fs.writeFileSync(path.join(config.uploadsDir, nome), buf);
  return nome;
}

export function apagarImagem(nome) {
  const p = path.join(config.uploadsDir, path.basename(nome));
  fs.rmSync(p, { force: true });
}

const EXT_ENCOMENDA = ['stl', '3mf', 'obj', 'step', 'stp', 'jpg', 'jpeg', 'png', 'webp', 'pdf'];

/** Arquivos de encomenda (STL, 3MF, fotos...): ficam numa pasta privada, só o painel acessa. */
export function salvarArquivoEncomenda(nomeOriginal, dataUrl) {
  const ext = path.extname(nomeOriginal || '').slice(1).toLowerCase();
  if (!EXT_ENCOMENDA.includes(ext)) throw new HttpError(400, `Tipo de arquivo não aceito: .${ext || '?'} (aceitos: ${EXT_ENCOMENDA.join(', ')})`);
  const buf = decodificar(dataUrl);
  if (buf.length > 20 * 1024 * 1024) throw new HttpError(413, 'Cada arquivo pode ter no máximo 20 MB.');
  const nome = nomeAleatorio(ext);
  fs.writeFileSync(path.join(privadoDir, nome), buf);
  return { arquivo: nome, nome: path.basename(nomeOriginal).slice(0, 120), tamanho: buf.length };
}
