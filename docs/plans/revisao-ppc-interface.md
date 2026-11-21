# Revisar um PPC: redesenho da interface

Plano de 21/11/2026, a partir de duas revisões (fluxo e UX; sistema visual) feitas com o app rodando no servidor de teste (`apps/web/test/servidor-teste.ts`). Alpha: sem compatibilidade, sem migração; o que muda no contrato muda.

## O diagnóstico em uma frase

A tela pós-upload empilha seis blocos de mesmo peso numa coluna de 720 px (texto de abertura, seletor de arquivo, formulário de IA, resumo com nove informações, escolha de modo, paradas), e só depois mostra a primeira pendência. Cada pendência tem cerca de dez elementos, quatro deles botões iguais. E o título ("3 pontos precisam de ajuste e 8 são para conferir") soa como veredito, quando cobre 12 dos 84 critérios.

## Achados que o plano resolve

Do mais grave ao menos:

1. **Falsa completude.** Sem a IA, o app conferiu 12 das 84 fichas (12 em modo D; 34 J e 38 S pedem leitura). A ressalva aparece em cinza no meio do parágrafo (`revisao/ia.ts:50`), e o título grande (`Roteiro.tsx:146`) parece uma conclusão. Esse é o maior risco de confiança do produto.
2. **Ordem invertida.** O formulário "Gerar relatório com IA" fica entre o upload e o resultado (`routes/revisao-ppc.tsx:131-145`), e o seletor de arquivo continua sendo o botão principal depois que o resultado chega (`revisao-ppc.tsx:89-106`). A pessoa não sabe se o próximo passo é ler, rodar a IA ou trocar de arquivo.
3. **Uma causa vira quatro pendências.** "Curso não identificado no CNCT" aparece em CT-IDENT-01, CT-IDENT-13, CT-CURR-02 e CT-SUP-21, e a mesma ficha pode aparecer duas vezes.
4. **A gravidade não manda na tela.** As paradas seguem a ordem do parecer, então a parada 1 traz só itens "para conferir". Os selos "Precisa de ajuste" (âmbar a 8 %) e "Para conferir" (azul a 8 %) têm o mesmo peso, e o selo "Aberta", contornado, tem mais contraste que os dois.
5. **A IA termina sem retorno.** O quadro some ou volta ao formulário inicial (`revisao-ppc.tsx:139`). O topo continua dizendo "sem IA".
6. **Os cartões são pesados.** Cada um tem dois selos, o código da ficha, "conferido pela base", a frase fixa de `ROTULO_LOCAL` (`componentes.tsx:58`) e quatro botões contornados (`Roteiro.tsx:356-387`). Num PPC real, "Ver tudo" passaria de 150 botões.
7. **Dois modelos de estado competem:** a gravidade (Precisa de ajuste / Para conferir) e a situação (Aberta / Vou ajustar / Resolvida / Contestada…). O título não muda quando a pessoa avança.
8. **Vaza a linguagem do sistema.** Códigos CT-xx (o `tituloFicha` cai no código, `packages/ppc/src/revisao-previa.ts:423`), IDs crus como fonte (`ifpr/proens/nt/2025/1`), o caminho absoluto em mono, "1 critérios em 1 etapas", "(1 linha(s))", "janela de 5 horas do plano Pro (referência provisória…)" e "68 critérios" fixo (`RevisaoComIa.tsx:28`; o certo é 72, derivado da base).
9. **Sete ressalvas espalhadas:** não é parecer, não é PPC aprovado, fica guardada, 30 dias, seu arquivo não é alterado, estimativa aproximada e "comentado no trecho", esta em cada cartão.
10. **O ciclo real fica escondido.** O ciclo é corrigir no Word, reenviar e ver a lista se atualizar. O app tem isso (`revisaoPpc.revisarDeNovo`), mas só por pendência, atrás de "Já resolvi".
11. **O carregamento é opaco** (uma linha, sem etapas), e cada geração cria outra "(n).docx" na pasta do original (`apps/server/src/nome-livre.ts`).
12. **Bug:** uma estimativa de IA preparada e não iniciada volta como "ainda não terminou" e esconde "Continuar de onde parei" (`revisaoParaRetomar`).

