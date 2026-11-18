/**
 * O classificador das falhas dos providers, num lugar só: o motor dá o `tipo` no ponto em que cada
 * driver produz a falha (`FalhaProvider`, o evento `Erro` do turno, o estado de instalação e de login),
 * e a interface e a revisão com IA leem o tipo, nunca o texto. Módulo folha, só de funções puras e
 * schemas, como `erros.ts`: os contratos do app e a interface o importam sem carregar os drivers.
 *
 * O texto técnico que a interface mostra em "Detalhes técnicos" sai de `textoTecnico`: curto e
 * saneado (e-mails, segredos, a pasta do usuário e a consulta das URLs mascarados).
 */
import * as Schema from "effect/Schema";

/**
 * Os tipos de falha de provider: sem login, cota ou limite de uso, rede ou proxy, CLI ausente, versão
 * antiga, recusa pelas regras de uso, tempo esgotado, serviço fora do ar, a base que não ficou
 * disponível, modelo fora da conta, queda do processo, o limite de passos do app e o desconhecido.
 */
export const TipoFalha = Schema.Literals([
  "semLogin",
  "cota",
  "rede",
  "cliAusente",
  "versao",
  "politica",
  "tempo",
  "indisponivel",
  "mcp",
  "modelo",
  "queda",
  "limiteApp",
  "desconhecido",
]);
export type TipoFalha = typeof TipoFalha.Type;

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
  // As frases dos protocolos copiados do T3 (`effect-acp`, `effect-codex-app-server`) também: o fim do
  // stdin/stdout ou do protocolo e a escrita que falhou são o processo que caiu.
  [
    "queda",
    /terminated by signal|process (exited|terminated)|processo d[oa] .* encerrou|app-server encerrou|input stream ended|protocol terminated|failed to send .*protocol message|transport operation.* failed/i,
  ],
  // O Claude Agent SDK encerra o turno com `error_max_turns` ou `error_max_budget_usd`.
  ["limiteApp", /error_max_(turns|budget_usd|structured_output_retries)|max(imum)? turns/i],
  [
    "politica",
    /usage polic|content polic|violat\w* (our |the )?(usage |content )?polic|flagged|invalid_prompt|cyber_policy|\bsafety\b|blocked (by|due to) (policy|safety)|recitation/i,
  ],
  // "limit reached" e "exceeded your" vêm da pausa por cota da revisão com IA ("5-hour limit reached",
  // "You exceeded your current quota").
  [
    "cota",
    /usage limit|rate[ _-]?limit|\b429\b|too many requests|quota|billing|credit balance|insufficient[ _]?(credits|funds|quota)|out of credits|limite de uso|resource[ _]exhausted|hit your (usage )?limit|limit reached|exceeded your/i,
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
    /ENOENT|command not found|no such file|executable not found|failed to spawn|ausente|n[ãa]o (está )?instalad|n[ãa]o encontrad|not installed/i,
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

/** O tipo de uma falha pela operação e pelo texto do provider; `desconhecido` sem padrão conhecido. */
export function classificarFalha(operacao: string, texto: string): TipoFalha {
  if (/^(login|entrar)$/i.test(operacao)) return "semLogin";
  return PADROES.find(([, padrao]) => padrao.test(texto))?.[0] ?? "desconhecido";
}

/** O texto de uma causa qualquer: a mensagem de um `Error`; vazio para o resto. */
export function textoDaCausa(cause: unknown): string {
  return cause instanceof Error ? cause.message : "";
}

/**
 * As falhas de instalação e de login do código copiado do T3 (em inglês, em `src/t3`), que chegam pela
 * `mensagem` dos estados: plano, aprovação, expiração, remoção, sem login, programa não instalado,
 * configuração que o app não usa, versão, sistema sem suporte, IPv6, versão retirada, servidor de
 * download, rede, tempo, operação em andamento, saída da conta, login não concluído, conta recusada,
 * disco, instalação incompleta, programa que não abre depois do login e programa que não inicia.
 */
export const TipoFalhaEstado = Schema.Literals([
  "plano",
  "naoAprovado",
  "expirado",
  "remocao",
  "semLogin",
  "naoInstalado",
  "configuracao",
  "versao",
  "sistema",
  "ipv6",
  "retirada",
  "download",
  "rede",
  "tempo",
  "emAndamento",
  "saida",
  "loginIncompleto",
  "contaRecusada",
  "disco",
  "incompleta",
  "aposLogin",
  "naoInicia",
]);
export type TipoFalhaEstado = typeof TipoFalhaEstado.Type;

/**
 * Os padrões das falhas de instalação e de login, na ordem em que se conferem (a primeira que casa
 * vale): as de causa precisa (plano, aprovação, remoção, sem login, configuração que o app não usa,
 * sistema, IPv6) antes das largas (rede, tempo, login, disco, instalação, programa que não inicia),
 * porque as frases do T3 trazem palavras de mais de um tipo.
 */
const PADROES_ESTADO: ReadonlyArray<readonly [TipoFalhaEstado, RegExp]> = [
  ["plano", /eligible .*subscription/i],
  ["naoAprovado", /not approved/i],
  ["expirado", /expired/i],
  ["remocao", /before removing|could not remove/i],
  ["semLogin", /sign in to .* before|not (logged|signed) in/i],
  [
    "naoInstalado",
    /not installed|install it to continue|missing or not executable|could not read the .* installation|update the managed .* installation/i,
  ],
  ["configuracao", /API key|GCP project|provider settings/i],
  ["versao", /compatib|supported range|no longer works with/i],
  ["sistema", /does not publish .* runtime for|memory pages|codesign/i],
  ["ipv6", /requires IPv6/i],
  ["retirada", /withdrawn/i],
  ["download", /download server returned HTTP/i],
  ["rede", /network|could not reach|has not reached|interrupted|internet|could not resolve/i],
  ["tempo", /timed out|has not started after|did not respond/i],
  ["emAndamento", /in progress|already|another installation|no longer current/i],
  ["saida", /sign-?out/i],
  ["loginIncompleto", /sign-?in|redirect URL|no longer active/i],
  ["contaRecusada", /rejected|could not authenticate|credentials/i],
  ["disco", /disk space|free space|directory access|locked files|could not be (created|written|set)/i],
  [
    "incompleta",
    /incomplete|invalid|does not match|wrong version|unsafe|SHA-256|checksum|size|exceeded|truncated|archive|extract|unpack|must contain|differs|did not identify/i,
  ],
  ["aposLogin", /authenticated, but/i],
  [
    "naoInicia",
    /could not (start|verify|publish|activate|prepare|finish|install|link)|could not start|protocol line|browser suppression|runtime path|user skills|launcher/i,
  ],
];

/**
 * O tipo de falha de uma mensagem de estado de instalação ou de login, ou `undefined` se ela não casa
 * com nenhum padrão. As de progresso que casam por acaso ("Checking credentials.") a interface
 * reconhece antes, pela tabela de frases dela.
 */
export function classificarFalhaEstado(mensagem: string): TipoFalhaEstado | undefined {
  return PADROES_ESTADO.find(([, padrao]) => padrao.test(mensagem))?.[0];
}

/** O tamanho máximo do texto técnico que vai à interface. */
export const LIMITE_TECNICO = 300;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const CONSULTA_URL = /\b([a-z][a-z0-9+.-]*:\/\/[^\s?#"'<>()]+)\?[^\s#"'<>()]*/gi;
const CHAVE_SECRETA =
  /\b(token|access_token|refresh_token|secret|password|senha|api[_-]?key|authorization|cookie)(["']?\s*[:=]\s*["']?)(?:Bearer\s+)?[^\s"',;&]+/gi;
const PORTADOR = /\b(Bearer\s+|sk-|sk-ant-)[A-Za-z0-9._~+/=-]{8,}/g;
/** Sequências longas sem espaço, com letras e dígitos: chaves, tokens, JWT. */
const CADEIA_LONGA = /\b(?=[A-Za-z0-9_\-.]*\d)(?=[A-Za-z0-9_\-.]*[A-Za-z])[A-Za-z0-9_\-.]{32,}\b/g;
/** O nome do usuário pode ter espaço: mascara até a próxima barra (ou o fim), e sobra mascarar demais. */
const PASTA_USUARIO = /(?:\/Users\/|\/home\/|\b[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/])[^\\/"'`:;,()\n]+/g;

/**
 * Mascara num texto técnico o que não pode ir à interface nem ao histórico: e-mails, segredos (valor
 * de chave secreta, `Bearer`, chaves de API, cadeias longas com cara de token), a pasta do usuário
 * (`/Users/nome`, `/home/nome`, `C:\Users\nome` viram `~`) e a consulta das URLs.
 */
export function sanear(texto: string): string {
  return texto
    .replace(CONSULTA_URL, "$1?<consulta>")
    .replace(EMAIL, "<e-mail>")
    .replace(CHAVE_SECRETA, "$1$2<segredo>")
    .replace(PORTADOR, "<segredo>")
    .replace(CADEIA_LONGA, "<segredo>")
    .replace(PASTA_USUARIO, "~");
}

/** Um texto técnico numa linha, saneado e com até `LIMITE_TECNICO` caracteres. */
export function textoTecnico(texto: string): string {
  const linha = sanear(texto).replace(/\s+/g, " ").trim();
  return linha.length <= LIMITE_TECNICO ? linha : `${linha.slice(0, LIMITE_TECNICO - 1)}…`;
}
