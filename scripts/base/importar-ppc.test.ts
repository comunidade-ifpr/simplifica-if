// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- monta uma base temporária com node:fs síncrono e fixa o relógio da importação
/**
 * Importação de PPC DOCX → base (`importar-ppc.ts`) sobre os DOCX sintéticos de
 * `@simplifica-if/ppc/testes/documentos`, numa base temporária: nada toca a base real.
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { montarDocx, par, titulo } from "@simplifica-if/docx/testes/sintetico";
import { contarDadosPessoais, totalDadosPessoais } from "@simplifica-if/kb/ppcs/dados-pessoais";
import { analisarPpc } from "@simplifica-if/kb/ppcs/front-matter";
import { docxDaFixture } from "@simplifica-if/ppc/testes/documentos";
import { afterAll, describe, expect, test } from "vite-plus/test";
import { criarCaminhos } from "./caminhos.ts";
import {
  ErroImportacao,
  gravarJuntos,
  importarPpcDocx,
  type OpcoesImportacao,
  semFiguraLocal,
  STATUS_REABERTO,
} from "./importar-ppc.ts";
import { RAIZ_PROJETO } from "../config.ts";
import { gerarIndices, gravarIndices } from "./indice-ppcs.ts";
import { Contexto } from "./validacao/contexto.ts";
import { dadosPessoaisEUrlsInternas } from "./validacao/normas.ts";
import { validarPpcs } from "./validacao/ppcs.ts";

const AGORA = new Date(2026, 10, 17, 10, 0, 0);
const URL_PDF = "https://ifpr.edu.br/campus-a/ppc-tecnico-x.pdf";
const CONVERSOR = `simplifica-if/packages/ppc@${"b".repeat(40)}`;
const IFPR = "base-conhecimento/institucional/ifpr";

const temporarios: string[] = [];
afterAll(() => {
  for (const diretorio of temporarios) NodeFS.rmSync(diretorio, { recursive: true, force: true });
});

function escrever(raiz: string, relativo: string, conteudo: string | Uint8Array): string {
  const caminho = NodePath.join(raiz, relativo);
  NodeFS.mkdirSync(NodePath.dirname(caminho), { recursive: true });
  NodeFS.writeFileSync(caminho, conteudo);
  return caminho;
}

/** Base com um campus e um curso; `ppc` entra no registro do curso como está. */
function baseTemporaria(ppc?: Record<string, unknown>): string {
  const raiz = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "importar-ppc-"));
  temporarios.push(raiz);
  escrever(raiz, `${IFPR}/campi/campus-a.json`, JSON.stringify({ campus_id: "campus-a", nome: "Campus A" }));
  escrever(
    raiz,
    `${IFPR}/cursos/campus-a/tecnico-x.json`,
    `${JSON.stringify(
      {
        campus_id: "campus-a",
        curso_slug: "tecnico-x",
        nome: "Técnico X",
        nivel: "médio",
        forma_oferta: "Integrado",
        pagina_oficial: "https://ifpr.edu.br/x",
        ...(ppc ? { ppc } : {}),
        notion_page_id: "abc",
      },
      null,
      2,
    )}\n`,
  );
  return raiz;
}

function opcoes(raiz: string, docx: string, extra: Partial<OpcoesImportacao> = {}): OpcoesImportacao {
  return {
    caminhos: criarCaminhos(raiz),
    curso: "campus-a/tecnico-x",
    arquivoDocx: docx,
    fonteUrl: URL_PDF,
    substituir: false,
    agora: AGORA,
    conversor: CONVERSOR,
    ...extra,
  };
}

const lerRegistro = (raiz: string) =>
  JSON.parse(NodeFS.readFileSync(NodePath.join(raiz, IFPR, "cursos/campus-a/tecnico-x.json"), "utf-8"));
const caminhoPpc = (raiz: string) => NodePath.join(raiz, IFPR, "ppcs/campus-a/tecnico-x.md");