## Direção

### A tela pós-upload diz uma coisa só

> **O que corrigir primeiro, e quanto do PPC já foi lido.**

O resto fica a um clique: ressalvas, caminho do arquivo, troca de arquivo, histórico, apagar, exportar.

### O elemento que fica na memória: a régua de critérios

A régua é uma fileira de 84 traços, um por critério, agrupados por tema e separados por um espaço maior entre os temas. A cor de cada traço diz a situação:

| Traço | Situação |
|---|---|
| vermelho | corrigir |
| âmbar | conferir |
| verde | em ordem |
| cinza contornado | ainda não lido |

Ela mostra a cobertura sem precisar de parágrafo. Sem IA, 72 traços ficam vazios, e isso se vê. Com a IA rodando, os traços se preenchem ao vivo; é o único movimento automático da tela. Um clique num traço ou num grupo leva à pendência ou ao tema. Na conferência só em código ela é honesta; na revisão completa ela vira o mapa do PPC.

É aqui que a ousadia se gasta. O resto da tela é quieto: linhas em vez de cartões, um primário por região, nenhuma cor fora da gravidade.

### Fluxo novo

```
Início ─▶ Escolher o PPC ─▶ Lendo (etapas) ─▶ Resultado ─▶ Trabalhar ─▶ Abrir no Word
                                                 ▲                 │
                                                 └ Enviar a versão corrigida ┘
```

1. **Escolher.** Uma área de soltar o arquivo (no desktop, o arrastar e soltar dá o caminho por `webUtils.getPathForFile`) e o botão "Escolher o PPC". Embaixo, as revisões recentes, uma linha cada: nome do arquivo, curso, data e "4 para corrigir". O parágrafo de abertura vira uma frase: "Confira seu PPC contra as normas antes de enviar à PROENS."
2. **Lendo.** Etapas visíveis, na ordem em que acontecem: "Lendo o documento", "Identificando o curso no CNCT", "Conferindo 12 critérios automáticos". O servidor emite as etapas; o RPC de hoje devolve tudo no fim.
3. **Resultado.** Cabeçalho do documento com a régua, a faixa da IA (se ela não rodou), o bloqueio de causa-raiz (se houver) e a lista.
4. **Trabalhar.** Uma pendência aberta por vez, com "Feito", "Sugerir texto" e "Discordar" no menu.
5. **Fechar o ciclo.** O botão "Abrir no Word com os comentários" regrava a mesma cópia (`<nome> - revisão prévia (Simplifica IF).docx`) e só cai para "(2)" se o arquivo estiver aberto e travado. "Enviar a versão corrigida" reconfere todas as pendências abertas contra o arquivo novo, generalizando o `revisarDeNovo`.

### Wireframe: resultado

