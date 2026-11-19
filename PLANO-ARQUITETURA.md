# Plano de arquitetura da base de conhecimento

Situação em 13/11/2026. Este plano consolida duas análises de arquitetura de retrieval: uma auditoria da base atual e um desenho "do zero". Também consolida o código da base e das skills em TypeScript.

A versão 2 incorpora duas revisões independentes, uma da migração para TypeScript e outra das fases de retrieval. A seção [Histórico de revisões](#histórico-de-revisões) registra o que mudou.

Desde a etapa C0 da [consolidação na stack do T3](docs/plans/consolidacao-stack-t3.md) (14/11/2026), o repositório roda em Node e pnpm. Os comandos deste plano foram atualizados; onde o texto registra como era antes, ele fala do Bun.

**Escopo:** a `revisar-ppc` (antes `analise-ppc`; veja a renomeação em [Andamento](#andamento)) e a base de conhecimento. `Movimentações de Cursos` (Notion) está fora do escopo por ora.

**O repositório hoje (17/11/2026).** O produto central é o app desktop Simplifica IF (`apps/`), com plano próprio em [`docs/plans/app-simplifica-if.md`](docs/plans/app-simplifica-if.md). A base de conhecimento, o `packages/kb` e o `simplifica-mcp`, de que este plano trata, são o núcleo que o alimenta: o app lê o `kb.sqlite` compilado da base. Ferramentas que continuam só no repositório, fora do app, estão em [Ferramentas do repositório fora do app](#ferramentas-do-repositório-fora-do-app).

## Tese

O problema da base não é busca, é identidade e relações. Faltam:

- ID canônico para cada norma e para cada dispositivo (artigo, parágrafo, inciso);
- relações tipadas e datadas entre normas, com vigência calculada para uma data;
- vínculo curso–CNCT e turno padronizado;
- proveniência e versão dos PPCs convertidos;
- citações e fatos extraídos dos PPCs, com o trecho de origem e cruzados com o SUAP.

O tamanho é pequeno: cerca de 3.500 dispositivos normativos, 202 PPCs (112 técnicos e 90 de graduação, pós ou FIC) e 218 cursos do CNCT. Tudo cabe num SQLite gerado a partir dos arquivos do git. Banco vetorial, banco de grafo e frameworks de RAG ficam fora.

## Princípios

1. **Os arquivos no git são a fonte de verdade.** Markdown das normas, `base-conhecimento/institucional/ifpr/`, fichas, CNCT e PPCs convertidos. Todo banco ou índice é derivado, reproduzível e fica fora do git.
2. **Uma linguagem.** Pipeline, skills, validadores e CLI em TypeScript (Node, desde o C0; antes, Bun). Quando não houver equivalente aceitável, a exceção fica isolada num script único, documentada e com teste de contrato.
3. **Contratos explícitos.** Os dados novos e os que forem reestruturados ganham schema zod. Os JSON Schemas existentes continuam validados por `ajv` até haver motivo medido para trocá-los.
4. **Nada inferido por LLM entra sem revisão humana.** Relações de revogação, tabela de correspondência e fatos de PPC são propostos automaticamente e confirmados por diff no git.
5. **Cada fase se mede.** O conjunto de avaliação (fase 1) roda antes e depois de cada fase de retrieval. Uma fase que não melhora nenhuma métrica não avança. A consolidação em TypeScript é decisão de manutenção e segue outro critério: paridade com o Python.
6. **Determinismo.** As mesmas fontes geram o mesmo banco, os mesmos índices e os mesmos JSONs públicos. Quando um resultado depende de data, como a vigência, a data é parâmetro explícito e nunca o relógio do build.

## Ponto de partida

O que já existe e será aproveitado:

- **Dados institucionais:** ficam em `base-conhecimento/institucional/ifpr/`, com schemas zod (`scripts/dados/institucional.ts`) e chaves canônicas (`campus_id/curso_slug`).
- **Pipeline da base:** `scripts/base/` em TypeScript, com front matter, manifestos, índice de seções de PPC, validação e site.
- **Kit de paridade com Python,** feito no porte anterior do pipeline:
  - `scripts/base/texto.ts`: espaços como no Python, ordenação por code point, `splitlines`, UTF-8 estrito;
  - `scripts/base/json.ts`: serialização como no Python;
  - `scripts/base/schema.ts`: `ajv` com as mensagens e a ordem de erros do validador antigo.
- **`packages/sei-cli`:** em TypeScript, com `fflate` e `commander`. É o modelo de workspace.
- **Protótipos das fases 2 e 5,** hoje em Python na `revisar-ppc`:
  - casamento de referências por tipo, número, ano e órgão, em `validar_base_analise.py`;
  - registro de marcos com regras de transição, em `marcos-normativos.json`.

### Estado das normas (conferido em 13/11/2026)

- **9 de 36 normas ainda não usam `#### Art.` como heading:** Leis 10.639, 11.645, 11.788, 12.711, 14.945 e 15.468, NT PROENS 1/2025, Res. CONSUP 222/2024 e 242/2025.
- **A LDB, que é a norma mais citada, precisa de saneamento:**
  - em 116 dos 120 headings, o caput está dentro do próprio heading;
  - há 25 ocorrências de `**` solto;
  - há 31 linhas com vários parágrafos colados;
  - há 229 notas de redação ("Redação dada", "Incluído").
- **Relações entre normas são poucas:** 7 `revoga`, 2 `revogada_por`, 6 `altera` e 5 `alterada_por`. O `manifest.json` não as expõe.

### Python restante

| Onde | Dependências | Papel |
|---|---|---|
| `revisar-ppc/scripts/conversao_docx/` (~4.000 linhas) | `python-docx`; `rapidfuzz` opcional (fallback para `difflib`) | DOCX → `PPC.md` |
| `revisar-ppc/scripts/conversao_docx/image_extractor.py` | `docx2pdf` (MS Word), `pdf2image` (poppler), `pdfplumber` | renderiza a página quando a figura é desenho vetorial (fallback "rendered") |
| `revisar-ppc/scripts/preparar_documento.py` | importa `MarkdownNormalizer` de `conversao_docx`, mesmo com entrada `.md` | cria a rodada e o `PPC.md` canônico |
| `revisar-ppc/scripts/gerar_relatorio_html.py` (~1.270) | stdlib (`HTMLParser`, `textwrap`) | PPC HTML anotado |
| `revisar-ppc/scripts/subagents.py`, `common.py`, `cnct_catalogo.py`, `analise_ppc.py` (~1.720) | stdlib (`SequenceMatcher`) | rodada, grupos, prompts, contextos, mescla |
| `revisar-ppc/scripts/validar_base_analise.py` (~430) | stdlib (validador de JSON Schema escrito à mão) | fichas, marcos, referências |
| `revisar-ppc/scripts/gerar_indice_base_analise.py`, `gerar_mapa_fichas.py`, `publicar_surge.py` (~390) | stdlib, CLI `surge` | índice, mapa, publicação |
| `revisar-ppc/tests/` (89 casos; `test_flow.py` importa todos os módulos) | `pytest` | testes |
| `verificar-calendario/scripts/render_relatorio_pdf.py` | `reportlab` | relatório em PDF |
| `scripts/converter_ppcs_markdown.py` | `pymupdf4llm`, `rapidocr-onnxruntime`, `urllib` | baixa PDFs de PPC e converte em Markdown com OCR |

O `python3` do sistema não tem `python-docx`. Hoje não há um ambiente de referência fixado para os testes diferenciais.

## Arquitetura alvo

```
Fontes (git)                         Build (node)                           Consulta
─────────────                        ───────────                            ────────
normas/*.md ─────────┐
relacoes.yaml ───────┤               packages/kb
institucional/ifpr/  ┼──► parse ──► ├─ IDs, schemas, resolvedor   ──► kb.sqlite (FTS5) ──► CLI `kb … --json`
catalogos/cnct/ ─────┤     valida    ├─ dispositivos e relações               │            └► MCP (só se houver
ppcs/*.md (+ proveniência) ──┤ compila ├─ seções, citações, fatos            │               consumidor sem shell)
fichas revisar-ppc ──┘               └─ paridade (texto, json, schema)     ├──► JSONs públicos
                                                                            └──► site/, llms.txt
```

**IDs canônicos.** São derivados do ato, nunca do nome do arquivo:

- **Norma:** `br/cne-cp/res/2026/2`, `ifpr/consup/res/2024/190`, `br/lei/1996/9394`.
  - Uma compilação de trechos, como "LDB – trechos relevantes", é o mesmo ato, marcada com `variante: compilacao` e um ID próprio de arquivo. A busca deduplica pelos dispositivos.
- **Dispositivo:** `#art28-xvi`, `#art28-par1-iv`, `#art71-parunico`, `#art36A`, `#art5-al-a`, `#anexo1-item3`.
  - A letra de artigo vem colada e em maiúscula; a alínea é sempre `-al-`. Assim, art. 36-A e alínea a do art. 36 não se confundem.
- **Referência fora da base:** `externo:abnt/nbr/6023`, `externo:cft/res/2019/89`, `externo:campus/regulamento-estagio`.
- **Norma-stub:** norma citada mas sem texto na base, com metadados, status e aliases, mas sem dispositivos. Exemplos: CNE/CEB 6/2012, CNE/CEB 3/2018, Decreto 5.154/2004.
- **Institucional:**
  - `curso:curitiba/tecnico-em-enfermagem` (a chave atual de `base-conhecimento/institucional/ifpr/`);
  - `campus:curitiba`;
  - `cnct:tecnico-em-enfermagem`;
  - `ppc:curitiba/tecnico-em-enfermagem`, sem versão: a base guarda só o PPC vigente de cada curso (decisão de 13/11/2026, fase 4). As versões anteriores se recuperavam pelo histórico do git, mas a abertura do repositório reescreve o histórico (git filter-repo) e tira dele dados pessoais e URLs assinadas: para esses trechos, a versão antiga não é recuperável pelo git, e a fonte de qualquer versão anterior é o PDF oficial do PPC;
  - `ficha:CT-CURR-12`.

**Só o texto vigente.** Os dispositivos guardam a redação atual. Notas como "Redação dada pela Lei X" viram metadado do dispositivo, sem modelar redações históricas.

## Fases

| Fase | Entrega | Esforço | Depende de |
|---|---|---|---|
| 0 | Fundação TypeScript: `packages/kb`, validador da `revisar-ppc` em TS | Baixo | — |
| 1 | Conjunto de avaliação enxuto e harness com agente real | Baixo a médio | — |
| 2 | Identidade de normas, referências externas e resolvedor de citações | Médio | 0 |
| 3 | Curadoria rápida: `cnct_id`, turno, stubs, curadoria por campo | Baixo (humano) | 2 (stubs) |
| 4 | Proveniência de PPC e índice de seções v2 no pipeline atual | Médio | 0 |
| 5 | Saneamento das normas, dispositivos, relações, vigência e correspondência | Alto | 2 |
| 6 | SQLite + FTS5, CLI `kb`, citações e fatos de PPC, `pacote-contexto` | Médio | 4, 5 |
| 7 | MCP | Baixo | 6, e um consumidor sem shell |
| T | Trilha paralela: restante da migração Python → TypeScript | Alto | 0 |

A fase 1 começa junto com a 0. A trilha T corre em paralelo às fases de retrieval e não bloqueia nem é bloqueada por elas, exceto onde indicado.

Ficam fora do plano por ora:
- **Embeddings:** reavaliar só se a fase 6 medir recall temático abaixo de 0,8.
- **Movimentações de Cursos fora do Notion:** veja [Fora do escopo](#fora-do-escopo).

---

### Fase 0 — Fundação TypeScript

**Objetivo.** Criar o núcleo `packages/kb` e tirar do Python a validação da `revisar-ppc`, que hoje duplica regras do pipeline TypeScript.

**Entregas**

- **Workspace `packages/kb`,** no molde do `sei-cli`:
  - `package.json` com `"name": "@simplifica-if/kb"`, `"exports": { "./*": "./src/*.ts" }` e os scripts `test`, `typecheck` e `format`;
  - `tsconfig.json` estendendo um `tsconfig.base.json` comum, extraído do `tsconfig.json` da raiz;
  - na raiz, a dependência `"@simplifica-if/kb": "workspace:*"`. Os scripts das skills importam `@simplifica-if/kb/...`, e a resolução funciona também pelo symlink `.claude/skills`.
- **Kit de paridade movido para `packages/kb`:** `texto.ts`, `json.ts` e `schema.ts`. O `scripts/` passa a importá-lo de lá, para que a dependência vá num sentido só.
- **Configuração da raiz:**
  - `tsconfig.json` passa a incluir `.agents/skills/*/scripts/**/*.ts` e `.agents/skills/*/tests/**/*.ts`.
  - `test`: o executor de testes do Bun sobre `scripts ./.agents/skills`, mais os testes de cada pacote. O caminho precisava começar com `./`, porque o Bun ignorava diretórios com ponto. Desde o C0: `pnpm test`.
  - `format`: o formatador do Bun só com globs de `.ts` em `scripts/` e nas skills, porque sobre `.agents/skills/` ele reformataria fichas JSON e Markdown. Desde o C0: `pnpm fmt` (`vp fmt`), com as exclusões em `vite.config.ts`.
- **Validador da `revisar-ppc` em TypeScript:**
  - portar `validar_base_analise.py`, `gerar_indice_base_analise.py` e `gerar_mapa_fichas.py`, usando o `ajv` de `schema.ts` sobre os JSON Schemas atuais de `base-analise/schemas/`;
  - o casamento de referências vai para `packages/kb/src/normas/referencias.ts`, como semente do resolvedor da fase 2;
  - a validação da `revisar-ppc` passa a rodar também dentro de `node scripts/validar_base.ts`.
- **Entrypoint único `revisar_ppc.ts`.** Ele assume os subcomandos e chama o Python por subprocesso nos que ainda não foram portados. O `SKILL.md` muda uma vez só, e a trilha T troca as implementações por baixo.
- **Testes:** portar `test_marcos_normativos.py` e os casos de `test_flow.py` ligados à validação, ao índice e ao mapa. O resto de `test_flow.py` é fatiado junto com a trilha T.
- **Diferencial:**
  - `indice.json` e `mapa-fichas.md`: idênticos aos do Python, com `gerado_em` fixo;
  - mensagens de erro do validador: mesmas, sobre a base atual e sobre fixtures inválidas (casos negativos).

**Critério de aceite**

- `validar_base_analise.py`, `gerar_indice_base_analise.py` e `gerar_mapa_fichas.py` removidos.
- `pnpm exec vp test run .agents/skills` roda os casos portados, e a contagem aparece no relatório.
- `pnpm fmt:check` passa sem tocar JSON nem Markdown.
- `git grep` não encontra mais comandos Python para validar, indexar ou gerar o mapa em:
  - `instrucoes.md`;
  - `README.md` e `base-analise/README.md`;
  - `contratos/README.md`;
  - `docs/desenvolvimento-skills.md`;
  - `AGENTS.md` da raiz.

#### Regras para testes diferenciais (fase 0 e trilha T)

- **Relógio injetável.** `now_iso`, `timestamp_slug`, `gerado_em` e `data_conversao` recebem a data por parâmetro. O Python serializa UTC como `+00:00`, e o JS como `Z`: a saída deve seguir o formato atual.
- **Números.** O float `1.0` vira `1.0` no Python e `1` no JS (`cnct_catalogo.py`). O `round` do Python é bancário.
- **Ordenação.** Ordenar por code point, nunca com `localeCompare`. O JS põe chaves numéricas de objeto (`"2021"`) antes das demais: usar `Map` onde a ordem importa. Conferir a ordem dos `glob`.
- **Hash.** `sort_keys` do hash JSON (`common.py`) exige ordenação por code point.
- **Regex e Unicode.**
  - `\s`, `\d`, `\w` e `\b` são Unicode no Python: usar a flag `u` e classes explícitas.
  - `NFKD` + `encode("ascii", "ignore")` vira `normalize("NFKD").replace(/[^\x00-\x7f]/g, "")`.
  - `casefold()` não é o mesmo que `toLowerCase()`.
- **HTML.** `html.escape` do Python gera `&#x27;` para apóstrofo.
- **Funções sem equivalente direto.** `textwrap.wrap` e `difflib.SequenceMatcher` (com autojunk) precisam de porte próprio, testado contra o Python.
- **Ambiente de referência fixado:** `uv run --with python-docx==<versão>`, sem `rapidfuzz`, para que o fallback seja sempre o mesmo.

---

### Fase 1 — Conjunto de avaliação e harness

**Objetivo.** Medir a base como ela é usada de fato: por um agente LLM. A recuperação por grep mede quem escreveu o grep, não a base.

**Entregas**

- **`avaliacao/perguntas.yaml`,** com 20 a 30 perguntas tiradas do uso real. As 8 perguntas das análises de arquitetura são o núcleo:

  | # | Pergunta |
  |---|---|
  | Q1 | A carga horária dos integrados de Informática cumpre o mínimo da Res. CNE/CP 2/2026 e do CNCT? |
  | Q2 | Quais PPCs ainda citam a Res. CNE/CP 1/2021? |
  | Q3 | Que normas regem o estágio em Técnico em Enfermagem? |
  | Q4 | Que normas mudaram desde 01/01/2025 e o que isso impactou? |
  | Q5 | Como os PPCs de Agropecuária tratam o acompanhamento de egressos? |
  | Q6 | Os PPCs técnicos cobrem os incisos do art. 28 da Res. CNE/CP 2/2026? |
  | Q7 | Que dispositivo da Res. CNE/CP 2/2026 corresponde ao art. 20 da 1/2021? |
  | Q8 | Que campi ofertam cursos do eixo Informação e Comunicação, e em que turno? |

- **Gabaritos ancorados em ID e texto citado,** não em número de linha. O commit `304bc46` já reescreveu 7 normas, e número de linha não sobrevive a isso. Para perguntas de conjunto, o gabarito é o conjunto esperado, gerado por um comando versionado.
- **Três PPCs-ouro** com os achados esperados por ficha, para avaliar a `revisar-ppc` em si.
- **Harness `pnpm avaliacao`:**
  - chama um agente real (`claude -p`, modelo fixado) três vezes por pergunta;
  - pontua de forma determinística:
    - IDs e conjuntos esperados presentes na resposta;
    - citações proibidas (revogadas, inexistentes) ausentes;
    - número de chamadas de ferramenta e de tokens.
  - O relatório datado vai para `avaliacao/resultados/`.
- **Execução.** O harness roda sob demanda, antes e depois de cada fase de retrieval; não há CI no repositório. Os testes de componente (resolvedor, parser) rodam no `pnpm test`, a cada mudança.

**Linha de base.** Os números das análises de arquitetura (notas de 1,5 a 3,5, recall perto de 20% na Q2) não são reproduzíveis e não servem como referência. A linha de base é a primeira execução do harness.

---

### Fase 2 — Identidade de normas e resolvedor de citações

**Entregas**

- **Campo `id` no front matter e no `manifest.json`,** com lint de unicidade e formato, e `variante: compilacao` onde couber.
  - O parser de front matter passa a usar `yaml` com `schema: "failsafe"` (tudo como texto), mais a coerção zod de `ano`.
  - Critério: `manifest.json` com diff zero, exceto pelo campo novo. Com o schema padrão do `yaml`, `numero: 9394` viraria número, e o manifesto mudaria.
- **Normas-stub e referências `externo:`,** como definidos em [Arquitetura alvo](#arquitetura-alvo).
- **`resolverCitacao(texto)` em `packages/kb`:**
  - devolve `{ id, dispositivoId?, confianca, regra }`;
  - reconhece "nº 01/2021", "n° 1, de 5 de janeiro de 2021", URLs do DOU e do Planalto e quebras de OCR como "dejaneiro".
- **Fichas com referências estruturadas,** com schema zod da ficha:
  - formato `{ ref: "br/cne-cp/res/2026/2", dispositivo?: "#art28-vii", papel: "fundamento" }`;
  - o texto legível é renderizado a partir dele;
  - as 134 referências atuais são migradas, incluindo as 13 ao CNCT e as `externo:`.
- **`kb citacoes <id>`:** lista os PPCs que citam uma norma, de forma reproduzível.
- **Entrega para a gestão:**
  - o art. 71 da Res. CNE/CP 2/2026 alcança **todos** os cursos técnicos autorizados e em oferta, e não só os que citam a norma de 2021;
  - a lista de cursos sujeitos à adequação sai de `base-conhecimento/institucional/ifpr/` (nível técnico e situação ativa);
  - as citações viram um indicador de defasagem por curso: cita a CNE/CEB 6/2012, cita a CNE/CP 1/2021, cita a 2/2026 ou não cita DCN.

**Critério de aceite**

- O resolvedor atinge precisão ≥ 0,95 e recall ≥ 0,90 sobre cerca de 200 citações anotadas à mão em 20 PPCs.
- As 134 referências das fichas resolvem para um ID, de norma, stub ou `externo:`.
- A Q2 é respondida pelo harness com o conjunto do gabarito.

---

### Fase 3 — Curadoria rápida

Com os dados em `base-conhecimento/institucional/ifpr/`, cada campo novo é uma alteração de schema zod, revisada por diff.

**Entregas**

- **`cnct_id` no curso.** Por nome normalizado, 117 de 124 cursos de nível médio já casam. Os 7 restantes são triviais, como "Mecânica" e "Administração – PROEJA". A auditoria passa a acusar curso técnico ativo sem `cnct_id`.
- **Turno padronizado na oferta:**
  - um enum, mais uma nota;
  - antes, capturar as notas de rodapé dos editais (`¹`, `²`), que hoje não estão em `trecho_fonte`, para não perder informação;
  - hoje são 21 grafias, ou 25 contando as marcas de rodapé.
- **Curadoria do PPC por campo:** ano e vagas passam a ter status e data próprios.
- **Revisão dos 9 PPCs** com ano de capa anterior ao registrado.

**Critério de aceite**

- `cnct_id` em 100% dos cursos técnicos ativos.
- Turno 100% no enum, com o rodapé preservado.
- A Q8 é respondida pelo harness.

---

### Fase 4 — Proveniência de PPC e índice de seções v2

Esta fase vem antes do SQLite porque é barata e dá o maior ganho em busca temática.

**Entregas**

- **Proveniência no front matter de cada PPC convertido:**
  - URL de origem, hash do arquivo-fonte, data de conversão e versão do conversor;
  - o ano do documento continua em `base-conhecimento/institucional/ifpr/`.
- **Política de versão de PPC.** As adequações exigidas pelo art. 71 vão gerar reformulações em dois anos. **Decidido em 13/11/2026:** a base guarda só o PPC vigente de cada curso; o PPC novo substitui o Markdown no mesmo caminho, e as versões anteriores se recuperam pelo git (`git log --follow`, `git show <commit>:<caminho>`). O ID fica `ppc:<campus_id>/<curso_slug>`, sem `@<versão>`.
- **Índice de seções v2, ainda no pipeline atual:**
  - guarda as linhas de início e fim de cada seção no Markdown, além do preview de 500 caracteres. **Decidido em 13/11/2026:** o texto integral não é versionado (duplicaria cerca de 64 MB dos PPCs e incharia o histórico e o `site/` a cada regeneração); quem precisar dele lê as linhas do Markdown, e o texto integral indexado fica no `kb.sqlite` da fase 6, derivado e fora do git;
  - taxonomia separada por nível. Para cursos técnicos, ela cobre os incisos do art. 28. Graduação, pós e FIC (90 PPCs) ficam com uma taxonomia geral.
  - Hoje, "Acompanhamento do egresso" cai em `outros` em 107 de 107 ocorrências. Medido em 13/11/2026: 65% das ocorrências de seção, 78% dos títulos distintos e 60% do texto vão para `outros`.

**Critério de aceite**

- Menos de 20% das ocorrências de seção dos PPCs técnicos em `outros`.
- 100% dos PPCs com proveniência.
- A Q5 e a Q6 melhoram no harness em relação à linha de base.

---

### Fase 5 — Saneamento das normas, dispositivos, relações e vigência

**Entregas**

- **Saneamento antes do parser:**
  - a LDB precisa de headings só com o rótulo do artigo, de `**` fechados e de um parágrafo por linha;
  - as outras 9 normas passam a usar `#### Art.`;
  - o texto é preservado palavra por palavra, como no `304bc46`.
- **Parser de dispositivos** com `remark-parse` e `remark-gfm` (tabelas):
  - herda o caput nos incisos;
  - aplica as regras de ID da [Arquitetura alvo](#arquitetura-alvo);
  - trata notas técnicas sem artigos por seção;
  - as posições do mdast são em UTF-16, então a proveniência é convertida para linha.
- **Datas da norma:** `assinada_em`, `publicada_em` e `vigente_de`. A Res. CNE/CP 2/2026 depende de confirmar a data do DOU.
- **`base-conhecimento/relacoes.yaml`:**
  - relações `revoga`, `altera`, `regulamenta` e `fundamenta-se-em`, com origem, alvo (norma ou dispositivo), `efeito_de` e o dispositivo que opera a relação;
  - substitui os pares manuais do front matter: hoje são só 20 relações, e o `manifest.json` não as expõe;
  - o front matter das normas continua mostrando as relações, geradas a partir de `relacoes.yaml`, para quem lê o Markdown;
  - regex sobre "Ficam revogados" e "passa a vigorar" propõe arestas, e um humano confirma.
- **Vigência calculada para uma data explícita:**
  - `kb vigencia --em <data>`;
  - o `status_vigencia` publicado é calculado na `data_referencia` declarada em `config/`, atualizada de propósito, e não no relógio do build.
- **Regras de transição como dado.** O art. 70 e o art. 71 viram entidades próprias. `marcos-normativos.json` mantém só `transicao` e `orientacao_analise`; o resto é derivado.
- **Tabela de correspondência Res. CNE/CP 1/2021 → 2/2026,** logo depois dos IDs:
  - tipos `equivalente`, `parcial` e `sem-equivalente`;
  - exige leitura jurídica humana;
  - o custo de manter só se repete quando houver nova DCN.
- **`kb impacto <id>`:** lista fichas, validações cruzadas, PPCs e textos afetados.

**Critério de aceite**

- Os dispositivos concatenados reproduzem o corpo das 36 normas.
- IDs únicos, e 100% dos IDs citados nas fichas existem.
- Status calculado igual ao manual nas 36 normas, ou a diferença justificada.
- `kb impacto` para a revogação da 1/2021 medido contra os arquivos de conteúdo do `b4aded0`, com recall e precisão informados. São cerca de 41 arquivos, excluindo código, testes, schemas, READMEs e gerados.
- A Q4 e a Q7 são respondidas pelo harness.

---

### Fase 6 — Banco compilado e CLI `kb`

**Entregas**

- **`pnpm kb:compilar` gera `tmp/kb.sqlite`,** fora do git e reproduzível. O SQLite embutido no Bun, e no Node 26 desde o C0, é a versão 3.54.0 e suporta FTS5; isso foi verificado.
- **Busca textual:**
  - FTS5 com `tokenize="unicode61 remove_diacritics 2"`;
  - o FTS5 não tem stemmer para português, então uma coluna auxiliar recebe os termos reduzidos por um stemmer em TypeScript;
  - um léxico de sinônimos por tipo de seção completa a busca.
- **Texto integral das seções de PPC** (decisão da fase 4): o banco guarda o texto de cada seção, recortado pelas linhas do índice (`linha_inicio`–`linha_fim`); os JSONL versionados ficam só com preview e linhas.
- **Citações extraídas dos PPCs,** pelo resolvedor da fase 2, com seção e papel (fundamento ou referência bibliográfica).
- **Fatos de PPC cruzados com o SUAP.**
  - O SUAP já tem a carga horária das matrizes, inclusive a situação "CH divergentes".
  - O valor está em apontar a divergência entre PPC e SUAP, não em extrair a carga isoladamente de um texto convertido de PDF.
  - Cada fato traz `trecho_fonte` e status de curadoria.
- **CLI** `pnpm kb <comando> --json`, com `commander`, como o `sei-cli`. São 8 a 10 comandos:
  - `resolver`, `dispositivo`, `buscar-norma`;
  - `buscar-secoes`, `correspondencia`, `impacto`, `vigencia`;
  - `cursos`, `ppc-fatos`, `citacoes`.
  - Toda resposta traz o texto literal e a proveniência.
  - A CLI recompila o banco sozinha quando ele está ausente ou mais velho que as fontes.
- **`kb pacote-contexto <tarefa> <ppc>`** monta o contexto da `revisar-ppc` e substitui a montagem ad hoc de `subagents`.
- **`AGENTS.md`** passa a mandar os agentes consultarem a base pela CLI `kb`, mantendo os arquivos como alternativa.
- Consultas em SQL direto com `node:sqlite` (até o C0, `bun:sqlite`), com as linhas validadas por zod na fronteira e sem ORM.

**Critério de aceite**

- Dois builds sobre as mesmas fontes geram o mesmo hash do banco.
- Recall@10 ≥ 0,8 em consultas temáticas rotuladas.
- O harness mostra acerto igual ou maior que a linha de base, com menos tokens.
- Nos PPCs-ouro, a análise com `pacote-contexto` concorda com os achados esperados pelo menos tanto quanto a atual, usando contexto menor.

---

### Fase 7 — MCP

Entra só se surgir um consumidor sem shell: a CLI e os arquivos servem os agentes atuais.

- Servidor com `@modelcontextprotocol/sdk`, como casca fina sobre os comandos da CLI e com os mesmos schemas zod.

---

### Trilha T — Restante da migração Python → TypeScript

Corre em paralelo às fases 1 a 7. Cada passo troca uma implementação por baixo do entrypoint `revisar_ppc.ts` e só remove o Python depois do diferencial.

**T1. Orquestração**

- Portar `common.py`, `cnct_catalogo.py`, `subagents.py`, `preparar_documento.py` e o `markdown_normalizer.py`, que é só texto e que o `preparar_documento` importa.
- Subcomandos: `preparar-documento` (entrada `.md`), `montar-grupos-subagents`, `preparar-prompts-subagents`, `montar-grupo-avulso`, `mesclar-resultados-avulsos` e `validar-resultados`.
- `SequenceMatcher` precisa de porte próprio e testado.
- Diferencial: grupos, prompts e contextos idênticos para as fixtures, com relógio fixo.

**T2. Relatório e publicação**

- Portar `gerar_relatorio_html.py` com template literals e uma função de escape, sem framework. O `HTMLParser` do Python vira `htmlparser2`, que já é dependência.
- Portar `publicar_surge.py`, que só chama a CLI `surge` por `Bun.spawn`.
- Diferencial: HTML idêntico para as mesmas entradas.

**T3. Conversão DOCX** (concluído em 16/11/2026; veja [Andamento](#andamento))

- **Leitor OOXML** com `fflate` (`^0.8.2`, a mesma faixa do `sei-cli`) e `htmlparser2` em `xmlMode` com `domutils`, que preservam a ordem do conteúdo misto. Ele precisa reproduzir esta semântica do `python-docx`:
  - `style.name`, com o mapeamento de nomes internos (`heading 1` → `Heading 1`);
  - `row.cells` repetindo as células de `gridSpan` e resolvendo `vMerge`;
  - `Run.text` com `w:tab`, `w:br` e `noBreakHyphen`;
  - hyperlinks dentro de `paragraph.text`.
- **Extratores** de seções, matriz, ementário, identificação e imagens, além do escritor de Markdown.
- **Fallback "rendered"** de figuras vetoriais, que hoje depende de MS Word e poppler. Decidir entre:
  - `soffice --convert-to pdf` seguido de rasterização;
  - remover o fallback e emitir um alerta no `PPC.md` (decidido em 16/11/2026: o app não pode depender de programa externo).
- **Corpus** em `~/Library/CloudStorage/OneDrive-Pessoal/PPCs Dentec/`:
  - cerca de 12 DOCX, com versões sucessivas do mesmo PPC;
  - fica fora do git, porque são minutas com nomes de revisores;
  - o diferencial lê o caminho de `KB_CORPUS_DOCX` e grava em `tmp/`;
  - os arquivos estão só na nuvem: marcar a pasta como "Manter sempre neste dispositivo" antes de rodar;
  - as fixtures versionadas são trechos mínimos e anonimizados: uma matriz com células mescladas, um ementário e uma identificação.

**T4. PDF do calendário** (a skill `verificar-calendario` foi apagada em 16/11/2026, com o `render_relatorio_pdf.ts` e a dependência `pdfmake`)

- `render_relatorio_pdf.py` (`reportlab`) passa para `pdfmake`.
- Comparação visual e textual, com `creationDate` fixo.

**T5. Conversor de PDF de PPCs**

- O `pymupdf4llm` faz análise de layout (títulos por fonte, tabelas), coisa que o `unpdf` não faz. O OCR com `tesseract.js` também exige `@napi-rs/canvas`, que é nativo.
- Avaliar com 20 PPCs já convertidos.
- O desfecho provável é a **exceção Python**: um script único com metadados inline PEP 723, rodado por `uv run --script` e chamado pelo TypeScript por subprocesso, com teste de contrato.
- O download dos PDFs passa para TypeScript.

**Critério de aceite da trilha**

- `git ls-files '*.py'` só lista a exceção de T5, se houver.
- Os arquivos `requirements` foram removidos ou restritos à exceção.
- `git grep -nE 'python3?|pytest|pip install'` só encontra a exceção.
- `pnpm exec vp test run .agents/skills` roda pelo menos os 89 casos equivalentes.
- Há um relatório de diferencial por módulo, com os documentos do corpus e os diffs (zero ou aceitos).
- Numa rodada real com relógio fixo, os JSONs da rodada e o HTML saem idênticos aos da versão Python.

### Ferramentas do repositório fora do app

Item de roadmap (17/11/2026). Estas ferramentas são usadas por agentes e por quem cura a base, no repositório, e ainda não estão integradas ao app:

| Ferramenta | Sistema | Uso hoje | No app |
|---|---|---|---|
| `packages/sei-cli` | SEI | extração e leitura de processos (`pnpm sei`) | não |
| skill `revisar-processo-ppc` | SEI, pelo `sei-cli` | revisão do fluxo de processos SEI de PPC | não |
| skill `suap-ifpr` e `scripts/suap_*.ts` | SUAP | consulta, tutoriais e coleta de matrizes para a curadoria | não; o app mostra os dados do SUAP já publicados na base |
| sincronização SEI → Notion (`pnpm sei:sync`) e scripts do Notion | SEI e Notion | `Movimentações de Cursos` e `processos-sei/index.json` | não |
| skill `revisar-ppc` (sub-agentes, relatório HTML) | — | revisão de PPC por agente no repositório | em parte: o app tem a tarefa nativa "Revisar um PPC", que reaproveita as fichas e `packages/ppc` |

A integração das ferramentas de SEI e SUAP depende de o app voltar a acessar sistemas com login, o que o plano do app adia para depois do Marco 2 (decisão 6 e "Fora do escopo até o Marco 2" em [`docs/plans/app-simplifica-if.md`](docs/plans/app-simplifica-if.md)); o desenho de credenciais e sensibilidade está em [`docs/plans/app-seguranca-dados.md`](docs/plans/app-seguranca-dados.md), suspenso. A sincronização SEI → Notion segue a mesma condição e a direção de tirar `Movimentações de Cursos` do Notion ([Fora do escopo](#fora-do-escopo)). Até lá, essas ferramentas ficam no repositório, e o `AGENTS.md` as lista.

---

## Bibliotecas

| Biblioteca | Papel | Onde | Situação |
|---|---|---|---|
| `zod` 4 | Contratos de dados novos e reestruturados | 0, 2, 3 | Já usada |
| `ajv` | JSON Schemas existentes, com mensagens compatíveis (`schema.ts`) | 0 | Já usada; fica |
| `json-schema-to-typescript` | Tipos dos schemas públicos | — | Já usada; fica |
| `node:sqlite` (até o C0, `bun:sqlite`) | Banco compilado com FTS5 | 6 | Embutida |
| `commander` | CLIs `kb` e `revisar_ppc.ts` | 0, 6 | Já usada no `sei-cli` |
| `yaml` (`schema: "failsafe"`) | Front matter e `relacoes.yaml` | 2, 5 | Nova |
| `unified` + `remark-parse` + `remark-gfm` | Estrutura de normas e PPCs | 4, 5 | Nova |
| `fflate` + `htmlparser2` + `domutils` | Leitura de DOCX | T3 | Já usadas |
| `pdfmake` | PDF do calendário | T4 | Removida em 16/11/2026, com a skill `verificar-calendario` |
| `unpdf` + `tesseract.js` + `@napi-rs/canvas` | PDF → Markdown | T5 | Em avaliação; exceção provável |
| stemmer de português | Coluna auxiliar do FTS5 | 6 | Em avaliação: `snowball-stemmers` está parado desde 2022; comparar com RSLP |
| `@modelcontextprotocol/sdk` | Servidor MCP | 7 | Condicional |

As versões são fixadas exatamente na adoção (`pnpm add <pkg>@<versão>`).

**Inverter a direção dos schemas públicos** (gerar JSON Schema a partir de zod) fica como passo opcional, sem fase. Os testes com zod 4.6.7 mostraram diferenças em `z.toJSONSchema`:
- `.meta({ id })` gera `$defs` com `$ref`, e não `$id` na raiz;
- `nullable` vira `anyOf`;
- `z.int()` emite os limites ±2⁵³;
- as datas viram regex longas, e `datetime` recusa offset sem `{ offset: true }`;
- `z.object` sai com `additionalProperties: false`;
- os `pattern` saem com semântica de JS.

Por isso, só fazer com casos negativos e com diff dos schemas publicados.

**Descartados:**

| Opção | Motivo |
|---|---|
| ORM (Drizzle, Prisma) | Poucas tabelas e esquema gerado; SQL direto com validação zod basta |
| LangChain, LlamaIndex | Abstração sobre problemas determinísticos (IDs, relações, vigência) |
| Banco vetorial dedicado, banco de grafo | Volume pequeno; tabelas de arestas e CTE recursiva bastam |
| `mammoth` | Perde detalhes de tabela mesclada usados pelo extrator de matriz |
| `fast-xml-parser` | Lida mal com conteúdo misto do OOXML; `htmlparser2` já está no projeto |
| Embeddings e `sqlite-vec` | Sem medição que os justifique. No macOS, o `bun:sqlite` usa o SQLite do sistema, que não carrega extensões sem `setCustomSQLite` |

## O que não fazer

- Não versionar `kb.sqlite` nem torná-lo fonte de verdade.
- Não deixar um LLM inferir revogações, correspondências ou fatos de PPC sem confirmação humana versionada.
- Não fragmentar normas por janela de tokens: a unidade é o dispositivo, com o caput herdado.
- Não tratar "revogada" como "inaplicável": as regras de transição são dados.
- Não calcular nada com o relógio do build.
- Não reimplementar regras do núcleo fora de `packages/kb`.
- Não reformatar Markdown, JSON nem YAML: o `vp fmt` os exclui em `vite.config.ts`.

## Fora do escopo

**Movimentações de Cursos fora do Notion.** Decisão de 13/11/2026: fica registrada só como direção futura. Quando voltar à pauta:

- separar o registro da movimentação (editado por pessoas, raro) do estado SEI (derivado pela sincronização);
- levar o registro para `base-conhecimento/institucional/ifpr/movimentacoes/`;
- tratar o estado SEI como cache reconstruível.

A interface depende de quem edita:
- se forem só agentes e CLI, basta um painel somente leitura;
- se a equipe editar sem git, a opção é um SQLite hospedado (Cloudflare D1) com login.

O `kb.sqlite` nunca é o lugar de edição.

## Decisões em aberto

Decididas:
- núcleo em `packages/kb`;
- corpus DOCX na pasta `PPCs Dentec` do OneDrive;
- Movimentações fora do escopo;
- política de versão de PPC: só o vigente, com o histórico no git e ID `ppc:<campus_id>/<curso_slug>` sem versão (13/11/2026, fase 4);
- fallback "rendered" de figuras na conversão DOCX: removido, com aviso no `PPC.md` (16/11/2026, T3). Nos 12 PPCs do corpus, a figura vetorial é o fluxograma da representação gráfica, desenhado com formas do Word;
- conversor de PDF de PPCs (T5): removido, sem porte nem exceção Python; o repositório não tem mais código Python (17/11/2026);
- entrada de PPC novo na base (era o item 3 de "Em aberto"): script DOCX → base, pedindo o DOCX à coordenação do curso; PDF continua sem conversão, e não há conversão de PDF em TypeScript (17/11/2026). O `scripts/importar_ppc_docx.ts` converte com `converterPpc`, omite dados pessoais e URLs internas, grava o front matter de proveniência `registrada` e atualiza `ppc.url` e `ppc.markdown_path`; veja [Andamento](#andamento).

Em aberto:

1. **Modelo e orçamento do harness de avaliação:** modelo fixado e número de execuções por pergunta (fase 1).
2. **Data do DOU e URL oficial da Res. CNE/CP 2/2026:** necessárias para `publicada_em` e `vigente_de`; até lá, a vigência dela e a revogação da 1/2021 saem como "a confirmar" (fase 5).

## Andamento

**Fase 0 concluída em 13/11/2026** (branch `fase-0-fundacao-ts`).

- O workspace `packages/kb` foi criado, com o kit de paridade e `normas/referencias.ts`.
- O validador, o índice e o mapa da `analise-ppc` estão em TypeScript.
- O entrypoint `analise_ppc.ts` repassa ao Python os 7 subcomandos ainda não portados.
- Diferencial: 36 de 36 comparações idênticas em 12 cenários, incluindo casos negativos.
- Python restante: 64 casos pytest.
- Também foi corrigido o `types` do `sei-cli` (`bun-types` → `bun`), que deixava o typecheck quebrado desde a instalação isolada.

**Fase 1 implementada; falta a linha de base.**

- O que existe:
  - 25 perguntas em `avaliacao/perguntas.yaml`, 20 com gabarito curado e 5 provisórias;
  - os gabaritos de conjunto são gerados por `pnpm avaliacao:gabaritos`;
  - o harness roda com `pnpm avaliacao`;
  - há 3 PPCs-ouro em rascunho;
  - o smoke test com Q18 e haiku custou US$ 0,006.
- Antes da linha de base:
  - decidir modelo, execuções e orçamento (decisão em aberto 4);
  - testar `fontes_configuracao` para excluir hooks e plugins do usuário;
  - revisar os PPCs-ouro;
  - validar Q07, Q23 e Q25.
- Achados para as próximas fases:
  - o Markdown da Res. CNE/CP 1/2021 tem um heading falso "#### Art. 35-A" dentro do art. 26;
  - 17 PPCs citam a DCN da EPT como "CNE/CEB nº 1/2021", com o órgão trocado, e o resolvedor da fase 2 precisa tratar isso;
  - a Q08 se apoia em ofertas `sugerido` ainda não revisadas.

**Fase 2 concluída em 13/11/2026.** A 2a (branch `worktree-agent-ab78953406a22651e`) fez IDs, stubs, resolvedor e CLI; a 2b (branch `worktree-agent-abea7e713fbce0ddc`) fez as fichas com referências estruturadas, descritas depois da 2a.

- **IDs:** `id` no front matter das 36 normas e no `manifest.json` (diff só no campo novo), com lint de formato, unicidade e coerência com o ato em `validar_base.ts`. A LDB em trechos é `br/lei/1996/9394~compilacao`, com `variante: compilacao`; a regra está em `docs/padrao-front-matter-legislacao.md`.
- **Front matter:** `yaml` 2.9.1 em schema `failsafe` mais zod (`packages/kb/src/normas/front-matter.ts`); paridade com o parser antigo nas 36 normas.
- **Stubs e `externo:`:** `base-conhecimento/normas/stubs.yaml`, com 39 normas e 7 referências externas. Status só sai de "a confirmar" quando a base prova a revogação (7 casos, com `status_fonte`); o resto aguarda conferência em fonte oficial.
- **Resolvedor:** `resolverCitacao` e `extrairCitacoes` em `packages/kb/src/normas/resolver.ts`, com 19 regras nomeadas que dão ID (cada uma com sua confiança) e 7 que explicam a falta de ID, dispositivos (`#art28-xvi`) e as 134 referências das fichas resolvidas para ID (norma, stub, `externo:` ou `cnct:catalogo`). `referencias.ts` ficou intacto para o validador da `analise-ppc`.
- **CLI `kb`:** `resolver`, `citacoes`, `adequacao-art71` e `avaliar-resolvedor`, todos com `--json`.
- **Medida:** 257 citações anotadas em 198 linhas de 20 PPCs (`avaliacao/resolvedor/`, rascunho). Precisão 0,98, recall 0,957, dispositivos 0,905. O conjunto serviu também para ajustar as regras, então os números são otimistas; falta revisão humana e um conjunto independente.
- **Q02:** o gabarito vem de `kb citacoes br/cne-cp/res/2021/1`: os mesmos 59 PPCs da heurística anterior, agora com linha e regra de cada ocorrência. A heurística `gabaritos/citacoes.ts` foi removida.
- **Art. 71:** 112 cursos técnicos ativos ou em oferta. Pela DCN mais recente que o PPC cita: 0 citam a 2/2026, 39 a CNE/CP 1/2021, 63 a CNE/CEB 6/2012, 2 só a CNE/CEB 4/1999, 4 não citam DCN e 4 não têm PPC convertido.
- **Achados:**
  - 17 PPCs citam a DCN de 2021 com o órgão trocado (CNE/CEB); 1 a cita como "CNE/CP nº 1, de 5 de janeiro de 2022" e cai na CNE/CP 1/2022;
  - há duas Instruções Normativas do IFPR nº 1/2021 (26/07, curricularização da extensão, e 19/08, bibliotecas), citadas muitas vezes sem órgão;
  - a ficha `ct-ident-15` cita uma "Resolução CNE/CP nº 2/2025" que não foi identificada.

**Fase 2b concluída em 13/11/2026** (branch `worktree-agent-abea7e713fbce0ddc`).

- **Formato:** `referencias_normativas` das fichas é uma lista de `{ ref, dispositivo?, papel, nota? }`, uma entrada por dispositivo. `papel` é `fundamento` (a ficha aplica a regra) ou `complementar` (só remete a ela); `nota` guarda o que não cabe no ID, como o número SEI. `ref` aceita ato sem variante, stub, `externo:` e `cnct:` (`cnct:catalogo` ou `cnct:<curso>`). Contrato em `packages/kb/src/normas/referencia-estruturada.ts`; regras de citação em `base-analise/README.md`.
- **Migração:** as 134 citações viraram 206 entradas, por script com `resolverCitacao` (109 pela regra `estrutural`, 25 por `alias`), removido depois do uso (commit `f232c31`). Cada citação foi conferida por ida e volta: o texto renderizado é igual ao original em 114 casos; nos outros 20 muda só o título canônico (CNCT, LDB), entra a nota (SEI, recorte do CNCT) ou o dispositivo revisado. Seis entradas ficaram `complementar`. A "Resolução CNE/CP nº 2/2025" da `ct-ident-15` foi identificada pelo art. 45, § 3º, da 2/2026 (trava digital do Sistec, art. 1º).
- **Marcos:** `vigente`, `substitui` e `antecessoras_historicas` por ID; `dispositivos_revogados` como `ato#dispositivo`. `transicao` e `orientacao_analise` continuam em prosa. `stubs.yaml` ganhou as Res. CONSUP/IFPR 11/2009 e 53/2011, revogadas pela 239/2025; a medida do resolvedor e os gabaritos não mudaram.
- **Schemas:** o zod de `scripts/esquemas.ts` é a fonte única da ficha e dos marcos. `ficha.schema.json` e `marcos-normativos.schema.json` são gerados por `analise_ppc.ts gerar-schemas`, conferidos por `--check` e por `validar-base`; o validador aplica o JSON Schema gerado com o `ajv`, para manter o formato das mensagens.
- **Texto legível** (`normas/texto-dispositivos.ts` + título canônico) nas fichas dos grupos e prompts dos sub-agentes (com `ref`, `papel` e `path` da norma), nos marcos do contexto normativo, no `indice.json` (com `normas_citadas`) e no `mapa-fichas.md`, que ganhou a lista de fichas por norma.
- **Validador por ID:** ID inexistente, norma revogada (manifesto ou stub), norma substituída por marco, dispositivo revogado ou contido nele, referência repetida; formato de `ref` e `dispositivo` pelo schema. O casamento textual `normas/referencias.ts` perdeu o último consumidor e foi removido.
- **Pendências:**
  - a existência do dispositivo no texto da norma depende do parser da fase 5;
  - o `papel` foi atribuído na migração por regra simples (`fundamento`, salvo seis casos revisados) e merece revisão humana ficha a ficha;
  - os stubs novos e o da Res. CNE/CP nº 2/2025 continuam em `curadoria: rascunho`;
  - `cnct:<curso>` é aceito, mas nenhuma ficha o usa: as fichas citam o catálogo, e o curso vem do contexto da rodada;
  - as validações cruzadas continuam sem `referencias_normativas`.

**Fase 3 concluída em 13/11/2026** (branch `worktree-agent-a06982efc2d096698`).

- **`cnct_id`:** os 124 cursos de nível médio receberam `cnct_id` (`cnct:<id>` de `catalogos/cnct/index.json`) pela denominação normalizada: 123 casam, inclusive "Mecânica", "Administração – PROEJA" e os demais nomes sem "Técnico em" de Campo Largo. O único sem habilitação, Melhoria de Processos (Arapongas, suspenso), tem `cnct_ausencia` com o motivo: o PPC declara oferta experimental fora do CNCT. A auditoria acusa curso técnico ativo ou em oferta sem nenhum dos dois, e `validar_base.ts`, `cnct_id` fora do catálogo. Os dois campos são publicados no curso (`campus.schema.json`).
- **Turno:** enum de 7 valores (`matutino` 58, `vespertino` 26, `noturno` 35, `integral` 5, `diurno` 38, `matutino-com-contraturno` 38, `vespertino-com-contraturno` 6), mais `turno_original` (a grafia exata, com marca) e `turno_nota`. As notas de rodapé vieram dos editais: 87/2024 (SEI) e 88/2024 (PDF) para 2025, conferidos oferta a oferta; 130/2025 (retificado pelo 138/2025) e 128/2025 para 2026, porque a página de cursos do PS 2026, fonte das ofertas, saiu do ar. São 85 ofertas com `turno_nota`. `padronizarTurno` propõe o enum, e a auditoria recusa marca de rodapé sem nota. O `turno` público passou de texto livre a enum; a grafia antiga está em `turno_original`.
- **Curadoria do PPC por campo:** `curadoria_ano`/`data_curadoria_ano` e `curadoria_vagas`/`data_curadoria_vagas` substituem o par único; na migração, os dois campos herdaram o par. O JSON público já tinha status por campo, e o formato não mudou.
- **9 PPCs com ano de capa anterior ao registrado:** 1 corrigido (Assis Chateaubriand, Agropecuária subsequente, 2023 → 2021). Nos outros 8, o ano registrado é o de aprovação, ajuste ou atualização citado na própria capa; a evidência está em `ppc.observacoes`, e a convenção aguarda decisão humana.
- **Q08:** o gabarito usa `cnct_id` e o turno padronizado (Q01 e Q05 também passaram ao `cnct_id`), com os mesmos conjuntos.
- **Pendências:**
  - 8 ofertas de 2026 divergem do Anexo I do Edital 130/2025 no turno (Coronel Vivida ×2, Foz do Iguaçu ×3, Ivaiporã, União da Vitória ×2), e a de Toledo não consta dele. A divergência está em `turno_nota`. Uma delas, Foz do Iguaçu, Desenvolvimento de Sistemas, é âncora da Q08: matutino na página e integral no edital;
  - convenção do ano do PPC (capa ou ato posterior);
  - o `trecho_fonte` público do ano do PPC ainda diz "registrado no Notion".

**Trilha T, passo T1 concluído em 13/11/2026** (branch `worktree-agent-ac5acad58383e32fc`).

- O que foi portado:
  - `common.py`, `cnct_catalogo.py`, `subagents.py`, `preparar_documento.py` e `markdown_normalizer.py` viraram `rodada.ts`, `cnct-catalogo.ts`, `subagents.ts`, `preparar-documento.ts` e `normalizador-markdown.ts`;
  - a validação de resultados de `gerar_relatorio_html.py` virou `resultados.ts`;
  - o `analise_ppc.ts` executa em TypeScript `preparar-documento`, `montar-grupos-subagents`, `preparar-prompts-subagents`, `montar-grupo-avulso`, `mesclar-resultados-avulsos` e `validar-resultados`.
- Kit de paridade novo em `packages/kb/src/python/`, testado contra o Python 3.14: `SequenceMatcher` com autojunk, JSON do Python (`1.0` como `FloatPy`, inteiros grandes, `NaN`, ordem de chaves numéricas, `sort_keys`), `repr` e `round` de float, `casefold` com tabela gerada do Unicode 16, `isdigit`, `split()` e regex com `\s`, `\d`, `\w`, `\b`, `.` e `$` do Python.
- Relógio: `ANALISE_PPC_AGORA` fixa o nome da rodada, `criado_em` e o `data_conversao` da conversão DOCX; `ANALISE_PPC_PYTHON` escolhe o interpretador.
- Diferencial, com Python 3.14 + `python-docx` 1.2.0, sem `rapidfuzz`:
  - 30 cenários completos: as 2 fixtures, 7 PPCs técnicos reais, 20 Markdowns sintéticos (os casos de `test_flow.py`, CRLF, BOM, `ß`, extensão `.MD`, vazio, campus ambíguo) e 1 DOCX sintético gerado com `python-docx`;
  - cada cenário roda a cadeia inteira, 41 chamadas de `validar-resultados` (34 negativas), 6 mesclas (3 negativas) e um grupo avulso com ficha inexistente;
  - mais `preparar-documento` + `montar-grupos-subagents` nos 202 PPCs da base;
  - resultado: 8.713 comparações (arquivos byte a byte, stdout e código de saída) idênticas e nenhuma diferença, em `America/Sao_Paulo`; as fixtures também em `UTC` e `Asia/Kolkata`.
- Divergências aceitas, todas em caminhos de erro: o Python imprime traceback, e o TypeScript, uma linha `Tipo: mensagem`; o texto de arquivo ausente difere (`ENOENT` em vez de `[Errno 2]`); erros de linha de comando seguem o `commander` (código 1), e não o `argparse` (código 2). Limites conhecidos, sem ocorrência nos fluxos portados: inteiros acima de 2⁵³ são preservados na leitura e na escrita (como `bigint`), mas não em aritmética; e chaves numéricas acrescentadas por código a objetos lidos não seguem a ordem de inserção.
- Python que continua:
  - `gerar_relatorio_html.py`, `publicar_surge.py` e `analise_ppc.py`, reduzido ao `gerar-relatorio-html` (T2);
  - `common.py`, reduzido ao que o relatório usa (T2);
  - `conversao_docx/` e o novo `converter_docx.py`, chamado por subprocesso para entrada `.docx` (T3). O `markdown_normalizer.py` fica só para a conversão, igual ao porte.
- Testes: `orquestracao.test.ts` (51 casos) porta 36 testes de `test_flow.py`; o `pytest` ficou com 28 casos (relatório, Surge e extratores DOCX), e o `test_flow.py` cria a rodada pelo entrypoint TypeScript, exercitando a cadeia mista.

**Trilha T, passo T2 concluído em 13/11/2026** (branch `worktree-agent-a642457c659eb2137`).

- O que foi portado:
  - `gerar_relatorio_html.py` virou `relatorio-html.ts`, com template literals e o escape de `html.escape` (`&#x27;`);
  - o `HTMLParser` do `_HTMLPrettyPrinter` virou `html-py.ts`, sobre o `Tokenizer` do `htmlparser2`. O `Parser` não serve, porque fecha tags implicitamente e o Python não (`<em>a<strong>b</em>c</strong>`). O porte reproduz uma peculiaridade do Python: fora de tags inline, o texto em volta de uma referência é aparado pedaço a pedaço, e `a &amp; b` sai `a&amp;b`;
  - `publicar_surge.py` virou `publicar-surge.ts` (`Bun.spawnSync` da CLI `surge`);
  - o `analise_ppc.ts` executa `gerar-relatorio-html` em TypeScript, com as mesmas opções, arquivos (HTML, `assets/`, `surge-site/`, `surge-publicacao.json`) e saída JSON.
- Kit de paridade novo em `packages/kb/src/python/`: `textwrap.wrap` (`break_on_hyphens=False`), `html.escape`, `str.expandtabs`, `shlex.split`, `urllib.parse.quote` e `Path.as_uri()`, e `format(x, ".2f")` com empate para o par (o `toFixed` desempata para cima).
- Diferencial, com Python 3.14, relógio fixo e Surge falso no `PATH` (nada foi publicado de verdade):
  - 196 cenários: Markdown base e sintéticos (tabelas irregulares, listas, `<br>`, ênfases cruzadas, entidades, `\u2028`, CRLF, linhas longas), as 2 fixtures e 6 PPCs técnicos reais, cada um com resultados simples e 3 variados (todos os estados, evidências em texto e objeto com `anchor`, todos os status de `fundamentacao_normativa`, alertas transversais, `feedback_autores`, HTML, aspas e emoji); mais os 104 PPCs técnicos da base com resultados variados; 10 de publicação (sucesso, domínio padrão, por opção e por ambiente, `ANALISE_PPC_SURGE_CMD` com aspas, falha, saída sem confirmação, pedido de login, `surge-site` recriado); layout legado, `--resultados` absoluto e na raiz, caminho com espaço e caracteres reservados; e 27 casos negativos;
  - 2.318 comparações (código de saída, stdout, stderr e todos os arquivos da rodada byte a byte, mais os argumentos recebidos pelo Surge falso): 2.311 idênticas, e as 7 restantes são as divergências aceitas abaixo.
- Divergências aceitas, todas em caminhos de erro: o Python imprime traceback, e o TypeScript, uma linha `Tipo: mensagem` (com as mesmas mensagens); o texto de arquivo ausente difere (`ENOENT` em vez de `[Errno 2]`); erros de linha de comando seguem o `commander` (código 1), e não o `argparse` (código 2). Limites conhecidos, sem ocorrência no HTML que o relatório gera: casos patológicos de tokenização HTML (atributos com `/`, tags incompletas no fim do documento) não foram portados.
- Removidos: `gerar_relatorio_html.py`, `publicar_surge.py`, `analise_ppc.py`, `common.py` e `test_flow.py`.
- Testes: `relatorio.test.ts` (25 casos) porta os 20 testes de relatório e Surge de `test_flow.py` (o 21º, sem CLI de modelo, já estava em `orquestracao.test.ts`) e acrescenta a paridade do `_HTMLPrettyPrinter`, dos blocos e do unescape de atributos; `paridade-t2.test.ts` (8 casos) cobre o kit novo. O `pytest` ficou com os extratores DOCX.
- Python que continua: `conversao_docx/` e `converter_docx.py`, chamados por subprocesso para entrada `.docx` (T3); fora da skill, `scripts/converter_ppcs_markdown.py` (T5) e `verificar-calendario/scripts/render_relatorio_pdf.py` (T4).

**Trilha T, passo T4 concluído em 13/11/2026** (branch `worktree-agent-ab57257c2f314c964`).

- O que foi portado:
  - `render_relatorio_pdf.py` (`reportlab`) virou `render_relatorio_pdf.ts` (`pdfmake` 0.3.13), com a mesma interface (`<relatorio.md> <relatorio.pdf>`), o mesmo subconjunto de Markdown (título e subtítulo nas duas primeiras linhas, metadados `**Chave:** valor`, tabelas `| Item |` de 3 colunas, conclusões `N. **Pergunta** resposta` renumeradas, `` `código` `` e `**negrito**` com a ordem das regex do Python) e o mesmo leiaute (A4, margens de 14 mm mais os 6 pt do `Frame`, estilos, cores, grade, fundos alternados e cabeçalho repetido);
  - `VERIFICAR_CALENDARIO_AGORA` fixa a data de criação, e a saída fica reproduzível byte a byte;
  - fontes: Helvetica e Courier padrão do PDF, sem arquivo embutido, como no `reportlab`.
- O que foi preciso para chegar à paridade:
  - kerning desligado nas métricas AFM do `pdfkit` (o `reportlab` não aplica);
  - quebra de linhas do `reportlab` em `quebra-linhas.ts`: `breakLines` (só em espaços, com o encolhimento de 5% dos espaços) nos parágrafos e `cjkFragSplit` nas células (`wordWrap="CJK"`: o espaço que segue a palavra conta, e palavra longa é cortada no meio). O `pdfmake` recebe as linhas prontas, com folga na caixa para não quebrá-las de novo;
  - cada linha é um nó com margem de cima `corpo − ascendente` e altura `entrelinha − margem`, para a linha de base ficar a um corpo do topo (o `pdfmake` a põe a um ascendente). As linhas vão em blocos inquebráveis, porque o `pdfmake` descarta a margem de um nó que passa de página; as duas primeiras ficam juntas (`allowOrphans=0`);
  - espaços colapsados dentro de cada trecho, e não entre trechos, como o `Paragraph`.
- Diferencial com Python 3.14 + `reportlab` 5.1.0 (`rl_config.invariant`) em 12 Markdowns: 2 com as tabelas de `referencias/2026.md` e `2027.md` preenchidas, um de 150 linhas (18 páginas), marcações e casos de borda, sem conclusão, sem tabela, BOM com CRLF, caracteres fora da WinAnsi, a fixture do teste e 3 relatórios reais do formato antigo (de fora do git):
  - páginas: iguais nos 12;
  - texto extraído (`pdftotext`, sem espaços): igual em 11; no de caracteres fora da WinAnsi, só eles diferem;
  - posição das palavras (`pdftotext -bbox`): nos 8 casos só com caracteres WinAnsi, mesmas palavras nas mesmas páginas, com diferença máxima de 0,35 pt em y (espessura da grade) e 0 em x; nos 4 com caracteres fora dela, as mesmas palavras nas mesmas linhas, com até 0,7 pt de diferença em y e até 3,3 pt em x depois de um glifo de reserva (larguras da Roboto, e não da Symbol);
  - visual (`pdftoppm` a 80 dpi, imagens lado a lado e diferença em `tmp/t4/saida/`): de 0 a 2,9% de pixels diferentes, só antisserrilhado e o deslocamento de 0,35 pt.
- Divergências aceitas, todas em caracteres fora da cp1252: o `reportlab` desenhava `≥`, `→`, `✓` etc. com as fontes Symbol e ZapfDingbats, que o `pdfkit` não sabe usar (declara toda fonte padrão como WinAnsi). O porte usa a Roboto que acompanha o `pdfmake` (`≥`, `≤`, `≠`, `√`, grego), embutida só quando necessária; o que ela não tem (setas, `✓`, emoji, seletores de variação, BOM) sai como `■`, como no `reportlab`, com o mesmo avanço, mas um quadrado menor. Nas linhas com Roboto, a linha de base desce até 0,7 pt, e o `pdftotext` separa os `■` em palavras.
- Removidos: `render_relatorio_pdf.py` e o `requirements.txt` da skill; `SKILL.md`, `instrucoes.md` e `README.md` usam `node .agents/skills/verificar-calendario/scripts/render_relatorio_pdf.ts`.
- Testes: `render-relatorio-pdf.test.ts` (11 casos): leitura do Markdown, quebra de linhas, a fixture renderizada (2 páginas, cabeçalho repetido, texto em ordem), reprodutibilidade, fonte de reserva e CLI.
- Python que continua: `conversao_docx/` e `converter_docx.py` (T3) e `scripts/converter_ppcs_markdown.py` (T5).

**Correção da identificação do curso na `analise-ppc` concluída em 13/11/2026** (branch `worktree-agent-a58349c2b0998de53`; achado da rodada real do T1, em que o Técnico em Enfermagem de Curitiba saiu com curso `"Resolução CNE/CP nº 1/2021||||"`).

- Causa: `infer_identificacao_from_markdown` (portado no T1) casava `curso\s*:\s*(.+)` em qualquer ponto do documento, e a primeira ocorrência era "Base legal específica do curso: Resolução …"; campus, forma de oferta e modalidade tinham o mesmo defeito (rótulo no meio da frase, valor até o fim da linha) e a forma caía em "INTEGRADO" em qualquer lugar do texto. No `.docx`, o Python repetia o padrão (`curso[:\s]+(.+)` nos parágrafos, `re.search("curso", campo)` nas tabelas, que pegava "Coordenador do curso") e os dados da conversão sobrescreviam o Markdown.
- Correção: `scripts/identificacao.ts` (a identificação saiu de `rodada.ts`). Rótulo só vale no início de linha, célula ou trecho em negrito, ou no meio da linha com inicial maiúscula e dois-pontos; o valor termina no próximo rótulo; título numerado seguido do valor, tabela `| rótulo | valor |`, grade de opções com X, capa em caixa alta; validadores por campo (nome de curso sem "Resolução", "Lei", "nº", horas; campus pela lista de campi, sem "Reitoria"; forma e modalidade canônicas, pelo que o valor diz e não pelo rótulo; eixo pelo CNCT). Front matter YAML no topo é ignorado. Nada consulta `base-conhecimento/institucional/ifpr/`. `metadata.json` ganhou `eixo_tecnologico` também para `.md` e `identificacao_fontes`. O curso sai sem "Curso" na frente ("Técnico em Enfermagem"), e a forma de oferta sai canônica ("Subsequente", "Integrado (PROEJA)").
- `.docx`: a extração roda sobre o `PPC.md` da conversão e os dados do Python só preenchem lacunas, pelos mesmos validadores. No Python, correção mínima e equivalente: rótulos de identificação ancorados no início, com dois-pontos, em `identification_extractor.py` e `section_detector.py` (a T3 porta isso).
- Medida: `analise_ppc.ts medir-identificacao` compara com `base-conhecimento/institucional/ifpr/cursos` (só leitura) nos 110 PPCs técnicos da base, sem usar o nome do arquivo. Antes → depois: curso 50,9% → 99,1%; campus 30,0% → 99,1%; forma de oferta 94,5% → 100%; modalidade 32,7% → 99,1%. As heurísticas foram ajustadas sobre o mesmo conjunto, então os números são otimistas.
- Casos restantes: `campo-largo/tecnico-em-mecanica-subsequente.md` (OCR sem espaços, "TECNICOEMMECANICA"); `ponta-grossa/tecnico-em-informatica-integrado-ao-ensino-medio.md` (o arquivo é o PPC de Curitiba: endereço, página e e-mail de Curitiba, nenhuma menção a Ponta Grossa; precisa de curadoria do PPC); `arapongas/tecnico-em-melhoria-de-processos.md` (o PPC marca "( x ) Presencial" e o gabarito diz `ead`; conferir o gabarito).
- Testes: `identificacao.test.ts` (16 casos, com a amostra fixa de 13 PPCs da base e um DOCX sintético pela cadeia inteira) e `test_identificacao_docx.py` (3 casos, que falham no Python anterior).

**Fase 4 concluída em 13/11/2026** (branch `worktree-agent-a3f03148ee02d376b`).

- **Política de PPC:** decisão do usuário: só o PPC vigente, histórico no git, ID `ppc:<campus_id>/<curso_slug>` sem versão. Registrada em [Arquitetura alvo](#arquitetura-alvo), na fase 4 e em `docs/curadoria-metadados-institucionais.md`.
- **Proveniência:** front matter YAML nos 202 PPCs (`id`, `fonte_url`, `fonte_sha256`, `convertido_em`, `conversor`, `proveniencia`), contrato zod em `packages/kb/src/ppcs/front-matter.ts`, lido pelo parser `failsafe` das normas.
  - Os 202 têm proveniência `reconstruida` pelo git: `convertido_em` e `conversao_commit` do último commit que acrescentou ou reconverteu o arquivo (191 em 11/05/2026, os demais entre 19/05 e 06/07); `fonte_url` do campus JSON nesse commit, igual ao `ppc.url` atual nos 202; `pos_processamento_commits` em 200 (limpezas de ruído e remoção de sumário).
  - Ficaram `desconhecido` o hash e o conversor: o PDF da época não foi guardado, e baixar os 202 PDFs hoje não provaria que são os arquivos convertidos. O script de preenchimento ficou registrado no commit `367a87b` e foi removido.
  - `scripts/converter_ppcs_markdown.py` grava `registrada` (SHA-256 dos bytes baixados, versões do `pymupdf4llm` e do PyMuPDF, OCR), no mesmo formato do serializador TypeScript.
  - `validar_base.ts` exige o front matter, o `id` coerente com o caminho e `fonte_url` igual ao `ppc.url` vigente (URL nova exige reconversão).
- **Consumidores:** `kb citacoes`, `kb adequacao-art71`, `kb avaliar-resolvedor` e os gabaritos leem o PPC com o front matter em branco, preservando as linhas do arquivo (as citações deslocam de 10 a 13 linhas; Q02 regenerado, só com `linha` alterada; 59 PPCs, mesmas ocorrências e regras; resolvedor com as mesmas métricas). O `preparar-documento` da `analise-ppc` descarta o front matter: `PPC.md` e identificação idênticos nos 202 PPCs, e a rodada até `montar-grupos-subagents` idêntica no PPC de Enfermagem de Curitiba.
- **Índice de seções v2** (`packages/kb/src/ppcs/secoes.ts`, schemas `ppcs_index` v2 e `ppcs_secao` novo):
  - preview de 500 caracteres com `linha_inicio` e `linha_fim` no `.md` (contadas com o front matter), `numeracao`, `nivel`, `taxonomia` e `origem_tipo`; `textoDaSecao` e `lerTextoSecao` (`packages/kb`) reconstroem o texto integral pelas linhas, testado nas 20 mil seções dos 202 PPCs;
  - decisão: o git guarda preview e linhas; o texto integral fica no `kb.sqlite` da fase 6. Uma primeira versão com texto integral nos JSONL (63,7 MB) foi descartada antes do merge e não ficou no histórico;
  - taxonomia `tecnico` (32 tipos; os 22 ligados ao art. 28 cobrem os incisos I a XVIII e os §§ 1º e 4º) e `geral` (29 tipos), publicadas em `secoes.taxonomias`;
  - segmentação: cabeçalhos de página não abrem seção; rótulos internos ("EMENTA:", "Bibliografia básica", "1º ano") ficam no texto; "Componente curricular: …" abre seção no ementário; título sem regra herda do ancestral numerado ou da seção anterior; zonas pré-textual e de anexos.
- **Medida** (ocorrências com 40+ caracteres; antes com a segmentação e a taxonomia v1):

  | | Antes | Só regras de título novas | v2 |
  |---|---|---|---|
  | Técnicos em `outros` | 60,3% (8.521 de 14.131) | 35,5% | **1,3%** (118 de 9.086) |
  | Geral em `outros` | 69,5% (11.253 de 16.185) | 31,4% | 0,9% (102 de 11.924) |
  | "Acompanhamento do egresso" em `outros` | 107 de 107 | — | 0; 109 seções `acompanhamento_egresso` |

  Nos técnicos, 3,0% das ocorrências são `pretextual` e 12,5% `anexos`. O tipo vem do título em 56%, da numeração em 3% e do contexto em 39% (sobretudo componentes do ementário e subdivisões de anexos e regulamentos); amostras de herança por contexto mostraram acerto alto, mas sem medida formal.
- **Tamanho:** `index.json` 152 KB → 235 KB; `secoes/` 9,0 MB → 19,9 MB (32 arquivos; o maior, `ementas.jsonl`, 4,6 MB). O aumento vem de mais seções indexadas (anexos, componentes do ementário e tipos novos) e dos campos novos por linha.
- **Pendências:**
  - Q5 e Q6 no harness, quando houver linha de base (fase 1);
  - revisão humana de uma amostra da classificação, sobretudo das heranças por contexto;
  - ~~o conversor ainda lê e grava `conversao` nos campus JSON gerados~~: resolvido em 17/11/2026, o conversor lê os registros de cursos e não grava neles;
  - a identificação de curso da `analise-ppc` pode usar o `id` do front matter (hoje ele é só descartado).

**Fase 5 concluída em 13/11/2026** (branch `worktree-agent-aed7a4ecca512e2d8`).

- **Saneamento sem mudar palavras:** LDB (116 cabeçalhos com caput separados, `**` soltos removidos, parágrafos colados separados, capítulo V-A e dois períodos partidos recompostos), Leis 10.639, 11.645, 11.788, 12.711, 14.945 e 15.468 e Res. CONSUP 222/2024 e 242/2025 com `#### Art.` (a 12.711 mantém o rótulo "ARTIGO" do arquivo, para preservar palavras); a NT PROENS 1/2025 é lida por seção. Texto de outra norma alterado vai em citação (`>`); redações não vigentes reproduzidas ao lado da vigente (Lei 11.892, Res. 259/2025) e o "Art. 2º" que não consta da Res. 50/2017 publicada ficam entre comentários HTML; rótulos de parágrafo e inciso em negrito em 13 normas; heading falso "Art. 35-A" da Res. CNE/CP 1/2021 recomposto. Prova: `saneamento.test.ts` compara as palavras das 36 normas com `fcfc006` (36/36 idênticas). Lint da estrutura em `validar_base.ts`.
- **Parser** (`normas/estrutura.ts`, `remark-parse` 11.0.0 + `remark-gfm` 4.0.1 + `unified` 11.0.5): 4.891 dispositivos (1.281 artigos, 1.188 parágrafos, 2.224 incisos, 191 alíneas, 6 anexos, 1 seção), com caput herdado, notas de redação (379 dispositivos), 19 revogados e 10 vetados, estrutura e linhas. Reconstituição: os segmentos reproduzem o corpo das 36 normas, palavra por palavra (36/36); IDs únicos e no formato (regex ampliada para inciso com letra, item de alínea, `#anexoN-artX` e `#secaoN`); 4 avisos de rótulo repetido no texto publicado (ID pela posição). 100% dos dispositivos citados nas fichas e nos marcos existem (122; o único de stub, `br/cne-cp/res/2025/2#art1`, não tem texto para conferir). Compilação da LDB: dispositivos com o ID do arquivo, deduplicados pelo ato (o integral prevalece).
- **Datas:** `assinada_em`, `publicada_em`, `vigente_de` e `datas_fonte` nas 36 normas (zod e `manifest.json`); "a confirmar" quando a base não prova a data: publicação de 17 normas e início de vigência de 8, inclusive a Res. CNE/CP 2/2026 (decisão em aberto 4). Três leis conferidas no Planalto (12.711, 13.146, 14.945).
- **Relações:** `base-conhecimento/relacoes.yaml` com 59 relações (39 `revoga`, 12 `altera`, 1 `regulamenta`, 7 `fundamenta-se-em`), cada uma com evidência literal conferida pelo validador: 32 pares migrados do front matter, 16 propostas do regex confirmadas no texto, 11 manuais; 6 propostas descartadas com motivo (`kb relacoes --propor` fica vazio). O front matter mostra as relações geradas por `gerar_base.ts`. 27 stubs novos como alvos e origens.
- **Vigência:** `data_referencia` em `base-conhecimento/config/vigencia.yaml`; `status_vigencia` gerado. Igual ao manual em 30 das 35 normas com status calculado (a compilação continua manual); as 5 diferenças vêm de relações confirmadas no texto: LDB e Res. 55/2011, 8/2014 e 276/2026 passam a `parcialmente revogada` e a 259/2025 a `alterada`. Status incerto em 11 normas (`vigencia_a_confirmar`).
- **Transições como dado:** `base-conhecimento/transicoes.yaml` (arts. 70 a 73 da 2/2026, 62 e 63 da 1/2021, 42 da DCNEM). `marcos-normativos.json` (versão 4) guarda só a identificação (`linha`), `transicao` e `orientacao_analise`; vigente, substituídas, antecessoras e dispositivos revogados são derivados na leitura (`derivarLinha`), com validador, índice e subagents ajustados. A derivação acrescenta a Res. CNE/CP 3/2002 às antecessoras da DCN da EPT.
- **Correspondência 1/2021 → 2/2026** (rascunho): 168 itens cobrindo os 65 artigos (63 equivalentes, 101 parciais, 4 sem equivalente), com herança pelo ancestral. Q07 e Q23 apontam a tabela e seguem provisórios.
- **`kb impacto`:** contra os 41 arquivos de conteúdo modificados no `b4aded0` (rodando sobre o conteúdo de `b4aded0^`; os 2 criados no commit ficam fora), a citação estrita teve precisão 1,0 e recall 0,317 (13 de 41); somando o sinal temático da taxonomia das fichas, recall 0,927 e precisão 0,481 (38 de 79). As fichas antigas raramente citavam a 1/2021: a mudança veio das regras materiais.
- **CLI:** `kb dispositivo`, `vigencia`, `relacoes`, `correspondencia` e `impacto` (`normas/comandos.ts`); API para a fase 6 no README do `packages/kb`.
- **Pendências humanas:** revisão jurídica da tabela de correspondência; data do DOU da 2/2026 (e as publicações de outras 16 normas); a Lei 14.945/2024 está parafraseada no Markdown e a Lei 12.711/2012 está desatualizada (Lei 14.723/2023 não aplicada); ementas descritivas dos 27 stubs novos; os "Trechos prioritários" da Res. 8/2014 ficam fora do texto normativo.

**Fase 6 implementada em 13/11/2026, sem o harness** (branch `worktree-agent-ab82063f6dd337963`; a ligação com a fase 5 fica para depois do merge).

- **Banco:** `pnpm kb:compilar` gera `tmp/kb.sqlite` (fora do git) em cerca de 6 s, com 127 MB: normas (manifest e stubs) e texto por bloco de título, PPCs com proveniência, 20.098 seções com o texto integral recortado por `lerTextoSecao`, 28.987 citações (19.119 resolvidas como `fundamento` e 7.874 como `referencia-bibliografica`, pela seção de referências ou pelo rótulo "Bibliografia"), cursos com `cnct_id`, matrizes do SUAP, ofertas com turno, processos, editais, CNCT, fichas com referências estruturadas, tópicos, marcos e fatos de PPC. Esquema em `packages/kb/src/db/esquema.ts`; consultas em SQL direto com zod na fronteira.
- **Determinismo:** dois builds dão o mesmo arquivo byte a byte (teste em `db/base.test.ts`): leitura ordenada, `rowid` na ordem das fontes, nada do relógio, `page_size` fixo, `optimize` do FTS5 e `VACUUM`.
- **Recompilação:** a CLI recompila quando o banco falta, muda a versão do esquema, muda a lista de fontes ou muda o conteúdo (SHA-256 das fontes, conferido só quando algum mtime passa o do banco).
- **Busca:** FTS5 `unicode61 remove_diacritics 2`, coluna de radicais com um porte próprio do Snowball português (diferencial sem diferenças contra `snowball-stemmers` 0.6.0 em 75.882 palavras da base; o pacote está parado desde 2022 e o RSLP não tem referência em JavaScript para conferir um porte) e coluna de expansão com o léxico por tipo de seção (`packages/kb/dados/sinonimos.yaml`, rascunho).
- **Recall@10** em 27 consultas temáticas rotuladas (`avaliacao/busca-secoes/`, rascunho rotulado pelos títulos das seções; 23 dentro de um PPC, 4 entre PPCs por CNCT): 0,916 sem stemmer nem sinônimos, 0,872 só com radicais, **0,961** com radicais e sinônimos. O léxico e as consultas foram escritos pela mesma pessoa, então a medida é otimista; o embedding continua fora.
- **Fatos PPC × SUAP** (110 PPCs técnicos): carga total extraída em 95, estágio obrigatório em 78 (17 com carga), ano em 108. Carga: 42 conferem, 13 conferem com uma das matrizes, 2 diferem só pelo estágio, **33 divergem**, 15 sem fato, 5 sem SUAP. Estágio: 67 conferem, **7 divergem**. Ano: **13 PPCs mais recentes que todas as matrizes** do SUAP. São 47 PPCs com alguma divergência (`kb ppc-fatos --divergencias`), todas com o trecho de origem e status `extraido`.
- **CLI:** `buscar-norma`, `buscar-secoes`, `cursos`, `ppc-fatos`, `pacote-contexto` e `avaliar-busca`, além de `resolver`, `citacoes`, `adequacao-art71` e `avaliar-resolvedor`. `cursos --eixo "Informação e Comunicação" --processo processo-seletivo-2026` reproduz os 21 campi do gabarito da Q08; as citações da 1/2021 no banco, os 59 PPCs da Q02.
- **`pacote-contexto`** (Técnico em Enfermagem de Curitiba, rodada real até `preparar-prompts-subagents`, sem agente): uma ficha (CT-CURR-12) cabe em 52 mil caracteres contra 275 mil do grupo avulso atual (PPC inteiro, prompt e ficha), e já traz o texto dos arts. 9 e 28 da Res. CNE/CP nº 2/2026; o tópico `estagio` (4 fichas), em 112 mil. Os grupos de 20 fichas ficam do tamanho do atual (334 a 379 mil contra 362 a 367 mil), porque cobrem quase todos os tópicos. A `subagents.ts` não mudou.
- **Interface da fase 5:** `FontesNormativas` em `db/fontes-normativas.ts` (dispositivos, relações, vigências, transições e correspondências, com zod por linha), carregada vazia por `fontesNormativasPadrao`.
- **Pendências:** ligar a fase 5; harness com agente real (orçamento) para os critérios de tokens e de concordância nos PPCs-ouro; revisão humana do conjunto de consultas, do léxico, do mapa tópico → seção (`dados/topicos-secoes.yaml`) e dos fatos extraídos; extrair estágio em mais PPCs (32 técnicos sem o fato); `pacote-contexto` por ficha ou tópico na `analise-ppc`.

**Ligação das fases 5 e 6 concluída em 13/11/2026** (no `main`, depois do merge `28b2552`).

- **Marcos:** o compilador lia `vigente` de `marcos-normativos.json`, que a fase 5 tirou do arquivo (2 falhas em `db/base.test.ts`). Agora a linha `marcos` sai de `derivarLinha` na `data_referencia`, a mesma derivação da `analise-ppc`.
- **Carga:** `FontesNormativas` implementada por `normas/fontes-db.ts` sobre a API de `normas/`, padrão de `compilarBanco`; sem regra nova no banco. `ARQUIVOS_FONTES_NORMATIVAS` passa a listar `relacoes.yaml`, `transicoes.yaml`, `correspondencias/`, `config/vigencia.yaml` e `normas/stubs.yaml`.
- **Esquema (versão 2):**
  - `dispositivos` com todas as colunas de `Dispositivo` (tipo, caput, estrutura, notas com tipo, revogado, vetado), `ato_id`, `texto_com_caput` e `canonico` (a deduplicação de `indiceDispositivos`), mais `dispositivos_fts`;
  - `relacoes` com o arquivo inteiro: a chave antiga (origem, alvo, tipo) não comportava revogações parciais repetidas;
  - `vigencias` como intervalos `[de, ate)` com `status` e `certo`, calculados por `statusEm` nas datas em que ele pode mudar (`intervalosVigencia`);
  - `transicoes` com as datas resolvidas; a situação numa data sai de `situacaoNaData`, extraída de `situacaoTransicao`;
  - `correspondencias_tabelas` e `correspondencias`;
  - `normas_blocos` (texto por título) deu lugar a `normas_metadados`. O texto normativo vem dos dispositivos, e o editorial e os resumos dos Markdown ficam fora da busca. `db/normas-blocos.ts` e `blocoDoArtigo` foram removidos.
- **Números:** 4.891 dispositivos (4.867 canônicos no FTS; 24 da compilação da LDB), 59 relações, 205 intervalos de vigência para 103 atos (81 incertos), 8 transições, 168 itens de correspondência, 4 marcos. Dois builds seguidos dão o mesmo SHA-256 (`30bc62b8…`), em 7,3 a 8,1 s, com 131,8 MB (antes, 127,2 MB).
- **CLI:** `kb dispositivo` e `kb correspondencia` leem o banco. A herança pelo ancestral virou `correspondenciaEm` sobre uma fonte, e os descendentes `descendentesEm`; as duas leituras usam a mesma função. `buscar-norma` devolve dispositivos com ID canônico, caput, subordinados (na citação), arquivo e linhas, e tem `--vigentes --em <data>` pelos intervalos. `vigencia`, `relacoes` e `impacto` continuam nos arquivos:
  - `vigencia` explica eventos e pendências que só `statusEm` monta;
  - `--propor` roda o regex sobre o parser;
  - `impacto` lê os textos das skills, inclusive de outra árvore.
- **Mesmo resultado nos dois caminhos** (`db/base.test.ts`), conferido em:
  - todos os dispositivos, pelo ID do ato e pelo do arquivo;
  - os descendentes;
  - toda a correspondência da 1/2021 e as tabelas;
  - as relações;
  - os marcos derivados;
  - o status e o `certo` de cada ato em cada data de mudança e na véspera;
  - as transições em cinco datas.
- **`pacote-contexto`** (Técnico em Enfermagem de Curitiba), em caracteres:

  | Tarefa | Total antes | Total depois | Bloco de normas antes | Bloco de normas depois |
  |---|---|---|---|---|
  | CT-CURR-12 | 52.721 | 57.954 | 9.486 | 6.835 |
  | `estagio` | 112.366 | 115.551 | 11.347 | 6.668 |
  | grupos 001 a 004 | 334.557 a 379.761 | 345.733 a 385.542 | 30.415 a 56.325 | 30.815 a 57.196 |

  O texto normativo encolheu nas fichas avulsas porque o inciso citado vem com o caput, e não o artigo inteiro. Nos grupos, o bloco de normas oscila entre −7% e +13%, pelo custo de cada trecho em JSON. O aumento do total vem das regras de transição, que antes não entravam: 7 ou 8 regras, cerca de 7 a 9 mil caracteres, com o texto literal do dispositivo.
- **Pendências:** as da fase 6 (harness com agente real, revisões humanas) e as da fase 5 (data do DOU da 2/2026, revisão jurídica da correspondência). A busca de normas não tem conjunto rotulado para medir recall, como o das seções.

**`pacote-contexto` por tópico na `analise-ppc` concluído em 13/11/2026** (no `main`, sem commit; pendência da fase 6).

- **Grupos por tópico** (`agruparPorTopico`, em `packages/kb/src/db/pacote-contexto.ts`, usado pela skill e por `kb pacote-contexto grupo-NNN`): cada ficha entra uma vez, no grupo do seu tópico principal, o mais específico (menos fichas na taxonomia) dos seus `topicos_tematicos`, com empate pela ordem de `topicos-fichas.json`; as 8 fichas `tipo_escopo: transversal` vão num grupo `transversal`, por último, com o `PPC.md` inteiro. Máximo de 20 fichas por grupo (`--tamanho-grupo`); tópico maior vira partes equilibradas. Hoje são 17 grupos (16 tópicos e o transversal; o maior tem 9 fichas). A ficha multitemática fica num grupo só, mas o grupo recebe as seções de todos os tópicos das suas fichas.
- **PPC da rodada fora da base:** a segmentação e a taxonomia continuam em `ppcs/secoes.ts`; o recorte do índice virou `secoesIndexadas` (usado por `scripts/base/indice-ppcs.ts`, com índice e `secoes/*.jsonl` sem diff) e `secoesComChave` mantém também a capa, `outros` e as seções curtas (`<tipo>-x<n>`). A gravação de seções, FTS e citações saiu de `compilarBanco` para `gravarSecoesECitacoes` (banco igual, tabela a tabela), e `bancoDoPpcAvulso` usa o mesmo caminho num banco em memória; para 6 PPCs da base, ele dá as mesmas seções e citações do `kb.sqlite` (`db/base.test.ts`). O normalizador da skill põe o primeiro nível numerado em `#`, que o índice não reconhece (em 45 PPCs da base, `#` é capa): na rodada, `titulosNivel1` trata `#` como `##`.
- **Pacote do grupo:** seções inteiras dos tipos ligados aos tópicos (`dados/topicos-secoes.yaml`) mais a melhor seção de cada `consulta` das fichas; do `kb.sqlite`, o texto dos dispositivos citados (com caput e subordinados), as transições e as citações do PPC por marco (`pacoteContextoAvulso`); todos os 4 marcos por extenso; nos grupos de `referencias_normativas`, todas as citações normativas do PPC. `contextos.cnct` continua a comparação da skill; o registro é o mesmo da tabela `cnct` (teste). O prompt manda conferir o `PPC.md` completo antes de concluir ausência. `montar-grupo-avulso` usa o mesmo pacote e grava também o prompt (`grupos-avulsos/<id>.md`).
- **Mapa tópico → seção** (rascunho), ajustado pelas âncoras que ficavam fora: `pretextual` em `identificacao_oferta` e `corpo_docente_gestao`, `ensino_pesquisa_extensao` em `concepcao_metodologias`, `atendimento_estudante` em `aee_acessibilidade_inclusao`, `referencias` em `referencias_normativas`. `validar-base` exige uma entrada por tópico.
- **Medida** (caracteres dos pacotes de prompt, `ANALISE_PPC_AGORA` fixo, entrada `.md`, sem agente):

  | PPC | Antes: grupos, por grupo, total | Depois: grupos, por grupo (mediana), total | Contexto médio por ficha |
  |---|---|---|---|
  | Enfermagem, Curitiba | 4; 362–367 mil; 1,46 mi | 17; 60–378 mil (128 mil); 2,38 mi | 365 → 162 mil |
  | Eletromecânica, Jacarezinho | 4; 338–344 mil; 1,37 mi | 17; 77–341 mil (156 mil); 2,82 mi | 342 → 191 mil |
  | Administração PROEJA, Campo Largo | 4; 258–263 mil; 1,04 mi | 17; 57–250 mil (111 mil); 2,11 mi | 261 → 140 mil |
  | Minuta fora da base (Paranaguá alterado) | 4; 447–452 mil; 1,80 mi | 17; 48–456 mil (121 mil); 2,47 mi | 450 → 168 mil |

  O maior pacote é o `transversal` (PPC inteiro). O contexto de cada ficha cai de 45% a 63%, mas o total sobe de 1,4 a 2,0 vezes: são 17 sub-agentes em vez de 4, cada um com o prompt (7,6 mil), as fichas, as normas e as transições (até 60 mil) e, em 7 grupos, o CNCT (25 mil). Mandar as seções achadas só pela busca como trecho cortaria de 5% a 20% do total, mas tiraria 5 a 9 pontos da cobertura de âncoras; ficou o texto inteiro. Avulso de uma ficha (CT-CURR-12, Enfermagem): 62 mil, contra 275 mil.
- **Cobertura:** toda ficha em exatamente um grupo, nos 4 PPCs; toda seção dos tipos que o mapa liga aos tópicos das fichas está no grupo (0 faltas). Fora de todo grupo de tópico (só no transversal) ficam 8,4 mil caracteres de anexos em Enfermagem e 8,7 mil (anexos e `outros`) na minuta. Âncoras semânticas das fichas presentes no PPC (palavra inteira): 89%, 95%, 90% e 90% estão no próprio grupo. Na amostra das que faltam, a maioria é ocorrência incidental (“supervisão de estágio” nas referências, “autoavaliação” na avaliação da aprendizagem, “egressos” na organização curricular); casos reais: o capítulo de orientação do regulamento de estágio da minuta (anexo) e o “acervo” da biblioteca para as fichas de bibliografia.
- **Formato:** `grupos-subagents.json` troca `intervalo` por `topico`, `topico_titulo`, `parte`, `partes`, `escopo_ppc` e ganha `agrupamento`; `contextos.ppc` (novo) e `contextos.fundamentacao_normativa` (com `normas`, `transicoes`, `data_referencia` e `citacoes_do_ppc`); o resumo da CLI e o `manifest.json` dos prompts mostram tópico, escopo, seções e caracteres. `resultados-subagents.json`, a mescla, a validação e o relatório não mudam.
- **Pendências:** medir com agente real se os pacotes por tópico mantêm a concordância nos PPCs-ouro (critério da fase 6); revisão humana do mapa tópico → seção; decidir se tópicos pequenos devem ser juntados para baixar o total; anexos (regulamentos) só entram pela busca.

**Renomeação da `analise-ppc` para `revisar-ppc` em 13/11/2026** (no `main`, sem commit).

- **Motivo:** a skill faz uma revisão prévia do PPC, antes da submissão à PROENS; não é a análise oficial da PROENS nem emite parecer. O nome e o vocabulário imitavam o ato oficial. O novo nome faz par com a `revisar-processo-ppc`, que revisa o processo SEI.
- **Nomes:** diretório `.agents/skills/revisar-ppc` (com `git mv`; o symlink `.claude/skills` continua apontando para `.agents/skills`), entrypoint `scripts/revisar_ppc.ts`, assets `revisar-ppc.css` e `revisar-ppc.js`, relatório `relatorio-revisao.html`, variáveis `REVISAR_PPC_AGORA`, `REVISAR_PPC_PYTHON`, `REVISAR_PPC_SURGE_CMD` e `REVISAR_PPC_SURGE_DOMAIN` (sem os nomes antigos), subdomínio padrão `revisar-ppc-<rodada>.surge.sh`. A `base-analise/` e os identificadores internos (`CaminhosAnalise`, `orientacao_analise`) ficam.
- **Vocabulário:** a situação geral passa de `APROVADO`, `COM_RESSALVAS`, `DILIGENCIA` e `NAO_APROVADO` para `APTO_PARA_SUBMISSAO`, `APTO_COM_RESSALVAS`, `AJUSTES_NECESSARIOS` e `REVISAO_SUBSTANCIAL`, com rótulos em português no relatório e na saída da CLI (`situacao_rotulo`); `config/politica_parecer.json` virou `config/politica_revisao.json`. O relatório se chama "Relatório de revisão do PPC" e avisa, no cabeçalho e no rodapé, que não substitui a análise oficial da PROENS. O tópico `sintese_transversal_parecer` virou `sintese_transversal_revisao`, e as fichas CT-TRANS-05 e CT-TRANS-06 falam em ajustes e conclusão da revisão. "Parecer" como tipo de norma (Parecer CNE/CEB, termos de busca de referências normativas) continua.
- **Histórico:** os nomes antigos ficam nas entradas anteriores deste Andamento, que registram o que foi feito com eles.

**Revisão de código por área e correções em 14/11/2026** (no `main`, sem push).

- **Método:** quatro revisões independentes, cada uma com verificação cética dos achados; depois, um agente corretor por área, com teste escrito antes da correção (o teste falha sem ela). Achado não reproduzido seria relatado, não corrigido; todos se reproduziram.
- **Área 1, `revisar-ppc`** (5 achados): alertas BLOQ/OBRIG passam a pesar na situação geral; destaque do relatório só em nós de texto, com marca compartilhada para a mesma citação; a mescla normaliza a base e valida o resultado avulso; o front matter só é removido quando é o de proveniência; `REVISAR_PPC_AGORA` com data sem hora é meia-noite local no TypeScript e no Python.
- **Área 2, motor de normas** (11 achados, 3 altos):
  - status registrado de stub (`revogada`…) só vale a partir da vigência do ato de `status_fonte`;
  - as duas IN IFPR nº 1/2021 viraram `ifpr/reitoria/in/2021/1` (26/07, extensão) e `ifpr/proens/in/2021/1` (19/08, bibliotecas, ato conjunto Reitoria/PROENS);
  - a data citada é comparada primeiro com a do ato (`assinada_em`) e só depois com a de publicação;
  - também: inciso `IV-A`, regex com tempo exponencial trocada por varredura linear, PROEPPI/PROEPI, `ano-no-documento` com órgão compatível, `#art2` sem casar `#art29`, item, alíneas em intervalo, rótulo repetido no parser, IDs de dispositivo que não renderizavam.
  - Métricas do resolvedor sem mudança (precisão 0,98; recall 0,965); uma citação anotada mudou (Londrina, IN de 19/08/2021).
- **Área 3, `kb.sqlite` e busca** (7 achados, 2 altos): radical sem acento (a busca sem acento dá o mesmo que a acentuada); regex de carga horária (a divergência falsa de Ivaiporã sumiu: 33 → 32); mtime do banco anterior à leitura das fontes; `--vigentes`/`--situacao` aplicados à citação resolvida e aviso de ID desconhecido (`buscarNormaDetalhada`); remoção do temporário em erro; unidade hora-aula.
- **Área 4, dados, base e avaliação** (8 achados, 1 alto de segurança):
  - o harness passava ao `claude -p` todo o `process.env`, inclusive o que o Bun carrega de `.env.local`. Agora: ambiente mínimo explícito, sem Bash, escrita nem web, e leitura negada a `.env*`, `~/.ssh`, `~/.aws`, `~/.config`, `~/.claude` e `/etc`;
  - Lei 14.945/2024 transcrita do texto oficial. Ela não revoga a Lei 13.415 (relação removida; stub de volta a "a confirmar"); revoga dispositivos da LDB e altera a LDB e a Lei 12.711;
  - `turno` público volta ao texto da fonte, e o enum vai para `turno_padronizado`. A auditoria rejeita `turno` que não esteja no `trecho_fonte`;
  - Lei 10.639 vigente (a 11.645 só reescreve o art. 26-A da LDB); empreendedorismo mapeado para `#art22-viii` como `parcial`;
  - taxonomia de seções: capas fora de `avaliacao` (8 → 0); bolsas fora de `acessibilidade_inclusao` (97 → 1); "objetivos do componente" fora de `objetivos` (27 → 0);
  - `vigencia_a_confirmar` documentado como leitura obrigatória ao filtrar por `status_vigencia`.
- **Integração com o MCP** (que entrou no `main` durante as correções): `preencherBanco` recebe `topicosSecoes` e `versao`/`commit`/`canal`; a correção de `kb impacto` passou a `destinosDeOrigemEm`, sobre a fonte de dados; o registro lido do banco (`registroBanco`) ganhou `assinada_em`, tirado do front matter, sem mudar o esquema, para o modo banco também separar as duas IN.
- **Verificação:**
  - testes: 404 nos scripts e skills, 404 no `kb`, 73 no `sei-cli`, 51 no `mcp`, 0 falhas; pytest: 16 passam, 1 pulado;
  - sem erro: `format:check`, `typecheck`, `validar_base`, `gerar_base --check`, `gerar_tipos_schemas --check`, `avaliacao:gabaritos --check`, `validar-base`, `gerar-schemas`/`gerar-mapa`/`gerar-indice --check`.
- **Pendências:**
  - rodar o harness com o `claude` real para confirmar as regras de permissão;
  - decidir o órgão no ID da IN conjunta de 19/08/2021: `proens`, como ficou, ou `reitoria-proens`, como a regra de derivação daria;
  - conferir as duas IN na fonte oficial;
  - `LEI_BR_12711-2012_cotas.md` também parece paráfrase;
  - uma "IN nº 1/2021" sem data, em contexto IFPR, ainda vai para a IN da Reitoria.

**Trilha T, passo T3 concluído em 16/11/2026** (branch `t3/typescript-docx-conversion`). Esta entrada registra a primeira entrega; a seguinte, as correções das duas revisões, que mudaram o lugar do código e os defeitos mantidos.

- A conversão DOCX da `revisar-ppc` está em TypeScript (na primeira entrega, em `scripts/conversao-docx/` da skill); `preparar-documento` a chama direto, e a skill com entrada `.docx` roda só com Node (sem Python, MS Word ou poppler).
- Não é transcrição do Python. Duas camadas:
  - `ooxml/`: leitor próprio sobre `fflate` e `htmlparser2`, com um modelo intermediário do documento (parágrafos com runs e formatação direta, hyperlinks, tabelas com `gridSpan` e `vMerge`, figuras, propriedades) e nomes resolvidos pela URI do namespace;
  - domínio do PPC: `elementos.ts` (título, lista, grade de tabela), `secoes.ts`, `tabelas.ts`, `matriz.ts`, `ementario.ts`, `similaridade.ts`, `identificacao-tabelas.ts`, `figura.ts`, `markdown.ts` e `conversao.ts`.
- `similaridade.ts` reimplementa o `fuzz.partial_ratio` do `rapidfuzz` com LCS de bits paralelos: 992 escores iguais bit a bit aos dele (`tests/fixtures/partial-ratio-rapidfuzz.json`).
- Diferencial contra o Python do commit `c0d6f07`, com `python-docx` 1.2.0 e `rapidfuzz` 3.14.6 em ambiente temporário do `uv` (`scripts/dev/diferencial-docx.ts`, descrito no README da skill):
  - 23 documentos: os 12 PPCs técnicos reais de `KB_CORPUS_DOCX` e 11 sintéticos;
  - camada de elementos (o que o `DocxReader` lia) e artefatos finais (`.md`, `-bruto.md`, `_dados.json`, matriz, ementário, imagem): idênticos nos 23, no modo `python-docx` do leitor;
  - diferenças aceitas, neutralizadas e relatadas por documento: `propriedades-inventadas` (4 PPCs sem `docProps/core.xml`, em que o `python-docx` inventava título, autor e data) e `figura-nao-renderizada` (3 PPCs com o fluxograma em formas do Word).
- Diferenças deliberadas do modo padrão (`documento`), todas no README da skill:
  - o texto inserido com controle de alterações (`w:ins`) e os runs em `w:moveTo`, `w:smartTag`, `w:sdt` em linha, `w:fldSimple` e `w:customXml` entram no `PPC.md`; o `python-docx` os descartava, e 3 PPCs do corpus perdiam trechos (34, 89 e 131 linhas mudam);
  - a figura vetorial não é renderizada: `metodo: "vetorial_nao_renderizada"` e um aviso no `PPC.md`; EMF e WMF embutidos são copiados como estão; a imagem sai com a extensão dela;
  - `metadata_documento` vazio sem `core.xml`; mescla vertical malformada e imagem externa não abortam; o DOCX em "Strict Open XML" é lido.
- Defeitos da conversão antiga mantidos nesta entrega, e corrigidos na seguinte: negrito colado (`**a**b**`), numeração automática do Word ignorada, alíneas como `1. a)`, `total_ha` e `total_hr` zerados no resumo da matriz.
- Desempenho no corpus: de 0,11 a 0,26 s por PPC, contra 0,85 a 2,2 s do Python; `preparar-documento` inteiro em 0,44 s.
- Removidos: `conversao_docx/` (12 arquivos, cerca de 5.000 linhas), `converter_docx.py`, os 4 arquivos de `pytest` e o `requirements.txt` da skill; a opção `python` e a variável `REVISAR_PPC_PYTHON`.
- Testes: `conversao-docx.test.ts` (50 casos: leitor, regras de domínio, os casos dos 4 arquivos de `pytest`, gabaritos do oráculo e figura) e `similaridade.test.ts` (4 casos); a skill tem 257 casos. O teste DOCX da identificação deixou de depender do `python-docx`.
- Python que continua: só `scripts/converter_ppcs_markdown.py` (T5).
- Verificação, no Node 26.12.1 e com o `main` de 16/11/2026 (`67054eb`) incorporado à branch: `pnpm fmt:check`, `pnpm lint`, `pnpm typecheck` e `pnpm test` sem erro (658 casos na raiz e nas skills); `validar-base` e `gerar-schemas`, `gerar-mapa` e `gerar-indice --check` da skill sem erro.

**Revisão do T3 e correções em 16/11/2026** (mesma branch, sem merge: aguarda a re-verificação). Duas revisões independentes reproduziram o diferencial e não bloquearam o merge; apontaram robustez com arquivo hostil, quatro perdas de fidelidade e o lugar do código.

- **Lugar do código.** A conversão saiu da skill para dois pacotes do workspace, que o `apps/server` pode importar: `packages/docx` (`@simplifica-if/docx`, o leitor OOXML genérico) e `packages/ppc` (`@simplifica-if/ppc`, a conversão do PPC, o normalizador de Markdown, os documentos sintéticos e o diferencial). A skill fica com a CLI. Dois pacotes, e não um: o leitor não sabe o que é PPC e serve a outros documentos; o `kb` não ganha `fflate` nem regras de PPC. Dentro da skill a conversão dependia do `node_modules` da raiz, e o app, que leva a skill só com os arquivos do manifesto, não a executaria.
- **Arquivo hostil** (o app abre arquivos do usuário), tudo com `ErroDocx` em português e teste versionado (`packages/docx/test/leitor.test.ts`):
  - o ZIP é lido no próprio pacote: diretório central sem descompactar, partes sob demanda e em pedaços, com limite de 100 MB por parte e de 300 MB no total sobre a saída real (o tamanho declarado pode mentir), 10 mil entradas e razão de compressão de 200:1 nas partes de mais de 10 MB;
  - contêiner OLE (`.doc` renomeado ou DOCX com senha), arquivo que não é ZIP, ZIP truncado e entrada cifrada têm mensagem própria;
  - XML malformado ou truncado e aninhamento de mais de 256 níveis são recusados (antes: `PPC.md` pela metade e `RangeError`);
  - depois da re-verificação: a razão de compressão vale também para a saída real (96 MB de `<w:p/>` num ZIP de 142 KB com tamanho declarado de 100 bytes passavam e esgotavam a memória), teto de 1 milhão de elementos por parte XML, texto de tabela multiplicado pela mescla limitado a 16 milhões de caracteres e consolidação de parágrafos do normalizador em tempo linear (era quadrática: 40 mil parágrafos curtos, 19 s), com a mesma saída;
  - depois da segunda re-verificação: limites reunidos em `packages/docx/src/limites.ts` e apertados ao que os PPCs reais usam (arquivo de 20 MB, 25 MB por parte, 60 MB no total, 500 mil elementos por parte XML); orçamento de texto por documento em `packages/ppc/src/conversao-docx/orcamento.ts` (8 milhões de caracteres, 50 mil por parágrafo ou célula, mil caracteres seguidos sem letra nem dígito), porque os tetos por item deixavam passar sessenta tabelas logo abaixo do teto; aparo de espaços do `kb` sem expressão regular (`[espaços]+$` custava o quadrado de uma sequência longa: 89 s para 80 mil tabulações num ZIP de 3 KB); decisão do normalizador pelo começo estável do parágrafo, tomada uma vez. Pior caso honesto dentro dos limites: 1,5 s e cerca de 690 MB de memória residente, com heap de 512 MB;
  - `gridSpan` e `gridBefore` presos à faixa do Word (um `gridSpan` de 2 bilhões num arquivo de 879 bytes esgotava a memória), 1.024 células por linha e 2 milhões de posições por tabela; mescla vertical resolvida numa passada, sem recursão; arrays grandes sem espalhamento em chamadas;
  - documento sem texto e arquivo de mais de 100 MB são recusados; só `http`, `https` e `mailto` viram link no Markdown;
  - `preparar-documento` converte em memória antes de criar a rodada.
- **Regras do modo `documento`** (`packages/ppc/src/conversao-docx/regras.ts`): cada diferença em relação ao Python é uma regra nomeada, e todas desligadas reproduzem o Python. Além da leitura das alterações controladas, entraram:
  - `leitura`: linhas, células e parágrafos de tabela embrulhados em `w:sdt` (numa matriz, sumiam sem aviso), linha e figura removidas na revisão ficam de fora, e a célula das tabelas em `w:sdt` é lida como os parágrafos do corpo;
  - `titulosDeCorpo`: texto de corpo com estilo de título sai como parágrafo (num PPC do corpus, `## 5.9 ESTÁGIO CURRICULAR` ficava vazia e cinco frases viravam seções);
  - `listas`: a numeração automática do Word faz itens de lista, o número digitado fica e a alínea sai como `- a)`;
  - `negritoUnido`: `**Pró-Reitoria de Ensino**`, não `**Pró-Reitoria** de Ensino**`;
  - `linksSeguros`;
  - `totaisDaMatriz`: o total que nenhuma tabela declara é recalculado sobre todas as partes da matriz (antes ficava a soma da última), e `total_ha` e `total_hr` do resumo são somados.
- Dos defeitos que a primeira entrega mantinha por paridade, saíram o negrito colado, a numeração automática ignorada, as alíneas como `1. a)` e `total_ha`/`total_hr` zerados. Continuam: o texto de tabela aninhada fora da célula, a capa fora do Markdown e o número da lista automática não calculado (o item sai como `1.`).
- **Diferencial**, refeito com 12 PPCs reais e 14 documentos sintéticos (3 novos: títulos de corpo, listas automáticas, tabelas em `w:sdt`):
  - modo `python-docx`: elementos e artefatos idênticos nos 26; diferenças aceitas inalteradas (`propriedades-inventadas` em 4 PPCs, `figura-nao-renderizada` em 3);
  - modo `documento`: de 239 a 697 linhas mudam por PPC (contadas as duas versões de cada linha), medidas por regra na tabela do README da skill; a maior parte são itens de lista (de 73 a 220 novos por PPC) e negrito;
  - `titulosDeCorpo` tira de 2 a 33 falsas seções em 4 PPCs; `negritoUnido` não muda o número de títulos em nenhum;
  - `totaisDaMatriz`: os totais da matriz não mudam em nenhum dos 12 (todos declaram a linha de total do curso); `total_ha` e `total_hr` mudam nos 12;
  - tempo por PPC: de 0,11 a 0,26 s.
- Testes: `packages/docx` 26 casos, `packages/ppc` 73, skill `revisar-ppc` 206 (os da conversão foram para os pacotes), `kb` 413; `pnpm fmt`, `pnpm lint`, `pnpm typecheck` (raiz e os 12 pacotes e apps) e `pnpm test` sem erro no Node 26.12.1; `validar-base` e os `--check` da skill sem erro.
- Pendências:
  - a re-verificação e o merge;
  - no servidor (M1.11 do plano do app): rodar a conversão num `Worker` com limite de memória e de tempo, sem bloquear o laço de eventos; a conversão é síncrona e mantém a árvore do XML na memória;
  - o Strict Open XML foi testado só por troca de namespace num documento sintético;
  - listas automáticas: o número (`w:start`, letras, romanos) não é calculado, e o nível do subitem se perde no normalizador, que tira o recuo das linhas (limitações registradas no README da skill).

**Fim do Python em 17/11/2026** (branch `t3/remover-conversor-python`). Por decisão do usuário, a trilha T termina sem a exceção prevista em T5:

- saíram `scripts/converter_ppcs_markdown.py` e `requirements-ppc.txt`; não há, por ora, entrada de PPC novo na base (item 3 de "Em aberto"). A regra de dados pessoais fica só em `packages/kb/src/ppcs/dados-pessoais.ts`, com os casos em `dados-pessoais.casos.json`;
- saiu o diferencial `packages/ppc/scripts/diferencial-docx.ts` e o que só ele usava: o modo de leitura `python-docx`, as regras liga/desliga de `regras.ts` e o nível de seção configurável do normalizador. Os gabaritos de `packages/ppc/test/fixtures/conversao-docx/` passaram a ser os artefatos do modo padrão dos 17 documentos sintéticos, gerados com o código anterior à remoção e reproduzidos byte a byte;
- o kit `packages/kb/src/python/` virou `packages/kb/src/primitivas/` (`regex.ts`, `sequencias.ts`, `json-tipado.ts`, `shell.ts`, `quebra-de-linhas.ts`), `html-py.ts` virou `eventos-html.ts`, e os nomes com sufixo `Py` ganharam nomes do que fazem; os comentários descrevem o comportamento, sem a paridade com o Python;
- `git ls-files '*.py'` não lista nada, e `git grep -niE 'python|pytest|pymupdf|\.venv'` só acha os registros históricos, o código copiado do T3 e o texto dos PPCs da base.

**Entrada de PPC novo na base em 17/11/2026** (branch `t3/importar-ppc-docx`). Fecha o item 3 de "Em aberto" a favor do DOCX:

- `node scripts/importar_ppc_docx.ts <campus_id>/<curso_slug> <arquivo.docx> --fonte-url <url> [--substituir]`, com a lógica em `scripts/base/importar-ppc.ts` e 16 testes sobre os DOCX sintéticos de `packages/ppc` numa base temporária;
- `fonte_url` e `ppc.url` recebem o mesmo `--fonte-url`, e o `validar_base.ts` passa sem exceção nova. O `fonte_sha256` continua sendo o hash dos bytes de `fonte_url` e fica `desconhecido` (o script não baixa a URL); o hash do DOCX vai no campo novo `arquivo_convertido_sha256`, com `arquivo_convertido: docx`, que o índice publica como `arquivo_convertido: { tipo, sha256 }`. O `conversor` é `simplifica-if/packages/ppc@<commit>`, com `-modificado` se o checkout tem alteração não comitada em arquivo rastreado fora de `base-conhecimento/`, `site/`, `tmp/` e `outputs/` (a saída depende também de `packages/kb`, `scripts/base/importar-ppc.ts`, `scripts/dados/urls.ts` e do próprio script);
- o Markdown e o registro são calculados antes de qualquer escrita e gravados por temporário + `renameSync`; se o segundo falha, o primeiro volta ao anterior. `ppc` entra na posição do schema e `markdown_path` logo depois de `url`, sem mexer na ordem dos registros já completos; `ppc.observacoes` fica e a saída a aponta como "a reconferir";
- `limparUrlsInternas` (`scripts/dados/urls.ts`) é a limpeza de URLs internas do importador e da exportação dos processos SEI; um link Markdown para planilha vira `texto (planilha interna, link omitido)`;
- a figura da representação gráfica vira aviso, porque a base não publica `imagens/`; ano e vagas já registrados voltam a "Precisa de revisão";
- o script não regenera índices nem o site: imprime os quatro comandos do pipeline, que vêm depois da leitura do Markdown (e-mail particular sai à mão);
- o passo a passo está em "Entrada de PPC novo na base", na doc de curadoria.

**Documentação realinhada ao app em 17/11/2026** (branch `t3/realinhar-documentacao-app`). O `AGENTS.md`, o `README.md` e os READMEs dos apps, dos pacotes e das skills passam a descrever o repositório como o do app Simplifica IF e da base que o alimenta, com um mapa de `apps/` e `packages/` e o que o app entrega hoje, conferido no código (rotas de `apps/web`, as 16 ferramentas de `packages/mcp`, o motor e as skills com bloco `simplifica:`). Entrou neste plano a visão geral do repositório e o item de roadmap [Ferramentas do repositório fora do app](#ferramentas-do-repositório-fora-do-app): `sei-cli`, `revisar-processo-ppc`, `suap-ifpr`, a sincronização SEI → Notion e a `revisar-ppc` por sub-agentes ainda não estão no app.

**Gerador do `site/` removido em 18/11/2026** (branch `t3/remover-gerador-site-legado`). O `scripts/gerar_site.ts` (com `scripts/base/site.ts`), herdado do `gerar_site.py` da época em que a base era publicada como site estático, só copiava `base-conhecimento/` para `site/`, que nada consumia; o repositório público já publica `base-conhecimento/`. Saíram o gerador, o caso de teste, o `base:site` do `package.json`, o hash do `site/` no gabarito da base (`testes-gabarito/base.txt`; o `base.sh` confere só os geradores sem diferença no git e o `validar_base`) e as menções na documentação.

**Fim do leitor do repositório público em 18/11/2026** (mesmo branch). A base passa a ser lida só pelo app, pelo `simplifica-mcp` e pela CLI `kb`. Saem os artefatos que nenhum deles, script ou skill lê: o `index.json` de cursos, processos seletivos, editais, ofertas e conselhos (fica o de campi, que a `revisar-ppc` lê), os JSON Schemas públicos de `schemas/registros/`, a tabela de normas do `base-conhecimento/README.md`, `llms.txt`, `.nojekyll`, `index.html` e `paineis/`. O `processos-sei/index.json` e o `exportar_base_publica.ts` ficam até se confirmar se algo os consome; no repositório, só o `validar_base` os lê.

**Processos SEI fora da base em 18/11/2026** (mesmo branch). Saem o `institucional/ifpr/processos-sei/index.json`, que só o `validar_base` lia, e o `scripts/exportar_base_publica.ts`, que o gerava a partir de `Movimentações de Cursos` no Notion, com o código que só ele usava (`scripts/dados/processos-sei.ts`, `carregarMovimentacoes` e a auditoria das movimentações). As movimentações ficam só no Notion; o `sei:sync` (SEI → Notion) continua e não dependia do índice.

## Histórico de revisões

**v2, 13/11/2026.** Incorpora duas revisões independentes.

- **Reordenação:**
  - a consolidação em TypeScript virou uma fundação enxuta (fase 0) mais uma trilha paralela (T);
  - a curadoria rápida e o índice de seções v2 vieram para antes do saneamento das normas e do SQLite;
  - o MCP ficou condicional;
  - os embeddings saíram do plano.
- **Correções de fato:**
  - são 9 normas sem `#### Art.`, e não 3;
  - a LDB precisa de saneamento;
  - o art. 71 alcança todos os cursos técnicos em oferta, e não só os que citam a 1/2021;
  - as métricas das análises de arquitetura não são reproduzíveis;
  - o gabarito do `b4aded0` tem cerca de 41 arquivos de conteúdo, e não 54.
- **Correções técnicas:**
  - `ajv` fica;
  - front matter com `yaml` em modo `failsafe`, para manter o diff zero do manifesto;
  - o executor de testes do Bun precisava do caminho `./.agents`, e o formatador do Bun só podia rodar com globs de `.ts`;
  - `htmlparser2` em vez de `fast-xml-parser`;
  - `remark-gfm`;
  - o `preparar_documento` depende do `markdown_normalizer`;
  - a semântica do `python-docx` a reproduzir ficou listada;
  - o fallback de figuras e as dependências `docx2pdf`, `pdf2image`, `pdfplumber` e `rapidfuzz` entraram no inventário;
  - foram acrescentadas as regras de determinismo para os diferenciais.
- **Lacunas preenchidas:**
  - proveniência e política de versão de PPC;
  - referências `externo:` e normas-stub;
  - taxonomia de seções por nível;
  - cruzamento dos fatos de PPC com o SUAP;
  - harness com agente real e PPCs-ouro;
  - `AGENTS.md` apontando para a CLI;
  - vigência calculada numa data explícita.
