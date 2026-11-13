# Plano de arquitetura da base de conhecimento

Situação em 13/11/2026. Este plano consolida duas análises de arquitetura de retrieval: uma auditoria da base atual e um desenho "do zero". Também consolida o código da base e das skills em TypeScript.

A versão 2 incorpora duas revisões independentes, uma da migração para TypeScript e outra das fases de retrieval. A seção [Histórico de revisões](#histórico-de-revisões) registra o que mudou.

**Escopo:** a `analise-ppc` e a base de conhecimento. `Movimentações de Cursos` (Notion) está fora do escopo por ora.

## Tese

O problema da base não é busca, é identidade e relações. Faltam:

- ID canônico para cada norma e para cada dispositivo (artigo, parágrafo, inciso);
- relações tipadas e datadas entre normas, com vigência calculada para uma data;
- vínculo curso–CNCT e turno padronizado;
- proveniência e versão dos PPCs convertidos;
- citações e fatos extraídos dos PPCs, com o trecho de origem e cruzados com o SUAP.

O tamanho é pequeno: cerca de 3.500 dispositivos normativos, 202 PPCs (112 técnicos e 90 de graduação, pós ou FIC) e 218 cursos do CNCT. Tudo cabe num SQLite gerado a partir dos arquivos do git. Banco vetorial, banco de grafo e frameworks de RAG ficam fora.

## Princípios

1. **Os arquivos no git são a fonte de verdade.** Markdown das normas, `dados/institucional/`, fichas, CNCT e PPCs convertidos. Todo banco ou índice é derivado, reproduzível e fica fora do git.
2. **Uma linguagem.** Pipeline, skills, validadores e CLI em TypeScript (Bun). Quando não houver equivalente aceitável, a exceção fica isolada num script único, documentada e com teste de contrato.
3. **Contratos explícitos.** Os dados novos e os que forem reestruturados ganham schema zod. Os JSON Schemas existentes continuam validados por `ajv` até haver motivo medido para trocá-los.
4. **Nada inferido por LLM entra sem revisão humana.** Relações de revogação, tabela de correspondência e fatos de PPC são propostos automaticamente e confirmados por diff no git.
5. **Cada fase se mede.** O conjunto de avaliação (fase 1) roda antes e depois de cada fase de retrieval. Uma fase que não melhora nenhuma métrica não avança. A consolidação em TypeScript é decisão de manutenção e segue outro critério: paridade com o Python.
6. **Determinismo.** As mesmas fontes geram o mesmo banco, os mesmos índices e os mesmos JSONs públicos. Quando um resultado depende de data, como a vigência, a data é parâmetro explícito e nunca o relógio do build.

## Ponto de partida

O que já existe e será aproveitado:

- **Dados institucionais:** ficam em `dados/institucional/`, com schemas zod (`scripts/dados/institucional.ts`) e chaves canônicas (`campus_id/curso_slug`).
- **Pipeline da base:** `scripts/base/` em TypeScript, com front matter, manifestos, índice de seções de PPC, validação e site.
- **Kit de paridade com Python,** feito no porte anterior do pipeline:
  - `scripts/base/texto.ts`: espaços como no Python, ordenação por code point, `splitlines`, UTF-8 estrito;
  - `scripts/base/json.ts`: serialização como no Python;
  - `scripts/base/schema.ts`: `ajv` com as mensagens e a ordem de erros do validador antigo.
- **`packages/sei-cli`:** em TypeScript, com `fflate` e `commander`. É o modelo de workspace.
- **Protótipos das fases 2 e 5,** hoje em Python na `analise-ppc`:
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
| `analise-ppc/scripts/conversao_docx/` (~4.000 linhas) | `python-docx`; `rapidfuzz` opcional (fallback para `difflib`) | DOCX → `PPC.md` |
| `analise-ppc/scripts/conversao_docx/image_extractor.py` | `docx2pdf` (MS Word), `pdf2image` (poppler), `pdfplumber` | renderiza a página quando a figura é desenho vetorial (fallback "rendered") |
| `analise-ppc/scripts/preparar_documento.py` | importa `MarkdownNormalizer` de `conversao_docx`, mesmo com entrada `.md` | cria a rodada e o `PPC.md` canônico |
| `analise-ppc/scripts/gerar_relatorio_html.py` (~1.270) | stdlib (`HTMLParser`, `textwrap`) | PPC HTML anotado |
| `analise-ppc/scripts/subagents.py`, `common.py`, `cnct_catalogo.py`, `analise_ppc.py` (~1.720) | stdlib (`SequenceMatcher`) | rodada, grupos, prompts, contextos, mescla |
| `analise-ppc/scripts/validar_base_analise.py` (~430) | stdlib (validador de JSON Schema escrito à mão) | fichas, marcos, referências |
| `analise-ppc/scripts/gerar_indice_base_analise.py`, `gerar_mapa_fichas.py`, `publicar_surge.py` (~390) | stdlib, CLI `surge` | índice, mapa, publicação |
| `analise-ppc/tests/` (89 casos; `test_flow.py` importa todos os módulos) | `pytest` | testes |
| `verificar-calendario/scripts/render_relatorio_pdf.py` | `reportlab` | relatório em PDF |
| `scripts/converter_ppcs_markdown.py` | `pymupdf4llm`, `rapidocr-onnxruntime`, `urllib` | baixa PDFs de PPC e converte em Markdown com OCR |

O `python3` do sistema não tem `python-docx`. Hoje não há um ambiente de referência fixado para os testes diferenciais.

## Arquitetura alvo

```
Fontes (git)                         Build (bun)                            Consulta
─────────────                        ───────────                            ────────
normas/*.md ─────────┐
relacoes.yaml ───────┤               packages/kb
dados/institucional/ ┼──► parse ──► ├─ IDs, schemas, resolvedor   ──► kb.sqlite (FTS5) ──► CLI `kb … --json`
catalogos/cnct/ ─────┤     valida    ├─ dispositivos e relações               │            └► MCP (só se houver
ppcs/*.md (+ proveniência) ──┤ compila ├─ seções, citações, fatos            │               consumidor sem shell)
fichas analise-ppc ──┘               └─ paridade (texto, json, schema)     ├──► JSONs públicos
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
  - `curso:curitiba/tecnico-em-enfermagem` (a chave atual de `dados/institucional/`);
  - `campus:curitiba`;
  - `cnct:tecnico-em-enfermagem`;
  - `ppc:curitiba/tecnico-em-enfermagem@<versão>`;
  - `ficha:CT-CURR-12`.

**Só o texto vigente.** Os dispositivos guardam a redação atual. Notas como "Redação dada pela Lei X" viram metadado do dispositivo, sem modelar redações históricas.

## Fases

| Fase | Entrega | Esforço | Depende de |
|---|---|---|---|
| 0 | Fundação TypeScript: `packages/kb`, validador da `analise-ppc` em TS | Baixo | — |
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

**Objetivo.** Criar o núcleo `packages/kb` e tirar do Python a validação da `analise-ppc`, que hoje duplica regras do pipeline TypeScript.

**Entregas**

- **Workspace `packages/kb`,** no molde do `sei-cli`:
  - `package.json` com `"name": "@simplifica-if/kb"`, `"exports": { "./*": "./src/*.ts" }` e os scripts `test`, `typecheck` e `format`;
  - `tsconfig.json` estendendo um `tsconfig.base.json` comum, extraído do `tsconfig.json` da raiz;
  - na raiz, a dependência `"@simplifica-if/kb": "workspace:*"`. Os scripts das skills importam `@simplifica-if/kb/...`, e a resolução funciona também pelo symlink `.claude/skills`.
- **Kit de paridade movido para `packages/kb`:** `texto.ts`, `json.ts` e `schema.ts`. O `scripts/` passa a importá-lo de lá, para que a dependência vá num sentido só.
- **Configuração da raiz:**
  - `tsconfig.json` passa a incluir `.agents/skills/*/scripts/**/*.ts` e `.agents/skills/*/tests/**/*.ts`.
  - `test`: `bun test scripts ./.agents/skills && bun run --cwd packages/kb test && …`. O caminho precisa começar com `./`, porque o `bun test` ignora diretórios com ponto.
  - `format`: `bun fmt scripts '.agents/skills/*/scripts/**/*.ts' '.agents/skills/*/tests/**/*.ts' && …`. O glob tem de ser só de `.ts`: `bun fmt` sobre `.agents/skills/` reformataria fichas JSON e Markdown.
- **Validador da `analise-ppc` em TypeScript:**
  - portar `validar_base_analise.py`, `gerar_indice_base_analise.py` e `gerar_mapa_fichas.py`, usando o `ajv` de `schema.ts` sobre os JSON Schemas atuais de `base-analise/schemas/`;
  - o casamento de referências vai para `packages/kb/src/normas/referencias.ts`, como semente do resolvedor da fase 2;
  - a validação da `analise-ppc` passa a rodar também dentro de `bun run scripts/validar_base.ts`.
- **Entrypoint único `analise_ppc.ts`.** Ele assume os subcomandos e chama o Python por subprocesso nos que ainda não foram portados. O `SKILL.md` muda uma vez só, e a trilha T troca as implementações por baixo.
- **Testes:** portar `test_marcos_normativos.py` e os casos de `test_flow.py` ligados à validação, ao índice e ao mapa. O resto de `test_flow.py` é fatiado junto com a trilha T.
- **Diferencial:**
  - `indice.json` e `mapa-fichas.md`: idênticos aos do Python, com `gerado_em` fixo;
  - mensagens de erro do validador: mesmas, sobre a base atual e sobre fixtures inválidas (casos negativos).

**Critério de aceite**

- `validar_base_analise.py`, `gerar_indice_base_analise.py` e `gerar_mapa_fichas.py` removidos.
- `bun test ./.agents/skills` roda os casos portados, e a contagem aparece no relatório.
- `bun run format:check` passa sem tocar JSON nem Markdown.
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
- **Três PPCs-ouro** com os achados esperados por ficha, para avaliar a `analise-ppc` em si.
- **Harness `bun run avaliacao`:**
  - chama um agente real (`claude -p`, modelo fixado) três vezes por pergunta;
  - pontua de forma determinística:
    - IDs e conjuntos esperados presentes na resposta;
    - citações proibidas (revogadas, inexistentes) ausentes;
    - número de chamadas de ferramenta e de tokens.
  - O relatório datado vai para `avaliacao/resultados/`.
- **Execução.** O harness roda sob demanda, antes e depois de cada fase de retrieval; não há CI no repositório. Os testes de componente (resolvedor, parser) rodam no `bun test`, a cada mudança.

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
  - a lista de cursos sujeitos à adequação sai de `dados/institucional/` (nível técnico e situação ativa);
  - as citações viram um indicador de defasagem por curso: cita a CNE/CEB 6/2012, cita a CNE/CP 1/2021, cita a 2/2026 ou não cita DCN.

**Critério de aceite**

- O resolvedor atinge precisão ≥ 0,95 e recall ≥ 0,90 sobre cerca de 200 citações anotadas à mão em 20 PPCs.
- As 134 referências das fichas resolvem para um ID, de norma, stub ou `externo:`.
- A Q2 é respondida pelo harness com o conjunto do gabarito.

---

### Fase 3 — Curadoria rápida

Com os dados em `dados/institucional/`, cada campo novo é uma alteração de schema zod, revisada por diff.

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
  - o ano do documento continua em `dados/institucional/`.
- **Política de versão de PPC.** As adequações exigidas pelo art. 71 vão gerar reformulações em dois anos. Decidir se a base guarda só o PPC vigente, com o histórico no git, ou várias versões, com `ppc:...@<versão>`.
- **Índice de seções v2, ainda no pipeline atual:**
  - guarda o texto integral da seção, em vez do preview de 500 caracteres;
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

- **`bun run kb:compilar` gera `tmp/kb.sqlite`,** fora do git e reproduzível. O SQLite embutido no Bun é a versão 3.54.0 e suporta FTS5; isso foi verificado.
- **Busca textual:**
  - FTS5 com `tokenize="unicode61 remove_diacritics 2"`;
  - o FTS5 não tem stemmer para português, então uma coluna auxiliar recebe os termos reduzidos por um stemmer em TypeScript;
  - um léxico de sinônimos por tipo de seção completa a busca.
- **Citações extraídas dos PPCs,** pelo resolvedor da fase 2, com seção e papel (fundamento ou referência bibliográfica).
- **Fatos de PPC cruzados com o SUAP.**
  - O SUAP já tem a carga horária das matrizes, inclusive a situação "CH divergentes".
  - O valor está em apontar a divergência entre PPC e SUAP, não em extrair a carga isoladamente de um texto convertido de PDF.
  - Cada fato traz `trecho_fonte` e status de curadoria.
- **CLI** `bun run kb <comando> --json`, com `commander`, como o `sei-cli`. São 8 a 10 comandos:
  - `resolver`, `dispositivo`, `buscar-norma`;
  - `buscar-secoes`, `correspondencia`, `impacto`, `vigencia`;
  - `cursos`, `ppc-fatos`, `citacoes`.
  - Toda resposta traz o texto literal e a proveniência.
  - A CLI recompila o banco sozinha quando ele está ausente ou mais velho que as fontes.
- **`kb pacote-contexto <tarefa> <ppc>`** monta o contexto da `analise-ppc` e substitui a montagem ad hoc de `subagents`.
- **`AGENTS.md`** passa a mandar os agentes consultarem a base pela CLI `kb`, mantendo os arquivos como alternativa.
- Consultas em SQL direto com `bun:sqlite`, com as linhas validadas por zod na fronteira e sem ORM.

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

Corre em paralelo às fases 1 a 7. Cada passo troca uma implementação por baixo do entrypoint `analise_ppc.ts` e só remove o Python depois do diferencial.

**T1. Orquestração**

- Portar `common.py`, `cnct_catalogo.py`, `subagents.py`, `preparar_documento.py` e o `markdown_normalizer.py`, que é só texto e que o `preparar_documento` importa.
- Subcomandos: `preparar-documento` (entrada `.md`), `montar-grupos-subagents`, `preparar-prompts-subagents`, `montar-grupo-avulso`, `mesclar-resultados-avulsos` e `validar-resultados`.
- `SequenceMatcher` precisa de porte próprio e testado.
- Diferencial: grupos, prompts e contextos idênticos para as fixtures, com relógio fixo.

**T2. Relatório e publicação**

- Portar `gerar_relatorio_html.py` com template literals e uma função de escape, sem framework. O `HTMLParser` do Python vira `htmlparser2`, que já é dependência.
- Portar `publicar_surge.py`, que só chama a CLI `surge` por `Bun.spawn`.
- Diferencial: HTML idêntico para as mesmas entradas.

**T3. Conversão DOCX**

- **Leitor OOXML** com `fflate` (`^0.8.2`, a mesma faixa do `sei-cli`) e `htmlparser2` em `xmlMode` com `domutils`, que preservam a ordem do conteúdo misto. Ele precisa reproduzir esta semântica do `python-docx`:
  - `style.name`, com o mapeamento de nomes internos (`heading 1` → `Heading 1`);
  - `row.cells` repetindo as células de `gridSpan` e resolvendo `vMerge`;
  - `Run.text` com `w:tab`, `w:br` e `noBreakHyphen`;
  - hyperlinks dentro de `paragraph.text`.
- **Extratores** de seções, matriz, ementário, identificação e imagens, além do escritor de Markdown.
- **Fallback "rendered"** de figuras vetoriais, que hoje depende de MS Word e poppler. Decidir entre:
  - `soffice --convert-to pdf` seguido de rasterização;
  - remover o fallback e emitir um alerta no `PPC.md`.
- **Corpus** em `~/Library/CloudStorage/OneDrive-Pessoal/PPCs Dentec/`:
  - cerca de 12 DOCX, com versões sucessivas do mesmo PPC;
  - fica fora do git, porque são minutas com nomes de revisores;
  - o diferencial lê o caminho de `KB_CORPUS_DOCX` e grava em `tmp/`;
  - os arquivos estão só na nuvem: marcar a pasta como "Manter sempre neste dispositivo" antes de rodar;
  - as fixtures versionadas são trechos mínimos e anonimizados: uma matriz com células mescladas, um ementário e uma identificação.

**T4. PDF do calendário**

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
- `bun test ./.agents/skills` roda pelo menos os 89 casos equivalentes.
- Há um relatório de diferencial por módulo, com os documentos do corpus e os diffs (zero ou aceitos).
- Numa rodada real com relógio fixo, os JSONs da rodada e o HTML saem idênticos aos da versão Python.

---

## Bibliotecas

| Biblioteca | Papel | Onde | Situação |
|---|---|---|---|
| `zod` 4 | Contratos de dados novos e reestruturados | 0, 2, 3 | Já usada |
| `ajv` | JSON Schemas existentes, com mensagens compatíveis (`schema.ts`) | 0 | Já usada; fica |
| `json-schema-to-typescript` | Tipos dos schemas públicos | — | Já usada; fica |
| `bun:sqlite` | Banco compilado com FTS5 | 6 | Embutida |
| `commander` | CLIs `kb` e `analise_ppc.ts` | 0, 6 | Já usada no `sei-cli` |
| `yaml` (`schema: "failsafe"`) | Front matter e `relacoes.yaml` | 2, 5 | Nova |
| `unified` + `remark-parse` + `remark-gfm` | Estrutura de normas e PPCs | 4, 5 | Nova |
| `fflate` + `htmlparser2` + `domutils` | Leitura de DOCX | T3 | Já usadas |
| `pdfmake` | PDF do calendário | T4 | Nova |
| `unpdf` + `tesseract.js` + `@napi-rs/canvas` | PDF → Markdown | T5 | Em avaliação; exceção provável |
| stemmer de português | Coluna auxiliar do FTS5 | 6 | Em avaliação: `snowball-stemmers` está parado desde 2022; comparar com RSLP |
| `@modelcontextprotocol/sdk` | Servidor MCP | 7 | Condicional |

As versões são fixadas exatamente na adoção (`bun add <pkg>@<versão>`).

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
- Não rodar `bun fmt` fora dos globs de `.ts`.

## Fora do escopo

**Movimentações de Cursos fora do Notion.** Decisão de 13/11/2026: fica registrada só como direção futura. Quando voltar à pauta:

- separar o registro da movimentação (editado por pessoas, raro) do estado SEI (derivado pela sincronização, de hora em hora);
- levar o registro para `dados/institucional/movimentacoes/`;
- tratar o estado SEI como cache reconstruível.

A interface depende de quem edita:
- se forem só agentes e CLI, basta um painel somente leitura;
- se a equipe editar sem git, a opção é um SQLite hospedado (Cloudflare D1) com login.

O `kb.sqlite` nunca é o lugar de edição.

## Decisões em aberto

Decididas:
- núcleo em `packages/kb`;
- corpus DOCX na pasta `PPCs Dentec` do OneDrive;
- Movimentações fora do escopo.

Em aberto:

1. **Fallback "rendered" de figuras na conversão DOCX:** `soffice` ou remover com alerta (T3).
2. **Conversor de PDF de PPCs:** porte ou exceção Python, conforme a medição de T5.
3. **Política de versão de PPC:** só o vigente ou várias versões (fase 4).
4. **Modelo e orçamento do harness de avaliação:** modelo fixado e número de execuções por pergunta (fase 1).
5. **Data do DOU e URL oficial da Res. CNE/CP 2/2026:** necessárias para `publicada_em` e `vigente_de` (fase 5).

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
  - os gabaritos de conjunto são gerados por `bun run avaliacao:gabaritos`;
  - o harness roda com `bun run avaliacao`;
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

**Fase 2a concluída em 13/11/2026** (branch `worktree-agent-ab78953406a22651e`). Falta a 2b: fichas com referências estruturadas e schema zod da ficha, depois do porte de `subagents.py`.

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
  - `bun test` precisa do caminho `./.agents`, e `bun fmt` só pode rodar com globs de `.ts`;
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
