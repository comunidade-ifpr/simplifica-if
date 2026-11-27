# Arquitetura da base de conhecimento

Situação em 21/11/2026. Trata da base de conhecimento (`base-conhecimento/`), do `packages/kb`, da CLI `kb` e do `simplifica-mcp`, o núcleo que alimenta o app; o app tem plano próprio em [`app-simplifica-if.md`](app-simplifica-if.md). O detalhe de cada fase, as medições e o andamento dia a dia ficam no histórico do git.

## Tese

O problema da base não é busca, é identidade e relações. Por isso:

- **IDs canônicos** para cada norma e cada dispositivo, derivados do ato e não do nome do arquivo.
- **Relações tipadas e datadas** entre normas (`revoga`, `altera`, `regulamenta`, `fundamenta-se-em`), com a vigência calculada para uma data explícita e as **regras de transição** como dado: norma revogada não é norma inaplicável.
- **`kb.sqlite` derivado:** os arquivos no git são a fonte de verdade; o banco (SQLite com FTS5) é compilado deles por `pnpm kb:compilar`, é reproduzível e fica fora do git. Banco vetorial, banco de grafo, embeddings e frameworks de RAG ficam fora: o volume é pequeno.
- **Proveniência literal:** toda resposta traz o texto literal e o arquivo e a linha de onde ele veio, e é esse arquivo que se cita.
- **Só a CLI e o MCP leem a base:** a CLI `kb` no checkout, o `simplifica-mcp` (dentro do app e como executável à parte) e o app pelo mesmo `packages/kb`. Não há leitor direto da base, site, JSON público nem `llms.txt`; artefato sem consumidor sai.

## Princípios

1. **Os arquivos no git são a fonte de verdade.** Markdown das normas, `base-conhecimento/institucional/ifpr/`, fichas, CNCT e PPCs convertidos. Todo banco ou índice é derivado.
2. **Uma linguagem.** TypeScript em Node, com Effect 4; o repositório não tem Python.
3. **Contratos explícitos.** Effect Schema nos dados: os manifestos e índices pelo de `scripts/base/esquemas.ts`, os registros institucionais pelo de `scripts/dados/` e as fichas da revisão de PPC pelo de `scripts/base/revisao-ppc/`.
4. **Nada inferido por LLM entra sem revisão humana.** Relações, tabela de correspondência e fatos de PPC são propostos automaticamente e confirmados por diff no git.
5. **Cada mudança de retrieval se mede** contra os conjuntos de `avaliacao/` (`pnpm kb avaliar-resolvedor`, `pnpm kb avaliar-busca`).
6. **Determinismo.** As mesmas fontes geram o mesmo banco byte a byte. O que depende de data, como a vigência, recebe a data como parâmetro (`data_referencia` em `base-conhecimento/config/vigencia.yaml`), nunca o relógio do build. O banco guarda a vigência em intervalos datados; a consulta escolhe o dia (no app, no simplifica-mcp e na CLI `kb`, o de hoje). A versão da base (`meta.versao`, `AAAA.MM.DD`) identifica o conteúdo e muda a cada publicação; a `data_referencia` é só o dia do retrato no front matter.

## IDs canônicos

A regra está em `packages/kb/src/normas/ids.ts` e em [`padrao-front-matter-legislacao.md`](../../base-conhecimento/docs/padrao-front-matter-legislacao.md).

- **Norma:** `br/cne-cp/res/2026/2`, `ifpr/consup/res/2024/190`, `br/lei/1996/9394`. Cada ato tem um arquivo só, com o texto integral.
- **Dispositivo:** `#art28-xvi`, `#art28-par1-iv`, `#art71-parunico`, `#art36A`, `#art5-al-a`, `#anexo1-art5`. A letra de artigo vem colada e em maiúscula, e a alínea é sempre `-al-`: art. 36-A e alínea a do art. 36 não se confundem.
- **Norma-stub:** citada, sem texto na base (metadados, status e aliases, sem dispositivos), em `base-conhecimento/normas/stubs.yaml`.
- **Fora da base:** `externo:abnt/nbr/6023`, `externo:cft/res/2019/89`.
- **Institucional:** `curso:curitiba/tecnico-em-enfermagem`, `campus:curitiba`, `cnct:tecnico-em-enfermagem`, `ficha:CT-CURR-12` e `ppc:curitiba/tecnico-em-enfermagem/2023`, com a versão (o ano do documento): todo PPC que entra na base fica, e o registro do curso aponta o vigente; `campus/curso` sem versão vale pelo vigente.
- **Todo ato fica; o texto é o consolidado:** norma revogada ou substituída continua na base, com o status calculado pelas relações, porque PPCs e documentos a citam. Dentro de cada ato, os dispositivos guardam a redação atual; "Redação dada pela Lei X" vira metadado, e a redação anterior de um dispositivo alterado pode ficar marcada como não vigente.

