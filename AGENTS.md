# Instruções para agentes

Este repositório contém uma base de conhecimento local do IFPR com normas, catálogos, PPCs, metadados institucionais e painéis derivados. A fonte documental publicada fica em `base-conhecimento/`; a saída publicável é gerada em `site/`.

Os dados institucionais de gestão (Campi, Cursos com metadados de PPC e SUAP, Processos Seletivos, Editais e Ofertas) têm como fonte de verdade os registros de `base-conhecimento/institucional/ifpr/` (`campi/`, `cursos/`, `processos-seletivos/`, `editais/`, `ofertas/`), um JSON por registro, versionados no git e publicados como estão. Só o `index.json` de cada coleção (por `gerar_base.ts`) e `processos-sei/index.json` (exportado do Notion) são gerados; não os edite à mão. As reuniões do Consepe, com pareceres e itens de pauta e sem dados de pessoa, estão em `institucional/ifpr/conselhos/`. O Notion guarda só a base de fluxo `Movimentações de Cursos`, que também deve sair dele no futuro.

Também contém skills operacionais em `.agents/skills/`. O caminho `.claude/skills` é um symlink para esse diretório, para que o Claude Code descubra as mesmas skills; edite sempre em `.agents/skills/`. Ao fazer alterações em qualquer skill, leia primeiro o `README.md` da própria skill, quando existir. Use esse arquivo para entender propósito, fluxo de uso, comandos de manutenção e convenções locais antes de editar scripts, fichas, prompts, testes ou documentação. Se a alteração envolver base gerada ou índice consolidado, procure no `README.md` da skill o comando de regeneração ou validação correspondente e execute-o antes de concluir.

## Consulta local da base

Para consultas, respostas a perguntas ou uso desta base como fonte por LLM, use primeiro os arquivos locais deste checkout. Não substitua arquivos locais por URLs públicas quando o conteúdo estiver disponível no repositório.

Para uso por MCP (o servidor `simplifica-mcp`, sem o checkout), veja [`packages/mcp/instrucoes.md`](packages/mcp/instrucoes.md).

Comece pela CLI `kb` (requer `pnpm install` na raiz). Ela consulta `tmp/kb.sqlite`, um banco derivado dos arquivos do checkout (normas, PPCs com o texto integral das seções, registros institucionais, CNCT, fichas da `revisar-ppc`), e o recompila sozinha quando ele falta ou está mais velho que as fontes (cerca de 8 s; `pnpm kb:compilar` força). O banco nunca é fonte de verdade nem lugar de edição: toda resposta traz o texto literal e o arquivo e a linha de onde ele veio, e é esse arquivo que se cita.

```bash
pnpm kb buscar-norma "Resolução CNE/CP nº 2/2026, art. 28" --json   # citação ou ID → o dispositivo (caput, texto, linhas); termos → busca nos metadados e nos dispositivos
pnpm kb buscar-secoes "acompanhamento de egressos" --cnct tecnico-em-agropecuaria --json   # seções de PPC; filtros --ppc, --tipo, --nivel, --campus, --forma
pnpm kb cursos --eixo "Informação e Comunicação" --processo processo-seletivo-2026 --json   # cursos com CNCT, ofertas e turno; filtros --turno, --campus, --nivel…
pnpm kb ppc-fatos curitiba/tecnico-em-enfermagem --json              # carga horária, estágio e ano do PPC, cruzados com o SUAP
pnpm kb ppc-fatos --divergencias --nivel médio                        # PPCs com divergência PPC × SUAP
pnpm kb pacote-contexto CT-CURR-12 curitiba/tecnico-em-enfermagem --json   # contexto de uma ficha da revisar-ppc: CNCT, dispositivos citados, marcos e regras de transição, seções
```

Os fatos de PPC têm status `extraido` (regra sobre o texto convertido, sem revisão humana): confira o `trecho_fonte` antes de afirmar uma divergência. A busca de seções usa radicais e um léxico de sinônimos (`packages/kb/dados/sinonimos.yaml`); se ela não achar o que se espera, procure nos arquivos.

