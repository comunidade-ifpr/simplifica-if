import "vite-plus/test/config";
import { defineConfig } from "vite-plus";
import raiz from "../../vite.config.ts";

export default defineConfig({
  test: { ...raiz.test, globalSetup: ["./test/transversal/preparar-bundle.ts"] },
});
