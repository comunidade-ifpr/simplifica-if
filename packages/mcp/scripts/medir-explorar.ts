// @effect-diagnostics globalConsoleInEffect:off globalConsole:off globalJsonInEffect:off -- script de medição: imprime os tempos no terminal
/**
 * Mede o tempo das consultas do Explorar (`explorarIndice`, `explorarBuscar`) no `kb.sqlite` real, pelo
 * serviço `Leitura` (o mesmo dos handlers RPC), para o critério "menos de 200 ms por consulta".
 *
 *   node packages/mcp/scripts/medir-explorar.ts [tmp/kb.sqlite]
 *
 * Mostra a primeira chamada (que monta o índice) e a mediana e o máximo de 20 repetições de cada busca
 * (o máximo é quase sempre a primeira, com o banco frio). Sai com erro se alguma passar de 200 ms, o
 * critério do Explorar no plano.
 */
import * as Effect from "effect/Effect";
import { Leitura, layerLeitura } from "../src/rpc.ts";

const banco = process.argv[2] ?? "tmp/kb.sqlite";
const CONSULTAS = [
  "Res. CNE/CP 1/2021, art. 20",
  "ldb art 36",
  "enfermagem",
  "técnico em informática curitiba",
  "acompanhamento de egressos",
  "estágio supervisionado",
  "curso",
  "abertura de curso",
  "CT-CURR",
  "londrina",
  "agro",
  "a",
];

const ms = (inicio: bigint) => Number(process.hrtime.bigint() - inicio) / 1e6;
const LIMITE_MS = 200;
let acimaDoLimite = 0;

const programa = Effect.gen(function* () {
  const leitura = yield* Leitura;
  let inicio = process.hrtime.bigint();
  const indice = yield* leitura.explorarIndice({});
  const primeira = ms(inicio);
  if (primeira > LIMITE_MS) acimaDoLimite++;
  console.log(`explorarIndice, 1ª chamada: ${primeira.toFixed(1)} ms (${JSON.stringify(indice).length} bytes)`);
  inicio = process.hrtime.bigint();
  yield* leitura.explorarIndice({});
  console.log(`explorarIndice, guardado: ${ms(inicio).toFixed(1)} ms`);
  for (const consulta of CONSULTAS) {
    const tempos: number[] = [];
    let grupos = "";
    for (let i = 0; i < 20; i++) {
      const t = process.hrtime.bigint();
      const r = yield* leitura.explorarBuscar({ consulta, limite: 6 });
      tempos.push(ms(t));
      grupos = r.dados.grupos.map((g) => `${g.tipo}:${g.resultados.length}`).join(" ");
    }
    tempos.sort((a, b) => a - b);
    if (tempos.at(-1)! > LIMITE_MS) acimaDoLimite++;
    console.log(
      `${JSON.stringify(consulta).padEnd(36)} mediana ${tempos[10]!.toFixed(1)} ms, máx ${tempos.at(-1)!.toFixed(1)} ms  [${grupos}]`,
    );
  }
});

await Effect.runPromise(programa.pipe(Effect.provide(layerLeitura({ banco, canal: "dev" }))));
if (acimaDoLimite > 0) {
  console.error(`${acimaDoLimite} consulta(s) acima de ${LIMITE_MS} ms`);
  process.exitCode = 1;
}
