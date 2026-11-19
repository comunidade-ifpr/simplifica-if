# @simplifica-if/pdf

O texto de um PDF em Markdown, para a IA ler, sobre o [`pdfjs-dist`](https://github.com/mozilla/pdf.js) (Apache-2.0) no build para Node (`legacy/build`), sem canvas, sem rede e sem fontes do sistema.

```ts
import { pdfParaMarkdown } from "@simplifica-if/pdf/markdown";
import { ErroPdf, mensagemErroPdf } from "@simplifica-if/pdf/erro";

const markdown = await pdfParaMarkdown(bytes); // rejeita com ErroPdf
const limitado = await pdfParaMarkdown(bytes, { paginas: 100, caracteres: 1_000_000 });
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
- As linhas viram parágrafos: a linha que chega perto da margem direita da página (até 12% da largura do texto) continua na seguinte, salvo quando o espaço entre as duas passa de 1,4 entrelinha (a mediana da página) ou a seguinte começa com marcador de lista (`•`, `-`, `1)`, `a.`, `iv)`…). Linha curta fecha o parágrafo.
- A palavra partida no fim da linha ("estu-" e "dante", as duas em minúsculas) é juntada sem o hífen; "bem-" seguido de "estar" vira "bemestar", o custo da regra simples.
- O texto não é escapado (um `#` ou `*` do PDF fica como está). Tabelas e colunas saem na ordem do pdfjs, linha a linha; imagens, anotações e campos de formulário ficam de fora.

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

`src/testes/sintetico.ts` monta PDFs mínimos à mão (Helvetica com `WinAnsiEncoding`, `xref` calculada; `protegido: true` acrescenta um `/Encrypt` cuja senha de usuário não é vazia).

```bash
pnpm --filter @simplifica-if/pdf test
```
