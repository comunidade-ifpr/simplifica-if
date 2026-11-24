// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- script de avaliação: arquivos
/**
 * A rotulação cega da avaliação do INCONCLUSIVO (M1.11, etapa 5), sobre o que
 * `avaliar-inconclusivos.ts` gravou (`conjunto.json`, `execucao.jsonl`), sem nenhuma chamada de IA.
 *
 *   node apps/server/scripts/planilha-inconclusivos.ts resumo   [--saida pasta]
 *   node apps/server/scripts/planilha-inconclusivos.ts planilha [--saida pasta]
 *   node apps/server/scripts/planilha-inconclusivos.ts calcular --planilha preenchida.xlsx [--saida pasta]
 *
 * **Reconferência:** as respostas brutas gravadas passam de novo pela conferência e pelo resultado do
 * bloco **do código atual** (`conferidorDoBloco`, `resultadoDoBloco`), sem chamada: as regras novas
 * valem para os números e para a planilha. Uma ficha que a regra nova recusaria na primeira resposta,
 * num bloco em que a execução não fez nova tentativa, sai "falhou (sem nova tentativa gravada)".
 *
 * `resumo` dá os números brutos (como gravado e reconferido), por instrução.
 *
 * `planilha` gera, **só para o rotulador**, a pasta `para-rotular/` com `rotulacao-inconclusivos.xlsx`
 * (uma linha por par: o critério em linguagem simples, o trecho do PPC que a IA leu, as duas respostas
 * como "Resposta 1" e "Resposta 2", as colunas para marcar) e `rotulacao-inconclusivos.html` (o mesmo,
 * só leitura). A ordem das respostas é sorteada (`crypto.randomInt`) e só a chave a guarda
 * (`chave-embaralhamento.json`, fora de `para-rotular/`, com o estado e a instrução de cada resposta).
 * Pares em que uma das respostas falhou na conferência ficam fora da rotulação (o "falhou" só aparece
 * numa das instruções e revelaria a ordem) e são contados à parte. Nada na planilha diz a instrução:
 * nem o `tipo_achado`, nem a confiança.
 *
 * `calcular` lê a planilha preenchida e a chave e dá, por instrução, a **precisão de NAO_ATENDE** (a
 * métrica principal; pela IA e pela lista, depois de `estadoDaIa`), as taxas de INCONCLUSIVO e de "a
 * conferir", o acerto e a concordância (entre as instruções e com o estado marcado pela pessoa).
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import ExcelJS from "exceljs";
import type { AlvosDoBloco, CriterioInconclusivo } from "@simplifica-if/ppc/revisao-ia/pedido";
import { type FichaIa, fichaIa } from "@simplifica-if/ppc/revisao-ia/plano";
import { estadoDaIa, type ResultadoFichaIa } from "@simplifica-if/ppc/revisao-previa";
import { conferidorDoBloco, precisaNovaTentativa, resultadoDoBloco } from "../src/revisao-ppc/julgamento.ts";
import type { LinhaExecucao, Par } from "./avaliar-inconclusivos.ts";

const RAIZ = NodePath.resolve(import.meta.dirname, "../../..");
const args = process.argv.slice(2);
const comando = args[0];
const opcao = (nome: string) => {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : undefined;
};
const saida = opcao("--saida") ?? NodePath.join(NodeOS.tmpdir(), "simplifica-avaliacao-inconclusivos");
const arquivo = (nome: string) => NodePath.join(saida, nome);

const PASTA_ROTULADOR = "para-rotular";
const NOME_PLANILHA = "rotulacao-inconclusivos.xlsx";
const NOME_PAGINA = "rotulacao-inconclusivos.html";
const NOME_CHAVE = "chave-embaralhamento.json";
/** O teto de uma célula do Excel é 32.767 caracteres. */
const LIMITE_CELULA = 32_000;
const AVALIACOES = ["certa", "errada", "não sei"] as const;
const ESTADOS_PESSOA = ["Atende", "Não atende", "Inconclusivo", "Não se aplica"] as const;
const CRITERIOS: readonly CriterioInconclusivo[] = ["conservador", "ausencia"];

const ESTADO_LEGIVEL: Record<ResultadoFichaIa["estado"], string> = {
  ATENDE: "Atende",
  NAO_ATENDE: "Não atende",
  INCONCLUSIVO: "Inconclusivo (pede conferência)",
  NAO_APLICAVEL: "Não se aplica",
  FALHOU: "Sem resposta válida",
};

