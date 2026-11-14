# simplifica-mcp

Servidor MCP só de leitura que entrega a base de conhecimento do IFPR a qualquer IA (Claude, Codex, Gemini). Ele lê apenas o `kb.sqlite`, em modo somente leitura: não recompila o banco, não procura o repositório e não acessa a rede. Cada resposta traz o texto literal, a proveniência (`path` e linhas no repositório de origem), o link `ifpr://` e a versão da base.

Especificação: `docs/plans/m0-simplifica-mcp.md` (M0.1). Passos prontos: T1 (servidor, CLI, banco, envelope, links, texto e as ferramentas `sobre_a_base` e `etapa`) e T2 (ferramentas de normas: `buscar_norma`, `ler_dispositivos`, `ficha_norma`, `correspondencia` e `resolver_citacoes`). O teste `test/banco-real.test.ts` compara as ferramentas com a CLI `kb` sobre o `tmp/kb.sqlite` e é pulado quando o banco não existe.

## Como rodar

```bash
bun install                                         # na raiz do repositório
bun run kb:compilar                                 # gera tmp/kb.sqlite
bun run packages/mcp/src/cli.ts --banco tmp/kb.sqlite
```

O servidor fala MCP pelo stdin/stdout; as mensagens de diagnóstico vão para o stderr.

| Opção | Padrão | Uso |
|---|---|---|
| `--banco <caminho>` | variável `SIMPLIFICA_KB` | `kb.sqlite` a servir (obrigatório). `~/` no início é expandido. |
| `--pasta-trabalho <dir>` | diretório atual | única pasta de onde o servidor lê arquivos (para o `pacote_contexto`, no passo T4) |
| `--canal <dev\|beta\|estavel>` | `dev` | canal informado em `base.canal` quando o banco não o registra |

Um banco com `versao_esquema` diferente da esperada (`VERSAO_ESQUEMA` de `packages/kb/src/db/esquema.ts`) é recusado com "base incompatível com esta versão do simplifica-mcp; atualize".

## Configuração no piloto zero

Até haver binário (M0.2), o comando é `bun run /caminho/simplifica-if/packages/mcp/src/cli.ts --banco /caminho/kb.sqlite`. Depois, o binário `simplifica-mcp`.

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
│   └── ferramentas/    # uma ferramenta por arquivo; index.ts é o registro
└── test/               # banco de fixture com o DDL do kb; contrato, links, texto, banco, stdio
```

Regras de negócio ficam em `packages/kb`; aqui só há validação de entrada, envelope e formatação.

## Manutenção

```bash
bun run --cwd packages/mcp test
bun run --cwd packages/mcp typecheck
bun run --cwd packages/mcp format
```
