# Instruções para agentes

Este é o repositório do **Simplifica IF**, um app desktop para os servidores do IFPR: ele dá à IA da assinatura de cada pessoa (Claude, ChatGPT ou Gemini) a base de conhecimento do Instituto e tarefas prontas sobre ela. O repositório contém o app e a base que o alimenta (normas, PPCs, cursos, CNCT, metadados institucionais, fichas da revisão de PPC), além das skills e dos scripts que agentes usam aqui para curar a base. Os planos estão em [`docs/plans/README.md`](docs/plans/README.md): o do app em [`docs/plans/app-simplifica-if.md`](docs/plans/app-simplifica-if.md) (o que ele entrega e o que fica fora do escopo), o da base em [`docs/plans/arquitetura-base.md`](docs/plans/arquitetura-base.md).

## Mapa

- `apps/desktop`: processo principal do Electron; inicia o servidor local e abre a interface (`pnpm app:dev` em desenvolvimento).
- `apps/server`: servidor local (Effect): motor de conversa, MCP `ifpr` por HTTP local, RPC de leitura da base, revisão de PPC, pastas de trabalho, relatos de erro, atualização da base e das skills.
- `apps/web`: interface em React (Início, tarefas, conversa, leitor `ifpr://`, Explorar, Revisar um PPC, boas-vindas, Configurações, Ajuda).
- `packages/kb`: núcleo da base (resolvedor de citações, vigência, banco `kb.sqlite`, CLI `kb`).
- `packages/mcp`: o `simplifica-mcp`: ferramentas de consulta só de leitura ao `kb.sqlite` e a `etapa`, que informa ao app o andamento da tarefa; roda dentro do app e como executável à parte.
- `packages/motor`: motor de conversa com um driver por IA (Agent SDK do Claude, `codex app-server`, `agy acp`).
- `packages/ppc` e `packages/docx`: conversão de PPC em `.docx`, pré-conferência, revisão com IA e comentários no Word; o `docx` também converte `.docx` e `.odt` quaisquer em Markdown, para a IA ler os anexos.
- `packages/pdf`: o texto de um PDF em Markdown (`pdfjs-dist`), para a IA ler os anexos.
- `packages/contratos-app`: contratos RPC entre a interface e o servidor.
- `packages/atualizacao`: manifesto do canal, assinatura minisign e pacotes da base e das skills.
- `packages/effect-acp` e `packages/effect-codex-app-server`: copiados do T3 Code ([`docs/upstream-t3.md`](docs/upstream-t3.md)).
- `base-conhecimento/`: fonte publicada da base. Os dados institucionais (campi, cursos, processos seletivos, editais, ofertas, reuniões do Consepe) são um JSON por registro em `base-conhecimento/institucional/ifpr/`, fonte de verdade versionada no git.
- `scripts/`: pipeline da base, aplicação de dado coletado fora do repositório, fábrica da atualização, avaliação.
- `.agents/skills/`: skills dos agentes (`.claude/skills` é symlink para cá).

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
- Fatos de PPC têm status `extraido` (sem revisão humana): confira o trecho de origem antes de afirmar uma divergência. Se `buscar-secoes` não achar o esperado, procure com `rg` nos Markdown dos PPCs.
- PPCs são exemplos institucionais, não fonte normativa. Em elaboração ou revisão de PPC, combine PPCs similares com normas vigentes e, para cursos técnicos, com o CNCT.

## Curadoria da base

