/**
 * Normalização dos eventos sobre gravações reais de cada provider (`test/fixtures/*.jsonl`, saídas
 * do `pnpm motor:poc --gravar`, sem e-mails, tokens nem a pasta do usuário). Cada linha é
 * `{ ms?, direcao, mensagem }`; as de `entrada` são o que o driver passou ao normalizador.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { criarNormalizadorAntigravity, type EntradaAcp } from "../src/drivers/antigravity.ts";
import { criarNormalizadorClaude } from "../src/drivers/claude.ts";
import {
  CodexAppServerProcessExitedError,
  CodexAppServerTransportError,
} from "@simplifica-if/effect-codex-app-server/errors";
import { criarNormalizadorCodex, falhaQuedaCodex } from "../src/drivers/codex.ts";
import { Evento } from "../src/eventos.ts";

const Linha = Schema.Struct({
  ms: Schema.optionalKey(Schema.Number),
  direcao: Schema.Literals(["entrada", "saida"]),
  mensagem: Schema.Record(Schema.String, Schema.Unknown),
});
const decodificarLinha = Schema.decodeUnknownEffect(Schema.fromJsonString(Linha));
const validarEvento = Schema.decodeUnknownEffect(Evento);

const lerFixture = Effect.fn("teste.lerFixture")(function* (nome: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const texto = yield* fs.readFileString(path.join(import.meta.dirname, "fixtures", nome));
  const linhas = texto.split("\n").filter((linha) => linha.trim() !== "");
  return yield* Effect.forEach(linhas, (linha) => decodificarLinha(linha));
});

type Mensagem = Record<string, unknown>;

/** Roda o normalizador sobre as entradas e confere que todo evento obedece ao esquema. */
const normalizar = Effect.fn("teste.normalizar")(function* (
  nome: string,
  filtro: (mensagem: Mensagem) => boolean,
  passo: (mensagem: Mensagem) => ReadonlyArray<Evento>,
) {
  const linhas = yield* lerFixture(nome);
  const eventos = linhas
    .filter((linha) => linha.direcao === "entrada" && filtro(linha.mensagem))
    .flatMap((linha) => passo(linha.mensagem));
  yield* Effect.forEach(eventos, (evento) => validarEvento(evento), { discard: true });
  return eventos;
});

const deTipo = <T extends Evento["_tag"]>(eventos: ReadonlyArray<Evento>, tag: T) =>
  eventos.filter((evento): evento is Extract<Evento, { _tag: T }> => evento._tag === tag);

const nomesIniciados = (eventos: ReadonlyArray<Evento>) => deTipo(eventos, "FerramentaIniciada").map((e) => e.nome);

/** Cada `FerramentaConcluida` corresponde a uma `FerramentaIniciada` anterior, com o mesmo nome. */
const conferirPares = (eventos: ReadonlyArray<Evento>) => {
  const iniciadas = new Map<string, string>();
  for (const evento of eventos) {
    if (evento._tag === "FerramentaIniciada") iniciadas.set(evento.id, evento.nome);
    if (evento._tag === "FerramentaConcluida") assert.strictEqual(iniciadas.get(evento.id), evento.nome, evento.id);
  }
};

/** O texto dos `TextoParcial` de um turno é o texto final do turno. */
const textoParcial = (eventos: ReadonlyArray<Evento>) =>
  deTipo(eventos, "TextoParcial")
    .map((e) => e.texto)
    .join("");

