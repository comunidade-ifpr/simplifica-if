/**
 * A lista viva de um resultado de revisão (M1.11, etapa 5b), criada pela `ListaViva` (a
 * pré-conferência) e pela `RevisaoIa` (a revisão com IA concluída), e o nonce das listas e das ações
 * com IA. Fica aqui, e não na `ListaViva`, para a `RevisaoIa` não depender dela.
 */
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import type { Provider, ResultadoRevisaoPpc } from "@simplifica-if/contratos-app";
import { chavePendencia } from "@simplifica-if/ppc/revisao-previa";
import * as Listas from "../persistencia/Listas.ts";
import * as RevisorPpc from "./RevisorPpc.ts";

/** Um nonce novo, de 8 bytes em hexadecimal: as marcas de uma ação com IA não valem na seguinte. */
export const novoNonce = (aleatorio: SecureRandom.SecureRandom["Service"]) =>
  aleatorio.randomBytes(8).pipe(Effect.map(Hex.encode));

export interface DadosNovaLista {
  readonly id?: string;
  readonly arquivo: string;
  readonly revisado: RevisorPpc.RevisaoDoArquivo;
  readonly revisao: string | null;
  readonly provider: Provider | null;
  readonly modelo: string | null;
}

/** Grava a lista viva de um resultado e devolve o resultado com o `lista`. Pede as `Listas` e o `SecureRandom`. */
export const criarLista = Effect.fn("ListaViva.criarLista")(function* (d: DadosNovaLista) {
  const listas = yield* Listas.Listas;
  const aleatorio = yield* SecureRandom.SecureRandom;
  const id = d.id ?? `lista-${yield* aleatorio.uuidV4()}`;
  const resultado: ResultadoRevisaoPpc = { ...RevisorPpc.resultadoParaInterface(d.arquivo, d.revisado), lista: id };
  const vistas = new Set<string>();
  const pendencias = resultado.pendencias.flatMap((p) => {
    const chave = chavePendencia(p);
    if (vistas.has(chave)) return [];
    vistas.add(chave);
    return [{ chave, pendencia: p }];
  });
  yield* listas.criar(
    {
      id,
      arquivo: d.arquivo,
      sha256: d.revisado.sha256,
      revisao: d.revisao,
      provider: d.provider,
      modelo: d.modelo,
      cnct: resultado.curso.cnct?.slug ?? null,
      forma: resultado.curso.forma,
      markdown: d.revisado.revisao.markdown,
      linhasTextoParaIa: d.revisado.revisao.linhasTextoParaIa,
      nonce: yield* novoNonce(aleatorio),
      resultado,
    },
    pendencias,
  );
  return resultado;
});
