# @simplifica-if/server

O servidor local do app desktop (M1.1): um processo Node, sem interface, que o desktop inicia e com quem a interface fala só por `effect/rpc`. Junta numa aplicação Effect:

- o **`Motor`** (`@simplifica-if/motor`) com os drivers reais (`Drivers.layerNode`), a pasta de estado do app e o `fixPath` do T3 na partida;
- o **MCP `ifpr` por HTTP** (`@simplifica-if/mcp/http`, `layerSobreLeitura`) sobre o mesmo serviço `Leitura` do RPC de leitura, numa conexão só ao `kb.sqlite`: cada conversa recebe uma sessão com token próprio, revogado ao encerrar, e o motor recebe as chamadas que o servidor viu (`resultados`);
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

- **Token:** pela variável `SIMPLIFICA_SERVIDOR_TOKEN` ou, como o desktop vai fazer, pela primeira linha do stdin, um `EnvelopePartida` em JSON: `{"token": "<32+ caracteres>", "origens": ["app://…"]}`. Nunca pela linha de comando. O servidor tira a variável do ambiente antes de abrir os providers.
- **Linha de partida:** pronto o servidor, a única linha do stdout é a `LinhaPartida` em JSON; o desktop a lê. Logs e erros vão para o stderr.
- **`ponte-mcp`:** `node apps/server/src/bin.ts ponte-mcp` é a ponte stdio → HTTP do MCP (`AcpMcpStdioBridge` do T3), que o `agy` abre por sessão porque não anuncia MCP por HTTP. O driver do Antigravity recebe `ponteMcp = { comando: process.execPath, argumentos: [<bin.ts>, "ponte-mcp"] }`; a URL e o token vão no ambiente da ponte.
- **Encerramento:** SIGTERM ou SIGINT; com o token pelo stdin, também o stdin fechado e a troca do processo pai (`launcherWatch.ts` do T3). Em todos os casos o RPC para (os WebSockets fecham com 1001), as conversas se encerram (o processo de cada provider morre), o servidor MCP fecha e o processo sai.

## API (`GrupoApp`)

| Grupo | Método | Resposta |
|---|---|---|
| providers | `providers.detectar({ provider })` | `EstadoProvider` |
| | `providers.instalar({ provider })` | stream de `EstadoInstalacao` |
| | `providers.entrar({ provider })` | stream de `EstadoLogin` |
| conversa | `conversa.iniciar({ provider, pastaTrabalho, modelo?, buscaWeb? })` | `{ sessao }`; já com o MCP `ifpr` ligado |
| | `conversa.enviar({ sessao, texto })` | stream de `Evento` até `FimTurno` |
| | `conversa.responderAprovacao({ sessao, aprovacao, decisao })` | — |
| | `conversa.interromper({ sessao })`, `conversa.encerrar({ sessao })` | — |
| leitura | o `GrupoLeitura` de `@simplifica-if/mcp/grupo-leitura`, com os handlers de `@simplifica-if/mcp/rpc` (`lerLink` para qualquer link `ifpr://`, `fichaNorma`, `lerDispositivos`, `buscarNorma`, `fichaCurso`, `lerSecao`, `buscarSecoes`, `listarCursos`, `sobreABase`, `lerPpc`, `lerCnct`, `lerCampus`, `lerFicha` e o que ele ganhar) | as respostas das ferramentas MCP de mesmo nome |

**Conversas e conexões.** A conversa pertence ao cliente RPC (a conexão WebSocket) que a abriu ou que a usou por último. Quando essa conexão cai, a conversa fica órfã por uma tolerância (`TOLERANCIA_ORFA`, 2 minutos; `toleranciaOrfa` na layer) e então se encerra, como em `conversa.encerrar`. A interface que recarrega volta como outro cliente e, ao usar a conversa (`enviar`, `responderAprovacao`, `interromper`), a adota e cancela o prazo. O T3 não amarra a sessão à conexão: as conversas dele são persistidas, e a sessão do provider se libera depois de 30 minutos ociosa. Sem persistência nem retomada (M1.2), a conversa sem cliente não volta a ser vista; com a retomada, a regra passa a ser a do T3.

Erros tipados: `FalhaProvider` (sem o `cause`, que fica no log), `OperacaoNaoSuportada`, `PastaTrabalhoInvalida` (caminho não absoluto ou que não é pasta), `TurnoEmAndamento`, `SessaoDesconhecida`, `AprovacaoDesconhecida` e os da leitura.

```ts
const cliente = yield* RpcClient.make(GrupoApp) // protocolo: RpcClient.layerProtocolSocket + Socket.layerWebSocket(url, { headers })
const { sessao } = yield* cliente["conversa.iniciar"]({ provider: "claude", pastaTrabalho })
```

No navegador, que não manda cabeçalho no WebSocket, a URL leva um ingresso comprado com o token: `POST /ingresso` com `Authorization: Bearer <token>`, e depois `ws://127.0.0.1:<porta>/rpc?ingresso=<ingresso>`. Cada reconexão compra um ingresso novo.

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
- `src/servidor.ts`: a layer do servidor inteiro (`layer(opcoes)`, que pede os `Drivers`) e a rota `/rpc`.
- `src/Autenticacao.ts`, `src/Conversas.ts` (motor + MCP por conversa), `src/handlers.ts`.
- `src/t3/`: cópia do T3 (`launcherWatch.ts`), com `NOTICE`; registro em `docs/upstream-t3.md`.

## Testes

```bash
pnpm --filter @simplifica-if/server test        # servidor em portas efêmeras com drivers falsos; o bin.ts como processo
SIMPLIFICA_POC_REAL=1 SIMPLIFICA_PROVIDER=claude pnpm --filter @simplifica-if/server test real   # provider real, pelo RPC
```

O teste real gasta a assinatura do usuário e usa a pasta de estado do harness do motor (`SIMPLIFICA_ESTADO` ou `~/Library/Application Support/simplifica-if-poc`).

## Pontos de extensão (M1.2) e pendências

Em `src/Conversas.ts`: persistência dos eventos em `enviar` e da conversa em `iniciar`, retomada, política de aprovação (responder em `enviar` o que a política permite) e skills (instruções e arquivos da sessão em `iniciar`).

Pendências registradas:

- **Ponte no app empacotado:** `process.execPath` + `bin.ts` supõe o Node rodando TypeScript. No Electron, a ponte será o executável do app com `ELECTRON_RUN_AS_NODE=1` (o driver já põe a variável) e o bundle do servidor.
- **Windows:** o `awaitLauncherLoss` do T3 não age no Windows; ali o cordão é só o stdin.
- **Bundle da interface:** `@simplifica-if/contratos-app` importa o `GrupoLeitura` de `@simplifica-if/mcp/rpc`, que traz os handlers e o `kb`. Para o `apps/web`, os schemas da leitura precisam de um ponto de entrada sem o código do servidor.
- **Observabilidade:** logs simples no stderr; sem arquivo de log nem OTLP.
