# Desenvolvimento de Skills

## Papel das Skills

As skills são procedimentos operacionais para agentes IA. Elas devem transformar uma tarefa recorrente em fluxo reprodutível, com prompts, scripts, testes e artefatos de apoio. Há dois lugares, e cada skill mora num só: `.agents/skills/` tem as de quem mantém o repositório (curadoria; rodam no checkout, com a CLI `kb`, os scripts e o git) e `catalogo/skills/` tem as do app (viajam para o app, que só tem as ferramentas `ifpr` do `simplifica-mcp`; regras em "Skills e tarefas" do [`AGENTS.md`](../../AGENTS.md)).

A Base de Conhecimento local em `base-conhecimento/` continua sendo a fonte de verdade para normas, metadados institucionais, PPCs de referência e catálogos. Antes de duplicar conteúdo normativo dentro de uma skill, verifique pela CLI `kb` (skill do repositório) ou pelas ferramentas `ifpr` do `simplifica-mcp` (skill do app) se o dado já está na base: normas em `base-conhecimento/normas/`, registros institucionais e PPCs em `base-conhecimento/institucional/`, CNCT em `base-conhecimento/catalogos/`.

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

O `node scripts/validar_base.ts` também confere as fichas da tarefa "Revisar um PPC" (`base-conhecimento/revisao-ppc/`, veja o README da pasta). Regras compartilhadas (texto, JSON, JSON Schema, IDs de norma, referências normativas estruturadas e seu texto legível) ficam em `packages/kb` e são importadas como `@simplifica-if/kb/...`.
