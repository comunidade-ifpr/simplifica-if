# @simplifica-if/desktop

O app desktop do Simplifica IF (M1.1): o processo principal do Electron 44, que inicia o servidor local ([`apps/server`](../server/README.md)) e mostra a interface ([`apps/web`](../web)) numa janela. Segue o desenho do `apps/desktop` do T3 Code, reduzido ao que o app faz; o que foi copiado está em [`docs/upstream-t3.md`](../../docs/upstream-t3.md).

- Nome: **Simplifica IF**; `appId`: `br.edu.ifpr.simplifica`.
- A pasta do app (`app.getPath("userData")`): `~/Library/Application Support/Simplifica IF` no macOS, `%APPDATA%\Simplifica IF` no Windows; no desenvolvimento, `Simplifica IF (dev)`. É também a `--pasta-estado` do servidor (as CLIs gerenciadas e o perfil do Antigravity).

## Como rodar em desenvolvimento

Na raiz do repositório:

```bash
pnpm install          # uma vez, e depois de cada pull que mude dependências
pnpm kb:compilar      # tmp/kb.sqlite, a base do servidor (uma vez; recompile quando a base mudar)
pnpm app:dev          # abre o app; o mesmo que pnpm --filter @simplifica-if/desktop dev
```

O `app:dev` faz tudo num terminal só:

1. constrói o processo principal e o preload em `dist/app` e baixa o Electron, se faltar;
2. garante a interface: se `http://localhost:5190` já responde (por exemplo, `pnpm --filter @simplifica-if/web dev` noutro terminal), usa essa; senão, inicia o `apps/web` e espera ficar pronto;
3. abre o Electron, que inicia o servidor com o Node do repositório (`node apps/server/src/bin.ts`) e carrega a interface.

Ctrl+C ou fechar a janela encerra tudo, inclusive a interface que o `app:dev` iniciou. Mudanças em `apps/web` aparecem na hora; mudanças em `apps/desktop/src` ou `apps/server` pedem fechar e rodar de novo.

Se a interface não responder, a janela tenta carregá-la 8 vezes, em cerca de 10 s, e desiste com uma mensagem no terminal dizendo o que rodar. Se a porta 5190 estiver ocupada por outro programa, o `apps/web` não sobe (`strictPort`) e o `app:dev` para com o aviso.

| Variável | Padrão | Uso |
|---|---|---|
| `SIMPLIFICA_WEB_URL` | `http://localhost:5190` (o `PORTA_DEV` do `apps/web/vite.config.ts`) | o dev server da interface; vazia, a janela carrega o build em `dist/app/web` pelo protocolo `simplifica://app`, como no app empacotado |
| `SIMPLIFICA_NODE` | o Node que rodou o `dev` | o Node que roda o servidor em desenvolvimento |
| `SIMPLIFICA_KB` | `tmp/kb.sqlite` | a base (`--banco`) |

Argumentos depois de `dev` vão ao Electron, por exemplo `--remote-debugging-port=9333` para inspecionar a janela pelo Chrome DevTools Protocol.

## Como empacotar

O bundle do servidor leva também o Worker da revisão prévia, `servidor/trabalhador-ppc.mjs`, num bundle à parte, sem pedaços compartilhados com o `bin.mjs` (`scripts/construir.ts`).

```bash
pnpm --filter @simplifica-if/desktop build          # os bundles em dist/ (servidor, interface, processo principal, preload)
pnpm --filter @simplifica-if/desktop dist           # o instalador desta plataforma em dist/pacotes
pnpm --filter @simplifica-if/desktop dist --dir  # só o app, sem dmg (dist/pacotes/mac-arm64/Simplifica IF.app)
pnpm --filter @simplifica-if/desktop dist --win  # Windows (NSIS por usuário), a partir de outra máquina
```

O `build` gera:

| Saída | O quê |
|---|---|
| `dist/app/main.cjs`, `dist/app/preload.cjs` | o processo principal e o preload, em CommonJS; só o `electron` fica de fora |
| `dist/app/web/` | o build do `apps/web` (`pnpm --filter @simplifica-if/web build`); sem ele, a página provisória de `src/provisoria/`, que confere a ponte e o servidor |
| `dist/app/package.json` | o manifesto do app, sem dependências |
| `dist/recursos/skills/` | as skills do app (`scripts/skills.ts`): só as de `.agents/skills` com bloco `simplifica:` válido e, de cada uma, só o `SKILL.md` e os arquivos listados em `simplifica.arquivos` (nada de `scripts/`, `tests/`, `agents/` ou `README.md`); uma skill do app inválida faz o build falhar |
| `dist/recursos/servidor/` | o servidor (`apps/server/src/bin.ts`) em ESM, com as dependências dentro, menos `bufferutil` e `utf-8-validate` (opcionais do `ws`, que segue sem eles) e o `undici`, copiado em `node_modules/` ao lado (o `effect` o carrega por `import()` e usa os exports nomeados do CommonJS, que o bundle não reproduz) |

