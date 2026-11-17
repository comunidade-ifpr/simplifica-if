/**
 * O texto dos erros que chegam à interface (M1.14). Os erros tipados do servidor já trazem `message` em
 * português; os do transporte (`RpcClientError`), os do motor (`TurnoEmAndamento`…) e os defeitos
 * ganham uma frase própria.
 *
 * O `detalhe` de uma `FalhaProvider` e a mensagem do evento `Erro` de um turno vêm da CLI do provider
 * (Claude, Codex, Antigravity), quase sempre em inglês. Eles viram uma frase em português pelo tipo da
 * falha (`tipoFalha`: sem login, cota, rede ou proxy, CLI ausente, versão antiga, recusa pelas regras
 * de uso, tempo esgotado, serviço fora do ar…), com o que a pessoa pode fazer; o texto original fica
 * em `detalhe`, que a interface mostra recolhido em "Detalhes técnicos". A tradução fica no cliente
 * porque o histórico gravado guarda o texto original, e uma frase melhor vale também para conversas
 * antigas. */
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

/**
 * Os tipos de falha de provider que a interface explica (M1.14): sem login, cota ou limite de uso,
 * rede ou proxy, CLI ausente, versão antiga, recusa pelas regras de uso, tempo esgotado, serviço fora
 * do ar, a base que não ficou disponível, modelo fora da conta, queda do processo e o limite de passos
 * do app. O resto é "desconhecido" (`undefined`).
 */
export type TipoFalha =
  | "semLogin"
  | "cota"
  | "rede"
  | "cliAusente"
  | "versao"
  | "politica"
  | "tempo"
  | "indisponivel"
  | "mcp"
  | "modelo"
  | "queda"
  | "limiteApp";

/**
 * Os padrões de cada tipo, na ordem em que se conferem. Os textos vêm das CLIs e dos SDKs (em
 * `node_modules`): o `SDKAssistantMessageError` e os `subtype` de erro do `result` do Claude Agent
 * SDK, as mensagens do app-server do Codex (o `codexErrorInfo` não chega ao motor, só a mensagem) e
 * as do agy por ACP. A ordem importa:
 *
 * - a queda e o limite de passos do app primeiro, porque trazem palavras dos outros tipos;
 * - a recusa pelas regras de uso antes da cota ("usage policy" não é "usage limit");
 * - o MCP e o modelo antes do login e da CLI ausente ("MCP server not found" e "model not found" não
 *   são CLI ausente);
 * - a CLI ausente antes da versão antiga ("não instalado (ou versão sem suporte)" é instalar);
 * - o tempo esgotado antes da rede ("connect ETIMEDOUT" é tempo).
 */
