/**
 * Relatório HTML e publicação no Surge da revisar-ppc (casos portados de
 * `test_flow.py`, trilha T2), mais a paridade com o Python 3.14 do
 * `_HTMLPrettyPrinter`, dos blocos do PPC e da leitura de atributos do
 * `HTMLParser` (valores esperados gerados com o próprio Python).
 */
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vite-plus/test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { casefold } from "@simplifica-if/kb/python/texto";
import type { ObjetoPy } from "@simplifica-if/kb/python/valores";
import { caminhosPadrao } from "../scripts/caminhos.ts";
import { unescapeAtributoPy } from "../scripts/html-py.ts";
import { prepararDocumento } from "../scripts/preparar-documento.ts";
import { dominioSurgePadrao, prepararSiteSurge, publicarSiteSurge } from "../scripts/publicar-surge.ts";
import {
  formatarHtml,
  gerarBlocosPpc,
  gerarRelatorioHtml,
  renderizarHtml,
  resolverAncoraEvidencia,
} from "../scripts/relatorio-html.ts";
import {
  ErroResultadosSubagents,
  type ResultadoNormalizado,
  SITUACOES_REVISAO,
  situacao,
  validarResultadosRodada,
} from "../scripts/resultados.ts";
import { caminhosRodada, escreverJsonPy, lerJsonPy } from "../scripts/rodada.ts";
import {
  agruparFichasPorTopico,
  carregarFichasOrdenadas,
  carregarTopicosFichas,
  carregarValidacoesCruzadasOrdenadas,
} from "../scripts/subagents.ts";

const caminhos = caminhosPadrao();
const RAIZ = path.resolve(caminhos.appDir, "../../..");
const ENTRYPOINT = path.join(caminhos.appDir, "scripts", "revisar_ppc.ts");
const RELOGIO = () => new Date("2026-11-13T12:34:56Z");
const TOTAL_FICHAS = readdirSync(caminhos.fichasDir).filter((nome) => nome.endsWith(".json")).length;

const MARKDOWN_BASE = `# Curso Técnico em Informática

Curso: Curso Técnico em Informática
Campus: Assis Chateaubriand
Modalidade: Integrado

## 1. Apresentação

O curso apresenta objetivos, perfil do egresso e justificativa institucional.
`;

const temporarios: string[] = [];
afterEach(() => {
  for (const dir of temporarios.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function diretorioTemporario(): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "revisar-ppc-relatorio-")));
  temporarios.push(dir);
  return dir;
}

function criarRodada(markdown = MARKDOWN_BASE): string {
  const dir = diretorioTemporario();
  const arquivo = path.join(dir, "PPC.md");
  writeFileSync(arquivo, markdown, "utf-8");
  return prepararDocumento(arquivo, { saidaBase: path.join(dir, "output"), relogio: RELOGIO }).rodadaDir;
}

function resultado(fichaId: string, estado = "ATENDE", evidencias = 3): ObjetoPy {
  return {
    ficha_id: fichaId,
    estado,
    confianca: 0.9,
    justificativa: `Justificativa da ficha ${fichaId}.`,
    evidencias: Array.from({ length: evidencias }, (_, i) => `Evidência ${i + 1} de ${fichaId}`),
    lacunas: [],
    revisao_humana_obrigatoria: false,
  };
}

type Payload = {
  metadata: ObjetoPy;
  grupos: Array<{ grupo_id: string; resultados: ObjetoPy[] }>;
  [k: string]: unknown;
};

function payloadResultadosCompletos(): Payload {
  const grupos = agruparFichasPorTopico(carregarFichasOrdenadas(), carregarTopicosFichas(), 20).map((grupo) => ({
    grupo_id: grupo.grupo_id,
    resultados: grupo.fichas.map((ficha) => resultado(String(ficha.id), "ATENDE", Number(ficha.evidencia_minima ?? 3))),
  }));
  return { metadata: { origem: "teste" }, grupos };
}

function resultadoDa(payload: Payload, fichaId: string): ObjetoPy {
  for (const grupo of payload.grupos) {
    const achado = grupo.resultados.find((item) => item.ficha_id === fichaId);
    if (achado) return achado;
  }
  throw new Error(`Ficha não encontrada no payload de teste: ${fichaId}`);
}

function primeiraValidacaoCruzada(): string {
  return String(carregarValidacoesCruzadasOrdenadas()[0]!.id);
}

/** Grava os resultados, gera o relatório e devolve o HTML. */
function gerar(rodada: string, payload: unknown): string {
  escreverJsonPy(path.join(caminhosRodada(rodada).suporteDir, "resultados-subagents.json"), payload);
  gerarRelatorioHtml(rodada, "resultados-subagents.json");
  return readFileSync(caminhosRodada(rodada).relatorioHtml, "utf-8");
}

