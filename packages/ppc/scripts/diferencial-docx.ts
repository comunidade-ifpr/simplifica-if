// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off -- ferramenta de desenvolvimento, síncrona: subprocessos (git, uv, diff), arquivos em tmp/, saída no console e relógio fixo
/**
 * Diferencial da conversão DOCX: compara a conversão em TypeScript (`../src/conversao-docx/`) com a
 * conversão em Python que ela substituiu, extraída do git num commit fixo.
 *
 * Ferramenta de desenvolvimento, fora do app e da skill: precisa de `git`, `uv` e `diff`. O Python
 * roda num ambiente temporário (`uv run --with python-docx==1.2.0 --with rapidfuzz`); nada é
 * instalado.
 *
 * Uso, a partir da raiz do repositório:
 *
 *   KB_CORPUS_DOCX="/pasta/com/ppcs" node packages/ppc/scripts/diferencial-docx.ts
 *
 * Sem `KB_CORPUS_DOCX` (ou `--corpus <pasta>`), compara só os documentos sintéticos de
 * `src/testes/documentos.ts`. A saída vai para `tmp/diferencial-docx/` (`--saida` muda):
 * os artefatos das duas conversões, os `.diff` e `relatorio.md`. O código de saída é 1 se sobrar
 * diferença não aceita.
 *
 * Com `--gravar-gabaritos`, regrava os gabaritos versionados dos testes a partir do oráculo:
 * `test/fixtures/conversao-docx/` (a saída do Python para os documentos sintéticos em que não há
 * diferença aceita) e `test/fixtures/partial-ratio-rapidfuzz.json` (escores do `rapidfuzz`).
 *
 * Para cada documento são comparados:
 * 1. a camada de elementos (títulos, parágrafos com runs, tabelas com células, figuras), lida
 *    pelo `DocxReader` do Python e pelo leitor em TypeScript no modo `python-docx`;
 * 2. os artefatos finais (`.md`, `-bruto.md`, `_dados.json`, matriz, ementário, imagem), também no
 *    modo `python-docx`, depois de neutralizadas as diferenças aceitas (`DIFERENCAS_ACEITAS`);
 * 3. a saída do modo padrão (`documento`) contra a do modo `python-docx`: quantas linhas do
 *    `PPC.md` e dos JSONs mudam, no todo e por regra de `src/conversao-docx/regras.ts` (a conversão
 *    padrão com uma regra desligada, contra a padrão). São as diferenças deliberadas da conversão
 *    nova, descritas em `REGRAS_DO_MODO_DOCUMENTO`.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { type Conversao, converterDocx, converterPpc } from "../src/conversao-docx/conversao.ts";
import type { Elemento } from "../src/conversao-docx/elementos.ts";
import { REGRAS_DO_PYTHON, type Regras } from "../src/conversao-docx/regras.ts";
import { montarDocx } from "@simplifica-if/docx/testes/sintetico";
import { FIXTURES } from "../src/testes/documentos.ts";

/** Último commit com a conversão em Python (`conversao_docx/` e `converter_docx.py`). */
export const COMMIT_PYTHON = "c0d6f0728793024dbee52556590a14c8ac5a8aad";
const PASTA_SCRIPTS = ".agents/skills/revisar-ppc/scripts";
const DEPENDENCIAS_PYTHON = ["--with", "python-docx==1.2.0", "--with", "rapidfuzz==3.14.6"];
const AGORA = "2026-11-16T12:00:00";

export const DIFERENCAS_ACEITAS = [
  {
    id: "propriedades-inventadas",
    descricao:
      "DOCX sem `docProps/core.xml` (exportado do Google Docs): o python-docx inventa as propriedades " +
      '(`title: "Word Document"`, `last_modified_by: "python-docx"`, `modified` com a hora da conversão); ' +
      "a conversão nova deixa `metadata_documento` vazio.",
  },
  {
    id: "figura-nao-renderizada",
    descricao:
      "Representação gráfica sem imagem embutida: o Python tentava renderizar a página com MS Word e poppler " +
      "(`metodo: falha_dependencias` sem eles); a conversão nova não renderiza, registra " +
      "`vetorial_nao_renderizada` ou `figura_nao_localizada` e põe um aviso no `PPC.md`.",
  },
] as const;

