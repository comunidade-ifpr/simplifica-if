# Serviços Effect

Regras para escrever e manter código com Effect 4 neste repositório: serviços, transporte, tracing, fronteira de runtime, erros e testes. Valem para `apps/server`, `packages/mcp`, `packages/motor`, `packages/kb`, `packages/ppc`, `packages/docx`, `packages/atualizacao`, `packages/contratos-app` e `scripts/`. A revisão de arquitetura usa esta página como critério.

Para a biblioteca, leia [`.repos/effect/LLMS.md`](../../.repos/effect/LLMS.md) e os exemplos de `.repos/effect/ai-docs/src/`; para dúvidas de API, o código em `.repos/effect/packages/effect/src/` e `.repos/effect/packages/platform/node/src/` (a tag `effect@4.1.3` do catalog). Prefira os padrões de lá aos inventados.

**Origem.** Adaptado do T3 Code (MIT, Copyright (c) 2026 T3 Tools Inc.), commit `a6d91409729be6ba854b3f16adedc08847e3b24c`: `docs/internals/effect-services.md`, o checklist `.macroscope/check-run-agents/effect-service-conventions.md`, `docs/internals/testing.md` e as seções "Verifying" e "Taste" do `AGENTS.md`. A parte está registrada em [`docs/upstream-t3.md`](../upstream-t3.md); `node scripts/upstream_t3.ts diff servicos-effect` mostra o que mudou lá desde então.

