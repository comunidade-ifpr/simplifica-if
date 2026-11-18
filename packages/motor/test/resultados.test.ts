/**
 * O resumo das ferramentas MCP completado com o que o servidor do app viu (`src/resultados.ts`): o
 * `Motor` sobre um driver falso que segue um roteiro, com um servidor MCP falso cujo `resultados` é
 * uma fila que o roteiro alimenta antes de cada evento, como o servidor real, que publica a chamada
 * antes de responder ao provider. O último teste repassa a gravação real do Antigravity pelo
 * normalizador dele, com o `read_resource` casado com a leitura de recurso que o servidor registra
 * (o URI no lugar do nome da ferramenta).
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as Canal from "../src/Canal.ts";
import { criarNormalizadorAntigravity, type EntradaAcp } from "../src/drivers/antigravity.ts";
import * as Motor from "../src/Motor.ts";

/** Um passo do roteiro: o servidor vê uma chamada, ou o driver emite um evento. */
type Passo =
  | { readonly chamada: Motor.ResultadoFerramenta }
  | { readonly evento: Motor.Evento | ReadonlyArray<Motor.Evento> };

/** Driver falso: no turno `n`, segue `roteiros[n]` e termina com `FimTurno`. */
const driverRoteiro = (
  roteiros: ReadonlyArray<ReadonlyArray<Passo>>,
  servidor: Queue.Queue<Motor.ResultadoFerramenta>,
): Motor.Driver => ({
  detectar: Effect.succeed({ provider: "antigravity", instalado: true, autenticado: true }),
  iniciar: () =>
    Effect.gen(function* () {
      const canal = yield* Canal.make;
      const escopo = yield* Effect.scope;
      let turno = 0;
      const seguir = (roteiro: ReadonlyArray<Passo>) =>
        Effect.gen(function* () {
          for (const passo of roteiro) {
            if ("chamada" in passo) yield* Queue.offer(servidor, passo.chamada);
            else yield* Effect.forEach([passo.evento].flat(), canal.emitir, { discard: true });
          }
          yield* canal.emitir({ _tag: "FimTurno", motivo: "end_turn" });
        });
      return {
        enviar: () => canal.turno(Effect.asVoid(Effect.forkIn(seguir(roteiros[turno++] ?? []), escopo))),
        responder: canal.responder,
        interromper: Effect.void,
      } satisfies Motor.SessaoDriver;
    }),
});

/** Abre uma sessão do Antigravity com o servidor `ifpr` falso e devolve o id e a fila do servidor. */
const sessaoCom = (roteiros: ReadonlyArray<ReadonlyArray<Passo>>, comResultados = true) =>
  Effect.gen(function* () {
    const servidor = yield* Queue.unbounded<Motor.ResultadoFerramenta>();
    const driver = driverRoteiro(roteiros, servidor);
    const contexto = yield* Layer.build(
      Motor.layer.pipe(
        Layer.provide(
          Layer.succeed(Motor.Drivers, Motor.Drivers.of({ claude: driver, codex: driver, antigravity: driver })),
        ),
        Layer.provide(NodeServices.layer),
      ),
    );
    const motor = yield* Effect.service(Motor.Motor).pipe(Effect.provide(contexto));
    const sessao = yield* motor.iniciarSessao({
      provider: "antigravity",
      pastaTrabalho: "/tmp",
      servidoresMcp: [
        {
          tipo: "http",
          nome: "ifpr",
          url: "http://127.0.0.1:1/mcp",
          preAprovado: true,
          ...(comResultados ? { resultados: Stream.fromQueue(servidor) } : {}),
        },
      ],
    });
    const turno = () => Stream.runCollect(motor.enviarMensagem(sessao, "olá"));
    return { turno };
  });

const concluida = (id: string, nome: string, resumo = "", falhou = false): Motor.Evento => ({
  _tag: "FerramentaConcluida",
  id,
  nome,
  resumo,
  falhou,
});
const iniciada = (id: string, nome: string, entrada: unknown): Motor.Evento => ({
  _tag: "FerramentaIniciada",
  id,
  nome,
  entrada,
});
const chamada = (ferramenta: string, resumo: string, falhou = false): Passo => ({
  chamada: { ferramenta, resumo, falhou },
});