O `dist` acrescenta a base (`dist/recursos/base/kb.sqlite`, de `SIMPLIFICA_KB` ou `tmp/kb.sqlite`) e chama o electron-builder (`scripts/empacotar.ts`), sem assinatura e sem publicação:

- macOS: dmg e zip; Windows: NSIS por usuário (`oneClick`, sem pedir administrador);
- o processo principal, o preload e a interface vão no `app.asar`; o servidor, a base e as skills vão fora dele, em `Resources/servidor`, `Resources/base` e `Resources/skills`: o servidor roda no Node do Electron como módulos ES, e o SQLite precisa de um arquivo de verdade;
- o ícone é `recursos/icone.png` (`node scripts/gerar-icone.ts`), provisório.

## Partida e encerramento

1. O processo principal gera um token (32 bytes aleatórios, base64url) e inicia o servidor como processo filho (`src/servidor.ts`):
   - em desenvolvimento, `node apps/server/src/bin.ts`;
   - no app empacotado, o próprio executável com `ELECTRON_RUN_AS_NODE=1` sobre `Resources/servidor/bin.mjs`;
   - com `--banco`, `--pasta-estado` e `--pasta-skills` (no desenvolvimento, `.agents/skills` do checkout, de onde o servidor aceita só as skills com bloco `simplifica:`; no app empacotado, `Resources/skills`; sem a pasta, o servidor sobe sem skills); o token e a origem da janela vão no `EnvelopePartida`, na primeira linha do stdin. Nunca na linha de comando nem no ambiente (o `SIMPLIFICA_SERVIDOR_TOKEN` herdado sai do ambiente do filho).
2. Lê a `LinhaPartida` do stdout (prazo de 60 s) e abre a janela. O stderr do servidor (os logs) passa ao stderr do app e ao arquivo de log, junto com o que o processo principal registra (`src/registro.ts`): `simplifica-if.log` em `~/Library/Logs/Simplifica IF` no macOS e em `<pasta do app>\logs` no Windows (no desenvolvimento, em `<pasta do app>/logs`); passando de 5 MB, o arquivo vira `simplifica-if.log.1` e outro começa.
3. A interface pede a conexão pelo preload: `window.simplifica.conexao()` devolve `{ urlServidor: "http://127.0.0.1:<porta>", token }`. O processo principal só responde ao quadro principal da janela do app, na origem da interface.
4. Ao sair (fechar a janela, Cmd+Q, SIGINT ou SIGTERM), fecha o stdin do servidor e espera 5 s; se ele não sair, SIGTERM e, 2 s depois, SIGKILL. Se o app morrer, o servidor sai sozinho: o stdin fecha e o processo pai muda (`launcherWatch.ts`).
5. Se o servidor cair, ou não subir, um diálogo mostra o motivo (o fim do stderr) e oferece **Reiniciar** (novo token, nova porta, a janela recarrega) ou **Sair**.

## A base no app empacotado (decisão)

A ordem é `SIMPLIFICA_KB`, depois a mais nova entre `<pasta do app>/base/kb.sqlite` (a baixada) e a base empacotada (`Resources/base/kb.sqlite`). O desktop passa a empacotada em `--banco` e a pasta do app em `--pasta-atualizacao`; quem escolhe é o servidor, na abertura, depois de atender a troca pendente (um app novo pode trazer uma base mais nova que a baixada). Com `SIMPLIFICA_KB`, a atualização fica desligada. O instalador leva a base inteira (cerca de 140 MB).

## Atualização (M1.10)

