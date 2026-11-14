import { describe, expect, test } from "vite-plus/test";
import { esquemaConfig } from "./esquema.ts";
import { argumentosClaude, comandoLegivel } from "./executor.ts";
import { lerStreamJson } from "./stream.ts";

const linhas = (eventos: unknown[]) => eventos.map((evento) => JSON.stringify(evento)).join("\n");

describe("stream-json do claude -p", () => {
  test("conta ferramentas sem repetir blocos e lê uso e custo do evento final", () => {
    const saida = linhas([
      { type: "system", subtype: "init", model: "claude-haiku-teste", tools: ["Read"] },
      { type: "system", subtype: "permission_denied" },
      { type: "assistant", message: { model: "claude-haiku-teste", content: [{ type: "text", text: "Vou ler." }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "..." }] } },
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "t2", name: "Grep", input: {} },
            { type: "tool_use", id: "t3", name: "Read", input: {} },
          ],
        },
      },
      { type: "assistant", message: { content: [{ type: "tool_use", id: "t3", name: "Read", input: {} }] } },
      {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "Resposta final.",
        num_turns: 4,
        duration_ms: 1234,
        total_cost_usd: 0.0123,
        usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 30, cache_read_input_tokens: 40 },
      },
    ]);
    expect(lerStreamJson(`lixo antes\n${saida}\n`)).toEqual({
      resposta: "Resposta final.",
      modelo: "claude-haiku-teste",
      chamadas_ferramenta: 3,
      chamadas_negadas: 1,
      ferramentas: { Grep: 1, Read: 2 },
      tokens: { entrada: 10, saida: 20, cache_criacao: 30, cache_leitura: 40, total: 100 },
      custo_usd: 0.0123,
      turnos: 4,
      duracao_ms: 1234,
      desfecho: "success",
      erro: false,
    });
  });

  test("sem evento final: usa o último texto e marca erro", () => {
    const execucao = lerStreamJson(
      linhas([{ type: "assistant", message: { content: [{ type: "text", text: "parcial" }] } }]),
    );
    expect(execucao).toMatchObject({ resposta: "parcial", desfecho: "sem_resultado", erro: true });
  });

  test("limite de turnos é erro", () => {
    const execucao = lerStreamJson(linhas([{ type: "result", subtype: "error_max_turns", is_error: true }]));
    expect(execucao).toMatchObject({ resposta: "", desfecho: "error_max_turns", erro: true });
  });
});

describe("argumentos do claude -p", () => {
  const config = esquemaConfig.parse({
    modelo: "sonnet",
    execucoes: 3,
    max_turns: 12,
    max_budget_usd_por_execucao: 0.5,
    ferramentas: ["Read", "Grep"],
    ferramentas_permitidas: ["Read(./**)", "Grep"],
    instrucao_sistema: "Responda em português.",
    fontes_configuracao: ["project", "local"],
  });

  test("fixa modelo, saída stream-json, turnos, ferramentas só de leitura e orçamento", () => {
    const argumentos = argumentosClaude("Pergunta?", { config, modelo: "haiku" });
    expect(argumentos.slice(0, 2)).toEqual(["-p", "Pergunta?"]);
    const valor = (flag: string) => argumentos[argumentos.indexOf(flag) + 1];
    expect(valor("--model")).toBe("haiku");
    expect(valor("--output-format")).toBe("stream-json");
    expect(argumentos).toContain("--verbose");
    expect(valor("--max-turns")).toBe("12");
    expect(valor("--tools")).toBe("Read,Grep");
    expect(valor("--permission-mode")).toBe("dontAsk");
    expect(valor("--max-budget-usd")).toBe("0.5");
    expect(valor("--append-system-prompt")).toBe("Responda em português.");
    expect(valor("--setting-sources")).toBe("project,local");
    const inicio = argumentos.indexOf("--allowedTools") + 1;
    expect(argumentos.slice(inicio, inicio + 2)).toEqual(["Read(./**)", "Grep"]);
    expect(argumentos[inicio + 2]).toBe("--disallowedTools");
  });

  test("comando legível cita argumentos com espaço", () => {
    expect(comandoLegivel("claude", ["-p", "Qual o art. 71?", "--tools", "Read,Grep"])).toBe(
      "claude -p 'Qual o art. 71?' --tools Read,Grep",
    );
  });
});
