/** A identidade e os alvos do instalador (sem empacotar: isso é o `pnpm --filter @simplifica-if/desktop dist`). */
import { describe, expect, test } from "vite-plus/test";
import { EXTERNOS_SERVIDOR } from "../scripts/construir.ts";
import { configuracaoBuilder } from "../scripts/empacotar.ts";

describe("configuração do electron-builder", () => {
  test("nome, identificador e instaladores sem assinatura", () => {
    const config = configuracaoBuilder({ dir: false });
    expect(config.appId).toBe("br.edu.ifpr.simplifica");
    expect(config.productName).toBe("Simplifica IF");
    expect(config.electronVersion).toBe("44.10.1");
    expect(config.mac).toMatchObject({ target: ["dmg", "zip"], identity: null });
    expect(config.win).toMatchObject({ target: [{ target: "nsis", arch: ["x64"] }] });
    expect(config.nsis).toMatchObject({ oneClick: true, perMachine: false });
    expect(config.publish).toBeNull();
    expect(configuracaoBuilder({ dir: true }).mac).toMatchObject({ target: ["dir"] });
  });

  test("o servidor e a base vão fora do asar", () => {
    const destinos = (configuracaoBuilder({ dir: true }).extraResources as Array<{ to: string }>).map((r) => r.to);
    expect(destinos).toEqual(["servidor", "base"]);
  });

  test("os opcionais nativos do ws ficam fora do bundle do servidor", () => {
    expect(EXTERNOS_SERVIDOR).toEqual(expect.arrayContaining(["bufferutil", "utf-8-validate"]));
  });
});
