# Instruções para agentes

Este é o repositório do **Simplifica IF**, um app desktop para os servidores do IFPR: ele dá à IA da assinatura de cada pessoa (Claude, ChatGPT ou Gemini) a base de conhecimento do Instituto e tarefas prontas sobre ela. O repositório contém o app e a base que o alimenta (normas, PPCs, cursos, CNCT, metadados institucionais, fichas da revisão de PPC), além das skills e dos scripts que agentes usam aqui para curar a base. Os planos estão em [`docs/plans/README.md`](docs/plans/README.md): o do app em [`docs/plans/app-simplifica-if.md`](docs/plans/app-simplifica-if.md), o da base em [`docs/plans/arquitetura-base.md`](docs/plans/arquitetura-base.md).

## Mapa

- `apps/desktop`: processo principal do Electron; inicia o servidor local e abre a interface (`pnpm app:dev` em desenvolvimento).
- `apps/server`: servidor local (Effect): motor de conversa, MCP `ifpr` por HTTP local, RPC de leitura da base, revisão de PPC, pastas de trabalho, relatos de erro, atualização da base e das skills.
- `apps/web`: interface em React (Início, tarefas, conversa, leitor `ifpr://`, Explorar, Revisar um PPC, boas-vindas, Configurações).
- `packages/kb`: núcleo da base (resolvedor de citações, vigência, banco `kb.sqlite`, CLI `kb`).
- `packages/mcp`: o `simplifica-mcp`, 16 ferramentas: 15 de consulta só de leitura ao `kb.sqlite` e a `etapa`, que informa ao app o andamento da tarefa; roda dentro do app e como executável à parte.
- `packages/motor`: motor de conversa com um driver por IA (Agent SDK do Claude, `codex app-server`, `agy acp`).
- `packages/ppc` e `packages/docx`: conversão de PPC em `.docx`, pré-conferência, revisão com IA e comentários no Word; o `docx` também converte `.docx` e `.odt` quaisquer em Markdown, para a IA ler os anexos.
- `packages/pdf`: o texto de um PDF em Markdown (`pdfjs-dist`), para a IA ler os anexos.
- `packages/contratos-app`: contratos RPC entre a interface e o servidor.
- `packages/atualizacao`: manifesto do canal, assinatura minisign e pacotes da base e das skills.
- `packages/effect-acp` e `packages/effect-codex-app-server`: copiados do T3 Code ([`docs/upstream-t3.md`](docs/upstream-t3.md)).
- `base-conhecimento/`: fonte publicada da base.
- `scripts/`: pipeline da base, aplicação de dado coletado fora do repositório, fábrica da atualização, avaliação.
- `.agents/skills/`: skills dos agentes (`.claude/skills` é symlink para cá).

## O que o app entrega hoje

- **Conversa** com a IA da pessoa, com as ferramentas `ifpr` do `simplifica-mcp`, busca e leitura web por padrão como complemento à base (com filtro de URL pública e bloqueio de comandos de rede), aprovação de ações, indicador de etapas, pasta da tarefa em `Documentos/Simplifica IF/` e "Desfazer".
- **Tarefas** no Início: a nativa "Revisar um PPC" e as skills com bloco `simplifica:` no `SKILL.md` (hoje só a `verificar-fundamentacao-normativa`).
- **Revisar um PPC** (`.docx`): pré-conferência em código, relatório com IA opcional, roteiro por pendência e cópia do documento com comentários do Word. Os critérios são as fichas de `base-conhecimento/revisao-ppc/`.
- **Leitor `ifpr://` e Explorar:** normas com vigência, PPCs, cursos (com as divergências PPC × SUAP já publicadas na base), campi, CNCT, Consepe e fichas, sem IA e sem rede.
- Primeiro uso com perfil, "Isto está errado" (relato de erro) e atualização da base e das skills (pronta, sem feed de produção ligado).

