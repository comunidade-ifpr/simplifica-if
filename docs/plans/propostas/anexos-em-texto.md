# Anexos em texto para a IA: proposta

Proposta de desenho, 19/11/2026. v1 (`.docx`) em `main`; v2 (PDF, `.odt` e a conversão no começo do turno) pronta, sem commit.

> **Decisões (19/11/2026).** O texto vai para a pasta oculta `.simplifica/textos/` (3.1). O PDF entra na v2, com `pdfjs-dist` (3.3). O `.odt` só entra se não exigir dependência nova; o ZIP e o XML que o `@simplifica-if/docx` já usa bastam, então ele fica na v2 (3.3). Na v2, a IA é avisada do que a pessoa mexeu na pasta desde o último turno (3.2).

**A ideia:** o app garante que a IA consiga ler o que a pessoa anexou. Ao anexar um documento que a IA não lê sozinha, o servidor grava uma versão em texto (Markdown) na pasta da tarefa e avisa a IA de que ela existe. As skills deixam de limitar formato (`entradas[].aceita`); o único filtro passa a ser o de segurança do app (`EXTENSOES_DOCUMENTO`).

## 1. O problema

Hoje o anexo é copiado como veio, e cada IA lê com o que tem. O resultado depende da IA e do computador:

| Formato | Claude (Agent SDK) | ChatGPT (Codex) | Gemini (Antigravity) |
|---|---|---|---|
| `.md`, `.txt`, `.csv`, `.json` | lê | lê | lê |
| `.pdf` com texto | lê (leitura nativa de PDF) | só com um conversor instalado no computador e um comando | lê (a confirmar no `agy acp`) |
| `.docx`, `.odt`, `.rtf` | não lê; tentaria um comando, que pede aprovação | só com um conversor instalado e um comando | a confirmar; provavelmente não |
| `.xlsx`, `.ods`, `.pptx`, `.odp` | não lê | só com um conversor e um comando | a confirmar |
| `.png`, `.jpg` | vê a imagem | vê a imagem (`view_image`) | vê a imagem |

A política de fábrica (`packages/motor/src/politica.ts`) deixa ler arquivo dentro da pasta sem perguntar, mas rodar comando pede aprovação. Para quem não é técnico, um pedido "Rodar `textutil -convert txt …`?" no meio da tarefa é um beco sem saída. No Windows institucional, em geral não há conversor nenhum.

Por isso a skill `verificar-fundamentacao-normativa` aceita só `.md`, `.txt` e `.pdf`. Ela adivinha o que a IA consegue ler e erra para os dois lados: recusa `.docx`, que é o formato em que minutas, pareceres e PPCs circulam no IFPR, e aceita PDF, que o Codex pode não ler.

## 2. A abordagem

1. **Converter no anexo.** O `PastasTrabalho.anexar` copia o arquivo como hoje e, se o formato está na lista de conversão, roda o conversor num `Worker` com limites (o mesmo esquema do `RevisorPpc`: heap de 512 MB e 30 s). O resultado vai para `.simplifica/textos/<nome do anexo>.md`, por exemplo `.simplifica/textos/Minuta (2).docx.md`. Manter a extensão original no nome evita colisão entre `Minuta.docx` e `Minuta.pdf`.
2. **Cabeçalho honesto.** O `.md` começa com uma linha que diz de onde veio e o que pode faltar: "Texto extraído automaticamente de `Minuta (2).docx` em 19/11/2026. Tabelas viram tabelas Markdown; imagens, comentários e alterações excluídas não entram." A IA sabe o limite do que leu e pode avisar a pessoa.
3. **Avisar a IA.** O `pasta.anexar` passa a devolver `texto` (o caminho relativo do `.md`, quando há) em `ArquivoPasta`. A nota que a interface acrescenta ao pedido (`comArquivos`) diz: "Arquivos na pasta: Minuta (2).docx (em texto: `.simplifica/textos/Minuta (2).docx.md`)." É o mesmo canal que já avisa dos anexos, e não exige instruções de sessão próprias do app, que hoje não existem.
4. **Falha não bloqueia.** Se a conversão falhar (arquivo hostil, documento sem texto, limite estourado), o anexo continua lá e a nota diz "sem versão em texto: <motivo>". A IA tenta o original ou pede outro formato, como o parágrafo "Documento" da skill já manda.
5. **Skills sem filtro de formato.** Com a v1 pronta, a `verificar-fundamentacao-normativa` perde o `aceita`, e o parágrafo "Documento" ganha "se houver versão em texto, leia-a".

## 3. Decisões

### 3.1 Onde gravar o texto: pasta oculta (decidido) ou ao lado do original

