/**
 * O texto dos erros que chegam à interface (M1.14). Os erros tipados do servidor já trazem `message` em
 * português; os do transporte (`RpcClientError`), os do motor (`TurnoEmAndamento`…) e os defeitos
 * ganham uma frase própria.
 *
 * Uma `FalhaProvider` e o evento `Erro` de um turno trazem o `tipo` que o classificador do motor deu
 * (`@simplifica-if/motor/falhas`: sem login, cota, rede ou proxy, CLI ausente, versão antiga, recusa
 * pelas regras de uso, tempo esgotado, serviço fora do ar…). Aqui o tipo vira uma frase em português,
 * com o que a pessoa pode fazer; o texto técnico (o `tecnico` da falha, a `mensagem` do `Erro`), curto
 * e saneado no servidor, fica em `detalhe`, que a interface mostra recolhido em "Detalhes técnicos".
 */
import { TipoFalha } from "@simplifica-if/contratos-app";
import * as Schema from "effect/Schema";
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

function frase(tipo: TipoFalha, nome: string, operacao: string): string {
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
    case "desconhecido":
      return `O ${nome} não conseguiu ${textoOperacao(operacao)}. Tente de novo; se o erro continuar, veja os detalhes técnicos.`;
  }
}

/** Uma `FalhaProvider` (ou os campos dela) em português, com o texto técnico em `detalhe`. */
export function explicarFalhaProvider(falha: {
  readonly provider: string;
  readonly operacao: string;
  readonly tipo: TipoFalha;
  readonly tecnico?: string | undefined;
}): MensagemErro {
  const tecnico = falha.tecnico === undefined ? "" : `: ${falha.tecnico}`;
  return {
    texto: frase(falha.tipo, nomeProvider(falha.provider), falha.operacao),
    detalhe: `${falha.provider}: falha em ${falha.operacao}${tecnico}`,
  };
}

/**
 * O evento `Erro` de um turno, pelo tipo. A mensagem é técnica, muitas vezes em inglês: sem tipo
 * conhecido, a frase genérica, e a mensagem fica em "Detalhes técnicos".
 */
export function explicarErroDoTurno(
  provider: string,
  erro: { readonly tipo: TipoFalha; readonly mensagem: string },
): MensagemErro {
  return { texto: frase(erro.tipo, nomeProvider(provider), "responder"), detalhe: erro.mensagem };
}

const ehTipoFalha = Schema.is(TipoFalha);

/** O tipo que chegou do servidor; um valor fora da lista vira `desconhecido`. */
const tipoConhecido = (tipo: unknown): TipoFalha => (ehTipoFalha(tipo) ? tipo : "desconhecido");

/** Os erros do motor que chegam à interface sem `FalhaProvider`, com a frase para a pessoa. */
const ERROS_DO_MOTOR: Readonly<Record<string, string>> = {
  TurnoEmAndamento: "A IA ainda está respondendo. Espere a resposta terminar ou use Interromper.",
  SessaoDesconhecida: "Esta conversa foi encerrada. Abra-a de novo pela lista de conversas.",
  AprovacaoDesconhecida: "Este pedido de permissão não vale mais: a resposta já seguiu sem ele.",
};

/**
 * A queda da conexão com o servidor local no meio de um pedido, como a pessoa a lê: sem "servidor",
 * "conexão" nem "WebSocket" (M1.14); o técnico vai para "Detalhes técnicos".
 */
export const PERDEU_CONTATO =
  "O Simplifica IF perdeu o contato com a parte do app que roda no seu computador. Espere alguns segundos e tente de novo.";

/** O erro que chegou de uma chamada ao servidor, em português. */
export function explicarErro(erro: unknown): MensagemErro {
  if (typeof erro === "object" && erro !== null) {
    const registro = erro as {
      readonly _tag?: unknown;
      readonly message?: unknown;
      readonly provider?: unknown;
      readonly operacao?: unknown;
      readonly tipo?: unknown;
      readonly tecnico?: unknown;
    };
    if (registro._tag === "RpcClientError")
      return {
        texto: PERDEU_CONTATO,
        detalhe: `Conexão com o servidor local caiu (RpcClientError)${typeof registro.message === "string" && registro.message.length > 0 ? `: ${registro.message}` : ""}`,
      };
    if (
      registro._tag === "FalhaProvider" &&
      typeof registro.provider === "string" &&
      typeof registro.operacao === "string"
    ) {
      return explicarFalhaProvider({
        provider: registro.provider,
        operacao: registro.operacao,
        tipo: tipoConhecido(registro.tipo),
        ...(typeof registro.tecnico === "string" ? { tecnico: registro.tecnico } : {}),
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
