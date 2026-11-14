/**
 * `Leitura`: a leitura da base do IFPR que as ferramentas MCP e o grupo RPC compartilham. Um método
 * por ferramenta, cada um com a entrada já decodificada e a `Resposta` pronta (envelope, avisos,
 * paginação e orçamento); a ferramenta MCP só acrescenta o texto Markdown para a IA, e o RPC devolve
 * a resposta como está.
 *
 * A layer depende dos serviços de consulta do kb (`layerSomenteLeitura`, sem `FileSystem`) e do canal
 * da linha de comando, que entra no envelope quando o banco não registra um. As falhas do banco
 * (`FalhaNaConsulta`, `FalhaNasFontes`) chegam aos métodos como `FalhaNaBase`.
 */
import * as BaseKb from "@simplifica-if/kb/BaseKb";
import * as Sql from "@simplifica-if/kb/db/sql";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  type Base,
  CANAIS,
  type Canal,
  type ErroDeLeitura,
  FalhaNaBase,
  type Resposta,
} from "../contratos.ts";
import { type MetaEnvelope, montarBase, responder } from "../envelope.ts";
import type * as AdequacaoArt71 from "../ferramentas/adequacao-art71.ts";
import type * as BuscarNorma from "../ferramentas/buscar-norma.ts";
import type * as BuscarSecoes from "../ferramentas/buscar-secoes.ts";
import type * as CitacoesDaNorma from "../ferramentas/citacoes-da-norma.ts";
import type * as Correspondencia from "../ferramentas/correspondencia.ts";
import type * as Etapa from "../ferramentas/etapa.ts";
import type * as FatosPpc from "../ferramentas/fatos-ppc.ts";
import type * as FichaCurso from "../ferramentas/ficha-curso.ts";
import type * as FichaNorma from "../ferramentas/ficha-norma.ts";
import type * as ImpactoDaNorma from "../ferramentas/impacto-da-norma.ts";
import type * as LerDispositivos from "../ferramentas/ler-dispositivos.ts";
import type * as LerSecao from "../ferramentas/ler-secao.ts";
import type * as ListarCursos from "../ferramentas/listar-cursos.ts";
import type * as ResolverCitacoes from "../ferramentas/resolver-citacoes.ts";
import type * as SobreABase from "../ferramentas/sobre-a-base.ts";
import { linkCampus } from "../links.ts";
import { makeNormas } from "./normas.ts";
import { makePpcs } from "./ppcs.ts";

/** Uma leitura: a entrada decodificada de uma ferramenta e a resposta com os dados dela. */
type Metodo<E extends { readonly Type: unknown }, D extends { readonly Type: unknown }> = (
  entrada: E["Type"],
) => Effect.Effect<Resposta<D["Type"]>, ErroDeLeitura>;

/** O canal registrado no banco não é um dos do simplifica-mcp. */
export class CanalDesconhecido extends Schema.TaggedError<CanalDesconhecido>()("CanalDesconhecido", {
  canal: Schema.String,
}) {
  override get message(): string {
    return `canal da base desconhecido: ${this.canal} (esperado: ${CANAIS.join(", ")})`;
  }
}

export const ehCanalDesconhecido = Schema.is(CanalDesconhecido);

export class Leitura extends Context.Service<
  Leitura,
  {
    /** O envelope `base` das respostas (versão, commit, data de referência e canal). */
    readonly base: Base;
    readonly buscarNorma: Metodo<typeof BuscarNorma.Entrada, typeof BuscarNorma.Dados>;
    readonly lerDispositivos: Metodo<typeof LerDispositivos.Entrada, typeof LerDispositivos.Dados>;
    readonly fichaNorma: Metodo<typeof FichaNorma.Entrada, typeof FichaNorma.Dados>;
    readonly correspondencia: Metodo<typeof Correspondencia.Entrada, typeof Correspondencia.Dados>;
    readonly resolverCitacoes: Metodo<typeof ResolverCitacoes.Entrada, typeof ResolverCitacoes.Dados>;
    readonly citacoesDaNorma: Metodo<typeof CitacoesDaNorma.Entrada, typeof CitacoesDaNorma.Dados>;
    readonly impactoDaNorma: Metodo<typeof ImpactoDaNorma.Entrada, typeof ImpactoDaNorma.Dados>;
    readonly adequacaoArt71: Metodo<typeof AdequacaoArt71.Entrada, typeof AdequacaoArt71.Dados>;
    readonly buscarSecoes: Metodo<typeof BuscarSecoes.Entrada, typeof BuscarSecoes.Dados>;
    readonly lerSecao: Metodo<typeof LerSecao.Entrada, typeof LerSecao.Dados>;
    readonly listarCursos: Metodo<typeof ListarCursos.Entrada, typeof ListarCursos.Dados>;
    readonly fichaCurso: Metodo<typeof FichaCurso.Entrada, typeof FichaCurso.Dados>;
    readonly fatosPpc: Metodo<typeof FatosPpc.Entrada, typeof FatosPpc.Dados>;
    readonly sobreABase: Metodo<typeof SobreABase.Entrada, typeof SobreABase.Dados>;
    readonly etapa: Metodo<typeof Etapa.Entrada, typeof Etapa.Dados>;
  }
