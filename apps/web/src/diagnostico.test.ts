import { afterEach, assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Tracer from "effect/Tracer";
import { RpcClientDefect, RpcClientError } from "effect/rpc/RpcClientError";
import { codigoDoErro, cortarRegistro, LIMITE_REGISTRO_INTERFACE } from "@simplifica-if/contratos-app/ponte";
import { vi } from "vite-plus/test";
import { marcarCodigo } from "./conexao/erros.ts";
import {
  agruparQuedas,
  criarTracer,
  ehFalhaInesperada,
  instalarRegistroDeErros,
  JANELA_LIMITE_MS,
  JANELA_QUEDA_MS,
  layerTracer,
  limitarFrequencia,
  MAXIMO_CODIGOS_QUEDA,
  MAXIMO_POR_MINUTO,
  omitirValores,
  textoDoErro,
} from "./diagnostico.ts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const novaQueda = () =>
  new RpcClientError({ reason: new RpcClientDefect({ message: "socket fechado", cause: undefined }) });

describe("ehFalhaInesperada", () => {
  it("o defeito e a queda do transporte sim; o erro tipado e a interrupção não", () => {
    assert.isTrue(ehFalhaInesperada(Cause.die("boom")));
    assert.isTrue(ehFalhaInesperada(Cause.fail(novaQueda())));
    assert.isFalse(ehFalhaInesperada(Cause.fail({ _tag: "AvisoNaoAceito" })));
    assert.isFalse(ehFalhaInesperada(Cause.interrupt()));
  });
});

/** Roda `efeito` num span e devolve o `traceId` dele. */
const noSpan = <A, E>(nome: string, kind: "client" | "internal", efeito: Effect.Effect<A, E>) => {
  let traceId = "";
  return Effect.exit(
    Effect.flatMap(Effect.orDie(Effect.currentSpan), (span) => {
      traceId = span.traceId;
      return efeito;
    }).pipe(Effect.withSpan(nome, { kind })),
  ).pipe(Effect.map(() => traceId));
};

describe("layerTracer", () => {
  it.effect("registra o span de cliente que termina num defeito, com o código e o método", () =>
    Effect.gen(function* () {
      const erro = vi.spyOn(globalThis.console, "error").mockImplementation(() => undefined);
      const traceId = yield* noSpan("RpcClient.preferencias.gravarPerfil", "client", Effect.die("payload recusado"));
      assert.strictEqual(erro.mock.calls.length, 1);
      const linha = String(erro.mock.calls[0]?.[0]);
      assert.include(linha, `erro ${codigoDoErro(traceId)} em RpcClient.preferencias.gravarPerfil`);
      assert.include(linha, "payload recusado");
    }).pipe(Effect.provide(layerTracer)),
  );

  it.effect("não registra o sucesso, o erro tipado nem o span que não é de cliente", () =>
    Effect.gen(function* () {
      const erro = vi.spyOn(globalThis.console, "error").mockImplementation(() => undefined);
      yield* noSpan("RpcClient.preferencias.ler", "client", Effect.void);
      yield* noSpan("RpcClient.conversa.iniciar", "client", Effect.fail({ _tag: "AvisoNaoAceito" }));
      yield* noSpan("interno", "internal", Effect.die("boom"));
      assert.strictEqual(erro.mock.calls.length, 0);
    }).pipe(Effect.provide(layerTracer)),
  );
});

describe("criarTracer", () => {
  it.effect("a queda da conexão vai ao agrupador; o defeito, uma linha cada", () => {
    const linhas: Array<string> = [];
    const quedas: Array<readonly [string, string, string]> = [];
    const tracer = criarTracer({
      registrar: (texto) => linhas.push(texto),
      quedas: { anotar: (...argumentos) => void quedas.push(argumentos) },
    });
    return Effect.gen(function* () {
      const a = yield* noSpan("RpcClient.conversa.enviar", "client", Effect.fail(novaQueda()));
      const b = yield* noSpan("RpcClient.conversa.listar", "client", Effect.fail(novaQueda()));
      yield* noSpan("RpcClient.x", "client", Effect.die("boom"));
      yield* noSpan("RpcClient.y", "client", Effect.die("boom"));
      assert.deepStrictEqual(
        quedas.map(([codigo, metodo]) => [codigo, metodo]),
        [
          [codigoDoErro(a), "RpcClient.conversa.enviar"],
          [codigoDoErro(b), "RpcClient.conversa.listar"],
        ],
      );
      assert.include(quedas[0]![2], "socket fechado");
      assert.strictEqual(linhas.length, 2);
    }).pipe(Effect.provideService(Tracer.Tracer, tracer));
  });
});

describe("agruparQuedas", () => {
  it("uma linha por janela, com o total e os códigos (até o limite)", () => {
    const linhas: Array<string> = [];
    const agendados: Array<{ readonly acao: () => void; readonly ms: number }> = [];
    const quedas = agruparQuedas({
      registrar: (texto) => linhas.push(texto),
      agendar: (acao, ms) => void agendados.push({ acao, ms }),
    });
    quedas.anotar("AAAAAAAA", "RpcClient.conversa.enviar", "socket fechado\npilha");
    quedas.anotar("BBBBBBBB", "RpcClient.conversa.listar", "outro");
    assert.strictEqual(agendados.length, 1);
    assert.strictEqual(agendados[0]!.ms, JANELA_QUEDA_MS);
    assert.deepStrictEqual(linhas, []);
    agendados[0]!.acao();
    assert.deepStrictEqual(linhas, [
      "conexão com o servidor caiu: 2 chamadas afetadas (códigos AAAAAAAA RpcClient.conversa.enviar, BBBBBBBB RpcClient.conversa.listar); motivo: socket fechado",
    ]);

    // A janela seguinte: acima do limite de códigos, o resto é contado.
    for (let i = 0; i < MAXIMO_CODIGOS_QUEDA + 3; i += 1) quedas.anotar(`C${i}`, "m", "");
    assert.strictEqual(agendados.length, 2);
    agendados[1]!.acao();
    assert.strictEqual(linhas.length, 2);
    assert.include(linhas[1]!, `${MAXIMO_CODIGOS_QUEDA + 3} chamadas afetadas`);
    assert.include(linhas[1]!, "C0 m");
    assert.include(linhas[1]!, " e mais 3)");
    assert.notInclude(linhas[1]!, `C${MAXIMO_CODIGOS_QUEDA} m`);
  });

  it("descarregar grava a janela em curso uma vez só", () => {
    const linhas: Array<string> = [];
    const agendados: Array<() => void> = [];
    const quedas = agruparQuedas({ registrar: (texto) => linhas.push(texto), agendar: (acao) => agendados.push(acao) });
    quedas.descarregar();
    quedas.anotar("AAAAAAAA", "m", "");
    quedas.descarregar();
    agendados[0]!();
    assert.deepStrictEqual(linhas, ["conexão com o servidor caiu: 1 chamada afetada (códigos AAAAAAAA m)"]);
  });
});

describe("limitarFrequencia", () => {
  it("a mesma linha uma vez por janela; acima do máximo, uma linha de suprimidos quando a janela vira", () => {
    let agora = 1_000;
    const gravadas: Array<string> = [];
    const registrar = limitarFrequencia({ agora: () => agora, gravar: (linha) => gravadas.push(linha) });
    // O StrictMode monta a tela de erro duas vezes: a mesma linha.
    registrar("erro na tela /");
    registrar("erro na tela /");
    assert.deepStrictEqual(gravadas, ["erro na tela /"]);
    for (let i = 0; i < MAXIMO_POR_MINUTO + 5; i += 1) registrar(`linha ${i}`);
    assert.strictEqual(gravadas.length, MAXIMO_POR_MINUTO);
    agora += JANELA_LIMITE_MS;
    registrar("erro na tela /");
    assert.strictEqual(gravadas.length, MAXIMO_POR_MINUTO + 2);
    assert.match(gravadas.at(-2)!, /^7 registros suprimidos/);
    assert.strictEqual(gravadas.at(-1), "erro na tela /");
  });
});

describe("omitirValores", () => {
  it("tira o valor depois de `got` e das outras formas do formatador do Schema", () => {
    assert.strictEqual(
      omitirValores('Expected string, got {"nome":"Maria","cpf":"123"}\n  at ["perfil"]'),
      'Expected string, got [valor omitido]\n  at ["perfil"]',
    );
    assert.strictEqual(omitirValores('Invalid data "texto digitado"'), "Invalid data [valor omitido]");
    assert.strictEqual(
      omitirValores('Unexpected key with value "x"\n  at ["a"]'),
      'Unexpected key with value [valor omitido]\n  at ["a"]',
    );
    assert.strictEqual(
      omitirValores("Expected exactly one member to match the input 42"),
      "Expected exactly one member to match the input [valor omitido]",
    );
    assert.strictEqual(omitirValores('Missing key\n  at ["x"]'), 'Missing key\n  at ["x"]');
  });

  it("várias mensagens e um valor de várias linhas", () => {
    const texto = [
      "Error: SchemaError",
      'Expected string, got Perfil(nome: "Maria",',
      '  campus: "Curitiba")',
      '  at ["perfil"]["nome"]',
      'Expected number, got "abc"',
      '  at ["perfil"]["idade"]',
      "Missing key",
      '  at ["perfil"]["cargo"]',
      "    at RpcClient.ts:10:5",
    ].join("\n");
    assert.strictEqual(
      omitirValores(texto),
      [
        "Error: SchemaError",
        "Expected string, got [valor omitido]",
        '  at ["perfil"]["nome"]',
        "Expected number, got [valor omitido]",
        '  at ["perfil"]["idade"]',
        "Missing key",
        '  at ["perfil"]["cargo"]',
        "    at RpcClient.ts:10:5",
      ].join("\n"),
    );
  });
});

describe("cortarRegistro", () => {
  it("cabe no limite já com o …, sem partir um par de surrogates", () => {
    assert.strictEqual(cortarRegistro("abc"), "abc");
    const longo = "x".repeat(LIMITE_REGISTRO_INTERFACE + 10);
    const cortado = cortarRegistro(longo);
    assert.strictEqual(cortado.length, LIMITE_REGISTRO_INTERFACE);
    assert.isTrue(cortado.endsWith("…"));
    // "😀" são duas unidades UTF-16; o corte cairia no meio do par.
    assert.strictEqual(cortarRegistro("ab😀cd", 4), "ab…");
    assert.strictEqual(cortarRegistro("abc😀d", 4), "abc…");
  });
});

describe("textoDoErro", () => {
  it("a pilha do Error, o texto; de outro objeto, só o _tag e as chaves", () => {
    assert.include(textoDoErro(new Error("boom")), "boom");
    assert.strictEqual(textoDoErro("x"), "x");
    assert.strictEqual(textoDoErro({ a: 1, nome: "Maria" }), "{a, nome}");
    assert.strictEqual(textoDoErro({ _tag: "Falha", texto: "segredo" }), "Falha {_tag, texto}");
    assert.strictEqual(textoDoErro(42), "number");
  });
});

describe("instalarRegistroDeErros", () => {
  it("a rejeição de um erro com código (já registrado) não é registrada de novo", () => {
    const janela = new EventTarget();
    vi.stubGlobal("window", janela);
    const erro = vi.spyOn(globalThis.console, "error").mockImplementation(() => undefined);
    instalarRegistroDeErros();
    const rejeitar = (reason: unknown) =>
      janela.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason }));
    rejeitar(marcarCodigo(new Error("já registrado"), "ABCDEF12"));
    assert.strictEqual(erro.mock.calls.length, 0);
    rejeitar(new Error("sem dono"));
    assert.strictEqual(erro.mock.calls.length, 1);
    assert.include(String(erro.mock.calls[0]?.[0]), "sem dono");
  });
});
