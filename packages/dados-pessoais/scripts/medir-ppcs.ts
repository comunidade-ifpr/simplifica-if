// @effect-diagnostics nodeBuiltinImport:off globalConsole:off -- script de medição: lê a base e imprime contagens
/**
 * Mede o detector contra os PPCs convertidos da base (`base-conhecimento/institucional/ifpr/ppcs/`):
 * quantos PPCs teriam aviso ao serem anexados e quantos achados de cada tipo. Imprime só contagens e,
 * com `--amostras`, as formas mascaradas (sem o trecho em volta, que pode ter nome de pessoa).
 *
 *   node packages/dados-pessoais/scripts/medir-ppcs.ts [--amostras]
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { detectarDadosPessoais, TIPOS_DADO, type TipoDado } from "../src/detector.ts";

const RAIZ = NodePath.resolve(import.meta.dirname, "../../..");
const PASTA = NodePath.join(RAIZ, "base-conhecimento", "institucional", "ifpr", "ppcs");
const amostras = process.argv.includes("--amostras");

const arquivos = (NodeFS.readdirSync(PASTA, { recursive: true }) as Array<string>)
  .filter((nome) => nome.endsWith(".md") && !nome.split(NodePath.sep).includes("secoes"))
  .toSorted();

const porTipo: Record<TipoDado, number> = { cpf: 0, rg: 0, telefone: 0, email: 0 };
const ppcsPorTipo: Record<TipoDado, number> = { cpf: 0, rg: 0, telefone: 0, email: 0 };
const mascarados: Record<TipoDado, Array<string>> = { cpf: [], rg: [], telefone: [], email: [] };
let comAviso = 0;
let total = 0;
for (const arquivo of arquivos) {
  const achados = detectarDadosPessoais(NodeFS.readFileSync(NodePath.join(PASTA, arquivo), "utf8"));
  if (achados.length > 0) comAviso++;
  total += achados.length;
  const vistos = new Set<TipoDado>();
  for (const achado of achados) {
    porTipo[achado.tipo]++;
    vistos.add(achado.tipo);
    mascarados[achado.tipo].push(achado.mascarado);
  }
  for (const tipo of vistos) ppcsPorTipo[tipo]++;
}

const pct = (n: number) => `${((100 * n) / arquivos.length).toFixed(1).replace(".", ",")}%`;
console.log(`PPCs conferidos: ${arquivos.length}`);
console.log(`PPCs com aviso: ${comAviso} (${pct(comAviso)}); achados: ${total}`);
for (const tipo of TIPOS_DADO) {
  console.log(`  ${tipo}: ${porTipo[tipo]} achados em ${ppcsPorTipo[tipo]} PPCs (${pct(ppcsPorTipo[tipo])})`);
  if (amostras && mascarados[tipo].length > 0) {
    const contagem = new Map<string, number>();
    for (const valor of mascarados[tipo]) contagem.set(valor, (contagem.get(valor) ?? 0) + 1);
    for (const [valor, n] of [...contagem].toSorted((a, b) => b[1] - a[1]).slice(0, 15))
      console.log(`    ${n}× ${valor}`);
  }
}
