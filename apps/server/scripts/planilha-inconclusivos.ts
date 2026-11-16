// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- script de avaliação: arquivos
/**
 * A rotulação cega da avaliação do INCONCLUSIVO (M1.11, etapa 5), sobre o que
 * `avaliar-inconclusivos.ts` gravou (`conjunto.json`, `execucao.jsonl`), sem nenhuma chamada de IA.
 *
 *   node apps/server/scripts/planilha-inconclusivos.ts planilha [--saida pasta]
 *   node apps/server/scripts/planilha-inconclusivos.ts calcular --planilha preenchida.xlsx [--saida pasta]
 *
 * `planilha` gera, para uma pessoa rotular, `rotulacao-inconclusivos.xlsx` (uma linha por par: o
 * critério em linguagem simples, o trecho do PPC que a IA leu, as duas respostas embaralhadas como
 * "Resposta 1" e "Resposta 2", e as colunas para marcar) e `rotulacao-inconclusivos.html` (o mesmo
 * conteúdo, só leitura). A chave do embaralhamento fica à parte, em `chave-embaralhamento.json`: nada
 * na planilha diz qual instrução deu qual resposta (nem o `tipo_achado`, que só a nova tem).
 *
 * `calcular` lê a planilha preenchida e a chave e dá, por instrução: a distribuição dos estados, a
 * taxa de INCONCLUSIVO, a precisão de NAO_ATENDE (pela IA e pela lista, depois de `estadoDaIa`), a
 * taxa de acerto, e a concordância entre as instruções e com o estado que a pessoa marcou.
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import ExcelJS from "exceljs";
import { estadoDaIa, type ResultadoFichaIa } from "@simplifica-if/ppc/revisao-previa";
import type { CriterioInconclusivo } from "@simplifica-if/ppc/revisao-ia/pedido";
import type { LinhaExecucao, Par } from "./avaliar-inconclusivos.ts";

const args = process.argv.slice(2);
const comando = args[0];
const opcao = (nome: string) => {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : undefined;
};
const saida = opcao("--saida") ?? NodePath.join(NodeOS.tmpdir(), "simplifica-avaliacao-inconclusivos");
const arquivo = (nome: string) => NodePath.join(saida, nome);

const NOME_PLANILHA = "rotulacao-inconclusivos.xlsx";
const NOME_PAGINA = "rotulacao-inconclusivos.html";
const NOME_CHAVE = "chave-embaralhamento.json";
/** O teto de uma célula do Excel é 32.767 caracteres. */
const LIMITE_CELULA = 32_000;
const AVALIACOES = ["certa", "errada", "não sei"] as const;
const ESTADOS_PESSOA = ["Atende", "Não atende", "Inconclusivo", "Não se aplica"] as const;

const ESTADO_LEGIVEL: Record<ResultadoFichaIa["estado"], string> = {
  ATENDE: "Atende",
  NAO_ATENDE: "Não atende",
  INCONCLUSIVO: "Inconclusivo (pede conferência)",
  NAO_APLICAVEL: "Não se aplica",
  FALHOU: "Sem resposta válida (a resposta não passou na conferência automática; fica a conferir)",
};
const ESTADO_DA_PESSOA: Record<string, ResultadoFichaIa["estado"]> = {
  Atende: "ATENDE",
  "Não atende": "NAO_ATENDE",
  Inconclusivo: "INCONCLUSIVO",
  "Não se aplica": "NAO_APLICAVEL",
};

const hash = (texto: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) h = Math.imul(h ^ texto.charCodeAt(i), 0x01000193) >>> 0;
  return h;
};

type Resposta = { criterio: CriterioInconclusivo; resultado: ResultadoFichaIa; tentativas: number };
type ParCompleto = {
  id: string;
  par: Par;
  curso: string | null;
  criterioTexto: string;
  titulo: string;
  recorte: string;
  respostas: Record<CriterioInconclusivo, Resposta>;
};

