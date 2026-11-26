// @effect-diagnostics nodeBuiltinImport:off -- teste: a cópia comentada em arquivos de verdade, numa pasta temporária
/**
 * O nome da cópia comentada, com o carimbo fixo (o teste de ponta a ponta usa o relógio real e só
 * cai no mesmo minuto por acaso): cada revisão tem a sua cópia, a cópia nova só vai para um nome livre e
 * sem registro, e a regravação da própria revisão nunca passa por cima da cópia de outra.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { afterAll, assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as CopiasComentadas from "../../../src/modulos/revisao-ppc/persistencia/CopiasComentadas.ts";
import { carimboDaCopia, gravarCopia, semNumero } from "../../../src/modulos/revisao-ppc/RevisorPpc.ts";
import * as Banco from "../../../src/persistencia/Banco.ts";
import { diretorioTemporario, limparTemporarios } from "../../apoio.ts";

afterAll(limparTemporarios);

const camada = CopiasComentadas.layer.pipe(Layer.provide(Banco.layerMemoria));
const CARIMBO = "2026-11-26 12h55";
const bytes = (texto: string) => new TextEncoder().encode(texto);
const ler = (caminho: string) => NodeFS.readFileSync(caminho, "utf8");

describe("o nome da cópia comentada", () => {
  it("a data e a hora no fuso do instante, com zero à esquerda", () => {
    const sp = DateTime.zoneMakeNamedUnsafe("America/Sao_Paulo");
    assert.strictEqual(
      carimboDaCopia(DateTime.makeZonedUnsafe("2026-11-26T15:05:00Z", { timeZone: sp })),
      CARIMBO.replace("55", "05"),
    );
    // Às 23h30 de Brasília, já é o dia seguinte em UTC: vale o dia local.
    assert.strictEqual(
      carimboDaCopia(DateTime.makeZonedUnsafe("2026-03-02T02:30:00Z", { timeZone: sp })),
      "2026-03-01 23h30",
    );
  });

  it("a sequência parte do nome sem o ` (n)` do fim, e só dele", () => {
    assert.strictEqual(
      semNumero(`PPC - revisão prévia (Simplifica IF) ${CARIMBO} (2).docx`),
      `PPC - revisão prévia (Simplifica IF) ${CARIMBO}.docx`,
    );
    assert.strictEqual(
      semNumero(`PPC (2) final - revisão prévia (Simplifica IF) ${CARIMBO}.docx`),
      `PPC (2) final - revisão prévia (Simplifica IF) ${CARIMBO}.docx`,
    );
    assert.strictEqual(semNumero("PPC (100).docx"), "PPC (100).docx");
  });
});

describe("gravarCopia", () => {
  it.effect("cada revisão tem a sua; a regravação não passa por cima da cópia de outra revisão", () =>
    Effect.gen(function* () {
      const pasta = diretorioTemporario("simplifica-copia-");
      const original = NodePath.join(pasta, "PPC.docx");
      NodeFS.writeFileSync(original, "original");
      const nome = (sufixo = "") =>
        NodePath.join(pasta, `PPC - revisão prévia (Simplifica IF) ${CARIMBO}${sufixo}.docx`);

      // Duas revisões no mesmo minuto: a segunda vai para " (2)", e a primeira fica.
      const a = yield* gravarCopia(original, bytes("a"), undefined, CARIMBO);
      const b = yield* gravarCopia(original, bytes("b"), undefined, CARIMBO);
      assert.strictEqual(a, nome());
      assert.strictEqual(b, nome(" (2)"));
      assert.strictEqual(ler(a), "a");

      // A regravação de B vai por cima da cópia de B, que ainda é a que o app gravou.
      assert.strictEqual(yield* gravarCopia(original, bytes("b2"), b, CARIMBO), b);
      assert.strictEqual(ler(b), "b2");

      // A pessoa edita a cópia de B: a regravação vai para o próximo nome livre, não para a de A.
      NodeFS.writeFileSync(b, "minhas anotações");
      const b3 = yield* gravarCopia(original, bytes("b3"), b, CARIMBO);
      assert.strictEqual(b3, nome(" (3)"));
      assert.strictEqual(ler(b), "minhas anotações");
      assert.strictEqual(ler(a), "a");

      // A pessoa apaga a cópia de A, mas a lista de A ainda aponta para ela: nem uma revisão nova nem uma
      // regravação de outra revisão ocupam esse nome; só a própria A.
      NodeFS.rmSync(a);
      const c = yield* gravarCopia(original, bytes("c"), undefined, CARIMBO);
      assert.strictEqual(c, nome(" (4)"));
      NodeFS.writeFileSync(b3, "anotações de novo");
      const b5 = yield* gravarCopia(original, bytes("b5"), b3, CARIMBO);
      assert.strictEqual(b5, nome(" (5)"));
      assert.isFalse(NodeFS.existsSync(a));
      assert.strictEqual(yield* gravarCopia(original, bytes("a2"), a, CARIMBO), a);
      assert.strictEqual(ler(a), "a2");
      assert.strictEqual(ler(original), "original");
    }).pipe(Effect.provide(camada)),
  );
});
