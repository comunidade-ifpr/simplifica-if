/**
 * Os três providers como a interface os apresenta: o nome que a pessoa conhece, a conta de que precisa
 * e o texto de cada fase da instalação e do login.
 */
import type { EstadoInstalacao, EstadoLogin, Provider } from "@simplifica-if/contratos-app";

export const PROVIDERS: ReadonlyArray<Provider> = ["claude", "codex", "antigravity"];

export interface DescricaoProvider {
  /** O nome do produto. */
  readonly nome: string;
  /** A assinatura que a pessoa usa. */
  readonly conta: string;
}

export const DESCRICOES: Readonly<Record<Provider, DescricaoProvider>> = {
  claude: { nome: "Claude", conta: "Conta da Anthropic (Claude Pro ou Max)" },
  codex: { nome: "ChatGPT (Codex)", conta: "Conta da OpenAI (ChatGPT Plus ou Pro)" },
  antigravity: { nome: "Gemini (Antigravity)", conta: "Conta do Google" },
};

/**
 * O que a pessoa faz por conta própria quando o app não oferece a operação para o provider: um texto
 * e, quando há, o comando do Terminal. Provisório: o passo guiado é do M1.8.
 */
export interface Orientacao {
  readonly texto: string;
  readonly comando?: string;
}

const ORIENTACOES: Readonly<Record<Provider, Partial<Record<"instalar" | "entrar", Orientacao>>>> = {
  claude: {
    instalar: {
      texto:
        "O app ainda não instala o Claude Code. Instale-o pelo instalador oficial da Anthropic, entre na conta com o comando abaixo no Terminal e depois detecte de novo.",
      comando: "claude",
    },
    entrar: {
      texto: "O app ainda não faz o login do Claude. Entre na conta com o comando abaixo no Terminal e depois detecte de novo.",
      comando: "claude",
    },
  },
  codex: {
    entrar: {
      texto:
        "O app ainda não faz o login do ChatGPT. Entre na conta com o comando abaixo no Terminal e depois detecte de novo.",
      comando: "codex login",
    },
  },
  antigravity: {},
};

/** A orientação para quando o app não oferece `operacao` para o provider. */
export function orientacao(provider: Provider, operacao: "instalar" | "entrar"): Orientacao {
  return (
    ORIENTACOES[provider][operacao] ?? {
      texto:
        operacao === "instalar"
          ? `O app ainda não instala o ${DESCRICOES[provider].nome}. Instale-o por conta própria e depois detecte de novo.`
          : `O app ainda não faz o login do ${DESCRICOES[provider].nome}. Entre na conta por conta própria e depois detecte de novo.`,
    }
  );
}

const FASES_INSTALACAO: Readonly<Record<EstadoInstalacao["fase"], string>> = {
  parada: "Aguardando",
  baixando: "Baixando",
  extraindo: "Extraindo",
  verificando: "Verificando",
  concluida: "Instalação concluída",
  falhou: "A instalação falhou",
  cancelada: "Instalação cancelada",
};

const FASES_LOGIN: Readonly<Record<EstadoLogin["fase"], string>> = {
  parado: "Aguardando",
  iniciando: "Preparando o login",
  aguardando: "Termine o login no navegador",
  verificando: "Conferindo o login",
  concluido: "Login concluído",
  falhou: "O login falhou",
  cancelado: "Login cancelado",
};

export const textoFaseInstalacao = (fase: EstadoInstalacao["fase"]): string => FASES_INSTALACAO[fase];
export const textoFaseLogin = (fase: EstadoLogin["fase"]): string => FASES_LOGIN[fase];

export const instalacaoTerminou = (estado: EstadoInstalacao): boolean =>
  estado.fase === "concluida" || estado.fase === "falhou" || estado.fase === "cancelada";

export const loginTerminou = (estado: EstadoLogin): boolean =>
  estado.fase === "concluido" || estado.fase === "falhou" || estado.fase === "cancelado";

/** O progresso do download, de 0 a 100, ou `undefined` se o total não é conhecido. */
export function porcentagemInstalacao(estado: EstadoInstalacao): number | undefined {
  if (estado.fase === "concluida") return 100;
  if (estado.total === undefined || estado.total <= 0) return undefined;
  return Math.min(100, Math.round((estado.baixados / estado.total) * 100));
}

const formatoMb = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

/** `12,3 de 45,6 MB`, ou só o baixado quando o total não é conhecido. */
export function tamanhoBaixado(estado: EstadoInstalacao): string {
  const mb = (bytes: number) => formatoMb.format(bytes / 1_048_576);
  return estado.total === undefined ? `${mb(estado.baixados)} MB` : `${mb(estado.baixados)} de ${mb(estado.total)} MB`;
}