function lerExecucao(): LinhaExecucao[] {
  return NodeFS.readFileSync(arquivo("execucao.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LinhaExecucao);
}

/** A ficha como o pedido a descreve: título, pergunta e rubrica (o critério em linguagem simples). */
function fichaDoPedido(pedido: string, ficha: string) {
  const inicio = pedido.indexOf(`### ${ficha} — `);
  const bloco = inicio < 0 ? "" : pedido.slice(inicio).split(/\n(?=### |\n## )/)[0]!;
  const titulo = /^### \S+ — (.*) \(\w+\)$/m.exec(bloco)?.[1] ?? ficha;
  const linha = (rotulo: string) => new RegExp(`^${rotulo}: (.*)$`, "m").exec(bloco)?.[1] ?? "";
  const texto = [
    `Pergunta: ${linha("Pergunta")}`,
    `Como julgar: ${linha("Rubrica")}`,
    linha("Boa evidência") && `Boa evidência: ${linha("Boa evidência")}`,
    linha("Má evidência") && `Má evidência: ${linha("Má evidência")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { titulo, texto };
}

function montarPares(): ParCompleto[] {
  const { pares } = JSON.parse(NodeFS.readFileSync(arquivo("conjunto.json"), "utf8")) as { pares: Par[] };
  const linhas = lerExecucao();
  const completos: ParCompleto[] = [];
  pares.forEach((par, i) => {
    const doPar = (criterio: CriterioInconclusivo) =>
      linhas.find((l) => l.ppc === par.ppc && l.criterio === criterio && l.fichas.includes(par.ficha));
    const conservador = doPar("conservador");
    const ausencia = doPar("ausencia");
    if (!conservador || !ausencia) {
      console.error(`par sem as duas execuções, fica de fora: ${par.ppc} ${par.ficha}`);
      return;
    }
    const resposta = (l: LinhaExecucao, criterio: CriterioInconclusivo): Resposta => ({
      criterio,
      resultado: l.resultado.resultados.find((r) => r.ficha === par.ficha)!,
      tentativas: l.resultado.tentativas,
    });
    const ficha = fichaDoPedido(conservador.pedido, par.ficha);
    completos.push({
      id: `P${String(i + 1).padStart(2, "0")}`,
      par,
      curso: conservador.curso,
      criterioTexto: ficha.texto,
      titulo: ficha.titulo,
      recorte: conservador.conteudo[par.ficha] ?? "",
      respostas: { conservador: resposta(conservador, "conservador"), ausencia: resposta(ausencia, "ausencia") },
    });
  });
  return completos;
}

/** A ordem das respostas no par: estável e sem padrão visível (o hash do ID). */
const ordem = (id: string): [CriterioInconclusivo, CriterioInconclusivo] =>
  hash(`${id}|embaralhar`) % 2 === 0 ? ["conservador", "ausencia"] : ["ausencia", "conservador"];

/** A resposta como a pessoa lê: sem `tipo_achado` nem confiança (que entregariam a instrução). */
function respostaLegivel(r: ResultadoFichaIa): string {
  return [
    `Estado: ${ESTADO_LEGIVEL[r.estado]}`,
    r.justificativa && `Justificativa: ${r.justificativa}`,
    r.lacunas.length ? `Falta: ${r.lacunas.join("; ")}` : "",
    r.oQueFazer && `O que fazer: ${r.oQueFazer}`,
    r.trechos.length ? `Evidência (trecho do PPC):\n${r.trechos.map((t) => `“${t}”`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

const cortar = (texto: string) =>
  texto.length > LIMITE_CELULA
    ? `${texto.slice(0, LIMITE_CELULA)}\n\n[… cortado na planilha; o texto inteiro está na página HTML]`
    : texto;

const COLUNAS = [
  { header: "Par", key: "par", width: 7 },
  { header: "Curso (PPC da base)", key: "curso", width: 22 },
  { header: "Critério", key: "criterio", width: 24 },
  { header: "O que o critério pede", key: "pede", width: 50 },
  { header: "Trecho do PPC que a IA leu", key: "recorte", width: 80 },
  { header: "Resposta 1", key: "r1", width: 55 },
  { header: "Resposta 1: avaliação", key: "a1", width: 14 },
  { header: "Resposta 1: observação", key: "o1", width: 30 },
  { header: "Resposta 2", key: "r2", width: 55 },
  { header: "Resposta 2: avaliação", key: "a2", width: 14 },
  { header: "Resposta 2: observação", key: "o2", width: 30 },
  { header: "Estado correto (opcional)", key: "correto", width: 16 },
  { header: "Observação sobre o par", key: "obs", width: 30 },
] as const;

const COMO_PREENCHER = [
  "Como preencher (uma linha por par, na aba Pares):",
  "1. Leia o que o critério pede (coluna D) e o trecho do PPC que a IA leu (coluna E). Julgue só por esse trecho: é o que a IA recebeu.",
  "2. Leia a Resposta 1 e marque na coluna G: certa (o estado e a justificativa estão corretos pelo trecho), errada (o estado está errado, ou a falta apontada não existe no trecho) ou não sei.",
  "3. Faça o mesmo para a Resposta 2, na coluna J. As duas respostas vêm de instruções diferentes, em ordem embaralhada: julgue cada uma por si.",
  "4. Se quiser, marque na coluna L o estado que você daria (Atende, Não atende, Inconclusivo, Não se aplica) e anote o que achar útil nas colunas de observação.",
  "",
  "Inconclusivo é a resposta certa quando o trecho não permite decidir. Quando o trecho mostra que falta algo pedido, Não atende é a resposta certa, e Inconclusivo é errada.",
  "Os PPCs são da base pública do IFPR; esta planilha não é parecer e não avalia os cursos.",
];

async function gerarPlanilha() {
  const pares = montarPares();
  const chave: Record<string, Record<"Resposta 1" | "Resposta 2", CriterioInconclusivo>> = {};
  const livro = new ExcelJS.Workbook();
  livro.creator = "Simplifica IF";
  // A aba de instruções primeiro: é a que abre.
  const instrucoes = livro.addWorksheet("Como preencher");
  instrucoes.getColumn(1).width = 120;
  for (const texto of COMO_PREENCHER) instrucoes.addRow([texto]).alignment = { wrapText: true };
  const aba = livro.addWorksheet("Pares", { views: [{ state: "frozen", ySplit: 1, xSplit: 1 }] });
  aba.columns = COLUNAS.map((c) => ({ ...c }));
  for (const p of pares) {
    const [a, b] = ordem(p.id);
    chave[p.id] = { "Resposta 1": a, "Resposta 2": b };
    const linha = aba.addRow({
      par: p.id,
      curso: p.curso ?? p.par.ppc,
      criterio: `${p.par.ficha}\n${p.titulo}`,
      pede: p.criterioTexto,
      recorte: cortar(p.recorte),
      r1: respostaLegivel(p.respostas[a].resultado),
      r2: respostaLegivel(p.respostas[b].resultado),
    });
    linha.height = 400;
    linha.alignment = { wrapText: true, vertical: "top" };
    for (const col of ["G", "J"])
      aba.getCell(`${col}${linha.number}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`"${AVALIACOES.join(",")}"`],
      };
    aba.getCell(`L${linha.number}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`"${ESTADOS_PESSOA.join(",")}"`],
    };
    for (const col of ["G", "H", "J", "K", "L", "M"])
      aba.getCell(`${col}${linha.number}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF8E1" } };
  }
  const cabeca = aba.getRow(1);
  cabeca.font = { bold: true };
  cabeca.alignment = { wrapText: true, vertical: "middle" };
  cabeca.height = 32;
  await livro.xlsx.writeFile(arquivo(NOME_PLANILHA));
  NodeFS.writeFileSync(arquivo(NOME_CHAVE), JSON.stringify(chave, null, 2));
  NodeFS.writeFileSync(arquivo(NOME_PAGINA), pagina(pares));
  console.log(
    `${pares.length} pares\n${arquivo(NOME_PLANILHA)}\n${arquivo(NOME_PAGINA)}\n${arquivo(NOME_CHAVE)} (fora da planilha)`,
  );
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function pagina(pares: ParCompleto[]): string {
  const cartoes = pares
    .map((p) => {
      const [a, b] = ordem(p.id);
      return `<article id="${p.id}">
  <h2>${p.id} · ${esc(p.par.ficha)}: ${esc(p.titulo)}</h2>
  <p class="curso">${esc(p.curso ?? p.par.ppc)}</p>
  <section><h3>O que o critério pede</h3><pre>${esc(p.criterioTexto)}</pre></section>
  <details><summary>Trecho do PPC que a IA leu (${p.recorte.length.toLocaleString("pt-BR")} caracteres)</summary><pre class="recorte">${esc(p.recorte)}</pre></details>
  <div class="respostas">
    <section><h3>Resposta 1</h3><pre>${esc(respostaLegivel(p.respostas[a].resultado))}</pre></section>
    <section><h3>Resposta 2</h3><pre>${esc(respostaLegivel(p.respostas[b].resultado))}</pre></section>
  </div>
</article>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rotulação dos inconclusivos</title>
<style>
:root { --fundo: #fafaf7; --texto: #1d1d1b; --suave: #5f5f5a; --borda: #ddd9cf; --cartao: #fff; --realce: #fff8e1; }
@media (prefers-color-scheme: dark) { :root { --fundo: #161614; --texto: #ecebe6; --suave: #a8a69f; --borda: #3a3934; --cartao: #1f1f1c; --realce: #2e2a1d; } }
body { margin: 0; background: var(--fundo); color: var(--texto); font: 15px/1.5 system-ui, sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 64px; }
article { background: var(--cartao); border: 1px solid var(--borda); border-radius: 8px; padding: 16px; margin: 16px 0; }
h1 { font-size: 1.4rem; } h2 { font-size: 1.1rem; margin: 0 0 4px; } h3 { font-size: .95rem; margin: 12px 0 4px; color: var(--suave); }
.curso { color: var(--suave); margin: 0; }
pre { white-space: pre-wrap; word-wrap: break-word; font: inherit; margin: 0; }
pre.recorte { font: 13px/1.45 ui-monospace, monospace; max-height: 60vh; overflow: auto; background: var(--fundo); padding: 8px; border-radius: 4px; }
summary { cursor: pointer; margin-top: 12px; font-weight: 600; }
.respostas { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.respostas section { background: var(--realce); padding: 4px 12px 12px; border-radius: 6px; }
.aviso { background: var(--realce); padding: 12px; border-radius: 6px; }
@media (max-width: 700px) { .respostas { grid-template-columns: 1fr; } }
</style></head>
<body><main>
<h1>Rotulação dos inconclusivos (revisão com IA)</h1>
<div class="aviso">${COMO_PREENCHER.filter(Boolean)
    .map((l) => `<p>${esc(l)}</p>`)
    .join("")}<p>Esta página é só para leitura; as marcações vão na planilha (${NOME_PLANILHA}).</p></div>
${cartoes}
</main></body></html>
`;
}

/* ------------------------------------------------------------ calcular */

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}% (${a}/${b})` : "—");

async function calcular() {
  const caminho = opcao("--planilha");
  if (!caminho) throw new Error("--planilha preenchida.xlsx");
  const chave = JSON.parse(NodeFS.readFileSync(opcao("--chave") ?? arquivo(NOME_CHAVE), "utf8")) as Record<
    string,
    Record<"Resposta 1" | "Resposta 2", CriterioInconclusivo>
  >;
  const pares = new Map(montarPares().map((p) => [p.id, p]));
  const livro = new ExcelJS.Workbook();
  await livro.xlsx.readFile(caminho);
  const aba = livro.getWorksheet("Pares");
  if (!aba) throw new Error("a planilha não tem a aba Pares");
  const coluna = new Map<string, number>();
  aba.getRow(1).eachCell((c, n) => coluna.set(String(c.value).trim(), n));
  const valor = (linha: ExcelJS.Row, cabeca: string) => {
    const n = coluna.get(cabeca);
    const v = n ? linha.getCell(n).value : null;
    return v === null || v === undefined ? "" : String(typeof v === "object" && "text" in v ? v.text : v).trim();
  };
  type Rotulo = { estado: ResultadoFichaIa["estado"]; lista: string | null; avaliacao: string; correto: string };
  const porInstrucao: Record<CriterioInconclusivo, Rotulo[]> = { conservador: [], ausencia: [] };
  const corretos: { par: string; correto: string; conservador: string; ausencia: string }[] = [];
  aba.eachRow((linha, n) => {
    if (n === 1) return;
    const id = valor(linha, "Par");
    const par = pares.get(id);
    const k = chave[id];
    if (!par || !k) return;
    const correto = ESTADO_DA_PESSOA[valor(linha, "Estado correto (opcional)")] ?? "";
    for (const [i, rotulo] of [
      [1, "Resposta 1"],
      [2, "Resposta 2"],
    ] as const) {
      const criterio = k[rotulo];
      const r = par.respostas[criterio].resultado;
      porInstrucao[criterio].push({
        estado: r.estado,
        lista: estadoDaIa(r),
        avaliacao: valor(linha, `Resposta ${i}: avaliação`).toLowerCase(),
        correto,
      });
    }
    if (correto)
      corretos.push({
        par: id,
        correto,
        conservador: par.respostas.conservador.resultado.estado,
        ausencia: par.respostas.ausencia.resultado.estado,
      });
  });

  const relatorio: Record<string, unknown> = {};
  for (const criterio of ["conservador", "ausencia"] as const) {
    const rs = porInstrucao[criterio];
    const distribuicao: Record<string, number> = {};
    for (const r of rs) distribuicao[r.estado] = (distribuicao[r.estado] ?? 0) + 1;
    const rotulados = (lista: Rotulo[]) => lista.filter((r) => r.avaliacao === "certa" || r.avaliacao === "errada");
    const certas = (lista: Rotulo[]) => lista.filter((r) => r.avaliacao === "certa").length;
    const nao = rs.filter((r) => r.estado === "NAO_ATENDE");
    const naoLista = rs.filter((r) => r.lista === "nao_atende");
    relatorio[criterio] = {
      respostas: rs.length,
      distribuicao,
      taxaInconclusivo: pct(rs.filter((r) => r.estado === "INCONCLUSIVO").length, rs.length),
      taxaAConferirNaLista: pct(rs.filter((r) => r.lista === "a_conferir").length, rs.length),
      precisaoNaoAtende: pct(certas(rotulados(nao)), rotulados(nao).length),
      precisaoNaoAtendeNaLista: pct(certas(rotulados(naoLista)), rotulados(naoLista).length),
      acertoGeral: pct(certas(rotulados(rs)), rotulados(rs).length),
      naoSei: rs.filter((r) => r.avaliacao === "não sei").length,
      semMarcacao: rs.filter((r) => !r.avaliacao).length,
      concordanciaComAPessoa: pct(corretos.filter((c) => c[criterio] === c.correto).length, corretos.length),
    };
  }
  const todos = [...pares.values()];
  relatorio["concordanciaEntreInstrucoes"] = pct(
    todos.filter((p) => p.respostas.conservador.resultado.estado === p.respostas.ausencia.resultado.estado).length,
    todos.length,
  );
  NodeFS.writeFileSync(arquivo("resultado-rotulacao.json"), JSON.stringify(relatorio, null, 2));
  console.log(JSON.stringify(relatorio, null, 2));
}

/* ------------------------------------------------------------ resumo sem rotulação */

/** Os números brutos, sem rotulação: estados, primeira tentativa aceita, tokens e custo, por instrução. */
function resumir() {
  const linhas = lerExecucao();
  const pares = montarPares();
  const relatorio: Record<string, unknown> = {};
  for (const criterio of ["conservador", "ausencia"] as const) {
    const doCriterio = linhas.filter((l) => l.criterio === criterio);
    const estados: Record<string, number> = {};
    const lista: Record<string, number> = {};
    const tipos: Record<string, number> = {};
    for (const p of pares) {
      const r = p.respostas[criterio].resultado;
      estados[r.estado] = (estados[r.estado] ?? 0) + 1;
      const l = estadoDaIa(r) ?? "sem_pendencia";
      lista[l] = (lista[l] ?? 0) + 1;
      if (r.tipoAchado) tipos[r.tipoAchado] = (tipos[r.tipoAchado] ?? 0) + 1;
    }
    const soma = (k: keyof LinhaExecucao["uso"]) => doCriterio.reduce((t, l) => t + l.uso[k], 0);
    const entrada = soma("entrada") + soma("cacheLeitura") + soma("cacheEscrita");
    relatorio[criterio] = {
      blocos: doCriterio.length,
      primeiraTentativaAceita: pct(doCriterio.filter((l) => l.resultado.tentativas === 1).length, doCriterio.length),
      problemasDaPrimeira: doCriterio.flatMap((l) => l.resultado.problemasPrimeira ?? []),
      fichasQueFalharam: doCriterio.flatMap((l) => l.resultado.resultados.filter((r) => r.estado === "FALHOU")).length,
      estadosNosPares: estados,
      estadosNaLista: lista,
      tipoAchado: tipos,
      tokens: {
        entrada: soma("entrada"),
        cacheLeitura: soma("cacheLeitura"),
        cacheEscrita: soma("cacheEscrita"),
        saida: soma("saida"),
      },
      custoUsdAgentSdk: Math.round(soma("custoUsd") * 1000) / 1000,
      custoUsdPeloPrecoSonnet: Math.round(((entrada * 3 + soma("saida") * 15) / 1_000_000) * 1000) / 1000,
      segundos: Math.round(doCriterio.reduce((t, l) => t + l.segundos, 0)),
    };
  }
  relatorio["paresQueMudaram"] = pares
    .filter((p) => p.respostas.conservador.resultado.estado !== p.respostas.ausencia.resultado.estado)
    .map(
      (p) =>
        `${p.id} ${p.par.ficha}: ${p.respostas.conservador.resultado.estado} → ${p.respostas.ausencia.resultado.estado}`,
    );
  NodeFS.writeFileSync(arquivo("resumo-bruto.json"), JSON.stringify(relatorio, null, 2));
  console.log(JSON.stringify(relatorio, null, 2));
}

if (comando === "planilha") await gerarPlanilha();
else if (comando === "calcular") await calcular();
else if (comando === "resumo") resumir();
else console.error("use: planilha | calcular --planilha arquivo.xlsx | resumo");
