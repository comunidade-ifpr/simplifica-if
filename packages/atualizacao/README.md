# @simplifica-if/atualizacao

Atualização nos três ritmos (M1.10, plano "Atualização: três ritmos"): a base e as skills pelo manifesto do canal, assinado com minisign; o app pelo `electron-updater` (em `apps/desktop/src/atualizacaoApp.ts`). Nada aqui depende de binário externo: zstd pelo `node:zlib`, Ed25519 pelo `node:crypto`, BLAKE2b pelo `@noble/hashes`.

## Módulos

| Arquivo | O quê |
|---|---|
| `src/manifesto.ts` | o manifesto do canal (Effect Schema, formato do plano, mais `sha256_banco`, `url` e `novidades`) e a comparação de versões |
| `src/minisign.ts` | ler a chave pública, conferir (`ED`, pré-hash, e `Ed`, legado), assinar, ler e gravar a chave secreta (sem senha ou cifrada com scrypt) |
| `src/zstd.ts` | pacote inteiro e patch (`--patch-from`) pelo `node:zlib` |
| `src/pacote-skill.ts` | o pacote de uma skill: JSON dos arquivos comprimido, com os caminhos conferidos |
| `src/local.ts` | a pasta do app, o estado (`atualizacao.json`), a validação do banco e a troca na abertura (`prepararAbertura`) |
| `src/remoto.ts` | conferir o manifesto e baixar (patch ou inteiro), sem a API do GitHub |
| `apps/server/src/Atualizador.ts` | (no servidor, que tem os contratos RPC) o serviço Effect: abertura e a cada 24 h, estado, canal, aplicar, voltar, novidades vistas |
| `src/hospedagem.ts` | os links diretos do GitHub Releases e os `latest*.yml` do app |
| `src/fabrica.ts`, `src/novidades.ts`, `src/fontes.ts` | a fábrica: gerar o canal, propor e conferir novidades, fontes publicáveis |

## A verificação de assinatura (por que assim)

O app confere só o manifesto (`beta.json` + `beta.json.minisig`); os pacotes são conferidos pelo `sha256` que o manifesto assinado traz. A implementação é própria, sobre `node:crypto`, porque:

- o Ed25519 do `node:crypto` existe no Node do Electron 44 (BoringSSL), conferido em 16/11/2026;
- o `blake2b512` **não** existe no BoringSSL, e o minisign assina o BLAKE2b-512 do arquivo (`ED`, o padrão desde o 0.10). O `@noble/hashes` 1.8.0 (MIT, JS puro, auditado, já no lockfile pelo electron-builder) dá o BLAKE2b;
- o formato do minisign é pequeno (três campos em base64), e uma dependência de verificação inteira traria outra implementação de Ed25519 sem ganho.

O formato é o do minisign. Conferido em 16/11/2026 contra o minisign 0.12 oficial (imagem Docker `jedisct1/minisign`): o app aceita uma assinatura dele (vetor versionado em `test/vetores/`, só a chave pública e a assinatura), o `minisign -V` aceita uma assinatura da fábrica, o `minisign -S` assina com uma chave cifrada gerada pela fábrica, e a fábrica lê uma chave cifrada do `minisign -G`. Só a assinatura com pré-hash (`ED`) é aceita; a legada (`Ed`) é recusada. A senha entra como os bytes UTF-8 digitados, sem normalização, como no minisign. Os testes conferem assinatura adulterada, outra chave, comentário confiável trocado e a legada recusada.

O app também recusa: manifesto de outro canal, versão igual ou mais velha que a em uso (um manifesto antigo e bem assinado servido de novo não faz voltar), `app_minimo` maior que o app (avisa e não baixa), tamanho ou `sha256` diferentes, banco que não abre, não passa no `quick_check` ou tem outro esquema ou outra versão.

## Fluxo no app

