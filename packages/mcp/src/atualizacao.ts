// @effect-diagnostics nodeBuiltinImport:off -- o simplifica-mcp fora do app: arquivos da pasta de atualização, antes de abrir a base
/**
 * A atualização da base no `simplifica-mcp` fora do app (piloto zero, M1.10), opcional: com
 * `--pasta-atualizacao` (ou `SIMPLIFICA_ATUALIZACAO_PASTA`), o mesmo mecanismo do servidor do app
 * (`@simplifica-if/atualizacao`), só para a base.
 *
 * - Na abertura, atende a troca pendente e abre a base mais nova entre a baixada e a do `--banco`.
 * - Sem base nenhuma (nem `--banco`, nem baixada), baixa antes de abrir.
 * - Depois, confere o feed na abertura e a cada 24 h, em segundo plano. A versão nova entra na próxima
 *   vez que o cliente MCP iniciar o servidor: o processo nunca troca o arquivo aberto.
 *
 * O feed e a chave pública vêm de `--feed-atualizacao` e `--chave-atualizacao` (ou
 * `SIMPLIFICA_ATUALIZACAO_FEED` e `SIMPLIFICA_ATUALIZACAO_CHAVE`): fora do app, não há política
 * embutida. Sem os dois, só a troca pendente e a escolha da base valem.
 */
import * as NodePath from "node:path";
import { type Abertura, prepararAbertura } from "@simplifica-if/atualizacao/local";
import type { Canal } from "@simplifica-if/atualizacao/manifesto";
import type { ChavePublica } from "@simplifica-if/atualizacao/minisign";
import { atualizarUmaVez, layerHttp, opcoesDaPolitica } from "@simplifica-if/atualizacao/remoto";
import * as Console from "effect/Console";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import { VERSAO_PACOTE } from "./servidor.ts";

interface OpcoesAtualizacaoMcp {
  readonly pasta: string;
  /** O `--banco` (a base instalada), se houver. */
  readonly banco: string | undefined;
  readonly feed: string | undefined;
  readonly chave: string | undefined;
  readonly canal: Canal;
}

const avisar = (texto: string) => Console.error(`simplifica-mcp: ${texto}`);

/** Uma conferência: baixa o que houver de novo (só a base) e deixa pendente. */
const conferir = Effect.fn("simplifica-mcp.conferirAtualizacao")(
  function* (
    opcoes: OpcoesAtualizacaoMcp,
    feed: { readonly feed: string; readonly chave: ChavePublica },
    abertura: Abertura,
    quando = "; entra na próxima vez que o servidor iniciar",
  ) {
    const resultado = yield* atualizarUmaVez({
      ...feed,
      canal: opcoes.canal,
      pasta: opcoes.pasta,
      versaoApp: VERSAO_PACOTE,
      abertura,
      soBase: true,
    }).pipe(Effect.provide(layerHttp()));
    if (resultado.tipo === "baixada") {
      yield* avisar(`base ${resultado.versao} baixada (${resultado.via})${quando}`);
    } else if (resultado.tipo === "app-desatualizado") {
      yield* avisar(`a base ${resultado.versao} pede o simplifica-mcp ${resultado.appMinimo} ou mais novo`);
    }
  },
  Effect.catch((erro) => avisar(`atualização: ${erro.message}`)),
);

/**
 * Prepara a abertura (troca pendente; sem base, baixa antes) e devolve o `kb.sqlite` a abrir e a
 * conferência periódica, para rodar em segundo plano. Sem feed e chave, só a troca pendente e a escolha
 * da base valem.
 */
export const prepararAtualizacao = Effect.fn("simplifica-mcp.prepararAtualizacao")(function* (
  opcoes: OpcoesAtualizacaoMcp,
) {
  const empacotada = opcoes.banco ?? NodePath.join(opcoes.pasta, "base", "sem-base-instalada.sqlite");
  const abrir = prepararAbertura({ pasta: opcoes.pasta, bancoEmpacotado: empacotada });
  let abertura = yield* abrir;
  for (const evento of abertura.eventos) yield* avisar(`atualização: ${evento}`);
  const politica =
    opcoes.feed === undefined || opcoes.chave === undefined
      ? undefined
      : opcoesDaPolitica({ feed: opcoes.feed, chave: opcoes.chave });
  if (politica?.desligada != null) yield* avisar(`atualização desligada: ${politica.desligada}`);
  const feed = politica?.desligada === null ? { feed: politica.feed, chave: politica.chave } : undefined;
  if (feed === undefined) return { banco: abertura.banco, umaVez: Effect.void, periodica: Effect.void };
  if (abertura.info === null) {
    yield* avisar("nenhuma base instalada; baixando a do canal antes de abrir…");
    yield* conferir(opcoes, feed, abertura, "");
    abertura = yield* abrir;
  }
  // A conferência roda em segundo plano, fora deste Effect: leva consigo o disco de quem a preparou.
  const servicos = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  const umaVez = conferir(opcoes, feed, abertura).pipe(Effect.provideContext(servicos));
  const periodica = umaVez.pipe(Effect.repeat(Schedule.spaced(Duration.hours(24))), Effect.asVoid);
  return { banco: abertura.banco, umaVez, periodica };
});
