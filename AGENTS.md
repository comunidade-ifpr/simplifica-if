# Instruções para agentes

Este é o repositório do **Simplifica IF**, um app desktop para os servidores do IFPR: ele dá à IA da assinatura de cada pessoa (Claude, ChatGPT ou Gemini) a base de conhecimento do Instituto e tarefas prontas sobre ela. O repositório contém o app e a base que o alimenta (normas, PPCs, cursos, CNCT, metadados institucionais, fichas da revisão de PPC), além das skills e dos scripts que agentes usam aqui para curar a base. Os planos estão em [`docs/plans/README.md`](docs/plans/README.md): o do app em [`docs/plans/app-simplifica-if.md`](docs/plans/app-simplifica-if.md) (o que ele entrega e o que fica fora do escopo), o da base em [`docs/plans/arquitetura-base.md`](docs/plans/arquitetura-base.md).

## Mapa

- `apps/desktop`: processo principal do Electron; inicia o servidor local e abre a interface (`pnpm app:dev` em desenvolvimento).
- `apps/server`: servidor local (Effect): motor de conversa, MCP `ifpr` por HTTP local, RPC de leitura da base, pastas de trabalho, relatos de erro, atualização da base e das skills.
- `apps/web`: interface em React (Início, tarefas, conversa, leitor `ifpr://`, Explorar, boas-vindas, Configurações, Ajuda).
- `modulos/<nome>/` dentro de cada camada: o código de um **módulo** do app (o fluxo de uma tarefa com tela, RPC e tabelas próprias). Hoje há um, `revisao-ppc` (a tarefa `revisar-ppc`, "Revisar um PPC"): `apps/server/src/modulos/revisao-ppc/` (com `test/` e `scripts/` em `modulos/revisao-ppc/` ao lado), `apps/web/src/modulos/revisao-ppc/`, `apps/desktop/src/modulos/revisao-ppc/` (a ponte do desktop) e `packages/contratos-app/src/modulos/revisao-ppc.ts` (exportado como `@simplifica-if/contratos-app/modulos/revisao-ppc`). O domínio continua em `packages/ppc` e `packages/docx`, e as fichas, em `base-conhecimento/revisao-ppc/`. Ver "Módulos" abaixo.
- `packages/kb`: núcleo da base (resolvedor de citações, vigência, banco `kb.sqlite`, CLI `kb`).
- `packages/mcp`: o `simplifica-mcp`: ferramentas de consulta só de leitura ao `kb.sqlite` e a `etapa`, que informa ao app o andamento da tarefa; roda dentro do app e como executável à parte.
- `packages/motor`: motor de conversa com um driver por IA (Agent SDK do Claude, `codex app-server`, `agy acp`).
- `packages/ppc` e `packages/docx`: conversão de PPC em `.docx`, pré-conferência, revisão com IA e comentários no Word; o `docx` também converte `.docx` e `.odt` quaisquer em Markdown, para a IA ler os anexos.
- `packages/pdf`: o texto de um PDF em Markdown (`pdfjs-dist`, com títulos, tabelas e sem cabeçalhos de página), para a IA ler os anexos e para a entrada de PPC pelo PDF; e a limpeza, o diagnóstico e a conferência do Markdown convertido (`scripts/conversao_ppc.ts`).
- `packages/contratos-app`: contratos RPC entre a interface e o servidor.
- `packages/atualizacao`: manifesto do canal (com o catálogo de tarefas e as skills retiradas), assinatura minisign e pacotes da base e das skills.
- `packages/effect-acp` e `packages/effect-codex-app-server`: copiados do T3 Code ([`docs/upstream-t3.md`](docs/upstream-t3.md)).
- `base-conhecimento/`: fonte publicada da base. Os dados institucionais (campi, cursos, processos seletivos, editais, ofertas, reuniões do Consepe) são um JSON por registro em `base-conhecimento/institucional/ifpr/`, fonte de verdade versionada no git.
- `scripts/`: pipeline da base, aplicação de dado coletado fora do repositório, fábrica da atualização (que publica a base, as skills do app e o catálogo de tarefas), avaliação.
- `catalogo/`: o que viaja para o app como dado. `catalogo/tarefas/<id>.yaml` é o catálogo de tarefas, um manifesto por tarefa: o cartão do Início e o que ele abre (um link, uma conversa ou um módulo do app). `catalogo/skills/<nome>/` são as skills do app (o `SKILL.md` com o bloco `simplifica:` e os arquivos dela), e `catalogo/skills/retiradas.yaml`, o registro das skills retiradas.
- `.agents/skills/`: skills de quem mantém o repositório (curadoria da base); rodam no checkout e nunca vão para o app (`.claude/skills` é symlink para cá).

