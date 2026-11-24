# Base da revisão de PPC

As fichas da revisão de PPC são os critérios com que a tarefa "Revisar um PPC" do app confere um Projeto Pedagógico de Curso técnico antes da submissão à PROENS. Elas ficam aqui junto com os arquivos que as organizam. É uma revisão prévia: não substitui a análise oficial da PROENS nem emite parecer.

O kb compila as fichas, os tópicos e os marcos no `kb.sqlite` (`pnpm kb:compilar`). O app, o `simplifica-mcp` (recurso `ifpr://ficha/<ID>`, ferramentas `pacote_contexto` e `impacto_da_norma`) e o Explorar leem o banco, não estes arquivos.

## Estrutura

- `fichas/`: um JSON por ficha (`ct-*.json`), com pergunta, rubrica, evidências, referências normativas, estados permitidos e o modo de execução no app.
- `topicos-fichas.json`: a taxonomia semântica que organiza as fichas por tema, sem depender da numeração do PPC. Cada tópico lista as suas fichas; os tipos de seção do PPC de cada tópico estão em `packages/kb/dados/topicos-secoes.yaml`.
- `marcos-normativos.json`: os temas normativos (DCN da EPT, DCNEM, EJA, assistência estudantil). Cada um traz a identificação (`id`, `tema`, `linha` com os atos do tema por ID canônico, `aplica_a`, fichas), a regra de transição e a orientação de análise. A norma vigente, as substituídas, as antecessoras e os dispositivos revogados são derivados de `base-conhecimento/relacoes.yaml` na leitura.

Os contratos da ficha e dos marcos vivem em Effect Schema em `scripts/base/revisao-ppc/esquemas.ts` e são conferidos por `validar_base.ts`.

## Execução no app (D, S, J)

Cada ficha declara `execucao: { modo, justificativa }`. A justificativa diz o que o código usa e o que sobra para a IA.

- **D**: o código decide com a base, sem IA. Cada ficha D tem um verificador registrado em `packages/ppc/src/verificadores/registro.ts`.
- **S**: o código acha o trecho pelas `consultas` e `ancoras_semanticas` da ficha e decide a aplicabilidade; a IA confirma numa resposta curta.
- **J**: a IA julga as seções do tema, que vêm dos `topicos_tematicos` da ficha. As de `tipo_escopo: transversal` vão numa sessão no fim, sobre os resumos dos temas e o recorte das seções dos tópicos delas.

