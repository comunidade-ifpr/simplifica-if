/**
 * O diagnóstico da interface: o que dá errado na janela vai para o log do app (`simplifica-if.log`, pelo
 * `PonteDesktop.registrarErro`), além do console, que ninguém vê no app empacotado.
 *
 * - `layerTracer`: o tracer do runtime da interface. É o nativo do Effect, que guarda os spans em memória,
 *   com uma diferença: o span de cliente do RPC que termina num defeito ou na queda do transporte
 *   (`RpcClientError`) vai para o log, com o método e o código do erro (`codigoDoErro`). O erro tipado não:
 *   o servidor já o registra com o mesmo código. O payload que o servidor recusa (contrato diferente entre a
 *   interface e o servidor) só aparece aqui: ele nunca chega ao handler. A queda da conexão derruba todas as
 *   chamadas em curso de uma vez (e acontece de propósito a cada reinício do servidor): vira uma linha só
 *   por janela de `JANELA_QUEDA_MS`, com os códigos das chamadas afetadas (`agruparQuedas`).
 * - `instalarRegistroDeErros`: os erros sem dono da janela (`error`, `unhandledrejection`).
 *
 * Antes de ir ao log, o texto perde os valores que o Schema cita nas recusas (`omitirValores`: podem ser o
 * perfil ou o que a pessoa digitou), é cortado (`cortarRegistro`) e passa por um limite de frequência
 * (`limitarFrequencia`): a mesma linha uma vez por minuto, e no máximo `MAXIMO_POR_MINUTO` linhas.
 */
import { codigoDoErro, cortarRegistro } from "@simplifica-if/contratos-app/ponte";
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Tracer from "effect/Tracer";
import { temCodigo } from "./conexao/erros.ts";
import { ponteDesktop } from "./ponte-desktop.ts";

/* ---------------------------------------------------------- valores omitidos */

const OMITIDO = "[valor omitido]";

/**
 * Onde o formatador padrão do Schema (`SchemaIssue.makeFormatterDefault`) põe o valor recebido: depois de
 * `, got `, `Invalid data `, `Unexpected key with value ` e `Expected exactly one member to match the input `,
 * até o fim da linha.
 */
const COM_VALOR =
  /(, got |\bInvalid data |\bUnexpected key with value |\bExpected exactly one member to match the input ).*$/;

/** Uma linha que não é continuação do valor: o caminho (`  at …`), a pilha ou outra mensagem do Schema. */
const FIM_DO_VALOR = /^\s*$|^\s*at\s|^\s*(Expected|Missing key|Invalid data|Unexpected key|Forbidden)\b/;

/**
 * O texto sem os valores que uma recusa do Schema cita. O valor costuma ocupar o resto da linha; um valor
 * de várias linhas (um `toString` próprio) tem as linhas seguintes omitidas até o caminho ou a próxima
 * mensagem.
 */
export function omitirValores(texto: string): string {
  const saida: Array<string> = [];
  let dentroDoValor = false;
  for (const linha of texto.split("\n")) {
    if (dentroDoValor && !FIM_DO_VALOR.test(linha)) continue;
    dentroDoValor = COM_VALOR.test(linha);
    saida.push(dentroDoValor ? linha.replace(COM_VALOR, `$1${OMITIDO}`) : linha);
  }
  return saida.join("\n");
}

/* ---------------------------------------------------------- limite de frequência */

/** A janela do limite de frequência. */
export const JANELA_LIMITE_MS = 60_000;
/** Quantas linhas por janela; o resto vira uma linha "N registros suprimidos". */
export const MAXIMO_POR_MINUTO = 30;

export interface OpcoesLimite {
  readonly agora: () => number;
  readonly gravar: (linha: string) => void;
}

/**
 * Um limite de frequência: a mesma linha só uma vez por janela (o StrictMode do desenvolvimento monta a
 * tela de erro duas vezes) e no máximo `MAXIMO_POR_MINUTO` linhas por janela. Quando a janela vira, o
 * próximo registro vem depois de uma linha com quantos foram suprimidos.
 */