- **Base e skills:** o servidor (`packages/atualizacao/README.md`). O desktop só passa `--pasta-atualizacao` e `--versao-app` e oferece `reiniciarServidor`, porque a troca do arquivo só acontece na abertura do servidor (no Windows, um arquivo aberto não se renomeia). No desenvolvimento, a atualização liga só com `SIMPLIFICA_ATUALIZACAO_FEED` (com `SIMPLIFICA_ATUALIZACAO_CHAVE`), para testar contra um feed local.
- **App** (`src/atualizacaoApp.ts`): o `electron-updater` 6.8.9 (a versão do T3) com feed `generic` no release fixo do canal (`…/releases/download/canal-beta/`), nunca o provider `github`, que consulta a API. Baixa em segundo plano, instala ao sair ou em "Reiniciar para atualizar" (que encerra o servidor antes, como o T3 para os backends). Procura na abertura e a cada 24 h.
- **Proxy:** antes de iniciar o servidor, o processo principal resolve a proxy do sistema para a URL do feed (`session.resolveProxy`) e a passa em `HTTPS_PROXY` e `HTTP_PROXY`, salvo se o ambiente já as tem (`proxyParaServidor`).
- **Windows:** antes de ligar o updater, é obrigatório o `publisherName` da assinatura (ver `packages/atualizacao/README.md`).
- **Desligada** quando: fora do app empacotado, sem feed na política, com `SIMPLIFICA_SEM_ATUALIZACAO_APP`, fora do macOS e do Windows e, enquanto a política diz `se-assinado`, num app sem assinatura de código. O empacotamento grava `Resources/assinatura.json` (`{"assinado": false}` enquanto `mac.identity` é `null`). O macOS não instala atualização de um app sem Developer ID: o Squirrel.Mac confere a assinatura do app novo contra a do instalado. A seção "Atualizações" diz o motivo.
- O `empacotar.ts` põe um feed `generic` no `publish` só para o electron-builder gerar o `app-update.yml` e os `latest*.yml` (não com `--dir`); a fábrica os publica (`pnpm fabrica publicar-app`).

## Preload (`window.simplifica`)

```ts
interface PonteDesktop {
  conexao(): Promise<{ urlServidor: string; token: string }>; // espera o servidor ficar pronto
  abrirExterno?(url: string): Promise<void>;                   // só http(s), no navegador do sistema
  escolherPasta?(): Promise<string | null>;                    // diálogo do sistema; null se cancelar
  escolherDocx?(): Promise<string | null>;                     // diálogo de arquivo, só .docx; null se cancelar
  abrirDocumento?(caminho: string): Promise<void>;             // abre no Word a cópia comentada (só ela)
  mostrarNaPasta?(caminho: string): Promise<void>;             // mostra a cópia comentada no Finder/Explorador
  escolherAnexo?(extensoes?: string[]): Promise<string | null>; // diálogo de anexo, só documentos; libera no servidor
  abrirArquivoTarefa?(caminho: string): Promise<void>;         // abre um documento de Documentos/Simplifica IF/<tarefa>/
  mostrarArquivoTarefa?(caminho: string): Promise<void>;       // mostra um arquivo da pasta da tarefa
  reiniciarServidor?(): Promise<void>;                          // reinicia o servidor (troca da base, M1.10)
  atualizacaoApp?(): Promise<EstadoAtualizacaoApp>;             // estado do electron-updater
  procurarAtualizacaoApp?(): Promise<EstadoAtualizacaoApp>;
  instalarAtualizacaoApp?(): Promise<void>;                     // "Reiniciar para atualizar"
}
```

**Pasta das tarefas (M1.9).** O processo principal passa ao servidor `--pasta-trabalhos` com `Documentos/Simplifica IF` (`app.getPath("documents")`; `SIMPLIFICA_TRABALHOS` troca no desenvolvimento). `escolherAnexo` abre o diálogo só com extensões de documento (`EXTENSOES_DOCUMENTO`: Word, ODF, PDF, Markdown, texto, planilhas, apresentações, JSON, imagens), confere a extensão de novo e libera o arquivo no servidor, que o copia para a pasta da tarefa. `abrirArquivoTarefa` e `mostrarArquivoTarefa` só aceitam um arquivo pelo menos dois níveis abaixo da raiz (`<raiz>/<tarefa>/…`), com caminho normalizado, sem parte oculta (`.simplifica/`), arquivo comum e com o caminho real dentro da raiz (`arquivoDeTarefaPermitido` de `src/seguranca.ts`); "Abrir" ainda exige extensão de documento, porque a IA escreve na pasta e "Abrir" não pode virar "rodar" (`.command`, `.exe`, `.html` ficam só com "Mostrar na pasta").

**Revisão prévia de PPC (M1.11).** `escolherDocx` abre o diálogo com o filtro `.docx` e confere a extensão de novo (o filtro pode ser contornado com "Todos os arquivos"); o processo principal guarda os arquivos escolhidos nesta execução. Depois do diálogo, o processo principal libera o arquivo no servidor (`POST /revisao-ppc/liberar` com o `tokenDesktop`, um segundo segredo gerado a cada partida e passado só no envelope), e o servidor só analisa arquivos liberados. `abrirDocumento` (`shell.openPath`) e `mostrarNaPasta` (`shell.showItemInFolder`) só aceitam a cópia comentada de um deles: mesma pasta, `<nome> - revisão prévia (Simplifica IF).docx` ou com ` (2)` a ` (99)`, caminho normalizado e arquivo comum (não link, não pasta), por `copiaComentadaPermitida` de `src/seguranca.ts`. Assim a interface não abre outro arquivo do computador por esse caminho.

O contrato está em `src/ponteDesktop.ts`; a interface tem a cópia dela em `apps/web/src/ponte-desktop.ts`. O token nunca vai para log.

