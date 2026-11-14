/**
 * Conta os casos de teste por arquivo a partir de relatórios JUnit (do `bun test` ou do vitest) e
 * imprime `arquivo<TAB>casos<TAB>pulados`, em ordem, com o total no fim. É o formato de
 * `testes-gabarito/testes.txt`.
 *
 *   node testes-gabarito/contar_testes.ts packages/kb=/tmp/kb.xml scripts=/tmp/raiz.xml …
 *
 * Cada argumento é `prefixo=relatório`: o prefixo é o diretório de onde o executor rodou, para que o
 * caminho do arquivo saia relativo à raiz do repositório (`.` quando já é). O arquivo de cada caso é
 * o nome da `testsuite` de primeiro nível, que nos dois executores é o caminho do arquivo de teste.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const contagens = new Map<string, { casos: number; pulados: number }>();

for (const argumento of process.argv.slice(2)) {
  const [prefixo, relatorio] = argumento.split("=") as [string, string];
  const xml = readFileSync(relatorio, "utf8");
  let profundidade = 0;
  let arquivo = "";
  let casoAberto = false;
  for (const marca of xml.matchAll(/<(\/?)(testsuite|testcase|skipped)\b([^>]*?)(\/?)>/g)) {
    const [, fecha, nome, atributos = "", autoFechada] = marca;
    if (nome === "testsuite") {
      if (fecha) profundidade--;
      else {
        profundidade++;
        if (profundidade === 1) {
          const nomeSuite = /\bname="([^"]*)"/.exec(atributos)?.[1] ?? "";
          arquivo = path.posix.normalize(path.posix.join(prefixo, nomeSuite));
          if (!contagens.has(arquivo)) contagens.set(arquivo, { casos: 0, pulados: 0 });
        }
      }
    } else if (nome === "testcase") {
      if (fecha) casoAberto = false;
      else {
        contagens.get(arquivo)!.casos++;
        casoAberto = !autoFechada;
      }
    } else if (nome === "skipped" && !fecha && casoAberto) {
      contagens.get(arquivo)!.pulados++;
    }
  }
}

let casos = 0;
let pulados = 0;
const linhas = [...contagens.entries()]
  .filter(([, c]) => c.casos > 0)
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([arquivo, c]) => {
    casos += c.casos;
    pulados += c.pulados;
    return `${arquivo}\t${c.casos}\t${c.pulados}`;
  });
process.stdout.write(`${linhas.join("\n")}\nTOTAL\t${casos}\t${pulados}\n`);