1. **Abertura do servidor** (`--pasta-atualizacao`, que o desktop passa no app instalado): `prepararAbertura` atende o pedido de voltar ou põe a base pendente no lugar (a atual vira `kb.anterior.sqlite`), por `rename` na mesma pasta, e escolhe a mais nova entre a baixada e a empacotada. Só concorre a baixada do esquema que o app lê (`VERSAO_ESQUEMA` do `kb`): uma base baixada pelo app antigo, de outro esquema, ou a anterior de outro esquema depois de "Voltar", fica de lado, e o servidor abre a empacotada (o evento vai para o log). Só depois o servidor abre a base.
2. **Conferência** na abertura e a cada 24 h, no canal gravado (padrão da política: `beta`). Baixa o patch quando o manifesto tem um da versão em uso; senão, o pacote inteiro. Deixa `base/pendente.sqlite` e as skills em `skills/<versao>/`.
3. **Troca:** na próxima abertura, ou em "Usar a versão nova agora", que reinicia o servidor pelo desktop. Enquanto uma análise de PPC, uma revisão com IA ou uma conversa respondendo roda, o servidor responde `adiada` e a troca fica para a próxima abertura.
4. **Aviso "Base atualizada"** com as novidades da versão, até a pessoa fechar.
5. **Voltar** troca a base atual pela anterior (ou pela empacotada) na abertura e marca a versão que saiu como recusada: ela não se baixa de novo, só uma mais nova.
6. **Skills:** as do manifesto mais novas que as disponíveis, com `app_minimo` e `base_minima` atendidos. A pasta nova (`skills/<versao>/`) leva também as skills baixadas antes que o manifesto ainda lista: ela substitui a atual inteira. O `CatalogoSkills` lê a pasta empacotada e a baixada e fica, de cada skill, com a de `simplifica.versao` maior.
7. **Sem travar o servidor:** o zstd e o sha256 rodam no threadpool (`node:zlib` assíncrono e `crypto.subtle`), e o `quick_check` do banco baixado num `Worker` (`src/pesado.ts`).
8. **Proxy:** o download usa o `fetch` do `undici` 8.12.4 (o mesmo que o servidor já leva) com o `EnvHttpProxyAgent`, que segue `HTTP_PROXY`, `HTTPS_PROXY` e `NO_PROXY`. No app, o desktop passa ao servidor a proxy que o Electron resolve para o feed (`session.resolveProxy`: a configuração do sistema, o PAC e o WPAD), sem sobrescrever as variáveis que já existem. O `fetch` global do Node não serve: ele só usa a proxy com `NODE_USE_ENV_PROXY` desde a partida, e o `http.setGlobalProxyFromEnv` funcionou no Node 26, mas travou no teste com o Node 24 do Electron.
9. **Uma pasta, um processo:** o app e o `simplifica-mcp` usam pastas de atualização próprias (a do app é a `userData`; a do `simplifica-mcp`, a de `--pasta-atualizacao`). Como rede de proteção, cada download e cada troca tomam `atualizacao.trava` (criada com `wx`, com o pid; a trava de um processo morto se retoma), e quem não a consegue adia. Temporários de uma falha são apagados na hora, e as sobras de uma queda, na abertura seguinte.

Fora do app, o `simplifica-mcp` faz o mesmo só com a base (`--pasta-atualizacao`, `packages/mcp/README.md`).

## A fábrica

**Esquema novo exige `--app-minimo`.** Quando o `kb` sobe `VERSAO_ESQUEMA`, o app antigo não lê a base nova: ela só pode sair com `--app-minimo <primeira versão do app que lê o esquema novo>`, para o app antigo avisar "atualize o app" em vez de baixar uma base que vai recusar. A fábrica confere: se a base nova tem outro esquema que uma das anteriores (as dadas e as guardadas) e o `--app-minimo` ficou no padrão (`0.1.0`), ela recusa com o motivo (`conferirEsquema`, em `src/fabrica.ts`). Sem nenhuma anterior guardada, não há com o que comparar: a regra fica com quem publica.

**Esquema 5 e app 0.2.0 (17/11/2026).** O app 0.2.0 (o Explorar, M1.15) é o primeiro que lê o esquema 5 do `kb.sqlite` (Consepe e horários dos campi). A primeira base do esquema 5 sai com `pnpm fabrica … --app-minimo 0.2.0`; o app 0.1.0 avisa "atualize o app" em vez de baixá-la. O padrão da fábrica (`APP_MINIMO_PADRAO`) continua `0.1.0`, a primeira versão do app, e por isso a regra recusa a base do esquema 5 sem `--app-minimo` quando há uma anterior de outro esquema (o teste "o app atual passa na regra da fábrica" confere que a versão de `apps/desktop` é maior que o padrão e é aceita). Nenhuma base do esquema 4 foi publicada: o feed de produção da política ainda é `null`, e nada saiu pela fábrica; a base empacotada no instalador é a do build.

```bash
pnpm fabrica gerar-chave --saida ~/.simplifica-fabrica    # uma vez; com SIMPLIFICA_MINISIGN_SENHA, cifrada
export SIMPLIFICA_MINISIGN_CHAVE=~/.simplifica-fabrica/simplifica-fabrica.key
pnpm fabrica propor-novidades --de tmp/fabrica/bases/2026.11.13.sqlite --para tmp/kb.sqlite   # revisar e colar em novidades.yaml
pnpm fabrica canal --canal beta --versao 2026.11.20 --repositorio dono/repo
pnpm fabrica publicar --canal beta --versao 2026.11.20 --repositorio dono/repo              # mostra os comandos gh
pnpm fabrica promover --de beta --para estavel --versao 2026.11.20                          # dias depois, sem erro confirmado
pnpm fabrica publicar --canal estavel --versao 2026.11.20 --repositorio dono/repo [--executar]
pnpm fabrica publicar --canal beta --versao 2026.11.20 --repositorio dono/repo --executar   # publica
pnpm fabrica publicar-app --canal beta --versao 0.2.0 --repositorio dono/repo [--executar]  # depois do dist do desktop
```

