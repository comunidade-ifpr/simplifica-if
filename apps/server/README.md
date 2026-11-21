# @simplifica-if/server

O servidor local do app desktop (M1.1): um processo Node, sem interface, que o desktop inicia e com quem a interface fala só por `effect/rpc`. Junta numa aplicação Effect:

- o **`Motor`** (`@simplifica-if/motor`) com os drivers reais (`Drivers.layerNode`), a pasta de estado do app e o `fixPath` do T3 na partida;
- o **MCP `ifpr` por HTTP** (`@simplifica-if/mcp/http`, `layerSobreLeitura`) sobre o mesmo serviço `Leitura` do RPC de leitura, numa conexão só ao `kb.sqlite`: cada conversa recebe uma sessão com token próprio, revogado ao encerrar, e o motor recebe as chamadas que o servidor viu (`resultados`);
- o **catálogo das skills do app** (`CatalogoSkills`), entregue a toda conversa;
- a **API RPC** por WebSocket em `127.0.0.1`, com os contratos em [`packages/contratos-app`](../../packages/contratos-app/src/contratos.ts);
- a **revisão de PPC** (`src/revisao-ppc/`), as **pastas de trabalho** com "Desfazer", os **relatos de erro** e a **atualização** da base e das skills, descritos abaixo.