const PADROES: ReadonlyArray<readonly [TipoFalha, RegExp]> = [
  // O processo do provider morreu (o servidor reabre a sessão pela retomada na próxima mensagem).
  ["queda", /terminated by signal|process (exited|terminated)|processo d[oa] .* encerrou|app-server encerrou/i],
  // O Claude Agent SDK encerra o turno com `error_max_turns` ou `error_max_budget_usd`.
  ["limiteApp", /error_max_(turns|budget_usd|structured_output_retries)|max(imum)? turns/i],
  [
    "politica",
    /usage polic|content polic|violat\w* (our |the )?(usage |content )?polic|flagged|invalid_prompt|cyber_policy|\bsafety\b|blocked (by|due to) (policy|safety)|recitation/i,
  ],
  [
    "cota",
    /usage limit|rate[ _-]?limit|\b429\b|too many requests|quota|billing|credit balance|insufficient[ _]?(credits|funds|quota)|out of credits|limite de uso|resource[ _]exhausted|hit your (usage )?limit/i,
  ],
  ["mcp", /\bmcp\b|mcpCapabilities|ponte stdio/i],
  [
    "modelo",
    /model_not_found|\bmodel(o)?\b[^\n]*\b(not supported|unsupported|not available|not found|does not exist|no access|n[ãa]o (é )?suportado|indispon[ií]vel)|(unsupported|unknown|invalid) model|access to (the )?model/i,
  ],
  [
    "semLogin",
    /authentication_failed|not (logged|signed) in|\/login\b|log ?in required|please (log|sign) ?in|unauthori[sz]ed|\b401\b|invalid api key|authentication (failed|required|error)|not authenticated|sem login|credentials?|token (has )?expired|oauth/i,
  ],
  [
    "cliAusente",
    /ENOENT|command not found|no such file|executable not found|ausente|n[ãa]o (está )?instalad|n[ãa]o encontrad|not installed/i,
  ],
  [
    "versao",
    /vers[ãa]o (antiga|sem suporte|m[ií]nima)|unsupported (cli |client )?version|version .*(too old|not supported|unsupported)|too old|(please |must )?(update|upgrade) (to|your|the)|requires? (a )?(newer|version)|n[ãa]o anuncia/i,
  ],
  ["tempo", /timed? ?out|timeout|ETIMEDOUT|deadline exceeded|tempo esgotado|esgotou o tempo/i],
  [
    "rede",
    /ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|getaddrinfo|socket hang up|fetch failed|network|proxy|certificate|\bCERT_|SELF_SIGNED|connection (error|refused|reset|failed|closed)|stream disconnected|error sending request|could not (connect|resolve)|unable to connect|offline|sem conex[ãa]o/i,
  ],
  [
    "indisponivel",
    /overloaded|server_error|internal server error|service unavailable|bad gateway|\b(500|502|503|504|529)\b|unavailable/i,
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
  [/prompt|turn\/start|ler mensagens|encerrou|responder/i, "responder"],
  [/iniciar|abrir|preparar|initiali[sz]e|session\/new|thread\/start|sess[ãa]o/i, "abrir a conversa"],
];

function textoOperacao(operacao: string): string {
  return OPERACOES.find(([padrao]) => padrao.test(operacao))?.[1] ?? "concluir o pedido";
}

/** Onde a pessoa instala a IA e entra na conta. */
const SUA_IA = "Configurações › Sua IA";

function frase(tipo: TipoFalha | undefined, nome: string, operacao: string): string {
  switch (tipo) {
    case "semLogin":
      return `O ${nome} está sem login. Entre na conta em ${SUA_IA} e tente de novo.`;
    case "cota":
      return `Sua conta do ${nome} chegou ao limite de uso. Espere o limite renovar ou escolha outra IA para esta conversa.`;
    case "rede":
      return `O ${nome} não conseguiu se conectar à internet. Confira a conexão. Na rede do campus, um proxy ou firewall pode bloquear o acesso: fale com a TI do campus.`;
    case "cliAusente":
      return `O ${nome} não está instalado neste computador. Instale-o em ${SUA_IA} e tente de novo.`;
    case "versao":
      return `A versão do ${nome} neste computador é antiga demais para o app. Instale a versão nova em ${SUA_IA} e tente de novo.`;
    case "politica":
      return `O ${nome} recusou o pedido pelas regras de uso dele. Reescreva o pedido com outras palavras e tente de novo.`;
    case "tempo":
      return `O ${nome} demorou demais para responder. Tente de novo em instantes.`;
    case "indisponivel":
      return `O serviço do ${nome} está sobrecarregado ou fora do ar. Tente de novo em alguns minutos.`;
    case "mcp":
      return `A base do IFPR não ficou disponível para o ${nome}. Comece uma nova conversa; se o erro continuar, reinicie o app.`;
    case "modelo":
      return `O modelo pedido não está disponível na sua conta do ${nome}. Use o modelo padrão da conta ou escolha outro.`;
    case "queda":
      return `O ${nome} parou de funcionar no meio da resposta. Envie a mensagem de novo: a conversa continua de onde parou.`;
    case "limiteApp":
      return `A resposta passou do limite de passos que o app permite. Divida o pedido em partes menores e envie de novo.`;
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
 * A mensagem do evento `Erro` de um turno, por tipo. A mensagem vem sempre da CLI do provider ou do
 * motor (técnica, muitas vezes em inglês): sem padrão conhecido, a frase genérica, e o original fica
 * em "Detalhes técnicos".
 */
export function explicarErroDoTurno(provider: string, mensagem: string): MensagemErro {
  return { texto: frase(tipoFalha("", mensagem), nomeProvider(provider), "responder"), detalhe: mensagem };
}

/** Os erros do motor que chegam à interface sem `FalhaProvider`, com a frase para a pessoa. */
const ERROS_DO_MOTOR: Readonly<Record<string, string>> = {
  TurnoEmAndamento: "A IA ainda está respondendo. Espere a resposta terminar ou use Interromper.",
  SessaoDesconhecida: "Esta conversa foi encerrada. Abra-a de novo pela lista de conversas.",
  AprovacaoDesconhecida: "Este pedido de permissão não vale mais: a resposta já seguiu sem ele.",
};

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
    if (typeof registro._tag === "string" && registro._tag in ERROS_DO_MOTOR) {
      return {
        texto: ERROS_DO_MOTOR[registro._tag]!,
        ...(typeof registro.message === "string" ? { detalhe: registro.message } : {}),
      };
    }
    if (registro._tag === "OperacaoNaoSuportada" && typeof registro.provider === "string") {
      const nome = nomeProvider(registro.provider);
      return {
        texto:
          registro.operacao === "login"
            ? `O app ainda não faz o login do ${nome}. Siga a orientação em ${SUA_IA}.`
            : `O app ainda não instala o ${nome}. Siga a orientação em ${SUA_IA}.`,
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
