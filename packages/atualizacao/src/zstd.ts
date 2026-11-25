// @effect-diagnostics nodeBuiltinImport:off -- zstd do node:zlib; funções puras, sem runtime Effect
/**
 * Pacotes e patches da base com o zstd do `node:zlib` (Node 22.15+; o Node 24 do Electron 44 também
 * tem), sem binário externo.
 *
 * O patch é o que o `zstd --patch-from` faz: a versão nova comprimida com a anterior como dicionário
 * de conteúdo bruto. O formato é o mesmo do CLI nos dois sentidos (o `zstd -d --patch-from` lê o
 * patch daqui, e o app lê um do CLI), mas a fábrica gera em Node para não depender dele.
 *
 * Medido em 16/11/2026 sobre o `kb.sqlite` de 132 MB, com uma norma e um PPC alterados: o pacote
 * inteiro tem 34,7 MB (nível 19, 27 s); o patch, 14 KB (29 s) com `hashLog` 26 e `chainLog` 27. Com
 * os parâmetros do nível 19, que não cobrem um dicionário desse tamanho, o patch tinha 25 MB; o
 * `zstd --patch-from -19 --long=28` dá 38 KB. Aplicar leva cerca de 0,15 s.
 */
import * as NodeZlib from "node:zlib";

const C = NodeZlib.constants;

/** Janela máxima aceita na descompressão (2 GB): o patch de uma base de até ~1 GB. */
const JANELA_MAXIMA = 31;

const janelaPara = (bytes: number) => Math.min(30, Math.max(23, Math.ceil(Math.log2(Math.max(bytes, 1))) + 1));

export function comprimir(dados: Uint8Array, nivel = 19): Buffer {
  return NodeZlib.zstdCompressSync(dados, {
    params: { [C.ZSTD_c_compressionLevel]: nivel, [C.ZSTD_c_checksumFlag]: 1 },
  });
}

export function descomprimir(dados: Uint8Array, limite?: number): Buffer {
  return NodeZlib.zstdDecompressSync(dados, {
    params: { [C.ZSTD_d_windowLogMax]: JANELA_MAXIMA },
    ...(limite === undefined ? {} : { maxOutputLength: limite }),
  });
}

/** O patch de `anterior` para `nova` (a fábrica). */
export function criarPatch(anterior: Uint8Array, nova: Uint8Array, nivel = 19): Buffer {
  const janela = janelaPara(anterior.byteLength + nova.byteLength);
  return NodeZlib.zstdCompressSync(nova, {
    dictionary: anterior,
    params: {
      [C.ZSTD_c_compressionLevel]: nivel,
      [C.ZSTD_c_windowLog]: janela,
      [C.ZSTD_c_hashLog]: Math.min(janela - 2, 27),
      [C.ZSTD_c_chainLog]: Math.min(janela - 1, 28),
      [C.ZSTD_c_checksumFlag]: 1,
    },
  });
}
