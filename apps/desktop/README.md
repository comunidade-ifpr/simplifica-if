# @simplifica-if/desktop

O app desktop do Simplifica IF (M1.1): o processo principal do Electron 44, que inicia o servidor local ([`apps/server`](../server/README.md)) e mostra a interface ([`apps/web`](../web)) numa janela. Segue o desenho do `apps/desktop` do T3 Code, reduzido ao que o app faz; o que foi copiado está em [`docs/upstream-t3.md`](../../docs/upstream-t3.md).

- Nome: **Simplifica IF**; `appId`: `io.github.comunidade-ifpr.simplifica`.
- A pasta do app (`app.getPath("userData")`): `~/Library/Application Support/Simplifica IF` no macOS, `%APPDATA%\Simplifica IF` no Windows; no desenvolvimento, `Simplifica IF (dev)`. É também a `--pasta-estado` do servidor (as CLIs gerenciadas e o perfil do Antigravity).

## Como rodar em desenvolvimento

Na raiz do repositório:

```bash
pnpm install          # uma vez, e depois de cada pull que mude dependências
pnpm app:dev          # abre o app; o mesmo que pnpm --filter @simplifica-if/desktop dev
```

O `app:dev` faz tudo num terminal só:

1. constrói o processo principal e o preload em `dist/app` e baixa o Electron, se faltar;
   no macOS, roda o Electron de uma cópia do `Electron.app` em `dist/electron-dev`, com o nome e o ícone do app, porque o nome no menu e o ícone no Dock vêm do `Info.plist`, não de `app.setName`;
2. recompila o `tmp/kb.sqlite`, a base do servidor, se ele faltar ou estiver mais velho que as fontes ou que o esquema do código (cerca de 12 s; com `SIMPLIFICA_KB`, não mexe na base);
3. garante a interface: se `http://localhost:5190` já responde (por exemplo, `pnpm --filter @simplifica-if/web dev` noutro terminal), usa essa; senão, inicia o `apps/web` e espera ficar pronto;
4. abre o Electron, que inicia o servidor com o Node do repositório (`node apps/server/src/bin.ts`) e carrega a interface.

Ctrl+C ou fechar a janela encerra tudo, inclusive a interface que o `app:dev` iniciou. Mudanças em `apps/web` aparecem na hora; mudanças em `apps/server/src` ou em `packages/` reiniciam o servidor sozinhas (a janela recarrega; `src/vigiaDev.ts`), para a interface nova não falar com o servidor velho; mudanças em `apps/desktop/src` pedem fechar e rodar de novo.

Se a interface não responder, a janela tenta carregá-la 8 vezes, em cerca de 10 s, e desiste com uma mensagem no terminal dizendo o que rodar. Se a porta 5190 estiver ocupada por outro programa, o `apps/web` não sobe (`strictPort`) e o `app:dev` para com o aviso.

| Variável | Padrão | Uso |
|---|---|---|
| `SIMPLIFICA_WEB_URL` | `http://localhost:5190` (o `PORTA_DEV` do `apps/web/vite.config.ts`) | o dev server da interface; vazia, a janela carrega o build em `dist/app/web` pelo protocolo `simplifica://app`, como no app empacotado |
| `SIMPLIFICA_NODE` | o Node que rodou o `dev` | o Node que roda o servidor em desenvolvimento |
| `SIMPLIFICA_KB` | `tmp/kb.sqlite` | a base (`--banco`) |
| `SIMPLIFICA_DEV_SEM_REINICIO` | vazia | `1` desliga o reinício do servidor quando o código dele muda (por exemplo, no meio de uma conversa longa) |
| `SIMPLIFICA_TRACES` | `completo` | o que o servidor grava em `traces.jsonl` (`--traces`): `completo`, `caixa-preta` (como no app empacotado) ou `desligado`; no app empacotado é sempre `caixa-preta` |

Argumentos depois de `dev` vão ao Electron, por exemplo `--remote-debugging-port=9333` para inspecionar a janela pelo Chrome DevTools Protocol.

## Como empacotar

O bundle do servidor leva também os Workers da revisão prévia, `servidor/trabalhador-ppc.mjs`, e da versão em texto dos anexos, `servidor/trabalhador-textos.mjs`, cada um num bundle à parte, sem pedaços compartilhados com o `bin.mjs` (`scripts/construir.ts`).