function surgeFalso(dir: string, corpo: string): string {
  const arquivo = path.join(dir, "surge-falso");
  writeFileSync(arquivo, `#!/bin/sh\n${corpo}\n`);
  chmodSync(arquivo, 0o755);
  return arquivo;
}

const CASOS_PRETTY: Array<[string, string]> = [
  [
    "<!DOCTYPE html>\n<html><body><p>Tom &amp; Jerry &#x27;x&#x27; fim</p></body></html>",
    "<!DOCTYPE html>\n<html>\n  <body>\n    <p>Tom&amp;Jerry&#x27;x&#x27;fim\n    </p>\n  </body>\n</html>\n",
  ],
  [
    "<div><p><em>a<strong>b</em>c</strong> depois</p></div>",
    "<div>\n  <p><em>a<strong>b</em>c</strong>depois\n  </p>\n</div>\n",
  ],
  [
    '<title>A &amp; B</title><script src="x.js" defer></script><pre>  manter\n  isso </pre>',
    '<title>A&amp;B\n</title>\n<script src="x.js" defer></script>\n<pre>  manter\n  isso </pre>\n',
  ],
  [
    '<div><br><br/><input disabled="" x=y><span>  inline  </span>texto</div>',
    '<div><br>\n  <br>\n  <input disabled="" x="y"><span>  inline  </span>texto\n</div>\n',
  ],
  [
    "<section>palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra </section>",
    "<section>palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra\n  palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra\n  palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra\n  palavra\n</section>\n",
  ],
  [
    '<p title="a &amp; b &quot;c&quot; &#x27;d&#x27; &lt;e&gt;">x</p>',
    '<p title="a &amp; b &quot;c&quot; &#x27;d&#x27; &lt;e&gt;">x\n</p>\n',
  ],
  [
    "<div><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span></div>",
    "<div><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc\n</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc\n</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span><span>abc</span>\n</div>\n",
  ],
  [
    '<div><a href="#x">link longo de teste</a> texto solto <a href="#x">link longo de teste</a> texto solto <a href="#x">link longo de teste</a> texto solto <a href="#x">link longo de teste</a> texto solto <a href="#x">link longo de teste</a> texto solto <a href="#x">link longo de teste</a> texto solto <a href="#x">link longo de teste</a> texto solto <a href="#x">link longo de teste</a> texto solto <a href="#x">link longo de teste</a> texto solto <a href="#x">link longo de teste</a> texto solto </div>',
    '<div>\n  <a href="#x">link longo de teste\n  </a>texto solto\n  <a href="#x">link longo de teste\n  </a>texto solto\n  <a href="#x">link longo de teste\n  </a>texto solto\n  <a href="#x">link longo de teste\n  </a>texto solto\n  <a href="#x">link longo de teste\n  </a>texto solto\n  <a href="#x">link longo de teste\n  </a>texto solto\n  <a href="#x">link longo de teste\n  </a>texto solto\n  <a href="#x">link longo de teste\n  </a>texto solto\n  <a href="#x">link longo de teste\n  </a>texto solto\n  <a href="#x">link longo de teste\n  </a>texto solto\n</div>\n',
  ],
  ["<ul>\n<li>um</li>\n<li>dois & três</li></ul>", "<ul>\n  <li>um\n  </li>\n  <li>dois&três\n  </li>\n</ul>\n"],
  ["<p>a < b e c > d &x &#1 fim</p>", "<p>a<b e c > d&x;&#1;fim\n</p>\n"],
];
const CASOS_BLOCOS: Array<[string, Array<[string, string, string, string, number]>]> = [
  [
    "# Título\n\nParágrafo um\ncontinua\n\n- a\n- b\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n####### não\n\n## 2.1 Seção\n\ntexto",
    [
      ["ppc-b00001", "heading", "Título", "<h1>Título</h1>", 1],
      ["ppc-b00002", "paragraph", "Parágrafo um\ncontinua", "<p>Parágrafo um</p><p>continua</p>", 0],
      ["ppc-b00003", "list", "- a\n- b", "<ul><li>a</li><li>b</li></ul>", 0],
      [
        "ppc-b00004",
        "table",
        "| a | b |\n|---|---|\n| 1 | 2 |",
        '<table><thead><tr><th scope="col">a</th><th scope="col">b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
        0,
      ],
      ["ppc-b00005", "paragraph", "####### não", "<p>####### não</p>", 0],
      ["ppc-b00006", "heading", "2.1 Seção", "<h2>2.1 Seção</h2>", 2],
      ["ppc-b00007", "paragraph", "texto", "<p>texto</p>", 0],
    ],
  ],
  [
    "Linha com separador\n\n1) um\n2. dois\n\n|x|\n",
    [
      ["ppc-b00001", "paragraph", "Linha com separador", "<p>Linha com separador</p>", 0],
      ["ppc-b00002", "list", "1) um\n2. dois", "<ul><li>um</li><li>dois</li></ul>", 0],
      ["ppc-b00003", "table", "|x|", '<table><thead><tr><th scope="col">x</th></tr></thead><tbody></tbody></table>', 0],
    ],
  ],
];
const CASOS_ATRIBUTOS: Array<[string, string]> = [
  ["a &amp; b", "a & b"],
  ["&#x27;x&#39;", "'x'"],
  ["&lt;&gt;&quot;", '<>"'],
  ["&amp", "&"],
  ["&ampx", "&ampx"],
  ["&ampx;", "&ampx;"],
  ["&notit;", "&notit;"],
  ["&notin;", "∉"],
  ["&eacute", "é"],
  ["&AMP;", "&"],
  ["&xx;", "&xx;"],
  ["&#0;", "�"],
  ["&#13;", "\r"],
  ["&#128;", "€"],
  ["&#x80;", "€"],
  ["&#1;", ""],
  ["&#xD800;", "�"],
  ["&#1114112;", "�"],
  ["&#xFFFE;", ""],
  ["&#65=", "A="],
  ["&amp=", "&amp="],
  ["&#x1F600;", "😀"],
  ["&#99999999999999999999;", "�"],
];

