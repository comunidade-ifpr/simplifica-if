/**
 * `Leitura`: a leitura da base do IFPR que as ferramentas MCP e o grupo RPC compartilham. Um método
 * por ferramenta, cada um com a entrada já decodificada e a `Resposta` pronta (envelope, avisos,
 * paginação e orçamento); a ferramenta MCP só acrescenta o texto Markdown para a IA, e o RPC devolve
 * a resposta como está.
 *
 * A layer depende dos serviços de consulta do kb (`layerSomenteLeitura`, sem `FileSystem`) e do canal
 * da linha de comando, que entra no envelope quando o banco não registra um. A `PastaTrabalho`, de
 * onde o `pacote_contexto` lê um `.md`, é opcional: sem ela, o `arquivo` é recusado. As falhas do banco
 * (`FalhaNaConsulta`) chegam aos métodos como `FalhaNaBase`.
 */
import * as BaseKb from "@simplifica-if/kb/BaseKb";
import * as Cursos from "@simplifica-if/kb/Cursos";
import type * as Sql from "@simplifica-if/kb/db/sql";
import * as Ppcs from "@simplifica-if/kb/Ppcs";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { Canal } from "@simplifica-if/kb/canal";
import { type Base, type ErroDeLeitura, FalhaNaBase, type Resposta } from "../contratos.ts";
import { montarBase, responder } from "../envelope.ts";
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
import type * as PacoteContextoF from "../ferramentas/pacote-contexto.ts";
import type * as ResolverCitacoes from "../ferramentas/resolver-citacoes.ts";
import type * as SobreABase from "../ferramentas/sobre-a-base.ts";
import { linkCampus } from "../links.ts";
import type * as Documento from "../documento.ts";
import type * as Explorar from "../explorar.ts";
import { makeDocumentos } from "./documentos.ts";
import { makeExplorar } from "./explorar.ts";
import { makeNormas } from "./normas.ts";
import { makePacote } from "./pacote.ts";
import { makePpcs } from "./ppcs.ts";
import { type CampusRecurso, makeRecursos } from "./recursos.ts";
import type * as Conteudos from "../recursos/conteudos.ts";

/** Uma leitura: a entrada decodificada de uma ferramenta e a resposta com os dados dela. */
type Metodo<E extends { readonly Type: unknown }, D extends { readonly Type: unknown }> = (
  entrada: E["Type"],
) => Effect.Effect<Resposta<D["Type"]>, ErroDeLeitura>;

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
    readonly pacoteContexto: Metodo<typeof PacoteContextoF.Entrada, typeof PacoteContextoF.Dados>;
    readonly sobreABase: Metodo<typeof SobreABase.Entrada, typeof SobreABase.Dados>;
    readonly etapa: Metodo<typeof Etapa.Entrada, typeof Etapa.Dados>;
    /** Recursos `ifpr://` sem ferramenta própria (M1.5): PPC sem seção, CNCT, campus e ficha. */
    readonly lerPpc: Metodo<typeof Conteudos.EntradaPpc, typeof Conteudos.DadosPpc>;
    readonly lerCnct: Metodo<typeof Conteudos.EntradaCnct, typeof Conteudos.DadosCnct>;
    readonly lerCampus: Metodo<typeof Conteudos.EntradaCampus, typeof Conteudos.DadosCampus>;
    readonly lerFicha: Metodo<typeof Conteudos.EntradaFicha, typeof Conteudos.DadosFicha>;
    /** O Markdown inteiro de uma norma ou de um PPC, com as âncoras, para o leitor do app (M1.6). */
    readonly lerDocumento: Metodo<typeof Documento.EntradaDocumento, typeof Documento.DadosDocumento>;
    /** O Explorar do app: as coleções inteiras e a busca da paleta (sem ferramenta MCP). */
    readonly explorarIndice: Metodo<typeof Explorar.EntradaIndice, typeof Explorar.DadosIndice>;
    readonly explorarBuscar: Metodo<typeof Explorar.EntradaBusca, typeof Explorar.DadosBusca>;
  }
>()("@simplifica-if/mcp/leitura/Leitura") {}

/** O que um método de leitura pode falhar antes da tradução: as falhas de leitura e as do kb. */
type FalhaDoMetodo = ErroDeLeitura | Sql.FalhaNaConsulta;

