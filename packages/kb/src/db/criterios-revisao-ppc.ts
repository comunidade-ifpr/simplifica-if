/**
 * `kb criterios-revisao-ppc`: os critérios da tarefa "Revisar um PPC" (as fichas de
 * `base-conhecimento/revisao-ppc/fichas/`), por ID, por tópico de `topicos-fichas.json` ou pelos que
 * uma norma atinge (`criteriosAtingidosEm`: referência estruturada, correspondente na sucessora,
 * citação no texto ou tema). Não são fonte normativa: são o que a revisão confere.
 *
 * Por norma, também os outros arquivos da tarefa que a citam (os marcos normativos e a taxonomia dos
 * tópicos, `revisao_ppc_arquivos`). Lê só as tabelas `revisao_ppc_*` do `kb.sqlite`, com o título e o status de vigência de cada norma
 * citada (`normas`) e, por norma, os dispositivos dela e a correspondência.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as FontesNormativas from "../FontesNormativas.ts";
import {
  type ArquivoDaTarefaAtingido,
  type CriterioAtingido,
  criteriosAtingidosEm,
  type TopicoTaxonomia,
} from "../normas/impacto.ts";
import { CriteriosNaoEncontrados } from "../pacote-revisao-ppc-erros.ts";
import { compararTexto } from "../texto.ts";
import { carregarFonteCorrespondencia, obterNorma } from "./consultas-normas.ts";
import type { FichaPacote } from "./pacote-revisao-ppc.ts";
import * as Sql from "./sql.ts";

/** O filtro: exatamente um de `id` (`CT-SUP-17`), `topico` (`estagio`) ou `norma` (ID canônico, com dispositivo opcional). */
export interface FiltroCriterios {
  readonly id?: string;
  readonly topico?: string;
  readonly norma?: string;
}

/** Uma referência normativa do critério, com o título e o status de vigência da norma no banco. */
export interface ReferenciaCriterio {
  ref: string;
  dispositivo: string | null;
  papel: string;
  nota: string | null;
  /** `null`: a norma não está na base (ou a referência é ao CNCT). */
  titulo: string | null;
  status_vigencia: string | null;
}

export interface Criterio {
  id: string;
  titulo: string;
  /** Arquivo da ficha, relativo à raiz do repositório. */
  path: string;
  /** Tópicos de `topicos-fichas.json` a que o critério pertence, por ID. */
  topicos: string[];
  referencias: ReferenciaCriterio[];
  /** O JSON da ficha, com as chaves na ordem do arquivo. */
  ficha: FichaPacote;
  /** Só na busca por norma: por que a norma atinge o critério. */
  atingido?: Omit<CriterioAtingido, "id" | "arquivo">;
}

export interface ResultadoCriterios {
  filtro: { campo: "id" | "topico" | "norma"; valor: string };
  /** O título do tópico (busca por tópico) ou da norma (busca por norma). */
  titulo: string | null;
  criterios: Criterio[];
  /** Só na busca por norma: os tópicos cujos termos aparecem em dispositivos com mudança material. */
  topicos_atingidos?: string[];
  /** Só na busca por norma: os outros arquivos da tarefa que a citam (os marcos normativos, a taxonomia). */
  arquivos_da_tarefa?: ArquivoDaTarefaAtingido[];
}

const linhasFichas = Sql.todas(
  Schema.Struct({
    id: Schema.String,
    titulo: Schema.String,
    path: Schema.String,
    arquivo_json: Schema.String,
  }),
);
const decodificarFicha = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);
const linhasArquivos = Sql.todas(Schema.Struct({ path: Schema.String, arquivo_json: Schema.String }));
const linhasFichasTopicos = Sql.todas(Schema.Struct({ ficha_id: Schema.String, topico_id: Schema.String }));
const linhasDispositivos = Sql.todas(Schema.Struct({ dispositivo: Schema.String, texto: Schema.String }));

function referencias(ficha: FichaPacote): Omit<ReferenciaCriterio, "titulo" | "status_vigencia">[] {
  const lista = Array.isArray(ficha.referencias_normativas) ? ficha.referencias_normativas : [];
  return (lista as Record<string, unknown>[]).map((item) => ({
    ref: String(item.ref),
    dispositivo: typeof item.dispositivo === "string" ? item.dispositivo : null,
    papel: String(item.papel),
    nota: typeof item.nota === "string" ? item.nota : null,
  }));
}

