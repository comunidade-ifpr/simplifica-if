/**
 * Os três providers como a interface os apresenta: o nome que a pessoa conhece, a conta de que precisa
 * e o texto de cada fase da instalação e do login.
 */
import type { EstadoInstalacao, EstadoLogin, Provider, TipoFalhaEstado } from "@simplifica-if/contratos-app";
import { numeroMegabytes } from "./lib/formato.ts";

export const PROVIDERS: ReadonlyArray<Provider> = ["claude", "codex", "antigravity"];

export interface DescricaoProvider {
  /** O nome do produto. */
  readonly nome: string;
  /** O nome curto, nas frases ("O Claude chegou ao limite", "Continuar com ChatGPT"). */
  readonly curto: string;
  /** A assinatura que a pessoa usa. */
  readonly conta: string;
}

export const DESCRICOES: Readonly<Record<Provider, DescricaoProvider>> = {
  claude: { nome: "Claude", curto: "Claude", conta: "Conta Claude Pro, Max, Team ou Enterprise (ou chave de API)" },
  codex: { nome: "ChatGPT (Codex)", curto: "ChatGPT", conta: "Conta da OpenAI (ChatGPT Plus ou Pro)" },
  antigravity: { nome: "Gemini (Antigravity)", curto: "Gemini", conta: "Conta do Google" },
};

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
 * `packages/motor/src/t3`, que mantém o inglês de origem para a sincronização), em português.
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
 * As falhas de instalação e de login do código copiado do T3, pelo tipo que o classificador do motor
 * deu (`tipoFalha` do estado).
 */
const FALHAS_MOTOR: Readonly<Record<TipoFalhaEstado, string>> = {
  plano: "Esta conta do Google não tem o plano que o Antigravity exige. Entre com outra conta.",
  naoAprovado: "O login no Google não foi aprovado. Comece o login de novo.",
  expirado: "O login demorou demais e expirou. Comece o login de novo.",
  remocao: "Não foi possível remover a instalação desta IA. Feche as conversas com ela e tente de novo.",
  semLogin: `Esta IA está sem login. Entre na conta em ${SUA_IA}.`,
  naoInstalado: `O programa desta IA não está instalado neste computador, ou a instalação está com defeito. Instale-o em ${SUA_IA}.`,
  configuracao: `Esta forma de entrar pede uma configuração que o app não usa. Entre com a conta do Google em ${SUA_IA}.`,
  versao: `A versão desta IA neste computador não funciona bem com o app. Instale a versão nova em ${SUA_IA}.`,
  sistema: "O programa desta IA não roda neste computador. Escolha outra IA para as conversas.",
  ipv6: "O programa desta IA precisa do IPv6, que está desligado neste computador. Fale com a TI do campus.",
  retirada: "Esta versão foi retirada pelo fabricante. Procure atualizações e tente de novo.",
  download: "O site de onde o app baixa a IA está fora do ar. Tente de novo mais tarde.",
  rede: "Não foi possível falar com o serviço pela internet. Confira a conexão (na rede do campus, um proxy ou firewall pode bloquear) e tente de novo.",
  tempo: "O programa demorou demais para responder. Tente de novo.",
  emAndamento: "Já há uma operação em andamento. Espere ela terminar e tente de novo.",
  saida: "Não foi possível sair da conta. Tente de novo.",
  loginIncompleto: `O login no Google não foi concluído. Comece o login de novo em ${SUA_IA}.`,
  contaRecusada: "A conta não foi aceita. Comece o login de novo.",
  disco: "Não foi possível gravar a instalação. Confira o espaço livre no disco e tente de novo.",
  incompleta: "A instalação ficou incompleta. Instale de novo.",
  aposLogin: `A conta foi aceita, mas o programa da IA não conseguiu abrir a conversa. Tente de novo; se continuar, instale de novo em ${SUA_IA}.`,
  naoInicia: `O programa desta IA não conseguiu começar neste computador. Tente de novo; se continuar, instale de novo em ${SUA_IA}.`,
};

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
 * progresso pela tabela; a que já está em português, como veio; a de falha em inglês pelo `tipoFalha`
 * que o motor deu, com o original em `detalhe`.
 */
export function explicarMensagemMotor(estado: {
  readonly mensagem: string;
  readonly tipoFalha?: TipoFalhaEstado | undefined;
}): { readonly texto: string; readonly detalhe?: string } {
  const { mensagem, tipoFalha } = estado;
  const conhecida = MENSAGENS_MOTOR[mensagem.trim()];
  if (conhecida !== undefined) return { texto: conhecida };
  if (EM_PORTUGUES.test(mensagem)) return { texto: mensagem };
  return { texto: tipoFalha === undefined ? FALHA_GENERICA_MOTOR : FALHAS_MOTOR[tipoFalha], detalhe: mensagem };
}