/** Minúsculas, sem acento e sem espaços nas pontas: "Certa ", "NÃO SEI", "atende". */
const chaveTexto = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
const AVALIACAO_DA_PESSOA = new Map(AVALIACOES.map((a) => [chaveTexto(a), a]));
const ESTADO_DA_PESSOA = new Map<string, ResultadoFichaIa["estado"]>([
  ["atende", "ATENDE"],
  ["nao atende", "NAO_ATENDE"],
  ["inconclusivo", "INCONCLUSIVO"],
  ["nao se aplica", "NAO_APLICAVEL"],
]);

/* ------------------------------------------------------------ reconferência */

const fichas = new Map<string, FichaIa>();
const fichaDaBase = (id: string) => {
  let f = fichas.get(id);
  if (!f) {
    const caminho = NodePath.join(RAIZ, "base-conhecimento/revisao-ppc/fichas", `${id.toLowerCase()}.json`);
    f = fichaIa(JSON.parse(NodeFS.readFileSync(caminho, "utf8")) as Record<string, unknown>);
    fichas.set(id, f);
  }
  return f;
};

type Reconferida = LinhaExecucao & {
  reconferido: LinhaExecucao["resultado"];
  /** Fichas que a regra nova recusaria na primeira resposta, sem nova tentativa gravada. */
  semNovaTentativa: string[];
};

/** As respostas gravadas pela conferência e pelo resultado do bloco do código atual. */
function reconferir(linha: LinhaExecucao): Reconferida {
  const doBloco = linha.fichas.map(fichaDaBase);
  const alvos: AlvosDoBloco =
    linha.alvos ??
    Object.fromEntries(
      linha.fichas.map((f) => {
        const texto = linha.conteudo[f] ?? "";
        return [f, { alvo: texto, secao: texto.trim().length > 0 ? texto : null }];
      }),
    );
  const conferir = conferidorDoBloco({
    bloco: { id: linha.bloco, tipo: linha.tipo, tema: "", ordemTema: 0, fichas: linha.fichas },
    fichas: doBloco,
    alvos,
    fontes: new Set(linha.fontes),
    criterio: linha.criterio,
  });
  const primeira = conferir(linha.respostas[0] ?? "");
  const pede = precisaNovaTentativa(primeira);
  const segunda = pede && linha.respostas[1] !== undefined ? conferir(linha.respostas[1]) : null;
  const reconferido = resultadoDoBloco(doBloco, primeira, segunda, false);
  const semNovaTentativa =
    pede && !segunda ? reconferido.resultados.filter((r) => r.estado === "FALHOU").map((r) => r.ficha) : [];
  for (const r of reconferido.resultados)
    if (semNovaTentativa.includes(r.ficha)) r.motivoFalha = `${r.motivoFalha} (sem nova tentativa gravada)`;
  return { ...linha, reconferido, semNovaTentativa };
}

function lerExecucao(): Reconferida[] {
  return NodeFS.readFileSync(arquivo("execucao.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => reconferir(JSON.parse(l) as LinhaExecucao));
}

/* ------------------------------------------------------------ pares */

type Resposta = { gravado: ResultadoFichaIa; resultado: ResultadoFichaIa };
type ParCompleto = {
  id: string;
  par: Par;
  curso: string | null;
  criterioTexto: string;
  titulo: string;
  recorte: string;
  respostas: Record<CriterioInconclusivo, Resposta>;
};

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

function montarPares(linhas: readonly Reconferida[]): ParCompleto[] {
  const { pares } = JSON.parse(NodeFS.readFileSync(arquivo("conjunto.json"), "utf8")) as { pares: Par[] };
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
    const resposta = (l: Reconferida): Resposta => ({
      gravado: l.resultado.resultados.find((r) => r.ficha === par.ficha)!,
      resultado: l.reconferido.resultados.find((r) => r.ficha === par.ficha)!,
    });
    const ficha = fichaDoPedido(conservador.pedido, par.ficha);
    completos.push({
      id: `P${String(i + 1).padStart(2, "0")}`,
      par,
      curso: conservador.curso,
      criterioTexto: ficha.texto,
      titulo: ficha.titulo,
      recorte: conservador.conteudo[par.ficha] ?? "",
      respostas: { conservador: resposta(conservador), ausencia: resposta(ausencia) },
    });
  });
  return completos;
}

