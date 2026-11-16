## Resumo

Catálogo canônico das fichas de análise por lote do `revisar-ppc`.

Cada arquivo JSON descreve uma verificação individual aplicada ao PPC completo, com pergunta, rubrica, evidência mínima, referências normativas e estados permitidos.

Cada ficha deve declarar:

- `topicos_tematicos`: IDs de tópicos existentes em `../topicos-fichas.json`.
- `tipo_escopo`: `tematico`, `multitematico`, `transversal` ou `condicional`.
- `ancoras_semanticas`: títulos, aliases e termos que ajudam a localizar o conteúdo no PPC real.
- `execucao`: `{ "modo": "D" | "S" | "J", "justificativa": "…" }`, como a ficha roda na revisão do app (D: só código, com verificador registrado em `packages/ppc/src/verificadores/registro.ts`; S: o código acha o trecho e a IA confirma; J: julgamento da IA). Veja [Execução no app](../../README.md#execução-no-app-d-s-j).

Não codifique números de seção nem mantenha campos antigos de localização. A mesma ficha deve funcionar quando o tema aparecer em outro capítulo, item ou título.

Ao criar ou editar ficha:

1. Atualize `../topicos-fichas.json` se a ficha entrar em tópico novo ou mudar de cobertura.
2. Adicione teste quando a ficha representar regra nova, caso real corrigido ou regressão importante.
3. Regenere `../mapa-fichas.md` e `../indice.json` pelos scripts da skill.
4. Rode a validação da base e os testes da skill antes de concluir.
