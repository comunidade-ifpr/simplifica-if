# Instruções para agentes

Este repositório contém uma base de conhecimento local do IFPR com normas, catálogos, PPCs, metadados institucionais e painéis derivados. A fonte documental publicada fica em `base-conhecimento/`; a saída publicável é gerada em `site/`.

Os dados institucionais de gestão (Campi, Cursos com metadados de PPC e SUAP, Processos Seletivos, Editais e Ofertas) têm como fonte de verdade os arquivos de `dados/institucional/`, versionados no git. Os JSONs institucionais em `base-conhecimento/` são artefatos publicáveis gerados a partir deles; não os edite à mão. O Notion guarda só a base de fluxo `Movimentações de Cursos`, que também deve sair dele no futuro.

Também contém skills operacionais em `.agents/skills/`. O caminho `.claude/skills` é um symlink para esse diretório, para que o Claude Code descubra as mesmas skills; edite sempre em `.agents/skills/`. Ao fazer alterações em qualquer skill, leia primeiro o `README.md` da própria skill, quando existir. Use esse arquivo para entender propósito, fluxo de uso, comandos de manutenção e convenções locais antes de editar scripts, fichas, prompts, testes ou documentação. Se a alteração envolver base gerada ou índice consolidado, procure no `README.md` da skill o comando de regeneração ou validação correspondente e execute-o antes de concluir.

## Consulta local da base

Para consultas, respostas a perguntas ou uso desta base como fonte por LLM, use primeiro os arquivos locais deste checkout. Não substitua arquivos locais por URLs públicas quando o conteúdo estiver disponível no repositório.

Use os manifestos locais como ponto de entrada:

- `base-conhecimento/manifest.json`: normas, legislação, resoluções, portarias, notas técnicas e referências gerais.
- `base-conhecimento/institucional_manifest.json`: coleções institucionais do IFPR.
- `base-conhecimento/catalogos_manifest.json`: catálogos publicados, incluindo o CNCT.
- `base-conhecimento/institucional/ifpr/ppcs/index.json`: índice dos PPCs convertidos.

Os campos `path` dos manifestos são relativos a `base-conhecimento/`. Ao abrir um arquivo indicado por manifesto, prefixe o caminho com `base-conhecimento/`.

Procedimento recomendado:

1. Consulte o manifesto local adequado e filtre por `title`, `aliases`, `keywords`, `ementa`, `orgao`, `ano`, `status_vigencia`, campus, curso, nível ou tipo de oferta.
2. Abra os arquivos locais indicados no campo `path`, dentro de `base-conhecimento/`.
3. Para normas, legislação e resoluções, use os Markdown em `base-conhecimento/normas/` como fonte principal e cite o título, a fonte oficial registrada no front matter e o artigo, seção ou item usado.
4. Para metadados institucionais publicados, use os JSONs em `base-conhecimento/institucional/ifpr/`. Para estado operacional atual de bases geridas no Notion, consulte o Notion conforme a seção de curadoria e operação.
5. Para CNCT, use `base-conhecimento/catalogos/cnct/manifest.json`, `base-conhecimento/catalogos/cnct/index.json` e, quando necessário, os arquivos em `base-conhecimento/catalogos/cnct/cursos/`.
6. Para PPCs, use `base-conhecimento/institucional/ifpr/ppcs/index.json`, os índices de seções em `base-conhecimento/institucional/ifpr/ppcs/secoes/` e depois abra o Markdown completo do PPC antes de redigir resposta substantiva.
7. Use busca online apenas quando o dado necessário não existir na base local, quando a pergunta exigir atualização externa ou quando for preciso confirmar informação em fonte oficial. Ao usar fonte externa, deixe isso explícito.

Cada norma tem um ID canônico derivado do ato (`id` no front matter e no `manifest.json`), como `br/cne-cp/res/2026/2`, `br/lei/1996/9394` ou `ifpr/consup/res/2024/190`. Normas citadas sem texto na base (stubs) e referências `externo:` ficam em `base-conhecimento/normas/stubs.yaml`. Para identificar uma citação ou achar quem cita uma norma, use a CLI `kb` (requer `bun install` na raiz):

```bash
bun run kb resolver "Resolução CNE/CP nº 1/2021, art. 20"   # ID canônico, dispositivo, regra e confiança
bun run kb citacoes br/cne-cp/res/2021/1 --json              # PPCs convertidos que citam a norma, com linha, trecho e regra
bun run kb adequacao-art71                                   # cursos técnicos em oferta e a DCN que cada PPC cita
```

Confira a `regra` e a `confianca` das citações: as regras de confiança menor (`dcnept-2021-orgao-trocado`, `orgao-ausente-registro`, `orgao-no-documento`) completam ou corrigem citações incompletas dos PPCs e devem ser conferidas no trecho antes de afirmar algo substantivo. O resultado aponta o arquivo; abra o Markdown da norma ou do PPC antes de responder.

PPCs servem como exemplos institucionais observados, não como fonte normativa obrigatória. Em elaboração, revisão ou comparação de PPC, combine PPCs similares com normas vigentes da base e, para cursos técnicos, com o CNCT.

