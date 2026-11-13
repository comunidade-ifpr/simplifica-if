# @simplifica-if/kb

Núcleo da base de conhecimento ([plano de arquitetura](../../PLANO-ARQUITETURA.md)): regras que mais de um consumidor usa (pipeline em `scripts/`, skills em `.agents/skills/`, avaliação). Os scripts importam `@simplifica-if/kb/<módulo>`; a dependência vai num sentido só.

| Módulo | Papel |
|---|---|
| `texto.ts`, `json.ts`, `schema.ts` | kit de paridade com o pipeline Python antigo (espaços, ordenação, JSON, `ajv`) |
| `normas/ids.ts` | IDs canônicos de norma, dispositivo e `externo:` |
| `normas/front-matter.ts` | front matter das normas (`yaml` failsafe + zod) |
| `normas/registro.ts` | universo de IDs: `manifest.json` + `normas/stubs.yaml` |
| `normas/resolver.ts` | `resolverCitacao(texto)` e `extrairCitacoes(texto)`, com regras nomeadas e confiança |
| `normas/dispositivos.ts` | "art. 28, inciso XVI" → `#art28-xvi` |
| `normas/referencias.ts` | casamento usado pelo validador da `analise-ppc` (mantido compatível) |
| `ppcs/citacoes.ts` | citações dos PPCs convertidos; PPCs que citam uma norma |
| `adequacao/art71.ts` | cursos técnicos sujeitos ao art. 71 da Res. CNE/CP nº 2/2026 e a DCN que cada PPC cita |
| `avaliacao/resolvedor.ts` | precisão e recall do resolvedor em `avaliacao/resolvedor/citacoes-anotadas.yaml` |

## CLI

Da raiz do repositório:

```bash
bun run kb resolver "Res. CNE/CP 1/2021, art. 20" [--json]
bun run kb citacoes br/cne-cp/res/2021/1 [--json] [--confianca-min 0.8]
bun run kb adequacao-art71 [--json] [--incluir-tecnologia]
bun run kb avaliar-resolvedor [--json]
```

As saídas não dependem do relógio e têm ordem estável. As regras do resolvedor e suas confianças estão no comentário de `normas/resolver.ts`; uma citação que não identifica o ato volta com `id: null` e a regra que explica por quê.

## Manutenção

```bash
bun run --cwd packages/kb test        # inclui a medida do resolvedor (metas: precisão ≥ 0,95, recall ≥ 0,90)
bun run --cwd packages/kb typecheck
bun run --cwd packages/kb format
```

Ao mudar o resolvedor, rode também `bun run avaliacao:gabaritos` e revise o diff de `avaliacao/gabaritos/` (Q02 e Q20 vêm de `kb citacoes`).