type IdDiferenca = (typeof DIFERENCAS_ACEITAS)[number]["id"];

/** As regras do modo `documento`: o que cada uma muda em relação à conversão em Python. */
export const REGRAS_DO_MODO_DOCUMENTO: Array<{ regra: keyof Regras; descricao: string }> = [
  {
    regra: "leitura",
    descricao:
      "lê o texto de alterações controladas (`w:ins`, `w:moveTo`) e de `w:smartTag`, `w:sdt` em linha, `w:fldSimple` e " +
      "`w:customXml`; as linhas, células e parágrafos de tabela embrulhados em `w:sdt`; a numeração automática; a imagem " +
      "legada; nas tabelas em `w:sdt` (Google Docs), tabulações e quebras da célula, sem o texto removido nem a versão de " +
      "compatibilidade das caixas de texto",
  },
  { regra: "titulosDeCorpo", descricao: "texto de corpo com estilo de título sai como parágrafo, não como seção" },
  {
    regra: "listas",
    descricao: "a numeração automática do Word faz itens de lista; o número digitado fica; a alínea sai como `- a) …`",
  },
  { regra: "negritoUnido", descricao: "runs seguidos de mesma formatação num marcador só (`**ab**`, não `**a**b**`)" },
  { regra: "linksSeguros", descricao: "só `http`, `https` e `mailto` viram link, com parênteses e espaços escapados" },
  {
    regra: "totaisDaMatriz",
    descricao:
      "total não declarado da matriz dividida em tabelas é recalculado; `total_ha` e `total_hr` do resumo são somados",
  },
  {
    regra: "secoesNoNivel2",
    descricao:
      'as seções começam em `##` (a "1" é `##`, a "1.1" é `###`) e `#` fica para o título do documento, como nos PPCs ' +
      "da base e na segmentação do `kb`",
  },
];

/** Script Python: converte cada documento e despeja a camada de elementos do `DocxReader`. */
const SCRIPT_PYTHON = String.raw`
import contextlib, json, sys, time
from pathlib import Path

pasta_scripts, lista = sys.argv[1], sys.argv[2]
sys.path.insert(0, pasta_scripts)
import converter_docx
from conversao_docx import ConversionService
from conversao_docx.docx_reader import DocxReader, ElementType

converter_docx._fixar_relogio("${AGORA}")

def despejar(elemento):
    if elemento.type == ElementType.HEADING:
        return {"t": "titulo", "texto": elemento.text, "nivel": elemento.level, "estilo": elemento.style_name}
    if elemento.type == ElementType.PARAGRAPH:
        return {
            "t": "paragrafo",
            "trechos": [[r.text, bool(r.bold), bool(r.italic), bool(r.strike), r.hyperlink_url] for r in elemento.runs],
            "estilo": elemento.style_name,
            "lista": [elemento.is_list_item, elemento.list_level, elemento.list_type],
        }
    if elemento.type == ElementType.TABLE:
        return {"t": "tabela", "linhas": [[[c.text, c.col_span, c.is_merged_continuation] for c in linha] for linha in elemento.rows]}
    return {"t": "figura", "forma": elemento.is_drawing, "id": elemento.rId, "parte": elemento.partname,
            "alt": "" if elemento.is_drawing else elemento.alt_text, "largura": elemento.width_emu, "altura": elemento.height_emu}

resultado = {}
for item in json.loads(Path(lista).read_text(encoding="utf-8")):
    saida = Path(item["saida"])
    saida.mkdir(parents=True, exist_ok=True)
    inicio = time.perf_counter()
    try:
        with contextlib.redirect_stdout(sys.stderr):
            ConversionService().convert(arquivo_docx=Path(item["docx"]), output_dir=saida, verbose=False)
        tempo = time.perf_counter() - inicio
        elementos = [despejar(e) for e in DocxReader(item["docx"]).elements()]
        (saida.parent / "elementos-python.json").write_text(json.dumps(elementos, ensure_ascii=False, indent=1), encoding="utf-8")
        resultado[item["nome"]] = {"segundos": tempo}
    except Exception as erro:
        resultado[item["nome"]] = {"erro": f"{type(erro).__name__}: {erro}"}
print(json.dumps(resultado, ensure_ascii=False))
`;

