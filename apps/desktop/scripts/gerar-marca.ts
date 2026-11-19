// @effect-diagnostics nodeBuiltinImport:off -- script de geração da marca, sem runtime Effect
/**
 * Gera a marca do Simplifica IF a partir das cenas de `marca/cena.ts`, sem dependências:
 *
 * - `apps/desktop/recursos/icone.icns` e `icone.ico`: o ícone do app (relevo de 48 px para cima, plano
 *   até 32 px; no Windows, a placa quase sangrada e sem sombra externa);
 * - `apps/web/public/favicon.svg` e `apps/web/src/marca/logo-sobre-verde.svg` (o cabeçalho da interface);
 * - `docs/marca/`: o logo claro e o escuro e o ícone em SVG, para materiais.
 *
 *   node scripts/gerar-marca.ts             # grava
 *   node scripts/gerar-marca.ts --conferir  # só confere que os arquivos estão em dia (sai com 1 se não)
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { cenaIcone, cenaLogo, type OpcoesIcone, paraSvg } from "./marca/cena.ts";
import { icns, ico, TIPOS_ICNS } from "./marca/pacotes.ts";
import { type Bitmap, rasterizar } from "./marca/raster.ts";

const RAIZ = NodePath.resolve(import.meta.dirname, "..", "..", "..");

/** Até 32 px, o desenho plano; daí para cima, o com relevo. */
const estiloPara = (lado: number): OpcoesIcone["estilo"] => (lado <= 32 ? "plano" : "relevo");

function bitmaps(plataforma: OpcoesIcone["plataforma"], lados: ReadonlyArray<number>): Bitmap[] {
  const cenas = {
    plano: cenaIcone({ plataforma, estilo: "plano" }),
    relevo: cenaIcone({ plataforma, estilo: "relevo" }),
  };
  return [...new Set(lados)].map((lado) => rasterizar(cenas[estiloPara(lado)], lado));
}

export function arquivosDaMarca(): ReadonlyArray<readonly [string, () => string | Buffer]> {
  return [
    ["docs/marca/logo.svg", () => paraSvg(cenaLogo("claro"))],
    ["docs/marca/logo-escuro.svg", () => paraSvg(cenaLogo("escuro"))],
    ["docs/marca/icone.svg", () => paraSvg(cenaIcone({ plataforma: "mac", estilo: "relevo" }))],
    ["docs/marca/icone-plano.svg", () => paraSvg(cenaIcone({ plataforma: "windows", estilo: "plano" }))],
    ["apps/web/src/marca/logo-sobre-verde.svg", () => paraSvg(cenaLogo("sobre-verde"))],
    ["apps/web/public/favicon.svg", () => paraSvg(cenaIcone({ plataforma: "windows", estilo: "plano" }))],
    [
      "apps/desktop/recursos/icone.icns",
      () =>
        icns(
          bitmaps(
            "mac",
            TIPOS_ICNS.map(([, lado]) => lado),
          ),
        ),
    ],
    ["apps/desktop/recursos/icone.ico", () => ico(bitmaps("windows", [16, 20, 24, 32, 40, 48, 64, 128, 256]))],
  ];
}

if (import.meta.main) {
  const conferir = process.argv.includes("--conferir");
  const desatualizados: string[] = [];
  for (const [relativo, gerar] of arquivosDaMarca()) {
    const destino = NodePath.join(RAIZ, relativo);
    const conteudo = gerar();
    const bytes = typeof conteudo === "string" ? Buffer.from(conteudo, "utf-8") : conteudo;
    if (conferir) {
      if (!NodeFS.existsSync(destino) || !NodeFS.readFileSync(destino).equals(bytes)) desatualizados.push(relativo);
      continue;
    }
    NodeFS.mkdirSync(NodePath.dirname(destino), { recursive: true });
    NodeFS.writeFileSync(destino, bytes);
    process.stderr.write(`${relativo}\n`);
  }
  if (desatualizados.length > 0) {
    process.stderr.write(
      `marca desatualizada (rode node apps/desktop/scripts/gerar-marca.ts):\n${desatualizados.join("\n")}\n`,
    );
    process.exitCode = 1;
  }
}
