# Curadoria: o que está fora da base

Documentos que ainda não cumprem o contrato da base ficam aqui, fora de `base-conhecimento/`: não são publicados nem compilados no `kb.sqlite`. O repositório é público, e o `validar_base.ts` confere estes arquivos também (front matter, dados pessoais, URLs internas).

- `pendencias/ppcs/<campus>/<curso>/<rotulo>.md`: PPC convertido à espera do que falta (hoje, o ano do documento com evidência). O front matter é o de um PPC da base, sem `id` e sem os campos que faltam, com a lista `pendencias` (`ano: <o que falta e o que já se tentou>`).
- `pendencias/versoes-ppc/<campus>/<curso>/suap-matriz-<id>.json`: versão de PPC que se sabe existir (hoje, o PDF anexo a uma matriz do SUAP), mas sem texto na base, porque só há o PDF. Um JSON por versão (contrato `esquemaVersaoSemTexto`, em `scripts/base/pendencias.ts`): `matriz_suap` (`id`, `descricao`, `ano_criacao` e `data_inicio` da matriz, que não são o ano do PPC), `evidencia` (o trecho literal da capa que mostra a versão, e onde foi lido), `fonte_url` (o PDF público da mesma versão, quando achado; nunca o link do SUAP) e `pendencias` (`texto: …`, `fonte_url: …`). Não traz ano: o ano com a evidência é dado na importação do DOCX (`importar_ppc_docx.ts`); importada a versão, apague o JSON.

`pnpm pendencias` lista tudo o que falta completar; `node scripts/promover_ppc.ts` leva um PPC completo para a base. O roteiro está em [curadoria de metadados institucionais](../base-conhecimento/docs/curadoria-metadados-institucionais.md#ppcs).