Os verificadores, o estado `a_conferir` de tudo o que depende de extração e a precisão medida nos PPCs técnicos da base estão no [README do `packages/ppc`](../../packages/ppc/README.md#pré-conferência-sem-ia-fichas-d). Passar uma ficha para D é uma mudança versionada: o verificador, o registro e os casos de teste entram no mesmo commit.

O contrato de resposta da IA é conferido em código (`packages/ppc/src/revisao-ia/`): `ficha_id`, `estado` entre os `estados_permitidos` da ficha, `confianca`, `justificativa`, `evidencias[].trecho`, `lacunas`, `o_que_fazer` e `fontes` com os IDs canônicos. Por isso, editar `pergunta`, `rubrica`, `boa_evidencia`, `ma_evidencia`, `escalonar_quando`, `consultas`, `ancoras_semanticas` ou `topicos_tematicos` de uma ficha S ou J muda o que a IA recebe no app. Mudar o `modo` muda o bloco em que a ficha vai.

### Coerência entre seções

As fichas transversais (`CT-TRANS-*`) conferem a coerência entre seções. Até 21/11/2026, as antigas validações cruzadas da skill `revisar-ppc` (29 arquivos `VC-*`) faziam esse papel. Elas viraram fichas ou passaram para verificadores:

- **Normas citadas no texto e ausentes das referências** (as de identificação, organização curricular e atendimento, inclusive AEE e inclusão): verificador da CT-SUP-09, em código.
- **Fichas novas** (as antigas cruzadas de cada uma entre parênteses):
  - CT-TRANS-09: inclusão e AEE coerentes entre atendimento, currículo e avaliação (05×07, 07×05, 07×06);
  - CT-TRANS-10: profissional de educação especial e acessibilidade da infraestrutura (05×08 do AEE, 07×09);
  - CT-TRANS-11: estágio consistente em todo o PPC (05-14);
  - CT-TRANS-12: fechamento aritmético entre horário, dias letivos e carga horária (05-16).
- **Rubricas que absorveram as antigas cruzadas:**
  - CT-TRANS-01: objetivos, competências e componentes, nos dois sentidos;
  - CT-TRANS-02: metodologias, avaliação e instrumentos coerentes com a concepção;
  - CT-TRANS-04: docentes e laboratórios para as competências e os componentes;
  - CT-TRANS-08: a matriz pedagogicamente explicitada.
- **Já cobertas por outras fichas:**
  - denominação × CNCT: CT-IDENT-01;
  - carga horária da apresentação × matriz: CT-CURR-02;
  - base legal entre seções: CT-IDENT-08, CT-SUP-09 e CT-SUP-12;
  - bibliografias do ementário: CT-CURR-06;
  - AEE fora da matriz: CT-CURR-22;
  - estágio × perfil: CT-CURR-25;
  - egressos: CT-IDENT-18;
  - habilitação docente por componente: CT-SUP-15.

## Tópicos das fichas

As fichas usam `topicos_tematicos`, `tipo_escopo` e `ancoras_semanticas`, que apontam para tópicos semânticos (estágio, avaliação da aprendizagem, AEE, infraestrutura, matriz curricular, referências normativas…). Não use números nem nomes fixos de seção como contrato da ficha: a mesma ficha tem de funcionar quando o tema aparecer em outro capítulo, item ou título.

Ao criar ou editar uma ficha, mantenha a ficha e a taxonomia sincronizadas:

1. A ficha cita tópicos existentes em `topicos-fichas.json`.
2. Cada tópico lista todas as fichas que pertencem a ele.
3. Tópico novo também entra em `packages/kb/dados/topicos-secoes.yaml`.

As `consultas` da ficha são buscadas no PPC e trazem a melhor seção de cada uma. Prefira termos que apareçam no texto dos PPCs.

## Como citar normas nas fichas

`referencias_normativas` é uma lista de objetos, um por dispositivo citado:

```json
"referencias_normativas": [
  { "ref": "br/cne-cp/res/2026/2", "dispositivo": "#art29", "papel": "fundamento" },
  { "ref": "br/cne-cp/res/2026/2", "dispositivo": "#art37-par3", "papel": "fundamento" },
  { "ref": "ifpr/proens/nt/2025/1", "papel": "fundamento", "nota": "SEI nº 3881287" },
  { "ref": "externo:abnt/nbr/6023", "papel": "complementar" },
  { "ref": "cnct:catalogo", "papel": "fundamento" }
]
```

- `ref`: o ID canônico do ato, nunca texto livre. Use o `id` do front matter da norma em `base-conhecimento/normas/` (norma com texto na base) ou de `base-conhecimento/normas/stubs.yaml` (norma sem texto, `externo:`). Para o CNCT, use `cnct:catalogo` ou `cnct:<id do curso>`. Para achar o ID de uma citação, use `pnpm kb resolver-citacoes "Resolução CNE/CP nº 2/2026, art. 28, VII"`. Norma que ainda não existe na base entra antes em `stubs.yaml`.
- `dispositivo` (opcional): um único dispositivo, no formato `#art28-vii`, `#art28-par1-iv`, `#art24-parunico`, `#art36A` ou `#art5-ii-al-a`. Para citar vários dispositivos da mesma norma, repita a entrada em sequência. Sem `dispositivo`, a referência é ao ato inteiro.
- `papel`: `fundamento` quando a ficha aplica a regra da referência para decidir o estado; `complementar` quando só remete a ela (contexto, fonte local a que o PPC deve remeter, parâmetro técnico ou norma referida por outra).
- `nota` (opcional): o que não cabe nos campos anteriores, como o número SEI ou o recorte do catálogo.

O texto legível sai da estrutura (`@simplifica-if/kb/normas/referencia-estruturada`). Entradas consecutivas da mesma norma e do mesmo papel viram uma citação, com o título canônico, os dispositivos por extenso e a nota depois de " — ". O exemplo acima vira:

- "Resolução CNE/CP nº 2/2026, arts. 29 e 37, § 3º";
- "Nota Técnica PROENS/IFPR nº 1/2025 — SEI nº 3881287";
- "ABNT NBR 6023";
- "Catálogo Nacional de Cursos Técnicos (CNCT)".

## Vigência das normas

A vigência de cada norma vem do front matter dela em `base-conhecimento/normas/` (`status_vigencia`, calculado na `data_referencia` de `config/vigencia.yaml` a partir de `relacoes.yaml`) ou, para stubs, de `normas/stubs.yaml`. `marcos-normativos.json` guarda só a `linha` de cada tema, a `transicao` e a `orientacao_analise`; o resto do marco é derivado das relações na leitura (`derivarLinha`, em `packages/kb/src/normas/vigencia.ts`). Assim, uma norma nova que revogue a vigente passa a ser a vigente do marco sem editar o arquivo. `node scripts/validar_base.ts` confere tudo por ID:

- `ref` e `dispositivo` fora do formato canônico são erro de schema;
- uma ficha não pode citar:
  - ID inexistente na base;
  - norma `revogada` (no manifesto ou no stub);
  - norma listada em `substitui` ou `antecessoras_historicas` de um marco;
  - dispositivo listado em `dispositivos_revogados` ou contido nele;
  - a mesma referência duas vezes;
- a `linha` de cada marco precisa citar IDs registrados e derivar um ato vigente com texto na base;
- as normas derivadas do marco precisam existir, e nenhuma de `substitui` pode continuar `vigente`;
- os IDs em `fichas_responsaveis` e `fichas_base_legal` precisam existir;
- toda ficha D tem verificador registrado, e todo verificador é de uma ficha D.

Quando uma norma da base for revogada, rode o validador: ele lista as fichas a revisar. Escreva a regra de transição e a orientação de análise no marco, em vez de repeti-las em cada ficha.

## Manutenção

A partir da raiz do repositório, depois de alterar fichas, tópicos, marcos ou o contrato da ficha:

```bash
node scripts/validar_base.ts
pnpm exec vp test run scripts/base/revisao-ppc
pnpm kb:compilar
```

Mudança no modo de uma ficha ou num verificador pode ser medida na base com `node packages/ppc/scripts/pre-conferencia.ts --base`.
