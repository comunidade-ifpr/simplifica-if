/**
 * PDF do relatório de verificação de calendário (porte de
 * `render_relatorio_pdf.py`, trilha T4). A fixture `relatorio.md` foi
 * conferida contra o script Python com `reportlab` 5.1.0: as mesmas 2 páginas,
 * o mesmo texto e as mesmas posições de palavra (diferença máxima de 0,35 pt).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { quebrarCjk, quebrarNormal } from "../scripts/quebra-linhas.ts";
import { carregarRelatorio, gerarPdf } from "../scripts/render_relatorio_pdf.ts";

const RAIZ = path.resolve(import.meta.dir, "../../../..");
const SCRIPT = path.join(RAIZ, ".agents/skills/verificar-calendario/scripts/render_relatorio_pdf.ts");
const FIXTURE = path.join(import.meta.dir, "fixtures/relatorio.md");
const DATA = new Date("2000-01-01T00:00:00Z");
const temporarios: string[] = [];

afterAll(() => {
  for (const pasta of temporarios) rmSync(pasta, { recursive: true, force: true });
});

/**
 * Texto de cada página: junta as strings hexadecimais dos operadores `TJ`
 * (fontes padrão em WinAnsi, um byte por caractere) dos fluxos de conteúdo,
 * na ordem dos objetos `/Type /Page`.
 */
function textoPorPagina(pdf: Buffer): string[] {
  const bruto = pdf.toString("latin1");
  const conteudos = new Map<number, string>();
  for (const objeto of bruto.matchAll(/(\d+) 0 obj\s*<<[^<>]*>>\s*stream\r?\n/g)) {
    const inicio = objeto.index + objeto[0].length;
    const fim = bruto.indexOf("endstream", inicio);
    try {
      conteudos.set(Number(objeto[1]), inflateSync(pdf.subarray(inicio, fim)).toString("latin1"));
    } catch {
      // fluxo que não é Flate (fontes, imagens)
    }
  }
  const winAnsi = new TextDecoder("windows-1252");
  const paginas: string[] = [];
  for (const pagina of bruto.matchAll(/<<\s*\/Type \/Page\s[^]*?\/Contents (\d+) 0 R/g)) {
    const conteudo = conteudos.get(Number(pagina[1])) ?? "";
    let texto = "";
    for (const bloco of conteudo.matchAll(/BT([^]*?)ET/g)) {
      for (const hex of bloco[1]!.matchAll(/<([0-9a-fA-F]*)>/g)) {
        texto += winAnsi.decode(Uint8Array.from(hex[1]!.match(/../g) ?? [], (par) => Number.parseInt(par, 16)));
      }
    }
    paginas.push(texto);
  }
  return paginas;
}

const semEspacos = (texto: string) => texto.replace(/\s+/g, "");

describe("carregarRelatorio", () => {
  test("lê título, metadados, tabela de 3 colunas e conclusões renumeradas", () => {
    const relatorio = carregarRelatorio(
      [
        "# Relatório 2026",
        "##   Campus Irati - xlsx  ",
        "Texto livre ignorado.",
        "**Documento analisado:** calendário.xlsx",
        "**Chave:** valor com :** dentro",
        "- **Lista:** não é metadado",
        "| Item | Status | Observação/Evidência |",
        "|---|---|---|",
        "| I - início | ATENDE | 09/02 |",
        "| duas | colunas |",
        "|| pipe duplo | ATENDE | obs ||",
        "Fim da tabela",
        "| depois | não | entra |",
        "1. **Pergunta?** Sim.",
        "7.   **Outra?**   Não.  ",
        "3. Sem negrito não entra",
      ].join("\r\n"),
    );
    expect(relatorio).toEqual({
      titulo: "Relatório 2026",
      subtitulo: "Campus Irati - xlsx",
      metadados: [
        ["Documento analisado", "calendário.xlsx"],
        ["Chave", "valor com :** dentro"],
      ],
      tabela: [
        ["I - início", "ATENDE", "09/02"],
        ["pipe duplo", "ATENDE", "obs"],
      ],
      conclusoes: [
        ["Pergunta?", "Sim."],
        ["Outra?", "Não."],
      ],
    });
  });

  test("exige título e subtítulo", () => {
    expect(() => carregarRelatorio("# Só título")).toThrow("título e subtítulo");
  });
});

