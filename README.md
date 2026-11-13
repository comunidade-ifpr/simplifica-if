# Simplifica IF

Projeto unificado que reúne a Base de Conhecimento do IFPR e as skills operacionais usadas por agentes IA.

A base em `base-conhecimento/` é a fonte de verdade para normas, legislação, resoluções, portarias, metadados institucionais, PPCs, catálogos e documentos de referência. As skills em `.agents/skills/` transformam tarefas recorrentes em fluxos reprodutíveis que consultam essa base localmente.

## Estrutura

- `base-conhecimento/`: fonte publicável da base, com caminhos internos preservados como `normas/`, `institucional/`, `catalogos/`, `manifest.json`, `llms.txt` e `README.md`.
- `dados/`: fonte de verdade dos dados institucionais de gestão (campi, cursos, processos seletivos, editais e ofertas), um JSON por registro, e o arquivo das bases antigas do Notion. Os JSONs institucionais de `base-conhecimento/` são gerados a partir daqui.
- `site/`: saída gerada para publicação estática, ignorada pelo Git e reconstruída a partir de `base-conhecimento/`.
- `.agents/skills/`: skills operacionais para agentes IA, uma pasta versionada por skill e sem symlinks internos.
- `scripts/`: geração, validação e exportação da base e integração com Notion (só `Movimentações de Cursos`), SEI e SUAP, em TypeScript (Bun); a conversão de PPCs para Markdown continua em Python.
- `base-conhecimento/docs/`: documentação de apoio à curadoria da base e ao desenvolvimento das skills.
- `packages/sei-cli/`: CLI que extrai e inspeciona processos do SEI com Playwright, mantido como workspace Bun (veja o `README.md` do pacote).

## Base de Conhecimento

Use os manifestos em `base-conhecimento/` como ponto de entrada:

- `base-conhecimento/manifest.json`: normas, legislação, resoluções, portarias e notas técnicas.
- `base-conhecimento/institucional_manifest.json`: coleções institucionais do IFPR.
- `base-conhecimento/catalogos_manifest.json`: catálogos publicados, incluindo o CNCT.
- `base-conhecimento/institucional/ifpr/ppcs/index.json`: índice dos PPCs convertidos.

Os campos `path` dos manifestos são relativos a `base-conhecimento/`. Para publicar a base preservando URLs como `normas/...` e `institucional/...`, gere `site/`:

```bash
bun run scripts/gerar_site.ts
bun run scripts/gerar_site.ts --check
```

## Skills

As skills deste projeto ficam diretamente no diretório padrão de descoberta do repositório:

```bash
.agents/skills/
```

Skills disponíveis:

- `analise-ppc/`: análise IA-first de Projetos Pedagógicos de Curso técnico do IFPR.
- `ifpr-design/`: identidade visual do IFPR para materiais e interfaces.
- `revisar-processo-ppc/`: revisão de processos SEI de PPC.
- `suap-ifpr/`: consulta e navegação no SUAP do IFPR com apoio dos tutoriais oficiais, incluindo dados profissionais de docentes e técnicos administrativos, cursos e disciplinas. Os comandos são TypeScript (Bun) na raiz: `scripts/suap_consultar.ts` e `scripts/suap_tutoriais.ts`, testados por `bun test scripts`.
- `verificar-fundamentacao-normativa/`: conferência de citações e alegações baseadas em leis, resoluções, portarias, CNCT e regulamentos.
- `verificar-calendario/`: verificação de calendários acadêmicos do IFPR.

Ao desenvolver uma skill, consulte primeiro os dados locais em `base-conhecimento/` por manifesto. Só empacote cópias de normas, catálogos ou metadados quando houver motivo claro de portabilidade.

## Manutenção

```bash
bun run scripts/gerar_base.ts --check
bun run scripts/gerar_indice_ppcs.ts --check
bun run scripts/validar_base.ts
bun run scripts/gerar_site.ts --check
bun run scripts/gerar_tipos_schemas.ts --check
python3 -m pytest .agents/skills/analise-ppc/tests
```

Os JSON Schemas de `base-conhecimento/schemas/` são a fonte do formato dos JSONs institucionais e de catálogos. O validador os aplica com o ajv, e os tipos TypeScript usados pelo exportador e pelo validador ficam em `scripts/base/tipos-schemas.ts`, gerado a partir deles. Depois de alterar um schema, rode `bun run scripts/gerar_tipos_schemas.ts` e `bun run typecheck`.

## SEI e sincronização com o Notion

O `sei-cli` é um workspace Bun em `packages/sei-cli/`. Um `bun install` na raiz instala as dependências de todo o repositório. As credenciais do SEI ficam em `packages/sei-cli/.env.local` e os snapshots em `packages/sei-cli/dados/sei/`, ambos ignorados pelo Git.

```bash
bun run sei --help              # o CLI, executado dentro de packages/sei-cli
bun run sei:sync                # simula a atualização das Movimentações de Cursos no Notion
bun run sei:sync --apply        # grava no Notion
```

Credenciais, escopo, avisos de chegada na DENTEC, agendamento pelo launchd e diagnóstico estão em [`base-conhecimento/docs/sincronizacao-sei-notion.md`](base-conhecimento/docs/sincronizacao-sei-notion.md).

`bun run typecheck`, `bun test` e `bun run format` na raiz cobrem `scripts/` e o `sei-cli`. Os scripts importam tipos e schemas do CLI como `sei-cli/<módulo>`, por exemplo `sei-cli/esquemas`.

Para detalhes de desenvolvimento das skills, veja `base-conhecimento/docs/desenvolvimento-skills.md`.

## Licença

Conteúdo curatorial publicado sob CC BY 4.0. Textos normativos oficiais podem estar sujeitos ao regime próprio de documentos públicos; mantenha atribuição e consulte as fontes oficiais.
