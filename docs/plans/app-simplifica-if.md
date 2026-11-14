# Plano do app Simplifica IF

Situação em 14/11/2026. Planejamento detalhado até o Marco 2.

Este plano complementa o [PLANO-ARQUITETURA.md](../../PLANO-ARQUITETURA.md), que trata da base de conhecimento, do `packages/kb` e da CLI `kb`, o núcleo do app.

O [app-seguranca-dados.md](app-seguranca-dados.md) está suspenso. Ele guarda o desenho do acesso ao SUAP e ao SEI (credenciais, níveis de sensibilidade, garantias de retenção dos providers) para quando os sistemas voltarem ao escopo.

## Visão

O Simplifica IF é um app desktop que qualquer servidor do IFPR baixa e usa. Ele dá acesso a toda a base de conhecimento do Instituto e a tarefas prontas (skills) de cada área. O servidor conversa com a IA da própria assinatura (Claude, ChatGPT ou Gemini), e o app entrega a ela a base, as ferramentas e as regras.

O app não só responde perguntas. **A base vai até o servidor:** quando sai uma norma nova, muda um prazo ou o PPC de um curso diverge do SUAP, o app avisa quem é afetado e explica o que muda. Com isso, o servidor passa a saber o que antes só uma equipe central conseguia levantar.

Com dezenas de skills de todas as áreas, o app vira a porta de entrada única para o conhecimento do IFPR. Os sistemas institucionais (SUAP, SEI) ficam para depois do Marco 2.

## Decisões (13/11/2026)

