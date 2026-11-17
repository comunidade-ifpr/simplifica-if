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
  claude: { nome: "Claude", conta: "Conta Claude Pro, Max, Team ou Enterprise (ou chave de API)" },
  codex: { nome: "ChatGPT (Codex)", conta: "Conta da OpenAI (ChatGPT Plus ou Pro)" },
  antigravity: { nome: "Gemini (Antigravity)", conta: "Conta do Google" },
};

/**
 * O que a pessoa faz por conta própria quando o app não oferece a operação para o provider: um texto
 * e, quando há, o comando do Terminal. Hoje só serve de reserva: o Claude tem o passo guiado, e o app
 * instala e faz o login do Codex e do Antigravity.
 */
export interface Orientacao {
  readonly texto: string;
  readonly comando?: string;
}

/** A orientação para quando o app não oferece `operacao` para o provider. */
export function orientacao(provider: Provider, operacao: "instalar" | "entrar"): Orientacao {
  return {
    texto:
      operacao === "instalar"
        ? `O app ainda não instala o ${DESCRICOES[provider].nome}. Instale-o por conta própria e depois detecte de novo.`
        : `O app ainda não faz o login do ${DESCRICOES[provider].nome}. Entre na conta por conta própria e depois detecte de novo.`,
  };
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

/**
 * As mensagens de progresso da instalação e do login que vêm do código copiado do T3 (em
 * `packages/motor/src/t3`, que mantém o inglês de origem para a sincronização), em português.
 */
const MENSAGENS_MOTOR: Readonly<Record<string, string>> = {
  "Downloading Codex.": "Baixando o Codex.",
  "Extracting Codex.": "Extraindo o Codex.",
  "Checking Codex.": "Conferindo o Codex.",
  "Checking Antigravity access and models.": "Conferindo o acesso ao Antigravity.",
  "Starting Google sign-in.": "Abrindo o login do Google.",
  "Checking credentials.": "Conferindo a conta.",
  "Waiting for Google to finish sign-in.": "Esperando o Google concluir o login.",
  "Open the Google sign-in link. If you are remote, paste the redirect URL here.": "Abra a página de login do Google.",
  "Signed in with Google.": "Login no Google concluído.",
  "Connected to Antigravity.": "Conectado ao Antigravity.",
  "Signed out of Google.": "Você saiu da conta do Google.",
  "Google sign-in was cancelled.": "O login no Google foi cancelado.",
  "Google sign-in was cancelled by sign-out.": "O login no Google foi cancelado.",
  "Sign-in is in progress in another client.": "Há um login em andamento em outra janela. Espere ele terminar.",
};

/** As falhas de instalação e de login do código copiado do T3, por tipo. */
const FALHAS_MOTOR: ReadonlyArray<readonly [RegExp, string]> = [
  [/eligible .*subscription/i, "Esta conta do Google não tem o plano que o Antigravity exige. Entre com outra conta."],
  [/not approved/i, "O login no Google não foi aprovado. Comece o login de novo."],
  [/expired/i, "O login demorou demais e expirou. Comece o login de novo."],
  [
    /network|could not reach|has not reached|interrupted|internet/i,
    "Não foi possível falar com o serviço pela internet. Confira a conexão (na rede do campus, um proxy ou firewall pode bloquear) e tente de novo.",
  ],
  [/timed out|has not started after|did not respond/i, "O programa demorou demais para responder. Tente de novo."],
  [/withdrawn/i, "Esta versão foi retirada pelo fabricante. Procure atualizações e tente de novo."],
  [
    /disk space|directory access/i,
    "Não foi possível gravar a instalação. Confira o espaço livre no disco e tente de novo.",
  ],
  [
    /incomplete|invalid|does not match|wrong version|unsafe|SHA-256|size/i,
    "A instalação ficou incompleta. Instale de novo.",
  ],
  [/rejected|could not authenticate|credentials/i, "A conta não foi aceita. Comece o login de novo."],
  [/in progress|already/i, "Já há uma operação em andamento. Espere ela terminar e tente de novo."],
];

/** Um texto em inglês, pelas palavras mais comuns (o resto já nasce em português no app). */
const EM_INGLES =
  /\b(the|is|was|could|not|this|your|with|account|requires|failed|please|try|check|sign-?in|sign-?out|download|install(ed|ation)?)\b/i;

/**
 * A `mensagem` de um estado de instalação, de login ou de detecção, como a pessoa a lê (M1.14): a de
 * progresso pela tabela; a de falha em inglês pelo tipo, com o original em `detalhe`; a que já está em
 * português, como veio.
 */
export function explicarMensagemMotor(mensagem: string): { readonly texto: string; readonly detalhe?: string } {
  const conhecida = MENSAGENS_MOTOR[mensagem.trim()];
  if (conhecida !== undefined) return { texto: conhecida };
  if (!EM_INGLES.test(mensagem)) return { texto: mensagem };
  const falha = FALHAS_MOTOR.find(([padrao]) => padrao.test(mensagem))?.[1];
  return {
    texto: falha ?? "Algo deu errado. Tente de novo; se continuar, veja os detalhes técnicos.",
    detalhe: mensagem,
  };
}
