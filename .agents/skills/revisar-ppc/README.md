# Revisão de PPC

Esta skill revisa Projetos Pedagógicos de Curso técnico do IFPR antes da submissão à PROENS, a partir de um arquivo Word (`.docx`) ou Markdown (`.md`). É uma revisão prévia: o produto é um relatório de revisão (o PPC HTML anotado), não um parecer, e não substitui a análise oficial da PROENS. A IA roda por sub-agentes na conversa atual; os scripts preparam o `PPC.md`, organizam as fichas e geram o relatório.

A skill se chamava `analise-ppc` até 13/11/2026; o nome mudou para deixar claro que ela não é o ato oficial (veja o `PLANO-ARQUITETURA.md`, seção Andamento). Ela faz par com a `revisar-processo-ppc`, que revisa o processo SEI.

## Formato aceito

Forneça o PPC em Word ou Markdown:

- Aceito: `.docx`
- Aceito: `.md`
- Não aceito diretamente: `.pdf`

Se o PPC estiver em PDF, converta ou solicite a versão original em Word antes de iniciar a revisão.

## Como pedir para a IA usar a skill

Depois de instalar a skill no projeto, peça ao agente algo neste formato:

```text
Use a skill revisar-ppc para revisar o PPC em /caminho/para/PPC.docx
```

Ou, se estiver usando um caminho relativo ao projeto:

```text
Use a skill revisar-ppc para revisar o PPC em documentos/PPC_Curso_Tecnico.docx
```

Ao final, a IA deve informar um link para abrir o relatório e a situação da revisão:

```text
Relatório de revisão pronto (Ajustes necessários): [abrir relatório](https://revisar-ppc-<rodada>.surge.sh)
```

## Situação da revisão

O relatório classifica o PPC numa de quatro situações de revisão prévia, pela criticidade e pelo estado das fichas e pelos alertas transversais da síntese:

| Situação | Rótulo no relatório | Quando |
|---|---|---|
| `REVISAO_SUBSTANCIAL` | Revisão substancial necessária | alguma ficha `BLOQ` com `NAO_ATENDE` ou algum alerta transversal `BLOQ` |
| `AJUSTES_NECESSARIOS` | Ajustes necessários | alguma ficha `OBRIG` com `NAO_ATENDE` ou algum alerta transversal `OBRIG` |
| `APTO_COM_RESSALVAS` | Apto com ressalvas | alguma ficha `INCONCLUSIVO`, ou ficha ou alerta transversal com revisão humana obrigatória |
| `APTO_PARA_SUBMISSAO` | Apto para submissão | nenhum dos casos acima |

Um alerta transversal é um problema encontrado, por isso pesa como uma ficha `NAO_ATENDE` da mesma criticidade; o alerta `REC`, como a ficha `REC` não atendida, só pesa se pedir revisão humana.

São indicações para quem vai submeter o PPC, não aprovação, diligência ou reprovação: essas decisões são da PROENS. A regra está em `situacao` (`scripts/resultados.ts`); `config/politica_revisao.json` lista as mesmas situações, com limiares por contagem que o código ainda não usa.

## Onde ficam os resultados

Cada revisão cria uma rodada em:

```text
.agents/skills/revisar-ppc/output/<rodada>/
```

Dentro da rodada:

- `relatorio-revisao.html` é o relatório de revisão (PPC anotado) que deve ser aberto.
- `assets/` guarda CSS e JavaScript do leitor anotado.
- `arquivos-suporte/` guarda os arquivos usados para produzir o relatório.

Ao gerar o relatório, a skill publica no Surge por padrão e retorna `publicacao_url`/`surge_url`. Use `--sem-surge` quando quiser gerar somente o arquivo local.

## Fluxo técnico

