# @simplifica-if/motor

Prova de conceito (M1.0) do motor de conversa do app Simplifica IF. O app não é fork do T3 Code: o motor é próprio, fino, sobre as interfaces oficiais e versionadas de cada provider, com a assinatura do servidor.

| Provider | Interface | Login |
|---|---|---|
| Claude | `@anthropic-ai/claude-agent-sdk` 0.3.321 (a mesma do T3) com o `claude` instalado | o do Claude Code (Keychain ou `~/.claude`) |
| ChatGPT | `codex app-server` pelo `@simplifica-if/effect-codex-app-server` (copiado do T3) | o do Codex (`~/.codex`) |
| Gemini | `agy acp` pelo `@simplifica-if/effect-acp` (copiado do T3) | o do Antigravity (`oauth-personal`) |

## Uso

```bash
pnpm motor:poc --detectar                                # instalação, versão, login e plano dos três
pnpm motor:poc --provider claude "<pergunta>"            # padrão: a pergunta do CNCT
pnpm motor:poc --provider codex --aprovacao              # ida e volta de aprovação: nega, depois permite
pnpm motor:poc --provider antigravity --gravar x.jsonl   # grava as mensagens nativas (sanitizadas)
```

Cada sessão do harness roda numa pasta temporária vazia, com o `simplifica-mcp` deste checkout (`node packages/mcp/src/cli.ts --banco tmp/kb.sqlite`) como servidor `ifpr`. Precisa do `tmp/kb.sqlite` (`pnpm kb:compilar`).

```bash
pnpm --filter @simplifica-if/motor test                                   # normalização sobre as gravações, Motor com driver falso
SIMPLIFICA_POC_REAL=1 pnpm --filter @simplifica-if/motor test real        # os três providers de verdade (gasta assinatura)
```

## Estrutura

- `src/Motor.ts`: o serviço `Motor` (`detectar`, `iniciarSessao`, `enviarMensagem`, `responderAprovacao`, `interromper`, `encerrar`). Cada sessão tem um `Scope`; `encerrar` o fecha e o processo do provider morre junto.
- `src/eventos.ts`: os eventos normalizados (Effect Schema): `TextoParcial`, `TextoFinal`, `FerramentaIniciada`, `FerramentaConcluida`, `PedidoAprovacao`, `UsoTokens`, `Erro`, `FimTurno`.
- `src/Driver.ts`: o contrato do driver, `ConfigSessao`, `ServidorMcp`, `EstadoProvider` e os erros.
- `src/Canal.ts`: a fila do turno e os pedidos de aprovação pendentes, comum aos drivers.
- `src/drivers/{claude,codex,antigravity}.ts`: um driver por provider. O normalizador de cada um é uma função pura (`criarNormalizador*`), testada com gravações reais em `test/fixtures/`.
- `scripts/poc.ts`: o harness.

## Como cada provider recebe o MCP

- **Claude:** `mcpServers: { ifpr: { type: "stdio", command, args, alwaysLoad: true } }` no `query()`. Sem `alwaysLoad`, as ferramentas ficam atrás do `ToolSearch` e cada turno gasta duas idas e voltas a mais (21 s contra 15 s na mesma pergunta). `settingSources: []` deixa de fora as configurações, o `CLAUDE.md`, os hooks e os MCP do usuário. As ferramentas de leitura entram em `allowedTools` (`mcp__ifpr`) e não pedem aprovação.
- **Codex:** `config` do `thread/start`, com `mcp_servers.ifpr.{command,args,default_tools_approval_mode: "approve"}`, como o T3 faz com o servidor dele. Nada se grava no `config.toml`. **É preciso isolar a thread:** sem isso, o Codex sobe também os MCP do usuário (9 nesta máquina) e os conectores do ChatGPT, e na primeira tentativa respondeu com a busca web do `codex_apps` em vez da base. O driver lê `config/read` e passa `mcp_servers.<outro>.enabled = false` para cada MCP do usuário, `features.apps = false` e `web_search = "disabled"`. Só o `cua_repl` continua subindo, sem chave conhecida para desligá-lo.
- **Antigravity:** `mcpServers: [{ name: "ifpr", command, args, env: [] }]` no `session/new`. **Funcionou:** o `agy` 1.5.3 aceita o servidor e chama as ferramentas (o T3 passa `[]`). No ACP v1 o `command` tem de ser caminho absoluto.

**Toolkit no mesmo processo (`createSdkMcpServer`):** não é simples. O `tool()` do SDK pede esquema Zod (`AnyZodRawShape`) e o `instance` espera um `McpServer` do `@modelcontextprotocol/sdk`; o nosso Toolkit é `effect/ai` com Effect Schema. Teria de haver uma ponte, que só serviria ao Claude. Para o M1, a recomendação é servir o Toolkit por HTTP local dentro do servidor do app, como o `McpHttpServer.ts` do T3, e passar `{ type: "http", url, headers }` aos três: Claude (`mcpServers`), Codex (`mcp_servers.ifpr.url` e `http_headers`) e Antigravity (`mcpCapabilities.http: true` no `initialize` do `agy`). Isso também evita um processo Node por sessão.

## Detecção

Sem chamar modelo:

- **Claude:** `query()` com um prompt que nunca entrega mensagem; `initializationResult().account` dá `subscriptionType` ("Claude Pro"), `tokenSource` e `apiKeySource`, como no `ClaudeProvider.ts` do T3. Versão por `claude --version`.
- **Codex:** `initialize` (versão no `userAgent`) e `account/read` (`account.type` "chatgpt", `planType`). `requiresOpenaiAuth` sem conta quer dizer sem login.
- **Antigravity:** `initialize` e `authenticate({ methodId: "oauth-personal" })`; o código -32000 quer dizer sem login (`antigravityAuthSupport.ts` do T3).

Os três em cerca de 4 s.

## Armadilhas aprendidas (e tratadas)

- **Ambiente do Claude:** um `claude` iniciado de dentro de uma sessão do Claude Code herda `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID` e outras, e passa a agir como parte dela. O motor tira essas variáveis (lista do `ClaudeHome.ts` do T3) e o `ELECTRON_RUN_AS_NODE`.
- **Modelo do Codex:** o `model` do `config.toml` do usuário pode não valer para a conta (`gpt-6.1-sol` numa conta ChatGPT: "not supported when using Codex with a ChatGPT account"). Sem modelo na sessão, o driver usa o padrão do `model/list`, que é o da conta.
- **Sandbox do Codex:** com `workspace-write` a escrita na pasta nem pede aprovação. O motor usa `read-only` com `on-request`: toda escrita ou comando fora do sandbox vira `PedidoAprovacao`.
- **Turno em andamento:** o turno só acaba no `FimTurno` (ou numa falha), não quando quem lê o stream para. Um segundo envio durante o turno é recusado (`TurnoEmAndamento`).