1. **O servidor traz a própria assinatura de IA.** O IFPR não paga a IA neste horizonte.
2. **Horizonte de planejamento:** detalhado até o Marco 2.
3. **Piloto:** equipe da PROENS/DENS e coordenações de curso.
4. **Primeiro o cérebro, depois o corpo.** O Marco 0 entrega a base e as ferramentas como servidor MCP, usável em apps que já existem, antes do app próprio.
5. **O app é um fork fino do T3 Code** (licença MIT), num repositório separado.
6. **Sem SUAP e sem SEI até o Marco 2.** O app só trabalha com dados públicos: a base de conhecimento e os documentos que o servidor anexa. Assim, credenciais, níveis de sensibilidade, porteiro e verificação de ZDR saem do escopo. O desenho fica registrado em [app-seguranca-dados.md](app-seguranca-dados.md) para quando os sistemas voltarem.
7. **Stack única com o T3 Code (14/11/2026).** Este repositório migra para a stack do T3: Node, pnpm, Effect 4, Effect Schema e Vite+. O `kb` vira um serviço Effect importado pelo servidor do fork, e as ferramentas MCP viram um Toolkit de `effect/ai`. A regra de língua continua: português aqui; no fork, estrutura em inglês e domínio em português. Substitui a versão anterior desta decisão, do mesmo dia, que mantinha este repositório em Bun e sem Effect. Detalhes em [Tecnologia e língua do código](#tecnologia-e-língua-do-código); plano de migração em [consolidacao-stack-t3.md](consolidacao-stack-t3.md).

## Princípios

1. **Cérebro portátil, corpo fino.**
   - O valor está na base, nas ferramentas determinísticas e nas skills. Isso vira um servidor MCP e pacotes que funcionam em qualquer harness.
   - O app é a melhor experiência, não a única porta.
2. **Tarefa antes de chat.** Quem não sabe o que perguntar começa por um cartão de tarefa, com formulário curto, e não por uma caixa vazia.
3. **Toda afirmação a um clique da fonte.** Respostas trazem links `ifpr://`. O app abre a norma, o PPC ou o curso num painel, com o dispositivo destacado e o selo de vigência.
4. **A base funciona sem IA.** Buscar e navegar não gasta token e funciona offline. A IA entra para sintetizar e executar tarefas.
5. **A base vai até o servidor.** A detecção de novidades é determinística, calculada a partir dos pacotes e do perfil local. A IA só entra quando o servidor pede a explicação.
6. **Regras no núcleo, IA na ponta.** Cada servidor usa uma IA diferente. Quanto mais regra fica no `kb` (resolvedor, vigência, `pacote-contexto`), menos a resposta varia entre Claude, GPT e Gemini.
7. **Só dado público.** O app não busca nada em sistemas com login. O que chega à IA é a base pública e o que o próprio servidor anexa.
8. **Valem os princípios do PLANO-ARQUITETURA:**
   - o git é a fonte de verdade;
   - os builds são determinísticos;
   - nada inferido por LLM entra na base sem revisão humana;
   - cada fase se mede.

## Arquitetura

```
┌──────────── Simplifica IF (fork fino do T3 Code) ────────────┐
│  Modo Servidor (padrão)          │  Modo completo (curadores) │
│──────────────────────────────────────────────────────────────│
│  Servidor T3: conversas, providers, política, atualização    │
│   ├─ IA do servidor: Claude │ Codex (ChatGPT) │ Gemini       │
│   ├─ MCP `ifpr`: Toolkit do simplifica-mcp                   │
│   ├─ RPC de leitura: leitor, Explorar, "Para você"           │
│   └─ kb (serviços Effect): normas, PPCs, cursos, CNCT, fichas│
│  Pacotes locais: base (.sqlite) · skills                     │
└──────────────────────────────────────────────────────────────┘
  Fora do app: executável simplifica-mcp (stdio, Node SEA), com
  o mesmo Toolkit, para Claude Desktop, Codex e Gemini CLI
            ▲ manifesto assinado (canais beta e estável)
┌───────────┴──────── Fábrica (CI deste repositório) ──────────┐
│ git → valida → compila pacotes → avalia em 3 IAs → assina →   │
│ publica                                                       │
└──────────────────────────────────────────────────────────────┘
            ▲ feedback e propostas (com consentimento)
┌───────────┴──── Caixa da curadoria (backend mínimo) ─────────┐
│ "Isto está errado", "Propor norma", "Sugerir tarefa" → issue  │
│ ou PR para revisão humana                                     │
└──────────────────────────────────────────────────────────────┘
```

| Componente | Onde vive | Papel |
|---|---|---|
| App | repositório `simplifica-if-app`, fork do T3 Code | Interface, conversas, providers, política, atualização do app e dos pacotes. O servidor do app importa o `kb` e o `simplifica-mcp` |
| `kb` | `packages/kb` deste repositório | Serviços Effect com as regras e as consultas sobre o `kb.sqlite` |
| `simplifica-mcp` | `packages/mcp` deste repositório | Toolkit MCP e grupo RPC de leitura sobre o `kb`, montados no servidor do app; o mesmo Toolkit vira um executável stdio (Node SEA) por plataforma, para outros apps |
| Pacote da base | gerado pela fábrica a partir do git | `kb.sqlite` publicável, comprimido e assinado |
| Pacotes de skills | `.agents/skills/` | Skills com manifesto, versionadas e assinadas |
| Fábrica | CI deste repositório | Valida, compila, avalia, assina e publica |
| Caixa da curadoria | backend mínimo (a definir) | Recebe feedback e propostas e abre issue ou PR |

**Fronteiras**

- O app não lê o repositório, só os pacotes. Nada no computador do servidor depende de git, Python ou de um runtime instalado: o app leva o Node do Electron, e o executável stdio leva o próprio Node.
- Sem API local de leitura e sem processo paralelo. No app, o `kb` roda dentro do servidor do T3, e a interface lê por `effect/rpc`, com contratos em Effect Schema compartilhados.
- Fora do app, o mesmo Toolkit roda no executável stdio `simplifica-mcp`.
- Nem o app nem a IA falam com o SUAP ou o SEI. Os dados do SUAP que aparecem no app, como matrizes e cargas horárias, são os que a curadoria já publicou na base.
- Os links `ifpr://` são o contrato entre a resposta da IA e a interface. Funcionam com qualquer provider, porque são texto.

### Esquema `ifpr://`

Derivado dos IDs canônicos do PLANO-ARQUITETURA:

| Link | Abre |
|---|---|
| `ifpr://norma/br/cne-cp/res/2026/2#art28-xviii` | Leitor de normas no dispositivo, com vigência, relações e transições |
| `ifpr://curso/curitiba/tecnico-em-enfermagem` | Ficha do curso: PPC vigente, ofertas, CNCT, divergências PPC × SUAP, normas que o afetam |
| `ifpr://ppc/curitiba/tecnico-em-enfermagem#<secao>` | PPC convertido, na seção |
| `ifpr://cnct/tecnico-em-enfermagem` | Curso no CNCT |
| `ifpr://campus/curitiba` | Ficha do campus |
| `ifpr://ficha/CT-CURR-12` | Ficha da `revisar-ppc` |

As ferramentas do `simplifica-mcp` devolvem esses links prontos, e as instruções do servidor MCP pedem à IA que os use nas citações.

### Por que fork fino

O T3 Code teve 5.523 commits nos 30 dias anteriores a 13/11/2026. Um fork que altera o núcleo fica para trás em semanas. Regras:

- **O conjunto de patches é pequeno e listado:**
  1. marca: nome, ícones, identificador do app, pelo gancho `getAppBranding` que a ponte do desktop já tem;
  2. política de fábrica embutida: padrões e travas (ver Marco 1);
  3. registro do `simplifica-mcp` no servidor: o Toolkit em `apps/server/src/mcp/McpHttpServer.ts`, ao lado dos toolkits do T3, e o grupo RPC de leitura; o servidor MCP entra em toda sessão de provider;
  4. Modo Servidor: rotas e layout novos, sem alterar as telas existentes. As telas de desenvolvedor ficam escondidas por rota e pelo menu de configurações;
  5. painéis novos: leitor `ifpr://` e Explorar;
  6. português: catálogo pt-BR complementar e idioma padrão (ver [Interface em português](#interface-em-português)).
- **Código novo fica em diretórios novos.** Arquivos do T3 só mudam nos pontos de registro.
- **Tabelas próprias do fork ficam fora das migrações do T3.** O registro de migrações do T3 não tem faixa de IDs livre para forks (`docs/internals/legacy-orchestration-migration.md`). O que o fork guardar em SQLite usa uma tabela de migrações própria.
- **A base do fork é a última versão publicada do T3,** não o `main`. O CI refaz o rebase toda semana e avisa quando algum patch conflita.
- **Patch que cresce vira proposta ao T3** como recurso genérico. Exemplos: "servidores MCP da distribuição", "início com cartões de skills". O `CONTRIBUTING.md` do T3 só aceita correções de fora sem aprovação prévia; recurso novo começa por uma discussão com os mantenedores.

### Tecnologia e língua do código

Levantamento de 14/11/2026 no T3 Code `a6d9140972`.

**Stack única (decisão 7).** O fork tem de parecer código do T3, para que o rebase seja barato e os patches possam virar PRs no upstream. Este repositório passa a usar a mesma stack, porque o servidor do fork importa o `kb` e o `simplifica-mcp` como código, e não só como contrato.

| | `simplifica-if-app` (fork) | `simplifica-if` (este repositório) |
|---|---|---|
| Runtime e pacotes | Node 26, pnpm, Electron 44 | Node 26, pnpm; executável `simplifica-mcp` em Node SEA, como o `build:exe` do T3 |
| Núcleo | Effect 4 (hoje `effect@4.1.3`): serviços e Layers, Effect Schema, `effect/rpc`, `effect/ai` para MCP | o mesmo Effect, na mesma versão: serviços do `kb` sobre `effect/sql` e `node:sqlite`, Toolkit de `effect/ai`, `effect/cli` |
| Interface | React 19, TanStack Router, Tailwind 4, shadcn sobre Base UI, Effect atoms | — |
| Qualidade | Vite+ (`vp`), oxlint com o plugin do T3, oxfmt, `effect-tsgo`, vitest com `@effect/vitest` | as mesmas ferramentas; do plugin do T3, só as regras de Effect e de testes |
| Língua do código | inglês (identificadores, comentários, commits), domínio em português | português |
| Língua da interface | pt-BR pelo `gt-react` do T3 | textos das ferramentas MCP em português |

**Por que stack única:**

- **Código compartilhado, não só contrato.** O `kb` roda dentro do servidor do fork. Some a API local de leitura, e com ela um processo paralelo, uma porta HTTP e um segundo protocolo.
- **Um contrato só.** O mesmo Effect Schema gera o JSON Schema das ferramentas MCP e os tipos do RPC que o leitor, o Explorar e o "Para você" usam.
- **Uma caixa de ferramentas para os agentes.** As mesmas convenções (`docs/internals/effect-services.md` do T3), o mesmo lint e o mesmo `.repos/effect` nos dois repositórios.

**Como ficam as objeções de antes:**

- **Instabilidade do Effect 4** (`effect/ai`, `effect/sql`, `effect/cli`, `effect/rpc` marcados `@stability unstable`): uma versão só, fixada nos dois repositórios e atualizada junto com o rebase do fork.
- **Mensagens de validação em português:** um formatador pt-BR para os erros do Effect Schema substitui o `z.locales.ptBR()`.
- **Custo da migração:** quatro etapas (C0 a C3) com um gabarito byte a byte da CLI `kb` e do MCP. As regras puras do `kb` continuam funções puras. Ver [consolidacao-stack-t3.md](consolidacao-stack-t3.md).

**Regra de língua:**

1. **No fork,** código, comentários, commits e PRs ficam em inglês, no estilo do upstream, inclusive nos diretórios novos.
2. **Conceitos do IFPR mantêm o nome em português** também no fork, porque traduzir perde precisão: `norma`, `ppc`, `curso`, `campus`, `dispositivo`, `cnct`, `vigencia`. Exemplo: `useNormaReader`, `CursoSheet`, `PpcSectionLink`. A estrutura fica em inglês; o domínio, em português.
3. **Este repositório continua todo em português,** inclusive o `kb` e o `simplifica-mcp`, mesmo importados pelo fork. Nome, título e descrição das ferramentas são texto para a IA e aparecem na linha do tempo da conversa, então ficam em português e fora do catálogo de tradução do fork.

### Interface em português

O T3 Code já tem internacionalização: `gt-react` desde o PR [#31313](https://github.com/pingdotgg/t3code/pull/31313), de 12/11/2026.

- **Como funciona:** o texto em inglês é a chave (`<T>…</T>`, `gt("…")`). As traduções ficam em JSON por idioma em `apps/web/src/i18n/translations/` e são carregadas sob demanda, sem chamada a servidor externo. O que falta tradução aparece em inglês.
- **O que já existe em pt-BR:** 72 textos, todos das configurações (PR [#33161](https://github.com/pingdotgg/t3code/pull/33161)).
- **O que falta:** 3.000 a 4.000 textos no web, cerca de 66 itens no menu do Electron e cerca de 1.100 mensagens de erro no servidor.
- **Posição do upstream:** traduzir a interface inteira de uma vez depende de aprovação dos mantenedores (PR [#32192](https://github.com/pingdotgg/t3code/pull/32192), fechado). A proposta de migrar por área, em PRs pequenos, ainda espera resposta (discussão [#35259](https://github.com/pingdotgg/t3code/discussions/35259)).

**Estratégia: esconder a maior parte e traduzir só o que o servidor vê.**

1. **Mesma biblioteca do upstream, nenhuma segunda.** Outra biblioteca aumentaria o patch e nunca poderia subir para o T3.
2. **As telas novas do Modo Servidor** (Início, tarefas, leitor, Explorar, "Para você") são nossas. Elas já nascem com `gt-react`, com o texto em pt-BR no catálogo.
3. **Telas do T3 que o servidor vê:**
   - conversa, campo de mensagem e pedidos de aprovação (cerca de 310 textos);
   - lista de conversas;
   - boas-vindas e login;
   - configurações de provider, Geral, Aparência e Conversa;
   - avisos de atualização, menu do Electron e avisos de erro.

   Os textos ganham `gt-react` em PRs pequenos por área, enviados ao upstream. Enquanto não entram, ficam como patch nosso.
4. **Telas de desenvolvedor ficam escondidas, sem tradução:** diff, PRs, terminal, arquivos, worktrees, controle de versão, SSH e dispositivos, atalhos, diagnóstico, labs, segredos, navegador embutido e uso.
5. **Catálogo complementar** `pt-BR` no nosso repositório, mesclado ao do upstream em `loadTranslations`. É um patch de cerca de 10 linhas em `apps/web/src/i18n/initializeI18n.ts`.
6. **Português como padrão.** O idioma é uma configuração do cliente (`language` em `ClientSettingsSchema`, padrão `"en"`), e a política gerenciada não alcança configurações do cliente. Conferido em 14/11/2026. O fork muda o padrão para `"system"`, uma linha, e o Windows em português resolve para pt-BR. Essa mudança pode ser proposta ao upstream.
7. **Erros do servidor:** em vez de traduzir as mensagens no servidor do T3, o Modo Servidor traduz por tipo de erro no cliente. Assim, a explicação fica na língua de quem não é técnico.

## Experiência do servidor (Modo Servidor)

O T3 é organizado em pastas, git, terminal e logs de ferramenta. O Modo Servidor esconde isso. O Modo completo continua disponível para curadores e equipe técnica, e a política decide quem pode ativá-lo.

### Início

```
┌ Simplifica IF ─────────────────────────── Base de 12/11/2026 ✓ ┐
│  Coordenação de Curso · Campus Curitiba                        │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ O que você precisa hoje?                 [📎]  [Claude ▾] │ │
│  └──────────────────────────────────────────────────────────┘ │
│  Tarefas                                                       │
│  [Analisar um PPC] [Verificar calendário] [Conferir base legal]│
│  [Ver todas →]                                                 │
│                                                                │
│  Para você                                                     │
│  ● Nova DCN da EPT (Res. CNE/CP 2/2026). O PPC de Técnico em   │
│    Enfermagem cita a norma revogada. Prazo de adequação:       │
│    2 anos (art. 71), a partir da vigência.    [Ver o que muda] │
│                                                                │
│  Recentes: Análise PPC Enfermagem · Calendário 2027            │
└────────────────────────────────────────────────────────────────┘
```

- **Tarefas:** cartões gerados dos manifestos das skills e filtrados pelo perfil. "Ver todas" abre o catálogo por área.
- **Para você:** novidades que afetam o perfil (Marco 2). No Marco 1, mostra só as novidades gerais da base.

### Tarefa

Um cartão abre um formulário curto definido no manifesto da skill (arquivo, curso, ano), com uma frase do que vai acontecer e o tempo estimado. O formulário monta o pedido; o servidor pode editá-lo antes de enviar.

### Conversa

- **Etapas no lugar de logs.** A skill declara as etapas, e o app mostra o avanço. As chamadas de ferramenta ficam em "detalhes técnicos".

  ```
  Analisando PPC · Técnico em Enfermagem (Curitiba)
   ✓ Ler e preparar o documento
   ✓ Conferir carga horária com a matriz da base
   ◐ Verificar os critérios das fichas   ▓▓▓▓▓░░░░
   ○ Montar o parecer anotado          [detalhes técnicos]
  ```

- **Citações como chips.** Um link `ifpr://` vira um chip com o nome curto ("Res. CNE/CP 2/2026, art. 28, XVIII"). Ao clicar, o painel lateral abre a fonte.
- **Resultados como documentos.** O PPC anotado, o relatório do calendário e o parecer abrem num visualizador, com opção de exportar em PDF ou DOCX.
- **Avaliação.** Toda resposta tem 👍/👎 e "Isto está errado".
- **Desfazer.** Os checkpoints do T3 viram "Desfazer o que a IA fez nesta pasta".

### Pasta de trabalho

Cada conversa ganha uma pasta em `Documentos/Simplifica IF/<tarefa>/`. O servidor solta os arquivos ali e encontra ali os resultados. O git dos checkpoints fica oculto.

### Leitor e Explorar

- **Leitor:** painel lateral aberto por um link `ifpr://`. Mostra o texto literal, o dispositivo destacado, o selo de vigência (vigente, revogada, a confirmar), as relações, as regras de transição e "copiar citação". Lê do `kb` por `effect/rpc`, no próprio servidor do app, sem passar pela IA.
- **Explorar (Marco 2):** busca (`Ctrl/Cmd+K`) e navegação por normas, cursos, PPCs, campi e CNCT. É instantâneo, funciona offline e não gasta token. Cada página tem "Perguntar à IA sobre isto".

### Configurações do Modo Servidor

| Seção | Conteúdo |
|---|---|
| Sua IA | Conectar Claude, ChatGPT ou Gemini; o que vai para a IA conectada |
| Seu perfil | Campus, função e cursos. Fica só neste computador |
| Atualizações | Versões do app, da base e das skills; canal (estável ou beta) |

## Manifesto de skill

O `SKILL.md` continua no formato Agent Skills (`name`, `description`), que Claude, Codex e Antigravity já leem. O app precisa de mais campos, num bloco `simplifica:` do front matter:

```yaml
---
name: revisar-ppc
description: …
simplifica:
  titulo: Analisar um PPC
  resumo: Confere o PPC com as normas, o CNCT e a matriz publicada na base e gera um parecer anotado.
  area: ensino
  publico: [coordenacao-curso, pedagogia, dens]
  entradas:
    - { id: ppc, tipo: arquivo, aceita: [.docx, .md], rotulo: "PPC do curso" }
    - { id: curso, tipo: curso, rotulo: "Curso", opcional: true }
  etapas:
    - { id: preparar, rotulo: "Ler e preparar o documento" }
    - { id: matriz, rotulo: "Conferir carga horária com a matriz da base" }
    - { id: fichas, rotulo: "Verificar os critérios das fichas", progresso: true }
    - { id: parecer, rotulo: "Montar o parecer anotado" }
  ferramentas: [kb.pacote_contexto, kb.ppc_fatos]
  base_minima: 2026.11.01
  app_minimo: 0.1.0
  duracao_estimada: 20min
  donos: [proens/dens]
---
```

- **Regras do manifesto:**
  - `ferramentas` lista só ferramentas do `simplifica-mcp`. A skill no app não chama comandos do repositório;
  - skill que precise de SUAP, SEI ou outro sistema com login não entra no app. Ela continua no repositório, para os curadores;
  - `donos` vira entrada no CODEOWNERS.
- **Etapas:** a skill marca o avanço com uma ferramenta `etapa(id, progresso?)` do `simplifica-mcp`, que o app transforma no indicador de etapas.
- **Validação:** um Effect Schema valida o bloco no `validar_base.ts`.

## Atualização: três ritmos

| Camada | Frequência | Mecanismo |
|---|---|---|
| App | mensal | `electron-updater`, que o T3 já usa, com feed próprio na política (`limits.updates.feedUrl`) |
| Base | a cada poucos dias | o app (e, fora dele, o executável `simplifica-mcp`) confere o manifesto uma vez por dia e na abertura, baixa em segundo plano, confere assinatura e hash e troca o arquivo de uma vez |
| Skills | semanal | mesmo manifesto e mesmo mecanismo |

**Pacote da base**

- **v0: um pacote só,** o `kb.sqlite` publicável, comprimido com zstd. Em 13/11/2026 ele tinha 138 MB sem compressão e 34,7 MB com `zstd -19`. As seções de PPC e o índice de busca delas são cerca de 77% do arquivo.
- **Atualização por diferença:** como o build é determinístico, a fábrica publica também um patch `zstd --patch-from` a partir das últimas versões. O app baixa o patch quando tem a versão anterior e o pacote inteiro quando não tem. Dividir em vários pacotes por domínio só se a medição mostrar que o patch não basta.
- **Só fontes publicáveis.** `dados/arquivo-notion/` e tudo o que não for publicável fica fora. A fábrica falha se uma fonte não classificada entrar no pacote.
- **No computador do servidor, o pacote é só leitura.** O `kb` instalado não recompila nada e nunca procura arquivos do repositório. A proveniência (arquivo e linha no git) vem como metadado da resposta.
- **Toda resposta carimba a versão:** "base de 12/11/2026, commit `dc6b447`". Como o build é reproduzível, qualquer auditoria refaz o mesmo banco a partir do commit.

**Manifesto do canal** (`estavel.json` e `beta.json`, assinados com minisign; a chave pública vem embutida no app):

```json
{
  "canal": "estavel",
  "versao": "2026.11.13",
  "commit": "dc6b447",
  "base": {
    "arquivo": "base-2026.11.13.sqlite.zst",
    "sha256": "…",
    "bytes": 0,
    "patches": [{ "de": "2026.11.10", "arquivo": "base-2026.11.10-2026.11.13.patch.zst", "sha256": "…" }]
  },
  "skills": [{ "nome": "revisar-ppc", "versao": "1.4.0", "arquivo": "…", "sha256": "…", "app_minimo": "0.1.0", "base_minima": "2026.11.01" }],
  "app_minimo": "0.1.0"
}
```

**Canais**

- O piloto usa `beta`.
- A promoção para `estavel` é manual, depois de dias sem relato de erro confirmado.
- O servidor pode voltar para a versão anterior da base em "Atualizações".

**Novidades**

- `base-conhecimento/novidades.yaml` é um registro versionado e só de acréscimos, com o que mudou em cada versão: norma nova, revogação, alteração de vigência, PPC atualizado, curso novo.
- Um script propõe as entradas a partir da diferença entre versões, e a curadoria revisa o texto.
- A fábrica calcula, para cada entrada, quem ela afeta (`kb impacto`, `kb adequacao-art71`) e grava isso no pacote.

## Marcos

| Marco | Entrega | Para quem | Esforço | Depende de |
|---|---|---|---|---|
| 0 | Cérebro portátil: `simplifica-mcp`, pacote da base, skills portáteis, avaliação em 3 IAs | 3 a 5 pessoas da PROENS/DENS, em apps existentes | Médio | Fases 5 e 6 do PLANO-ARQUITETURA |
| 1 | App beta: fork fino, Modo Servidor, leitor, atualização, três skills | cerca de 20 pessoas: PROENS/DENS e coordenações de alguns campi | Alto | 0, trilha T3 (DOCX) |
| 2 | A base vai até o servidor: Explorar, "Para você", superpoderes, contribuição | piloto ampliado: coordenações de todos os campi | Médio a alto | 1 |

---

### Marco 0 — Cérebro portátil

**Objetivo.** A base e as ferramentas funcionam como servidor MCP, sem runtime instalado nem repositório, em apps que já existem (Claude Desktop, Claude Code, Codex, T3 Code). As mesmas perguntas recebem respostas tão boas quanto pela CLI nas três IAs.

**Entregas**

- **M0.1 — `packages/mcp`.** Uma casca fina sobre os comandos do `kb`. Hoje usa o SDK MCP 2.x com zod; na etapa C2 da [consolidação](consolidacao-stack-t3.md) vira um Toolkit de `effect/ai`, sem mudar o que a IA vê. É a fase 7 do PLANO-ARQUITETURA, que esperava um consumidor sem shell. Especificação detalhada: [m0-simplifica-mcp.md](m0-simplifica-mcp.md), com as 16 ferramentas e o banco que responde sem o repositório (T0). A lista abaixo é a proposta inicial; a especificação prevalece.
  - **Ferramentas de leitura**, todas com `readOnlyHint`:
    - `buscar_norma`, `dispositivo`, `vigencia`, `relacoes`, `correspondencia`;
    - `citacoes`, `impacto`, `adequacao`;
    - `buscar_secoes`, `cursos`, `ppc_fatos`;
    - `pacote_contexto`, `resolver`.
  - **Toda resposta traz** o texto literal, a proveniência, o link `ifpr://` e a versão da base.
  - **Instruções do servidor MCP:** a parte de consulta do `AGENTS.md` passa a viver num arquivo único, `packages/mcp/instrucoes.md`. As instruções do servidor saem dele, e o `AGENTS.md` aponta para ele. A parte de curadoria fica no `AGENTS.md`.
  - **Ferramenta `etapa`** para o indicador de etapas. Fora do app, ela não faz nada.
- **M0.2 — Executável.**
  - Node SEA, gerado por `vp pack` como o `build:exe` do T3, para macOS arm64 e x64, Windows x64 e Linux x64, sem Node nem Python instalados. O SQLite é o `node:sqlite` embutido no Node, sem módulo nativo. Entregue na etapa C0 da [consolidação](consolidacao-stack-t3.md).
  - **Modo pacote:** o executável lê um `kb.sqlite` informado, nunca recompila e não procura fontes.
  - **Assinatura de código:** Windows e macOS bloqueiam binários sem assinatura. Ver decisões em aberto.
- **M0.3 — Pacote da base.**
  - `pnpm kb pacote` gera o pacote publicável, o patch e o manifesto.
  - O CI confere que dois builds geram o mesmo hash, assina e publica no canal `beta`.
  - Medir o tamanho comprimido e o tamanho do patch entre versões vizinhas.
- **M0.4 — Skills portáteis.**
  - Bloco `simplifica:` no front matter das skills, com validação.
  - As skills passam a citar ferramentas MCP quando estiverem disponíveis e mantêm a CLI como alternativa dentro do repositório.
  - Primeiras skills: `verificar-fundamentacao-normativa`, `verificar-calendario` e `revisar-ppc` com entrada `.md`.
- **M0.5 — Avaliação em três IAs.**
  - O harness da fase 1 roda via MCP com Claude, GPT e Gemini, com o mesmo conjunto de perguntas.
  - Registra acerto, tokens e tempo por provider.
  - É a linha de base dos marcos seguintes.
- **M0.6 — Piloto zero.**
  - 3 a 5 pessoas da PROENS/DENS usam o `simplifica-mcp` no app que já têm.
  - As perguntas reais delas viram casos do conjunto de avaliação.

**Critério de aceite**

- O executável roda num computador limpo (macOS e Windows) e responde às ferramentas com o pacote baixado.
- Nas três IAs, o acerto via MCP é igual ou maior que via CLI, com menos tokens.
- Dois builds do pacote geram o mesmo hash, e o app rejeita um pacote com assinatura inválida.
- Uma pessoa do piloto zero instala e faz a primeira consulta em até 15 minutos, seguindo um guia de uma página.

---

### Marco 1 — App beta

**Objetivo.** Um servidor que não é técnico instala o app, conecta a própria IA e conclui as tarefas do piloto sem ajuda. A base se atualiza sozinha.

**Entregas**

- **M1.1 — Fork e sincronização.**
  - Repositório `simplifica-if-app` sobre a última versão publicada do T3, com a lista de patches da seção [Por que fork fino](#por-que-fork-fino).
  - CI de rebase semanal.
  - Identificador `br.edu.ifpr.simplifica`.
  - Stack e checagens do upstream sem mudança: `vp lint`, `vp fmt`, `effect-tsgo` e `vp test` rodam no CI do fork. Código novo em Effect, no padrão de `docs/internals/effect-services.md` do T3.
  - O fork consome `@simplifica-if/kb` e `@simplifica-if/mcp` como definido em [Decisões em aberto da consolidação](consolidacao-stack-t3.md#decisões-em-aberto), com a mesma versão do Effect.
- **M1.2 — Política de fábrica.** Padrões e travas embutidos no app. Ficam abaixo de uma política gerenciada pela DTI, se houver:
  - `limits.providers.allowedDrivers`: `claudeAgent`, `codex`, `antigravity`;
  - `limits.clients`: só `desktop`; `limits.connect`: desligado; `limits.telemetry`: desligado;
  - `limits.updates.feedUrl`: o feed próprio;
  - `maxRuntimeMode`: começa em `approval-required`, com as ferramentas de leitura do `simplifica-mcp` pré-aprovadas. O modo final se decide com o atrito medido no piloto.
- **M1.3 — Primeiro uso.**
  - **Boas-vindas em três passos:** conectar a IA, preencher o perfil (campus, função, cursos) e fazer uma tarefa de exemplo.
  - **Conectar a IA:** um botão por provider, reaproveitando a detecção e o login que o T3 já faz.
  - **Instalação das CLIs dos providers sem terminal:**
    - a do Codex é código aberto e pode ir junto com o app;
    - a do Claude Code e a do Antigravity se instalam pelo instalador oficial, chamado pelo app.
  - **Aviso de uso:** a IA conectada é a da conta pessoal do servidor, e o app só entrega a ela a base pública e o que o servidor anexar. O aviso pede que não se anexe documento com dado pessoal ou de acesso restrito.
- **M1.4 — Modo Servidor.** Início, tarefa, conversa com etapas, pasta de trabalho e "Desfazer". Terminal, diff, branches e PRs ficam escondidos.
- **M1.5 — Leitor `ifpr://`.** Painel nativo, que não depende do provider suportar MCP Apps (hoje só Codex e Claude suportam). Lê do `kb` por `effect/rpc`, pelo grupo de leitura de `@simplifica-if/mcp/rpc`, montado no servidor do app.
- **M1.6 — Atualização.** App, base e skills, nos três ritmos, com o aviso "Base atualizada", a lista de novidades e a opção de voltar uma versão.
- **M1.7 — Skills no app:**
  - `revisar-ppc`, com entrada `.docx`. Depende do passo T3 da trilha do PLANO-ARQUITETURA, a conversão DOCX em TypeScript, que vira pré-requisito deste marco;
  - `verificar-calendario`;
  - `verificar-fundamentacao-normativa`.

  Os resultados abrem no visualizador e podem ser exportados.
- **M1.8 — "Isto está errado".**
  - **Pacote do relato:** pergunta, resposta, citações, versões da base, da skill e do app, e provider.
  - **Consentimento:** o servidor vê exatamente o que será enviado antes de enviar e pode retirar trechos.
  - **Destino:** a caixa da curadoria abre uma issue.
- **M1.9 — Aviso ao anexar.** Um detector local procura nos arquivos anexados CPF, RG, telefone e e-mail fora do domínio institucional. Se achar, avisa antes do envio. Não bloqueia: PPCs e normas trazem nomes e cargos em atos oficiais, e a decisão é do servidor.
- **M1.10 — Interface em português.** Segue a seção [Interface em português](#interface-em-português):
  - idioma padrão `system`;
  - catálogo pt-BR complementar;
  - textos das telas visíveis do T3 envolvidos em `gt-react` e traduzidos;
  - erros traduzidos por tipo no cliente.

  Os PRs por área são abertos no upstream depois de consultar os mantenedores.

**Critério de aceite**

- **Instalação:**
  - cerca de 20 pessoas do piloto instalam sem suporte, ou com no máximo uma intervenção cada;
  - Windows e macOS cobertos. Supõe-se que a maioria dos computadores institucionais seja Windows; confirmar.
- **Tarefas:** cada pessoa conclui as três tarefas, e a avaliação de utilidade fica em pelo menos 4 de 5.
- **Atualização:** uma nova versão da base chega a 90% dos computadores ativos do piloto em até 48 horas.
- **Fontes:** em pelo menos 60% das conversas com resposta normativa, o servidor abre ao menos uma citação. É a medida de que a fonte está a um clique.
- **Fork:** o rebase semanal passa sem intervenção manual em pelo menos 3 de cada 4 semanas.
- **Português:** nenhum texto em inglês nas telas do Modo Servidor. Um teste de navegador percorre essas telas com o idioma pt-BR e falha se algum texto estiver sem tradução.

---

### Marco 2 — A base vai até o servidor

**Objetivo.** O app avisa cada servidor do que o afeta, permite explorar a base sem IA e recebe contribuições.

**Entregas**

- **M2.1 — Explorar.**
  - Busca `Ctrl/Cmd+K` e páginas de norma, curso, PPC, campus e CNCT.
  - A página do curso reúne o PPC vigente, as ofertas, o CNCT, as divergências entre o PPC e os dados do SUAP publicados na base (`kb ppc-fatos`), as normas que o afetam (`kb citacoes`, `kb impacto`) e os prazos.
  - Tudo vem do `kb` por `effect/rpc`, sem IA.
- **M2.2 — Motor "Para você".** Determinístico e local:
  - **Entradas:** `novidades.yaml` com os afetados já calculados, `transicoes.yaml` (prazos), divergências de `ppc-fatos` e o perfil local.
  - **Tipos de aviso:**
    - norma nova ou revogada que afeta curso do perfil;
    - prazo de adequação que se aproxima;
    - PPC do perfil divergente do SUAP;
    - PPC do perfil atualizado na base.
  - **Prazos "a confirmar"** aparecem assim, por exemplo, enquanto a data de publicação da Res. CNE/CP 2/2026 no DOU não estiver registrada.
  - **"Ver o que muda"** abre uma conversa com a skill `explicar-novidade`, nova, que usa `pacote_contexto` e cita as fontes. Só esse passo gasta token.
  - **Notificação do sistema operacional:** opcional, desligada por padrão.
- **M2.3 — Superpoderes.** Perguntas prontas por perfil, cada uma ligada a um comando do `kb`:

  | Pergunta | Base |
  |---|---|
  | Meu curso está adequado à nova DCN da EPT? | `adequacao`, `impacto`, `correspondencia` |
  | Onde o PPC do meu curso diverge do SUAP? | `ppc_fatos` |
  | Como outros campi escreveram a seção de acompanhamento de egressos? | `buscar_secoes` |
  | Que prazos normativos me afetam? | `vigencia`, transições |
  | Quais PPCs citam esta norma? | `citacoes` |
- **M2.4 — Contribuição.**
  - **"Propor norma":**
    - o servidor solta o PDF;
    - o agente converte seguindo o padrão de front matter, e o `simplifica-mcp` valida localmente com as regras do `validar_base`;
    - a proposta vai para a caixa da curadoria, que abre um PR.
  - **"Sugerir tarefa":** o servidor descreve o trabalho repetitivo, e a sugestão vai para a fila de skills da curadoria.
- **M2.5 — Piloto ampliado** para as coordenações de todos os campi, com suporte por um canal único e o relato pelo "Isto está errado".

**Critério de aceite**

- **"Para você":**
  - nenhum aviso falso nos casos de teste (afetados conferidos à mão para 3 novidades reais);
  - pelo menos 30% dos avisos abertos pelo piloto.
- **Explorar:** responde em menos de 200 ms por consulta no computador mais modesto do piloto.
- **Contribuição:** pelo menos uma norma proposta pelo app chega a `main` depois da revisão da curadoria.

---

## Trilhas e dependências

| Trilha | Marco 0 | Marco 1 | Marco 2 |
|---|---|---|---|
| Base e `kb` (PLANO-ARQUITETURA) | concluir fases 5 e 6; pacote publicável | T3 (DOCX em TS) | `novidades.yaml`; afetados por novidade |
| Stack ([consolidação](consolidacao-stack-t3.md)) | C0 (Node, executável SEA), C1 (`kb` em Effect), C2 e C3 | versão do Effect em sincronia com o fork | — |
| `simplifica-mcp` | ferramentas, executável, modo pacote | Toolkit e RPC de leitura no servidor do fork, atualização | validação local de norma |
| App (fork) | — | fork, política, Modo Servidor, leitor, interface em português | Explorar, "Para você", contribuição |
| Skills | manifesto, 3 skills portáteis | skills no app | `explicar-novidade` |
| Fábrica | CI do pacote, assinatura, canal beta | canais, promoção, feed do app | — |
| Curadoria | — | caixa da curadoria (issues) | propostas de norma (PRs) |
| Privacidade | — | aviso de uso, aviso ao anexar, consentimento no relato | — |
| Avaliação | 3 IAs via MCP | utilidade no piloto | explicações de novidades |

## Métricas do piloto

- Tarefas concluídas por pessoa e por semana.
- Tempo até a primeira resposta útil, contado da instalação.
- Proporção de respostas normativas com citação aberta.
- Relatos "Isto está errado" por 100 conversas e proporção confirmada pela curadoria.
- Tempo até 90% dos computadores receberem a nova versão da base.
- Avisos "Para você" mostrados, abertos e avaliados como úteis.
- Acerto e tokens por provider no conjunto de avaliação, por versão da base.

Só métricas agregadas e com opt-in saem do computador. O padrão é não enviar nada.

## Riscos

| Risco | Efeito | Mitigação |
|---|---|---|
| Ritmo do T3 | fork fica para trás | fork fino, base em versão publicada, rebase semanal, propor recursos ao T3 |
| Instalar a CLI do provider | servidor não técnico trava no primeiro passo | instalação pelo app, guia de uma página, piloto mede o atrito |
| Binário sem assinatura | Windows Defender e Gatekeeper bloqueiam | certificados de assinatura (decisão em aberto) |
| Computador institucional sem permissão de instalação | piloto não instala | instalador por usuário (NSIS per-user), conversa prévia com a DTI |
| Variação entre IAs | mesma tarefa, qualidade diferente | regras no `kb`, avaliação em 3 IAs como critério de publicação |
| Erro da base multiplicado | muitos servidores recebem a mesma resposta errada | canais beta e estável, "Isto está errado", selos "a confirmar" e "extraído" |
| Servidor anexa documento com dado pessoal | o dado vai para a IA da conta pessoal dele | aviso de uso, aviso ao anexar, termo de uso |
| Suporte | equipe pequena recebe muitas dúvidas | piloto por etapas, canal único, perguntas frequentes geradas dos relatos |
| Upstream não aceita os PRs de tradução | o patch de textos cresce e conflita no rebase | traduzir só as telas visíveis; esconder as demais; textos novos do upstream aparecem em inglês, sem quebrar |
| Mudanças incompatíveis no Effect 4 (`effect/ai`, `effect/sql`, `effect/cli`, `effect/rpc`, `effect/http` instáveis) | uma atualização quebra o fork e este repositório ao mesmo tempo | uma versão só, fixada no catalog dos dois repositórios e atualizada junto com o rebase do fork; `.repos/effect` na mesma tag; testes de protocolo MCP e gabarito da CLI `kb` em cada atualização |
| Migração de stack atrasa o Marco 0 | o piloto zero espera | o C0 entrega o executável primeiro; gabarito byte a byte em todas as etapas; C2 e C3 em paralelo |

## O que não fazer

- Não alterar o núcleo do T3 fora dos pontos de registro.
- Não incluir no app ferramenta ou skill que acesse SUAP, SEI ou outro sistema com login, nem pedir senha de sistema institucional.
- Não enviar para fora do computador perfil, conversa ou registro de acesso sem consentimento explícito.
- Não calcular "Para você" com LLM. A IA só explica.
- Não publicar pacote sem assinatura nem com fonte não publicável.

## Fora do escopo até o Marco 2

- Acesso a SUAP, SEI e outros sistemas com login, e qualquer dado não público. O desenho para quando voltarem está em [app-seguranca-dados.md](app-seguranca-dados.md). As skills `suap-ifpr` e `revisar-processo-ppc` continuam no repositório, para os curadores.
- Modelo local.
- Tarefas agendadas executadas pela IA. O "Para você" não precisa delas.
- App mobile. O mobile do T3 conecta no desktop, mas não faz parte do piloto.
- Contas de usuário e servidor central do Simplifica IF.
- `Movimentações de Cursos`.
- Rota de IA paga pelo IFPR.

## Decisões em aberto

1. **Assinatura de código:** quem obtém e guarda os certificados (Apple Developer ID e assinatura Windows), o IFPR ou o projeto?
2. **Hospedagem:** onde ficam os pacotes e o feed do app (GitHub Releases de um repositório público de distribuição, Cloudflare R2 ou servidor do IFPR)? O conteúdo é público; o repositório de origem é privado.
3. **Caixa da curadoria:** onde abre issue e PR (GitHub com um app do projeto) e quem faz a triagem.
4. **Nome e marca:** Simplifica IF dentro da identidade visual do IFPR (skill `ifpr-design`).
5. **Modo de permissão final** do Modo Servidor, a decidir com o atrito medido no piloto.
6. **Computadores do piloto:** sistema operacional, permissão de instalação e hardware.
7. **Aviso e termo de uso:** o texto que explica ao servidor o que vai para a IA conectada e o que não anexar. Vale uma revisão leve do encarregado de dados.
8. **Conversa com os mantenedores do T3** antes do M1.10: apoiar a discussão #35259 (tradução por área) e propor o padrão `"system"` para o idioma. Quem conduz?

## Andamento

- 13/11/2026: plano criado.
- 13/11/2026: SUAP e SEI retirados do escopo até o Marco 2. O app só trabalha com dados públicos.
- 13/11/2026: protótipos navegáveis de quatro telas (Início, Conversa com leitor, Para você, Ficha do curso), com dados reais da base. O usuário aprovou a direção em 14/11/2026.
- 14/11/2026: levantamento da stack do T3 Code. Decididos a regra de língua do código, a interface em português pelo `gt-react` e "sem Effect neste repositório no Marco 0" (decisão 7).
- 14/11/2026: decisão 7 revista. Este repositório consolida na stack do T3 (Node, pnpm, Effect 4, Vite+); o `kb` vira serviço Effect no servidor do fork, e some a API local de leitura. Plano em [consolidacao-stack-t3.md](consolidacao-stack-t3.md).
- 14/11/2026: **M1.0, prova de conceito do motor** (branch da worktree, sem merge). Em vez do fork, app próprio com motor fino sobre as interfaces oficiais: Agent SDK (Claude), `codex app-server` (ChatGPT) e `agy acp` (Gemini). `packages/motor` com o serviço `Motor`, eventos normalizados e um driver por provider; `packages/effect-acp` e `packages/effect-codex-app-server` copiados do T3, registrados em [upstream-t3.md](../upstream-t3.md). Os três responderam à pergunta do CNCT com as ferramentas `ifpr` e citaram `ifpr://`, e os três fizeram a ida e volta de aprovação (negar, depois permitir). Achados e lacunas em `packages/motor/README.md`.
