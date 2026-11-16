// @effect-diagnostics nodeBuiltinImport:off -- funções puras de caminho, chamadas dentro dos callbacks dos drivers
/**
 * Política de fábrica (M1.7, versão mínima): o que a sessão do provider pode fazer sem perguntar, o
 * que pergunta ao servidor e o que se nega sem perguntar. É um Effect Schema embutido no app e só de
 * leitura (`POLITICA_FABRICA`); o `Motor` a aplica nos três drivers.
 *
 * Cada driver classifica o pedido de aprovação nativo num `TipoFerramenta` com os caminhos que ele
 * toca (`classificar*` nos drivers); `avaliar` decide pela política. As decisões `permitir` e `negar`
 * se respondem no próprio motor (`Canal.aprovar`), sem chegar à interface; `perguntar` vira
 * `PedidoAprovacao`.
 *
 * Fica para depois (decisão em aberto 9): um arquivo de política da máquina, gerido pela DTI, que só
 * restringe esta.
 */
import * as NodePath from "node:path";
import * as Schema from "effect/Schema";
import { Provider } from "./eventos.ts";

/** O que fazer com um pedido: responder sozinho (`permitir`, `negar`) ou perguntar ao servidor. */
export const Regra = Schema.Literals(["permitir", "perguntar", "negar"]);
export type Regra = typeof Regra.Type;

/** A regra para o que fica dentro da pasta de trabalho da sessão e para o que fica fora dela. */
export const RegraPorLugar = Schema.Struct({ dentro: Regra, fora: Regra });

/**
 * Tipos de ferramenta, iguais nos três providers:
 * - `leitura`: ler arquivo, listar pasta, buscar em arquivos;
 * - `escrita`: criar, alterar, apagar ou mover arquivo;
 * - `comando`: rodar um comando no terminal;
 * - `mcp-app`: ferramenta (ou recurso) de um servidor MCP do app marcado `preAprovado` (o `ifpr`);
 * - `mcp-outro`: ferramenta de outro servidor MCP;
 * - `web`: busca na web ou leitura de uma URL;
 * - `outra`: o resto (subagente, plano, pergunta ao usuário…).
 */
export const TipoFerramenta = Schema.Literals([
  "leitura",
  "escrita",
  "comando",
  "mcp-app",
  "mcp-outro",
  "web",
  "outra",
]);
export type TipoFerramenta = typeof TipoFerramenta.Type;

/** Um pedido de aprovação classificado: o tipo e os caminhos que ele toca (vazio: só a pasta da sessão). */
export interface ClassePedido {
  readonly tipo: TipoFerramenta;
  readonly caminhos: ReadonlyArray<string>;
}

export const Politica = Schema.Struct({
  /** Os providers que o app abre. Um provider novo é decisão de produto, não configuração. */
  providers: Schema.Array(Provider),
  ferramentas: Schema.Struct({
    leitura: RegraPorLugar,
    escrita: RegraPorLugar,
    comando: RegraPorLugar,
    mcpApp: Regra,
    mcpOutro: Regra,
    web: Regra,
    outra: Regra,
  }),
  /** Sandbox e aprovação do Codex (`thread/start`). */
  codex: Schema.Struct({
    sandbox: Schema.Literals(["read-only", "workspace-write"]),
    aprovacao: Schema.Literals(["on-request", "untrusted"]),
  }),
  /**
   * O que vem do usuário e não entra na sessão: MCP, conectores (apps do ChatGPT, plugins), skills,
   * instruções e hooks. `buscaWeb` desligada ignora o `buscaWeb` da sessão; `a-pedido` o respeita.
   */
  isolamento: Schema.Struct({
    configuracaoDoUsuario: Schema.Literals(["desligada"]),
    buscaWeb: Schema.Literals(["desligada", "a-pedido"]),
  }),
  /** Telemetria dos providers: desligada; nada sai além do que a conversa precisa. */
  telemetria: Schema.Literals(["desligada"]),
});
export type Politica = typeof Politica.Type;

const congelar = <A>(valor: A): A => {
  if (typeof valor === "object" && valor !== null) {
    for (const filho of Object.values(valor)) congelar(filho);
    Object.freeze(valor);
  }
  return valor;
};

/**
 * A política de fábrica. As ferramentas `ifpr` passam sem perguntar (só leitura, sobre dado
 * público); escrita e comandos perguntam dentro da pasta de trabalho e se negam fora dela; ler fora
 * da pasta também se nega, porque a sessão só vê a base pública e o que o servidor anexa.
 */
