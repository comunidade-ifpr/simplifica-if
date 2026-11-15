/**
 * Contrato entre o `Motor` e cada provider. Um driver sabe detectar o provider e abrir uma sessão;
 * a sessão envia mensagens, recebe respostas de aprovação e se interrompe. Encerrar é fechar o
 * `Scope` em que a sessão foi aberta: o processo do provider morre junto.
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";
import type { AprovacaoDesconhecida, Decisao, FalhaProvider, TurnoEmAndamento } from "./erros.ts";
import type { Evento, Provider } from "./eventos.ts";
import type { Politica } from "./politica.ts";

export * from "./erros.ts";

/** Servidor MCP por stdio: o provider abre o processo, só nesta sessão. */
export interface ServidorMcpStdio {
  readonly tipo: "stdio";
  readonly nome: string;
  readonly comando: string;
  readonly argumentos: ReadonlyArray<string>;
  readonly ambiente?: Readonly<Record<string, string>>;
  /** Ferramentas só de leitura: o provider as chama sem pedir aprovação. */
  readonly preAprovado: boolean;
}

/**
 * Uma chamada de ferramenta concluída, como o servidor MCP do app a viu: o nome sem o servidor
 * (`buscar_norma`), o começo do resultado e se ele é de erro.
 */
export interface ResultadoFerramenta {
  /** O nome da ferramenta, sem o servidor; numa leitura de recurso (`resources/read`), o URI lido. */
  readonly ferramenta: string;
  readonly resumo: string;
  readonly falhou: boolean;
}

/**
 * Servidor MCP por HTTP (streamable HTTP), já em execução: o provider só se conecta, só nesta sessão.
 * `cabecalhos` leva o escopo da sessão (`Authorization: Bearer <token>`).
 */
export interface ServidorMcpHttp {
  readonly tipo: "http";
  readonly nome: string;
  readonly url: string;
  readonly cabecalhos?: Readonly<Record<string, string>>;
  /** Ferramentas só de leitura: o provider as chama sem pedir aprovação. */
  readonly preAprovado: boolean;
  /**
   * As chamadas desta sessão ao servidor, na ordem em que terminam (no app, o `chamadas` do
   * `ServidorMcpHttp` de `@simplifica-if/mcp/http`, filtrado pelo rótulo da sessão). Com ele, o
   * `Motor` completa o `resumo` vazio de `FerramentaConcluida` das ferramentas deste servidor: o
   * `agy` não manda o resultado pelo ACP. Veja `resultados.ts`.
   */
  readonly resultados?: Stream.Stream<ResultadoFerramenta>;
}

/** Servidor MCP entregue ao provider só nesta sessão, por stdio ou por HTTP. */
export type ServidorMcp = ServidorMcpStdio | ServidorMcpHttp;

/** Um arquivo de uma skill: caminho relativo à pasta da skill e conteúdo em texto. */
export interface ArquivoSkill {
  readonly caminho: string;
  readonly conteudo: string;
}

/**
 * Uma skill do app, entregue pelo motor (o isolamento deixa de fora as skills do usuário). As
 * instruções e os arquivos vão para `<pasta de trabalho>/.simplifica/skills/<nome>/` (`SKILL.md` e
 * os `arquivos`), e as instruções da sessão listam a skill com o nome, a descrição e o caminho.
 */
export interface Skill {
  /** Só letras minúsculas, dígitos e hífen: vira nome de pasta. */
  readonly nome: string;
  /** Quando usar a skill; é o que o provider lê para decidir. */
  readonly descricao: string;
  /** O corpo do `SKILL.md`: o passo a passo que o provider segue ao usar a skill. */
  readonly instrucoes: string;
  readonly arquivos?: ReadonlyArray<ArquivoSkill>;
}

export interface ConfigSessao {
  readonly provider: Provider;
  readonly pastaTrabalho: string;
  readonly servidoresMcp: ReadonlyArray<ServidorMcp>;
  /** Modelo do provider; sem ele, o padrão da conta. */
  readonly modelo?: string;
  /**
   * Busca na web (padrão: desligada). Desligada, a resposta sai da base e do que o usuário anexa.
   * Só vale se a política permitir (`isolamento.buscaWeb: "a-pedido"`); a de fábrica desliga.
   */
  readonly buscaWeb?: boolean;
  /**
   * Retoma a conversa nativa do provider com este id (o `idNativo` de uma sessão anterior), em vez de
   * abrir uma nova: `resume` do Agent SDK (Claude), `thread/resume` (Codex), `session/load` do ACP
   * (Antigravity). Se o provider não retoma, o driver falha com `FalhaProvider` na operação `retomar`.
   */
  readonly retomar?: string;
  /** Instruções da sessão, somadas às do provider (system prompt, `developerInstructions`, `systemPrompt.append`). */
  readonly instrucoes?: string;
  /** Skills do app para esta sessão; o `Motor` grava os arquivos e as junta às `instrucoes`. */
  readonly skills?: ReadonlyArray<Skill>;
}