Os arquivos continuam a alternativa quando a CLI não cobre a pergunta. Use os manifestos locais como ponto de entrada:

- `base-conhecimento/manifest.json`: normas, legislação, resoluções, portarias, notas técnicas e referências gerais.
- `base-conhecimento/institucional_manifest.json`: coleções institucionais do IFPR.
- `base-conhecimento/catalogos_manifest.json`: catálogos publicados, incluindo o CNCT.
- `base-conhecimento/institucional/ifpr/ppcs/index.json`: índice dos PPCs convertidos.

Os campos `path` dos manifestos são relativos a `base-conhecimento/`. Ao abrir um arquivo indicado por manifesto, prefixe o caminho com `base-conhecimento/`.

Procedimento recomendado:

1. Tente primeiro o comando `kb` correspondente (acima). Sem ele, consulte o manifesto local adequado e filtre por `title`, `aliases`, `keywords`, `ementa`, `orgao`, `ano`, `status_vigencia`, campus, curso, nível ou tipo de oferta.
2. Abra os arquivos locais indicados no campo `path`, dentro de `base-conhecimento/`.
3. Para normas, legislação e resoluções, use os Markdown em `base-conhecimento/normas/` como fonte principal e cite o título, a fonte oficial registrada no front matter e o artigo, seção ou item usado.
4. Para metadados institucionais publicados, use os JSONs em `base-conhecimento/institucional/ifpr/`. Para estado operacional atual de bases geridas no Notion, consulte o Notion conforme a seção de curadoria e operação.
5. Para CNCT, use `base-conhecimento/catalogos/cnct/manifest.json`, `base-conhecimento/catalogos/cnct/index.json` e, quando necessário, os arquivos em `base-conhecimento/catalogos/cnct/cursos/`.
6. Para PPCs, use `pnpm kb buscar-secoes` (ou `base-conhecimento/institucional/ifpr/ppcs/index.json` e os índices de seções em `base-conhecimento/institucional/ifpr/ppcs/secoes/`) e depois abra o Markdown do PPC nas linhas indicadas antes de redigir resposta substantiva.
7. Use busca online apenas quando o dado necessário não existir na base local, quando a pergunta exigir atualização externa ou quando for preciso confirmar informação em fonte oficial. Ao usar fonte externa, deixe isso explícito.

Cada norma tem um ID canônico derivado do ato (`id` no front matter e no `manifest.json`), como `br/cne-cp/res/2026/2`, `br/lei/1996/9394` ou `ifpr/consup/res/2024/190`. Normas citadas sem texto na base (stubs) e referências `externo:` ficam em `base-conhecimento/normas/stubs.yaml`. Para identificar uma citação ou achar quem cita uma norma, use a CLI `kb` (requer `pnpm install` na raiz):

```bash
pnpm kb resolver "Resolução CNE/CP nº 1/2021, art. 20"   # ID canônico, dispositivo, regra e confiança
pnpm kb citacoes br/cne-cp/res/2021/1 --json              # PPCs convertidos que citam a norma, com linha, trecho e regra
pnpm kb adequacao-art71                                   # cursos técnicos em oferta e a DCN que cada PPC cita
pnpm kb dispositivo "br/cne-cp/res/2026/2#art28-xviii"    # texto do dispositivo, caput herdado, notas e linha no Markdown
pnpm kb vigencia br/cne-cp/res/2021/1 --em 2026-11-01     # status numa data, relações que o determinam e regras de transição
pnpm kb correspondencia "br/cne-cp/res/2021/1#art20"      # dispositivo correspondente na norma sucessora (tabela em rascunho)
pnpm kb impacto br/cne-cp/res/2021/1                      # fichas, validações, textos das skills, normas e PPCs afetados
pnpm kb relacoes br/lei/1996/9394                         # relações tipadas (revoga, altera, regulamenta, fundamenta-se-em)
```