export const POLITICA_FABRICA: Politica = congelar(
  Schema.decodeSync(Politica)({
    providers: ["claude", "codex", "antigravity"],
    ferramentas: {
      leitura: { dentro: "permitir", fora: "negar" },
      escrita: { dentro: "perguntar", fora: "negar" },
      comando: { dentro: "perguntar", fora: "negar" },
      mcpApp: "permitir",
      mcpOutro: "negar",
      web: "negar",
      outra: "perguntar",
    },
    codex: { sandbox: "read-only", aprovacao: "on-request" },
    isolamento: { configuracaoDoUsuario: "desligada", buscaWeb: "desligada" },
    telemetria: "desligada",
  }),
);

/**
 * A política das sessões de julgamento (`ConfigSessao.semFerramentas`, a revisão de PPC do M1.11):
 * o contexto vai pronto na mensagem, e qualquer ferramenta se nega sem perguntar, dentro ou fora da
 * pasta. Os providers e o isolamento são os de fábrica.
 */
export const POLITICA_JULGAMENTO: Politica = congelar(
  Schema.decodeSync(Politica)({
    providers: ["claude", "codex", "antigravity"],
    ferramentas: {
      leitura: { dentro: "negar", fora: "negar" },
      escrita: { dentro: "negar", fora: "negar" },
      comando: { dentro: "negar", fora: "negar" },
      mcpApp: "negar",
      mcpOutro: "negar",
      web: "negar",
      outra: "negar",
    },
    codex: { sandbox: "read-only", aprovacao: "on-request" },
    isolamento: { configuracaoDoUsuario: "desligada", buscaWeb: "desligada" },
    telemetria: "desligada",
  }),
);

/** A busca web vale nesta sessão: pedida na sessão e permitida pela política. */
export const buscaWebLigada = (politica: Politica, pedida: boolean | undefined): boolean =>
  pedida === true && politica.isolamento.buscaWeb === "a-pedido" && politica.ferramentas.web !== "negar";

/**
 * As formas de escrever a pasta da sessão. No macOS, `/tmp` e `/var` são atalhos para `/private/…`:
 * o provider pode citar o caminho por qualquer dos dois.
 */
export function formasDaPasta(pasta: string): ReadonlyArray<string> {
  const formas = [pasta];
  if (pasta.startsWith("/private/")) formas.push(pasta.slice("/private".length));
  else if (/^\/(tmp|var|etc)(\/|$)/.test(pasta)) formas.push(`/private${pasta}`);
  return formas;
}

/** O caminho fica dentro da pasta (relativo: a partir dela). `~` conta como fora. */
export function dentroDaPasta(caminho: string, pasta: string): boolean {
  if (caminho.startsWith("~")) return false;
  const caminhos =
    NodePath.isAbsolute(caminho) || /^[A-Za-z]:[\\/]/.test(caminho) ? caminho : NodePath.join(pasta, caminho);
  return formasDaPasta(pasta).some((forma) => {
    const relativo = NodePath.relative(forma, NodePath.resolve(caminhos));
    return relativo === "" || (!relativo.startsWith("..") && !NodePath.isAbsolute(relativo));
  });
}

/** Saídas especiais que um comando pode citar sem sair da pasta. */
const CAMINHOS_INOFENSIVOS = new Set(["/dev/null", "/dev/stdout", "/dev/stderr", "NUL"]);

/**
 * Executáveis do sistema (`/bin/zsh -lc '…'`, como o Codex embrulha os comandos): citar o programa
 * não é tocar arquivo fora da pasta.
 */
const EXECUTAVEIS_DO_SISTEMA = /^\/(?:usr\/(?:local\/)?)?s?bin\/|^\/opt\/homebrew\/bin\//;

/**
 * Caminhos que um comando cita: absolutos (`/x`, `C:\x`), da pasta pessoal (`~/x`) ou que sobem
 * (`../x`). É uma heurística para negar sem perguntar o que sai da pasta; o que passa ainda pergunta
 * ao servidor, e o Codex roda no sandbox somente leitura.
 */
