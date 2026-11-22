/**
 * A cópia comentada de uma lista viva (M1.11, etapa 5b): a situação de cada pendência no comentário e
 * no aviso, com os resultados da leitura com IA que a lista guarda. A `ListaViva` a regrava em "Abrir no
 * Word" e a `RevisaoIa` no fim da leitura; fica aqui para a `RevisaoIa` não depender da `ListaViva`.
 * Quem chama segura `Listas.exclusivo`.
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import type { PendenciaRevisao } from "@simplifica-if/contratos-app";
import { chavePendencia, type MarcaPendencia } from "@simplifica-if/ppc/revisao-previa";
import * as Listas from "../persistencia/Listas.ts";
import type { PendenciaDaLista } from "./arquivo-novo.ts";
import * as RevisorPpc from "./RevisorPpc.ts";

/** A situação de cada pendência não aberta, com a nota, para a cópia comentada (pela chave). */
export function marcasDaCopia(
  pendencias: ReadonlyArray<Pick<PendenciaDaLista, "chave" | "situacao" | "resolvidaPor">>,
  eventos: ReadonlyArray<{ chave: string; acao: string; texto: string; motivo?: string | null | undefined }>,
): Record<string, MarcaPendencia> {
  const situacoes: Record<string, MarcaPendencia> = {};
  for (const p of pendencias) {
    if (p.situacao === "aberta") continue;
    const ultimo = eventos.filter((e) => e.chave === p.chave).at(-1);
    const ultimaContestacao = eventos.filter((e) => e.chave === p.chave && e.acao === "contestar").at(-1);
    const nota =
      p.situacao === "resolvida"
        ? p.resolvidaPor === "revisarDeNovo"
          ? "Conferida na nova revisão do arquivo atualizado."
          : "Marcada pela coordenação, sem nova revisão."
        : p.situacao === "contestada_mantida" && ultimo?.acao === "contestar"
          ? ultimo.texto.replace(/^Mantida: /, "Resposta da revisão: ")
          : p.situacao === "contestada_aceita" && ultimaContestacao
            ? `Motivo da coordenação: “${ultimaContestacao.motivo ?? ""}”. ${ultimaContestacao.texto}`
            : undefined;
    situacoes[p.chave] = {
      situacao: p.situacao,
      ...(nota ? { nota } : {}),
      // Só a pendência confirmada pela nova revisão sai do documento.
      ...(p.situacao === "resolvida" && p.resolvidaPor === "revisarDeNovo" ? { foraDoDocumento: true } : {}),
    };
  }
  return situacoes;
}

/** O curso que a pessoa escolheu ("Qual é o curso?"); o identificado no documento é o documento que diz. */
export const cursoEscolhido = (r: Listas.RegistroLista): { cnct?: string; forma?: string } =>
  r.resultado.curso.origem !== "pessoa"
    ? {}
    : { ...(r.cnct === null ? {} : { cnct: r.cnct }), ...(r.forma === null ? {} : { forma: r.forma }) };

/** Onde cada pendência ficou na cópia gravada, pela chave (o `noDocumento` real, que a lista guarda). */
export const locaisNoDocumento = (
  pendencias: ReadonlyArray<PendenciaRevisao>,
): ReadonlyMap<string, PendenciaRevisao["noDocumento"]> =>
  new Map(pendencias.map((p) => [chavePendencia(p), p.noDocumento]));

/**
 * A cópia comentada do arquivo da lista, com a situação de cada pendência e os resultados da IA; o
 * resultado da lista passa a ser o dela, e cada pendência, o lugar em que ficou no documento. Só regrava
 * se a lista mudou desde a última cópia ou se a cópia sumiu.
 */
export const regravarCopia = Effect.fn("ListaViva.regravarCopia")(function* (registro: Listas.RegistroLista) {
  const listas = yield* Listas.Listas;
  const revisor = yield* RevisorPpc.RevisorPpc;
  const fs = yield* FileSystem.FileSystem;
  const id = registro.id;
  const copia = registro.resultado.arquivoComentado;
  const existe = copia !== "" && (yield* fs.exists(copia).pipe(Effect.orElseSucceed(() => false)));
  if (registro.versaoCopia === registro.versao && existe) return;
  const situacoes = marcasDaCopia(yield* listas.pendencias(id), yield* listas.eventos(id));
  const final = yield* revisor.revisarArquivo({
    arquivo: registro.arquivo,
    gravar: true,
    sha256: registro.sha256,
    ...cursoEscolhido(registro),
    ...(registro.resultadosIa === null ? {} : { ia: registro.resultadosIa }),
    situacoes,
  });
  yield* listas.trocarResultado(
    id,
    { ...RevisorPpc.resultadoParaInterface(registro.arquivo, final), lista: id },
    registro.versao,
    locaisNoDocumento(final.revisao.pendencias),
  );
});