Os dispositivos têm ID próprio (`#art28-xvi`, `#art28-par1-iv`, `#art71-parunico`, `#art36A`, `#anexo1-art5`). As relações entre normas estão em `base-conhecimento/relacoes.yaml`, as regras de transição em `base-conhecimento/transicoes.yaml` e as tabelas de correspondência entre normas sucessoras em `base-conhecimento/correspondencias/`. O `status_vigencia` publicado é calculado na `data_referencia` de `base-conhecimento/config/vigencia.yaml`; quando ele depende de uma data ainda não registrada (por exemplo, a publicação da Res. CNE/CP nº 2/2026 no DOU), o front matter e o `manifest.json` trazem `vigencia_a_confirmar`. Norma revogada não é inaplicável: consulte as regras de transição (`kb vigencia`). A tabela de correspondência 1/2021 → 2/2026 é rascunho sem revisão jurídica; trate-a como indicação, não como fundamento.

Confira a `regra` e a `confianca` das citações: as regras de confiança menor (`dcnept-2021-orgao-trocado`, `orgao-ausente-registro`, `orgao-no-documento`) completam ou corrigem citações incompletas dos PPCs e devem ser conferidas no trecho antes de afirmar algo substantivo. O resultado aponta o arquivo; abra o Markdown da norma ou do PPC antes de responder.

PPCs servem como exemplos institucionais observados, não como fonte normativa obrigatória. Em elaboração, revisão ou comparação de PPC, combine PPCs similares com normas vigentes da base e, para cursos técnicos, com o CNCT.

## Curadoria e operação

Para consultar ou alterar campi, cursos, metadados de PPC e SUAP, horários dos campi, processos seletivos, editais ou ofertas de ingresso, leia primeiro:

- [Curadoria de metadados institucionais](base-conhecimento/docs/curadoria-metadados-institucionais.md)

Para solicitações sobre `Movimentações de Cursos`, a única base que continua no Notion (cada movimentação aponta para o curso pela chave `campus_id/curso_slug` em `Curso ID`), leia primeiro:

- [Operação do Notion por agentes](base-conhecimento/docs/notion-operacao-agentes.md)

As bases do Consepe estão em `base-conhecimento/institucional/ifpr/conselhos/`; Pareceres de Curso, Servidores e Conselheiros ficaram só no arquivo do Notion.

Para perguntas, conferências ou curadoria que dependam de dados do Sistema Eletrônico de Informações (SEI), use o pacote `packages/sei-cli` deste repositório como ferramenta operacional e leia primeiro:

- [Uso do sei-cli por agentes](base-conhecimento/docs/sei-cli-operacao-agentes.md)
- [Sincronização SEI → Notion](base-conhecimento/docs/sincronizacao-sei-notion.md)

Para `Movimentações de Cursos` e para a exportação pública, use a API do Notion com `NOTION_TOKEN` do projeto. Não presuma que o Notion MCP local do usuário acessa esta base, pois ele pode estar conectado ao Notion pessoal do usuário. Se `NOTION_TOKEN` não estiver disponível, peça ao usuário o token da integração Notion organizacional e grave em `.env.local`.

Depois de alterar os registros de `base-conhecimento/institucional/ifpr/` ou `Movimentações de Cursos`, rode:

```bash
node scripts/exportar_base_publica.ts   # só se Movimentações de Cursos mudou (Notion → processos-sei/index.json)
node scripts/gerar_base.ts
node scripts/gerar_indice_ppcs.ts
node scripts/validar_base.ts
node scripts/gerar_site.ts
```

Para atualização rotineira de dados SEI em `Movimentações de Cursos`, use antes (requer `pnpm install` na raiz):

```bash
pnpm sei:sync --apply
```

Funcionamento, credenciais, agendamento e diagnóstico da sincronização estão em [Sincronização SEI → Notion](base-conhecimento/docs/sincronizacao-sei-notion.md).

