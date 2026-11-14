# simplifica-mcp

Servidor MCP só de leitura que entrega a base de conhecimento do IFPR a qualquer IA (Claude, Codex, Gemini). Ele lê apenas o `kb.sqlite`, em modo somente leitura: não recompila o banco, não procura o repositório e não acessa a rede. Cada resposta traz o texto literal, a proveniência (`path` e linhas no repositório de origem), o link `ifpr://` e a versão da base.

Especificação: `docs/plans/m0-simplifica-mcp.md` (M0.1). Prontos os passos T0 (banco autossuficiente, no `packages/kb`), T1 (servidor, CLI, banco, envelope, links e texto), T2 (normas), T3 (PPCs e cursos) e T4 (`pacote_contexto`): as 16 ferramentas.

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
| 14 | `pacote_contexto` | contexto de uma tarefa da `revisar-ppc` para um PPC da base ou um `.md` da pasta de trabalho |
| 15 | `sobre_a_base` | versão, data de referência e conteúdo da base |
| 16 | `etapa` | etapa da tarefa, para o app |

## Como rodar

```bash
pnpm install                                         # na raiz do repositório
pnpm kb compilar                                     # gera tmp/kb.sqlite
node packages/mcp/src/cli.ts --banco tmp/kb.sqlite
```

O servidor fala MCP pelo stdin/stdout; as mensagens de diagnóstico vão para o stderr.

**Pasta de trabalho.** O `pacote_contexto` com `arquivo` é o único ponto em que o servidor lê um arquivo fora do banco (`src/leitura/PastaTrabalho.ts`). O caminho, relativo à pasta ou absoluto dentro dela, é recusado se sair da pasta, antes de tocar no disco (o que pega o `..` e o caminho absoluto de fora); depois de conferir que o arquivo existe, o caminho real (`realPath`, com os links simbólicos seguidos) é conferido de novo, o que pega o symlink para fora. Só `.md`, até 8 MB.

| Opção | Padrão | Uso |
|---|---|---|
| `--banco <caminho>` | variável `SIMPLIFICA_KB` | `kb.sqlite` a servir (obrigatório). `~/` no início é expandido. |
| `--pasta-trabalho <dir>` | diretório atual | única pasta de onde o servidor lê arquivos: o `arquivo` do `pacote_contexto` |
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

O pacote é Effect 4 (`effect/ai`, `effect/rpc`, `effect/cli`), sem o SDK oficial do MCP em produção: o cliente do SDK (`@modelcontextprotocol/client`) fica só nos testes, como conferência independente do protocolo.

```
packages/mcp/
├── instrucoes.md            # campo `instructions` do servidor, embutido em src/instrucoes.gerado.ts
├── src/
│   ├── cli.ts               # effect/cli: --banco (ou SIMPLIFICA_KB), --pasta-trabalho, --canal; stdio
│   ├── servidor.ts          # McpServer.layerStdio, layerLeitura, layerRegistro, mensagens de abertura
│   ├── contratos.ts         # Effect Schema do envelope (Resposta, Aviso, Fonte, Página) e dos tipos comuns; erros
│   ├── esquema.ts           # construtores de schema (texto aparado, inteiro…) e o JSON Schema das ferramentas
│   ├── validacao.ts         # entrada inválida → mensagem em português, no formato do servidor anterior
│   ├── leitura/             # serviço `Leitura`: um método por ferramenta, com envelope, paginação e orçamento;
│   │                        # `PastaTrabalho`, a leitura do `.md` do `pacote_contexto` (o único `FileSystem`)
│   ├── envelope.ts          # base, avisos e cursor opaco
│   ├── orcamento.ts         # paginação pelo limite e pelo teto de caracteres ao mesmo tempo
│   ├── links.ts, texto.ts   # IDs → ifpr://; Markdown compacto para a IA (funções puras)
│   ├── ferramentas/         # um arquivo por ferramenta (Tool.make, descrição, texto)
│   │   ├── toolkit.ts       # FerramentasIfpr (Toolkit) e layerHandlers
│   │   └── registrar.ts     # registrarFerramentas, sobre McpServer.addTool
│   ├── toolkit.ts           # export @simplifica-if/mcp/toolkit
│   └── rpc.ts               # export @simplifica-if/mcp/rpc: GrupoLeitura e layerHandlersRpc
└── test/                    # fixtures com o DDL do kb; contrato, equivalência, RPC, stdio, smoke
```

Regras de negócio ficam em `packages/kb`; aqui ficam a validação de entrada, o envelope, o orçamento e a formatação. As ferramentas MCP e o RPC chamam o mesmo serviço `Leitura`, com os mesmos schemas.

## Uso pelo app (fork do T3)

Três pontos de entrada, sem curinga:

- `@simplifica-if/mcp/toolkit`: `FerramentasIfpr`, `FERRAMENTAS`, `layerHandlers`, `registrarFerramentas`, `layerRegistro`, `layerLeitura` (sem pasta de trabalho: o `pacote_contexto` aceita só `ppc`), `layerLeituraComPasta` (com ela; pede `FileSystem` e `Path`), `Leitura`, `NOME_SERVIDOR`, `VERSAO_PACOTE`, `INSTRUCOES` e `PROTOCOLOS`;
- `@simplifica-if/mcp/rpc`: `GrupoLeitura` (`fichaNorma`, `lerDispositivos`, `buscarNorma`, `fichaCurso`, `lerSecao`, `buscarSecoes`, `listarCursos`, `sobreABase`), `layerHandlersRpc` e `layerLeitura`;
- `@simplifica-if/mcp/contratos`: os schemas do envelope e dos tipos comuns.

```ts
McpServer.layerHttp({
  name: NOME_SERVIDOR, version: VERSAO_PACOTE, instructions: INSTRUCOES, protocols: PROTOCOLOS,
  path: "/mcp/ifpr", registrations: layerRegistro,
}).pipe(Layer.fresh, Layer.provide(layerLeitura({ banco, canal: "estavel" })))
```

O `Layer.fresh` é necessário quando há outro `McpServer` no mesmo grafo de layers (o do T3): sem ele, os dois endpoints compartilham o registro e listam as ferramentas um do outro.

O registro é próprio (`addTool`), e não `McpServer.registerToolkit`, para que o `content` seja o texto Markdown e a entrada inválida volte como resultado `isError` com a mensagem em português, e não como erro `InvalidParams`.

## Manutenção

```bash
pnpm --filter @simplifica-if/mcp test
pnpm --filter @simplifica-if/mcp typecheck
node packages/mcp/test/gabarito.ts --comparar --schemas-equivalentes   # na raiz: o gabarito do C0 pelo protocolo
node packages/mcp/test/gabarito.ts --atualizar pacote_contexto        # regrava só essa parte (ver testes-gabarito/README.md)
pnpm fmt                             # na raiz: vp fmt no repositório inteiro
pnpm mcp:smoke                       # na raiz: as ferramentas × a CLI kb sobre o tmp/kb.sqlite
```

O `mcp:smoke` roda `test/banco-real.test.ts` (normas), `test/smoke-base-real.test.ts` (PPCs e cursos) e `test/smoke-pacote-contexto.test.ts` (o pacote igual, byte a byte, ao de `kb pacote-contexto`) com `SIMPLIFICA_SMOKE=1`; sem a variável, os três ficam de fora do `pnpm test`, que não depende do `tmp/kb.sqlite`. A CLI `kb` que eles chamam compila o banco se ele faltar ou estiver velho.
