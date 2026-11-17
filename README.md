# Simplifica IF

App desktop para os servidores do IFPR. O Simplifica IF dá à IA da assinatura de cada pessoa (Claude, ChatGPT ou Gemini) a base de conhecimento do Instituto e tarefas prontas sobre ela. Este repositório contém o app, a base que o alimenta e as skills e scripts que agentes usam para curar a base.

## O app

O que ele entrega hoje:

- conversa com a IA da pessoa, que consulta a base pelas 16 ferramentas do servidor MCP `ifpr` (`packages/mcp`) e cita cada fonte com um link `ifpr://`;
- tarefas no Início: "Revisar um PPC" (`.docx`: pré-conferência em código, relatório com IA opcional e cópia com comentários do Word) e as skills com bloco `simplifica:` (hoje, `verificar-fundamentacao-normativa`);
- leitor `ifpr://` e Explorar, para navegar por normas, PPCs, cursos, campi, CNCT, Consepe e fichas sem IA;
- pasta de trabalho com "Desfazer", primeiro uso com perfil, relato de erro e atualização da base e das skills.

O app só usa dado público: a base e os arquivos que a pessoa anexa. SUAP, SEI e Notion ficam fora dele (veja [Fora do app](#fora-do-app)). Os planos estão em [`docs/plans/`](docs/plans/README.md).

```bash
pnpm install
pnpm app:dev        # o app em desenvolvimento (veja apps/desktop/README.md)
```

| Parte | O quê |
|---|---|
| [`apps/desktop`](apps/desktop/README.md) | Electron: inicia o servidor local e abre a interface |
| [`apps/server`](apps/server/README.md) | servidor local: motor, MCP `ifpr`, RPC de leitura, revisão de PPC, pastas, atualização |
| [`apps/web`](apps/web/README.md) | interface em React |
| [`packages/kb`](packages/kb/README.md) | núcleo da base e CLI `kb` |
| [`packages/mcp`](packages/mcp/README.md) | `simplifica-mcp`: ferramentas só de leitura sobre o `kb.sqlite`, no app e como executável à parte ([guia do piloto zero](docs/guia-piloto-zero.md)) |
| [`packages/motor`](packages/motor/README.md) | motor de conversa com Claude, ChatGPT e Gemini |
| [`packages/ppc`](packages/ppc/README.md), [`packages/docx`](packages/docx/README.md) | conversão, pré-conferência e revisão de PPC em `.docx` |
| [`packages/atualizacao`](packages/atualizacao/README.md) | atualização da base e das skills |
| `packages/contratos-app` | contratos RPC entre interface e servidor |
| `packages/effect-acp`, `packages/effect-codex-app-server` | copiados do T3 Code ([`docs/upstream-t3.md`](docs/upstream-t3.md)) |

## Fora do app

Estas ferramentas rodam só no repositório, por agentes ou por quem cura a base. A integração ao app está nos planos (decisão 6 de [`docs/plans/app-simplifica-if.md`](docs/plans/app-simplifica-if.md) e [`PLANO-ARQUITETURA.md`](PLANO-ARQUITETURA.md#ferramentas-do-repositório-fora-do-app)):

- `packages/sei-cli` (SEI) e a skill `revisar-processo-ppc`;
- a skill `suap-ifpr` (SUAP) e os scripts `suap_*.ts`;
- a sincronização SEI → Notion de `Movimentações de Cursos` (`pnpm sei:sync`);
- a skill `revisar-ppc` com sub-agentes (no app, a revisão é a tarefa "Revisar um PPC");
- a skill `ifpr-design`.

## Base, skills e scripts

- `base-conhecimento/`: fonte publicável da base, com caminhos internos preservados como `normas/`, `institucional/`, `catalogos/`, `manifest.json`, `llms.txt` e `README.md`. Os dados institucionais de gestão (campi, cursos, processos seletivos, editais, ofertas e as reuniões do Consepe) ficam em `base-conhecimento/institucional/ifpr/`, um JSON por registro.
- `site/`: saída gerada para publicação estática, ignorada pelo Git e reconstruída a partir de `base-conhecimento/`.
- `.agents/skills/`: skills operacionais para agentes IA, uma pasta versionada por skill e sem symlinks internos.
- `scripts/`: geração, validação e exportação da base e integração com Notion (só `Movimentações de Cursos`), SEI e SUAP, em TypeScript (Node e pnpm). Os PPCs da base já estão convertidos em Markdown; não há, hoje, ferramenta para converter um PPC novo e gravá-lo na base (ver `PLANO-ARQUITETURA.md`, "Decisões em aberto").
- `base-conhecimento/docs/`: documentação de apoio à curadoria da base e ao desenvolvimento das skills.
- `packages/sei-cli/`: CLI que extrai e inspeciona processos do SEI com Playwright, mantido como workspace pnpm (veja o `README.md` do pacote).

## Base de Conhecimento

Use os manifestos em `base-conhecimento/` como ponto de entrada:

- `base-conhecimento/manifest.json`: normas, legislação, resoluções, portarias e notas técnicas.
- `base-conhecimento/institucional_manifest.json`: coleções institucionais do IFPR.
- `base-conhecimento/catalogos_manifest.json`: catálogos publicados, incluindo o CNCT.
- `base-conhecimento/institucional/ifpr/ppcs/index.json`: índice dos PPCs convertidos.

Os campos `path` dos manifestos são relativos a `base-conhecimento/`. Para publicar a base preservando URLs como `normas/...` e `institucional/...`, gere `site/`:

```bash
node scripts/gerar_site.ts
node scripts/gerar_site.ts --check
```

## Skills

As skills deste projeto ficam diretamente no diretório padrão de descoberta do repositório:

```bash
.agents/skills/
```

Skills disponíveis (só a `verificar-fundamentacao-normativa` vai para o app; as demais rodam só no repositório):

- `revisar-ppc/`: revisão prévia IA-first de Projetos Pedagógicos de Curso técnico do IFPR, antes da submissão à PROENS (não substitui a análise oficial da PROENS). No app, a revisão é a tarefa nativa "Revisar um PPC", que reaproveita as fichas desta skill.
- `ifpr-design/`: identidade visual do IFPR para materiais e interfaces.
- `revisar-processo-ppc/`: revisão de processos SEI de PPC.
- `suap-ifpr/`: consulta e navegação no SUAP do IFPR com apoio dos tutoriais oficiais, incluindo dados profissionais de docentes e técnicos administrativos, cursos e disciplinas. Os comandos são TypeScript (Node) na raiz: `scripts/suap_consultar.ts` e `scripts/suap_tutoriais.ts`, testados por `pnpm exec vp test run scripts`.
- `verificar-fundamentacao-normativa/`: conferência de citações e alegações baseadas em leis, resoluções, portarias, CNCT e regulamentos. Tem bloco `simplifica:` e é tarefa do app.

Ao desenvolver uma skill, consulte primeiro os dados locais em `base-conhecimento/` por manifesto. Só empacote cópias de normas, catálogos ou metadados quando houver motivo claro de portabilidade.

## Manutenção

```bash
node scripts/gerar_base.ts --check
node scripts/gerar_indice_ppcs.ts --check
node scripts/validar_base.ts
node scripts/gerar_site.ts --check
node scripts/gerar_tipos_schemas.ts --check
pnpm exec vp test run .agents/skills/revisar-ppc
pnpm fmt && pnpm lint && pnpm typecheck && pnpm test   # todo o código: app, pacotes, scripts e skills
```

Os JSON Schemas de `base-conhecimento/schemas/` são a fonte do formato dos manifestos e índices (institucional, catálogos, CNCT, PPCs); o validador os aplica, e os tipos TypeScript do validador ficam em `scripts/base/tipos-schemas.ts`, gerado a partir deles (depois de alterar um desses schemas, rode `node scripts/gerar_tipos_schemas.ts` e `pnpm typecheck`). Os registros institucionais (campus, curso, processo seletivo, edital, oferta, conselho, reunião e processos SEI) têm o formato no Effect Schema de `scripts/dados/`; os JSON Schemas públicos deles, em `base-conhecimento/schemas/registros/`, são gerados daí pelo `node scripts/gerar_base.ts` e conferidos pelo `gerar_base.ts --check` e pelo `validar_base.ts`.

## SEI e sincronização com o Notion

O `sei-cli` é um workspace pnpm em `packages/sei-cli/`. Um `pnpm install` na raiz instala as dependências de todo o repositório. As credenciais do SEI ficam em `packages/sei-cli/.env.local` e os snapshots em `packages/sei-cli/dados/sei/`, ambos ignorados pelo Git.

```bash
pnpm sei --help              # o CLI, executado dentro de packages/sei-cli
pnpm sei:sync                # simula a atualização das Movimentações de Cursos no Notion
pnpm sei:sync --apply        # grava no Notion
```

Credenciais, escopo, avisos de chegada na DENTEC, agendamento pelo launchd e diagnóstico estão em [`base-conhecimento/docs/sincronizacao-sei-notion.md`](base-conhecimento/docs/sincronizacao-sei-notion.md).

`pnpm typecheck`, `pnpm test` e `pnpm fmt` na raiz cobrem todo o repositório: `apps/`, `packages/` (inclusive o `sei-cli`), `scripts/` e as skills. Os scripts importam tipos e schemas do CLI como `sei-cli/<módulo>`, por exemplo `sei-cli/esquemas`.

Para detalhes de desenvolvimento das skills, veja `base-conhecimento/docs/desenvolvimento-skills.md`.

## Licença

- **Código** (aplicativo, pacotes, scripts e skills): licença MIT, em [`LICENSE`](LICENSE). Partes copiadas do T3 Code mantêm o aviso MIT de origem nos arquivos `NOTICE` e `LICENSE-T3` de cada pasta.
- **Conteúdo curatorial** (`base-conhecimento/`): CC BY 4.0, em [`LICENSE-DADOS`](LICENSE-DADOS). Textos normativos oficiais podem estar sujeitos ao regime próprio de documentos públicos; mantenha atribuição e consulte as fontes oficiais.