Depois de alterar um JSON Schema em `base-conhecimento/schemas/`, regenere os tipos TypeScript derivados dele (`scripts/base/tipos-schemas.ts`) e confira o código que os usa:

```bash
node scripts/gerar_tipos_schemas.ts
pnpm typecheck
```

### Dados pessoais e URLs internas na base

A base é pública. A regra fica em `packages/kb/src/ppcs/dados-pessoais.ts`, com cópia em `scripts/converter_ppcs_markdown.py` (por onde os PPCs entram na base) e os mesmos casos de teste para as duas (`dados-pessoais.casos.json`); o `validar_base.ts` aplica a regra a todo arquivo de `base-conhecimento/` e recusa o que ela acharia, com só as contagens na mensagem. A exportação dos processos SEI aplica a mesma limpeza às anotações do Notion.

São omitidos, com o rótulo e o resto da frase mantidos:

- CPF → `[CPF omitido]`: o número depois do rótulo `CPF` (inclusive com `|` ou `<br>` no meio, como em célula de tabela) e o `000.000.000-00` sem rótulo com dígito verificador válido;
- RG → `[RG omitido]`: o número depois de `RG`, `R.G.`, `R.G`, `Registro Geral`, `cédula`/`carteira`/`doc. de identidade` ou `Identidade:`, com UF (`MG-12.345.678`) ou grupos separados por espaço; `RG/CPF:` com dois números vira os dois marcadores;
- celular → `[telefone omitido]`: 9 dígitos começando por 9, com DDD (com ou sem parênteses, `+55`) ou, sem DDD, com separador;
- matrícula de estudante → `[matrícula omitida]`: 11 dígitos começando pelo ano (`20xx…`);
- SIAPE → `[SIAPE omitido]`: o número depois do rótulo `SIAPE` e os números da coluna `SIAPE` de tabela Markdown.

Ficam: o nome de pessoa em ato oficial, quadro docente ou declaração; e-mail institucional; telefone fixo; endereço e contato de campus e de parceiros. Não são CPF nem RG: onze dígitos soltos (IDs do Lattes e ISBN partidos pela conversão), número de até 4 dígitos depois de `RG` (um ano) e `R.G.` depois de iniciais de autor em referência bibliográfica (`JORDÃO, R.G. 2010`). E-mail particular não tem regra automática: tire à mão.

Também não entram, e o `validar_base.ts` recusa: URL pré-assinada (`AWSAccessKeyId`, `Signature`, `X-Amz-*`; grave sem a query string), link de planilha do Google (`docs.google.com/spreadsheets`; o texto da referência fica sem o link, salvo o `horarios_url` de um campus, grade pública apontada pelo site oficial) e parâmetros de sessão do SEI (`infra_hash`, `infra_sistema`, `infra_unidade_atual`; o `hash_download` da autenticação pública fica).

Ao incluir uma norma em `base-conhecimento/normas/`, preencha o `id` conforme [Padrão de front matter](base-conhecimento/docs/padrao-front-matter-legislacao.md) e retire de `normas/stubs.yaml` o stub correspondente, se houver.

Depois de alterar normas, `relacoes.yaml`, `transicoes.yaml`, `correspondencias/`, `config/vigencia.yaml`, `normas/stubs.yaml`, catálogos, PPCs convertidos ou manifestos locais, rode:

```bash
node scripts/gerar_base.ts      # campos gerados do front matter (relações, status de vigência) e manifest.json
node scripts/validar_base.ts
node scripts/gerar_site.ts
```

Não edite à mão `status_vigencia`, `revoga`, `revogada_por`, `altera`, `alterada_por`, `regulamenta`, `regulamentada_por`, `fundamenta_se_em`, `fundamenta` nem `vigencia_*` no front matter das normas: eles são gerados. Relação nova entra em `relacoes.yaml`, com a evidência literal do texto; `pnpm kb relacoes --propor` lista o que o regex encontrou e ainda não foi confirmado. Ao mudar a marcação de uma norma, preserve as palavras (`pnpm --filter @simplifica-if/kb test src/normas` confere) e siga as convenções de corpo de `base-conhecimento/docs/padrao-front-matter-legislacao.md`.

