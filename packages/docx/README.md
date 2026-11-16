# @simplifica-if/docx

Leitor de arquivos `.docx` (OOXML) em TypeScript, sem Word, Python ou binário nativo: `fflate` para o ZIP e `htmlparser2` para o XML. Não sabe o que é um PPC; a conversão do PPC fica em [`@simplifica-if/ppc`](../ppc/README.md).

```ts
import { lerDocx } from "@simplifica-if/docx/leitor";

const documento = lerDocx(bytes); // blocos (parágrafos e tabelas) e propriedades
```

| Módulo | Papel |
|---|---|
| `pacote.ts` | O ZIP do DOCX: diretório central, partes descompactadas sob demanda e sob limites (`LIMITES_PADRAO`), relações. |
| `xml.ts` | XML em árvore, com nomes canônicos pela URI do namespace; recusa XML malformado e aninhamento de mais de 256 níveis. |
| `leitor.ts`, `modelo.ts` | Modelo intermediário do documento e os dois modos de leitura (`Fidelidade`). |
| `erro.ts` | `ErroDocx`: todo arquivo recusado sai com ele, com mensagem em português. |
| `testes/sintetico.ts` | Construtor de DOCX sintéticos para testes (não é usado em produção). |

O arquivo vem do usuário e pode ser hostil. Os limites e as recusas estão descritos no README da skill `revisar-ppc` ("Arquivo hostil ou quebrado") e cobertos por `test/leitor.test.ts`. A leitura é síncrona e mantém a árvore do XML na memória: num servidor, rode-a num `Worker` com limite de memória e de tempo.

```bash
pnpm --filter @simplifica-if/docx test
```