## Curadoria e operação

Para consultar ou alterar campi, cursos, metadados de PPC e SUAP, horários dos campi, processos seletivos, editais ou ofertas de ingresso, leia primeiro:

- [Curadoria de metadados institucionais](base-conhecimento/docs/curadoria-metadados-institucionais.md)

Para solicitações sobre `Movimentações de Cursos`, a única base que continua no Notion (cada movimentação aponta para o curso pela chave `campus_id/curso_slug` em `Curso ID`), leia primeiro:

- [Operação do Notion por agentes](base-conhecimento/docs/notion-operacao-agentes.md)

Pareceres de Curso e as bases do Consepe foram arquivados em `dados/arquivo-notion/`, somente para consulta.

Para perguntas, conferências ou curadoria que dependam de dados do Sistema Eletrônico de Informações (SEI), use o pacote `packages/sei-cli` deste repositório como ferramenta operacional e leia primeiro:

- [Uso do sei-cli por agentes](base-conhecimento/docs/sei-cli-operacao-agentes.md)
- [Sincronização SEI → Notion](base-conhecimento/docs/sincronizacao-sei-notion.md)

Para `Movimentações de Cursos` e para a exportação pública, use a API do Notion com `NOTION_TOKEN` do projeto. Não presuma que o Notion MCP local do usuário acessa esta base, pois ele pode estar conectado ao Notion pessoal do usuário. Se `NOTION_TOKEN` não estiver disponível, peça ao usuário o token da integração Notion organizacional e grave em `.env.local`.

Depois de alterar `dados/institucional/` ou `Movimentações de Cursos`, rode:

```bash
bun run scripts/exportar_base_publica.ts
bun run scripts/gerar_indice_ppcs.ts
bun run scripts/validar_base.ts
bun run scripts/gerar_site.ts
```

Para atualização rotineira de dados SEI em `Movimentações de Cursos`, use antes (requer `bun install` na raiz):

```bash
bun run sei:sync --apply
```

Funcionamento, credenciais, agendamento e diagnóstico da sincronização estão em [Sincronização SEI → Notion](base-conhecimento/docs/sincronizacao-sei-notion.md).

Depois de alterar um JSON Schema em `base-conhecimento/schemas/`, regenere os tipos TypeScript derivados dele (`scripts/base/tipos-schemas.ts`) e confira o código que os usa:

```bash
bun run scripts/gerar_tipos_schemas.ts
bun run typecheck
```

Ao incluir uma norma em `base-conhecimento/normas/`, preencha o `id` conforme [Padrão de front matter](base-conhecimento/docs/padrao-front-matter-legislacao.md) e retire de `normas/stubs.yaml` o stub correspondente, se houver.

Depois de alterar normas, catálogos, PPCs convertidos ou manifestos locais, rode:

```bash
bun run scripts/validar_base.ts
bun run scripts/gerar_site.ts
```

Os scripts que falam com Notion, SEI e SUAP, assim como o pipeline da base (`gerar_base.ts`, `gerar_indice_ppcs.ts`, `validar_base.ts`, `gerar_site.ts`, com lógica em `scripts/base/`), são TypeScript (Bun) e exigem `bun install` na raiz. Regras compartilhadas entre `scripts/` e as skills (texto, JSON, JSON Schema, referências normativas) ficam no workspace `packages/kb` (`@simplifica-if/kb`); `packages/kb` não importa de `scripts/`. Em `scripts/`, só `converter_ppcs_markdown.py` (depende de `pymupdf4llm`) continua em Python. Depois de alterar código TypeScript em `scripts/`, `packages/kb` ou nas skills, rode:

```bash
bun run format
bun run typecheck
bun run test
```

O `bun run format` aplica `bun fmt` (largura 120, configurada em `bunfig.toml`) apenas em `scripts/`, nos `.ts` de `.agents/skills/*/scripts/` e `.agents/skills/*/tests/` e nos workspaces de `packages/`. Não rode `bun fmt` na raiz: Markdown e JSON de `base-conhecimento/` são textos normativos ou saídas de geradores e não devem ser reformatados.

Depois de alterar skills, rode os testes ou validações da skill afetada. Para a skill `analise-ppc`, use:

```bash
bun run .agents/skills/analise-ppc/scripts/analise_ppc.ts validar-base
bun run .agents/skills/analise-ppc/scripts/analise_ppc.ts gerar-mapa --check
bun run .agents/skills/analise-ppc/scripts/analise_ppc.ts gerar-indice --check
bun test ./.agents/skills/analise-ppc
python3 -m pytest .agents/skills/analise-ppc/tests
```

Sem `--check`, `gerar-mapa` e `gerar-indice` regeneram `mapa-fichas.md` e `indice.json` da base de análise. O `analise_ppc.ts` é o ponto de entrada único da skill, e todos os subcomandos rodam em TypeScript; só a conversão de entrada `.docx` ainda chama Python (`converter_docx.py`), e o `pytest` cobre só os extratores dessa conversão.
