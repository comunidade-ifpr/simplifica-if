// @effect-diagnostics nodeBuiltinImport:off -- ferramenta de teste: lê e grava o gabarito em testes-gabarito/
/**
 * Gabarito do servidor MCP: `initialize`, `tools/list` e as respostas (`content` e `structuredContent`)
 * de duas a três chamadas por ferramenta, colhidos pelo Client do SDK em stdio, com o servidor como
 * processo filho sobre o `tmp/kb.sqlite` real.
 *
 *   node packages/mcp/test/gabarito.ts --comparar     # confere com testes-gabarito/mcp.json
 *   node packages/mcp/test/gabarito.ts --capturar     # regrava o gabarito (só por decisão explícita)
 *   node packages/mcp/test/gabarito.ts --comparar --schemas-equivalentes
 *
 * Com `--schemas-equivalentes` (critério do C2, servidor no `McpServer` do Effect), a comparação é por
 * partes: as chamadas (`content` e `structuredContent`) e as instruções continuam byte a byte; o
 * `tools/list` passa por `compararDefinicoes` (`equivalencia.ts`: textos e anotações iguais, schemas
 * equivalentes pela forma normalizada e pelo veredito do ajv); e o `initialize` aceita as diferenças do
 * `McpServer` do Effect 4.1.3, listadas em `DIFERENCAS_DO_INITIALIZE`.
 *
 * Neutro de runtime: o servidor roda com o mesmo executável deste script (`process.execPath`), ou com
 * o comando de `SIMPLIFICA_MCP_EXE` (o executável empacotado). A comparação é byte a byte, sobre o JSON
 * serializado com indentação de 2 espaços, mascarando só o que depende da impressão digital das fontes
 * do banco (a versão `dev-<8 hex de fontes_sha256>` do envelope e a impressão da consulta nos cursores),
 * que muda com qualquer mudança no código de `packages/kb/src`. O arquivo guarda a captura sem máscara.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Client } from "@modelcontextprotocol/client";
import { type ChamadaDoGabarito, compararDefinicoes, type DefinicaoListada } from "./equivalencia.ts";

const RAIZ = NodePath.resolve(import.meta.dirname, "../../..");
const CLI = NodePath.join(RAIZ, "packages/mcp/src/cli.ts");
const BANCO = NodePath.join(RAIZ, "tmp/kb.sqlite");
const ARQUIVO = NodePath.join(RAIZ, "testes-gabarito/mcp.json");

const PPC = "curitiba/tecnico-em-enfermagem";
const NORMA = "br/cne-cp/res/2021/1";

/** Chamadas por ferramenta, na ordem do `tools/list`. As de entrada inválida conferem a mensagem de erro. */
const CHAMADAS: ReadonlyArray<{ readonly name: string; readonly arguments: Record<string, unknown> }> = [
  { name: "buscar_norma", arguments: { consulta: "Resolução CNE/CP nº 2/2026, art. 28" } },
  { name: "buscar_norma", arguments: { consulta: "estágio supervisionado obrigatório", limite: 3 } },
  { name: "buscar_norma", arguments: { consulta: "itinerário formativo", vigentes: true } },
  { name: "ler_dispositivos", arguments: { ids: ["br/cne-cp/res/2026/2#art28-xviii", "br/xx/res/1900/1#art1"] } },
  { name: "ler_dispositivos", arguments: { ids: ["br/cne-cp/res/2026/2#art28"], filhos: true } },
  { name: "ficha_norma", arguments: { id: NORMA } },
  { name: "ficha_norma", arguments: { id: "br/lei/1996/9394" } },
  { name: "ficha_norma", arguments: { id: "br/xx/res/1900/1" } },
  { name: "correspondencia", arguments: { id: `${NORMA}#art20` } },
  { name: "correspondencia", arguments: { id: NORMA } },
  { name: "resolver_citacoes", arguments: { citacoes: ["Resolução CNE/CP nº 1/2021, art. 20", "Lei nº 9.394/1996"] } },
  { name: "resolver_citacoes", arguments: { citacoes: ["texto qualquer sem citação normativa"] } },
  { name: "resolver_citacoes", arguments: { textos: ["chave errada"] } },
  { name: "citacoes_da_norma", arguments: { id: NORMA, limite: 5 } },
  { name: "citacoes_da_norma", arguments: { id: NORMA, ppc: PPC } },
  { name: "impacto_da_norma", arguments: { id: NORMA } },
  { name: "impacto_da_norma", arguments: { id: "br/lei/1996/9394" } },
  { name: "adequacao_art71", arguments: { limite: 5 } },
  { name: "adequacao_art71", arguments: { campus: "curitiba", limite: 10 } },
  { name: "buscar_secoes", arguments: { consulta: "acompanhamento de egressos", cnct: "tecnico-em-agropecuaria" } },
  { name: "buscar_secoes", arguments: { consulta: "estágio obrigatório", ppc: PPC, limite: 2, integral: true } },
  { name: "buscar_secoes", arguments: { consulta: "" } },
  { name: "ler_secao", arguments: { id: "SECAO" } },
  { name: "ler_secao", arguments: { id: "ppc:inexistente/inexistente#1" } },
  { name: "listar_cursos", arguments: { limite: 5 } },
  { name: "listar_cursos", arguments: { campus: "curitiba", nivel: "médio" } },
  { name: "ficha_curso", arguments: { curso: PPC } },
  { name: "ficha_curso", arguments: { curso: "campus-inexistente/curso" } },
  { name: "fatos_ppc", arguments: { ppc: PPC } },
  { name: "fatos_ppc", arguments: { divergencias: true, nivel: "médio", limite: 3 } },
  { name: "sobre_a_base", arguments: {} },
  { name: "etapa", arguments: { id: "gabarito", progresso: { feito: 1, total: 2 } } },
  { name: "etapa", arguments: { id: "" } },
];

