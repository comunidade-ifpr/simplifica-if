# @simplifica-if/ppc

Conversão de um PPC em Word (`.docx`) nos artefatos que a skill `revisar-ppc` consome (`PPC.md` normalizado, Markdown bruto, `_dados.json`, matriz curricular, ementário e a figura da representação gráfica) e o normalizador de Markdown de PPCs. É um pacote do workspace para que a skill e o servidor do app importem o mesmo código.

```ts
import { converterPpc, gravarArtefatos } from "@simplifica-if/ppc/conversao-docx/conversao";

const conversao = converterPpc(bytes, "PPC.docx", { agora: new Date() }); // em memória; lança ErroDocx
const artefatos = gravarArtefatos(conversao, "PPC.docx", pastaDeSaida);
```

A leitura do DOCX é do pacote [`@simplifica-if/docx`](../docx/README.md). A arquitetura, as regras do modo `documento` (`src/conversao-docx/regras.ts`), as diferenças em relação à conversão antiga em Python e o diferencial (`scripts/diferencial-docx.ts`) estão no [README da skill](../../.agents/skills/revisar-ppc/README.md#conversão-docx).

```bash
pnpm --filter @simplifica-if/ppc test
node packages/ppc/scripts/diferencial-docx.ts   # precisa de git, uv e diff
```
