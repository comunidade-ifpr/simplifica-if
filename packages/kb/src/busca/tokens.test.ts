/** Termos da busca: a forma acentuada e a sem acento de uma palavra dão o mesmo radical. */
import { describe, expect, test } from "bun:test";
import { radicais, radicalDoToken, semDiacriticos, termos } from "./tokens.ts";

const PARES = [
  "avaliação",
  "avaliações",
  "certificação",
  "integralização",
  "referências",
  "horária",
  "experiência",
  "tolerância",
  "permanência",
  "inclusão",
  "estágio",
  "obrigatório",
  "frequência",
  "módulo",
  "disponível",
  "acessível",
  "evolução",
];

describe("radical sem depender de acento", () => {
  test.each(PARES)("%s e a forma sem acento", (palavra) => {
    expect(radicalDoToken(semDiacriticos(palavra))).toBe(radicalDoToken(palavra));
  });

  test("flexões continuam juntas", () => {
    expect(radicalDoToken("avaliação")).toBe(radicalDoToken("avaliações"));
    expect(radicalDoToken("avaliacao")).toBe(radicalDoToken("avaliar"));
    expect(radicalDoToken("certificacoes")).toBe(radicalDoToken("certificação"));
    expect(radicalDoToken("egressos")).toBe(radicalDoToken("egresso"));
    expect(radicalDoToken("estagios")).toBe(radicalDoToken("estágio"));
  });

  test("palavras vazias com ou sem acento", () => {
    expect(termos("são paulo")).toEqual(termos("sao paulo"));
    expect(radicais("carga horária até o fim")).toEqual(radicais("carga horaria ate o fim"));
  });
});