describe("paridade com o Python", () => {
  test("_HTMLPrettyPrinter: texto em volta de referências, tags cruzadas, inline e preservadas", () => {
    for (const [html, esperado] of CASOS_PRETTY) expect(formatarHtml(html)).toBe(esperado);
  });

  test("gerar_blocos_ppc", () => {
    for (const [markdown, esperado] of CASOS_BLOCOS) {
      expect(gerarBlocosPpc(markdown).map((b) => [b.id, b.kind, b.text, b.html, b.level])).toEqual(esperado);
    }
  });

  test("_unescape_attrvalue do HTMLParser", () => {
    for (const [valor, esperado] of CASOS_ATRIBUTOS) expect(unescapeAtributoPy(valor)).toBe(esperado);
  });
});

describe("blocos e âncoras", () => {
  test("gerarBlocosPpc cria IDs estáveis por bloco", () => {
    const blocos = gerarBlocosPpc(MARKDOWN_BASE);
    expect(blocos.slice(0, 3).map((bloco) => bloco.id)).toEqual(["ppc-b00001", "ppc-b00002", "ppc-b00003"]);
    expect(blocos[0]!.kind).toBe("heading");
    expect(blocos[0]!.text).toBe("Curso Técnico em Informática");
    expect(blocos.some((bloco) => bloco.text.includes("objetivos"))).toBe(true);
  });

  test("gerarBlocosPpc preserva <br> como quebra de linha", () => {
    const blocos = gerarBlocosPpc("## Ementário\n\n| Campo |\n|---|\n| Linha 1<br>Linha 2 |\n");
    const tabela = blocos.find((bloco) => bloco.kind === "table")!.html;
    expect(tabela).toContain("Linha 1<br>Linha 2");
    expect(tabela).not.toContain("&lt;br&gt;");
  });

  test("âncora por título de seção, sem depender da numeração", () => {
    const blocos = gerarBlocosPpc(`# Curso

## 7.2 Acompanhamento do Egresso

O PPC prevê pesquisas com egressos e uso dos resultados na avaliação do curso.

## 7.3 Registro Profissional

O PPC trata o registro junto ao conselho profissional.
`);
    const [anchorId, quote] = resolverAncoraEvidencia(
      { trecho: "pesquisas com egressos", secao: "Acompanhamento do Egresso", fonte: "PPC.md" },
      blocos,
    );
    const bloco = blocos.find((item) => item.id === anchorId)!;
    expect(bloco.kind).toBe("paragraph");
    expect(bloco.text).toContain("pesquisas com egressos");
    expect(quote).toBe("pesquisas com egressos");
  });
});

