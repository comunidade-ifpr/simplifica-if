## Resumo

Centro canônico da base de análise do `analise-ppc`. Reúne, em um único lugar, as fontes estruturadas que orientam a leitura do PPC.

## Estrutura

- `fichas/` — verificações analíticas executadas por lote sobre o PPC completo.
- `topicos-fichas.json` — taxonomia semântica que organiza as fichas por tema, sem depender da numeração do PPC.
- `mapa-fichas.md` — visão legível da taxonomia para consulta rápida.
- `validacoes-cruzadas/` — verificações transversais de coerência entre seções e achados.
- `marcos-normativos.json` — registro único da norma vigente de cada tema (DCN da EPT, DCNEM, EJA, assistência estudantil), das normas que ela substituiu e das regras de transição, com as normas por ID canônico. É injetado nos subagentes, com as normas por extenso, em `contextos.fundamentacao_normativa.marcos_normativos`.
- `contratos/` — exemplos mínimos de payload e formatos de referência.
- `schemas/` — contratos JSON Schema para fichas, marcos, validações cruzadas e respostas. `ficha.schema.json` e `marcos-normativos.schema.json` são gerados do zod de `scripts/esquemas.ts` (veja [Schemas](#schemas)); os demais são editados à mão.
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

- `ref`: ID canônico do ato, nunca texto livre. Use o `id` de `base-conhecimento/manifest.json` (norma com texto na base) ou de `base-conhecimento/normas/stubs.yaml` (norma sem texto, `externo:`); para o CNCT, `cnct:catalogo` ou `cnct:<id do curso>` de `catalogos/cnct/index.json`. A variante de arquivo (`~compilacao`) não é citável: cite o ato. Para descobrir o ID de uma citação, use `bun run kb resolver "Resolução CNE/CP nº 2/2026, art. 28, VII"`. Norma que ainda não existe na base entra antes em `stubs.yaml`.
- `dispositivo` (opcional): um único dispositivo, no formato `#art28-vii`, `#art28-par1-iv`, `#art24-parunico`, `#art36A` ou `#art5-ii-al-a`. Para citar vários dispositivos da mesma norma, repita a entrada, em sequência; sem `dispositivo`, a referência é ao ato inteiro.
- `papel`: `fundamento` quando a ficha aplica a regra da referência para decidir o estado; `complementar` quando só remete a ela (contexto, fonte local a que o PPC deve remeter, parâmetro técnico ou norma referida por outra).
- `nota` (opcional): detalhe da citação que não cabe nos campos anteriores, como o número SEI ou o recorte do catálogo.

O texto legível é renderizado da estrutura (`@simplifica-if/kb/normas/referencia-estruturada`): entradas consecutivas da mesma norma e do mesmo papel viram uma citação, com o título canônico, os dispositivos por extenso e a nota depois de " — ". O exemplo acima vira "Resolução CNE/CP nº 2/2026, arts. 29 e 37, § 3º", "Nota Técnica PROENS/IFPR nº 1/2025 — SEI nº 3881287", "ABNT NBR 6023" e "Catálogo Nacional de Cursos Técnicos (CNCT)". É esse texto, com o papel, o ID e o arquivo da norma na base (`path`, relativo a `base-conhecimento/`), que vai para os sub-agentes, para `indice.json` (que também lista os IDs em `normas_citadas`) e para `mapa-fichas.md`.

## Vigência das normas

A vigência de cada norma vem de `base-conhecimento/manifest.json` (campo `status_vigencia`; a norma revogadora fica em `revogada_por`, no front matter do arquivo indicado em `path`) ou, para stubs, de `base-conhecimento/normas/stubs.yaml` (`status_vigencia` e `status_fonte`). `marcos-normativos.json` cita as normas por ID: `vigente`, `substitui` e `antecessoras_historicas` com o ID do ato; `dispositivos_revogados` com o ID do ato e o dispositivo (`br/cne-ceb/res/2025/3#art6-iii`). Os textos `transicao` e `orientacao_analise` continuam em prosa. O validador confere tudo por ID:

- `ref` e `dispositivo` fora do formato canônico são erro de schema;
- uma ficha não pode citar ID inexistente na base, norma `revogada` (no manifesto ou no stub), norma listada em `substitui` ou `antecessoras_historicas` de um marco, nem dispositivo listado em `dispositivos_revogados` ou contido nele (`#art6-iii-al-a` dentro de `#art6-iii`); também não pode repetir a mesma referência;
- a norma `vigente` de cada marco precisa ter texto na base (manifesto) e não estar revogada; as normas de `substitui`, `antecessoras_historicas` e `dispositivos_revogados` precisam existir na base, e nenhuma de `substitui` pode continuar `vigente`;
- os IDs em `fichas_responsaveis` e `fichas_base_legal` precisam existir;
- sem o manifesto, a validação falha em vez de pular a checagem.

A existência do dispositivo no texto da norma ainda não é conferida: depende do parser de dispositivos (fase 5 do plano de arquitetura). As validações cruzadas não têm `referencias_normativas` e ficam fora dessa checagem; elas remetem aos marcos no texto da rubrica.

Quando uma norma da base for revogada, rode o validador: ele lista as fichas a revisar. Atualize as fichas e o marco correspondente em `marcos-normativos.json`. Escreva a regra de transição e a orientação de análise no marco, em vez de repeti-las em cada ficha; as fichas podem remeter a `contextos.fundamentacao_normativa.marcos_normativos`.

## Schemas

O contrato da ficha e o de `marcos-normativos.json` são os esquemas zod de `scripts/esquemas.ts`, a fonte única. `schemas/ficha.schema.json` e `schemas/marcos-normativos.schema.json` são gerados deles por `gerar-schemas`, para documentação, para o `indice.json` e para o ajv, que dá as mensagens de erro do validador (`$.referencias_normativas[0].ref: valor '...' fora do formato`). `gerar-schemas --check` e `validar-base` acusam schema gerado desatualizado. Ao mudar o contrato, edite `scripts/esquemas.ts` (ou `esquemaReferenciaNormativa`, no `packages/kb`) e rode `gerar-schemas`; não edite os dois JSON Schemas à mão. Os esquemas não usam refinamentos, para que tudo o que exigem caiba no JSON Schema.

## Uso recomendado

1. Consulte `mapa-fichas.md` quando quiser saber quais fichas avaliam cada tema.
2. Consulte `indice.json` quando quiser localizar rapidamente itens por ID, categoria, domínio, criticidade ou tópico.
3. Abra `fichas/` quando a pergunta for sobre cobertura analítica por item.
4. Abra `validacoes-cruzadas/` quando a pergunta for sobre coerência transversal.
5. Abra `contratos/` quando a dúvida for sobre formato de entrada ou saída.

## Manutenção

Rode a partir da raiz do repositório sempre que alterar fichas, tópicos, validações cruzadas, contratos ou schemas:

```bash
bun run .agents/skills/analise-ppc/scripts/analise_ppc.ts gerar-schemas
bun run .agents/skills/analise-ppc/scripts/analise_ppc.ts validar-base
bun run .agents/skills/analise-ppc/scripts/analise_ppc.ts gerar-mapa
bun run .agents/skills/analise-ppc/scripts/analise_ppc.ts gerar-indice
bun run .agents/skills/analise-ppc/scripts/analise_ppc.ts validar-base
bun test ./.agents/skills/analise-ppc
python3 -m pytest .agents/skills/analise-ppc/tests
```

O `bun test` cobre a validação da base, a orquestração da análise, o relatório HTML e a publicação no Surge, em TypeScript; o `pytest` cobre só o que ainda é Python (extratores da conversão DOCX).
