# Simplifica IF

App desktop para os servidores do IFPR. O Simplifica IF dá à IA da assinatura de cada pessoa (Claude, ChatGPT ou Gemini) a base de conhecimento do Instituto e tarefas prontas sobre ela. Este repositório contém o app, a base que o alimenta e as skills e scripts que agentes usam para curar a base.

## O app

O que ele entrega hoje:

- conversa com a IA da pessoa, que consulta a base pelas 16 ferramentas do servidor MCP `ifpr` (`packages/mcp`) e é instruída a citar cada fonte com um link `ifpr://`;
- tarefas no Início: "Revisar um PPC" (`.docx`: pré-conferência em código, relatório com IA opcional e cópia com comentários do Word) e as skills com bloco `simplifica:` (hoje, `verificar-fundamentacao-normativa`);
- leitor `ifpr://` e Explorar, para navegar por normas, PPCs, cursos, campi, CNCT, Consepe e fichas sem IA;
- pasta de trabalho com "Desfazer", primeiro uso com perfil, relato de erro e atualização da base e das skills.

O app foi desenhado para dado público: a base e os arquivos que a pessoa escolhe anexar (ele não confere os anexos, que vão para a IA da pessoa). Sistemas com login, como SUAP e SEI, ficam fora dele (veja [Fora do app](#fora-do-app)). Os planos estão em [`docs/plans/`](docs/plans/README.md).

```bash
pnpm install
pnpm kb:compilar   # tmp/kb.sqlite, a base que o servidor lê
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

Estas ferramentas rodam só no repositório, por agentes ou por quem cura a base:

- a skill `ifpr-design`.

As ferramentas com login em sistemas internos (SEI, SUAP) ficam num repositório privado à parte. Elas leem a base pelo `simplifica-mcp` e entregam dado coletado por relatório, aplicado aqui por um comando `aplicar_*` (veja "Dado coletado fora do repositório" em [`base-conhecimento/docs/curadoria-metadados-institucionais.md`](base-conhecimento/docs/curadoria-metadados-institucionais.md)). A integração de sistemas com login ao app está nos planos (decisão 6 de [`docs/plans/app-simplifica-if.md`](docs/plans/app-simplifica-if.md)).

## Base, skills e scripts

- `base-conhecimento/`: fonte publicável da base, com `normas/`, `institucional/`, `catalogos/`, `revisao-ppc/` (as fichas da tarefa "Revisar um PPC"), `manifest.json` e `README.md`. Os dados institucionais de gestão (campi, cursos, processos seletivos, editais, ofertas e as reuniões do Consepe) ficam em `base-conhecimento/institucional/ifpr/`, um JSON por registro.
- `.agents/skills/`: skills operacionais para agentes IA, uma pasta versionada por skill e sem symlinks internos.
- `scripts/`: geração e validação da base, aplicação de dado coletado fora do repositório (`aplicar_matrizes_suap.ts`), fábrica da atualização e avaliação, em TypeScript (Node e pnpm). Um PPC novo, ou a versão nova do PPC de um curso, entra na base a partir do DOCX da coordenação, com `node scripts/importar_ppc_docx.ts` (passo a passo em `base-conhecimento/docs/curadoria-metadados-institucionais.md`); PDF não é convertido.
- `base-conhecimento/docs/`: documentação de apoio à curadoria da base e ao desenvolvimento das skills.

## Base de Conhecimento

A base é lida pelo app, pelo `simplifica-mcp` e, no repositório, pela CLI `kb` (`pnpm kb`), todos sobre o `kb.sqlite` compilado de `base-conhecimento/`. Os comandos e o procedimento de consulta estão em "Consulta local da base", no [`AGENTS.md`](AGENTS.md#consulta-local-da-base); a resposta aponta o Markdown da norma ou do PPC, que é o que se abre e se cita.

## Skills

As skills deste projeto ficam diretamente no diretório padrão de descoberta do repositório:

```bash
.agents/skills/
```

Skills disponíveis (só a `verificar-fundamentacao-normativa` vai para o app; as demais rodam só no repositório):

- `ifpr-design/`: identidade visual do IFPR para materiais e interfaces.
- `verificar-fundamentacao-normativa/`: conferência de citações e alegações baseadas em leis, resoluções, portarias, CNCT e regulamentos. Tem bloco `simplifica:` e é tarefa do app.

Ao desenvolver uma skill, consulte os dados da base pela CLI `kb` ou pelas ferramentas `ifpr` do MCP. Só empacote cópias de normas, catálogos ou metadados quando houver motivo claro de portabilidade.

## Manutenção

```bash
node scripts/gerar_base.ts --check
node scripts/gerar_indice_ppcs.ts --check
node scripts/validar_base.ts
node scripts/gerar_tipos_schemas.ts --check
pnpm fmt && pnpm lint && pnpm typecheck && pnpm test   # todo o código: app, pacotes e scripts
```

Os JSON Schemas de `base-conhecimento/schemas/` são a fonte do formato dos manifestos e índices (CNCT e PPCs); o validador os aplica, e os tipos TypeScript do validador ficam em `scripts/base/tipos-schemas.ts`, gerado a partir deles (depois de alterar um desses schemas, rode `node scripts/gerar_tipos_schemas.ts` e `pnpm typecheck`). Os registros institucionais (campus, curso, processo seletivo, edital, oferta, conselho e reunião) têm o formato no Effect Schema de `scripts/dados/`, que o `validar_base.ts` aplica.

## Desenvolvimento

`pnpm typecheck`, `pnpm test` e `pnpm fmt` na raiz cobrem todo o repositório: `apps/`, `packages/`, `scripts/` e as skills.

Para detalhes de desenvolvimento das skills, veja `base-conhecimento/docs/desenvolvimento-skills.md`.

## Licença

- **Código** (aplicativo, pacotes, scripts e skills): licença MIT, em [`LICENSE`](LICENSE). Partes copiadas do T3 Code mantêm o aviso MIT de origem nos arquivos `NOTICE` e `LICENSE-T3` de cada pasta.
- **Conteúdo curatorial** (`base-conhecimento/`): CC BY 4.0, em [`LICENSE-DADOS`](LICENSE-DADOS). Textos normativos oficiais podem estar sujeitos ao regime próprio de documentos públicos; mantenha atribuição e consulte as fontes oficiais.
