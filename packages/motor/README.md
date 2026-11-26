# @simplifica-if/motor

Motor de conversa do app Simplifica IF: começou como prova de conceito (M1.0) e virou o motor de produção do M1.2, dentro do `apps/server`. O app não é fork do T3 Code: o motor é próprio, fino, sobre as interfaces oficiais e versionadas de cada provider, com a assinatura do servidor.

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
SIMPLIFICA_POC_REAL=1 pnpm --filter @simplifica-if/motor test real -t "codex|ntigravity"   # só os testes de Codex e Antigravity
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
- **Login dentro do app:** `Motor.entrar(provider)` devolve o progresso (`EstadoLogin`).
  - **Antigravity** (`AntigravityAuth`), como acima.
  - **Codex** (M1.8): o próprio `codex app-server` faz o login da conta do ChatGPT, como o app do Codex: `account/login/start` com `type: "chatgpt"` abre um servidor de retorno local e devolve a `authUrl` (`aguardando`), e `account/login/completed` diz se deu certo. O login vai para o `~/.codex` do usuário, o mesmo do Codex do terminal. Só uma `authUrl` em `https://auth.openai.com` vai à interface (`authUrlOficialCodex`); a falha vira "O login não foi concluído…", com o texto da CLI, curto e saneado (`textoTecnico`), em `detalhe` (`fimLoginCodex`). Fechar o stream fecha o app-server e cancela o login; sem resposta em 10 minutos, falha por tempo. Conferido em 16/11/2026 com o `codex-cli` 0.169.0, só até a URL (`auth.openai.com`) e com `account/login/cancel`: o `auth.json` não mudou.
  - **Claude:** sem login no app (nem no T3). A pessoa instala o Claude Code pelo instalador oficial e entra com `claude` no Terminal; o passo guiado das boas-vindas explica e confere. O driver só aceita um `claude` cujo `--version` responde como o Claude Code (`versaoClaudeValida`: `2.1.325 (Claude Code)`) e procura de novo a cada `detectar` e `iniciar` enquanto não o acha ou quando o guardado deixa de existir, também em `~/.local/bin` (a pasta do instalador oficial): quem acabou de instalar tem o PATH novo só nos terminais novos, e o servidor leu o PATH ao abrir.
- **Ambiente** (`os-jank.ts`, `ClaudeHome`, `ClaudeExecutable`): `fixPath()` completa o PATH com o do shell de login (um app aberto pelo Finder não acharia `~/.local/bin`). O Claude tem o `claude.cmd` do Windows resolvido e um aviso quando a máquina tem `managed-mcp.json`.

**Não troque o `HOME` ao rodar o `agy`.** O macOS procura o chaveiro em `$HOME/Library/Keychains` e, com um HOME falso, mostra "Chaves não encontradas", oferecendo "Reajustar para padrões", que recria o chaveiro de login. Por isso o teste real do perfil não usa HOME falso; o controle positivo acima foi feito à mão.

## Estrutura