O ponto de entrada é `scripts/revisar_ppc.ts` (Node, em `effect/cli`; `--help` lista os subcomandos e as opções de cada um), e todos os subcomandos rodam em TypeScript, inclusive `gerar-relatorio-html`, a publicação no Surge e a conversão de entrada `.docx` em `preparar-documento` (veja [Conversão DOCX](#conversão-docx)). A skill só precisa do Node: não usa Python, MS Word nem poppler. Em testes e diferenciais, `REVISAR_PPC_AGORA` fixa o relógio da rodada: nome do diretório, `criado_em` e `data_conversao`. Aceita `AAAA-MM-DD` (meia-noite local) ou `AAAA-MM-DDTHH:MM[:SS]` com fuso opcional (`Z` ou `±HH:MM`; sem fuso, hora local); outro formato é recusado. Fora da skill, o conversor de PDF de PPCs da base (`scripts/converter_ppcs_markdown.py`) continua em Python, até a trilha T5.

```bash
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts preparar-documento caminho/PPC.docx
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts montar-grupos-subagents --rodada-dir .agents/skills/revisar-ppc/output/<rodada>
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts preparar-prompts-subagents --rodada-dir .agents/skills/revisar-ppc/output/<rodada>
```

Depois, o agente principal spawna um sub-agente por grupo, de preferência com os pacotes prontos de `arquivos-suporte/prompts-subagents/` (um por grupo, com o prompt, o trecho do PPC e o JSON do grupo). Em seguida, colete as respostas em `arquivos-suporte/resultados-subagents.json`, rode a síntese transversal com `prompts/sintese-transversal.md` e `validacoes_cruzadas`, e gere o relatório:

```bash
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts gerar-relatorio-html --rodada-dir .agents/skills/revisar-ppc/output/<rodada> --resultados resultados-subagents.json
```

Para reavaliar fichas específicas, use `montar-grupo-avulso`, execute um sub-agente com o pacote retornado (`prompt_subagent_path`) e depois `mesclar-resultados-avulsos`. A mescla valida o avulso com o mesmo contrato de `validar-resultados` (fichas conhecidas, sem repetição, estado, confiança, evidências) e, se ele for inválido, recusa sem tocar a base; a base no formato `{"grupo_id", "resultados"}` é gravada em `grupos[]`, com os resultados originais.

## Grupos por tópico

Os grupos de sub-agente são por tópico (`base-analise/topicos-fichas.json`), e o contexto de cada um sai do `pacote-contexto` do kb (`packages/kb`, `pacoteContextoAvulso`):

- **Uma ficha, um grupo.** Cada ficha entra no grupo do seu tópico principal: o mais específico (o de menos fichas na taxonomia) entre os seus `topicos_tematicos`; no empate, o primeiro na ordem de `topicos-fichas.json`. As fichas com `tipo_escopo: transversal` (as `CT-TRANS-*`, que cruzam o PPC inteiro) vão num grupo `transversal`, por último, com o `PPC.md` completo; uma ficha sem tópico conhecido também. Os grupos seguem a ordem da taxonomia (`grupo-001`, `grupo-002`…).
- **Tamanho máximo.** `--tamanho-grupo` (padrão 20) é o máximo de fichas por grupo; um tópico maior vira partes equilibradas (`parte`/`partes`). Hoje nenhum tópico passa de 14 fichas, e a rodada tem 17 grupos.
- **Seções do PPC.** O `PPC.md` da rodada, que pode não estar na base, é segmentado com a segmentação e a taxonomia técnica do índice de seções (`secoesComChave` e `bancoDoPpcAvulso` do kb), num banco em memória com o esquema do `kb.sqlite`. Ficam também a capa, as seções `outros` e as de texto curto, que o índice publicado descarta, e `# Título` conta como título (o normalizador põe o primeiro nível numerado em `#`). Cada grupo recebe, inteiras, as seções dos tipos ligados a todos os tópicos das suas fichas (`packages/kb/dados/topicos-secoes.yaml`), inclusive os tópicos secundários das fichas multitemáticas, mais a melhor seção de cada `consulta` das fichas (busca com todos os termos). O pacote diz onde está o `PPC.md` completo, e o prompt manda conferi-lo antes de concluir que algo falta.
- **Normas, marcos e transições.** Vêm do `kb.sqlite` (recompilado sozinho quando velho): o texto de cada dispositivo citado pelas fichas do grupo, com o caput e os subordinados; as regras de transição das normas das fichas e das citadas pelo PPC como fundamento, com a situação na `data_referencia`; os marcos normativos, com as citações do PPC às normas de cada um. Os grupos com fichas de `referencias_normativas` recebem também todas as citações normativas do PPC (`citacoes_do_ppc`).
- **CNCT.** `contextos.cnct` continua sendo a comparação da skill (`cnct-contexto.json`): o curso do CNCT identificado pela denominação, com as comparações de eixo, carga e estágio. O registro é o mesmo do `kb.sqlite` (`cnct:<id>`, conferido em teste).

`montar-grupos-subagents` imprime, por grupo, o tópico, o escopo do PPC (`secoes` ou `completo`) e o número de seções; `preparar-prompts-subagents` grava o tamanho de cada pacote (`caracteres`) no `manifest.json`.

## Conversão DOCX

`preparar-documento` converte o `.docx` em memória, antes de criar a rodada (um arquivo que não é DOCX, está protegido por senha ou corrompido falha sem deixar pastas), e grava em `arquivos-suporte/artefatos-conversao/` o Markdown normalizado, o Markdown bruto, `<nome>_dados.json`, `<nome>_matriz_curricular.json`, `<nome>_ementario.json` e, quando há, `imagens/representacao_grafica.<ext>`.

A conversão não mora na skill: está em dois pacotes do workspace, que o servidor do app também pode importar. A skill fica com a CLI (`scripts/preparar-documento.ts`).

| Pacote | Papel |
|---|---|
| `packages/docx` (`@simplifica-if/docx`) | Leitor OOXML genérico, que não sabe o que é um PPC: `pacote.ts` (o ZIP, lido sob limites), `xml.ts` (árvore com nomes resolvidos pela URI do namespace), `leitor.ts` e `modelo.ts` (modelo intermediário: parágrafos com estilo, recuo, numeração, runs com formatação direta, hyperlinks e figura; tabelas com `gridSpan`, `vMerge` e os dois textos de cada célula; propriedades). |
| `packages/ppc` (`@simplifica-if/ppc`) | Conversão do PPC, em `src/conversao-docx/`: `elementos.ts` (título, parágrafo, item de lista, grade de tabela, figura), `secoes.ts`, `tabelas.ts`, `matriz.ts`, `ementario.ts` e `similaridade.ts` (o `partial_ratio` do `rapidfuzz`), `identificacao-tabelas.ts`, `figura.ts`, `markdown.ts`, `regras.ts` e `conversao.ts`; e o `normalizador-markdown.ts`, usado também na entrada `.md`. |

Até 16/11/2026 a conversão era em Python (`conversao_docx/`, sobre `python-docx`); a trilha T3 do `PLANO-ARQUITETURA.md` a substituiu. A conversão antiga continua sendo o oráculo do diferencial: com `fidelidade: "python-docx"`, a nova a reproduz byte a byte. O padrão (`documento`) lê o texto que o Word mostra e corrige os defeitos dela, por regras nomeadas em `regras.ts`.

### Arquivo hostil ou quebrado

O app abre arquivos do usuário. O leitor e a conversão recusam, com `ErroDocx` e mensagem em português:

- o que não é ZIP, o `.doc` renomeado e o DOCX protegido por senha (contêiner OLE: "arquivo do Word 97-2003 (.doc) ou um DOCX protegido por senha");
- ZIP truncado ou com entrada cifrada;
- XML malformado ou truncado (antes virava um `PPC.md` pela metade, sem aviso);
- documento sem texto nenhum (vazio, ou PPC digitalizado como imagem);
- o que passa dos limites abaixo.

Os limites ficam em dois lugares, um por pacote, e quem chama pode trocar qualquer um (`limites` e `limitesDeTexto` nas opções de `converterPpc`). Os padrões vêm dos 12 PPCs reais conferidos em 16/11/2026.

| Limite (`packages/docx/src/limites.ts`) | Padrão | Maior valor nos PPCs reais |
|---|---:|---:|
| Arquivo `.docx` (`bytesDoArquivo`), conferido antes da leitura | 20 MB | 7,3 MB |
| Parte descompactada (`bytesPorParte`) | 25 MB | 4,5 MB (`document.xml`) |
| Total das partes lidas (`bytesNoTotal`) | 60 MB | cerca de 6 MB |
| Razão de compressão, nas partes de mais de 10 MB (`razaoDeCompressao`) | 200:1 | cerca de 15:1 |
| Entradas no ZIP (`entradas`) | 10 mil | dezenas |
| Elementos por parte XML (`elementosPorParte`) | 500 mil | 104 mil |
| Níveis de aninhamento do XML (`profundidadeDoXml`) | 256 | dezenas |
| Células por linha de tabela (`celulasPorLinha`) | 1.024 | 63 (o máximo do Word) |
| Posições da grade de uma tabela (`posicoesPorTabela`) | 2 milhões | milhares |

| Orçamento de texto do documento (`packages/ppc/src/conversao-docx/orcamento.ts`) | Padrão | Maior valor nos PPCs reais |
|---|---:|---:|
| Caracteres no documento: texto das tabelas expandidas e Markdown gerado (`caracteresNoDocumento`) | 8 milhões | 398 mil |
| Caracteres num parágrafo, título ou célula (`caracteresPorBloco`) | 50 mil | 3,3 mil |
| Caracteres seguidos sem letra nem dígito: espaços, tabulações, pontuação (`sequenciaSemTexto`) | 1.000 | 27 |

O arquivo acima de 20 MB sai com a orientação de compactar as imagens no Word (Arquivo › Compactar imagens). As partes do ZIP são descompactadas sob demanda, em pedaços, e os limites de tamanho e de razão valem para o que de fato saiu, não para o tamanho declarado; o que a conversão não lê (fontes, imagens, `customXml`) não é descompactado. `gridSpan` e `gridBefore` ficam presos à faixa do Word (até 63 colunas).

O orçamento de texto é por documento porque os limites por item não fecham a conta: sessenta tabelas logo abaixo do teto por tabela (num ZIP de 18 KB) custavam dois minutos. Ele é conferido logo depois da leitura, antes de qualquer trabalho proporcional ao texto. O teto de sequência sem letra nem dígito existe por causa das expressões regulares terminadas em `\s*$` ou em pontuação, que custam o quadrado de uma sequência dessas (80 mil tabulações num parágrafo, num ZIP de 3 KB, levavam 89 s); o aparo de espaços do `kb` deixou de usar expressão regular pelo mesmo motivo.

Entidades declaradas no XML não são expandidas nem buscadas, e uma relação que aponta para fora do pacote resolve dentro dele. No `PPC.md`, só endereços `http`, `https` e `mailto` viram link, com parênteses e espaços escapados no endereço e `]` e `\` no texto. A consolidação de parágrafos do normalizador é linear no tamanho do texto.

Pior caso honesto dentro dos limites (um `document.xml` de 14 a 25 MB com 486 mil elementos e texto variado): 1,5 s e cerca de 690 MB de memória residente no pico; converte com o heap limitado a 512 MB. Um PPC típico leva 0,1 a 0,3 s e cerca de 150 MB. A conversão é síncrona e a árvore do XML fica inteira na memória: quem a chama a partir de um servidor deve isolá-la num `Worker` com limite de memória e de tempo (veja o M1.11 em `docs/plans/app-simplifica-if.md`). Os tetos barram os casos conhecidos, não toda entrada patológica; o limite de tempo do `Worker` é a defesa final.

### Diferenças em relação à conversão em Python

Regras do modo `documento` (`regras.ts`); cada uma pode ser desligada à parte, e o diferencial mede quantas linhas cada uma muda em cada documento:

- **`leitura`.** O `python-docx` só lê os runs filhos diretos do parágrafo, e o texto inserido com o controle de alterações ligado (`w:ins`) sumia do `PPC.md`: "está previst na Resolução", "### e formas de acesso" no lugar de "### 1.1.2 Requisitos e formas de acesso". Entram os runs de `w:ins`, `w:moveTo`, `w:smartTag`, `w:sdt` em linha, `w:fldSimple` e `w:customXml`; o removido (`w:del`, `w:moveFrom`) fica de fora, inclusive a figura apagada e a linha de tabela removida na revisão. Entram também as linhas, as células e os parágrafos de tabela embrulhados em `w:sdt` (numa matriz, o `python-docx` perdia esses componentes sem aviso). Nas tabelas em `w:sdt` do Google Docs, a célula é lida como os parágrafos do corpo: com tabulações e quebras, sem o texto movido e sem a versão de compatibilidade das caixas de texto, que saía repetida.
- **`titulosDeCorpo`.** Texto de corpo digitado num parágrafo com estilo de título sai como parágrafo: frase de 200 caracteres ou mais, item com marcador ou, sem numeração de seção, texto terminado em ponto e vírgula ou frase de oito palavras ou mais terminada em ponto ou dois-pontos. Antes, cada frase abria uma seção e a seção de verdade ficava vazia (`## 5.9 ESTÁGIO CURRICULAR` seguido de cinco `## O curso não prevê estágio…`).
- **`listas`.** A numeração automática do Word (`w:numPr`) faz itens de lista, com o nível (o Python a procurava no lugar errado e nunca a achou; as listas saíam como parágrafos soltos). O número digitado fica (`2. texto`, não `1. texto`), e a alínea sai como `- a) texto`, não `1. a) texto`.
- **`negritoUnido`.** Runs seguidos de mesma formatação saem num marcador só, com os espaços das pontas fora dele: `**Pró-Reitoria de Ensino**`, não `**Pró-Reitoria** de Ensino**`.
- **`linksSeguros`.** Descrita acima.
- **`totaisDaMatriz`.** Na matriz dividida em várias tabelas, o total que nenhuma delas declara é recalculado sobre todas as partes (antes ficava a soma da última: 160 h-a de um 2º ano no lugar das 400 do curso), e `resumo_matriz_curricular.total_ha` e `total_hr` são a soma dos componentes (antes, sempre 0).
- **`secoesNoNivel2`.** As seções começam em `##` (a seção "1" é `##`, a "1.1" é `###`), e `#` fica para o título do documento, como nos PPCs convertidos da base (`##` em todas as seções) e na segmentação de seções do `kb`, que só toma `##` em diante. O Python escrevia a seção de primeiro nível como `#`, e o `kb` não a reconhecia: a pré-conferência via todas as seções do modelo "ausentes". O normalizador (`normalizarMarkdown`, também usado na entrada `.md`) segue a mesma convenção pela numeração; sem número, o título mantém o nível que tinha. Incluída em 16/11/2026, depois da medição abaixo: nos 14 sintéticos, muda de 2 a 18 linhas por documento, só marcadores de título.

Fora das regras, valem nos dois modos:

- **Representação gráfica.** A figura desenhada com formas do Word não é renderizada (a conversão antiga chamava o MS Word e o poppler). O `_dados.json` traz `metodo: "vetorial_nao_renderizada"` (ou `"figura_nao_localizada"`, quando a seção não tem figura reconhecida) e o `PPC.md` recebe, depois do título da seção, um parágrafo `**Aviso da conversão:** …`. Um EMF ou WMF embutido é copiado como está (`metodo: "vetorial_arquivo_cru"`, com `arquivo_vetorial`), sem contar como imagem extraída. A imagem sai com a extensão dela: a conversão antiga gravava qualquer formato como `representacao_grafica.png`.
- **Propriedades do documento.** Sem `docProps/core.xml` (exportação do Google Docs), `metadata_documento` fica vazio; o `python-docx` inventava `title: "Word Document"`, `last_modified_by: "python-docx"` e a hora da conversão como `modified`.
- **Robustez.** Mescla vertical malformada e imagem com relação externa não abortam mais. O prefixo de namespace do XML é livre, e o DOCX salvo como "Strict Open XML" é lido.
- **Referências do ementário.** A busca aproximada de locais usa sempre a medida do `rapidfuzz`. A conversão antiga, sem ele instalado, caía num cálculo com `difflib`, com escores diferentes.

O que continua como na conversão antiga: o texto de uma tabela aninhada não entra na célula que a contém; o que vem antes do primeiro título (capa) fica fora do Markdown.

Limitações das listas automáticas:

- o número não é calculado: todo item numerado sai como `1.` (o Markdown numera na exibição), e a lista que no Word começa em 5 (`w:start`) ou usa letras ou romanos perde o rótulo;
- o nível (`w:ilvl`) vai para o Markdown bruto como recuo, mas o normalizador tira o recuo de toda linha, como sempre fez: no `PPC.md`, o subitem fica no nível do item. Preservar o recuo muda a normalização também da entrada `.md` e ficou fora desta trilha.

### Diferencial contra a conversão em Python

`packages/ppc/scripts/diferencial-docx.ts` é uma ferramenta de desenvolvimento, fora da skill e do app: extrai a conversão em Python do commit `c0d6f07` (`git archive`), roda-a num ambiente temporário (`uv run --with python-docx==1.2.0 --with rapidfuzz==3.14.6`; nada é instalado) e compara com a conversão em TypeScript. Precisa de `git`, `uv` e `diff`.

```bash
node packages/ppc/scripts/diferencial-docx.ts                      # só os documentos sintéticos
KB_CORPUS_DOCX="/pasta/com/ppcs" node packages/ppc/scripts/diferencial-docx.ts
node packages/ppc/scripts/diferencial-docx.ts --gravar-gabaritos   # regrava os gabaritos dos testes
```

Para cada documento, o diferencial:

1. compara a camada de elementos (o que o `DocxReader` do Python lia contra o leitor no modo `python-docx`) e os artefatos finais, byte a byte. Duas diferenças são neutralizadas antes e relatadas por documento: `propriedades-inventadas` e `figura-nao-renderizada` (descritas acima);
2. conta as linhas do `PPC.md` e dos JSONs que mudam no modo `documento`, no todo e por regra (a conversão padrão com uma regra desligada, contra a padrão).

A saída vai para `tmp/diferencial-docx/` (artefatos, `.diff` e `relatorio.md`), e o código de saída é 1 se sobrar diferença no item 1. O corpus de PPCs reais fica fora do git (são minutas, com nomes de revisores): `KB_CORPUS_DOCX` aponta para a pasta, que é lida no lugar.

Resultado de 16/11/2026, com 12 PPCs técnicos reais e 14 documentos sintéticos (Node 26.12.1 e Python 3.12, num Mac com Apple Silicon):

- modo `python-docx`: elementos e artefatos idênticos nos 26, com `propriedades-inventadas` em 4 PPCs e `figura-nao-renderizada` em 3;
- tempo por PPC: de 0,11 a 0,26 s, contra 0,84 a 2,0 s do Python;
- modo `documento`, linhas que mudam em cada PPC (contadas as duas versões de cada linha alterada; `leitura` e `listas` se sobrepõem, porque a numeração automática depende das duas):

| PPC | Total | `leitura` | `titulosDeCorpo` | `listas` | `negritoUnido` | `linksSeguros` | `totaisDaMatriz` |
|---|---:|---:|---:|---:|---:|---:|---:|
| corpus-01 | 678 | 468 | 0 | 472 | 210 | 0 | 4 |
| corpus-02 | 697 | 475 | 0 | 479 | 228 | 0 | 4 |
| corpus-03 | 697 | 475 | 0 | 479 | 228 | 0 | 4 |
| corpus-04 | 239 | 186 | 5 | 188 | 46 | 0 | 4 |
| corpus-05 | 295 | 229 | 0 | 201 | 72 | 0 | 4 |
| corpus-06 | 373 | 254 | 99 | 254 | 70 | 0 | 4 |
| corpus-07 | 356 | 288 | 130 | 254 | 76 | 0 | 4 |
| corpus-08 | 372 | 323 | 22 | 205 | 58 | 0 | 4 |
| corpus-09 | 697 | 475 | 0 | 479 | 228 | 0 | 4 |
| corpus-10 | 357 | 265 | 0 | 287 | 68 | 0 | 4 |
| corpus-11 | 344 | 278 | 0 | 278 | 62 | 0 | 4 |
| corpus-12 | 366 | 294 | 0 | 294 | 70 | 0 | 4 |

  Em `totaisDaMatriz`, as 4 linhas são `total_ha` e `total_hr` do resumo: os totais da matriz não mudam em nenhum dos 12 (todos declaram a linha de total do curso). Nenhum PPC do corpus tem link fora de `http`, `https` e `mailto`. O número de títulos não muda com `negritoUnido`; com `titulosDeCorpo`, 4 PPCs perdem de 2 a 33 falsas seções.

Os documentos sintéticos (`packages/ppc/src/testes/documentos.ts`, sobre o construtor de `packages/docx/src/testes/sintetico.ts`) são OOXML mínimo escrito à mão: mesclas horizontal, vertical, em bloco e em L, linhas, células e tabelas em `w:sdt`, alterações controladas, tabulações e quebras, hyperlinks, figura PNG, JPEG, EMF, vetorial e apagada, listas automáticas e digitadas, texto de corpo com estilo de título e dois PPCs fictícios completos. Os gabaritos de `packages/ppc/test/fixtures/conversao-docx/` são a saída do Python para eles, e `partial-ratio-rapidfuzz.json` traz 992 escores do `rapidfuzz`; os testes dos dois pacotes conferem tudo sem precisar de Python, e `packages/docx/test/leitor.test.ts` cobre os arquivos hostis.

## Identificação do curso

O `preparar-documento` grava em `metadata.json` o curso, o campus, a forma de oferta (`forma_oferta`, repetida em `modalidade`), a modalidade de ensino e o eixo tecnológico, com a fonte de cada um em `identificacao_fontes` (`rotulo`, `capa`, `inicio`, `conversao` ou `nome_arquivo`). A extração (`scripts/identificacao.ts`) é heurística e só lê o próprio PPC, mais as listas de campi e de eixos do CNCT da base; não consulta `dados/institucional/`, porque o PPC analisado pode não estar lá. Rótulos só valem no início de linha, célula ou trecho em negrito, ou no meio da linha com inicial maiúscula e dois-pontos, e cada valor passa por um validador do campo. Com `.docx`, a extração roda sobre o `PPC.md` da conversão, e os dados da conversão (`_dados.json`) só preenchem o que faltar.

Para medir a identificação nos PPCs técnicos da base contra `dados/institucional/cursos` (só leitura, como gabarito):

```bash
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts medir-identificacao --erros
```

`--amostra` mede só a amostra fixa usada em `tests/identificacao.test.ts`, e `--json` imprime a medição completa.

## Manutenção de fichas

Ao criar, atualizar ou corrigir uma ficha em `base-analise/fichas/`:

1. Garanta que a ficha declare `topicos_tematicos`, `tipo_escopo` e `ancoras_semanticas`.
2. Cite em `referencias_normativas` apenas normas vigentes, por ID canônico, com `dispositivo` e `papel` (veja [Como citar normas nas fichas](base-analise/README.md#como-citar-normas-nas-fichas)). Regras de transição e a norma vigente de cada tema ficam em `base-analise/marcos-normativos.json`; o validador acusa ID inexistente, norma revogada no manifesto ou nos stubs, norma substituída por marco e dispositivo revogado.
3. Atualize `base-analise/topicos-fichas.json` quando a cobertura temática mudar.
4. Atualize ou crie teste quando a ficha cobrir comportamento novo, regra normativa específica ou regressão já observada.
5. Regenere os artefatos derivados e valide a base.

Comandos obrigatórios a partir da raiz do repositório:

```bash
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts gerar-schemas --check
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts validar-base
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts gerar-mapa
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts gerar-indice
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts validar-base
pnpm exec vp test run .agents/skills/revisar-ppc
```

O `pnpm exec vp test run .agents/skills/revisar-ppc` cobre a skill inteira, inclusive a conversão DOCX.