O app foi desenhado para dado público (decisão 6 do plano do app): a base e os arquivos que a pessoa escolhe anexar, sob o aviso de uso. Ele não confere os anexos, que vão para a IA da pessoa, e não acessa sistemas com login.

## Ferramentas do repositório fora do app

Estas ferramentas rodam só no repositório, por agentes ou por quem cura a base:

- a skill `ifpr-design`, usada para desenhar a interface e materiais, não como tarefa do app.

As ferramentas com login em sistemas internos (SEI, SUAP) ficam num repositório privado à parte. Elas não importam código daqui: leem a base pelo `simplifica-mcp` (`simplifica-mcp consultar`) e entregam dado coletado por um relatório que um comando `aplicar_*` daqui confere e aplica (veja "Dado coletado fora do repositório" na [doc de curadoria](base-conhecimento/docs/curadoria-metadados-institucionais.md)). A integração de sistemas com login ao app fica para depois do Marco 2 (decisão 6 e "Fora do escopo até o Marco 2" em [`docs/plans/app-simplifica-if.md`](docs/plans/app-simplifica-if.md)).

## Base de conhecimento

A base reúne normas, catálogos, PPCs, e metadados institucionais. A fonte publicada fica em `base-conhecimento/`, e o `kb.sqlite` que o app e o `simplifica-mcp` leem é compilado dos mesmos arquivos (`pnpm kb:compilar`).

Os dados institucionais de gestão (Campi, Cursos com metadados de PPC e SUAP, Processos Seletivos, Editais e Ofertas) têm como fonte de verdade os registros de `base-conhecimento/institucional/ifpr/` (`campi/`, `cursos/`, `processos-seletivos/`, `editais/`, `ofertas/`), um JSON por registro, versionados no git; o kb os lê direto. As reuniões do Consepe, com pareceres e itens de pauta e sem dados de pessoa, estão em `institucional/ifpr/conselhos/`.

## Skills

As skills ficam em `.agents/skills/`; `.claude/skills` é um symlink para esse diretório, para que o Claude Code descubra as mesmas skills. Edite sempre em `.agents/skills/`. Antes de alterar uma skill, leia o `README.md` dela, quando existir: propósito, fluxo de uso, comandos de manutenção e convenções locais. Se a alteração envolver base gerada ou índice consolidado, rode o comando de regeneração ou validação indicado nesse README antes de concluir. Só as skills com bloco `simplifica:` vão para o app (veja o parágrafo sobre o bloco `simplifica:`, mais abaixo); as demais rodam só no repositório.

## Consulta local da base

A base é consultada pela CLI `kb`, dentro do checkout, ou pelo MCP (o servidor `simplifica-mcp`, sem o checkout; veja [`packages/mcp/instrucoes.md`](packages/mcp/instrucoes.md)), e depois pelo Markdown da norma ou do PPC que a resposta aponta. Não navegue a base por manifestos e índices, e não troque os arquivos locais por URLs públicas.

Use a CLI `kb` (requer `pnpm install` na raiz). Ela consulta `tmp/kb.sqlite`, um banco derivado dos arquivos do checkout (normas, PPCs com o texto integral das seções, registros institucionais, CNCT, fichas da revisão de PPC), e o recompila sozinha quando ele falta ou está mais velho que as fontes (cerca de 8 s; `pnpm kb:compilar` força). O banco nunca é fonte de verdade nem lugar de edição: toda resposta traz o texto literal e o arquivo e a linha de onde ele veio, e é esse arquivo que se cita.

```bash
pnpm kb buscar-norma "Resolução CNE/CP nº 2/2026, art. 28" --json   # citação ou ID → o dispositivo (caput, texto, linhas); termos → busca nos metadados e nos dispositivos
pnpm kb buscar-secoes "acompanhamento de egressos" --cnct tecnico-em-agropecuaria --json   # seções de PPC; filtros --ppc, --tipo, --nivel, --campus, --forma
pnpm kb cursos --eixo "Informação e Comunicação" --processo processo-seletivo-2026 --json   # cursos com CNCT, ofertas e turno; filtros --turno, --campus, --nivel…
pnpm kb ppc-fatos curitiba/tecnico-em-enfermagem --json              # carga horária, estágio e ano do PPC, cruzados com o SUAP
pnpm kb ppc-fatos --divergencias --nivel médio                        # PPCs com divergência PPC × SUAP
pnpm kb pacote-contexto CT-CURR-12 curitiba/tecnico-em-enfermagem --json   # contexto de uma ficha da revisão de PPC: CNCT, dispositivos citados, marcos e regras de transição, seções
```

