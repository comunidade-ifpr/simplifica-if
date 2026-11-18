// @effect-diagnostics nodeBuiltinImport:off -- consulta o git (commit de referência) pelo node:child_process síncrono
/**
 * Relações, vigência, transições, front matter gerado, correspondência e impacto (fase 5). O impacto
 * roda o serviço `Impacto` sobre a layer da CLI (`layerRepositorio`): fontes lidas dos arquivos do
 * checkout e o `tmp/kb.sqlite`, recompilado se estiver velho.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer, test } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Impacto from "../Impacto.ts";
import * as Layers from "../layers.ts";
import { validarCorrespondencias } from "./correspondencia.ts";
import { dispositivosDoAto, listarNormas } from "./estrutura.ts";
import { analisarFrontMatter } from "./front-matter.ts";
import { normasComCamposGerados, reescreverFrontMatter } from "./gerado.ts";
import { idDoAto } from "./ids.ts";
import { raizRepositorio } from "../caminhos.ts";
import { INCLUIDAS_DEPOIS, REF_ANTES_SANEAMENTO } from "./referencia-saneamento.ts";
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
const refDisponivel =
  NodeChildProcess.spawnSync("git", ["cat-file", "-e", `${REF_ANTES_SANEAMENTO}^{commit}`], {
    cwd: raiz,
    stdio: "ignore",
  }).status === 0;
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

  test("Res. CNE/CP 1/2021 antes e depois da assinatura da 2/2026 (publicação a confirmar)", () => {
    expect(statusEm(DCN_2021, "2020-12-31", vigencia).status).toBe("ainda-nao-vigente");
    const antes = statusEm(DCN_2021, "2026-11-01", vigencia);
    expect(antes.status).toBe("vigente");
    expect(antes.eventos[0]!.ocorreu).toBe(false);
    const depois = statusEm(DCN_2021, "2026-11-12", vigencia);
    expect(depois.status).toBe("revogada");
    expect(depois.certo).toBe(false);
    expect(depois.eventos[0]!.ocorreu).toBe("a confirmar");
  });

  test("datas certas: Lei 13.146 entra em vigor 180 dias depois da publicação", () => {
    expect(statusEm("br/lei/2015/13146", "2015-12-31", vigencia).status).toBe("ainda-nao-vigente");
    expect(statusEm("br/lei/2015/13146", "2016-01-03", vigencia)).toMatchObject({ status: "vigente", certo: true });
  });

  test.skipIf(!refDisponivel)(
    "status calculado = manual (fcfc006) nas 36 normas de então, salvo divergências justificadas",
    () => {
      // Status manuais anteriores que o cálculo muda, com a relação que justifica a mudança.
      const justificadas: Record<string, [string, string]> = {
        "br/lei/1996/9394": ["alterada", "parcialmente revogada"], // Lei 11.788, art. 22: revoga o par. único do art. 82
        "br/lei/2003/10639": ["alterada", "vigente"], // a Lei 11.645 altera o art. 26-A da LDB, não a Lei 10.639
        "br/lei/2012/12711": ["vigente", "alterada"], // Lei 14.945/2024, art. 8º: nova redação do caput do art. 1º
        "ifpr/consup/res/2011/55": ["alterada", "parcialmente revogada"], // art. 104 revogado pela Res. 2/2017 (nota no texto)
        "ifpr/consup/res/2014/8": ["alterada", "parcialmente revogada"], // Res. 222/2024 e 242/2025, art. 2º
        "ifpr/consup/res/2025/259": ["vigente", "alterada"], // Res. 263/2025 (notas no próprio texto)
        "ifpr/consup/res/2026/276": ["vigente", "parcialmente revogada"], // Res. 282/2026 revoga o par. único do art. 31
      };
      const divergentes: Record<string, [string, string]> = {};
      for (const norma of listarNormas(raiz)) {
        if (INCLUIDAS_DEPOIS.has(norma.path)) continue;
        const antigo = NodeChildProcess.spawnSync(
          "git",
          ["show", `${REF_ANTES_SANEAMENTO}:base-conhecimento/${norma.path}`],
          {
            cwd: raiz,
            encoding: "utf-8",
            maxBuffer: 64 * 1024 * 1024,
          },
        ).stdout;
        const manual = String(analisarFrontMatter(antigo, norma.path).meta.status_vigencia);
        if (norma.id.includes("~")) continue; // compilação: status manual (texto reproduzido)
        const calculado = statusEm(norma.id, dataReferencia(raiz), vigencia).status;
        if (calculado !== manual) divergentes[norma.id] = [manual, calculado];
      }
      expect(divergentes).toEqual(justificadas);
    },
  );

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
      const efeito = inicioVigencia(idDoAto(stub.status_fonte!.split("#")[0]!), vigencia);
      const limite = efeito.data ?? efeito.minimo!;
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
    const art72 = transicoesAplicaveis(DCN_2026, "2031-01-01", vigencia).find((t) => t.id === "dcnept-2026-art72")!;
    expect(art72.situacao).toBe("encerrada");
  });

  test("linha normativa deriva vigente, substituídas e dispositivos revogados", () => {
    const linha = derivarLinha(["br/cne-ceb/res/2012/6", DCN_2021, DCN_2026], "2026-11-13", vigencia);
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
  });
});

/** Árvore de conteúdo sintética (`kb impacto --conteudo`): cinco fichas que citam dispositivos das DCN. */
const conteudoSintetico = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const conteudo = yield* fs.makeTempDirectoryScoped({ prefix: "kb-impacto-" });
  const pasta = path.join(conteudo, ".agents", "skills", "x", "base-analise", "fichas");
  yield* fs.makeDirectory(pasta, { recursive: true });
  const ficha = (nome: string, refs: { ref: string; dispositivo: string }[]) =>
    fs.writeFileString(path.join(pasta, `${nome}.json`), JSON.stringify({ referencias_normativas: refs }));
  yield* ficha("ct-x-01", [{ ref: DCN_2021, dispositivo: "#art29" }]);
  yield* ficha("ct-x-02", [{ ref: DCN_2021, dispositivo: "#art22-x" }]);
  yield* ficha("ct-x-03", [{ ref: DCN_2026, dispositivo: "#art22" }]); // destino do art. 20 da 1/2021
  yield* ficha("ct-x-04", [{ ref: DCN_2021, dispositivo: "#art2" }]);
  yield* ficha("ct-x-05", [{ ref: DCN_2026, dispositivo: "#art1-par1" }]); // destino do art. 2º da 1/2021
  return conteudo;
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
        const conteudo = yield* conteudoSintetico;
        const impacto = yield* Impacto.Impacto;
        const r = yield* impacto.daNorma(`${DCN_2021}#art2`, { raizConteudo: conteudo, incluirPpcs: false });
        const porArquivo = Object.fromEntries(r.arquivos.map((a) => [nomeDaFicha(a.arquivo), a.motivos]));
        expect(porArquivo).toEqual({ "ct-x-04": ["referencia"], "ct-x-05": ["referencia-correspondente"] });
      }),
    );

    it.effect("o ato inteiro continua alcançando todos", () =>
      Effect.gen(function* () {
        const conteudo = yield* conteudoSintetico;
        const impacto = yield* Impacto.Impacto;
        const r = yield* impacto.daNorma(DCN_2021, { raizConteudo: conteudo, incluirPpcs: false });
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
    it.effect("revogação da 1/2021 alcança a sucessora, transições, normas e conteúdos das skills", () =>
      Effect.gen(function* () {
        const impacto = yield* Impacto.Impacto;
        const r = yield* impacto.daNorma(DCN_2021, { incluirPpcs: false });
        expect(r.sucessoras).toEqual([DCN_2026]);
        expect(r.normas_que_citam.map((n) => n.id)).toContain("br/mec/portaria/2024/902");
        const arquivos = r.arquivos.map((a) => a.arquivo);
        expect(arquivos).toContain(
          ".agents/skills/revisar-ppc/base-analise/validacoes-cruzadas/vc-01-03-11-normas.json",
        );
        expect(arquivos).toContain(".agents/skills/revisar-ppc/base-analise/fichas/ct-curr-02.json");
      }),
    );
  });
});