describe("normalização", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect("Claude: pergunta do CNCT com as ferramentas ifpr", () =>
      Effect.gen(function* () {
        const passo = criarNormalizadorClaude();
        const eventos = yield* normalizar(
          "claude-cnct.jsonl",
          (m) => typeof m.type === "string",
          (m) => passo(m as never),
        );
        assert.deepStrictEqual(nomesIniciados(eventos), [
          "ifpr.listar_cursos",
          "ifpr.ficha_curso",
          "ifpr.sobre_a_base",
        ]);
        conferirPares(eventos);
        assert.isTrue(deTipo(eventos, "FerramentaConcluida").every((e) => !e.falhou && e.resumo.startsWith('{"base"')));
        const finais = deTipo(eventos, "TextoFinal");
        assert.strictEqual(finais.length, 1);
        assert.strictEqual(textoParcial(eventos), finais[0]?.texto);
        assert.match(finais[0]?.texto ?? "", /1\.200 horas/);
        assert.match(finais[0]?.texto ?? "", /ifpr:\/\/cnct\/tecnico-em-enfermagem/);
        const [uso, fim] = eventos.slice(-2);
        // A entrada que vai para o cache (`cache_creation_input_tokens`) fica fora de `input_tokens`:
        // sem `cacheEscrita`, este turno pareceria ter consumido 8 tokens de entrada.
        assert.deepStrictEqual(uso, {
          _tag: "UsoTokens",
          entrada: 8,
          saida: 1016,
          cacheLeitura: 105281,
          cacheEscrita: 48330,
          custoUsd: 0.42818280000000003,
        });
        assert.deepStrictEqual(fim, { _tag: "FimTurno", motivo: "end_turn" });
      }),
    );

    it.effect("Claude: texto parcial pelos stream_event, sem duplicar o TextoFinal (gravação com tempos)", () =>
      Effect.gen(function* () {
        const passo = criarNormalizadorClaude();
        const linhas = yield* lerFixture("claude-parcial.jsonl");
        const comTempo = linhas
          .filter((linha) => linha.direcao === "entrada" && typeof linha.mensagem.type === "string")
          .flatMap((linha) => passo(linha.mensagem as never).map((evento) => ({ ms: linha.ms ?? 0, evento })));
        yield* Effect.forEach(comTempo, ({ evento }) => validarEvento(evento), { discard: true });
        const eventos = comTempo.map(({ evento }) => evento);
        const parciais = comTempo.filter(({ evento }) => evento._tag === "TextoParcial");
        const finais = comTempo.filter(({ evento }) => evento._tag === "TextoFinal");
        // Um bloco de texto: muitos pedaços e um TextoFinal só, com o mesmo texto.
        assert.isAbove(parciais.length, 50);
        assert.strictEqual(finais.length, 1);
        assert.strictEqual(textoParcial(eventos), deTipo(eventos, "TextoFinal")[0]?.texto);
        // Os pedaços vêm antes do TextoFinal, e o primeiro antes do bloco completo.
        const indiceFinal = eventos.findIndex((evento) => evento._tag === "TextoFinal");
        assert.isTrue(eventos.slice(indiceFinal + 1).every((evento) => evento._tag !== "TextoParcial"));
        assert.isBelow(parciais[0]?.ms ?? Infinity, finais[0]?.ms ?? 0);
        // Medido nesta gravação: o texto vem depois das ferramentas, e o primeiro pedaço chega a 14,4 s
        // do início, junto com o resto: o modelo redige a resposta no raciocínio oculto (README).
        assert.isAbove(parciais[0]?.ms ?? 0, 10_000);
        assert.isTrue(deTipo(eventos, "FerramentaIniciada").some((evento) => evento.nome.startsWith("ifpr.")));
        assert.match(finais[0]?.evento._tag === "TextoFinal" ? finais[0].evento.texto : "", /ifpr:\/\//);
      }),
    );

    it.effect("Claude: stream_event de subagente não vira TextoParcial", () =>
      Effect.sync(() => {
        const passo = criarNormalizadorClaude();
        const delta = (pai: string | null) =>
          passo({
            type: "stream_event",
            event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "oi" } },
            parent_tool_use_id: pai,
            uuid: "u",
            session_id: "s",
          } as never);
        assert.deepStrictEqual(delta(null), [{ _tag: "TextoParcial", texto: "oi" }]);
        assert.deepStrictEqual(delta("toolu_1"), []);
      }),
    );

    it.effect("Claude: aprovação negada e depois permitida", () =>
      Effect.gen(function* () {
        const passo = criarNormalizadorClaude();
        const eventos = yield* normalizar(
          "claude-aprovacao.jsonl",
          (m) => typeof m.type === "string" && m.type !== "can_use_tool",
          (m) => passo(m as never),
        );
        const concluidas = deTipo(eventos, "FerramentaConcluida");
        assert.deepStrictEqual(
          concluidas.map((e) => [e.nome, e.falhou]),
          [
            ["Write", true],
            ["Write", false],
          ],
        );
        assert.strictEqual(concluidas[0]?.resumo, "O usuário negou esta ação.");
        assert.strictEqual(deTipo(eventos, "FimTurno").length, 2);
        // O pedido em si vem pelo `canUseTool`, gravado à parte, com a resposta do harness.
        const linhas = yield* lerFixture("claude-aprovacao.jsonl");
        const respostas = linhas
          .filter((l) => l.mensagem.type === "can_use_tool_response")
          .map((l) => l.mensagem.behavior);
        assert.deepStrictEqual(respostas, ["deny", "allow"]);
      }),
    );

    it.effect("Codex: pergunta do CNCT com as ferramentas ifpr", () =>
      Effect.gen(function* () {
        const passo = criarNormalizadorCodex();
        const eventos = yield* normalizar(
          "codex-cnct.jsonl",
          (m) => typeof m.metodo === "string",
          (m) => passo(m.metodo as string, m.parametros),
        );
        assert.deepStrictEqual(nomesIniciados(eventos), [
          "ifpr.buscar_norma",
          "ifpr.ficha_curso",
          "ifpr.listar_cursos",
          "ifpr.ficha_curso",
        ]);
        conferirPares(eventos);
        // A primeira `ficha_curso` veio sem argumento e o MCP recusou: o erro vira `falhou`.
        assert.deepStrictEqual(
          deTipo(eventos, "FerramentaConcluida").map((e) => e.falhou),
          [false, true, false, false],
        );
        const finais = deTipo(eventos, "TextoFinal");
        assert.strictEqual(finais.length, 2);
        assert.strictEqual(textoParcial(eventos), finais.map((e) => e.texto).join(""));
        assert.match(finais[1]?.texto ?? "", /ifpr:\/\//);
        const uso = deTipo(eventos, "UsoTokens");
        assert.strictEqual(uso.length, 1);
        assert.isAbove(uso[0]?.entrada ?? 0, 0);
        assert.deepStrictEqual(eventos.at(-1), { _tag: "FimTurno", motivo: "completed" });
        // Nenhum MCP do usuário subiu com erro: o isolamento os desligou.
        assert.strictEqual(deTipo(eventos, "Erro").length, 0);
      }),
    );

    it.effect("Codex: aprovação negada (edição) e permitida (comando)", () =>
      Effect.gen(function* () {
        const passo = criarNormalizadorCodex();
        const eventos = yield* normalizar(
          "codex-aprovacao.jsonl",
          (m) => typeof m.metodo === "string" && m.parametros !== undefined,
          (m) => passo(m.metodo as string, m.parametros),
        );
        const concluidas = deTipo(eventos, "FerramentaConcluida");
        assert.deepStrictEqual(
          concluidas.map((e) => [e.nome, e.falhou]),
          [
            ["comando", false],
            ["editar_arquivos", true],
            ["comando", false],
            ["comando", false],
          ],
        );
        assert.strictEqual(concluidas.at(-1)?.resumo, "ok");
        const linhas = yield* lerFixture("codex-aprovacao.jsonl");
        const decisoes = linhas
          .filter((l) => l.mensagem.metodo === "resposta de aprovação")
          .map((l) => l.mensagem.decisao);
        assert.deepStrictEqual(decisoes, ["negar", "permitir"]);
        assert.deepStrictEqual(
          deTipo(eventos, "FimTurno").map((e) => e.motivo),
          ["completed", "completed"],
        );
      }),
    );

    it.effect("Antigravity: pergunta do CNCT com as ferramentas ifpr", () =>
      Effect.gen(function* () {
        const passo = criarNormalizadorAntigravity(["ifpr"]);
        const eventos = yield* normalizar(
          "antigravity-cnct.jsonl",
          (m) => m.tipo === "session/update" || (m.tipo === "session/prompt" && m.resposta !== undefined),
          (m) => passo(m as unknown as EntradaAcp),
        );
        assert.deepStrictEqual(nomesIniciados(eventos), [
          "ifpr.listar_cursos",
          "ifpr.buscar_norma",
          "ifpr.ficha_curso",
          "read_resource",
          "ifpr.pacote_contexto",
          "ifpr.sobre_a_base",
        ]);
        conferirPares(eventos);
        // O `toolSummary` que o agy injeta sai da entrada.
        const entradas = deTipo(eventos, "FerramentaIniciada").map((e) => e.entrada as Record<string, unknown>);
        assert.isTrue(entradas.every((entrada) => !("toolSummary" in entrada)));
        assert.deepStrictEqual(entradas[0], { cnct: "tecnico-em-enfermagem" });
        // O `read_resource` de um link `ifpr://` falha: o simplifica-mcp não serve recursos.
        assert.deepStrictEqual(
          deTipo(eventos, "FerramentaConcluida")
            .filter((e) => e.falhou)
            .map((e) => e.nome),
          ["read_resource"],
        );
        const finais = deTipo(eventos, "TextoFinal");
        assert.strictEqual(finais.length, 1);
        assert.strictEqual(textoParcial(eventos), finais[0]?.texto);
        assert.match(finais[0]?.texto ?? "", /ifpr:\/\/cnct\/tecnico-em-enfermagem/);
        assert.deepStrictEqual(deTipo(eventos, "UsoTokens")[0], {
          _tag: "UsoTokens",
          entrada: 27849,
          saida: 1124,
          cacheLeitura: 84402,
        });
        assert.deepStrictEqual(eventos.at(-1), { _tag: "FimTurno", motivo: "end_turn" });
      }),
    );

    it.effect("Antigravity: aprovação negada e depois permitida", () =>
      Effect.gen(function* () {
        const passo = criarNormalizadorAntigravity(["ifpr"]);
        const eventos = yield* normalizar(
          "antigravity-aprovacao.jsonl",
          (m) => m.tipo === "session/update" || (m.tipo === "session/prompt" && m.resposta !== undefined),
          (m) => passo(m as unknown as EntradaAcp),
        );
        assert.deepStrictEqual(
          deTipo(eventos, "FerramentaConcluida").map((e) => [e.nome, e.falhou]),
          [
            ["write_file", true],
            ["write_file", false],
          ],
        );
        const linhas = yield* lerFixture("antigravity-aprovacao.jsonl");
        const pedidos = linhas.filter((l) => l.mensagem.tipo === "session/request_permission");
        assert.strictEqual(pedidos.filter((l) => l.direcao === "entrada").length, 2);
        const escolhidas = pedidos
          .filter((l) => l.direcao === "saida")
          .map((l) => (l.mensagem.resposta as { outcome: { optionId?: string } }).outcome.optionId);
        assert.strictEqual(escolhidas.length, 2);
        assert.notStrictEqual(escolhidas[0], escolhidas[1]);
        assert.strictEqual(deTipo(eventos, "FimTurno").length, 2);
      }),
    );
  });
});