describe("destaques de evidência no PPC", () => {
  const PARAGRAFO = "O curso tem duração de 3 anos e carga horária de 1200 horas.";
  const markdown = `# Curso Técnico em Informática\n\n${PARAGRAFO}\n`;
  const resultadoCitando = (fichaId: string, titulo: string, quote: string) =>
    ({
      grupo_id: "grupo-001",
      ficha_id: fichaId,
      titulo,
      criticidade: "OBRIG",
      estado: "NAO_ATENDE",
      confianca: 0.9,
      justificativa: `Justificativa de ${fichaId}.`,
      evidencias: [
        { trecho: quote, secao: "", localizador: "", fonte: "PPC.md", artefato: "", anchor: { block_id: "", quote } },
      ],
      lacunas: [],
      revisao_humana_obrigatoria: false,
      feedback_autores: "",
      fundamentacao_normativa: [],
    }) as unknown as ResultadoNormalizado;

  /** O conteúdo do bloco do parágrafo. */
  function conteudoDoBloco(resultados: ResultadoNormalizado[]): string {
    const html = renderizarHtml({ curso: "Curso" }, resultados, [], markdown);
    const inicio = html.indexOf('<div class="block-content"><p>O curso tem');
    expect(inicio).toBeGreaterThanOrEqual(0);
    return html.slice(inicio, html.indexOf("</div>", inicio));
  }

  /** Nenhum `<` dentro de atributo e nenhum `<a>` aberto dentro de outro. */
  function conferirMarcacao(conteudo: string) {
    for (const [, valor] of conteudo.matchAll(/="([^"]*)"/g)) expect(valor).not.toContain("<");
    let abertos = 0;
    for (const [tag] of conteudo.matchAll(/<\/?a\b/g)) {
      abertos += tag === "<a" ? 1 : -1;
      expect(abertos).toBeGreaterThanOrEqual(0);
      expect(abertos).toBeLessThanOrEqual(1);
    }
    expect(abertos).toBe(0);
  }

  test("não insere destaque dentro do atributo title de outro destaque", () => {
    const conteudo = conteudoDoBloco([
      resultadoCitando("CT-01", "Duração e carga horária", "duração de 3 anos"),
      resultadoCitando("CT-02", "Carga horária", "carga horária"),
    ]);
    conferirMarcacao(conteudo);
    expect(conteudo).toContain('title="Evidência de CT-01: Duração e carga horária"');
    expect(conteudo).toContain('<mark class="evidence-highlight">duração de 3 anos</mark>');
    expect(conteudo).toContain('<mark class="evidence-highlight">carga horária</mark>');
  });

  test("a mesma citação por duas fichas vira um destaque com links para as duas", () => {
    const conteudo = conteudoDoBloco([
      resultadoCitando("CT-01", "Duração", "duração de 3 anos"),
      resultadoCitando("CT-02", "Prazo", "duração de 3 anos"),
    ]);
    conferirMarcacao(conteudo);
    expect(conteudo.match(/<mark /g)?.length).toBe(1);
    expect(conteudo).toContain('data-evidence-ref="ann-001"');
    expect(conteudo).toContain('data-evidence-ref="ann-002"');
  });

  test("citação sobreposta a outra não aninha destaques", () => {
    const conteudo = conteudoDoBloco([
      resultadoCitando("CT-01", "Duração", "duração de 3 anos"),
      resultadoCitando("CT-02", "Prazo", "3 anos e carga"),
    ]);
    conferirMarcacao(conteudo);
    expect(conteudo).toContain('<mark class="evidence-highlight">duração de 3 anos</mark>');
    expect(conteudo).toContain('data-evidence-ref="ann-001"');
  });
});

describe("situação da revisão", () => {
  const item = (criticidade: string, estado: string, revisao = false) =>
    ({ criticidade, estado, revisao_humana_obrigatoria: revisao }) as unknown as ResultadoNormalizado;

  test("vocabulário de revisão prévia, do mais grave ao mais leve", () => {
    expect(situacao([item("BLOQ", "NAO_ATENDE"), item("OBRIG", "NAO_ATENDE")])).toBe("REVISAO_SUBSTANCIAL");
    expect(situacao([item("OBRIG", "NAO_ATENDE"), item("REC", "INCONCLUSIVO")])).toBe("AJUSTES_NECESSARIOS");
    expect(situacao([item("REC", "NAO_ATENDE"), item("REC", "INCONCLUSIVO")])).toBe("APTO_COM_RESSALVAS");
    expect(situacao([item("BLOQ", "ATENDE", true)])).toBe("APTO_COM_RESSALVAS");
    expect(situacao([item("BLOQ", "ATENDE"), item("REC", "NAO_ATENDE")])).toBe("APTO_PARA_SUBMISSAO");
    expect(Object.keys(SITUACOES_REVISAO)).toEqual(
      [
        ...((lerJsonPy(path.join(caminhos.appDir, "config", "politica_revisao.json")) as ObjetoPy)
          .situacoes as string[]),
      ].reverse(),
    );
  });
});

