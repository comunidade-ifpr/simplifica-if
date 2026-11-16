/**
 * Comentários do Word ancorados em trechos (PoC da proposta C do M1.11). Sem Word à mão, a validade
 * do arquivo é conferida pela estrutura: toda parte XML bem formada (pelo analisador estrito do
 * leitor), relação e tipo de conteúdo da parte de comentários, e para cada id exatamente um início,
 * um fim e uma referência no documento, nessa ordem, e um `w:comment` na parte de comentários. O
 * texto do documento lido de novo tem de ser o mesmo de antes: comentar não muda o PPC.
 */
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, test } from "vite-plus/test";
import { comentarDocx } from "../src/comentarios.ts";
import { lerDocx } from "../src/leitor.ts";
import { textoDoParagrafo, type BlocoOoxml } from "../src/modelo.ts";
import { hyperlink, montarDocx, par, run, tabelaDeTextos } from "../src/testes/sintetico.ts";
import { analisarXml } from "../src/xml.ts";

const DATA = "2026-11-16T12:00:00Z";

function textos(blocos: BlocoOoxml[]): string[] {
  return blocos.flatMap((bloco) =>
    bloco.tipo === "paragrafo"
      ? [textoDoParagrafo(bloco)]
      : bloco.linhas.flatMap((linha) => linha.celulas.map((celula) => celula.texto)),
  );
}

/** Confere a estrutura do arquivo comentado e devolve o documento e os comentários como texto. */
function conferir(docx: Uint8Array) {
  const partes = unzipSync(docx);
  for (const [nome, conteudo] of Object.entries(partes))
    if (nome.endsWith(".xml") || nome.endsWith(".rels")) expect(analisarXml(conteudo, nome)).not.toBeNull();
  const documento = strFromU8(partes["word/document.xml"]!);
  const comentarios = strFromU8(partes["word/comments.xml"]!);
  expect(strFromU8(partes["[Content_Types].xml"]!)).toContain(
    'PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"',
  );
  expect(strFromU8(partes["word/_rels/document.xml.rels"]!)).toMatch(/relationships\/comments" Target="comments.xml"/);
  const ids = [...comentarios.matchAll(/<w:comment w:id="(\d+)"/g)].map((m) => m[1]!);
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) {
    const posicoes = ["commentRangeStart", "commentRangeEnd", "commentReference"].map((marca) => {
      const achados = [...documento.matchAll(new RegExp(`<w:${marca} w:id="${id}"/>`, "g"))];
      expect(achados, `${marca} ${id}`).toHaveLength(1);
      return achados[0]!.index;
    });
    expect(posicoes[0]).toBeLessThan(posicoes[1]!);
    expect(posicoes[1]).toBeLessThan(posicoes[2]!);
  }
  return { documento, comentarios, ids };
}

