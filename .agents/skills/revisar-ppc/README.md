# Revisão de PPC

Esta skill revisa Projetos Pedagógicos de Curso técnico do IFPR antes da submissão à PROENS, a partir de um arquivo Word (`.docx`) ou Markdown (`.md`). É uma revisão prévia: o produto é um relatório de revisão (o PPC HTML anotado), não um parecer, e não substitui a análise oficial da PROENS. A IA roda por sub-agentes na conversa atual; os scripts preparam o `PPC.md`, organizam as fichas e geram o relatório.

A skill se chamava `analise-ppc` até 13/11/2026; o nome mudou para deixar claro que ela faz uma revisão prévia, antes da submissão à PROENS, e não é a análise oficial nem emite parecer.

A skill, com sub-agentes e o relatório HTML, roda só no repositório: não tem bloco `simplifica:` e não vai para o app. No app Simplifica IF, a revisão é a tarefa nativa "Revisar um PPC", conduzida pelo servidor, que usa as fichas desta skill e a conversão de `packages/ppc` e devolve o `.docx` com comentários (veja [Execução no app](#execução-no-app-d-s-j)).

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

Ao gerar o relatório, a skill publica no Surge por padrão e retorna `publicacao_url`/`surge_url`. Use `--sem-surge` quando quiser gerar somente o arquivo local. Se a CLI do Surge falhar ou não confirmar a publicação, a mensagem traz as últimas linhas do stderr (com os e-mails mascarados), e a saída completa fica em `arquivos-suporte/surge-erro.log`.

## Fluxo técnico

O ponto de entrada é `scripts/revisar_ppc.ts` (Node, em `effect/cli`; `--help` lista os subcomandos e as opções de cada um), e todos os subcomandos rodam em TypeScript, inclusive `gerar-relatorio-html`, a publicação no Surge e a conversão de entrada `.docx` em `preparar-documento` (veja [Conversão DOCX](#conversão-docx)). A skill só precisa do Node: não usa MS Word nem poppler. Em testes, `REVISAR_PPC_AGORA` fixa o relógio da rodada: nome do diretório, `criado_em` e `data_conversao`. Aceita `AAAA-MM-DD` (meia-noite local) ou `AAAA-MM-DDTHH:MM[:SS]` com fuso opcional (`Z` ou `±HH:MM`; sem fuso, hora local); outro formato é recusado.

```bash
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts preparar-documento caminho/PPC.docx
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts montar-grupos-subagents --rodada-dir .agents/skills/revisar-ppc/output/<rodada>
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts preparar-prompts-subagents --rodada-dir .agents/skills/revisar-ppc/output/<rodada>
```

Depois, o agente principal spawna um sub-agente por grupo, de preferência com os pacotes prontos de `arquivos-suporte/prompts-subagents/` (um por grupo, com o prompt, o trecho do PPC e o JSON do grupo). Em seguida, colete as respostas em `arquivos-suporte/resultados-subagents.json`, rode a síntese transversal com `prompts/sintese-transversal.md` e `validacoes_cruzadas`, e gere o relatório:

```bash
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts gerar-relatorio-html --rodada-dir .agents/skills/revisar-ppc/output/<rodada> --resultados resultados-subagents.json
```

O JSON de resultados é decodificado pelo contrato de `scripts/esquemas.ts` (o resultado de lote e os alertas transversais, os mesmos de `base-analise/schemas/`), e o que o contrato não exprime (ficha conhecida e coberta uma vez, evidência com conteúdo, mínimo de evidências, `feedback_autores` exigido pela ficha, validação cruzada conhecida) é conferido depois; a recusa diz o caminho de cada campo fora do contrato (`$.grupos[0].resultados[1].estado`) ou a ficha e o alerta envolvidos. O topo, o grupo, o resultado da ficha e o alerta aceitam chaves a mais; a evidência, a âncora e o achado normativo, não: um sinônimo como `"seção"` no lugar de `secao` é recusado com o caminho do campo (`$.grupos[0].resultados[1].evidencias[0].seção`). `null` num campo opcional vale como ausente.

Para reavaliar fichas específicas, use `montar-grupo-avulso`, execute um sub-agente com o pacote retornado (`prompt_subagent_path`) e depois `mesclar-resultados-avulsos`. A mescla valida o avulso com o mesmo contrato de `validar-resultados` (fichas conhecidas, sem repetição, estado, confiança, evidências) e, se ele for inválido, recusa sem tocar a base; a base no formato `{"grupo_id", "resultados"}` é gravada em `grupos[]`, com os resultados originais.

## Grupos por tópico

Os grupos de sub-agente são por tópico (`base-analise/topicos-fichas.json`), e o contexto de cada um sai do `pacote-contexto` do kb (`packages/kb`, `PacoteContexto.abrirAvulso`):

- **Uma ficha, um grupo.** Cada ficha entra no grupo do seu tópico principal: o mais específico (o de menos fichas na taxonomia) entre os seus `topicos_tematicos`; no empate, o primeiro na ordem de `topicos-fichas.json`. As fichas com `tipo_escopo: transversal` (as `CT-TRANS-*`, que cruzam o PPC inteiro) vão num grupo `transversal`, por último, com o `PPC.md` completo; uma ficha sem tópico conhecido também. Os grupos seguem a ordem da taxonomia (`grupo-001`, `grupo-002`…).
- **Tamanho máximo.** `--tamanho-grupo` (padrão 20) é o máximo de fichas por grupo; um tópico maior vira partes equilibradas (`parte`/`partes`). Hoje nenhum tópico passa de 14 fichas, e a rodada tem 17 grupos.
- **Seções do PPC.** O `PPC.md` da rodada, que pode não estar na base, é segmentado com a segmentação e a taxonomia técnica do índice de seções (`secoesComChave` e o banco do PPC avulso do kb, `PacoteContexto.abrirAvulso`), num banco em memória com o esquema do `kb.sqlite`. Ficam também a capa, as seções `outros` e as de texto curto, que o índice publicado descarta, e `# Título` conta como título (o normalizador põe o primeiro nível numerado em `#`). Cada grupo recebe, inteiras, as seções dos tipos ligados a todos os tópicos das suas fichas (`packages/kb/dados/topicos-secoes.yaml`), inclusive os tópicos secundários das fichas multitemáticas, mais a melhor seção de cada `consulta` das fichas (busca com todos os termos). O pacote diz onde está o `PPC.md` completo, e o prompt manda conferi-lo antes de concluir que algo falta.
- **Normas, marcos e transições.** Vêm do `kb.sqlite` (recompilado sozinho quando velho): o texto de cada dispositivo citado pelas fichas do grupo, com o caput e os subordinados; as regras de transição das normas das fichas e das citadas pelo PPC como fundamento, com a situação na `data_referencia`; os marcos normativos, com as citações do PPC às normas de cada um. Os grupos com fichas de `referencias_normativas` recebem também todas as citações normativas do PPC (`citacoes_do_ppc`).
- **CNCT.** `contextos.cnct` continua sendo a comparação da skill (`cnct-contexto.json`): o curso do CNCT identificado pela denominação, com as comparações de eixo, carga e estágio. O registro é o mesmo do `kb.sqlite` (`cnct:<id>`, conferido em teste).

`montar-grupos-subagents` imprime, por grupo, o tópico, o escopo do PPC (`secoes` ou `completo`) e o número de seções; `preparar-prompts-subagents` grava o tamanho de cada pacote (`caracteres`) no `manifest.json`.

## Conversão DOCX

`preparar-documento` converte o `.docx` em memória, antes de criar a rodada (um arquivo que não é DOCX, está protegido por senha ou corrompido falha sem deixar pastas), e grava em `arquivos-suporte/artefatos-conversao/` o Markdown normalizado, o Markdown bruto, `<nome>_dados.json`, `<nome>_matriz_curricular.json`, `<nome>_ementario.json` e, quando há, `imagens/representacao_grafica.<ext>`.

A conversão não mora na skill: está em dois pacotes do workspace, que o servidor do app também pode importar. A skill fica com a CLI (`scripts/preparar-documento.ts`).

| Pacote | Papel |
|---|---|
| `packages/docx` (`@simplifica-if/docx`) | Leitor OOXML genérico, que não sabe o que é um PPC: `pacote.ts` (o ZIP, lido sob limites), `xml.ts` (árvore com nomes resolvidos pela URI do namespace), `leitor.ts` e `modelo.ts` (modelo intermediário: parágrafos com estilo, recuo, numeração, runs com formatação direta, hyperlinks e figura; tabelas com `gridSpan`, `vMerge` e os dois textos de cada célula; propriedades). |
| `packages/ppc` (`@simplifica-if/ppc`) | Conversão do PPC, em `src/conversao-docx/`, sobre a camada genérica do `docx` (`elementos.ts`: título, parágrafo, item de lista, grade de tabela, figura; `tabelas.ts`; `orcamento.ts`; a escrita em `markdown.ts`): `secoes.ts`, `matriz.ts`, `ementario.ts` e `similaridade.ts` (o `partial_ratio` do `rapidfuzz`), `identificacao-tabelas.ts`, `figura.ts`, `markdown.ts` (as seções) e `conversao.ts`; e o `normalizador-markdown.ts`, usado também na entrada `.md`. |

A conversão lê o texto que o Word mostra (inclusive as alterações controladas ainda não aceitas) e aplica as regras descritas em [Regras da conversão](#regras-da-conversão).

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

| Orçamento de texto do documento (`packages/docx/src/orcamento.ts`) | Padrão | Maior valor nos PPCs reais |
|---|---:|---:|
| Caracteres no documento: texto das tabelas expandidas e Markdown gerado (`caracteresNoDocumento`) | 8 milhões | 398 mil |
| Caracteres num parágrafo, título ou célula (`caracteresPorBloco`) | 50 mil | 3,3 mil |
| Caracteres seguidos sem letra nem dígito: espaços, tabulações, pontuação (`sequenciaSemTexto`) | 1.000 | 27 |

O arquivo acima de 20 MB sai com a orientação de compactar as imagens no Word (Arquivo › Compactar imagens). As partes do ZIP são descompactadas sob demanda, em pedaços, e os limites de tamanho e de razão valem para o que de fato saiu, não para o tamanho declarado; o que a conversão não lê (fontes, imagens, `customXml`) não é descompactado. `gridSpan` e `gridBefore` ficam presos à faixa do Word (até 63 colunas).

O orçamento de texto é por documento porque os limites por item não fecham a conta: sessenta tabelas logo abaixo do teto por tabela (num ZIP de 18 KB) custavam dois minutos. Ele é conferido logo depois da leitura, antes de qualquer trabalho proporcional ao texto. O teto de sequência sem letra nem dígito existe por causa das expressões regulares terminadas em `\s*$` ou em pontuação, que custam o quadrado de uma sequência dessas (80 mil tabulações num parágrafo, num ZIP de 3 KB, levavam 89 s); o aparo de espaços do `kb` deixou de usar expressão regular pelo mesmo motivo.

Entidades declaradas no XML não são expandidas nem buscadas, e uma relação que aponta para fora do pacote resolve dentro dele. No `PPC.md`, só endereços `http`, `https` e `mailto` viram link, com parênteses e espaços escapados no endereço e `]` e `\` no texto. A consolidação de parágrafos do normalizador é linear no tamanho do texto.

Pior caso honesto dentro dos limites (um `document.xml` de 14 a 25 MB com 486 mil elementos e texto variado): 1,5 s e cerca de 690 MB de memória residente no pico; converte com o heap limitado a 512 MB. Um PPC típico leva 0,1 a 0,3 s e cerca de 150 MB. A conversão é síncrona e a árvore do XML fica inteira na memória: quem a chama a partir de um servidor deve isolá-la num `Worker` com limite de memória e de tempo (veja o M1.11 em `docs/plans/app-simplifica-if.md`). Os tetos barram os casos conhecidos, não toda entrada patológica; o limite de tempo do `Worker` é a defesa final.

### Regras da conversão

- **Leitura.** Entram os runs de `w:ins`, `w:moveTo`, `w:smartTag`, `w:sdt` em linha, `w:fldSimple` e `w:customXml`, de modo que o texto inserido com o controle de alterações ligado aparece no `PPC.md`; o removido (`w:del`, `w:moveFrom`) fica de fora, inclusive a figura apagada e a linha de tabela removida na revisão. Entram também as linhas, as células e os parágrafos de tabela embrulhados em `w:sdt` (numa matriz, são componentes). Nas tabelas em `w:sdt` do Google Docs, a célula é lida como os parágrafos do corpo: com tabulações e quebras, sem o texto movido e sem a versão de compatibilidade das caixas de texto.
- **Títulos de corpo.** Texto de corpo digitado num parágrafo com estilo de título sai como parágrafo: frase de 200 caracteres ou mais, item com marcador ou, sem numeração de seção, texto terminado em ponto e vírgula ou frase de oito palavras ou mais terminada em ponto ou dois-pontos. Sem isso, cada frase abriria uma seção e a seção de verdade ficaria vazia (`## 5.9 ESTÁGIO CURRICULAR` seguido de cinco `## O curso não prevê estágio…`).
- **Listas.** A numeração automática do Word (`w:numPr`) faz itens de lista, com o nível. O número digitado fica (`2. texto`, não `1. texto`), e a alínea sai como `- a) texto`, não `1. a) texto`.
- **Negrito unido.** Runs seguidos de mesma formatação saem num marcador só, com os espaços das pontas fora dele: `**Pró-Reitoria de Ensino**`, não `**Pró-Reitoria** de Ensino**`.
- **Links seguros.** Descrita acima.
- **Totais da matriz.** Na matriz dividida em várias tabelas, o total que nenhuma delas declara é recalculado sobre todas as partes (e não fica a soma da última: 160 h-a de um 2º ano no lugar das 400 do curso), e `resumo_matriz_curricular.total_ha` e `total_hr` são a soma dos componentes.
- **Seções no nível 2.** As seções começam em `##` (a seção "1" é `##`, a "1.1" é `###`), e `#` fica para o título do documento, como nos PPCs convertidos da base (`##` em todas as seções) e na segmentação de seções do `kb`, que só toma `##` em diante; com a seção de primeiro nível em `#`, a pré-conferência veria todas as seções do modelo "ausentes". O normalizador (`normalizarMarkdown`, também usado na entrada `.md`) segue a mesma convenção pela numeração; sem número, o título mantém o nível que tinha.
- **Representação gráfica.** A figura desenhada com formas do Word não é renderizada. O `_dados.json` traz `metodo: "vetorial_nao_renderizada"` (ou `"figura_nao_localizada"`, quando a seção não tem figura reconhecida) e o `PPC.md` recebe, depois do título da seção, um parágrafo `**Aviso da conversão:** …`. Um EMF ou WMF embutido é copiado como está (`metodo: "vetorial_arquivo_cru"`, com `arquivo_vetorial`), sem contar como imagem extraída. A imagem sai com a extensão dela.
- **Propriedades do documento.** Sem `docProps/core.xml` (exportação do Google Docs), `metadata_documento` fica vazio.
- **Robustez.** Mescla vertical malformada e imagem com relação externa não abortam. O prefixo de namespace do XML é livre, e o DOCX salvo como "Strict Open XML" é lido.
- **Referências do ementário.** A busca aproximada de locais usa a medida `partial_ratio` do `rapidfuzz`, reproduzida em `similaridade.ts`.
- O texto de uma tabela aninhada não entra na célula que a contém; o que vem antes do primeiro título (capa) fica fora do Markdown.

Limitações das listas automáticas:

- o número não é calculado: todo item numerado sai como `1.` (o Markdown numera na exibição), e a lista que no Word começa em 5 (`w:start`) ou usa letras ou romanos perde o rótulo;
- o nível (`w:ilvl`) vai para o Markdown bruto como recuo, mas o normalizador tira o recuo de toda linha: no `PPC.md`, o subitem fica no nível do item. Preservar o recuo muda a normalização também da entrada `.md`.

Um PPC típico leva de 0,1 a 0,3 s para converter (12 PPCs técnicos reais, medidos em 16/11/2026 num Mac com Apple Silicon).

Os documentos sintéticos (`packages/ppc/src/testes/documentos.ts`, sobre o construtor de `packages/docx/src/testes/sintetico.ts`) são OOXML mínimo escrito à mão: mesclas horizontal, vertical, em bloco e em L, linhas, células e tabelas em `w:sdt`, alterações controladas, tabulações e quebras, hyperlinks, figura PNG, JPEG, EMF, vetorial e apagada, listas automáticas e digitadas, texto de corpo com estilo de título e dois PPCs fictícios completos. Os gabaritos de `packages/ppc/test/fixtures/conversao-docx/` são os artefatos de cada um, que a conversão tem de reproduzir byte a byte (uma mudança deliberada na saída regrava o gabarito do documento afetado), e `partial-ratio-rapidfuzz.json` traz 992 escores do `rapidfuzz`; os testes dos dois pacotes conferem tudo, e `packages/docx/test/leitor.test.ts` cobre os arquivos hostis.

## Identificação do curso

O `preparar-documento` grava em `metadata.json` o curso, o campus, a forma de oferta (`forma_oferta`, repetida em `modalidade`), a modalidade de ensino e o eixo tecnológico, com a fonte de cada um em `identificacao_fontes` (`rotulo`, `capa`, `inicio`, `conversao` ou `nome_arquivo`). A extração (`scripts/identificacao.ts`) é heurística e só lê o próprio PPC, mais as listas de campi e de eixos do CNCT da base; não consulta `base-conhecimento/institucional/ifpr/`, porque o PPC analisado pode não estar lá. Rótulos só valem no início de linha, célula ou trecho em negrito, ou no meio da linha com inicial maiúscula e dois-pontos, e cada valor passa por um validador do campo. Com `.docx`, a extração roda sobre o `PPC.md` da conversão, e os dados da conversão (`_dados.json`) só preenchem o que faltar.

Para medir a identificação nos PPCs técnicos da base contra `base-conhecimento/institucional/ifpr/cursos` (só leitura, como gabarito):

```bash
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts medir-identificacao --erros
```

`--amostra` mede só a amostra fixa usada em `tests/identificacao.test.ts`, e `--json` imprime a medição completa.

## Execução no app (D, S, J)

Cada ficha declara `execucao: { modo, justificativa }`, a classificação da revisão de PPC no app (M1.11, proposta C, no histórico do git em `docs/plans/propostas/m1-11-revisao-ppc-C.md`): **D** (12 fichas), o código decide com a base, sem IA; **S** (38), o código acha o trecho e decide a aplicabilidade, e a IA confirma numa resposta curta; **J** (30), julgamento da IA sobre as seções do tema (as transversais, sobre os resumos). A justificativa diz o que o código usa e o que sobra para a IA. O schema recusa ficha sem `execucao`; `validar-base` recusa ficha D sem verificador registrado em `packages/ppc/src/verificadores/registro.ts` e verificador de ficha que não é D. `indice.json` traz o modo e o verificador de cada ficha (e a contagem por modo em `resumo.fichas_por_execucao`), e `mapa-fichas.md` lista as fichas por modo.

Os verificadores, o que cada um confere, o estado `a_conferir` para tudo o que depende de extração e a precisão medida nos 110 PPCs técnicos da base estão no [README do `packages/ppc`](../../../packages/ppc/README.md#pré-conferência-sem-ia-fichas-d) e em [`PRECISAO.md`](../../../packages/ppc/PRECISAO.md). Mudar uma ficha para D é uma edição versionada: o verificador, o registro, os casos de teste e a medição na base entram juntos. A revisão por sub-agentes desta skill continua a avaliar todas as 80 fichas; o modo só muda a revisão no app.

No app (M1.11, etapa 4), as fichas S e J vão à IA conduzidas pelo servidor, não pela skill: lotes S com o recorte que o código acha pelos `consultas` e `ancoras_semanticas` da ficha, um bloco por tema J com as seções dos `topicos_tematicos` e as transversais sobre os resumos dos temas (`packages/ppc/src/revisao-ia/`, descrito no README do `packages/ppc`). O contrato de resposta é o desta skill reduzido (`ficha_id`, `estado` entre os `estados_permitidos` da ficha, `confianca`, `justificativa`, `evidencias[].trecho`, `lacunas`, `revisao_humana_obrigatoria`, mais `o_que_fazer` e `fontes` com os IDs canônicos), conferido em código. Por isso, editar `pergunta`, `rubrica`, `boa_evidencia`, `ma_evidencia`, `escalonar_quando`, `consultas`, `ancoras_semanticas` ou `topicos_tematicos` de uma ficha S ou J muda o que a IA recebe no app; mudar o `modo` de uma ficha muda o bloco em que ela vai.

## Manutenção de fichas

Ao criar, atualizar ou corrigir uma ficha em `base-analise/fichas/`:

1. Garanta que a ficha declare `execucao`, `topicos_tematicos`, `tipo_escopo` e `ancoras_semanticas`.
2. Cite em `referencias_normativas` apenas normas vigentes, por ID canônico, com `dispositivo` e `papel` (veja [Como citar normas nas fichas](base-analise/README.md#como-citar-normas-nas-fichas)). Regras de transição e a norma vigente de cada tema ficam em `base-analise/marcos-normativos.json`; o validador acusa ID inexistente, norma revogada no manifesto ou nos stubs, norma substituída por marco e dispositivo revogado.
3. Atualize `base-analise/topicos-fichas.json` quando a cobertura temática mudar.
4. Mantenha `execucao` coerente com a revisão no app (veja [Execução no app](#execução-no-app-d-s-j)): uma ficha `D` precisa de verificador registrado em `packages/ppc`.
5. Atualize ou crie teste quando a ficha cobrir comportamento novo, regra normativa específica ou regressão já observada.
6. Regenere os artefatos derivados e valide a base.

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
