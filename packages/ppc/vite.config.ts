/**
 * Testes do pacote: os da raiz (`../../vite.config.ts`, só o bloco `test`; o lint e o fmt continuam os
 * da raiz) e um `globalSetup` que garante o `tmp/kb.sqlite` fresco uma vez, antes dos arquivos de
 * teste (`test/banco-fresco.ts`).
 */
import "vite-plus/test/config";
import { defineConfig } from "vite-plus";
import raiz from "../../vite.config.ts";

const TESTES_BASE = [
  "test/precisao-base.test.ts",
  "test/identificacao-medicao.test.ts",
  "test/revisao-ia-conversa-base.test.ts",
];

export default defineConfig({
  test: {
    globalSetup: ["./test/banco-fresco.ts"],
    projects: [
      {
        extends: true,
        test: {
          ...raiz.test,
          name: "unidade",
          exclude: [...(raiz.test?.exclude ?? []), ...TESTES_BASE],
        },
      },
      {
        extends: true,
        test: {
          ...raiz.test,
          name: "base",
          include: TESTES_BASE,
        },
      },
    ],
  },
});