/** Elementos no mesmo formato do despejo do Python. */
function despejarElementos(elementos: Elemento[]): unknown[] {
  return elementos.map((elemento) => {
    if (elemento.tipo === "titulo")
      return { t: "titulo", texto: elemento.texto, nivel: elemento.nivel, estilo: elemento.estilo };
    if (elemento.tipo === "paragrafo") {
      const tipo = elemento.tipoLista === "numerada" ? "number" : elemento.tipoLista === "marcador" ? "bullet" : null;
      return {
        t: "paragrafo",
        trechos: elemento.trechos.map((trecho) => [
          trecho.texto,
          trecho.negrito,
          trecho.italico,
          trecho.tachado,
          trecho.url,
        ]),
        estilo: elemento.estilo,
        lista: [elemento.itemDeLista, elemento.nivelLista, tipo],
      };
    }
    if (elemento.tipo === "tabela") {
      return {
        t: "tabela",
        linhas: elemento.linhas.map((linha) =>
          linha.map((celula) => [celula.texto, celula.colunas, celula.continuacao]),
        ),
      };
    }
    const figura = elemento.figura;
    if (figura.tipo === "forma")
      return { t: "figura", forma: true, id: "", parte: null, alt: "", largura: null, altura: null };
    return {
      t: "figura",
      forma: false,
      id: figura.idRelacao,
      parte: figura.parte,
      alt: figura.textoAlternativo,
      largura: figura.larguraEmu,
      altura: figura.alturaEmu,
    };
  });
}

function executar(comando: string, argumentos: string[], opcoes: NodeChildProcess.SpawnSyncOptions = {}): string {
  const processo = NodeChildProcess.spawnSync(comando, argumentos, {
    encoding: "utf-8",
    maxBuffer: 1 << 30,
    ...opcoes,
  });
  if (processo.error) throw processo.error;
  if (processo.status !== 0)
    throw new Error(`${comando} ${argumentos.join(" ")} falhou (${processo.status}):\n${processo.stderr}`);
  return String(processo.stdout);
}

function listarDocx(pasta: string): string[] {
  return NodeFS.readdirSync(pasta, { recursive: true, encoding: "utf-8" })
    .filter((nome) => nome.toLowerCase().endsWith(".docx") && !NodePath.basename(nome).startsWith("~$"))
    .map((nome) => NodePath.join(pasta, nome))
    .sort();
}

function arquivosDe(pasta: string): string[] {
  if (!NodeFS.existsSync(pasta)) return [];
  return NodeFS.readdirSync(pasta, { recursive: true, encoding: "utf-8" })
    .filter((nome) => NodeFS.statSync(NodePath.join(pasta, nome)).isFile())
    .sort();
}

type Documento = { nome: string; docx: string; origem: "corpus" | "sintetico" };

type Resultado = {
  documento: Documento;
  segundosPython: number | null;
  milissegundosTs: number;
  erroPython: string | null;
  elementosIguais: boolean;
  /** Arquivos que diferem depois de neutralizadas as diferenças aceitas. */
  arquivosDiferentes: string[];
  aceitas: IdDiferenca[];
  /** Linhas do `PPC.md` e dos JSONs que mudam no modo `documento` em relação ao modo `python-docx`. */
  linhasDoModoDocumento: number;
  /** Linhas que cada regra muda: a conversão padrão com a regra desligada, contra a padrão. */
  linhasPorRegra: Record<string, number>;
};