```
┌ simplifica IF   Início  Explorar  Configurações                          Buscar ⌘K ┐  #1B5E20
│                                                                                    │
│  Revisar um PPC                                                                    │
│                                                                                    │
│  PPC Agropecuária 2026.docx                                    [Abrir no Word]  ⋯  │
│  Técnico em Agropecuária, subsequente, campus Ivaiporã                             │
│                                                                                    │
│  3 para corrigir e 8 para conferir, nos 12 critérios que o app confere sozinho.    │
│  ▮▮▮▮ ▮▮▮▮▮▮ ▯▯▯▯▯▯▯▯ ▮▮▯▯▯▯▯ ▯▯▯▯▯▯▯▯▯ ▯▯▯▯▯ ▯▯▯▯▯▯▯▯▯▯ …        (84 traços)     │
│                                                                                    │
│  ┌──────────────────────────────────────────────────────────────────────────────┐ │
│  │ Faltam 72 critérios que pedem leitura. O Claude lê em cerca de 6 minutos,    │ │
│  │ usando perto de 14 % do seu limite de 5 horas.      [Ler com o Claude]  Opções│ │
│  └──────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                    │
│  ┌ Não reconhecemos o curso no Catálogo Nacional (CNCT) ────────────────────────┐ │
│  │ Carga horária, eixo e requisitos de ingresso ficaram sem conferência.        │ │
│  │ Qual é o curso?  [ Escolher no CNCT ▾ ]                      4 pendências ▸  │ │
│  └──────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                    │
│  Temas                     │  Fundamentos legais e normativos                      │
│  ● Fundamentos legais    2 │  ──────────────────────────────────────────────────── │
│  ● Acesso, AEE e incl.   1 │  ● O PPC cita a Res. CNE/CP 1/2021, revogada pela   ⌄ │
│  ◐ Identificação e oferta 3│    2/2026                                             │
│  ◐ Perfil do egresso     1 │    O que fazer: troque a referência e confira o       │
│  ✓ Matriz curricular       │    art. 28, que mudou a carga de estágio.             │
│  ○ Estágio          não lido│   ┃ "conforme a Resolução CNE/CP nº 1, de 5 de     │
│  ○ …                       │   ┃  janeiro de 2021…"        (serifada, seção 1.2)  │
│                            │    Res. CNE/CP nº 2/2026, art. 28                     │
│  4 de 11 feitas            │    [Feito]  Sugerir texto   ⋯                         │
│                            │  ──────────────────────────────────────────────────── │
│  Sobre esta revisão        │  ● Falta a referência ao decreto de acessibilidade  › │
│                            │  ──────────────────────────────────────────────────── │
│                            │  ◐ Conferir a data de aprovação no Consup           › │
└────────────────────────────┴────────────────────────────────────────────────────────┘
```

- **A lista:** uma por tema, ordenada por gravidade (corrigir antes de conferir), com o tema escolhido na coluna da esquerda e "Tudo" no topo dela. A escolha entre "Revisar comigo" e "Ver tudo" deixa de existir; o roteiro com paradas e o aviso laranja de cobertura (`Roteiro.tsx:214-255`) saem.
- **A linha recolhida:** o glifo de gravidade, a mensagem em até duas linhas e a localização ("seção 4.1" ou "falta no documento").
- **A linha aberta:** "O que fazer", o trecho em serifada com o filete na cor da gravidade, a fonte pelo título da norma, como link `ifpr://`, e as ações.
- **Teclado:** ↑ e ↓ andam pela lista, Enter abre e F marca como feito. É um app de desktop, e há quem revise um PPC por semana.
- **Abaixo de 960 px:** a coluna de temas vira um seletor acima da lista.
- **"Sobre esta revisão"**, recolhido, reúne as sete ressalvas num lugar só: não é parecer da PROENS, o arquivo não é alterado, o que fica guardado e por quanto tempo, a data da base e o que a régua cobre.
- **O menu ⋯ do documento:** "Mostrar na pasta", "Enviar a versão corrigida", "Exportar a lista", "Revisar outro arquivo" e "Apagar esta revisão".

### Depois da IA

- A régua se preenche ao vivo, e a faixa da IA vira o andamento: "Lendo Matriz curricular (5 de 17 temas)", com "Pausar".
- No fim, a faixa diz o resultado em uma linha e some ao fechar: "O Claude leu 72 critérios e encontrou mais 5 pontos." Os pontos novos ganham a marca "Novo" até serem abertos.
- O título passa a ser "6 para corrigir e 9 para conferir, em 84 critérios".
- **Opções** (popover) reúnem a escolha da IA (padrão: a das Configurações), o escopo ("O que mais devolve PPC" / "Todos os 72") e o detalhe do uso do plano. A estimativa aparece já calculada na faixa; o botão "Ver quanto vai usar do plano" sai.

### Um só modelo de estado

| Hoje | Depois |
|---|---|
| Precisa de ajuste / Para conferir (selos) | **Corrigir** / **Conferir**: glifo, cor e palavra, sem selo |
| Aberta | não aparece (é o estado normal) |
| Vou ajustar | sai da interface e do contrato (`SituacaoPendencia`); conferir antes se a cópia comentada o usa |
| Resolvida | **Feito**: a linha esmaece, vai para o fim e pode ser desfeita |
| Contestada (aceita) | **Retirado**: "a IA conferiu o trecho que você indicou" |
| Contestada (mantida) | **Mantido**: "sua observação foi registrada" |

