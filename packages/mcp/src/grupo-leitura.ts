/**
 * `@simplifica-if/mcp/grupo-leitura`: as definições do grupo RPC de leitura (`effect/rpc`), sem a
 * implementação. Como o `packages/contracts` do T3, que separa os `Rpc` e os schemas dos handlers do
 * servidor: a interface do app importa daqui (pelo `@simplifica-if/contratos-app`) e não carrega o
 * `kb`, o `node:sqlite` nem o serviço `Leitura`. Os handlers ficam em `@simplifica-if/mcp/rpc`.
 *
 * Este módulo e o que ele importa (os schemas e o texto das ferramentas, os conteúdos dos recursos, o
 * `contratos.ts`) não podem importar o `kb` nem módulos do Node em tempo de execução; o teste
 * `grupo-leitura.test.ts` confere o grafo de imports.
 *
 * Cada operação tem a entrada e a resposta da ferramenta MCP de mesmo nome (um contrato só para as
 * duas). `lerLink` lê qualquer link `ifpr://` pela mesma resolução do `resources/read` e devolve um
 * `LinkLido`; `lerPpc`, `lerCnct`, `lerCampus` e `lerFicha` são os conteúdos que só existem como
 * recurso. `lerDocumento` traz o Markdown inteiro de uma norma ou de um PPC, com as âncoras, para o
 * leitor do app gerar o HTML (M1.6); não tem ferramenta MCP. `explorarIndice` e `explorarBuscar` são o
 * Explorar do app (as coleções e a paleta de busca, `explorar.ts`); também sem ferramenta MCP.
 */
import { Rpc, RpcGroup } from "effect/rpc";
import * as Schema from "effect/Schema";
import { ErroDeLeitura } from "./contratos.ts";
import { EntradaDocumento, SaidaDocumento } from "./documento.ts";
import { EntradaBusca, EntradaIndice, SaidaBusca, SaidaIndice } from "./explorar.ts";

export type { Ancora, DadosDocumento, DatasDoAto } from "./documento.ts";
export type * from "./explorar.ts";
export { ROTULOS_INDICADOR } from "./ferramentas/ficha-curso.ts";
import { buscarNorma } from "./ferramentas/buscar-norma.ts";
import { buscarSecoes } from "./ferramentas/buscar-secoes.ts";
import { fichaCurso } from "./ferramentas/ficha-curso.ts";
import { fichaNorma } from "./ferramentas/ficha-norma.ts";
import { lerDispositivos } from "./ferramentas/ler-dispositivos.ts";
import { lerSecao } from "./ferramentas/ler-secao.ts";
import { listarCursos } from "./ferramentas/listar-cursos.ts";
import { sobreABase } from "./ferramentas/sobre-a-base.ts";
import * as Conteudos from "./recursos/conteudos.ts";

/** Um link lido de um tipo de conteúdo: a `Resposta` com os dados dele e o texto do `resources/read`. */
const lido = <T extends string, S extends Schema.Top>(tipo: T, resposta: S) =>
  Schema.Struct({
    tipo: Schema.Literal(tipo),
    resposta,
    /** O texto Markdown do `resources/read`: avisos, corpo e rodapé da base. */
    texto: Schema.String,
  });

/**
 * O conteúdo de um link `ifpr://`, pelo tipo: `norma` (a ficha), `dispositivo` (norma com
 * `#dispositivo`), `curso`, `ppc` (o índice), `secao` (PPC com `#secao`), `cnct`, `campus` e `ficha`.
 * A `resposta` é a da ferramenta de mesmo conteúdo (`ficha_norma`, `ler_dispositivos`, `ficha_curso`,
 * `ler_secao`) ou da leitura própria do recurso.
 */
export const LinkLido = Schema.Union([
  lido("norma", fichaNorma.saida),
  lido("dispositivo", lerDispositivos.saida),
  lido("curso", fichaCurso.saida),
  lido("ppc", Conteudos.SaidaPpc),
  lido("secao", lerSecao.saida),
  lido("cnct", Conteudos.SaidaCnct),
  lido("campus", Conteudos.SaidaCampus),
  lido("ficha", Conteudos.SaidaFicha),
]);
export type LinkLido = typeof LinkLido.Type;

/** A entrada de `lerLink`. O link é texto livre: o malformado volta como `EntradaInvalida`, em português. */
export const EntradaLink = Schema.Struct({ link: Schema.String });

export class GrupoLeitura extends RpcGroup.make(
  Rpc.make("fichaNorma", { payload: fichaNorma.entrada, success: fichaNorma.saida, error: ErroDeLeitura }),
  Rpc.make("lerDispositivos", {
    payload: lerDispositivos.entrada,
    success: lerDispositivos.saida,
    error: ErroDeLeitura,
  }),
  Rpc.make("buscarNorma", { payload: buscarNorma.entrada, success: buscarNorma.saida, error: ErroDeLeitura }),
  Rpc.make("fichaCurso", { payload: fichaCurso.entrada, success: fichaCurso.saida, error: ErroDeLeitura }),
  Rpc.make("lerSecao", { payload: lerSecao.entrada, success: lerSecao.saida, error: ErroDeLeitura }),
  Rpc.make("buscarSecoes", { payload: buscarSecoes.entrada, success: buscarSecoes.saida, error: ErroDeLeitura }),
  Rpc.make("listarCursos", { payload: listarCursos.entrada, success: listarCursos.saida, error: ErroDeLeitura }),
  Rpc.make("sobreABase", { payload: sobreABase.entrada, success: sobreABase.saida, error: ErroDeLeitura }),
  Rpc.make("lerLink", { payload: EntradaLink, success: LinkLido, error: ErroDeLeitura }),
  Rpc.make("lerPpc", { payload: Conteudos.EntradaPpc, success: Conteudos.SaidaPpc, error: ErroDeLeitura }),
  Rpc.make("lerCnct", { payload: Conteudos.EntradaCnct, success: Conteudos.SaidaCnct, error: ErroDeLeitura }),
  Rpc.make("lerCampus", { payload: Conteudos.EntradaCampus, success: Conteudos.SaidaCampus, error: ErroDeLeitura }),
  Rpc.make("lerFicha", { payload: Conteudos.EntradaFicha, success: Conteudos.SaidaFicha, error: ErroDeLeitura }),
  Rpc.make("lerDocumento", { payload: EntradaDocumento, success: SaidaDocumento, error: ErroDeLeitura }),
  Rpc.make("explorarIndice", { payload: EntradaIndice, success: SaidaIndice, error: ErroDeLeitura }),
  Rpc.make("explorarBuscar", { payload: EntradaBusca, success: SaidaBusca, error: ErroDeLeitura }),
) {}
