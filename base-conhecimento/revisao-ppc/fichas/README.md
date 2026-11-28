## Resumo

As fichas da revisão de PPC: um JSON por critério, com pergunta, rubrica, evidência mínima, referências normativas e estados permitidos. O contrato é o Effect Schema de `scripts/base/revisao-ppc/esquemas.ts`.

Cada ficha declara:

- `topicos_tematicos`: IDs de tópicos existentes em `../topicos.json`.
- `criticidade`: `bloqueante`, `obrigatorio` ou `recomendado`.
- `estados_permitidos`: lista com valores de `atende`, `nao_atende`, `a_conferir`, `nao_se_aplica`.
- `ancoras_semanticas`: títulos, aliases e termos que ajudam a localizar o conteúdo no PPC real.
- `execucao`: `{ "modo": "hibrido" | "focal" | "tematico" | "transversal", "justificativa": "…" }`, como a ficha roda na revisão do app (veja [Execução no app](../README.md#execução-no-app-hibrido-focal-tematico-transversal)).

Não codifique números de seção nem campos antigos de localização: a mesma ficha deve funcionar quando o tema aparecer em outro capítulo, item ou título.

Ao criar ou editar ficha:

1. Cite apenas tópicos existentes em `../topicos.json` (se criar tópico novo, adicione-o lá com os tipos de seção em `secoes`).
2. Acrescente teste quando a ficha representar regra nova, caso real corrigido ou regressão importante.
3. Rode `node scripts/gerar_base.ts` e `node scripts/validar_base.ts` (veja [Manutenção](../README.md#manutenção)).