```bash
pnpm --filter @simplifica-if/desktop build          # os bundles em dist/ (servidor, interface, processo principal, preload)
pnpm --filter @simplifica-if/desktop dist           # o instalador desta plataforma em dist/pacotes
pnpm --filter @simplifica-if/desktop dist --dir  # só o app, sem dmg (dist/pacotes/mac-arm64/Simplifica IF.app)
pnpm --filter @simplifica-if/desktop dist --win  # Windows (NSIS por usuário), a partir de outra máquina
pnpm --filter @simplifica-if/desktop dist --base-dev  # build local, com a base de desenvolvimento (dev-<hash>)
```

O `build` gera:

| Saída | O quê |
|---|---|
| `dist/app/main.cjs`, `dist/app/preload.cjs` | o processo principal e o preload, em CommonJS; só o `electron` fica de fora |
| `dist/app/web/` | o build do `apps/web` (`pnpm --filter @simplifica-if/web build`); sem ele, a página provisória de `src/provisoria/`, que confere a ponte e o servidor |
| `dist/app/package.json` | o manifesto do app, sem dependências |
| `dist/recursos/skills/` | as skills do app (`scripts/skills.ts`): as de `catalogo/skills`, todas com o bloco `simplifica:` válido, e a lista das retiradas (`retiradas.yaml`); de cada skill, só o `SKILL.md` e os arquivos listados em `simplifica.arquivos` (nada de `scripts/`, `tests/` ou `README.md`); uma skill do app inválida faz o build falhar |
| `dist/recursos/tarefas/` | os manifestos de tarefa (`scripts/tarefas.ts`), de `catalogo/tarefas`, e o `origem.json` (o commit do checkout e a data dele, que ordenam o catálogo do instalador contra o baixado pelo canal; o build precisa do git e recusa data do commit inválida ou no futuro); um manifesto inválido, que cita skill que não foi copiada ou módulo que o app não tem, ou de `app_minimo` menor que o da skill que cita, faz o build falhar. Em desenvolvimento, o desktop passa `--tarefas-do-checkout` ao servidor: o catálogo do checkout vence o baixado |
| `dist/recursos/servidor/` | o servidor (`apps/server/src/bin.ts`) em ESM, com as dependências dentro, menos `bufferutil` e `utf-8-validate` (opcionais do `ws`, que segue sem eles) e o `undici`, copiado em `node_modules/` ao lado (o `effect` o carrega por `import()` e usa os exports nomeados do CommonJS, que o bundle não reproduz) |
| `dist/recursos/LICENCAS.md` | a licença do app e a de cada pacote de terceiros que o bundler pôs no processo principal, no servidor, nos Workers e na interface (`scripts/licencas.ts`; a interface pelo `build.license` do `apps/web`), mais o `undici` copiado; no pacote, `Resources/LICENCAS.md`. O Electron e o Chromium trazem os próprios arquivos de licença |

O `dist` acrescenta a base (`dist/recursos/base/kb.sqlite`, de `SIMPLIFICA_KB` ou `tmp/kb.sqlite`) e chama o electron-builder (`scripts/empacotar.ts`), sem assinatura e sem publicação. A base precisa ter a versão da fábrica (`SIMPLIFICA_KB=tmp/fabrica/bases/<versao>.sqlite`): o `dist` recusa, antes de construir, a base de desenvolvimento (`dev-<hash>`, a do `pnpm kb:compilar`), que perde para qualquer baixada e não faz patch; `--base-dev` a aceita, para um instalador local que não se distribui.

- macOS: dmg e zip; Windows: NSIS por usuário (`oneClick`, sem pedir administrador);
- o processo principal, o preload e a interface vão no `app.asar`; o servidor, a base, as skills e as tarefas vão fora dele, em `Resources/servidor`, `Resources/base`, `Resources/skills` e `Resources/tarefas`: o servidor roda no Node do Electron como módulos ES, e o SQLite precisa de um arquivo de verdade;
- o ícone é `recursos/icone.icns` (macOS) e `recursos/icone.ico` (Windows), gerados com o resto da marca por `node scripts/gerar-marca.ts` (veja [`docs/marca/`](../../docs/marca/README.md)).

## Partida e encerramento