/** Neutraliza as diferenças aceitas nos artefatos do Python e do TypeScript; devolve as que ocorreram. */
function neutralizar(pastaPython: string, pastaTs: string, base: string, bloco: string | null): IdDiferenca[] {
  const aceitas = new Set<IdDiferenca>();
  const dadosPython = NodePath.join(pastaPython, `${base}_dados.json`);
  const dadosTs = NodePath.join(pastaTs, `${base}_dados.json`);
  const python = JSON.parse(NodeFS.readFileSync(dadosPython, "utf-8"));
  const ts = JSON.parse(NodeFS.readFileSync(dadosTs, "utf-8"));
  let textoPython = NodeFS.readFileSync(dadosPython, "utf-8");
  let textoTs = NodeFS.readFileSync(dadosTs, "utf-8");

  const meta = python.metadata_documento ?? {};
  if (
    meta.title === "Word Document" &&
    meta.last_modified_by === "python-docx" &&
    !Object.keys(ts.metadata_documento).length
  ) {
    aceitas.add("propriedades-inventadas");
    textoPython = textoPython.replace(/"metadata_documento": \{[^}]*\}/, '"metadata_documento": {}');
  }
  const metodoPython = python.representacao_grafica?.metodo;
  const metodoTs = ts.representacao_grafica?.metodo;
  if (
    metodoPython === "falha_dependencias" &&
    (metodoTs === "vetorial_nao_renderizada" || metodoTs === "figura_nao_localizada")
  ) {
    aceitas.add("figura-nao-renderizada");
    textoTs = textoTs.replace(`"metodo": "${metodoTs}"`, '"metodo": "falha_dependencias"');
    if (bloco) {
      for (const [nome, trecho] of [
        [`${base}-bruto.md`, `\n${bloco}\n\n`],
        [`${base}.md`, `${bloco}\n\n`],
      ] as const) {
        const caminho = NodePath.join(pastaTs, nome);
        const texto = NodeFS.readFileSync(caminho, "utf-8");
        if (texto.split(trecho).length === 2) NodeFS.writeFileSync(caminho, texto.replace(trecho, ""), "utf-8");
      }
    }
  }
  NodeFS.writeFileSync(dadosPython, textoPython, "utf-8");
  NodeFS.writeFileSync(dadosTs, textoTs, "utf-8");
  return [...aceitas];
}

/** Texto dos artefatos de uma conversão em memória, sem o Markdown bruto e sem a data. */
function textoDosArtefatos(conversao: Conversao): string {
  return [
    conversao.markdown,
    ...[conversao.dados, conversao.resumos, conversao.matriz, conversao.ementario].map((item) =>
      JSON.stringify(item, null, 1),
    ),
  ].join("\n");
}

/** Linhas que estão num texto e não no outro (por multiconjunto, sem alinhar). */
function linhasDiferentes(a: string, b: string): number {
  if (a === b) return 0;
  const saldo = new Map<string, number>();
  for (const linha of a.split("\n")) saldo.set(linha, (saldo.get(linha) ?? 0) + 1);
  for (const linha of b.split("\n")) saldo.set(linha, (saldo.get(linha) ?? 0) - 1);
  let total = 0;
  for (const valor of saldo.values()) total += Math.abs(valor);
  return total;
}

/** Casos para conferir `partialRatio` contra o `rapidfuzz`: locais com erros de digitação e textos pseudoaleatórios. */
function casosDeSemelhanca(): Array<[string, string]> {
  const locais = [
    "são paulo",
    "rio de janeiro",
    "porto alegre",
    "curitiba",
    "belo horizonte",
    "ribeirão preto",
    "maringá",
  ];
  const frases = [
    "gramática de teste. sao paulo: editora fictícia, 2020. souza, joão",
    "leitura. rio de janiero: teste, 2013.pereira, carlos. texto e contexto. porto algre: modelo",
    "introdução. curitba: intersaberes, 2021. belo horizonte : autêntica; ribeirao preto: usp",
    "maringa: eduem, 2019. disponível em: https://exemplo.gov.br. acesso em: 1 jan. 2026.",
  ];
  const casos: Array<[string, string]> = [
    ["", ""],
    ["", "abc"],
    ["abc", ""],
    ["a", "a"],
    ["a", "b"],
    ["abc", "abc"],
    ["abcd", "abdc"],
    ["curitiba", "curitiba"],
    ["x".repeat(32), `${"x".repeat(31)}y${"x".repeat(10)}`],
    ["abcdefghijklmnopqrstuvwxyzabcdefghijklmnop", "zabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz abcdefghij"],
    ["ação 😀 teste", "uma ação 😀 de teste com emoji 😀"],
  ];
  for (const local of locais) {
    for (const frase of frases) {
      const caracteres = Array.from(frase);
      // As mesmas janelas do ementário: o tamanho do termo mais cinco caracteres.
      for (let i = 0; i + local.length <= caracteres.length; i += 3) {
        casos.push([local, caracteres.slice(i, i + local.length + 5).join("")]);
      }
    }
  }
  // Gerador congruente linear: os casos são sempre os mesmos.
  let semente = 20261116;
  const sortear = (limite: number) => {
    semente = (Math.imul(semente, 1103515245) + 12345) >>> 0;
    return (semente >>> 8) % limite;
  };
  const texto = (tamanho: number) => Array.from({ length: tamanho }, () => "abcde áé"[sortear(8)]).join("");
  for (let i = 0; i < 300; i += 1) casos.push([texto(1 + sortear(40)), texto(1 + sortear(64))]);
  return casos;
}