describe("importarPpcDocx", () => {
  test("grava o PPC com proveniência registrada e atualiza o registro do curso", () => {
    const raiz = baseTemporaria();
    const bytes = docxDaFixture("ppc-minimo");
    const sha256 = NodeCrypto.createHash("sha256").update(bytes).digest("hex");
    const docx = escrever(raiz, "entrada/PPC Técnico X.docx", bytes);

    const resultado = importarPpcDocx(opcoes(raiz, docx));

    expect(resultado).toMatchObject({
      markdownPath: "institucional/ifpr/ppcs/campus-a/tecnico-x.md",
      registroPath: "institucional/ifpr/cursos/campus-a/tecnico-x.json",
      substituiu: false,
      ppcUrlAnterior: null,
      curadoriaReaberta: [],
      representacaoGrafica: "bitmap",
    });
    const texto = NodeFS.readFileSync(caminhoPpc(raiz), "utf-8");
    const { proveniencia, corpo } = analisarPpc(texto, "teste");
    expect(proveniencia).toMatchObject({
      id: "ppc:campus-a/tecnico-x",
      fonte_url: URL_PDF,
      // O hash da fonte é o dos bytes de fonte_url (o PDF), que a importação não baixa.
      fonte_sha256: "desconhecido",
      convertido_em: "2026-11-17",
      conversor: CONVERSOR,
      arquivo_convertido: "docx",
      arquivo_convertido_sha256: sha256,
      proveniencia: "registrada",
    });
    expect(proveniencia.nota_proveniencia).toContain("arquivo_convertido_sha256");
    expect(corpo).toContain("## 1 APRESENTAÇÃO");
    expect(corpo).toContain("### 5.6 MATRIZ CURRICULAR");
    // A figura local não vai para a base: fica o aviso.
    expect(corpo).not.toContain("imagens/representacao_grafica");
    expect(corpo).toContain("**Aviso da conversão:** a representação gráfica");
    expect(NodeFS.existsSync(NodePath.join(raiz, IFPR, "ppcs/campus-a/imagens"))).toBe(false);

    const registro = lerRegistro(raiz);
    expect(registro.ppc).toEqual({ url: URL_PDF, markdown_path: "institucional/ifpr/ppcs/campus-a/tecnico-x.md" });
    // O ppc entra na posição do schema (antes de notion_page_id), como nos outros registros.
    expect(Object.keys(registro)).toEqual([
      "campus_id",
      "curso_slug",
      "nome",
      "nivel",
      "forma_oferta",
      "pagina_oficial",
      "ppc",
      "notion_page_id",
    ]);

    // O pipeline da base aceita o resultado: o índice e a proveniência conferem com o registro.
    const caminhos = criarCaminhos(raiz);
    const indices = gerarIndices(caminhos, "2026-11-17");
    expect(indices.itensPpc.map((item) => item.id)).toEqual(["campus-a/tecnico-x"]);
    expect(indices.itensPpc[0]?.fonte_pdf).toBe(URL_PDF);
    expect(indices.itensPpc[0]?.proveniencia).toEqual({
      situacao: "registrada",
      fonte_url: URL_PDF,
      fonte_sha256: "desconhecido",
      arquivo_convertido: { tipo: "docx", sha256 },
      convertido_em: "2026-11-17",
      conversor: CONVERSOR,
    });
  });

  test("omite dados pessoais e informa só as contagens", () => {
    const raiz = baseTemporaria();
    const docx = escrever(
      raiz,
      "entrada/ppc.docx",
      montarDocx({
        corpo: [
          titulo("1 IDENTIFICAÇÃO"),
          par("Coordenação: Fulano de Tal, CPF: 111.444.777-35, celular (41) 99876-5432."),
          par("Planilha de acompanhamento: https://docs.google.com/spreadsheets/d/abc123/edit"),
        ].join(""),
      }),
    );
    const resultado = importarPpcDocx(opcoes(raiz, docx));
    expect(resultado.omitidos).toEqual({ cpf: 1, rg: 0, telefone: 1, matricula: 0, siape: 0 });
    expect(resultado.urlsLimpas).toEqual({ planilhas: 1, sessoesSei: 0, assinadas: 0 });
    const texto = NodeFS.readFileSync(caminhoPpc(raiz), "utf-8");
    expect(texto).toContain("CPF: [CPF omitido]");
    expect(texto).toContain("[telefone omitido]");
    expect(texto).not.toContain("docs.google.com");
    expect(totalDadosPessoais(contarDadosPessoais(texto))).toBe(0);
  });

  test("recusa sobrescrever sem --substituir e, com ele, troca o PPC e reabre a curadoria", () => {
    const ppcAntigo = {
      url: "https://ifpr.edu.br/campus-a/ppc-antigo.pdf",
      markdown_path: "institucional/ifpr/ppcs/campus-a/tecnico-x.md",
      ano_documento: 2019,
      vagas: "40",
      trecho_vagas: "40 vagas anuais",
      curadoria_ano: "Revisado",
      data_curadoria_ano: "2026-05-11",
      curadoria_vagas: "Revisado",
      data_curadoria_vagas: "2026-05-11",
      observacoes: "Capa traz ano de ajuste posterior.",
    };
    const raiz = baseTemporaria(ppcAntigo);
    escrever(raiz, `${IFPR}/ppcs/campus-a/tecnico-x.md`, "texto antigo\n");
    const docx = escrever(raiz, "entrada/ppc.docx", docxDaFixture("ppc-minimo"));

    expect(() => importarPpcDocx(opcoes(raiz, docx))).toThrow(/repita com --substituir/);
    expect(NodeFS.readFileSync(caminhoPpc(raiz), "utf-8")).toBe("texto antigo\n");
    expect(lerRegistro(raiz).ppc).toEqual(ppcAntigo);

    const resultado = importarPpcDocx(opcoes(raiz, docx, { substituir: true }));
    expect(resultado).toMatchObject({
      substituiu: true,
      ppcUrlAnterior: ppcAntigo.url,
      curadoriaReaberta: ["ano", "vagas"],
      // A observação fica, mas foi escrita sobre o texto anterior: a saída pede para reconferir.
      observacoesAReconferir: true,
    });
    expect(Object.keys(lerRegistro(raiz).ppc)).toEqual(Object.keys(ppcAntigo));
    expect(lerRegistro(raiz).ppc).toEqual({
      ...ppcAntigo,
      url: URL_PDF,
      curadoria_ano: STATUS_REABERTO,
      data_curadoria_ano: "2026-11-17",
      curadoria_vagas: STATUS_REABERTO,
      data_curadoria_vagas: "2026-11-17",
    });
    expect(NodeFS.readFileSync(caminhoPpc(raiz), "utf-8")).toMatch(/^---\nid: ppc:campus-a\/tecnico-x\n/);
  });

  test("registro já completo sai igual byte a byte; campo ausente entra na posição do schema", () => {
    const completo = { url: URL_PDF, markdown_path: "institucional/ifpr/ppcs/campus-a/tecnico-x.md" };
    const raiz = baseTemporaria(completo);
    escrever(raiz, `${IFPR}/ppcs/campus-a/tecnico-x.md`, "texto antigo\n");
    const arquivo = NodePath.join(raiz, IFPR, "cursos/campus-a/tecnico-x.json");
    const antes = NodeFS.readFileSync(arquivo, "utf-8");
    const docx = escrever(raiz, "entrada/ppc.docx", docxDaFixture("ppc-minimo"));
    expect(importarPpcDocx(opcoes(raiz, docx, { substituir: true })).observacoesAReconferir).toBe(false);
    expect(NodeFS.readFileSync(arquivo, "utf-8")).toBe(antes);

    // Sem markdown_path e sem os status de curadoria: entram logo depois de url e de cada valor.
    const parcial = baseTemporaria({ url: URL_PDF, ano_documento: 2020, vagas: "40", observacoes: "x" });
    const docx2 = escrever(parcial, "entrada/ppc.docx", docxDaFixture("ppc-minimo"));
    importarPpcDocx(opcoes(parcial, docx2));
    expect(Object.keys(lerRegistro(parcial).ppc)).toEqual([
      "url",
      "markdown_path",
      "ano_documento",
      "vagas",
      "curadoria_ano",
      "data_curadoria_ano",
      "curadoria_vagas",
      "data_curadoria_vagas",
      "observacoes",
    ]);
  });

  test("figura EMF: o aviso troca a referência a imagens/…emf", () => {
    const raiz = baseTemporaria();
    const docx = escrever(raiz, "entrada/ppc.docx", docxDaFixture("figura-emf"));
    const resultado = importarPpcDocx(opcoes(raiz, docx));
    expect(resultado.representacaoGrafica).toBe("vetorial_arquivo_cru");
    const texto = NodeFS.readFileSync(caminhoPpc(raiz), "utf-8");
    expect(texto).not.toContain("imagens/");
    expect(texto).not.toContain(".emf");
    expect(texto).toContain("**Aviso da conversão:** a representação gráfica");
  });

  test("bloco da figura ausente ou que sobra no texto: recusa em vez de publicar link quebrado", () => {
    const grafica = {
      secao: "5.11 REPRESENTAÇÃO GRÁFICA",
      temBitmap: true,
      temDesenhosVetoriais: false,
      metodo: "bitmap",
      arquivo: { caminho: "imagens/representacao_grafica.png", bytes: new Uint8Array() },
      bloco: "![Representação gráfica](imagens/representacao_grafica.png)",
    } as const;
    expect(() => semFiguraLocal("## 5.11 REPRESENTAÇÃO GRÁFICA\n\ntexto\n", grafica)).toThrow(ErroImportacao);
    expect(() => semFiguraLocal(`${grafica.bloco}\n\nVer também imagens/representacao_grafica.png\n`, grafica)).toThrow(
      /ainda cita imagens\/representacao_grafica\.png/,
    );
    expect(semFiguraLocal("sem figura\n", { ...grafica, arquivo: null })).toBe("sem figura\n");
  });

  test("URL assinada e sessão do SEI no corpo saem, com as contagens", () => {
    const raiz = baseTemporaria();
    const docx = escrever(
      raiz,
      "entrada/ppc.docx",
      montarDocx({
        corpo: [
          titulo("1 IDENTIFICAÇÃO"),
          par(
            "Matriz no SUAP: https://s3.amazonaws.com/suap/ppc.pdf?AWSAccessKeyId=AKIASEGREDO&Signature=SEGREDO&Expires=1",
          ),
          par(
            "Processo: https://sei.ifpr.edu.br/sei/controlador.php?acao=x&id_documento=1&infra_sistema=2&infra_unidade_atual=3&infra_hash=0123456789abcdef",
          ),
        ].join(""),
      }),
    );
    const resultado = importarPpcDocx(opcoes(raiz, docx));
    expect(resultado.urlsLimpas).toEqual({ planilhas: 0, sessoesSei: 1, assinadas: 1 });
    const texto = NodeFS.readFileSync(caminhoPpc(raiz), "utf-8");
    expect(texto).toContain("https://s3.amazonaws.com/suap/ppc.pdf");
    expect(texto).toContain("controlador.php?acao=x&id_documento=1");
    expect(texto).not.toMatch(/SEGREDO|AWSAccessKeyId|infra_/);
    expect(dadosPessoaisEUrlsInternas("institucional/ifpr/ppcs/campus-a/tecnico-x.md", texto)).toEqual([]);
  });

  test("o índice de seções acha as seções numeradas do Markdown vindo do DOCX", () => {
    const raiz = baseTemporaria();
    const docx = escrever(raiz, "entrada/ppc.docx", docxDaFixture("ppc-minimo"));
    importarPpcDocx(opcoes(raiz, docx));
    const { itensSecao } = gerarIndices(criarCaminhos(raiz), "2026-11-17");
    expect(itensSecao.map((secao) => [secao.heading, secao.section_kind, secao.numeracao])).toEqual(
      expect.arrayContaining([
        ["1.1 JUSTIFICATIVA", "justificativa", "1.1"],
        ["5.6 MATRIZ CURRICULAR", "matriz_curricular", "5.6"],
        ["5.11 REPRESENTAÇÃO GRÁFICA DO PROCESSO FORMATIVO", "itinerario_formativo", "5.11"],
      ]),
    );
    const linhas = NodeFS.readFileSync(caminhoPpc(raiz), "utf-8").split("\n");
    const matriz = itensSecao.find((secao) => secao.section_kind === "matriz_curricular")!;
    expect(linhas[matriz.linha_inicio - 1]).toBe("### 5.6 MATRIZ CURRICULAR");
  });

  test("a validação de PPCs da base aceita o PPC importado, sem exceção", () => {
    const raiz = baseTemporaria();
    NodeFS.cpSync(
      NodePath.join(RAIZ_PROJETO, "base-conhecimento", "schemas"),
      NodePath.join(raiz, "base-conhecimento", "schemas"),
      {
        recursive: true,
      },
    );
    const docx = escrever(raiz, "entrada/ppc.docx", docxDaFixture("ppc-nucleos"));
    importarPpcDocx(opcoes(raiz, docx));
    const caminhos = criarCaminhos(raiz);
    gravarIndices(caminhos, gerarIndices(caminhos, "2026-11-17"));
    expect(validarPpcs(new Contexto(caminhos), {})).toEqual([]);
    const relativo = "institucional/ifpr/ppcs/campus-a/tecnico-x.md";
    expect(dadosPessoaisEUrlsInternas(relativo, NodeFS.readFileSync(caminhoPpc(raiz), "utf-8"))).toEqual([]);
  });

  describe("recusas", () => {
    const recusa = (fn: () => unknown, mensagem: RegExp) => {
      expect(fn).toThrow(ErroImportacao);
      expect(fn).toThrow(mensagem);
    };

    test("curso inexistente ou chave malformada", () => {
      const raiz = baseTemporaria();
      const docx = escrever(raiz, "entrada/ppc.docx", docxDaFixture("ppc-minimo"));
      recusa(() => importarPpcDocx(opcoes(raiz, docx, { curso: "campus-a/nao-existe" })), /Curso inexistente/);
      recusa(() => importarPpcDocx(opcoes(raiz, docx, { curso: "campus-a" })), /<campus_id>\/<curso_slug>/);
      recusa(() => importarPpcDocx(opcoes(raiz, docx, { curso: "../x/y" })), /<campus_id>\/<curso_slug>/);
    });

    test("arquivo que não é DOCX", () => {
      const raiz = baseTemporaria();
      const pdf = escrever(raiz, "entrada/ppc.pdf", "%PDF-1.7\n");
      recusa(() => importarPpcDocx(opcoes(raiz, pdf)), /deve ser \.docx/);
      const falso = escrever(raiz, "entrada/falso.docx", "não é zip");
      recusa(() => importarPpcDocx(opcoes(raiz, falso)), /Conversão recusada/);
      recusa(() => importarPpcDocx(opcoes(raiz, NodePath.join(raiz, "nada.docx"))), /não encontrado/);
    });

    test("conversão vazia", () => {
      const raiz = baseTemporaria();
      const vazio = escrever(raiz, "entrada/vazio.docx", montarDocx({ corpo: par("") }));
      recusa(() => importarPpcDocx(opcoes(raiz, vazio)), /não tem texto/);
    });

    test("fonte-url que não é https pública", () => {
      const raiz = baseTemporaria();
      const docx = escrever(raiz, "entrada/ppc.docx", docxDaFixture("ppc-minimo"));
      recusa(() => importarPpcDocx(opcoes(raiz, docx, { fonteUrl: "http://ifpr.edu.br/x.pdf" })), /https/);
      recusa(
        () => importarPpcDocx(opcoes(raiz, docx, { fonteUrl: "https://s3.x/ppc.pdf?AWSAccessKeyId=A&Signature=B" })),
        /pré-assinada/,
      );
      // Assinada em http: recusada como assinada, e a mensagem não repete a credencial.
      const assinadaHttp = "http://s3.x/ppc.pdf?AWSAccessKeyId=AKIASEGREDO&Signature=SEGREDO";
      recusa(() => importarPpcDocx(opcoes(raiz, docx, { fonteUrl: assinadaHttp })), /pré-assinada/);
      expect(() => importarPpcDocx(opcoes(raiz, docx, { fonteUrl: assinadaHttp }))).not.toThrow(/SEGREDO/);
      expect(() => importarPpcDocx(opcoes(raiz, docx, { fonteUrl: "http://x.br/a.pdf?token=SEGREDO" }))).toThrow(
        "--fonte-url deve ser URL https: http://x.br/a.pdf",
      );
      recusa(
        () => importarPpcDocx(opcoes(raiz, docx, { fonteUrl: "https://docs.google.com/spreadsheets/d/a/edit" })),
        /planilha do Google/,
      );
    });

    test("markdown_path do registro fora do caminho esperado", () => {
      const raiz = baseTemporaria({ url: URL_PDF, markdown_path: "institucional/ifpr/ppcs/campus-a/outro.md" });
      const docx = escrever(raiz, "entrada/ppc.docx", docxDaFixture("ppc-minimo"));
      recusa(() => importarPpcDocx(opcoes(raiz, docx)), /fora do caminho esperado/);
    });

    test("falha na gravação do registro desfaz o PPC já trocado", () => {
      const raiz = baseTemporaria({ url: URL_PDF, markdown_path: "institucional/ifpr/ppcs/campus-a/tecnico-x.md" });
      escrever(raiz, `${IFPR}/ppcs/campus-a/tecnico-x.md`, "texto antigo\n");
      const arquivo = NodePath.join(raiz, IFPR, "cursos/campus-a/tecnico-x.json");
      const ppc = caminhoPpc(raiz);
      const falhaNoSegundo = (de: string, para: string) => {
        if (para === arquivo) throw new Error("disco cheio");
        NodeFS.renameSync(de, para);
      };
      expect(() =>
        gravarJuntos(
          [
            { destino: ppc, texto: "texto novo\n" },
            { destino: arquivo, texto: "{}\n" },
          ],
          falhaNoSegundo,
        ),
      ).toThrow("disco cheio");
      expect(NodeFS.readFileSync(ppc, "utf-8")).toBe("texto antigo\n");
      expect(NodeFS.readFileSync(arquivo, "utf-8")).toContain('"curso_slug": "tecnico-x"');
      // Sem temporários sobrando.
      expect(NodeFS.readdirSync(NodePath.dirname(ppc))).toEqual(["tecnico-x.md"]);
      expect(NodeFS.readdirSync(NodePath.dirname(arquivo))).toEqual(["tecnico-x.json"]);

      // PPC novo (não havia arquivo): a falha o remove, e a pasta criada também.
      const nova = baseTemporaria();
      const ppcNovo = caminhoPpc(nova);
      const arquivoNovo = NodePath.join(nova, IFPR, "cursos/campus-a/tecnico-x.json");
      const falha = (de: string, para: string) => {
        if (para === arquivoNovo) throw new Error("disco cheio");
        NodeFS.renameSync(de, para);
      };
      expect(() =>
        gravarJuntos(
          [
            { destino: ppcNovo, texto: "novo\n" },
            { destino: arquivoNovo, texto: "{}\n" },
          ],
          falha,
        ),
      ).toThrow("disco cheio");
      expect(NodeFS.existsSync(NodePath.join(nova, IFPR, "ppcs"))).toBe(false);
    });

    test("nada é gravado quando a conversão falha", () => {
      const raiz = baseTemporaria();
      const falso = escrever(raiz, "entrada/falso.docx", "não é zip");
      const antes = NodeFS.readFileSync(NodePath.join(raiz, IFPR, "cursos/campus-a/tecnico-x.json"), "utf-8");
      expect(() => importarPpcDocx(opcoes(raiz, falso))).toThrow(ErroImportacao);
      expect(NodeFS.existsSync(caminhoPpc(raiz))).toBe(false);
      expect(NodeFS.readFileSync(NodePath.join(raiz, IFPR, "cursos/campus-a/tecnico-x.json"), "utf-8")).toBe(antes);
    });
  });
});