`canal` (só o beta) compila o `kb.sqlite` **do commit**, não do disco: extrai as fontes por `git archive HEAD` numa pasta à parte (0,3 s; arquivo não rastreado, ignorado ou modificado fica de fora) e roda o `kb` dela, com `--versao` e `--commit` e **sem canal no `meta`** (o canal é do manifesto; a mesma base vale para os dois canais). Recusa fonte fora de `FONTES_PUBLICAVEIS`, faz o pacote inteiro (zstd 19), um patch de cada uma das três versões anteriores guardadas em `tmp/fabrica/bases/` (e das dadas em `--anterior`), um pacote por skill do app (também do commit) e o manifesto assinado, com as novidades da versão (o `novidades.yaml` do commit precisa ser só de acréscimos desde a última versão publicada).

`promover` passa uma versão do beta ao estável sem recompilar: confere o manifesto do beta, troca o canal e o `gerado_em`, assina de novo e grava só `estavel.json` e a assinatura. Os pacotes são os mesmos, no mesmo release `base-<versao>`, com os mesmos sha256; por isso o canal precisa ter sido gerado com `--repositorio` (pacotes com `url`). O `publicar` de uma promoção só troca o manifesto no release do canal.

Medido em 16/11/2026 com a base real (132 MB): pacote de 33 MB em cerca de 27 s; patch entre duas versões próximas de 10 a 14 KB; aplicar o patch no Node do Electron, 76 ms.

## Hospedagem: GitHub Releases (decidida em 16/11/2026)

O app só baixa por links diretos (`https://github.com/<dono>/<repo>/releases/download/<tag>/<arquivo>`), que redirecionam para o CDN e não contam no limite da API (60 consultas por hora por IP sem login; num campus, muitos computadores saem pelo mesmo IP). O provider `github` do `electron-updater` consulta a API e não é usado.

| Release (tag) | Conteúdo |
|---|---|
| `canal-beta`, `canal-estavel` (fixos, pré-lançamento) | `beta.json` e `.minisig`; `latest-mac.yml` e `latest.yml` do app; trocados a cada publicação |
| `base-<versao>` (imutável) | o pacote da base, os patches, os pacotes das skills |
| `app-v<versao>` (imutável) | os instaladores e os `.blockmap` |

Um release fixo por canal, e não `latest/download/`: o `latest` é um só para o repositório e não separa canais nem ritmos. O manifesto e os `latest*.yml` apontam para os releases imutáveis por URL relativa (`../base-2026.11.20/...`).

## O que falta para ligar em produção (passo a passo)

1. **Repositório público.** Quando o repositório for aberto, ponha o feed na política: em `packages/motor/src/politica-atualizacao.ts`, `feed: "https://github.com/<dono>/<repo>/releases/download/canal-{canal}/"` (a forma que `feedGitHub("dono/repo")` dá; o módulo da política não tem dependências, e o desktop o importa). Até lá, para testar contra outro feed, `SIMPLIFICA_ATUALIZACAO_FEED` e `SIMPLIFICA_ATUALIZACAO_CHAVE`.
2. **Chave de produção.** Num computador da fábrica: `SIMPLIFICA_MINISIGN_SENHA=… pnpm fabrica gerar-chave --saida ~/.simplifica-fabrica`. Guarde a chave secreta e a senha fora do repositório (cofre de senhas da equipe, com cópia de segurança); a perda da chave obriga a um app novo com outra chave pública. Copie a linha base64 que o comando imprime para `chavePublica` em `politica-atualizacao.ts`.
3. **Primeira publicação.** `pnpm fabrica canal --canal beta --versao <hoje> --repositorio dono/repo`, depois `publicar … --executar` (o `gh` precisa de login com permissão de escrever releases).
4. **App.** Gere os instaladores com a política preenchida (`pnpm --filter @simplifica-if/desktop dist`). A base e as skills passam a se atualizar sozinhas.
5. **Assinatura de código (decisão em aberto 1).** A atualização do app fica desligada enquanto o app não for assinado (`app: "se-assinado"`). Para ligar:
   - macOS: certificado Developer ID Application, `mac.identity` no `empacotar.ts`, `hardenedRuntime: true`, notarização (`notarize` do electron-builder com `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`). Sem isso, o Squirrel.Mac recusa instalar a versão nova; com isso, o `assinatura.json` do empacotamento passa a `true` (`CSC_LINK`);
   - Windows: certificado (ou Azure Trusted Signing, como o T3) e `win.signtoolOptions`/`azureSignOptions`. **Antes de ligar o updater no Windows, é obrigatório o `publisherName`** (em `win.signtoolOptions.publisherName` ou `azureSignOptions.publisherName`, como o T3): é com ele que o `electron-updater` confere a assinatura do instalador novo; sem ele, aceitaria um instalador de qualquer assinante. O NSIS atualiza sem assinatura, mas o SmartScreen avisa a cada versão;
   - depois, `pnpm fabrica publicar-app` a cada versão do app.