- **Metadados institucionais** (campi, cursos, SUAP, horários, processos seletivos, editais, ofertas, PPC novo, dado coletado fora do repositório): leia antes a [curadoria de metadados institucionais](base-conhecimento/docs/curadoria-metadados-institucionais.md). PPC novo entra pelo DOCX (`node scripts/importar_ppc_docx.ts --ano <AAAA>`), como versão nova com ID permanente (`ppc:<campus>/<curso>/<versao>`); o PPC anterior do curso não sai, fica substituído. O ano do documento é obrigatório, com o trecho literal que o traz (`--evidencia`); sem ele, o PPC fica fora da base, em `curadoria/pendencias/` (`pnpm pendencias` lista o que falta completar; `node scripts/promover_ppc.ts` leva para a base). Não preencha dado obrigatório por dedução: o que falta vira pendência. PDF não é convertido.
- **Normas:** siga o [padrão de front matter](base-conhecimento/docs/padrao-front-matter-legislacao.md). A base guarda todo ato que entrou nela: norma revogada ou substituída não sai, porque PPCs e documentos a citam; a revogação entra em `relacoes.yaml` e o status é calculado. O corpo do arquivo é só o texto integral do ato, na redação consolidada, um arquivo por ato; resumo e nota sobre a fonte são campos do front matter (`pontos_chave`, `notas_da_fonte`), e nenhum é fundamento. Orientação para PPC fica nas fichas da revisão de PPC, não na norma. Além disso, norma nova tem um roteiro próprio lá ("Inclusão de norma nova": stubs e relações). Não edite à mão os campos gerados (`status_vigencia`, `revoga`, `revogada_por`, `altera`, `alterada_por`, `regulamenta`, `regulamentada_por`, `fundamenta_se_em`, `fundamenta`, `vigencia_*`): relação nova entra em `relacoes.yaml`, com a evidência literal. Ao mudar a marcação de uma norma, preserve as palavras do texto oficial.
- **Dados pessoais:** a base é pública. `validar_base.ts` recusa CPF, RG, celular, matrícula, SIAPE, URL pré-assinada, planilha do Google e sessão do SEI (regra em `packages/kb/src/ppcs/dados-pessoais.ts`; o que fica e o que sai em [Dados pessoais e URLs internas](base-conhecimento/docs/curadoria-metadados-institucionais.md#dados-pessoais-e-urls-internas)). E-mail particular não tem regra automática: tire à mão.
- **Fichas da revisão de PPC** (`base-conhecimento/revisao-ppc/`): leia o [README da pasta](base-conhecimento/revisao-ppc/README.md) antes; depois, `node scripts/validar_base.ts` e `pnpm exec vp test run scripts/base/revisao-ppc`. Mudar um verificador (`packages/ppc/src/verificadores/`) pode ser medido na base com `node packages/ppc/scripts/pre-conferencia.ts --base`.

Depois de alterar qualquer coisa em `base-conhecimento/` (normas, `relacoes.yaml`, `transicoes.yaml`, `correspondencias/`, `config/vigencia.yaml`, stubs, catálogos, PPCs, registros institucionais):

```bash
node scripts/gerar_base.ts
node scripts/gerar_indice_ppcs.ts   # se mexeu em registros institucionais ou PPCs
node scripts/validar_base.ts
```

Se a mudança afeta o banco (normas, relações, PPCs), compile (`pnpm kb:compilar`) e confira a resposta pelo `pnpm kb` (por exemplo, `pnpm kb ficha-norma <id>` da norma nova).

Depois de alterar um JSON Schema em `base-conhecimento/schemas/`: `node scripts/gerar_tipos_schemas.ts` e `pnpm typecheck`.

## Skills

Edite sempre em `.agents/skills/` e leia antes o `README.md` da skill, quando existir (rode a regeneração ou validação que ele indicar). As skills com bloco `simplifica:` no front matter do `SKILL.md` (hoje `verificar-fundamentacao-normativa`) vão também para o app, que não tem o repositório: mantenha as ferramentas MCP `ifpr` como caminho principal e a CLI como alternativa "dentro do repositório", e acrescente a `simplifica.arquivos` todo arquivo novo que o texto cite (`node scripts/validar_base.ts` confere). Skill sem esse bloco roda só no repositório.

## Código

TypeScript em tudo (salvo poucos `.js`/`.mjs` de build do desktop); os scripts rodam direto no Node 26.12.1 (`.node-version`), sem build, com o pnpm do `packageManager` (`pnpm install` na raiz). Regras compartilhadas entre `scripts/` e o app ficam em `packages/kb` (`@simplifica-if/kb`), que não importa de `scripts/`. Depois de alterar código:

```bash
pnpm fmt && pnpm lint && pnpm typecheck && pnpm test
```

Use sempre `pnpm fmt`, nunca o oxfmt ou o prettier direto: a formatação deixa de fora Markdown, JSON, YAML e as pastas de dados (`base-conhecimento/`, `avaliacao/`, `tmp/`, `outputs/`, `.repos/`, dados das skills). Conversão de `.docx` (`packages/docx`, `packages/ppc`): rode `pnpm --filter @simplifica-if/docx --filter @simplifica-if/ppc test`; os gabaritos de `packages/ppc/test/fixtures/conversao-docx/` travam a saída byte a byte.

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
- Migrações do `conversas.sqlite` (`apps/server/src/persistencia/migracoes/`): enquanto não há usuários em produção, o schema pode ser ajustado direto em `0001_Inicial.ts`; depois do lançamento, mudanças entram numa migração nova registrada em `Banco.ts`, com teste de upgrade em `apps/server/test/migracoes.test.ts`.

## Depurar o app

Os logs ficam em `~/Library/Application Support/Simplifica IF (dev)/logs` no desenvolvimento (macOS); nada sai do computador. O código de um erro (o de "Detalhes técnicos" na interface, o `codigo=` do log) são os 8 primeiros caracteres do `traceId`: `pnpm traces --codigo ABCD1234` mostra a árvore do trace. As outras pastas, as opções do `pnpm traces`, os modos (`SIMPLIFICA_TRACES`) e a leitura de um pacote de diagnóstico estão em [`apps/server/README.md`](apps/server/README.md#depurar-pelo-código-do-erro).