export function limitarFrequencia(opcoes: OpcoesLimite): (linha: string) => void {
  let inicio: number | undefined;
  let vistas = new Set<string>();
  let suprimidos = 0;
  return (linha) => {
    const agora = opcoes.agora();
    if (inicio === undefined || agora - inicio >= JANELA_LIMITE_MS) {
      if (suprimidos > 0)
        opcoes.gravar(`${suprimidos} registros suprimidos no último minuto (repetidos ou acima do limite)`);
      inicio = agora;
      vistas = new Set();
      suprimidos = 0;
    }
    if (vistas.has(linha) || vistas.size >= MAXIMO_POR_MINUTO) {
      suprimidos += 1;
      return;
    }
    vistas.add(linha);
    opcoes.gravar(linha);
  };
}

/** Grava no console e no log do app. Nunca falha. */
function gravarNoLog(linha: string): void {
  console.error(`[interface] ${linha}`);
  try {
    void ponteDesktop()
      ?.registrarErro?.(linha)
      .catch(() => undefined);
  } catch {
    // O log nunca derruba a interface.
  }
}

const gravarLimitado = limitarFrequencia({ agora: () => Date.now(), gravar: gravarNoLog });

/** Grava uma linha no log do app (no navegador, só no console), sem valores, cortada e limitada. Nunca falha. */
export function registrarErro(texto: string): void {
  gravarLimitado(cortarRegistro(omitirValores(texto)));
}

/**
 * O texto de um valor qualquer lançado: a pilha do `Error`; de outro objeto, só o `_tag` e os nomes das
 * chaves (os valores podem ser dado da pessoa).
 */
export function textoDoErro(erro: unknown): string {
  if (erro instanceof Error) return erro.stack ?? `${erro.name}: ${erro.message}`;
  if (typeof erro === "string") return erro;
  if (typeof erro === "object" && erro !== null) {
    const tag = "_tag" in erro && typeof erro._tag === "string" ? `${erro._tag} ` : "";
    let chaves: Array<string>;
    try {
      chaves = Object.keys(erro);
    } catch {
      chaves = [];
    }
    return `${tag}{${chaves.join(", ")}}`;
  }
  return typeof erro;
}

/* ---------------------------------------------------------- tracer */

const ehRpcClientError = (erro: unknown): erro is { readonly _tag: "RpcClientError"; readonly message?: unknown } =>
  typeof erro === "object" && erro !== null && "_tag" in erro && erro._tag === "RpcClientError";

/** A queda do transporte (`RpcClientError`), se a causa é só ela. */
function quedaDaConexao(causa: Cause.Cause<unknown>): { readonly message?: unknown } | undefined {
  if (Cause.hasDies(causa)) return undefined;
  const erro = Cause.findError(causa);
  return Result.isSuccess(erro) && ehRpcClientError(erro.success) ? erro.success : undefined;
}

/** Um defeito ou a queda do transporte; o erro tipado e a interrupção não. */
export function ehFalhaInesperada(causa: Cause.Cause<unknown>): boolean {
  if (Cause.hasInterruptsOnly(causa)) return false;
  const erro = Cause.findError(causa);
  return Result.isFailure(erro) || ehRpcClientError(erro.success);
}

/** A janela em que as quedas da conexão viram uma linha só. */
export const JANELA_QUEDA_MS = 10_000;
/** Quantos códigos a linha da queda lista. */
export const MAXIMO_CODIGOS_QUEDA = 20;

export interface OpcoesQuedas {
  readonly registrar: (texto: string) => void;
  /** Roda `acao` daqui a `ms` (o `setTimeout`, trocado nos testes). */
  readonly agendar: (acao: () => void, ms: number) => void;
}

export interface AgrupadorQuedas {
  /** Uma chamada que caiu com a conexão. */
  readonly anotar: (codigo: string, metodo: string, motivo: string) => void;
  /** Grava agora a linha da janela em curso, se houver (a página vai fechar). */
  readonly descarregar: () => void;
}