1. O processo principal gera um token (32 bytes aleatórios, base64url) e inicia o servidor como processo filho (`src/servidor.ts`):
   - em desenvolvimento, `node apps/server/src/bin.ts`;
   - no app empacotado, o próprio executável com `ELECTRON_RUN_AS_NODE=1` sobre `Resources/servidor/bin.mjs`;
   - com `--banco`, `--pasta-estado` e `--pasta-skills` (no desenvolvimento, `catalogo/skills` do checkout; no app empacotado, `Resources/skills`; sem a pasta, o servidor sobe sem skills) e `--pasta-tarefas` (`catalogo/tarefas` do checkout ou `Resources/tarefas`, com o `origem.json` do build; sem a pasta, sem cartões no Início); o token e a origem da janela vão no `EnvelopePartida`, na primeira linha do stdin. Nunca na linha de comando nem no ambiente (o `SIMPLIFICA_SERVIDOR_TOKEN` herdado sai do ambiente do filho).
2. Lê a `LinhaPartida` do stdout (prazo de 60 s) e abre a janela. O stderr do servidor (os logs) passa ao stderr do app e ao arquivo de log, junto com o que o processo principal registra (`src/registro.ts`): `simplifica-if.log` em `~/Library/Logs/Simplifica IF` no macOS e em `<pasta do app>\logs` no Windows (no desenvolvimento, em `<pasta do app>/logs`); passando de 5 MB, o arquivo vira `simplifica-if.log.1` e outro começa. A interface também escreve nele, por `registrarErro` (linhas `[interface]`): as chamadas ao servidor que terminam num defeito ou na queda da conexão, as telas que quebram e os erros sem dono da janela. Cada falha de chamada leva o código do erro (`codigoDoErro`, os 8 primeiros caracteres do `traceId` do pedido), o mesmo no log do servidor e em "Detalhes técnicos": com o código que a pessoa informa, acha-se o pedido no log. Na mesma pasta, o servidor grava os spans e os logs dele em OTLP/JSON (`traces.jsonl`, `logs-otlp.jsonl`; `--pasta-logs` e `--traces`, ver [`apps/server`](../server/README.md#traces-e-logs)): tudo no desenvolvimento, e no app empacotado a caixa-preta, só os traces com erro ou lentos. `pnpm traces --codigo <código>` mostra a árvore do pedido. Um defeito de handler aparece duas vezes, de propósito: no log do servidor e na linha `[interface]`, com o mesmo código. A queda da conexão vira uma linha só a cada 10 s, com os códigos das chamadas afetadas; a interface omite os valores que o Schema cita ao recusar um payload, e o processo principal aceita no máximo 120 registros por minuto.
3. A interface pede a conexão pelo preload: `window.simplifica.conexao()` devolve `{ urlServidor: "http://127.0.0.1:<porta>", token }`. O processo principal só responde ao quadro principal da janela do app, na origem da interface.
4. Ao sair (fechar a janela, Cmd+Q, SIGINT ou SIGTERM), fecha o stdin do servidor e espera 5 s; se ele não sair, SIGTERM e, 2 s depois, SIGKILL. Se o app morrer, o servidor sai sozinho: o stdin fecha e o processo pai muda (`launcherWatch.ts`).
5. Se o servidor cair, ou não subir, um diálogo diz em português que o app parou por um problema interno, com o motivo (o fim do stderr) sob "Detalhes técnicos", e oferece **Reiniciar** (novo token, nova porta, a janela recarrega) ou **Sair**.

## A base no app empacotado (decisão)

A ordem é `SIMPLIFICA_KB`, depois a mais nova entre `<pasta do app>/base/kb.sqlite` (a baixada) e a base empacotada (`Resources/base/kb.sqlite`). O desktop passa a empacotada em `--banco` e a pasta do app em `--pasta-atualizacao`; quem escolhe é o servidor, na abertura, depois de atender a troca pendente (um app novo pode trazer uma base mais nova que a baixada). Com `SIMPLIFICA_KB`, a atualização fica desligada. O instalador leva a base inteira (cerca de 140 MB).

## Atualização (M1.10)

- **Base e skills:** o servidor (`packages/atualizacao/README.md`). O desktop só passa `--pasta-atualizacao` e `--versao-app` e oferece `reiniciarServidor`, porque a troca do arquivo só acontece na abertura do servidor (no Windows, um arquivo aberto não se renomeia). No desenvolvimento, a atualização liga só com `SIMPLIFICA_ATUALIZACAO_FEED` (com `SIMPLIFICA_ATUALIZACAO_CHAVE`), para testar contra um feed local.
- **Proxy:** antes de iniciar o servidor, o processo principal resolve a proxy do sistema para a URL do feed (`session.resolveProxy`) e a passa em `HTTPS_PROXY` e `HTTP_PROXY`, salvo se o ambiente já as tem (`src/proxy.ts`, `proxyParaServidor`).

## Preload (`window.simplifica`)

```ts
interface PonteDesktop {
  conexao(): Promise<{ urlServidor: string; token: string }>; // espera o servidor ficar pronto
  abrirExterno(url: string): Promise<void>;                    // só http(s), no navegador do sistema
  escolherDocx(): Promise<string | null>;                      // diálogo de arquivo, só .docx; null se cancelar
  soltarDocx(arquivo: File): Promise<string | null>;           // .docx solto (arrastar e soltar); null se recusado
  abrirDocumento(caminho: string): Promise<void>;              // abre no Word a cópia comentada ou o .docx escolhido nesta execução (o acompanhado)
  mostrarNaPasta(caminho: string): Promise<void>;              // mostra a cópia comentada no Finder/Explorador
  escolherAnexo(extensoes?: readonly string[]): Promise<string | null>; // diálogo de anexo, só documentos; libera no servidor
  anexarSoltos(arquivos: readonly File[], extensoes?: readonly string[]): Promise<readonly (string | null)[]>;
  abrirArquivoTarefa(caminho: string): Promise<void>;          // abre um documento de Documentos/Simplifica IF/<tarefa>/
  mostrarArquivoTarefa(caminho: string): Promise<void>;        // mostra um arquivo da pasta da tarefa
  pastaParaLixeira(caminho: string): Promise<void>;            // manda à Lixeira a pasta da tarefa
  reiniciarServidor(): Promise<void>;                          // reinicia o servidor (troca da base, M1.10)
  registrarErro(texto: string): Promise<void>;                 // grava um erro da interface no log do app
  janela: JanelaDesktop;                                       // a janela: barra de título, várias janelas, avisos, modo compacto
}
```

`JanelaDesktop` (o contrato inteiro em `@simplifica-if/contratos-app/ponte`): a plataforma e a tela cheia (os botões do sistema na barra de título), o tema escolhido no app (`temaDoApp`), os atalhos do menu (`aoAtalhoDoMenu`: Buscar na base, Mostrar ou esconder o painel, Perguntar à IA, Abrir em nova janela), as várias janelas (`abrirJanela(rota)` e `continuidade`: `completa`, `so-grava` ou `nenhuma`), o aviso e o selo do sistema (`avisar`, `selo`, `aoAbrirRota`; `src/avisos.ts`), o modo compacto (`compacta(ligar)`, que devolve se ligou, e o alfinete `naFrente`; `src/compacta.ts`) e a gravação da continuidade antes de fechar (`antesDeSair`; `src/antesDeSair.ts`).

**Pasta das tarefas (M1.9).** O processo principal passa ao servidor `--pasta-trabalhos` com `Documentos/Simplifica IF` (`app.getPath("documents")`; `SIMPLIFICA_TRABALHOS` troca no desenvolvimento). `escolherAnexo` abre o diálogo só com extensões de documento (`EXTENSOES_DOCUMENTO`: Word, ODF, PDF, Markdown, texto, planilhas, apresentações, JSON, imagens), confere a extensão de novo e libera o arquivo no servidor, que o copia para a pasta da tarefa. `abrirArquivoTarefa` e `mostrarArquivoTarefa` só aceitam um arquivo pelo menos dois níveis abaixo da raiz (`<raiz>/<tarefa>/…`), com caminho normalizado, sem parte oculta (`.simplifica/`), arquivo comum e com o caminho real dentro da raiz (`arquivoDeTarefaPermitido` de `src/seguranca.ts`); "Abrir" ainda exige extensão de documento, porque a IA escreve na pasta e "Abrir" não pode virar "rodar" (`.command`, `.exe`, `.html` ficam só com "Mostrar na pasta").

**Revisão prévia de PPC (M1.11).** `escolherDocx` abre o diálogo com o filtro `.docx` e confere a extensão de novo (o filtro pode ser contornado com "Todos os arquivos"); o processo principal guarda os arquivos escolhidos nesta execução e, quando necessário após reiniciar o app, sincroniza os caminhos das revisões ativas no servidor (`GET /arquivos/liberados` com o `tokenDesktop`, separados em `originais` e `acompanhados`). `soltarDocx` faz o mesmo com o `.docx` solto na área de soltar: o preload tira o caminho do `File` (`webUtils.getPathForFile`, `""` para `File` criado por script), e o processo principal confere a extensão e que é arquivo comum. Depois do diálogo, o processo principal libera o arquivo no servidor (`POST /arquivos/liberar` com o `tokenDesktop`, um segundo segredo gerado a cada partida e passado só no envelope), e o servidor só revisa arquivos liberados ou vinculados a uma revisão ativa no banco. `mostrarNaPasta` (`shell.showItemInFolder`) só aceita a cópia comentada de um original autorizado: mesma pasta, `<nome> - revisão prévia (Simplifica IF) <data e hora>.docx` (uma por revisão, regravada pela própria revisão) ou, com o nome ocupado, com ` (2)` a ` (99)`, caminho normalizado e arquivo comum (não link, não pasta), por `copiaComentadaPermitida` de `src/modulos/revisao-ppc/seguranca.ts`; `abrirDocumento` (`shell.openPath`) aceita a cópia comentada, o original ou o acompanhado da revisão (`documentoPermitido`). Assim a interface não abre outro arquivo do computador por esse caminho. Esses quatro canais são do módulo `revisao-ppc` e moram com ele (`src/modulos/revisao-ppc/`: `ipc.ts`, os canais, registrados pelo `src/ipc.ts` com o mesmo `tratar`; `preload.ts`, a parte dele em `window.simplifica`; `seguranca.ts`, as regras; testes em `test/modulos/revisao-ppc/`); a regra é a mesma, e a ponte continua estreita, por caso de uso. O `src/ipc.ts`, o `src/preload.ts` e o `scripts/construir.ts` (o Worker `trabalhador-ppc`) são arquivos de composição: só eles citam o módulo (a lista em `ferramentas/oxlint-plugin/modulos.ts`).

O contrato (`PonteDesktop`, os canais do IPC, os caminhos do servidor, a variável do token, `EXTENSOES_DOCUMENTO` e a `LinhaPartida`) está em `@simplifica-if/contratos-app/ponte`, um módulo sem nenhum import: o processo principal, o preload e a interface o importam, e o `main.cjs` continua sem o Effect. O token nunca vai para log.

## Segurança da janela

Como no T3:

- `contextIsolation`, `sandbox`, sem `nodeIntegration` e sem `<webview>`;
- navegação só na origem da interface; links para fora, e `window.open`, abrem no navegador do sistema se forem http(s), e os outros esquemas são recusados; a janela nova do app sai só pelo canal `abrirJanela`, com uma rota do app (`/…`, sem outro host, sem controle nem barra invertida, até 4 000 caracteres);
- nenhuma permissão do navegador (câmera, notificações…), salvo escrever na área de transferência;
- uma instância só do app.

Na interface empacotada, a CSP vai em cada resposta do protocolo `simplifica://app` (`src/seguranca.ts`), mais estreita que a do T3:

- `connect-src` só para o servidor local na porta desta execução;
- `script-src 'self'` mais o hash dos scripts inline do `index.html` (o do tema);
- sem `eval`, `object-src 'none'`, `frame-src 'none'`.

No desenvolvimento, a janela carrega o dev server sem CSP: o Vite precisa de script inline e do WebSocket do HMR.

## Estrutura

- `src/main.ts`: o processo principal (servidor, janelas, atualização, ciclo de vida); `src/ipc.ts`: os canais do IPC, cada um atrás de `tratar`, que só atende uma janela do app e passa a que pediu (os diálogos ficam presos a ela); `src/protocolo.ts`: o protocolo `simplifica://app/`; `src/menu.ts`: o menu em pt-BR, com "Abrir em nova janela" (⇧⌘N) no Arquivo.
- `src/janelas.ts`: as várias janelas ("Abrir em nova janela", ⇧⌘-clique, e o ⇧-clique ou ⌘-clique num link do app, que o `setWindowOpenHandler` transforma em janela do app), sem Electron: o conjunto na ordem de uso (a última usada recebe o `second-instance`, os atalhos do menu e o clique do aviso sem janela certa), no máximo `MAXIMO_JANELAS` abertas, a janela nova em cascata a partir da que pediu, dentro da área útil da tela dela, e no centro dela quando a que pediu está no modo compacto, maximizada ou em tela cheia (`medidasDaJanelaNova`), a principal (só ela grava e volta a continuidade; fechada, a próxima janela aberta passa a ser a principal e grava sem voltar; o argumento `--simplifica-continuidade=…`, lido pelo preload em `JanelaDesktop.continuidade`), o remetente conferido do IPC (sem ler o `webContents` da janela fechando) e a rota da janela nova. O modo compacto é de cada janela (`porJanela`, que solta a espera da tela cheia da janela que fecha), o tema vale para todas, e fechar a última janela sai do app. O aviso do sistema vale pelo primeiro pedido, de qualquer janela, e os repetidos saem descartados (`avisos.ts`).

- `src/servidor.ts`: o token, a montagem do comando, a linha de partida e o encerramento; sem Electron.
- `src/configuracao.ts`: de onde vêm o servidor, a base, a interface, a pasta de estado e a de skills; sem Electron.
- `src/seguranca.ts`: CSP, navegação, links externos, anexos, pastas de tarefa e arquivos do protocolo; sem Electron.
- `src/modulos/revisao-ppc/`: a ponte do módulo da revisão de PPC (`ipc.ts`, `preload.ts` e `seguranca.ts`, sem Electron).
- `src/registro.ts`: o arquivo de log, com o giro em 5 MB; sem Electron.
- `src/vigiaDev.ts`: só no desenvolvimento, reinicia o servidor quando o código dele muda; sem Electron.
- `src/reinicio.ts`: a troca do servidor, uma de cada vez; sem Electron.
- `src/preload.ts`: a ponte (o contrato está em `@simplifica-if/contratos-app/ponte`), com a parte de cada módulo.
- `src/compacta.ts`: o modo compacto de uma janela, sem Electron (`criarJanelaCompacta`: guarda as medidas, sai da tela cheia e do maximizado, encosta a coluna à direita da área útil, o "sempre por cima" e o alfinete, e desfaz tudo ao desligar).
- `src/avisos.ts`: o aviso do sistema (`Notification`, só sem janela à vista ou, no compacto, com a janela oculta; o clique traz a janela que mostra a rota) e o selo do Dock.
- `src/antesDeSair.ts`: espera a janela gravar a continuidade (até 1 s) no `before-quit` e ao fechar a janela, antes de encerrar o servidor.
- `src/janela.ts`: a barra de título sem moldura do sistema (os semáforos do macOS, o `titleBarOverlay` do Windows); sem Electron.
- `scripts/construir.ts`, `scripts/empacotar.ts`, `scripts/skills.ts` e `scripts/tarefas.ts` (as skills e os manifestos de tarefa do app no pacote), `scripts/dev.ts`, `scripts/gerar-marca.ts` (com `scripts/marca/`).
- `scripts/t3/`: cópia do T3 (`ensure-electron-runtime.mjs`), com `NOTICE`.

**Só português (M1.14).** O menu (Sobre, Ocultar, Sair, Editar com Desfazer, Copiar e Colar, Ver, Janela), os títulos e botões dos diálogos de abrir arquivo e de confirmação e o painel Sobre (`setAboutPanelOptions`) estão em pt-BR. O Chromium sobe com `--lang=pt-BR` (`navigator.language`, o `Intl` padrão e os textos do próprio Chromium), seja qual for a língua do sistema. O que é do macOS (Cancelar e Abrir nos diálogos, os itens que o sistema acrescenta ao menu Editar, "Versão" no painel Sobre) segue as localizações que o pacote declara: o empacotamento põe `CFBundleDevelopmentRegion` em `pt-BR` e tira de `Contents/Resources` as pastas `*.lproj` vazias das outras línguas (`deixarSoPortugues`, no `afterPack`), ficando só o `pt_BR.lproj`; os `locale.pak` do Chromium, no framework, continuam pt-BR e en-US (`electronLanguages`), porque o en-US é a reserva do Chromium. O instalador NSIS do Windows sai em português (`language: "1046"`, sem escolha de língua). No Windows, os diálogos de arquivo são do sistema e seguem a língua dele: o app põe em português o título, o botão de confirmar e o nome do filtro (`title`, `buttonLabel`, `filters`), e o resto ("Cancelar", "Nome do arquivo", o painel de navegação) vem do Windows. O Electron não tem opção para mudar isso (o `--lang` vale só para o Chromium, e não há `app.setLocale`): é um limite aceito.

O processo principal não usa Effect: as APIs do Electron são de callback, e o `main.cjs` fica pequeno, sem runtime. O servidor, que é Effect, roda noutro processo.

## Testes

```bash
pnpm --filter @simplifica-if/desktop test
```

- `test/servidor.test.ts`: o token, a linha de partida, os argumentos e o ambiente (sem o token na linha de comando) e o encerramento (stdin, SIGTERM, SIGKILL, saída antes de ficar pronto), com processos Node falsos.
- `test/configuracao.test.ts`: os caminhos no desenvolvimento e no app empacotado, a CSP, a navegação, os links externos e os arquivos do protocolo.
- `test/integracao.test.ts`: o servidor de verdade (`apps/server`, banco de fixture, nenhum provider chamado), iniciado como o app o inicia: a linha de partida, o `POST /ingresso` com o token e a origem da janela, as recusas e o encerramento pelo stdin. Se o bundle (`build`) e o Electron existirem, repete com o Electron como Node sobre o bundle.
- `test/empacotar.test.ts`: a identidade e os alvos do electron-builder, e a cópia das skills do app (só as elegíveis, só os arquivos listados; uma inválida faz o build falhar) e dos manifestos de tarefa.
- `test/registro.test.ts`: o arquivo de log (pasta criada, acréscimo, giro no limite, falha sem derrubar o app), a linha `[interface]` (quebras, ANSI e controles) e o teto por minuto.
- `test/vigia-dev.test.ts`: que arquivos reiniciam o servidor no desenvolvimento, e que uma pasta que falta ou um vigia que falha não derrubam o app.
- `test/reinicio.test.ts`: a troca do servidor, uma de cada vez (pedidos no meio viram uma troca só, depois).
- `test/proxy.test.ts`: conversão da proxy resolvida pelo Electron (`proxyParaServidor`) para `HTTPS_PROXY`/`HTTP_PROXY`.
- `test/janelas.test.ts`: as várias janelas com `BrowserWindow` falsas: a principal, a última usada, o teto, a continuidade e as medidas da janela nova, o remetente do IPC por janela (também a fechando) e a rota recusada; `test/compacta.test.ts` e `test/avisos.test.ts` cobrem o modo compacto por janela (e a janela que fecha no meio da saída da tela cheia) e o aviso com duas janelas (o primeiro pedido, os repetidos, o clique sem navegar na janela que já mostra a rota).
- `test/compacta.test.ts`: o modo compacto com `BrowserWindow` falsa: as medidas e a restauração no macOS e no Windows, o maximizado e a tela cheia (com a reserva da espera), o alfinete, as medidas que já não caem numa tela e a janela que fecha.
- `test/avisos.test.ts`: o aviso do sistema com `Notification` e janelas falsas: só com a janela sem foco (no compacto com o alfinete preso, só com ela oculta ou minimizada), o texto fixo, o clique que traz a janela, as notificações guardadas com teto, o selo.
- `test/antes-de-sair.test.ts`: a gravação da continuidade antes de fechar: a resposta do mesmo pedido, vinda da janela a que ele foi; o prazo que solta o fechamento; a janela que já se foi; o segundo fechar sem pedir de novo; a saída do app sem pedir duas vezes.
- `test/janela.test.ts`, `test/marca.test.ts` e `test/licencas.test.ts`: a barra de título, os ícones gerados e o arquivo de licenças.

Nenhum teste abre janela. O T3 tem um smoke do app empacotado (`scripts/smoke-desktop-app.ts`, Playwright com `_electron`) que roda nos jobs de release; aqui ele fica como pendência do CI. Para conferir o app de verdade, empacote com `--dir` e abra o `.app`; com `--remote-debugging-port`, a página pode ser lida pelo CDP.

## Pendências

- **Assinatura de código e notarização** (macOS: Developer ID e notarização; Windows: certificado). Sem elas, o macOS pede "Abrir mesmo assim" e o Windows mostra o SmartScreen.
- **Instaladores no CI** (macOS e Windows), com o `kb.sqlite` da fábrica e um smoke do app empacotado, como o `smoke-desktop-app.ts` do T3.
- **Windows:** o `dist --win` e o app no Windows ainda não foram testados; ali o cordão do servidor é só o stdin (o `awaitLauncherLoss` do T3 não age no Windows).
- **Atualização do app ligada:** depende da assinatura de código (acima) e do feed na política (repositório público); ver `packages/atualizacao/README.md`, "O que falta para ligar em produção".
- **Tamanho:** o instalador leva a base inteira e o Electron com as línguas pt-BR e en-US.
