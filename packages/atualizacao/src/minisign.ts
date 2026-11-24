// @effect-diagnostics nodeBuiltinImport:off extendsNativeError:off -- Ed25519 e scrypt do node:crypto; funções puras, sem runtime Effect (o erro é lançado, e quem chama converte)
/**
 * Minisign (https://jedisct1.github.io/minisign/) em JS, sobre o Ed25519 do `node:crypto` e o
 * BLAKE2b do `@noble/hashes` (o Node do Electron usa o BoringSSL, que não tem `blake2b512`).
 *
 * - **No app:** só `lerChavePublica` e `verificar`. O manifesto do canal vem com a assinatura ao
 *   lado (`beta.json.minisig`), e a chave pública vem embutida na política de fábrica.
 * - **Na fábrica:** `gerarChaves`, `lerChaveSecreta` e `assinar`. A chave secreta nunca entra no
 *   repositório: o script a lê de um arquivo fora do git (`SIMPLIFICA_MINISIGN_CHAVE`).
 *
 * Formatos (os do minisign 0.11, compatíveis com `minisign -V` e `minisign -S`):
 *
 * - chave pública: `"Ed"` + id (8 bytes) + chave (32), em base64, depois de uma linha de comentário;
 * - assinatura: `"ED"` (pré-hash BLAKE2b-512, o padrão do minisign desde o 0.10; a legada, `"Ed"`, é
 *   recusada: a fábrica só assina com pré-hash) + id +
 *   assinatura (64); a linha `trusted comment:` e a assinatura global, sobre assinatura + comentário;
 * - chave secreta: `"Ed"` + KDF (`"Sc"`, scrypt, ou dois zeros, sem senha) + `"B2"` + sal (32) +
 *   opslimit e memlimit (8 bytes LE cada) + id + chave (64) + soma BLAKE2b-256 (32), cifrados com o
 *   scrypt quando há senha.
 */
import * as NodeCrypto from "node:crypto";
import { blake2b } from "@noble/hashes/blake2b";

const ALG_ED = "Ed";
const ALG_PREHASH = "ED";
const KDF_SCRYPT = "Sc";
const CHK_B2 = "B2";

export class ErroMinisign extends Error {
  override readonly name = "ErroMinisign";
}

export interface ChavePublica {
  /** Id da chave (8 bytes). */
  readonly id: Uint8Array;
  readonly chave: Uint8Array;
}

export interface ChaveSecreta extends ChavePublica {
  /** A chave secreta do libsodium: semente (32) + chave pública (32). */
  readonly secreta: Uint8Array;
}

const latin = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

/** O id como o minisign o escreve: inteiro de 64 bits little-endian, em hexadecimal maiúsculo. */
export const idHex = (id: Uint8Array): string => Buffer.from(id).reverse().toString("hex").toUpperCase();

/** A linha de dados de um arquivo minisign: a primeira linha que não é comentário. */
function linhaDeDados(texto: string, oQue: string): Uint8Array {
  const linhas = texto.split(/\r?\n/).map((linha) => linha.trim());
  const dados = linhas.find((linha) => linha !== "" && !linha.startsWith("untrusted comment:"));
  if (dados === undefined) throw new ErroMinisign(`${oQue}: sem a linha de dados`);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(dados)) throw new ErroMinisign(`${oQue}: base64 inválido`);
  return new Uint8Array(Buffer.from(dados, "base64"));
}

/** Lê uma chave pública: o arquivo `.pub` inteiro ou só a linha base64. */
export function lerChavePublica(texto: string): ChavePublica {
  const bytes = linhaDeDados(texto, "chave pública");
  if (bytes.length !== 42 || latin(bytes.subarray(0, 2)) !== ALG_ED) {
    throw new ErroMinisign("chave pública: formato desconhecido (esperava Ed25519 do minisign)");
  }
  return { id: bytes.slice(2, 10), chave: bytes.slice(10, 42) };
}

export function escreverChavePublica(chave: ChavePublica): string {
  const bytes = Buffer.concat([Buffer.from(ALG_ED, "latin1"), chave.id, chave.chave]);
  return `untrusted comment: minisign public key ${idHex(chave.id)}\n${base64(bytes)}\n`;
}

const objetoPublico = (chave: Uint8Array) =>
  NodeCrypto.createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: base64url(chave) }, format: "jwk" });

const objetoPrivado = (secreta: Uint8Array) =>
  NodeCrypto.createPrivateKey({
    key: { kty: "OKP", crv: "Ed25519", d: base64url(secreta.subarray(0, 32)), x: base64url(secreta.subarray(32, 64)) },
    format: "jwk",
  });