Os scripts que falam com Notion, SEI e SUAP, assim como o pipeline da base (`gerar_base.ts`, `gerar_indice_ppcs.ts`, `validar_base.ts`, `gerar_site.ts`, com lógica em `scripts/base/`), são TypeScript e rodam direto no Node, sem etapa de build: a versão fica em `.node-version` e `engines` (26.12.1), e o pnpm do `packageManager` (12.14.0, pelo corepack) instala as dependências com `pnpm install` na raiz. Regras compartilhadas entre `scripts/` e as skills (texto, JSON, JSON Schema, referências normativas) ficam no workspace `packages/kb` (`@simplifica-if/kb`); `packages/kb` não importa de `scripts/`. Em `scripts/`, só `converter_ppcs_markdown.py` (depende de `pymupdf4llm`) continua em Python. Depois de alterar código TypeScript em `scripts/`, `packages/kb` ou nas skills, rode:

```bash
pnpm fmt
pnpm lint
pnpm typecheck
pnpm test
```

As ferramentas são as do T3 Code, configuradas em `vite.config.ts`: `pnpm fmt` aplica o `vp fmt` (oxfmt, largura 120), `pnpm lint` o `vp lint` (oxlint), `pnpm test` o `vp test` (vitest) na raiz e em cada pacote, e `pnpm typecheck` o `effect-tsgo`. A formatação deixa de fora Markdown, JSON, YAML e Python, e as pastas de dados (`base-conhecimento/`, `avaliacao/`, `site/`, `tmp/`, `outputs/`, `.repos/` e as pastas de dados das skills): são textos normativos, saídas de geradores ou insumos, e não devem ser reformatados. Use sempre `pnpm fmt`, nunca o oxfmt ou o prettier direto sobre a raiz. O código de referência do Effect fica em `.repos/effect`, fora do git, trazido na versão do catalog por `pnpm sync:repos`.

As skills com bloco `simplifica:` no front matter do `SKILL.md` (hoje `verificar-fundamentacao-normativa`) também vão para o app desktop, que não tem o repositório: só as ferramentas MCP `ifpr` e os arquivos listados em `simplifica.arquivos`. Ao editá-las, mantenha as ferramentas `ifpr` como caminho principal e a CLI e os scripts como alternativa "dentro do repositório", e acrescente a `simplifica.arquivos` todo arquivo novo que o texto cite; `node scripts/validar_base.ts` confere o bloco (Effect Schema em `@simplifica-if/mcp/skills`) e os arquivos.

Depois de alterar skills, rode os testes ou validações da skill afetada. Para a skill `revisar-ppc`, use:

```bash
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts validar-base
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts gerar-schemas --check
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts gerar-mapa --check
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts gerar-indice --check
pnpm exec vp test run .agents/skills/revisar-ppc
```

Sem `--check`, `gerar-schemas`, `gerar-mapa` e `gerar-indice` regeneram os JSON Schemas de ficha e marcos (gerados do Effect Schema de `scripts/esquemas.ts`), `mapa-fichas.md` e `indice.json` da base de análise. O `revisar_ppc.ts` é o ponto de entrada único da skill, e todos os subcomandos rodam em TypeScript, inclusive a conversão de entrada `.docx`: a skill só precisa do Node. A conversão fica em dois pacotes do workspace, `packages/docx` (leitor OOXML genérico, com os limites contra arquivo hostil) e `packages/ppc` (conversão do PPC e normalizador de Markdown), que o servidor do app também importa. Depois de alterá-los, rode os testes dos dois (`pnpm --filter @simplifica-if/docx --filter @simplifica-if/ppc test`) e o diferencial contra a conversão antiga em Python (`node packages/ppc/scripts/diferencial-docx.ts`, descrito no `README.md` da skill; ferramenta de desenvolvimento, precisa de `uv`).