>()("@simplifica-if/mcp/leitura/Leitura") {}

const linhasNivel = Sql.todas(Schema.Struct({ nivel: Schema.String }));
const linhasCampus = Sql.todas(Schema.Struct({ campus_id: Schema.String, nome: Schema.String }));
const linhasTipo = Sql.todas(Schema.Struct({ tipo: Schema.String }));

const ehCanal = Schema.is(Schema.Literals(CANAIS));

/** As falhas do banco viram `FalhaNaBase`; a entrada inválida passa como está. */
function naBase<A, E extends { readonly _tag: string }>(
  efeito: Effect.Effect<A, E>,
): Effect.Effect<A, Exclude<E, { readonly _tag: "FalhaNaConsulta" | "FalhaNasFontes" }> | FalhaNaBase> {
  return Effect.mapError(efeito, (erro) =>
    erro._tag === "FalhaNaConsulta" || erro._tag === "FalhaNasFontes"
      ? new FalhaNaBase({ operacao: erro._tag === "FalhaNaConsulta" ? "consulta ao kb.sqlite" : "fontes normativas", cause: erro })
      : (erro as Exclude<E, { readonly _tag: "FalhaNaConsulta" | "FalhaNasFontes" }>),
  );
}

const comFalhaNaBase = <F extends Record<string, (entrada: never) => Effect.Effect<unknown, { readonly _tag: string }>>>(
  metodos: F,
) =>
  Object.fromEntries(
    Object.entries(metodos).map(([nome, metodo]) => [nome, (entrada: never) => naBase(metodo(entrada))]),
  ) as unknown as {
    readonly [K in keyof F]: (
      entrada: Parameters<F[K]>[0],
    ) => Effect.Effect<Effect.Success<ReturnType<F[K]>>, ErroDeLeitura>;
  };

const make = Effect.fn("Leitura.make")(function* (opcoes: { readonly canal: Canal }) {
  const { meta } = yield* BaseKb.BaseKb;
  if (meta.canal !== null && !ehCanal(meta.canal)) return yield* new CanalDesconhecido({ canal: meta.canal });
  const metaEnvelope: MetaEnvelope = { ...meta, canal: meta.canal };
  const base = montarBase(metaEnvelope, opcoes.canal);

  // `sobre_a_base`: o conteúdo do banco não muda com o servidor no ar
  const niveis = (yield* linhasNivel(
    "SELECT nivel FROM ppcs UNION SELECT nivel FROM cursos WHERE nivel IS NOT NULL ORDER BY nivel",
  )).map((n) => n.nivel);
  const campi = (yield* linhasCampus("SELECT campus_id, nome FROM campi ORDER BY campus_id")).map((c) => ({
    id: c.campus_id,
    nome: c.nome,
    link: linkCampus(c.campus_id),
  }));
  const tiposDeSecao = (yield* linhasTipo("SELECT DISTINCT tipo FROM secoes ORDER BY tipo")).map((t) => t.tipo);

  const normas = yield* makeNormas(base);
  const ppcs = yield* makePpcs(base);

  return Leitura.of({
    base,
    ...comFalhaNaBase({ ...normas, ...ppcs }),
    sobreABase: Effect.fn("Leitura.sobreABase")(function* () {
      return responder(base, { contagens: meta.contagens, tipos_de_secao: tiposDeSecao, niveis, campi });
    }),
    etapa: Effect.fn("Leitura.etapa")(function* () {
      return responder(base, { registrado: false });
    }),
  });
});

/** `Leitura` sobre os serviços de consulta do kb do ambiente. */
export const layer = (opcoes: { readonly canal: Canal }) => Layer.effect(Leitura, make(opcoes));
