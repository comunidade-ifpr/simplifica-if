# simplifica-mcp

Servidor MCP só de leitura que entrega a base de conhecimento do IFPR a qualquer IA (Claude, Codex, Gemini). É o MCP `ifpr` que o app Simplifica IF entrega a toda conversa (por HTTP local, dentro do `apps/server`) e também um executável à parte, para usar a base em apps de IA que a pessoa já tem ([guia de instalação](../../docs/guia-simplifica-mcp.md)). Ele lê apenas o `kb.sqlite`, em modo somente leitura: não recompila o banco, não procura o repositório e não acessa a rede. Cada resposta traz o texto literal, a proveniência (`path` e linhas no repositório de origem), o link `ifpr://` e a versão da base. Os mesmos links `ifpr://` também se leem como recursos MCP (M1.5, ver [Recursos `ifpr://`](#recursos-ifpr)).

Especificação original: o plano do M0.1 (`docs/plans/m0-simplifica-mcp.md`, no histórico do git); hoje o contrato de cada ferramenta é o Effect Schema de `src/ferramentas/`. Prontos os passos T0 (banco autossuficiente, no `packages/kb`), T1 (servidor, CLI, banco, envelope, links e texto), T2 (normas), T3 (PPCs e cursos), T4 (`pacote_contexto`) e T6 (suítes transversais e CI): as 16 ferramentas.

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
| 14 | `pacote_contexto` | contexto de uma tarefa da revisão de PPC para um PPC da base ou um `.md` da pasta de trabalho |
| 15 | `sobre_a_base` | versão, data da versão, dia da vigência e conteúdo da base |
| 16 | `etapa` | etapa da tarefa, para o app |

## Recursos `ifpr://`

Desde o M1.5, os links que as ferramentas devolvem são recursos MCP, no executável stdio e no servidor HTTP do app, sem mudar as ferramentas (`src/recursos/recursos.ts`). O `initialize` passa a anunciar a capacidade `resources`.

| Modelo de URI (`resources/templates/list`) | `resources/read` devolve | Leitura |
|---|---|---|
| `ifpr://norma/{+norma}{#dispositivo}` | sem dispositivo, a ficha da norma (vigência, relações, sucessoras, transições); com `#dispositivo`, só o dispositivo, com o caput herdado, os incisos e as notas | `ficha_norma`; `ler_dispositivos` com `filhos` |
| `ifpr://curso/{campus}/{curso}` | a ficha do curso | `ficha_curso` |
| `ifpr://ppc/{campus}/{curso}{/versao}{#secao}` | o PPC pela versão (o ano do documento, como em `ifpr://ppc/curitiba/tecnico-em-enfermagem/2023`); sem a versão, o PPC vigente do curso. Sem seção, o índice do PPC (fatos × SUAP e o link de cada seção, com as linhas); com `#secao`, o texto literal da seção (a seção longa vem no primeiro trecho, com o `cursor` para continuar em `ler_secao`) | `Leitura.lerPpc`; `ler_secao` |
| `ifpr://cnct/{slug}` | o curso no CNCT (eixo, área, carga horária, perfil, campo de atuação, CBO, infraestrutura, legislação, cada campo com a linha no JSON do catálogo) e os cursos do IFPR com a habilitação | `Leitura.lerCnct`, sobre `Cursos.cnct` do kb |
| `ifpr://campus/{campus}` | o campus e os cursos dele | `Leitura.lerCampus` |
| `ifpr://ficha/{ficha}` | pergunta, rubrica, evidências (com a linha no arquivo da ficha) e referências normativas de uma ficha da revisão de PPC | `Leitura.lerFicha`, sobre `FontesNormativas.conteudoRevisaoPpc` |

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
| `--vigencia-na-referencia` | desligada | calcula a vigência na `data_referencia` gravada na base, e não no dia (respostas que não mudam com o calendário) |

Um banco com `versao_esquema` diferente da esperada (`VERSAO_ESQUEMA` de `packages/kb/src/db/esquema.ts`) é recusado com "base incompatível com esta versão do simplifica-mcp; atualize".

## CLI `kb`

Dentro do checkout, as ferramentas são também a CLI `kb` (`pnpm kb`, ponto de entrada `src/kb.ts`): um comando por ferramenta (menos a `etapa`), com o nome em kebab-case, sobre o `tmp/kb.sqlite` recompilado quando está velho (`KB_SQLITE`, `KB_RECOMPILAR=nunca|sempre`). Os comandos são derivados da ferramenta em `src/consulta.ts`: a descrição dela, e um parâmetro por campo do JSON Schema de entrada (o do `tools/list`). O primeiro campo obrigatório é o argumento posicional (repetível quando é uma lista); os outros são flags com o nome do campo em kebab-case (`confianca_min` → `--confianca-min`): booleano liga com a flag, lista repete a flag, número e texto levam o valor. A conferência da entrada é a da ferramenta, com as mesmas mensagens.

```bash
pnpm kb buscar-norma "Resolução CNE/CP nº 2/2026, art. 28" --limite 5
pnpm kb ler-dispositivos "br/cne-cp/res/2026/2#art28" "br/cne-cp/res/2026/2#art71" --filhos
pnpm kb ficha-norma br/cne-cp/res/2021/1 --em 2026-11-01          # vigência, relações, sucessoras, transições
pnpm kb resolver-citacoes "Resolução CNE/CP nº 1/2021, art. 20" "Lei nº 9.394/1996, art. 36"
pnpm kb buscar-secoes "estágio obrigatório" --nivel médio --tipo estagio_praticas --tipo avaliacao
pnpm kb listar-cursos --campus curitiba --todas-as-paginas
pnpm kb pacote-contexto CT-CURR-12 --ppc curitiba/tecnico-em-enfermagem   # ou --arquivo PPC.md (do diretório atual)
pnpm kb <comando> --help
```

- **Saída:** o texto Markdown que a IA recebe; com `--json`, a `Resposta` inteira (o `structuredContent`) numa linha. Nas ferramentas paginadas, `--todas-as-paginas` segue o cursor e imprime todas as páginas (no JSON, uma por linha).
- **Erros:** entrada inválida, ID que não está na base e falha do banco saem como `kb: <mensagem>` no stderr, com código 1; um erro de uso (flag desconhecida, argumento que falta) imprime o erro do `effect/cli`, também com 1.
- **Curadoria:** `compilar`, `relacoes --propor`, `avaliar-resolvedor`, `avaliar-busca` e `fatos-a-revisar` ficam em `@simplifica-if/kb/cli` ([`packages/kb/README.md`](../kb/README.md#cli)) e entram na mesma CLI.

## Configuração fora do app

Para quem vai instalar, o passo a passo está no [guia de instalação](../../docs/guia-simplifica-mcp.md).

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
- **Atualização da base (opcional, M1.10):** com `--pasta-atualizacao <pasta>`, `--feed-atualizacao <url com {canal}>` e `--chave-atualizacao <linha base64 da chave pública>` (ou `SIMPLIFICA_ATUALIZACAO_PASTA`, `_FEED`, `_CHAVE`; canal em `--canal-atualizacao`, padrão `beta`), o servidor usa o mesmo mecanismo do app, só para a base (`src/atualizacao.ts`): na abertura, atende a troca pendente e abre a mais nova entre a baixada e a do `--banco` (que passa a ser opcional; sem base nenhuma, baixa antes de abrir), e confere o feed em segundo plano na abertura e a cada 24 h. A base nova entra na próxima vez que o cliente MCP iniciar o servidor. Fora do app não há política embutida: o feed e a chave vêm dos argumentos. Use uma pasta só do `simplifica-mcp`, nunca a do app (a trava `atualizacao.trava` impede dois processos de trocarem a base ao mesmo tempo, mas cada um adiaria o outro). A proxy vem de `HTTP_PROXY`, `HTTPS_PROXY` e `NO_PROXY`.
- **Caminho:** use caminhos absolutos no comando. O servidor expande `~/` nos próprios argumentos, mas nem todo cliente expande o `~` do nome do programa.

## Estrutura

O pacote é Effect 4 (`effect/ai`, `effect/rpc`, `effect/cli`), sem o SDK oficial do MCP em produção: o cliente do SDK (`@modelcontextprotocol/client`) fica só nos testes, como conferência independente do protocolo.

```
packages/mcp/
├── src/
│   ├── instrucoes.ts        # campo `instructions` do servidor MCP
│   ├── cli.ts               # effect/cli: --banco (ou SIMPLIFICA_KB), --pasta-trabalho, --canal; stdio
│   ├── kb.ts                # a CLI `kb` do checkout (pnpm kb): os comandos de consulta.ts e a curadoria do kb
│   ├── consulta.ts          # um comando por ferramenta, derivado do JSON Schema de entrada; imprimirConsulta
│   ├── servidor.ts          # McpServer.layerStdio, layerLeitura, layerRegistro, mensagens de abertura
│   ├── skills.ts            # export @simplifica-if/mcp/skills: o bloco `simplifica:` do SKILL.md e a leitura de uma pasta de skills
│   ├── tarefas.ts           # export @simplifica-if/mcp/tarefas: o manifesto de tarefa (`catalogo/tarefas/<id>.yaml`), a leitura da pasta e a do catálogo que vem pelo canal
│   ├── modulos.ts, publicos.ts, pedido.ts  # os módulos do app, o vocabulário de `publico` e os marcadores `{id}` do pedido (sem Node: a interface os importa)
│   ├── http.ts              # export @simplifica-if/mcp/http: o servidor HTTP local do app, com token por sessão
│   ├── SessaoAtual.ts       # a sessão da chamada (só no HTTP): rótulo e registro das chamadas
│   ├── documento.ts         # schemas do lerDocumento (o documento inteiro do leitor do app, M1.6)
│   ├── contratos.ts         # Effect Schema do envelope (Resposta, Aviso, Fonte, Página) e dos tipos comuns; erros
│   ├── esquema.ts           # construtores de schema (texto aparado, inteiro…) e o JSON Schema das ferramentas
│   ├── validacao.ts         # entrada inválida → mensagem em português para a IA
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
│   │   └── registrar.ts     # chamador (uma chamada de ferramenta) e registrarFerramentas, sobre McpServer.addTool
│   └── rpc.ts               # export @simplifica-if/mcp/rpc: GrupoLeitura (ferramentas e links ifpr://) e layerHandlersRpc
└── test/                    # fixtures com o DDL do kb; testes por ferramenta, equivalência, RPC, stdio
    └── transversal/         # suítes de todas as ferramentas: amostras.ts e os *.test.ts
```

Regras de negócio ficam em `packages/kb`; aqui ficam a validação de entrada, o envelope, o orçamento e a formatação. As ferramentas MCP, os recursos `ifpr://` e o RPC chamam o mesmo serviço `Leitura`, com os mesmos schemas.

## Uso pelo app

Pontos de entrada, sem curinga:

- `@simplifica-if/mcp/http` (M1.4): o servidor MCP dentro do processo do app, por HTTP em `127.0.0.1`. `layer({ banco, porta?, canal?, pastaTrabalho? })` dá o serviço `ServidorMcpHttp` com um `Leitura` próprio; `layerSobreLeitura({ porta?, pastaTrabalho? })` dá o mesmo serviço sobre o `Leitura` do ambiente, para quem já o tem (o `apps/server`, que o usa também no RPC de leitura, abre assim uma conexão só ao `kb.sqlite`). O serviço tem `url`, `porta`, `abrirSessao({ rotulo, pastaTrabalho? })` (um token por sessão, revogado no fim do `Scope`; a pasta da sessão vale mais que a da layer) e `chamadas` (cada chamada de ferramenta e cada leitura de recurso, com a sessão, a duração, se falhou e o começo do resultado em `resumo`, até 300 caracteres numa linha). A leitura de recurso vem com `tipo: "recurso"` e o URI pedido em `ferramenta` (`ifpr://cnct/tecnico-em-enfermagem`); na que falhou, o `resumo` é o começo da mensagem de erro. A chamada de ferramenta vem sem `tipo` (o padrão é `"ferramenta"`), como antes. O motor casa o `read_resource` do Antigravity (entrada `{ ServerName, Uri }`) com essa leitura pelo URI (`packages/motor/src/resultados.ts`). As defesas (`Host`, token em tempo constante, tamanho do corpo, `Origin`, protocolos) e o que veio do T3 estão no cabeçalho de `src/http.ts`. Para teste manual: `node packages/mcp/scripts/servir-http.ts --banco tmp/kb.sqlite`, que imprime a URL e o cabeçalho `Authorization` de uma sessão. O executável stdio não muda: o servidor HTTP do Node traz o `ws`, que o SEA não resolve;

- `@simplifica-if/mcp/grupo-leitura`: as definições do grupo RPC de leitura, sem a implementação (como o `packages/contracts` do T3): `GrupoLeitura`, `LinkLido`, `EntradaLink` os tipos do documento do leitor (`DadosDocumento`, `Ancora`) e os do Explorar (`DadosIndice`, `DadosBusca` e as linhas de cada coleção), e `ROTULOS_INDICADOR` (os nomes da adequação ao art. 71). É o que a interface do app importa, pelo `@simplifica-if/contratos-app`; o grafo dele não carrega o `kb`, o `Leitura` nem módulos do Node (`packages/contratos-app/test/sem-servidor.test.ts`). Por isso os schemas e o texto das ferramentas (`src/ferramentas/*.ts`, menos `registrar.ts` e `toolkit.ts`), `src/recursos/conteudos.ts`, `src/orcamento.ts` e `src/contratos.ts` não importam o `kb` em tempo de execução (só tipos) nem o `envelope.ts`;
- `@simplifica-if/mcp/rpc`: `layerHandlersRpc` (os handlers do `GrupoLeitura`) e `layerLeitura` (com `etapaRegistrada: true`, o do app, a ferramenta `etapa` responde que registrou a etapa). As operações das ferramentas (`fichaNorma`, `lerDispositivos`, `fichaCurso`, `lerSecao`, `listarCursos`, `sobreABase`), com a entrada e a resposta da ferramenta de mesmo nome; `lerLink({ link })`, para o leitor `ifpr://` da interface, que lê qualquer link pela resolução do `resources/read` e devolve o `LinkLido` (`tipo`, `resposta`, `texto`); e `lerPpc`, `lerCnct`, `lerCampus` e `lerFicha`, os conteúdos que só existem como recurso, com a mesma resposta que `lerLink` traz nesses tipos (os schemas `Entrada*` e `Saida*` de `src/recursos/conteudos.ts`). Link malformado ou que não está na base falha com `EntradaInvalida`, com a mensagem do `resources/read`. `lerDocumento({ link })` (M1.6, `src/documento.ts` e `src/leitura/documentos.ts`) é só do leitor do app, sem ferramenta MCP (o texto inteiro não cabe no orçamento da IA): para um link de norma da base ou de PPC, com ou sem fragmento, o Markdown inteiro do arquivo (`Normas.documento` e `Ppcs.documento` do kb, da tabela `documentos`) com o front matter em branco, para as linhas do texto serem as do arquivo, e as âncoras (os dispositivos da norma ou as seções do índice do PPC, com as linhas e o pai); o `alvo` é o fragmento pedido, se ele é uma das âncoras, e senão vem `null` com o aviso `nao-encontrado`. Norma sem texto na base (stub, externa), outro tipo de link e link malformado falham com `EntradaInvalida`. `compararNormas({ a, b })` (`src/comparar.ts` e `src/leitura/comparar.ts`) é o modo Comparar do app, também sem ferramenta MCP (a IA tem `correspondencia`): as duas normas lado a lado pela tabela de correspondência entre elas, em qualquer ordem (a origem da tabela fica à esquerda), uma linha por dispositivo da origem (`Normas.alinhamento`) com os trechos de cada lado e as palavras mudadas (`diferencaPalavras` do kb), os artigos novos do destino e a vigência das duas no dia da consulta (`Normas.vigencia`); a linha herdada vai com os textos inteiros, sem diferença; sem tabela, `EntradaInvalida`. `explorarIndice({})` e `explorarBuscar({ consulta, limite })` (`src/explorar.ts` e `src/leitura/explorar.ts`) são o Explorar do app, também sem ferramenta MCP (a IA já tem `buscar_norma`, `listar_cursos` e `buscar_secoes`, com o texto no orçamento dela): o índice traz as coleções inteiras (normas, cursos com CNCT, turnos e processos, PPCs, campi com calendário e horários, CNCT, fichas, processos seletivos e as reuniões do Consepe com documentos e itens de pauta; esquema 5), montado na primeira chamada e guardado; a busca devolve os resultados agrupados por tipo, com a citação resolvida (a regra do `buscar_norma`) no primeiro grupo, as coleções pequenas buscadas na memória (cada termo começa uma palavra, sem acento) e as seções dos PPCs pelo FTS (`Ppcs.buscarSecoesPorPrefixo`), e as `comparacoes` das normas achadas que têm tabela de correspondência (`Normas.comparaveis`). O `mcp` não consulta as tabelas do `kb.sqlite` direto: o índice, o leitor e o `sobre_a_base` saem de métodos dos serviços do kb (`Normas`, `Ppcs`, `Cursos`, `Conselhos`, `PacoteContexto`). `node packages/mcp/scripts/medir-explorar.ts` mede as consultas no `tmp/kb.sqlite` e falha acima de 200 ms;

- `@simplifica-if/mcp/skills`: o manifesto da skill do app, o bloco `simplifica:` do front matter do `SKILL.md` (`ManifestoSkill`: `ferramentas`, conferidas contra o Toolkit, `arquivos`, `etapas`, `versao` e `app_minimo` (X.Y.Z), `base_minima` (AAAA.MM.DD)), e `lerPastaSkills`. As skills do app moram em `catalogo/skills/`; skill sem o bloco não vai para o app. A leitura do servidor ignora campo desconhecido no bloco; a do `validar_base.ts` e a do build do desktop (`estrito`) o recusam (um campo do cartão, que é da tarefa, não passa em silêncio).
- `@simplifica-if/mcp/tarefas`: o manifesto da tarefa, o cartão do app (`ManifestoTarefa`, um `catalogo/tarefas/<id>.yaml` por tarefa), `lerPastaTarefas`, e o caminho do canal de atualização: `tarefasParaOCanal` (o que a fábrica põe no manifesto assinado) e `lerTarefasDoCanal` (o que o servidor lê do catálogo baixado, no mesmo modo tolerante). Obrigatórios: `id` (o nome do arquivo), `titulo`, `resumo`, `area`, `mantenedor` (`nome`, `github`), `situacao` (`experimental`, `estavel`, `descontinuada`) e a abertura, no campo `abre`, exatamente uma de:
  - `link: { url, requer_login }`: só `https`, sem usuário nem senha na URL;
  - `conversa: { skill?, pedido, entradas?, web? }`: o `pedido` cita as entradas por `{id}`, e todo `{id}` precisa existir em `entradas`; `web: false` desliga a busca e a leitura na web da sessão, e a `skill` é a única que a conversa da tarefa leva (o manifesto só restringe);
  - `modulo: <nome>`: um módulo do app (`@simplifica-if/mcp/modulos`, hoje só `revisao-ppc`). O schema aceita qualquer nome, para o catálogo de um app mais novo não quebrar num mais velho: quem recusa o módulo desconhecido é o `validar_base.ts`, e o servidor esconde a tarefa.

  Opcionais: `publico` (`@simplifica-if/mcp/publicos`), `limites`, `autoria`, `duracao_estimada`, `app_minimo` (X.Y.Z) e `base_minima` (AAAA.MM.DD), nos padrões de `@simplifica-if/atualizacao/manifesto`: versão malformada invalida o manifesto. A leitura do servidor ignora campo desconhecido; a do `validar_base.ts` e a do build do desktop (`estrito`) o recusam. `aberturaDe` devolve a abertura já separada pelo tipo; `conferirAbertura` é a regra "a skill e o módulo citados existem", a mesma para o servidor, o `validar_base.ts` e o build do desktop. Os marcadores `{id}` do pedido ficam em `@simplifica-if/mcp/pedido` (`RE_MARCADOR`, `marcadoresDoPedido`), que a interface também usa.

O registro é próprio (`addTool`), e não `McpServer.registerToolkit`, para que o `content` seja o texto Markdown e a entrada inválida volte como resultado `isError` com a mensagem em português, e não como erro `InvalidParams`.

## Manutenção

```bash
pnpm --filter @simplifica-if/mcp test
pnpm --filter @simplifica-if/mcp typecheck
pnpm fmt                             # na raiz: vp fmt no repositório inteiro
pnpm mcp:smoke                       # na raiz: as suítes transversais também na base real (tmp/kb.sqlite)
```

Protocolo: só as duas revisões atuais do MCP, `2026-07-28` (sem sessão; o Claude e o Antigravity a usam) e `2025-11-25` (o Codex 0.171 só a pede com a opção em desenvolvimento `mcp_2026_07_28`), em stdio e em HTTP (`PROTOCOLOS` em `src/servidor.ts`). As anteriores (`2025-06-18`, `2025-03-26`, `2024-11-05`) não são aceitas. Quando o Codex usar a `2026-07-28` por padrão, a `2025-11-25` sai.

## Suítes transversais

As suítes de `test/transversal/` cobrem todas as ferramentas de `FERRAMENTAS`, sem repetir os testes por ferramenta. Elas tiram as entradas de `amostras.ts`, indexado pelo nome da ferramenta: uma ferramenta nova sem amostra quebra o `typecheck` e os testes. Os comandos da CLI `kb` são as próprias ferramentas (`src/consulta.ts`); `test/consulta.test.ts` confere a derivação dos comandos.

| Suíte | O que confere | Fixture | Base real |
|---|---|---|---|
| `contrato.test.ts` | Toda ferramenta tem amostras. Pelo protocolo, a entrada válida passa no `inputSchema`, responde sem erro, e a saída passa no `outputSchema` (ajv) e no Effect Schema. A inválida volta `isError`, com a mensagem em português que começa pelo campo | sim | — |
| `base-real.test.ts` | As ferramentas umas contra as outras e contra o banco, sobre o banco do checkout (a camada da CLI `kb`): o texto integral de `buscar_secoes` é o de `ler_secao`; o `pacote_contexto` fica no teto, e o do PPC da base e o do mesmo PPC como arquivo trazem as mesmas fichas, normas, marcos e transições; as contagens de `sobre_a_base` são as linhas das tabelas | — | sim |
| `sem-repositorio.test.ts` | Todas as ferramentas numa pasta só com o `kb.sqlite` (diretório atual e `HOME`, com o `PATH` mínimo), com as respostas iguais às do processo de teste e a pasta intacta | sim | sim |
| `orcamento.test.ts` | Nenhum texto acima do teto da ferramenta. A paginação percorrida com o cursor tem mais de uma página e soma o total, sem repetir item | sim | sim |
| `pasta-de-trabalho.test.ts` | O `pacote_contexto` com `arquivo`, pelo servidor isolado: lê o `.md` de dentro da pasta (relativo, em subpasta e absoluto) e recusa `..`, caminho absoluto de fora e link simbólico para fora, antes de ler. A pasta fica como estava | sim | — |
| `descricoes.test.ts` | Pelo `tools/list`: título, descrição (até 600 caracteres) com a frase "Use quando…", parâmetros descritos e o tamanho do que vai ao modelo | sim | — |

- **Fixture e base real:** o `pnpm test` roda a parte da fixture, que não depende do `tmp/kb.sqlite`. O `pnpm mcp:smoke` roda as suítes inteiras com `SIMPLIFICA_SMOKE=1`; o `base-real.test.ts` recompila o banco se ele faltar ou estiver velho, como a CLI `kb`.
- **Amostras do `pacote_contexto`:** só com `ppc`. O `arquivo` depende da pasta de trabalho, e as suítes por amostra montam o `Leitura` sem ela; ele tem a suíte própria.
- **Sem repositório:** sem `SIMPLIFICA_MCP_EXE`, o servidor é o bundle do executável (`conferirBundle`), no Node com `--permission`. Ele só lê a pasta do banco e o próprio código, não escreve e não abre processos, e um controle negativo confere que ler fora da pasta é negado. Com `SIMPLIFICA_MCP_EXE`, o servidor é o executável, sem o modelo de permissões. Duas ressalvas:
  - o `realpath` em JavaScript do Node faz `lstat` dos diretórios ancestrais, e o modelo de permissões nega isso. Um gancho de pré-carga troca o `realpath` pelo nativo. O executável não aceita o gancho, e por isso roda sem `--permission`;
  - no Node 26.12, o `node:sqlite` abre arquivos sem passar pelo modelo de permissões. O isolamento do banco vem de a pasta só ter o `kb.sqlite`.
- **Contra o executável:**

  ```bash
  pnpm mcp:executavel
  cd packages/mcp && SIMPLIFICA_MCP_EXE=$PWD/dist-exe/simplifica-mcp \
    pnpm exec vp test run --config ../../vite.config.ts --dir . test/transversal/sem-repositorio.test.ts \
    test/transversal/pasta-de-trabalho.test.ts
  ```

## CI

O workflow `.github/workflows/ci.yml` roda em todo push e PR, sem segredos e sem acesso a sistemas com login. O preparo é o mesmo nos dois jobs (`.github/actions/preparar`): o Node de `.node-version`, o pnpm de `packageManager` pelo corepack (o corepack 0.36.0, instalado à parte), o cache do store do pnpm e `pnpm install --frozen-lockfile`.

| Job | Runner | Passos | Tempo estimado |
|---|---|---|---|
| `verificacao` | `ubuntu-24.04` | `pnpm fmt:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm kb compilar`, `pnpm mcp:smoke`, `validar_base.ts` (que confere também os arquivos gerados da base) | 6 a 8 min |
| `executavel` | `macos-15` (arm64), `ubuntu-24.04` (x64), `windows-2025` (x64) | `pnpm mcp:executavel`; `sem-repositorio.test.ts` e `pasta-de-trabalho.test.ts` contra o executável; o executável como artefato `simplifica-mcp-<alvo>`, por 14 dias | 3 a 6 min cada |

Para validar o workflow, use o `actionlint` (com o `shellcheck`, se houver): `actionlint` na raiz do repositório.