const falhouAlguma = (p: ParCompleto) => CRITERIOS.some((c) => p.respostas[c].resultado.estado === "FALHOU");

/* ------------------------------------------------------------ resumo bruto */

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}% (${a}/${b})` : "—");
const contar = (valores: readonly string[]) => {
  const c: Record<string, number> = {};
  for (const v of valores) c[v] = (c[v] ?? 0) + 1;
  return c;
};

/** Os números brutos, sem rotulação: como gravado e reconferido com as regras atuais, por instrução. */
function resumir() {
  const linhas = lerExecucao();
  const pares = montarPares(linhas);
  const relatorio: Record<string, unknown> = {};
  for (const criterio of CRITERIOS) {
    const doCriterio = linhas.filter((l) => l.criterio === criterio);
    const estados = (qual: keyof Resposta) => {
      const rs = pares.map((p) => p.respostas[criterio][qual]);
      return {
        estados: contar(rs.map((r) => r.estado)),
        lista: contar(rs.map((r) => estadoDaIa(r) ?? "sem_pendencia")),
        tipoAchado: contar(rs.flatMap((r) => (r.tipoAchado ? [r.tipoAchado] : []))),
      };
    };
    const soma = (k: keyof LinhaExecucao["uso"]) => doCriterio.reduce((t, l) => t + l.uso[k], 0);
    const entrada = soma("entrada") + soma("cacheLeitura") + soma("cacheEscrita");
    const naoAtendeGravado = pares.map((p) => p.respostas[criterio].gravado).filter((r) => r.estado === "NAO_ATENDE");
    relatorio[criterio] = {
      blocos: doCriterio.length,
      primeiraTentativaAceita: pct(doCriterio.filter((l) => l.resultado.tentativas === 1).length, doCriterio.length),
      problemasDaPrimeira: doCriterio.flatMap((l) => l.resultado.problemasPrimeira ?? []),
      comoGravado: {
        ...estados("gravado"),
        // O campo ainda estava no pedido quando a IA respondeu (antes da revisão da etapa 5).
        revisaoHumanaDaIaNosNaoAtende: pct(
          naoAtendeGravado.filter((r) => r.revisaoHumana).length,
          naoAtendeGravado.length,
        ),
      },
      reconferido: {
        ...estados("resultado"),
        semNovaTentativaGravada: doCriterio.flatMap((l) => l.semNovaTentativa.map((f) => `${l.ppc} ${f}`)),
        mudaramNaReconferencia: pares
          .filter((p) => p.respostas[criterio].gravado.estado !== p.respostas[criterio].resultado.estado)
          .map(
            (p) =>
              `${p.id} ${p.par.ficha}: ${p.respostas[criterio].gravado.estado} → ${p.respostas[criterio].resultado.estado} (${p.respostas[criterio].resultado.motivoFalha ?? ""})`,
          ),
      },
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
  relatorio["paresQueMudaramEntreInstrucoes"] = pares
    .filter((p) => p.respostas.conservador.resultado.estado !== p.respostas.ausencia.resultado.estado)
    .map(
      (p) =>
        `${p.id} ${p.par.ficha}: ${p.respostas.conservador.resultado.estado} → ${p.respostas.ausencia.resultado.estado}`,
    );
  relatorio["foraDaRotulacao"] = pares
    .filter(falhouAlguma)
    .map(
      (p) =>
        `${p.id} ${p.par.ficha}: ${CRITERIOS.map((c) => `${c} ${p.respostas[c].resultado.estado}${p.respostas[c].resultado.motivoFalha ? ` (${p.respostas[c].resultado.motivoFalha})` : ""}`).join("; ")}`,
    );
  NodeFS.writeFileSync(arquivo("resumo-bruto.json"), JSON.stringify(relatorio, null, 2));
  console.log(JSON.stringify(relatorio, null, 2));
}

/* ------------------------------------------------------------ planilha e página */

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

/** Instruções neutras: nada aqui favorece uma das formas de decidir. */
const COMO_PREENCHER = [
  "Como preencher (uma linha por par, na aba Pares):",
  "1. Leia o que o critério pede (coluna D) e o trecho do PPC que a IA leu (coluna E). Julgue só por esse trecho: é o que a IA recebeu.",
  "2. Leia a Resposta 1 e marque na coluna G: certa, errada ou não sei. Certa: o estado está correto dado o trecho, e o que a resposta diz que falta de fato falta no trecho. Errada: o estado não se sustenta pelo trecho, ou a falta apontada não existe (o item está no trecho).",
  "3. Faça o mesmo para a Resposta 2, na coluna J. As duas respostas vêm de formas diferentes de pedir à IA, em ordem sorteada: julgue cada uma por si.",
  "4. Se quiser, marque na coluna L o estado que você daria (Atende, Não atende, Inconclusivo, Não se aplica) e anote o que achar útil nas colunas de observação.",
  "",
  "Os PPCs são da base pública do IFPR; esta planilha não é parecer e não avalia os cursos.",
];

type ChaveResposta = {
  criterio: CriterioInconclusivo;
  estado: ResultadoFichaIa["estado"];
  lista: ReturnType<typeof estadoDaIa>;
};
type Chave = Record<string, Record<"Resposta 1" | "Resposta 2", ChaveResposta>>;
type Ordem = [CriterioInconclusivo, CriterioInconclusivo];

async function gerarPlanilha() {
  const todos = montarPares(lerExecucao());
  const pares = todos.filter((p) => !falhouAlguma(p));
  const chave: Chave = {};
  const pasta = arquivo(PASTA_ROTULADOR);
  NodeFS.rmSync(pasta, { recursive: true, force: true });
  NodeFS.mkdirSync(pasta, { recursive: true });
  const livro = new ExcelJS.Workbook();
  livro.creator = "Simplifica IF";
  // A aba de instruções primeiro: é a que abre.
  const instrucoes = livro.addWorksheet("Como preencher");
  instrucoes.getColumn(1).width = 120;
  for (const texto of COMO_PREENCHER) instrucoes.addRow([texto]).alignment = { wrapText: true };
  const aba = livro.addWorksheet("Pares", { views: [{ state: "frozen", ySplit: 1, xSplit: 1 }] });
  aba.columns = COLUNAS.map((c) => ({ ...c }));
  const ordens = new Map<string, Ordem>();
  for (const p of pares) {
    // Sorteio de verdade: a ordem só existe na chave.
    const ordem: Ordem = NodeCrypto.randomInt(2) === 0 ? ["conservador", "ausencia"] : ["ausencia", "conservador"];
    ordens.set(p.id, ordem);
    const [a, b] = ordem;
    const daChave = (c: CriterioInconclusivo): ChaveResposta => ({
      criterio: c,
      estado: p.respostas[c].resultado.estado,
      lista: estadoDaIa(p.respostas[c].resultado),
    });
    chave[p.id] = { "Resposta 1": daChave(a), "Resposta 2": daChave(b) };
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
  await livro.xlsx.writeFile(NodePath.join(pasta, NOME_PLANILHA));
  NodeFS.writeFileSync(NodePath.join(pasta, NOME_PAGINA), pagina(pares, ordens));
  NodeFS.writeFileSync(arquivo(NOME_CHAVE), JSON.stringify(chave, null, 2));
  console.log(
    [
      `${pares.length} pares na rotulação; ${todos.length - pares.length} fora (uma das respostas falhou na conferência; ver resumo-bruto.json)`,
      `para o rotulador: ${pasta}`,
      `chave (fora da pasta do rotulador): ${arquivo(NOME_CHAVE)}`,
    ].join("\n"),
  );
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function pagina(pares: readonly ParCompleto[], ordens: ReadonlyMap<string, Ordem>): string {
  const cartoes = pares
    .map((p) => {
      const [a, b] = ordens.get(p.id)!;
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

/** O texto de uma célula: texto simples, rich text (os pedaços juntos), fórmula com resultado, link. */
function textoDaCelula(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v !== "object") return String(v).trim();
  if (v instanceof Date) return v.toISOString();
  if ("richText" in v)
    return v.richText
      .map((p) => p.text)
      .join("")
      .trim();
  if ("text" in v) return String(v.text).trim();
  if ("result" in v) return textoDaCelula(v.result as ExcelJS.CellValue);
  return "";
}

async function calcular() {
  const caminho = opcao("--planilha");
  if (!caminho) throw new Error("--planilha preenchida.xlsx");
  const chave = JSON.parse(NodeFS.readFileSync(opcao("--chave") ?? arquivo(NOME_CHAVE), "utf8")) as Chave;
  const livro = new ExcelJS.Workbook();
  await livro.xlsx.readFile(caminho);
  const aba = livro.getWorksheet("Pares");
  if (!aba) throw new Error("a planilha não tem a aba Pares");
  const coluna = new Map<string, number>();
  aba.getRow(1).eachCell((c, n) => coluna.set(textoDaCelula(c.value), n));
  const valor = (linha: ExcelJS.Row, cabeca: string) => {
    const n = coluna.get(cabeca);
    return n ? textoDaCelula(linha.getCell(n).value) : "";
  };
  type Rotulo = ChaveResposta & { avaliacao: string; correto: string };
  const porInstrucao: Record<CriterioInconclusivo, Rotulo[]> = { conservador: [], ausencia: [] };
  const naoReconhecidos: string[] = [];
  const vistos = new Set<string>();
  aba.eachRow((linha, n) => {
    if (n === 1) return;
    const id = valor(linha, "Par");
    if (!id) return;
    const k = chave[id];
    if (!k) {
      naoReconhecidos.push(`linha ${n}: par "${id}" não está na chave`);
      return;
    }
    if (vistos.has(id)) {
      naoReconhecidos.push(`linha ${n}: par ${id} repetido (fica a primeira)`);
      return;
    }
    vistos.add(id);
    const marcadoCorreto = valor(linha, "Estado correto (opcional)");
    const correto = ESTADO_DA_PESSOA.get(chaveTexto(marcadoCorreto)) ?? "";
    if (marcadoCorreto && !correto) naoReconhecidos.push(`linha ${n} (${id}), estado correto: "${marcadoCorreto}"`);
    for (const rotulo of ["Resposta 1", "Resposta 2"] as const) {
      const marcado = valor(linha, `${rotulo}: avaliação`);
      const avaliacao = AVALIACAO_DA_PESSOA.get(chaveTexto(marcado)) ?? "";
      if (marcado && !avaliacao) naoReconhecidos.push(`linha ${n} (${id}), ${rotulo}: "${marcado}"`);
      porInstrucao[k[rotulo].criterio].push({ ...k[rotulo], avaliacao, correto });
    }
  });

  const relatorio: Record<string, unknown> = {};
  const certas = (lista: readonly Rotulo[]) => lista.filter((r) => r.avaliacao === "certa").length;
  const rotulados = (lista: readonly Rotulo[]) =>
    lista.filter((r) => r.avaliacao === "certa" || r.avaliacao === "errada");
  for (const criterio of CRITERIOS) {
    const rs = porInstrucao[criterio];
    const nao = rotulados(rs.filter((r) => r.estado === "NAO_ATENDE"));
    const naoLista = rotulados(rs.filter((r) => r.lista === "nao_atende"));
    const comCorreto = rs.filter((r) => r.correto);
    relatorio[criterio] = {
      // A métrica principal.
      precisaoNaoAtende: pct(certas(nao), nao.length),
      precisaoNaoAtendeNaLista: pct(certas(naoLista), naoLista.length),
      taxaInconclusivo: pct(rs.filter((r) => r.estado === "INCONCLUSIVO").length, rs.length),
      taxaAConferirNaLista: pct(rs.filter((r) => r.lista === "a_conferir").length, rs.length),
      acertoGeral: pct(certas(rotulados(rs)), rotulados(rs).length),
      respostas: rs.length,
      distribuicao: contar(rs.map((r) => r.estado)),
      naoSei: rs.filter((r) => r.avaliacao === "não sei").length,
      semMarcacao: rs.filter((r) => !r.avaliacao).length,
      concordanciaComAPessoa: pct(comCorreto.filter((r) => r.estado === r.correto).length, comCorreto.length),
    };
  }
  const ids = Object.keys(chave).filter((id) => vistos.has(id));
  const estadoDe = (id: string, c: CriterioInconclusivo) =>
    Object.values(chave[id]!).find((r) => r.criterio === c)!.estado;
  relatorio["concordanciaEntreInstrucoes"] = pct(
    ids.filter((id) => estadoDe(id, "conservador") === estadoDe(id, "ausencia")).length,
    ids.length,
  );
  relatorio["valoresNaoReconhecidos"] = naoReconhecidos;
  NodeFS.writeFileSync(arquivo("resultado-rotulacao.json"), JSON.stringify(relatorio, null, 2));
  console.log(JSON.stringify(relatorio, null, 2));
}

if (comando === "planilha") await gerarPlanilha();
else if (comando === "calcular") await calcular();
else if (comando === "resumo") resumir();
else console.error("use: resumo | planilha | calcular --planilha arquivo.xlsx");
