import { describe, expect, test } from "vite-plus/test";
import { ehUrlAssinada, limparUrlsAssinadas, RE_URL_ASSINADA, semAssinatura } from "./urls.ts";

const ASSINADA = "https://s3.sa-east-1.amazonaws.com/suap-prod/edu/ppc/PPC.pdf?AWSAccessKeyId=AKIAEXEMPLO&Signature=abc%3D&Expires=1780059125";

describe("URLs pré-assinadas", () => {
  test("reconhece a assinatura do S3 (v2 e v4) e deixa as demais URLs", () => {
    expect(ehUrlAssinada(ASSINADA)).toBe(true);
    expect(ehUrlAssinada("https://bucket.s3.amazonaws.com/a.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=f")).toBe(
      true,
    );
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
