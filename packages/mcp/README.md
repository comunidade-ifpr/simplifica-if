# simplifica-mcp

Servidor MCP só de leitura que entrega a base de conhecimento do IFPR a qualquer IA (Claude, Codex, Gemini). Ele lê apenas o `kb.sqlite`, em modo somente leitura: não recompila o banco, não procura o repositório e não acessa a rede. Cada resposta traz o texto literal, a proveniência (`path` e linhas no repositório de origem), o link `ifpr://` e a versão da base. Os mesmos links `ifpr://` também se leem como recursos MCP (M1.5, ver [Recursos `ifpr://`](#recursos-ifpr)).

Especificação: `docs/plans/m0-simplifica-mcp.md` (M0.1). Prontos os passos T0 (banco autossuficiente, no `packages/kb`), T1 (servidor, CLI, banco, envelope, links e texto), T2 (normas), T3 (PPCs e cursos), T4 (`pacote_contexto`) e T6 (suítes transversais e CI): as 16 ferramentas.

| # | Ferramenta | O que faz |
|---|---|---|
| 1 | `buscar_norma` | busca normas por citação, ID ou termos |
| 2 | `ler_dispositivos` | lê dispositivos pelo ID, com o caput herdado |
| 3 | `ficha_norma` | vigência numa data, relações, sucessoras e transições |
| 4 | `correspondencia` | dispositivo correspondente na norma sucessora (tabela em rascunho) |
| 5 | `resolver_citacoes` | citações em texto livre → ID canônico, regra e confiança |
| 6 | `citacoes_da_norma` | PPCs que citam uma norma ou dispositivo |
| 7 | `impacto_da_norma` | o que uma norma atinge na base |
| 8 | `adequacao_art71` | cursos técnicos alcançados pelo art. 71 da Res. CNE/CP nº 2/2026 |
| 9 | `buscar_secoes` | busca trechos de PPCs |
| 10 | `ler_secao` | lê uma seção de PPC pelo ID |
| 11 | `listar_cursos` | cursos com CNCT, eixo, ofertas e turno |
| 12 | `ficha_curso` | tudo sobre um curso |
| 13 | `fatos_ppc` | fatos do PPC cruzados com o SUAP |
| 14 | `pacote_contexto` | contexto de uma tarefa da `revisar-ppc` para um PPC da base ou um `.md` da pasta de trabalho |
| 15 | `sobre_a_base` | versão, data de referência e conteúdo da base |
| 16 | `etapa` | etapa da tarefa, para o app |

## Recursos `ifpr://`

Desde o M1.5, os links que as ferramentas devolvem são recursos MCP, no executável stdio e no servidor HTTP do app, sem mudar as ferramentas (`src/recursos/recursos.ts`). O `initialize` passa a anunciar a capacidade `resources`.

| Modelo de URI (`resources/templates/list`) | `resources/read` devolve | Leitura |
|---|---|---|
| `ifpr://norma/{+norma}{#dispositivo}` | sem dispositivo, a ficha da norma (vigência, relações, sucessoras, transições); com `#dispositivo`, só o dispositivo, com o caput herdado, os incisos e as notas | `ficha_norma`; `ler_dispositivos` com `filhos` |
| `ifpr://curso/{campus}/{curso}` | a ficha do curso | `ficha_curso` |
| `ifpr://ppc/{campus}/{curso}{#secao}` | sem seção, o índice do PPC (fatos × SUAP e o link de cada seção, com as linhas); com `#secao`, o texto literal da seção (a seção longa vem no primeiro trecho, com o `cursor` para continuar em `ler_secao`) | `Leitura.lerPpc`; `ler_secao` |
| `ifpr://cnct/{slug}` | o curso no CNCT (eixo, área, carga horária, perfil, campo de atuação, CBO, infraestrutura, legislação, cada campo com a linha no JSON do catálogo) e os cursos do IFPR com a habilitação | `Leitura.lerCnct`, sobre `Cursos.cnct` do kb |
| `ifpr://campus/{campus}` | o campus e os cursos dele | `Leitura.lerCampus` |
| `ifpr://ficha/{ficha}` | pergunta, rubrica, evidências (com a linha no arquivo da ficha) e referências normativas de uma ficha da `revisar-ppc` | `Leitura.lerFicha`, sobre `FontesNormativas.conteudoDasSkills` |

- **Conteúdo:** `text/markdown`, o mesmo texto da ferramenta: avisos ("Atenção:"), corpo com a fonte (`path:linhas`) e o rodapé com a versão da base. A `base` e os avisos vão também no `_meta` (`ifpr/base`, `ifpr/avisos`). Cada tipo tem o teto de tamanho da ferramenta correspondente; os novos, o seu (`TETO_RECURSO_*` em `src/recursos/conteudos.ts`).
- **`resources/list`:** só pontos de entrada, não a base inteira: as normas centrais que estiverem na base (Res. CNE/CP nº 2/2026, Res. CNE/CP nº 1/2021, LDB) e os campi.
- **Erros:** link malformado, de tipo desconhecido, de outro esquema ou de algo que não está na base volta como erro `InvalidParams` (-32602), com a mensagem em português e um exemplo do link certo. Os modelos casam pelo tipo (`ifpr://norma/*`…); um modelo curinga, escondido do `resources/templates/list` por `McpServer.visibility`, pega o resto, que sem ele voltaria com a mensagem em inglês do `effect/ai`.
- **Resolução única:** `lerRecurso` (em `src/recursos/recursos.ts`) desmonta o link e chama o `Leitura`; é a mesma função do `resources/read` e do RPC `lerLink`. Ela devolve um `LinkLido`: o tipo do conteúdo (`norma`, `dispositivo`, `curso`, `ppc`, `secao`, `cnct`, `campus`, `ficha`), a `Resposta` estruturada e o texto Markdown.
- **No servidor HTTP:** cada leitura entra no stream `chamadas`, como as chamadas de ferramenta (ver abaixo).

## Como rodar

```bash
pnpm install                                         # na raiz do repositório
pnpm kb compilar                                     # gera tmp/kb.sqlite
node packages/mcp/src/cli.ts --banco tmp/kb.sqlite
```

O servidor fala MCP pelo stdin/stdout; as mensagens de diagnóstico vão para o stderr.

**Pasta de trabalho.** O `pacote_contexto` com `arquivo` é o único ponto em que o servidor lê um arquivo fora do banco (`src/leitura/PastaTrabalho.ts`). O caminho, relativo à pasta ou absoluto dentro dela, é recusado se sair da pasta, antes de tocar no disco (o que pega o `..` e o caminho absoluto de fora); depois de conferir que o arquivo existe, o caminho real (`realPath`, com os links simbólicos seguidos) é conferido de novo, o que pega o symlink para fora. Só `.md`, até 8 MB.

| Opção | Padrão | Uso |
|---|---|---|
| `--banco <caminho>` | variável `SIMPLIFICA_KB` | `kb.sqlite` a servir (obrigatório). `~/` no início é expandido. |
| `--pasta-trabalho <dir>` | diretório atual | única pasta de onde o servidor lê arquivos: o `arquivo` do `pacote_contexto` |
| `--canal <dev\|beta\|estavel>` | `dev` | canal informado em `base.canal` quando o banco não o registra |

Um banco com `versao_esquema` diferente da esperada (`VERSAO_ESQUEMA` de `packages/kb/src/db/esquema.ts`) é recusado com "base incompatível com esta versão do simplifica-mcp; atualize".

## Configuração no piloto zero

Para quem vai instalar, o passo a passo está no [guia do piloto zero](../../docs/guia-piloto-zero.md).

Para rodar a partir do checkout, o comando é `node /caminho/simplifica-if/packages/mcp/src/cli.ts --banco /caminho/kb.sqlite` (Node da versão de `.node-version`). O executável `simplifica-mcp`, um Node SEA que não precisa de Node instalado, sai de `pnpm mcp:executavel` em `packages/mcp/dist-exe/` (`--alvo` ou `--todos` para outras plataformas).

```bash
# Claude Code
claude mcp add ifpr -- simplifica-mcp --banco ~/SimplificaIF/kb.sqlite
```

```json
// Claude Desktop: claude_desktop_config.json
{ "mcpServers": { "ifpr": { "command": "simplifica-mcp", "args": ["--banco", "~/SimplificaIF/kb.sqlite"] } } }
```

```toml
# Codex: ~/.codex/config.toml
[mcp_servers.ifpr]
command = "simplifica-mcp"
args = ["--banco", "~/SimplificaIF/kb.sqlite"]
```

- **Gemini CLI:** a mesma estrutura de `mcpServers`, em `~/.gemini/settings.json`.
- **Caminho:** use caminhos absolutos no comando. O servidor expande `~/` nos próprios argumentos, mas nem todo cliente expande o `~` do nome do programa.

## Estrutura

O pacote é Effect 4 (`effect/ai`, `effect/rpc`, `effect/cli`), sem o SDK oficial do MCP em produção: o cliente do SDK (`@modelcontextprotocol/client`) fica só nos testes, como conferência independente do protocolo.

```
packages/mcp/
├── instrucoes.md            # campo `instructions` do servidor, embutido em src/instrucoes.gerado.ts
├── src/
│   ├── cli.ts               # effect/cli: --banco (ou SIMPLIFICA_KB), --pasta-trabalho, --canal; stdio
│   ├── servidor.ts          # McpServer.layerStdio, layerLeitura, layerRegistro, mensagens de abertura
│   ├── http.ts              # export @simplifica-if/mcp/http: o servidor HTTP local do app, com token por sessão
│   ├── SessaoAtual.ts       # a sessão da chamada (só no HTTP): rótulo e registro das chamadas
│   ├── contratos.ts         # Effect Schema do envelope (Resposta, Aviso, Fonte, Página) e dos tipos comuns; erros
│   ├── esquema.ts           # construtores de schema (texto aparado, inteiro…) e o JSON Schema das ferramentas
│   ├── validacao.ts         # entrada inválida → mensagem em português, no formato do servidor anterior
│   ├── leitura/             # serviço `Leitura`: um método por ferramenta (e por recurso sem ferramenta),
│   │                        # com envelope, paginação e orçamento;
│   │                        # `PastaTrabalho`, a leitura do `.md` do `pacote_contexto` (o único `FileSystem`)
│   ├── envelope.ts          # base, avisos e cursor opaco
│   ├── orcamento.ts         # paginação pelo limite e pelo teto de caracteres ao mesmo tempo
│   ├── links.ts, texto.ts   # IDs → ifpr://; Markdown compacto para a IA (funções puras)
│   ├── recursos/            # os links ifpr:// como recursos MCP (M1.5): modelos, leitura e registro
│   │   ├── recursos.ts      # MODELOS, lerRecurso, layerRecursos (parte do layerRegistro)
│   │   └── conteudos.ts     # dados e texto do PPC sem seção, do CNCT, do campus e da ficha
│   ├── ferramentas/         # um arquivo por ferramenta (Tool.make, descrição, texto)
│   │   ├── toolkit.ts       # FerramentasIfpr (Toolkit) e layerHandlers
│   │   └── registrar.ts     # registrarFerramentas, sobre McpServer.addTool
│   ├── toolkit.ts           # export @simplifica-if/mcp/toolkit
│   └── rpc.ts               # export @simplifica-if/mcp/rpc: GrupoLeitura (ferramentas e links ifpr://) e layerHandlersRpc
└── test/                    # fixtures com o DDL do kb; testes por ferramenta, equivalência, RPC, stdio
    └── transversal/         # suítes de todas as ferramentas: amostras.ts, paridade.ts e os *.test.ts
```

Regras de negócio ficam em `packages/kb`; aqui ficam a validação de entrada, o envelope, o orçamento e a formatação. As ferramentas MCP, os recursos `ifpr://` e o RPC chamam o mesmo serviço `Leitura`, com os mesmos schemas.

## Uso pelo app (fork do T3)

Quatro pontos de entrada, sem curinga:

- `@simplifica-if/mcp/http` (M1.4): o servidor MCP dentro do processo do app, por HTTP em `127.0.0.1`. `layer({ banco, porta?, canal?, pastaTrabalho? })` dá o serviço `ServidorMcpHttp`: `url`, `porta`, `abrirSessao({ rotulo, pastaTrabalho? })` (um token por sessão, revogado no fim do `Scope`; a pasta da sessão vale mais que a da layer) e `chamadas` (cada chamada de ferramenta e cada leitura de recurso, com a sessão, a duração, se falhou e o começo do resultado em `resumo`, até 300 caracteres numa linha). A leitura de recurso vem com `tipo: "recurso"` e o URI pedido em `ferramenta` (`ifpr://cnct/tecnico-em-enfermagem`); na que falhou, o `resumo` é o começo da mensagem de erro. A chamada de ferramenta vem sem `tipo` (o padrão é `"ferramenta"`), como antes. O motor casa o `read_resource` do Antigravity (entrada `{ ServerName, Uri }`) com essa leitura pelo URI (`packages/motor/src/resultados.ts`). As defesas (`Host`, token em tempo constante, tamanho do corpo, `Origin`, protocolos) e o que veio do T3 estão no cabeçalho de `src/http.ts`. Para teste manual: `node packages/mcp/scripts/servir-http.ts --banco tmp/kb.sqlite`, que imprime a URL e o cabeçalho `Authorization` de uma sessão. O executável stdio não muda: o servidor HTTP do Node traz o `ws`, que o SEA não resolve;

- `@simplifica-if/mcp/toolkit`: `FerramentasIfpr`, `FERRAMENTAS`, `layerHandlers`, `registrarFerramentas`, `layerRegistro` (ferramentas e recursos `ifpr://`), `layerLeitura` (sem pasta de trabalho: o `pacote_contexto` aceita só `ppc`), `layerLeituraComPasta` (com ela; pede `FileSystem` e `Path`), `Leitura`, `NOME_SERVIDOR`, `VERSAO_PACOTE`, `INSTRUCOES` e `PROTOCOLOS`;
- `@simplifica-if/mcp/rpc`: `GrupoLeitura`, `layerHandlersRpc` e `layerLeitura`. As operações das ferramentas (`fichaNorma`, `lerDispositivos`, `buscarNorma`, `fichaCurso`, `lerSecao`, `buscarSecoes`, `listarCursos`, `sobreABase`), com a entrada e a resposta da ferramenta de mesmo nome; `lerLink({ link })`, para o leitor `ifpr://` da interface, que lê qualquer link pela resolução do `resources/read` e devolve o `LinkLido` (`tipo`, `resposta`, `texto`); e `lerPpc`, `lerCnct`, `lerCampus` e `lerFicha`, os conteúdos que só existem como recurso, com a mesma resposta que `lerLink` traz nesses tipos (os schemas `Entrada*` e `Saida*` de `src/recursos/conteudos.ts`). Link malformado ou que não está na base falha com `EntradaInvalida`, com a mensagem do `resources/read`;
- `@simplifica-if/mcp/contratos`: os schemas do envelope e dos tipos comuns.

```ts
McpServer.layerHttp({
  name: NOME_SERVIDOR, version: VERSAO_PACOTE, instructions: INSTRUCOES, protocols: PROTOCOLOS,
  path: "/mcp/ifpr", registrations: layerRegistro,
}).pipe(Layer.fresh, Layer.provide(layerLeitura({ banco, canal: "estavel" })))
```

O `Layer.fresh` é necessário quando há outro `McpServer` no mesmo grafo de layers (o do T3): sem ele, os dois endpoints compartilham o registro e listam as ferramentas um do outro.

O registro é próprio (`addTool`), e não `McpServer.registerToolkit`, para que o `content` seja o texto Markdown e a entrada inválida volte como resultado `isError` com a mensagem em português, e não como erro `InvalidParams`.

## Manutenção

```bash
pnpm --filter @simplifica-if/mcp test
pnpm --filter @simplifica-if/mcp typecheck
node packages/mcp/test/gabarito.ts --comparar --schemas-equivalentes   # na raiz: o gabarito do C0 pelo protocolo
node packages/mcp/test/gabarito.ts --atualizar pacote_contexto        # regrava só essa parte (ver testes-gabarito/README.md)
node packages/mcp/test/gabarito.ts --atualizar instrucoes             # depois de mudar instrucoes.md e rodar pnpm mcp:instrucoes
pnpm fmt                             # na raiz: vp fmt no repositório inteiro
pnpm mcp:smoke                       # na raiz: as suítes transversais também na base real (tmp/kb.sqlite)
```

## Suítes transversais

As suítes de `test/transversal/` cobrem todas as ferramentas de `FERRAMENTAS`, sem repetir os testes por ferramenta. Elas tiram as entradas de `amostras.ts` e os casos de paridade de `paridade.ts`. Os dois registros são indexados pelo nome da ferramenta: uma ferramenta nova sem amostra ou sem caso de paridade quebra o `typecheck` e os testes.

| Suíte | O que confere | Fixture | Base real |
|---|---|---|---|
| `contrato.test.ts` | Toda ferramenta tem amostras. Pelo protocolo, a entrada válida passa no `inputSchema`, responde sem erro, e a saída passa no `outputSchema` (ajv) e no Effect Schema. A inválida volta `isError`, com a mensagem em português que começa pelo campo | sim | — |
| `paridade.test.ts` | Cada ferramenta × o comando da CLI `kb` no mesmo banco: mesmos IDs, textos e totais (o `pacote_contexto`, byte a byte, pela base e pelo arquivo). `etapa` não tem comando, e o motivo fica registrado | — | sim |
| `sem-repositorio.test.ts` | Todas as ferramentas numa pasta só com o `kb.sqlite` (diretório atual e `HOME`, com o `PATH` mínimo), com as respostas iguais às do processo de teste e a pasta intacta | sim | sim |
| `orcamento.test.ts` | Nenhum texto acima do teto da ferramenta. A paginação percorrida com o cursor tem mais de uma página e soma o total, sem repetir item | sim | sim |
| `determinismo.test.ts` | Dois processos em stdio, com as mesmas chamadas, dão as linhas de resposta iguais byte a byte | sim | sim |
| `pasta-de-trabalho.test.ts` | O `pacote_contexto` com `arquivo`, pelo servidor isolado: lê o `.md` de dentro da pasta (relativo, em subpasta e absoluto) e recusa `..`, caminho absoluto de fora e link simbólico para fora, antes de ler. A pasta fica como estava | sim | — |
| `descricoes.test.ts` | Pelo `tools/list`: título, descrição (até 600 caracteres) com a frase "Use quando…", parâmetros descritos e o tamanho do que vai ao modelo | sim | — |

- **Fixture e base real:** o `pnpm test` roda a parte da fixture, que não depende do `tmp/kb.sqlite`. O `pnpm mcp:smoke` roda as suítes inteiras com `SIMPLIFICA_SMOKE=1`; a CLI `kb` compila o banco se ele faltar ou estiver velho.
- **Amostras do `pacote_contexto`:** só com `ppc`. O `arquivo` depende da pasta de trabalho, e as suítes por amostra montam o `Leitura` sem ela; ele tem a suíte própria.
- **Sem repositório:** sem `SIMPLIFICA_MCP_EXE`, o servidor é o bundle do executável (`conferirBundle`), no Node com `--permission`. Ele só lê a pasta do banco e o próprio código, não escreve e não abre processos, e um controle negativo confere que ler fora da pasta é negado. Com `SIMPLIFICA_MCP_EXE`, o servidor é o executável, sem o modelo de permissões. Duas ressalvas:
  - o `realpath` em JavaScript do Node faz `lstat` dos diretórios ancestrais, e o modelo de permissões nega isso. Um gancho de pré-carga troca o `realpath` pelo nativo. O executável não aceita o gancho, e por isso roda sem `--permission`;
  - no Node 26.12, o `node:sqlite` abre arquivos sem passar pelo modelo de permissões. O isolamento do banco vem de a pasta só ter o `kb.sqlite`.
- **Contra o executável:**

  ```bash
  pnpm mcp:executavel
  cd packages/mcp && SIMPLIFICA_MCP_EXE=$PWD/dist-exe/simplifica-mcp \
    pnpm exec vp test run --config ../../vite.config.ts --dir . test/transversal/sem-repositorio.test.ts \
    test/transversal/determinismo.test.ts test/transversal/pasta-de-trabalho.test.ts
  ```

## CI

O workflow `.github/workflows/ci.yml` roda em todo push e PR, sem segredos e sem acesso a Notion, SEI ou SUAP. O preparo é o mesmo nos dois jobs (`.github/actions/preparar`): o Node de `.node-version`, o pnpm de `packageManager` pelo corepack (o corepack 0.36.0, instalado à parte), o cache do store do pnpm e `pnpm install --frozen-lockfile`.

| Job | Runner | Passos | Tempo estimado |
|---|---|---|---|
| `verificacao` | `ubuntu-24.04` | `pnpm fmt:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm kb compilar`, `pnpm mcp:smoke`, `validar_base.ts`, `testes-gabarito/kb.sh --comparar`, `testes-gabarito/base.sh --comparar` e `gabarito.ts --comparar --schemas-equivalentes` | 6 a 8 min |
| `executavel` | `macos-15` (arm64), `ubuntu-24.04` (x64), `windows-2025` (x64) | `pnpm mcp:executavel`; `sem-repositorio.test.ts`, `determinismo.test.ts` e `pasta-de-trabalho.test.ts` contra o executável; o executável como artefato `simplifica-mcp-<alvo>`, por 14 dias | 3 a 6 min cada |

O `testes-gabarito/banco.sh` fica fora do CI. Ele compara o `.dump` do `sqlite3`, e esse texto muda com o build do `sqlite3`, não com o banco: o 3.40 do Debian escreve `replace(…, char(10))` onde o 3.54 escreve `unistr(…)`, e o 3.54 do sqlite.org escreve `0` onde o da Apple escreve `0.0`. O banco compilado no Linux, despejado pelo `sqlite3` do macOS, é igual ao gabarito. Rode o `banco.sh` no macOS.

Para validar o workflow, use o `actionlint` (com o `shellcheck`, se houver): `actionlint` na raiz do repositório.
