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
import { lerChavePublica } from "@simplifica-if/atualizacao/minisign";
import { atualizarUmaVez, baixarComFetch } from "@simplifica-if/atualizacao/remoto";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import { VERSAO_PACOTE } from "./servidor.ts";

export interface OpcoesAtualizacaoMcp {
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
    abertura: Abertura,
    quando = "; entra na próxima vez que o servidor iniciar",
  ) {
    if (opcoes.feed === undefined || opcoes.chave === undefined) return;
    const feed = opcoes.feed;
    const textoChave = opcoes.chave;
    const agora = DateTime.formatIso(yield* DateTime.now);
    const resultado = yield* Effect.tryPromise({
      try: () =>
        atualizarUmaVez({
          feed,
          canal: opcoes.canal,
          chave: lerChavePublica(textoChave),
          agora,
          contexto: {
            pasta: opcoes.pasta,
            versaoApp: VERSAO_PACOTE,
            baseEmUso: { caminho: abertura.banco, info: abertura.info },
            versoesSkills: {},
            baixar: baixarComFetch(),
            comSkills: false,
          },
        }),
      catch: (erro) => (erro instanceof Error ? erro.message : String(erro)),
    });
    if (resultado.tipo === "baixada") {
      yield* avisar(`base ${resultado.versao} baixada (${resultado.via})${quando}`);
    } else if (resultado.tipo === "app-desatualizado") {
      yield* avisar(`a base ${resultado.versao} pede o simplifica-mcp ${resultado.appMinimo} ou mais novo`);
    }
  },
  Effect.catch((erro) => avisar(`atualização: ${erro}`)),
);

/**
 * Prepara a abertura (troca pendente; sem base, baixa antes) e devolve o `kb.sqlite` a abrir e a
 * conferência periódica, para rodar em segundo plano.
 */
export const prepararAtualizacao = Effect.fn("simplifica-mcp.prepararAtualizacao")(function* (
  opcoes: OpcoesAtualizacaoMcp,
) {
  const empacotada = opcoes.banco ?? NodePath.join(opcoes.pasta, "base", "sem-base-instalada.sqlite");
  let abertura = prepararAbertura({ pasta: opcoes.pasta, bancoEmpacotado: empacotada });
  for (const evento of abertura.eventos) yield* avisar(`atualização: ${evento}`);
  if (abertura.info === null && opcoes.feed !== undefined && opcoes.chave !== undefined) {
    yield* avisar("nenhuma base instalada; baixando a do canal antes de abrir…");
    yield* conferir(opcoes, abertura, "");
    abertura = prepararAbertura({ pasta: opcoes.pasta, bancoEmpacotado: empacotada });
  }
  const umaVez = conferir(opcoes, abertura);
  const periodica = umaVez.pipe(Effect.repeat(Schedule.spaced(Duration.hours(24))), Effect.asVoid);
  return { banco: abertura.banco, umaVez, periodica };
});
