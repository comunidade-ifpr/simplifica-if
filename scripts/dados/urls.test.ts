// @effect-diagnostics nodeBuiltinImport:off -- teste: compara com o conversor Python por subprocesso
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import { describe, expect, test } from "vite-plus/test";
import {
  ehUrlAssinada,
  limparUrlsAssinadas,
  RE_URL_ASSINADA,
  RE_URL_SESSAO_SEI,
  semAssinatura,
  semPlanilhasGoogle,
  semSessaoSei,
} from "./urls.ts";

const ASSINADA =
  "https://s3.sa-east-1.amazonaws.com/suap-prod/edu/ppc/PPC.pdf?AWSAccessKeyId=AKIAEXEMPLO&Signature=abc%3D&Expires=1780059125";

describe("URLs pré-assinadas", () => {
  test("reconhece a assinatura do S3 (v2 e v4) e deixa as demais URLs", () => {
    expect(ehUrlAssinada(ASSINADA)).toBe(true);
    expect(
      ehUrlAssinada("https://bucket.s3.amazonaws.com/a.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=f"),
    ).toBe(true);
    expect(ehUrlAssinada("https://ifpr.edu.br/x.pdf?page=2")).toBe(false);
    expect(ehUrlAssinada("texto com Signature=1")).toBe(false);
  });

  test("grava só o endereço do objeto, sem a query", () => {
    expect(semAssinatura(ASSINADA)).toBe("https://s3.sa-east-1.amazonaws.com/suap-prod/edu/ppc/PPC.pdf");
    expect(semAssinatura("https://ifpr.edu.br/x.pdf?page=2")).toBe("https://ifpr.edu.br/x.pdf?page=2");
    expect(limparUrlsAssinadas({ ppc: { url: ASSINADA, ano: 2020 }, urls: [ASSINADA] })).toEqual({
      ppc: { url: "https://s3.sa-east-1.amazonaws.com/suap-prod/edu/ppc/PPC.pdf", ano: 2020 },
      urls: ["https://s3.sa-east-1.amazonaws.com/suap-prod/edu/ppc/PPC.pdf"],
    });
  });

  test("acha a URL assinada no meio de um texto (validação da base)", () => {
    expect(RE_URL_ASSINADA.test(`{"url": "${ASSINADA}"}`)).toBe(true);
    expect(RE_URL_ASSINADA.test('{"url": "https://ifpr.edu.br/a.pdf"}')).toBe(false);
  });
});

describe("planilhas do Google e sessão do SEI", () => {
  test("o link da planilha sai e o texto em volta fica", () => {
    expect(semPlanilhasGoogle("Origem: https://docs.google.com/spreadsheets/d/abc/edit?gid=1#gid=1 aba TAREFAS")).toBe(
      "Origem: planilha interna (link omitido) aba TAREFAS",
    );
  });

  test("tira infra_hash, infra_sistema e infra_unidade_atual e deixa o resto da URL", () => {
    const url =
      "https://sei.ifpr.edu.br/sei/controlador.php?acao=documento_visualizar&id_documento=1&infra_sistema=2&infra_unidade_atual=3&infra_hash=abc";
    expect(semSessaoSei(`ver ${url}.`)).toBe(
      "ver https://sei.ifpr.edu.br/sei/controlador.php?acao=documento_visualizar&id_documento=1.",
    );
    expect(RE_URL_SESSAO_SEI.test(semSessaoSei(url))).toBe(false);
    const publica = "https://sei.ifpr.edu.br/sei/publicacoes/controlador_publicacoes.php?acao=x&hash_download=abc";
    expect(semSessaoSei(publica)).toBe(publica);
    // URL partida pela conversão do PDF: o hash sai mesmo assim.
    expect(semSessaoSei("&infr a_unidade_atual=3&infra_hash=0123abcd0123abcd 4567ef Ato nº 1")).toBe(
      "&infr a_unidade_atual=3 Ato nº 1",
    );
    expect(RE_URL_SESSAO_SEI.test("não persista URLs de sessão com `infra_hash`.")).toBe(false);
  });
});

const python = NodeChildProcess.spawnSync("python3", ["--version"]).status === 0;
test.skipIf(!python)("o conversor Python limpa as URLs como semPlanilhasGoogle e semSessaoSei", () => {
  const entradas = [
    "Origem: https://docs.google.com/spreadsheets/d/abc/edit?gid=1 aba X",
    "ver https://sei.ifpr.edu.br/sei/controlador.php?acao=documento_visualizar&id_documento=1&infra_sistema=2&infra_unidade_atual=3&infra_hash=abc.",
    "https://sei.ifpr.edu.br/sei/controlador.php?infra_hash=abc&acao=x",
    "id_documento=1&infr a_unidade_atual=3&infra_hash=0123abcd0123abcd 4567ef Ato nº 1",
  ];
  const resultado = NodeChildProcess.spawnSync(
    "python3",
    [
      "-c",
      "import json, sys; from converter_ppcs_markdown import limpar_urls; print(json.dumps([limpar_urls(t) for t in json.load(sys.stdin)]))",
    ],
    { cwd: NodePath.resolve(import.meta.dirname, ".."), input: JSON.stringify(entradas), encoding: "utf-8" },
  );
  expect(resultado.stderr).toBe("");
  expect(JSON.parse(resultado.stdout)).toEqual(entradas.map((texto) => semSessaoSei(semPlanilhasGoogle(texto))));
});