| | `.simplifica/textos/` (oculta) | Ao lado (`Minuta.docx.md`) |
|---|---|---|
| Painel "Pasta da tarefa" | não aparece; a lista continua sendo o que a pessoa trouxe | aparece duplicado em "Você trouxe" |
| Desfazer | fora, como tudo que começa com `.`; o texto é derivado e se refaz | entra nas cópias de cada turno |
| Busca da IA | `rg` e os globs pulam pastas ocultas: a IA só acha o texto pelo caminho da nota | a IA acha sozinha |
| Abrir pelo app | `arquivoDeTarefaPermitido` recusa caminho com parte oculta: abrir exigiria uma exceção | abre como qualquer documento |

**Decidido: pasta oculta.** A nota no pedido dá o caminho exato, e a pasta da pessoa fica como ela a montou. Mostrar "ver o texto que a IA leu" no painel pode vir depois, com a exceção só para `.simplifica/textos/`.

### 3.2 Quando converter: no anexo (v1) e no começo do turno (v2)

- **v1, no anexo:** cobre o clipe e o arrastar e soltar, no Início, no formulário da tarefa e na conversa.
- **v2, no começo de cada turno:** cobre o que a pessoa pôs na pasta pelo Finder ou pelo Explorador. O retrato da pasta que o Desfazer já faz antes do turno lista os arquivos com tamanho e SHA-256, então converter o que mudou sai quase de graça.

**O aviso da v2 (decidido):** a IA fica sabendo do que **a pessoa** mexeu na pasta desde o último turno, convertido ou não. O critério já existe: o Desfazer separa o que o turno mudou (o retrato `fim.json`) do que mudou depois, fora da conversa. O aviso usa só essa segunda parte:

- **novos:** o nome e, quando houver, o caminho do texto;
- **mudados:** o mesmo, com "texto refeito" quando o app converteu de novo. É o caso que mais importa: a pessoa corrige a minuta no Word e pede "confere de novo", e a IA não pode responder com base no texto antigo;
- **removidos:** só o nome, para a IA não citar o que saiu;
- **muitos de uma vez:** até 10 nomes e "e mais N".

Fica de fora o que a IA mesma escreveu (ela sabe) e o que não mudou (seria ruído a cada turno). **Na implementação:** o aviso é o evento `MudancasPasta` do turno (no contrato, `EventoConversa` = os eventos do motor mais este), gravado logo depois da mensagem; compara com a cópia do último turno que chegou à IA, e só quando ele fechou (se o app caiu no meio, o que a IA fez pareceria da pessoa); converte até 10 documentos por turno (e por até 60 s; o resto sai no turno seguinte). A decisão de converter não vem da janela entre os turnos, mas de um índice em `.simplifica/textos/indice.json` com a impressão do conteúdo de onde cada texto saiu: assim o texto se põe em dia também quando a pessoa muda um arquivo durante o turno, antes do primeiro ou quando um Desfazer volta o conteúdo, e um documento que deixa de converter perde o texto velho (revisão de 19/11/2026). O turno abre antes do preparo (a cópia da pasta e os textos), com a fase `preparando`, como o `starting` do T3 Code: o "Parar" nessa fase interrompe o preparo (e o Worker da conversão em andamento), o turno fecha com o motivo `parado_antes_do_envio` sem a mensagem ter ido à IA, e a cópia dele sai, para o próximo turno comparar a pasta com o último que chegou à IA. O servidor acrescenta o aviso ao pedido que vai para a IA, e a conversa o mostra numa linha discreta na mensagem da pessoa ("📎 1 documento mudou na pasta: Minuta.docx"), como a nota dos anexos já aparece hoje: nada vai para a IA sem a pessoa ver.

### 3.3 Formatos, em ordem

| Etapa | Formatos | Conversor | Custo |
|---|---|---|---|
| v1 | `.docx` | `@simplifica-if/docx`, que já existe, já lê arquivo hostil sob limites e já roda em `Worker` na revisão de PPC | pequeno |
| v1.1 | `.xlsx` | o mesmo pacote OOXML: uma tabela Markdown por planilha | pequeno a médio |
| v2 | `.pdf` com texto | dependência nova, aprovada (`pdfjs-dist`, JavaScript puro, Apache-2.0); PDF digitalizado sem texto sai "sem versão em texto" | médio |
| v2 | `.odt` | leitor ODF novo sobre o `fflate` e o `htmlparser2` que o `docx` já usa, sem dependência nova; se a PoC mostrar que exige uma, sai | médio |
| depois | `.ods`, `.odp` | o mesmo leitor ODF | sob demanda |
| depois | `.pptx`, `.rtf` | sob demanda | — |
| não | imagens, `.md`, `.txt`, `.csv`, `.json` | as três IAs já leem | — |

O PDF entra mesmo com o Claude e o Gemini lendo PDF: o Codex não lê, e a versão em texto deixa o resultado igual nas três IAs.

### 3.4 Onde fica o conversor genérico

A conversão de PPC (`packages/ppc/src/conversao-docx/`) mistura duas camadas:

- **genérica:** `elementos.ts` (parágrafos e tabelas na ordem), `secoes.ts` (títulos pelo estilo do Word), `tabelas.ts`, `markdown.ts` (`escreverMarkdown`) e `orcamento.ts` (limites de texto);
- **de PPC:** matriz, ementário, identificação, representação gráfica e o normalizador de Markdown de PPC.

Recomendo levar a camada genérica para `@simplifica-if/docx` (uma entrada `@simplifica-if/docx/markdown`, com `docxParaMarkdown(bytes)`) e deixar o `packages/ppc` importando de lá. O README do `docx` já diz que ele "não sabe o que é um PPC", e esses módulos também não sabem. Os gabaritos byte a byte de `packages/ppc/test/fixtures/conversao-docx/` conferem que a mudança não altera a saída do PPC.

**Na implementação (19/11/2026):** `secoes.ts` fica no `ppc`, e o `docxParaMarkdown` não passa por ele. `detectarSecoes` descarta o que vem antes do primeiro título (pensado para a capa do PPC), e numa minuta isso é a ementa e o "RESOLVE:". A conversão genérica escreve todos os elementos em sequência, com os títulos como `##`.

### 3.5 Fidelidade do `.docx`

O que o leitor já faz e o que falta para minutas e pareceres:

- **já entra:** texto, títulos, tabelas (com mesclas), caixas de texto (`textosDeCaixas`) e as inserções das alterações controladas;
- **fica de fora, como deve:** o texto excluído com alterações controladas (o cabeçalho do `.md` diz isso);
- **falta e importa:** **notas de rodapé e de fim**, onde minutas e pareceres costumam pôr a fundamentação. Proponho entrar na v1 como `[^n]` do Markdown;
- **falta e pode esperar:** comentários do Word (a revisão de PPC escreve comentários, não lê), cabeçalho e rodapé de página, imagens.

## 4. Segurança e privacidade

- Nada sai do computador: a conversão roda no servidor local, e o texto fica na pasta da tarefa, onde o original já está.
- A entrada hostil já é tratada pelo leitor (`LIMITES_PADRAO`: ZIP, razão de compressão, profundidade do XML, células), e o `Worker` tem teto de memória e tempo. O mesmo vale para o conversor de PDF, se entrar.
- Injeção de instruções no documento não é um risco novo: o texto é o mesmo que a IA leria no original.
- O tamanho do `.md` fica limitado pelo orçamento de texto da conversão. Um documento grande demais sai "sem versão em texto", com o motivo.

## 5. Contratos e código tocados (v1)

- `@simplifica-if/docx`: `docxParaMarkdown` e as notas de rodapé no leitor, com os casos hostis e sintéticos.
- `packages/ppc`: importa a camada genérica do `docx`; os gabaritos byte a byte continuam iguais.
- `apps/server`: um serviço `TextosAnexos` (`converter(arquivo, nome)`, que só converte), chamado pelo `PastasTrabalho.anexar`, que grava o texto na pasta oculta sem seguir link; o Worker com teto de memória e tempo sai do `RevisorPpc` para `WorkerLimitado.ts`, usado pelos dois.
- `@simplifica-if/contratos-app`: `ArquivoPasta.texto?: string`, mais o motivo quando não há texto.
- `apps/web`: `comArquivos` recebe os anexos com `texto` e escreve a nota; o Início e o formulário da tarefa passam a usar o nome devolvido pelo servidor, como a conversa já usa.
- Skill `verificar-fundamentacao-normativa`: sai o `aceita`, e "Documento" ganha a versão em texto (versão nova da skill).

## 6. Critérios de aceite (v1)

- Um `.docx` anexado no Início, no formulário da tarefa e na conversa gera `.simplifica/textos/<nome>.md`, e o pedido enviado à IA traz o caminho.
- Com o Claude e com o Codex, a skill `verificar-fundamentacao-normativa` confere uma minuta em `.docx` sem nenhum pedido de aprovação de comando. Teste real, fora do CI, como os `*-real.test.ts`.
- Um `.docx` hostil, vazio ou só com imagem gera o anexo sem texto, com o motivo na nota; o anexo não falha.
- As notas de rodapé de uma minuta sintética aparecem no `.md`.
- Os gabaritos de conversão do PPC não mudam.

## 7. Perguntas

Respondidas em 19/11/2026 (ver "Decisões", no topo):

1. ~~Pasta oculta ou ao lado do original?~~ Pasta oculta.
2. ~~O PDF entra na v2?~~ Sim, com `pdfjs-dist`.
3. ~~ODF importa?~~ Só sem dependência nova; o `.odt` fica na v2 nessa condição.
4. ~~Na v2, avisar a IA de cada documento novo ou só dos convertidos?~~ Do que a pessoa mexeu na pasta desde o último turno: novos, mudados e removidos, convertidos ou não (3.2).