## Consulta da base

A base é consultada pela CLI `kb`, dentro do checkout, ou pelo MCP `simplifica-mcp` ([`packages/mcp/src/instrucoes.ts`](packages/mcp/src/instrucoes.ts)): os comandos da CLI são as ferramentas do MCP, um por ferramenta, com o nome em kebab-case, a mesma entrada (argumento e flags) e a mesma resposta (o texto Markdown, ou a resposta inteira em JSON com `--json`). Depois, abra o Markdown da norma ou do PPC que a resposta aponta. Não navegue a base por manifestos e índices, e não troque os arquivos locais por URLs públicas. A CLI lê `tmp/kb.sqlite`, que se recompila sozinho quando está mais velho que as fontes (`pnpm kb:compilar` força). O banco nunca é fonte de verdade nem lugar de edição: toda resposta traz o arquivo e a linha, e é esse arquivo que se cita.

```bash
pnpm kb buscar-norma "Resolução CNE/CP nº 2/2026, art. 28"         # citação, ID ou termos → dispositivos
pnpm kb buscar-secoes "acompanhamento de egressos" --cnct tecnico-em-agropecuaria   # seções de PPC
pnpm kb fatos-ppc --ppc curitiba/tecnico-em-enfermagem               # fatos do PPC cruzados com o SUAP
pnpm kb ficha-norma br/cne-cp/res/2021/1 --em 2026-11-01             # vigência numa data, relações e regras de transição
```