export interface Assinatura {
  readonly id: Uint8Array;
  readonly assinatura: Uint8Array;
  /** O texto depois de `trusted comment: ` (assinado pela assinatura global). */
  readonly comentario: string;
  readonly global: Uint8Array;
}

/** Lê um arquivo `.minisig`. */
export function lerAssinatura(texto: string): Assinatura {
  const linhas = texto.split(/\r?\n/);
  const uteis = linhas.filter((linha) => linha.trim() !== "");
  if (uteis.length < 4 || !uteis[0]!.startsWith("untrusted comment:") || !uteis[2]!.startsWith("trusted comment: ")) {
    throw new ErroMinisign("assinatura: formato desconhecido");
  }
  const bytes = linhaDeDados(uteis[1]!, "assinatura");
  const alg = latin(bytes.subarray(0, 2));
  if (bytes.length === 74 && alg === ALG_ED) {
    throw new ErroMinisign("assinatura legada (sem pré-hash) recusada; assine com o minisign 0.10 ou mais novo");
  }
  if (bytes.length !== 74 || alg !== ALG_PREHASH) {
    throw new ErroMinisign("assinatura: algoritmo desconhecido");
  }
  const global = linhaDeDados(uteis[3]!, "assinatura global");
  if (global.length !== 64) throw new ErroMinisign("assinatura global: tamanho errado");
  return {
    id: bytes.slice(2, 10),
    assinatura: bytes.slice(10, 74),
    comentario: uteis[2]!.slice("trusted comment: ".length),
    global,
  };
}

const iguais = (a: Uint8Array, b: Uint8Array) => a.length === b.length && NodeCrypto.timingSafeEqual(a, b);

/**
 * Confere `dados` com a assinatura e a chave. Devolve o comentário confiável; lança `ErroMinisign`
 * se a chave for outra, a assinatura não bater ou o comentário confiável tiver sido trocado.
 */
export function verificar(dados: Uint8Array, assinaturaTexto: string, chave: ChavePublica): string {
  const assinatura = lerAssinatura(assinaturaTexto);
  if (!iguais(assinatura.id, chave.id)) {
    throw new ErroMinisign(`assinatura de outra chave (${idHex(assinatura.id)}; esperava ${idHex(chave.id)})`);
  }
  const publica = objetoPublico(chave.chave);
  const mensagem = blake2b(dados, { dkLen: 64 });
  if (!NodeCrypto.verify(null, mensagem, publica, assinatura.assinatura)) {
    throw new ErroMinisign("assinatura inválida");
  }
  const global = Buffer.concat([assinatura.assinatura, Buffer.from(assinatura.comentario, "utf8")]);
  if (!NodeCrypto.verify(null, global, publica, assinatura.global)) {
    throw new ErroMinisign("comentário confiável adulterado");
  }
  return assinatura.comentario;
}

/** Assina como `minisign -S` (pré-hash BLAKE2b-512). O comentário confiável não pode ter quebra de linha. */
export function assinar(dados: Uint8Array, chave: ChaveSecreta, comentario: string): string {
  if (/[\r\n]/.test(comentario)) throw new ErroMinisign("o comentário confiável não pode ter quebra de linha");
  const privada = objetoPrivado(chave.secreta);
  const assinatura = NodeCrypto.sign(null, blake2b(dados, { dkLen: 64 }), privada);
  const global = NodeCrypto.sign(null, Buffer.concat([assinatura, Buffer.from(comentario, "utf8")]), privada);
  const linha = Buffer.concat([Buffer.from(ALG_PREHASH, "latin1"), chave.id, assinatura]);
  return [
    "untrusted comment: assinatura da fábrica do Simplifica IF",
    base64(linha),
    `trusted comment: ${comentario}`,
    base64(global),
    "",
  ].join("\n");
}

/* ------------------------------------------------------------------ chave secreta (fábrica) */

const soma = (id: Uint8Array, secreta: Uint8Array) =>
  blake2b(Buffer.concat([Buffer.from(ALG_ED, "latin1"), id, secreta]), { dkLen: 32 });

/** `pickparams` do libsodium (`crypto_pwhash_scryptsalsa208sha256`), que o minisign usa. */
export function parametrosScrypt(opslimit: number, memlimit: number): { N: number; r: number; p: number } {
  const ops = Math.max(opslimit, 32768);
  const r = 8;
  const log2 = (maximo: number) => {
    let n = 1;
    while (n < 63 && 2 ** n <= maximo / 2) n += 1;
    return n;
  };
  if (ops < memlimit / 32) {
    return { N: 2 ** log2(Math.floor(ops / (r * 4))), r, p: 1 };
  }
  const n = log2(Math.floor(memlimit / (r * 128)));
  const maxrp = Math.min(Math.floor(ops / 4 / 2 ** n), 0x3fffffff);
  return { N: 2 ** n, r, p: Math.max(1, Math.floor(maxrp / r)) };
}