## Sistema visual (app inteiro)

### Cor

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `--primary` | `#1B5E20` | `#2E7D32` (texto branco) | botão principal; no escuro, sai o `#4CAF50` cheio, que brilha |
| cabeçalho | `#1B5E20` | `#14361A` | o `#1F8A42` com branco dá 4,4:1 e falha AA nos 14 px da navegação |
| `--accent-text` | `#1F8A42` | `#81C784` | link e marca em texto grande |
| `--grav-corrigir` | `#C72E2E`, texto `#A32424`, fundo `#FDECEC` | `#EF5350`, texto `#FF8A80`, fundo `rgb(239 83 80 / .14)` | glifo ● cheio |
| `--grav-conferir` | `#B26A00`, texto `#8A4B00`, fundo `#FFF4E0` | `#FFB74D`, texto `#FFCC80` | glifo ◐ |
| `--grav-ok` | `#1F8A42` sobre `#E8F5E9` | `#81C784` | glifo ✓ |
| `--grav-nao-lido` | `#BDBDBD` contornado | `#4A504B` | glifo ○ |
| superfícies | `#FFFFFF` / `#F6F7F5` / borda `#E2E4E0` | `#121512` / `#1A1E1B` / borda `#2E342F` | o cartão escuro de hoje quase não se distingue do fundo |

- O azul `info` (`#0277BD`) fica só para estado do sistema (conexão, atualização), nunca na revisão.
- Fica no global `accent-color: var(--primary)`, porque hoje os radios nativos saem azuis.
- A cor nunca vai sozinha: glifo, cor e palavra andam juntos.

### Tipografia

A Open Sans continua como regra de marca (`ifpr-design`), mas com o eixo de largura (`@fontsource-variable/open-sans/wdth.css`), que já vem no pacote instalado. Entra a **Source Serif 4** (`@fontsource-variable/source-serif-4`) para uma função só: a voz do documento. Ela vale nos trechos do PPC, no texto de norma no leitor `ifpr://`, nas citações da conversa e na sugestão de texto da IA. Só de olhar, a pessoa separa o que está no PPC ou na norma do que o app diz.

| Utilitário | Tamanho/entrelinha | Peso | Uso |
|---|---|---|---|
| `text-display` | 30/36, `wdth` 87,5, −0,01em | 700 | título de página e frase-resultado |
| `text-title` | 20/28 | 600 | título de seção e nome do documento |
| `text-heading` | 17/26 | 600 | título de pendência e de cartão |
| `text-body` | 16/26 | 400 | texto da interface (o 16/1,6 da marca) |
| `text-quote` | 17/28, Source Serif 4 | 400 | trecho e norma |
| `text-small` | 14/20 | 400 | metadado e localização |
| `text-micro` | 13/18 | 500 | contagem, dica; piso absoluto |

- Nada abaixo de 13 px: saem `text-[11px]`, `text-[.625rem]` e o `text-xs` solto. Os números vão com `tabular-nums`.
- Os rótulos ficam em caixa normal e semibold. Nada de rótulo em maiúsculas espaçadas.
- Medida de leitura de 68 caracteres (`max-w-[68ch]`) em todo parágrafo.

### Densidade e forma

1. **Cartão com borda só para objeto que existe sozinho:** o documento, a faixa da IA e o bloqueio. Uma lista é feita de linhas com divisória de 1 px, nunca de um cartão por item.
2. **Um botão primário por região visível.** Modo, filtro e escolha usam controle segmentado ou radio em cartão, nunca a variante `default` do botão.
3. **Selo só para mudança** ("Novo", "Retirado"). A gravidade é glifo e palavra.
4. **Raios:** controle 8, superfície 12 e pill para selo. Sombra só em popover e na caixa de pedido.
5. **Espaço:** escala de 4, 8, 12, 16, 24, 40 e 64.
6. **Duas larguras de página:** `--page-narrow: 720px` (conversa, formulários, boas-vindas) e `--page-wide: 1120px` (Início, Explorar, revisão, Configurações). Hoje são cinco (`2xl` a `5xl`), e o título pula de lugar ao trocar de aba.
7. **Um estilo de link:** a cor `--accent-text` sublinhada. O chip `.link-ifpr` fica só para referência `ifpr://` dentro de texto corrido.