O servidor foi desenhado para dado público (o `kb.sqlite` e os arquivos que a pessoa escolhe, que ele não confere). Não acessa sistemas com login (lista das ferramentas fora do app no [`AGENTS.md`](../../AGENTS.md#ferramentas-do-repositório-fora-do-app)).

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
| `--pasta-trabalhos <dir>` | `SIMPLIFICA_TRABALHOS`; `~/Documents/Simplifica IF` (o desktop passa a pasta Documentos do sistema) | a raiz das pastas de tarefa (ver [Pasta de trabalho e Desfazer](#pasta-de-trabalho-e-desfazer-m19)) |
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
| conversa | `conversa.iniciar({ provider, pastaTrabalho, modelo?, tarefa? })` | `{ sessao }`; já com o MCP `ifpr` ligado. `tarefa`: a skill da tarefa (ou `conversa`); no primeiro turno, o servidor diz à IA qual skill seguir |
| | `conversa.enviar({ sessao, texto })` | stream de `Evento` até `FimTurno` |
| | `conversa.responderAprovacao({ sessao, aprovacao, decisao })` | — |
| | `conversa.interromper({ sessao })`, `conversa.encerrar({ sessao })` | — |
| | `conversa.listar({})` | `ResumoConversa[]`, da mais recente para a mais antiga (título, provider, estado, turnos, datas) |
| | `conversa.carregar({ sessao })` | `ConversaGravada`: o resumo e o histórico (`ItemConversa`: mensagens, eventos e decisões, com `ordem`) |
| | `conversa.acompanhar({ sessao, depois })` | stream dos itens depois de `depois` e, se há turno em andamento, dos que chegam até o `FimTurno` |
| | `conversa.avaliar({ sessao, turno, nota })` | 👍/👎 (`util`, `nao_util`; `null` retira) da resposta do turno; `conversa.carregar` devolve as `avaliacoes` |
| preferências (M1.8) | `preferencias.ler({})` | `Preferencias`: `perfil?` (campus, função, cursos), `avisoAceitoEm?`, `boasVindasEm?`, `iasDesligadas`. Ficam só neste computador, na tabela `preferencias` do `conversas.sqlite` (migração 6, `persistencia/Preferencias.ts`); valor que não decodifica conta como ausente |
| | `preferencias.gravarPerfil({ perfil })`, `preferencias.apagarPerfil({})` | `Preferencias`; o schema recusa função fora de `FUNCOES` e mais de 30 cursos |
| | `preferencias.aceitarAviso({})`, `preferencias.concluirBoasVindas({})` | `Preferencias`; a primeira data fica |
| | `preferencias.usarIa({ provider, usar })` | `Preferencias`; tira a IA da escolha das conversas (ou a devolve), sem sair da conta |
| | (regra) | Sem o aviso aceito, `conversa.iniciar`, `conversa.enviar`, `revisaoPpc.prepararIa`, `revisaoPpc.iniciarIa`, `revisaoPpc.contestar`, `revisaoPpc.sugerir` e `revisaoPpc.revisarDeNovo` falham com `AvisoNaoAceito` (frase em português); a regra fica nos serviços (`Conversas`, `RevisaoIa`, `ListaViva`), não nos handlers. A pré-conferência não depende dele. `apagarPerfil` usa `secure_delete` e `wal_checkpoint(TRUNCATE)`: o texto do perfil não fica no arquivo nem no `-wal` |
| skills | `skills.listar({})` | `ResumoSkill[]` (`nome`, `titulo`, `resumo`, `area`, `publico`, `entradas`, `etapas`, `duracaoEstimada`), em ordem alfabética do nome; os cartões e o formulário da tarefa |
| pasta | `pasta.criar({ titulo })` | `{ pasta }`: `Documentos/Simplifica IF/<título>`, nome seguro, sem colisão |
| | `pasta.anexar({ pasta, arquivo })` | `ArquivoPasta`: a cópia, na pasta da tarefa, de um arquivo liberado pelo desktop |
| relato (M1.12) | `relato.preparar({ sessao, turno })` | `RascunhoRelato`: pergunta e resposta do turno, fontes `ifpr://`, versões (app, base, tarefa, IA e CLI) e o repositório da curadoria da política (`null` até ele abrir) |
| | `relato.registrar({ sessao, turno, via, titulo, corpo })` | `RelatoRegistrado`: o relato aprovado na tabela `relatos` (migração 7) e, com `via: "arquivo"`, o `.md` em `Documentos/Simplifica IF/Relatos de erro/`, fora da pasta da tarefa |
| | `pasta.ver({ sessao })`, `pasta.desfazer({ sessao })` | `PastaConversa`: os arquivos (`anexado` ou `pasta`) e a previsão do Desfazer; `desfazer` restaura e devolve a pasta depois (recusa com turno em andamento) |
| revisão de PPC | `revisaoPpc.revisar({ arquivo, cnct?, forma? })` (stream) | `EventoRevisaoPpc`: as etapas da leitura quando cada uma começa (`lendo`, `identificando`, `conferindo`, `gravando`) e, no fim, `pronto` com o `ResultadoRevisaoPpc`: o caminho da cópia comentada, o curso considerado, as pendências (com tema, estado, o que fazer, trecho, fontes legíveis, onde ficou o comentário e `dependeDoCurso`) e a régua com todos os critérios da base (decididos ou `nao_lido`); erro `FalhaRevisaoPpc` com a frase para a pessoa. Com `cnct` ("Qual é o curso?"), a lista nova substitui a anterior do mesmo arquivo |
| revisão com IA | `revisaoPpc.prepararIa({ arquivo, provider, modo, modelo?, cnct?, forma? })` | `EstadoRevisaoIa` `preparada`: os blocos e a estimativa (tokens, minutos, % da janela, US$ equivalentes no Claude); nada vai ao provider |
| | `revisaoPpc.iniciarIa({ revisao })`, `revisaoPpc.pausarIa({ revisao })` | começa ou retoma (só os blocos pendentes); pausa (os prontos ficam gravados) |
| | `revisaoPpc.acompanharIa({ revisao })` (stream) | o estado agora e a cada bloco pronto, pausa ou fim; termina em `concluida` (com o `ResultadoRevisaoPpc` unificado) ou `falhou` |
| | `revisaoPpc.listarIa({})` | as revisões gravadas, sem o plano |
| lista viva (etapa 5b) | `revisaoPpc.lista({ lista })`, `revisaoPpc.ultimaLista({})`, `revisaoPpc.apagarLista({ lista })` | `ListaPendencias`: cada pendência com a situação, o histórico e a sugestão, e o uso das ações com IA. `revisar` e a revisão com IA concluída devolvem o `lista` no resultado |
| | `revisaoPpc.marcar({ lista, chave, situacao })` | "Feito" (`resolvida`) e "Desfazer" (`aberta`), sem IA |
| | `revisaoPpc.estimarAcao({ lista, chave, acao, provider? })` | tokens, segundos e US$ equivalentes de "Discordo…", "Sugerir texto" ou a nova revisão (0 numa ficha do código) |
| | `revisaoPpc.contestar({ lista, chave, motivo, provider? })`, `revisaoPpc.sugerir(…)`, `revisaoPpc.revisarDeNovo({ lista, chave, arquivo, provider? })` | a lista depois da ação; a situação sai da conferência em código, nunca da resposta da IA nem da palavra da pessoa |
| | `revisaoPpc.revisarArquivoNovo({ lista, arquivo })` | "Enviar a versão corrigida": `{ lista, resolvidas, continuam, novas }`; o `.docx` novo, pré-conferido só no código, decide as pendências do código da lista (as da IA ficam), as novas entram abertas, e a lista passa ao arquivo novo, com a cópia comentada dele |
| | `revisaoPpc.gerarCopia({ lista })` | regrava a cópia comentada (o mesmo nome) com a situação marcada em cada comentário e no aviso do título |
| leitura | o `GrupoLeitura` de `@simplifica-if/mcp/grupo-leitura`, com os handlers de `@simplifica-if/mcp/rpc` (`lerLink` para qualquer link `ifpr://`, `fichaNorma`, `lerDispositivos`, `fichaCurso`, `lerSecao`, `listarCursos`, `sobreABase`, `lerPpc`, `lerCnct`, `lerCampus`, `lerFicha`, `lerDocumento` do leitor, `explorarIndice` e `explorarBuscar` do Explorar e o que ele ganhar) | as respostas das ferramentas MCP de mesmo nome; as do leitor e do Explorar não têm ferramenta |

**Conversas gravadas (M1.2).** A conversa tem id próprio, fica no banco `conversas.sqlite` da pasta de estado (`effect/sql` sobre `node:sqlite`, migrações em `src/persistencia/migracoes/`) e não depende da conexão: a interface que recarrega volta por `carregar` e, com turno em andamento, por `acompanhar`. Os eventos de cada turno passam por um fiber do servidor, que os grava e os publica; o `TextoParcial` não se grava (o texto parcial sem `TextoFinal` vira um `TextoFinal` no fim do turno). Estados: `pronta`, `respondendo`, `liberada` (sem processo do provider) e `caiu`.

- **Sessão do provider:** ociosa por 30 minutos (como no T3), ela se libera; a próxima mensagem a reabre pela retomada nativa (`resume` do Agent SDK, `thread/resume` do Codex, `session/load` do `agy`). Se o provider não retomar, abre-se uma sessão nova, e a mensagem leva o histórico gravado como contexto.
- **Interromper:** pede ao provider que pare; sem `FimTurno` em `PRAZO_INTERRUPCAO`, a sessão se libera e o turno fecha como interrompido.
- **Queda do processo do provider:** o turno termina com `Erro` e `FimTurno` (motivo `falha`), a conversa fica `caiu`, e a próxima mensagem a reabre pela retomada.
- **App fechado:** as sessões se liberam, e um turno em andamento fecha como interrompido; na abertura, as conversas que o banco dá como abertas passam a `liberada`.
- **Política de aprovação (M1.7):** aplicada no motor (`packages/motor/src/politica.ts`); o servidor só vê os pedidos que a política manda perguntar.

Erros tipados: `FalhaProvider` (com o `tipo` do classificador do motor; sem o `cause`, que fica no log, e com o texto técnico dele, curto e saneado, em `tecnico`), `OperacaoNaoSuportada`, `PastaTrabalhoInvalida` (caminho não absoluto ou que não é pasta), `TurnoEmAndamento`, `SessaoDesconhecida`, `AprovacaoDesconhecida` e os da leitura.

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
- Uma skill editada só vale depois de reiniciar o servidor. No app, as skills chegam pela atualização (M1.10): o catálogo lê também a pasta baixada (`<pasta do app>/skills/<versao>/`) e fica, de cada skill, com a de `simplifica.versao` maior; no empate, a empacotada.

Hoje é uma: `verificar-fundamentacao-normativa`.

## Pasta de trabalho e Desfazer (M1.9)

`src/PastasTrabalho.ts`. Cada tarefa ganha uma pasta em `<--pasta-trabalhos>/<título>` (`nomeSeguro`: sem `<>:"/\|?*` nem controle, sem ponto ou espaço nas pontas, até 60 caracteres, nome reservado do Windows vira "Tarefa"; colisão vira ` (2)`, ` (3)`…). A pasta é *gerida* quando o caminho real é filho direto da raiz real; só as geridas têm lista, anexos e cópias. A conversa com uma pasta escolhida à mão (a tela técnica) segue sem elas.

- **Anexar:** o desktop libera o arquivo escolhido no diálogo (`CAMINHO_LIBERAR_ARQUIVO`, a mesma liberação da revisão prévia); o servidor só copia arquivo liberado, comum (não link), de até 50 MB, sem sobrescrever. Os anexos ficam registrados (`anexos_pasta`, migração 5) para a interface separar "Você trouxe" do que a conversa criou.
- **"Isto está errado" (M1.12):** `Relatos.ts`. O rascunho vem da conversa gravada (a mensagem da pessoa, sem a indicação da skill; os `TextoFinal` do turno), nunca da pasta da tarefa nem dos anexos. O repositório da curadoria é o de `curadoria.repositorio` da política de fábrica (`packages/motor/src/politica-curadoria.ts`, `dono/repo` sem `.` nem `..`), trocado nos testes pela opção `relatos`. O servidor não abre a issue: a interface registra o relato e só então abre `issues/new` no navegador. "Salvar o relato" grava `<tarefa> - <data> (mensagem N).md` em `<raiz>/Relatos de erro/` (`PASTA_RELATOS`), fora da pasta de qualquer tarefa: a política nega à IA a leitura fora da pasta da conversa. Nenhuma tarefa ganha esse nome (`pasta.criar` começa em ` (2)`), e nada se sobrescreve. O app não confere dado pessoal no relato nem nos anexos (o M1.13 foi retirado): vale o aviso de uso aceito no primeiro uso.
- **Cópia antes de cada turno:** `Conversas` chama `guardarCopia` antes de mandar a mensagem ao provider (a política de fábrica deixa a IA escrever na pasta com aprovação). A cópia vai para `<pasta de estado>/copias/<conversa>/<turno>/`, fora da pasta de trabalho, com um `manifesto.json` (tamanho e SHA-256 de cada arquivo) gravado por último. Ficam fora os nomes que começam com `.` (o `.simplifica/` das skills) e os links simbólicos.
- **Escolha: cópia simples, não git oculto.** A pasta de uma tarefa é pequena (o documento, o relatório); o git não vem instalado nos computadores institucionais com Windows, e levá-lo no app custaria dezenas de MB; restaurar é copiar de volta, sem repositório escondido dentro da pasta da pessoa. O preço é o espaço (uma cópia inteira por turno), contido pelos limites.
- **Limites** (`LIMITES`): pasta de até 50 MB e 500 arquivos (acima disso, o turno fica sem cópia, e o "Desfazer" avisa e não volta a uma cópia mais antiga, que desfaria também o que veio depois); as 10 cópias mais recentes por conversa.
- **Retrato do fim do turno:** ao fechar cada turno, `fim.json` ao lado da cópia guarda a pasta depois do turno. É o que separa o que a IA fez do que a pessoa mudou depois (no Word, por exemplo).
- **Desfazer:** pega o turno mais recente que mudou a pasta (cópia de antes × retrato do fim) e volta só os arquivos desse turno. Os que mudaram de novo fora da conversa vão em `foraDaConversa`: a confirmação avisa, e eles só são desfeitos com `incluirForaDaConversa`. As pastas que o turno criou e ficaram vazias saem; as cópias daquele turno em diante também (o próximo Desfazer volta mais um turno). Com turno em andamento, `TurnoEmAndamento`.
- **Sem seguir links:** a varredura vê os links (no retrato, como `link`) e nunca os copia. Ao restaurar, cada componente do caminho é conferido com `lstat`; um link no lugar de pasta ou arquivo é removido e trocado, nunca seguido. O arquivo é gravado num temporário novo na mesma pasta (`O_EXCL`, `O_NOFOLLOW`) e trocado por `rename`, com o caminho real conferido antes (`gravarSemSeguirLinks`, `removerSemSeguirLinks`).
- **Arquivos pelo `FileSystem` do Effect**, salvo três operações que ele não oferece e ficam com o Node em `src/pastas-node.ts`: o temporário com `O_NOFOLLOW`, o `rmdir` da pasta vazia (o `remove` do Effect é o `rm`, que só apaga pasta com `recursive`) e o SHA-256 por partes. As falhas chegam à interface como `FalhaPasta` com a frase fixa; a falha de arquivo fica em `cause`, que vai para o log e não para a interface. Criar sem sobrescrever (pasta, anexo, relato) é `criarSemColisao` (`src/nome-livre.ts`); a cópia comentada da revisão prévia usa a mesma sequência só quando a cópia está travada.
- **Tarefa:** `conversa.iniciar` só aceita uma skill do catálogo ou `conversa` (`TarefaDesconhecida`); o nome entra na instrução do primeiro turno.
- **Anexar:** só `EXTENSOES_DOCUMENTO` (do contrato), também quando o servidor não exige a liberação.

## Atualização da base e das skills (M1.10)

Com `--pasta-atualizacao <pasta do app>` (o desktop passa no app instalado), a CLI, antes de abrir a base, atende a troca pendente (`prepararAbertura` de `@simplifica-if/atualizacao/local`) e abre a mais nova entre a baixada e a do `--banco`. O serviço `Atualizador` confere o feed da política (`POLITICA_FABRICA.atualizacao`) na abertura e a cada 24 h e responde o grupo `atualizacao.*` (`estado`, `procurar`, `trocarCanal`, `aplicar`, `voltar`, `novidadesVistas`). `aplicar` e `voltar` respondem `adiada` enquanto uma revisão de PPC, uma revisão com IA ou uma conversa respondendo roda; senão, `reiniciar`, e a interface pede ao desktop para reiniciar o servidor.

| Argumento | Variável | Uso |
|---|---|---|
| `--pasta-atualizacao` | `SIMPLIFICA_ATUALIZACAO_PASTA` | liga a atualização, gravando nesta pasta |
| `--feed-atualizacao` | `SIMPLIFICA_ATUALIZACAO_FEED` | feed no lugar do da política (com `{canal}`) |
| `--chave-atualizacao` | `SIMPLIFICA_ATUALIZACAO_CHAVE` | chave pública minisign no lugar da da política |
| `--versao-app` | | a versão do app, para o `app_minimo` do manifesto |

Sem feed ou sem chave (a política ainda não tem os de produção), o estado diz o motivo e nada sai para a rede. O mecanismo, a fábrica e o passo a passo de produção estão em [`packages/atualizacao`](../../packages/atualizacao/README.md). Teste: `test/atualizacao.test.ts` (o servidor de verdade pelo RPC, com um canal gerado pela fábrica e servido em 127.0.0.1).

## Revisão prévia de PPC (M1.11, etapa 3)

`revisaoPpc.revisar` faz a revisão prévia **sem IA** de um PPC em DOCX (`src/revisao-ppc/RevisorPpc.ts`):

1. **Pedido:** `arquivo` é o caminho absoluto escolhido no diálogo do sistema. No app, o servidor só aceita arquivos que o processo principal do desktop liberou nesta execução: o desktop manda no envelope de partida um segundo segredo, o `tokenDesktop`, que a janela nunca recebe, e libera cada arquivo escolhido por `POST /revisao-ppc/liberar` (`CAMINHO_LIBERAR_ARQUIVO`; `Host` local, sem `Origin`, `Authorization: Bearer <tokenDesktop>`). Assim, uma janela comprometida, que tem o token do RPC, não manda o servidor ler um `.docx` qualquer nem gravar ao lado dele. Sem `tokenDesktop` (o servidor iniciado à mão, com `SIMPLIFICA_SERVIDOR_TOKEN`, para o navegador e o desenvolvimento), qualquer `.docx` é aceito. Uma revisão por vez (cada Worker pode usar 512 MB): a segunda simultânea é recusada com "Já há uma revisão em andamento". O resto do pedido: só `.docx`, arquivo comum, até 20 MB, conferido pelo `stat` antes de ler (acima disso, a orientação de compactar as imagens). `cnct` (slug) e `forma` substituem o curso que a revisão identifica no documento.
2. **Base:** montada uma vez, na primeira revisão, do mesmo `kb.sqlite` que o servidor serve (`FontesNormativas`, inclusive as datas dos atos e as transições da vigência, e as tabelas `cnct`, `normas`, `fichas`, `topicos` e `meta`). Nada vem de arquivos do repositório: o servidor empacotado, fora do checkout, faz a mesma revisão. `test/revisao-ppc-base.test.ts` compila a base real num diretório temporário e confere que a base do banco é a mesma dos arquivos, campo a campo, com o mesmo resultado da revisão; e roda a revisão num processo filho (`test/sem-repositorio.ts`) com a leitura das pastas de dados do checkout bloqueada, sem nenhuma tentativa de leitura (o controle, a pré-conferência sem `vigencia`, esbarra no bloqueio).
3. **Worker** (`src/revisao-ppc/trabalhador.ts`, `worker_threads`, pelo `src/WorkerLimitado.ts`, que a versão em texto dos anexos também usa): roda `revisarDocx` de `@simplifica-if/ppc/revisao-previa` (conversão, pré-conferência das 12 fichas D e triagem, comentários). Limites em `LIMITES`: `resourceLimits.maxOldGenerationSizeMb` 512 (com piso de 64: com 2 MB, medido no Node 26, o V8 aborta o processo inteiro em vez de encerrar o Worker) e 30 s, com `terminate()` no estouro ou na interrupção. Estouro de memória (`ERR_WORKER_OUT_OF_MEMORY`), de tempo, `ErroDocx` (protegido, corrompido, bomba de descompactação, sem texto) e defeito viram `FalhaRevisaoPpc` com a frase em português (do `ErroDocx`, o Worker manda o motivo e os atributos, e a frase é montada aqui por `mensagemErroDocx`); o defeito vai para o log. O servidor continua de pé, e o laço de eventos não para durante a revisão (os testes conferem os dois).
4. **Cópia:** gravada na pasta do original como `<nome> - revisão prévia (Simplifica IF).docx` (`SUFIXO_REVISAO_PREVIA` do contrato), regravada a cada revisão: a pasta fica com uma cópia só. Se ela está aberta e travada (`EBUSY`, ou sem permissão de escrita: o Word no Windows), passa a ` (2)`, ` (3)`… até 20 (`criarSemColisao` com `pular: travado`). O original só é lido.

As etapas vão à interface quando cada uma começa: `lendo` no servidor, depois das recusas (extensão, liberação, tamanho) e antes de ler os bytes (a conversão, no Worker, faz parte dela); `identificando`, `conferindo` e `gravando` do Worker, como avisos de andamento antes da resposta (`WorkerLimitado`, `aoAndamento`). O `ListaViva.revisar` as põe no stream do RPC (`Stream.callback`).

Em desenvolvimento, o Worker é o `trabalhador.ts`; no bundle, o `trabalhador-ppc.mjs` ao lado do `bin.mjs` (`URL_TRABALHADOR`).

## Versão em texto dos anexos

Ao anexar (`pasta.anexar`), o `.docx` ganha uma versão em Markdown para a IA ler, porque o Claude não o lê e o Codex e o Gemini só com um conversor instalado e um comando, que pede aprovação.

- **Conversão** (`src/textos-anexos/TextosAnexos.ts`): `docxParaMarkdown` de `@simplifica-if/docx/markdown` num Worker (`src/textos-anexos/trabalhador.ts`, pelo `WorkerLimitado`), com os limites da revisão prévia (`LIMITES`: 20 MB de arquivo, 512 MB de heap, 30 s) e uma conversão por vez. O Markdown começa com um cabeçalho que diz de onde veio e o que não entra (imagens, comentários, texto excluído).
- **Leitura** (`lerSemSeguirLinks`, em `src/pastas-node.ts`): o `TextosAnexos` recebe os bytes, não o caminho, e não lê arquivo. O `PastasTrabalho` lê o documento da pasta (a cópia do anexo, ou o que a pessoa pôs lá) sem seguir link, porque a IA escreve na pasta e um processo deixado por ela poderia trocar o arquivo, ou uma subpasta do caminho, por um link para fora. A abertura recusa link: no macOS, em qualquer parte do caminho (`O_NOFOLLOW_ANY`); nos outros, na última (`O_NOFOLLOW`). Pelo descritor, confere que é um arquivo comum de até 20 MB (`TextosAnexos.bytesDoArquivo`); no Linux, que o caminho do descritor (`/proc/self/fd`) está na pasta; em todos, que o caminho real está na pasta e leva ao mesmo arquivo aberto (`dev`/`ino`); e só então lê pelo descritor. A pasta e o arquivo passam pelo mesmo `realpath` nativo (o do Effect, em JS fora do Windows, guarda a caixa e a forma Unicode recebidas). No Windows, sem `O_NOFOLLOW` nem `/proc`, fica só a conferência pelo caminho real e o `dev`/`ino`: uma junction posta e tirada no meio ainda passaria (risco residual). Os erros: `LeituraRecusada` (link, pasta, fora, trocado ou removido: "O arquivo mudou de novo e não pôde ser lido.", o texto anterior sai e o índice não registra), `ArquivoGrandeDemais` ("O arquivo passa de 20 MB.") e `LeituraNaoFeita` (E/S), os dois no índice. A impressão no índice é o SHA-256 dos bytes lidos; sem leitura, a do retrato.
- **Gravação** (`PastasTrabalho.anexar`): em `<pasta>/.simplifica/textos/<nome do anexo>.md`, sem seguir link (`gravarSemSeguirLinks`). A pasta oculta fica fora da lista do painel e do Desfazer.
- **Resposta** (`ArquivoAnexado` do contrato): `texto`, o caminho relativo, ou `semTexto`, o motivo (arquivo protegido, sem texto, grande demais, estouro). O anexo nunca falha por causa do texto. A interface põe o caminho ou o motivo na nota do pedido.

- **Mudanças fora da conversa** (v2, `PastasTrabalho.guardarCopia`): no começo de cada turno, o retrato da pasta (o da cópia do Desfazer) se compara com o do fim do último turno que chegou à IA (`fim.json` da cópia mais recente). O que mudou entre os dois foi a pessoa, fora da conversa: arquivos novos (menos os anexos do app, que a nota já trouxe), mudados e removidos, sem links nem a pasta oculta. Os textos se põem em dia por um índice (`.simplifica/textos/indice.json`: de cada documento, a impressão `tamanho:sha256` do conteúdo convertido), não pela janela entre os turnos: o texto de quem saiu da pasta sai primeiro, e todo documento cujo texto não é do conteúdo atual é convertido (os mudados primeiro), até 10 por turno e 60 s; o que sobra sai no turno seguinte. Assim entram também o mudado durante o turno, o posto antes do primeiro e o que um Desfazer voltou, e um documento que deixou de converter perde o texto velho. Os temporários do Word (`~$…`, `~WRL….tmp`) ficam fora do retrato. O `Conversas` grava o evento `MudancasPasta` logo depois da mensagem (a interface mostra uma linha abaixo dela) e manda à IA a mensagem seguida do aviso (`textos-anexos/aviso.ts`); o histórico guarda a mensagem como a pessoa a escreveu. A comparação é com a cópia mais recente (a do último turno que chegou à IA); se ela não tem o retrato do fim (o app caiu no meio do turno), não há aviso.
- **O turno e o "Parar"** (`Conversas.executarTurno`): o turno abre antes do preparo, na fase `preparando` (como o `starting` do T3 Code), com a mensagem gravada; a cópia, os textos e o aviso rodam na fibra do turno, contra o sinal `parar`. O `interromper` e a fibra conferem e trocam a fase num passo só: no preparo, o "Parar" interrompe a cópia e as conversões (o Worker se encerra), o turno fecha com o motivo `parado_antes_do_envio` (`MOTIVO_PARADO_ANTES_DO_ENVIO`) sem a mensagem ter ido à IA, e a cópia do turno sai (`descartarCopia`); em `respondendo`, ele pede ao provider que pare, como antes. O índice dos textos se grava a cada conversão; o que um turno parado converteu fica marcado como pendente no índice e entra no aviso do turno que chegar à IA (`confirmarAviso` limpa a marca). O primeiro turno que chega à IA é o que indica a skill da tarefa. Uma sessão que cai no preparo não recebe a mensagem: o turno fecha com o erro da queda. Encerrar a conversa no preparo fecha o turno como parado.

No bundle, o Worker é o `trabalhador-textos.mjs` ao lado do `bin.mjs`. Testes: `test/pasta-trabalho.test.ts` e `test/textos-anexos.test.ts`.

## Revisão com IA (M1.11, etapa 4)

Depois da pré-conferência, a pessoa pode pedir a revisão das fichas S (38) e J (30) pela IA da conta dela. **O servidor conduz**, não o provider (`src/revisao-ppc/RevisaoIa.ts`):

1. **Preparo, em código** (`preparo.ts`, 0,6 s num PPC de 255 mil caracteres): o arquivo é convertido de novo no Worker do `RevisorPpc` (mesmas conferências: liberado, 20 MB, limites), as linhas de texto dirigido a IA (a triagem) saem do Markdown, e os blocos se montam com o PPC aberto por `PacoteContexto.abrirAvulso` do `kb`, sobre o `kb.sqlite`: lotes S com o recorte de cada ficha (1 a 3 mil caracteres), um tema J com só as seções dos tópicos (até 30 mil), as transversais no fim, sobre os resumos dos temas. Todo pedido leva o curso identificado (CNCT e forma), o contexto normativo em texto (dispositivos, marcos, transições, CNCT) e o PPC entre marcas com um nonce da rodada. O plano inteiro (com o texto dos pedidos) fica gravado: a retomada não o refaz.
2. **Sessões** (`julgamento.ts`): uma por bloco, `PARALELISMO` (2) por vez, configurável (`Opcoes.revisaoIa`). `ConfigSessao.semFerramentas`: sem MCP, sem skills, numa pasta temporária vazia (apagada no fim), com a `POLITICA_JULGAMENTO` do motor (nega tudo sem perguntar) e, no Claude, `tools: []` e só as instruções do app como prompt de sistema. Modelo padrão por provider em `MODELO_PADRAO` (`revisao-ppc/modelos.ts`): Sonnet no Claude; o padrão da conta no Codex e no Antigravity.
3. **Conferência** (`@simplifica-if/ppc/revisao-ia/conferencia`): toda resposta passa pelo Effect Schema do contrato, pelos estados permitidos da ficha, pelo trecho literal no PPC (sem as linhas da triagem: citar a instrução escondida não vale como evidência) e pelas normas do contexto entregue. Se falhar, uma nova tentativa numa **sessão nova**, com o pedido inteiro e os problemas no fim (sem repetir o texto que a IA escreveu: um trecho recusado pode ser a instrução escondida); no Claude, o segundo turno de uma sessão levou um bloco fixo de ~158 mil tokens. Se falhar de novo, a ficha sai "a conferir" com o motivo legível. A conferência é por ficha: uma ficha ruim não derruba as boas do lote.
4. **Persistência e retomada** (`persistencia/Revisoes.ts`, migração 2 do `conversas.sqlite`): cada bloco grava ao terminar. Limite de taxa ou cota (os tipos `cota` e `indisponivel` do classificador do motor, `@simplifica-if/motor/falhas`: 429, `rate_limit`, `usage limit`, `quota`, `resource exhausted`, `overloaded`), provider caído, turno de mais de 6 min ou um defeito pausam a revisão com a frase para a pessoa (`limite: true` para os dois primeiros); `iniciarIa` de novo retoma só os pendentes. Uma revisão `em_andamento` quando o servidor reinicia (app fechado) volta como `pausada`.
5. **Fim:** o `RevisorPpc` roda a pré-conferência de novo com os resultados conferidos da IA (`EntradaIa`) e grava uma nova cópia comentada, com as pendências do código e da IA juntas; o `.docx` tem de ter o mesmo sha256 da preparação.

**Critério do INCONCLUSIVO (etapa 5, em avaliação):** `OpcoesRevisaoIa.criterio` escolhe a instrução dos pedidos novos: `conservador` (o padrão: "na dúvida, INCONCLUSIVO", NAO_ATENDE com confiança abaixo de 0,6 vira "a conferir") ou `ausencia` (o que falta numa seção presente é NAO_ATENDE com `tipo_achado` e um trecho literal da seção lida, conferido no conteúdo da ficha; INCONCLUSIVO só para mérito ou recorte sem a seção; a confiança não rebaixa ausência nem contradição). O plano grava o critério; a retomada usa o da revisão. A avaliação das duas fica em `scripts/avaliar-inconclusivos.ts` (escolhe os pares e julga cada bloco uma vez com cada instrução, gravando as respostas brutas) e `scripts/planilha-inconclusivos.ts` (planilha cega, página só leitura, `resumo` bruto e `calcular` a partir da planilha preenchida); números no plano do app, M1.11, etapa 5.

**Sem ferramentas nos três providers** (revisão independente, 16/11/2026): o Codex com sandbox `read-only` roda comandos de leitura sem pedir aprovação, então a política sozinha não bastava. Com `semFerramentas`, o motor desliga no Codex o shell (`features.shell_tool`, `features.unified_exec`), a leitura de imagem, os subagentes, o `apply_patch` e a busca web, com a thread `ephemeral`; no Antigravity, todas as ferramentas conhecidas do `agy` 1.5.9 vão para `disabledTools`; no Claude, `tools: []`. Segunda defesa no `julgamento.ts`: qualquer `FerramentaIniciada` ou pedido de aprovação descarta a resposta do bloco (as fichas saem "a conferir", "a IA tentou usar uma ferramenta…"), sem nova tentativa. Na chamada real curta de cada provider (lote `s-04-1`, duas tentativas cada), zero ferramentas.

**O que fica guardado e onde:**
- no `conversas.sqlite` da pasta de estado do app: o plano de cada revisão com IA, **com o texto do PPC convertido** (sem as linhas dirigidas a IA), o resultado de cada bloco e o uso de cada tentativa. Sai com "Apagar esta revisão" (RPC `revisaoPpc.apagarIa`); uma revisão `preparada` e nunca iniciada expira em 7 dias (`DIAS_PREPARADA`) e é substituída ao preparar de novo o mesmo arquivo;
- no provider: nada que se retome. O Claude roda com `persistSession: false` (nada em `~/.claude/projects`; conferido na chamada real) e sem cache de prompt (`DISABLE_PROMPT_CACHING`); o Codex, com a thread `ephemeral` (fora do histórico do usuário); o Antigravity grava cada sessão no perfil próprio do app (`providers/antigravity/<hash>/antigravity-acp/conversations/<id>.db`, `brain/<id>/`, `annotations/<id>.pbtxt`), e o driver apaga esses arquivos ao fim de cada sessão de julgamento;
- a cópia comentada, na pasta do original, como na pré-conferência.

**Estimativa** (`revisao-ppc/estimativa.ts`): o plano já tem o texto dos pedidos, então a entrada é o tamanho real convertido pela densidade medida (2,0 caracteres por token), mais o sistema por sessão; saída de 690 tokens por ficha e velocidade por provider medidas no teste real (registro no plano do app, M1.11, etapa 4). A fração da janela **não é medida**: é uma referência provisória por plano (`janelaReferencia`), a calibrar no piloto, e a tela diz isso.

```bash
node apps/server/scripts/revisao-ia-real.ts --so-preparar            # só o preparo e os pedidos, sem IA
node apps/server/scripts/revisao-ia-real.ts                          # Claude, modo rápido, revisão inteira (gasta a assinatura)
node apps/server/scripts/revisao-ia-real.ts --provider codex --bloco s-04-1   # um bloco só
```

**Recortes** (`preparo.ts` sobre `@simplifica-if/ppc/revisao-ia/estrutura`): cada pedido leva uma parte "extraída pelo código" (o quadro de identificação com os fatos do `kb`, a matriz em TSV, o índice do ementário e o começo das referências, conforme as fichas do bloco), e o recorte de cada ficha escolhe seções inteiras pelo título, pelo corpo e pelo tópico. Medição sem IA:

```bash
node apps/server/scripts/medir-recortes.ts --saida tmp/recortes.json   # 110 PPCs técnicos, 22 fichas do modo rápido, ~35 s
```

A taxa é a fração dos pares (PPC, ficha) em que o conteúdo que a IA recebe contém a evidência do gabarito, entre os pares em que o próprio PPC a tem: 45,9% com os recortes por termos, 92,0% com os estruturados (16/11/2026).

O script converte um PPC da base (Markdown público; padrão: Técnico em Enfermagem, Curitiba) em DOCX, planta a instrução escondida na seção 5.1 e imprime as medidas (`--saida` para a pasta). Uma execução por medição.

## Lista viva e conversa por pendência (M1.11, etapa 5b)

`src/revisao-ppc/ListaViva.ts`, sobre `persistencia/Listas.ts` (migração 4 do `conversas.sqlite`: `listas_pendencias`, `pendencias_vivas`, `eventos_pendencia`, `acoes_ia`).

- **A lista** nasce de cada `revisar` (a pré-conferência) e de cada revisão com IA concluída (`criarLista`, em `revisao-ppc/criar-lista.ts`, chamada pela `ListaViva` e pela `RevisaoIa`), com o texto do PPC convertido que as ações usam. O id da lista e os nonces (da lista e de cada ação com IA) vêm do `SecureRandom`. As três ações com IA (`contestar`, `sugerir`, `revisarDeNovo`) abrem pelo mesmo preparo (`abrirAcao`: o aviso aceito, a lista e a pendência; `prepararAcaoIa`: provider, modelo, contexto da ficha e nonce novo) e terminam pelo mesmo registro (`concluirAcao`). Cada pendência tem uma chave estável (`chavePendencia` do `packages/ppc`: a ficha e um hash da origem, do trecho e da mensagem); a situação, o histórico e a sugestão passam da lista mais recente do mesmo arquivo com o mesmo sha256 (o "Feito" da pré-conferência continua na lista da revisão com IA, e na revisão com o curso escolhido), e a lista anterior sai. Situações: `aberta`, `resolvida` (com `resolvidaPor`: a pessoa ou a nova revisão), `contestada_aceita`, `contestada_mantida`. Uma lista de revisão com IA some com ela (`ON DELETE CASCADE`).
- **A régua e o curso:** o resultado lista todas as fichas da base (`criterios`), decididas pelo código, pela IA ou `nao_lido`. Sem o curso no CNCT, as pendências das fichas que conferem contra ele (`FICHAS_DO_CURSO` do `packages/ppc`) vêm com `dependeDoCurso`; a mesma ficha com a mesma mensagem no mesmo trecho é uma pendência só.
- **"Discordo…"** (`contestar`), regra da revisão independente de 16/11/2026 (`conferirContestacao`):
  - **pendência do código** (fichas D e triagem) nunca sai por contestação e não vai à IA: fica `contestada_mantida`, "a conferência automática só muda com o arquivo corrigido", e a saída é "Já resolvi" com nova revisão. A discordância fica registrada e sai em CSV para a curadoria das regras (`revisaoPpc.exportarDiscordancias`: data, arquivo, ficha, apontamento, trecho e o motivo da pessoa);
  - **pendência da IA**: uma sessão nova sem ferramentas (`turnoSemFerramentas`), com um nonce novo por ação, a ficha, o contexto normativo, o recorte da ficha (`contextoDaFicha`) e o motivo da pessoa entre `<motivo-NONCE>`. Só sai (`contestada_aceita`) com **prova de leitura**: a IA respondeu `retirar` com ATENDE ou NAO_APLICAVEL permitido à ficha e citou um trecho conferível de ao menos 40 caracteres **na seção do critério** (o recorte próprio, sem o comum, sem os títulos e sem linha que pede algo à revisão), que não é o trecho apontado pela pendência. Fonte sozinha não basta, e só conta como ID exato entregue; fonte fora do contexto ou trecho conferível inventado derrubam a retirada; trecho curto demais é neutro; NAO_APLICAVEL exige o dispositivo entregue;
  - **mesmo aceita**, a contestação fica "a conferir" na cópia comentada, com o motivo e o trecho; só a pendência confirmada pela nova revisão sai do documento.
- **"Sugerir texto"** (`sugerir`): a redação em JSON; o código extrai da própria redação os números, as normas citadas e os nomes próprios e marca os que não estão no recorte, no contexto normativo, no CNCT ou no texto da pendência (`conferirSugestao`); `[completar: …]` não é fato. Fica na pendência; nunca vai ao documento.
- **"Já resolvi" com o arquivo novo** (`revisarDeNovo`): o `.docx` novo (liberado pelo desktop, sha256 diferente do revisado) é convertido e pré-conferido; se parecer outro documento ou uma versão incompleta (outro CNCT ou forma; menos de 60% dos títulos de seção **do revisado** no novo, `SEMELHANCA_MINIMA`; ou menos de 70% das seções ou das linhas com texto do revisado, `TAMANHO_MINIMO`), a nova revisão recusa e não marca nada; o que a triagem do arquivo novo aponta e a lista não tem entra nela, aberto; numa pendência do código, ela fica `resolvida` só se a ficha não aponta mais nada; numa da IA, um lote S de uma ficha, conferido como no julgamento, decide (`estadoDaIa` nulo → `resolvida`; senão `aberta`, com o que ainda aponta).
- **"Enviar a versão corrigida"** (`revisarArquivoNovo`): a mesma leitura do arquivo novo e as mesmas recusas de `revisarDeNovo`, sem IA e sem o aviso de uso. Cada pendência do código decide pela chave: ausente no arquivo novo, `resolvida` (`resolvidaPor: "revisarDeNovo"`); presente, continua (a marcada como feita volta a `aberta`); as que só o arquivo novo aponta entram abertas; as da IA ficam como estão. A lista passa ao arquivo novo (`Listas.trocarArquivo`: caminho, sha256 e texto convertido) e a cópia comentada é regravada dele.
- **O que fica guardado:** a lista guarda o texto do PPC convertido, o histórico e **o que a pessoa escreveu em "Discordo…"** até ela apagar a lista ("Apagar esta lista", `revisaoPpc.apagarLista`) ou ficar 30 dias sem uso (`DIAS_LISTA`, ao subir o servidor e a cada `ultimaLista`). Uma lista nova do mesmo arquivo com o mesmo conteúdo herda a situação e apaga as anteriores (o uso das ações passa para ela).
- **Uso e vez:** uma ação com IA por vez (`withPermitsIfAvailable`); a pausa do provider vira a frase para a pessoa; o uso de cada ação fica em `acoes_ia` e soma ao `usoTotal` da revisão com IA de onde a lista veio. Os turnos seguintes da mesma pendência levam o histórico em frases fixas do app, nunca o texto da IA.
- **Cache:** cada ação é uma sessão nova, com o cache de prompt desligado como no lote. Medido em 16/11/2026: manter a sessão da pendência aberta e mandar a ação seguinte como novo turno gravou 170 mil tokens no cache no segundo turno e não leu nada (o mesmo bloco fixo da etapa 4), e uma sessão nova com uma mensagem só não tem ponto de leitura no prefixo comum. O reaproveitamento fica para depois (ver Pendências).

```bash
node apps/server/scripts/lista-viva-real.ts --listar                # pré-conferência de um PPC da base em DOCX, sem IA; imprime as chaves
node apps/server/scripts/lista-viva-real.ts --fundamentada <chave> "<motivo>" --sem-fundamento <chave> "<motivo>" --sugerir <chave>
```

Números da execução real no plano do app (M1.11, etapa 5b).

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
- `src/revisao-ppc/`: `RevisorPpc.ts` (o serviço da revisão prévia: pedido, base do `kb.sqlite`, Worker, cópia), `trabalhador.ts` (o Worker), `RevisaoIa.ts` (a revisão com IA: preparar, executar, pausar, retomar, acompanhar), `preparo.ts` (o plano e os pedidos) e `julgamento.ts` (a sessão de um bloco, a conferência e a nova tentativa; `turnoSemFerramentas`, a sessão de um turno que as ações da lista viva também usam) e `ListaViva.ts` (a lista viva, o envio da versão corrigida e as ações por pendência); `persistencia/Listas.ts`, a lista no banco.
- `src/PastasTrabalho.ts` (pastas de tarefa, anexos, relatos, cópias e Desfazer), `src/pastas-node.ts` (o que fica com o Node), `src/nome-livre.ts` (` (2)`, ` (3)`…) e `src/ArquivosLiberados.ts` (a liberação do desktop, que a revisão prévia e o "Anexar" exigem).
- `src/Autenticacao.ts`, `src/Conversas.ts` (motor + MCP por conversa, gravação, retomada e ciclo de vida da sessão), `src/CatalogoSkills.ts` (as skills do app), `src/handlers.ts`.
- `src/persistencia/`: `Banco.ts` (o `node:sqlite` com os `PRAGMA` e as migrações do T3), `Historico.ts` (conversas, itens, avaliações, anexos e relatos), `Revisoes.ts` (as revisões com IA e os blocos) e `migracoes/`.
- `src/t3/`: cópia do T3 (`launcherWatch.ts`), com `NOTICE`; registro em `docs/upstream-t3.md`.

## Testes

```bash
pnpm --filter @simplifica-if/server test        # pasta-trabalho.test.ts: pasta da tarefa (nome seguro, colisão), anexo só liberado, cópia por turno, Desfazer duas vezes, recusa no meio do turno, limite de tamanho e de cópias, 👍/👎 e a skill indicada no primeiro turno; servidor em portas efêmeras com drivers falsos; o bin.ts como processo; a revisão prévia com o Worker de verdade (revisao-ppc.test.ts: etapas, cópia única e a travada, recusas, bomba ZIP, estouro de memória e de tempo, laço de eventos livre); a revisão com IA com um driver de teste (revisao-ia.test.ts: sessões sem ferramentas, JSON inválido, trecho inventado, norma fora do contexto, injeção, limite de taxa no meio e retomada); a lista viva com o mesmo driver (lista-viva.test.ts: a situação que passa da pré-conferência para a revisão com IA, a régua, "Qual é o curso?", "Enviar a versão corrigida", contestação com evidência, autoridade, trecho inventado e injeção no motivo e no PPC, sugestão com fato inventado, nova revisão pelo arquivo novo, cópia com a situação, uso somado à revisão, lista que sobrevive a reabrir o banco)
SIMPLIFICA_POC_REAL=1 SIMPLIFICA_PROVIDER=claude pnpm --filter @simplifica-if/server test real   # provider real, pelo RPC
SIMPLIFICA_POC_REAL=1 SIMPLIFICA_PROVIDER=claude pnpm --filter @simplifica-if/server test ciclo-real   # ciclo de vida da conversa
SIMPLIFICA_POC_REAL=1 SIMPLIFICA_PROVIDER=codex pnpm --filter @simplifica-if/server test skills-real   # uma skill do app numa conversa real
```

O filtro do vitest casa com o nome do arquivo por substring: `test real` roda também o `ciclo-real` e o `skills-real`, e `test real.test` também. Para rodar só um, use o nome inteiro (`test test/real.test.ts`).

**Revisão com IA, teste real (16/11/2026):** `scripts/revisao-ia-real.ts`, uma execução por provider, sobre o PPC de Técnico em Enfermagem (Curitiba) da base convertido para DOCX, com a instrução escondida na seção 5.1. Os números e a revisão estão no plano do app (M1.11, etapa 4): Claude, modo rápido, 22 critérios em 5 blocos, 64 s e US$ 0,48 equivalentes, nenhuma resposta recusada na conferência; Codex e Antigravity, um lote S de 3 critérios cada, 22 s, válidos na primeira resposta. Segunda execução com o Claude, com os recortes estruturados: INCONCLUSIVO de 15 para 13, 115 s, US$ 1,11 pelos tokens sem o bloco fixo do segundo turno.

O `skills-real` abre uma conversa sobre o catálogo do `.agents/skills` e pergunta pelos rótulos de classificação da `verificar-fundamentacao-normativa`. Sem `SIMPLIFICA_PROVIDER`, roda os três. Em 16/11/2026 passou nos três, sempre com a leitura do `.simplifica/skills/verificar-fundamentacao-normativa/SKILL.md` gravado na pasta de trabalho, nenhum pedido de aprovação e os sete rótulos na resposta:

| Provider | Tempo | Leitura do `SKILL.md` |
|---|---|---|
| Claude (Pro) | 4,2 s | `Read` |
| Codex (0.169.0) | 7,3 s | `cat` pelo shell, dentro do sandbox `read-only`, sem aprovação |
| Antigravity (`agy` 1.5.9) | 19,6 s | `read_file` |

O `ciclo-real` roda as `Conversas` sobre os drivers reais e um banco temporário: três turnos (o terceiro com uma ferramenta `ifpr`), escrita fora da pasta de trabalho negada pela política sem perguntar, interromper depois da primeira ferramenta e um turno em seguida, retomada depois de fechar a layer (lembrando a primeira palavra), SIGKILL no processo do provider no meio de um turno (`caiu`) e um turno depois, que o reabre. Sem `SIMPLIFICA_PROVIDER`, roda os três. Em 15/11/2026, com o Claude (Pro, Claude Code 2.1.325), tudo passou: turnos de 1 a 3 s, retomada nativa nas duas vezes, o turno da queda fechado 0,1 s depois do SIGKILL. Em 16/11/2026 passou também nos outros dois:

| | Codex (codex-cli 0.169.0) | Antigravity (`agy` 1.5.9) |
|---|---|---|
| teste inteiro | 27 s | 92 s |
| sessão aberta | 0,6 s | 1,5 s |
| turnos simples | 1 a 3 s | 4 a 10 s |
| turno com `ifpr` | 6 s | 21 s |
| escrita fora da pasta | negada sem pergunta; o modelo explica em uma frase | negada sem pergunta; o modelo encerra o turno **sem texto** |
| interromper | `interrupted`, fechado na hora | `cancelled`, fechado na hora |
| retomada depois de fechar e depois da queda | nativa (`thread/resume`) | nativa (`session/load`) |
| queda (SIGKILL) | `Erro` "o processo do codex encerrou", `caiu`, reaberta | `Erro` "o processo do agy encerrou", `caiu`, reaberta |

Até 16/11/2026, a queda do Codex mostrava a mensagem do transporte em inglês ("Codex App Server transport operation 'read-process-exit-status' failed."); o driver agora monta a frase em português (`falhaQuedaCodex`). A resposta vazia do Antigravity depois da negação é comportamento do `agy`: a interface mostra a ferramenta que falhou, e o turno fecha normalmente.

O teste real gasta a assinatura do usuário e usa a pasta de estado do harness do motor (`SIMPLIFICA_ESTADO` ou `~/Library/Application Support/simplifica-if-poc`). Ele imprime no stderr, por turno, as ferramentas (nome, entrada, resumo), o tempo e os links `ifpr://` da resposta; no Antigravity, um segundo turno confere que o `read_resource` de um link `ifpr://` sai com o resumo que o servidor viu.

## Pendências

- ~~**Ciclo real no Codex e no Antigravity.**~~ Resolvida em 16/11/2026: passou nos dois, com retomada nativa. O `agy` 1.5.9 anuncia `loadSession` (e `sessionCapabilities.resume`); se uma versão deixar de anunciar, a conversa recomeça com o histórico como contexto.
- ~~**Skills do app nas conversas.**~~ Resolvida: o `CatalogoSkills` as passa a toda conversa (ver [Skills do app](#skills-do-app)), com teste real verde nos três providers. A revisão de PPC é a tarefa nativa (`revisaoPpc.revisar`), sobre as fichas de `base-conhecimento/revisao-ppc/`; as etapas com IA são as 4 e 5 do M1.11.
- **Lista viva (etapa 5b):** o cache entre as ações da mesma pendência não é reaproveitado (ver a seção); dois caminhos a medir: o prefixo comum no prompt de sistema (lido do cache entre sessões, mas põe o PPC no sistema) ou um `cache_control` no meio da mensagem, se o Agent SDK passar a aceitar. A abertura da parada com IA e a pré-busca da seguinte (a proposta B) não foram feitas: o roteiro percorre a lista que a pré-conferência e o relatório com IA produziram. O recorte da ficha D não traz sempre o trecho apontado pelo código (no teste real, a citação da Res. 54/2011 ficou fora do recorte da CT-SUP-12, e a IA disse isso).
- **Revisão prévia:** a revisão é uma chamada só, sem andamento por etapa (a conversão e a pré-conferência levam menos de 1 s nos PPCs de teste); a interface não deixa escolher o curso quando a identificação falha (o RPC já aceita `cnct` e `forma`); a comparação da base do `kb.sqlite` com a dos arquivos virou teste (`revisao-ppc-base.test.ts`).

- ~~**Ponte no app empacotado.**~~ Resolvida com o `apps/desktop`: o comando da ponte sai do `argv` do processo (`src/ponte.ts`), e o bundle roda a ponte com o Electron como Node (conferido no app empacotado).
- **Windows:** o `awaitLauncherLoss` do T3 não age no Windows; ali o cordão é só o stdin.
- ~~**Erros do motor no contrato.**~~ Resolvida: os erros e a `Decisao` ficam em `@simplifica-if/motor/erros`, só schemas, e o `@simplifica-if/contratos-app` importa do motor só eles e os tipos dos estados. O bundle da interface não leva mais o `Motor.ts` (o `sem-servidor.test.ts` confere).
- **Observabilidade:** logs simples no stderr, que o desktop copia para o arquivo de log do app (`apps/desktop/src/registro.ts`); sem OTLP.
