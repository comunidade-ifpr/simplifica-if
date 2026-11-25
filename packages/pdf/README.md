# @simplifica-if/pdf

O texto de um PDF em Markdown, para a IA ler um anexo e para a entrada de PPC pelo PDF (`scripts/importar_ppc_pdf.ts`), sobre o [`pdfjs-dist`](https://github.com/mozilla/pdf.js) (Apache-2.0) no build para Node (`legacy/build`), sem canvas, sem rede e sem fontes do sistema. E as três ferramentas do Markdown convertido de PDF, que valem também para os PPCs antigos da base: a limpeza determinística, o diagnóstico do que fica para a revisão com IA e a conferência de que uma correção mudou só a forma (`scripts/conversao_ppc.ts`).

```ts
import { pdfParaMarkdown } from "@simplifica-if/pdf/markdown";
import { ErroPdf, mensagemErroPdf } from "@simplifica-if/pdf/erro";

const markdown = await pdfParaMarkdown(bytes); // rejeita com ErroPdf
const limitado = await pdfParaMarkdown(bytes, { paginas: 100, caracteres: 1_000_000 });
const semMarcadores = await pdfParaMarkdown(bytes, { marcadoresDePagina: false }); // para a base
```

## O Markdown

```markdown
<!-- página 1 -->

RESOLUÇÃO CNE/CP Nº 2, DE 11 DE NOVEMBRO DE 2026

Art. 1º Esta Resolução define as Diretrizes Curriculares Nacionais…

<!-- página 2: sem texto -->

<!-- página 3 -->

…
```

- Cada página começa com `<!-- página N -->`, N a posição da página no arquivo (a partir de 1), não o número impresso nela; a página sem texto sai como `<!-- página N: sem texto -->`. A IA cita a página pelo marcador.
- O texto vem na ordem do `getTextContent` do pdfjs. Os itens viram linhas pelo `hasEOL` e pela mudança de altura, com espaço entre itens afastados.
- **Cabeçalho e rodapé:** a linha na faixa de cima ou de baixo da página (8% da altura) que se repete, com os números trocados, em 3 páginas ou mais (e em ao menos um quarto delas) sai, e o número sozinho nessas faixas (o da página) também.
- **Tabelas** (`tabelas.ts`, sobre `geometria.ts`): os traços horizontais e verticais da página (o `constructPath` da lista de operações, com a matriz corrente; do que só é preenchido, vale o retângulo fino, porque o largo é fundo de célula) formam a grade; a célula sem borda entre ela e a vizinha é mesclada, e o texto dela vai para a de cima à esquerda. A tabela sai em Markdown no lugar dela na página; linha e coluna vazias saem; o título que ocupa sozinho a primeira linha sai da tabela, em negrito. Com `marcadoresDePagina: false`, a tabela que abre a página e tem as colunas da que fechou a anterior continua nela. Tabela sem borda (colunas só por alinhamento) sai linha a linha.
- **Negrito e títulos:** o trecho em fonte negrita (o nome da fonte, guardado com `fontExtraProperties`, tem Bold, Black, Heavy ou Semibold) vai entre `**`. O parágrafo curto (até 150 caracteres), todo em negrito ou em letra 15% maior que a do corpo, que não acaba em pontuação, é título: `##` e mais um `#` por nível da numeração (`2.4.1` → `####`).
- **Parágrafos:** a linha que chega perto da margem direita da página (até 12% da largura do texto) continua na seguinte, salvo quando o espaço entre as duas passa de 1,4 entrelinha (a mediana da página), a seguinte começa com marcador de lista (`•`, `-`, `1)`, `a.`, `iv)`…), uma é toda em negrito e a outra não, ou a de cima é linha de sumário (acaba no número da página). Linha curta fecha o parágrafo. Com `marcadoresDePagina: false`, o parágrafo que chega à margem no fim da página continua no primeiro da página seguinte.
- A palavra partida no fim da linha ("estu-" e "dante", as duas em minúsculas) é juntada sem o hífen; "bem-" seguido de "estar" vira "bemestar", o custo da regra simples.
- O texto não é escapado (um `#` ou `*` do PDF fica como está); `|` dentro de célula vira `\|`. Imagens, anotações e campos de formulário ficam de fora.

## Limpeza, diagnóstico e conferência

- `limparMarkdownConvertido(corpo)` (`limpeza.ts`): passadas em blocos (separados por linha em branco), repetidas até o texto estabilizar (limpar duas vezes dá o mesmo): marcadores das fontes de símbolos (U+F0B7…) viram `- `; cabeçalho e rodapé institucional repetido 3 vezes ou mais sai (também de dentro de tabela), mas não legenda, referência, ato nem frase; número de página solto que segue a sequência; sumário (5 ou mais entradas seguidas); tabela partida pela página (mesmas colunas, cabeçalho vazio ou repetido); títulos sem negrito e no nível da numeração, inclusive a linha numerada sem marcação que continua a numeração do título anterior; parágrafo partido antes de minúscula; espaço antes de pontuação depois de ênfase. Devolve o texto e as contagens por passada.
- `diagnosticarMarkdown(texto, primeiraLinha)` (`diagnostico.ts`): os achados que pedem revisão (`TIPOS_ACHADO`, com a explicação em `EXPLICACOES`), com a linha; `regioesDosAchados` os agrupa em regiões de trabalho.
- `conferirPalavras(antes, depois)` (`conferencia.ts`): compara as palavras como multiconjunto. Palavra `nova` (que não existia) reprova; `repetida` (já existia, agora mais vezes, como no cabeçalho de tabela) e `removida` são listadas; junções ("estu- dante" → "estudante") e separações ("INSTITUTOFEDERAL" → "INSTITUTO FEDERAL") valem. `<br>` não é palavra.

## Erros

`ErroPdf` traz `dados` (`{ motivo, paginas?, limite? }`, serializável por `postMessage`) e a frase para a pessoa em `message` (`mensagemErroPdf(dados)`):

| `motivo` | Quando |
|---|---|
| `nao-e-pdf` | sem a assinatura `%PDF-` no primeiro 1 KB |
| `corrompido` | o pdfjs não acha a estrutura do PDF (`InvalidPDFException`, `FormatError`); outro erro do pdfjs é relançado como está |
| `protegido` | o PDF pede senha para abrir |
| `sem-texto` | nenhuma página tem texto (digitalizado ou vazio) |
| `paginas-demais` | mais páginas que `paginas` (padrão 500) |
| `texto-demais` | Markdown com mais caracteres que `caracteres` (padrão 8 milhões, o orçamento do `@simplifica-if/docx`) |

## O worker do pdfjs e o bundle

O pdfjs é carregado no primeiro uso, por `import()` (3,2 MB de código), com o módulo do worker (`pdf.worker.mjs`) importado junto e posto em `globalThis.pdfjsWorker`: assim o pdfjs roda o "worker" na mesma thread, sem `new Worker` nem o `import()` de `workerSrc`, que num bundle não acharia o arquivo. Os dois `import()` têm caminho literal, e o empacotador com `codeSplitting: false` os põe no mesmo `.mjs`. Quem chama roda a conversão num `Worker` do servidor, com limite de memória e de tempo, como a do `.docx`.

Os avisos do pdfjs ao carregar (não achou o `@napi-rs/canvas`, que o `pnpm-workspace.yaml` deixa de fora porque só serve para desenhar páginas, e não pôde imitar `DOMMatrix` e `Path2D`) são calados; os demais, com `verbosity: ERRORS`.

Importe `@simplifica-if/pdf/markdown` só no bundle do Worker: no bundle do servidor, basta `@simplifica-if/pdf/erro`.

## Testes

`src/testes/sintetico.ts` monta PDFs mínimos à mão (Helvetica com `WinAnsiEncoding`, `xref` calculada; a linha entre `**` em Helvetica-Bold; `cabecalho`, `numerarPaginas` e `tabelas` desenhadas com traços; `protegido: true` acrescenta um `/Encrypt` cuja senha de usuário não é vazia).

```bash
pnpm --filter @simplifica-if/pdf test
```