### Componentes

**Ajustados em `components/ui`:**
- `badge.tsx`: 13 px, pill, variantes "novo" e "retirado".
- `button.tsx`: `sm` com 32 px e sem sombra.
- `alert.tsx`: raio 12, só para erro e aviso de sistema.

**Novos em `components/ui`:**
- `segmented.tsx`;
- `radio-cartao.tsx`;
- `nota.tsx`: a ressalva única, recolhível;
- `linha-expansivel.tsx`: linha de lista com divisória, chevron e uma aberta por vez;
- `area-soltar.tsx`.

**Novos na revisão:**
- `CabecalhoDocumento`;
- `ReguaCriterios`;
- `IndicadorGravidade`;
- `LinhaPendencia`, que substitui `CartaoPendencia` e `DetalhesPendencia`;
- `NavTemas`;
- `FaixaIa`, que substitui o formulário de `RevisaoComIa.tsx`;
- `BloqueioCurso`.

## Linguagem

| Hoje | Depois |
|---|---|
| "Revisão prévia, sem IA: o Simplifica IF confere…" (fixo) | "Confira seu PPC contra as normas antes de enviar à PROENS." |
| CT-CURR-16, CT-IDENT-01 na linha | some; o código vai para o "⋯ > Detalhes" da pendência, junto com "Isto está errado" |
| "conferido pela base" / "avaliação da IA" | some da linha; a régua e a marca "Novo" carregam a origem |
| "Gerar relatório com IA (revisão completa)" | "Ler com o Claude" (o nome da IA escolhida) |
| "Ver quanto vai usar do plano" | a estimativa já escrita na faixa |
| "1 critérios em 1 etapas… janela de 5 horas do plano Pro (referência provisória…)" | "Cerca de 6 minutos, perto de 14 % do seu limite de 5 horas. Dá para pausar." |
| "Os 68 critérios que exigem leitura." | "Os 72 critérios que pedem leitura", com o número vindo da base |
| "Parada 1 de 5", "Revisar comigo, uma parada por vez" | some (coluna de temas) |
| "Precisa de ajuste" / "Para conferir" | "Corrigir" / "Conferir" |
| "Vou ajustar" / "Já resolvi" / "Reabrir" | "Feito" / "Desfazer" |
| "Discordo…" | "Discordar" (no ⋯ da pendência) |
| "Fonte: ifpr/proens/nt/2025/1" | "Nota Técnica PROENS/IFPR nº 1/2025", pelo título da norma no `kb` |
| "(1 linha(s))" | concordância de verdade |
| "Listado no comentário do título… (o problema é algo que falta)" | "falta no documento" (a localização da linha) |
| "a pessoa confere a identificação antes da revisão" | "Confira o nome do curso: ele precisa estar como no CNCT." |
| "Gerar a cópia comentada com a situação atual" | some: "Abrir no Word" gera a versão atual |
| "Apagar esta lista" | "Apagar esta revisão" (no ⋯) |

Uma ação guarda o mesmo nome do começo ao fim. "Ler com o Claude" leva a "O Claude leu…"; "Feito" leva a "4 de 11 feitas".

## Fases

### Fase 1: limpeza local (sem mudar contrato)