Os fatos de PPC têm status `extraido` (regra sobre o texto convertido, sem revisão humana): confira o `trecho_fonte` antes de afirmar uma divergência. A busca de seções usa radicais e um léxico de sinônimos (`packages/kb/dados/sinonimos.yaml`); se ela não achar o que se espera, procure com `rg` nos Markdown dos PPCs.

Procedimento recomendado:

1. Ache a fonte pelo comando `kb` correspondente (acima e abaixo).
2. Abra o arquivo e as linhas que a resposta aponta (os `path` são relativos à raiz do repositório ou, quando a resposta diz, a `base-conhecimento/`) antes de redigir resposta substantiva.
3. Para normas, cite o título, a fonte oficial registrada no front matter e o artigo, seção ou item usado. Para PPCs, cite o arquivo e as linhas. Para metadados institucionais, cite o registro JSON de `base-conhecimento/institucional/ifpr/`.
4. Use busca online apenas quando o dado necessário não existir na base local, quando a pergunta exigir atualização externa ou quando for preciso confirmar informação em fonte oficial. Ao usar fonte externa, deixe isso explícito.

Cada norma tem um ID canônico derivado do ato (`id` no front matter e no `manifest.json`), como `br/cne-cp/res/2026/2`, `br/lei/1996/9394` ou `ifpr/consup/res/2024/190`. Normas citadas sem texto na base (stubs) e referências `externo:` ficam em `base-conhecimento/normas/stubs.yaml`. Para identificar uma citação ou achar quem cita uma norma, use a CLI `kb`:

```bash
pnpm kb resolver "Resolução CNE/CP nº 1/2021, art. 20"   # ID canônico, dispositivo, regra e confiança
pnpm kb citacoes br/cne-cp/res/2021/1 --json              # PPCs convertidos que citam a norma, com linha, trecho e regra
pnpm kb adequacao-art71                                   # cursos técnicos em oferta e a DCN que cada PPC cita
pnpm kb dispositivo "br/cne-cp/res/2026/2#art28-xviii"    # texto do dispositivo, caput herdado, notas e linha no Markdown
pnpm kb vigencia br/cne-cp/res/2021/1 --em 2026-11-01     # status numa data, relações que o determinam e regras de transição
pnpm kb correspondencia "br/cne-cp/res/2021/1#art20"      # dispositivo correspondente na norma sucessora (tabela em rascunho)
pnpm kb impacto br/cne-cp/res/2021/1                      # fichas, validações, textos das skills, normas e PPCs afetados
pnpm kb relacoes br/lei/1996/9394                         # relações tipadas (revoga, altera, regulamenta, fundamenta-se-em)
```

Os dispositivos têm ID próprio (`#art28-xvi`, `#art28-par1-iv`, `#art71-parunico`, `#art36A`, `#anexo1-art5`). As relações entre normas estão em `base-conhecimento/relacoes.yaml`, as regras de transição em `base-conhecimento/transicoes.yaml` e as tabelas de correspondência entre normas sucessoras em `base-conhecimento/correspondencias/`. O `status_vigencia` publicado é calculado na `data_referencia` de `base-conhecimento/config/vigencia.yaml`; quando ele depende de uma data ainda não registrada (por exemplo, a publicação da Res. CNE/CP nº 2/2026 no DOU), o front matter e o `manifest.json` trazem `vigencia_a_confirmar`. Norma revogada não é inaplicável: consulte as regras de transição (`kb vigencia`). A tabela de correspondência 1/2021 → 2/2026 é rascunho sem revisão jurídica; trate-a como indicação, não como fundamento.