Os outros (`resolver-citacoes`, `ler-dispositivos`, `correspondencia`, `citacoes-da-norma`, `impacto-da-norma`, `listar-cursos`, `ficha-curso`, `pacote-contexto`…) estão em `pnpm kb --help` e no [`packages/mcp/README.md`](packages/mcp/README.md#cli-kb).

1. Ache a fonte pelo comando `kb`; abra o arquivo e as linhas que a resposta aponta antes de redigir resposta substantiva.
2. Cite: norma pelo título, a fonte oficial do front matter e o dispositivo; PPC pelo arquivo e linhas; metadado institucional pelo registro JSON.
3. Fonte externa só quando o dado não está na base, a pergunta exige atualização ou é preciso confirmar em fonte oficial; deixe isso explícito.

Armadilhas:

- **Norma revogada não é inaplicável:** consulte as regras de transição (`kb ficha-norma`). Norma `aguardando publicação` (assinada e ainda não publicada, como a Res. CNE/CP nº 2/2026) não está em vigor.
- A tabela de correspondência 1/2021 → 2/2026 é rascunho sem revisão jurídica: indicação, não fundamento.
- Confira `regra` e `confianca` das citações: as regras de confiança menor (`dcnept-2021-orgao-trocado`, `orgao-ausente-registro`, `orgao-no-documento`) pedem conferência no trecho.
- Fatos de PPC têm status `extraido` (por regra, sem revisão humana) até alguém os revisar em `base-conhecimento/fatos-ppc.yaml` (status `revisado`, com revisor e data; a fila: `pnpm kb fatos-a-revisar`); o ano do documento é `evidencia-conferida`, não revisado. Confira o trecho de origem antes de afirmar uma divergência; carga sem unidade conhecida sai `unidade-desconhecida` no cruzamento com o SUAP, sem divergência afirmada. Se `buscar-secoes` não achar o esperado, procure com `rg` nos Markdown dos PPCs.
- PPCs são exemplos institucionais, não fonte normativa. Em elaboração ou revisão de PPC, combine PPCs similares com normas vigentes e, para cursos técnicos, com o CNCT.

## Curadoria da base

- **Metadados institucionais** (campi, cursos, SUAP, horários, processos seletivos, editais, ofertas, PPC novo, dado coletado fora do repositório): leia antes a [curadoria de metadados institucionais](base-conhecimento/docs/curadoria-metadados-institucionais.md). PPC novo entra pelo DOCX (`node scripts/importar_ppc_docx.ts --ano <AAAA>`), ou, sem DOCX, pelo PDF (`node scripts/importar_ppc_pdf.ts`, seguido da revisão com a skill `revisar-conversao-ppc`), como versão nova com ID permanente (`ppc:<campus>/<curso>/<versao>`); o PPC anterior do curso não sai, fica substituído. O ano do documento é obrigatório, com o trecho literal que o traz (`--evidencia`); sem ele, o PPC fica fora da base, em `curadoria/pendencias/` (`pnpm pendencias` lista o que falta completar; `node scripts/promover_ppc.ts` leva para a base). Não preencha dado obrigatório por dedução: o que falta vira pendência. Ao mexer no texto de um PPC, só a forma muda: confira com `node scripts/conversao_ppc.ts conferir <ppc>`.
- **Normas:** siga o [padrão de front matter](base-conhecimento/docs/padrao-front-matter-legislacao.md). A base guarda todo ato que entrou nela: norma revogada ou substituída não sai, porque PPCs e documentos a citam; a revogação entra em `relacoes.yaml` e o status é calculado. O corpo do arquivo é só o texto integral do ato, na redação consolidada, um arquivo por ato; resumo e nota sobre a fonte são campos do front matter (`pontos_chave`, `notas_da_fonte`), e nenhum é fundamento. Orientação para PPC fica nas fichas da revisão de PPC, não na norma. Além disso, norma nova tem um roteiro próprio lá ("Inclusão de norma nova": stubs e relações). Não edite à mão os campos gerados (`status_vigencia`, `revoga`, `revogada_por`, `altera`, `alterada_por`, `regulamenta`, `regulamentada_por`, `fundamenta_se_em`, `fundamenta`, `vigencia_*`): relação nova entra em `relacoes.yaml`, com a evidência literal. Ao mudar a marcação de uma norma, preserve as palavras do texto oficial.
- **Dados pessoais:** a base é pública. `validar_base.ts` recusa CPF, RG, celular, matrícula, SIAPE, URL pré-assinada, planilha do Google e sessão do SEI (regra em `packages/kb/src/ppcs/dados-pessoais.ts`; o que fica e o que sai em [Dados pessoais e URLs internas](base-conhecimento/docs/curadoria-metadados-institucionais.md#dados-pessoais-e-urls-internas)). E-mail particular não tem regra automática: tire à mão.
- **Fichas da revisão de PPC** (`base-conhecimento/revisao-ppc/`): leia o [README da pasta](base-conhecimento/revisao-ppc/README.md) antes; depois, `node scripts/validar_base.ts` e `pnpm exec vp test run scripts/base/revisao-ppc`. Mudar um verificador (`packages/ppc/src/verificadores/`) pode ser medido na base com `node packages/ppc/scripts/pre-conferencia.ts --base`.

Depois de alterar qualquer coisa em `base-conhecimento/` (normas, `relacoes.yaml`, `transicoes.yaml`, `correspondencias/`, `config/vigencia.yaml`, stubs, catálogos, PPCs, registros institucionais):

```bash
node scripts/gerar_base.ts
node scripts/validar_base.ts
```

Se a mudança afeta o banco (normas, relações, PPCs), compile (`pnpm kb:compilar`) e confira a resposta pelo `pnpm kb` (por exemplo, `pnpm kb ficha-norma <id>` da norma nova).

O formato dos manifestos e índices (CNCT e PPCs) é o Effect Schema de `scripts/base/esquemas.ts`, fonte também dos tipos; depois de alterá-lo, `node scripts/validar_base.ts` e `pnpm typecheck`.

## Skills e tarefas

Há dois lugares para skill, e cada skill mora num só:

- **`catalogo/skills/<nome>/`: as skills do app** (hoje `verificar-fundamentacao-normativa`). Viajam para o app, que não tem o repositório, nem terminal, nem a CLI `kb`: o texto só usa as ferramentas MCP `ifpr` e os arquivos da própria skill. Toda skill dali tem o bloco `simplifica:` no front matter do `SKILL.md`, só com o que é da skill: `versao` (X.Y.Z), `app_minimo`, `base_minima`, `ferramentas`, `arquivos` e `etapas`; outro campo ali (título, área, entradas, que são da tarefa) é erro no `validar_base.ts` e no build do desktop. Acrescente a `simplifica.arquivos` todo arquivo novo que o texto cite. **Toda edição sobe a `versao`:** o app só troca uma skill pela de versão maior, e a fábrica recusa publicar conteúdo novo com a versão de antes. Essas skills não são skills do agente neste checkout: teste pelo app (`pnpm app:dev`, que lê `catalogo/` direto) ou por `pnpm avaliacao:skill`.
- **`.agents/skills/<nome>/`: as skills de quem mantém o repositório** (hoje `revisar-conversao-ppc`). Rodam no checkout, com a CLI, os scripts e o git, e nunca vão para o app: não têm o bloco `simplifica:` (tê-lo ali é erro no `validar_base.ts`). Leia antes o `README.md` da skill, quando existir (rode a regeneração ou validação que ele indicar).

Para tirar do app uma skill já publicada, apagar a pasta não basta (a que veio no instalador continua nos computadores): apague a pasta e acrescente o nome a `catalogo/skills/retiradas.yaml`, que é só de acréscimos (formato no próprio arquivo e em [`packages/atualizacao/src/retiradas.ts`](packages/atualizacao/src/retiradas.ts)). Um nome retirado não volta.

O cartão do app é a **tarefa**, um arquivo `catalogo/tarefas/<id>.yaml` (schema `ManifestoTarefa`, em [`packages/mcp/src/tarefas.ts`](packages/mcp/src/tarefas.ts); desenho e decisões no [plano das tarefas](docs/plans/tarefas.md)): título, resumo, área, público, mantenedor, situação e a abertura (o campo `abre`), que é exatamente uma de `link` (só `https`; abre no navegador), `conversa` (o `pedido`, as `entradas` do formulário e, se houver, a `skill`) ou `modulo` (um dos módulos do app, em [`packages/mcp/src/modulos.ts`](packages/mcp/src/modulos.ts)). A conversa aberta por um cartão leva só a skill da tarefa (ou nenhuma), e `abre.conversa.web: false` tira dela a busca e a leitura na web; a conversa livre leva todas as skills. A tarefa `experimental` só aparece e só abre conversa no canal beta. Uma skill do app sem tarefa vai para o app sem cartão, só nas conversas livres (o `validar_base.ts` avisa, para ser escolha e não esquecimento). O `id` é o nome do arquivo e é permanente: as conversas o guardam; para tirar uma tarefa do catálogo sem perder o título das conversas antigas, mude a `situacao` para `descontinuada`. O catálogo viaja inteiro pelo canal de atualização e o app o troca de uma vez: a tarefa cujo arquivo sai do repositório some do app, e tarefa não tem versão. Não invente URL de link nem campo novo: campo só entra no schema junto com quem o consome. Depois de mexer em `catalogo/`, `node scripts/validar_base.ts` (confere o schema das tarefas e das skills, a skill e o módulo citados, as retiradas e os dados pessoais, também em `.agents/skills/`).

## Módulos

O núcleo não importa de `modulos/`, e um módulo não importa de outro. Só os **arquivos de composição** citam um módulo, com imports nomeados e em poucas linhas (o `GrupoApp`, as layers e os handlers do servidor, a migração, a casca da rota, o estado da interface, o leitor, a ponte do desktop, o Worker do build): a lista única fica em [`ferramentas/oxlint-plugin/modulos.ts`](ferramentas/oxlint-plugin/modulos.ts), em duas partes: os que importam do módulo, cada um só do módulo da própria camada e por caminho relativo, e os que só o citam pelo nome (a ponte, a lista `MODULOS`, a rota da tarefa, o Worker do build), que não importam de `modulos/`. A regra `simplifica-if/fronteira-modulos` do `pnpm lint` a confere em toda forma de citar um arquivo por caminho (`import`, `export … from`, `import()`, `require`, `import X = require`, tipo `import("…")`, `vi.mock` e parentes, `new URL(…, import.meta.url)`), e um teste da raiz varre o repositório inteiro (raiz, `apps/`, `packages/`, `scripts/`, `ferramentas/`) com a mesma regra. Código novo do módulo vai para a pasta dele; o que dois módulos usarem vai para o núcleo. As tabelas de um módulo têm o nome dele de prefixo (`revisao_ppc_*`). Não há registro de módulos nem interface genérica: o contrato sai quando houver o segundo módulo (decisões 7 e 8 e "O módulo: a Revisar um PPC" do [plano das tarefas](docs/plans/tarefas.md)).

## Código

TypeScript em tudo (salvo poucos `.js`/`.mjs` de build do desktop); os scripts rodam direto no Node 26.12.1 (`.node-version`), sem build, com o pnpm do `packageManager` (`pnpm install` na raiz). Regras compartilhadas entre `scripts/` e o app ficam em `packages/kb` (`@simplifica-if/kb`), que não importa de `scripts/`. Depois de alterar código:

```bash
pnpm fmt && pnpm lint && pnpm typecheck && pnpm test
```

Use sempre `pnpm fmt`, nunca o oxfmt ou o prettier direto: a formatação deixa de fora Markdown, JSON, YAML e as pastas de dados (`base-conhecimento/`, `catalogo/`, `avaliacao/`, `tmp/`, `outputs/`, `.repos/`). Conversão de `.docx` (`packages/docx`, `packages/ppc`): rode `pnpm --filter @simplifica-if/docx --filter @simplifica-if/ppc test`; os gabaritos de `packages/ppc/test/fixtures/conversao-docx/` travam a saída byte a byte.

`.repos/effect` é o código de referência do Effect, somente leitura: prefira os padrões dele, mas nunca edite nem importe dessa pasta; ao subir o `effect` do catalog, rode `pnpm sync:repos`.

### Código com Effect

O backend, os pacotes e os scripts usam Effect 4. Antes de escrever ou revisar código Effect, leia [Serviços Effect](docs/internals/servicos-effect.md) e, para a biblioteca, [`.repos/effect/LLMS.md`](.repos/effect/LLMS.md). O essencial:

- Uma capacidade é um método de serviço do domínio (`Context.Service` com a interface inline, `make`, `layer`). Handlers RPC, ferramentas MCP, a CLI `kb` e os scripts são casca fina: decodificam, chamam um método e traduzem os erros.
- Use Effect para I/O, erros esperados, recursos com ciclo de vida, `Config`, concorrência e prazo, e nos pontos de entrada (`NodeRuntime.runMain`, `effect/cli`). Funções puras de texto, regex e transformação de dados continuam funções comuns.
- Funções reutilizáveis usam `Effect.fn("Servico.operacao")`. Imports por namespace (`import * as Effect from "effect/Effect"`). Tipos inferidos; nada de `any`.
- Erros são `Schema.TaggedError` com atributos estruturados, mensagem em português que não sai de `cause`, e `cause` no erro que embrulha outro. Capture com `Effect.catchTags`.
- `runPromise` e `ManagedRuntime` só nas bordas, nunca dentro de serviço.
- Testes com `@effect/vitest` (`it.effect`, `TestClock`), sem `sleep`, polling, relógio de parede nem `retry`.
- Identificadores, mensagens e comentários em português; comentário só para o que o código não mostra, curto. Supressão de lint ou de diagnóstico diz por quê.
- Migrações do `conversas.sqlite` (`apps/server/src/persistencia/migracoes/`): mudanças entram numa migração nova registrada em `Banco.ts`, com teste de upgrade em `apps/server/test/migracoes.test.ts` (desde a migração 2, para o banco de desenvolvimento não ter de ser apagado); a migração que mexe em tabela de módulo chama uma função do módulo e entra na lista dos arquivos de composição.

## Depurar o app

Os logs ficam em `~/Library/Application Support/Simplifica IF (dev)/logs` no desenvolvimento (macOS); nada sai do computador. O código de um erro (o de "Detalhes técnicos" na interface, o `codigo=` do log) são os 8 primeiros caracteres do `traceId`: `pnpm traces --codigo ABCD1234` mostra a árvore do trace. As outras pastas, as opções do `pnpm traces`, os modos (`SIMPLIFICA_TRACES`) e a leitura de um pacote de diagnóstico estão em [`apps/server/README.md`](apps/server/README.md#depurar-pelo-código-do-erro).