describe("situação da revisão com alertas transversais", () => {
  const item = (criticidade: string, estado: string, revisao = false) =>
    ({ criticidade, estado, revisao_humana_obrigatoria: revisao }) as unknown as ResultadoNormalizado;
  const alerta = (criticidade: string, revisao = false): ObjetoPy => ({
    criticidade,
    revisao_humana_obrigatoria: revisao,
  });

  test("alerta pesa como ficha NAO_ATENDE de mesma criticidade", () => {
    const fichas = [item("BLOQ", "ATENDE"), item("OBRIG", "ATENDE")];
    expect(situacao(fichas, [alerta("BLOQ")])).toBe("REVISAO_SUBSTANCIAL");
    expect(situacao(fichas, [alerta("OBRIG")])).toBe("AJUSTES_NECESSARIOS");
    expect(situacao(fichas, [alerta("REC")])).toBe("APTO_PARA_SUBMISSAO");
    expect(situacao(fichas, [alerta("REC", true)])).toBe("APTO_COM_RESSALVAS");
    expect(situacao([item("OBRIG", "NAO_ATENDE")], [alerta("BLOQ")])).toBe("REVISAO_SUBSTANCIAL");
    expect(situacao(fichas)).toBe("APTO_PARA_SUBMISSAO");
  });

  test("gerar-relatorio-html e validar-resultados contam alerta BLOQ com todas as fichas ATENDE", () => {
    const rodada = criarRodada();
    const payload = payloadResultadosCompletos();
    payload.alertas_transversais = [
      {
        id: "ALERTA-001",
        validacao_id: primeiraValidacaoCruzada(),
        titulo: "Inconsistência bloqueante",
        criticidade: "BLOQ",
        descricao: "Carga horária da matriz diverge da identificação.",
        fichas_relacionadas: [],
        evidencias: ["Evidência transversal"],
        revisao_humana_obrigatoria: false,
      },
    ];
    escreverJsonPy(path.join(caminhosRodada(rodada).suporteDir, "resultados-subagents.json"), payload);
    expect(validarResultadosRodada(rodada, "resultados-subagents.json").situacao).toBe("REVISAO_SUBSTANCIAL");
    const relatorio = gerarRelatorioHtml(rodada, "resultados-subagents.json");
    expect(relatorio.situacao).toBe("REVISAO_SUBSTANCIAL");
    expect(readFileSync(caminhosRodada(rodada).relatorioHtml, "utf-8")).toContain(
      SITUACOES_REVISAO.REVISAO_SUBSTANCIAL,
    );
  });
});