Confira a `regra` e a `confianca` das citações: as regras de confiança menor (`dcnept-2021-orgao-trocado`, `orgao-ausente-registro`, `orgao-no-documento`) completam ou corrigem citações incompletas dos PPCs e devem ser conferidas no trecho antes de afirmar algo substantivo. O resultado aponta o arquivo; abra o Markdown da norma ou do PPC antes de responder.

PPCs servem como exemplos institucionais observados, não como fonte normativa obrigatória. Em elaboração, revisão ou comparação de PPC, combine PPCs similares com normas vigentes da base e, para cursos técnicos, com o CNCT.

## Curadoria e operação

Para consultar ou alterar campi, cursos, metadados de PPC e SUAP, horários dos campi, processos seletivos, editais ou ofertas de ingresso, leia primeiro:

- [Curadoria de metadados institucionais](base-conhecimento/docs/curadoria-metadados-institucionais.md)

Um PPC novo (ou a versão nova do PPC de um curso) entra na base pelo DOCX da coordenação: `node scripts/importar_ppc_docx.ts <campus_id>/<curso_slug> <arquivo.docx> --fonte-url <url> [--substituir]`, seguido do pipeline da base; PDF não é convertido (passo a passo em "Entrada de PPC novo na base" na doc de curadoria).

Dado coletado fora do repositório (hoje, as matrizes do SUAP) chega por um relatório JSON que um comando `aplicar_*` confere e aplica, como `node scripts/aplicar_matrizes_suap.ts <relatório> [--apply]`; a convenção está em "Dado coletado fora do repositório" na doc de curadoria.

As reuniões do Consepe estão em `base-conhecimento/institucional/ifpr/conselhos/`.

Depois de alterar os registros de `base-conhecimento/institucional/ifpr/`, rode:

```bash
node scripts/gerar_base.ts
node scripts/gerar_indice_ppcs.ts
node scripts/validar_base.ts
```

Depois de alterar um JSON Schema em `base-conhecimento/schemas/`, regenere os tipos TypeScript derivados dele (`scripts/base/tipos-schemas.ts`) e confira o código que os usa:

```bash
node scripts/gerar_tipos_schemas.ts
pnpm typecheck
```

### Dados pessoais e URLs internas na base

A base é pública. A regra fica em `packages/kb/src/ppcs/dados-pessoais.ts`, com os casos de teste em `dados-pessoais.casos.json`; o `validar_base.ts` aplica a regra a todo arquivo de `base-conhecimento/` e recusa o que ela acharia, com só as contagens na mensagem. A importação de PPC (`importar_ppc_docx.ts`) aplica a mesma limpeza ao texto convertido.

São omitidos, com o rótulo e o resto da frase mantidos:

- CPF → `[CPF omitido]`: o número depois do rótulo `CPF` (inclusive com `|` ou `<br>` no meio, como em célula de tabela) e o `000.000.000-00` sem rótulo com dígito verificador válido;
- RG → `[RG omitido]`: o número depois de `RG`, `R.G.`, `R.G`, `Registro Geral`, `cédula`/`carteira`/`doc. de identidade` ou `Identidade:`, com UF (`MG-12.345.678`) ou grupos separados por espaço; `RG/CPF:` com dois números vira os dois marcadores;
- celular → `[telefone omitido]`: 9 dígitos começando por 9, com DDD (com ou sem parênteses, `+55`) ou, sem DDD, com separador;
- matrícula de estudante → `[matrícula omitida]`: 11 dígitos começando pelo ano (`20xx…`);
- SIAPE → `[SIAPE omitido]`: o número depois do rótulo `SIAPE` e os números da coluna `SIAPE` de tabela Markdown.

