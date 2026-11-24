# Curadoria: o que está fora da base

Documentos que ainda não cumprem o contrato da base ficam aqui, fora de `base-conhecimento/`: não são publicados nem compilados no `kb.sqlite`. O repositório é público, e o `validar_base.ts` confere estes arquivos também (front matter, dados pessoais, URLs internas).

- `pendencias/ppcs/<campus>/<curso>/<rotulo>.md`: PPC convertido à espera do que falta (hoje, o ano do documento com evidência). O front matter é o de um PPC da base, sem `id` e sem os campos que faltam, com a lista `pendencias` (`ano: <o que falta e o que já se tentou>`).

`pnpm pendencias` lista tudo o que falta completar; `node scripts/promover_ppc.ts` leva um PPC completo para a base. O roteiro está em [curadoria de metadados institucionais](../base-conhecimento/docs/curadoria-metadados-institucionais.md#ppcs).
