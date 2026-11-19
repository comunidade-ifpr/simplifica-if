# @simplifica-if/docx

Leitor de arquivos `.docx` (OOXML) e `.odt` (OpenDocument Text) em TypeScript, sem Word, LibreOffice nem binário nativo: `fflate` para o ZIP e `htmlparser2` para o XML, e a conversão de um `.docx` ou `.odt` qualquer em Markdown. Não sabe o que é um PPC; a conversão do PPC (seções, matriz, ementário, normalizador) fica em [`@simplifica-if/ppc`](../ppc/README.md), sobre a camada de texto daqui.

```ts
import { lerDocx } from "@simplifica-if/docx/leitor";
import { docxParaMarkdown } from "@simplifica-if/docx/markdown";
import { odtParaMarkdown } from "@simplifica-if/docx/odt";

const documento = lerDocx(bytes); // blocos (parágrafos e tabelas) e propriedades
const comNotas = lerDocx(bytes, { notas: true }); // + notas de rodapé e de fim, e a referência marcada no texto
const markdown = docxParaMarkdown(bytes); // o texto em Markdown, para a IA ler; lança ErroDocx
const doOdt = odtParaMarkdown(bytes); // o mesmo para um .odt; lança ErroDocx com formato "ODT"
```

`docxParaMarkdown` escreve todos os elementos em sequência, sem detectar seções (o que vem antes do primeiro título, como a ementa e o "RESOLVE:" de uma minuta, fica): títulos do Word viram `##` em diante, tabelas viram tabelas Markdown, listas e links como na conversão do PPC, e cada parágrafo do Word é um parágrafo do Markdown. As notas de rodapé saem como `[^1]`, `[^2]`… e as de fim como `[^fim-1]`, `[^fim-2]`…, cada série numerada na ordem em que a referência aparece no texto, com as definições no fim (as de rodapé antes das de fim); referência a nota inexistente sai do texto. O texto das caixas de texto vai para uma seção "Caixas de texto" no fim; as figuras ficam de fora. Os limites do pacote e o orçamento de texto valem como na conversão do PPC (`limites`, `limitesDeTexto`), e o documento sem texto sai com o motivo `sem-texto`.

`odtParaMarkdown` lê o `.odt` com o mesmo ZIP (`PacoteZip`) e os mesmos limites, converte o `content.xml` nos mesmos elementos e escreve com o mesmo `Escritor` (`documentoEmMarkdown`), então a saída tem o mesmo estilo. Entram os títulos (`text:h`, pelo nível de estrutura, e o parágrafo de estilo "Title"), os parágrafos, as listas (nível pelo aninhamento; numerada ou com marcadores pelo estilo da lista), as tabelas (com as mesclas: a célula coberta repete a de origem, como no DOCX), os links `http`, `https` e `mailto`, negrito, itálico e tachado dos estilos (com herança), os espaços de `text:s`, as tabulações, as quebras de linha e as notas de rodapé e de fim; o texto dos quadros e formas (`draw:frame` com `draw:text-box`) vai para "Caixas de texto", no fim. Ficam de fora as imagens, os comentários, o texto excluído com o controle de alterações e os modelos de índice, e não há título reconhecido pela formatação. O pacote precisa declarar o tipo `application/vnd.oasis.opendocument.text` (no `mimetype` ou, sem ele, no manifesto); outro tipo sai com `nao-e-odt`, e o documento com senha (`manifest:encryption-data`), com `protegido`. Os erros saem com `formato: "ODT"`, e a frase diz "ODT" no lugar de "DOCX".