Ficam: o nome de pessoa em ato oficial, quadro docente ou declaração; e-mail institucional; telefone fixo; endereço e contato de campus e de parceiros. Não são CPF nem RG: onze dígitos soltos (IDs do Lattes e ISBN partidos pela conversão), número de até 4 dígitos depois de `RG` (um ano) e `R.G.` depois de iniciais de autor em referência bibliográfica (`JORDÃO, R.G. 2010`). E-mail particular não tem regra automática: tire à mão.

Também não entram, e o `validar_base.ts` recusa: URL pré-assinada (`AWSAccessKeyId`, `Signature`, `X-Amz-*`; grave sem a query string), link de planilha do Google (`docs.google.com/spreadsheets`; o texto da referência fica sem o link, salvo o `horarios_url` de um campus, grade pública apontada pelo site oficial) e parâmetros de sessão do SEI (`infra_hash`, `infra_sistema`, `infra_unidade_atual`; o `hash_download` da autenticação pública fica).

Ao incluir uma norma em `base-conhecimento/normas/`, preencha o `id` conforme [Padrão de front matter](base-conhecimento/docs/padrao-front-matter-legislacao.md) e retire de `normas/stubs.yaml` o stub correspondente, se houver.

Depois de alterar normas, `relacoes.yaml`, `transicoes.yaml`, `correspondencias/`, `config/vigencia.yaml`, `normas/stubs.yaml`, catálogos, PPCs convertidos ou manifestos locais, rode:

```bash
node scripts/gerar_base.ts      # campos gerados do front matter (relações, status de vigência) e manifest.json
node scripts/validar_base.ts
```

Depois, compile o banco (`pnpm kb:compilar`) e confira os gabaritos de `testes-gabarito/` (`sh testes-gabarito/kb.sh --comparar`, `banco.sh --comparar`, `base.sh --comparar` e `node packages/mcp/test/gabarito.ts --comparar`) e recalcule a contagem de casos de `testes.txt` pelo roteiro JUnit do [README do gabarito](testes-gabarito/README.md): uma norma nova muda escores de busca, contagens do banco e o número de casos de `estrutura.test.ts`, que tem um caso por norma. Norma nova também entra em `INCLUIDAS_DEPOIS` (`packages/kb/src/normas/referencia-saneamento.ts`), porque os testes de saneamento e de status manual comparam as normas com o commit anterior ao saneamento, e na contagem de `estrutura.test.ts`.

Não edite à mão `status_vigencia`, `revoga`, `revogada_por`, `altera`, `alterada_por`, `regulamenta`, `regulamentada_por`, `fundamenta_se_em`, `fundamenta` nem `vigencia_*` no front matter das normas: eles são gerados. Relação nova entra em `relacoes.yaml`, com a evidência literal do texto; `pnpm kb relacoes --propor` lista o que o regex encontrou e ainda não foi confirmado. Ao mudar a marcação de uma norma, preserve as palavras (`pnpm --filter @simplifica-if/kb test src/normas` confere) e siga as convenções de corpo de `base-conhecimento/docs/padrao-front-matter-legislacao.md`.

O código é TypeScript (salvo poucos `.js` e `.mjs` pontuais, como os de build do desktop): o app (`apps/`), os pacotes (`packages/`), os scripts de manutenção e o pipeline da base (`gerar_base.ts`, `gerar_indice_ppcs.ts`, `validar_base.ts`, com lógica em `scripts/base/`). Os scripts rodam direto no Node, sem etapa de build: a versão fica em `.node-version` e `engines` (26.12.1), e o pnpm do `packageManager` (12.14.0, pelo corepack) instala as dependências com `pnpm install` na raiz. Regras compartilhadas entre `scripts/` e o app (texto, JSON, JSON Schema, referências normativas) ficam no workspace `packages/kb` (`@simplifica-if/kb`); `packages/kb` não importa de `scripts/`. Depois de alterar código TypeScript em qualquer parte, rode:

```bash
pnpm fmt
pnpm lint
pnpm typecheck
pnpm test
```