- Mover o quadro de IA para baixo do resumo e mostrar a estimativa já calculada. Depois do resultado, tirar o seletor de arquivo do topo e levar "Revisar outro arquivo" para o ⋯.
- Título honesto, com "nos 12 critérios que o app confere sozinho", e remover o "sem IA" do texto fixo.
- Ordenar por gravidade dentro de cada parada e abrir o roteiro na primeira parada que tenha "Corrigir".
- Tirar da linha os selos "Aberta", o código CT-xx, "conferido pela base" e a frase de `ROTULO_LOCAL`. Juntar "Vou ajustar" e "Já resolvi" em "Feito". Levar "Discordar" para o menu.
- Esconder o caminho absoluto, a nota de 30 dias e "Apagar" (para o ⋯). Juntar as ressalvas em "Sobre esta revisão".
- Dar retorno ao fim da IA ("O Claude leu… e encontrou mais N").
- Bugs: o "68" fixo, "critérios/etapas" sem plural, "linha(s)", o ID cru como fonte, o `tituloFicha` caindo no código e a estimativa preparada escondendo "Continuar".

### Fase 2: sistema visual

Arquivos: `index.css`, `__root.tsx`, `components/ui/*` e os contêineres de página em `routes/index.tsx`, `revisao-ppc.tsx`, `explorar.tsx`, `configuracoes.tsx`, `conversa.tsx` e `tarefas.tsx`. O trabalho:

- os tokens de cor e de gravidade, o cabeçalho `#1B5E20`, o primário escuro e o `accent-color`;
- a escala tipográfica, o eixo `wdth` e a Source Serif 4 (no `apps/web/package.json`);
- as duas larguras de página;
- o ajuste dos componentes do T3 e os componentes novos;
- o link único;
- a serifada no leitor `ifpr://` e nas citações da conversa.

Como os componentes copiados do T3 mudam, `docs/upstream-t3.md` registra a adaptação.

### Fase 3: a revisão nova

- `CabecalhoDocumento`, `ReguaCriterios`, `NavTemas` com a lista em duas colunas e `LinhaPendencia` com teclado.
- `FaixaIa`, com o andamento na régua e as opções num popover.
- A tela de entrada com a área de soltar e as revisões recentes. O modo "Revisar comigo" e o roteiro de paradas saem (`revisao/roteiro.ts` e os testes dele).

### Fase 4: servidor e contrato

- **Etapas da leitura:** a pré-conferência emite eventos e o RPC vira um stream.
- **Causa-raiz:** o servidor agrupa as pendências que dependem do curso no CNCT sob um bloqueio. O RPC novo `revisaoPpc.definirCurso` reconfere com o curso escolhido. Fichas repetidas são deduplicadas.
- **Cópia única:** sobrescreve a cópia comentada, e o "(n)" fica só quando o arquivo está travado.
- **"Enviar a versão corrigida":** reconfere toda a lista contra o arquivo novo, generalizando o `ListaViva.revisarDeNovo`.
- **Modelo de estado:** sai o `vou_ajustar` do `SituacaoPendencia`, e o total de fichas que pedem leitura passa a vir da base.

### Testes que vão quebrar e precisam acompanhar

- `apps/web/src/app.browser.test.tsx`, os testes de `apps/web/src/revisao/*.test.ts` e os de `apps/server/test/` (`revisao-ia.test.ts`, `revisao-ppc-base.test.ts`, `lista-viva.test.ts`).
- `apps/web/test/mensagens-copiadas.test.ts` e `ingles.test.ts`, se conferirem os textos.
- Cada fase fecha com `pnpm fmt`, `pnpm lint`, `pnpm typecheck` e `pnpm test`, e com capturas do fluxo no servidor de teste, nos temas claro e escuro, a 1440 e a 1100 px.

## Decisões em aberto

- **A IA antes do upload?** O fluxo de UX propôs escolher a profundidade antes de enviar o arquivo. O plano faz o contrário: a conferência em código sempre roda (segundos, sem custo) e a IA vem como continuação na faixa. Assim a pessoa vê algo útil antes de gastar o plano. Se o piloto mostrar que quase todo mundo roda a IA, ela vira o padrão, com a IA das Configurações já escolhida e um clique a menos.
- **O cabeçalho no tema escuro**, `#14361A` ou neutro: decidir nas capturas da Fase 2.