describe("gerar-relatorio-html", () => {
  test("aceita resultados válidos", () => {
    const rodada = criarRodada();
    const rodadaPaths = caminhosRodada(rodada);
    escreverJsonPy(path.join(rodadaPaths.suporteDir, "resultados-subagents.json"), payloadResultadosCompletos());
    const payload = gerarRelatorioHtml(rodada, "resultados-subagents.json");
    expect(payload.relatorio_html).toBe(rodadaPaths.relatorioHtml);
    expect(payload.total_fichas).toBe(TOTAL_FICHAS);
    expect(payload.total_alertas_transversais).toBe(0);
    expect(payload.situacao).toBe("APTO_PARA_SUBMISSAO");
    expect(payload.situacao_rotulo).toBe("Apto para submissão");
    const html = readFileSync(rodadaPaths.relatorioHtml, "utf-8");
    for (const trecho of [
      "<title>Relatório de revisão do PPC · Técnico em Informática\n",
      "PPC anotado",
      'class="badge estado-apto-para-submissao" title="APTO_PARA_SUBMISSAO">Apto para submissão</span>',
      "não substitui a análise oficial da PROENS",
      '<footer class="review-footer">',
      "Curso Técnico em Informática",
      "CT-IDENT-01",
      'id="filtro-busca"',
      'id="filtro-modo"',
    ]) {
      expect(html).toContain(trecho);
    }
  });

  test("ordena a margem pela posição no PPC", () => {
    const rodada = criarRodada();
    const payload = payloadResultadosCompletos();
    const ancorar = (fichaId: string, blockId: string, quote: string, secao: string) => {
      const item = resultadoDa(payload, fichaId);
      const total = Math.max(3, (item.evidencias as unknown[]).length);
      item.evidencias = Array.from({ length: total }, () => ({
        trecho: quote,
        secao,
        fonte: "PPC.md",
        anchor: { block_id: blockId, quote },
      }));
    };
    ancorar("CT-CURR-01", "ppc-b00004", "O curso apresenta objetivos", "Apresentação");
    ancorar("CT-IDENT-01", "ppc-b00002", "Curso: Curso Técnico em Informática", "Identificação");
    const html = gerar(rodada, payload);
    const margem = html.indexOf('<aside class="review-margin"');
    const posIdent = html.indexOf('<p class="annotation-kicker">CT-IDENT-01', margem);
    const posCurr = html.indexOf('<p class="annotation-kicker">CT-CURR-01', margem);
    expect(posIdent).toBeGreaterThan(-1);
    expect(posIdent).toBeLessThan(posCurr);
    expect(html.slice(0, posCurr)).toContain('id="ann-001"');
    expect(html).toContain('href="#ann-001"');
  });

  test("renderiza fundamentação normativa", () => {
    const rodada = criarRodada();
    const payload = payloadResultadosCompletos();
    payload.grupos[0]!.resultados[0]!.fundamentacao_normativa = [
      {
        status: "CONFIRMADA_COM_RESSALVA",
        trecho_ppc: "O PPC afirma atendimento à Resolução CNE/CP nº 1/2021.",
        norma: "Resolução CNE/CP nº 1/2021",
        fonte: "base-conhecimento/normas/br/resolucoes/RESOLUCAO_CNE-CP_1-2021_dcnept.md",
        dispositivo: "Diretrizes gerais da EPT",
        evidencia: "A norma trata das DCN gerais para a Educação Profissional e Tecnológica.",
        analise: "A citação é pertinente, mas precisa indicar o alcance específico usado pelo PPC.",
        recomendacao: "Explicitar quais diretrizes orientam a organização curricular.",
      },
    ];
    const html = gerar(rodada, payload);
    expect(html).toContain("Fundamentação normativa verificada");
    expect(html).toContain('class="normative-section normative-confirmada-com-ressalva"');
    expect(html).toContain("CONFIRMADA_COM_RESSALVA");
    expect(html).toContain("RESOLUCAO_CNE-CP_1-2021_dcnept.md");
  });

  test("renderiza evidência estruturada só com trecho e seção", () => {
    const rodada = criarRodada();
    const payload = payloadResultadosCompletos();
    payload.grupos[0]!.resultados[0]!.evidencias = [
      {
        trecho: "O PPC identifica o curso como Técnico em Informática.",
        secao: "1",
        localizador: "Quadro de identificação",
        fonte: "PPC.md",
        artefato: "",
      },
      { trecho: "A modalidade é integrada.", secao: "1", localizador: "Identificação", fonte: "PPC.md", artefato: "" },
    ];
    const html = gerar(rodada, payload);
    expect(html).toContain("O PPC identifica o curso como Técnico em Informática.");
    expect(html).toContain("Seção:</strong> 1");
    expect(html).not.toContain("Localizador:");
    expect(html).not.toContain("Fonte:</strong> PPC.md");
    expect(html).not.toContain("Artefato:");
  });

  test("usa assets externos e anota o PPC", () => {
    const rodada = criarRodada();
    const payload = payloadResultadosCompletos();
    const primeiro = resultadoDa(payload, "CT-CURR-01");
    primeiro.estado = "NAO_ATENDE";
    primeiro.revisao_humana_obrigatoria = true;
    primeiro.lacunas = ["Falta detalhar a aderência da identificação."];
    const evidencia = (trecho: string, secao: string, localizador: string, blockId: string) => ({
      trecho,
      secao,
      localizador,
      fonte: "PPC.md",
      artefato: "",
      anchor: { block_id: blockId, quote: trecho },
    });
    primeiro.evidencias = [
      evidencia("Curso: Curso Técnico em Informática", "Identificação", "Cabeçalho", "ppc-b00002"),
      evidencia("O curso apresenta objetivos", "Apresentação", "Corpo da seção", "ppc-b00004"),
      evidencia("Campus: Assis Chateaubriand", "Identificação", "Cabeçalho", "ppc-b00002"),
    ];
    const html = gerar(rodada, payload);
    expect(html).toContain('<link rel="stylesheet" href="assets/revisar-ppc.css">');
    expect(html).toContain('<script src="assets/revisar-ppc.js" defer></script>');
    expect(html).not.toContain("<style>");
    expect(html).toContain("PPC anotado");
    expect(html).not.toContain("Achados detalhados por ficha");
    expect(html).not.toContain('id="achados-detalhados"');
    expect(html).toContain('id="ppc-b00002"');
    expect(html).toContain(
      'class="evidence-link evidence-state-nao-atende" href="#ann-001" data-evidence-ref="ann-001"',
    );
    expect(html).toContain('<span class="evidence-ref" aria-hidden="true">CT-CURR-01</span>');
    expect(html).toContain('title="Evidência de CT-CURR-01:');
    expect(html).toContain("Curso: Curso Técnico em Informática");
    for (const ancora of ['href="#ann-001"', 'href="#ppc-b00002"', 'href="#ppc-b00004"', "Ir para seção"]) {
      expect(html).toContain(ancora);
    }
    expect(html).not.toContain("Ver no PPC");
    expect(html).toContain('\n          <section id="ppc-b00002"');
    expect(html).not.toContain("></section><section id=");
    expect(Math.max(...html.split("\n").map((linha) => linha.length))).toBeLessThan(260);
    expect(existsSync(path.join(rodada, "assets", "revisar-ppc.css"))).toBe(true);
    expect(existsSync(path.join(rodada, "assets", "revisar-ppc.js"))).toBe(true);
  });

  const negativos: Array<[string, (payload: Payload) => void, string]> = [
    ["ficha duplicada", (p) => (p.grupos[1]!.resultados[0] = { ...p.grupos[0]!.resultados[0]! }), "duplicadas"],
    ["ficha desconhecida", (p) => (p.grupos[0]!.resultados[0]!.ficha_id = "CT-NAO-EXISTE"), "desconhecidas"],
    ["ficha faltante", (p) => void p.grupos[0]!.resultados.pop(), "sem resultado"],
    ["evidências abaixo do mínimo", (p) => (p.grupos[0]!.resultados[0]!.evidencias = []), "mínimo exigido"],
    [
      "alerta transversal sem validacao_id",
      (p) =>
        (p.alertas_transversais = [
          {
            id: "ALERTA-001",
            titulo: "Inconsistência transversal",
            criticidade: "OBRIG",
            descricao: "Perfil e matriz precisam de revisão conjunta.",
            fichas_relacionadas: ["CT-IDENT-01"],
            evidencias: ["Evidência transversal"],
            revisao_humana_obrigatoria: true,
          },
        ]),
      "validacao_id",
    ],
    [
      "feedback_autores ausente quando a ficha exige",
      (p) => {
        const item = resultadoDa(p, "CT-TRANS-08");
        item.estado = "NAO_ATENDE";
        item.revisao_humana_obrigatoria = true;
        delete item.feedback_autores;
      },
      "feedback_autores",
    ],
  ];
  for (const [nome, mutar, mensagem] of negativos) {
    test(`rejeita ${nome}`, () => {
      const rodada = criarRodada();
      const payload = payloadResultadosCompletos();
      mutar(payload);
      expect(() => gerar(rodada, payload)).toThrow(ErroResultadosSubagents);
      expect(() => gerar(rodada, payload)).toThrow(mensagem);
    });
  }

  test("renderiza alertas transversais", () => {
    const rodada = criarRodada();
    const payload = payloadResultadosCompletos();
    payload.alertas_transversais = [
      {
        id: "ALERTA-001",
        validacao_id: primeiraValidacaoCruzada(),
        titulo: "Inconsistência transversal",
        criticidade: "OBRIG",
        descricao: "Perfil e matriz precisam de revisão conjunta.",
        fichas_relacionadas: ["CT-IDENT-01"],
        evidencias: ["Evidência transversal"],
        revisao_humana_obrigatoria: true,
      },
    ];
    escreverJsonPy(path.join(caminhosRodada(rodada).suporteDir, "resultados-subagents.json"), payload);
    const relatorio = gerarRelatorioHtml(rodada, "resultados-subagents.json");
    expect(relatorio.total_alertas_transversais).toBe(1);
    const html = readFileSync(caminhosRodada(rodada).relatorioHtml, "utf-8");
    for (const trecho of ["Alertas transversais", "ALERTA-001", "Validação cruzada", "transversal-notes"]) {
      expect(html).toContain(trecho);
    }
    expect(html).not.toContain('id="alertas"');
  });

  test("renderiza alerta transversal com várias âncoras", () => {
    const rodada = criarRodada();
    const payload = payloadResultadosCompletos();
    const ponto = (secao: string, trecho: string, blockId: string) => ({
      secao,
      trecho,
      papel: "ponto_de_conflito",
      fonte: "PPC.md",
      anchor: { block_id: blockId, quote: trecho },
    });
    payload.alertas_transversais = [
      {
        id: "ALERTA-001",
        validacao_id: primeiraValidacaoCruzada(),
        titulo: "Divergência entre identificação e apresentação",
        criticidade: "OBRIG",
        descricao: "Dois pontos do PPC precisam ser lidos em conjunto.",
        fichas_relacionadas: ["CT-IDENT-01"],
        evidencias: [
          ponto("Capa", "Curso: Curso Técnico em Informática", "ppc-b00002"),
          ponto("Apresentação", "O curso apresenta objetivos", "ppc-b00004"),
        ],
        revisao_humana_obrigatoria: true,
      },
    ];
    const html = gerar(rodada, payload);
    for (const trecho of [
      'id="ALERTA-001"',
      'href="#ALERTA-001"',
      'href="#ppc-b00002"',
      'href="#ppc-b00004"',
      "Pontos no PPC",
      "ponto_de_conflito",
      "estado-transversal",
    ]) {
      expect(html).toContain(trecho);
    }
    expect(html).not.toContain('id="alertas"');
  });

  test("renderiza feedback aos autores", () => {
    const rodada = criarRodada();
    const payload = payloadResultadosCompletos();
    const texto = "Recomenda-se explicitar a articulação entre concepção, perfil e matriz.";
    const item = resultadoDa(payload, "CT-TRANS-08");
    item.estado = "NAO_ATENDE";
    item.revisao_humana_obrigatoria = true;
    item.feedback_autores = texto;
    escreverJsonPy(path.join(caminhosRodada(rodada).suporteDir, "resultados-subagents.json"), payload);
    const relatorio = gerarRelatorioHtml(rodada, "resultados-subagents.json");
    expect(relatorio.total_fichas).toBe(TOTAL_FICHAS);
    const html = readFileSync(caminhosRodada(rodada).relatorioHtml, "utf-8");
    expect(html).toContain("Feedback sugerido aos autores");
    expect(html).toContain(texto);
    expect(html).toContain("Feedback aos autores");
  });
});

