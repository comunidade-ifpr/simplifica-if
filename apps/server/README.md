# @simplifica-if/server

O servidor local do app desktop (M1.1): um processo Node, sem interface, que o desktop inicia e com quem a interface fala só por `effect/rpc`. Junta numa aplicação Effect:

- o **`Motor`** (`@simplifica-if/motor`) com os drivers reais (`Drivers.layerNode`), a pasta de estado do app e o `fixPath` do T3 na partida;
- o **MCP `ifpr` por HTTP** (`@simplifica-if/mcp/http`, `layerSobreLeitura`) sobre o mesmo serviço `Leitura` do RPC de leitura, numa conexão só ao `kb.sqlite`: cada conversa recebe uma sessão com token próprio, revogado ao encerrar, e o motor recebe as chamadas que o servidor viu (`resultados`);
- o **catálogo das skills do app** (`CatalogoSkills`), entregue a toda conversa;
- a **API RPC** por WebSocket em `127.0.0.1`, com os contratos em [`packages/contratos-app`](../../packages/contratos-app/src/contratos.ts).

## Como rodar

```bash
pnpm kb:compilar                                   # tmp/kb.sqlite
SIMPLIFICA_SERVIDOR_TOKEN=$(openssl rand -base64 32) \
  node apps/server/src/bin.ts --banco tmp/kb.sqlite
# {"servidor":"simplifica-if","pid":123,"porta":61885,"rpc":"ws://127.0.0.1:61885/rpc","mcp":"http://127.0.0.1:61886/mcp"}
```