## Estado

| Fase | Entrega | Situação |
|---|---|---|
| 0 | Fundação TypeScript: `packages/kb` e validador da `revisar-ppc` em TS | Concluída (13/11/2026) |
| 1 | Linha de base com agente real (`claude -p`) sobre perguntas | Encerrada sem linha de base: o harness lia o checkout sem o MCP e saiu em 21/11/2026 |
| 2 | IDs, stubs, `externo:`, resolvedor de citações, fichas com referências estruturadas | Concluída |
| 3 | Curadoria: `cnct_id`, turno padronizado, curadoria do PPC por campo | Concluída |
| 4 | Proveniência de PPC e índice de seções por nível | Concluída |
| 5 | Saneamento das normas, dispositivos, `relacoes.yaml`, vigência, `transicoes.yaml`, correspondência, `kb impacto` | Concluída |
| 6 | `kb.sqlite` com FTS5, CLI `kb`, citações e fatos PPC × SUAP, `pacote-revisao-ppc` | Concluída |
| 7 | MCP | Concluída: `simplifica-mcp` em `packages/mcp`, com `McpServer` do `effect/ai` |
| T | Migração Python → TypeScript (orquestração, relatório, DOCX) | Concluída em 17/11/2026; PDF de PPC não é convertido |

O que ficou de medição: os conjuntos de `avaliacao/` para o resolvedor e a busca de seções (lidos pelo `kb`), os PPCs-ouro e a avaliação das skills do app pelo motor e o MCP (`scripts/avaliar_skill.ts`); veja [`avaliacao/README.md`](../../avaliacao/README.md). A CI (`.github/workflows/ci.yml`) roda fmt, lint, typecheck, `kb compilar`, testes, o smoke do MCP e o `validar_base.ts`.

No `kb`, as consultas usam o `SqlClient` do `effect/sql` sobre `node:sqlite` (`packages/kb/src/db/nodeSqliteClient.ts`); a compilação do banco escreve com o `DatabaseSync` direto.

## Em aberto

Pendências humanas, todas marcadas como rascunho nos arquivos:

1. **Revisão do conjunto anotado do resolvedor** (`avaliacao/resolvedor/citacoes-anotadas.yaml`): serviu também para ajustar as regras, então a medida é otimista; falta revisão e um conjunto independente.
2. **Revisão das consultas da busca de seções** (`avaliacao/busca-secoes/consultas.yaml`), do léxico de sinônimos (`packages/kb/dados/sinonimos.yaml`) e do mapa tópico → seção (`packages/kb/dados/topicos-secoes.yaml`).
3. **Revisão dos três PPCs-ouro** (`avaliacao/ppcs-ouro/`).
4. **Data do DOU da Res. CNE/CP nº 2/2026:** até ela, a 2/2026 fica `aguardando publicação` (não está em vigor), e a 1/2021 segue vigente; registrada a data, a 1/2021 passa a revogada e as transições dos arts. 70 a 72 começam.
5. **Revisão jurídica da tabela de correspondência 1/2021 → 2/2026** (`base-conhecimento/correspondencias/`): até lá, é indicação, não fundamento.
6. **Revisão dos fatos de PPC:** todos têm status `extraido`, sem revisão humana. A revisão entra em `base-conhecimento/fatos-ppc.yaml` (status `revisado`, com revisor e data), pela fila `pnpm kb fatos-a-revisar`: primeiro os 23 com valores alternativos, depois as horas sem unidade conhecida. Até lá, confira o `trecho_fonte` antes de afirmar uma divergência; a carga sem unidade conhecida não afirma divergência com o SUAP.
7. **Busca de normas** não tem conjunto rotulado para medir recall, como a de seções.

## Não fazer

- Não versionar o `kb.sqlite` nem torná-lo fonte de verdade ou lugar de edição.
- Não ler a base por fora da CLI `kb`, do MCP e do app, nem criar artefato que só um leitor externo usaria.
- Não deixar um LLM inferir revogações, correspondências ou fatos de PPC sem confirmação humana versionada.
- Não fragmentar normas por janela de tokens: a unidade é o dispositivo, com o caput herdado.
- Não tratar "revogada" como "inaplicável".
- Não calcular nada com o relógio do build.
- Não editar à mão os campos gerados do front matter das normas (`status_vigencia`, relações, `vigencia_*`): a fonte é `relacoes.yaml` e a configuração de vigência.
- Não reimplementar regras do núcleo fora de `packages/kb`.
- Não reformatar Markdown, JSON nem YAML: o `vp fmt` os exclui em `vite.config.ts`.
- Não adotar embeddings, banco vetorial, ORM nem framework de RAG sem uma medição que os justifique.