- `src/Motor.ts`: o serviço `Motor` (`detectar`, `iniciarSessao`, `enviarMensagem`, `responderAprovacao`, `interromper`, `encerrar`). Cada sessão tem um `Scope`; `encerrar` o fecha e o processo do provider morre junto.
- `src/eventos.ts`: os eventos normalizados (Effect Schema): `TextoParcial`, `TextoFinal`, `FerramentaIniciada`, `FerramentaConcluida`, `PedidoAprovacao`, `UsoTokens`, `Erro`, `FimTurno`. O driver classifica cada ferramenta: `FerramentaIniciada` e `PedidoAprovacao` levam o `TipoFerramenta` (o mesmo da política) e, numa ferramenta `web`, o alvo (`web`: a URL lida ou a consulta pesquisada), para a interface não conhecer os nomes nativos nem as chaves de entrada de cada provider. O `motivo` do `FimTurno` é um conjunto fechado (`MotivoFim`: `concluido`, `interrompido`, `falha` e, do servidor, `parado_antes_do_envio`), que cada driver mapeia do nativo.
- `src/erros.ts` (`@simplifica-if/motor/erros`): os erros (`FalhaProvider`, `OperacaoNaoSuportada`, `SessaoDesconhecida`…) e a `Decisao`, só schemas, para os contratos do app e a interface; `Driver.ts` os reexporta.
- `src/falhas.ts` (`@simplifica-if/motor/falhas`): o classificador único das falhas dos providers. `classificarFalha` dá o `tipo` da `FalhaProvider` (pelo `falhaDe` do `Canal`) e do evento `Erro` (`erroDoTurno`), no ponto em que o driver produz a falha; `classificarFalhaEstado`, o `tipoFalha` das mensagens de instalação e de login do código do T3. A interface e a revisão com IA leem o tipo, nunca o texto. `textoTecnico` dá o texto de "Detalhes técnicos", curto e saneado; o servidor o calcula do `cause` só no transporte. Os casos ficam em `test/falhas.test.ts`.
- `src/Driver.ts`: o contrato do driver, `ConfigSessao`, `ServidorMcp`, `DeteccaoProvider` (o que o driver detecta) e `EstadoProvider` (a detecção mais `podeInstalar` e `podeEntrar`, que o `Motor.detectar` deriva de o driver ter `instalar` e `entrar`).
- `src/Canal.ts`: a fila do turno, os pedidos de aprovação pendentes e a política aplicada a eles, comum aos drivers.
- `src/politica.ts`: a política de fábrica e a avaliação por tipo de ferramenta e lugar.
- `src/skills.ts`: os arquivos e as instruções das skills do app.
- `src/resultados.ts`: completa o resumo das ferramentas MCP com os `resultados` do servidor HTTP do app.
- `src/drivers/{claude,codex,antigravity}.ts`: um driver por provider. O normalizador de cada um é uma função pura (`criarNormalizador*`), testada com gravações reais em `test/fixtures/`.
- `scripts/poc.ts`: o harness.

## Como cada provider recebe o MCP

`ServidorMcp` é `{ tipo: "http", url, cabecalhos }` (o servidor HTTP local do app, M1.4) ou `{ tipo: "stdio", comando, argumentos }`. Teste real com os três em 14/11/2026, por HTTP:

- **Claude:** `mcpServers.ifpr = { type: "http", url, headers, alwaysLoad: true }` no `query()`; em stdio, `{ type: "stdio", command, args, alwaysLoad: true }`. Sem `alwaysLoad`, as ferramentas ficam atrás do `ToolSearch` e cada turno gasta duas idas e voltas a mais (21 s contra 15 s na mesma pergunta). `settingSources: []` deixa de fora as configurações, o `CLAUDE.md`, os hooks e os MCP do usuário. As ferramentas de leitura entram em `allowedTools` (`mcp__ifpr`).
- **Codex:** `config` do `thread/start`, com `mcp_servers.ifpr.{url, http_headers, default_tools_approval_mode: "approve"}` (ou `command` e `args`), como o T3 faz com o servidor dele. Nada se grava no `config.toml`. **É preciso isolar a thread:** sem isso, o Codex sobe também os MCP do usuário e os conectores do ChatGPT. O driver desliga cada MCP do usuário (`enabled = false`, pelo `config/read`), `features.apps` e `features.plugins`. A busca web nativa usa os servidores da OpenAI (`web_search: "live"`, respeitando `allowedWebSearchModes` de `configRequirements/read`, com fallback para `"cached"` ou `"disabled"`), e fica `"disabled"` nas sessões `semFerramentas`. Comandos de terminal que pedem rede (`networkApprovalContext`) são classificados como `comando-rede` e negados sempre.
  - **`cua_repl`:** vem do plugin `unified-computer-use@openai-bundled` (o `.mcp.json` do plugin, em `~/.codex/plugins/cache/openai-bundled/unified-computer-use/`), que o app ChatGPT instala e liga no `config.toml`. Não é `features.computer_use` nem `features.browser_use`: com os dois `false` na thread, ele subiu igual. Medido em 14/11/2026 (codex-cli 0.169.0), só com `thread/start` e as notificações `mcpServer/startupStatus/updated`, sem turno: com o isolamento anterior, `cua_repl` `starting` → `ready`; com `plugins.unified-computer-use@openai-bundled.enabled = false`, nada; com `features.plugins = false`, nada, e o `ifpr` da sessão sobe normalmente. O driver usa `features.plugins = false`, que desliga também os outros plugins (os remotos não aparecem no `config.toml`) com as skills e os hooks deles; o `Stop` do `unified-computer-use` chamaria `cua_repl.turn_ended` a cada turno.
