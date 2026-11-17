/**
 * Os três providers como a interface os apresenta: o nome que a pessoa conhece, a conta de que precisa
 * e o texto de cada fase da instalação e do login.
 */
import type { EstadoInstalacao, EstadoLogin, Provider } from "@simplifica-if/contratos-app";
import { numeroMegabytes } from "./lib/formato.ts";

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

/** `12,3 de 45,6 MB`, ou só o baixado quando o total não é conhecido. */
export function tamanhoBaixado(estado: EstadoInstalacao): string {
  const mb = numeroMegabytes;
  return estado.total === undefined ? `${mb(estado.baixados)} MB` : `${mb(estado.baixados)} de ${mb(estado.total)} MB`;
}

/**
 * As mensagens de progresso da instalação e do login que vêm do código copiado do T3 (em
 * `packages/motor/src/t3`, que mantém o inglês de origem para a sincronização), em português. O teste
 * `test/mensagens-copiadas.test.ts` confere que toda frase do código copiado cai aqui ou num tipo de
 * `FALHAS_MOTOR`, e acusa a frase nova numa atualização do upstream.
 */
const MENSAGENS_MOTOR: Readonly<Record<string, string>> = {
  "Downloading Codex.": "Baixando o Codex.",
  "Extracting Codex.": "Extraindo o Codex.",
  "Checking Codex.": "Conferindo o Codex.",
  "Downloading Google's official Antigravity runtime.": "Baixando o Antigravity do site oficial do Google.",
  "Checking the downloaded runtime.": "Conferindo o programa baixado.",
  "Extracting the verified runtime.": "Extraindo o programa.",
  "Checking the installed runtime.": "Conferindo o programa instalado.",
  "Installation cancelled. The previous runtime is unchanged.":
    "Instalação cancelada. A versão que já estava instalada continua como estava.",
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

/** Onde a pessoa instala a IA e entra na conta. */
const SUA_IA = "Configurações › Sua IA";

/**
 * As falhas de instalação e de login do código copiado do T3, por tipo, na ordem em que se conferem
 * (a primeira que casa vale): as de causa precisa (plano, aprovação, remoção, sem login, configuração
 * que o app não usa, sistema, IPv6) antes das largas (rede, tempo, login, disco, instalação, programa
 * que não inicia), porque as frases do T3 trazem palavras de mais de um tipo.
 */
const FALHAS_MOTOR: ReadonlyArray<readonly [RegExp, string]> = [
  [/eligible .*subscription/i, "Esta conta do Google não tem o plano que o Antigravity exige. Entre com outra conta."],
  [/not approved/i, "O login no Google não foi aprovado. Comece o login de novo."],
  [/expired/i, "O login demorou demais e expirou. Comece o login de novo."],
  [
    /before removing|could not remove/i,
    "Não foi possível remover a instalação desta IA. Feche as conversas com ela e tente de novo.",
  ],
  [/sign in to .* before|not (logged|signed) in/i, `Esta IA está sem login. Entre na conta em ${SUA_IA}.`],
  [
    /not installed|install it to continue|missing or not executable|could not read the .* installation|update the managed .* installation/i,
    `O programa desta IA não está instalado neste computador, ou a instalação está com defeito. Instale-o em ${SUA_IA}.`,
  ],
  [
    /API key|GCP project|provider settings/i,
    `Esta forma de entrar pede uma configuração que o app não usa. Entre com a conta do Google em ${SUA_IA}.`,
  ],
  [
    /compatib|supported range|no longer works with/i,
    `A versão desta IA neste computador não funciona bem com o app. Instale a versão nova em ${SUA_IA}.`,
  ],
  [
    /does not publish .* runtime for|memory pages|codesign/i,
    "O programa desta IA não roda neste computador. Escolha outra IA para as conversas.",
  ],
  [
    /requires IPv6/i,
    "O programa desta IA precisa do IPv6, que está desligado neste computador. Fale com a TI do campus.",
  ],
  [/withdrawn/i, "Esta versão foi retirada pelo fabricante. Procure atualizações e tente de novo."],
  [/download server returned HTTP/i, "O site de onde o app baixa a IA está fora do ar. Tente de novo mais tarde."],
  [
    /network|could not reach|has not reached|interrupted|internet|could not resolve/i,
    "Não foi possível falar com o serviço pela internet. Confira a conexão (na rede do campus, um proxy ou firewall pode bloquear) e tente de novo.",
  ],
  [/timed out|has not started after|did not respond/i, "O programa demorou demais para responder. Tente de novo."],
  [
    /in progress|already|another installation|no longer current/i,
    "Já há uma operação em andamento. Espere ela terminar e tente de novo.",
  ],
  [/sign-?out/i, "Não foi possível sair da conta. Tente de novo."],
  [
    /sign-?in|redirect URL|no longer active/i,
    `O login no Google não foi concluído. Comece o login de novo em ${SUA_IA}.`,
  ],
  [/rejected|could not authenticate|credentials/i, "A conta não foi aceita. Comece o login de novo."],
  [
    /disk space|free space|directory access|locked files|could not be (created|written|set)/i,
    "Não foi possível gravar a instalação. Confira o espaço livre no disco e tente de novo.",
  ],
  [
    /incomplete|invalid|does not match|wrong version|unsafe|SHA-256|checksum|size|exceeded|truncated|archive|extract|unpack|must contain|differs|did not identify/i,
    "A instalação ficou incompleta. Instale de novo.",
  ],
  [
    /authenticated, but/i,
    `A conta foi aceita, mas o programa da IA não conseguiu abrir a conversa. Tente de novo; se continuar, instale de novo em ${SUA_IA}.`,
  ],
  [
    /could not (start|verify|publish|activate|prepare|finish|install|link)|could not start|protocol line|browser suppression|runtime path|user skills|launcher/i,
    `O programa desta IA não conseguiu começar neste computador. Tente de novo; se continuar, instale de novo em ${SUA_IA}.`,
  ],
];

/** A frase quando a falha não tem tipo conhecido. */
export const FALHA_GENERICA_MOTOR = "Algo deu errado. Tente de novo; se continuar, veja os detalhes técnicos.";

/**
 * Um texto já em português: as mensagens que o próprio motor escreve (`packages/motor/src/drivers`)
 * têm acento ou uma destas palavras; as do código copiado do T3, em inglês, não. Conferir o português,
 * e não o inglês, faz a frase inglesa sem palavra conhecida cair no tipo ou na genérica, e não na tela.
 */
const EM_PORTUGUES = /[ãõçáéíóúâêô]|\b(n[ãa]o|de|da|em|sem|para|com|ou)\b/i;

/**
 * A `mensagem` de um estado de instalação, de login ou de detecção, como a pessoa a lê (M1.14): a de
 * progresso pela tabela; a de falha em inglês pelo tipo, com o original em `detalhe`; a que já está em
 * português, como veio.
 */
export function explicarMensagemMotor(mensagem: string): { readonly texto: string; readonly detalhe?: string } {
  const conhecida = MENSAGENS_MOTOR[mensagem.trim()];
  if (conhecida !== undefined) return { texto: conhecida };
  if (EM_PORTUGUES.test(mensagem)) return { texto: mensagem };
  const falha = FALHAS_MOTOR.find(([padrao]) => padrao.test(mensagem))?.[1];
  return { texto: falha ?? FALHA_GENERICA_MOTOR, detalhe: mensagem };
}