describe("publicação no Surge", () => {
  test("chama a CLI com a pasta e o domínio", () => {
    const dir = diretorioTemporario();
    const relatorio = path.join(dir, "relatorio.html");
    writeFileSync(relatorio, "<!doctype html><html><body><script>ok()</script></body></html>");
    const site = prepararSiteSurge(relatorio, path.join(dir, "surge-site"));
    const argumentos = path.join(dir, "args.txt");
    const falso = surgeFalso(
      dir,
      `printf '%s\\n' "$@" > "${argumentos}"\necho 'Success - Published to revisar-ppc-teste.surge.sh'`,
    );
    const payload = publicarSiteSurge(site, "revisar-ppc-teste.surge.sh", [falso]);
    expect(payload.public_url).toBe("https://revisar-ppc-teste.surge.sh");
    expect(payload.domain).toBe("revisar-ppc-teste.surge.sh");
    expect(readFileSync(path.join(site, "index.html"), "utf-8")).toContain("<script>ok()</script>");
    expect(readFileSync(argumentos, "utf-8")).toBe(`${site}\nrevisar-ppc-teste.surge.sh\n`);
  });

  test("recusa saída sem confirmação, pedido de login e código de erro", () => {
    const dir = diretorioTemporario();
    const site = path.join(dir, "site");
    const mudo = surgeFalso(dir, "echo 'Publicando...'");
    expect(() => publicarSiteSurge(site, "x.surge.sh", [mudo])).toThrow("confirmação de publicação reconhecível");
    const login = surgeFalso(dir, "echo 'Login or create surge account'; echo 'email:'");
    expect(() => publicarSiteSurge(site, "x.surge.sh", [login])).toThrow("autenticação interativa");
    const falha = surgeFalso(dir, "echo 'erro' >&2; exit 2");
    expect(() => publicarSiteSurge(site, "x.surge.sh", [falha])).toThrow("Falha ao publicar relatório no Surge.\nerro");
  });

  test("domínio padrão usa o nome da rodada", () => {
    expect(dominioSurgePadrao("/tmp/2026-06-29t10-00-00-ppc-tecnico-em-informatica---quedas")).toBe(
      "revisar-ppc-2026-06-29t10-00-00-ppc-tecnico-em-informatica.surge.sh",
    );
  });

  test("a CLI publica por padrão e grava surge-publicacao.json", () => {
    const rodada = criarRodada();
    const rodadaPaths = caminhosRodada(rodada);
    escreverJsonPy(path.join(rodadaPaths.suporteDir, "resultados-subagents.json"), payloadResultadosCompletos());
    const falso = surgeFalso(diretorioTemporario(), "echo 'Success - Published'");
    const processo = spawnSync(
      process.execPath,
      [ENTRYPOINT, "gerar-relatorio-html", "--rodada-dir", rodada, "--surge-domain", "relatorio-ppc.surge.sh"],
      { cwd: RAIZ, env: { ...process.env, REVISAR_PPC_SURGE_CMD: falso } },
    );
    expect(processo.status).toBe(0);
    const saida = JSON.parse(processo.stdout.toString());
    expect(saida.publicacao_servico).toBe("surge");
    expect(saida.surge_url).toBe("https://relatorio-ppc.surge.sh");
    expect(saida.situacao).toBe("APTO_PARA_SUBMISSAO");
    expect(saida.mensagem).toBe(
      "Relatório de revisão do PPC pronto (Apto para submissão): https://relatorio-ppc.surge.sh. " +
        "Revisão prévia à submissão; não substitui a análise oficial da PROENS.",
    );
    expect(existsSync(rodadaPaths.relatorioHtml)).toBe(true);
    const site = path.join(rodadaPaths.suporteDir, "surge-site");
    expect(casefold(readFileSync(path.join(site, "index.html"), "utf-8"))).toContain("<script");
    expect(existsSync(path.join(site, "assets", "revisar-ppc.css"))).toBe(true);
    expect(existsSync(path.join(site, "assets", "revisar-ppc.js"))).toBe(true);
    const publicacao = lerJsonPy(path.join(rodadaPaths.suporteDir, "surge-publicacao.json")) as ObjetoPy;
    expect(publicacao.domain).toBe("relatorio-ppc.surge.sh");
    expect(publicacao.site_dir).toBe(site);
    expect(publicacao.relatorio_html_original).toBe(rodadaPaths.relatorioHtml);
  });

  test("--sem-surge devolve a URL local codificada como Path.as_uri", () => {
    const rodada = criarRodada();
    escreverJsonPy(
      path.join(caminhosRodada(rodada).suporteDir, "resultados-subagents.json"),
      payloadResultadosCompletos(),
    );
    const processo = spawnSync(
      process.execPath,
      [ENTRYPOINT, "gerar-relatorio-html", "--rodada-dir", rodada, "--sem-surge"],
      { cwd: RAIZ },
    );
    expect(processo.status).toBe(0);
    const saida = JSON.parse(processo.stdout.toString());
    expect(Object.keys(saida)).toEqual(["relatorio_html", "relatorio_url", "situacao", "situacao_rotulo", "mensagem"]);
    expect(saida.situacao_rotulo).toBe("Apto para submissão");
    expect(saida.relatorio_url).toBe(`file://${caminhosRodada(rodada).relatorioHtml}`);
  });
});