const modo = process.argv[2];
const equivalentes = process.argv.includes("--schemas-equivalentes");
if ((modo !== "--capturar" && modo !== "--comparar") || (equivalentes && modo !== "--comparar")) {
  process.stderr.write("uso: gabarito.ts --capturar | --comparar [--schemas-equivalentes]\n");
  process.exit(2);
}

const exe = process.env.SIMPLIFICA_MCP_EXE;
const transporte = new StdioClientTransport({
  command: exe ?? process.execPath,
  args: [...(exe ? [] : [CLI]), "--banco", BANCO, "--canal", "dev"],
  cwd: RAIZ,
  env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
  stderr: "pipe",
});
const cliente = new Client({ name: "gabarito", version: "0" }, { versionNegotiation: { mode: "legacy" } });
await cliente.connect(transporte);

const { tools } = await cliente.listTools();
/** `ler_secao` lê a primeira seção da segunda busca, para não fixar um ID que dependa da conversão. */
let secao = "";
const chamadas: unknown[] = [];
for (const chamada of CHAMADAS) {
  const args =
    chamada.name === "ler_secao" && chamada.arguments.id === "SECAO"
      ? { ...chamada.arguments, id: secao }
      : chamada.arguments;
  const resultado = await cliente.callTool({ name: chamada.name, arguments: args });
  if (chamada.name === "buscar_secoes" && !secao) {
    secao = (resultado.structuredContent as any)?.dados?.resultados?.[0]?.id ?? "";
  }
  chamadas.push({ name: chamada.name, arguments: args, resultado });
}
const gabarito = {
  servidor: cliente.getServerVersion(),
  capacidades: cliente.getServerCapabilities(),
  instrucoes: cliente.getInstructions(),
  tools,
  chamadas,
};
await cliente.close();

const texto = `${JSON.stringify(gabarito, null, 2)}\n`;

/**
 * Máscara do que depende da impressão digital das fontes: a versão de desenvolvimento da base
 * (`dev-` e 8 hex) e a impressão da consulta nos cursores de paginação (que inclui a versão); o
 * deslocamento do cursor continua conferido.
 */
function mascarar(json: string): string {
  return json.replace(/\bdev-[0-9a-f]{8}\b/g, "dev-<fontes>").replace(/\beyJkIjo[A-Za-z0-9_-]+/g, (cursor) => {
    try {
      const { d } = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { d: number };
      return `<cursor d=${d}>`;
    } catch {
      return cursor;
    }
  });
}
if (modo === "--capturar") {
  NodeFS.writeFileSync(ARQUIVO, texto);
  process.stdout.write(
    `gabarito do MCP gravado em ${NodePath.relative(RAIZ, ARQUIVO)} (${tools.length} ferramentas, ${chamadas.length} chamadas)\n`,
  );
} else if (equivalentes) {
  const antigo = JSON.parse(NodeFS.readFileSync(ARQUIVO, "utf8")) as {
    readonly servidor: unknown;
    readonly capacidades: unknown;
    readonly instrucoes: unknown;
    readonly tools: readonly DefinicaoListada[];
    readonly chamadas: readonly ChamadaDoGabarito[];
  };
  const problemas: string[] = [];
  const json = (valor: unknown) => mascarar(JSON.stringify(valor, null, 2));
  // `initialize`: o `McpServer.layerStdio` do Effect 4.1.3 não aceita `title` no `serverInfo` e sempre
  // anuncia `logging` e `completions` (o servidor não registra nenhum dos dois; os clientes os ignoram)
  const servidor = { ...(antigo.servidor as Record<string, unknown>) };
  delete servidor.title;
  if (json(servidor) !== json(gabarito.servidor)) problemas.push(`servidor: ${json(gabarito.servidor)}`);
  const capacidades = { logging: {}, completions: {}, ...(antigo.capacidades as Record<string, unknown>) };
  if (json(capacidades) !== json(gabarito.capacidades)) problemas.push(`capacidades: ${json(gabarito.capacidades)}`);
  if (antigo.instrucoes !== gabarito.instrucoes) problemas.push("instruções diferentes");
  const definicoes = compararDefinicoes(antigo.tools, tools as readonly DefinicaoListada[], antigo.chamadas);
  problemas.push(...definicoes.problemas);
  antigo.chamadas.forEach((esperada, i) => {
    if (json(esperada) !== json(chamadas[i])) problemas.push(`chamada ${i + 1} (${esperada.name}) diferente`);
  });
  if (antigo.chamadas.length !== chamadas.length)
    problemas.push(`${chamadas.length} chamadas; esperava ${antigo.chamadas.length}`);
  if (problemas.length > 0) {
    process.stderr.write(
      `gabarito do MCP: ${problemas.length} diferença(s)\n${problemas.map((p) => `  ${p}`).join("\n")}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `gabarito do MCP: equivalente (${tools.length} ferramentas, ${chamadas.length} chamadas iguais, ${definicoes.amostras} amostras com o mesmo veredito)\n`,
  );
} else {
  const esperado = mascarar(NodeFS.readFileSync(ARQUIVO, "utf8"));
  const obtido = mascarar(texto);
  if (esperado === obtido) {
    process.stdout.write(`gabarito do MCP: igual (${tools.length} ferramentas, ${chamadas.length} chamadas)\n`);
  } else {
    const a = esperado.split("\n");
    const b = obtido.split("\n");
    const i = a.findIndex((linha, n) => linha !== b[n]);
    process.stderr.write(
      `gabarito do MCP: diferente a partir da linha ${i + 1}\n  esperado: ${a[i]}\n  obtido:   ${b[i]}\n`,
    );
    process.exit(1);
  }
}