**Língua.** Identificadores, mensagens de erro e comentários em português, como manda a seção "Tecnologia e língua do código" de [`docs/plans/app-simplifica-if.md`](../plans/app-simplifica-if.md#tecnologia-e-língua-do-código). A API do Effect é o que é. O código copiado do T3 (`packages/motor/src/t3`, `apps/server/src/t3`, `packages/effect-acp`, `packages/effect-codex-app-server`) fica como veio, em inglês.

## Onde mora uma capacidade

Uma capacidade é um método de um serviço do domínio. Estenda o serviço que já é dono do domínio; crie um novo só quando nenhum for. Os domínios de hoje:

- `packages/kb/src`: `Normas`, `Ppcs`, `Cursos`, `Conselhos`, `Impacto`, `PacoteContexto`, `FontesNormativas`, `BaseKb`, `Compilador`;
- `packages/mcp/src/leitura`: `Leitura` (a leitura que as ferramentas MCP e o RPC compartilham) e `PastaTrabalho`;
- `packages/motor/src`: `Motor`;
- `apps/server/src`: `Conversas`, `PastasTrabalho`, `ArquivosLiberados`, `Relatos`, `CatalogoSkills`, `Atualizador`, `Autenticacao`, `persistencia/` e `revisao-ppc/`.

O transporte é casca fina. Ele faz três coisas: decodifica a entrada, chama um método de serviço e traduz os erros tipados para o erro do transporte. Arquivo, processo, banco, rede, nome de pasta, despacho em várias etapas, nova tentativa e desfazer ficam no serviço. O motivo é alcance: a mesma capacidade chega pela interface (RPC), pela IA (MCP), pela CLI `kb` e pelos scripts. Lógica escrita num handler falta nos outros e só se testa com um socket.

Os transportes deste repositório:

- **Handlers RPC do servidor:** [`apps/server/src/handlers.ts`](../../apps/server/src/handlers.ts) (os grupos de `@simplifica-if/contratos-app`) e os handlers de leitura de [`packages/mcp/src/rpc.ts`](../../packages/mcp/src/rpc.ts).
- **Ferramentas MCP:** o `layerHandlers` de [`packages/mcp/src/ferramentas/toolkit.ts`](../../packages/mcp/src/ferramentas/toolkit.ts). Cada arquivo de `ferramentas/` declara só schema, descrição e o texto da resposta.
- **CLI `kb`:** [`packages/kb/src/cli/`](../../packages/kb/src/cli/), comandos do `effect/cli` que chamam o serviço e formatam a saída.
- **Scripts:** os pontos de entrada de `scripts/*.ts` sobre [`scripts/principal.ts`](../../scripts/principal.ts) (`executarPrincipal`), e os de `packages/*/scripts/`.

O melhor exemplo é o Toolkit do MCP, em que cada ferramenta é um método de `Leitura`:

```ts
// packages/mcp/src/ferramentas/toolkit.ts
export const layerHandlers = FerramentasIfpr.toLayer(
  Effect.gen(function* () {
    const leitura = yield* Leitura.Leitura;
    return FerramentasIfpr.of({
      buscar_norma: leitura.buscarNorma,
      ler_dispositivos: leitura.lerDispositivos,
      // …
    });
  }),
);
```

Nos handlers RPC, `traduzir` (e `traduzirStream`, para os métodos em stream) é a tradução do transporte, a mesma para todos os métodos de todos os grupos: registra a falha no log do servidor e manda o `FalhaProvider` e a `FalhaPasta` à interface sem o `cause` (do `cause` do `FalhaProvider` sai só o texto técnico, curto e saneado). Regra de produto não fica no handler: o aviso de uso antes de mandar algo à IA é exigido dentro de `Conversas`, `RevisaoIa` e `ListaViva`. Envelope, paginação e orçamento de resposta ficam no serviço `Leitura`, não no handler.

Funções puras para trabalho puro (formatar, montar nome, analisar texto) podem ficar ao lado do serviço; a capacidade em si é o método. Os handlers não criam span próprio: o `Effect.fn` do método já cria. Um handler com contexto da chamada, como o id da conversa, o acrescenta com `Effect.annotateCurrentSpan`.

## Forma do módulo de serviço

Um módulo por serviço, nesta ordem: imports, erros e schemas, a tag `Context.Service` com a interface inline, `make`, `layer`. Bons exemplos: [`packages/mcp/src/leitura/PastaTrabalho.ts`](../../packages/mcp/src/leitura/PastaTrabalho.ts), [`packages/kb/src/Normas.ts`](../../packages/kb/src/Normas.ts) e [`apps/server/src/Relatos.ts`](../../apps/server/src/Relatos.ts).

```ts
// packages/mcp/src/leitura/PastaTrabalho.ts (resumido)
export class PastaTrabalhoInvalida extends Schema.TaggedError<PastaTrabalhoInvalida>()("PastaTrabalhoInvalida", {
  pasta: Schema.String,
}) {
  override get message(): string {
    return `pasta de trabalho não encontrada: ${this.pasta}`;
  }
}

export const ehPastaTrabalhoInvalida = Schema.is(PastaTrabalhoInvalida);

export class PastaTrabalho extends Context.Service<
  PastaTrabalho,
  {
    readonly pasta: string;
    readonly lerMarkdown: (arquivo: string) => Effect.Effect<ArquivoLido, EntradaInvalida>;
  }
>()("@simplifica-if/mcp/leitura/PastaTrabalho") {}

export const make = Effect.fn("PastaTrabalho.make")(function* (opcoes: { readonly pasta: string }) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // …
  const lerMarkdown = Effect.fn("PastaTrabalho.lerMarkdown")(function* (arquivo: string) { /* … */ });
  return PastaTrabalho.of({ pasta, lerMarkdown });
});

export const layer = (opcoes: { readonly pasta: string }) => Layer.effect(PastaTrabalho, make(opcoes));
```

- **Chave do serviço:** `@simplifica-if/<pacote>/<caminho>/<Nome>`, como `@simplifica-if/kb/Normas` e `@simplifica-if/server/persistencia/Historico`. Em `scripts/`, que não é pacote, `simplifica-if/scripts/<caminho>/<Nome>`.
- **Imports por namespace**, dos subcaminhos: `import * as Effect from "effect/Effect"`, nunca `import { Effect } from "effect"`. Quem usa um serviço importa o módulo como namespace: `import * as Normas from "./Normas.ts"`, depois `yield* Normas.Normas` e `Normas.layer`; nunca `import { layer as normasLayer }`. Módulos do Node também: `import * as NodeFs from "node:fs"` (a regra `namespace-node-imports` confere). Import nomeado serve para pacotes inteiros como `@simplifica-if/contratos-app` e para módulos de que se usa só uma função pura, um erro, um schema ou um tipo. Um barril expõe um serviço inteiro com `export * as Leitura from "./leitura/Leitura.ts"`.
- **Interface inline.** Sem `NormasShape` avulso; o tipo é `Normas["Service"]`.
- **Dependências vêm do ambiente** (`yield* FileSystem.FileSystem`), nunca como parâmetro de `make`, para que o tipo de `make` e de `layer` mostre o que eles pedem. Nada de serviço em variável de módulo, em closure sobre um singleton ou num `Layer.succeed` que chama API imperativa. Configuração, valores imutáveis e callbacks deliberados podem ser parâmetro: `layer({ pasta })`, `make(opcoes: OpcoesRelatos)`. Os testes podem passar instâncias de serviço diretamente.
- **`make`** existe quando o módulo constrói o serviço, e só se exporta quando outro módulo o importa. Não escreva `make = Effect.succeed(...)` para forçar `Layer.effect`; use o construtor que serve (`Layer.succeed`, `Layer.sync`, `Layer.effect`).
- **Nomes.** Um módulo nomeado pela implementação usa `make` e `layer`. Um módulo com várias implementações dá nome a cada uma: `layerArquivo`, `layerSomenteLeitura`.
- **Mudar um serviço de lugar** apaga o arquivo antigo e atualiza todos os chamadores (servidor, MCP, CLI, scripts, testes), sem reexportação de compatibilidade. O app não tem usuários; não há legado a preservar.

## Funções Effect e tracing

- Funções reutilizáveis usam `Effect.fn("Servico.operacao")`, não uma arrow ou declaração que devolve `Effect.gen`. O nome cria o span; `Effect.fn(function* ...)` sem nome só captura a pilha. Em scripts, o prefixo é o nome do script: `Effect.fn("upstream_t3.git")`. A regra `prefer-effect-fn` confere.
- `Effect.gen` fica para programas inline e para a construção de layers.
- `Effect.fnUntraced` é escolha deliberada: trabalho por linha, por trecho de stream ou por evento, laço apertado, ou ajudante já coberto pelo span da operação. Diga o motivo ao lado. Um laço não é exceção por si: a operação de fora ainda merece span.
- Não crie um segundo span para a mesma operação; leve nome e opções existentes para o `Effect.fn`. Atributos que dependem dos argumentos entram com `Effect.annotateCurrentSpan`.
- Combinadores vão depois do corpo do gerador, como argumentos do `Effect.fn`. Tipo de retorno explícito, quando preciso, é `Effect.fn.Return<A, E, R>`. Preserve parâmetros genéricos, preguiça, escopo e interrupção.

## Fronteira de runtime

`NodeRuntime.runMain`, `runPromise`, `runPromiseExit` e `ManagedRuntime.make` ficam nas bordas: os pontos de entrada (`executarPrincipal` de `packages/kb/src/principal.ts`, que as CLIs `kb`, `simplifica-mcp`, `sei` e os scripts usam, e `apps/server/src/cli.ts`), a interface React e os callbacks de bibliotecas que esperam Promise. Exemplo de callback legítimo: o `canUseTool` do Agent SDK em `packages/motor/src/drivers/claude.ts`, que roda a aprovação com `Effect.runPromiseWith(servicos)`. Nunca dentro de serviço, consulta, persistência ou construtor de layer. Um adaptador nomeado pode levar um serviço a uma API de Promise, mas nenhum serviço Effect depende dele.

Um recurso compartilhado se compõe uma vez, numa layer da aplicação (`apps/server/src/servidor.ts`, `packages/kb/src/layers.ts`), e se fornece a quem precisa; não crie um runtime por recurso. Quando a aquisição pode falhar e o chamador precisa de alternativa, a falha fica tipada: um erro na operação ou um serviço opcional, como o `Leitura` faz com `PastaTrabalho`.

O processo do Node (`process.env`, `process.cwd()`, `process.argv`) se lê só nos pontos de entrada; o resto recebe por parâmetro de configuração ou por `Config`. A regra `no-global-process-runtime` confere, com as exceções listadas no `vite.config.ts`.

## Erros

- **Atributos.** Falhas são classes `Schema.TaggedError`, com nome em português (`NormaNaoEncontrada`, `FalhaNaConsulta`, `EntradaInvalida`) e atributos estruturados: a operação ou etapa, o caminho ou id do recurso, uma categoria normalizada. A mensagem, em português, é fixa ou montada desses atributos, nunca de `cause`, `cause.message` ou de um defeito em texto. Nada de campo `detalhe` que copia `cause.message`.
- **Causa.** O erro que embrulha outro guarda o erro imediatamente abaixo em `cause`; obrigatório quando toda construção embrulha uma falha. Erros de validação ou de domínio sem nada embaixo não têm `cause`. Exemplo: `FalhaNaConsulta` (`packages/kb/src/db/sql.ts`), com `consulta` e `cause: Schema.Defect()`.
- **Valores seguros.** Atributos e anotações de log ficam limitados: sem texto de PPC ou de anexo, argumentos ou saída de comando, URL assinada ou com consulta, credencial ou token, defeito arbitrário. O valor exato vive só em `cause`; exponha categoria, tamanho, contagem ou o protocolo e o host de uma URL. É a mesma regra da base pública ([curadoria, "Dados pessoais e URLs internas"](../../base-conhecimento/docs/curadoria-metadados-institucionais.md#dados-pessoais-e-urls-internas)) aplicada aos erros.
- **Tradução.** Construa o erro onde a falha acontece e traduza para o erro do transporte só no transporte. Uma fronteira de tradução deixa passar os erros de domínio que já estão no canal de destino e embrulha só os desconhecidos ou de nível mais baixo. Traduza cada falha onde o contexto é conhecido; não embrulhe uma sequência inteira num erro genérico.
- **Discriminadores.** Não codifique a mesma distinção duas vezes, numa tag específica e num literal único de `operacao`, `motivo` ou `tipo`. Separe classes quando a distinção decide o fluxo do chamador ou a mensagem para a pessoa; campo só de diagnóstico continua campo. Mensagem que chega à interface, ao RPC, ao MCP ou ao banco é comportamento, e uma refatoração a preserva.
- **Mapeadores.** Não escreva um ajudante que só faz `(...args) => new AlgumErro({ ...args })`. Mantenha um mapeador só quando ele normaliza, deixa passar erros de domínio ou acrescenta contexto; se ele pertence ao erro de destino, vira fábrica estática da classe.
- **Predicados** se exportam direto: `export const ehNormaNaoEncontrada = Schema.is(NormaNaoEncontrada)`.
- **Captura.** Tags conhecidas se capturam com `Effect.catchTags({ ... })`, mesmo para uma só, não com `catchTag` nem com `catchIf` e predicado de schema (a regra `prefer-catch-tags` confere). `Effect.catch` é para tratar o canal inteiro; `catchIf`, para condições estruturais como o código de um erro de plataforma.

## Onde usar Effect

O repositório inteiro está na stack do Effect, mas nem todo código precisa ser Effect. Converta para Effect o código que tem uma das características abaixo; deixe o resto como função comum. Na dúvida, a pergunta é: este código toca o mundo de fora, falha de um jeito que o chamador precisa tratar, ou segura algo que precisa ser liberado?

**Use Effect para:**

- **I/O.** Arquivo, processo, rede e banco passam pelos serviços da plataforma: `FileSystem` e `Path` (`effect/FileSystem`, `effect/Path`), `ChildProcess` e `ChildProcessSpawner` (`effect/process`), `HttpClient` (`effect/http`), `SqlClient` (`effect/sql`, sobre o `nodeSqliteClient` de `packages/kb/src/db/`). As implementações do Node vêm de `@effect/platform-node` (`NodeServices.layer` junta `FileSystem`, `Path`, `ChildProcessSpawner`, `Stdio` e `Terminal`; `NodeHttpClient` para HTTP). Nada de `node:fs`, `node:child_process` ou `fetch` direto em código novo de serviço; os testes trocam a layer, não o módulo.
- **Erros esperados.** Uma falha que o chamador trata (arquivo ausente, entrada inválida, resposta HTTP de erro, credencial que falta) vira `Schema.TaggedError` no canal de erro, não `throw`, `try/catch` ou Promise rejeitada. `throw` sobra para defeito: o que não deveria acontecer.
- **Recursos com ciclo de vida.** O que se abre e se fecha (conexão de banco, processo filho, servidor HTTP, navegador do Playwright, arquivo temporário, lock) usa `Effect.acquireRelease` dentro de um `Scope`, ou `Layer.effect` com finalizador. Exemplo: o banco do PPC avulso em `packages/kb/src/db/pacote-contexto.ts`.
- **Configuração e ambiente.** Variáveis de ambiente e segredos entram por `Config` (`Config.String`, `Config.Redacted`, `Config.option`), como a senha da chave minisign em `scripts/fabrica_atualizacao.ts`. O segredo fica `Redacted` até o ponto de uso, o que o mantém fora de log e de erro. Nos scripts, o `ConfigProvider` é um só, o de `scripts/configuracao.ts`, que `executarPrincipal` instala: o ambiente e, na falta, o `.env.local` da raiz, sem gravar no `process.env`.
- **Concorrência e prazo.** Trabalho em paralelo usa `Effect.forEach(..., { concurrency })`, `Effect.all` ou `Stream`; prazo usa `Effect.timeout`, `Effect.timeoutOption` (como `Relatos.preparar`) ou `Schedule` para nova tentativa. Não `Promise.all`, `AbortSignal.timeout` nem `setTimeout` à mão, porque eles escapam da interrupção e do `TestClock`.
- **CLIs e scripts.** Um script novo, ou um script que muda de verdade, tem ponto de entrada Effect: `executarPrincipal(nome, programa)` de `scripts/principal.ts` (o comum de `@simplifica-if/kb/principal`, sobre `NodeRuntime.runMain` e `NodeServices.layer`, mais o `ConfigProvider`), com argumentos e flags do `effect/cli` (`Command`, `Argument`, `Flag`), como `scripts/importar_ppc_docx.ts` e a CLI `kb`. O pipeline da base (`gerar_base`, `validar_base` e os outros) segue esse modelo, e os arquivos gerados passam por `aplicarGerados` (`scripts/base/gerados.ts`), que grava ou, no `--check`, só confere. Arquivo, processo e caminho vêm de `FileSystem`, `ChildProcess` e `Path`, e a data, de `Clock` ou `DateTime`, para que a saída não dependa do relógio quando não deve.

**Não use Effect para:**

- **Funções puras.** Texto, regex, normalização, conversão e transformação de dados continuam funções comuns, síncronas, sem `Effect` no tipo: o resolvedor de citações, a vigência, `adequacaoArt71Em`, `impactoEm`, o stemmer, a formatação de saída, o conversor de PPC em `packages/ppc` e o leitor OOXML de `packages/docx` sobre bytes já lidos. O serviço as chama de dentro. Elas ficam testáveis sem layer e preservam a paridade byte a byte dos gabaritos.
- **Valor pronto.** Não embrulhe em `Effect.succeed` o que não faz I/O nem falha, só para encaixar num pipeline; chame a função e use o resultado.
- **Contratos.** `packages/contratos-app` tem schemas e funções derivadas pequenas (`citacoesDe`), sem serviço nem I/O.
- **Interface.** O `apps/web` segue as regras de React; o Effect entra lá pela conexão RPC (`src/conexao/`) e pelos atoms, não nos componentes.

Uma conversão troca o código inteiro do caminho: o serviço novo, os chamadores e os testes no mesmo PR, sem manter as duas versões.

Armadilhas que as conversões deste repositório já encontraram:

- **`throw` vira defeito.** O `Effect.tryPromise` de um código `async` pegava qualquer `throw`; dentro de `Effect.gen`, um `throw` síncrono (`new URL`, `JSON.parse`, `toISOString`, função pura que recusa) vira defeito, que `Effect.catch` e `Effect.result` não pegam. Cada chamada que pode lançar ganha um `Effect.try` com erro tipado, ou uma conferência antes.
- **"Nunca falha" precisa de `catchCause`.** Um finalizador ou um passo que só registra no log trata a causa inteira (falha e defeito) e deixa a interrupção passar; dois finalizadores independentes são dois `Effect.ensuring`, para o segundo rodar se o primeiro morrer.
- **Diagnóstico sem `cause` na mensagem.** Quem traduz a falha põe na mensagem o que é seguro e útil: o código do sistema (`EACCES`, `ENOSPC`), o recurso relativo (arquivo dentro da base, ref, host), a categoria. A saída bruta (stderr, `cause.message`) fica em `cause` ou num log ao lado.
- **`Schema.Struct` descarta chave desconhecida em silêncio.** Onde perder dado importa (resposta de IA, registro), decodifique com `onExcessProperty: "error"`. E texto gerado por IA escreve `null` em campo opcional: aceite-o como ausente (`Schema.NullOr` normalizado), em vez de recusar a resposta inteira.
- **`FileSystem.exists` só devolve `false` para `NotFound`.** `ENOTDIR` (um `.DS_Store` onde se esperava uma pasta), `EISDIR` e `ELOOP` viram `PlatformError`; o `try/catch` antigo que filtrava códigos errno precisa virar um `stat` com o tipo conferido, ou a leitura das entradas com tipo.
- **Biblioteca síncrona que lança.** Um `unzipSync`, um parser ou um decodificador de terceiros dentro de `Effect.fn` vira defeito; o `catch` amplo da versão antiga às vezes era uma degradação de propósito (o snapshot do SEI seguia sem o ZIP), e precisa voltar como `Effect.try` com erro tipado e o mesmo tratamento.
- **Duas implementações que viram uma perdem o teste que as comparava.** Quando a versão por arquivo e a do banco, ou duas montagens paralelas, passam a ser a mesma função, o teste "lado A contra lado B" só confere as entradas; dê à função uma referência independente no próprio teste (os arquivos lidos ali, um curso conhecido) e confira que ele falha com uma sabotagem de propósito.
- **Contexto capturado na montagem leva o `Scope` da layer.** Um `Effect.context()` dentro do `make` de um `Layer.effect` guarda também o `Scope` da layer (e o span e o stack frame da montagem); dado de volta com `provideContext`, ele passa por cima do de quem chama, e um `acquireRelease` feito ali só fecha com a layer. Guarde só os serviços declarados (`Context.pick`), como `Sql.ambienteDoServico(SqlClient.SqlClient, ...)`, e teste o recurso usado depois do fim do escopo.
- **Garantia do sistema operacional não vira checagem prévia.** `rmdir` (falha se a pasta não está vazia), `unlink` e `open` com `O_EXCL|O_NOFOLLOW` protegem contra corrida; trocá-los por "conferir e depois `remove`" abre uma janela. Onde o `FileSystem` do Effect não oferece a primitiva, ela fica num adaptador Node pequeno, com o motivo ao lado.

## Testes

- **`@effect/vitest`.** Teste de código Effect usa `it.effect` ou `layer(...)((it) => ...)`, não `Effect.runPromise` dentro de `it` (regra `no-manual-effect-runtime-in-tests`).
- **Relógio de teste.** `it.effect` roda no `TestClock`: `Effect.sleep` só anda com `TestClock.adjust` (exemplo: `apps/server/test/autenticacao.test.ts`). `it.live` usa o relógio de parede e serve só para processo filho, rede ou provider real (`*real.test.ts`).
- **Sem espera real nem polling.** Nada de `sleep` ou `setTimeout` para esperar, nem laço com `yieldNow` ou `sleep` até algo acontecer: aguarde o `Deferred`, tire da `Queue` ou consuma o `Stream` que marca o marco (regras `no-real-time-wait-in-tests` e `no-polling-loop-in-tests`).
- **Sem relógio de parede.** Nada de diferença de `Date.now()` ou `performance.now()`; afirme sobre eventos e contagens (regra `no-wall-clock-in-tests`).
- **Prazos.** O prazo do projeto (60 s no `vite.config.ts`) é o teto, e `retry` é 0: teste instável se corrige, não se repete. Diferente do T3, um prazo por teste é aceito aqui em dois casos, com o motivo ao lado: como afirmação de velocidade de trabalho de CPU ("recusado depressa", em `packages/ppc/test/conversao-docx.test.ts`) e para compilar a base real. Nunca para esperar um evento.
- **Pulos.** Um teste pulado depende de condição explícita (`describe.skipIf(!SMOKE)`, provider ausente), não de `.skip` solto.
- **Casos em tabela.** Vários casos do mesmo teste vão em `it.each(casos)` ou `it.effect.each(casos)`, não num `for` em volta de `it` (regra `no-test-in-loop`, em aviso enquanto há testes antigos assim).
- **Testes de navegador** (`*.browser.test.tsx` do `apps/web`): afirme com `expect.element` ou `vi.waitFor`, nunca com `requestAnimationFrame` ou `transitionend` (regra `no-frame-waits-in-browser-tests`); a exceção é provar que um evento *não* aconteceu, com supressão e motivo. Sem `jsdom` nem `happy-dom` e sem pragma `@vitest-environment` por arquivo: o ambiente é do projeto `navegador` (regra `no-dom-test-environment`).
- **O que testar.** O comportamento que pode quebrar: regras da base (resolvedor, vigência, fatos de PPC), tradução de protocolo dos providers, autenticação, persistência e migrações, leitura de formato externo (DOCX, relatório de coleta), correção de corrida e a lógica que um conserto mudou. Não teste o que o tipo já garante, texto de interface, nem espelho de chamadas de mock.
- **Layers de teste só para dependências externas** (`FileSystem`, banco de fixture, provider falso); não simule a lógica sob teste.
- **Estenda antes de acrescentar.** Se um teste ou tabela já cobre o comportamento, acrescente uma linha ou uma afirmação. Teste numa camada só: a mais baixa que falha sem o conserto.
- **Gabaritos.** Mudança que altera a saída da CLI `kb`, do MCP ou da base confere `testes-gabarito/`; regerar o gabarito é decisão explícita.

## O que o lint confere

As regras do plugin `simplifica-if` (`ferramentas/oxlint-plugin`, copiadas do T3) cobrem a parte mecânica: `namespace-node-imports`, `no-global-process-runtime`, `no-inline-schema-compile`, `prefer-effect-fn`, `prefer-catch-tags`, `require-suppression-reason` e as de teste citadas acima. O `effect-tsgo` (`pnpm typecheck`) aplica os diagnósticos do `tsconfig.effect.json`, como `globalDate`, `globalRandom` e `globalConsole`. Toda supressão de lint ou de diagnóstico diz por quê, num sufixo `-- motivo` ou num comentário logo acima.

O resto desta página é revisão: posição da lógica, forma do módulo, atributos de erro, escolha de `fnUntraced`.

## Do T3 que não vale aqui

- **Event sourcing.** Não há orquestrador, comandos, eventos, projeções, outbox nem worker de efeitos; as regras de "drenar o worker" e de esperar o evento persistido ficam de fora. O servidor guarda as conversas em SQLite comum (`apps/server/src/persistencia/`).
- **Middleware de RPC do T3.** Não há `RpcAuthorization` nem `RpcInstrumentation`: a autenticação é a do WebSocket (`Autenticacao.ts`), antes do upgrade. Também não há `McpToolAccess`, escopos de permissão por método nem a regra `no-rpc-permission-bypass`.
- **knip.** Não roda neste repositório; a regra "não exporte o que ninguém importa" continua valendo, sem a checagem automática.
- **Exceções nomeadas do T3**, como `DeviceBootError.diagnostics` e o `infra/relay`.
- **Superfícies do T3** (mobile, conexão remota, vários providers por adaptador de orquestração) e a convenção de nomes em inglês.

## Divergências já vistas

Código anterior a esta página que não segue alguma regra. Não é achado num PR que não o toca; entra na revisão de arquitetura:

- a leitura da base com `node:fs` síncrono nos `carregar*` e em `scripts/base/validacao/`, chamada de dentro dos programas Effect do pipeline da base;
- testes que ainda registram casos num `for` (os avisos de `no-test-in-loop` no `pnpm lint`).

## Antes de concluir

- Algum handler, ferramenta MCP, comando da CLI ou script que você mexeu faz mais que decodificar, chamar e traduzir erros?
- A capacidade nova chega pela interface, pelo MCP e pela CLI onde fizer sentido? Se não, é de propósito?
- Você estendeu o serviço que já é dono do domínio antes de criar outro?
- O código novo que faz I/O, falha de forma esperada ou segura um recurso está em Effect, e o código puro ficou puro?
- Toda supressão que você acrescentou diz por quê?
