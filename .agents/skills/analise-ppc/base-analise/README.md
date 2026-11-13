## Resumo

Centro canônico da base de análise do `analise-ppc`. Reúne, em um único lugar, as fontes estruturadas que orientam a leitura do PPC.

## Estrutura

- `fichas/` — verificações analíticas executadas por lote sobre o PPC completo.
- `topicos-fichas.json` — taxonomia semântica que organiza as fichas por tema, sem depender da numeração do PPC.
- `mapa-fichas.md` — visão legível da taxonomia para consulta rápida.
- `validacoes-cruzadas/` — verificações transversais de coerência entre seções e achados.
- `marcos-normativos.json` — registro único da norma vigente de cada tema (DCN da EPT, DCNEM, EJA, assistência estudantil), das normas que ela substituiu e das regras de transição. É injetado nos subagentes em `contextos.fundamentacao_normativa.marcos_normativos`.
- `contratos/` — exemplos mínimos de payload e formatos de referência.
- `schemas/` — contratos JSON Schema para fichas, validações cruzadas e respostas.
- `indice.json` — índice consolidado da base de análise, gerado a partir dos JSONs reais.

O CNCT usado pela skill vem da base unificada em `base-conhecimento/catalogos/cnct/`.

## Tópicos das fichas

As fichas usam `topicos_tematicos`, `tipo_escopo` e `ancoras_semanticas`.

Esses campos apontam para tópicos semânticos, como estágio, avaliação da aprendizagem, AEE, infraestrutura, matriz curricular ou referências normativas. Não use números fixos nem nomes de seções como contrato da ficha: a numeração e os títulos reais devem ser inferidos durante a rodada de análise a partir das âncoras.

Use `topicos-fichas.json` como fonte canônica e `mapa-fichas.md` para consulta humana.

Ao criar ou editar uma ficha, mantenha a ficha e a taxonomia sincronizadas:

1. A ficha deve citar tópicos existentes em `topicos-fichas.json`.
2. Cada tópico deve citar todas as fichas que pertencem a ele.
3. `mapa-fichas.md` e `indice.json` são gerados; não edite manualmente.

## Vigência das normas

A vigência de cada norma vem de `base-conhecimento/manifest.json` (campo `status_vigencia`); a norma revogadora fica em `revogada_por`, no front matter do arquivo indicado em `path`. O validador cruza as fichas com o manifesto e com `marcos-normativos.json` (validado por `schemas/marcos-normativos.schema.json`):

- uma ficha não pode citar em `referencias_normativas` norma `revogada` no manifesto, norma listada em `substitui` ou `antecessoras_historicas` de um marco, nem dispositivo listado em `dispositivos_revogados`;
- a norma `vigente` de cada marco precisa existir no manifesto e não estar revogada, e nenhuma norma listada em `substitui` pode continuar `vigente`;
- os IDs em `fichas_responsaveis` e `fichas_base_legal` precisam existir;
- sem o manifesto, a validação falha em vez de pular a checagem.

As referências são casadas por tipo, número, ano e órgão depois de normalizar a grafia ("Res. CNE/CP n° 1/2021", "Resolução CNE/CP nº 1, de 5 de janeiro de 2021" e "Resolução CNE/CP 01/2021" são a mesma norma). Siglas sem número, como "DCNEPT", não são usadas para casar. Referências a fontes fora do manifesto (CNCT, ABNT, PDI, regulamentos de campus, leis não incorporadas) não são verificadas. As validações cruzadas não têm `referencias_normativas` e ficam fora dessa checagem; elas remetem aos marcos no texto da rubrica.

Quando uma norma da base for revogada, rode o validador: ele lista as fichas a revisar. Atualize as fichas e o marco correspondente em `marcos-normativos.json`. Escreva a regra de transição e a orientação de análise no marco, em vez de repeti-las em cada ficha; as fichas podem remeter a `contextos.fundamentacao_normativa.marcos_normativos`.

## Uso recomendado

1. Consulte `mapa-fichas.md` quando quiser saber quais fichas avaliam cada tema.
2. Consulte `indice.json` quando quiser localizar rapidamente itens por ID, categoria, domínio, criticidade ou tópico.
3. Abra `fichas/` quando a pergunta for sobre cobertura analítica por item.
4. Abra `validacoes-cruzadas/` quando a pergunta for sobre coerência transversal.
5. Abra `contratos/` quando a dúvida for sobre formato de entrada ou saída.

## Manutenção

Rode a partir da raiz do repositório sempre que alterar fichas, tópicos, validações cruzadas, contratos ou schemas:

```bash
bun run .agents/skills/analise-ppc/scripts/analise_ppc.ts validar-base
bun run .agents/skills/analise-ppc/scripts/analise_ppc.ts gerar-mapa
bun run .agents/skills/analise-ppc/scripts/analise_ppc.ts gerar-indice
bun run .agents/skills/analise-ppc/scripts/analise_ppc.ts validar-base
bun test ./.agents/skills/analise-ppc
python3 -m pytest .agents/skills/analise-ppc/tests
```

O `bun test` cobre a validação da base, a orquestração da análise, o relatório HTML e a publicação no Surge, em TypeScript; o `pytest` cobre só o que ainda é Python (extratores da conversão DOCX).
