/**
 * A tradução de erro do transporte RPC, a mesma para todos os métodos de todos os grupos (os do núcleo, em
 * `handlers.ts`, e os de cada módulo): a causa, defeitos inclusive, vai para o log do servidor (stderr) com
 * o código do erro (`codigoDoErro`, do `traceId` do pedido), com o `cause` de cada erro tipado trocado pelo
 * resumo dele (`resumoDaFalha`: o tipo e um texto técnico curto, sem caminhos, que podem trazer o nome da
 * pasta da tarefa ou de um anexo, nem trecho do pedido ou da resposta); e o `FalhaProvider`, a `FalhaPasta`
 * e o `FalhaDiagnostico` chegam à interface sem o `cause`. Do `cause` do `FalhaProvider` sai só o texto
 * técnico de "Detalhes técnicos" (`tecnico`), curto e saneado.
 */
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import {
  codigoDoErro,
  ehFalhaDiagnostico,
  ehFalhaPasta,
  FalhaDiagnostico,
  FalhaPasta,
} from "@simplifica-if/contratos-app";
import * as Motor from "@simplifica-if/motor";
import { resumoDaFalha } from "./observabilidade/resumoDaFalha.ts";

const ehFalhaProvider = Schema.is(Motor.FalhaProvider);

/** O texto técnico do `cause`, curto e saneado, ou nada se ele não tem texto. */
const tecnicoDe = (cause: unknown): { readonly tecnico?: string } => {
  const texto = Motor.textoDaCausa(cause);
  return texto === "" ? {} : { tecnico: Motor.textoTecnico(texto) };
};

/**
 * O erro como vai à interface: o `FalhaProvider`, a `FalhaPasta` e o `FalhaDiagnostico` sem o `cause`; o
 * `FalhaProvider` com o texto técnico dele.
 */
const paraInterface = <E>(erro: E): E =>
  ehFalhaProvider(erro)
    ? (new Motor.FalhaProvider({
        provider: erro.provider,
        operacao: erro.operacao,
        tipo: erro.tipo,
        ...tecnicoDe(erro.cause),
      }) as E)
    : ehFalhaPasta(erro)
      ? (new FalhaPasta({ motivo: erro.motivo }) as E)
      : ehFalhaDiagnostico(erro)
        ? (new FalhaDiagnostico({ motivo: erro.motivo }) as E)
        : erro;

/** Um campo `cause` presente: o erro tipado vai ao log com o resumo da causa no lugar dela. */
const temCausa = (erro: unknown): erro is { readonly cause: unknown } =>
  typeof erro === "object" && erro !== null && "cause" in erro && erro.cause !== undefined;

/**
 * O erro como vai ao log: o mesmo erro, com o `cause` trocado pelo resumo (`resumoDaFalha`), que não leva
 * caminho, nome de anexo nem texto do pedido ou da resposta.
 */
export const paraRegistro = <E>(erro: E): E => {
  if (!temCausa(erro)) return erro;
  const resumo = resumoDaFalha(erro.cause);
  if (ehFalhaProvider(erro))
    return new Motor.FalhaProvider({
      provider: erro.provider,
      operacao: erro.operacao,
      tipo: erro.tipo,
      cause: resumo,
    }) as E;
  if (ehFalhaPasta(erro)) return new FalhaPasta({ motivo: erro.motivo, cause: resumo }) as E;
  if (ehFalhaDiagnostico(erro)) return new FalhaDiagnostico({ motivo: erro.motivo, cause: resumo }) as E;
  return erro;
};

/** O log anotado com o código do erro (`codigoDoErro`), tirado do span do pedido, se houver um. */
const comCodigo = <A, E, R>(efeito: Effect.Effect<A, E, R>) =>
  Effect.flatMap(Effect.option(Effect.currentSpan), (span) =>
    Option.isSome(span) ? Effect.annotateLogs(efeito, { codigo: codigoDoErro(span.value.traceId) }) : efeito,
  );

/**
 * Registra a causa: o erro tipado como aviso, com o resumo do `cause` dele (`paraRegistro`), e o defeito
 * (um `orDie`, uma exceção) como erro. Interrupção não é erro.
 */
const registrar = (metodo: string, causa: Cause.Cause<unknown>) =>
  Cause.hasInterruptsOnly(causa)
    ? Effect.void
    : comCodigo(
        Cause.hasDies(causa)
          ? Effect.logError(`RPC ${metodo}: defeito`, Cause.map(causa, paraRegistro))
          : Effect.logWarning(`RPC ${metodo} falhou`, Cause.map(causa, paraRegistro)),
      );

/**
 * A tradução de erro do transporte, a mesma para todos os métodos de todos os grupos: registra no log
 * do servidor a causa inteira, defeitos inclusive, e manda o erro à interface por `paraInterface`.
 */
export const traduzir = <A, E, R>(metodo: string, efeito: Effect.Effect<A, E, R>) =>
  efeito.pipe(
    Effect.tapCause((causa) => registrar(metodo, causa)),
    Effect.mapError((erro: E) => paraInterface(erro)),
  );

/** `traduzir` para os métodos que respondem em stream. */
export const traduzirStream = <A, E, R>(metodo: string, stream: Stream.Stream<A, E, R>) =>
  stream.pipe(
    Stream.onError((causa) => registrar(metodo, causa)),
    Stream.mapError((erro: E) => paraInterface(erro)),
  );
