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

`preparar-documento` converte o `.docx` com o código de `scripts/conversao-docx/`, em TypeScript, e grava em `arquivos-suporte/artefatos-conversao/` o Markdown normalizado, o Markdown bruto, `<nome>_dados.json`, `<nome>_matriz_curricular.json`, `<nome>_ementario.json` e, quando há, `imagens/representacao_grafica.<ext>`. Até 16/11/2026 essa conversão era em Python (`conversao_docx/`, sobre `python-docx`); a trilha T3 do `PLANO-ARQUITETURA.md` a substituiu, com a mesma saída salvo o que está em [Diferenças em relação à conversão em Python](#diferenças-em-relação-à-conversão-em-python).

O código tem duas camadas, e a de baixo não sabe o que é um PPC:

| Módulo | Papel |
|---|---|
| `ooxml/pacote.ts` | O ZIP do DOCX (`fflate`): partes, relações, XML e binários. Só o XML é descompactado na abertura. |
| `ooxml/xml.ts` | XML em árvore (`htmlparser2`), com os nomes resolvidos pela URI do namespace, não pelo prefixo. |
| `ooxml/leitor.ts`, `ooxml/modelo.ts` | Modelo intermediário do documento: parágrafos (estilo, recuo, runs com formatação direta, hyperlinks, figura), tabelas (células com `gridSpan`, `vMerge` e os dois textos, o dos parágrafos diretos e o de todos os `w:t`) e propriedades. |
| `elementos.ts` | Do modelo aos elementos do PPC: título (pelo estilo ou por numeração e negrito), parágrafo, item de lista, tabela (grade com a célula mesclada repetida, ou leitura direta para tabelas em `w:sdt`) e figura. |
| `secoes.ts` | Hierarquia de seções e dados de identificação das seções de apresentação. |
| `tabelas.ts` | Tabela em grade regular e em Markdown. |
| `matriz.ts` | Matriz curricular nos formatos `legacy` e `nucleos_ftp_fgb_np`, mescla das partes, Markdown canônico. |
| `ementario.ts`, `similaridade.ts` | Quadros do ementário e separação das referências ABNT; `partialRatio` reproduz o `fuzz.partial_ratio` do `rapidfuzz`. |
| `identificacao-tabelas.ts` | Pares campo-valor das tabelas de identificação. |
| `figura.ts` | Seção da representação gráfica: imagem embutida, arquivo vetorial ou aviso. |
| `markdown.ts`, `conversao.ts` | Markdown bruto, normalização (`../normalizador-markdown.ts`), JSONs e gravação. |

O leitor tem dois modos (`Fidelidade` em `ooxml/leitor.ts`). O padrão, `documento`, lê o texto que o Word mostra. O modo `python-docx` reproduz o que o `python-docx` lia e existe para o diferencial.

### Diferenças em relação à conversão em Python

Deliberadas, no modo padrão:

- **Alterações controladas.** O `python-docx` só lê os runs filhos diretos do parágrafo, e o texto inserido com o controle de alterações ligado (`w:ins`) sumia do `PPC.md`: "está previst na Resolução", "### e formas de acesso" no lugar de "### 1.1.2 Requisitos e formas de acesso". Agora entram os runs de `w:ins`, `w:moveTo`, `w:smartTag`, `w:sdt` em linha, `w:fldSimple` e `w:customXml`; o texto removido (`w:del`, `w:moveFrom`) continua de fora. Em 3 dos 12 PPCs do corpus isso muda 34, 89 e 131 linhas do `PPC.md`.
- **Representação gráfica.** A figura desenhada com formas do Word não é mais renderizada (a conversão antiga chamava o MS Word e o poppler). O `_dados.json` traz `metodo: "vetorial_nao_renderizada"` (ou `"figura_nao_localizada"`, quando a seção não tem figura reconhecida) e o `PPC.md` recebe, depois do título da seção, um parágrafo `**Aviso da conversão:** …`. Um EMF ou WMF embutido é copiado como está (`metodo: "vetorial_arquivo_cru"`, com `arquivo_vetorial`), sem contar como imagem extraída. A imagem legada (`v:imagedata` em `w:pict` ou `w:object`) é reconhecida. A imagem sai com a extensão dela: a conversão antiga gravava qualquer formato como `representacao_grafica.png`.
- **Propriedades do documento.** Sem `docProps/core.xml` (exportação do Google Docs), `metadata_documento` fica vazio; o `python-docx` inventava `title: "Word Document"`, `last_modified_by: "python-docx"` e a hora da conversão como `modified`.
- **Robustez.** Mescla vertical malformada (continuação sem célula acima na mesma coluna) e imagem com relação externa não abortam mais a conversão. O prefixo de namespace do XML é livre.
- **Referências do ementário.** A busca aproximada de locais usa sempre a medida do `rapidfuzz`. A conversão antiga, sem o `rapidfuzz` instalado, caía num cálculo com `difflib`, com escores diferentes.

Defeitos conhecidos da conversão antiga, mantidos para a saída não mudar (candidatos a correção, com o diferencial como rede):

- runs em negrito colados saem como `**a**b**` (deveria ser `**ab**`);
- a numeração automática do Word (`w:numPr`) não é lida: listas e títulos numerados pelo Word saem sem o número, e só o estilo de lista ou o marcador digitado fazem um item;
- alíneas digitadas (`a) texto`) viram `1. a) texto`;
- `resumo_matriz_curricular.total_ha` e `total_hr` são sempre 0 (os totais válidos estão em `totais`);
- o texto de uma tabela aninhada não entra na célula que a contém; o que vem antes do primeiro título (capa) fica fora do Markdown.

### Diferencial contra a conversão em Python

`scripts/dev/diferencial-docx.ts` é uma ferramenta de desenvolvimento, fora da skill e do app: extrai a conversão em Python do commit `c0d6f07` (`git archive`), roda-a num ambiente temporário (`uv run --with python-docx==1.2.0 --with rapidfuzz==3.14.6`; nada é instalado) e compara com a conversão em TypeScript. Precisa de `git`, `uv` e `diff`.

```bash
node .agents/skills/revisar-ppc/scripts/dev/diferencial-docx.ts                      # só os documentos sintéticos
KB_CORPUS_DOCX="/pasta/com/ppcs" node .agents/skills/revisar-ppc/scripts/dev/diferencial-docx.ts
node .agents/skills/revisar-ppc/scripts/dev/diferencial-docx.ts --gravar-gabaritos   # regrava os gabaritos dos testes
```

Para cada documento, compara a camada de elementos (o que o `DocxReader` do Python lia contra o leitor no modo `python-docx`) e os artefatos finais, byte a byte, e conta as linhas do `PPC.md` que mudam no modo padrão. Duas diferenças são neutralizadas antes da comparação e relatadas por documento: `propriedades-inventadas` e `figura-nao-renderizada` (as duas descritas acima). A saída vai para `tmp/diferencial-docx/` (artefatos, `.diff` e `relatorio.md`), e o código de saída é 1 se sobrar diferença.

O corpus de PPCs reais fica fora do git (são minutas, com nomes de revisores): `KB_CORPUS_DOCX` aponta para a pasta, que é lida no lugar. Em 16/11/2026, com 12 PPCs técnicos reais e 11 documentos sintéticos, não sobrou diferença: elementos e artefatos idênticos nos 23, com `propriedades-inventadas` em 4 PPCs e `figura-nao-renderizada` em 3. A conversão em TypeScript levou de 0,11 a 0,26 s por PPC, contra 0,85 a 2,2 s do Python (Node 26.12.1 e Python 3.12, num Mac com Apple Silicon).

Os documentos sintéticos (`tests/apoio/docx-sintetico.ts`) são OOXML mínimo escrito à mão: mesclas horizontal, vertical, em bloco e em L, células e tabelas em `w:sdt`, alterações controladas, tabulações e quebras, hyperlinks, figura PNG, JPEG, EMF e vetorial, listas e dois PPCs fictícios completos. Os gabaritos de `tests/fixtures/conversao-docx/` são a saída do Python para eles, e `tests/fixtures/partial-ratio-rapidfuzz.json` traz 992 escores do `rapidfuzz`; `tests/conversao-docx.test.ts` e `tests/similaridade.test.ts` conferem os dois sem precisar de Python.

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