/** O que o driver detecta: instalado, versão e login. Nunca traz e-mail nem credencial. */
export interface DeteccaoProvider {
  readonly provider: Provider;
  readonly instalado: boolean;
  /** `gerenciada`: a cópia que o app instalou; `local`: a CLI que o usuário já tinha. */
  readonly origem?: "gerenciada" | "local";
  readonly versao?: string;
  readonly autenticado: boolean;
  /** Como está logado: `claude.ai`, `chatgpt`, `apiKey`, `oauth-personal`… */
  readonly metodo?: string;
  /** Plano da assinatura, quando o provider informa (`max`, `plus`, `pro`…). */
  readonly plano?: string;
  readonly mensagem?: string;
  /** Algo que impede o app de funcionar direito mesmo com login (ex.: MCP bloqueado pela organização). */
  readonly aviso?: string;
}

/**
 * Resultado de `Motor.detectar`: a detecção do driver e o que o app oferece para o provider, derivado
 * de o driver ter `instalar` e `entrar`. A interface só mostra "Instalar" e "Entrar" quando há.
 */
export interface EstadoProvider extends DeteccaoProvider {
  /** O app instala (ou atualiza) a CLI gerenciada do provider. */
  readonly podeInstalar: boolean;
  /** O app faz o login do provider. */
  readonly podeEntrar: boolean;
}

export interface SessaoDriver {
  /**
   * O id da conversa no próprio provider, que `ConfigSessao.retomar` aceita depois: o `session_id` do
   * Agent SDK, o `threadId` do Codex, o `sessionId` do ACP. Sem ele, a sessão não se retoma.
   */
  readonly idNativo?: string;
  /**
   * Termina quando o processo do provider acaba sozinho (queda), com o motivo, antes de o turno
   * corrente falhar com o mesmo erro; nunca termina quando a sessão se encerra pelo `Scope`. Depois
   * da queda, `enviar` falha com o mesmo erro.
   */
  readonly queda?: Effect.Effect<FalhaProvider>;
  /** Envia a mensagem e devolve os eventos do turno; o stream termina depois de `FimTurno`. */
  readonly enviar: (texto: string) => Stream.Stream<Evento, FalhaProvider | TurnoEmAndamento>;
  readonly responder: (idAprovacao: string, decisao: Decisao) => Effect.Effect<void, AprovacaoDesconhecida>;
  readonly interromper: Effect.Effect<void, FalhaProvider>;
}

/** Progresso da instalação gerenciada de uma CLI (a do T3: download, sha256, staging, versão ativa). */
export interface EstadoInstalacao {
  readonly provider: Provider;
  readonly fase: "parada" | "baixando" | "extraindo" | "verificando" | "concluida" | "falhou" | "cancelada";
  readonly baixados: number;
  readonly total?: number;
  /** A versão que a instalação oferece (a fixada pelo T3 ou uma mais nova). */
  readonly versao?: string;
  readonly versaoInstalada?: string;
  readonly executavel?: string;
  /** `local`: uma CLI suportada que o usuário já tinha; `gerenciada`: a cópia do app. */
  readonly origem?: "gerenciada" | "local";
  readonly mensagem?: string;
}

/** Progresso do login dentro do app. Em `aguardando`, `url` é a página que o app abre no navegador. */
export interface EstadoLogin {
  readonly provider: Provider;
  readonly fase: "parado" | "iniciando" | "aguardando" | "verificando" | "concluido" | "falhou" | "cancelado";
  readonly url?: string;
  readonly mensagem?: string;
}

export interface Driver {
  readonly detectar: Effect.Effect<DeteccaoProvider>;
  /** Abre a sessão; o `Motor` passa a política e as `instrucoes` já com as skills. */
  readonly iniciar: (
    config: ConfigSessao,
    politica: Politica,
  ) => Effect.Effect<SessaoDriver, FalhaProvider, Scope.Scope>;
  /** Instala (ou atualiza) a CLI gerenciada; o stream termina numa fase final. */
  readonly instalar?: Stream.Stream<EstadoInstalacao, FalhaProvider>;
  /** Login dentro do app; o stream termina numa fase final. */
  readonly entrar?: Stream.Stream<EstadoLogin, FalhaProvider>;
}

/** Os drivers disponíveis, por provider. `Drivers.layerNode` (em `drivers/index.ts`) monta os reais. */
export class Drivers extends Context.Service<Drivers, Readonly<Record<Provider, Driver>>>()(
  "@simplifica-if/motor/Driver/Drivers",
) {}

/** Gravação opcional das mensagens nativas (fixtures): recebe cada mensagem crua, na ordem. */
export const Gravador = Context.Reference<(direcao: "entrada" | "saida", mensagem: unknown) => void>(
  "@simplifica-if/motor/Driver/Gravador",
  { defaultValue: () => () => {} },
);
