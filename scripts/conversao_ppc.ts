#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off -- leitura e gravação síncronas dos PPCs da base, como o resto do pipeline da base
/**
 * A qualidade do texto dos PPCs convertidos de PDF: `limpar` (a limpeza determinística de
 * `@simplifica-if/pdf/limpeza`), `diagnosticar` (os trechos que pedem revisão, para a skill
 * `revisar-conversao-ppc`) e `conferir` (se uma correção mudou só marcação, espaços e quebras, sem
 * acrescentar palavra nem mexer no front matter).
 *
 * O alvo é o caminho do Markdown ou a chave `campus/curso/versao`; `--todos` pega todos os PPCs da
 * base. O front matter nunca muda: só o corpo.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Argument from "effect/cli/Argument";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import { jsonIndentado } from "@simplifica-if/kb/json";
import { sairCom } from "@simplifica-if/kb/principal";
import { conferirPalavras } from "@simplifica-if/pdf/conferencia";
import {
  contarAchados,
  diagnosticarMarkdown,
  EXPLICACOES,
  regioesDosAchados,
  TIPOS_ACHADO,
} from "@simplifica-if/pdf/diagnostico";
import { limparMarkdownConvertido, PASSADAS, type Passada } from "@simplifica-if/pdf/limpeza";
import { criarCaminhos } from "./base/caminhos.ts";
import { RAIZ_PROJETO } from "./config.ts";
import * as Git from "./git.ts";
import { executarPrincipal } from "./principal.ts";

const caminhos = criarCaminhos();

/** Todos os PPCs da base (`institucional/ifpr/ppcs/<campus>/<curso>/<versao>.md`). */
function todosOsPpcs(): string[] {
  const arquivos: string[] = [];
  for (const campus of NodeFS.readdirSync(caminhos.ppcs, { withFileTypes: true })) {
    if (!campus.isDirectory() || campus.name === "secoes") continue;
    const pastaCampus = NodePath.join(caminhos.ppcs, campus.name);
    for (const curso of NodeFS.readdirSync(pastaCampus, { withFileTypes: true })) {
      if (!curso.isDirectory()) continue;
      const pastaCurso = NodePath.join(pastaCampus, curso.name);
      for (const versao of NodeFS.readdirSync(pastaCurso))
        if (versao.endsWith(".md")) arquivos.push(NodePath.join(pastaCurso, versao));
    }
  }
  return arquivos.sort();
}

/** O arquivo do alvo: caminho existente ou chave `campus/curso/versao` da base. */
function arquivoDoAlvo(alvo: string): string {
  if (NodeFS.existsSync(alvo) && NodeFS.statSync(alvo).isFile()) return NodePath.resolve(alvo);
  const daChave = NodePath.join(caminhos.ppcs, `${alvo.replace(/\.md$/u, "")}.md`);
  if (NodeFS.existsSync(daChave)) return daChave;
  throw new Error(`PPC não encontrado: ${alvo} (caminho do .md ou campus/curso/versao)`);
}

function arquivosDosAlvos(alvos: ReadonlyArray<string>, todos: boolean): string[] {
  if (todos) return todosOsPpcs();
  if (!alvos.length) throw new Error("diga o PPC (caminho ou campus/curso/versao) ou use --todos");
  return alvos.map(arquivoDoAlvo);
}

/** O texto em front matter (com o `---` de fechamento e a quebra) e corpo. */
function separar(texto: string): { frontMatter: string; corpo: string; linhasFrontMatter: number } {
  const casamento = /^---\n[\s\S]*?\n---\n/u.exec(texto);
  const frontMatter = casamento?.[0] ?? "";
  return { frontMatter, corpo: texto.slice(frontMatter.length), linhasFrontMatter: frontMatter.split("\n").length - 1 };
}

const relativoAoProjeto = (arquivo: string) => NodePath.relative(RAIZ_PROJETO, arquivo);

const argumentoAlvos = Argument.String("ppc").pipe(
  Argument.withDescription("caminho do Markdown ou campus/curso/versao"),
  Argument.variadic(),
);
const flagTodos = Flag.Boolean("todos").pipe(Flag.withDescription("todos os PPCs da base"), Flag.withDefault(false));
const flagJson = Flag.Boolean("json").pipe(Flag.withDescription("a resposta inteira em JSON"), Flag.withDefault(false));