export function caminhosDoComando(comando: string): ReadonlyArray<string> {
  const encontrados: Array<string> = [];
  const padrao = /(?:^|[\s"'=<>|;&(`])((?:~|\.\.|[A-Za-z]:\\|\/)[^\s"'|;&<>()`]*)/g;
  for (const achado of comando.matchAll(padrao)) {
    const caminho = achado[1];
    if (caminho !== undefined && !CAMINHOS_INOFENSIVOS.has(caminho) && !EXECUTAVEIS_DO_SISTEMA.test(caminho)) {
      encontrados.push(caminho);
    }
  }
  return encontrados;
}

const DESCRICAO: Record<TipoFerramenta, string> = {
  leitura: "ler arquivos",
  escrita: "alterar arquivos",
  comando: "rodar comandos",
  "mcp-app": "usar as ferramentas do app",
  "mcp-outro": "usar servidores MCP que não são do app",
  web: "acessar a web",
  outra: "usar esta ferramenta",
};

export interface Avaliacao {
  readonly regra: Regra;
  /** Por que a política decidiu sozinha; vai para o provider quando nega. */
  readonly motivo: string;
}

/** Decide um pedido classificado pela política, para a sessão na `pasta`. */
export function avaliar(politica: Politica, classe: ClassePedido, pasta: string): Avaliacao {
  const regras = politica.ferramentas;
  switch (classe.tipo) {
    case "leitura":
    case "escrita":
    case "comando": {
      const fora = classe.caminhos.some((caminho) => !dentroDaPasta(caminho, pasta));
      const regra = regras[classe.tipo][fora ? "fora" : "dentro"];
      const onde = fora ? "fora da pasta de trabalho" : "na pasta de trabalho";
      return {
        regra,
        motivo: `A política do app ${regra === "negar" ? "não permite" : "permite"} ${DESCRICAO[classe.tipo]} ${onde}.`,
      };
    }
    case "mcp-app":
      return {
        regra: regras.mcpApp,
        motivo: `A política do app ${regras.mcpApp === "negar" ? "não permite" : "permite"} ${DESCRICAO["mcp-app"]}.`,
      };
    case "mcp-outro":
      return { regra: regras.mcpOutro, motivo: `A política do app não permite ${DESCRICAO["mcp-outro"]}.` };
    case "web":
      return { regra: regras.web, motivo: `A política do app não permite ${DESCRICAO.web} nesta sessão.` };
    case "outra":
      return { regra: regras.outra, motivo: `A política do app não permite ${DESCRICAO.outra}.` };
  }
}

/* ================================================================ telemetria */

/**
 * Ambiente sem telemetria: tira as variáveis `OTEL_*` herdadas (um exportador OTLP do usuário
 * mandaria a conversa para fora) e, no Claude, põe as que desligam telemetria, relatório de erro e
 * tráfego não essencial do Claude Code.
 */
export function ambienteSemTelemetria(
  provider: Provider,
  ambiente: Readonly<Record<string, string>>,
): Record<string, string> {
  const limpo: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(ambiente)) {
    if (!chave.startsWith("OTEL_")) limpo[chave] = valor;
  }
  if (provider === "claude") Object.assign(limpo, TELEMETRIA_CLAUDE);
  if (provider === "antigravity") Object.assign(limpo, TELEMETRIA_ANTIGRAVITY);
  return limpo;
}

/**
 * Claude Code: `DISABLE_TELEMETRY` (métricas de uso), `DISABLE_ERROR_REPORTING` (Sentry),
 * `CLAUDE_CODE_ENABLE_TELEMETRY=0` (OpenTelemetry) e `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, que
 * junta essas duas com a atualização automática e o `/bug`.
 */
export const TELEMETRIA_CLAUDE: Readonly<Record<string, string>> = {
  DISABLE_TELEMETRY: "1",
  DISABLE_ERROR_REPORTING: "1",
  DISABLE_BUG_COMMAND: "1",
  CLAUDE_CODE_ENABLE_TELEMETRY: "0",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
};

/** Antigravity: o Sentry do `agy` sem amostras (a flag `--disable-telemetry` faz o resto). */
export const TELEMETRIA_ANTIGRAVITY: Readonly<Record<string, string>> = {
  ANTIGRAVITY_SENTRY_SAMPLE_RATE: "0",
};

/**
 * Codex: `-c` do `codex app-server`, valendo para o processo (a telemetria se configura na partida,
 * não por thread). `analytics` e `feedback` desligados; os três exportadores OpenTelemetry em `none`
 * (o de métricas tem `statsig` como alternativa embutida).
 */
export const TELEMETRIA_CODEX_ARGS: ReadonlyArray<string> = [
  "-c",
  "analytics.enabled=false",
  "-c",
  "feedback.enabled=false",
  "-c",
  'otel.exporter="none"',
  "-c",
  'otel.trace_exporter="none"',
  "-c",
  'otel.metrics_exporter="none"',
];

/** Antigravity: argumento do `agy acp`. */
export const TELEMETRIA_ANTIGRAVITY_ARGS: ReadonlyArray<string> = ["--disable-telemetry"];
