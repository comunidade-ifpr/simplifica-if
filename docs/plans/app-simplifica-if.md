# Plano do app Simplifica IF

Situação em 21/11/2026. Plano vivo: visão, decisões, arquitetura e o que falta até o Marco 2. O que já foi feito está no código e no histórico do git.

Este plano complementa o [arquitetura-base.md](arquitetura-base.md), que trata da base de conhecimento, do `packages/kb` e da CLI `kb`.

## Visão

O Simplifica IF é um app desktop que qualquer servidor do IFPR baixa e usa. Ele dá acesso à base de conhecimento do Instituto e a tarefas prontas (skills) de cada área. O servidor conversa com a IA da própria assinatura (Claude, ChatGPT ou Gemini), e o app entrega a ela a base, as ferramentas e as regras.

O app não só responde perguntas. **A base vai até o servidor:** quando sai uma norma nova, muda um prazo ou o PPC de um curso diverge do SUAP, o app avisa quem é afetado e explica o que muda.

Com skills de todas as áreas, o app vira a porta de entrada para o conhecimento do IFPR. Os sistemas institucionais (SUAP, SEI) ficam para depois do Marco 2.

## Decisões (13/11/2026)

1. **O servidor traz a própria assinatura de IA.** O IFPR não paga a IA neste horizonte.
2. **Horizonte de planejamento:** detalhado até o Marco 2.
3. **Piloto:** equipe da PROENS/DENS e coordenações de curso.
4. **Primeiro o cérebro, depois o corpo.** A base e as ferramentas existem como servidor MCP (`simplifica-mcp`), usável em apps que já existem, e o app é a melhor experiência, não a única porta. O `simplifica-mcp` fora do app continua um canal suportado (decisão de 21/11/2026), só na versão mais nova do protocolo MCP, sem legado.
5. **App próprio no monorepo, com código do T3 copiado e registrado.** O app vive neste repositório, ao lado do `kb` e do `simplifica-mcp`. O código que vem do T3 Code é copiado por parte e registrado em [upstream-t3.md](../upstream-t3.md). Motivo em [Código do T3](#código-do-t3-copiar-registrar-sincronizar-sob-demanda).
6. **Sem SUAP e sem SEI até o Marco 2.** O app só trabalha com dado público: a base e os documentos que o servidor anexa. Credenciais, níveis de sensibilidade e verificação de ZDR ficam fora do escopo.
7. **Stack única com o T3 Code, interface inclusive.** Node, pnpm, Effect 4 e Vite+ no backend e nas ferramentas; Electron, React, TanStack Router, Tailwind e shadcn sobre Base UI no app. O `kb` é um serviço Effect dentro do servidor local, e as ferramentas MCP são um Toolkit de `effect/ai`. Detalhes em [Tecnologia e língua do código](#tecnologia-e-língua-do-código).
8. **Repositório aberto com histórico limpo.** O histórico foi reescrito antes da publicação, sem dados pessoais nem URLs assinadas. A base segue a [política de dados pessoais](../../base-conhecimento/docs/curadoria-metadados-institucionais.md#dados-pessoais-e-urls-internas), que o `validar_base` aplica.

## Princípios

1. **Cérebro portátil, corpo fino.** O valor está na base, nas ferramentas determinísticas e nas skills, que funcionam em qualquer harness pelo MCP.
2. **Tarefa antes de chat.** Quem não sabe o que perguntar começa por um cartão de tarefa, com formulário curto.
3. **Toda afirmação a um clique da fonte.** Respostas trazem links `ifpr://`, que o app abre no leitor com o dispositivo destacado e o selo de vigência.
4. **A base funciona sem IA.** Buscar e navegar não gasta token e funciona offline.
5. **A base vai até o servidor.** A detecção de novidades é determinística, a partir dos pacotes e do perfil local. A IA só explica.
6. **Regras no núcleo, IA na ponta.** Quanto mais regra fica no `kb`, menos a resposta varia entre Claude, GPT e Gemini.
7. **Só dado público.** O app não busca nada em sistemas com login.
8. **Valem os princípios do plano da base:** o git é a fonte de verdade, os builds são determinísticos, nada inferido por LLM entra na base sem revisão humana, cada fase se mede.

## Arquitetura

O app tem dois processos: o do Electron, com a interface, e o servidor local, que roda o motor, o MCP `ifpr` por HTTP local e o `kb`. As IAs são processos filhos do servidor local, com a conta da pessoa: Claude (Agent SDK e `claude`), ChatGPT (`codex app-server`) e Gemini (`agy acp`). Fora do app, o executável `simplifica-mcp` (stdio, Node SEA) serve o mesmo Toolkit. A fábrica (`pnpm fabrica`) publica a base e as skills num manifesto assinado.

O mapa das pastas (`apps/desktop`, `apps/server`, `apps/web`, `packages/*`) está no [`AGENTS.md`](../../AGENTS.md#mapa). O código copiado do T3 fica em `packages/motor/src/t3`, `apps/server/src/t3`, `packages/effect-acp` e `packages/effect-codex-app-server`.

**Fronteiras**

- O app não lê o repositório, só os pacotes. Nada no computador do servidor depende de git, Python ou de um runtime instalado: o app leva o Node do Electron, e o executável stdio leva o próprio Node.
- Sem API local de leitura separada: o `kb` roda dentro do servidor local, e a interface lê por `effect/rpc`, com contratos em Effect Schema.
- **MCP HTTP local:** o servidor serve o Toolkit `ifpr` em `127.0.0.1`, porta escolhida na abertura, um token por sessão. No Antigravity, que não anuncia MCP HTTP, vai por stdio pela ponte `AcpMcpStdioBridge` do T3, subcomando do próprio executável.
- O app não usa o servidor do T3, o protocolo RPC dele nem o `t3 serve`.
- Nem o app nem a IA falam com o SUAP ou o SEI. Os dados do SUAP no app são os que a curadoria já publicou na base.
- Os processos das IAs morrem com a sessão. Os links `ifpr://` são o contrato entre a resposta da IA e a interface, e funcionam com qualquer provider, porque são texto.

### Esquema `ifpr://`

| Link | Abre |
|---|---|
| `ifpr://norma/br/cne-cp/res/2026/2#art28-xviii` | Norma no dispositivo, com vigência, relações e transições |
| `ifpr://curso/curitiba/tecnico-em-enfermagem` | Ficha do curso: PPC, ofertas, CNCT, divergências PPC × SUAP |
| `ifpr://ppc/curitiba/tecnico-em-enfermagem/2023#<secao>` | PPC convertido, na seção; sem a versão (`ifpr://ppc/curitiba/tecnico-em-enfermagem`), o PPC vigente do curso |
| `ifpr://cnct/tecnico-em-enfermagem` | Curso no CNCT |
| `ifpr://campus/curitiba` | Ficha do campus |
| `ifpr://ficha/CT-CURR-12` | Ficha da revisão de PPC |

As ferramentas do `simplifica-mcp` devolvem esses links prontos, e o `simplifica-mcp` também os serve como recursos MCP (`resources/read`), no app e no executável. O Consepe ainda não tem link próprio.

### Código do T3: copiar, registrar, sincronizar sob demanda

**Por que não fork.** No T3 Code `a6d9140972`, o servidor e o web somam cerca de 610 mil linhas, com cerca de 4 mil commits por mês; a orquestração é entrelaçada e os adaptadores de provider vivem dentro de `apps/server`. O app precisa de uma fração disso. Copiar pacotes inteiros traria a orquestração; usar o `t3 serve` dependeria de um protocolo privado que muda muito.

**Regras**

1. **Copia-se por parte, com motivo.** Cada parte entra na tabela de [upstream-t3.md](../upstream-t3.md) com origem, commit, data e adaptações.
2. **Atribuição MIT em cada parte:** `NOTICE` no pacote, cabeçalho no arquivo ou `LICENSE-T3` ao lado.
3. **Adaptação mínima e listada.** O que não precisa mudar fica igual, inclusive o inglês interno. Pacotes iguais ao upstream ficam fora do `vp fmt` e do `vp lint` daqui.
4. **Sincronização caso a caso.** Sincroniza-se por correção de segurança, defeito que nos afeta ou mudança no protocolo de um provider.
5. **Inspiração sem cópia** fica listada à parte no manifesto.

O porte do motor está feito: instalação gerenciada do Codex e do Antigravity, `ClaudeExecutable`, `ClaudeHome`, login do Antigravity e a ponte MCP estão em `packages/motor/src/t3/`.

### Tecnologia e língua do código

**Stack única (decisão 7).** As versões ficam fixas no catalog do `pnpm-workspace.yaml`, alinhadas ao T3 `a6d9140972` na época da cópia: Node 26.12.1, pnpm 12.14.0, Vite+ (`vp`: oxlint, oxfmt, vitest, tsdown), `effect-tsgo`, Effect 4 (`effect/rpc`, `effect/http`, `effect/sql` sobre `node:sqlite`, `effect/ai`, `effect/cli`), Node SEA para o executável, Agent SDK do Claude, Electron 44 com electron-builder e electron-updater, React 19, TanStack Router com rotas por arquivo, Tailwind 4, shadcn sobre Base UI (`base-mira`), `react-markdown` com GFM, vitest com `@effect/vitest` e testes de navegador no Playwright.

**Por que stack única:** o `kb` e o `simplifica-mcp` rodam dentro do servidor local; o mesmo Effect Schema gera o JSON Schema das ferramentas MCP e os tipos do RPC; um componente do T3 entra sem trocar de biblioteca; os agentes trabalham com as mesmas convenções em todo o repositório.

**Instabilidade do Effect 4** (`effect/ai`, `effect/sql`, `effect/cli`, `effect/rpc`, `effect/http` marcados instáveis): uma versão só no catalog, atualizada num PR com os gabaritos da CLI `kb` e do MCP; `.repos/effect` na mesma tag (`pnpm sync:repos`).

**Regra de língua:**

1. O código do app segue o padrão deste repositório: identificadores, comentários, mensagens e commits em português, com os nomes do domínio (`norma`, `ppc`, `curso`, `campus`, `dispositivo`). A API das bibliotecas é o que é.
2. Componentes copiados do T3 mantêm o inglês interno de origem, para o diff de sincronização ser legível. O texto visível ao usuário é traduzido na cópia, e isso fica nas adaptações do manifesto.
3. Nome, título e descrição das ferramentas MCP são texto para a IA e ficam em português.

### Interface em português

Texto em pt-BR direto no componente, sem `gt-react`. Datas, números e moeda pelo `Intl` num utilitário único (`apps/web/src/lib/formato.ts`). Os erros dos providers são explicados por tipo no cliente (`apps/web/src/conexao/erros.ts`), com o texto técnico em "Detalhes técnicos". Um teste de navegador falha se aparecer inglês ou jargão nas telas (`apps/web/test/ingles.ts`), e outro lista o destino de cada frase do código copiado do T3. Os diálogos de arquivo do Windows seguem a língua do sistema (limite aceito).

## Manifesto de skill

O `SKILL.md` segue o formato Agent Skills (`name`, `description`). O app lê um bloco `simplifica:` no front matter, como o da `verificar-fundamentacao-normativa` (resumido):

```yaml
name: verificar-fundamentacao-normativa
simplifica:
  versao: 0.1.2
  titulo: Conferir a fundamentação normativa
  resumo: Confere cada citação e afirmação normativa de um documento contra o texto das normas e do CNCT na base…
  area: ensino
  publico: [proens, dens, coordenacao-curso, pedagogia]
  entradas:
    - { id: documento, tipo: arquivo, rotulo: "Documento a conferir" }
  ferramentas: [resolver_citacoes, buscar_norma, ler_dispositivos, ficha_norma, etapa]
  etapas:
    - { id: fontes, rotulo: "Ler a fonte de cada alegação", progresso: true }
  arquivos: [references/relatorio.md]
  duracao_estimada: 10min
```

- O schema fica em `@simplifica-if/mcp/skills`, conferido no `validar_base.ts`. Obrigatórios: `titulo`, `resumo`, `area`, `ferramentas` e `arquivos`; `base_minima`, `app_minimo` e `donos` são opcionais (`donos` deve virar entrada num CODEOWNERS, que ainda não existe).
- `ferramentas` lista só ferramentas do `simplifica-mcp` que a skill usa (a busca web, quando ligada, vem da política da sessão, não do manifesto): a skill no app não chama comandos do repositório. `arquivos` lista o que vai para o app; `scripts/`, `tests/` e `agents/` nunca vão. Skill que precise de sistema com login não entra no app.
- `publico` tem vocabulário fechado (`@simplifica-if/mcp/publicos`) e filtra os cartões pelo perfil. A ferramenta `etapa` vira o indicador de etapas da conversa.

Hoje o Início tem duas tarefas: a nativa "Revisar um PPC" (conduzida pelo servidor, sobre as fichas de `base-conhecimento/revisao-ppc/`) e a `verificar-fundamentacao-normativa`. A skill `revisar-ppc`, com sub-agentes e relatório HTML, saiu em 21/11/2026: o app já fazia a revisão, e as validações cruzadas dela viraram fichas transversais e um verificador.

## Atualização: três ritmos

| Camada | Frequência | Mecanismo |
|---|---|---|
| App | mensal | `electron-updater` com feed `generic` |
| Base | a cada poucos dias | o app (e o executável, com `--pasta-atualizacao`) confere o manifesto na abertura e a cada 24 h, baixa em segundo plano, confere assinatura e hash e troca na próxima abertura |
| Skills | semanal | mesmo manifesto e mesmo mecanismo |

**Feito, em `packages/atualizacao` (o README tem o fluxo):** `pnpm fabrica` compila do commit, comprime a base com zstd, gera patch entre versões (cerca de 10 KB entre versões próximas, contra cerca de 33 MB do pacote inteiro), empacota as skills, assina o manifesto com minisign, confere que só entram fontes publicáveis, mantém `base-conhecimento/novidades.yaml` (só acréscimos, com proposta pela diferença entre bases) e promove do beta ao estável reaproveitando os pacotes. O servidor troca a base com rename atômico, escolhe a mais nova entre a baixada e a empacotada, recusa base de esquema que o app não lê, adia a troca com trabalho em curso e permite voltar uma versão. Subir o esquema da base exige publicar com `--app-minimo`.

**Hospedagem:** GitHub Releases do próprio repositório, só por links diretos (`releases/download/<tag>/<arquivo>`), nunca pela API: um release fixo por canal (`canal-beta`, `canal-estavel`) e releases imutáveis por versão. O piloto usa `beta`; a promoção para `estavel` é manual, depois de dias sem relato de erro confirmado.

**Falta:** o feed e a chave de produção na política (`null` em `packages/motor/src/politica-atualizacao.ts`); a assinatura de código, sem a qual o `electron-updater` fica desligado (no Windows, o `publisherName` é obrigatório antes de ligar); e a fábrica gravar no pacote quem cada novidade afeta (`kb impacto`, `kb adequacao-art71`), entrada do "Para você".

## Política de fábrica

A política é um Effect Schema embutido no app, só de leitura (`packages/motor/src/politica*.ts`).

| Item | Valor de fábrica | Motivo |
|---|---|---|
| Providers permitidos | `claude`, `codex`, `antigravity` | provider novo é decisão de produto |
| Ferramentas `ifpr` | aprovadas sem perguntar | só leitura, sobre dado público |
| Escrita e comandos | pedem aprovação, só dentro da pasta da tarefa; negados fora | o servidor vê o que a IA quer fazer |
| MCP e conectores do usuário | desligados na sessão | a conversa não puxa MCPs, apps nem plugins pessoais |
| Busca e leitura web | ligadas em conversas (filtro de URL pública; comandos de rede negados); desligadas na revisão de PPC | base primeiro, web oficial como complemento |
| Telemetria | desligada | só métricas agregadas com opt-in saem do computador |
| Atualização | feed, canal padrão (`beta` no piloto), chave minisign | o app só aceita pacote assinado do feed próprio |
| Curadoria | `repositorio` (`null` até definido) e `rotulos` | "Isto está errado" abre `issues/new` no navegador, sem token no app |

O modo de aprovação final se decide com o atrito medido no piloto. Um arquivo de política da máquina, gerido pela DTI e que só restringe, fica para depois.

## Marcos

Marco 0, cérebro portátil: o `simplifica-mcp` em apps que já existem, para 3 a 5 pessoas da PROENS/DENS. Marco 1, app beta, para cerca de 20 pessoas da PROENS/DENS e de coordenações de alguns campi. Marco 2, a base vai até o servidor ("Para você", superpoderes, contribuição), para as coordenações de todos os campi.

### Situação

| Entrega | Situação |
|---|---|
| M0.1 `simplifica-mcp` | feito: `packages/mcp`, 16 ferramentas, instruções em `packages/mcp/instrucoes.md` |
| M0.2 Executável | feito: `pnpm mcp:executavel`, job do CI por plataforma; falta a assinatura de código |
| M0.3 Pacote da base | feito pela fábrica (`pnpm fabrica`) |
| M0.4 Skills portáteis | feito: bloco `simplifica:`, `verificar-fundamentacao-normativa` portátil |
| M0.5 Avaliação em três IAs | em parte: `pnpm avaliacao:skill` roda nos três providers, mas só o Claude foi rodado |
| M0.6 Piloto zero | falta |
| M1.0 PoC do motor | feito: `packages/motor` |
| M1.1 App e shell | feito: `apps/desktop`, `apps/server`, `apps/web`, marca em `docs/marca/`; faltam assinatura, notarização e instaladores no CI |
| M1.2 Motor de produção | feito: conversas em `effect/sql`, retomada nativa, queda e interromper, teste real do ciclo nos três providers |
| M1.3 Providers no computador | feito: detecção, instalação gerenciada (Codex, Antigravity), passo guiado do Claude, isolamento por sessão |
| M1.4 e M1.5 MCP HTTP local e recursos `ifpr://` | feito: `@simplifica-if/mcp/http`, `resources/read` |
| M1.6 Leitor | feito: painel nos seis tipos de link (`apps/web/README.md`) |
| M1.7 Política de fábrica | feito, versão mínima |
| M1.8 Primeiro uso | feito: `/boas-vindas`, perfil local, aviso de uso (`AvisoUso.tsx`) |
| M1.9 Modo Servidor | feito: Início, tarefa, conversa com etapas, pasta da tarefa, "Desfazer" |
| M1.10 Atualização | feito, sem feed de produção |
| M1.11 Revisar um PPC | feito, etapas 1 a 5b: pré-conferência em código, revisão com IA, roteiro por pendência, DOCX comentado (`apps/server/src/revisao-ppc/`, `packages/ppc`) |
| M1.12 "Isto está errado" e M1.14 português | feito: `RelatoErro.tsx`, `apps/server/src/Relatos.ts`, `apps/web/test/ingles.ts` |
| M1.13 Aviso ao anexar | retirado: o aviso de uso basta |
| M1.15 Explorar | feito: `apps/web/src/routes/explorar*` |
| Anexos em texto | feito: `.docx`, `.odt` e PDF em Markdown para a IA (`apps/server/src/textos-anexos/`) |
| M2.1 a M2.5 | M2.1 virou o M1.15; M2.2 a M2.5 faltam |

**Revisar um PPC, em uma linha:** 84 fichas classificadas pelo campo `execucao` (12 D só código, 38 S trecho achado pelo código e confirmado pela IA, 34 J julgamento da IA sobre a seção); a pré-conferência roda sem IA, e a revisão com IA é orquestrada pelo servidor em sessões sem ferramentas, com toda resposta conferida em código.

## O que falta

- **M0.5:** rodar `pnpm avaliacao:skill` no Codex e no Antigravity; o caso atual tem efeito teto no Claude e precisa de erros mais sutis.
- **M0.6, piloto zero:** o `simplifica-mcp` fora do app, pelo [guia-piloto-zero.md](../guia-piloto-zero.md); as perguntas reais viram casos de avaliação. Critério: instalar e fazer a primeira consulta em até 15 minutos.
- **Distribuição:** assinatura de código e notarização (macOS, Windows) e instaladores gerados no CI (decisão em aberto 1); feed e chave de produção da atualização; `curadoria.repositorio` na política; a fábrica gravar no pacote quem cada novidade afeta.
- **Critério do INCONCLUSIVO:** rotular à mão os 33 pares do conjunto (`apps/server/scripts/planilha-inconclusivos.ts`, arquivos em `tmp/avaliacao-inconclusivos/`), rodar o `calcular` e decidir o `CRITERIO_PADRAO` (`packages/ppc/src/revisao-ia/pedido.ts`, hoje `conservador`). Medido no Claude, nos 36 pares: INCONCLUSIVO 15 (`conservador`) contra 12 (`ausencia`), NAO_ATENDE 7 contra 11, "precisa de ajuste" na lista 7 contra 11. Troca-se se a precisão de NAO_ATENDE da `ausencia` não for pior e o INCONCLUSIVO cair.
- **Revisar um PPC, sobras:** levar ao pedido a seção que o motivo da pessoa aponta fora do recorte; abrir cada parada do roteiro com IA e pré-buscar a seguinte; medir a revisão inteira e as ações no Codex e no Antigravity (só lotes curtos rodaram neles); recorte da ficha D com o trecho que o código apontou; escolher na tela o provider das ações e o curso (a conferir); exportar a lista em DOCX ou PDF; reaproveitar o cache entre ações; abrir as amostras de comentários (`packages/ppc/scripts/amostras-revisao-previa.ts`) no LibreOffice e no Google Docs (no Word já abrem certo).
- **Leitor e Explorar, sobras:** busca dentro do documento; exportar em PDF ou DOCX; imprimir PPC grande sem montar tudo de uma vez; `urn_lexml` e tabelas em TSV para a IA (opcionais); paginação das coleções; sinônimos na busca; guardar a rolagem ao voltar; link `ifpr://` e recurso MCP para o Consepe; na ficha do curso, as normas por `impacto` e os prazos por perfil (com o M2.2); medir no computador mais modesto do piloto (meta: menos de 200 ms).
- **Primeiro uso e interface:** revisão do aviso de uso pelo encarregado de dados (decisão em aberto 7); tarefa de exemplo com um PPC público em DOCX; logout das contas pelo app; a escolha da IA dizer qual está pronta; conferir os comandos de instalação do Claude que o app mostra; conferir o app com o macOS em inglês.
- **Anexos em texto:** `.xlsx`; `.ods`, `.odp`, `.pptx` e `.rtf` sob demanda; "ver o texto que a IA leu" no painel da pasta; teste real (fora do CI) da `verificar-fundamentacao-normativa` com uma minuta `.docx`, no Claude e no Codex, sem pedido de aprovação de comando.

**Critério de aceite do Marco 1 e piloto**

- Instalação: cerca de 20 pessoas instalam sem suporte, ou com no máximo uma intervenção, inclusive a CLI e o login do provider, em Windows e macOS.
- Tarefas: cada pessoa conclui as duas tarefas do Início, com utilidade de pelo menos 4 de 5.
- Motor: teste real nos três providers (`SIMPLIFICA_POC_REAL=1`) com a pergunta de referência, três turnos, interromper, retomada e queda; a sessão só vê as ferramentas `ifpr` e as nativas.
- Latência (mediana de 5): a mensagem aparece em até 1 s; sinal de progresso em até 10 s; primeiro texto em até 20 s no Claude e no Codex e até 60 s no Antigravity.
- Atualização: nova versão da base em 90% dos computadores ativos em até 48 horas.
- Fontes: em pelo menos 60% das conversas com resposta normativa, a pessoa abre ao menos uma citação.
- Métricas do piloto: tarefas por pessoa e semana, tempo até a primeira resposta útil, relatos por 100 conversas, acerto e tokens por provider. Só métricas agregadas e com opt-in saem do computador.

### Marco 2 — A base vai até o servidor

- **M2.2 — "Para você".** Determinístico e local. Entradas: `novidades.yaml` com os afetados, `transicoes.yaml`, divergências de `ppc-fatos` e o perfil. Avisos: norma nova ou revogada que afeta curso do perfil, prazo de adequação próximo, PPC divergente do SUAP, PPC atualizado na base. Prazos "a confirmar" aparecem assim. "Ver o que muda" abre uma conversa com a skill `explicar-novidade`, nova; só esse passo gasta token. Notificação do sistema opcional, desligada por padrão.
- **M2.3 — Superpoderes.** Perguntas prontas por perfil, cada uma ligada a ferramentas do `kb`: adequação à nova DCN da EPT, divergências PPC × SUAP, como outros campi escreveram uma seção, prazos normativos, PPCs que citam uma norma.
- **M2.4 — Contribuição.** "Propor norma": o servidor solta o PDF, o agente converte seguindo o padrão de front matter, o `simplifica-mcp` valida localmente e a proposta vira PR para a curadoria. "Sugerir tarefa": a sugestão vai para a fila de skills.
- **M2.5 — Piloto ampliado** para as coordenações de todos os campi, com canal único de suporte.

**Critério de aceite:** nenhum aviso falso nos casos de teste (afetados conferidos à mão para 3 novidades reais); pelo menos 30% dos avisos abertos no piloto; pelo menos uma norma proposta pelo app chega a `main`.

## Riscos

| Risco | Mitigação |
|---|---|
| Deriva das CLIs dos providers | só interfaces oficiais (Agent SDK, `app-server`, ACP); detecção de versão; teste real nos três antes de cada versão |
| Isolamento incompleto | desligar por sessão MCP, conectores, plugins e navegador automatizado do usuário; filtro determinístico de URL pública na leitura web; teste que lista as ferramentas visíveis; `CODEX_HOME` próprio se não bastar |
| Servidor não técnico trava ao instalar a CLI | instalação gerenciada do Codex e do Antigravity; passo guiado do Claude |
| Binário sem assinatura bloqueado | certificados de assinatura (decisão em aberto 1) |
| Computador sem permissão de instalação | instalador por usuário; conversa prévia com a DTI |
| Erro da base multiplicado | canais beta e estável, "Isto está errado", selos "a confirmar" e "extraído" |
| Anexo com dado pessoal vai à IA da pessoa | aviso de uso aceito no primeiro uso; sem ele, o servidor não manda nada à IA |
| Relato publicado com dado pessoal | prévia exata com retirada de trechos e texto fixo de issue pública; "Salvar" e "Copiar" como alternativa |
| Regra errada da pré-conferência parece fato | regra sobre extração sai "a conferir"; pendência só com precisão medida nos 110 PPCs técnicos |

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

- Acesso a SUAP, SEI e outros sistemas com login, e qualquer dado não público.
- Modelos locais e roteamento por OpenRouter.
- Tarefas agendadas executadas pela IA.
- App mobile.
- Contas de usuário e servidor central do Simplifica IF.
- Rota de IA paga pelo IFPR.

## Decisões em aberto

Os números são os de sempre, porque o código e os READMEs os citam; a 2 (hospedagem) e a 4 (marca) já foram decididas.

- **1. Assinatura de código:** quem obtém e guarda os certificados (Apple Developer ID e assinatura Windows), o IFPR ou o projeto?
- **3. Caixa da curadoria:** o relato vira issue no repositório do projeto, aberta pela pessoa. Falta decidir quem faz a triagem e o que fazer com o relato de quem não tem conta no GitHub (hoje, salvar ou copiar e mandar por outro canal).
- **5. Modo de permissão final** do Modo Servidor, com o atrito medido no piloto.
- **6. Computadores do piloto:** sistema operacional, permissão de instalação e hardware.
- **7. Aviso de uso:** o texto provisório (`apps/web/src/components/AvisoUso.tsx`) precisa da revisão do encarregado de dados antes do piloto.
- **8. `CODEX_HOME` próprio.** O Antigravity já roda com perfil próprio do app; o Codex usa o `~/.codex` do usuário, com MCP, conectores e plugins desligados por thread (e `web_search: "live"` nos servidores da OpenAI, ou `"disabled"` na revisão de PPC). Uma pasta própria vale se o desligamento deixar escapar algo; o custo é o login (o T3 resolve com pasta-sombra e broker de token, `CodexHomeLayout`).
- **9. Política da máquina pela DTI:** se e quando o app lê um arquivo de política que só restringe a de fábrica.