describe("queda do codex app-server", () => {
  it("SIGKILL (sem código de saída): queda, com o erro do transporte em cause", () => {
    const erro = new CodexAppServerTransportError({ operation: "read-process-exit-status", pid: 1, cause: "morto" });
    const falha = falhaQuedaCodex(erro);
    assert.strictEqual(falha.tipo, "queda");
    assert.strictEqual(falha.message, "codex: falha em sessão (queda)");
    assert.strictEqual(falha.cause, erro);
  });

  it("saída com código: queda, com o código no erro em cause", () => {
    const erro = new CodexAppServerProcessExitedError({ code: 1, pid: 1 });
    const falha = falhaQuedaCodex(erro);
    assert.strictEqual(falha.tipo, "queda");
    assert.strictEqual(falha.cause, erro);
  });
});

describe("sessão de julgamento: tipo desconhecido conta como ferramenta", () => {
  it("Codex: imageView, collabAgentToolCall, imageGeneration e um tipo novo viram FerramentaIniciada; mensagem e raciocínio não", () => {
    const normalizar = criarNormalizadorCodex();
    const tipos = (tipo: string) =>
      normalizar("item/started", { item: { type: tipo, id: `i-${tipo}` } }).map((e) => e._tag);
    for (const tipo of ["imageView", "collabAgentToolCall", "imageGeneration", "algoNovo"])
      assert.deepStrictEqual(tipos(tipo), ["FerramentaIniciada"]);
    for (const tipo of ["agentMessage", "reasoning", "userMessage"]) assert.deepStrictEqual(tipos(tipo), []);
  });

  it("Claude: bloco que não é texto nem raciocínio vira ferramenta só na sessão de julgamento", () => {
    const mensagem = {
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        content: [
          { type: "server_tool_use", id: "s1", name: "web_search", input: {} },
          { type: "thinking", thinking: "…" },
        ],
      },
    } as unknown as Parameters<ReturnType<typeof criarNormalizadorClaude>>[0];
    assert.deepStrictEqual(
      criarNormalizadorClaude({ semFerramentas: true })(mensagem).map((e) => e._tag),
      ["FerramentaIniciada"],
    );
    assert.deepStrictEqual(criarNormalizadorClaude()(mensagem), []);
  });

  it("Antigravity: atualização desconhecida vira ferramenta só na sessão de julgamento; as benignas não", () => {
    const entrada = (sessionUpdate: string) =>
      ({ tipo: "session/update", notificacao: { update: { sessionUpdate } } }) as unknown as EntradaAcp;
    const julgamento = criarNormalizadorAntigravity([], { semFerramentas: true });
    assert.deepStrictEqual(
      julgamento(entrada("terminal_output")).map((e) => e._tag),
      ["FerramentaIniciada"],
    );
    assert.deepStrictEqual(julgamento(entrada("available_commands_update")), []);
    assert.deepStrictEqual(julgamento(entrada("agent_thought_chunk")), []);
    assert.deepStrictEqual(criarNormalizadorAntigravity()(entrada("terminal_output")), []);
  });
});
