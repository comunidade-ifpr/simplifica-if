// @effect-diagnostics nodeBuiltinImport:off -- monta caminhos das fichas com node:path e um checkout temporário com node:fs
/**
 * Relações, vigência, transições, front matter gerado, correspondência e impacto. O impacto
 * roda sobre a layer da CLI (`layerRepositorio`): o `tmp/kb.sqlite`, recompilado se estiver velho; o
 * de um dispositivo, pela regra pura `impactoEm` com fichas sintéticas e a vigência e a
 * correspondência do banco.
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer, test } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FontesNormativas from "../FontesNormativas.ts";
import * as Impacto from "../Impacto.ts";
import { carregarFonteCorrespondencia } from "../db/consultas-normas.ts";
import * as Layers from "../layers.ts";
import { validarCorrespondencias } from "./correspondencia.ts";
import { dispositivosDaNorma } from "./estrutura.ts";
import { impactoEm } from "./impacto.ts";
import { normasComCamposGerados, reescreverFrontMatter } from "./gerado.ts";
import { raizRepositorio } from "../caminhos.ts";
import { carregarRegistro } from "./registro.ts";
import { carregarRelacoes, proporRelacoes, validarRelacoes } from "./relacoes.ts";
import {
  carregarFonteVigencia,
  dataReferencia,
  derivarLinha,
  inicioVigencia,
  statusEm,
  transicoesAplicaveis,
} from "./vigencia.ts";

const raiz = raizRepositorio();
const vigencia = carregarFonteVigencia(raiz);
/** A base com a Res. CNE/CP nº 2/2026 publicada em 12/11/2026, para exercitar a revogação e as transições. */
const comDcn2026Publicada = {
  ...vigencia,
  datas: new Map(vigencia.datas).set("br/cne-cp/res/2026/2", {
    assinada_em: "2026-11-11",
    publicada_em: "2026-11-12",
    vigente_de: "2026-11-12",
  }),
};
const DCN_2021 = "br/cne-cp/res/2021/1";
const DCN_2026 = "br/cne-cp/res/2026/2";

/** Véspera de uma data AAAA-MM-DD, em UTC. */
const vesperaDe = (data: string): string =>
  DateTime.formatIsoDateUtc(DateTime.subtract(DateTime.makeUnsafe(`${data}T00:00:00Z`), { days: 1 }));