/* ------------------------------------------------------------------ limpar */

const comandoLimpar = Command.make(
  "limpar",
  {
    alvos: argumentoAlvos,
    todos: flagTodos,
    gravar: Flag.Boolean("gravar").pipe(
      Flag.withDescription("grava o corpo limpo (sem ela, só conta o que mudaria)"),
      Flag.withDefault(false),
    ),
    passadas: Flag.String("passadas").pipe(
      Flag.withDescription(`as passadas, separadas por vírgula (padrão: todas, ${PASSADAS.join(",")})`),
      Flag.optional,
    ),
  },
  Effect.fn("conversao_ppc.limpar")(function* ({ alvos, todos, gravar, passadas }) {
    const escolhidas =
      passadas._tag === "Some" ? (passadas.value.split(",").map((p) => p.trim()) as Passada[]) : undefined;
    const invalidas = escolhidas?.filter((p) => !PASSADAS.includes(p)) ?? [];
    if (invalidas.length) return yield* Effect.die(new Error(`passada desconhecida: ${invalidas.join(", ")}`));
    const total = Object.fromEntries(PASSADAS.map((p) => [p, 0])) as Record<Passada, number>;
    let mudados = 0;
    for (const arquivo of arquivosDosAlvos(alvos, todos)) {
      const texto = NodeFS.readFileSync(arquivo, "utf8");
      const { frontMatter, corpo } = separar(texto);
      const { texto: limpo, contagens } = limparMarkdownConvertido(corpo, escolhidas ? { passadas: escolhidas } : {});
      const novo = `${frontMatter}${frontMatter ? "\n" : ""}${limpo}`;
      for (const p of PASSADAS) total[p] += contagens[p];
      if (novo === texto) continue;
      mudados += 1;
      const resumo = PASSADAS.filter((p) => contagens[p] > 0)
        .map((p) => `${p} ${contagens[p]}`)
        .join(", ");
      yield* Console.log(`${relativoAoProjeto(arquivo)}: ${resumo || "espaços e linhas em branco"}`);
      if (gravar) NodeFS.writeFileSync(arquivo, novo);
    }
    yield* Console.log(
      `\n${mudados} PPC(s) ${gravar ? "limpos" : "mudariam"}; ${PASSADAS.map((p) => `${p} ${total[p]}`).join(", ")}`,
    );
    if (gravar && mudados)
      yield* Console.log("Confira com `node scripts/conversao_ppc.ts conferir` e rode gerar_base e validar_base.");
  }),
).pipe(Command.withDescription("Limpa o corpo dos PPCs (cabeçalhos, páginas, sumário, tabelas, títulos, parágrafos)."));

/* ------------------------------------------------------------- diagnosticar */

const comandoDiagnosticar = Command.make(
  "diagnosticar",
  {
    alvos: argumentoAlvos,
    todos: flagTodos,
    json: flagJson,
    linhasPorRegiao: Flag.Int("linhas-por-regiao").pipe(
      Flag.withDescription("tamanho máximo de uma região de trabalho"),
      Flag.withDefault(80),
    ),
  },
  Effect.fn("conversao_ppc.diagnosticar")(function* ({ alvos, todos, json, linhasPorRegiao }) {
    const resultados = arquivosDosAlvos(alvos, todos).map((arquivo) => {
      const texto = NodeFS.readFileSync(arquivo, "utf8");
      const { corpo, linhasFrontMatter } = separar(texto);
      const achados = diagnosticarMarkdown(corpo, linhasFrontMatter + 1);
      return {
        arquivo: relativoAoProjeto(arquivo),
        linhas: texto.split("\n").length,
        contagem: contarAchados(achados),
        regioes: regioesDosAchados(achados, linhasPorRegiao),
      };
    });
    if (json) return yield* Console.log(jsonIndentado(resultados).trimEnd());
    if (resultados.length > 1) {
      const linhas = resultados
        .map((r) => ({ ...r, total: Object.values(r.contagem).reduce((a, b) => a + b, 0) }))
        .sort((a, b) => b.total / b.linhas - a.total / a.linhas)
        .map((r) => `${r.total}\t${r.regioes.length}\t${r.arquivo}`);
      yield* Console.log(["achados\tregiões\tarquivo", ...linhas].join("\n"));
      return;
    }
    for (const r of resultados) {
      yield* Console.log(`# ${r.arquivo} (${r.linhas} linhas)\n`);
      for (const tipo of TIPOS_ACHADO)
        if (r.contagem[tipo]) yield* Console.log(`- ${tipo}: ${r.contagem[tipo]} (${EXPLICACOES[tipo]})`);
      for (const regiao of r.regioes) {
        yield* Console.log(`\n## linhas ${regiao.linha}-${regiao.fim}`);
        for (const a of regiao.achados) yield* Console.log(`- ${a.linha}: ${a.tipo}: ${a.trecho}`);
      }
    }
  }),
).pipe(Command.withDescription("Lista os trechos que pedem revisão, agrupados em regiões, com as linhas."));