/** Texto marcado pelo comentário `id` (o que fica entre o início e o fim). */
function marcado(documento: string, id: string): string {
  const inicio = documento.indexOf(`<w:commentRangeStart w:id="${id}"/>`);
  const fim = documento.indexOf(`<w:commentRangeEnd w:id="${id}"/>`);
  return [...documento.slice(inicio, fim).matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");
}

const PPC = montarDocx({
  corpo:
    par("PROJETO PEDAGÓGICO DO CURSO TÉCNICO EM AGROPECUÁRIA", { negrito: true }) +
    par(
      run("Fundamenta-se na ") +
        run("Resolução CNE/CEB nº 6/2012", { negrito: true }) +
        run(", que define as Diretrizes Curriculares Nacionais."),
    ) +
    par("A frequência mínima é de 75% & a recuperação é paralela, com “devolutivas” ao estudante.") +
    par(run("Consulte o ") + hyperlink("Catálogo Nacional", 'r:id="rId9"') + run(" para o perfil.")) +
    tabelaDeTextos([
      ["Componente", "Carga horária"],
      ["Atendimento Educacional Especializado", "40 h"],
    ]),
});

describe("comentarDocx", () => {
  test("ancora no trecho exato, dividindo runs, sem mudar o texto do documento", () => {
    const antes = textos(lerDocx(PPC).blocos);
    const { docx, ancoradas, naoAncoradas } = comentarDocx(
      PPC,
      [
        { trechos: ["Resolução CNE/CEB nº 6/2012"], texto: "Norma revogada pela Res. CNE/CP nº 1/2021." },
        { trechos: ["75%  &  a RECUPERAÇÃO"], texto: "Conferido: frequência mínima declarada." },
        { trechos: ['com "devolutivas"'], texto: "Aspas curvas no arquivo, retas no trecho." },
        { trechos: ["Fundamenta-se na Resolução"], texto: "Atravessa dois runs." },
        { trechos: ["Atendimento Educacional Especializado"], texto: "AEE não pode ser componente da matriz." },
        { trechos: ["Consulte o Catálogo Nacional para"], texto: "Atravessa o hiperlink." },
      ],
      { data: DATA },
    );
    expect(naoAncoradas).toEqual([]);
    expect(ancoradas).toHaveLength(6);
    const { documento, comentarios, ids } = conferir(docx);
    expect(ids).toEqual(["0", "1", "2", "3", "4", "5"]);
    expect(marcado(documento, "0")).toBe("Resolução CNE/CEB nº 6/2012");
    expect(marcado(documento, "1")).toBe("75% &amp; a recuperação");
    expect(marcado(documento, "2")).toBe("com “devolutivas”");
    expect(marcado(documento, "3")).toBe("Fundamenta-se na Resolução");
    expect(marcado(documento, "4")).toBe("Atendimento Educacional Especializado");
    expect(comentarios).toContain('w:author="Simplifica IF (revisão prévia)"');
    // O negrito do run dividido vale para as duas metades.
    expect(documento).toMatch(/<w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">Resolução<\/w:t>/);
    expect(textos(lerDocx(docx).blocos)).toEqual(antes);
  });

  test("trecho ausente não é ancorado em lugar errado; seção ausente vai para o início", () => {
    const { docx, ancoradas, naoAncoradas } = comentarDocx(
      PPC,
      [
        { trechos: ["texto que não está no PPC"], texto: "x" },
        { trechos: ["acompanhamento de egressos"], texto: "Falta a seção de egressos.", noInicioSeAusente: true },
      ],
      { data: DATA },
    );
    expect(naoAncoradas).toEqual([{ indice: 0, motivo: "trecho não encontrado num só parágrafo do arquivo" }]);
    expect(ancoradas).toEqual([
      { indice: 1, paragrafo: "PROJETO PEDAGÓGICO DO CURSO TÉCNICO EM AGROPECUÁRIA", noInicio: true },
    ]);
    const { documento } = conferir(docx);
    expect(marcado(documento, "0")).toBe("PROJETO PEDAGÓGICO DO CURSO TÉCNICO EM AGROPECUÁRIA");
  });

  test("dois comentários no mesmo run e comentários sobre um arquivo já comentado", () => {
    const primeiro = comentarDocx(
      PPC,
      [
        { trechos: ["frequência mínima"], texto: "a" },
        { trechos: ["recuperação é paralela"], texto: "b" },
      ],
      { data: DATA },
    );
    const segundo = comentarDocx(primeiro.docx, [{ trechos: ["Diretrizes Curriculares"], texto: "c" }], {
      data: DATA,
    });
    const { documento, ids } = conferir(segundo.docx);
    expect(ids).toEqual(["0", "1", "2"]);
    expect(marcado(documento, "0")).toBe("frequência mínima");
    expect(marcado(documento, "1")).toBe("recuperação é paralela");
    expect(marcado(documento, "2")).toBe("Diretrizes Curriculares");
    // A relação e o tipo da parte de comentários não são duplicados.
    const partes = unzipSync(segundo.docx);
    expect(strFromU8(partes["[Content_Types].xml"]!).match(/comments\+xml/g)).toHaveLength(1);
  });

  test("texto do comentário vindo da IA é escapado e perde caracteres de controle", () => {
    const { docx } = comentarDocx(
      PPC,
      [{ trechos: ["Diretrizes"], texto: 'Veja <w:p> & "isto"\u0007\n\nSegundo parágrafo\nlinha 2' }],
      { data: DATA },
    );
    const { comentarios } = conferir(docx);
    expect(comentarios).toContain("Veja &lt;w:p&gt; &amp; &quot;isto&quot;</w:t>");
    expect(comentarios).toContain('Segundo parágrafo</w:t><w:br/><w:t xml:space="preserve">linha 2');
  });
});
