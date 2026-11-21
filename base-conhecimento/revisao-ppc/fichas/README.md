## Resumo

As fichas da revisão de PPC: um JSON por critério, com pergunta, rubrica, evidência mínima, referências normativas e estados permitidos. O contrato é o Effect Schema de `scripts/base/revisao-ppc/esquemas.ts` (`../schemas/ficha.schema.json` é gerado dele).

Cada ficha declara:

- `topicos_tematicos`: IDs de tópicos existentes em `../topicos-fichas.json`.
- `tipo_escopo`: `tematico`, `multitematico`, `transversal` ou `condicional`.
- `ancoras_semanticas`: títulos, aliases e termos que ajudam a localizar o conteúdo no PPC real.
- `execucao`: `{ "modo": "D" | "S" | "J", "justificativa": "…" }`, como a ficha roda na revisão do app (veja [Execução no app](../README.md#execução-no-app-d-s-j)).

Não codifique números de seção nem campos antigos de localização: a mesma ficha deve funcionar quando o tema aparecer em outro capítulo, item ou título.

Ao criar ou editar ficha:

1. Atualize `../topicos-fichas.json` se a ficha entrar em tópico novo ou mudar de cobertura.
2. Acrescente teste quando a ficha representar regra nova, caso real corrigido ou regressão importante.
3. Rode `node scripts/gerar_base.ts` e `node scripts/validar_base.ts` (veja [Manutenção](../README.md#manutenção)).
