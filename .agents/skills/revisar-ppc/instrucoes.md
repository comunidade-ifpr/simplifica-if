# Instruções da Skill Revisão de PPC

## Resumo

Esta skill faz a revisão prévia de um PPC técnico do IFPR, antes da submissão à PROENS, por sub-agentes dentro da conversa. O produto é um relatório de revisão para quem elabora ou acompanha o PPC: não é parecer e não substitui a análise oficial da PROENS. Ao relatar o resultado, use esse vocabulário (revisão, relatório de revisão, ajustes) e não fale em aprovação, diligência ou reprovação. Os scripts são deliberadamente pequenos: convertem o documento para `PPC.md`, montam grupos de fichas e renderizam o PPC HTML anotado a partir do JSON coletado dos sub-agentes.

O ponto de entrada é `scripts/revisar_ppc.ts` (Node), e todos os subcomandos rodam em TypeScript, inclusive `gerar-relatorio-html`, a publicação no Surge e a conversão de entrada `.docx` em `preparar-documento` (pacotes `@simplifica-if/ppc` e `@simplifica-if/docx` do workspace, com leitor OOXML próprio). A skill só precisa do Node: não usa MS Word nem poppler.

O output padrão fica em `.agents/skills/revisar-ppc/output/<rodada>/`. O relatório de revisão fica em `relatorio-revisao.html`; os assets do leitor ficam em `assets/`; os artefatos de suporte ficam em `arquivos-suporte/`.

## Dependências

Rode `pnpm install` na raiz do repositório (o ponto de entrada usa `effect` (`effect/cli`), `htmlparser2` e os pacotes `@simplifica-if/kb`, `@simplifica-if/ppc` e `@simplifica-if/docx` do workspace). Não há dependência fora do Node, nem para a entrada `.docx`.

## Fluxo recomendado

Execute os comandos a partir da raiz deste repositório:

```bash
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts preparar-documento caminho/PPC.docx
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts montar-grupos-subagents --rodada-dir .agents/skills/revisar-ppc/output/<rodada>
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts preparar-prompts-subagents --rodada-dir .agents/skills/revisar-ppc/output/<rodada>
```

Depois disso, o agente principal deve:

1. Ler `arquivos-suporte/grupos-subagents.json` (ou só o resumo impresso por `montar-grupos-subagents`).
2. Ler `prompts/subagent-lote-fichas.md`.
3. Ler os pacotes prontos em `arquivos-suporte/prompts-subagents/*.md` (um por grupo; `manifest.json` lista os arquivos, o tópico e o tamanho de cada um).
4. Spawnar um sub-agente por grupo.
5. Passar a cada sub-agente o pacote do grupo. De forma equivalente: o prompt de trabalho, as fichas do grupo, os blocos de `contextos` e o PPC do escopo do grupo: no escopo `secoes`, as seções listadas em `contextos.ppc.secoes` (linhas de `PPC.md`); no escopo `completo` (grupo `transversal`), o `PPC.md` inteiro.
6. Coletar as respostas em `arquivos-suporte/resultados-subagents.json`.
7. Fazer a etapa de validações cruzadas usando `prompts/sintese-transversal.md`, o PPC completo, todos os resultados, `cnct_contexto`, `contexto_estrutural`, `fundamentacao_normativa` (do topo de `grupos-subagents.json`, com todos os marcos) e `validacoes_cruzadas`; salvar o retorno em `alertas_transversais` dentro de `resultados-subagents.json`.
8. Gerar o relatório:

```bash
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts gerar-relatorio-html --rodada-dir .agents/skills/revisar-ppc/output/<rodada> --resultados resultados-subagents.json
```

## Grupos por tópico e contexto de cada grupo

`montar-grupos-subagents` monta um grupo por tópico de `base-analise/topicos-fichas.json`, na ordem da taxonomia, e um grupo `transversal` por último:

- cada ficha entra uma vez, no grupo do seu tópico principal, o mais específico (menos fichas na taxonomia) dos seus `topicos_tematicos`; no empate, o primeiro na taxonomia;
- as fichas com `tipo_escopo: transversal` vão no grupo `transversal`, que recebe o `PPC.md` inteiro (`escopo_ppc: "completo"`);
- `--tamanho-grupo` (padrão 20) é o máximo de fichas por grupo; tópico maior vira partes equilibradas (`parte`, `partes`).

Cada grupo traz `topico`, `topico_titulo`, `parte`, `partes`, `escopo_ppc` e, em `contextos`:

