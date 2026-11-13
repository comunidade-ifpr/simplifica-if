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
| `normas/texto-dispositivos.ts` | o caminho inverso: `["#art29", "#art37-par3"]` → "arts. 29 e 37, § 3º" |
| `normas/markdown.ts` | Markdown → mdast (`remark-parse` + `remark-gfm`) com o front matter em branco (linhas do mdast = linhas do arquivo) e `palavrasMarkdown`, a régua do saneamento e da reconstituição |
| `normas/estrutura.ts` | parser de dispositivos: artigo, parágrafo, inciso, alínea, item, anexo e seção, com IDs canônicos, caput herdado, notas de redação, revogado/vetado, estrutura e linhas; segmentos que reconstituem o corpo; dedução da compilação pelo ato |
| `normas/relacoes.ts` | `base-conhecimento/relacoes.yaml` (zod), validação por evidência literal, campos de relação do front matter e propostas por regex |
| `normas/vigencia.ts` | datas das normas, status numa data (`statusEm`), `data_referencia` de `config/vigencia.yaml`, regras de transição (`transicoes.yaml`) e linhas normativas dos marcos (`derivarLinha`) |
| `normas/gerado.ts` | campos gerados do front matter (relações e status) e reescrita do front matter, usados por `scripts/gerar_base.ts` |
| `normas/correspondencia.ts` | tabelas de correspondência entre normas sucessoras (`correspondencias/*.yaml`), com herança pelo ancestral |
| `normas/impacto.ts` | `kb impacto`: fichas, validações cruzadas, textos das skills, normas e PPCs afetados por uma norma |
| `normas/comandos.ts` | comandos da CLI da fase 5, registrados em `cli.ts` |
| `normas/referencia-estruturada.ts` | `{ ref, dispositivo?, papel, nota? }` (zod), universo de IDs citáveis (normas, stubs, `externo:`, `cnct:`) e texto legível das referências das fichas da `analise-ppc` |
| `ppcs/citacoes.ts` | citações dos PPCs convertidos; PPCs que citam uma norma; `lerTextoSecao` (texto integral de uma seção do índice pelas linhas) |
| `ppcs/front-matter.ts` | front matter de proveniência dos PPCs (`ppc:<campus>/<curso>`, URL, hash, data, conversor) e leitura com o front matter em branco |
| `ppcs/secoes.ts` | títulos, segmentação com linhas, taxonomias de seção por nível (técnico, ligada ao art. 28 da Res. CNE/CP nº 2/2026, e geral), preview e `textoDaSecao` |
| `adequacao/art71.ts` | cursos técnicos sujeitos ao art. 71 da Res. CNE/CP nº 2/2026 e a DCN que cada PPC cita |
| `avaliacao/resolvedor.ts` | precisão e recall do resolvedor em `avaliacao/resolvedor/citacoes-anotadas.yaml` |

## CLI

Da raiz do repositório:

```bash
bun run kb resolver "Res. CNE/CP 1/2021, art. 20" [--json]
bun run kb citacoes br/cne-cp/res/2021/1 [--json] [--confianca-min 0.8]
bun run kb adequacao-art71 [--json] [--incluir-tecnologia]
bun run kb avaliar-resolvedor [--json]
bun run kb dispositivo "br/cne-cp/res/2026/2#art71-parunico" [--json] [--filhos]
bun run kb vigencia br/cne-cp/res/2021/1 [--em 2026-11-12] [--json]
bun run kb relacoes br/lei/1996/9394 [--json]
bun run kb relacoes --propor [--json]
bun run kb correspondencia "br/cne-cp/res/2021/1#art20" [--json]
bun run kb impacto br/cne-cp/res/2021/1 [--json] [--sem-ppcs] [--conteudo <dir>]
```

As saídas não dependem do relógio e têm ordem estável. As regras do resolvedor e suas confianças estão no comentário de `normas/resolver.ts`; uma citação que não identifica o ato volta com `id: null` e a regra que explica por quê.

## API para o banco compilado (fase 6)

Funções puras sobre os arquivos do checkout (todas aceitam a raiz do repositório como último argumento; o padrão é o próprio checkout). Nenhuma lê o relógio.

| Função | Módulo | Devolve |
|---|---|---|
| `listarNormas(raiz)` | `normas/estrutura` | `{ id, path, arquivo }` das 36 normas |
| `carregarEstruturas(raiz)` | `normas/estrutura` | por norma: `dispositivos`, `segmentos` (corpo inteiro, em ordem, com tipo e linhas) e `problemas` |
| `carregarDispositivos(raiz)` | `normas/estrutura` | `Dispositivo[]`: `id`, `dispositivo`, `norma` (arquivo), `ato`, `tipo`, `rotulo`, `pai`, `texto`, `caput[]`, `estrutura[]`, `notas[]`, `revogado`, `vetado`, `linha_inicio`, `linha_fim`, `ordem` |
| `indiceDispositivos(raiz)` / `obterDispositivo(id)` / `dispositivosDoAto(ato)` | `normas/estrutura` | índice por `ato#dispositivo`, já deduplicado com a compilação (o texto integral prevalece) |
| `carregarRelacoes(raiz)` | `normas/relacoes` | `Relacao[]`: `tipo`, `origem`, `operador`, `alvo`, `alvo_dispositivo`, `alcance`, `efeito_de`, `evidencia`, `confirmado_em`, `proposta`, `nota` |
| `carregarDatas(raiz)` | `normas/vigencia` | `assinada_em`, `publicada_em`, `vigente_de` por ato (normas e stubs) |
| `statusEm(id, data, raiz)` | `normas/vigencia` | `{ status, certo, inicio, eventos[], pendencias[] }` |
| `dataReferencia(raiz)` | `normas/vigencia` | a `data_referencia` declarada |
| `carregarTransicoes(raiz)` / `transicoesAplicaveis(id, data)` | `normas/vigencia` | regras de transição e sua situação na data |
| `derivarLinha(linha, data, raiz)` | `normas/vigencia` | vigente, substituídas, antecessoras e dispositivos revogados de um tema |
| `carregarCorrespondencias(raiz)` / `correspondencia(id)` | `normas/correspondencia` | tabelas e o item aplicável (com herança) |
| `impacto(id, opcoes)` | `normas/impacto` | arquivos, normas e PPCs afetados |

Sugestão de tabelas: `dispositivo` (as colunas de `Dispositivo`, com `ato` e `norma` separados), `segmento`, `relacao`, `datas_norma`, `transicao`, `correspondencia` (origem, destino, tipo, nota, tabela, status). O status de vigência deve ser calculado por `statusEm` na data pedida, e não gravado.

## Manutenção

```bash
bun run --cwd packages/kb test        # inclui a medida do resolvedor (metas: precisão ≥ 0,95, recall ≥ 0,90)
bun run --cwd packages/kb typecheck
bun run --cwd packages/kb format
```

Ao mudar o resolvedor, rode também `bun run avaliacao:gabaritos` e revise o diff de `avaliacao/gabaritos/` (Q02 e Q20 vêm de `kb citacoes`).
