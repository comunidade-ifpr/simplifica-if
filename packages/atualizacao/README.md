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
| `src/Atualizador.ts` | o serviço Effect do servidor: abertura e a cada 24 h, estado, canal, aplicar, voltar, novidades vistas |
| `src/hospedagem.ts` | os links diretos do GitHub Releases e os `latest*.yml` do app |
| `src/fabrica.ts`, `src/novidades.ts`, `src/fontes.ts` | a fábrica: gerar o canal, propor e conferir novidades, fontes publicáveis |

## A verificação de assinatura (por que assim)

O app confere só o manifesto (`beta.json` + `beta.json.minisig`); os pacotes são conferidos pelo `sha256` que o manifesto assinado traz. A implementação é própria, sobre `node:crypto`, porque:

- o Ed25519 do `node:crypto` existe no Node do Electron 44 (BoringSSL), conferido em 16/11/2026;
- o `blake2b512` **não** existe no BoringSSL, e o minisign assina o BLAKE2b-512 do arquivo (`ED`, o padrão desde o 0.10). O `@noble/hashes` 1.8.0 (MIT, JS puro, auditado, já no lockfile pelo electron-builder) dá o BLAKE2b;
- o formato do minisign é pequeno (três campos em base64), e uma dependência de verificação inteira traria outra implementação de Ed25519 sem ganho.

O formato é o do minisign 0.11: a chave pública e a assinatura da fábrica servem no `minisign -V`, e uma chave criada com `minisign -G` serve na fábrica. Os testes conferem assinatura adulterada, outra chave, comentário confiável trocado e a assinatura legada.

O app também recusa: manifesto de outro canal, versão igual ou mais velha que a em uso (um manifesto antigo e bem assinado servido de novo não faz voltar), `app_minimo` maior que o app (avisa e não baixa), tamanho ou `sha256` diferentes, banco que não abre, não passa no `quick_check` ou tem outro esquema ou outra versão.

## Fluxo no app

1. **Abertura do servidor** (`--pasta-atualizacao`, que o desktop passa no app instalado): `prepararAbertura` atende o pedido de voltar ou põe a base pendente no lugar (a atual vira `kb.anterior.sqlite`), por `rename` na mesma pasta, e escolhe a mais nova entre a baixada e a empacotada. Só depois o servidor abre a base.
2. **Conferência** na abertura e a cada 24 h, no canal gravado (padrão da política: `beta`). Baixa o patch quando o manifesto tem um da versão em uso; senão, o pacote inteiro. Deixa `base/pendente.sqlite` e as skills em `skills/<versao>/`.
3. **Troca:** na próxima abertura, ou em "Usar a versão nova agora", que reinicia o servidor pelo desktop. Enquanto uma análise de PPC, uma revisão com IA ou uma conversa respondendo roda, o servidor responde `adiada` e a troca fica para a próxima abertura.
4. **Aviso "Base atualizada"** com as novidades da versão, até a pessoa fechar.
5. **Voltar** troca a base atual pela anterior (ou pela empacotada) na abertura e marca a versão que saiu como recusada: ela não se baixa de novo, só uma mais nova.
6. **Skills:** as do manifesto mais novas que as disponíveis, com `app_minimo` e `base_minima` atendidos. O `CatalogoSkills` lê a pasta empacotada e a baixada e fica, de cada skill, com a de `simplifica.versao` maior.

Fora do app, o `simplifica-mcp` faz o mesmo só com a base (`--pasta-atualizacao`, `packages/mcp/README.md`).

## A fábrica

```bash
pnpm fabrica gerar-chave --saida ~/.simplifica-fabrica    # uma vez; com SIMPLIFICA_MINISIGN_SENHA, cifrada
export SIMPLIFICA_MINISIGN_CHAVE=~/.simplifica-fabrica/simplifica-fabrica.key
pnpm fabrica propor-novidades --de tmp/fabrica/bases/2026.11.13.sqlite --para tmp/kb.sqlite   # revisar e colar em novidades.yaml
pnpm fabrica canal --canal beta --versao 2026.11.20 --repositorio dono/repo
pnpm fabrica publicar --canal beta --versao 2026.11.20 --repositorio dono/repo              # mostra os comandos gh
pnpm fabrica publicar --canal beta --versao 2026.11.20 --repositorio dono/repo --executar   # publica
pnpm fabrica publicar-app --canal beta --versao 0.2.0 --repositorio dono/repo [--executar]  # depois do dist do desktop
```

`canal` compila o `kb.sqlite` com `--versao`, `--commit` e `--canal`, recusa fonte fora de `FONTES_PUBLICAVEIS`, faz o pacote inteiro (zstd 19), um patch de cada uma das três versões anteriores guardadas em `tmp/fabrica/bases/` (e das dadas em `--anterior`), um pacote por skill do app e o manifesto assinado, com as novidades da versão (o `novidades.yaml` precisa ser só de acréscimos desde a última versão publicada). Promover para o estável é rodar `canal` e `publicar` de novo com `--canal estavel` e a mesma versão.

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
   - Windows: certificado (ou Azure Trusted Signing, como o T3) e `win.signtoolOptions`/`azureSignOptions`; o NSIS atualiza sem assinatura, mas o SmartScreen avisa a cada versão;
   - depois, `pnpm fabrica publicar-app` a cada versão do app.
