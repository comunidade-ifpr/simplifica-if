/**
 * O texto dos erros que chegam à interface. Os erros tipados do servidor já trazem `message` em
 * português; os do transporte (`RpcClientError`) e os defeitos ganham uma frase própria.
 *
 * O `detalhe` de uma `FalhaProvider` (e a mensagem do evento `Erro` de um turno) vem muitas vezes da
 * CLI do provider, em inglês. As falhas conhecidas (sem login, CLI ausente, MCP que não subiu, modelo
 * fora da conta, tempo esgotado) viram uma frase em português pela `operacao`, pelo provider e por
 * padrões do detalhe; o texto original fica em `detalhe`, que a interface mostra recolhido em
 * "Detalhes técnicos". É o mínimo do M1.14, que prevê a tradução por tipo de erro no cliente.
 */
import { DESCRICOES } from "../providers.ts";

/** Uma frase para a pessoa e, quando há, o texto técnico original. */
export interface MensagemErro {
  readonly texto: string;
  readonly detalhe?: string;
}

function comMaiuscula(texto: string): string {
  return texto.length === 0 ? texto : `${texto[0]!.toUpperCase()}${texto.slice(1)}`;
}

function comPonto(texto: string): string {
  return /[.!?…]$/.test(texto) ? texto : `${texto}.`;
}

function nomeProvider(provider: string): string {
  return provider in DESCRICOES ? DESCRICOES[provider as keyof typeof DESCRICOES].nome : provider;
}

/** Os tipos de falha de provider que a interface explica. */
export type TipoFalha = "semLogin" | "cliAusente" | "mcp" | "modelo" | "tempo";

/**
 * Os padrões de cada tipo, na ordem em que se conferem: o MCP e o modelo antes do login e da CLI
 * ausente, porque "MCP server not found" e "model not found" não são CLI ausente.
 */
const PADROES: ReadonlyArray<readonly [TipoFalha, RegExp]> = [
  ["mcp", /\bmcp\b|mcpCapabilities|ponte stdio/i],
  [
    "modelo",
    /\bmodel(o)?\b[^\n]*\b(not supported|unsupported|not available|not found|does not exist|no access|n[ãa]o (é )?suportado|indispon[ií]vel)|(unsupported|unknown|invalid) model|access to (the )?model/i,
  ],
  [
    "semLogin",
    /not (logged|signed) in|\/login\b|log ?in required|please (log|sign) ?in|unauthori[sz]ed|\b401\b|invalid api key|authentication (failed|required|error)|not authenticated|sem login|credentials?/i,
  ],
  ["tempo", /timed? ?out|timeout|ETIMEDOUT|deadline exceeded|tempo esgotado|esgotou o tempo/i],
  [
    "cliAusente",
    /ENOENT|command not found|no such file|executable not found|ausente|n[ãa]o (está )?instalad|not installed/i,
  ],
];

/** O tipo de uma falha de provider, pela operação e pelos padrões do detalhe; `undefined` se não conhece. */
export function tipoFalha(operacao: string, detalhe: string): TipoFalha | undefined {
  if (/^(login|entrar)$/i.test(operacao)) return "semLogin";
  return PADROES.find(([, padrao]) => padrao.test(detalhe))?.[0];
}

const OPERACOES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^instalar$/i, "instalar"],
  [/^(entrar|login)$/i, "entrar na conta"],
  [/^(detectar|conta)$/i, "detectar a instalação"],
  [/interromp|cancel|interrupt/i, "interromper a resposta"],
  [/prompt|turn\/start|ler mensagens|encerrou/i, "responder"],
  [/iniciar|abrir|preparar|initiali[sz]e|session\/new|thread\/start/i, "abrir a conversa"],
];

function textoOperacao(operacao: string): string {
  return OPERACOES.find(([padrao]) => padrao.test(operacao))?.[1] ?? "concluir o pedido";
}

function frase(tipo: TipoFalha | undefined, nome: string, operacao: string): string {
  switch (tipo) {
    case "semLogin":
      return `O ${nome} está sem login. Entre na conta pela tela Início e tente de novo.`;
    case "cliAusente":
      return `O ${nome} não está instalado neste computador. Instale-o pela tela Início e tente de novo.`;
    case "mcp":
      return `A base do IFPR (o servidor MCP) não ficou disponível para o ${nome}. Comece uma nova conversa; se o erro continuar, reinicie o app.`;
    case "modelo":
      return `O modelo pedido não está disponível na sua conta do ${nome}. Use o modelo padrão da conta ou escolha outro.`;
    case "tempo":
      return `O ${nome} demorou demais para responder. Tente de novo em instantes.`;
    case undefined:
      return `O ${nome} não conseguiu ${textoOperacao(operacao)}. Tente de novo; se o erro continuar, veja os detalhes técnicos.`;
  }
}

/** Uma `FalhaProvider` (ou os campos dela) em português, com o texto original em `detalhe`. */
export function explicarFalhaProvider(falha: {
  readonly provider: string;
  readonly operacao: string;
  readonly detalhe: string;
}): MensagemErro {
  return {
    texto: frase(tipoFalha(falha.operacao, falha.detalhe), nomeProvider(falha.provider), falha.operacao),
    detalhe: `${falha.provider}: falha em ${falha.operacao}: ${falha.detalhe}`,
  };
}

/**
 * A mensagem do evento `Erro` de um turno, em português quando é uma falha conhecida. Sem padrão
 * conhecido, a própria mensagem, que pode ser do app (já em português) ou da CLI.
 */
export function explicarErroDoTurno(provider: string, mensagem: string): MensagemErro {
  const tipo = tipoFalha("", mensagem);
  if (tipo === undefined) return { texto: comPonto(comMaiuscula(mensagem)) };
  return { texto: frase(tipo, nomeProvider(provider), ""), detalhe: mensagem };
}

/** O erro que chegou de uma chamada ao servidor, em português. */
export function explicarErro(erro: unknown): MensagemErro {
  if (typeof erro === "object" && erro !== null) {
    const registro = erro as {
      readonly _tag?: unknown;
      readonly message?: unknown;
      readonly provider?: unknown;
      readonly operacao?: unknown;
      readonly detalhe?: unknown;
    };
    if (registro._tag === "RpcClientError") return { texto: "A conexão com o servidor local caiu durante o pedido." };
    if (
      registro._tag === "FalhaProvider" &&
      typeof registro.provider === "string" &&
      typeof registro.operacao === "string" &&
      typeof registro.detalhe === "string"
    ) {
      return explicarFalhaProvider({
        provider: registro.provider,
        operacao: registro.operacao,
        detalhe: registro.detalhe,
      });
    }
    if (registro._tag === "OperacaoNaoSuportada" && typeof registro.provider === "string") {
      const nome = nomeProvider(registro.provider);
      return {
        texto:
          registro.operacao === "login"
            ? `O app ainda não faz o login do ${nome}. Siga a orientação da tela Início.`
            : `O app ainda não instala o ${nome}. Siga a orientação da tela Início.`,
      };
    }
    if (typeof registro._tag === "string" && typeof registro.message === "string" && registro.message.length > 0) {
      return { texto: comPonto(comMaiuscula(registro.message)) };
    }
    if (erro instanceof Error && erro.message.length > 0) {
      return { texto: "Algo deu errado no app. Tente de novo.", detalhe: erro.message };
    }
  }
  return { texto: "Algo deu errado no app. Tente de novo." };
}

/** Só a frase para a pessoa. */
export function mensagemDeErro(erro: unknown): string {
  return explicarErro(erro).texto;
}
