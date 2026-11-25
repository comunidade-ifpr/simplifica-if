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
import { analisarPpc, analisarPpcPendente } from "@simplifica-if/kb/ppcs/front-matter";
import { docxDaFixture } from "@simplifica-if/ppc/testes/documentos";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterAll, describe, expect, test } from "vite-plus/test";
import { criarCaminhos } from "./caminhos.ts";
import {
  ErroImportacao,
  FalhaAoGravar,
  gravarJuntos,
  importarPpcDocx,
  type OpcoesImportacao,
  semFiguraLocal,
  STATUS_REABERTO,
} from "./importar-ppc.ts";
import { aplicarGerados } from "./gerados.ts";
import { arquivosIndices, gerarIndices } from "./indice-ppcs.ts";
import { Contexto } from "./validacao/contexto.ts";
import { dadosPessoaisEUrlsInternas } from "./validacao/normas.ts";
import { validarPpcs } from "./validacao/ppcs.ts";
import { listarPendencias } from "./pendencias.ts";
import { promoverPpc } from "./versoes-ppc.ts";

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
      },
      null,
      2,
    )}\n`,
  );
  return raiz;
}

const FONTE_ANO = "https://ifpr.edu.br/campus-a/ppc-tecnico-x.pdf#page=1";
/** Ano com a evidência (na capa do PDF publicado: os DOCX de teste não trazem o ano no texto). */
const doAno = (ano: number) => ({ ano, evidencia: `PPC aprovado em ${ano}`, fonteAno: FONTE_ANO });

function opcoes(raiz: string, docx: string, extra: Partial<OpcoesImportacao> = {}): OpcoesImportacao {
  return {
    caminhos: criarCaminhos(raiz),
    curso: "campus-a/tecnico-x",
    arquivoDocx: docx,
    fonteUrl: URL_PDF,
    ...doAno(2026),
    reconverter: false,
    agora: AGORA,
    conversor: CONVERSOR,
    ...extra,
  };
}

const lerRegistro = (raiz: string) =>
  JSON.parse(NodeFS.readFileSync(NodePath.join(raiz, IFPR, "cursos/campus-a/tecnico-x.json"), "utf-8"));
const caminhoPpc = (raiz: string) => NodePath.join(raiz, IFPR, "ppcs/campus-a/tecnico-x/2026.md");

describe("importarPpcDocx", () => {
  it.effect("grava o PPC com proveniência registrada e atualiza o registro do curso", () =>
    Effect.gen(function* () {
      const raiz = baseTemporaria();
      const bytes = docxDaFixture("ppc-minimo");
      const sha256 = NodeCrypto.createHash("sha256").update(bytes).digest("hex");
      const docx = escrever(raiz, "entrada/PPC Técnico X.docx", bytes);

      const resultado = yield* importarPpcDocx(opcoes(raiz, docx));

      expect(resultado).toMatchObject({
        markdownPath: "institucional/ifpr/ppcs/campus-a/tecnico-x/2026.md",
        registroPath: "institucional/ifpr/cursos/campus-a/tecnico-x.json",
        id: "ppc:campus-a/tecnico-x/2026",
        substituido: null,
        ppcUrlAnterior: null,
        pendencias: [],
        curadoriaReaberta: [],
        representacaoGrafica: "bitmap",
      });
      const texto = NodeFS.readFileSync(caminhoPpc(raiz), "utf-8");
      const { proveniencia, corpo } = analisarPpc(texto, "teste");
      expect(proveniencia).toMatchObject({
        id: "ppc:campus-a/tecnico-x/2026",
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
      expect(registro.ppc).toEqual({
        url: URL_PDF,
        markdown_path: "institucional/ifpr/ppcs/campus-a/tecnico-x/2026.md",
      });
      // O ppc entra na posição do schema, como nos outros registros.
      expect(Object.keys(registro)).toEqual([
        "campus_id",
        "curso_slug",
        "nome",
        "nivel",
        "forma_oferta",
        "pagina_oficial",
        "ppc",
      ]);

      // O pipeline da base aceita o resultado: o índice e a proveniência conferem com o registro.
      const caminhos = criarCaminhos(raiz);
      const indices = gerarIndices(caminhos, "2026-11-17");
      expect(indices.itensPpc.map((item) => item.id)).toEqual(["campus-a/tecnico-x/2026"]);
      expect(indices.itensPpc[0]?.fonte_pdf).toBe(URL_PDF);
      expect(indices.itensPpc[0]?.proveniencia).toEqual({
        situacao: "registrada",
        fonte_url: URL_PDF,
        fonte_sha256: "desconhecido",
        arquivo_convertido: { tipo: "docx", sha256 },
        convertido_em: "2026-11-17",
        conversor: CONVERSOR,
      });
    }),
  );

  it.effect("sem o ano ou sem a evidência, o PPC fica pendente, fora da base, e o registro não muda", () =>
    Effect.gen(function* () {
      const raiz = baseTemporaria({ url: URL_PDF });
      const registroAntes = NodeFS.readFileSync(NodePath.join(raiz, IFPR, "cursos/campus-a/tecnico-x.json"), "utf-8");
      const docx = escrever(raiz, "entrada/ppc.docx", docxDaFixture("ppc-minimo"));

      const semAno = yield* importarPpcDocx(opcoes(raiz, docx, { ano: undefined, evidencia: undefined }));
      expect(semAno).toMatchObject({
        markdownPath: "curadoria/pendencias/ppcs/campus-a/tecnico-x/sem-ano.md",
        id: null,
        pendencias: [expect.stringMatching(/^ano: importado sem --ano/)],
      });
      const comAno = yield* importarPpcDocx(opcoes(raiz, docx, { evidencia: undefined }));
      expect(comAno.markdownPath).toBe("curadoria/pendencias/ppcs/campus-a/tecnico-x/2026.md");
      const { pendente } = analisarPpcPendente(
        NodeFS.readFileSync(NodePath.join(raiz, comAno.markdownPath), "utf-8"),
        "p",
      );
      expect(pendente).toMatchObject({ ano_documento: "2026", proveniencia: "registrada", fonte_url: URL_PDF });
      expect(NodeFS.readFileSync(NodePath.join(raiz, IFPR, "cursos/campus-a/tecnico-x.json"), "utf-8")).toBe(
        registroAntes,
      );
      expect(NodeFS.existsSync(NodePath.join(raiz, IFPR, "ppcs"))).toBe(false);

      const caminhos = criarCaminhos(raiz);
      expect(listarPendencias(caminhos).map((p) => p.tipo === "ppc-pendente" && p.arquivo)).toEqual([
        "curadoria/pendencias/ppcs/campus-a/tecnico-x/2026.md",
        "curadoria/pendencias/ppcs/campus-a/tecnico-x/sem-ano.md",
      ]);
      // Completo, promove: entra na base como vigente.
      const promovido = promoverPpc(
        caminhos,
        comAno.markdownPath,
        { ano: 2026, evidencia: "PPC aprovado em 2026", fonte: FONTE_ANO },
        AGORA,
      );
      expect(promovido).toMatchObject({ id: "ppc:campus-a/tecnico-x/2026", vigente: true });
      expect(lerRegistro(raiz).ppc.markdown_path).toBe("institucional/ifpr/ppcs/campus-a/tecnico-x/2026.md");

      const semEvidenciaComAno = yield* Effect.flip(importarPpcDocx(opcoes(raiz, docx, { evidencia: "sem ano aqui" })));
      expect(semEvidenciaComAno.motivo).toBe("evidencia-invalida");
      const foraDoTexto = yield* Effect.flip(importarPpcDocx(opcoes(raiz, docx, { fonteAno: "texto" })));
      expect(foraDoTexto.message).toMatch(/não aparece no texto/);
    }),
  );

  it.effect("omite dados pessoais e informa só as contagens", () =>
    Effect.gen(function* () {
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
      const resultado = yield* importarPpcDocx(opcoes(raiz, docx));
      expect(resultado.omitidos).toEqual({ cpf: 1, rg: 0, telefone: 1, matricula: 0, siape: 0 });
      expect(resultado.urlsLimpas).toEqual({ planilhas: 1, sessoesSei: 0, assinadas: 0 });
      const texto = NodeFS.readFileSync(caminhoPpc(raiz), "utf-8");
      expect(texto).toContain("CPF: [CPF omitido]");
      expect(texto).toContain("[telefone omitido]");
      expect(texto).not.toContain("docs.google.com");
      expect(totalDadosPessoais(contarDadosPessoais(texto))).toBe(0);
    }),
  );

  it.effect("PPC novo entra como versão nova: o anterior fica, substituído, e a curadoria reabre", () =>
    Effect.gen(function* () {
      const ppcAntigo = {
        url: "https://ifpr.edu.br/campus-a/ppc-antigo.pdf",
        markdown_path: "institucional/ifpr/ppcs/campus-a/tecnico-x/2019.md",
        vagas: "40",
        trecho_vagas: "40 vagas anuais",
        curadoria_vagas: "Revisado",
        data_curadoria_vagas: "2026-05-11",
        observacoes: "Capa traz ano de ajuste posterior.",
      };
      const raiz = baseTemporaria(ppcAntigo);
      const antigo = escrever(raiz, `${IFPR}/ppcs/campus-a/tecnico-x/2019.md`, "texto antigo\n");
      const docx = escrever(raiz, "entrada/ppc.docx", docxDaFixture("ppc-minimo"));

      const resultado = yield* importarPpcDocx(opcoes(raiz, docx));
      expect(resultado).toMatchObject({
        id: "ppc:campus-a/tecnico-x/2026",
        markdownPath: "institucional/ifpr/ppcs/campus-a/tecnico-x/2026.md",
        substituido: "institucional/ifpr/ppcs/campus-a/tecnico-x/2019.md",
        ppcUrlAnterior: ppcAntigo.url,
        curadoriaReaberta: ["vagas"],
        // A observação fica, mas foi escrita sobre o texto anterior: a saída pede para reconferir.
        observacoesAReconferir: true,
      });
      expect(NodeFS.readFileSync(antigo, "utf-8")).toBe("texto antigo\n");
      expect(Object.keys(lerRegistro(raiz).ppc)).toEqual(Object.keys(ppcAntigo));
      expect(lerRegistro(raiz).ppc).toEqual({
        ...ppcAntigo,
        url: URL_PDF,
        markdown_path: "institucional/ifpr/ppcs/campus-a/tecnico-x/2026.md",
        curadoria_vagas: STATUS_REABERTO,
        data_curadoria_vagas: "2026-11-17",
      });

      // Outro PPC do mesmo ano ganha sufixo; um PPC mais antigo que o vigente é recusado.
      expect((yield* importarPpcDocx(opcoes(raiz, docx))).id).toBe("ppc:campus-a/tecnico-x/2026-2");
      const anterior = yield* Effect.flip(importarPpcDocx(opcoes(raiz, docx, doAno(2020))));
      expect(anterior.motivo).toBe("versao-anterior");
    }),
  );

  it.effect("--reconverter grava por cima do vigente, só com o ano dele", () =>
    Effect.gen(function* () {
      const raiz = baseTemporaria({
        url: URL_PDF,
        markdown_path: "institucional/ifpr/ppcs/campus-a/tecnico-x/2026.md",
      });
      escrever(raiz, `${IFPR}/ppcs/campus-a/tecnico-x/2026.md`, "texto antigo\n");
      const docx = escrever(raiz, "entrada/ppc.docx", docxDaFixture("ppc-minimo"));
      const outroAno = yield* Effect.flip(importarPpcDocx(opcoes(raiz, docx, { ...doAno(2025), reconverter: true })));
      expect(outroAno.motivo).toBe("ano-invalido");
      const resultado = yield* importarPpcDocx(opcoes(raiz, docx, { reconverter: true }));
      expect(resultado).toMatchObject({ id: "ppc:campus-a/tecnico-x/2026", substituido: null });
      expect(NodeFS.readFileSync(caminhoPpc(raiz), "utf-8")).toMatch(/^---\nid: ppc:campus-a\/tecnico-x\/2026\n/);
      expect(NodeFS.readdirSync(NodePath.dirname(caminhoPpc(raiz)))).toEqual(["2026.md"]);
    }),
  );

  it.effect("registro já completo sai igual byte a byte; campo ausente entra na posição do schema", () =>
    Effect.gen(function* () {
      const completo = { url: URL_PDF, markdown_path: "institucional/ifpr/ppcs/campus-a/tecnico-x/2026.md" };
      const raiz = baseTemporaria(completo);
      escrever(raiz, `${IFPR}/ppcs/campus-a/tecnico-x/2026.md`, "texto antigo\n");
      const arquivo = NodePath.join(raiz, IFPR, "cursos/campus-a/tecnico-x.json");
      const antes = NodeFS.readFileSync(arquivo, "utf-8");
      const docx = escrever(raiz, "entrada/ppc.docx", docxDaFixture("ppc-minimo"));
      expect((yield* importarPpcDocx(opcoes(raiz, docx, { reconverter: true }))).observacoesAReconferir).toBe(false);
      expect(NodeFS.readFileSync(arquivo, "utf-8")).toBe(antes);

      // Sem markdown_path e sem os status de curadoria: entram logo depois de url e de cada valor.
      const parcial = baseTemporaria({ url: URL_PDF, vagas: "40", observacoes: "x" });
      const docx2 = escrever(parcial, "entrada/ppc.docx", docxDaFixture("ppc-minimo"));
      yield* importarPpcDocx(opcoes(parcial, docx2));
      expect(Object.keys(lerRegistro(parcial).ppc)).toEqual([
        "url",
        "markdown_path",
        "vagas",
        "curadoria_vagas",
        "data_curadoria_vagas",
        "observacoes",
      ]);
    }),
  );

  it.effect("figura EMF: o aviso troca a referência a imagens/…emf", () =>
    Effect.gen(function* () {
      const raiz = baseTemporaria();
      const docx = escrever(raiz, "entrada/ppc.docx", docxDaFixture("figura-emf"));
      const resultado = yield* importarPpcDocx(opcoes(raiz, docx));
      expect(resultado.representacaoGrafica).toBe("vetorial_arquivo_cru");
      const texto = NodeFS.readFileSync(caminhoPpc(raiz), "utf-8");
      expect(texto).not.toContain("imagens/");
      expect(texto).not.toContain(".emf");
      expect(texto).toContain("**Aviso da conversão:** a representação gráfica");
    }),
  );

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

  it.effect("URL assinada e sessão do SEI no corpo saem, com as contagens", () =>
    Effect.gen(function* () {
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
      const resultado = yield* importarPpcDocx(opcoes(raiz, docx));
      expect(resultado.urlsLimpas).toEqual({ planilhas: 0, sessoesSei: 1, assinadas: 1 });
      const texto = NodeFS.readFileSync(caminhoPpc(raiz), "utf-8");
      expect(texto).toContain("https://s3.amazonaws.com/suap/ppc.pdf");
      expect(texto).toContain("controlador.php?acao=x&id_documento=1");
      expect(texto).not.toMatch(/SEGREDO|AWSAccessKeyId|infra_/);
      expect(dadosPessoaisEUrlsInternas("institucional/ifpr/ppcs/campus-a/tecnico-x/2026.md", texto)).toEqual([]);
    }),
  );

  it.effect("o índice de seções acha as seções numeradas do Markdown vindo do DOCX", () =>
    Effect.gen(function* () {
      const raiz = baseTemporaria();
      const docx = escrever(raiz, "entrada/ppc.docx", docxDaFixture("ppc-minimo"));
      yield* importarPpcDocx(opcoes(raiz, docx));
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
    }),
  );

  it.effect("a validação de PPCs da base aceita o PPC importado, sem exceção", () =>
    Effect.gen(function* () {
      const raiz = baseTemporaria();
      const docx = escrever(raiz, "entrada/ppc.docx", docxDaFixture("ppc-nucleos"));
      yield* importarPpcDocx(opcoes(raiz, docx));
      const caminhos = criarCaminhos(raiz);
      const { arquivos, ...pastas } = arquivosIndices(caminhos, gerarIndices(caminhos, "2026-11-17"));
      yield* aplicarGerados(arquivos, { modo: "gravar", raiz: caminhos.raiz, ...pastas });
      expect(validarPpcs(new Contexto(caminhos))).toEqual([]);
      const relativo = "institucional/ifpr/ppcs/campus-a/tecnico-x/2026.md";
      expect(dadosPessoaisEUrlsInternas(relativo, NodeFS.readFileSync(caminhoPpc(raiz), "utf-8"))).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("versões: o índice marca a vigente e a substituída; a validação acusa arquivo solto e vigente antiga", () =>
    Effect.gen(function* () {
      const raiz = baseTemporaria();
      const docx = escrever(raiz, "entrada/ppc.docx", docxDaFixture("ppc-minimo"));
      yield* importarPpcDocx(
        opcoes(raiz, docx, { ...doAno(2019), fonteUrl: "https://ifpr.edu.br/campus-a/ppc-2019.pdf" }),
      );
      yield* importarPpcDocx(opcoes(raiz, docx));
      const caminhos = criarCaminhos(raiz);
      const gerar = Effect.fnUntraced(function* () {
        const indices = gerarIndices(caminhos, "2026-11-17");
        const { arquivos, ...pastas } = arquivosIndices(caminhos, indices);
        yield* aplicarGerados(arquivos, { modo: "gravar", raiz: caminhos.raiz, ...pastas });
        return indices.itensPpc;
      });
      const itens = yield* gerar();
      expect(itens.map((i) => [i.id, i.vigente, i.substituido_por, i.fonte_pdf, i.ano_documento])).toEqual([
        [
          "campus-a/tecnico-x/2019",
          false,
          "campus-a/tecnico-x/2026",
          "https://ifpr.edu.br/campus-a/ppc-2019.pdf",
          2019,
        ],
        ["campus-a/tecnico-x/2026", true, undefined, URL_PDF, 2026],
      ]);
      expect(validarPpcs(new Contexto(caminhos))).toEqual([]);

      // PPC no caminho antigo (sem versão) não some em silêncio: é erro.
      const solto = escrever(raiz, `${IFPR}/ppcs/campus-a/tecnico-x.md`, "texto\n");
      expect(validarPpcs(new Contexto(caminhos)).join("\n")).toContain(
        "institucional/ifpr/ppcs/campus-a/tecnico-x.md: PPC fora do caminho",
      );
      NodeFS.rmSync(solto);

      // O curso apontando a versão antiga: a vigente não é a mais recente.
      const arquivo = NodePath.join(raiz, IFPR, "cursos/campus-a/tecnico-x.json");
      const registro = lerRegistro(raiz);
      registro.ppc.markdown_path = "institucional/ifpr/ppcs/campus-a/tecnico-x/2019.md";
      registro.ppc.url = "https://ifpr.edu.br/campus-a/ppc-2019.pdf";
      NodeFS.writeFileSync(arquivo, `${JSON.stringify(registro, null, 2)}\n`);
      yield* gerar();
      expect(validarPpcs(new Contexto(caminhos)).join("\n")).toContain(
        "o PPC vigente de campus-a/tecnico-x (2019) não é a versão mais recente (2026)",
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  describe("recusas", () => {
    const recusa = Effect.fnUntraced(function* (importacao: ReturnType<typeof importarPpcDocx>, mensagem: RegExp) {
      const erro = yield* Effect.flip(importacao);
      expect(erro).toBeInstanceOf(ErroImportacao);
      expect(erro.message).toMatch(mensagem);
      return erro;
    });

    it.effect("curso inexistente ou chave malformada", () =>
      Effect.gen(function* () {
        const raiz = baseTemporaria();
        const docx = escrever(raiz, "entrada/ppc.docx", docxDaFixture("ppc-minimo"));
        yield* recusa(importarPpcDocx(opcoes(raiz, docx, { curso: "campus-a/nao-existe" })), /Curso inexistente/);
        yield* recusa(importarPpcDocx(opcoes(raiz, docx, { curso: "campus-a" })), /<campus_id>\/<curso_slug>/);
        yield* recusa(importarPpcDocx(opcoes(raiz, docx, { curso: "../x/y" })), /<campus_id>\/<curso_slug>/);
      }),
    );

    it.effect("arquivo que não é DOCX", () =>
      Effect.gen(function* () {
        const raiz = baseTemporaria();
        const pdf = escrever(raiz, "entrada/ppc.pdf", "%PDF-1.7\n");
        yield* recusa(importarPpcDocx(opcoes(raiz, pdf)), /deve ser \.docx/);
        const falso = escrever(raiz, "entrada/falso.docx", "não é zip");
        yield* recusa(importarPpcDocx(opcoes(raiz, falso)), /Conversão recusada/);
        yield* recusa(importarPpcDocx(opcoes(raiz, NodePath.join(raiz, "nada.docx"))), /não encontrado/);
      }),
    );

    it.effect("conversão vazia", () =>
      Effect.gen(function* () {
        const raiz = baseTemporaria();
        const vazio = escrever(raiz, "entrada/vazio.docx", montarDocx({ corpo: par("") }));
        yield* recusa(importarPpcDocx(opcoes(raiz, vazio)), /não tem texto/);
      }),
    );

    it.effect("fonte-url que não é https pública", () =>
      Effect.gen(function* () {
        const raiz = baseTemporaria();
        const docx = escrever(raiz, "entrada/ppc.docx", docxDaFixture("ppc-minimo"));
        yield* recusa(importarPpcDocx(opcoes(raiz, docx, { fonteUrl: "http://ifpr.edu.br/x.pdf" })), /https/);
        yield* recusa(
          importarPpcDocx(opcoes(raiz, docx, { fonteUrl: "https://s3.x/ppc.pdf?AWSAccessKeyId=A&Signature=B" })),
          /pré-assinada/,
        );
        // Assinada em http: recusada como assinada, e a mensagem não repete a credencial.
        const assinadaHttp = "http://s3.x/ppc.pdf?AWSAccessKeyId=AKIASEGREDO&Signature=SEGREDO";
        yield* recusa(importarPpcDocx(opcoes(raiz, docx, { fonteUrl: assinadaHttp })), /pré-assinada/);
        expect(
          (yield* Effect.flip(importarPpcDocx(opcoes(raiz, docx, { fonteUrl: assinadaHttp })))).message,
        ).not.toMatch(/SEGREDO/);
        expect(
          (yield* Effect.flip(importarPpcDocx(opcoes(raiz, docx, { fonteUrl: "http://x.br/a.pdf?token=SEGREDO" }))))
            .message,
        ).toBe("--fonte-url deve ser URL https: http://x.br/a.pdf");
        yield* recusa(
          importarPpcDocx(opcoes(raiz, docx, { fonteUrl: "https://docs.google.com/spreadsheets/d/a/edit" })),
          /planilha do Google/,
        );
      }),
    );

    it.effect("markdown_path do registro fora do caminho esperado", () =>
      Effect.gen(function* () {
        const raiz = baseTemporaria({ url: URL_PDF, markdown_path: "institucional/ifpr/ppcs/campus-a/outro.md" });
        const docx = escrever(raiz, "entrada/ppc.docx", docxDaFixture("ppc-minimo"));
        yield* recusa(importarPpcDocx(opcoes(raiz, docx)), /fora do caminho/);
      }),
    );

    test("falha na gravação do registro desfaz o PPC já trocado", () => {
      const raiz = baseTemporaria({
        url: URL_PDF,
        markdown_path: "institucional/ifpr/ppcs/campus-a/tecnico-x/2026.md",
      });
      escrever(raiz, `${IFPR}/ppcs/campus-a/tecnico-x/2026.md`, "texto antigo\n");
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
      ).toThrow(expect.objectContaining({ destino: arquivo, cause: new Error("disco cheio") }));
      expect(NodeFS.readFileSync(ppc, "utf-8")).toBe("texto antigo\n");
      expect(NodeFS.readFileSync(arquivo, "utf-8")).toContain('"curso_slug": "tecnico-x"');
      // Sem temporários sobrando.
      expect(NodeFS.readdirSync(NodePath.dirname(ppc))).toEqual(["2026.md"]);
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
      ).toThrow(FalhaAoGravar);
      expect(NodeFS.existsSync(NodePath.join(nova, IFPR, "ppcs"))).toBe(false);
    });

    it.effect("permissão negada na pasta do PPC: código e arquivo na mensagem, nada alterado", () =>
      Effect.gen(function* () {
        // Como root, a permissão não é conferida e não há falha a observar.
        if (process.getuid?.() === 0) return;
        const raiz = baseTemporaria();
        const docx = escrever(raiz, "entrada/ppc.docx", docxDaFixture("ppc-minimo"));
        const pasta = NodePath.dirname(caminhoPpc(raiz));
        NodeFS.mkdirSync(pasta, { recursive: true });
        const registro = NodePath.join(raiz, IFPR, "cursos/campus-a/tecnico-x.json");
        const antes = NodeFS.readFileSync(registro, "utf-8");
        NodeFS.chmodSync(pasta, 0o555);
        const erro = yield* Effect.flip(importarPpcDocx(opcoes(raiz, docx))).pipe(
          Effect.ensuring(Effect.sync(() => NodeFS.chmodSync(pasta, 0o755))),
        );
        expect(erro).toMatchObject({
          motivo: "gravacao",
          codigo: "EACCES",
          arquivo: "institucional/ifpr/ppcs/campus-a/tecnico-x/2026.md",
        });
        expect(erro.message).toBe(
          "Falha ao gravar o PPC e o registro (EACCES em institucional/ifpr/ppcs/campus-a/tecnico-x/2026.md); nada foi alterado",
        );
        expect(NodeFS.readdirSync(pasta)).toEqual([]);
        expect(NodeFS.readFileSync(registro, "utf-8")).toBe(antes);
      }),
    );

    it.effect("registro do curso com JSON quebrado: a mensagem traz o erro do JSON", () =>
      Effect.gen(function* () {
        const raiz = baseTemporaria();
        escrever(raiz, `${IFPR}/cursos/campus-a/tecnico-x.json`, '{"campus_id": "campus-a",\n');
        const docx = escrever(raiz, "entrada/ppc.docx", docxDaFixture("ppc-minimo"));
        const erro = yield* recusa(
          importarPpcDocx(opcoes(raiz, docx)),
          /^institucional\/ifpr\/cursos\/campus-a\/tecnico-x\.json: JSON inválido \(.+\)$/,
        );
        expect(erro).toMatchObject({
          motivo: "registro-invalido",
          arquivo: "institucional/ifpr/cursos/campus-a/tecnico-x.json",
        });
        expect(erro.erroJson).toMatch(/JSON/);
        expect(erro.message).toContain(erro.erroJson);
      }),
    );

    it.effect("nada é gravado quando a conversão falha", () =>
      Effect.gen(function* () {
        const raiz = baseTemporaria();
        const falso = escrever(raiz, "entrada/falso.docx", "não é zip");
        const antes = NodeFS.readFileSync(NodePath.join(raiz, IFPR, "cursos/campus-a/tecnico-x.json"), "utf-8");
        expect((yield* Effect.flip(importarPpcDocx(opcoes(raiz, falso)))).motivo).toBe("conversao-recusada");
        expect(NodeFS.existsSync(caminhoPpc(raiz))).toBe(false);
        expect(NodeFS.readFileSync(NodePath.join(raiz, IFPR, "cursos/campus-a/tecnico-x.json"), "utf-8")).toBe(antes);
      }),
    );
  });
});