describe("quebra de linhas do reportlab", () => {
  const medir = (texto: string) => texto.length;
  const textos = (linhas: Array<Array<{ text: string }>>) => linhas.map((l) => l.map((p) => p.text).join(""));

  test("normal: só quebra em espaços, com 5% de encolhimento dos espaços", () => {
    expect(textos(quebrarNormal([{ text: "aaa bb/cc dd" }], [6], medir))).toEqual(["aaa", "bb/cc", "dd"]);
    // "aaaa bbbb" = 9 > 8, mas o limite é 8 + 0,05 × 1 espaço: não cabe; com 20 espaços de largura, cabe.
    expect(textos(quebrarNormal([{ text: "aaaa bbbb" }], [8], medir))).toEqual(["aaaa", "bbbb"]);
    const espacoLargo = (texto: string) => (texto === " " ? 20 : texto.length);
    expect(textos(quebrarNormal([{ text: "a b" }], [21], espacoLargo))).toEqual(["a b"]);
  });

  test("normal: larguras por linha (recuo pendente) e espaço no trecho em que está", () => {
    const pecas = [{ text: "1. " }, { text: "xx", bold: true }, { text: " yy zz" }];
    const linhas = quebrarNormal(pecas, [8, 5], medir);
    expect(textos(linhas)).toEqual(["1. xx yy", "zz"]);
    expect(linhas[0]).toEqual([
      { text: "1." },
      { text: " " },
      { text: "xx", bold: true },
      { text: " " },
      { text: "yy" },
    ]);
  });

  test("cjk: a palavra só entra com o espaço que a segue", () => {
    // "bbb" caberia (10), mas o espaço seguinte estoura e a linha volta ao espaço anterior.
    expect(textos(quebrarCjk([{ text: "aaaaaa bbb cc" }], [10], medir))).toEqual(["aaaaaa", "bbb cc"]);
    expect(textos(quebrarCjk([{ text: "aaaaaa bb cc" }], [10], medir))).toEqual(["aaaaaa bb", "cc"]);
    expect(textos(quebrarCjk([{ text: "aaaaaa bbb" }], [10], medir))).toEqual(["aaaaaa bbb"]);
  });

  test("cjk: palavra longa é cortada no meio, sem hífen", () => {
    expect(textos(quebrarCjk([{ text: "x abcdefghij" }], [5], medir))).toEqual(["x abc", "defgh", "ij"]);
  });

  test("cjk: pontuação que não inicia linha fica pendurada", () => {
    // Sem espaço na segunda metade da linha, o espaço que segue a vírgula começa a linha seguinte.
    expect(textos(quebrarCjk([{ text: "abcd, e" }], [4], medir))).toEqual(["abcd,", " e"]);
  });
});

describe("PDF", () => {
  test("renderiza a fixture em 2 páginas, com cabeçalho repetido e o texto do Markdown", async () => {
    const pdf = await gerarPdf(readFileSync(FIXTURE, "utf8"), DATA);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const paginas = textoPorPagina(pdf);
    expect(paginas).toHaveLength(2);
    for (const pagina of paginas) expect(pagina).toContain("ItemStatusObservação/Evidência");

    const texto = semEspacos(paginas.join(""));
    const relatorio = carregarRelatorio(readFileSync(FIXTURE, "utf8"));
    const esperado = [
      relatorio.titulo,
      relatorio.subtitulo,
      "Documento analisado: Calendário Acadêmico Telêmaco Borba - Cursos Técnicos.xlsx",
      "Método de leitura: estrutura do arquivo (abas BIMESTRAL e Tabela - Datas e Eventos)",
      "Prevê, no mínimo, 200 (duzentos) dias letivos anuais",
      "XXV - o evento alusivo à Semana Cultural Interescolar",
      'Linha com código, negrito, negrito código e aspas "duplas" & <sinais>',
      "https://ifpr.edu.br/calendario/2026/campus/telemaco-borba/cursos-tecnicos-integrados-anexo-unico.pdf",
      "Conclusão",
      "1. O calendário está alinhado com a resolução de referência do ano?",
      "4. Existe coerência entre todos os documentos apresentados?",
    ];
    let posicao = 0;
    for (const trecho of esperado) {
      const achado = texto.indexOf(semEspacos(trecho), posicao);
      expect({ trecho, achado: achado >= 0 }).toEqual({ trecho, achado: true });
      posicao = achado;
    }
    expect(texto).not.toContain("**");
    expect(texto).not.toContain("`");
    expect(texto).not.toContain("Linhacomduascolunas");
  });

  test("é reproduzível com data fixa e não embute fontes", async () => {
    const markdown = readFileSync(FIXTURE, "utf8");
    const a = await gerarPdf(markdown, DATA);
    const b = await gerarPdf(markdown, DATA);
    expect(a.equals(b)).toBe(true);
    const bruto = a.toString("latin1");
    expect(bruto).toContain("(D:20000101000000Z)");
    expect(bruto).not.toContain("/FontFile");
    expect(bruto).toContain("/BaseFont /Helvetica-Bold");
    expect(bruto).toContain("/BaseFont /Courier");
  });

  test("caractere fora da cp1252 usa a Roboto do pdfmake, e não bytes WinAnsi", async () => {
    const pdf = await gerarPdf("# Título\n## Sub\n**Total:** 200 ≥ 200 ✅\n", DATA);
    const bruto = pdf.toString("latin1");
    expect(bruto).toContain("Roboto-Regular");
    expect(semEspacos(textoPorPagina(pdf)[0]!)).toContain("Total:200");
  });

  test("CLI: mesma interface do script Python", () => {
    const pasta = mkdtempSync(path.join(tmpdir(), "relatorio-pdf-"));
    temporarios.push(pasta);
    const saida = path.join(pasta, "sub", "relatorio.pdf");
    const rodar = (...args: string[]) =>
      Bun.spawnSync(["bun", "run", SCRIPT, ...args], {
        env: { ...process.env, VERIFICAR_CALENDARIO_AGORA: "2000-01-01T00:00:00Z" },
      });
    const ok = rodar(FIXTURE, saida);
    expect(ok.exitCode).toBe(0);
    expect(textoPorPagina(readFileSync(saida))).toHaveLength(2);

    const uso = rodar(FIXTURE);
    expect(uso.exitCode).toBe(1);
    expect(uso.stdout.toString()).toContain("Uso: render_relatorio_pdf.ts entrada.md saida.pdf");
  });
});