/** A senha entra como bytes UTF-8, como digitada: o minisign não normaliza (um "é" composto e um decomposto são senhas diferentes). */
const fluxoScrypt = (senha: string, sal: Uint8Array, opslimit: number, memlimit: number) => {
  const { N, r, p } = parametrosScrypt(opslimit, memlimit);
  return NodeCrypto.scryptSync(senha, sal, 104, {
    N,
    r,
    p,
    maxmem: 128 * N * r * p + 64 * 1024 * 1024,
  });
};

const xor = (a: Uint8Array, b: Uint8Array) => a.map((byte, i) => byte ^ b[i]!);

/** Lê uma chave secreta do minisign (cifrada com senha, ou sem senha, `minisign -G -W`). */
export function lerChaveSecreta(texto: string, senha?: string): ChaveSecreta {
  const bytes = linhaDeDados(texto, "chave secreta");
  if (bytes.length !== 158 || latin(bytes.subarray(0, 2)) !== ALG_ED || latin(bytes.subarray(4, 6)) !== CHK_B2) {
    throw new ErroMinisign("chave secreta: formato desconhecido");
  }
  const kdf = bytes.subarray(2, 4);
  const sal = bytes.subarray(6, 38);
  const visao = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const opslimit = Number(visao.getBigUint64(38, true));
  const memlimit = Number(visao.getBigUint64(46, true));
  let chaveNum: Uint8Array = bytes.subarray(54, 158);
  if (latin(kdf) === KDF_SCRYPT) {
    if (senha === undefined) throw new ErroMinisign("chave secreta cifrada: falta a senha");
    chaveNum = xor(chaveNum, fluxoScrypt(senha, sal, opslimit, memlimit));
  } else if (kdf[0] !== 0 || kdf[1] !== 0) {
    throw new ErroMinisign("chave secreta: KDF desconhecido");
  }
  const id = chaveNum.slice(0, 8);
  const secreta = chaveNum.slice(8, 72);
  if (!iguais(soma(id, secreta), chaveNum.subarray(72, 104))) {
    throw new ErroMinisign("chave secreta: senha errada ou arquivo corrompido");
  }
  return { id, secreta, chave: secreta.slice(32, 64) };
}

/** Escreve a chave secreta no formato do minisign; com `senha`, cifrada pelo scrypt. */
export function escreverChaveSecreta(
  chave: ChaveSecreta,
  opcoes: { readonly senha?: string; readonly opslimit?: number; readonly memlimit?: number } = {},
): string {
  const sal = NodeCrypto.randomBytes(32);
  const opslimit = opcoes.opslimit ?? 33_554_432;
  const memlimit = opcoes.memlimit ?? 1_073_741_824;
  const limites = Buffer.alloc(16);
  limites.writeBigUInt64LE(BigInt(opslimit), 0);
  limites.writeBigUInt64LE(BigInt(memlimit), 8);
  let chaveNum: Uint8Array = Buffer.concat([chave.id, chave.secreta, soma(chave.id, chave.secreta)]);
  const cifrada = opcoes.senha !== undefined;
  if (cifrada) chaveNum = xor(chaveNum, fluxoScrypt(opcoes.senha!, sal, opslimit, memlimit));
  const bytes = Buffer.concat([
    Buffer.from(ALG_ED, "latin1"),
    cifrada ? Buffer.from(KDF_SCRYPT, "latin1") : Buffer.alloc(2),
    Buffer.from(CHK_B2, "latin1"),
    sal,
    limites,
    chaveNum,
  ]);
  const comentario = cifrada ? "minisign encrypted secret key" : "minisign secret key (sem senha)";
  return `untrusted comment: ${comentario}\n${base64(bytes)}\n`;
}

/** Um par novo (a fábrica, uma vez; os testes, um descartável a cada execução). */
export function gerarChaves(): ChaveSecreta {
  const { privateKey } = NodeCrypto.generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" });
  const semente = Buffer.from(jwk.d!, "base64url");
  const publica = Buffer.from(jwk.x!, "base64url");
  return {
    id: new Uint8Array(NodeCrypto.randomBytes(8)),
    secreta: new Uint8Array(Buffer.concat([semente, publica])),
    chave: new Uint8Array(publica),
  };
}
