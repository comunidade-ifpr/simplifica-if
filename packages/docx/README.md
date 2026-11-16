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

## Limites

O arquivo vem do usuário e pode ser hostil. Todos os limites de leitura ficam em `src/limites.ts` (`LIMITES_PADRAO`) e podem ser trocados por quem abre o arquivo: `lerDocx(bytes, { limites: { bytesDoArquivo: … } })` ou `new PacoteOoxml(bytes, limites)`. O que passa de um limite sai com `ErroDocx`, com mensagem em português.

| Campo | Padrão | O que limita |
|---|---:|---|
| `bytesDoArquivo` | 20 MB | o arquivo `.docx`; a mensagem sugere compactar as imagens no Word |
| `bytesPorParte` | 25 MB | uma parte do ZIP, descompactada (vale para a saída real, não para o tamanho declarado) |
| `bytesNoTotal` | 60 MB | a soma das partes lidas (só o que é pedido é descompactado) |
| `razaoDeCompressao` | 200 | descompactado ÷ compactado, nas partes de mais de 10 MB, conferida a cada pedaço |
| `entradas` | 10.000 | entradas no ZIP |
| `elementosPorParte` | 500.000 | elementos numa parte XML |
| `profundidadeDoXml` | 256 | níveis de aninhamento do XML |
| `celulasPorLinha` | 1.024 | células numa linha de tabela |
| `posicoesPorTabela` | 2.000.000 | células vezes colunas ocupadas, por tabela |

Os padrões folgam sobre os PPCs reais conferidos em 16/11/2026 (arquivos de 0,7 a 7,3 MB; `document.xml` de até 4,5 MB e 104 mil elementos). O pior caso honesto dentro deles (486 mil elementos, `document.xml` de 14 a 25 MB) leva 1,5 s e cerca de 690 MB de memória residente, e roda com o heap limitado a 512 MB.

A leitura é síncrona e mantém a árvore do XML na memória. Num servidor, rode-a num `Worker`:

- `resourceLimits: { maxOldGenerationSizeMb: 512 }`: basta para o pior caso honesto, e o estouro encerra só o `Worker`;
- tempo máximo de 30 s, com `worker.terminate()` no estouro: vinte vezes o pior caso honesto, e a defesa contra a entrada patológica que os limites não preveem;
- conferência do tamanho do arquivo antes de lê-lo (`bytesDoArquivo`).

Os casos hostis estão em `test/leitor.test.ts`; os limites de texto do PPC (orçamento por documento), no pacote `@simplifica-if/ppc`.

```bash
pnpm --filter @simplifica-if/docx test
```