/** Os critérios do filtro, em ordem de ID (por norma, na ordem dos arquivos). */
export const criteriosDoBanco = Effect.fn("pacoteRevisaoPpc.criterios")(function* (filtro: FiltroCriterios) {
  const campos = (["id", "topico", "norma"] as const).filter((c) => filtro[c] !== undefined);
  if (campos.length !== 1) {
    return yield* new CriteriosNaoEncontrados({ campo: "filtro", valor: campos.join(", ") || "nenhum" });
  }
  const campo = campos[0]!;
  const valor = filtro[campo]!.trim();
  const fontes = yield* FontesNormativas.FontesNormativas;

  const fichas = yield* linhasFichas("SELECT id, titulo, path, arquivo_json FROM revisao_ppc_fichas ORDER BY path");
  const topicosPorFicha = new Map<string, string[]>();
  for (const l of yield* linhasFichasTopicos(
    "SELECT ficha_id, topico_id FROM revisao_ppc_fichas_topicos ORDER BY ficha_id, topico_id",
  )) {
    topicosPorFicha.set(l.ficha_id, [...(topicosPorFicha.get(l.ficha_id) ?? []), l.topico_id]);
  }

  let titulo: string | null = null;
  let escolhidas: { linha: (typeof fichas)[number]; atingido?: CriterioAtingido }[];
  let topicosAtingidos: string[] | undefined;
  let arquivosDaTarefa: ArquivoDaTarefaAtingido[] | undefined;
  if (campo === "id") {
    const pedido = valor.replace(/^ficha:/i, "").toUpperCase();
    escolhidas = fichas.filter((f) => f.id.toUpperCase() === pedido).map((linha) => ({ linha }));
  } else if (campo === "topico") {
    const topico = fontes.topicosFichas.find((t) => t.id === valor);
    titulo = topico?.titulo ?? null;
    escolhidas = fichas
      .filter((f) => topicosPorFicha.get(f.id)?.includes(valor))
      .sort((a, b) => compararTexto(a.id, b.id))
      .map((linha) => ({ linha }));
  } else {
    const ato = valor.split("#")[0]!;
    const norma = fontes.registro.obter(ato);
    if (norma === undefined) return yield* new CriteriosNaoEncontrados({ campo, valor });
    titulo = norma.title;
    const dispositivos = yield* linhasDispositivos(
      "SELECT dispositivo, texto FROM dispositivos WHERE norma_id = ? ORDER BY ordem",
      [ato],
    );
    const outros = yield* linhasArquivos("SELECT path, arquivo_json FROM revisao_ppc_arquivos ORDER BY path");
    const { criterios, topicos, arquivos } = criteriosAtingidosEm({
      id: valor,
      vigencia: fontes,
      dataReferencia: fontes.dataReferencia,
      correspondencia: yield* carregarFonteCorrespondencia,
      dispositivos,
      // a taxonomia validada tem os campos que a regra lê (`id`, `termos_busca`, `fichas`) e outros
      topicos: fontes.topicosFichas as unknown as TopicoTaxonomia[],
      fichas: fichas.map((f) => ({ arquivo: f.path, texto: f.arquivo_json })),
      arquivos: outros.map((a) => ({ arquivo: a.path, texto: a.arquivo_json })),
    });
    const porId = new Map(fichas.map((f) => [f.id, f]));
    escolhidas = criterios.flatMap((atingido) => {
      const linha = porId.get(atingido.id);
      return linha === undefined ? [] : [{ linha, atingido }];
    });
    topicosAtingidos = topicos;
    arquivosDaTarefa = arquivos;
  }
  if (escolhidas.length === 0 && campo !== "norma") return yield* new CriteriosNaoEncontrados({ campo, valor });

  const normas = new Map<string, { titulo: string | null; status_vigencia: string | null }>();
  const criterios: Criterio[] = [];
  for (const { linha, atingido } of escolhidas) {
    const ficha = (yield* decodificarFicha(linha.arquivo_json).pipe(
      Effect.mapError((cause) => new Sql.FalhaNaConsulta({ consulta: `revisao_ppc_fichas ${linha.id}`, cause })),
    )) as FichaPacote;
    const refs: ReferenciaCriterio[] = [];
    for (const r of referencias(ficha)) {
      if (!normas.has(r.ref)) {
        const norma = r.ref.startsWith("cnct:") ? null : yield* obterNorma(r.ref);
        normas.set(r.ref, { titulo: norma?.titulo ?? null, status_vigencia: norma?.status_vigencia ?? null });
      }
      refs.push({ ...r, ...normas.get(r.ref)! });
    }
    criterios.push({
      id: linha.id,
      titulo: linha.titulo,
      path: linha.path,
      topicos: topicosPorFicha.get(linha.id) ?? [],
      referencias: refs,
      ficha,
      ...(atingido === undefined
        ? {}
        : {
            atingido: {
              motivos: atingido.motivos,
              dispositivos: atingido.dispositivos,
              ...(atingido.topicos ? { topicos: atingido.topicos } : {}),
            },
          }),
    });
  }
  const resultado: ResultadoCriterios = {
    filtro: { campo, valor },
    titulo,
    criterios,
    ...(topicosAtingidos === undefined ? {} : { topicos_atingidos: topicosAtingidos }),
    ...(arquivosDaTarefa === undefined ? {} : { arquivos_da_tarefa: arquivosDaTarefa }),
  };
  return resultado;
});