const SCRIPT_ESCORES = String.raw`
import json, sys
from rapidfuzz import fuzz
casos = json.loads(sys.stdin.read())
linhas = [json.dumps([a, b, fuzz.partial_ratio(a, b)], ensure_ascii=False) for a, b in casos]
print("[\n" + ",\n".join(linhas) + "\n]")
`;

/** Regrava os gabaritos versionados dos testes a partir da saída do oráculo. */
function gravarGabaritos(raiz: string, saida: string, resultados: Resultado[]): void {
  const fixtures = NodePath.join(raiz, "packages/ppc/test/fixtures");
  const destino = NodePath.join(fixtures, "conversao-docx");
  NodeFS.rmSync(destino, { recursive: true, force: true });
  for (const item of resultados) {
    const limpo = !item.erroPython && item.elementosIguais && !item.arquivosDiferentes.length && !item.aceitas.length;
    if (item.documento.origem !== "sintetico" || !limpo) continue;
    const origem = NodePath.join(saida, item.documento.nome, "python");
    const pasta = NodePath.join(destino, item.documento.nome.replace(/^sintetico-/, ""));
    for (const nome of arquivosDe(origem).filter((arquivo) => !arquivo.startsWith("imagens"))) {
      NodeFS.mkdirSync(pasta, { recursive: true });
      NodeFS.copyFileSync(NodePath.join(origem, nome), NodePath.join(pasta, nome));
    }
  }
  const escores = executar("uv", ["run", "-q", ...DEPENDENCIAS_PYTHON, "python", "-c", SCRIPT_ESCORES], {
    input: JSON.stringify(casosDeSemelhanca()),
  });
  NodeFS.writeFileSync(NodePath.join(fixtures, "partial-ratio-rapidfuzz.json"), escores, "utf-8");
  console.log(`Gabaritos regravados em ${fixtures}.`);
}

