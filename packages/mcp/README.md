# simplifica-mcp

Servidor MCP só de leitura que entrega a base de conhecimento do IFPR a qualquer IA (Claude, Codex, Gemini). Ele lê apenas o `kb.sqlite`, em modo somente leitura: não recompila o banco, não procura o repositório e não acessa a rede. Cada resposta traz o texto literal, a proveniência (`path` e linhas no repositório de origem), o link `ifpr://` e a versão da base.

Especificação: `docs/plans/m0-simplifica-mcp.md` (M0.1). Prontos os passos T0 (banco autossuficiente, no `packages/kb`), T1 (servidor, CLI, banco, envelope, links e texto), T2 (normas) e T3 (PPCs e cursos): 15 das 16 ferramentas. Falta o T4, `pacote_contexto`.

| # | Ferramenta | O que faz |
|---|---|---|
| 1 | `buscar_norma` | busca normas por citação, ID ou termos |
| 2 | `ler_dispositivos` | lê dispositivos pelo ID, com o caput herdado |
| 3 | `ficha_norma` | vigência numa data, relações, sucessoras e transições |
| 4 | `correspondencia` | dispositivo correspondente na norma sucessora (tabela em rascunho) |
| 5 | `resolver_citacoes` | citações em texto livre → ID canônico, regra e confiança |
| 6 | `citacoes_da_norma` | PPCs que citam uma norma ou dispositivo |
| 7 | `impacto_da_norma` | o que uma norma atinge na base |
| 8 | `adequacao_art71` | cursos técnicos alcançados pelo art. 71 da Res. CNE/CP nº 2/2026 |
| 9 | `buscar_secoes` | busca trechos de PPCs |
| 10 | `ler_secao` | lê uma seção de PPC pelo ID |
| 11 | `listar_cursos` | cursos com CNCT, eixo, ofertas e turno |
| 12 | `ficha_curso` | tudo sobre um curso |
| 13 | `fatos_ppc` | fatos do PPC cruzados com o SUAP |
| 14 | `pacote_contexto` | contexto de uma tarefa da `revisar-ppc` (passo T4, ainda não existe) |
| 15 | `sobre_a_base` | versão, data de referência e conteúdo da base |
| 16 | `etapa` | etapa da tarefa, para o app |

## Como rodar

```bash
pnpm install                                         # na raiz do repositório
pnpm kb:compilar                                 # gera tmp/kb.sqlite
node packages/mcp/src/cli.ts --banco tmp/kb.sqlite
```

O servidor fala MCP pelo stdin/stdout; as mensagens de diagnóstico vão para o stderr.

| Opção | Padrão | Uso |
|---|---|---|
| `--banco <caminho>` | variável `SIMPLIFICA_KB` | `kb.sqlite` a servir (obrigatório). `~/` no início é expandido. |
| `--pasta-trabalho <dir>` | diretório atual | única pasta de onde o servidor lê arquivos (para o `pacote_contexto`, no passo T4) |
| `--canal <dev\|beta\|estavel>` | `dev` | canal informado em `base.canal` quando o banco não o registra |

Um banco com `versao_esquema` diferente da esperada (`VERSAO_ESQUEMA` de `packages/kb/src/db/esquema.ts`) é recusado com "base incompatível com esta versão do simplifica-mcp; atualize".

## Configuração no piloto zero

Para rodar a partir do checkout, o comando é `node /caminho/simplifica-if/packages/mcp/src/cli.ts --banco /caminho/kb.sqlite` (Node da versão de `.node-version`). O executável `simplifica-mcp`, um Node SEA que não precisa de Node instalado, sai de `pnpm mcp:executavel` em `packages/mcp/dist-exe/` (`--alvo` ou `--todos` para outras plataformas).

```bash
# Claude Code
claude mcp add ifpr -- simplifica-mcp --banco ~/SimplificaIF/kb.sqlite
```

```json
// Claude Desktop: claude_desktop_config.json
{ "mcpServers": { "ifpr": { "command": "simplifica-mcp", "args": ["--banco", "~/SimplificaIF/kb.sqlite"] } } }
```

```toml
# Codex: ~/.codex/config.toml
[mcp_servers.ifpr]
command = "simplifica-mcp"
args = ["--banco", "~/SimplificaIF/kb.sqlite"]
```

- **Gemini CLI:** a mesma estrutura de `mcpServers`, em `~/.gemini/settings.json`.
- **Caminho:** use caminhos absolutos no comando. O servidor expande `~/` nos próprios argumentos, mas nem todo cliente expande o `~` do nome do programa.

## Estrutura

```
packages/mcp/
├── instrucoes.md       # campo `instructions` do servidor (até 400 palavras), embutido no bundle
├── src/
│   ├── cli.ts          # --banco, --pasta-trabalho, --canal; inicia em stdio
│   ├── servidor.ts     # cria o servidor e registra as ferramentas
│   ├── banco.ts        # abre o kb.sqlite só para leitura e confere versao_esquema
│   ├── envelope.ts     # base, avisos, fonte, paginação com cursor opaco
│   ├── links.ts        # IDs canônicos → ifpr://
│   ├── texto.ts        # Markdown compacto para a IA (avisos, itens, rodapé)
│   ├── orcamento.ts    # paginação pelo limite e pelo teto de caracteres ao mesmo tempo
│   └── ferramentas/    # uma ferramenta por arquivo; index.ts é o registro
│                       # tipos-comuns.ts: NormaResumo e Relacao, os mesmos em todas as ferramentas
└── test/               # bancos de fixture com o DDL do kb; contrato, links, texto, banco, stdio, smoke
```

Regras de negócio ficam em `packages/kb`; aqui só há validação de entrada, envelope e formatação.

## Manutenção

```bash
pnpm --filter @simplifica-if/mcp test
pnpm --filter @simplifica-if/mcp typecheck
pnpm fmt                             # na raiz: vp fmt no repositório inteiro
pnpm mcp:smoke                       # na raiz: as ferramentas × a CLI kb sobre o tmp/kb.sqlite
```

O `mcp:smoke` roda `test/banco-real.test.ts` (normas) e `test/smoke-base-real.test.ts` (PPCs e cursos) com `SIMPLIFICA_SMOKE=1`; sem a variável, os dois ficam de fora do `pnpm test`, que não depende do `tmp/kb.sqlite`. A CLI `kb` que eles chamam compila o banco se ele faltar ou estiver velho.