| Módulo | Papel |
|---|---|
| `zip.ts` | `PacoteZip`, o ZIP do DOCX e do ODT: diretório central, partes descompactadas sob demanda e sob limites (`LIMITES_PADRAO`), XML de uma parte. |
| `pacote.ts` | `PacoteOoxml`, o pacote do DOCX: o `PacoteZip` com as relações entre as partes. |
| `xml.ts` | XML em árvore, com nomes canônicos pela URI do namespace (OOXML e OpenDocument); recusa XML malformado e aninhamento de mais de 256 níveis. |
| `leitor.ts`, `modelo.ts` | Modelo intermediário do documento e a leitura do texto que o Word mostra; `textosDeCaixas`, o texto das caixas de texto e formas, onde o comentário do Word não ancora. Com `notas: true`, as notas de rodapé e de fim (sem as de separador) e a referência marcada no texto com dois não caracteres do Unicode (`marcaDeNota`), que valem também dentro da célula de tabela. |
| `elementos.ts` | Do modelo aos elementos do texto: título (pelo estilo do Word ou pela formatação, como num documento digitado sem estilos), parágrafo com trechos formatados, item de lista, tabela em grade (com as mesclas) e figura. |
| `tabelas.ts` | Tabela em grade regular (mesclas expandidas, com teto de células e de texto) e a tabela pipe do Markdown. |
| `orcamento.ts` | Orçamento de texto do documento (`LIMITES_DE_TEXTO`): caracteres no documento, por bloco e sequência sem letra nem dígito. |
| `markdown.ts` | O `Escritor` (trechos, links só `http`, `https` e `mailto`, listas, títulos e tabelas), que a conversão do PPC usa por seções; `documentoEmMarkdown` (corpo, caixas de texto e notas, sob o orçamento de texto) e `docxParaMarkdown`. |
| `odt.ts` | `odtParaMarkdown`: o `.odt` nos elementos de `elementos.ts` (estilos de texto e de lista, tabelas com mesclas, notas, quadros), escrito por `documentoEmMarkdown`. |
| `erro.ts` | `ErroDocx`: todo arquivo recusado sai com ele, com um `motivo` tipado e os atributos (`dados`: parte, limite, tamanho); a mensagem em português é montada deles (`mensagemErroDocx`), e o Worker da revisão transporta os `dados`, não a frase. |
| `testes/sintetico.ts` | Construtor de DOCX sintéticos para testes (não é usado em produção): tabelas com `w:tblGrid` e parágrafo final, caixa de texto como o Word grava (`caixaDeTexto`), relações de hiperlink (`linkExterno`). `montarDocx` confere cada pacote com o validador abaixo e lança se o Word o recusaria (`validar: false` para o documento quebrado de propósito). |
| `testes/sintetico-odt.ts` | Construtor de ODT sintéticos para testes (`montarOdt`), com `mimetype` sem compressão na frente, manifesto e estilos de texto e de lista prontos. |
| `testes/validar-ooxml.ts` | Validador estrutural para testes (`problemasOoxml`): as regras que, violadas, fazem o Word recusar o arquivo e que os leitores tolerantes deixam passar (referência a relação inexistente, corpo ou célula que termina em tabela, grade da tabela, namespaces e `mc:Ignorable`, tipos de conteúdo, ids de comentário e de desenho). Roda em todo sintético e em toda saída de `comentarDocx` e `revisarDocx` nos testes. |

## Limites

O arquivo vem do usuário e pode ser hostil. Todos os limites de leitura ficam em `src/limites.ts` (`LIMITES_PADRAO`), valem para o `.docx` e para o `.odt`, e podem ser trocados por quem abre o arquivo: `lerDocx(bytes, { limites: { bytesDoArquivo: … } })`, `odtParaMarkdown(bytes, { limites })` ou `new PacoteOoxml(bytes, limites)`. O que passa de um limite sai com `ErroDocx`, com mensagem em português.

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

Os casos hostis estão em `test/leitor.test.ts` (e repetidos para `docxParaMarkdown` em `test/markdown.test.ts` e para `odtParaMarkdown` em `test/odt.test.ts`, com as contagens do ODF: `text:c`, `table:number-columns-repeated` e `table:number-rows-repeated`). O orçamento de texto por documento fica em `src/orcamento.ts` e vale para a conversão em Markdown (a do PPC, `docxParaMarkdown` e `odtParaMarkdown`):

| Campo | Padrão | O que limita |
|---|---:|---|
| `caracteresNoDocumento` | 8.000.000 | o texto das tabelas expandidas (a mescla repete a célula) e o Markdown gerado |
| `caracteresPorBloco` | 50.000 | um parágrafo, título ou célula |
| `sequenciaSemTexto` | 1.000 | caracteres seguidos sem letra nem dígito |

```bash
pnpm --filter @simplifica-if/docx test
```