## Segurança da janela

Como no T3:

- `contextIsolation`, `sandbox`, sem `nodeIntegration` e sem `<webview>`;
- navegação só na origem da interface; links para fora, e `window.open`, abrem no navegador do sistema se forem http(s), e os outros esquemas são recusados;
- nenhuma permissão do navegador (câmera, notificações…), salvo escrever na área de transferência;
- uma instância só do app.

Na interface empacotada, a CSP vai em cada resposta do protocolo `simplifica://app` (`src/seguranca.ts`), mais estreita que a do T3:

- `connect-src` só para o servidor local na porta desta execução;
- `script-src 'self'` mais o hash dos scripts inline do `index.html` (o do tema);
- sem `eval`, `object-src 'none'`, `frame-src 'none'`.

No desenvolvimento, a janela carrega o dev server sem CSP: o Vite precisa de script inline e do WebSocket do HMR.

## Estrutura

- `src/main.ts`: o processo principal (servidor, janela, IPC, protocolo, menu em pt-BR, ciclo de vida).
- `src/servidor.ts`: o token, a montagem do comando, a linha de partida e o encerramento; sem Electron.
- `src/configuracao.ts`: de onde vêm o servidor, a base, a interface, a pasta de estado e a de skills; sem Electron.
- `src/seguranca.ts`: CSP, navegação, links externos e arquivos do protocolo; sem Electron.
- `src/registro.ts`: o arquivo de log, com o giro em 5 MB; sem Electron.
- `src/preload.ts`, `src/ponteDesktop.ts`: a ponte e o contrato.
- `scripts/construir.ts`, `scripts/empacotar.ts`, `scripts/skills.ts` (as skills do app no pacote), `scripts/dev.ts`, `scripts/gerar-icone.ts`.
- `scripts/t3/`: cópia do T3 (`ensure-electron-runtime.mjs`), com `NOTICE`.

O processo principal não usa Effect: as APIs do Electron são de callback, e o `main.cjs` fica pequeno, sem runtime. O servidor, que é Effect, roda noutro processo.

## Testes

```bash
pnpm --filter @simplifica-if/desktop test
```

- `test/servidor.test.ts`: o token, a linha de partida, os argumentos e o ambiente (sem o token na linha de comando) e o encerramento (stdin, SIGTERM, SIGKILL, saída antes de ficar pronto), com processos Node falsos.
- `test/configuracao.test.ts`: os caminhos no desenvolvimento e no app empacotado, a CSP, a navegação, os links externos e os arquivos do protocolo.
- `test/integracao.test.ts`: o servidor de verdade (`apps/server`, banco de fixture, nenhum provider chamado), iniciado como o app o inicia: a linha de partida, o `POST /ingresso` com o token e a origem da janela, as recusas e o encerramento pelo stdin. Se o bundle (`build`) e o Electron existirem, repete com o Electron como Node sobre o bundle.
- `test/empacotar.test.ts`: a identidade e os alvos do electron-builder, e a cópia das skills do app (só as elegíveis, só os arquivos listados; uma inválida faz o build falhar).
- `test/registro.test.ts`: o arquivo de log (pasta criada, acréscimo, giro no limite, falha sem derrubar o app).
- `test/atualizacao-app.test.ts`: quando o `electron-updater` fica desligado, o feed do canal e o ciclo procurar, baixar, pronta e instalar (com o servidor encerrado antes), com um atualizador falso.

Nenhum teste abre janela. O T3 tem um smoke do app empacotado (`scripts/smoke-desktop-app.ts`, Playwright com `_electron`) que roda nos jobs de release; aqui ele fica como pendência do CI. Para conferir o app de verdade, empacote com `--dir` e abra o `.app`; com `--remote-debugging-port`, a página pode ser lida pelo CDP.

## Pendências

- **Assinatura de código e notarização** (macOS: Developer ID e notarização; Windows: certificado). Sem elas, o macOS pede "Abrir mesmo assim" e o Windows mostra o SmartScreen.
- **Ícone final** pela identidade visual do IFPR (skill `ifpr-design`); o de `recursos/icone.png` é provisório.
- **Instaladores no CI** (macOS e Windows), com o `kb.sqlite` da fábrica e um smoke do app empacotado, como o `smoke-desktop-app.ts` do T3.
- **Windows:** o `dist --win` e o app no Windows ainda não foram testados; ali o cordão do servidor é só o stdin (o `awaitLauncherLoss` do T3 não age no Windows).
- **Atualização do app ligada:** depende da assinatura de código (acima) e do feed na política (repositório público); ver `packages/atualizacao/README.md`, "O que falta para ligar em produção".
- **Tamanho:** o instalador leva a base inteira e o Electron com as línguas pt-BR e en-US.