/** As falhas do kb viram `FalhaNaBase`; os erros de leitura passam como estão. */
const naBase = <A>(efeito: Effect.Effect<A, FalhaDoMetodo>): Effect.Effect<A, ErroDeLeitura> =>
  efeito.pipe(
    Effect.catchTags({
      FalhaNaConsulta: (cause) => Effect.fail(new FalhaNaBase({ operacao: "consulta ao kb.sqlite", cause })),
    }),
  );

/** Um método de leitura com as falhas do banco traduzidas por `naBase`. */
const comFalhaNaBase =
  <E, A>(metodo: (entrada: E) => Effect.Effect<A, FalhaDoMetodo>) =>
  (entrada: E) =>
    naBase(metodo(entrada));

/** Opções do `Leitura`. */
export interface Opcoes {
  /** O canal da linha de comando, que entra no envelope quando o banco não registra um. */
  readonly canal: Canal;
  /**
   * A ferramenta `etapa` registra a etapa (`registrado: true`): no app, a interface a lê nos eventos
   * da conversa. Fora dele (padrão), ela só responde que não registrou.
   */
  readonly etapaRegistrada?: boolean;
}

const make = Effect.fn("Leitura.make")(function* (opcoes: Opcoes) {
  const { meta } = yield* BaseKb.BaseKb;
  const cursosKb = yield* Cursos.Cursos;
  const ppcsKb = yield* Ppcs.Ppcs;
  const base = montarBase(meta, opcoes.canal);

  // `sobre_a_base`: o conteúdo do banco não muda com o servidor no ar
  const niveis = yield* cursosKb.niveis;
  const campiDaBase = yield* cursosKb.campi;
  const campi = campiDaBase.map((c) => ({ id: c.campus_id, nome: c.nome, link: linkCampus(c.campus_id) }));
  const campiPorId = new Map<string, CampusRecurso>(
    campiDaBase.map((c) => [c.campus_id, { id: c.campus_id, nome: c.nome, site: c.site, path: c.path }]),
  );
  const tiposDeSecao = yield* ppcsKb.tiposDeSecao;

  const normas = yield* makeNormas(base);
  const ppcs = yield* makePpcs(base);
  const pacote = yield* makePacote(base);
  const recursos = yield* makeRecursos(base, campiPorId);
  const documentos = yield* makeDocumentos(base);
  const explorar = yield* makeExplorar(base);

  const sobreABase = responder(base, { contagens: meta.contagens, tipos_de_secao: tiposDeSecao, niveis, campi });
  const etapa = responder(base, { registrado: opcoes.etapaRegistrada ?? false });

  return Leitura.of({
    base,
    buscarNorma: comFalhaNaBase(normas.buscarNorma),
    lerDispositivos: comFalhaNaBase(normas.lerDispositivos),
    fichaNorma: comFalhaNaBase(normas.fichaNorma),
    correspondencia: comFalhaNaBase(normas.correspondencia),
    resolverCitacoes: comFalhaNaBase(normas.resolverCitacoes),
    citacoesDaNorma: comFalhaNaBase(ppcs.citacoesDaNorma),
    impactoDaNorma: comFalhaNaBase(ppcs.impactoDaNorma),
    adequacaoArt71: comFalhaNaBase(ppcs.adequacaoArt71),
    buscarSecoes: comFalhaNaBase(ppcs.buscarSecoes),
    lerSecao: comFalhaNaBase(ppcs.lerSecao),
    listarCursos: comFalhaNaBase(ppcs.listarCursos),
    fichaCurso: comFalhaNaBase(ppcs.fichaCurso),
    fatosPpc: comFalhaNaBase(ppcs.fatosPpc),
    pacoteContexto: comFalhaNaBase(pacote.pacoteContexto),
    lerPpc: comFalhaNaBase(recursos.lerPpc),
    lerCnct: comFalhaNaBase(recursos.lerCnct),
    lerCampus: comFalhaNaBase(recursos.lerCampus),
    lerFicha: comFalhaNaBase(recursos.lerFicha),
    lerDocumento: comFalhaNaBase(documentos.lerDocumento),
    explorarIndice: comFalhaNaBase(explorar.explorarIndice),
    explorarBuscar: comFalhaNaBase(explorar.explorarBuscar),
    // respostas fixas, montadas uma vez: o banco não muda com o servidor no ar
    sobreABase: Effect.fn("Leitura.sobreABase")(() => Effect.succeed(sobreABase)),
    etapa: Effect.fn("Leitura.etapa")(() => Effect.succeed(etapa)),
  });
});

/** `Leitura` sobre os serviços de consulta do kb do ambiente. */
export const layer = (opcoes: Opcoes) => Layer.effect(Leitura, make(opcoes));
