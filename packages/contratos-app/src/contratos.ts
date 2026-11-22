/**
 * `@simplifica-if/contratos-app`: o contrato entre a interface do app e o servidor local
 * (`apps/server`), em Effect Schema, como o `packages/contracts` do T3. A interface, o servidor e o
 * desktop importam daqui; nada aqui depende do Node, e importar o pacote não carrega o `kb`, a leitura
 * do MCP nem os drivers do motor (`test/sem-servidor.test.ts` confere o grafo de imports).
 *
 * - `GrupoApp`: a API RPC (`effect/rpc`) por WebSocket. Dez grupos: providers, conversa, relato de erro (`relato.ts`), diagnóstico (`diagnostico.ts`), skills, pasta de trabalho, revisão de PPC, atualização, preferências (o primeiro uso, `preferencias.ts`) e leitura (o
 *   `GrupoLeitura` de `@simplifica-if/mcp/grupo-leitura`, só as definições, sem duplicar; os handlers
 *   ficam em `@simplifica-if/mcp/rpc`, que este pacote não importa). Os métodos de providers e de conversa
 *   têm nome com prefixo, como os `WS_METHODS` do T3: `cliente["conversa.enviar"]({ … })`.
 * - A partida do servidor e a autenticação do WebSocket (`EnvelopePartida`, `LinhaPartida`, ingresso):
 *   `partida.ts`.
 * - O que o desktop, o preload e a interface combinam sem Effect (caminhos HTTP, variável do token,
 *   extensões de documento, `PonteDesktop`, canais do IPC): `ponte.ts`, exportado à parte como
 *   `@simplifica-if/contratos-app/ponte`, sem nenhum import. Daqui saem só as constantes.
 *
 * Cada grupo fica no seu arquivo (`providers.ts`, `conversa.ts`, `relato.ts`, `diagnostico.ts`, `skills.ts`, `pasta.ts`,
 * `revisao-ppc.ts`, `atualizacao.ts`, `preferencias.ts`); este só os reúne no `GrupoApp`.
 */
import {
  type Ancora,
  type CampusDoIndice,
  type CnctDoIndice,
  type CursoDoIndice,
  type DadosBusca,
  type DadosDocumento,
  type DadosIndice,
  type DocumentoConselho,
  type FichaDoIndice,
  GrupoLeitura,
  type GrupoBusca,
  ROTULOS_INDICADOR,
  type ItemDePauta,
  type LinkLido,
  type NormaDoIndice,
  type PpcDoIndice,
  type ResultadoBusca,
  type ReuniaoDoIndice,
  type TipoResultado,
} from "@simplifica-if/mcp/grupo-leitura";
import {
  AprovacaoDesconhecida,
  Decisao,
  FalhaProvider,
  OperacaoNaoSuportada,
  SessaoDesconhecida,
  TurnoEmAndamento,
} from "@simplifica-if/motor/erros";
import {
  EstadoInstalacao,
  EstadoLogin,
  EstadoProvider,
  ModeloProvider,
  NivelEsforco,
} from "@simplifica-if/motor/estados-provider";
import { Evento, Provider } from "@simplifica-if/motor/eventos";
import { TipoFalha, TipoFalhaEstado } from "@simplifica-if/motor/falhas";
import { GrupoAtualizacao } from "./atualizacao.ts";
import { GrupoConversa } from "./conversa.ts";
import { GrupoDiagnostico } from "./diagnostico.ts";
import { GrupoPasta } from "./pasta.ts";
import { GrupoPreferencias } from "./preferencias.ts";
import { GrupoProviders } from "./providers.ts";
import { GrupoRelato } from "./relato.ts";
import { GrupoRevisaoPpc } from "./revisao-ppc.ts";
import { GrupoSkills } from "./skills.ts";

export { AprovacaoDesconhecida, Decisao, FalhaProvider, OperacaoNaoSuportada, SessaoDesconhecida, TurnoEmAndamento };
export { EstadoInstalacao, EstadoLogin, EstadoProvider, ModeloProvider, NivelEsforco };
export { TipoFalha, TipoFalhaEstado };
export { Evento, Provider };
export { GrupoLeitura, ROTULOS_INDICADOR };
export type { Ancora, DadosDocumento, LinkLido };
export type {
  CampusDoIndice,
  CnctDoIndice,
  CursoDoIndice,
  DadosBusca,
  DadosIndice,
  DocumentoConselho,
  FichaDoIndice,
  GrupoBusca,
  ItemDePauta,
  NormaDoIndice,
  PpcDoIndice,
  ResultadoBusca,
  ReuniaoDoIndice,
  TipoResultado,
};

export {
  CAMINHO_INGRESSO,
  CAMINHO_LIBERAR_ARQUIVO,
  CAMINHO_RPC,
  codigoDoErro,
  EXTENSOES_DOCUMENTO,
  ehExtensaoDocumento,
  SUFIXO_REVISAO_PREVIA,
  TAMANHO_MINIMO_TOKEN,
  VARIAVEL_TOKEN,
} from "./ponte.ts";
export * from "./atualizacao.ts";
export * from "./conversa.ts";
export * from "./diagnostico.ts";
export * from "./partida.ts";
export * from "./pasta.ts";
export * from "./preferencias.ts";
export * from "./providers.ts";
export * from "./relato.ts";
export * from "./revisao-ppc.ts";
export * from "./skills.ts";

/** A API inteira do servidor local: providers, conversa, relato, diagnóstico, skills, pasta, revisão de PPC, atualização, leitura e preferências. */
export class GrupoApp extends GrupoProviders.merge(
  GrupoConversa,
  GrupoRelato,
  GrupoDiagnostico,
  GrupoPreferencias,
  GrupoSkills,
  GrupoPasta,
  GrupoRevisaoPpc,
  GrupoAtualizacao,
  GrupoLeitura,
) {}
