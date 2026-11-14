# Consolidação na stack do T3 Code

Situação em 14/11/2026. Plano de migração deste repositório para a stack do T3 Code, em quatro etapas (C0 a C3). Cada etapa é executável por um agente sem a conversa que a originou.

Complementa o [plano do app](app-simplifica-if.md#tecnologia-e-língua-do-código) e o [M0.1](m0-simplifica-mcp.md). Onde este plano contradiz o que eles dizem sobre Bun, zod ou "API local de leitura", este plano prevalece.

## Decisão (14/11/2026)

O simplifica-if adota a stack do T3 Code de ponta a ponta:

- **Node no lugar do Bun,** pnpm no lugar do `bun install`;
- **Effect 4** nos pacotes e pontos de entrada, **Effect Schema** no lugar do zod;
- **as ferramentas do T3:** Vite+ (`vp`) para lint, formatação, testes e empacotamento, `effect-tsgo` para tipos.

**Motivo.** O `kb` passa a ser um serviço Effect importado pelo servidor do fork (`simplifica-if-app`):

- o leitor `ifpr://`, o Explorar e o "Para você" leem por `effect/rpc`, com contratos em Effect Schema compartilhados;
- as ferramentas MCP viram um Toolkit de `effect/ai`, registrado ao lado dos toolkits do T3 em `apps/server/src/mcp/McpHttpServer.ts`;
- somem a "API local de leitura" e o processo paralelo.

**O que não muda:**

- **Portabilidade do Marco 0.** O mesmo Toolkit roda num executável stdio, empacotado como Node SEA, como o `build:exe` do T3.
- **Língua.** Código, comentários e commits deste repositório continuam em português. No fork, estrutura em inglês e conceitos do IFPR em português ([Regra de língua](app-simplifica-if.md#tecnologia-e-língua-do-código)).
- **Python.** A conversão de PPC e DOCX (`scripts/converter_ppcs_markdown.py`, `converter_docx.py` da `revisar-ppc`) fica como está.
- **Regras e dados.** Nenhuma regra do `kb` muda de resultado. Markdown, JSON e YAML de `base-conhecimento/` e `dados/` não são tocados.

## Resultado esperado

```
┌──────── simplifica-if-app (fork do T3) ─────────┐
│ apps/server                                     │
│  ├─ McpHttpServer.ts: toolkits do T3 + `ifpr`   │◄── @simplifica-if/mcp/toolkit
│  ├─ RPC: leitor, Explorar, "Para você"          │◄── @simplifica-if/mcp/rpc
│  └─ serviços do kb sobre o kb.sqlite            │◄── @simplifica-if/kb
└─────────────────────────────────────────────────┘
┌──────── simplifica-mcp (executável Node SEA) ───┐
│ McpServer.layerStdio + mesmo Toolkit + kb       │──► Claude Desktop, Codex, Gemini CLI
└─────────────────────────────────────────────────┘
```

## Pré-requisitos e coordenação

- **Branches abertos.** O C0 começa quando não houver branch aberto que altere `packages/` (os passos T2 a T4 do [M0.1](m0-simplifica-mcp.md#ordem-de-implementação) integrados em `main`). O C0 muda imports e testes de todos os arquivos, e qualquer branch paralelo conflitaria inteiro.
- **Ferramentas ainda não escritas** no início do C2 nascem direto em Effect, sem versão em zod.
- **Piloto zero.** A partir do C0, o piloto usa o executável Node SEA. O binário Bun deixa de ser gerado.
- **Um PR por etapa** (C2 e C3 podem ter mais de um), sempre com o gabarito do C0 passando.

## Inventário (14/11/2026)

### simplifica-if (`HEAD` `138f77a`)

Contagem sem `node_modules/`, `.claude/` e `outputs/`.

| Item | Quantidade | Onde |
|---|---|---|
| Arquivos `.ts` | 240 (46 mil linhas) | `packages/kb` 76, `scripts/` cerca de 70, `.agents/skills` 29, `packages/sei-cli` 26, `packages/mcp` 18 e crescendo |
| `bun:sqlite` | 20 arquivos | `packages/kb/src/db/*`, `normas/comandos.ts`, `avaliacao/busca-secoes.ts`, `packages/mcp/src` e fixtures, `revisar-ppc/scripts/subagents.ts` |
| API do `bun:sqlite` usada | `.query` 61, `.get` 48, `.all` 47, `.run` 46, `.prepare` 23, `.values` 4, `.transaction` 4, `.exec` 1; opções `strict`, `readonly`, `create` | — |
| `bun:test` | 68 arquivos | `spyOn` em 12 lugares, inclusive sobre namespaces ESM (`db/base.test.ts`, `mcp/test/normas.test.ts`); `.each` em 14 |
| `Bun.spawn` / `Bun.spawnSync` | 5 / 21 usos em 19 arquivos | testes que rodam CLIs, `revisar-ppc` (Python, `surge`), `scripts/avaliar.ts` |
| Outras APIs `Bun.*` | `Bun.sleep` 9, `Bun.sleepSync` 2, `Bun.write` 4, `Bun.YAML.parse` 3, `Bun.deepEquals` 1, `Bun.which` 1 | `scripts/avaliacao/`, `verificar-calendario`, `revisar-ppc/scripts/indice-base.ts`, `scripts/agendar_sincronizacao_sei.ts` |
| `import.meta` | `.dir` 18, `.main` 11, `.url` 1 | scripts e CLIs |
| Import de texto | 1 (`packages/mcp/src/servidor.ts` ← `instrucoes.md`) e a declaração em `modulos.d.ts` | — |
| Sintaxe não apagável | 5 *parameter properties* (`private readonly x` no construtor) | `scripts/notion/cliente.ts`, `scripts/dados/cursos.ts`, `scripts/base/validacao/contexto.ts`, `packages/kb/src/python/valores.ts`, `packages/kb/src/db/compilar.ts` |
| Imports relativos sem extensão | 79 | quase todos em `packages/sei-cli` |
| zod | 67 arquivos | `packages/mcp` 24, `packages/kb` 21, `scripts/` 18, skills 2, `sei-cli` 1; `z.toJSONSchema` em 3 (inclui `revisar-ppc/scripts/esquemas.ts`), `z.locales.ptBR()` em 1 |
| `commander` | CLIs `kb`, `simplifica-mcp`, `sei`, `revisar_ppc.ts` e scripts | — |
| FTS5 | `packages/kb/src/db/esquema.ts`, `consultas.ts` | conferido: funciona em `node:sqlite`, e o `tmp/kb.sqlite` real abre no Node 24 |
| `.env` | Bun carrega `.env*` sozinho; `scripts/segredos.ts` e `sei-cli/src/infra/env.ts` carregam com `dotenv`, mas há leitura direta de `process.env` (`sei-cli/src/infra/playwrightSei.ts`) | — |
| Formatação | `bun fmt`, largura 120 (`bunfig.toml`), só em `scripts/`, skills e `packages/` | Markdown e JSON de `base-conhecimento/` nunca são reformatados |
| Tipos | TypeScript 7 (`tsc`), `moduleResolution: Bundler`, `types: ["bun"]` | `tsconfig.base.json` |
| Comandos `bun` em documentos | `AGENTS.md` 39, `sei-cli/README.md` 38, `docs/sei-cli-operacao-agentes.md` 26, `kb/README.md` 23, `PLANO-ARQUITETURA.md` 22, `README.md` 14, `sincronizacao-sei-notion.md` 18, mais 13 arquivos de skills e `base-conhecimento/docs/` | — |
| CI | não existe (`.github/` ausente) | — |
| Executável | não há script no repositório; foi gerado à mão com `bun build --compile` (84 MB, 83 MB de runtime) | — |
| Testes | 825 em 13/11/2026, nenhuma falha | — |

Python, fora do escopo: `scripts/converter_ppcs_markdown.py` (`pymupdf4llm`), `converter_docx.py` e o `pytest` da `revisar-ppc`.

### T3 Code (`a6d9140972`, 13/11/2026)

| Item | Valor | Onde |
|---|---|---|
| Gerenciador | `pnpm@12.14.0`, catalog em `pnpm-workspace.yaml` | raiz |
| Node | `26.12.1` (`engines`) | `package.json` |
| Vite+ | `vite-plus` 1.4.0 (CLI `vp`), com o override `vite: npm:@voidzero-dev/vite-plus-core@1.4.0` | `pnpm-workspace.yaml` |
| Lint | oxlint 1.89 por `vp lint`, plugins `eslint`, `oxc`, `unicorn`, `typescript` e o plugin próprio `oxlint-plugin-t3code` | `vite.config.ts` |
| Formatação | oxfmt 0.74 por `vp fmt`, com `ignorePatterns` | `vite.config.ts` |
| Testes | vitest 5.0.5 (dentro do Vite+) com `@effect/vitest` 4.1.2; override `"@effect/vitest>vitest": "-"` | `pnpm-workspace.yaml` |
| Tipos | `effect-tsgo` (`@effect/tsgo` 0.67.1), regras do language service em `tsconfig.effect.json` | raiz |
| `tsconfig` | `module`/`moduleResolution` `NodeNext`, `erasableSyntaxOnly`, `allowImportingTsExtensions`, `rewriteRelativeImportExtensions`, `verbatimModuleSyntax` | `tsconfig.base.json` |
| Effect | `effect@4.1.3`, `@effect/*` 4.1.2; módulos `effect/ai`, `effect/sql`, `effect/cli`, `effect/rpc`, `effect/http`, `effect/process`, marcados `@stability unstable` | catalog |
| SQLite | cliente `effect/sql` próprio sobre `node:sqlite`, MIT, 1.042 linhas; leitor e checkpoint opcionais em worker com `eval: true` | `packages/shared/src/nodeSqliteClient.ts` |
| SEA | `vp pack` (tsdown) com `exe`; um só chunk; `seaConfig.useCodeCache: false`; alvos `darwin-arm64`, `darwin-x64`, `linux-x64`, `win-x64`, `win-arm64`; build cruzado pede Node ≥ 25.7 | `apps/server/scripts/cli.ts` (`build-exe`), `apps/server/vite.config.ts` |
| MCP | `McpServer.layerHttp` com `protocols: [v2025_06_18, v2026_07_28]`; `registerToolkit` põe o resultado como JSON no `content`; ferramentas de imagem usam `server.addTool` direto (`registerImageTool`); listagem adiada por `McpToolExposure` | `apps/server/src/mcp/McpHttpServer.ts` |
| Convenções | serviços, erros, `Effect.fn`, bordas de runtime | `docs/internals/effect-services.md`, `AGENTS.md` |
| Código do Effect | `.repos/effect`, com `LLMS.md`, `MIGRATION.md` e `ai-docs/`; sincronizado por `scripts/sync-reference-repos.ts` na tag `effect@<versão do catalog>` | `.repos/` |

## Versões fixadas

Uma versão só nos dois repositórios. Toda atualização do Effect acontece no mesmo dia aqui e no fork, junto com o rebase do fork.

| Pacote | Versão | Onde fica |
|---|---|---|
| Node | 26.12.1 | `engines.node` e `.node-version` |
| pnpm | 12.14.0 | `packageManager` |
| `vite-plus` | 1.4.0 | catalog |
| `@effect/tsgo` | 0.67.1 | `devDependencies` da raiz |
| `effect` | 4.1.3 | catalog; `peerDependencies` de `@simplifica-if/kb` e `@simplifica-if/mcp` |
| `@effect/platform-node`, `@effect/vitest` | 4.1.2 | catalog |
| `@types/node` | 24.12.4 (o mesmo do T3) | catalog |

O agente que atualizar uma versão roda `pnpm sync:repos` (C0) para trazer `.repos/effect` na mesma tag.

## Convenções Effect neste repositório

Resumo adaptado de `docs/internals/effect-services.md` do T3 (`$T3CODE_DIR/docs/internals/effect-services.md`). Leia o original antes do C1. Para a biblioteca, leia `.repos/effect/LLMS.md` e, para dúvidas de API, o código em `.repos/effect/packages/effect/src/`.

**Onde mora cada coisa**

- **Uma capacidade é um método de serviço do domínio:** `Normas`, `Ppcs`, `Cursos`, `Leitura`.
- **Transporte é casca.** A CLI `kb`, uma ferramenta MCP e um RPC fazem três coisas: decodificam a entrada, chamam um método e mapeiam os erros tipados. Envelope, paginação e orçamento ficam no serviço `Leitura`, não no handler.
- **Regras puras continuam funções puras,** sem Effect: resolvedor, vigência, `adequacaoArt71Em`, `impactoEm`, stemmer, formatação de texto. O Effect entra nas fontes de dados, no banco, no sistema de arquivos, nos erros e nas bordas. Regra específica deste repositório: preserva a paridade byte a byte e mantém as regras testáveis sem camadas.

**Forma do módulo de serviço**

Nesta ordem:

1. imports;
2. erros e schemas;
3. a tag `Context.Service`, com a interface inline e chave `"simplifica-if/<pacote>/<Nome>"`;
4. `make`;
5. `layer`.

```ts
export class NormaNaoEncontrada extends Schema.TaggedError<NormaNaoEncontrada>()("NormaNaoEncontrada", {
  id: Schema.String,
}) {
  override get message(): string {
    return `norma não encontrada na base: ${this.id}`;
  }
}

export class Normas extends Context.Service<
  Normas,
  { readonly ficha: (entrada: { readonly id: string; readonly em?: string }) => Effect.Effect<FichaNorma, NormaNaoEncontrada> }
>()("simplifica-if/kb/Normas") {}

const make = Effect.gen(function* () {
  const fontes = yield* FontesNormativas.FontesNormativas;
  const ficha = Effect.fn("Normas.ficha")(function* (entrada) { /* … */ });
  return Normas.of({ ficha });
});

export const layer = Layer.effect(Normas, make);
```

**Regras**

- **Imports por namespace:** `import * as Effect from "effect/Effect"`, `import * as Normas from "./Normas.ts"`, depois `yield* Normas.Normas` e `Normas.layer`. Módulos do Node também: `import * as NodeFs from "node:fs"`. Nunca `import { layer as normasLayer }`.
- **Interface sem tipo avulso:** use `Normas["Service"]`, nunca `NormasShape`.
- **Dependências vêm do ambiente** (`yield* SqlClient.SqlClient`), nunca como parâmetro de `make`. Configuração e valores imutáveis podem ser parâmetro, como o caminho do banco em `layerArquivo({ caminho })`. Nada de serviço escondido em variável de módulo.
- **Funções reutilizáveis** usam `Effect.fn("Servico.operacao")`, que cria o span. Use `Effect.fnUntraced` em laços por linha, com um comentário dizendo por quê. `Effect.gen` fica para programas inline e construção de layers.
- **Runtime só nas bordas.** `NodeRuntime.runMain` nas CLIs e no executável stdio. Nunca `runPromise` ou `ManagedRuntime` dentro de serviço, consulta ou construtor de layer. A única exceção temporária é a ponte do C1 (ver C1), removida no C2 e no C3.
- **Erros:**
  - são classes `Schema.TaggedError` com nomes em português (`NormaNaoEncontrada`, `BaseIncompativel`, `EntradaInvalida`) e atributos estruturados;
  - a mensagem é fixa ou montada dos atributos, em português, nunca de `cause.message`;
  - o erro que embrulha outro guarda o erro de baixo em `cause`;
  - nenhum atributo leva conteúdo cru (texto de PPC, credencial, URL com consulta);
  - capture com `Effect.catchTags({ … })`, mesmo para uma tag só;
  - predicados se exportam como `export const ehNormaNaoEncontrada = Schema.is(NormaNaoEncontrada)`.
- **Determinismo.** Sem `Date.now()`, `new Date()`, `Math.random()` ou `console` em código Effect: use `Clock`, `DateTime` e `Console`. As regras `globalDate`, `globalRandom` e `globalConsole` do `tsconfig.effect.json` ficam ligadas. Isso garante o princípio "saídas sem relógio" da CLI `kb`.
- **Schemas** são Effect Schema. Mensagens de validação em português saem de um formatador único, `@simplifica-if/kb/esquema/mensagens` (C1). JSON entra por `Schema.fromJsonString`, não por `JSON.parse` dentro de Effect.
- **Mover um serviço** apaga o arquivo antigo e atualiza todos os chamadores, sem reexportação de compatibilidade.
- **Testes:**
  - `@effect/vitest` (`it.effect`, `it.layer`);
  - layers de teste só para dependências externas: `FileSystem`, banco de fixture;
  - `TestClock` em vez de espera real;
  - não simule a lógica sob teste.
- **Supressões** de lint ou de diagnóstico dizem por quê, num sufixo `-- motivo` ou num comentário acima.
- **Língua.** Identificadores, mensagens e comentários em português. A API do Effect é o que é. Exceção: o cliente SQLite copiado do T3 fica como veio, em inglês, com a atribuição.

## Gabarito de comportamento

O C0 captura o gabarito **antes de qualquer mudança**, ainda com Bun. Todas as etapas o conferem. Fica em `testes-gabarito/` (versionado), com um script de shell neutro de runtime.

| Peça | Conteúdo | Comparação |
|---|---|---|
| `testes-gabarito/kb.sh` | lista de invocações da CLI `kb`: cada comando do `AGENTS.md` (`buscar-norma`, `buscar-secoes`, `cursos`, `ppc-fatos` com e sem `--divergencias`, `pacote-contexto`, `resolver`, `citacoes`, `adequacao-art71`, `dispositivo`, `vigencia`, `correspondencia`, `impacto`, `relacoes`, `relacoes --propor`), em texto e com `--json`, mais casos de erro (citação não resolvida, ID inexistente) | stdout e código de saída **byte a byte**. Ajuda (`--help`) e stderr ficam fora: o `effect/cli` formata diferente |
| `testes-gabarito/mcp.json` | `tools/list` e as respostas de 2 a 3 chamadas por ferramenta (`structuredContent` e `content`), colhidas pelo cliente de teste em stdio por `packages/mcp/test/gabarito.ts` (novo, com `--capturar` e `--comparar`) | C0: byte a byte. C2: ver critério do C2 |
| `testes-gabarito/testes.txt` | número de casos de teste por arquivo (JUnit de `bun test`) | mesmo número por arquivo, sem falha |
| `testes-gabarito/banco.txt` | `sqlite3 tmp/kb.sqlite .dump`, sem as tabelas internas do FTS5, com o hash de cada tabela | igual. O hash do arquivo `.sqlite` inteiro **não** serve: o cabeçalho grava a versão do SQLite de quem escreveu, e o Bun e o Node trazem versões diferentes |
| Base | `validar_base.ts` sem erro; `gerar_base.ts`, `gerar_indice_ppcs.ts` e `exportar_base_publica.ts` sem diferença no `git status`; hash de `site/` depois de `gerar_site.ts` | igual |

O gabarito é regerado só por decisão explícita. Exemplo: uma correção de regra que muda a saída é um PR próprio, fora destas etapas.

---

## C0 — Sair do Bun, sem mudar comportamento

**Objetivo.** Node, pnpm e as ferramentas do T3, com o mesmo código e o mesmo comportamento. Ainda sem Effect e com zod.

**Escopo.** Repositório inteiro: `package.json` (raiz e pacotes), `pnpm-workspace.yaml` (novo), `bun.lock` (sai), `bunfig.toml` (sai), `tsconfig*.json`, `vite.config.ts` (novo), todos os `.ts`, `AGENTS.md`, `README.md`, `PLANO-ARQUITETURA.md` (só comandos), READMEs e `SKILL.md` das skills, `base-conhecimento/docs/*.md` (só comandos), `.gitignore`, `.git-blame-ignore-revs` (novo).

**Decisões**

| Decisão | Descartada |
|---|---|
| pnpm 12.14.0 com catalog em `pnpm-workspace.yaml`, workspaces `packages/*` | npm ou yarn: o fork usa pnpm, e o catalog é o que mantém as versões iguais |
| Node 26.12.1 roda `.ts` direto (remoção de tipos nativa), sem `tsx` | `tsx` ou `jiti`: mais uma camada de runtime que o T3 não usa |
| `tsconfig.base.json` igual ao do T3, sem React: `NodeNext`, `erasableSyntaxOnly`, `rewriteRelativeImportExtensions`, `types: ["node"]` | manter `Bundler`: o Node não resolve como o bundler, e o erro só apareceria em execução |
| `effect-tsgo` já no C0 (sem código Effect, funciona como o tsgo) | `tsc` até o C1: trocaria de ferramenta duas vezes |
| `vp test` (vitest) com `pool: "forks"` | manter `bun test`: o objetivo é sair do Bun |
| `vp fmt` (oxfmt) com largura 120 | largura padrão do oxfmt: reformataria todos os arquivos sem ganho; o código daqui não é formatado pelo fork |
| `vp lint` (oxlint) com `correctness`, `suspicious` e `perf` em `warn`, como o T3; plugin do T3 só no C1 | plugin do T3 agora: as regras dele são sobre Effect |
| `instrucoes.md` vira um módulo gerado, `packages/mcp/src/instrucoes.gerado.ts` (`export const INSTRUCOES = "…"`), por `pnpm mcp:instrucoes`, com `--check` nos testes | plugin de texto: um por ferramenta (Node, vitest, tsdown, bundler do fork); `node:sea` `getAsset`: não funciona quando o fork empacota o pacote |
| Executável por `vp pack` com `exe` (tsdown), como o `build:exe` do T3, num script `packages/mcp/scripts/construir-executavel.ts` | `postject` à mão: o T3 já resolveu assinatura, alvos e chunk único com o tsdown |
| `node:sqlite` (`DatabaseSync`) direto, sem Effect ainda | `better-sqlite3`: módulo nativo, que o SEA não carrega sem `node_modules` ao lado |
| `.repos/effect` fora do git (`.gitignore`), trazido por `pnpm sync:repos` na tag `effect@4.1.3`, com sparse checkout de `packages/effect/src`, `LLMS.md`, `MIGRATION.md` e `ai-docs/` | versionar como o T3: dezenas de MB no histórico de um repositório de base de conhecimento |
| Comando curto de agentes: `pnpm kb …` | `node packages/kb/src/cli.ts …`: longo demais para os documentos |

**Equivalências**

| Bun | Node |
|---|---|
| `new Database(c, { readonly, strict })` | `new DatabaseSync(c, { readOnly: true })`. O `strict` do Bun aceita parâmetro nomeado sem prefixo: confira cada `$nome`, `:nome` e `@nome` |
| `db.query(sql)` (com cache) | `db.prepare(sql)`, guardado num `Map` por SQL se a medição mostrar diferença |
| `.get()`, `.all()`, `.run()` | iguais. O `.get()` do Node devolve `undefined` onde o Bun devolve `null`. As linhas têm protótipo nulo: compare com `toEqual`, não `toStrictEqual` |
| `.values()` | `stmt.setReturnArrays(true)` e `.all()` (Node 24+) |
| `db.transaction(fn)()` | `db.exec("BEGIN")` … `COMMIT`, com `ROLLBACK` no `catch`, num helper `emTransacao(db, fn)` |
| `bun:test` | `vitest`. `spyOn` vira `vi.spyOn`, mas não espiona export de namespace ESM: use `vi.mock(caminho, async (original) => ({ ...(await original()), f: … }))` |
| `Bun.spawn` / `Bun.spawnSync` | `node:child_process` `spawn` / `spawnSync`. `bun run x.ts` vira `process.execPath, ["x.ts"]` |
| `Bun.sleep` / `Bun.sleepSync` | `node:timers/promises` `setTimeout` / `Atomics.wait` num `SharedArrayBuffer` |
| `Bun.write` | `node:fs/promises` `writeFile` |
| `Bun.YAML.parse` | `yaml` (`parse`), que o `kb` já usa |
| `Bun.deepEquals` | `node:util` `isDeepStrictEqual` |
| `Bun.which("bun")` | `process.execPath` (o Node que roda o script) |
| `import.meta.dir` | `import.meta.dirname` |
| `import.meta.main` | igual (Node ≥ 24.2) |
| `#!/usr/bin/env bun` | `#!/usr/bin/env node` |
| `.env*` automático | carga explícita com `dotenv` no ponto de entrada (`scripts/segredos.ts`, `sei-cli/src/infra/env.ts`) |
| `bun fmt` / `bun test` / `tsc` | `vp fmt` / `vp test` / `effect-tsgo` |
| `bun build --compile` | `vp pack` com `exe` |

**Passos**

1. **Gabarito.** Capture o gabarito, ainda com Bun, e versione-o.
2. **Pacotes.** `packageManager`, `engines`, `.node-version`, `pnpm-workspace.yaml` com catalog e overrides copiados do T3 (só os que se aplicam), as mesmas versões resolvidas do `bun.lock` (fixe no `package.json` as que hoje usam `^`), e depois apague `bun.lock` e `bunfig.toml`. Tire `@types/bun` e ponha `@types/node`. Os scripts da raiz passam a `node …` e `vp …`; `test`, `typecheck`, `lint`, `fmt` e `fmt:check` rodam no workspace inteiro.
3. **`tsconfig`.** Base do T3, sem `tsconfig.effect.json` ainda. Reescreva as 5 *parameter properties* como campos e ponha `.ts` nos 79 imports sem extensão.
4. **Código.** Faça as trocas da tabela de equivalências, arquivo por arquivo, começando por `packages/kb/src/db/banco.ts` e `compilar.ts`.
5. **Instruções do MCP.** Gerador e `instrucoes.gerado.ts`. Apague `modulos.d.ts`.
6. **Testes.** `bun:test` vira `vitest`. Em `db/base.test.ts`, o teste "sem repositório" passa a `vi.mock("node:fs", …)` e `vi.mock` dos módulos `registro.ts` e `resolver.ts`. Confira a contagem por arquivo com o gabarito.
7. **Formatação.** `vite.config.ts` com `fmt.ignorePatterns` que deixa de fora `**/*.md`, `**/*.json`, `**/*.yaml`, `**/*.yml`, `base-conhecimento/**`, `dados/**`, `avaliacao/**`, `site/**`, `tmp/**`, `outputs/**`, `.repos/**`, `.agents/skills/*/{assets,base-analise,config,prompts,output}/**`, `**/*.py`. `vp fmt` num commit só de formatação, registrado em `.git-blame-ignore-revs`.
8. **Lint.** `vp lint` sem erro, com supressões justificadas.
9. **Executável.** `construir-executavel.ts`: um chunk, alvos `darwin-arm64`, `darwin-x64`, `win-x64`, `linux-x64`. Antes de gerar o SEA, confira que o bundle não importa nenhum pacote externo (como `findEsmImportsOfExternalPackages` do T3). Meça o tamanho.
10. **`.repos/effect`.** Script `scripts/sincronizar_repos.ts`, comando `pnpm sync:repos`.
11. **Documentos.** Troque `bun run X` por `pnpm X` ou `node X` em `AGENTS.md`, READMEs, `SKILL.md` e `base-conhecimento/docs/`. Reescreva o parágrafo de formatação do `AGENTS.md` (`vp fmt`, exclusões) e o de requisitos (`pnpm install` no lugar de `bun install`).
12. **Agendamento do SEI.** `scripts/agendar_sincronizacao_sei.ts` passa a gravar o caminho do Node no plist do launchd. Avise no PR que o agendamento precisa ser refeito na máquina do curador, com o comando documentado em `sincronizacao-sei-notion.md`.

**Riscos**

| Risco | Mitigação |
|---|---|
| `spyOn` em namespace ESM não funciona no vitest | `vi.mock` com fábrica parcial (passo 6). No C1, o teste passa a usar layers e deixa de precisar disso |
| Parâmetros nomeados do `bun:sqlite` com `strict: true` (sem prefixo) | o `node:sqlite` aceita sem prefixo por padrão (`allowBareNamedParameters`); confira cada consulta pelo gabarito |
| SQLite do Node com versão diferente da do Bun: FTS5 com `bm25` e `snippet` pode ordenar empates de outro jeito | o gabarito de `buscar-secoes` e `buscar-norma` pega; se houver empate instável, desempate explícito por ID na consulta, num commit próprio |
| `pnpm kb … --json` com cabeçalho do pnpm no stdout | conferir; se sujar, documente `pnpm -s kb` ou ajuste o `.npmrc` (`reporter`) |
| Aviso `ExperimentalWarning` do `node:sqlite` no stderr | não afeta o stdout do MCP nem o gabarito; se incomodar no executável, filtre o aviso no ponto de entrada |
| Executável Node maior que o Bun (o binário do Node 26 passa de 100 MB) | medir e registrar; compressão no pacote de distribuição; o app não usa o executável, só clientes externos |
| Assinatura no macOS depois da injeção do SEA | conferir se o `tsdown` assina ad hoc; se não, `codesign --sign -` no script. A assinatura definitiva continua decisão em aberto do plano do app |
| Variáveis do `.env.local` que só chegavam pelo carregamento automático do Bun | procurar `process.env.` em todo ponto de entrada e carregar com `dotenv` onde faltar |

**Critério de aceite**

- `pnpm install` num clone limpo, sem Bun instalado.
- `vp test`: mesmo número de casos por arquivo do gabarito, nenhuma falha.
- `effect-tsgo`, `vp lint` e `vp fmt --check` sem erro.
- Gabarito da CLI `kb`, do MCP e do banco igual, byte a byte.
- `validar_base` sem erro; geradores sem diferença no git; `site/` com o mesmo hash.
- Executável `simplifica-mcp` de `darwin-arm64` responde a `initialize`, `tools/list` e `tools/call` a partir de um diretório vazio que só tem o `kb.sqlite`, sem Node instalado no `PATH` (teste `stdio.test.ts` apontado para o binário).
- `rg -n '\bbun\b|Bun\.|bun:' --type ts` vazio; `rg -n 'bun (run|test|fmt|install)'` vazio nos `.md` fora de `docs/plans/` e de `base-conhecimento/normas/`.

**Verificação**

```bash
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm fmt:check
pnpm test
sh testes-gabarito/kb.sh --comparar
node packages/mcp/test/gabarito.ts --comparar        # tools/list e chamadas
node scripts/validar_base.ts
node packages/mcp/scripts/construir-executavel.ts
d=$(mktemp -d) && cp tmp/kb.sqlite "$d" && (cd "$d" && env -i PATH=/usr/bin:/bin "$OLDPWD/packages/mcp/dist-exe/simplifica-mcp" --banco kb.sqlite < /dev/null)
```

---

## C1 — `packages/kb` em Effect

**Objetivo.** O `kb` vira um conjunto de serviços Effect sobre um `SqlClient` de `node:sqlite`, com Effect Schema, erros tipados e a CLI em `effect/cli`. Os resultados não mudam.

**Escopo.**

- **Muda:** `packages/kb/**` e `tsconfig.effect.json` (novo).
- **Plugin de lint:** `ferramentas/oxlint-plugin/` (novo), com as regras copiadas do T3.
- **Ponte nos chamadores:** só no ponto de entrada de quem importa o `kb` com E/S. São `packages/mcp/src/servidor.ts`, os `main` de `scripts/*.ts` e `.agents/skills/revisar-ppc/scripts/subagents.ts`.

**Decisões**

| Decisão | Descartada |
|---|---|
| Regras puras (`normas/vigencia.ts`, `resolver.ts`, `impacto.ts`, `adequacao/art71.ts`, `busca/*`, `ppcs/secoes.ts`, `python/*`) continuam funções puras com a mesma assinatura | reescrevê-las em `Effect.gen`: nenhum ganho e risco à paridade |
| As fontes viram um serviço `FontesNormativas` com duas layers: `layerBanco` (tabelas do `kb.sqlite`) e `layerArquivos` (repositório). O teste de paridade roda os mesmos serviços sobre as duas | duas famílias de funções (`*Banco` e de arquivo), como hoje |
| "Sem repositório" garantido pelo tipo: `layerBanco` não exige `FileSystem` | `node:fs` espionado no teste, como hoje |
| `SqlClient` com o cliente do T3 copiado para `packages/kb/src/db/nodeSqliteClient.ts`, com atribuição MIT e o commit de origem no cabeçalho, sem worker de leitura (`readerWorker: false`) | `@effect/sql-sqlite-node` (`better-sqlite3`, nativo, quebra o SEA); cliente escrito do zero |
| Compilação do banco (`compilar.ts`) usa `DatabaseSync` direto dentro de um serviço `Compilador`, com `Effect.acquireRelease` e transação, porque são dezenas de milhares de inserções | `SqlClient` linha a linha: custo por instrução. Decidir pela medição (ver riscos) |
| Linhas decodificadas com `SqlSchema` e Effect Schema na borda do serviço | tipar com `as`: perde a garantia que o zod dá hoje |
| Memoização por banco (`memorizado`) vira construção na layer: registro, datas e transições são montados uma vez em `make` | `Effect.cached` por chamada |
| Formatador de mensagens pt-BR único, `src/esquema/mensagens.ts`, com `SchemaIssue.makeFormatterDefault` e ganchos de folha e de checagem em português | anotar `message` em cada schema |
| CLI `kb` em `effect/cli` com `NodeRuntime.runMain`; saída por `Console`. Comando que hoje imprime e sai com 1 imprime e falha com `EncerrarComCodigo`, tratado no ponto de entrada sem mensagem extra | manter `commander`: duas bibliotecas de CLI no fim |
| Ponte temporária: `Effect.runPromise` com as layers montadas uma vez, só nos pontos de entrada dos chamadores (lista no escopo). Some no C2 e no C3 | manter funções síncronas de compatibilidade no `kb`: viraria API dupla |
| Regras do plugin do T3 copiadas (MIT): `prefer-effect-fn`, `prefer-catch-tags`, `no-manual-effect-runtime-in-tests`, `namespace-node-imports`, `no-wall-clock-in-tests`, `no-real-time-wait-in-tests`, `require-suppression-reason`, `no-inline-schema-compile`, `no-global-process-runtime` | o plugin inteiro: regras de React, mobile e textos em inglês |

**Serviços** (proposta; junte serviços que ficarem com um método só)

| Serviço | Métodos | Depende de |
|---|---|---|
| `BaseKb` | `meta` (versão, commit, canal, `data_referencia`), conferência de `versao_esquema` | `SqlClient` |
| `FontesNormativas` | registro de normas, datas, transições, relações, sinônimos, tópicos | `SqlClient` (banco) ou `FileSystem` e `Path` (arquivos) |
| `Normas` | `buscar`, `dispositivos`, `vigencia`, `relacoes`, `correspondencia`, `resolver`, `ficha` | `FontesNormativas`, `SqlClient` |
| `Ppcs` | `buscarSecoes`, `lerSecao`, `citacoesDaNorma`, `fatos`, `divergencias` | `FontesNormativas`, `SqlClient` |
| `Cursos` | `listar`, `adequacaoArt71` | `SqlClient` |
| `Impacto` | `daNorma` | `FontesNormativas`, `SqlClient` |
| `PacoteContexto` | `montar` (ficha e curso), `doMarkdown` | `Ppcs`, `FontesNormativas` |
| `Compilador` | `compilar` | `FileSystem`, `Path` |

Layers prontas para os consumidores, em `src/layers.ts`:

- `layerSomenteLeitura({ caminho })`: banco somente leitura, todos os serviços de consulta, sem `FileSystem`. É a que o MCP e o fork usam.
- `layerRepositorio({ raiz })`: arquivos e recompilação automática do `tmp/kb.sqlite`. É a da CLI.

**Passos**

1. **Infraestrutura.** `effect` e `@effect/platform-node` como `peerDependencies` e `devDependencies` do `kb`, `tsconfig.effect.json` igual ao do T3 (com `schemaNumber: off` e as mesmas exceções de teste), plugin de lint com as regras escolhidas.
2. **Banco.** Cliente `nodeSqliteClient.ts`, `BaseKb` e o erro `BaseIncompativel`. `banco.ts` é removido.
3. **Fontes.** `FontesNormativas` com as duas layers, a partir de `db/fontes-banco.ts`, `db/fontes.ts`, `db/fontes-normativas.ts` e `normas/fontes-db.ts`.
4. **Serviços de consulta,** um por vez, cada um com os testes do módulo migrados para `@effect/vitest` antes de passar ao próximo: `Normas`, `Ppcs`, `Cursos`, `Impacto`, `PacoteContexto`.
5. **zod.** Troque por Effect Schema nos 21 arquivos do `kb`. `schema.ts` e `json.ts` viram schemas e o formatador pt-BR.
6. **`Compilador`.** Meça o tempo de compilação antes e depois, com `packages/kb/scripts/medir.ts` (novo: latência das consultas pesadas e tempo de compilação, rodado já no início do C1 para ter a linha de base).
7. **CLI.** `cli.ts`, `normas/comandos.ts` e `db/comandos.ts` em `effect/cli`.
8. **Paridade.** `db/base.test.ts` roda os serviços sobre `layerBanco` e `layerArquivos` no mesmo commit, e o teste "sem repositório" usa `layerSomenteLeitura` numa cópia do banco, sem `vi.mock`.
9. **Ponte nos chamadores** e `pnpm test` do repositório inteiro.
10. **Remoção.** Apague `modo-banco.ts` e as funções `*Banco`. Os chamadores usam os serviços pela ponte.
11. **Documentos.** `packages/kb/README.md`: serviços, layers e como consumir.

**Riscos**

| Risco | Mitigação |
|---|---|
| Latência de `SqlClient` mais `SqlSchema` em consultas grandes (`buscar-secoes`, `adequacao-art71`, `cursos --campus`) | medir antes e depois. Limite: até 20% acima de hoje, e menos de 200 ms por consulta (critério do M2.1). Acima disso, decodifique só os campos usados |
| Compilação mais lenta (hoje cerca de 8 s) | `DatabaseSync` direto no `Compilador`; limite de 20% acima |
| Efeitos síncronos chamados por regras puras (uma regra que lê arquivo no meio) | levantar no passo 3: a regra recebe o dado pronto pela fonte, sem ler arquivo |
| `effect/sql` e `effect/cli` instáveis | versão fixada (ver [Versões fixadas](#versões-fixadas)); o gabarito roda em cada atualização |
| Ponte esquecida depois do C2 e do C3 | critério de aceite do C3: nenhuma chamada a `runPromise` fora dos pontos de entrada |

**Critério de aceite**

- Gabarito da CLI `kb` igual, byte a byte (stdout e código de saída).
- Paridade banco × arquivos em todos os comandos de [T0](m0-simplifica-mcp.md#t0--banco-autossuficiente-em-packageskb), com a mesma exceção aceita (`impacto` só com fichas).
- O tipo de `layerSomenteLeitura` não exige `FileSystem`, e o teste "sem repositório" passa sem `vi.mock`.
- Testes do `kb` em `@effect/vitest`, com contagem igual ou maior que a do gabarito.
- Nenhum `zod` nem `commander` em `packages/kb`.
- Latência e compilação dentro dos limites, com os números registrados no PR.
- O resto do repositório (`pnpm test`, gabarito do MCP) continua passando pela ponte.

**Verificação**

```bash
pnpm typecheck && pnpm lint && pnpm fmt:check
pnpm --filter @simplifica-if/kb test
pnpm test
sh testes-gabarito/kb.sh --comparar
node packages/mcp/test/gabarito.ts --comparar
rg -n 'from "zod"|from "commander"' packages/kb
node packages/kb/scripts/medir.ts            # latência das consultas e tempo de compilação
```

---

## C2 — `packages/mcp` em Effect

**Objetivo.** As 16 ferramentas viram um Toolkit de `effect/ai`, servido em stdio pelo executável e exportado para o fork montar. Para a IA, nada muda.

**Escopo.** `packages/mcp/**`, `docs/plans/m0-simplifica-mcp.md` (seção "Estrutura do pacote", quando a outra tarefa tiver terminado de editá-lo) e, se faltar algum método, `packages/kb/src/` (só acréscimos, listados no PR).

**Ponto de partida (deixado pelo C1, ver o Andamento).**

- **Ponte.** As ferramentas chamam os serviços do kb por `ctx.kb(Servico.Servico.use((s) => s.metodo(...)))`. A função `abrirKb` (`servidor.ts`) monta `Layers.layerSomenteLeitura({ caminho })` uma vez e roda cada chamada com `Effect.runSync` e `Scheduler.PreventSchedulerYield`. O C2 troca isso pela layer no `McpServer.layerStdio` e tira o `runSync`.
- **SQL próprio.** Ainda há `DatabaseSync` no `Contexto` para o SQL próprio de três ferramentas: `sobre-a-base.ts`, os tipos de seção de `buscar-secoes.ts` e as fichas de `impacto-da-norma.ts`. Esse SQL vai para o serviço `Leitura` (ou para um método novo do kb, listado no PR).
- **Abertura e meta.** `packages/mcp/src/banco.ts` duplica o que `BaseKb` faz: `meta` com a mesma forma, mais `linhas`, e os erros `BaseIncompativel`/`BaseAusente`. A diferença está nas mensagens: o kb diz "base incompatível com esta versão do kb", e os testes do mcp conferem "…do simplifica-mcp; atualize". Mapeie as mensagens no transporte.
- **Testes "sem repositório".** `packages/mcp/test/normas.test.ts` e `ppcs-cursos.test.ts` ainda usam `packages/kb/src/testes/interceptacao.ts` (`vi.mock` de `node:fs`). Com `layerSomenteLeitura`, a garantia é de tipo; apague o módulo quando nenhum teste o usar e liste a remoção no PR.
- **Fixtures em memória.** `@simplifica-if/kb/db/conexao` (`layerDeConexao(db)`) dá um `SqlClient` sobre um `DatabaseSync` já aberto, útil para fixtures em memória.
- **Mensagens de entrada inválida.** O formatador pt-BR está em `@simplifica-if/kb/esquema/mensagens` (`formatarErro`, `problemas`). As folhas saem como "Entrada inválida: esperava um texto".

**Decisões**

| Decisão | Descartada |
|---|---|
| Um `Tool.make` por ferramenta, com `Tool.Title`, `Readonly`, `Idempotent`, `OpenWorld: false`, `Destructive: false`; `Toolkit.make` exportado como `FerramentasIfpr` | um Toolkit por domínio: o fork registra tudo junto de qualquer jeito |
| Serviço `Leitura` em `packages/mcp/src/leitura/` com um método por ferramenta, devolvendo a `Resposta<T>` (envelope, avisos, paginação, orçamento). O handler da ferramenta só chama `Leitura` e formata o texto Markdown | regra no handler: o RPC teria de duplicá-la |
| Registro próprio, `registrarFerramentas`, sobre `McpServer.addTool` (como o `registerImageTool` do T3). Motivos: o `content` é o texto Markdown, e o `registerToolkit` põe ali o JSON; e a entrada inválida volta como resultado `isError` com mensagem em português, como hoje, e não como erro `InvalidParams` do JSON-RPC | `McpServer.registerToolkit`: muda o texto que a IA lê e a forma do erro de validação |
| Mensagem de entrada inválida no formato atual, `Invalid arguments for tool <nome>: <campo>: <mensagem>`, com a mensagem do formatador pt-BR do `kb`. Os textos que os testes conferem (como "Entrada inválida: esperava um texto") saem iguais | mensagens padrão do Effect, em inglês |
| `inputSchema` e `outputSchema` gerados do Effect Schema (`Tool.getJsonSchema` e `Tool.getJsonSchemaFromSchema`) | JSON Schema escrito à mão |
| Transporte: `McpServer.layerStdio({ name: "ifpr", instructions: INSTRUCOES, protocols: [McpProtocol.v2025_06_18, McpProtocol.v2026_07_28], registrations })` com `NodeRuntime.runMain` | SDK `@modelcontextprotocol/server` sob o Toolkit: duas pilhas MCP |
| Cliente de teste continua o SDK oficial (`@modelcontextprotocol/client`, só `devDependency`), como teste de conformidade independente | `McpClient` do `effect/ai`: testaria o Effect contra ele mesmo |
| Pontos de entrada explícitos no `package.json`: `./toolkit` (Toolkit, `layerHandlers`, `registrarFerramentas`, `NOME_SERVIDOR`, `INSTRUCOES`), `./rpc` (grupo RPC de leitura e `layerHandlersRpc`), `./contratos` (schemas do envelope e dos tipos comuns) | exportação curinga `./*`: o fork dependeria de arquivos internos |
| Grupo RPC `GrupoLeitura` (`effect/rpc`) com as operações que o leitor e o Explorar usam: `fichaNorma`, `lerDispositivos`, `buscarNorma`, `fichaCurso`, `lerSecao`, `buscarSecoes`, `listarCursos`, `sobreABase`. Mesmos schemas de entrada e saída das ferramentas; handlers chamam `Leitura` | um contrato RPC separado: duas fontes de verdade |
| `pacote_contexto` lê da pasta de trabalho por `FileSystem` e `Path` do Effect, com `realPath` contra `..` e symlink | `node:fs` direto |

**Passos**

1. **Experimento antes de portar.** Confirme que o `McpServer.layerStdio` do Effect 4.1.3 atende clientes que pedem `2025-11-25` e o SDK 1.23 (Gemini CLI), e que dois `McpServer.layerHttp` com nomes e caminhos diferentes convivem no mesmo `HttpRouter`. Isso informa a [decisão em aberto 2](#decisões-em-aberto). Registre o resultado no PR.
2. **Contratos.** `src/contratos.ts`: envelope `Resposta`, `Aviso`, `Fonte`, `Link`, `NormaResumo`, `DispositivoTexto` em Effect Schema, a partir de `ferramentas/tipos-comuns.ts`.
3. **`Leitura`.** O serviço, a partir de `envelope.ts`, `orcamento.ts` e dos `responder` de cada ferramenta. `links.ts` e `texto.ts` continuam funções puras.
4. **Ferramentas.** Um arquivo por ferramenta em `src/ferramentas/`, cada um com `Tool.make` e o handler, mais `toolkit.ts` e `registrar.ts`.
5. **Transporte.** `servidor.ts` com `layerStdio`; `cli.ts` em `effect/cli` (`--banco` com `SIMPLIFICA_KB`, `--pasta-trabalho`, `--canal`, expansão de `~`). Sai a ponte do C1.
6. **Testes.** Os testes de protocolo (`stdio.test.ts`, as partes de `ferramentas.test.ts`, `normas.test.ts` e `ppcs-cursos.test.ts` que passam pelo cliente, `smoke-base-real.test.ts`) não mudam de expectativa. Os testes de unidade que chamavam `responder` passam a chamar `Leitura` em `it.effect`, com os mesmos valores esperados.
7. **Equivalência de schemas.** Um teste compara o `tools/list` com o gabarito: nomes, títulos, descrições e anotações iguais; `inputSchema` e `outputSchema` normalizados (chaves ordenadas, `$defs` resolvidos, sem `$schema`) iguais ou com diferenças listadas no próprio teste. O ajv valida as entradas válidas e inválidas dos testes contra o schema novo, com o mesmo veredito do antigo, e todo `structuredContent` do gabarito contra o `outputSchema` novo.
8. **RPC.** `rpc.ts` com `GrupoLeitura` e `layerHandlersRpc`, testados com `RpcTest`.
9. **Executável.** `construir-executavel.ts` com a entrada Effect. Confira de novo que o bundle não tem import externo.
10. **Saída do zod.** Tire `zod` e `@modelcontextprotocol/server` do `package.json`. Atualize `packages/mcp/README.md`.

**Riscos**

| Risco | Mitigação |
|---|---|
| Negociação de versão do protocolo diferente da do SDK 2.x | experimento do passo 1; teste com os clientes do SDK 1.23 e 2.x e com Claude Code e Codex reais antes do merge |
| JSON Schema do Effect diferente do zod em detalhes que mudam a escolha do modelo (`anyOf` com `null`, limites de inteiro, `additionalProperties`) | teste de equivalência do passo 7; ajuste por anotação no schema; as diferenças restantes entram no M0.5 como variável medida |
| O `McpServer` do Effect não aceitar `structuredContent` com `content` próprio no `addTool` | o `CallToolResult` do `McpSchema` tem os dois campos; conferido no código de `registerToolkit` |
| Regra `no-raw-mcp-registration` do T3 no fork acusar o `registrarFerramentas` | o arquivo fica neste repositório; se o fork lintar o submódulo, registre a exceção com motivo |
| Mudança de texto das descrições por descuido | o teste do passo 7 compara as descrições byte a byte com o gabarito |

**Critério de aceite**

- Os testes de protocolo passam sem mudança de expectativa.
- `tools/list` com nomes, títulos, descrições e anotações iguais ao gabarito, e JSON Schema equivalente pelo teste do passo 7.
- `content` e `structuredContent` das chamadas do gabarito iguais, byte a byte.
- Smoke contra a base real (`smoke-base-real.test.ts`) passa.
- Executável a partir de um diretório vazio, como no C0, nas quatro plataformas do script (pelo menos `darwin-arm64` executado; as outras compiladas).
- `@simplifica-if/mcp/toolkit`, `/rpc` e `/contratos` importáveis por um pacote de teste fora do `packages/mcp` (`packages/mcp/test/consumidor/`), que monta o Toolkit num `McpServer.layerHttp` em memória.
- Nenhum `zod`, `commander` ou `@modelcontextprotocol/server` em `packages/mcp`.

**Verificação**

```bash
pnpm typecheck && pnpm lint && pnpm fmt:check
pnpm --filter @simplifica-if/mcp test
node packages/mcp/test/gabarito.ts --comparar --schemas-equivalentes
SIMPLIFICA_KB=tmp/kb.sqlite pnpm --filter @simplifica-if/mcp test smoke-base-real
node packages/mcp/scripts/construir-executavel.ts --todos
claude mcp add ifpr-teste -- "$PWD/packages/mcp/dist-exe/simplifica-mcp" --banco "$PWD/tmp/kb.sqlite"   # conferência manual
```

---

## C3 — Resto do repositório

**Objetivo.** `scripts/`, `packages/sei-cli` e os scripts das skills sem zod e sem `commander`, com Effect nos pontos de entrada e nos clientes HTTP onde houver retentativa, prazo ou recurso a liberar. No fim, nenhum `zod` nem `bun` no repositório.

**Escopo.** `scripts/**`, `packages/sei-cli/**`, `.agents/skills/**` (scripts, testes, `README.md`, `SKILL.md`), `base-conhecimento/docs/*.md` (só comandos), `AGENTS.md`, `README.md`, `PLANO-ARQUITETURA.md` (só comandos).

**Ponto de partida (deixado pelo C1, ver o Andamento).**

- **Ponte na `revisar-ppc`.** Fica em `scripts/kb.ts`. `garantirBancoFresco(raiz)` chama o `Compilador` por `Effect.runPromise` no ponto de entrada (`revisar_ppc.ts`, subcomandos `montar-grupos-subagents` e `montar-grupo-avulso`) e no `beforeAll` de `orquestracao.test.ts`. `abrirKb(caminho)` monta `layerSomenteLeitura` e roda os métodos com `Effect.runSync`. `subagents.ts` usa `PacoteContexto.avulso` e `nomesDeCampi`.
- **Cópia zod.** `revisar-ppc/scripts/esquemas.ts` tem uma cópia zod temporária de `esquemaReferenciaNormativa`, para os JSON Schemas. A versão do kb é Effect Schema; ao migrar `gerar-schemas`, importe-a de volta e apague a cópia.
- **Scripts.** Os scripts não precisaram de ponte. Eles usam os carregadores síncronos que o kb mantém, com a supressão `nodeBuiltinImport` justificada: `carregarRegistro`, `carregarRelacoes`, `statusEm(…, raiz)`, `carregarTransicoes`, `indiceDispositivos`, `ppcsQueCitam` dos arquivos, `normasComCamposGerados` e outros. Ao passar um script a Effect, prefira `FontesNormativas.layerArquivos({ raiz })` e os serviços. Os carregadores síncronos saem do kb quando o último chamador sair, num acréscimo listado no PR.
- **Mudanças de API que os scripts já absorveram.** `ErroFrontMatter` virou `Schema.TaggedError`, com construtor `{ rotulo, detalhe }`. Os carregadores lançam `Schema.SchemaError` em vez de `ZodError`; formate com `esquema/mensagens.ts`. O esquema `esquemaNorma` é Effect Schema, usado por `scripts/base/validacao/normas.ts`.
- **`tsconfig.effect.json`.** No C1, só o `packages/kb` o estende. Com ele, `globalConsole`, `nodeBuiltinImport` e `globalDate` dão erro em todo arquivo, então a raiz, as skills e o `sei-cli` passam a estendê-lo quando forem migrados. As regras do plugin de lint (`ferramentas/oxlint-plugin`) também valem só em `packages/kb/**`: estenda os `overrides` de `vite.config.ts` junto.

**Decisões**

| Decisão | Descartada |
|---|---|
| zod vira Effect Schema em todos os arquivos, com o formatador pt-BR do `kb` | manter zod nos scripts: duas bibliotecas de schema |
| `gerar-schemas` da `revisar-ppc` gera os JSON Schemas de ficha e marcos com `Schema.toJsonSchemaDocument` (draft 2020-12). Os textos de `description` ficam iguais, porque os sub-agentes da revisão os leem | aceitar descrições reescritas: muda o comportamento da revisão |
| Equivalência dos JSON Schemas da `revisar-ppc` medida pelo veredito: as fichas e os marcos de `base-analise/` e de `tests/` validam igual (ajv) no schema antigo e no novo; mais um conjunto de exemplos inválidos, rejeitados pelos dois | exigir arquivo idêntico: o gerador do Effect ordena e agrupa de outro jeito |
| `NodeRuntime.runMain` e `effect/cli` nos pontos de entrada com argumentos (`sei`, `revisar_ppc.ts`, `avaliar.ts`, `notion_*`, `suap_*`, `sei_sync_agendado.ts`); scripts sem argumento só com `runMain` | migrar a lógica interna de todo script: custo sem retorno em scripts de execução única |
| Notion: `@notionhq/client` continua, dentro de um serviço `Notion` com erros tipados e retentativa por `Schedule` em limite de taxa | reescrever a API do Notion sobre `HttpClient` |
| SUAP: chamadas HTTP diretas passam a `HttpClient` do `effect/http`, com prazo e retentativa | `fetch` solto |
| SEI: `playwright` continua, com o navegador aberto por `Effect.acquireRelease` num serviço `NavegadorSei` | outra ferramenta de automação |
| `ajv` e `json-schema-to-typescript` continuam para `base-conhecimento/schemas/`, cuja fonte é JSON Schema e não zod | converter esses schemas para Effect Schema: são contrato publicado |

**Passos**

1. **Inventário.** `rg -l 'from "zod"|from "commander"' scripts packages/sei-cli .agents` e ordem por dependência.
2. **Fundação.** `scripts/config.ts`, `scripts/esquema.ts`, `scripts/lock.ts` e `scripts/dominio/`.
3. **Base.** `scripts/base/` e os quatro scripts do pipeline (`exportar_base_publica`, `gerar_indice_ppcs`, `validar_base`, `gerar_site`). Gabarito da base a cada passo.
4. **Avaliação.** `scripts/avaliacao/` e `avaliar.ts`, com `ChildProcessSpawner` do `effect/process` no executor.
5. **Notion, SUAP e SEI.** `scripts/notion/`, `scripts/suap/`, `scripts/sei/`, `packages/sei-cli`.
6. **Skills.** `revisar-ppc` (com `gerar-schemas`, `gerar-mapa`, `gerar-indice` e o teste de equivalência), `verificar-calendario`, `suap-ifpr`.
7. **Saída da ponte do C1** nos scripts e na `revisar-ppc`.
8. **Limpeza.** Tire `zod` e `commander` de todos os `package.json` e confira os documentos.

**Riscos**

| Risco | Mitigação |
|---|---|
| Fichas da `revisar-ppc` passam a ser aceitas ou rejeitadas de outro jeito | teste de veredito do passo 6, no CI |
| Sincronização SEI → Notion agendada quebra em silêncio | rodar `pnpm sei:sync` sem `--apply` antes e depois e comparar o plano de mudanças; conferir o primeiro disparo agendado depois do merge |
| Testes que dependem de credenciais (SEI, SUAP, Notion) não rodam no ambiente do agente | separar os testes com credencial e marcá-los; o PR registra quem os rodou e quando |

**Critério de aceite**

- `pnpm test` com contagem igual ou maior que a do gabarito, sem falha; `pytest` da `revisar-ppc` sem falha.
- `revisar_ppc.ts validar-base`, `gerar-schemas --check` (contra os schemas novos), `gerar-mapa --check` e `gerar-indice --check` sem erro.
- Teste de veredito dos JSON Schemas da `revisar-ppc` passa.
- Gabarito da base igual.
- `rg -n 'zod|commander' --type ts`, `rg -n '"zod"|"commander"' -g 'package.json'` e `rg -n '\bbun\b' -g '*.ts' -g '*.json' -g '*.md' --glob '!docs/plans/**' --glob '!base-conhecimento/normas/**'` vazios.
- Nenhuma chamada a `runPromise`, `runSync` ou `ManagedRuntime` fora dos pontos de entrada (`rg -n 'run(Promise|Sync)|ManagedRuntime' scripts packages .agents`, conferido à mão).

**Verificação**

```bash
pnpm typecheck && pnpm lint && pnpm fmt:check
pnpm test
python3 -m pytest .agents/skills/revisar-ppc/tests
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts validar-base
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts gerar-schemas --check
node scripts/exportar_base_publica.ts && node scripts/gerar_indice_ppcs.ts && node scripts/validar_base.ts && node scripts/gerar_site.ts && git status --short
pnpm sei:sync      # sem --apply: compara o plano de mudanças
```

---

## Fronteira entre C2 e C3

C2 e C3 começam juntos, depois do merge do C1, em worktrees separadas.

| Arquivo ou pasta | C2 | C3 |
|---|---|---|
| `packages/mcp/**` | sim | não |
| `packages/kb/**` | só acréscimos que o MCP exigir, listados no PR, e a remoção de `src/testes/interceptacao.ts` quando os testes do mcp deixarem de usá-lo | só a remoção dos carregadores síncronos que ficarem sem chamador, listada no PR |
| `scripts/**`, `packages/sei-cli/**`, `.agents/skills/**` | não | sim |
| `AGENTS.md`, `README.md`, `PLANO-ARQUITETURA.md`, `base-conhecimento/docs/*.md` | não (a parte do MCP no `AGENTS.md` vai no PR do C3, a pedido do C2) | sim |
| `docs/plans/m0-simplifica-mcp.md` | sim | não |
| `pnpm-workspace.yaml`, `package.json` da raiz, `vite.config.ts`, `tsconfig*.json` | só por um commit pequeno separado ("catalog: …"), integrado em `main` antes do resto | idem |
| `testes-gabarito/` | só `mcp.json` (se uma decisão explícita mudar o gabarito) | só a parte da base |

## Ordem e esforço

| Etapa | Depende de | Esforço estimado |
|---|---|---|
| C0 | T2 a T4 do M0.1 integrados | 2 a 4 dias |
| C1 | C0 | 5 a 8 dias |
| C2 | C1 | 3 a 5 dias |
| C3 | C1 (em paralelo com o C2) | 5 a 8 dias |

O M1.1 (fork) pode começar depois do C2: é o primeiro momento em que há Toolkit e RPC para registrar.

## Decisões em aberto

1. **Como o fork consome `@simplifica-if/kb` e `@simplifica-if/mcp`.**
   - **Recomendação: submódulo git** no fork, em `vendor/simplifica-if`, com sparse checkout de `packages/kb`, `packages/mcp` e dos arquivos de configuração. A pasta entra no `pnpm-workspace.yaml` do fork.
     - O código chega como fonte TypeScript, sem etapa de build.
     - Há uma única cópia do `effect`, a do catalog do fork, resolvida pela `peerDependency`.
     - Fica fora dos arquivos do T3, então não pesa no rebase.
     - As `fmt.ignorePatterns` e `lint.ignorePatterns` do fork excluem `vendor/**`; os testes do submódulo rodam aqui.
   - **Depois, quando a API do `kb` estabilizar:** pacote publicado (JavaScript gerado por `vp pack` e `.d.ts`) num registro privado, com `effect` como `peerDependency`.
   - **Descartada: dependência git do pnpm.** O pacote ficaria dentro de `node_modules`, e o Node não remove tipos de `.ts` dentro de `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). Só funcionaria com build, e aí o pacote publicado é melhor.
2. **Nome das ferramentas no fork.**
   - Se o Toolkit for registrado dentro do servidor MCP do T3, as ferramentas aparecem como `mcp__t3-code__buscar_norma`. Elas também ficam sujeitas à listagem adiada (`McpToolExposure`) e entram no orçamento medido por `AgentContextBudget.test.ts`.
   - **Recomendação:** um segundo endpoint MCP no mesmo servidor HTTP, `name: "ifpr"`, em `/mcp/ifpr`, com as nossas `instructions`, montado em `McpHttpServer.ts` com o mesmo `registrarFerramentas`, e registrado nas sessões dos providers ao lado do `t3-code`.
     - Os nomes ficam iguais aos do Marco 0 e das avaliações.
     - O texto de `instrucoes.md` chega à IA.
   - O experimento do passo 1 do C2 confirma a viabilidade.
3. **Largura da formatação.** 120, como hoje (recomendado), ou o padrão do oxfmt, como o T3. Só importa se o fork passar a formatar o submódulo.
4. **Compilação do banco por `SqlClient`.** Se a medição do C1 mostrar custo pequeno (até 20%), o `Compilador` pode usar o `SqlClient` e o `node:sqlite` direto sai do código. Decide-se no PR do C1.
   - **Medido no C1 (14/11/2026).** O `SqlClient` custa cerca de 1,6 µs a mais por instrução (50 mil inserções: 97 ms contra 18 ms). Com cerca de 120 mil instruções na compilação, isso dá uns 0,2 s, perto de 2% dos 12 s.
   - **Decisão do C1.** O `DatabaseSync` direto fica, dentro do `Compilador`. O custo não impede a troca, mas `preencherBanco` são umas 600 linhas síncronas, e reescrevê-las arrisca o determinismo do banco sem ganho no C1.
   - **Troca posterior.** Fica em aberto para um PR próprio, junto com `bancoDoPpcAvulso`, que poderia gravar num `SqlClient` `:memory:`, e com `db/conexao.ts`, que então sairia.

## Andamento

- 14/11/2026: plano criado depois da decisão de consolidar na stack do T3. Inventário dos dois repositórios no T3 `a6d9140972` e no simplifica-if `138f77a`.
- 14/11/2026: **C0 concluído.** Node 26.12.1 (`.node-version`, `engines`), pnpm 12.14.0 (`packageManager`, pelo corepack), `vp fmt`, `vp lint`, `vp test` e `effect-tsgo`; `bun.lock` e os `bunfig.toml` saíram. Gabarito capturado com Bun antes de qualquer mudança (`testes-gabarito/`) e conferido no Node:
  - CLI `kb`: 84 invocações iguais byte a byte (stdout e código de saída);
  - MCP: `initialize`, `tools/list` e as 33 chamadas iguais, pelo Node e pelo executável SEA, com a máscara descrita abaixo;
  - banco: as 32 tabelas, os índices e o esquema do FTS5 iguais;
  - base: geradores sem diferença no git, `validar_base` sem erro, `site/` com o mesmo hash (depois da troca dos comandos em `base-conhecimento/docs/`, que o site copia, o hash foi recalculado com o Bun sobre os documentos novos; Bun e Node geram o mesmo `site/`); `exportar_base_publica` com o mesmo diff do Bun (só a data do dia);
  - testes: 1014 casos em 69 arquivos, 1001 passando e 13 pulados; no Bun, 1015 casos, 1000 passando e 15 pulados. As diferenças: `instrucoes.test.ts` é novo (+1), e os blocos pulados do smoke contavam no JUnit do Bun um caso a mais cada (6 e 8; rodando, 5 e 7 nos dois executores, como em `testes-smoke.txt`).
  - Executável `simplifica-mcp` (Node SEA): 140,9 MiB em `darwin-arm64` (147,7 MB), contra 84 MB do binário do Bun; `darwin-x64` 144,4 MiB, `linux-x64` 145,6 MiB, `win-x64` 102,5 MiB. Responde a `initialize`, `tools/list` e `tools/call` num diretório vazio só com o `kb.sqlite`, com `PATH=/usr/bin:/bin`, e passa o `stdio.test.ts` apontado para ele (`SIMPLIFICA_MCP_EXE`).
  - Desvios do plano:
    1. **Máscara no gabarito.** As fontes do `kb.sqlite` incluem o código de `packages/kb/src`, e por isso a impressão digital (`meta.fontes_sha256`, `fontes_lista_sha256` e `fontes_total`) muda com qualquer mudança de código, sem mudar dado nenhum. Ela aparece na `meta` do banco, na versão `dev-<8 hex>` do envelope do MCP e na impressão da consulta nos cursores. `banco.sh` deixa essas três chaves fora do hash da `meta` (o `banco.txt` foi recalculado sobre o banco que o Bun compilou, com as outras 33 linhas iguais às da primeira captura), e `gabarito.ts --comparar` mascara a versão `dev-` e o hash do cursor (o deslocamento continua conferido). O C1, que reescreve o `kb`, depende dessa máscara.
    2. **`exportar_base_publica` fora de `base.sh`.** Ele lê o Notion e grava a data do dia; confere-se à mão, no mesmo dia, pelo `git diff` que deixa em cada runtime.
    3. **Sem commit só de formatação nem `.git-blame-ignore-revs`.** O `vp fmt` (largura 120) não mudou nenhum arquivo que a migração não tenha editado: o oxfmt formata este código como o `bun fmt`.
    4. **Testes importam de `vite-plus/test`**, como no T3, e não de `vitest`. O prazo padrão é de 60 s, como no T3: no Node, dois testes que percorrem a base inteira passam dos 5 s.
    5. **`vi.mock` com fábricas compartilhadas** em `packages/kb/src/testes/interceptacao.ts` para os três testes "sem o repositório" (`db/base.test.ts`, `mcp/test/normas.test.ts`, `mcp/test/ppcs-cursos.test.ts`). O mock de `node:fs` só alcança os módulos que o vitest transforma, não as dependências em `node_modules`, ao contrário do `spyOn` do Bun; a garantia completa vem no C1, com `layerSomenteLeitura`.
    6. **Executável pela API `vite-plus/pack`** (o tsdown do `vp pack`), sem arquivo de configuração: a CLI do `vp pack` não aceita a opção de empacotar as dependências. Três ajustes: `define` de `import.meta.main` como `false`, porque num bundle todo módulo é o principal e o `if (import.meta.main)` de `kb/src/db/compilar.ts` compilaria o banco ao iniciar (o `bun build` fazia essa troca sozinho); a conferência de imports usa o `parseAst` do Vite+, e não o TypeScript; e cada alvo é gerado num diretório temporário, porque o tsdown limpa o diretório do executável a cada build. O teste do `kb` que compilava um binário do Bun passa a gerar um Node SEA pela mesma API.
    7. **Lint.** As regras do T3 sem as de React e sem o plugin próprio, que entra no C1. `.claude/` fica fora de testes, lint e formatação: `.claude/skills` é symlink para `.agents/skills`, e o vitest rodaria os testes das skills duas vezes.
    8. **`tsconfig.base.json`** é o do T3, mais `noUnusedLocals`, `noUnusedParameters` e `noFallthroughCasesInSwitch`, que este repositório já tinha.
    9. **Módulos gerados fora da formatação** (`**/*.gerado.ts`), como os arquivos gerados no T3: o `--check` do gerador é a fonte do formato.
    10. **Corepack.** O Node 26 não traz o corepack; ele foi instalado com `npm install --global corepack` no Node 26.12.1 do fnm, como nos workflows do T3.
    11. **`pnpm sei`** roda `node src/cli.ts` dentro de `packages/sei-cli`, como o antigo `--cwd`, para que o `.env.local` do pacote (credenciais do SEI) seja lido; a sincronização (`scripts/sei/lote.ts`) chama `node src/cli.ts` ali, sem passar pelo script do pacote.
    12. **Exceções ao `grep` de `bun`.** Ficam os comentários de `relacoes.yaml`, `transicoes.yaml`, `config/vigencia.yaml` e da tabela de correspondência, e a `descricao` de `revisar-ppc/base-analise/marcos-normativos.json`: são fontes do `kb.sqlite` em `base-conhecimento/` e da base de análise, que o C0 não toca. Também ficam menções ao Bun como registro do que valia antes (comentários, `PLANO-ARQUITETURA.md`, planos).
  - Mudanças de código além das trocas mecânicas: `.get()` do `node:sqlite` devolve `undefined` onde o Bun devolvia `null`, o que invertia `atoForaDeVigencia` (`!== null`, corrigido para `!== undefined`); `segredos.ts` não desconta mais os valores que o Bun carregava sozinho dos `.env*` (o Node não os carrega); o agendamento grava o Node estável (`caminhoEstavelNode`, que recusa `Cellar/` e `fnm_multishells/`) e chama o script sem `run`.
  - Desempenho: as consultas ao banco empatam (o SQLite é o 3.54.0 nos dois); os comandos da CLI `kb` que leem arquivos (`citacoes`, `impacto`, `adequacao-art71`) ficaram cerca de 1,5 vez mais lentos, e o `kb.sh` inteiro leva 48 s, contra 33 s no Bun. A compilação do banco segue em cerca de 8 s.
  - Para o curador: o LaunchAgent instalado ainda chama `/opt/homebrew/bin/bun run …/scripts/sei_sync_agendado.ts`. Depois do merge, rode `pnpm install` e reinstale o agendamento com o Node 26.12.1: `node scripts/agendar_sincronizacao_sei.ts instalar` (ver `base-conhecimento/docs/sincronizacao-sei-notion.md`).
- 14/11/2026: **C1 concluído.** O `packages/kb` virou serviços Effect 4 sobre um `SqlClient` do `node:sqlite`; a CLI `kb` está em `effect/cli`; Effect Schema substituiu o zod. Serviços em `packages/kb/src/`: `BaseKb`, `FontesNormativas` (`layerBanco` e `layerArquivos`), `Normas`, `Ppcs`, `Cursos`, `Impacto`, `PacoteContexto` e `Compilador`. Layers prontas em `layers.ts`: `layerSomenteLeitura({ caminho })`, `layerRepositorio({ raiz })` e `layerConsultas`. O README do pacote descreve os serviços e como consumi-los. Gabarito conferido no Node 26.12.1:
  - CLI `kb`: as 84 invocações iguais byte a byte;
  - MCP: `initialize`, `tools/list` e as 33 chamadas iguais, pelo Node e pelo executável SEA (141,7 MB, sem import externo, `stdio.test.ts` 7/7 apontado para ele, num diretório vazio só com o `kb.sqlite`);
  - banco: as 32 tabelas iguais (`banco.sh`) e o `.dump` inteiro, com o FTS5, igual;
  - base: `validar_base` sem erro; `pnpm mcp:smoke` 12/12.
  - Testes: 1118 casos em 78 arquivos, sem falha, 13 pulados (os 12 do smoke e o de `sei-cli/test/fluxo.test.ts`, como no C0). No C0 eram 1014. As diferenças:
    - +103 na raiz: os testes das nove regras do plugin de lint (`ferramentas/oxlint-plugin/rules/*.test.ts`);
    - +1 em `packages/kb/src/db/base.test.ts`, que passou de 32 para 33 casos com o teste de tipo de `layerSomenteLeitura`;
    - `db/banco.test.ts` virou `db/fontes.test.ts`, com os mesmos 7 casos.

    Os testes do kb que rodam Effect usam `@effect/vitest`; os de regras puras continuam como estavam. A `revisar-ppc` passa `validar-base` e `gerar-schemas`, `gerar-mapa` e `gerar-indice` com `--check`. Sem `zod` nem `commander` em `packages/kb`. `pnpm fmt:check`, `pnpm lint` e `pnpm typecheck` estão limpos, sem diagnóstico de Effect.
  - Desempenho, na mesma máquina, com o C0 numa worktree do commit `f992933`:
    - `kb.sh` inteiro: 25 s, contra 48 s no C0. A CLI não lê mais os PPCs e as normas dos arquivos em `citacoes`, `impacto` e `adequacao-art71`; consulta o banco;
    - compilação: 12,2 a 12,3 s, contra 12,3 s no C0;
    - consultas, mediana em ms pelo `packages/kb/scripts/medir.ts` (C1) contra as funções do `modo-banco` (C0):

      | Consulta | C0 | C1 |
      |---|---|---|
      | `buscar-secoes` | 2,8 | 3,0 |
      | `buscar-norma` (citação) | 2,0 | 2,6 |
      | `cursos` | 1,0 | 0,9 |
      | `adequacao-art71` | 12,5 | 1,4 |
      | `impacto` | 72,4 | 14,2 |
      | `pacote-contexto` | 10,6 | 10,6 |

      Todas ficam muito abaixo dos 200 ms do M2.1. Duas passavam de 20% na primeira versão e foram corrigidas: `adequacao-art71` (19,6 ms) passou a ler só as citações das DCN da EPT, as únicas que a regra olha; `correspondencia` (de 0,2 para 0,9 ms) passou a carregar a fonte de correspondência uma vez, na construção da layer.
  - Desvios do plano:
    1. **Chave dos serviços.** É `@simplifica-if/kb/<Nome>`, e não `simplifica-if/kb/<Nome>`: o diagnóstico `deterministicKeys` do `effect-tsgo` exige o nome do pacote.
    2. **`tsconfig.effect.json` só no `packages/kb`.** Ele liga `globalConsole`, `nodeBuiltinImport` e `globalDate` como erro em qualquer arquivo, o que reprovaria `scripts/`, as skills, o `sei-cli` e o `mcp` antes da migração deles. O mesmo vale para as regras do plugin de lint (`ferramentas/oxlint-plugin`, nove regras do T3, com os testes delas: +103 casos na raiz), ligadas por `overrides` só em `packages/kb/**`. A regra `namespace-node-imports` do T3 pede `NodeFS`, com S maiúsculo, e não `NodeFs`.
    3. **Carregadores síncronos.** Continuam no kb `carregarRegistro`, `carregarRelacoes`, `statusEm(…, raiz)`, o parser das normas, o `ppcsQueCitam` dos arquivos e outros, cada arquivo com a supressão `nodeBuiltinImport:off -- motivo`, como as ~90 do T3. Os scripts e a compilação os usam. A `FontesNormativas.layerArquivos` lê por `FileSystem` e `Path` e interpreta com as mesmas funções puras, extraídas deles (`montarRegistro`, `relacoesDoYaml`, `transicoesDoYaml`, `dataReferenciaDoYaml`, `sinonimosDoYaml`). Nenhum serviço chama os carregadores síncronos.
    4. **`Compilador`.** O estado do banco (`estadoDoBanco`) e o hash das fontes continuam síncronos em `db/fontes.ts`: percorrem e hasheiam milhares de arquivos a cada comando da CLI. Só a orquestração da gravação usa `FileSystem` e `acquireUseRelease`. A decisão em aberto 4 foi medida; ver lá.
    5. **`db/conexao.ts`, fora do plano.** É um `SqlClient` sobre um `DatabaseSync` já aberto, para o banco em memória do PPC avulso (`bancoDoPpcAvulso`, gravado pelo mesmo código da compilação) e para fixtures. O cliente do T3 só abre por nome de arquivo.
    6. **Ponte com `Effect.runSync`, e não `runPromise`.** As ferramentas do MCP e as funções da `revisar-ppc` são síncronas, e as consultas sobre o `node:sqlite` também. As pontes (`packages/mcp/src/servidor.ts`, `abrirKb`; `.agents/skills/revisar-ppc/scripts/kb.ts`) montam `layerSomenteLeitura` uma vez num escopo do processo e rodam com `Scheduler.PreventSchedulerYield`. Sem isso, um efeito síncrono longo, como decodificar milhares de linhas, cede a vez ao agendador, e o `runSync` falha com "An asynchronous Effect was executed with Effect.runSync" (visto no `impacto_da_norma`). Pelo mesmo motivo, `Effect.cached` não serve na ponte, e os valores fixos são carregados na construção da layer. A `revisar-ppc` garante o banco fresco no ponto de entrada (`garantirBancoFresco`, `Effect.runPromise` do `Compilador`). Os scripts não precisaram de ponte: não usam o banco.
    7. **Chamadores além do ponto de entrada.** Com a saída do `modo-banco`, as 16 ferramentas do mcp trocaram as chamadas `*Banco(db, …)` por `ctx.kb(Servico.use(…))`, sem mudar resultado; o SQL próprio de três ferramentas ficou no `DatabaseSync`. Na `revisar-ppc`, `subagents.ts`, `revisar_ppc.ts` e `orquestracao.test.ts` adotaram a ponte, e `esquemas.ts` ganhou uma cópia zod temporária de `esquemaReferenciaNormativa`, para gerar os JSON Schemas. `scripts/base/validacao/normas.ts` e `scripts/base/front-matter.ts` acompanharam o Effect Schema de `esquemaNorma` e o novo `ErroFrontMatter`, agora `Schema.TaggedError` com `{ rotulo, detalhe }`.
    8. **Formatador pt-BR.** Usa `SchemaIssue.makeFormatterStandardSchemaV1` com ganchos de folha e de checagem: no Effect 4.1.3, `makeFormatterDefault` não aceita ganchos.
    9. **CLI.** `NodeRuntime.runMain` roda com `disableErrorReporting`, porque o relatório padrão escreve no stdout. Os erros tipados vão para o stderr como `kb: <mensagem>`. `EncerrarComCodigo` só define o código de saída. O `pnpm kb:compilar` virou o subcomando `kb compilar`; o `main` de `db/compilar.ts` saiu, e com ele o motivo do `define` de `import.meta.main` no executável, que continua por precaução.
    10. **Impressão digital das fontes.** Os serviços, as layers, a CLI e o cliente SQL ficaram fora das fontes do banco (`CODIGO_FORA` em `db/fontes.ts`): mudar uma consulta não recompila o banco.
    11. **`testes/interceptacao.ts`.** Fica para os testes do mcp. O teste do kb passou a usar `layerSomenteLeitura`; ver o C2.
- 14/11/2026: **C2 concluído.** O `packages/mcp` virou um Toolkit do `effect/ai` (`FerramentasIfpr`, um `Tool.make` por ferramenta), servido em stdio por `McpServer.layerStdio` com `NodeRuntime.runMain` e a CLI em `effect/cli`. O serviço `Leitura` (`src/leitura/`) monta envelope, avisos, paginação e orçamento, e serve ao Toolkit e ao grupo RPC `GrupoLeitura` (as 8 operações do plano). Saíram a ponte `ctx.kb`, o `DatabaseSync` do `Contexto` (o SQL próprio foi para o `Leitura`), `banco.ts`, `ferramentas/index.ts`, `tipos-comuns.ts` (virou `contratos.ts`) e `packages/kb/src/testes/interceptacao.ts`. Nenhum `zod`, `commander` nem `@modelcontextprotocol/server` no pacote; `effect` e `@effect/platform-node` são `peerDependencies`, e o cliente do SDK fica em `devDependencies`. Exports para o fork: `@simplifica-if/mcp/toolkit` (`FerramentasIfpr`, `FERRAMENTAS`, `layerHandlers`, `registrarFerramentas`, `layerRegistro`, `layerLeitura`, `Leitura`, `NOME_SERVIDOR`, `VERSAO_PACOTE`, `INSTRUCOES`, `PROTOCOLOS`), `/rpc` (`GrupoLeitura`, `layerHandlersRpc`, `layerLeitura`, `Leitura`) e `/contratos`. Conferido no Node 26.12.1:
  - **Experimento do passo 1** (refeito nesta data, porque o primeiro não ficou registrado):
    - stdio: o `layerStdio` do Effect 4.1.3 atende o cliente do SDK 1.23 (a geração do Gemini CLI) e o do SDK 2.4 nos modos `legacy` e `auto` (era moderna, `2026-07-28`). Um cliente que pede `2025-11-25` recebe `2025-06-18` se a versão não estiver na lista de `protocols`; com ela, recebe `2025-11-25`. Por isso `PROTOCOLOS` é `[v2025_11_25, v2025_06_18, v2026_07_28]`;
    - dois `McpServer.layerHttp` (`/mcp` "T3 Code" com `registerToolkit` e `/mcp/ifpr` "ifpr" com `addTool`) convivem no mesmo `HttpRouter`, cada um com nome e instruções próprios, **desde que o segundo use `Layer.fresh`**. Sem ele, o `McpServer` é memoizado e os dois endpoints listam as ferramentas um do outro, e a chamada vai para o handler errado. Isso confirma a recomendação da decisão em aberto 2, com o `Layer.fresh`, documentado em `src/toolkit.ts`, no README e testado em `test/consumidor/`.
  - Gabarito do MCP pelo protocolo (`gabarito.ts --comparar --schemas-equivalentes`, novo), pelo Node e pelo executável: as 33 chamadas iguais byte a byte (`content` e `structuredContent`, com a máscara do C0), instruções iguais, `tools/list` com nomes, títulos e descrições iguais.
  - Equivalência dos JSON Schemas (`equivalencia-schemas.test.ts`, sobre as definições, e o mesmo pelo protocolo): forma normalizada igual, salvo `propertyNames: {type: "string"}` dos registros, que o zod escreve e o Effect não (4 caminhos, listados em `test/equivalencia.ts`); 6189 amostras válidas e inválidas, de entrada (as chamadas do gabarito e variações de cada campo nos limites) e de saída (cada `structuredContent` do gabarito e variações), com o mesmo veredito do ajv nos dois schemas.
  - CLI `kb`: as 84 invocações iguais byte a byte. `pnpm mcp:smoke` 12/12; `validar_base` OK.
  - Testes: 1131 casos em 81 arquivos, 1118 passando, 13 pulados, sem falha. No C1 eram 1118 em 78; +13 no mcp: `equivalencia-schemas.test.ts` (1), `rpc.test.ts` (9), `consumidor/consumidor.test.ts` (3). `banco.test.ts` virou `abertura.test.ts`, com os mesmos 8 casos; os testes de protocolo e de unidade mantêm as expectativas, agora em `it.effect` sobre o `Leitura`.
  - Executável SEA: 142,0 MB em `darwin-arm64` (contra 141,7 MB no C1), `darwin-x64` 145,5 MB, `linux-x64` 146,7 MB, `win-x64` 103,6 MB; bundle de 3110 kB sem import externo. Num diretório vazio só com o `kb.sqlite`, com `PATH=/usr/bin:/bin`, responde a `initialize`, `tools/list` e `tools/call` com os clientes do SDK 1.23 e 2.4 (`legacy` e `auto`), e passa o `stdio.test.ts` (7/7) apontado para ele.
  - `pnpm fmt:check`, `pnpm lint` e `pnpm typecheck` limpos.
  - Desvios do plano:
    1. **`initialize` diferente do gabarito em dois pontos que o Effect 4.1.3 não deixa escolher:** o `serverInfo` perde o `title` ("Base de conhecimento do IFPR"), que o `layerStdio` não aceita, e as capacidades ganham `logging` e `completions`, que o runtime do `McpServer` sempre anuncia. O servidor não registra nenhum dos dois, e os clientes testados os ignoram. Aceitos no `--schemas-equivalentes`.
    2. **`destructiveHint: false` explícito nas anotações.** O `McpSchema.ToolAnnotations` do Effect sempre escreve `destructiveHint`, com padrão `true`, tanto pelo construtor quanto pela decodificação; o comentário anterior do `registrar.ts`, que dizia evitá-lo pela decodificação, estava errado, e o `tools/list` anunciava as ferramentas como destrutivas. Agora vai `false`, como a anotação `Tool.Destructive` do Toolkit. É a única diferença de anotação em relação ao gabarito, aceita no teste de equivalência.
    3. **Mensagem de entrada inválida com formatador próprio** (`src/validacao.ts`), e não o de `@simplifica-if/kb/esquema/mensagens`: as mensagens que a IA lê são as do zod `pt-BR` do servidor anterior ("Pequeno demais: esperava que o texto tivesse >= 1 caracteres"), conferidas byte a byte pelo gabarito, e o formatador do kb tem outro texto, pensado para a CLI.
    4. **Campos com padrão obrigatórios no RPC.** O cliente RPC passa o payload decodificado, então `limite`, `integral`, `filhos` e afins, que a ferramenta MCP completa com padrão, são obrigatórios no `GrupoLeitura` (anotado em `src/rpc.ts`). O `/contratos` não exporta os schemas de dados de cada ferramenta por nome; o fork chega a eles por `FERRAMENTAS[i].dados` e `.saida`.
    5. **`-0` no `structuredContent`.** O arredondamento da pontuação em `packages/kb/src/db/consultas.ts` dá `-0` em alguns casos, desde antes da migração. O `InMemoryTransport` dos testes antigos o preservava; o HTTP em memória dos testes novos serializa em JSON (`0`). O teste do protocolo em `ppcs-cursos.test.ts` compara as duas respostas depois de serializá-las, sem mudar valor esperado.
    6. **Supressões nos scripts e nas fixtures.** O `packages/mcp` estende o `tsconfig.effect.json`; os scripts de build (`construir-executavel.ts`, `gerar-instrucoes.ts`), as fixtures e os testes que usam `node:fs`, `node:sqlite` ou processos filhos têm `@effect-diagnostics nodeBuiltinImport:off` (e `globalConsole:off` nos scripts) com o motivo, como no kb. `test/apoio.ts` suprime `no-inline-schema-compile` (o schema muda a cada ferramenta).
    7. **Arquivos compartilhados.** Só `vite.config.ts`, no commit separado `catalog: regras de lint do Effect também no packages/mcp` (os `overrides` do plugin próprio estendidos ao `packages/mcp`), e o `pnpm-lock.yaml`. O `AGENTS.md` não menciona o pacote do MCP por dentro; nada a pedir ao C3.
- 14/11/2026: **C3 concluído.** `scripts/`, `packages/sei-cli` e as skills sem `zod`, `commander` nem `bun`; nenhum `package.json` do repositório os declara mais. Retomado depois de uma parada por limite de taxa: o trabalho pela metade de quatro worktrees de subagente (sei-cli; avaliação; Notion e notificação; SUAP) foi commitado como "em andamento" e integrado por merge, e as seis worktrees `agent-*` e os branches `worktree-agent-*` foram removidos.
  - **Viraram Effect** (serviços, erros `Schema.TaggedError`, `NodeRuntime.runMain` por `scripts/principal.ts` e `effect/cli` nos pontos de entrada com argumentos):
    - Notion: serviço `Notion` (`scripts/notion/cliente.ts`) sobre o `@notionhq/client`, com a retentativa do SDK desligada e a própria por `Schedule` (1, 2, 4, 8 s, até 10 s, ou o `retry-after`), erros por status (`NotionLimiteDeTaxa`, `NotionFalhaTransitoria`, `NotionNaoAutorizado`, `NotionNaoEncontrado`, `NotionPedidoRecusado`) e `layerMemoria` para os testes; `notion_atualizar_movimentacoes_sei.ts` e `notion_atualizar_cursos_movimentacoes.ts` em `effect/cli`, com o programa da sincronização em `notion/sincronizacao-sei.ts` (serviços `LoteSei` e `Notificador`);
    - SUAP: `SessaoSuap` sobre `HttpClient`, cookies em `Ref`, redirecionamentos à mão, prazo de 30 s, duas retentativas nas leituras e nenhuma no POST do login; credenciais por `Config`; os três `suap_*` em `effect/cli`;
    - SEI: `NavegadorSei` abre o Playwright por `acquireRelease` (cada sessão do lote num escopo filho, fechada antes de abrir a próxima); `sei` em `effect/cli`; `scripts/sei/lote.ts` com `ChildProcessSpawner`, `Clock` e `Console`, e `consultarLote` devolvendo `Effect` com `FalhaLote`;
    - notificação: `Notificador` (terminal-notifier ou osascript por `ChildProcessSpawner`, prazo de 15 s); `agendar_sincronizacao_sei.ts` em `effect/cli` (`instalar`, `remover`, `status`), com o `launchctl` pelo `ChildProcessSpawner`;
    - avaliação: `avaliar.ts` em `effect/cli`, executor por `ChildProcessSpawner`; `revisar_ppc.ts` em `effect/cli`, sem a ponte do C1.
  - **Só trocaram zod por Effect Schema:** `scripts/esquema.ts` (`solto`, `ESTRITO`, `validarJson`, `decodificarOuNada`, com o formatador pt-BR do kb), `config.ts`, `lock.ts`, `dominio/`, `dados/institucional.ts`, o pipeline da base (`scripts/base/`, síncrono, com supressões `nodeBuiltinImport` justificadas), os contratos da `revisar-ppc` (`esquemas.ts`, sem a cópia zod de `esquemaReferenciaNormativa`) e da `verificar-calendario`, e os schemas do `sei-cli`.
  - Conferido no Node 26.12.1, depois do merge de `main` com o C2: `pnpm fmt:check`, `pnpm lint` e `pnpm typecheck` limpos; CLI `kb` com as 84 invocações iguais; gabarito da base igual (geradores sem diferença no git, `validar_base` OK); `revisar_ppc.ts validar-base`, `gerar-schemas --check`, `gerar-mapa --check` e `gerar-indice --check` OK; `pytest` da `revisar-ppc` 16 passando e 1 pulado (com `uv run --with pytest --with-requirements requirements.txt`: o Python da máquina não tem o pytest).
  - **Veredito dos JSON Schemas da `revisar-ppc`** (`tests/schemas-gerados.test.ts`, 57 casos): todas as fichas e marcos de `base-analise/` e de `tests/` e um conjunto de exemplos inválidos têm o mesmo veredito e as mesmas mensagens do ajv no schema anterior ao C3 (cópia congelada em `tests/fixtures/schemas-anteriores/`) e no gerado por `Schema.toJsonSchemaDocument`; as `description` são iguais.
  - Testes: 1251 casos em 86 arquivos, 1238 passando e 13 pulados (os mesmos do C2), sem falha. No C2 eram 1131. As diferenças, todas na raiz (+97) e no `sei-cli` (+23): `revisar-ppc/tests/schemas-gerados.test.ts` (+57, novo), SUAP (`cliente.test.ts` novo com 12, `consultas` +3, `matrizes` +3, `tutoriais` +5), `notion/sincronizacao-sei.test.ts` (+7, novo: o plano de mudanças do `sei:sync` igual ao do script anterior, sobre o Notion e o lote em memória), `avaliacao/executor.test.ts` +5, `notion/cliente.test.ts` +2 (retentativa com `TestClock` e `retry-after`), `dados/institucional`, `lock` e `sei/lote` +1 cada; no `sei-cli`, `operacoes.test.ts` (14, novo: `NavegadorSei` falso, retentativa, segunda passada, prazo e fechamento do navegador), `apresentacao.test.ts` (5, novo) e `esquemas.test.ts` +4.
  - Nenhuma chamada real a Notion, SEI ou SUAP: tudo sobre fixtures, `layerMemoria`, o `HttpClient` falso do SUAP e um `NavegadorSei` falso. O `sei-cli` foi conferido contra a CLI antiga em 28 casos locais (stdout e código de saída iguais) e com o Chromium apontado para `127.0.0.1:9`.
  - Desvios do plano:
    1. **Carregadores síncronos do kb: nenhum removido.** O pipeline da base (`gerar_base`, `validar_base`, `gerar_indice_ppcs`, `gerar_site`) continua síncrono, como decidido ("migrar a lógica interna de todo script: custo sem retorno"), e ainda usa `carregarRegistro`, `carregarRelacoes`, `carregarTransicoes`, `statusEm`, `indiceDispositivos`, `ppcsQueCitam`, `normasComCamposGerados`, `lerRegistroStubs`, `lerSinonimos` e `lerTopicosSecoes`. Comparados os imports de `@simplifica-if/kb` em `scripts/`, `.agents/` e `packages/sei-cli` antes e depois, só saíram `PAPEIS_REFERENCIA` e `ErroFrontMatter`, que o kb usa por dentro. `packages/kb` não foi tocado pelo C3.
    2. **`sei_sync_agendado.ts` fica sem Effect.** É a rede de segurança do LaunchAgent: importa só módulos do Node (e `notificacao/alerta.ts`, também sem pacotes), para avisar mesmo quando as dependências não carregam depois de um `git pull`. Supressões `nodeBuiltinImport`, `globalConsole` e `globalDate` justificadas no arquivo.
    3. **Erro de uso com código 1, e não 2,** em `suap_*`, `sei` e `agendar_sincronizacao_sei` (padrão do `effect/cli`, como `kb` e `revisar_ppc`). No `sei`, SIGTERM sai com 130 (`runMain`), e não 143; `--ultimos` antes de `lote` passa a ser recusado e valores não inteiros não são mais truncados; o `erro` de uma falha do Playwright no JSONL do lote traz só o tipo do erro, sem a mensagem crua com a URL (perde detalhe como `ERR_CONNECTION_REFUSED`). A ajuda do `sei` mudou de forma. `suap_coletar_matrizes` sem credenciais falha uma vez, antes de coletar.
    4. **Hash do `site/` recapturado** (`testes-gabarito/base.txt`): mudaram só três documentos de `base-conhecimento/docs` que o site copia (zod → Effect Schema), conferido por `diff -r` contra o site do commit anterior, em que o gabarito era igual.
    5. **Exceções ao `grep` de `zod`:** os comentários "Contrato: … (zod)" nos YAML que são fontes do `kb.sqlite` (`relacoes.yaml`, `transicoes.yaml`, `normas/stubs.yaml`, a tabela de correspondência, `packages/kb/dados/*.yaml`) e os comentários históricos em `packages/kb/src` (fora do escopo do C3); a `description` da cópia congelada dos schemas anteriores (`tests/fixtures/schemas-anteriores/`), que registra de onde ela veio; comentários de `scripts/esquema.ts` que comparam com o zod; e o `PLANO-ARQUITETURA.md`, que o escopo só deixa mexer em comandos. `bun` só fica em `testes-gabarito/README.md`, como registro da captura do C0.
    6. **`pnpm sei:sync` sem `--apply` não foi rodado** antes e depois, como pedia a verificação: ele lê o Notion e o SEI de verdade. A equivalência do plano de mudanças ficou com `sincronizacao-sei.test.ts`, que compara o plano do programa novo com capturas do script anterior.
    7. **Arquivos compartilhados:** `package.json` da raiz (saíram `zod` e `commander`), `pnpm-lock.yaml`, `tsconfig.json` e `tsconfig.effect.json` (a raiz estende o `tsconfig.effect.json`), e `vite.config.ts` (os `overrides` do plugin de lint valem também em `scripts/**`, `packages/sei-cli/**`, `.agents/skills/**` e `testes-gabarito/**`; o conflito com o C2 nesse arquivo foi resolvido somando as duas listas, e o override de testes passou a valer para todo `*.test.ts`).
  - Para o curador: o LaunchAgent não foi mexido. Depois do merge, rode `pnpm install`; o agendamento instalado continua chamando `scripts/sei_sync_agendado.ts`, que não mudou de contrato. Na primeira hora útil, confira o `tmp/logs/sei-sync.log` (é a primeira execução real do `sei:sync` com o Notion, o SEI e o notificador em Effect), e rode um `pnpm sei:sync` sem `--apply` para ver o plano. `agendar_sincronizacao_sei.ts` passou a ter subcomandos do `effect/cli` (`instalar --de 8 --ate 18 --minuto 5`, `remover`, `status`), com os mesmos nomes.