- `ppc`: o escopo, o caminho do `PPC.md`, os tópicos das fichas do grupo e as seções selecionadas (`id` como no índice de seções, `tipo`, `titulo`, `linha_inicio`, `linha_fim`, `caracteres` e `motivo`: `topico:<id>` pelo tipo da seção ou `busca:<ficha>:<consulta>`). O `PPC.md` é segmentado com a segmentação e a taxonomia técnica do índice de seções (`packages/kb`), num banco em memória, porque o PPC analisado pode não estar na base; as seções dos tipos ligados aos tópicos das fichas (`packages/kb/dados/topicos-secoes.yaml`) entram inteiras, mais a melhor seção de cada consulta das fichas;
- `cnct`, `estrutura` e `anexos_visuais`, como antes;
- `fundamentacao_normativa`: protocolo, manifestos e status, mais o texto dos dispositivos citados pelas fichas do grupo (`normas`, com caput e subordinados), as regras de transição aplicáveis (`transicoes`, na `data_referencia`), os marcos (`marcos_normativos`, com `citacoes_no_ppc`) e, nos grupos com fichas de `referencias_normativas`, todas as citações normativas do PPC (`citacoes_do_ppc`). Tudo vem do `kb.sqlite`, que a CLI recompila sozinha quando está velho.

No pacote de prompt, o escopo `secoes` aparece como `## PPC.md: seções do grupo`, cada seção com um comentário `<!-- seção <id> · linhas a-b · motivo -->` e o texto do `PPC.md`; o JSON do grupo vai sem a lista de seções, que já está no bloco do PPC.

## Contrato de resultados

`resultados-subagents.json` deve conter:

```json
{
  "metadata": {
    "observacao": "opcional"
  },
  "grupos": [
    {
      "grupo_id": "grupo-001",
      "resultados": [
        {
          "ficha_id": "CT-IDENT-01",
          "estado": "ATENDE",
          "confianca": 0.9,
          "justificativa": "Decisão fundamentada no PPC.",
          "evidencias": [
            {
              "trecho": "Trecho ou referência textual do PPC.",
              "secao": "Seção do PPC, quando identificável.",
              "localizador": "Página, item, título ou outro ponto de localização.",
              "fonte": "PPC.md",
              "artefato": "Caminho de artefato estruturado ou visual, quando usado.",
              "anchor": {
                "block_id": "ppc-b00042",
                "quote": "Trecho exato dentro do bloco, quando disponível."
              }
            }
          ],
          "lacunas": [],
          "revisao_humana_obrigatoria": false,
          "fundamentacao_normativa": [
            {
              "status": "CONFIRMADA",
              "trecho_ppc": "Trecho do PPC que afirma algo sobre uma norma.",
              "norma": "Norma consultada.",
              "fonte": "base-conhecimento/normas/...",
              "dispositivo": "Artigo, inciso, parágrafo, seção ou campo do CNCT.",
              "evidencia": "Resumo fiel do dispositivo consultado.",
              "analise": "Relação entre a fonte e a afirmação do PPC.",
              "recomendacao": "Ajuste sugerido, quando aplicável."
            }
          ],
          "feedback_autores": "Campo opcional para fichas que solicitam texto de feedback aos autores do PPC."
        }
      ]
    }
  ]
}
```

O renderizador valida campos obrigatórios, fichas duplicadas, fichas ausentes, fichas desconhecidas e quantidade mínima de evidências por ficha antes de gerar o HTML. `evidencias` aceita strings legadas, mas o formato preferido é objeto estruturado com `trecho`, `secao`, `localizador`, `fonte`, `artefato` e `anchor`; outra chave na evidência (como `seção`) é recusada.
O campo opcional `anchor` deve conter `block_id` e `quote`; quando ausente, o renderizador tenta localizar a anotação por trecho, localizador ou seção.
Quando uma ficha declarar `feedback_autores.obrigatorio_quando_estado`, o renderizador também valida a presença de `feedback_autores` para os estados indicados.
O campo `fundamentacao_normativa` é opcional, mas deve ser usado quando a ficha avaliar afirmação do PPC sobre lei, resolução, portaria, nota técnica, regulamento, CNCT ou outro documento normativo. Quando informado, ele aparece no relatório HTML dentro da ficha correspondente.

## Contexto CNCT

`montar-grupos-subagents` identifica a entrada provável do CNCT para o curso usando a base unificada em `base-conhecimento/catalogos/cnct/index.json` e os arquivos `base-conhecimento/catalogos/cnct/cursos/*.json`. O contexto é salvo em:

```text
arquivos-suporte/cnct-contexto.json
```

O mesmo contexto aparece no topo de `grupos-subagents.json` como `cnct_contexto`. Grupos com fichas que mencionam CNCT ou `contexto_estrutural.cnct` recebem também `requer_contexto_cnct: true` e `contextos.cnct`. Passe esse bloco ao sub-agente junto com o PPC e as fichas do grupo. O curso identificado é o mesmo registro da tabela `cnct` do `kb.sqlite` (`cnct:<id>`).

## Validações cruzadas

`montar-grupos-subagents` também salva:

```text
arquivos-suporte/validacoes-cruzadas-contexto.json
```

Esse bloco contém as validações transversais canônicas de `base-analise/validacoes-cruzadas/`. Na etapa de síntese transversal, todo alerta deve informar `validacao_id`, apontando para a validação cruzada que fundamenta o alerta.

## Contexto estrutural e anexos visuais

`montar-grupos-subagents` também salva:

```text
arquivos-suporte/contexto-estrutural-subagents.json
```