describe("relações", () => {
  test("relacoes.yaml válido e sem propostas pendentes do regex", () => {
    expect(validarRelacoes(raiz)).toEqual([]);
    expect(proporRelacoes(raiz)).toEqual([]);
  });

  test("origem sem texto na base (stub) exige efeito_de com data em revoga e altera", () => {
    const tmp = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "relacoes-"));
    try {
      NodeFS.cpSync(NodePath.join(raiz, "base-conhecimento/normas"), NodePath.join(tmp, "base-conhecimento/normas"), {
        recursive: true,
      });
      const relacoes = NodeFS.readFileSync(NodePath.join(raiz, "base-conhecimento/relacoes.yaml"), "utf-8");
      const semEfeito = relacoes.replace(
        /(origem: br\/lei\/2023\/14723\n(?:.*\n)*?)    efeito_de: "2023-11-14"\n/,
        "$1",
      );
      expect(semEfeito).not.toBe(relacoes);
      NodeFS.writeFileSync(NodePath.join(tmp, "base-conhecimento/relacoes.yaml"), semEfeito);
      expect(validarRelacoes(tmp, carregarRegistro(raiz))).toEqual([
        expect.stringMatching(
          /\(altera br\/lei\/2023\/14723 → br\/lei\/2012\/12711\): origem sem texto na base exige efeito_de com a data/,
        ),
      ]);
    } finally {
      NodeFS.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("migra os pares do front matter antigo (7 revoga, 2 revogada_por, 6 altera, 5 alterada_por)", () => {
    const migradas = carregarRelacoes(raiz).filter((r) => r.proposta === "front-matter");
    const tem = (tipo: string, origem: string, alvo: string) =>
      migradas.some((r) => r.tipo === tipo && r.origem === origem && r.alvo === alvo);
    expect(tem("revoga", DCN_2026, DCN_2021)).toBe(true);
    expect(tem("revoga", DCN_2026, "br/cne-ceb/res/2025/3")).toBe(true);
    // A Lei 11.645 dá nova redação ao art. 26-A da LDB; o par antigo "altera Lei 10.639" foi retirado.
    expect(tem("altera", "br/lei/2008/11645", "br/lei/1996/9394")).toBe(true);
    expect(tem("altera", "br/lei/2008/11645", "br/lei/2003/10639")).toBe(false);
    expect(tem("altera", "br/cne-ceb/res/2025/6", "br/cne-ceb/res/2025/3")).toBe(true);
    expect(tem("altera", "ifpr/consup/res/2024/222", "ifpr/consup/res/2014/8")).toBe(true);
  });
});

describe("vigência", () => {
  test("data de referência explícita, nunca o relógio", () => {
    expect(dataReferencia(raiz)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("Res. CNE/CP 2/2026 aguardando publicação: não vigente, e a revogação que ela opera não produz efeito", () => {
    expect(statusEm(DCN_2026, "2030-01-01", vigencia)).toMatchObject({
      status: "ainda-nao-vigente",
      inicio: { data: null, aguardando: true },
    });
    expect(statusEm(DCN_2021, "2021-01-05", vigencia).status).toBe("ainda-nao-vigente");
    const depois = statusEm(DCN_2021, "2030-01-01", vigencia);
    expect(depois.status).toBe("vigente");
    expect(depois.eventos.find((e) => e.origem === DCN_2026)).toMatchObject({ efeito_de: null, ocorreu: false });
  });

  test("Res. CNE/CP 1/2021 antes e depois da publicação da 2/2026", () => {
    expect(statusEm(DCN_2021, "2026-11-11", comDcn2026Publicada).status).toBe("vigente");
    const depois = statusEm(DCN_2021, "2026-11-12", comDcn2026Publicada);
    expect(depois.status).toBe("revogada");
    expect(depois.eventos.find((e) => e.origem === DCN_2026)).toMatchObject({ efeito_de: "2026-11-12", ocorreu: true });
  });

  test("datas certas: Lei 13.146 entra em vigor 180 dias depois da publicação", () => {
    expect(statusEm("br/lei/2015/13146", "2015-12-31", vigencia).status).toBe("ainda-nao-vigente");
    expect(statusEm("br/lei/2015/13146", "2016-01-03", vigencia)).toMatchObject({ status: "vigente" });
  });

  test("stub com status registrado: o status só vale a partir do efeito da relação que o fundamenta", () => {
    expect(statusEm("br/cne-ceb/res/2012/6", "2015-01-01", vigencia).status).toBe("vigente");
    expect(statusEm("br/cne-cp/res/2002/3", "2015-01-01", vigencia).status).toBe("vigente");
    expect(statusEm("br/cne-ceb/res/2014/1", "2015-01-01", vigencia).status).toBe("vigente");
    expect(statusEm("br/lei/1971/5692", "1990-01-01", vigencia).status).toBe("vigente");
    const registro = carregarRegistro(raiz);
    const datados = registro.entradas.filter(
      (e) => e.situacao === "stub" && e.status_vigencia && !["a confirmar", "vigente"].includes(e.status_vigencia),
    );
    expect(datados.length).toBeGreaterThan(20);
    const errados: string[] = [];
    for (const stub of datados) {
      const efeito = inicioVigencia(stub.status_fonte!.split("#")[0]!, vigencia);
      if (efeito.aguardando) {
        // a norma do status_fonte aguarda publicação: o status registrado ainda não vale
        if (statusEm(stub.id, "2027-01-01", vigencia).status !== "vigente") errados.push(`${stub.id} aguardando`);
        continue;
      }
      const limite = efeito.data!;
      const vespera = vesperaDe(limite);
      const antes = statusEm(stub.id, vespera, vigencia).status;
      if (!["vigente", "alterada", "ainda-nao-vigente"].includes(antes)) errados.push(`${stub.id} ${vespera} ${antes}`);
      const depois = statusEm(stub.id, "2027-01-01", vigencia).status;
      if (depois !== stub.status_vigencia) errados.push(`${stub.id} 2027-01-01 ${depois}`);
    }
    expect(errados).toEqual([]);
  });

  test("regras de transição da 2/2026 alcançam a 1/2021", () => {
    const ids = transicoesAplicaveis(DCN_2021, "2026-11-13", vigencia).map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(["dcnept-2026-art71", "dcnept-2026-art71-parunico"]));
    const art72 = (fonte: typeof vigencia) =>
      transicoesAplicaveis(DCN_2026, "2031-01-01", fonte).find((t) => t.id === "dcnept-2026-art72")!;
    // aguardando publicação, a regra não começou; publicada, conta da publicação
    expect(art72(vigencia)).toMatchObject({ situacao: "a-iniciar", inicio_em: null });
    expect(art72(comDcn2026Publicada).situacao).toBe("encerrada");
  });

  test("linha normativa deriva vigente, substituídas e dispositivos revogados", () => {
    const linhaHoje = derivarLinha(["br/cne-ceb/res/2012/6", DCN_2021, DCN_2026], "2026-11-13", vigencia);
    expect(linhaHoje.vigente).toBe(DCN_2021);
    const linha = derivarLinha(["br/cne-ceb/res/2012/6", DCN_2021, DCN_2026], "2026-11-13", comDcn2026Publicada);
    expect(linha.vigente).toBe(DCN_2026);
    expect(linha.substitui).toContain(DCN_2021);
    expect(linha.dispositivos_revogados).toEqual(["br/cne-ceb/res/2025/3#art6-iii"]);
    expect(derivarLinha(["br/cne-ceb/res/2012/6", DCN_2021], "2026-11-01", vigencia).vigente).toBe(DCN_2021);
  });
});

describe("front matter gerado", () => {
  test("as normas estão com os campos gerados em dia (gerar_base.ts)", () => {
    expect(
      normasComCamposGerados(raiz)
        .filter((n) => n.atual !== n.esperado)
        .map((n) => n.path),
    ).toEqual([]);
  });

  test("reescreve só os campos controlados", () => {
    const texto =
      '---\nid: x\nstatus_vigencia: vigente\nfonte_url: "https://u"\nfonte_referencia: "r"\nrevoga:\n  - "A"\nrelaciona_se_a:\n  - "B"\n---\n\n## Resumo\n';
    const campos = new Map<string, string | string[]>([
      ["status_vigencia", "alterada"],
      ["alterada_por", ["C (art. 1º)"]],
    ]);
    expect(reescreverFrontMatter(texto, campos)).toBe(
      '---\nid: x\nstatus_vigencia: "alterada"\nfonte_url: "https://u"\nfonte_referencia: "r"\nalterada_por:\n  - "C (art. 1º)"\nrelaciona_se_a:\n  - "B"\n---\n\n## Resumo\n',
    );
  });

  test("sem status_vigencia (norma nova), a primeira reescrita já é a final", () => {
    const texto = '---\nid: x\nfonte_url: "https://u"\nrelaciona_se_a:\n  - "B"\n---\n\nTexto.\n';
    const campos = new Map<string, string | string[]>([
      ["status_vigencia", "vigente"],
      ["revoga", ["A"]],
    ]);
    const uma = reescreverFrontMatter(texto, campos);
    expect(uma).toBe(
      '---\nid: x\nfonte_url: "https://u"\nstatus_vigencia: "vigente"\nrevoga:\n  - "A"\nrelaciona_se_a:\n  - "B"\n---\n\nTexto.\n',
    );
    expect(reescreverFrontMatter(uma, campos)).toBe(uma);
  });
});

describe("correspondência 1/2021 → 2/2026", () => {
  test("válida e cobre todos os artigos da 1/2021", () => {
    expect(validarCorrespondencias(raiz)).toEqual([]);
    const artigos = dispositivosDaNorma(DCN_2021, raiz).filter((d) => d.tipo === "artigo");
    expect(artigos.length).toBe(65);
  });
});

/** Cinco fichas sintéticas que citam dispositivos das DCN, como o banco as guarda (caminho e JSON). */
const FICHAS_SINTETICAS = (
  [
    ["ct-x-01", DCN_2021, "#art29"],
    ["ct-x-02", DCN_2021, "#art22-x"],
    ["ct-x-03", DCN_2026, "#art22"], // destino do art. 20 da 1/2021
    ["ct-x-04", DCN_2021, "#art2"],
    ["ct-x-05", DCN_2026, "#art1-par1"], // destino do art. 2º da 1/2021
  ] as const
).map(([nome, ref, dispositivo]) => ({
  arquivo: `base-conhecimento/revisao-ppc/fichas/${nome}.json`,
  texto: JSON.stringify({ referencias_normativas: [{ ref, dispositivo }] }),
}));

/** `impactoEm` sobre as fichas sintéticas, com a vigência e a correspondência da base. */
const impactoSintetico = Effect.fn("impacto.sintetico")(function* (id: string) {
  const fontes = yield* FontesNormativas.FontesNormativas;
  const correspondencia = yield* carregarFonteCorrespondencia;
  return impactoEm(
    {
      id,
      vigencia: fontes,
      dataReferencia: fontes.dataReferencia,
      correspondencia,
      dispositivos: [],
      topicos: [],
      arquivosConteudo: FICHAS_SINTETICAS,
      segmentosCitantes: [],
      ppcsQueCitam: [],
    },
    { incluirPpcs: false },
  );
});

const nomeDaFicha = (arquivo: string) => NodePath.basename(arquivo, ".json");

// a layer da CLI, com o relógio real: se o `tmp/kb.sqlite` estiver velho, ela o recompila com o mtime certo
layer(Layers.layerRepositorio({ raiz }).pipe(Layer.provideMerge(NodeServices.layer)), {
  excludeTestServices: true,
  timeout: "180 seconds",
})((it) => {
  describe("impacto de um dispositivo", () => {
    it.effect("#art2 não casa #art29 nem #art22-x, e só os destinos do art. 2º contam como correspondentes", () =>
      Effect.gen(function* () {
        const r = yield* impactoSintetico(`${DCN_2021}#art2`);
        const porArquivo = Object.fromEntries(r.arquivos.map((a) => [nomeDaFicha(a.arquivo), a.motivos]));
        expect(porArquivo).toEqual({ "ct-x-04": ["referencia"], "ct-x-05": ["referencia-correspondente"] });
      }),
    );

    it.effect("o ato inteiro continua alcançando todos", () =>
      Effect.gen(function* () {
        const r = yield* impactoSintetico(DCN_2021);
        expect(r.arquivos.map((a) => nomeDaFicha(a.arquivo)).sort()).toEqual([
          "ct-x-01",
          "ct-x-02",
          "ct-x-03",
          "ct-x-04",
          "ct-x-05",
        ]);
      }),
    );
  });

  describe("impacto", () => {
    it.effect("revogação da 1/2021 alcança a sucessora, transições, normas e as fichas", () =>
      Effect.gen(function* () {
        const impacto = yield* Impacto.Impacto;
        const r = yield* impacto.daNorma(DCN_2021, { incluirPpcs: false });
        expect(r.sucessoras).toEqual([DCN_2026]);
        expect(r.normas_que_citam.map((n) => n.id)).toContain("br/mec/portaria/2024/902");
        const arquivos = r.arquivos.map((a) => a.arquivo);
        expect(arquivos).toContain("base-conhecimento/revisao-ppc/fichas/ct-curr-02.json");
        // além das fichas, os marcos normativos da revisão de PPC, que o banco também guarda
        expect(arquivos).toContain("base-conhecimento/revisao-ppc/marcos-normativos.json");
      }),
    );
  });
});
