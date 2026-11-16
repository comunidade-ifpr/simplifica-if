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
5. **App próprio no monorepo, com a stack do T3 e código copiado com manifesto (revista em 14/11/2026).** O app vive neste repositório, ao lado do `kb` e do `simplifica-mcp`, com a stack do T3 Code tão próxima quanto possível, na interface e no backend. O código que vem do T3 é copiado e registrado em [upstream-t3.md](../upstream-t3.md), com origem, commit e adaptações. Substitui a versão de 13/11/2026, "fork fino do T3 Code num repositório separado". Motivo e opções descartadas em [Código do T3](#código-do-t3-copiar-registrar-sincronizar-sob-demanda).
6. **Sem SUAP e sem SEI até o Marco 2.** O app só trabalha com dados públicos: a base de conhecimento e os documentos que o servidor anexa. Assim, credenciais, níveis de sensibilidade, porteiro e verificação de ZDR saem do escopo. O desenho fica registrado em [app-seguranca-dados.md](app-seguranca-dados.md) para quando os sistemas voltarem.
7. **Stack única com o T3 Code, interface inclusive (14/11/2026).** O repositório inteiro usa a stack do T3: Node, pnpm, Effect 4, Effect Schema e Vite+ no backend e nas ferramentas; Electron, React, TanStack Router, Tailwind e shadcn sobre Base UI no app. O `kb` é um serviço Effect importado pelo servidor local do app, e as ferramentas MCP são um Toolkit de `effect/ai`. O código do app segue a regra de língua deste repositório: português. A migração do que já existia (C0 a C3) está concluída: [consolidacao-stack-t3.md](consolidacao-stack-t3.md). Detalhes em [Tecnologia e língua do código](#tecnologia-e-língua-do-código).

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
┌──────────── Simplifica IF (app Electron, este monorepo) ─────┐
│  Interface (React): Início, tarefas, conversa, leitor         │
│        │ effect/rpc sobre WebSocket (local)                   │
│  Servidor local (Effect)                                      │
│   ├─ Motor: sessões, eventos, aprovações, política            │
│   ├─ MCP `ifpr` por HTTP local: Toolkit do simplifica-mcp     │
│   ├─ RPC de leitura: leitor, Explorar, "Para você"            │
│   ├─ Persistência: conversas e eventos (effect/sql, SQLite)   │
│   └─ kb (serviços Effect): normas, PPCs, cursos, CNCT, fichas │
│  Pacotes locais: base (.sqlite) · skills                      │
└───────┬───────────────────────────────────────▲──────────────┘
        │ processo filho, conta do servidor     │ ferramentas pela
        ▼                                       │ URL do MCP local
  Providers (externos): Claude (Agent SDK + `claude`) │
  ChatGPT (`codex app-server`) │ Gemini (`agy acp`)

  Fora do app: executável simplifica-mcp (stdio, Node SEA), com
  o mesmo Toolkit, para Claude Desktop, Codex e Gemini CLI (Marco 0)
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
| App desktop | `apps/desktop` (proposta) | Processo principal do Electron, ponte `preload`, instalador, atualização do app |
| Interface | `apps/web` (proposta) | Telas do Modo Servidor; fala com o servidor local só por `effect/rpc` |
| Servidor local | `apps/server` (proposta) | Processo Effect iniciado pelo app: motor, MCP HTTP local, RPC de leitura, persistência, política, atualização da base e das skills |
| Motor | `packages/motor` | Serviço `Motor`: sessões, eventos normalizados, aprovações; um driver por provider. PoC em `main` (M1.0) |
| Providers | fora do app | CLIs e SDKs oficiais, com o login e a assinatura do servidor: `@anthropic-ai/claude-agent-sdk` com o `claude`, `codex app-server`, `agy acp` |
| `kb` | `packages/kb` | Serviços Effect com as regras e as consultas sobre o `kb.sqlite` |
| `simplifica-mcp` | `packages/mcp` | Toolkit MCP e grupo RPC de leitura sobre o `kb`. No app, o Toolkit é servido por HTTP local; fora dele, vira um executável stdio (Node SEA) por plataforma, para outros apps |
| Código copiado do T3 | onde for usado, registrado em [upstream-t3.md](../upstream-t3.md) | `effect-acp`, `effect-codex-app-server`, cliente SQLite, plugin de lint e, no M1, componentes do app |
| Pacote da base | gerado pela fábrica a partir do git | `kb.sqlite` publicável, comprimido e assinado |
| Pacotes de skills | `.agents/skills/` | Skills com manifesto, versionadas e assinadas |
| Fábrica | CI deste repositório | Valida, compila, avalia, assina e publica |
| Caixa da curadoria | backend mínimo (a definir) | Recebe feedback e propostas e abre issue ou PR |

**Fronteiras**

- O app não lê o repositório, só os pacotes. Nada no computador do servidor depende de git, Python ou de um runtime instalado: o app leva o Node do Electron, e o executável stdio leva o próprio Node.
- O app tem dois processos: o do Electron (com a interface) e o servidor local. Os processos dos providers são filhos do servidor local e morrem com a sessão.
- Sem API local de leitura separada. O `kb` roda dentro do servidor local, e a interface lê por `effect/rpc`, com contratos em Effect Schema compartilhados.
- **MCP HTTP local.** O servidor local serve o Toolkit `ifpr` em `127.0.0.1`, numa porta escolhida na abertura, com um token por sessão. O motor passa a URL e o cabeçalho a cada provider. Um processo, nenhum `simplifica-mcp` por sessão.
- Fora do app, o mesmo Toolkit roda no executável stdio `simplifica-mcp`, que continua servindo os outros apps (Marco 0).
- O app não usa o servidor do T3, o protocolo RPC dele nem o `t3 serve`.
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

Desde o M1.5, o `simplifica-mcp` serve os mesmos links também como recursos MCP (`resources/read`), no app e no executável stdio. Na PoC, o Antigravity tentou `read_resource` num link `ifpr://` que recebeu.

### Código do T3: copiar, registrar, sincronizar sob demanda

**Por que não fork.** Medido no T3 Code `a6d9140972`:

- o servidor e o web somam cerca de 610 mil linhas, com cerca de 4 mil commits por mês;
- os recursos de desenvolvedor estão entrelaçados na orquestração: `Orchestrator.ts` tem 16 mil linhas;
- os adaptadores de provider vivem dentro de `apps/server`, e não em pacotes: Claude com 43 mil linhas, Codex com 17 mil, Antigravity com 5 mil;
- não há mecanismo de marca própria.

O app precisa de uma fração disso. A PoC mostrou o tamanho: o motor tem cerca de 1.420 linhas para os três providers, contra 13,9 mil só no `ClaudeAdapterV2` do T3.

**Opções descartadas**

| Opção | Por que não |
|---|---|
| Fork e esconder o que não serve | custo de rebase sobre 4 mil commits por mês num núcleo entrelaçado |
| Copiar pacotes inteiros do T3 | os adaptadores de provider não estão em pacotes; copiar `apps/server` traz a orquestração junto |
| `t3 serve` como motor, sem cliente próprio | o protocolo RPC não é oficial e muda muito, os contratos são privados e não há como registrar o nosso MCP |

**Regras**

1. **Copia-se por parte, com motivo.** Um pacote, um arquivo ou um componente que resolve um problema que já temos. Cada parte entra na tabela de [upstream-t3.md](../upstream-t3.md) com a origem, o commit, a data e as adaptações.
2. **Atribuição MIT em cada parte:** `NOTICE` no pacote, cabeçalho no arquivo ou `LICENSE-T3` ao lado.
3. **Adaptação mínima e listada.** O que não precisa mudar fica igual, inclusive o inglês interno (ver [Regra de língua](#tecnologia-e-língua-do-código)). Pacotes iguais ao upstream ficam fora do `vp fmt` e do `vp lint` daqui.
4. **Sincronização caso a caso, não semanal.** `pnpm upstream:t3 status` lista as partes com mudança no upstream e `pnpm upstream:t3 diff <parte>` mostra o diff desde o commit registrado. Sincroniza-se quando há motivo: correção de segurança, defeito que nos afeta ou mudança no protocolo de um provider. O T3 acompanha as CLIs dos providers antes de nós; o `status` serve também de alarme.
5. **Inspiração sem cópia** fica listada à parte no manifesto, para quem mexer conferir o original.

**Candidatos para o M1** (cada um entra no manifesto quando for copiado):

- motor (porte em andamento no branch `t3/motor-porte-t3`): `CodexInstallation.ts` e `AntigravityInstallation.ts` (instalação gerenciada), `ClaudeExecutable.ts`, `ClaudeHome.ts`, `fixPath`, `antigravityAuthSupport.ts` e, se isolarmos o Codex, `CodexHomeLayout.ts`;
- shell do app: configuração do Electron e do `preload`, transporte `effect/rpc` sobre WebSocket, atualizador, componentes `ui/` do shadcn (estilo `base-mira`), campo de mensagem em Tiptap e renderização de Markdown;
- servidor: o padrão do `McpHttpServer.ts` para o MCP HTTP local.

### Tecnologia e língua do código

Levantamento de 14/11/2026 no T3 Code `a6d9140972` (`pnpm-workspace.yaml` e `apps/*/package.json`).

**Stack única (decisão 7).** O app usa a stack do T3, para copiar componentes sem traduzir de tecnologia e para que os agentes trabalhem com as mesmas convenções em todo o repositório. As versões entram fixas no catalog. Onde o T3 usa faixa (`^`), vale a versão resolvida no lockfile dele no momento da cópia.

| Camada | Peças | Versão no T3 `a6d9140972` |
|---|---|---|
| Base | Node | 26.12.1 |
| | pnpm, com catalog | 12.14.0 |
| | Vite+ (`vp`: oxlint, oxfmt, vitest, tsdown) | `vite-plus` 1.4.0 |
| | `effect-tsgo` | `@effect/tsgo` 0.67.1 |
| | knip | 6.34.0 |
| Backend | Effect 4: serviços e Layers, Effect Schema | `effect` 4.1.3; `@effect/platform-node` 4.1.2 |
| | `effect/rpc` sobre WebSocket entre a interface e o servidor local | `effect` |
| | `effect/http` | `effect` |
| | `effect/sql` sobre `node:sqlite`, migrações em Effect | `effect`; cliente copiado em `packages/kb/src/db/nodeSqliteClient.ts` |
| | `effect/ai` para MCP | `effect` |
| | `Config`, `Logger` e OTLP (`effect/observability`) | `effect` |
| | Node SEA | executável `simplifica-mcp` |
| | Agent SDK do Claude | `@anthropic-ai/claude-agent-sdk` 0.3.321 |
| Desktop | Electron | 44.10.1 |
| | electron-builder | 26.16.1 |
| | electron-updater | 6.8.9 |
| | ponte `preload` | — |
| Interface | React | 19.3.0 |
| | Vite | `vite` = `@voidzero-dev/vite-plus-core` 1.4.0 |
| | TanStack Router, rotas por arquivo | `@tanstack/react-router` ^1.160.2; `@tanstack/router-plugin` ^1.161.0 |
| | Effect atoms e zustand | `@effect/atom-react` 4.1.2; `zustand` ^5.0.11 |
| | Tailwind 4 | `tailwindcss` 4.3.3 |
| | shadcn sobre Base UI, estilo `base-mira` | `@base-ui/react` ^1.9.0; `class-variance-authority` ^0.7.1 |
| | ícones | `lucide-react` ^0.564.0 |
| | Markdown com GFM e fórmulas | `react-markdown` ^10.1.0; `remark-gfm` 4.0.1; `remark-math` 6.0.0; `katex` ^0.18.2 |
| | campo de mensagem | Tiptap 3 (`@tiptap/*` ^3.31.3) |
| | i18n | `gt-react` 11.4.18 no T3; aqui, não adotado (ver [Interface em português](#interface-em-português)) |
| Testes | vitest (dentro do Vite+) | 5.0.5 |
| | `@effect/vitest` | 4.1.2 (com o patch copiado do T3) |
| | testes de navegador | `@vitest/browser-playwright` 5.0.5; `playwright` 1.64.1 |

**Por que stack única:**

- **Código compartilhado, não só contrato.** O `kb` e o `simplifica-mcp` rodam dentro do servidor local. Não há API de leitura separada, nem um segundo protocolo.
- **Um contrato só.** O mesmo Effect Schema gera o JSON Schema das ferramentas MCP e os tipos do RPC que o leitor, o Explorar e o "Para você" usam.
- **Cópia barata.** Um componente do T3 entra sem trocar de biblioteca. O diff de sincronização mostra só o que mudou de fato.
- **Uma caixa de ferramentas para os agentes.** As mesmas convenções (`docs/internals/effect-services.md` do T3, resumidas em [consolidacao-stack-t3.md](consolidacao-stack-t3.md#convenções-effect-neste-repositório)), o mesmo lint e o mesmo `.repos/effect`.

**Instabilidade do Effect 4** (`effect/ai`, `effect/sql`, `effect/cli`, `effect/rpc`, `effect/http` marcados `@stability unstable`): uma versão só no catalog do monorepo, atualizada num PR com os gabaritos da CLI `kb` e do MCP. A versão acompanha a do T3 quando o código copiado depender dela, não automaticamente.

**Regra de língua:**

1. **O código do app segue o padrão deste repositório:** identificadores, comentários, mensagens e commits em português, com os nomes do domínio (`norma`, `ppc`, `curso`, `campus`, `dispositivo`, `cnct`, `vigencia`). Exemplo: `useLeitorNorma`, `FichaCurso`, `LinkSecaoPpc`. A API das bibliotecas é o que é.
2. **Componentes copiados do T3 mantêm o inglês interno de origem** (identificadores, comentários, nomes de arquivo), para que o diff de sincronização seja legível. O que muda na cópia é o texto visível ao usuário, traduzido para pt-BR, e isso fica registrado nas adaptações do manifesto.
3. **Nome, título e descrição das ferramentas MCP** são texto para a IA e aparecem na conversa: ficam em português, como hoje.

### Interface em português

Com app próprio, as telas são nossas e o texto já nasce em pt-BR. Não há catálogo do upstream a complementar, PR de tradução a negociar nem idioma padrão a mudar.

**`gt-react` (o i18n do T3) vale a pena?**

| | A favor | Contra |
|---|---|---|
| `gt-react` | os componentes copiados já vêm com `<T>` e `gt()`, e a cópia muda menos; uma versão multilíngue futura fica pronta | o texto-fonte é a chave em inglês: com pt-BR como única língua, cada texto teria a chave numa língua e a tradução noutra; mais uma ferramenta de build (`gt`), mais um catálogo e um teste de cobertura para manter |
| pt-BR direto | o texto está no componente, legível por quem revisa; nada a carregar nem a sincronizar | os componentes copiados mudam um pouco mais (os `<T>…</T>` viram texto em pt-BR); multilíngue no futuro exige extrair os textos |

**Recomendação: texto em pt-BR direto, sem `gt-react`.**

- Não há versão multilíngue no horizonte do Marco 2. Extrair textos depois é trabalho mecânico em poucos milhares de linhas nossas; não vale pagar o custo agora.
- Na cópia de um componente do T3, os textos visíveis são traduzidos no lugar e os envoltórios `<T>` e `gt()` saem. O manifesto registra "textos traduzidos para pt-BR" nas adaptações. Na sincronização, o diff do upstream mostra os textos novos, que se traduzem ao reaplicar.
- Datas, números e plurais pelo `Intl` com `pt-BR`; `lang="pt-BR"` no documento; menus do Electron em pt-BR.
- **Erros:** o servidor local traduz por tipo os erros que vêm dos providers (em inglês), para que a explicação fique na língua de quem não é técnico. Os erros nossos já nascem em português.
- **Garantia:** um teste de navegador percorre as telas e falha se aparecer algum dos textos em inglês substituídos na cópia (a lista sai da origem de cada componente copiado).

## Experiência do servidor (Modo Servidor)

O app é só o Modo Servidor: sem pastas de projeto, git, terminal nem logs de ferramenta à vista. Não há "Modo completo": curadores e equipe técnica continuam usando o repositório com Claude Code, Codex ou o próprio T3 Code. O nome fica para as telas e para as entregas.

### Início

```
┌ Simplifica IF ─────────────────────────── Base de 12/11/2026 ✓ ┐
│  Coordenação de Curso · Campus Curitiba                        │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ O que você precisa hoje?                 [📎]  [Claude ▾] │ │
│  └──────────────────────────────────────────────────────────┘ │
│  Tarefas                                                       │
│  [Analisar um PPC] [Conferir base legal]                       │
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
- **Resultados como documentos.** O PPC anotado e o parecer abrem num visualizador, com opção de exportar em PDF ou DOCX.
- **Avaliação.** Toda resposta tem 👍/👎 e "Isto está errado".
- **Desfazer.** "Desfazer o que a IA fez nesta pasta": o servidor local guarda uma cópia da pasta de trabalho antes de cada turno que pede escrita. O T3 usa checkpoints em git; aqui a pasta é pequena e o git ficaria oculto de qualquer jeito.

### Pasta de trabalho

Cada conversa ganha uma pasta em `Documentos/Simplifica IF/<tarefa>/`. O servidor solta os arquivos ali e encontra ali os resultados. O git dos checkpoints fica oculto.

### Leitor e Explorar

- **Leitor:** painel lateral aberto por um link `ifpr://`. Mostra o texto literal, o dispositivo destacado, o selo de vigência (vigente, revogada, a confirmar), as relações, as regras de transição e "copiar citação". Lê do `kb` por `effect/rpc`, no próprio servidor do app, sem passar pela IA.
- **Explorar (Marco 2):** busca (`Ctrl/Cmd+K`) e navegação por normas, cursos, PPCs, campi e CNCT. É instantâneo, funciona offline e não gasta token. Cada página tem "Perguntar à IA sobre isto".

### Configurações do Modo Servidor

| Seção | Conteúdo |
|---|---|
| Sua IA | Conectar Claude, ChatGPT ou Gemini; estado do login e da instalação; o que vai para a IA conectada |
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
  ferramentas: [pacote_contexto, fatos_ppc]
  arquivos: [fichas/indice.json, referencias/criterios.md]
  base_minima: 2026.11.01
  app_minimo: 0.1.0
  duracao_estimada: 20min
  donos: [proens/dens]
---
```

- **Regras do manifesto:**
  - `ferramentas` lista só ferramentas do `simplifica-mcp`, pelo nome do Toolkit (`buscar_norma`, `pacote_contexto`…). A skill no app não chama comandos do repositório;
  - `arquivos` lista, um a um, os arquivos da pasta da skill que vão para o app com o `SKILL.md`; `scripts/`, `tests/` e `agents/` nunca vão;
  - skill que precise de SUAP, SEI ou outro sistema com login não entra no app. Ela continua no repositório, para os curadores;
  - `donos` vira entrada no CODEOWNERS.
- **Etapas:** a skill marca o avanço com uma ferramenta `etapa(id, progresso?)` do `simplifica-mcp`, que o app transforma no indicador de etapas.
- **Validação:** um Effect Schema valida o bloco no `validar_base.ts`.
- **Feito em 16/11/2026:** o schema fica em `@simplifica-if/mcp/skills` (`ManifestoSkill`, `lerPastaSkills`), porque confere `ferramentas` contra o Toolkit; o `validar_base.ts`, o servidor e o build do desktop o importam. Obrigatórios por enquanto: `titulo`, `resumo`, `area`, `ferramentas` e `arquivos`; `publico`, `entradas`, `etapas`, `base_minima`, `app_minimo`, `duracao_estimada` e `donos` são opcionais até a interface e a atualização os usarem.

## Atualização: três ritmos

| Camada | Frequência | Mecanismo |
|---|---|---|
| App | mensal | `electron-updater`, como no T3, com o feed próprio definido na política de fábrica |
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
| 1 | App beta: app próprio com a stack do T3, motor de produção, Modo Servidor, leitor, atualização, três skills | cerca de 20 pessoas: PROENS/DENS e coordenações de alguns campi | Alto | 0, M1.0 (PoC do motor), trilha T3 (DOCX) |
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
  - Primeiras skills: `verificar-fundamentacao-normativa` e `revisar-ppc` com entrada `.md`.
  - **Andamento em 16/11/2026:** bloco e validação feitos (ver [Manifesto de skill](#manifesto-de-skill)). `verificar-fundamentacao-normativa` e `verificar-calendario` portáteis: o texto usa as ferramentas `ifpr` como caminho principal e a CLI `kb` e os scripts como alternativa dentro do repositório; no app, o calendário entrega só o relatório em Markdown (o PDF por script fica no repositório). Falta a `revisar-ppc` com entrada `.md`. Em 16/11/2026, a `verificar-calendario` foi apagada do repositório: deixou de ser necessária.
- **M0.5 — Avaliação em três IAs.**
  - O harness da fase 1 roda via MCP com Claude, GPT e Gemini, com o mesmo conjunto de perguntas.
  - Registra acerto, tokens e tempo por provider.
  - É a linha de base dos marcos seguintes.
  - **Andamento em 16/11/2026:** primeiro caso de skill do app, com e sem a skill: `pnpm avaliacao:skill` (`scripts/avaliar_skill.ts`, caso em `avaliacao/skills/verificar-fundamentacao-normativa/`, ver `avaliacao/README.md`). Roda pelo motor do app com o MCP `ifpr` por HTTP local, nos três providers; dois documentos sintéticos (minuta de PPC de Enfermagem e parecer de Informática integrado) com 12 alegações, 7 com erro plantado (artigo errado, "deve" onde a norma diz "pode", lei revogada como vigente, regra do estágio obrigatório generalizada, carga horária sem norma e errada, PPC de outro campus como obrigação, "obrigatório em todos"); pontuação por regex e por juiz (LLM, rubrica explícita). Rodado uma vez só com o Claude (assinatura, modelo padrão da conta); Codex e Antigravity prontos, não rodados.
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

**O que a PoC (M1.0) ensinou**

| Provider | Primeiro texto | Total | Observação |
|---|---|---|---|
| Claude | 14,7 s | 14,7 s | o texto parcial chega todo no fim |
| Codex | 2,5 s | 18,1 s | 267 mil tokens de entrada |
| Antigravity | 59,7 s | 66 s | o `agy` não manda o resultado das ferramentas |

Pergunta de referência: "carga horária mínima do Técnico em Enfermagem no CNCT". Os três usaram as ferramentas `ifpr`, citaram `ifpr://` e passaram na ida e volta de aprovação (negar, depois permitir). Cada provider recebe o MCP de um jeito:

- **Claude:** `mcpServers` stdio com `alwaysLoad: true` e `settingSources: []`;
- **Codex:** `mcp_servers` no `config` do `thread/start`, com os MCP e os conectores do usuário e a busca web desligados só naquela thread; o `cua_repl` continua;
- **Antigravity:** `mcpServers` no `session/new`, com caminho absoluto (o T3 passa `[]`).

Lacunas: MCP por HTTP local, recursos `ifpr://`, isolamento (`~/.codex` e `~/.gemini` do usuário), instalação e login das CLIs dentro do app, persistência e retomada, política de aprovação por tipo de ferramenta, e interromper, vários turnos e queda do processo sem teste real. Detalhes em `packages/motor/README.md`.

**Entregas**

- **M1.0 — PoC do motor.** Concluída, em `main`: `packages/motor` com os drivers de Claude, Codex e Antigravity.
- **M1.1 — App e shell.**
  - `apps/desktop` (Electron 44, `preload`, electron-builder), `apps/server` (servidor local em Effect, `effect/rpc` sobre WebSocket) e `apps/web` (React 19, TanStack Router com rotas por arquivo, Tailwind 4, shadcn sobre Base UI no estilo `base-mira`), na stack da [tabela](#tecnologia-e-língua-do-código).
  - As ferramentas do T3 no app: `vp lint`, `vp fmt`, `effect-tsgo`, `vp test`, testes de navegador e knip, no mesmo `pnpm fmt|lint|typecheck|test` da raiz.
  - Identificador `br.edu.ifpr.simplifica`, nome e ícones pela identidade do IFPR (skill `ifpr-design`).
  - Instaladores de Windows (NSIS por usuário) e macOS gerados no CI, ainda sem assinatura definitiva.
  - Cada parte copiada do T3 registrada em [upstream-t3.md](../upstream-t3.md).
  - **`apps/server` feito em 14/11/2026:** servidor local headless que junta o `Motor` (drivers reais), o MCP `ifpr` HTTP com um token por conversa e a API `effect/rpc` por WebSocket em `127.0.0.1` (grupos providers, conversa e leitura, contratos em `packages/contratos-app`), com o token do processo pai, `Host` e `Origin` conferidos e encerramento pelo SIGTERM ou pelo stdin fechado. Detalhes e pendências em `apps/server/README.md`.
  - **`apps/desktop` feito em 14/11/2026:** Electron 44 com preload (`window.simplifica`: `conexao`, `abrirExterno`, `escolherPasta`), `sandbox`, `contextIsolation`, CSP e protocolo `simplifica://app`; inicia o `apps/server` com um token pelo stdin, lê a linha de partida, encerra pelo stdin fechado (depois SIGTERM e SIGKILL) e oferece reiniciar quando o servidor cai. Empacotamento pelo electron-builder (`br.edu.ifpr.simplifica`; dmg e zip no macOS, NSIS por usuário no Windows), com o servidor em bundle rodando no Node do Electron e a ponte MCP como subcomando do bundle. Falta: assinatura de código e notarização, o ícone final pela identidade do IFPR e os instaladores no CI. Detalhes em `apps/desktop/README.md`.
  - **`apps/web` feito em 14/11/2026:** a interface React (TanStack Router, Tailwind 4, shadcn sobre Base UI, cores e Open Sans do IFPR, tema claro e escuro), ligada ao servidor por `effect/rpc` com ingresso e reconexão automática: Início com os três providers (detectar, instalar, entrar) e Conversa (texto parcial e final, ferramentas como etapas, aprovação, interromper, nova conversa, links `ifpr://` num painel lateral com o `lerLink`). Testes de unidade contra o `apps/server` com drivers de demonstração e de navegador no Chromium. Detalhes e pendências em `apps/web/README.md`.
- **M1.2 — Motor de produção.** O `Motor` da PoC dentro do servidor local, com:
  - persistência das conversas e dos eventos em `effect/sql` sobre `node:sqlite`, com migrações em Effect;
  - retomada depois de fechar o app, pelo mecanismo de cada provider (a confirmar por provider);
  - vários turnos, interromper e queda do processo do provider, com teste real nos três;
  - aprovações por tipo de ferramenta, segundo a política (M1.7);
  - texto parcial do Claude chegando aos poucos, e não só no fim;
  - medida e redução do contexto do Codex (267 mil tokens de entrada na pergunta de referência);
  - as skills chegam ao provider pelo motor (instruções da sessão e arquivos na pasta de trabalho), porque `settingSources: []` e o isolamento deixam de fora as skills do usuário.
  - **Feito em 15/11/2026** (detalhes em `apps/server/README.md` e `packages/motor/README.md`):
    - conversas gravadas em `effect/sql` sobre `node:sqlite` (`conversas.sqlite` na pasta de estado, migrações em Effect como as do T3), com id próprio e independentes da conexão; a interface lista as conversas, reabre pela URL e, ao recarregar, volta a acompanhar a resposta em andamento;
    - retomada nativa nos três (`resume` no Claude, `thread/resume` no Codex, `session/load` no `agy`), com recomeço pelo histórico gravado se o provider não retomar; sessão liberada depois de 30 minutos ociosa, como no T3;
    - queda do processo do provider vira `Erro` e `FimTurno` e a conversa `caiu`, reaberta pela próxima mensagem; interromper com prazo;
    - texto parcial do Claude pelos `stream_event`: funciona, mas na pergunta de referência o primeiro pedaço chega junto com o resto (cerca de 14 s), porque o modelo redige no raciocínio oculto;
    - contexto do Codex cortado por thread (`CONTEXTO_CODEX` e o isolamento de skills, hooks e `AGENTS.md`): um turno sem ferramenta abaixo de 12 mil tokens de entrada, contra 14 mil antes;
    - skills do app pelo motor (`.simplifica/skills/` na pasta e instruções da sessão);
    - teste real do ciclo (`apps/server/test/ciclo-real.test.ts`) com o Claude: três turnos, escrita fora da pasta negada pela política, interromper, retomada depois de fechar e depois de SIGKILL, tudo verde.
  - **Critério fechado nos três providers em 16/11/2026.** O `ciclo-real` passou também no Codex (codex-cli 0.169.0, plano free, 27 s) e no Antigravity (`agy` 1.5.9, 92 s), com retomada nativa nas duas vezes (`thread/resume`; `session/load`, que o `agy` 1.5.9 anuncia), a escrita fora da pasta negada sem pergunta e o turno da queda fechado logo depois do SIGKILL. Turnos simples: Codex de 1 a 3 s, Antigravity de 4 a 10 s; o turno com a ferramenta `ifpr` levou 6 s no Codex e 21 s no Antigravity. Achados:
    - a queda do Codex chegava à interface com a mensagem do transporte em inglês; agora sai como a do `agy` ("o processo do codex encerrou");
    - no Antigravity, depois que a política nega a escrita, o modelo encerra o turno sem texto: a conversa mostra só a ferramenta que falhou. É comportamento do `agy`, e não do motor.
  - **Contexto do Codex na pergunta de referência:** 136,6 mil tokens de entrada no turno (98,4 mil em cache; três requisições ao modelo, com `listar_cursos` e `ficha_curso`), contra 267 mil na PoC, cerca de metade. O uso é o total do turno, que soma a entrada de cada requisição, e por isso cresce com o número de ferramentas; um turno sem ferramenta fica abaixo de 12 mil.
- **M1.3 — Providers no computador do servidor.**
  - **Detecção** de instalação, versão, login e plano, como o `--detectar` da PoC (cerca de 4 s para os três).
  - **Instalação e login copiados do T3, não escritos do zero.** O porte está em andamento no branch `t3/motor-porte-t3`, com registro em [upstream-t3.md](../upstream-t3.md).
  - **Codex e Antigravity: instalação gerenciada** (`CodexInstallation.ts`, `AntigravityInstallation.ts`):
    - o app baixa a própria cópia da CLI e confere o sha256;
    - instala por staging e registra a versão ativa em `active.json`;
    - verifica atualização de hora em hora;
    - usa a CLI do usuário quando ela já está instalada.
  - **Claude: passo guiado.** O T3 não instala a CLI do Claude, só a atualiza (`ClaudeMaintenance`). O servidor instala a CLI pelo instalador oficial e faz o login, com o passo a passo na tela de boas-vindas (M1.8); o app detecta quando terminou.
  - **Login** pelo fluxo oficial de cada CLI, com o apoio do T3 (`antigravityAuthSupport.ts` no Antigravity).
  - **Ambiente:** `ClaudeExecutable` (localiza o `claude`), `ClaudeHome` (ambiente da sessão; avisa quando há um `managed-mcp.json` da organização) e o `fixPath` do T3, porque o app aberto pelo Finder herda um PATH mínimo e não acha as CLIs.
  - **Isolamento:** a sessão do app não vê MCP, conectores, hooks nem configurações do usuário. Se o Codex ganhar uma pasta própria, copiar também `CodexHomeLayout.ts` (decisão em aberto 8).
- **M1.4 — MCP HTTP local.**
  - O servidor local serve `FerramentasIfpr` por `McpServer.layerHttp` em `127.0.0.1`, porta escolhida na abertura.
  - **Por que HTTP no processo do app, e não stdio por sessão:**
    1. uma instância e uma conexão ao `kb.sqlite` para todas as sessões, sem processo Node por conversa;
    2. o app vê cada chamada de ferramenta no próprio processo, o que alimenta o leitor, o "Para você" e as métricas;
    3. escopo por sessão pelo cabeçalho `Authorization`, com um token por sessão;
    4. uma configuração para os três providers: `type: "http"` no Claude (`mcpServers`), `url` com `http_headers` no Codex (`mcp_servers.ifpr`) e HTTP no ACP do Antigravity (`mcpCapabilities.http`);
    5. ferramentas ligadas à interface, como abrir um link no leitor; a `etapa` alimenta o indicador de etapas da conversa.
  - A ponte `createSdkMcpServer` do Claude fica descartada: pede Zod e só serviria a ele.
  - **Feito em 14/11/2026** (`@simplifica-if/mcp/http`), com teste real nos três providers:
    - **Claude:** `mcpServers` com `type: "http"`.
    - **Codex:** `mcp_servers.ifpr.url` com `http_headers`, por thread.
    - **Antigravity:** o `agy` 1.5.9 não anuncia `mcpCapabilities.http`. Como o T3 faz com agentes ACP nessa situação, o MCP vai como stdio pela ponte `AcpMcpStdioBridge` do T3, que repassa ao servidor HTTP local; a URL e o token vão no `env` do servidor, nunca na linha de comando. Se uma versão futura anunciar HTTP, o driver passa a usar HTTP sozinho.
    - O servidor escuta só em `127.0.0.1`, com porta escolhida na abertura e um token por sessão, revogado no fim da sessão. Ele confere `Host`, recusa `Origin`, limita o corpo a 1 MiB, aceita uma pasta de trabalho por sessão e entrega ao app cada chamada de ferramenta.
    - O stdio por sessão continua no motor como alternativa (`--mcp stdio` no harness).
    - **No app:** a ponte vira um subcomando do próprio executável, como o `acp-mcp-bridge` do T3. O empacotamento do servidor HTTP precisa marcar como externos os opcionais do `ws` (`bufferutil`, `utf-8-validate`).
- **M1.5 — Recursos `ifpr://` no MCP.** O `simplifica-mcp` lista e lê os links `ifpr://` como recursos (`resources/read`, com modelos de URI), no app e no executável stdio, sem mudar as ferramentas.
  - **Feito em 14/11/2026:** seis modelos de URI (norma com `#dispositivo`, curso, PPC com `#secao`, CNCT, campus, ficha) em `resources/templates/list`; `resources/read` em Markdown, com o texto e o envelope das ferramentas (o dispositivo e a seção devolvem só o trecho); `resources/list` com as normas centrais e os campi; link inválido como `InvalidParams` em português. Detalhes em `packages/mcp/README.md`.
- **M1.6 — Leitor `ifpr://`.** Painel nativo, que não depende do provider suportar MCP Apps. Lê do `kb` pelo grupo `GrupoLeitura` de `@simplifica-if/mcp/rpc`, por `effect/rpc`, sem passar pela IA.

  **Formato dos documentos (decisão de 16/11/2026):** a base continua em Markdown, que é a fonte única e editável; HTML e XML não são gravados em `base-conhecimento/`. Medido em normas e PPCs reais: HTML custa de 15% a 25% mais tokens que o Markdown (tabelas, 80%), e LexML ou Akoma Ntoso, de 30% a 45%. A estrutura extra não melhora a citação, que já chega pronta do `kb` pelo MCP: dispositivo, caminho, caput, arquivo e linha. O leitor gera o HTML na hora de exibir, a partir da mesma árvore `remark` que o `kb` usa (`packages/kb/src/normas/estrutura.ts`):
  - um plugin `rehype` põe o `id` de cada dispositivo (`art28-xviii`) e o destaque do trecho citado (`<mark>`);
  - os selos de vigência são componentes React;
  - só entra `react-markdown`, sem `rehype-raw` nem `innerHTML`, porque o PPC é entrada não confiável.

  Os PPCs usam o mesmo componente, ancorado nas seções do índice. Impressão e exportação saem desse HTML derivado, com CSS de impressão. Fica opcional um campo `urn_lexml` no front matter das normas federais, como identificador estável fora do projeto. Para a IA, as tabelas podem ir como texto tabulado (TSV), cerca de 15% mais curto que a tabela GFM.
- **M1.7 — Política de fábrica.** Ver [Política de fábrica](#política-de-fábrica) abaixo. **Versão mínima feita em 15/11/2026**, no motor (`packages/motor/src/politica.ts`), aplicada nos três drivers: cada pedido nativo se classifica por tipo de ferramenta e lugar; `ifpr` passa sem perguntar, escrita e comandos perguntam dentro da pasta de trabalho e se negam fora, leitura fora da pasta, outros MCP e web se negam; telemetria desligada nos três. Falta o atributo de atualização (feed, canal e chave minisign), que vem com o M1.10.
- **M1.8 — Primeiro uso.**
  - **Boas-vindas em três passos:** conectar a IA (M1.3), preencher o perfil (campus, função, cursos) e fazer uma tarefa de exemplo.
  - **Conectar a IA:** Codex e Antigravity se instalam sozinhos, e o servidor só faz o login. Para o Claude, um passo guiado: instalar a CLI pelo instalador oficial, fazer o login e voltar ao app, que confere e segue.
  - **Aviso de uso:** a IA conectada é a da conta pessoal do servidor, e o app só entrega a ela a base pública e o que o servidor anexar. O aviso pede que não se anexe documento com dado pessoal ou de acesso restrito.
- **M1.9 — Modo Servidor.** Início, tarefa, conversa com etapas, pasta de trabalho e "Desfazer".
- **M1.10 — Atualização.** App, base e skills, nos três ritmos, com o aviso "Base atualizada", a lista de novidades e a opção de voltar uma versão.
- **M1.11 — Skills no app:**
  - `revisar-ppc`, com entrada `.docx`. O pré-requisito, a conversão DOCX em TypeScript (passo T3 do PLANO-ARQUITETURA), está em `main` desde 16/11/2026, mas **a skill ainda não roda no app**. O que existe: a conversão em dois pacotes do workspace que o servidor pode importar, `@simplifica-if/docx` (leitor OOXML, com limites contra arquivo hostil) e `@simplifica-if/ppc` (conversão do PPC), só com Node, sem Python, MS Word ou poppler; o fluxograma desenhado com formas do Word vira um aviso no `PPC.md`. O que falta, neste marco:
    - o servidor chamar a conversão: a CLI da skill importa os pacotes do `node_modules` do repositório, e o app leva a skill só com os arquivos de `simplifica.arquivos`. A preparação do documento passa a ser uma ferramenta do servidor (ou a CLI vai empacotada com ele);
    - rodar a conversão num `Worker`, porque ela é síncrona, mantém a árvore do XML na memória e não pode bloquear o laço de eventos do servidor. Limites recomendados, medidos em 16/11/2026: `resourceLimits: { maxOldGenerationSizeMb: 512 }` (o pior caso honesto dentro dos limites do leitor converte com esse heap, em 1,5 s e com cerca de 690 MB de memória residente; um PPC típico usa cerca de 150 MB) e tempo máximo de 30 s, com `worker.terminate()` no estouro. O limite de tempo é a defesa final: os tetos do leitor e da conversão barram os casos conhecidos, não toda entrada patológica;
    - recusar o arquivo de mais de 20 MB antes de ler (`lerArquivoDocx` confere o tamanho; os PPCs reais têm de 0,7 a 7,3 MB) e mostrar ao servidor a mensagem do `ErroDocx` (arquivo grande demais, com a orientação de compactar as imagens; protegido por senha; corrompido; sem texto). Os limites ficam em `packages/docx/src/limites.ts` (arquivo, partes do ZIP, XML, tabelas) e em `packages/ppc/src/conversao-docx/orcamento.ts` (texto do documento), descritos nos READMEs do `packages/docx` e da skill;
    - os demais scripts da skill (grupos, prompts, relatório) no mesmo caminho;
    - **a tarefa "Analisar um PPC" (decisão de 16/11/2026).** Três propostas, cada uma com prova de conceito medida, ficam como registro em [`propostas/`](propostas/): [A](propostas/m1-11-revisao-ppc-A.md) (revisão orquestrada pelo servidor; PoC só na branch `t3/revisao-ppc-orquestrada-app`, em `apps/server/src/revisao-ppc/julgamento.ts` e `apps/server/scripts/poc-revisao-ppc.ts`), [B](propostas/m1-11-revisao-ppc-B.md) (roteiro conversacional com lista de pendências; PoC só na branch `t3/revisao-ppc-conversacional`, em `apps/server/src/revisao-ppc/parada.ts` e `apps/server/scripts/poc-revisao-ppc-conversa.ts`) e [C](propostas/m1-11-revisao-ppc-C.md) (código primeiro, DOCX da pessoa de volta com comentários). **Aprovada a síntese descrita em C (seção 9):**
      1. **porta de entrada: a pré-conferência em código, sem IA** (`packages/ppc/src/pre-conferencia.ts`, 20 ms por PPC nos 110 PPCs técnicos da base), exportável já no primeiro minuto;
      2. **ordem e vocabulário de B:** temas na ordem do parecer da PROENS, modos "o que mais devolve" (rápido) e completo, lista de pendências com resolvidas e discordâncias;
      3. **execução de A, com recortes finos:** o servidor orquestra sessões curtas sem ferramentas e confere o JSON em código; fichas S em lotes de trechos, fichas J numa sessão por tema com as seções do tema, as transversais sobre resumos;
      4. **a conversa de B é opcional, dentro de cada pendência** ("Já está certo…", "Sugerir texto"), sobre o cache da sessão do tema;
      5. **entrega: o DOCX da pessoa com comentários do Word ancorados nos trechos** (`packages/docx/src/comentarios.ts`) e a lista ao lado; o HTML de hoje fica como visão opcional.

      **Classificação das 80 fichas** (anexo de C), que vira dado nas fichas (campo `execucao`), para mover uma ficha de J para S ou D ser edição versionada com a precisão medida na base: **12 D** (só código), **38 S** (código acha o trecho, a IA confirma em resposta curta), **30 J** (julgamento da IA sobre a seção).

      **Ordem de construção, uma etapa por entrega:**
      1. uma convenção única de títulos de seção entre a conversão e o `kb`. **Feito em 16/11/2026:** as seções começam em `##` e `#` fica para o título do documento, como nos 202 PPCs convertidos da base e na segmentação do `kb`; a conversão DOCX (regra `secoesNoNivel2` do modo `documento`) e o normalizador passaram a escrever assim, e o contorno de C saiu da pré-conferência. Teste ponta a ponta: DOCX sintético → `PPC.md` → `segmentarPpc` → pré-conferência, sem seção do modelo "ausente";
      2. o campo `execucao` nas fichas da `revisar-ppc` e os verificadores D (os 7 da PoC de C primeiro), cada um com teste exigido pelo `validar-base`. **Feito em 16/11/2026** (branch `t3/m1-11-etapa2-verificadores`, aguardando revisão): as 80 fichas têm `execucao: { modo, justificativa }` (12 D, 38 S, 30 J; a classificação de C foi revista e mantida), no Effect Schema, nos JSON Schemas, no índice e no mapa; os 12 verificadores ficam em `packages/ppc/src/verificadores/`, com o registro ficha → verificador (`registro.ts`) que a etapa 4 consulta; `validar-base` recusa ficha D sem verificador e verificador de ficha que não é D. Cada resultado traz o estado (`atende`, `nao_atende`, `a_conferir`, `nao_se_aplica`), os trechos literais com linha e seção e as fontes `ifpr://`. Nos 110 PPCs técnicos da base (cerca de 30 ms por PPC), com amostra conferida à mão por regra ([`packages/ppc/PRECISAO.md`](../../packages/ppc/PRECISAO.md), números conferidos por `pre-conferencia.ts --base --check`, invariantes no `pnpm test`): nenhum falso positivo nas amostras de `nao_atende`. Depois da revisão independente, as regras de norma seguem a vigência na data do `kb` e a transição (a Res. CNE/CP nº 2/2026 e as revogações por ela, a confirmar, saem `a_conferir` com os arts. 70 e 71; a 3/2018, com o art. 42 da 2/2024), só a ficha responsável pelo marco eleva a `nao_atende` (CT-IDENT-08 e CT-SUP-09 registram), qualquer sucessora da cadeia citada basta, e os comentários do DOCX juntam as fichas do mesmo trecho (1.294 apontamentos, 972 comentários). `nao_atende` por PPC: CT-SUP-12 em 93, CT-SUP-21 e CT-SUP-24 em 14, CT-SUP-14 em 11, CT-CURR-22 em 3; as outras sete só registram ou dependem de extração;
      3. "Baixar o DOCX com estes comentários" no servidor: a pré-conferência chega às pessoas **sem nenhuma chamada de IA**. **Feito em 16/11/2026** (branch `t3/9890093b`, sobre a da etapa 2, aguardando revisão): "Analisar um PPC" no app, ponta a ponta. A pessoa escolhe o `.docx` no diálogo do sistema; o RPC `revisaoPpc.analisar` (`apps/server/src/revisao-ppc/`) recusa mais de 20 MB antes de ler, monta a base do `kb.sqlite` (nada do checkout: conferido com o bundle rodando numa pasta temporária) e roda `revisarDocx` (`packages/ppc/src/revisao-previa.ts`) num `Worker` com 512 MB de heap e 30 s; estouro de memória, de tempo, `ErroDocx` e defeito viram frase em português, e o servidor segue de pé (testado com a bomba de descompactação dos testes do `packages/docx`). A cópia comentada vai para a pasta do original, `<nome> - revisão prévia (Simplifica IF).docx`, sem sobrescrever; o original só é lido. A tela mostra o andamento, as pendências por tema na ordem do parecer (estados "Precisa de ajuste", "Para conferir"), "Abrir o documento comentado" e "Mostrar na pasta" (o desktop só abre a cópia comentada de um arquivo escolhido no diálogo). Cada comentário diz o problema, o que fazer e a fonte legível no Word (nome da norma, dispositivo por extenso, endereço oficial quando a base o tem); "a conferir" sai como "Confira:"; um comentário no título avisa que não é parecer da PROENS, com a data da base e "12 de 80 critérios conferidos automaticamente; os demais exigem leitura". O curso é identificado no documento (denominação do CNCT e forma de oferta); a escolha pela pessoa existe no RPC, ainda não na tela. Medido: com heap de 2 MB o V8 aborta o processo inteiro, então o limite tem piso de 64 MB. Depois da revisão da etapa 2 (merge de `4a67dee`), a vigência também vem do `kb.sqlite` (com teste da revisão sem o repositório e da base do banco igual à dos arquivos), há um item por trecho com "Também em", as ausências ficam juntas no comentário do título, e a norma "a confirmar" sai "Confira:" com a transição em linha própria e os dispositivos por extenso;
      4. lotes S e temas J pelo motor, nos três providers;
      5. o roteiro de B e a conversa por pendência.

      **Riscos próprios:**
      - *regra errada parece fato:* uma pendência do código pesa mais que um palpite da IA. Toda regra sobre extração (`extraido`, classificação de títulos) sai como "a conferir"; uma regra só vira "pendência" com a precisão medida na base (a PoC rebaixou CT-IDENT-13 assim); regressão com os 110 PPCs e gabaritos anotados à mão; o comentário mostra o trecho e a fonte;
      - *a IA ceder em réplicas:* numa discordância sem fundamento, a IA tende a concordar (a PoC de B pediu a regra explícita da réplica). O servidor só retira uma pendência quando a resposta traz trecho do PPC ou dispositivo de norma **conferidos em código** contra o texto literal; senão, a pendência fica, com a discordância registrada;
      - *Codex e Antigravity não testados:* as PoCs de A e B rodaram só no Claude; os custos de C são estimativa sobre a medida de B. A etapa 4 só fecha com o teste real nos três;
      - âncora errada no DOCX (trecho literal que não cabe num parágrafo vai só para a lista e para o aviso do título, nunca para outro lugar) e "pré-conferência limpa não é PPC aprovado" (a tela e o aviso dizem quantos dos 80 critérios foram conferidos). **Em 16/11/2026, o usuário abriu no Word um arquivo gerado pelo `comentarios.ts`, e ele abriu certo.** Na etapa 3, as marcas passaram a ficar sempre como filhas do parágrafo (por fora de `w:ins`, link, campo e controle de conteúdo: rejeitar as alterações não deixa comentário órfão), com testes para comentário em tabela, trecho que atravessa negrito e link, documento com comentários de outra pessoa (partes do Word moderno, `commentsExtended`), controle de alterações no trecho e trecho que não se acha (caixa de texto, dois parágrafos, número escrito de outro jeito). As amostras de cada caso saem de `packages/ppc/scripts/amostras-revisao-previa.ts`. Falta abrir essas amostras no Word, no LibreOffice (não instalado na máquina de desenvolvimento) e no Google Docs; o `textutil` do macOS as lê.

      A correção `cacheEscrita` do motor, achada na PoC de A, entrou em `main`: a entrada que o Claude grava no cache (`cache_creation_input_tokens`) vem fora de `input_tokens`, e um turno de 48 mil tokens aparecia com 8;
  - `verificar-fundamentacao-normativa`.

  A `verificar-calendario` saiu do marco e do repositório em 16/11/2026: deixou de ser necessária.

  Os resultados abrem no visualizador e podem ser exportados.

  **Andamento em 16/11/2026:** o servidor entrega as skills às conversas. O `CatalogoSkills` (`apps/server`) lê a `--pasta-skills` (no desenvolvimento, `.agents/skills`; no app empacotado, `Resources/skills`, que o build gera só com as skills elegíveis e os arquivos listados), aceita só as de bloco `simplifica:` válido e passa todas a toda conversa nova ou retomada (`ConfigSessao.skills`); o RPC `skills.listar` devolve nome, título, resumo e área para os futuros cartões. `verificar-fundamentacao-normativa` está no catálogo (a `verificar-calendario` esteve até ser apagada, no mesmo dia); teste real com o Claude verde (a IA lê o `SKILL.md` sem pedido de aprovação). Falta: a `revisar-ppc` (depende da conversão DOCX em TypeScript), os cartões e o indicador de etapas na interface (M1.9) e o visualizador dos resultados.

  **Skills nos três providers (16/11/2026):** o `skills-real` passou no Codex (7,3 s; lê o `SKILL.md` com `cat` dentro do sandbox `read-only`) e no Antigravity (19,6 s; `read_file`), além do Claude (4,2 s). Nos três, a IA leu o `SKILL.md` de `.simplifica/skills/verificar-fundamentacao-normativa/` sem pedido de aprovação e respondeu com os sete rótulos.

  **Andamento em 16/11/2026 (skill com e sem):** a `verificar-fundamentacao-normativa` foi enxugada para o método (de 833 para 501 palavras no corpo do `SKILL.md`): as regras de citação, vigência, confiança e PPC como exemplo saíram, porque as instruções do servidor MCP já as dão; ficaram a extração das alegações explícitas e implícitas, o checklist por alegação, os sete status, os critérios por tema e o formato do relatório. Avaliação com o Claude (M0.5), 2 documentos × 3 condições, juiz Claude:

  | Métrica | só MCP | MCP + skill enxuta | MCP + skill antiga |
  |---|---|---|---|
  | Alegações tratadas | 12/12 | 12/12 | 12/12 |
  | Status corretos | 12/12 | 12/12 | 12/12 |
  | Erros plantados detectados | 7/7 | 7/7 | 7/7 |
  | Falsos alarmes (5 corretas) | 0 | 0 | 0 |
  | Rótulos da classificação usados | 0/14 | 10/14 | 11/14 |
  | Seções do formato do relatório | 0/12 | 11/12 | 10/12 |
  | Links `ifpr://` distintos | 12 | 11 | 15 |
  | Tokens de entrada / saída | 344 mil / 6,6 mil | 480 mil / 12,0 mil | 427 mil / 10,6 mil |
  | Custo e tempo | US$ 0,85, 65 s | US$ 1,15, 104 s | US$ 1,12, 92 s |

  Só com o MCP, o Claude já acerta tudo neste caso (efeito teto): o ganho da skill não é de acerto, é de forma, com a classificação fixa e o relatório no formato padrão, ao custo de cerca de 35% mais tokens e 60% mais tempo. O enxugamento não perdeu nada mensurável. **Recomendação: a skill fica**, porque o cartão do app precisa de uma tarefa com entrega padronizada e auditável (um status por alegação, o mesmo formato entre pessoas e providers), e esse é o efeito medido; mas não se deve atribuir a ela ganho de acerto. Antes de outra skill de conferência, o caso precisa de erros mais sutis (dispositivo vizinho que quase sustenta, condicionante omitida, norma institucional desatualizada) e de rodadas no Codex e no Antigravity, onde as instruções do servidor podem pesar menos.
- **M1.12 — "Isto está errado".**
  - **Pacote do relato:** pergunta, resposta, citações, versões da base, da skill e do app, e provider.
  - **Consentimento:** o servidor vê exatamente o que será enviado antes de enviar e pode retirar trechos.
  - **Destino:** a caixa da curadoria abre uma issue.
- **M1.13 — Aviso ao anexar.** Um detector local procura nos arquivos anexados CPF, RG, telefone e e-mail fora do domínio institucional. Se achar, avisa antes do envio. Não bloqueia: PPCs e normas trazem nomes e cargos em atos oficiais, e a decisão é do servidor.
- **M1.14 — Interface em português.** Segue a seção [Interface em português](#interface-em-português): texto em pt-BR direto, componentes copiados traduzidos na cópia, erros dos providers explicados por tipo, teste de navegador sem texto em inglês.

#### Política de fábrica

O T3 tem uma política gerenciada (`ManagedPolicy`) com dezenas de travas. No app próprio, a política só precisa cobrir o que o app faz. **Versão mínima:**

| Item | Valor de fábrica | Motivo |
|---|---|---|
| Providers permitidos | `claude`, `codex`, `antigravity` | os três da PoC; um provider novo é decisão de produto, não configuração |
| Ferramentas `ifpr` | aprovadas sem perguntar | só leitura, sobre dado público |
| Escrita e comandos | pedem aprovação, só dentro da pasta de trabalho; Codex em `read-only` com `on-request` | o servidor vê o que a IA quer fazer; nada fora da pasta |
| MCP, conectores e busca web do usuário | desligados na sessão | a resposta tem de vir da base, como mostrou a PoC do Codex |
| Telemetria | desligada; OTLP sem destino | só métricas agregadas com opt-in saem do computador |
| Atualização | URL do feed, canal padrão (`beta` no piloto) e chave pública minisign | o app só aceita pacote assinado do feed próprio |

- A política é um Effect Schema embutido no app e só de leitura.
- O modo de aprovação final se decide com o atrito medido no piloto (decisão em aberto 5).
- **Fica para depois:** um arquivo de política da máquina, gerido pela DTI, que só pode restringir (decisão em aberto 9).

**Critério de aceite**

- **Instalação:**
  - cerca de 20 pessoas do piloto instalam sem suporte, ou com no máximo uma intervenção cada, inclusive a CLI e o login do provider;
  - Windows e macOS cobertos. Supõe-se que a maioria dos computadores institucionais seja Windows; confirmar.
- **Tarefas:** cada pessoa conclui as três tarefas, e a avaliação de utilidade fica em pelo menos 4 de 5.
- **Motor:** nos três providers, com teste real no CI manual (`SIMPLIFICA_POC_REAL=1`):
  - a pergunta de referência responde com as ferramentas `ifpr` e cita `ifpr://`;
  - três turnos seguidos, interromper no meio de um turno, retomada depois de fechar o app e queda do processo do provider terminam num estado claro na tela;
  - a sessão não lista nenhuma ferramenta além das `ifpr` e das nativas do provider (isolamento).
- **Latência**, na pergunta de referência, mediana de 5 execuções:
  - **interface:** a mensagem aparece na conversa e o estado "enviado ao Claude/ChatGPT/Gemini" com o tempo decorrido em até 1 s;
  - **sinal de progresso** (etapa, ferramenta em uso ou texto) em até 10 s nos três;
  - **primeiro texto:** até 20 s no Claude e no Codex; até 60 s no Antigravity, que aparece na escolha da IA como "mais lento";
  - **enquanto espera:** o estado do turno ("consultando a base: buscar_norma", "escrevendo a resposta") a partir dos eventos do motor; depois de 30 s sem texto, a frase "o Gemini costuma levar cerca de um minuto" e o botão "Interromper".
- **Atualização:** uma nova versão da base chega a 90% dos computadores ativos do piloto em até 48 horas.
- **Fontes:** em pelo menos 60% das conversas com resposta normativa, o servidor abre ao menos uma citação. É a medida de que a fonte está a um clique.
- **Português:** nenhum texto em inglês nas telas, conferido pelo teste de navegador do M1.14.
- **Código do T3:** toda parte copiada está em [upstream-t3.md](../upstream-t3.md), e `pnpm upstream:t3 status` roda sem erro.

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
| Stack ([consolidação](consolidacao-stack-t3.md)) | C0 a C3 (concluídos) | interface e desktop no catalog | — |
| `simplifica-mcp` | ferramentas, executável, modo pacote | MCP HTTP local, recursos `ifpr://`, RPC de leitura no servidor local, atualização | validação local de norma |
| App | — | shell, política, Modo Servidor, leitor, interface em português | Explorar, "Para você", contribuição |
| Motor e providers | PoC (M1.0) | motor de produção, instalação, login e isolamento das CLIs | — |
| Código do T3 | `effect-acp`, `effect-codex-app-server`, cliente SQLite, lint | componentes do shell e do motor, registrados em [upstream-t3.md](../upstream-t3.md) | sincronização caso a caso |
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
| Deriva das CLIs dos providers | uma versão nova do `claude`, do `codex` ou do `agy` muda o protocolo ou a forma de receber o MCP, e o app para de responder | só interfaces oficiais e versionadas (Agent SDK, `app-server`, ACP); detecção da versão e faixa testada por provider; normalizadores testados com gravações reais; teste real nos três antes de cada versão do app; `pnpm upstream:t3 status` como alarme, porque o T3 se adapta antes |
| Manutenção do motor e do app | equipe pequena mantém um app inteiro | motor fino (cerca de 1.420 linhas na PoC); copiar do T3 em vez de escrever; nenhum recurso de desenvolvedor; knip contra código morto |
| Isolamento incompleto | MCP, conectores ou busca web do usuário respondem no lugar da base | desligar por sessão o que a PoC achou; teste de aceite que lista as ferramentas visíveis; pasta própria do Codex e do Antigravity se não bastar (decisão em aberto 8) |
| Latência do Antigravity | o servidor desiste antes da resposta (cerca de 60 s até o primeiro texto) | estado do turno e aviso de espera na tela; "mais lento" na escolha da IA; meta medida no piloto |
| Instalar a CLI do provider | servidor não técnico trava no primeiro passo | instalação gerenciada copiada do T3 no Codex e no Antigravity; passo guiado para o Claude, o único que o servidor instala sozinho; piloto mede o atrito |
| Binário sem assinatura | Windows Defender e Gatekeeper bloqueiam | certificados de assinatura (decisão em aberto) |
| Computador institucional sem permissão de instalação | piloto não instala | instalador por usuário (NSIS per-user), conversa prévia com a DTI |
| Variação entre IAs | mesma tarefa, qualidade diferente | regras no `kb`, avaliação em 3 IAs como critério de publicação |
| Erro da base multiplicado | muitos servidores recebem a mesma resposta errada | canais beta e estável, "Isto está errado", selos "a confirmar" e "extraído" |
| Servidor anexa documento com dado pessoal | o dado vai para a IA da conta pessoal dele | aviso de uso, aviso ao anexar, termo de uso |
| Suporte | equipe pequena recebe muitas dúvidas | piloto por etapas, canal único, perguntas frequentes geradas dos relatos |
| Mudanças incompatíveis no Effect 4 (`effect/ai`, `effect/sql`, `effect/cli`, `effect/rpc`, `effect/http` instáveis) | uma atualização quebra o app, o `kb` e o MCP ao mesmo tempo | uma versão só, fixada no catalog do monorepo; `.repos/effect` na mesma tag; testes de protocolo MCP, gabarito da CLI `kb` e testes do app em cada atualização |

## O que não fazer

- Não copiar código do T3 sem registrar em [upstream-t3.md](../upstream-t3.md), com a atribuição.
- Não depender do servidor do T3, do protocolo RPC dele nem do `t3 serve`.
- Não trazer recursos de desenvolvedor para o app: terminal, git, diff, worktrees, PRs.
- Não gravar na configuração do usuário dos providers (`config.toml`, `~/.claude`, `~/.gemini`): o que o app precisa vai na sessão.
- Não incluir no app ferramenta ou skill que acesse SUAP, SEI ou outro sistema com login, nem pedir senha de sistema institucional.
- Não enviar para fora do computador perfil, conversa ou registro de acesso sem consentimento explícito.
- Não calcular "Para você" com LLM. A IA só explica.
- Não publicar pacote sem assinatura nem com fonte não publicável.

## Fora do escopo até o Marco 2

- Acesso a SUAP, SEI e outros sistemas com login, e qualquer dado não público. O desenho para quando voltarem está em [app-seguranca-dados.md](app-seguranca-dados.md). As skills `suap-ifpr` e `revisar-processo-ppc` continuam no repositório, para os curadores.
- Modelo local.
- Tarefas agendadas executadas pela IA. O "Para você" não precisa delas.
- App mobile.
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
8. **Isolamento do Codex e do Antigravity.** Decidido em parte em 14/11/2026, no porte do T3 para o motor:
   - **Antigravity: perfil próprio, como no T3.** O `agy` roda com o `GEMINI_HOME` do app (`--gemini-dir`, em `<pasta do app>/providers/antigravity/`), sem os MCP, os hooks, as configurações e as chaves de API do usuário. Controle feito: sem o perfil, o `agy` carrega o `~/.gemini/config/mcp_config.json`; com o perfil, não. Achado: o `agy` 1.5.9 no macOS guarda o login do Google no Keychain, e não no perfil; o login é compartilhado com o `agy` do usuário, e quem já entrou no terminal não precisa entrar de novo no app.
   - **Codex: continua no `~/.codex`,** com o desligamento por thread (MCP do usuário, conectores do ChatGPT e busca web). O login é o do usuário.
   - **Em aberto: levar o Codex para um `CODEX_HOME` próprio.** Vale se o desligamento por thread deixar escapar algo (o `cua_repl` já escapa) ou se a configuração do usuário mudar o comportamento por outro caminho. O custo é o login: copiar o `auth.json` faz o refresh token rodar em duas cópias, e uma pode derrubar a outra; o T3 resolve com uma pasta-sombra e um broker de token (`CodexHomeLayout`, `CodexManagedTokenBroker`). Decide-se no M1.3, com o teste de isolamento.
9. **Política da máquina pela DTI:** se e quando o app lê um arquivo de política que só restringe a de fábrica.

## Andamento

- 13/11/2026: plano criado.
- 13/11/2026: SUAP e SEI retirados do escopo até o Marco 2. O app só trabalha com dados públicos.
- 13/11/2026: protótipos navegáveis de quatro telas (Início, Conversa com leitor, Para você, Ficha do curso), com dados reais da base. O usuário aprovou a direção em 14/11/2026.
- 14/11/2026: levantamento da stack do T3 Code. Decididos a regra de língua do código, a interface em português pelo `gt-react` e "sem Effect neste repositório no Marco 0" (decisão 7).
- 14/11/2026: decisão 7 revista. Este repositório consolida na stack do T3 (Node, pnpm, Effect 4, Vite+); o `kb` vira serviço Effect no servidor do fork, e some a API local de leitura. Plano em [consolidacao-stack-t3.md](consolidacao-stack-t3.md).
- 14/11/2026: **M1.0, prova de conceito do motor**, integrada em `main`. Em vez do fork, app próprio com motor fino sobre as interfaces oficiais: Agent SDK (Claude), `codex app-server` (ChatGPT) e `agy acp` (Gemini). `packages/motor` com o serviço `Motor`, eventos normalizados e um driver por provider; `packages/effect-acp` e `packages/effect-codex-app-server` copiados do T3, registrados em [upstream-t3.md](../upstream-t3.md). Os três responderam à pergunta do CNCT com as ferramentas `ifpr` e citaram `ifpr://`, e os três fizeram a ida e volta de aprovação (negar, depois permitir). Achados e lacunas em `packages/motor/README.md`.
- 14/11/2026: **direção revista: app próprio no monorepo, sem fork** (decisões 5 e 7). Stack do T3 também na interface, com as versões do T3 `a6d9140972`; código do T3 copiado e registrado em [upstream-t3.md](../upstream-t3.md), sincronizado caso a caso. Interface em pt-BR direto, sem `gt-react`. Marco 1 refeito com o que a PoC ensinou: motor de produção, providers no computador do servidor, MCP HTTP local, recursos `ifpr://`, política de fábrica mínima e meta de latência.
- 14/11/2026: correção vinda da PoC. A instalação e o login das CLIs vêm do T3, não são escritos do zero: instalação gerenciada do Codex e do Antigravity (`CodexInstallation.ts`, `AntigravityInstallation.ts`), `ClaudeExecutable`, `ClaudeHome` e `fixPath`, em porte no branch `t3/motor-porte-t3`. O Claude é a exceção: passo guiado nas boas-vindas. O M1.4 registra os motivos do MCP HTTP local e que falta testá-lo no Codex e no `agy`.
- 15/11/2026: **M1.2 (motor de produção) e M1.7 (política de fábrica mínima)** integrados em `main`: conversas gravadas e retomadas pelo provider, lista de conversas e reabertura na interface, queda do processo e interromper com estado claro, política por tipo de ferramenta nos três drivers, skills do app pelo motor e contexto do Codex reduzido. Teste real do ciclo de vida verde com o Claude; faltam o Codex e o Antigravity.
- 16/11/2026: **skills do app nas conversas** (M0.4 e M1.11, em parte). Manifesto `simplifica:` com Effect Schema em `@simplifica-if/mcp/skills`, validado no `validar_base.ts`; `verificar-fundamentacao-normativa` e `verificar-calendario` portáteis (ferramentas `ifpr` primeiro, CLI e scripts no repositório); `CatalogoSkills` no servidor, com `--pasta-skills` e o RPC `skills.listar`; o desktop passa a pasta e empacota só as skills elegíveis. Teste real com o Claude verde; faltam a `revisar-ppc`, o Codex e o Antigravity e a interface.
- 16/11/2026: a skill `verificar-calendario` foi apagada do repositório (deixou de ser necessária), com o script do PDF e a dependência `pdfmake`; no app fica a `verificar-fundamentacao-normativa`.
- 16/11/2026: **critério do M1.2 fechado nos três providers.** O teste real do ciclo de vida (três turnos, política negando a escrita fora da pasta sem pergunta, interromper, retomada depois de reiniciar, queda do processo) passou no Codex e no Antigravity, com retomada nativa nos dois. O teste real das skills do app também passou nos dois (M1.11). A queda do Codex passou a ter mensagem em português. Contexto do Codex na pergunta de referência: 136,6 mil tokens de entrada, contra 267 mil na PoC.
- 16/11/2026: **conversão DOCX em TypeScript, pré-requisito do M1.11** (passo T3 do PLANO-ARQUITETURA, branch `t3/typescript-docx-conversion`, aguardando re-verificação e merge). A skill `revisar-ppc` roda só com Node no repositório; a conversão ficou em `packages/docx` e `packages/ppc`, para o servidor importar, com limites contra arquivo hostil. A skill ainda não roda no app: o M1.11 lista o que falta (chamada pelo servidor, `Worker` com limite de memória e de tempo).
- 16/11/2026: **M1.11, "Analisar um PPC": aprovada a síntese da proposta C** (pré-conferência em código como porta de entrada, ordem e vocabulário de B, execução de A com recortes finos, conversa opcional por pendência, entrega no DOCX comentado). Em `main`: as três propostas em [`propostas/`](propostas/), `packages/docx/src/comentarios.ts`, `packages/ppc/src/pre-conferencia.ts`, a correção `cacheEscrita` do motor e a etapa 1 da construção (seções a partir de `##` na conversão DOCX e no normalizador, a convenção da base e do `kb`). As PoCs de A e B ficam nas branches delas.
- 16/11/2026: **M1.11, etapa 2: `execucao` nas fichas e os 12 verificadores D** (branch `t3/m1-11-etapa2-verificadores`, aguardando revisão). Classificação de C mantida (12 D, 38 S, 30 J) e versionada nas fichas; a PoC de 7 fichas virou 12 verificadores em `packages/ppc/src/verificadores/`, com registro, casos por verificador e regressão nos 110 PPCs técnicos. Precisão por regra em `packages/ppc/PRECISAO.md`: por PPC, `nao_atende` em CT-IDENT-08 (110), CT-SUP-12 (103), CT-SUP-09 (87), CT-SUP-21 (14), CT-SUP-24 (14), CT-SUP-14 (11) e CT-CURR-22 (3), todos verdadeiros nas amostras depois dos ajustes; a PoC apontava norma revogada em 107 PPCs e legislação profissional em 50, e a medição rebaixou para `a_conferir` a citação em seção de histórico e o curso que trata a profissão pelo conselho. Na revisão independente, a transição da 2/2026, a cadeia de sucessoras e a ficha responsável pelo marco entraram nas regras: CT-IDENT-08 e CT-SUP-09 passaram a só registrar, e CT-SUP-12 caiu de 103 para 93 PPCs com pendência.
- 16/11/2026: **formato dos documentos da base:** continua o Markdown como fonte, e o HTML é derivado só no leitor do app (M1.6). Medido: HTML custa de 15% a 25% mais tokens, e o XML jurídico, de 30% a 45%, sem ganho de citação.
- 16/11/2026: **M1.11, etapa 3: "Analisar um PPC" no app, sem IA** (branch `t3/9890093b`, sobre a da etapa 2, aguardando revisão). Servidor: `revisaoPpc.analisar`, com a base do `kb.sqlite` e a conversão, a pré-conferência e os comentários num `Worker` (512 MB, 30 s, piso de 64 MB porque 2 MB derruba o processo); o Worker vai no bundle como `trabalhador-ppc.mjs`, e o servidor empacotado analisou um PPC fora do checkout. Desktop: `escolherDocx`, `abrirDocumento` e `mostrarNaPasta`, só para a cópia comentada de um arquivo escolhido. Interface: botão provisório no Início, andamento, pendências por tema na ordem do parecer, os dois botões. Comentários com fonte legível no Word, "Confira:" para o que é a conferir e o aviso de revisão prévia no título. O usuário abriu no Word um DOCX comentado pelo `comentarios.ts`, e ele abriu certo; os casos de compatibilidade (tabela, negrito e link, comentários de outra pessoa, controle de alterações, trecho que não se acha) têm teste e amostras para conferir no Word. Depois da revisão independente das etapas 2 e 3 (16/11/2026): textos do Word em linguagem de coordenação (data não confirmada, transição sem contradição, sem códigos de ficha no corpo, fontes agrupadas, trecho e local do item não localizado), o servidor só analisa arquivos liberados pelo processo principal do desktop (`tokenDesktop`), uma análise por vez, e a revogação recente (menos de 12 meses, posterior ao PPC quando a data dele é conhecida) sem regra de transição sai "a conferir" (27 apontamentos da CT-SUP-12 na base, todos de revogações pela Res. CONSUP/IFPR nº 271/2026). Na mesma data, a etapa 3 foi adaptada à etapa 2 revisada: vigência do `kb.sqlite` (teste da revisão num processo sem acesso às pastas de dados do checkout), teste automático da base do banco contra a dos arquivos, um item por trecho com "Também em", ausências num só comentário no título.
