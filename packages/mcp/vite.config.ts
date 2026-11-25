import "vite-plus/test/config";
import { defineConfig } from "vite-plus";
import raiz from "../../vite.config.ts";

const { include: _include, ...base } = raiz.test ?? {};

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          ...base,
          name: "unidade",
          include: ["test/*.test.ts"],
        },
      },
      {
        test: {
          ...base,
          name: "transversal",
          include: ["test/transversal/*.test.ts"],
          globalSetup: ["./test/transversal/preparar-bundle.ts"],
        },
      },
    ],
  },
});
