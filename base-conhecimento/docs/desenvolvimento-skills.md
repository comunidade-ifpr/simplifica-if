# Desenvolvimento de Skills

## Papel das Skills

As skills em `.agents/skills/` são procedimentos operacionais para agentes IA. Elas devem transformar uma tarefa recorrente em fluxo reprodutível, com prompts, scripts, testes e artefatos de apoio.

A Base de Conhecimento local em `base-conhecimento/` continua sendo a fonte de verdade para normas, metadados institucionais, PPCs de referência e catálogos. Antes de duplicar conteúdo normativo dentro de uma skill, verifique se o dado já existe em:

- `base-conhecimento/manifest.json`
- `base-conhecimento/institucional_manifest.json`
- `base-conhecimento/catalogos_manifest.json`
- `base-conhecimento/normas/`
- `base-conhecimento/institucional/`
- `base-conhecimento/catalogos/`

## Integração Com a Base

Ao criar ou revisar uma skill:

1. Defina quais manifestos e coleções da base a skill deve consultar.
2. Prefira referências por `path` e metadados estruturados em vez de texto copiado.
3. Quando a skill precisar funcionar instalada em outro projeto sem a base completa, documente quais dados foram empacotados e qual é a origem.
4. Inclua testes ou validações que indiquem quando uma base gerada, índice ou cópia empacotada ficou desatualizada.

## Convenções

- Cada skill deve ter `SKILL.md`.
- Cada skill com fluxo próprio deve ter `README.md`.
- Scripts de skill devem ficar dentro da própria pasta da skill.
- Dados canônicos compartilhados devem ficar na base, não dentro da skill, salvo quando houver motivo de portabilidade.
- Prompts devem orientar o agente a declarar lacuna ou `INCONCLUSIVO` quando uma norma necessária não estiver disponível na base ou no contexto enviado.

## Validação

Depois de alterar a base:

```bash
bun run scripts/validar_base.ts
bun run scripts/gerar_site.ts --check
```

Depois de alterar `analise-ppc`:

```bash
bun run .agents/skills/analise-ppc/scripts/analise_ppc.ts validar-base
bun run .agents/skills/analise-ppc/scripts/analise_ppc.ts gerar-mapa --check
bun run .agents/skills/analise-ppc/scripts/analise_ppc.ts gerar-indice --check
bun test ./.agents/skills/analise-ppc
python3 -m pytest .agents/skills/analise-ppc/tests
```

Sem `--check`, `gerar-mapa` e `gerar-indice` regeneram `base-analise/mapa-fichas.md` e `base-analise/indice.json`. O `bun run scripts/validar_base.ts` também roda a validação da base de análise. Os scripts TypeScript das skills ficam em `.agents/skills/<skill>/scripts/` e os testes em `.agents/skills/<skill>/tests/*.test.ts`; ambos entram em `bun run typecheck`, `bun run test` e `bun run format`. Regras compartilhadas (texto, JSON, JSON Schema, casamento de referências normativas) ficam em `packages/kb` e são importadas como `@simplifica-if/kb/...`.