/* ---------------------------------------------------------------- conferir */

const comandoConferir = Command.make(
  "conferir",
  {
    alvos: argumentoAlvos,
    todos: flagTodos,
    contra: Flag.String("contra").pipe(
      Flag.withDescription("a versão de antes, uma referência do git (padrão: HEAD)"),
      Flag.withDefault("HEAD"),
    ),
    json: flagJson,
  },
  Effect.fn("conversao_ppc.conferir")(function* ({ alvos, todos, contra, json }) {
    const resultados = [];
    for (const arquivo of arquivosDosAlvos(alvos, todos)) {
      const caminhoGit = relativoAoProjeto(arquivo).split(NodePath.sep).join("/");
      const antes = yield* Git.executar(["show", `${contra}:${caminhoGit}`], { cwd: RAIZ_PROJETO });
      const depois = NodeFS.readFileSync(arquivo, "utf8");
      if (antes === depois) continue;
      const a = separar(antes);
      const d = separar(depois);
      const conferencia = conferirPalavras(a.corpo, d.corpo);
      resultados.push({
        arquivo: caminhoGit,
        frontMatterMudou: a.frontMatter !== d.frontMatter,
        ...conferencia,
      });
    }
    const reprovados = resultados.filter((r) => r.frontMatterMudou || r.acrescentadas.length > 0);
    if (json) yield* Console.log(jsonIndentado(resultados).trimEnd());
    else {
      for (const r of resultados) {
        const ok = !r.frontMatterMudou && !r.acrescentadas.length;
        yield* Console.log(
          `# ${ok ? "ok" : "REPROVADO"} ${r.arquivo}: ${r.palavrasAntes} → ${r.palavrasDepois} palavras, ` +
            `${r.removidas.reduce((s, [, n]) => s + n, 0)} removidas, ${r.juncoes.length} junções, ` +
            `${r.separacoes.length} separações`,
        );
        if (r.frontMatterMudou) yield* Console.log("- o front matter mudou (só o corpo pode mudar)");
        if (r.acrescentadas.length)
          yield* Console.log(`- acrescentadas: ${r.acrescentadas.map(([p, n]) => `${p}×${n}`).join(" ")}`);
        if (r.removidas.length)
          yield* Console.log(
            `- removidas: ${r.removidas
              .slice(0, 60)
              .map(([p, n]) => `${p}×${n}`)
              .join(" ")}${r.removidas.length > 60 ? " …" : ""}`,
          );
        if (r.juncoes.length)
          yield* Console.log(
            `- junções: ${r.juncoes
              .slice(0, 20)
              .map((j) => `${j.partes.join("+")}=${j.palavra}`)
              .join(" ")}`,
          );
        if (r.separacoes.length)
          yield* Console.log(
            `- separações: ${r.separacoes
              .slice(0, 20)
              .map((j) => `${j.palavra}=${j.partes.join("+")}`)
              .join(" ")}`,
          );
      }
      yield* Console.log(`\n${resultados.length} PPC(s) mudados, ${reprovados.length} reprovado(s).`);
    }
    if (reprovados.length) return yield* sairCom(1);
  }),
).pipe(
  Command.withDescription(
    "Confere a correção contra o git: o front matter igual e nenhuma palavra acrescentada (junções e separações valem).",
  ),
);

export const comando = Command.make("conversao_ppc").pipe(
  Command.withDescription("A qualidade do texto dos PPCs convertidos de PDF: limpar, diagnosticar e conferir."),
  Command.withSubcommands([comandoLimpar, comandoDiagnosticar, comandoConferir]),
);

if (import.meta.main) {
  executarPrincipal("conversao_ppc", Command.run(comando, { version: "1.0.0" }));
}