function main(): number {
  const argumentos = process.argv.slice(2);
  const opcao = (nome: string) => (argumentos.includes(nome) ? argumentos[argumentos.indexOf(nome) + 1] : undefined);
  const raiz = executar("git", ["rev-parse", "--show-toplevel"]).trim();
  const saida = NodePath.resolve(opcao("--saida") ?? NodePath.join(raiz, "tmp", "diferencial-docx"));
  const corpus = opcao("--corpus") ?? process.env.KB_CORPUS_DOCX;
  NodeFS.rmSync(saida, { recursive: true, force: true });
  NodeFS.mkdirSync(saida, { recursive: true });

  // 1. A conversão em Python, do commit fixo.
  const pastaPython = NodePath.join(saida, "_python");
  NodeFS.mkdirSync(pastaPython);
  const pacote = NodeChildProcess.spawnSync(
    "git",
    ["archive", COMMIT_PYTHON, `${PASTA_SCRIPTS}/conversao_docx`, `${PASTA_SCRIPTS}/converter_docx.py`],
    { cwd: raiz, maxBuffer: 1 << 30 },
  );
  if (pacote.status !== 0) throw new Error(`git archive ${COMMIT_PYTHON} falhou: ${pacote.stderr}`);
  executar("tar", ["-x", "-C", pastaPython], { input: pacote.stdout });
  NodeFS.writeFileSync(NodePath.join(pastaPython, "diferencial.py"), SCRIPT_PYTHON, "utf-8");

  // 2. Os documentos: sintéticos (materializados em tmp) e o corpus real, que não é copiado.
  const documentos: Documento[] = [];
  const pastaSinteticos = NodePath.join(saida, "_sinteticos");
  NodeFS.mkdirSync(pastaSinteticos);
  for (const fixture of FIXTURES.filter((item) => item.oraculo)) {
    const docx = NodePath.join(pastaSinteticos, `${fixture.nome}.docx`);
    NodeFS.writeFileSync(docx, montarDocx(fixture.partes()));
    documentos.push({ nome: `sintetico-${fixture.nome}`, docx, origem: "sintetico" });
  }
  if (corpus) {
    for (const [indice, docx] of listarDocx(corpus).entries()) {
      documentos.push({ nome: `corpus-${String(indice + 1).padStart(2, "0")}`, docx, origem: "corpus" });
    }
  } else console.error("KB_CORPUS_DOCX não definida: só os documentos sintéticos serão comparados.");

  // 3. Python, numa execução só.
  const lista = NodePath.join(saida, "_documentos.json");
  NodeFS.writeFileSync(
    lista,
    JSON.stringify(
      documentos.map((item) => ({
        nome: item.nome,
        docx: item.docx,
        saida: NodePath.join(saida, item.nome, "python"),
      })),
    ),
  );
  console.error(`Convertendo ${documentos.length} documentos com o Python de ${COMMIT_PYTHON.slice(0, 7)}…`);
  const temposPython = JSON.parse(
    executar(
      "uv",
      [
        "run",
        "-q",
        ...DEPENDENCIAS_PYTHON,
        "python",
        "-B",
        NodePath.join(pastaPython, "diferencial.py"),
        NodePath.join(pastaPython, PASTA_SCRIPTS),
        lista,
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    ),
  ) as Record<string, { segundos?: number; erro?: string }>;

  // 4. TypeScript e comparação.
  const agora = new Date(AGORA);
  const resultados: Resultado[] = [];
  for (const documento of documentos) {
    const pasta = NodePath.join(saida, documento.nome);
    const python = temposPython[documento.nome] ?? { erro: "sem resultado" };
    const base = NodePath.basename(documento.docx).replace(/\.docx$/i, "");
    const bytes = NodeFS.readFileSync(documento.docx);

    const inicio = performance.now();
    converterDocx(documento.docx, NodePath.join(pasta, "ts"), { agora, fidelidade: "python-docx" });
    const milissegundosTs = performance.now() - inicio;
    const compativel = converterPpc(bytes, NodePath.basename(documento.docx), { agora, fidelidade: "python-docx" });
    converterDocx(documento.docx, NodePath.join(pasta, "ts-documento"), { agora });
    const padrao = textoDosArtefatos(converterPpc(bytes, NodePath.basename(documento.docx), { agora }));
    const linhasPorRegra: Record<string, number> = {};
    for (const { regra } of REGRAS_DO_MODO_DOCUMENTO) {
      const semARegra = converterPpc(bytes, NodePath.basename(documento.docx), {
        agora,
        regras: { [regra]: REGRAS_DO_PYTHON[regra] },
      });
      linhasPorRegra[regra] = linhasDiferentes(padrao, textoDosArtefatos(semARegra));
    }

    const resultado: Resultado = {
      documento,
      segundosPython: python.segundos ?? null,
      milissegundosTs,
      erroPython: python.erro ?? null,
      elementosIguais: false,
      arquivosDiferentes: [],
      aceitas: [],
      linhasDoModoDocumento: linhasDiferentes(padrao, textoDosArtefatos(compativel)),
      linhasPorRegra,
    };
    resultados.push(resultado);
    if (python.erro) continue;

    const elementosTs = JSON.stringify(despejarElementos(compativel.elementos), null, 1);
    NodeFS.writeFileSync(NodePath.join(pasta, "elementos-ts.json"), elementosTs, "utf-8");
    resultado.elementosIguais =
      elementosTs === NodeFS.readFileSync(NodePath.join(pasta, "elementos-python.json"), "utf-8");

    resultado.aceitas = neutralizar(
      NodePath.join(pasta, "python"),
      NodePath.join(pasta, "ts"),
      base,
      compativel.representacaoGrafica?.bloco ?? null,
    );
    const nomes = new Set([...arquivosDe(NodePath.join(pasta, "python")), ...arquivosDe(NodePath.join(pasta, "ts"))]);
    for (const nome of nomes) {
      const [a, b] = [NodePath.join(pasta, "python", nome), NodePath.join(pasta, "ts", nome)];
      const iguais =
        NodeFS.existsSync(a) && NodeFS.existsSync(b) && NodeFS.readFileSync(a).equals(NodeFS.readFileSync(b));
      if (iguais) continue;
      resultado.arquivosDiferentes.push(nome);
      const diferenca = NodeChildProcess.spawnSync("diff", ["-u", a, b], { encoding: "utf-8", maxBuffer: 1 << 30 });
      NodeFS.writeFileSync(
        NodePath.join(pasta, `${nome.replaceAll("/", "_")}.diff`),
        diferenca.stdout || diferenca.stderr,
        "utf-8",
      );
    }
  }

  // 5. Relatório. Os nomes dos arquivos do corpus ficam só no relatório em tmp/, fora do git.
  const falhas = resultados.filter(
    (item) => item.erroPython || !item.elementosIguais || item.arquivosDiferentes.length,
  );
  const linhas = [
    "# Diferencial da conversão DOCX",
    "",
    `Python do commit \`${COMMIT_PYTHON}\` (${DEPENDENCIAS_PYTHON.filter((item) => item !== "--with").join(", ")}) contra a conversão em TypeScript no modo \`python-docx\`.`,
    "",
    `- Documentos: ${resultados.length} (${resultados.filter((item) => item.documento.origem === "corpus").length} do corpus, ${resultados.filter((item) => item.documento.origem === "sintetico").length} sintéticos)`,
    `- Com diferença não aceita: ${falhas.length}`,
    "",
    `| Documento | Arquivo | Python (s) | TS (ms) | Elementos | Artefatos | Diferenças aceitas | Modo \`documento\` (linhas) | ${REGRAS_DO_MODO_DOCUMENTO.map((item) => item.regra).join(" | ")} |`,
    `|---|---|---:|---:|---|---|---|---:|${REGRAS_DO_MODO_DOCUMENTO.map(() => "---:|").join("")}`,
    ...resultados.map((item) =>
      [
        "",
        item.documento.nome,
        NodePath.basename(item.documento.docx),
        item.segundosPython?.toFixed(2) ?? "—",
        item.milissegundosTs.toFixed(0),
        item.erroPython ? `erro no Python: ${item.erroPython}` : item.elementosIguais ? "iguais" : "DIFERENTES",
        item.erroPython
          ? "—"
          : item.arquivosDiferentes.length
            ? `DIFERENTES: ${item.arquivosDiferentes.join(", ")}`
            : "iguais",
        item.aceitas.join(", ") || "—",
        String(item.linhasDoModoDocumento),
        ...REGRAS_DO_MODO_DOCUMENTO.map(({ regra }) => String(item.linhasPorRegra[regra] ?? 0)),
        "",
      ]
        .join(" | ")
        .trim(),
    ),
    "",
    "## Diferenças aceitas",
    "",
    ...DIFERENCAS_ACEITAS.map((item) => `- \`${item.id}\`: ${item.descricao}`),
    "",
    "## Regras do modo `documento`",
    "",
    "As colunas por regra contam as linhas (do `PPC.md` e dos JSONs) que mudam quando só aquela regra é desligada.",
    "",
    ...REGRAS_DO_MODO_DOCUMENTO.map((item) => `- \`${item.regra}\`: ${item.descricao}`),
    "",
  ];
  NodeFS.writeFileSync(NodePath.join(saida, "relatorio.md"), linhas.join("\n"), "utf-8");
  for (const item of resultados) {
    const estado = item.erroPython
      ? "ERRO PYTHON"
      : !item.elementosIguais || item.arquivosDiferentes.length
        ? "DIFERENTE"
        : "igual";
    console.log(
      `${estado.padEnd(11)} ${item.documento.nome.padEnd(28)} python ${item.segundosPython?.toFixed(2) ?? "—"} s, ts ${item.milissegundosTs.toFixed(0)} ms` +
        `${item.aceitas.length ? `, aceitas: ${item.aceitas.join(", ")}` : ""}, modo documento: ${item.linhasDoModoDocumento} linhas (${REGRAS_DO_MODO_DOCUMENTO.map(({ regra }) => `${regra} ${item.linhasPorRegra[regra]}`).join(", ")})`,
    );
  }
  if (argumentos.includes("--gravar-gabaritos")) gravarGabaritos(raiz, saida, resultados);
  console.log(
    `\n${resultados.length} documentos, ${falhas.length} com diferença não aceita. Relatório: ${NodePath.join(saida, "relatorio.md")}`,
  );
  return falhas.length ? 1 : 0;
}

if (import.meta.main) process.exitCode = main();