- **Modelo e raciocínio do Antigravity** (`src/acp/opcoes-sessao.ts`, 19/11/2026, `agy` 1.5.9 e 1.5.12): o `session/new` devolve `configOptions` com a opção `model` e a `thought_level`; `session/set_config_option` troca as duas. Os níveis mudam com o modelo, e ao trocar de modelo o nível corrente continua se o modelo novo o aceita. A escolha vale por sessão e volta no `session/load`. A detecção abre uma sessão descartável para listar os modelos (apagada do perfil no fim). `pnpm motor:poc --provider antigravity --modelo gemini-3.8-flash --esforco low "…"` exercita o caminho.
- **Antigravity:** HTTP no `session/new` (`{ type: "http", name, url, headers }`) quando o `initialize` anuncia `mcpCapabilities.http`. O `agy` 1.5.9 **não anuncia**: aí, como o T3, o MCP vai como stdio pela ponte `AcpMcpStdioBridge` do T3 (`scripts/ponte-mcp.ts`), que repassa ao servidor HTTP, inclusive as requisições da revisão `2026-07-28` com os cabeçalhos dela; a URL e o `Authorization` vão no `env` do servidor (`T3_ACP_MCP_ENDPOINT`, `T3_ACP_MCP_AUTHORIZATION`), nunca na linha de comando. Sem ponte configurada (`ponteMcp` no `layerNode`), a sessão falha com mensagem clara. No ACP v1 o `command` do stdio tem de ser caminho absoluto. Com o perfil próprio, nada do `~/.gemini` do usuário entra na sessão.

**Resultado das ferramentas pelo servidor do app (`src/resultados.ts`):** o `agy` 1.5.x não manda o resultado pelo ACP (o `tool_call_update` com `completed` vem sem `rawOutput` e sem `content`), e o `FerramentaConcluida` do Antigravity sai com `resumo` vazio. O `ServidorMcpHttp` da sessão pode trazer `resultados`, um `Stream` das chamadas que o servidor viu (`{ ferramenta, resumo, falhou }`); o harness o liga ao `chamadas` de `@simplifica-if/mcp/http`, filtrado pelo rótulo da sessão, cujo `resumo` são os primeiros 300 caracteres do texto do resultado. O `Motor` passa os eventos do turno por um completador: cada `FerramentaConcluida` de `<servidor>.<ferramenta>` consome a próxima chamada daquela ferramenta (ordem e nome, dentro da sessão) e, se veio com resumo vazio, fica com o dela. O `read_resource` do Antigravity (sem prefixo de servidor; entrada `{ ServerName, Uri }`) consome a próxima leitura de recurso daquele URI no servidor `ServerName`: o servidor do app a registra com o URI em `ferramenta` (`tipo: "recurso"`). Espera até 1 s pela chamada; as sobras de um turno se descartam no início do seguinte. Os normalizadores não mudam, e o motor não depende do pacote MCP.

**Toolkit no mesmo processo (`createSdkMcpServer`):** não é simples. O `tool()` do SDK pede esquema Zod (`AnyZodRawShape`) e o `instance` espera um `McpServer` do `@modelcontextprotocol/sdk`; o nosso Toolkit é `effect/ai` com Effect Schema. Teria de haver uma ponte, que só serviria ao Claude. Para o M1, a recomendação é servir o Toolkit por HTTP local dentro do servidor do app, como o `McpHttpServer.ts` do T3, e passar `{ type: "http", url, headers }` aos três: Claude (`mcpServers`), Codex (`mcp_servers.ifpr.url` e `http_headers`) e Antigravity (`mcpCapabilities.http: true` no `initialize` do `agy`). Isso também evita um processo Node por sessão.

## Política de fábrica (M1.7, versão mínima)

`src/politica.ts`: um Effect Schema embutido e congelado (`POLITICA_FABRICA`), só de leitura. Cada driver classifica o pedido de aprovação nativo num tipo de ferramenta, com os caminhos que ele toca (`classificarClaude`, `classificarComandoCodex`, `classificarAcp`), e o `Canal.comPolitica` decide: `permitir` e `negar` se respondem no motor, sem evento; `perguntar` vira `PedidoAprovacao`.

