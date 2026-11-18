/**
 * Testes do pacote: os da raiz (`../../vite.config.ts`, só o bloco `test`; o lint e o fmt continuam os
 * da raiz) e um `globalSetup` que garante o `tmp/kb.sqlite` fresco uma vez, antes dos arquivos de
 * teste (`test/banco-fresco.ts`).
 */
import "vite-plus/test/config";
import { defineConfig } from "vite-plus";
import raiz from "../../vite.config.ts";

export default defineConfig({
  test: { ...raiz.test, globalSetup: ["./test/banco-fresco.ts"] },
});
