// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- monta bases temporárias com node:fs para as operações síncronas sobre PPCs e fixa a data delas
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterAll, describe, expect, test } from "vite-plus/test";
import {
  analisarPpc,
  analisarPpcPendente,
  type ProvenienciaPpc,
  serializarFrontMatterPpc,
} from "@simplifica-if/kb/ppcs/front-matter";
import { criarCaminhos } from "./caminhos.ts";
import { listarPendencias } from "./pendencias.ts";
import { Contexto } from "./validacao/contexto.ts";
import { validarPendenciasPpcs } from "./validacao/pendencias.ts";
import { definirAnoPpc, ErroVersaoPpc, moverParaPendencias, promoverPpc, STATUS_REABERTO } from "./versoes-ppc.ts";

const AGORA = new Date(2026, 10, 24, 10, 0, 0);
const IFPR = "base-conhecimento/institucional/ifpr";
const PPCS = `${IFPR}/ppcs/campus-a/tecnico-x`;
const CORPO = "\n**PROJETO PEDAGÓGICO**\n\n**Cidade\n2019**\n\n## 1 Apresentação\ntexto\n";

const temporarios: string[] = [];
afterAll(() => {
  for (const diretorio of temporarios) NodeFS.rmSync(diretorio, { recursive: true, force: true });
});

function escrever(raiz: string, relativo: string, conteudo: string): string {
  const caminho = NodePath.join(raiz, relativo);
  NodeFS.mkdirSync(NodePath.dirname(caminho), { recursive: true });
  NodeFS.writeFileSync(caminho, conteudo);
  return caminho;
}

/** Front matter de um PPC da base. */
function ppc(
  versao: string,
  ano: string = versao.slice(0, 4),
  fonte = `https://ifpr.edu.br/ppc-${versao}.pdf`,
): string {
  const base: ProvenienciaPpc = {
    id: `ppc:campus-a/tecnico-x/${versao}`,
    ano_documento: ano,
    ano_evidencia: `PPC ${ano}`,
    ano_fonte: "https://ifpr.edu.br/capa.pdf#page=1",
    fonte_url: fonte,
    fonte_sha256: "desconhecido",
    convertido_em: "2026-05-28",
    conversor: "desconhecido",
    proveniencia: "reconstruida",
    nota_proveniencia: "Reconstruída.",
  };
  return serializarFrontMatterPpc(base) + CORPO;
}

