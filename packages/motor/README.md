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
pnpm motor:poc --instalar antigravity                    # instalação gerenciada (a do T3) na pasta de estado
pnpm motor:poc --entrar antigravity                      # login no perfil próprio; imprime a URL do Google
```

A pasta de estado do app é `SIMPLIFICA_ESTADO` ou, no macOS, `~/Library/Application Support/simplifica-if-poc`. Ali ficam as instalações gerenciadas (`tools/`) e o perfil do Antigravity (`providers/antigravity/`). Ela fica fora do repositório porque guarda o login do Antigravity.

Cada sessão do harness roda numa pasta temporária vazia, com o `simplifica-mcp` deste checkout como servidor `ifpr`. Precisa do `tmp/kb.sqlite` (`pnpm kb:compilar`). O padrão (`--mcp http`) sobe o servidor MCP HTTP local (`@simplifica-if/mcp/http`) no próprio processo, em `127.0.0.1`, com um token por sessão, e imprime cada chamada de ferramenta que chega. `--mcp stdio` usa `node packages/mcp/src/cli.ts --banco tmp/kb.sqlite`, um processo por sessão.

```bash
pnpm --filter @simplifica-if/motor test                                   # normalização sobre as gravações, Motor com driver falso
SIMPLIFICA_POC_REAL=1 pnpm --filter @simplifica-if/motor test real        # os três providers de verdade (gasta assinatura)
```

## Instalação, perfil e login (partes do T3)

O código do T3 está em `src/t3/`, em inglês e na formatação do upstream, com `NOTICE` e o registro de cada arquivo em `docs/upstream-t3.md`. Os testes vieram junto, em `test/t3/`.

- **Instalação gerenciada** (`CodexInstallation`, `AntigravityInstallation`): baixa a CLI oficial (Codex do GitHub da OpenAI, `agy` do bucket do Google), confere o sha256, instala por staging, registra a versão ativa em `active.json` e verifica atualizações de hora em hora. `Motor.instalar(provider)` devolve o progresso (`EstadoInstalacao`).
  - O Codex usa um `codex` local suportado, se houver no PATH; senão, a cópia gerenciada.
  - O Antigravity usa a cópia gerenciada, como no T3: o `agy` do PATH só entra se for passado como `binarioAntigravity`. Medido: 83 MB, 12 s, versão 1.5.9.
  - O Claude não tem instalação gerenciada, nem no T3: o usuário instala o Claude Code.
- **Perfil próprio do Antigravity** (`antigravityAuthSupport`): o `agy` roda com `--gemini-dir <pasta do app>/providers/antigravity/<hash>`, `GEMINI_HOME` igual, `HOME` real e o ambiente limpo pelo T3 (sem `GEMINI_API_KEY`, `GOOGLE_*`, `GEMINI_HOME` e `BROWSER` do usuário).
  - **Controle positivo:** com um MCP que deixa um arquivo-marca no `~/.gemini/config/mcp_config.json`, o `agy` sem o perfil carregou o MCP (marca criada); com o perfil, não.
  - **Login:** o `agy` 1.5.9 no macOS guarda o login do Google no Keychain, e não no `acp_token.json` do perfil. O login é compartilhado com o `agy` do usuário: o `entrar` concluiu sem abrir o navegador. Sem login, o `entrar` passa por `aguardando` com a `url` do Google, que o app abre.
  - No perfil próprio, o `agy` pede permissão até para MCP; o driver responde `permitir` sozinho para as ferramentas de servidores `preAprovado`.
- **Login dentro do app** (`AntigravityAuth`): `Motor.entrar("antigravity")` devolve o progresso (`EstadoLogin`). O Codex e o Claude continuam com o login das próprias CLIs.
- **Ambiente** (`os-jank.ts`, `ClaudeHome`, `ClaudeExecutable`): `fixPath()` completa o PATH com o do shell de login (um app aberto pelo Finder não acharia `~/.local/bin`). O Claude tem o `claude.cmd` do Windows resolvido e um aviso quando a máquina tem `managed-mcp.json`.

**Não troque o `HOME` ao rodar o `agy`.** O macOS procura o chaveiro em `$HOME/Library/Keychains` e, com um HOME falso, mostra "Chaves não encontradas", oferecendo "Reajustar para padrões", que recria o chaveiro de login. Por isso o teste real do perfil não usa HOME falso; o controle positivo acima foi feito à mão.

## Estrutura

- `src/Motor.ts`: o serviço `Motor` (`detectar`, `iniciarSessao`, `enviarMensagem`, `responderAprovacao`, `interromper`, `encerrar`). Cada sessão tem um `Scope`; `encerrar` o fecha e o processo do provider morre junto.
- `src/eventos.ts`: os eventos normalizados (Effect Schema): `TextoParcial`, `TextoFinal`, `FerramentaIniciada`, `FerramentaConcluida`, `PedidoAprovacao`, `UsoTokens`, `Erro`, `FimTurno`.
- `src/Driver.ts`: o contrato do driver, `ConfigSessao`, `ServidorMcp`, `EstadoProvider` e os erros.
- `src/Canal.ts`: a fila do turno e os pedidos de aprovação pendentes, comum aos drivers.
- `src/resultados.ts`: completa o resumo das ferramentas MCP com os `resultados` do servidor HTTP do app.
- `src/drivers/{claude,codex,antigravity}.ts`: um driver por provider. O normalizador de cada um é uma função pura (`criarNormalizador*`), testada com gravações reais em `test/fixtures/`.
- `scripts/poc.ts`: o harness.

## Como cada provider recebe o MCP

`ServidorMcp` é `{ tipo: "http", url, cabecalhos }` (o servidor HTTP local do app, M1.4) ou `{ tipo: "stdio", comando, argumentos }`. Teste real com os três em 14/11/2026, por HTTP:

- **Claude:** `mcpServers.ifpr = { type: "http", url, headers, alwaysLoad: true }` no `query()`; em stdio, `{ type: "stdio", command, args, alwaysLoad: true }`. Sem `alwaysLoad`, as ferramentas ficam atrás do `ToolSearch` e cada turno gasta duas idas e voltas a mais (21 s contra 15 s na mesma pergunta). `settingSources: []` deixa de fora as configurações, o `CLAUDE.md`, os hooks e os MCP do usuário. As ferramentas de leitura entram em `allowedTools` (`mcp__ifpr`).
- **Codex:** `config` do `thread/start`, com `mcp_servers.ifpr.{url, http_headers, default_tools_approval_mode: "approve"}` (ou `command` e `args`), como o T3 faz com o servidor dele. Nada se grava no `config.toml`. **É preciso isolar a thread:** sem isso, o Codex sobe também os MCP do usuário e os conectores do ChatGPT. O driver desliga cada MCP do usuário (`enabled = false`, pelo `config/read`), `features.apps`, `features.plugins` e `web_search`.
  - **`cua_repl`:** vem do plugin `unified-computer-use@openai-bundled` (o `.mcp.json` do plugin, em `~/.codex/plugins/cache/openai-bundled/unified-computer-use/`), que o app ChatGPT instala e liga no `config.toml`. Não é `features.computer_use` nem `features.browser_use`: com os dois `false` na thread, ele subiu igual. Medido em 14/11/2026 (codex-cli 0.169.0), só com `thread/start` e as notificações `mcpServer/startupStatus/updated`, sem turno: com o isolamento anterior, `cua_repl` `starting` → `ready`; com `plugins.unified-computer-use@openai-bundled.enabled = false`, nada; com `features.plugins = false`, nada, e o `ifpr` da sessão sobe normalmente. O driver usa `features.plugins = false`, que desliga também os outros plugins (os remotos não aparecem no `config.toml`) com as skills e os hooks deles; o `Stop` do `unified-computer-use` chamaria `cua_repl.turn_ended` a cada turno.
- **Antigravity:** HTTP no `session/new` (`{ type: "http", name, url, headers }`) quando o `initialize` anuncia `mcpCapabilities.http`. O `agy` 1.5.9 **não anuncia**: aí, como o T3, o MCP vai como stdio pela ponte `AcpMcpStdioBridge` do T3 (`scripts/ponte-mcp.ts`), que repassa ao servidor HTTP; a URL e o `Authorization` vão no `env` do servidor (`T3_ACP_MCP_ENDPOINT`, `T3_ACP_MCP_AUTHORIZATION`), nunca na linha de comando. Sem ponte configurada (`ponteMcp` no `layerNode`), a sessão falha com mensagem clara. No ACP v1 o `command` do stdio tem de ser caminho absoluto. Com o perfil próprio, nada do `~/.gemini` do usuário entra na sessão.

**Resultado das ferramentas pelo servidor do app (`src/resultados.ts`):** o `agy` 1.5.x não manda o resultado pelo ACP (o `tool_call_update` com `completed` vem sem `rawOutput` e sem `content`), e o `FerramentaConcluida` do Antigravity sai com `resumo` vazio. O `ServidorMcpHttp` da sessão pode trazer `resultados`, um `Stream` das chamadas que o servidor viu (`{ ferramenta, resumo, falhou }`); o harness o liga ao `chamadas` de `@simplifica-if/mcp/http`, filtrado pelo rótulo da sessão, cujo `resumo` são os primeiros 300 caracteres do texto do resultado. O `Motor` passa os eventos do turno por um completador: cada `FerramentaConcluida` de `<servidor>.<ferramenta>` consome a próxima chamada daquela ferramenta (ordem e nome, dentro da sessão) e, se veio com resumo vazio, fica com o dela. Espera até 1 s pela chamada; as sobras de um turno se descartam no início do seguinte. Os normalizadores não mudam, e o motor não depende do pacote MCP.

**Toolkit no mesmo processo (`createSdkMcpServer`):** não é simples. O `tool()` do SDK pede esquema Zod (`AnyZodRawShape`) e o `instance` espera um `McpServer` do `@modelcontextprotocol/sdk`; o nosso Toolkit é `effect/ai` com Effect Schema. Teria de haver uma ponte, que só serviria ao Claude. Para o M1, a recomendação é servir o Toolkit por HTTP local dentro do servidor do app, como o `McpHttpServer.ts` do T3, e passar `{ type: "http", url, headers }` aos três: Claude (`mcpServers`), Codex (`mcp_servers.ifpr.url` e `http_headers`) e Antigravity (`mcpCapabilities.http: true` no `initialize` do `agy`). Isso também evita um processo Node por sessão.

## Detecção

Sem chamar modelo:

- **Claude:** `query()` com um prompt que nunca entrega mensagem; `initializationResult().account` dá `subscriptionType` ("Claude Pro"), `tokenSource` e `apiKeySource`, como no `ClaudeProvider.ts` do T3. Versão por `claude --version`.
- **Codex:** `initialize` (versão no `userAgent`) e `account/read` (`account.type` "chatgpt", `planType`). `requiresOpenaiAuth` sem conta quer dizer sem login.
- **Antigravity:** a instalação resolve o executável (sem processo); o login é o `acp_token.json` do perfil ou, sem ele, `initialize` e `authenticate` no perfil próprio. O código -32000, ou a URL de login no stdout, quer dizer sem login.

Os três em cerca de 4 s.

## Armadilhas aprendidas (e tratadas)

- **Ambiente do Claude:** um `claude` iniciado de dentro de uma sessão do Claude Code herda `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID` e outras, e passa a agir como parte dela. O motor tira essas variáveis (lista do `ClaudeHome.ts` do T3) e o `ELECTRON_RUN_AS_NODE`.
- **Modelo do Codex:** o `model` do `config.toml` do usuário pode não valer para a conta (`gpt-6.1-sol` numa conta ChatGPT: "not supported when using Codex with a ChatGPT account"). Sem modelo na sessão, o driver usa o padrão do `model/list`, que é o da conta.
- **Sandbox do Codex:** com `workspace-write` a escrita na pasta nem pede aprovação. O motor usa `read-only` com `on-request`: toda escrita ou comando fora do sandbox vira `PedidoAprovacao`.
- **Turno em andamento:** o turno só acaba no `FimTurno` (ou numa falha), não quando quem lê o stream para. Um segundo envio durante o turno é recusado (`TurnoEmAndamento`).