| Opção | Padrão | Uso |
|---|---|---|
| `--banco <kb.sqlite>` | `SIMPLIFICA_KB` | base servida pelo MCP e pela leitura (obrigatório) |
| `--porta <n>` | 0 (livre) | porta do RPC |
| `--porta-mcp <n>` | 0 (livre) | porta do MCP HTTP |
| `--pasta-estado <dir>` | `SIMPLIFICA_ESTADO`; no macOS, `~/Library/Application Support/simplifica-if` | CLIs gerenciadas e perfil do Antigravity; fora de repositórios |
| `--origem <origem>` | nenhuma | origem de navegador aceita no WebSocket (repetível) |
| `--canal dev\|beta\|estavel` | `dev` | canal da base quando o banco não registra um |
| `--pasta-skills <dir>` | `SIMPLIFICA_SKILLS`; rodando do código-fonte, `.agents/skills` do checkout; no bundle, nenhuma | as skills do app (ver [Skills do app](#skills-do-app)) |

- **Token:** pela variável `SIMPLIFICA_SERVIDOR_TOKEN` ou, como o desktop vai fazer, pela primeira linha do stdin, um `EnvelopePartida` em JSON: `{"token": "<32+ caracteres>", "origens": ["app://…"]}`. Nunca pela linha de comando. O servidor tira a variável do ambiente antes de abrir os providers.
- **Linha de partida:** pronto o servidor, a única linha do stdout é a `LinhaPartida` em JSON; o desktop a lê. Logs e erros vão para o stderr.
- **`ponte-mcp`:** `node apps/server/src/bin.ts ponte-mcp` é a ponte stdio → HTTP do MCP (`AcpMcpStdioBridge` do T3), que o `agy` abre por sessão porque não anuncia MCP por HTTP. O driver do Antigravity recebe o executável que roda o servidor e o script dele com o subcomando (`src/ponte.ts`, o `selfInvocationArgs` do T3): `node <bin.ts> ponte-mcp` no desenvolvimento e, no app empacotado, o executável do Electron com `<Resources>/servidor/bin.mjs ponte-mcp` (o driver põe `ELECTRON_RUN_AS_NODE=1`). A URL e o token vão no ambiente da ponte.
- **Encerramento:** SIGTERM ou SIGINT; com o token pelo stdin, também o stdin fechado e a troca do processo pai (`launcherWatch.ts` do T3). Em todos os casos o RPC para (os WebSockets fecham com 1001), as conversas se encerram (o processo de cada provider morre), o servidor MCP fecha e o processo sai.

## API (`GrupoApp`)

| Grupo | Método | Resposta |
|---|---|---|
| providers | `providers.detectar({ provider })` | `EstadoProvider`, com `podeInstalar` e `podeEntrar` (o driver tem `instalar`, `entrar`) |
| | `providers.instalar({ provider })` | stream de `EstadoInstalacao` |
| | `providers.entrar({ provider })` | stream de `EstadoLogin` |
| conversa | `conversa.iniciar({ provider, pastaTrabalho, modelo?, buscaWeb? })` | `{ sessao }`; já com o MCP `ifpr` ligado |
| | `conversa.enviar({ sessao, texto })` | stream de `Evento` até `FimTurno` |
| | `conversa.responderAprovacao({ sessao, aprovacao, decisao })` | — |
| | `conversa.interromper({ sessao })`, `conversa.encerrar({ sessao })` | — |
| | `conversa.listar({})` | `ResumoConversa[]`, da mais recente para a mais antiga (título, provider, estado, turnos, datas) |
| | `conversa.carregar({ sessao })` | `ConversaGravada`: o resumo e o histórico (`ItemConversa`: mensagens, eventos e decisões, com `ordem`) |
| | `conversa.acompanhar({ sessao, depois })` | stream dos itens depois de `depois` e, se há turno em andamento, dos que chegam até o `FimTurno` |
| | `conversa.retomar({ sessao })` | `ResumoConversa`; reabre a sessão do provider sem mandar mensagem |
| skills | `skills.listar({})` | `ResumoSkill[]` (`nome`, `titulo`, `resumo`, `area`), em ordem alfabética do nome; para os futuros cartões da tela inicial |
| leitura | o `GrupoLeitura` de `@simplifica-if/mcp/grupo-leitura`, com os handlers de `@simplifica-if/mcp/rpc` (`lerLink` para qualquer link `ifpr://`, `fichaNorma`, `lerDispositivos`, `buscarNorma`, `fichaCurso`, `lerSecao`, `buscarSecoes`, `listarCursos`, `sobreABase`, `lerPpc`, `lerCnct`, `lerCampus`, `lerFicha` e o que ele ganhar) | as respostas das ferramentas MCP de mesmo nome |

**Conversas gravadas (M1.2).** A conversa tem id próprio, fica no banco `conversas.sqlite` da pasta de estado (`effect/sql` sobre `node:sqlite`, migrações em `src/persistencia/migracoes/`) e não depende da conexão: a interface que recarrega volta por `carregar` e, com turno em andamento, por `acompanhar`. Os eventos de cada turno passam por um fiber do servidor, que os grava e os publica; o `TextoParcial` não se grava (o texto parcial sem `TextoFinal` vira um `TextoFinal` no fim do turno). Estados: `pronta`, `respondendo`, `liberada` (sem processo do provider) e `caiu`.

- **Sessão do provider:** ociosa por 30 minutos (como no T3), ela se libera; a próxima mensagem a reabre pela retomada nativa (`resume` do Agent SDK, `thread/resume` do Codex, `session/load` do `agy`). Se o provider não retomar, abre-se uma sessão nova, e a mensagem leva o histórico gravado como contexto.
- **Interromper:** pede ao provider que pare; sem `FimTurno` em `PRAZO_INTERRUPCAO`, a sessão se libera e o turno fecha como interrompido.
- **Queda do processo do provider:** o turno termina com `Erro` e `FimTurno` (motivo `falha`), a conversa fica `caiu`, e a próxima mensagem a reabre pela retomada.
- **App fechado:** as sessões se liberam, e um turno em andamento fecha como interrompido; na abertura, as conversas que o banco dá como abertas passam a `liberada`.
- **Política de aprovação (M1.7):** aplicada no motor (`packages/motor/src/politica.ts`); o servidor só vê os pedidos que a política manda perguntar.

Erros tipados: `FalhaProvider` (sem o `cause`, que fica no log), `OperacaoNaoSuportada`, `PastaTrabalhoInvalida` (caminho não absoluto ou que não é pasta), `TurnoEmAndamento`, `SessaoDesconhecida`, `AprovacaoDesconhecida` e os da leitura.

```ts
const cliente = yield* RpcClient.make(GrupoApp) // protocolo: RpcClient.layerProtocolSocket + Socket.layerWebSocket(url, { headers })
const { sessao } = yield* cliente["conversa.iniciar"]({ provider: "claude", pastaTrabalho })
```

No navegador, que não manda cabeçalho no WebSocket, a URL leva um ingresso comprado com o token: `POST /ingresso` com `Authorization: Bearer <token>`, e depois `ws://127.0.0.1:<porta>/rpc?ingresso=<ingresso>`. Cada reconexão compra um ingresso novo.

## Skills do app

O `CatalogoSkills` (`src/CatalogoSkills.ts`) lê a `--pasta-skills` uma vez, na abertura, com `lerPastaSkills` de `@simplifica-if/mcp/skills` (o mesmo Effect Schema do `validar_base.ts`):

- **Quais entram:** só as skills com bloco `simplifica:` válido no front matter do `SKILL.md` (`titulo`, `resumo`, `area`, `ferramentas` só do `simplifica-mcp`, `arquivos`; o resto do manifesto do plano é opcional). Skill sem o bloco fica no repositório, sem aviso. Bloco inválido, `name` diferente da pasta ou arquivo listado que falta: a skill fica de fora, com o erro no log; as outras seguem. A pasta que não pode ser lida impede a abertura (`PastaSkillsInvalida`).
- **O que vai ao motor:** `Motor.Skill` com o `name`, a `description`, o corpo do `SKILL.md` como instruções e só os arquivos de `simplifica.arquivos`.
- **Quando:** toda sessão aberta pelas `Conversas` (nova, retomada pelo provider ou recomeçada com o histórico) leva todas as skills do catálogo em `ConfigSessao.skills`. O motor grava `<pasta>/.simplifica/skills/<nome>/` e põe nas instruções da sessão só o nome, a descrição e o caminho de cada `SKILL.md`; o provider o lê quando o pedido combina, e a leitura dentro da pasta de trabalho passa pela política sem perguntar.
- Uma skill editada só vale depois de reiniciar o servidor. No app, as skills chegam pela atualização (M1.10).

Hoje são duas: `verificar-fundamentacao-normativa` e `verificar-calendario`.

## Segurança

- O RPC e o MCP escutam só em `127.0.0.1`, em portas escolhidas na abertura.
- Antes do upgrade do WebSocket (`src/Autenticacao.ts`): `Host` só `127.0.0.1:<porta>` ou `localhost:<porta>` (DNS rebinding, 403); `Origin`, se vier, só as origens dadas pelo pai (403); token em `Authorization: Bearer` ou, para o navegador, que não manda cabeçalho no WebSocket, um ingresso em `?ingresso=` (401). Guarda-se só o SHA-256 do token, comparado em tempo constante.
- **Ingresso** (o `wsTicket` do T3): `POST /ingresso` com o token no `Authorization` devolve `{ ingresso, expiraEm }` (`Ingresso` do contrato). O ingresso tem 32 bytes aleatórios, vale por 1 minuto e abre uma conexão só; o servidor guarda só o hash, na memória. O pedido passa pelas mesmas conferências de `Host` e `Origin`, e o `OPTIONS` do CORS só responde às origens permitidas. O token nunca vai na URL. O T3 emite o ticket por 5 minutos, assinado e ligado à chave do cliente (DPoP), porque aceita outros dispositivos.
- O MCP tem as defesas próprias (`packages/mcp/src/http.ts`) e um token por conversa, diferente do token do RPC.
- A pasta de trabalho de cada conversa é o caminho real de uma pasta que existe; é a única de onde o MCP lê arquivos naquela sessão.

## Estrutura

- `src/bin.ts`: entrada; o caminho rápido `ponte-mcp` e a CLI.
- `src/cli.ts`: opções, partida, drivers reais, linha de partida e encerramento.
- `src/partida.ts`: o token (ambiente ou envelope no stdin) e o cordão do stdin.
- `src/ponte.ts`: o comando da ponte MCP (`ponte-mcp`) para o driver do Antigravity.
- `src/servidor.ts`: a layer do servidor inteiro (`layer(opcoes)`, que pede os `Drivers`) e a rota `/rpc`.
- `src/Autenticacao.ts`, `src/Conversas.ts` (motor + MCP por conversa, gravação, retomada e ciclo de vida da sessão), `src/CatalogoSkills.ts` (as skills do app), `src/handlers.ts`.
- `src/persistencia/`: `Banco.ts` (o `node:sqlite` com os `PRAGMA` e as migrações do T3), `Historico.ts` (conversas e itens) e `migracoes/`.
- `src/t3/`: cópia do T3 (`launcherWatch.ts`), com `NOTICE`; registro em `docs/upstream-t3.md`.

## Testes

```bash
pnpm --filter @simplifica-if/server test        # servidor em portas efêmeras com drivers falsos; o bin.ts como processo
SIMPLIFICA_POC_REAL=1 SIMPLIFICA_PROVIDER=claude pnpm --filter @simplifica-if/server test real   # provider real, pelo RPC
SIMPLIFICA_POC_REAL=1 SIMPLIFICA_PROVIDER=claude pnpm --filter @simplifica-if/server test ciclo-real   # ciclo de vida da conversa
SIMPLIFICA_POC_REAL=1 pnpm --filter @simplifica-if/server test skills-real   # uma skill do app numa conversa real (só Claude)
```

O `skills-real` abre uma conversa com o Claude sobre o catálogo do `.agents/skills` e pergunta pelos rótulos de classificação da `verificar-fundamentacao-normativa`. Em 16/11/2026 (Claude Pro) passou em 4,2 s: um `Read` do `.simplifica/skills/verificar-fundamentacao-normativa/SKILL.md` gravado na pasta de trabalho, nenhum pedido de aprovação e os sete rótulos na resposta.

O `ciclo-real` roda as `Conversas` sobre os drivers reais e um banco temporário: três turnos (o terceiro com uma ferramenta `ifpr`), escrita fora da pasta de trabalho negada pela política sem perguntar, interromper depois da primeira ferramenta e um turno em seguida, retomada depois de fechar a layer (lembrando a primeira palavra), SIGKILL no processo do provider no meio de um turno (`caiu`) e um turno depois, que o reabre. Sem `SIMPLIFICA_PROVIDER`, roda os três. Em 15/11/2026, com o Claude (Pro, Claude Code 2.1.325), tudo passou: turnos de 1 a 3 s, retomada nativa nas duas vezes, o turno da queda fechado 0,1 s depois do SIGKILL.

O teste real gasta a assinatura do usuário e usa a pasta de estado do harness do motor (`SIMPLIFICA_ESTADO` ou `~/Library/Application Support/simplifica-if-poc`). Ele imprime no stderr, por turno, as ferramentas (nome, entrada, resumo), o tempo e os links `ifpr://` da resposta; no Antigravity, um segundo turno confere que o `read_resource` de um link `ifpr://` sai com o resumo que o servidor viu.

## Pendências

- **Ciclo real no Codex e no Antigravity:** o `ciclo-real` só rodou com o Claude. O `agy` 1.5.9 precisa anunciar `loadSession` para a retomada nativa; sem isso, a conversa recomeça com o histórico como contexto.
- ~~**Skills do app nas conversas.**~~ Resolvida: o `CatalogoSkills` as passa a toda conversa (ver [Skills do app](#skills-do-app)). Falta a `revisar-ppc` (depende da conversão DOCX em TypeScript) e o teste real no Codex e no Antigravity.

- ~~**Ponte no app empacotado.**~~ Resolvida com o `apps/desktop`: o comando da ponte sai do `argv` do processo (`src/ponte.ts`), e o bundle roda a ponte com o Electron como Node (conferido no app empacotado).
- **Windows:** o `awaitLauncherLoss` do T3 não age no Windows; ali o cordão é só o stdin.
- ~~**Erros do motor no contrato.**~~ Resolvida: os erros e a `Decisao` ficam em `@simplifica-if/motor/erros`, só schemas, e o `@simplifica-if/contratos-app` importa do motor só eles e os tipos dos estados. O bundle da interface não leva mais o `Motor.ts` (o `sem-servidor.test.ts` confere).
- **Observabilidade:** logs simples no stderr, que o desktop copia para o arquivo de log do app (`apps/desktop/src/registro.ts`); sem OTLP.
