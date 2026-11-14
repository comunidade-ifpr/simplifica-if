## Resumo

Centro canônico da base de análise do `revisar-ppc`. Reúne, em um único lugar, as fontes estruturadas que orientam a leitura do PPC.

## Estrutura

- `fichas/` — verificações analíticas executadas por lote sobre o PPC completo.
- `topicos-fichas.json` — taxonomia semântica que organiza as fichas por tema, sem depender da numeração do PPC.
- `mapa-fichas.md` — visão legível da taxonomia para consulta rápida.
- `validacoes-cruzadas/` — verificações transversais de coerência entre seções e achados.
- `marcos-normativos.json` — registro único dos temas normativos (DCN da EPT, DCNEM, EJA, assistência estudantil): identificação (`id`, `tema`, `linha` com os atos do tema por ID canônico, `aplica_a`, fichas), regra de transição e orientação de análise. A norma vigente, as substituídas, as antecessoras e os dispositivos revogados são derivados de `base-conhecimento/relacoes.yaml` na leitura (`scripts/marcos.ts`). É injetado nos subagentes, com os campos derivados, as normas por extenso e as citações do PPC às normas de cada marco, em `contextos.fundamentacao_normativa.marcos_normativos`.
- `contratos/` — exemplos mínimos de payload e formatos de referência.
- `schemas/` — contratos JSON Schema para fichas, marcos, validações cruzadas e respostas. `ficha.schema.json` e `marcos-normativos.schema.json` são gerados do Effect Schema de `scripts/esquemas.ts` (veja [Schemas](#schemas)); os demais são editados à mão.
- `indice.json` — índice consolidado da base de análise, gerado a partir dos JSONs reais.
- `mapa-fichas.md` também lista, no fim, as fichas que citam cada norma.

O CNCT usado pela skill vem da base unificada em `base-conhecimento/catalogos/cnct/`.

## Tópicos das fichas

As fichas usam `topicos_tematicos`, `tipo_escopo` e `ancoras_semanticas`.

Esses campos apontam para tópicos semânticos, como estágio, avaliação da aprendizagem, AEE, infraestrutura, matriz curricular ou referências normativas. Não use números fixos nem nomes de seções como contrato da ficha: a numeração e os títulos reais devem ser inferidos durante a rodada de análise a partir das âncoras.

Use `topicos-fichas.json` como fonte canônica e `mapa-fichas.md` para consulta humana.

Ao criar ou editar uma ficha, mantenha a ficha e a taxonomia sincronizadas:

1. A ficha deve citar tópicos existentes em `topicos-fichas.json`.
2. Cada tópico deve citar todas as fichas que pertencem a ele.
3. `mapa-fichas.md` e `indice.json` são gerados; não edite manualmente.

Os tópicos também decidem os grupos de sub-agente da rodada: cada ficha vai no grupo do seu tópico principal (o de menos fichas entre os seus `topicos_tematicos`; no empate, o primeiro na ordem deste arquivo), e as de `tipo_escopo: transversal` vão num grupo com o PPC inteiro. O grupo recebe as seções do PPC dos tipos ligados aos tópicos das suas fichas em `packages/kb/dados/topicos-secoes.yaml`; ao criar um tópico, acrescente-o lá também. As `consultas` da ficha são buscadas no PPC e trazem a melhor seção de cada uma: prefira termos que apareçam no texto do PPC.

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

- `ref`: ID canônico do ato, nunca texto livre. Use o `id` de `base-conhecimento/manifest.json` (norma com texto na base) ou de `base-conhecimento/normas/stubs.yaml` (norma sem texto, `externo:`); para o CNCT, `cnct:catalogo` ou `cnct:<id do curso>` de `catalogos/cnct/index.json`. A variante de arquivo (`~compilacao`) não é citável: cite o ato. Para descobrir o ID de uma citação, use `pnpm kb resolver "Resolução CNE/CP nº 2/2026, art. 28, VII"`. Norma que ainda não existe na base entra antes em `stubs.yaml`.
- `dispositivo` (opcional): um único dispositivo, no formato `#art28-vii`, `#art28-par1-iv`, `#art24-parunico`, `#art36A` ou `#art5-ii-al-a`. Para citar vários dispositivos da mesma norma, repita a entrada, em sequência; sem `dispositivo`, a referência é ao ato inteiro.
- `papel`: `fundamento` quando a ficha aplica a regra da referência para decidir o estado; `complementar` quando só remete a ela (contexto, fonte local a que o PPC deve remeter, parâmetro técnico ou norma referida por outra).
- `nota` (opcional): detalhe da citação que não cabe nos campos anteriores, como o número SEI ou o recorte do catálogo.

O texto legível é renderizado da estrutura (`@simplifica-if/kb/normas/referencia-estruturada`): entradas consecutivas da mesma norma e do mesmo papel viram uma citação, com o título canônico, os dispositivos por extenso e a nota depois de " — ". O exemplo acima vira "Resolução CNE/CP nº 2/2026, arts. 29 e 37, § 3º", "Nota Técnica PROENS/IFPR nº 1/2025 — SEI nº 3881287", "ABNT NBR 6023" e "Catálogo Nacional de Cursos Técnicos (CNCT)". É esse texto, com o papel, o ID e o arquivo da norma na base (`path`, relativo a `base-conhecimento/`), que vai para os sub-agentes, para `indice.json` (que também lista os IDs em `normas_citadas`) e para `mapa-fichas.md`.

## Vigência das normas

A vigência de cada norma vem de `base-conhecimento/manifest.json` (campo `status_vigencia`, calculado na `data_referencia` de `base-conhecimento/config/vigencia.yaml` a partir de `base-conhecimento/relacoes.yaml`; a norma revogadora aparece em `revogada_por`, gerado no front matter do arquivo indicado em `path`) ou, para stubs, de `base-conhecimento/normas/stubs.yaml` (`status_vigencia` e `status_fonte`). `marcos-normativos.json` guarda só a `linha` de cada tema (IDs dos atos, do mais antigo ao mais recente conhecido), a `transicao` e a `orientacao_analise`; `vigente`, `substitui`, `antecessoras_historicas` (IDs de ato) e `dispositivos_revogados` (ato com dispositivo, `br/cne-ceb/res/2025/3#art6-iii`) são derivados das relações na leitura (`derivarLinha`, em `packages/kb/src/normas/vigencia.ts`): uma nova norma que revogue a vigente passa a ser a vigente do marco sem editar o arquivo. As regras de transição como dado estão em `base-conhecimento/transicoes.yaml`. O validador confere tudo por ID:

- `ref` e `dispositivo` fora do formato canônico são erro de schema;
- uma ficha não pode citar ID inexistente na base, norma `revogada` (no manifesto ou no stub), norma listada em `substitui` ou `antecessoras_historicas` de um marco, nem dispositivo listado em `dispositivos_revogados` ou contido nele (`#art6-iii-al-a` dentro de `#art6-iii`); também não pode repetir a mesma referência;
- a `linha` de cada marco precisa citar IDs registrados e derivar um ato vigente; a norma `vigente` derivada precisa ter texto na base (manifesto) e não estar revogada; as normas de `substitui`, `antecessoras_historicas` e `dispositivos_revogados` precisam existir na base, e nenhuma de `substitui` pode continuar `vigente`;
- os IDs em `fichas_responsaveis` e `fichas_base_legal` precisam existir;
- sem o manifesto, a validação falha em vez de pular a checagem.

A existência do dispositivo no texto da norma ainda não é conferida: depende do parser de dispositivos (fase 5 do plano de arquitetura). As validações cruzadas não têm `referencias_normativas` e ficam fora dessa checagem; elas remetem aos marcos no texto da rubrica.

Quando uma norma da base for revogada, rode o validador: ele lista as fichas a revisar. Atualize as fichas e o marco correspondente em `marcos-normativos.json`. Escreva a regra de transição e a orientação de análise no marco, em vez de repeti-las em cada ficha; as fichas podem remeter a `contextos.fundamentacao_normativa.marcos_normativos`.

## Schemas

O contrato da ficha e o de `marcos-normativos.json` são os Effect Schemas de `scripts/esquemas.ts`, a fonte única. `schemas/ficha.schema.json` e `schemas/marcos-normativos.schema.json` são gerados deles por `gerar-schemas` (`Schema.toJsonSchemaDocument`, draft 2020-12), para documentação, para o `indice.json` e para o ajv, que dá as mensagens de erro do validador (`$.referencias_normativas[0].ref: valor '...' fora do formato`). `gerar-schemas --check` e `validar-base` acusam schema gerado desatualizado. Ao mudar o contrato, edite `scripts/esquemas.ts` (ou `esquemaReferenciaNormativa`, no `packages/kb`) e rode `gerar-schemas`; não edite os dois JSON Schemas à mão. Os esquemas não usam refinamentos, para que tudo o que exigem caiba no JSON Schema.

## Uso recomendado

1. Consulte `mapa-fichas.md` quando quiser saber quais fichas avaliam cada tema.
2. Consulte `indice.json` quando quiser localizar rapidamente itens por ID, categoria, domínio, criticidade ou tópico.
3. Abra `fichas/` quando a pergunta for sobre cobertura analítica por item.
4. Abra `validacoes-cruzadas/` quando a pergunta for sobre coerência transversal.
5. Abra `contratos/` quando a dúvida for sobre formato de entrada ou saída.

## Manutenção

Rode a partir da raiz do repositório sempre que alterar fichas, tópicos, validações cruzadas, contratos ou schemas:

```bash
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts gerar-schemas
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts validar-base
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts gerar-mapa
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts gerar-indice
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts validar-base
pnpm exec vp test run .agents/skills/revisar-ppc
python3 -m pytest .agents/skills/revisar-ppc/tests
```

O `pnpm exec vp test run .agents/skills/revisar-ppc` cobre a validação da base, a orquestração da análise, o relatório HTML e a publicação no Surge, em TypeScript; o `pytest` cobre só o que ainda é Python (extratores da conversão DOCX).