| Tipo | Dentro da pasta de trabalho | Fora dela |
|---|---|---|
| leitura (ler, listar, buscar) | permitir | negar |
| escrita (criar, alterar, apagar, mover) | perguntar | negar |
| comando | perguntar | negar |
| comando com rede (`networkApprovalContext`) | negar | negar |
| MCP do app (`preAprovado`, o `ifpr`) | permitir | — |
| web (`WebSearch`/`WebFetch`, `search_web`/`read_url_content`, com filtro de URL pública) | permitir | — |
| outro MCP | negar | — |
| outra (subagente, plano…) | perguntar | — |

**Sessão sem web** (`ConfigSessao.semWeb`, a tarefa com `abre.conversa.web: false`): o `Motor` abre a sessão com `politicaSemWeb(política do app)`, que só troca `isolamento.buscaWeb` para `desligada` e `ferramentas.web` para `negar`. Os drivers já seguem a política recebida (`buscaWebLigada`): `disallowedTools` no Claude, `web_search: "disabled"` no Codex, `disabledTools` no Antigravity, e as instruções de web não entram. Só restringe: sem o campo, ou com `false`, vale a política do app. No Codex, a retomada de uma thread manda sempre o `developerInstructions` (`instrucoesThreadCodex`): sem instruções na sessão, a string vazia, para as de quando a thread nasceu (a lista de skills, a orientação de web) não ficarem valendo.

**Sessão de julgamento** (`ConfigSessao.semFerramentas`, a revisão de PPC com IA do M1.11): o `Motor` aplica a `POLITICA_JULGAMENTO` (toda ferramenta negada sem perguntar, dentro ou fora da pasta, inclusive busca web) em vez da política do app e recusa MCP ou skills na mesma sessão. O driver do Claude passa `tools: []`, `permissionMode: "dontAsk"` e as instruções do app como prompt de sistema inteiro (sem o do Claude Code): no teste real, a entrada fora do cache foi de 2 tokens por bloco. No Codex, a política sozinha não basta: com sandbox `read-only` e `on-request`, comandos de leitura rodam sem pedir aprovação. Por isso a thread de julgamento desliga as ferramentas no `config` (`SEM_FERRAMENTAS_CODEX`: `features.shell_tool`, `features.unified_exec`, `features.view_image`, `features.multi_agent`, `include_apply_patch_tool`, `web_search`; chaves de `codex features list` no codex-cli 0.169.0; aceitas por um `thread/start` sem turno) e é `ephemeral`. No Antigravity, `FERRAMENTAS_ANTIGRAVITY` (as do binário do `agy` 1.5.9 e das gravações) vai para `_meta.antigravity.disabledTools`, e os arquivos da sessão no perfil (`arquivosDaSessaoAntigravity`) se apagam no fim. No Claude, além de `tools: []`, `persistSession: false` e `DISABLE_PROMPT_CACHING=1` (um turno por sessão: o cache não teria retorno). Em 16/11/2026, uma chamada real curta em cada provider não mostrou nenhuma ferramenta.

Também: providers permitidos (`claude`, `codex`, `antigravity`), Codex em `read-only` com `on-request`, busca e leitura web ligadas por padrão em conversas (com `browser` e `browser_subagent` sempre em `disabledTools` no Antigravity e filtro léxico de URL pública com fail-closed em `avaliar` para Claude; no `agy` 1.5.14, conferido em 21/11/2026, só `search_web` é exposta no ACP e roda direto sem `session/request_permission`, enquanto `read_url_content` não está disponível e continua coberta no `classificarAcp`), configuração do usuário desligada, telemetria desligada nos três (variáveis do Claude, `-c` do `codex app-server`, `--disable-telemetry` do `agy`, sem `OTEL_*`). No macOS, `/tmp` e `/private/tmp` contam como a mesma pasta. O arquivo de política da máquina, gerido pela DTI, fica para depois (decisão em aberto 9).

## Retomada, queda e interromper (M1.2)

