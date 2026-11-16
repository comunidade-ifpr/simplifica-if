// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- o teste grava um DOCX sintético num diretório temporário e fixa o relógio
/**
 * `preparar-documento` com entrada `.docx`: a rodada inteira sai só com Node, pela conversão de
 * `@simplifica-if/ppc`.
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { ObjetoPy } from "@simplifica-if/kb/python/valores";
import { docxDaFixture } from "@simplifica-if/ppc/testes/documentos";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { prepararDocumento } from "../scripts/preparar-documento.ts";
import { lerJsonPy } from "../scripts/rodada.ts";

const temporarios: string[] = [];
afterEach(() => {
  for (const dir of temporarios.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});

function diretorioTemporario(): string {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "revisar-ppc-preparar-docx-"));
  temporarios.push(dir);
  return dir;
}

describe("preparar-documento com .docx", () => {
  test("preparar-documento com .docx: rodada completa só com Node", () => {
    const dir = diretorioTemporario();
    const docx = NodePath.join(dir, "PPC Tecnico em Testes.docx");
    NodeFS.writeFileSync(docx, docxDaFixture("ppc-minimo"));
    const { rodadaDir, metadata, ppc } = prepararDocumento(docx, {
      saidaBase: NodePath.join(dir, "rodadas"),
      relogio: () => new Date(2026, 10, 13),
    });
    expect(NodePath.basename(rodadaDir)).toBe("2026-11-13t00-00-00-ppc-tecnico-em-testes");
    const dadosDaRodada = lerJsonPy(metadata) as ObjetoPy;
    expect(dadosDaRodada).toMatchObject({
      curso: "Técnico em Testes",
      campus: "Foz do Iguaçu",
      forma_oferta: "Integrado",
      modalidade_ensino: "Presencial",
      eixo_tecnologico: "Informação e Comunicação",
    });
    const conversao = dadosDaRodada.artefatos_conversao_docx as Record<string, string>;
    expect(Object.keys(conversao)).toEqual([
      "output_dir",
      "markdown",
      "markdown_bruto",
      "dados",
      "matriz_curricular",
      "ementario",
    ]);
    for (const caminho of Object.values(conversao)) expect(NodeFS.existsSync(caminho)).toBe(true);
    expect((lerJsonPy(conversao.dados!) as ObjetoPy).data_conversao).toBe("2026-11-13T00:00:00");
    expect(NodeFS.existsSync(NodePath.join(conversao.output_dir!, "imagens", "representacao_grafica.png"))).toBe(true);
    // O PPC.md da rodada é o Markdown normalizado da conversão, com a matriz canônica.
    const texto = NodeFS.readFileSync(ppc, "utf-8");
    expect(texto).toBe(NodeFS.readFileSync(conversao.markdown!, "utf-8"));
    expect(texto).toContain("| CARGA HORÁRIA TOTAL DO CURSO | CARGA HORÁRIA TOTAL DO CURSO |  | 680 | 530 |");
  });

  test("arquivo que não é DOCX falha antes de criar a rodada", () => {
    const dir = diretorioTemporario();
    const rodadas = NodePath.join(dir, "rodadas");
    const casos: Array<[string, Uint8Array, RegExp]> = [
      ["texto.docx", new TextEncoder().encode("isto não é um DOCX"), /não é um DOCX/],
      [
        "antigo.docx",
        Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]),
        /Word 97-2003 \(\.doc\) ou um DOCX protegido por senha/,
      ],
      ["truncado.docx", docxDaFixture("ppc-minimo").slice(0, 300), /corrompido ou incompleto/],
    ];
    for (const [nome, bytes, mensagem] of casos) {
      const arquivo = NodePath.join(dir, nome);
      NodeFS.writeFileSync(arquivo, bytes);
      expect(() => prepararDocumento(arquivo, { saidaBase: rodadas, relogio: () => new Date(2026, 10, 13) })).toThrow(
        mensagem,
      );
    }
    expect(NodeFS.existsSync(rodadas)).toBe(false);
  });

  test("arquivo de mais de 20 MB é recusado antes de ser lido", () => {
    const dir = diretorioTemporario();
    const arquivo = NodePath.join(dir, "enorme.docx");
    // Arquivo esparso: tem o tamanho, sem ocupar o disco.
    NodeFS.closeSync(NodeFS.openSync(arquivo, "w"));
    NodeFS.truncateSync(arquivo, 21 * 1024 * 1024);
    expect(() => prepararDocumento(arquivo, { saidaBase: NodePath.join(dir, "rodadas") })).toThrow(
      /tem 21 MB, e o limite é de 20 MB\. Um PPC raramente passa disso.*Arquivo › Compactar imagens/,
    );
    expect(NodeFS.existsSync(NodePath.join(dir, "rodadas"))).toBe(false);
  });
});