const resumos = (eventos: ReadonlyArray<Motor.Evento>) =>
  eventos.flatMap((evento) => (evento._tag === "FerramentaConcluida" ? [[evento.id, evento.resumo]] : []));

describe("resultados do servidor MCP", () => {
  it.effect("completa o resumo vazio pela ordem e pelo nome da ferramenta", () =>
    Effect.gen(function* () {
      const { turno } = yield* sessaoCom([
        [
          // Duas chamadas em paralelo terminam fora da ordem dos eventos.
          chamada("ficha_curso", "Técnico em Enfermagem"),
          chamada("buscar_norma", "Resolução CNE/CP nº 2/2026"),
          { evento: concluida("a1", "ifpr.buscar_norma") },
          { evento: concluida("a2", "ifpr.ficha_curso") },
          chamada("buscar_norma", "Lei nº 9.394/1996"),
          { evento: concluida("a3", "ifpr.buscar_norma") },
          // Ferramenta que não é do servidor: segue como veio, sem esperar.
          { evento: concluida("x1", "read_resource", "", true) },
        ],
      ]);
      const eventos = yield* turno();
      assert.deepStrictEqual(resumos(eventos), [
        ["a1", "Resolução CNE/CP nº 2/2026"],
        ["a2", "Técnico em Enfermagem"],
        ["a3", "Lei nº 9.394/1996"],
        ["x1", ""],
      ]);
      assert.strictEqual(eventos.at(-1)?._tag, "FimTurno");
    }).pipe(Effect.scoped),
  );

  it.effect("read_resource do Antigravity: casa com a leitura do URI no servidor ServerName", () =>
    Effect.gen(function* () {
      const uri = "ifpr://cnct/tecnico-em-enfermagem";
      const { turno } = yield* sessaoCom([
        [
          // O servidor registra a leitura com o URI no lugar do nome; uma ferramenta lida antes não atrapalha.
          chamada("buscar_norma", "Resolução CNE/CP nº 2/2026"),
          chamada(uri, "Técnico em Enfermagem (CNCT)"),
          { evento: iniciada("r1", "read_resource", { ServerName: "ifpr", Uri: uri }) },
          { evento: concluida("r1", "read_resource") },
          { evento: concluida("b1", "ifpr.buscar_norma") },
          // De outro servidor, ou sem a entrada esperada: segue como veio, sem esperar.
          { evento: iniciada("r2", "read_resource", { ServerName: "outro", Uri: uri }) },
          { evento: concluida("r2", "read_resource") },
          { evento: iniciada("r3", "read_resource", { uri }) },
          { evento: concluida("r3", "read_resource") },
        ],
      ]);
      assert.deepStrictEqual(resumos(yield* turno()), [
        ["r1", "Técnico em Enfermagem (CNCT)"],
        ["b1", "Resolução CNE/CP nº 2/2026"],
        ["r2", ""],
        ["r3", ""],
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("o resumo do provider prevalece, mas a chamada é consumida para não desalinhar", () =>
    Effect.gen(function* () {
      const { turno } = yield* sessaoCom([
        [
          chamada("buscar_norma", "do servidor 1"),
          { evento: concluida("c1", "ifpr.buscar_norma", "do provider") },
          chamada("buscar_norma", "do servidor 2"),
          { evento: concluida("c2", "ifpr.buscar_norma") },
        ],
      ]);
      assert.deepStrictEqual(resumos(yield* turno()), [
        ["c1", "do provider"],
        ["c2", "do servidor 2"],
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("sem a chamada no servidor, espera ESPERA_RESULTADO e segue com o resumo vazio", () =>
    Effect.gen(function* () {
      const { turno } = yield* sessaoCom([[{ evento: concluida("s1", "ifpr.buscar_norma", "", true) }]]);
      const fibra = yield* Effect.forkChild(turno(), { startImmediately: true });
      yield* TestClock.adjust("1 second");
      assert.deepStrictEqual(resumos(yield* Fiber.join(fibra)), [["s1", ""]]);
    }).pipe(Effect.scoped),
  );

  it.effect("descarta, no início do turno, as chamadas que sobraram do anterior", () =>
    Effect.gen(function* () {
      const { turno } = yield* sessaoCom([
        // O servidor viu uma chamada que o provider não informou.
        [chamada("buscar_norma", "sobra")],
        [chamada("buscar_norma", "do turno 2"), { evento: concluida("t2", "ifpr.buscar_norma") }],
      ]);
      yield* turno();
      yield* Effect.yieldNow;
      assert.deepStrictEqual(resumos(yield* turno()), [["t2", "do turno 2"]]);
    }).pipe(Effect.scoped),
  );

  it.effect("sem resultados no servidor, os eventos seguem como vieram", () =>
    Effect.gen(function* () {
      const { turno } = yield* sessaoCom(
        [[chamada("buscar_norma", "ignorada"), { evento: concluida("n1", "ifpr.buscar_norma") }]],
        false,
      );
      assert.deepStrictEqual(resumos(yield* turno()), [["n1", ""]]);
    }).pipe(Effect.scoped),
  );

  it.effect("gravação do Antigravity: as ferramentas ifpr ganham o resumo do servidor", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const linhas = (yield* fs.readFileString(path.join(import.meta.dirname, "fixtures", "antigravity-cnct.jsonl")))
        .split("\n")
        .filter((linha) => linha.trim() !== "")
        .map((linha) => JSON.parse(linha) as { direcao: string; mensagem: Record<string, unknown> })
        .filter(
          ({ direcao, mensagem: m }) =>
            direcao === "entrada" &&
            (m.tipo === "session/update" || (m.tipo === "session/prompt" && m.resposta !== undefined)),
        );
      // O normalizador real, sem mudança; antes de cada `FerramentaConcluida` de `ifpr`, o servidor
      // falso vê a chamada, e antes do `read_resource`, a leitura do URI, como o servidor do app a
      // registra (na gravação, de antes dos recursos, a leitura falhou sem chegar ao servidor). O
      // `FimTurno` da gravação fica de fora: o roteiro termina o turno.
      const normalizar = criarNormalizadorAntigravity(["ifpr"]);
      const uris = new Map<string, string>();
      const roteiro = linhas.flatMap(({ mensagem }): ReadonlyArray<Passo> =>
        normalizar(mensagem as unknown as EntradaAcp)
          .filter((evento) => evento._tag !== "FimTurno")
          .flatMap((evento): ReadonlyArray<Passo> => {
            if (evento._tag === "FerramentaIniciada" && evento.nome === "read_resource") {
              uris.set(evento.id, (evento.entrada as { readonly Uri: string }).Uri);
            }
            if (evento._tag !== "FerramentaConcluida") return [{ evento }];
            const nome = evento.nome.startsWith("ifpr.") ? evento.nome.slice(5) : uris.get(evento.id);
            return nome === undefined ? [{ evento }] : [chamada(nome, `resultado de ${nome}`), { evento }];
          }),
      );
      const { turno } = yield* sessaoCom([roteiro]);
      const concluidas = (yield* turno()).filter((evento) => evento._tag === "FerramentaConcluida");
      assert.deepStrictEqual(
        concluidas.map((evento) => [evento.nome, evento.resumo]),
        [
          ["ifpr.listar_cursos", "resultado de listar_cursos"],
          ["ifpr.buscar_norma", "resultado de buscar_norma"],
          ["ifpr.ficha_curso", "resultado de ficha_curso"],
          ["read_resource", "resultado de ifpr://cnct/tecnico-em-enfermagem"],
          ["ifpr.pacote_contexto", "resultado de pacote_contexto"],
          ["ifpr.sobre_a_base", "resultado de sobre_a_base"],
        ],
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