- **Retomada:** `ConfigSessao.retomar` com o `idNativo` de uma sessão anterior (`Motor.infoSessao`). Claude: `resume` (a sessão nova recebe um `sessionId` escolhido pelo driver, e o SDK grava a transcrição em `~/.claude/projects/`). Codex: `thread/resume`, com os mesmos parâmetros da thread nova; por isso a thread não é `ephemeral` e aparece no histórico do Codex do usuário. Antigravity: `session/load` quando o `initialize` anuncia `loadSession` (senão `session/resume`), com o mesmo `_meta`; o histórico que o `session/load` repete fica fora dos eventos. O `agy` 1.5.9 anuncia os dois (`loadSession: true` e `sessionCapabilities.resume`, conferido em 16/11/2026); no `ciclo-real` do servidor, as duas retomadas do Antigravity foram por ele.
- **Queda:** quando o processo do provider acaba sozinho, `SessaoDriver.queda` termina antes de o turno corrente falhar com o mesmo erro (`Canal.morrer`), e a sessão recusa os próximos turnos. O `apps/server` usa isso para fechar a conversa como `caiu`. A mensagem é do motor, em português ("o processo do codex encerrou", "o processo do agy encerrou"), e não a do transporte.
- **Interromper:** o Claude interrompido termina com `error_during_execution`; o driver o troca por `FimTurno` com motivo `interrompido`.

## Skills do app, texto parcial e contexto (M1.2)

- **Skills** (`src/skills.ts`): o `apps/server` passa à sessão skills do catálogo dele (`CatalogoSkills`, as de bloco `simplifica:` válido): todas na conversa livre, só a da tarefa na conversa aberta por um cartão. `ConfigSessao.skills` grava cada skill em `<pasta>/.simplifica/skills/<nome>/SKILL.md`, com os arquivos ao lado, e soma às instruções da sessão a lista das skills (system prompt do Claude, `developerInstructions` do Codex, `systemPrompt.append` do `_meta.antigravity`). O teste real (`test/real.test.ts`, um por provider) confere que a skill de exemplo lê um arquivo dela e responde sem pedido de aprovação; passou no Codex e no Antigravity em 16/11/2026. O `skills-real` do servidor faz o mesmo com a `verificar-fundamentacao-normativa` do catálogo, verde nos três.
- **Texto parcial do Claude:** cada `text_delta` dos `stream_event` vira `TextoParcial`, e o bloco completo, `TextoFinal`, sem duplicar; os `stream_event` de subagente ficam de fora. Medido na pergunta de referência (`test/fixtures/claude-parcial.jsonl`): o texto vem depois das ferramentas, e o primeiro pedaço chega a cerca de 14 s, junto com o resto, porque o modelo redige a resposta no raciocínio oculto. O streaming funciona; a espera é do modelo.
- **Contexto do Codex:** além do isolamento, `CONTEXTO_CODEX` desliga na thread as ferramentas e instruções que a política não usa (`features.goals`, `image_generation`, `sleep_tool`, `tool_suggest`, `skill_search`, `include_*_instructions`), e o isolamento tira as skills, os hooks e o `AGENTS.md` do usuário. Um turno sem ferramenta tinha 14 mil tokens de entrada só com o isolamento do M1.4 e caiu abaixo de 12 mil sem busca web; com `web_search: "live"` e `INSTRUCOES_WEB` (medido em 21/11/2026, `codex-cli` 0.171.0: **12.935 tokens**), o teste real confere que fica abaixo de 14 mil. Na pergunta de referência (`pnpm motor:poc --provider codex`), 16/11/2026: **136,6 mil tokens de entrada**, 98,4 mil em cache, 317 de saída, 11 s, com `listar_cursos` e `ficha_curso`; na PoC eram 267 mil. O `UsoTokens` do Codex é o total do turno (a diferença do `total` da thread entre o fim de um turno e o do seguinte): soma a entrada de cada requisição ao modelo e cresce com o número de ferramentas.

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
- **Segundo turno do Claude sem ferramentas (16/11/2026):** na revisão de PPC, o segundo turno de uma sessão `semFerramentas` carregou um bloco fixo de 157.896 tokens (lido ou gravado no cache), em três sessões diferentes; o primeiro turno, não. A origem não foi isolada; o julgamento passou a abrir uma sessão por tentativa. E o `custoUsd` do Claude é o `total_cost_usd` do Agent SDK, **acumulado na sessão**: some entre sessões, nunca entre turnos.
- **Turno em andamento:** o turno só acaba no `FimTurno` (ou numa falha), não quando quem lê o stream para. Um segundo envio durante o turno é recusado (`TurnoEmAndamento`).