As ferramentas são as do T3 Code, configuradas em `vite.config.ts`: `pnpm fmt` aplica o `vp fmt` (oxfmt, largura 120), `pnpm lint` o `vp lint` (oxlint), `pnpm test` o `vp test` (vitest) na raiz e em cada pacote, e `pnpm typecheck` o `effect-tsgo`. A formatação deixa de fora Markdown, JSON e YAML, e as pastas de dados (`base-conhecimento/`, `avaliacao/`, `tmp/`, `outputs/`, `.repos/` e as pastas de dados das skills): são textos normativos, saídas de geradores ou insumos, e não devem ser reformatados. Use sempre `pnpm fmt`, nunca o oxfmt ou o prettier direto sobre a raiz. O código de referência do Effect fica em `.repos/effect`, versionado e somente leitura: o repositório do Effect inteiro na tag do `effect` do catalog, sem o `.git` dele. Prefira os padrões dele aos inventados, mas nunca edite nem importe dessa pasta; ao subir o `effect` do catalog, rode `pnpm sync:repos`, que troca a pasta e faz o commit só dela. A CI não baixa `.repos/` (sparse checkout), e o fmt, o lint, o typecheck e os testes não a veem.

As skills com bloco `simplifica:` no front matter do `SKILL.md` (hoje `verificar-fundamentacao-normativa`) também vão para o app desktop, que não tem o repositório: só as ferramentas MCP `ifpr` e os arquivos listados em `simplifica.arquivos`. Ao editá-las, mantenha as ferramentas `ifpr` como caminho principal e a CLI e os scripts como alternativa "dentro do repositório", e acrescente a `simplifica.arquivos` todo arquivo novo que o texto cite; `node scripts/validar_base.ts` confere o bloco (Effect Schema em `@simplifica-if/mcp/skills`) e os arquivos.

### Fichas da revisão de PPC

Os critérios da tarefa "Revisar um PPC" são as fichas de `base-conhecimento/revisao-ppc/` (`fichas/`, `topicos-fichas.json`, `marcos-normativos.json`); leia o [README da pasta](base-conhecimento/revisao-ppc/README.md) antes de mudá-las. O contrato está em `scripts/base/revisao-ppc/`. Depois de alterar fichas, tópicos ou marcos, rode:

```bash
node scripts/gerar_base.ts        # schemas/ e mapa-fichas.md da revisão
node scripts/validar_base.ts
pnpm exec vp test run scripts/base/revisao-ppc
```

Ficha D tem verificador em `packages/ppc/src/verificadores/`; mudar um verificador ou o modo de uma ficha pede `node packages/ppc/scripts/pre-conferencia.ts --base --check` e a atualização de `packages/ppc/PRECISAO.md`. A conversão do `.docx` fica em `packages/docx` (leitor OOXML genérico, com os limites contra arquivo hostil) e `packages/ppc` (conversão do PPC e normalizador de Markdown). Depois de alterá-los, rode os testes dos dois (`pnpm --filter @simplifica-if/docx --filter @simplifica-if/ppc test`); os gabaritos em `packages/ppc/test/fixtures/conversao-docx/` travam a saída byte a byte.

## Código com Effect

O backend, os pacotes e os scripts usam Effect 4. Antes de escrever ou revisar código Effect, leia [Serviços Effect](docs/internals/servicos-effect.md) e, para a biblioteca, [`.repos/effect/LLMS.md`](.repos/effect/LLMS.md). O essencial:

- Uma capacidade é um método de serviço do domínio (`Context.Service` com a interface inline, `make`, `layer`). Handlers RPC, ferramentas MCP, a CLI `kb` e os scripts são casca fina: decodificam, chamam um método e traduzem os erros.
- Use Effect para I/O, erros esperados, recursos com ciclo de vida, `Config`, concorrência e prazo, e nos pontos de entrada (`NodeRuntime.runMain`, `effect/cli`). Funções puras de texto, regex e transformação de dados continuam funções comuns, chamadas de dentro dos serviços.
- Funções reutilizáveis usam `Effect.fn("Servico.operacao")`. Imports por namespace (`import * as Effect from "effect/Effect"`). Tipos inferidos; nada de `any`.
- Erros são `Schema.TaggedError` com atributos estruturados, mensagem em português que não sai de `cause`, e `cause` no erro que embrulha outro. Capture com `Effect.catchTags`.
- `runPromise` e `ManagedRuntime` só nas bordas, nunca dentro de serviço.
- Testes com `@effect/vitest` (`it.effect`, `TestClock`), sem `sleep`, polling, relógio de parede nem `retry`.
- Identificadores, mensagens e comentários em português; comentário só para o que o código não mostra, curto. Supressão de lint ou de diagnóstico diz por quê.
- Migrações do `conversas.sqlite` (`apps/server/src/persistencia/migracoes/`) são imutáveis depois de irem para `main`: mudanças de schema ou novos campos obrigatórios em colunas JSON entram numa migração nova registrada em `Banco.ts`, com teste de upgrade em `apps/server/test/migracoes.test.ts`.

## Depurar o app

O app grava tudo localmente, na pasta de logs: `~/Library/Application Support/Simplifica IF (dev)/logs` no desenvolvimento (macOS), `~/Library/Logs/Simplifica IF` no app empacotado do macOS e `%APPDATA%\Simplifica IF\logs` no Windows. Nada sai do computador.

- `simplifica-if.log` (giro em 5 MB para `.1`): o que o processo principal do desktop registra, o stderr do servidor (logfmt, uma linha por registro) e os erros da interface (linhas `[interface]`).
- `traces.jsonl` e `logs-otlp.jsonl` (mesmo giro): os spans e os logs do servidor em OTLP/JSON, um pedido de exportação por linha. No desenvolvimento vai tudo; no app empacotado, a caixa-preta grava só os traces com erro (inteiros) e o resumo dos lentos ([`apps/server/README.md`](apps/server/README.md#traces-e-logs)).

O código de um erro (o de "Detalhes técnicos" na interface, o `codigo=` do log) são os 8 primeiros caracteres do `traceId` do pedido. Com ele:

```bash
rg "codigo=ABCD1234" "<pasta de logs>/simplifica-if.log"   # as linhas do log do servidor e da interface
pnpm traces --codigo ABCD1234                              # a árvore do trace: spans, duração, status, erro e logs
pnpm traces --erros                                        # os traces com erro, mais recentes primeiro
pnpm traces --lentos 2000 --ultimos 10                     # os traces de 2 s ou mais
pnpm traces --logs                                         # os logs sem trace gravado (a partida, os avisos de gravação)
pnpm traces --codigo ABCD1234 --json                       # a forma achatada, para ler por programa
pnpm traces --pasta "<pasta de logs>"                      # outra pasta (padrão: a do desenvolvimento)
```

Quem relata um problema anexa o pacote de "Configurações › Diagnóstico" (`Documentos/Simplifica IF/Diagnósticos/diagnostico-AAAA-MM-DD-HHMMSS.zip`): os mesmos três arquivos e os `.1`, saneados (pastas de tarefa, pasta pessoal, usuário nos caminhos, e-mails, segredos e dados pessoais trocados por marcadores), mais o `sistema.json` (versões, IAs, sistema, modo dos traces) e um `LEIA-ME.txt`; sem conversas, anexos, perfil nem tokens ([`apps/server/README.md`](apps/server/README.md#diagnóstico)). Para ler: descompacte numa pasta e rode `pnpm traces --pasta <pasta descompactada> --codigo ABCD1234` (e `rg "codigo=ABCD1234" <pasta>/simplifica-if.log`).

`SIMPLIFICA_TRACES` (`completo`, `caixa-preta`, `desligado`) muda o modo no `pnpm app:dev`. Com `OTEL_EXPORTER_OTLP_ENDPOINT` (por exemplo `http://localhost:4318`), o servidor manda os spans e os logs a um coletor OTLP/HTTP (Jaeger, otel-tui), no lugar dos arquivos; só para desenvolvimento.