/**
 * As quedas da conexão, agrupadas: a primeira abre uma janela de `JANELA_QUEDA_MS`, e ao fim dela vai ao
 * log uma linha com quantas chamadas caíram e os códigos delas (até `MAXIMO_CODIGOS_QUEDA`), para o código
 * que a pessoa informa continuar achável.
 */
export function agruparQuedas(opcoes: OpcoesQuedas): AgrupadorQuedas {
  let afetadas: Array<string> = [];
  let total = 0;
  let motivoDaJanela = "";
  let aberta = false;

  const descarregar = () => {
    if (!aberta) return;
    aberta = false;
    const mais = total > afetadas.length ? ` e mais ${total - afetadas.length}` : "";
    const motivo = motivoDaJanela === "" ? "" : `; motivo: ${motivoDaJanela}`;
    opcoes.registrar(
      `conexão com o servidor caiu: ${total} ${total === 1 ? "chamada afetada" : "chamadas afetadas"} ` +
        `(códigos ${afetadas.join(", ")}${mais})${motivo}`,
    );
    afetadas = [];
    total = 0;
    motivoDaJanela = "";
  };

  return {
    anotar(codigo, metodo, motivo) {
      if (!aberta) {
        aberta = true;
        motivoDaJanela = motivo.split("\n")[0]!.slice(0, 200);
        opcoes.agendar(descarregar, JANELA_QUEDA_MS);
      }
      total += 1;
      if (afetadas.length < MAXIMO_CODIGOS_QUEDA) afetadas.push(`${codigo} ${metodo}`);
    },
    descarregar,
  };
}

const quedas = agruparQuedas({
  registrar: registrarErro,
  agendar: (acao, ms) => void setTimeout(acao, ms),
});

export interface OpcoesTracer {
  readonly registrar: (texto: string) => void;
  readonly quedas: Pick<AgrupadorQuedas, "anotar">;
}

/** O tracer nativo, com o registro das chamadas RPC que terminam numa falha inesperada. */
export function criarTracer(opcoes: OpcoesTracer): Tracer.Tracer {
  class SpanComRegistro extends Tracer.NativeSpan {
    override end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
      const jaTerminou = this.status._tag === "Ended";
      super.end(endTime, exit);
      if (jaTerminou || this.kind !== "client" || Exit.isSuccess(exit) || !ehFalhaInesperada(exit.cause)) return;
      const codigo = codigoDoErro(this.traceId);
      const queda = quedaDaConexao(exit.cause);
      if (queda !== undefined) {
        opcoes.quedas.anotar(codigo, this.name, typeof queda.message === "string" ? queda.message : "");
        return;
      }
      opcoes.registrar(`erro ${codigo} em ${this.name}: ${Cause.pretty(exit.cause)}`);
    }
  }
  return Tracer.make({ span: (opcoesSpan) => new SpanComRegistro(opcoesSpan) });
}

export const tracer: Tracer.Tracer = criarTracer({ registrar: registrarErro, quedas });

export const layerTracer = Layer.succeed(Tracer.Tracer, tracer);

/** Registra os erros sem dono da janela. Chamado uma vez, na partida da interface. */
export function instalarRegistroDeErros(): void {
  window.addEventListener("error", (evento) => {
    registrarErro(`erro na janela: ${textoDoErro(evento.error ?? evento.message)}`);
  });
  window.addEventListener("unhandledrejection", (evento) => {
    // O erro de uma chamada ao servidor (com código) já foi registrado: pelo tracer, se inesperado, ou
    // pelo servidor, se tipado.
    if (temCodigo(evento.reason)) return;
    registrarErro(`promessa rejeitada sem tratamento: ${textoDoErro(evento.reason)}`);
  });
  // As quedas da janela em curso não se perdem quando a página recarrega ou fecha.
  window.addEventListener("pagehide", () => quedas.descarregar());
}
