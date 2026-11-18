# Desenvolvimento de Skills

## Papel das Skills

As skills em `.agents/skills/` são procedimentos operacionais para agentes IA. Elas devem transformar uma tarefa recorrente em fluxo reprodutível, com prompts, scripts, testes e artefatos de apoio.

A Base de Conhecimento local em `base-conhecimento/` continua sendo a fonte de verdade para normas, metadados institucionais, PPCs de referência e catálogos. Antes de duplicar conteúdo normativo dentro de uma skill, verifique pela CLI `kb` (no repositório) ou pelas ferramentas `ifpr` do `simplifica-mcp` (no app) se o dado já está na base: normas em `base-conhecimento/normas/`, registros institucionais e PPCs em `base-conhecimento/institucional/`, CNCT em `base-conhecimento/catalogos/`.

## Integração Com a Base

Ao criar ou revisar uma skill:

1. Defina quais comandos `kb` ou ferramentas `ifpr` a skill usa para consultar a base.
2. Prefira referências por ID canônico e `path` em vez de texto copiado.
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
node scripts/validar_base.ts
```

Depois de alterar `revisar-ppc`:

```bash
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts validar-base
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts gerar-schemas --check
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts gerar-mapa --check
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts gerar-indice --check
pnpm exec vp test run .agents/skills/revisar-ppc
```

Sem `--check`, `gerar-schemas`, `gerar-mapa` e `gerar-indice` regeneram os JSON Schemas de ficha e marcos (gerados do Effect Schema de `scripts/esquemas.ts`), `base-analise/mapa-fichas.md` e `base-analise/indice.json`. O `node scripts/validar_base.ts` também roda a validação da base de análise. Os scripts TypeScript das skills ficam em `.agents/skills/<skill>/scripts/` e os testes em `.agents/skills/<skill>/tests/*.test.ts`; ambos entram em `pnpm typecheck`, `pnpm test` e `pnpm fmt`. Regras compartilhadas (texto, JSON, JSON Schema, IDs de norma, referências normativas estruturadas e seu texto legível) ficam em `packages/kb` e são importadas como `@simplifica-if/kb/...`.
