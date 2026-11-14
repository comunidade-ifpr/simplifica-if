/** Relações, vigência, transições, front matter gerado, correspondência e impacto (fase 5). */
import { describe, expect, test } from "bun:test";
import { correspondencia, validarCorrespondencias } from "./correspondencia.ts";
import { dispositivosDoAto, listarNormas } from "./estrutura.ts";
import { analisarFrontMatter } from "./front-matter.ts";
import { normasComCamposGerados, reescreverFrontMatter } from "./gerado.ts";
import { impacto } from "./impacto.ts";
import { raizRepositorio } from "./registro.ts";
import { carregarRelacoes, proporRelacoes, validarRelacoes } from "./relacoes.ts";
import { dataReferencia, derivarLinha, statusEm, transicoesAplicaveis } from "./vigencia.ts";

const raiz = raizRepositorio();
/** Último commit antes da fase 5 (mesmo de `saneamento.test.ts`). */
const REF_ANTES_SANEAMENTO = "fcfc006";
const refDisponivel =
  Bun.spawnSync(["git", "cat-file", "-e", `${REF_ANTES_SANEAMENTO}^{commit}`], { cwd: raiz, stderr: "pipe" })
    .exitCode === 0;
const DCN_2021 = "br/cne-cp/res/2021/1";
const DCN_2026 = "br/cne-cp/res/2026/2";

describe("relações", () => {
  test("relacoes.yaml válido e sem propostas pendentes do regex", () => {
    expect(validarRelacoes(raiz)).toEqual([]);
    expect(proporRelacoes(raiz)).toEqual([]);
  });

  test("migra os pares do front matter antigo (7 revoga, 2 revogada_por, 6 altera, 5 alterada_por)", () => {
    const migradas = carregarRelacoes(raiz).filter((r) => r.proposta === "front-matter");
    const tem = (tipo: string, origem: string, alvo: string) =>
      migradas.some((r) => r.tipo === tipo && r.origem === origem && r.alvo === alvo);
    expect(tem("revoga", DCN_2026, DCN_2021)).toBe(true);
    expect(tem("revoga", DCN_2026, "br/cne-ceb/res/2025/3")).toBe(true);
    expect(tem("altera", "br/lei/2008/11645", "br/lei/2003/10639")).toBe(true);
    expect(tem("altera", "br/cne-ceb/res/2025/6", "br/cne-ceb/res/2025/3")).toBe(true);
    expect(tem("altera", "ifpr/consup/res/2024/222", "ifpr/consup/res/2014/8")).toBe(true);
  });
});

