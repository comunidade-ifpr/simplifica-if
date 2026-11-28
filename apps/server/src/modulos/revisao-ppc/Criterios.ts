/**
 * A ficha de um critério da revisão para o painel de leitura (`revisaoPpc.criterio`): o texto vem das
 * fichas da revisão no `kb.sqlite` (`PacoteRevisaoPpc`), a vigência de cada norma citada vem das `Normas`
 * na data da base (o CNCT, com o curso da revisão), os temas das seções, dos tópicos (`FontesNormativas`), e o "Neste PPC", da lista viva.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  FalhaRevisaoPpc,
  type FichaCriterio,
  type ListaPendencias,
} from "@simplifica-if/contratos-app/modulos/revisao-ppc";
import * as FontesNormativas from "@simplifica-if/kb/FontesNormativas";
import * as Normas from "@simplifica-if/kb/Normas";
import * as PacoteRevisaoPpc from "@simplifica-if/kb/PacoteRevisaoPpc";
import { ehModoExecucao, type ModoExecucao } from "@simplifica-if/kb/revisao-ppc/constantes";
import * as ListaViva from "./ListaViva.ts";

const texto = (valor: unknown): string | null =>
  typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;

const objeto = (valor: unknown): Readonly<Record<string, unknown>> =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};

const lista = (valor: unknown): ReadonlyArray<unknown> => (Array.isArray(valor) ? valor : []);

/** As normas da ficha, uma por norma, com os dispositivos na ordem em que a ficha os cita. */
export function normasDaFicha(ficha: Readonly<Record<string, unknown>>): ReadonlyArray<{
  readonly norma: string;
  readonly dispositivos: ReadonlyArray<string>;
}> {
  const porNorma = new Map<string, Array<string>>();
  for (const item of lista(ficha["referencias_normativas"])) {
    const ref = texto(objeto(item)["ref"]);
    if (ref === null) continue;
    const dispositivos = porNorma.get(ref) ?? [];
    porNorma.set(ref, dispositivos);
    const dispositivo = texto(objeto(item)["dispositivo"])?.replace(/^#/, "");
    if (dispositivo !== undefined && dispositivo !== "" && !dispositivos.includes(dispositivo))
      dispositivos.push(dispositivo);
  }
  return [...porNorma].map(([norma, dispositivos]) => ({ norma, dispositivos }));
}

/** O critério `id` nesta lista: o estado na régua e a pendência dele (a primeira em aberto, senão a primeira). */
export function nestePpc(atual: ListaPendencias, id: string): FichaCriterio["nestePpc"] {
  const criterio = atual.resultado.criterios.find((c) => c.ficha === id);
  const doCriterio = atual.pendencias.filter((v) => v.pendencia.ficha === id);
  const viva = doCriterio.find((v) => v.situacao === "aberta") ?? doCriterio[0];
  return {
    estado: criterio?.estado ?? "nao_lido",
    mensagem: criterio?.mensagem ?? "",
    pendencia:
      viva === undefined
        ? null
        : {
            chave: viva.chave,
            situacao: viva.situacao,
            titulo: viva.pendencia.titulo,
            secao: viva.pendencia.secao,
            trecho: viva.pendencia.trecho,
          },
  };
}

export class Criterios extends Context.Service<
  Criterios,
  {
    /** A ficha do critério `id` (`CT-SUP-17`) na revisão `lista`. */
    readonly ficha: (lista: string, id: string) => Effect.Effect<FichaCriterio, FalhaRevisaoPpc>;
  }
>()("@simplifica-if/server/modulos/revisao-ppc/Criterios") {}

/**
 * A referência da ficha como o painel a mostra: a norma da base, com o título e a vigência, abre no Ler;
 * o CNCT abre no curso da revisão, quando ela o identificou; a referência externa não tem texto na base,
 * só o título.
 */
function referencia(
  n: { readonly norma: string; readonly dispositivos: ReadonlyArray<string> },
  norma: { readonly titulo: string; readonly status_vigencia: string | null } | null,
  cnct: { readonly slug: string; readonly denominacao: string } | null,
): FichaCriterio["normas"][number] {
  if (n.norma.startsWith("cnct:"))
    return {
      ...n,
      tipo: "cnct",
      titulo: cnct === null ? "Catálogo Nacional de Cursos Técnicos (CNCT)" : `CNCT · ${cnct.denominacao}`,
      link: cnct === null ? null : `ifpr://cnct/${cnct.slug}`,
      vigencia: null,
    };
  if (n.norma.startsWith("externo:"))
    return { ...n, tipo: "externo", titulo: norma?.titulo ?? null, link: null, vigencia: null };
  const dispositivo = n.dispositivos.length === 1 ? `#${n.dispositivos[0]}` : "";
  return {
    ...n,
    tipo: "norma",
    titulo: norma?.titulo ?? null,
    link: `ifpr://norma/${n.norma}${dispositivo}`,
    vigencia: norma?.status_vigencia ?? null,
  };
}

const make = Effect.gen(function* () {
  const viva = yield* ListaViva.ListaViva;
  const pacotes = yield* PacoteRevisaoPpc.PacoteRevisaoPpc;
  const normas = yield* Normas.Normas;
  const fontes = yield* FontesNormativas.FontesNormativas;

  const ficha = Effect.fn("Criterios.ficha")(function* (listaId: string, id: string) {
    const atual = yield* viva.lista(listaId);
    const falha = (motivo: string) => new FalhaRevisaoPpc({ arquivo: atual.arquivoOriginal, motivo });
    const [dados] = yield* pacotes
      .fichas([id])
      .pipe(Effect.mapError(() => falha("Não foi possível ler os critérios da revisão na base.")));
    if (dados === undefined || dados.id !== id) return yield* falha(`O critério ${id} não está na base.`);
    const execucao = objeto(dados["execucao"]);
    const modo: ModoExecucao = ehModoExecucao(execucao["modo"]) ? execucao["modo"] : "tematico";
    const topicos = lista(dados["topicos_tematicos"]).filter((t): t is string => typeof t === "string");
    const secoes = topicos.flatMap((t) => {
      const titulo = fontes.topicosFichas.find((topico) => topico.id === t)?.titulo;
      return titulo === undefined ? [] : [titulo];
    });
    const cnct = atual.resultado.curso.cnct;
    const referencias = yield* Effect.forEach(normasDaFicha(dados), (n) =>
      n.norma.startsWith("cnct:")
        ? Effect.succeed(referencia(n, null, cnct))
        : normas.ficha(n.norma).pipe(
            Effect.map((norma) => referencia(n, norma, cnct)),
            Effect.orElseSucceed(() => referencia(n, null, cnct)),
          ),
    );
    return {
      id,
      titulo: texto(dados["titulo"]) ?? id,
      criticidade: texto(dados["criticidade"]),
      pergunta: texto(dados["pergunta"]),
      normas: referencias,
      atendido: texto(dados["boa_evidencia"]),
      naoAtendido: texto(dados["ma_evidencia"]),
      aConferir: texto(dados["escalonar_quando"]),
      modo,
      justificativa: texto(execucao["justificativa"]),
      secoes,
      nestePpc: nestePpc(atual, id),
    } satisfies FichaCriterio;
  });

  return Criterios.of({ ficha });
});

/** Pede a `ListaViva` e, do `kb.sqlite`, o `PacoteRevisaoPpc`, as `Normas` e as `FontesNormativas`. */
export const layer = Layer.effect(Criterios, make);