Esse bloco resume artefatos extraídos do DOCX, como identificação, matriz curricular, ementário e caminhos dos JSONs estruturados. Ele é incluído como `contextos.estrutura` em todos os grupos. Quando a representação gráfica do processo formativo é extraída e o grupo contém `CT-CURR-10`, o grupo recebe `contextos.anexos_visuais` com o caminho absoluto da imagem.

## Fundamentação normativa

`montar-grupos-subagents` também inclui `contextos.fundamentacao_normativa` nos grupos com fichas que citam ou dependem de base legal. Esse contexto traz o texto dos dispositivos citados pelas fichas, as regras de transição e os marcos (do `kb.sqlite`) e aponta para `base-conhecimento/` e para a skill `verificar-fundamentacao-normativa`.

Quando um PPC afirmar algo sobre lei, resolução, portaria, nota técnica, CNCT ou regulamento, o sub-agente deve consultar a fonte antes de validar a alegação. A saída da ficha deve registrar os achados no campo `fundamentacao_normativa` usando os status:

```text
CONFIRMADA
CONFIRMADA_COM_RESSALVA
IMPRECISA
SEM_SUPORTE_NA_FONTE
CONTRADITORIA
FONTE_AUSENTE_OU_NAO_CONSULTADA
NAO_NORMATIVA
```

## Reavaliação avulsa

Para reavaliar fichas específicas sem refazer todos os grupos:

```bash
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts montar-grupo-avulso --rodada-dir .agents/skills/revisar-ppc/output/<rodada> --ficha-id CT-IDENT-01
```

O grupo avulso usa o mesmo pacote por tópico: as seções do `PPC.md` dos tópicos das fichas pedidas (ou o PPC inteiro, se alguma for transversal), as normas, as transições e os marcos. O comando grava `grupos-avulsos/<grupo>.json` e o pacote de prompt `grupos-avulsos/<grupo>.md` (`prompt_subagent_path`). Spawnar um sub-agente com esse pacote, salvar a resposta em `arquivos-suporte/resultado-avulso.json` e mesclar:

```bash
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts mesclar-resultados-avulsos --rodada-dir .agents/skills/revisar-ppc/output/<rodada> --resultados-avulsos resultado-avulso.json
```

Depois, rode novamente `gerar-relatorio-html`.

## Manutenção da base de análise

Ao alterar fichas, validações cruzadas, contratos, schemas ou a taxonomia temática, atualize os artefatos derivados e rode a suíte da skill.

Checklist para fichas:

1. Edite a ficha em `base-analise/fichas/`.
2. Garanta `topicos_tematicos`, `tipo_escopo` e `ancoras_semanticas`. Cite normas em `referencias_normativas` por ID canônico, com `dispositivo` e `papel` (veja "Como citar normas nas fichas" em `base-analise/README.md`).
3. Atualize `base-analise/topicos-fichas.json` quando o tema ou a cobertura da ficha mudar.
4. Atualize teste quando a ficha introduzir regra nova, regressão observada ou comportamento que não deve se perder.
5. Regenere `base-analise/mapa-fichas.md` e `base-analise/indice.json` (`gerar-mapa --check` e `gerar-indice --check` só conferem, sem reescrever).

Comandos obrigatórios:

```bash
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts gerar-schemas --check
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts validar-base
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts gerar-mapa
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts gerar-indice
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts validar-base
pnpm exec vp test run .agents/skills/revisar-ppc
```

## Situação da revisão

`gerar-relatorio-html` e `validar-resultados` devolvem `situacao` (e o primeiro, também `situacao_rotulo`), calculada por `situacao` em `scripts/resultados.ts`:

- `REVISAO_SUBSTANCIAL` (Revisão substancial necessária): alguma ficha `BLOQ` com `NAO_ATENDE` ou algum alerta transversal `BLOQ`;
- `AJUSTES_NECESSARIOS` (Ajustes necessários): alguma ficha `OBRIG` com `NAO_ATENDE` ou algum alerta transversal `OBRIG` (a criticidade padrão do alerta);
- `APTO_COM_RESSALVAS` (Apto com ressalvas): alguma ficha `INCONCLUSIVO`, ou ficha ou alerta transversal com `revisao_humana_obrigatoria`;
- `APTO_PARA_SUBMISSAO` (Apto para submissão): nenhum dos casos acima.

O relatório mostra o rótulo e avisa, no cabeçalho e no rodapé, que a revisão é prévia e não substitui a análise oficial da PROENS.

## Entrega do relatório

Ao concluir `gerar-relatorio-html`, use preferencialmente a URL `surge_url` ou `publicacao_url` retornada pelo comando para avisar a pessoa, com o `situacao_rotulo`. O comando publica o HTML interativo no Surge por padrão e também mantém o arquivo local em `relatorio_html`. Se a publicação externa não for desejada, rode com `--sem-surge`.

```text
Relatório de revisão pronto (Ajustes necessários): [abrir relatório](https://revisar-ppc-<rodada>.surge.sh)
```

Lembre que é uma revisão prévia à submissão, que não substitui a análise oficial da PROENS.

Não peça para a pessoa procurar o arquivo dentro dos artefatos.