describe("vigência", () => {
  test("data de referência explícita, nunca o relógio", () => {
    expect(dataReferencia(raiz)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("Res. CNE/CP 1/2021 antes e depois da assinatura da 2/2026 (publicação a confirmar)", () => {
    expect(statusEm(DCN_2021, "2020-12-31", raiz).status).toBe("ainda-nao-vigente");
    const antes = statusEm(DCN_2021, "2026-11-01", raiz);
    expect(antes.status).toBe("vigente");
    expect(antes.eventos[0]!.ocorreu).toBe(false);
    const depois = statusEm(DCN_2021, "2026-11-12", raiz);
    expect(depois.status).toBe("revogada");
    expect(depois.certo).toBe(false);
    expect(depois.eventos[0]!.ocorreu).toBe("a confirmar");
  });

  test("datas certas: Lei 13.146 entra em vigor 180 dias depois da publicação", () => {
    expect(statusEm("br/lei/2015/13146", "2015-12-31", raiz).status).toBe("ainda-nao-vigente");
    expect(statusEm("br/lei/2015/13146", "2016-01-03", raiz)).toMatchObject({ status: "vigente", certo: true });
  });

  test.skipIf(!refDisponivel)(
    "status calculado = manual (fcfc006) nas 36 normas, salvo divergências justificadas",
    () => {
      // Status manuais anteriores que o cálculo muda, com a relação que justifica a mudança.
      const justificadas: Record<string, [string, string]> = {
        "br/lei/1996/9394": ["alterada", "parcialmente revogada"], // Lei 11.788, art. 22: revoga o par. único do art. 82
        "ifpr/consup/res/2011/55": ["alterada", "parcialmente revogada"], // art. 104 revogado pela Res. 2/2017 (nota no texto)
        "ifpr/consup/res/2014/8": ["alterada", "parcialmente revogada"], // Res. 222/2024 e 242/2025, art. 2º
        "ifpr/consup/res/2025/259": ["vigente", "alterada"], // Res. 263/2025 (notas no próprio texto)
        "ifpr/consup/res/2026/276": ["vigente", "parcialmente revogada"], // Res. 282/2026 revoga o par. único do art. 31
      };
      const divergentes: Record<string, [string, string]> = {};
      for (const norma of listarNormas(raiz)) {
        const antigo = Bun.spawnSync(["git", "show", `${REF_ANTES_SANEAMENTO}:base-conhecimento/${norma.path}`], {
          cwd: raiz,
          stdout: "pipe",
        }).stdout.toString();
        const manual = String(analisarFrontMatter(antigo, norma.path).meta.status_vigencia);
        if (norma.id.includes("~")) continue; // compilação: status manual (texto reproduzido)
        const calculado = statusEm(norma.id, dataReferencia(raiz), raiz).status;
        if (calculado !== manual) divergentes[norma.id] = [manual, calculado];
      }
      expect(divergentes).toEqual(justificadas);
    },
  );

  test("regras de transição da 2/2026 alcançam a 1/2021", () => {
    const ids = transicoesAplicaveis(DCN_2021, "2026-11-13", raiz).map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(["dcnept-2026-art71", "dcnept-2026-art71-parunico"]));
    const art72 = transicoesAplicaveis(DCN_2026, "2031-01-01", raiz).find((t) => t.id === "dcnept-2026-art72")!;
    expect(art72.situacao).toBe("encerrada");
  });

  test("linha normativa deriva vigente, substituídas e dispositivos revogados", () => {
    const linha = derivarLinha(["br/cne-ceb/res/2012/6", DCN_2021, DCN_2026], "2026-11-13", raiz);
    expect(linha.vigente).toBe(DCN_2026);
    expect(linha.substitui).toContain(DCN_2021);
    expect(linha.dispositivos_revogados).toEqual(["br/cne-ceb/res/2025/3#art6-iii"]);
    expect(derivarLinha(["br/cne-ceb/res/2012/6", DCN_2021], "2026-11-01", raiz).vigente).toBe(DCN_2021);
  });
});

describe("front matter gerado", () => {
  test("as 36 normas estão com os campos gerados em dia (gerar_base.ts)", () => {
    expect(
      normasComCamposGerados(raiz)
        .filter((n) => n.atual !== n.esperado)
        .map((n) => n.path),
    ).toEqual([]);
  });

  test("reescreve só os campos controlados", () => {
    const texto =
      '---\nid: x\nstatus_vigencia: vigente\nfonte: "u"\nrevoga:\n  - "A"\nrelaciona_se_a:\n  - "B"\n---\n\n## Resumo\n';
    const campos = new Map<string, string | string[]>([
      ["status_vigencia", "alterada"],
      ["vigencia_calculada_em", "2026-11-13"],
      ["alterada_por", ["C (art. 1º)"]],
    ]);
    expect(reescreverFrontMatter(texto, campos)).toBe(
      '---\nid: x\nstatus_vigencia: "alterada"\nfonte: "u"\nvigencia_calculada_em: "2026-11-13"\nalterada_por:\n  - "C (art. 1º)"\nrelaciona_se_a:\n  - "B"\n---\n\n## Resumo\n',
    );
  });
});

describe("correspondência 1/2021 → 2/2026", () => {
  test("válida e cobre todos os artigos da 1/2021", () => {
    expect(validarCorrespondencias(raiz)).toEqual([]);
    const artigos = dispositivosDoAto(DCN_2021, raiz).filter((d) => d.tipo === "artigo");
    expect(artigos.length).toBe(65);
    expect(correspondencia(DCN_2021, raiz).length).toBe(65);
  });

  test("Q07 e Q23 da avaliação", () => {
    const [art20] = correspondencia(`${DCN_2021}#art20`, raiz);
    expect(art20!.item).toMatchObject({ tipo: "parcial", destino: ["#art22"] });
    const [art26par1] = correspondencia(`${DCN_2021}#art26-par1`, raiz);
    expect(art26par1!.item.destino).toEqual(["#art29-par2", "#art29-par3"]);
    const [herdado] = correspondencia(`${DCN_2021}#art5-par1`, raiz);
    expect(herdado!.herdado_de).toBe("#art5");
  });
});

describe("impacto", () => {
  test("revogação da 1/2021 alcança a sucessora, transições, normas e conteúdos das skills", () => {
    const r = impacto(DCN_2021, { raiz, incluirPpcs: false });
    expect(r.sucessoras).toEqual([DCN_2026]);
    expect(r.normas_que_citam.map((n) => n.id)).toContain("br/mec/portaria/2024/902");
    const arquivos = r.arquivos.map((a) => a.arquivo);
    expect(arquivos).toContain(".agents/skills/revisar-ppc/base-analise/validacoes-cruzadas/vc-01-03-11-normas.json");
    expect(arquivos).toContain(".agents/skills/revisar-ppc/base-analise/fichas/ct-curr-02.json");
  });
});
