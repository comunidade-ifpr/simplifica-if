import type { Provider } from "@simplifica-if/motor/eventos";

/**
 * O modelo padrão da revisão com IA, por provider: o intermediário de cada um, que julga bem
 * critérios com rubrica e custa menos que o maior. `undefined`: o padrão da conta.
 *
 * - Claude: Sonnet (`claude-sonnet-5-5`), o modelo das PoCs de A e B;
 * - Codex: o padrão da conta (`model/list`): numa conta ChatGPT, o modelo do `config.toml` pode não
 *   valer (armadilha registrada no motor), e o Codex não expõe um "intermediário" estável por nome;
 * - Antigravity: o padrão da conta (a lista do `agy` muda com a conta, sem um "intermediário" estável
 *   por nome; a sessão aceita modelo, ver `packages/motor/src/acp/opcoes-sessao.ts`).
 */
export const MODELO_PADRAO: Record<Provider, string | undefined> = {
  claude: "claude-sonnet-5-5",
  codex: undefined,
  antigravity: undefined,
};