/** Base com um curso e as versões dadas; o curso aponta `vigente`. */
function base(versoes: Record<string, string>, vigente: string | null, extraPpc: object = {}): string {
  const raiz = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "versoes-ppc-"));
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
        ppc: {
          url: vigente ? `https://ifpr.edu.br/ppc-${vigente}.pdf` : "https://ifpr.edu.br/ppc.pdf",
          ...(vigente ? { markdown_path: `institucional/ifpr/ppcs/campus-a/tecnico-x/${vigente}.md` } : {}),
          ...extraPpc,
        },
      },
      null,
      2,
    )}\n`,
  );
  for (const [versao, ano] of Object.entries(versoes)) escrever(raiz, `${PPCS}/${versao}.md`, ppc(versao, ano));
  return raiz;
}

const registro = (raiz: string) =>
  JSON.parse(NodeFS.readFileSync(NodePath.join(raiz, IFPR, "cursos/campus-a/tecnico-x.json"), "utf-8")).ppc;
const versoes = (raiz: string) => NodeFS.readdirSync(NodePath.join(raiz, PPCS)).sort();

describe("definirAnoPpc", () => {
  test("ano da própria versão: grava a evidência do texto e não move nada", () => {
    const raiz = base({ "2019": "2019" }, "2019");
    const antes = NodeFS.readFileSync(NodePath.join(raiz, IFPR, "cursos/campus-a/tecnico-x.json"), "utf-8");
    const resultado = definirAnoPpc(
      criarCaminhos(raiz),
      "campus-a/tecnico-x/2019",
      { ano: 2019, evidencia: "Cidade 2019", fonte: "texto" },
      AGORA,
    );
    expect(resultado).toEqual({
      chaveAnterior: "campus-a/tecnico-x/2019",
      chave: "campus-a/tecnico-x/2019",
      vigente: "institucional/ifpr/ppcs/campus-a/tecnico-x/2019.md",
    });
    const { proveniencia, corpo } = analisarPpc(
      NodeFS.readFileSync(NodePath.join(raiz, PPCS, "2019.md"), "utf-8"),
      "x",
    );
    expect(proveniencia).toMatchObject({ ano_documento: "2019", ano_evidencia: "Cidade 2019", ano_fonte: "texto" });
    expect(corpo).toBe(CORPO);
    expect(NodeFS.readFileSync(NodePath.join(raiz, IFPR, "cursos/campus-a/tecnico-x.json"), "utf-8")).toBe(antes);
  });

  test("ano de outra versão: o PPC muda de ID e arquivo, e o curso continua apontando a mais recente", () => {
    const raiz = base({ "2019": "2019", "2023": "2023" }, "2023", { vagas: "40", trecho_vagas: "40 vagas" });
    // A 2023 era, na verdade, de 2017: passa a ser a mais antiga, e a 2019 vira a vigente.
    const resultado = definirAnoPpc(
      criarCaminhos(raiz),
      "campus-a/tecnico-x/2023",
      { ano: 2017, evidencia: "aprovado em 2017", fonte: "https://ifpr.edu.br/res.pdf" },
      AGORA,
    );
    expect(resultado.chave).toBe("campus-a/tecnico-x/2017");
    expect(versoes(raiz)).toEqual(["2017.md", "2019.md"]);
    expect(registro(raiz)).toEqual({
      url: "https://ifpr.edu.br/ppc-2019.pdf",
      markdown_path: "institucional/ifpr/ppcs/campus-a/tecnico-x/2019.md",
      vagas: "40",
      trecho_vagas: "40 vagas",
      curadoria_vagas: STATUS_REABERTO,
      data_curadoria_vagas: "2026-11-24",
    });
    const movido = analisarPpc(NodeFS.readFileSync(NodePath.join(raiz, PPCS, "2017.md"), "utf-8"), "x").proveniencia;
    expect(movido.id).toBe("ppc:campus-a/tecnico-x/2017");
    expect(movido.fonte_url).toBe("https://ifpr.edu.br/ppc-2023.pdf");
  });

  test("mesmo documento renomeado continua vigente sem reabrir as vagas; ano ocupado ganha sufixo", () => {
    const raiz = base({ "2019": "2019", "2023": "2023" }, "2023", { vagas: "40", curadoria_vagas: "Revisado" });
    const resultado = definirAnoPpc(
      criarCaminhos(raiz),
      "campus-a/tecnico-x/2023",
      { ano: 2019, evidencia: "Cidade 2019", fonte: "texto" },
      AGORA,
    );
    expect(resultado.chave).toBe("campus-a/tecnico-x/2019-2");
    expect(registro(raiz)).toMatchObject({
      markdown_path: "institucional/ifpr/ppcs/campus-a/tecnico-x/2019-2.md",
      curadoria_vagas: "Revisado",
    });
  });

  test("recusa evidência sem o ano, fora do texto ou PPC inexistente, sem mudar nada", () => {
    const raiz = base({ "2019": "2019" }, "2019");
    const caminhos = criarCaminhos(raiz);
    expect(() =>
      definirAnoPpc(caminhos, "campus-a/tecnico-x/2019", { ano: 2019, evidencia: "Cidade", fonte: "texto" }, AGORA),
    ).toThrow(/deve conter o ano 2019/);
    expect(() =>
      definirAnoPpc(
        caminhos,
        "campus-a/tecnico-x/2019",
        { ano: 2019, evidencia: "Curitiba 2019", fonte: "texto" },
        AGORA,
      ),
    ).toThrow(/não aparece no texto/);
    expect(() =>
      definirAnoPpc(caminhos, "campus-a/tecnico-x/2030", { ano: 2030, evidencia: "2030", fonte: "texto" }, AGORA),
    ).toThrow(ErroVersaoPpc);
    expect(versoes(raiz)).toEqual(["2019.md"]);
  });
});

describe("pendências", () => {
  test("moverParaPendencias: o vigente sai, a versão anterior vira vigente; o último deixa o curso sem markdown_path", () => {
    const raiz = base({ "2019": "2019", "2023": "2023" }, "2023");
    const caminhos = criarCaminhos(raiz);
    const resultado = moverParaPendencias(caminhos, "campus-a/tecnico-x/2023", ["ano: capa sem data; PDF lido"], AGORA);
    expect(resultado).toEqual({
      arquivo: "curadoria/pendencias/ppcs/campus-a/tecnico-x/2023.md",
      vigente: "institucional/ifpr/ppcs/campus-a/tecnico-x/2019.md",
    });
    expect(registro(raiz)).toMatchObject({ url: "https://ifpr.edu.br/ppc-2019.pdf" });
    const pendente = analisarPpcPendente(NodeFS.readFileSync(NodePath.join(raiz, resultado.arquivo), "utf-8"), "p");
    expect(pendente.pendente.pendencias).toEqual(["ano: capa sem data; PDF lido"]);
    expect(pendente.corpo).toBe(CORPO);

    moverParaPendencias(caminhos, "campus-a/tecnico-x/2019", ["ano: x"], AGORA);
    expect(registro(raiz)).toEqual({ url: "https://ifpr.edu.br/ppc-2019.pdf" });
    expect(NodeFS.existsSync(NodePath.join(raiz, PPCS))).toBe(false);
    expect(() => moverParaPendencias(caminhos, "campus-a/tecnico-x/2019", [], AGORA)).toThrow(/ao menos uma/);
  });

  test("listarPendencias e validarPendenciasPpcs: pendentes, cursos sem texto, e o que está fora do contrato", () => {
    const raiz = base({ "2023": "2023" }, "2023");
    const caminhos = criarCaminhos(raiz);
    expect(listarPendencias(caminhos)).toEqual([]);
    moverParaPendencias(caminhos, "campus-a/tecnico-x/2023", ["ano: capa sem data"], AGORA);
    expect(listarPendencias(caminhos)).toEqual([
      {
        tipo: "ppc-pendente",
        curso: "campus-a/tecnico-x",
        arquivo: "curadoria/pendencias/ppcs/campus-a/tecnico-x/2023.md",
        pendencias: ["ano: capa sem data"],
        fonte_url: "https://ifpr.edu.br/ppc-2023.pdf",
      },
    ]);
    expect(validarPendenciasPpcs(new Contexto(caminhos))).toEqual([]);

    // Curso com PPC publicado e nada na base nem pendente.
    escrever(
      raiz,
      `${IFPR}/cursos/campus-a/outro.json`,
      JSON.stringify({ campus_id: "campus-a", curso_slug: "outro", nome: "Outro", ppc: { url: "https://x.br/o.pdf" } }),
    );
    expect(listarPendencias(caminhos).map((p) => [p.tipo, p.curso])).toEqual([
      ["ppc-pendente", "campus-a/tecnico-x"],
      ["ppc-sem-texto", "campus-a/outro"],
    ]);

    // Pendente com dado pessoal, sem a pendência do ano, e fora do caminho.
    const arquivo = NodePath.join(raiz, "curadoria/pendencias/ppcs/campus-a/tecnico-x/2023.md");
    NodeFS.writeFileSync(
      arquivo,
      NodeFS.readFileSync(arquivo, "utf-8").replace('  - "ano: capa sem data"', '  - "vagas: x"') +
        "CPF 111.444.777-35\n",
    );
    escrever(raiz, "curadoria/pendencias/ppcs/solto.md", "x\n");
    const erros = validarPendenciasPpcs(new Contexto(caminhos)).join("\n");
    expect(erros).toContain("contém dados pessoais");
    expect(erros).toContain('campo desconhecido "vagas"');
    expect(erros).toContain('falta a pendência "ano"');
    expect(erros).toContain("solto.md: PPC pendente fora do caminho");
  });

  test("promoverPpc: ganha a versão do ano; vira vigente só se for a mais recente", () => {
    const raiz = base({ "2019": "2019", "2023": "2023" }, "2023");
    const caminhos = criarCaminhos(raiz);
    definirAnoPpc(
      caminhos,
      "campus-a/tecnico-x/2023",
      { ano: 2023, evidencia: "PPC 2023", fonte: "https://x.br/c.pdf" },
      AGORA,
    );
    moverParaPendencias(caminhos, "campus-a/tecnico-x/2019", ["ano: confirmar"], AGORA);
    const pendente = "curadoria/pendencias/ppcs/campus-a/tecnico-x/2019.md";
    expect(() =>
      promoverPpc(caminhos, pendente, { ano: 2019, evidencia: "Curitiba 2019", fonte: "texto" }, AGORA),
    ).toThrow(/não aparece no texto/);
    expect(promoverPpc(caminhos, pendente, { ano: 2019, evidencia: "Cidade 2019", fonte: "texto" }, AGORA)).toEqual({
      chave: "campus-a/tecnico-x/2019",
      id: "ppc:campus-a/tecnico-x/2019",
      vigente: false,
    });
    expect(NodeFS.existsSync(NodePath.join(raiz, "curadoria/pendencias/ppcs/campus-a"))).toBe(false);
    expect(versoes(raiz)).toEqual(["2019.md", "2023.md"]);
    expect(registro(raiz).markdown_path).toBe("institucional/ifpr/ppcs/campus-a/tecnico-x/2023.md");

    // Uma pendente mais nova vira vigente.
    moverParaPendencias(caminhos, "campus-a/tecnico-x/2023", ["ano: rever"], AGORA);
    const novo = promoverPpc(
      caminhos,
      NodePath.join(raiz, "curadoria/pendencias/ppcs/campus-a/tecnico-x/2023.md"),
      { ano: 2025, evidencia: "versão de 2025", fonte: "https://x.br/r.pdf" },
      AGORA,
    );
    expect(novo).toMatchObject({ chave: "campus-a/tecnico-x/2025", vigente: true });
    expect(registro(raiz)).toMatchObject({
      url: "https://ifpr.edu.br/ppc-2023.pdf",
      markdown_path: "institucional/ifpr/ppcs/campus-a/tecnico-x/2025.md",
    });
    expect(() =>
      promoverPpc(caminhos, "base-conhecimento/x.md", { ano: 2025, evidencia: "2025", fonte: "texto" }, AGORA),
    ).toThrow(/deve estar em curadoria\/pendencias/);
  });
});
