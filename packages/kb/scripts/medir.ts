/**
 * Mede o kb: a latência das consultas pesadas pelos serviços, sobre o `kb.sqlite` aberto só para
 * leitura (`layerSomenteLeitura`, o caminho do servidor MCP), e o tempo de uma compilação inteira.
 *
 *   node packages/kb/scripts/medir.ts [--banco tmp/kb.sqlite] [--repeticoes 20] [--sem-compilar]
 *
 * Cada consulta roda uma vez para aquecer e depois `--repeticoes` vezes; imprime a mediana e o
 * máximo em milissegundos. O limite do plano (M2.1) é de 200 ms por consulta. A compilação grava
 * num diretório temporário e não toca no `tmp/kb.sqlite`.
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Clock from "effect/Clock";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import * as Compilador from "../src/Compilador.ts";
import * as Cursos from "../src/Cursos.ts";
import type * as FontesNormativas from "../src/FontesNormativas.ts";
import type * as Sql from "../src/db/sql.ts";
import * as Impacto from "../src/Impacto.ts";
import * as Layers from "../src/layers.ts";
import * as Normas from "../src/Normas.ts";
import * as PacoteContexto from "../src/PacoteContexto.ts";
import * as Ppcs from "../src/Ppcs.ts";
import { raizRepositorio } from "../src/normas/registro.ts";

type Erro =
  | Sql.FalhaNaConsulta
  | FontesNormativas.FalhaNasFontes
  | PacoteContexto.PpcNaoEncontrado
  | PacoteContexto.GrupoInexistente
  | PacoteContexto.TarefaNaoReconhecida;

const CONSULTAS: ReadonlyArray<readonly [string, Effect.Effect<unknown, Erro, Layers.ServicosConsulta>]> = [
  ["buscar-secoes", Ppcs.Ppcs.use((p) => p.buscarSecoes("acompanhamento de egressos", {}, { limite: 10 }))],
  [
    "buscar-secoes --integral",
    Ppcs.Ppcs.use((p) =>
      p.buscarSecoes("estágio obrigatório", { ppc: "curitiba/tecnico-em-enfermagem" }, { limite: 3, integral: true }),
    ),
  ],
  ["buscar-norma (termos)", Normas.Normas.use((n) => n.buscar("estágio supervisionado obrigatório"))],
  ["buscar-norma (citação)", Normas.Normas.use((n) => n.buscar("Resolução CNE/CP nº 2/2026, art. 28"))],
  ["cursos --campus curitiba", Cursos.Cursos.use((c) => c.listar({ campus: "curitiba" }))],
  ["cursos (todos)", Cursos.Cursos.use((c) => c.listar())],
  ["adequacao-art71", Cursos.Cursos.use((c) => c.adequacaoArt71())],
  ["ppc-fatos --divergencias", Ppcs.Ppcs.use((p) => p.divergencias({ nivel: "médio" }))],
  ["citacoes br/cne-cp/res/2021/1", Ppcs.Ppcs.use((p) => p.relatorioCitacoes("br/cne-cp/res/2021/1"))],
  ["impacto br/cne-cp/res/2021/1", Impacto.Impacto.use((i) => i.daNorma("br/cne-cp/res/2021/1"))],
  ["correspondencia #art20", Normas.Normas.use((n) => n.correspondencia("br/cne-cp/res/2021/1#art20"))],
  [
    "pacote-contexto CT-CURR-12",
    PacoteContexto.PacoteContexto.use((p) => p.montar("CT-CURR-12", "curitiba/tecnico-em-enfermagem")),
  ],
];

const cronometrar = Effect.fnUntraced(function* <A, E, R>(efeito: Effect.Effect<A, E, R>) {
  const inicio = yield* Clock.currentTimeNanos;
  yield* efeito;
  const fim = yield* Clock.currentTimeNanos;
  return Number(fim - inicio) / 1e6;
});

const formatar = (ms: number) => ms.toFixed(1).padStart(8);

const medir = Command.make(
  "medir",
  {
    banco: Flag.String("banco").pipe(Flag.optional),
    repeticoes: Flag.Int("repeticoes").pipe(Flag.withDefault(20)),
    semCompilar: Flag.Boolean("sem-compilar").pipe(Flag.withDefault(false)),
  },
  Effect.fn("medir")(function* ({ banco, repeticoes, semCompilar }) {
    const path = yield* Path.Path;
    const raiz = raizRepositorio();
    const caminho = Option.isSome(banco) ? path.resolve(banco.value) : path.join(raiz, "tmp", "kb.sqlite");

    const abertura = yield* cronometrar(
      Effect.scoped(
        Effect.asVoid(
          Effect.provide(
            Normas.Normas.useSync(() => undefined),
            Layers.layerSomenteLeitura({ caminho }),
          ),
        ),
      ),
    );
    yield* Console.log(`abertura de layerSomenteLeitura: ${abertura.toFixed(1)} ms`);
    yield* Console.log(`${"consulta".padEnd(32)} mediana    máximo  (ms, ${repeticoes} repetições)`);
    yield* Effect.gen(function* () {
      for (const [nome, consulta] of CONSULTAS) {
        yield* consulta;
        const tempos: number[] = [];
        for (let i = 0; i < repeticoes; i++) tempos.push(yield* cronometrar(consulta));
        tempos.sort((a, b) => a - b);
        const mediana = tempos[Math.floor(tempos.length / 2)]!;
        yield* Console.log(`${nome.padEnd(32)}${formatar(mediana)}  ${formatar(tempos.at(-1)!)}`);
      }
    }).pipe(Effect.provide(Layers.layerSomenteLeitura({ caminho })));

    if (semCompilar) return;
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "kb-medir-" });
    const compilacao = yield* cronometrar(
      Compilador.Compilador.use((c) => c.compilar({ raiz, destino: path.join(dir, "kb.sqlite") })),
    );
    yield* Console.log(`compilação: ${(compilacao / 1000).toFixed(1)} s`);
  }, Effect.scoped),
);

medir.pipe(
  Command.run({ version: "0.1.0" }),
  Effect.provide(Layer.provideMerge(Compilador.layer, NodeServices.layer)),
  NodeRuntime.runMain,
);
