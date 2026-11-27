# Plano da multitarefa no app

Situação em 27/11/2026, depois da revisão final (Opus e Gemini 4 Neon). Plano vivo: como o Simplifica IF deixa a pessoa fazer mais de uma coisa ao mesmo tempo (revisar um PPC e pesquisar a base, revisar e conversar com a IA sobre uma norma, deixar uma conversa longa rodando, corrigir o PPC no Word com as pendências à vista) sem virar um gerenciador de janelas. As dez etapas estão em `main`, com as correções da revisão de conjunto ([Depois da implementação](#depois-da-implementação)).

Complementa o [plano do app](app-simplifica-if.md) (princípios, aviso de uso, política de fábrica, M2.2) e o [plano das tarefas](tarefas.md) (módulos e a fronteira deles). Os mockups das telas com tudo implementado, em situações de uso, estão em [multitarefa-mockups.html](multitarefa-mockups.html).

## Problema

O servidor local já trabalha em paralelo; a interface e o desktop, não.

- **O servidor aguenta.** As conversas vivem num `Map` com `PubSub` e trava próprios (`apps/server/src/Conversas.ts:281`), o turno corre num fiber do servidor e não depende da tela (`Conversas.ts:5-10`), e a leitura com IA do PPC também segue sozinha (`modulos/revisao-ppc/RevisaoIa.ts`). Várias conexões WebSocket acompanham a mesma conversa.
- **A interface tem uma de cada coisa.** Um `ControleConversa` e um `ControleRevisao` no `ContextoApp` (`apps/web/src/contexto.tsx:13-18`); abrir uma conversa solta a anterior (`conversa/ControleConversa.ts:7`). `ItemConversa` (a aprovação) e `ApagarConversas` também usam esse controle único.
- **O painel de leitura é de cada tela.** São duas cópias do mesmo estado local (`routes/conversa.tsx:355`, `modulos/revisao-ppc/Leitura.tsx:70`), que se perdem ao navegar. Trocar de conversa fecha o painel (`conversa.tsx:354`).
- **Buscar e perguntar tiram a pessoa de onde ela está.** A paleta ⌘K navega para `/explorar/ver` (`explorar/Paleta.tsx:140-145`), e "Perguntar à IA sobre isto" vai ao Início (`explorar/PerguntarIa.tsx:13`). No meio de uma revisão, pesquisar uma norma é sair da revisão.
- **O leitor presume um documento por janela.**
  - `IR_PARA` e `MONTAR_TUDO` vão por `window` a todo `Documento` montado (`leitor/Documento.tsx:181,209`; disparados em `Sumario.tsx:27` e `Leitor.tsx:204`).
  - O destaque e a busca usam nomes fixos de `CSS.highlights` (`Documento.tsx:234`, `BuscaPainel.tsx`), estilizados por `::highlight(...)` fixos no `index.css:575-601`.
  - A faixa do trecho e as âncoras rolam por `document.getElementById` (`leitor/pecas.tsx:215`, `components/Markdown.tsx:40`), e os `id` dos dispositivos se repetem se a mesma norma estiver aberta duas vezes (`rehypeDispositivos.ts`).
  - O ⌘F escuta a janela inteira (`BuscaPainel.tsx`), e a impressão esconde tudo o que não é `.leitor-impressao` (`index.css:611-639`), que todo leitor usa.
- **Nada avisa o que roda em segundo plano.** Não há indicador no cabeçalho nem notificação; a lista de conversas só recarrega por gatilho (`components/ListaConversas.tsx`).
- **Uma janela, por construção** (`apps/desktop/src/main.ts:97`), com o IPC confiando só nela (`apps/desktop/src/ipc.ts:51-78`) e tamanho mínimo de 800×560 (`main.ts:261-262`).

As propostas de três modelos (Opus, Fable e Gemini), feitas em separado, convergiram no mesmo desenho: um painel de apoio do app, a conversa ao lado e uma bandeja do que está rodando; abas e divisão de tela ficam de fora.

## Decisões (27/11/2026)

1. **O painel é do app, não da tela.** É uma coluna só, à direita, montada na moldura e presente em toda tela, que sobrevive à navegação e à troca de conversa.
   - Tem três abas: Ler, Conversar e Pasta.
   - A busca fica na paleta (⌘K), aberta também pelo botão "Buscar na base" do próprio painel. Uma aba Buscar espremeria a barra de abas no notebook.
2. **A conversa ao lado é uma conversa livre** (todas as skills, com web), igual às outras: aparece na lista de conversas e pode ir para a tela cheia.
   - Aberta a partir de uma revisão de PPC, ela **leva o PPC inteiro em Markdown**, e o pedido manda a IA lê-lo inteiro.
   - Os 195 PPCs da base têm mediana de 259 mil caracteres (uns 70 mil tokens) e máximo de 684 mil (uns 190 mil tokens). Cabem nas janelas de 1 milhão de tokens, mas não com folga numa de 200 mil. As ferramentas de leitura dos harnesses leem em partes, e a leitura gasta cota: ver [o que medir](#a-conferir).
3. **A melhor experiência vem antes do custo em tokens.** O contexto da tela entra já incluído, como fichas visíveis e removíveis acima da caixa (opt-out).
   - Nada vai escondido: o que vai à IA está sempre à vista.
   - O arquivo de uma ficha só vai para a pasta da conversa no envio, e só se a ficha ficou.
   - O aviso de uso continua valendo, e o texto dele passa a citar as fichas (ver [Dados e aviso de uso](#dados-e-aviso-de-uso)).
4. **Sem teto de sessões de IA.** Quando a assinatura chega ao limite, o app avisa onde aconteceu e oferece continuar com outra IA instalada, levando o mesmo contexto.
   - Isso vale para a conversa e para a leitura com IA da revisão.
   - Na revisão, a outra IA lê só os blocos que faltam, e cada pendência da IA mostra qual IA a julgou.
5. **A tela de referência é o notebook (1366×768); o melhor caso é 1920×1080.** Quase ninguém usa dois monitores.
   - O painel é coluna quando a tela principal ainda fica com 760 px ou mais; abaixo disso, é sobreposição.
   - Várias janelas ficaram para o fim da fila e entraram como a etapa 10.
6. **Modo compacto ao lado do Word.** A multitarefa real da revisão é entre o app e o Word: a revisão encolhe para uma coluna estreita encostada à direita da tela.
7. **Sem abas, sem divisão de tela, sem mesas por enquanto.**
   - Os cenários são "trabalho principal + apoio". O app já ensina essa forma (o painel da conversa e o da revisão).
   - Abas ou divisão exigiriam tirar a moldura da rota raiz e montar um roteador por painel, para entregar a quem não pediu um gerenciador de layout.
   - Reabre-se a questão se a [prateleira de documentos marcados](#painel-do-app) transbordar no piloto.
8. **A notificação do sistema vem ligada por padrão** para "resposta pronta" e "a IA pede permissão", só com a janela sem foco (no modo compacto, só com a janela oculta). Desliga-se nas Configurações.
   - No modo compacto, a coluna à vista não dá aviso do sistema: a moldura compacta mostra "Em andamento" (a bandeja), para o pedido de permissão e a resposta pronta não ficarem sem sinal.
   - A notificação das novidades da base (M2.2) continua desligada por padrão.
9. **A pasta da conversa aberta da revisão tem o Markdown do PPC sempre atual**, regravado quando a lista muda, por exemplo pela [conferência ao salvar](#conferência-ao-salvar).
   - Uma nota na pasta diz qual `.docx` está no Word e onde ele está.
   - O `.docx` só entra se a pessoa o anexar (ficha "Anexar o .docx"). Cópias de `.docx` envelheceriam no primeiro salvamento no Word, e o app as converteria de novo em texto.
10. **O modo compacto fica sempre por cima, à direita.** Ao ligá-lo, o app diz "Deixe o Word à esquerda" (no Windows, ⊞+←), porque a coluna cobre a área dos balões de comentário do Word. Um botão solta o "sempre por cima". Ajusta-se no piloto.
11. **A conversa ao lado de uma revisão usa a mesma IA da revisão;** se a revisão não usou IA, usa a última IA usada.
   - Com a leitura com IA em andamento, a caixa avisa que as duas gastam a mesma assinatura.
12. **Uma conversa ao lado por revisão.** "Conversar sobre esta pendência" retoma a conversa ao lado da mesma revisão e acrescenta a ficha da nova pendência; "Nova conversa", no painel, abre outra. Assim a lista de conversas não se enche de conversas de uma pergunta.
13. **Comparar normas entra no plano.** Duas normas que se sucedem ficam lado a lado, alinhadas pela tabela de correspondência, com o aviso fixo de rascunho (cena 9 dos mockups). Comparar PPCs fica para depois.

## O desenho

### Painel do app

```
┌ Simplifica IF  Início  Explorar        [Buscar ⌘K]  (◐ 2)  ● ? ⚙ ┐
├────────────────────────────────────────┬───────────────────────────┤
│ Revisar um PPC · Téc. Enfermagem        │ Ler  Conversar  Pasta  ⌘K │
│ ▾ Carga horária do estágio              │ ← →  Res. CNE/CP 2/2026 ⤢✕│
│   "…160 horas…"   [norma] [Conversar]   │ Art. 28. …▓▓ trecho ▓▓…   │
└────────────────────────────────────────┴───────────────────────────┘
```

- **Estado:** um `ControlePainel` no `ContextoApp`, no molde do `ControleConversa` (`obter`/`observar`). Guarda:
  - se está aberto e a aba;
  - o `Historico` de links (`leitor/historico.ts`);
  - a conversa da aba Conversar;
  - se está preso como coluna;
  - os documentos marcados.
- **Onde:** a `ColunaLateral` com o painel é montada uma vez em `routes/__root.tsx`, ao lado do `<Outlet />`. A conversa e a revisão deixam o `useState` local e chamam o painel.
- **Erro de uma tela:** hoje o `errorComponent` da rota raiz (`__root.tsx:21-26`) troca a moldura inteira. O `<Outlet />` ganha uma `CatchBoundary` própria, para que o erro de uma tela fique na área dela, com o painel, o cabeçalho e a bandeja de pé.
- **Abas:**
  - **Ler:** o `PainelLeitura` de hoje, com voltar e avançar próprios, ⌘F e "⤢ abrir em tela cheia", que leva a `/explorar/ver`.
  - **Conversar:** [a conversa ao lado](#conversa-ao-lado).
  - **Pasta:** a `PainelPasta` de hoje. Mostra a pasta da conversa da aba Conversar; se essa aba está vazia, a da conversa da tela. "Pasta da tarefa", na tela cheia, abre a da conversa da tela; com as duas conversas, a aba diz de qual é a pasta e leva à outra.
  - **"Buscar na base" (⌘K):** um botão com rótulo, não só a lupa, que abre a paleta, com os resultados indo para o Ler. A lupa fica para a busca no texto (⌘F) do documento aberto.
- **Documentos marcados:** um marcador no cabeçalho do Ler guarda o documento numa prateleira de até cinco itens, para voltar com um clique. É o substituto modesto das abas.
- **Três ícones diferentes para três coisas diferentes:**
  - marcador para guardar um documento;
  - "prender ao lado" para a sobreposição virar coluna;
  - alfinete só para o "sempre por cima" do modo compacto.
- **Largura e forma:**
  - A largura segue na `ColunaLateral` (`localStorage`, por computador; perdê-la na troca de origem entre o desenvolvimento e o pacote não pesa).
  - Quando a tela principal ficaria com menos de 760 px, o painel vira sobreposição, com sombra, por cima da tela. "Prender ao lado" o fixa como coluna, e o app lembra essa escolha.
  - As telas passam de breakpoints de janela a *container queries*: os `min-[960px]` de `Leitura.tsx` (linhas 273 a 311) e o `md:flex` de `conversa.tsx:342`, como o leitor já faz (`leitor/pecas.tsx:161`).
- **Sobreposição e teclado:**
  - Ao abrir, o foco vai ao painel; ao fechar, volta ao ponto de origem.
  - Esc fecha primeiro o menu ou a busca no texto, e só depois recolhe o painel.
  - Sem `aria-modal`, porque `BuscaPainel.tsx:76` desliga o ⌘F da tela quando há um modal.
- **Onde um link abre:** uma só função `abrirLink(link, onde)` no contexto. Ela substitui as quatro de hoje (`conversa.tsx:376`, `Leitura.tsx:298`, `ver.tsx:70`, `Paleta.tsx:144`) e os `<Link to="/explorar/ver">` do Explorar (`explorar/componentes.tsx`, `LinhaDoTempo.tsx`, `routes/explorar/reuniao.tsx`, `consepe.tsx`).
  - **Na revisão e na conversa,** clique e ↵ na paleta abrem no painel. **No Início e no Explorar,** abrem na tela, porque lá não há o que manter.
  - **⌥-clique (Alt no Windows) e ⇧↵ na paleta** abrem no outro lugar. A dica fica escrita na linha do resultado. Não se usa ⇧-clique: no Chromium ele abre janela nova e, no leitor, estende a seleção. Com as várias janelas (etapa 10), ⇧⌘-clique (Ctrl+Shift+clique) abre uma janela do app, e o ⇧-clique ou ⌘-clique num link do app, que o Chromium trataria como janela nova, também.
  - **No modo compacto,** todo link abre no painel, também o ⌥-clique; só o botão que pede a tela a abre.
  - **A rota de uma atividade** (a bandeja, o aviso do sistema) que é a conversa da aba Conversar abre no painel, sem tirar a pessoa da tela nem do modo compacto.
  - **As reuniões do Consepe não têm link `ifpr://`** (`Paleta.tsx:54-60`) e continuam abrindo em `/explorar/reuniao`.
  - **O "Abrir ao lado" de hoje da revisão** (o PPC no Ler, `CabecalhoDocumento.tsx`) vai para o menu ⋯ e para o "Ver no PPC" de cada pendência.
- **Atalhos,** todos também no menu Ver (`menu.ts`):
  - ⌘K / Ctrl+K: busca;
  - ⌘\ / Ctrl+\: mostra e esconde o painel;
  - ⌘J / Ctrl+J: a aba Conversar com o contexto da tela; na paleta, leva o texto digitado como pergunta. Tem `preventDefault`, porque no Chromium o Ctrl+J abre os downloads.

  A detecção de macOS hoje é feita de dois jeitos (`Paleta.tsx:50`, `BuscaPainel.tsx:31`) e passa a ser uma só.

### Conversa ao lado

```
│ ▾ Carga horária do estágio          ║ Ler  [Conversar]  Pasta  ⌘K ⤢ ✕ │
│   [Conversar sobre esta pendência] ─╫▶ ┌ vai junto ──────────────────┐ │
│                                     ║  │ 📄 PPC Téc. Enfermagem   ✕  │ │
│                                     ║  │ ◆ Pendência: estágio     ✕  │ │
│                                     ║  │ ⚖ Res. 2/2026, art. 28   ✕  │ │
│                                     ║  └─────────────────────────────┘ │
│                                     ║  [ Pergunte…            Claude ➤]│
```

- **Controles por id.** Um `GerenteConversas` no `ContextoApp` devolve um `ControleConversa` por conversa, com contagem de referências; a rota `/conversa` e o painel pegam o seu. O redutor (`conversa/estado.ts`) não muda.
  - Soltar a última referência só para de acompanhar; nunca encerra a sessão, que se libera pela ociosidade do servidor. Hoje `ControleConversa.nova()` encerra (`ControleConversa.ts:245-251`).
  - "⤢" leva a conversa à tela cheia. A aba Conversar passa a dizer "Aberta na tela cheia", com "Trazer de volta".
- **A vista.** A `Conversa`, o `Compositor` e os itens (`routes/conversa.tsx:60-334`) viram uma `VistaConversa`, que recebe o controle por prop e é usada na rota e no painel.
  - A aprovação de `ItemConversa.tsx` e o `ApagarConversas.tsx` deixam de usar o controle único.
  - Apagar a conversa que está no painel solta o controle, e a aba mostra "Conversa apagada".
  - A `VistaConversa` trata o `AvisoNaoAceito` como a `FaixaIa.tsx` já faz, sem perder o texto nem as fichas.
- **De onde nasce:**
  - "Conversar sobre esta pendência", na `LinhaPendencia` da revisão, que retoma a conversa da revisão (decisão 12);
  - "Perguntar sobre este trecho", na barra que aparece ao selecionar texto no leitor, ao lado de "Copiar citação". O dispositivo é o do começo da seleção, e a barra também funciona com seleção por teclado e não sai da borda do painel;
  - "Perguntar à IA sobre isto", no Explorar, que deixa de navegar;
  - "Perguntar à IA", na última linha da paleta;
  - ⌘J.
- **Fichas de contexto (opt-out).** Acima da caixa ficam fichas do que está na tela, já incluídas e removíveis, cada uma por teclado ("Tirar o PPC do contexto"). Depois do envio, aparecem na mensagem gravada.
  - **Na revisão:** o PPC inteiro, a pendência em foco (o texto dela, o trecho do PPC e a ficha da revisão) e o documento aberto no Ler, se houver.
  - **No leitor:** o documento aberto e o trecho selecionado. Um link da base vira ficha de link `ifpr://`, que a IA lê pelas ferramentas `ifpr`. O link `ifpr://revisao-ppc/…` não é da base (`modulos/revisao-ppc/lista.ts:40`) e vira a ficha do PPC em revisão.
- **Como o PPC vai à IA.** A IA não enxerga o PPC em revisão: ele vem por RPC (`revisaoPpc.documento`), não pelo MCP `ifpr`, que só lê a base. A revisão não tem pasta de trabalho: a cópia comentada fica ao lado do original (`RevisorPpc.ts`).
  - O módulo ganha `revisaoPpc.conversarSobre(lista, chave)`. Ele cria a pasta da conversa (`PastasTrabalho.criar`, "PPC <curso> – conversa") e grava nela o Markdown da versão em revisão, com um sumário de seções e linhas no topo, e a nota com o caminho do `.docx`.
  - Para gravar, o núcleo ganha `PastasTrabalho.gravar(pasta, nome, bytes)`, sem seguir link. Hoje ela só tem `criar`, `anexar` (arquivo liberado pelo desktop), `gravarRelato` e `gravarDiagnostico`.
  - O primeiro pedido diz à IA para ler o Markdown inteiro antes de responder, começando pela seção da pendência.
  - Quando a lista muda, o módulo regrava o Markdown antes da próxima mensagem, e a ficha diz "atualizado às 14:32".
  - O módulo chama o núcleo, nunca o contrário (decisão 7 do [plano das tarefas](tarefas.md)).
- **A IA da conversa:** ver a decisão 11. Pode-se trocar na caixa antes do primeiro envio.
- **Origem.** Na lista de conversas, a conversa ao lado leva a origem ("da revisão do PPC de Enfermagem"), gravada como rótulo e rota. Se a revisão for apagada, a origem passa a "revisão apagada".

### Em andamento

```
[Buscar ⌘K]  (◐ 2 ▾)  ● ? ⚙
             ├ ◐ Conversa "Estágio e a 2/2026"   respondendo há 40 s
             ├ ◐ Revisão PPC Enfermagem          IA: 7 de 12 temas
             ├ ? Conversa "Calendário 2027"      quer gravar "minuta.docx" na pasta [Permitir] [Negar]
             └ ● Conversa "Fundamentação"        resposta pronta
```

- **Servidor:** o serviço `Atividades`, do núcleo, com o fluxo `atividades.acompanhar`, que manda o retrato inicial e depois os eventos. Hoje não existe `PubSub` geral: há um por conversa viva.
  - `Conversas` publica nele explicitamente cada mudança: começo e fim de turno, pedido e decisão de aprovação, erro de cota, apagar. Os pedidos de aprovação pendentes ficam em memória.
  - O módulo da revisão publica o andamento da leitura com IA. O núcleo não importa o módulo.
  - Cada atividade traz um título, uma rota opaca (para onde o clique leva) e, no máximo, ações do núcleo (Permitir e Negar). "Pausar" a leitura fica na tela da revisão.
- **Visto:** a interface marca a conversa como vista ao exibi-la (`conversa.marcarVista`). "Resposta pronta" é a que terminou depois da última vez em que foi vista.
- **Web:** um `ControleAtividades` no contexto; o botão fica no cabeçalho (`__root.tsx`), ao lado do `IndicadorConexao`, com `aria-expanded`. A `ListaConversas` passa a reagir a ele.
  - Itens navegáveis por setas.
  - Uma região `aria-live="polite"` anuncia "resposta pronta" e "a IA pede permissão".
- **Aprovação sem trocar de tela.** O pedido de aprovação de uma conversa em segundo plano aparece na bandeja com o mesmo texto da conversa (o que a IA quer gravar ou executar) e Permitir e Negar. Pela política de fábrica, só escrita e comandos pedem aprovação (`app-simplifica-if.md`, "Política de fábrica").
- **Aviso do sistema:** `Notification` no processo principal, por um canal novo da ponte. As permissões do Chromium continuam negadas (`main.ts:414-419`).
  - Ligado por padrão (decisão 8).
  - O texto diz só "Uma resposta está pronta" ou "A IA pede uma permissão", sem o título da conversa, porque aparece na tela bloqueada.
  - Clicar leva até lá.
  - No Windows, exige `app.setAppUserModelId`. O selo com a contagem é só do macOS (`app.dock.setBadge`); no Windows, `setOverlayIcon`.

### Limite da assinatura

- **Quando aparece:** só no limite de uso. A falha de cota é reconhecida em `packages/motor/src/falhas.ts`. Ela vira um cartão na conversa ("O Claude chegou ao limite da sua assinatura") e um item na bandeja. O "serviço fora do ar" (`indisponivel`), que hoje o julgamento da revisão junta ao limite (`julgamento.ts:69`, `ehLimite`), tem outro texto e não oferece troca de IA. O horário em que o limite volta só aparece se o provider o informar.
- **Na conversa:** o cartão oferece "Continuar com ChatGPT" e "Continuar com Gemini", com as IAs instaladas e conectadas. Continuar abre uma conversa nova com a outra IA, numa entrada nova de `conversa.iniciar` (`continuaDe: id`), na mesma pasta e com as mesmas fichas.
  - O histórico vai numa ficha visível e removível: "Histórico da conversa com o Claude (12 mensagens; as mais antigas ficam de fora)". Não vai escondido no contexto, como na retomada sem sessão de hoje (`Conversas.ts`, `contextoDoHistorico`, cortada em 24 mil caracteres).
  - A última pergunta vai escrita na caixa, não enviada.
  - A conversa antiga ganha a linha "Continuada com o ChatGPT", com o link.
- **Na revisão:** a faixa da IA oferece a mesma troca (decisão 4).
  - Um RPC novo do módulo, `revisaoPpc.continuarIaCom(lista, provider)`, troca a IA da leitura pausada e lê só os blocos que faltam. Hoje a leitura tem uma IA só, e `ligarALista` recusa outra leitura com uma pausada (`RevisaoIa.ts`).
  - Cada bloco grava a IA que o leu, e a pendência da IA mostra "julgada pelo Claude" ou "pelo ChatGPT".

### Modo compacto ao lado do Word

```
┌──────────── Word: PPC_Enfermagem.docx ───────────┐┌ Simplifica IF ⤢📌┐
│ 3.4 Estágio supervisionado                       ││ 12 pontos · 3 ✓  │
│ O estágio terá carga de 160 horas…               ││ ✓ Salvo às 14:32 │
│                                                  ││ ▾ Carga estágio  │
│                                                  ││   [Feito]        │
│                                                  ││ [Pergunte…    ➤] │
└──────────────────────────────────────────────────┘└──────────────────┘
```

- **Entrada:** "Acompanhar no Word", junto do "Abrir no Word" do cabeçalho da revisão (`CabecalhoDocumento.tsx`). Abre o documento acompanhado e liga o modo; ⤢ volta ao app inteiro.
- **Desktop (núcleo):** um canal da ponte, `janela.compacta(ligar)`. É capacidade da janela, não da revisão; a revisão só a pede.
  - **Ao ligar:**
    - guarda as medidas;
    - sai de maximizado ou de tela cheia;
    - troca o tamanho mínimo (`setMinimumSize`);
    - encosta a janela, com cerca de 380 px, na borda direita da área útil da tela em que ela está (`screen.getDisplayMatching`), com a altura toda;
    - liga o "sempre por cima" (decisão 10), com `setAlwaysOnTop(true, "floating")`. Fica por cima do Word em janela, não do Word em tela cheia: o `setVisibleOnAllWorkspaces` com `visibleOnFullScreen` tira o app do Dock e do ⌘Tab no macOS. A decidir no piloto.
  - **Ao desligar:** desfaz tudo e restaura as medidas.
- **A moldura compacta:** a moldura reage a um estado `janelaCompacta`, do núcleo, e não à rota.
  - Mostra só o título da revisão, ⤢ e o alfinete.
  - Respeita os semáforos do macOS e o `titleBarOverlay` do Windows (`janela.ts`, `index.css`, `data-botoes`), que tomam boa parte dos 380 px.
- **Web (módulo):** `/revisao-ppc?id=…&compacto=1` mostra:
  - o filtro por gravidade e a lista de pendências numa coluna, com uma aberta por vez;
  - o trecho, Feito, Copiar trecho, Norma e Sugerir texto;
  - no rodapé, uma caixa curta da conversa ao lado. A resposta abre na coluna, no lugar da lista, com voltar.
- **O app não mexe no Word.** A pessoa edita o documento acompanhado no Word, e o app só fica ao lado com as pendências. "Copiar trecho" e "Sugerir texto" levam texto para a área de transferência, para colar no Word.
- **Fora:** o app não lê a tela nem a janela do Word, não escreve no documento aberto e não é suplemento do Word.

### Conferência ao salvar

Cada vez que a pessoa salva no Word, o app confere de novo o arquivo, sem clique e sem IA, e a lista se atualiza em poucos segundos: "Salvo às 14:32 · 2 pontos resolvidos, 1 novo". Vale com o app inteiro ou no modo compacto.

- **O arquivo acompanhado** é a cópia comentada que "Acompanhar no Word" grava e abre, ou outro `.docx` que a pessoa escolher pelo diálogo.
  - Fica num campo próprio da lista, sem trocar o arquivo original (`arquivoOriginal`), que sustenta o nome no cabeçalho, a regra da cópia (`seguranca.ts`) e o nome dos arquivos que o app grava.
  - O servidor só lê arquivo liberado pelo desktop (`exigirLiberado`, `RevisorPpc.ts`). Por isso, a cópia comentada que o próprio servidor grava passa a ser liberada por ele. Numa revisão de uma sessão anterior, a liberação se perdeu, e "Acompanhar no Word" pede o arquivo de novo (`escolherArquivoDeNovo`).
  - Enquanto a revisão acompanha um arquivo, "Abrir no Word" abre esse arquivo, sem gerar outra cópia (hoje `gerarCopia` gravaria uma cópia da cópia, com os comentários em dobro).
- **A operação é própria:** `ListaViva.conferirSalvamento(lista, arquivo)`, e não o `revisarArquivoNovo` de "Enviar a versão corrigida". Esse recusa com a leitura com IA em andamento e apaga a pausada (`ListaViva.ts:13-14`), regrava a cópia e sobe a `versao_copia`.
  - A conferência é a do código: as pendências do código saem do resultado, resolvidas ou abertas, e as que só o arquivo novo aponta entram abertas.
  - Não troca o arquivo da lista, não regrava a cópia, não sobe a `versao_copia` e **não toca na leitura com IA**. Com ela em andamento, o resultado entra depois da mesclagem do bloco, na mesma trava da lista. Pausada, ela continua pausada e retoma de onde estava.
  - O arquivo que parece outro documento (abaixo dos limites de títulos e tamanho de `lerArquivoNovo`) não é conferido. A lista diz "Este arquivo não parece o mesmo PPC" e espera o próximo salvamento.
  - As pendências da IA ficam como estão, porque conferi-las custa tempo e cota. As marcadas "Feito" ganham "Reconferir com a IA" (`revisaoPpc.revisarDeNovo`), por pendência ou todas de uma vez.
- **O fluxo da lista:** hoje a lista só se lê por chamada (`revisaoPpc.lista`), e os fluxos que existem (`revisar`, `acompanharIa`) terminam com o trabalho. O módulo ganha `revisaoPpc.acompanharLista`, que manda a lista a cada mudança e os eventos "conferido às 14:32 · 2 resolvidas, 1 nova" ou "falhou".
- **O vigia** é do módulo e vive enquanto houver um `acompanharLista` aberto (`Effect.acquireRelease`). Ao abrir de novo, compara o SHA-256 do arquivo e confere se ele mudou nesse intervalo.
  - Vigia a pasta, não o arquivo, porque o Word salva trocando o arquivo.
  - Ignora os temporários do Word (ver [A conferir](#a-conferir)) e só confere quando o SHA-256 muda.
  - Espera cerca de 2 s sem novas mudanças.
  - Uma conferência por vez; os salvamentos que chegam no meio se juntam, e a última versão vence. Com o autossalvamento do Word 365, no máximo uma conferência a cada 15 s.
  - Na pasta do OneDrive ou de rede, onde `fs.watch` falha, confere também quando a janela ganha foco, comparando o SHA-256.
  - Testes com `TestClock` e um `FileSystem.watch` falso, sem `sleep`.
- **A interface:** a lista mostra uma linha do que mudou. A pendência que o código deu por resolvida sai riscada, com um realce breve, e a que o arquivo novo trouxe entra marcada "novo". Se a conferência falhar (arquivo corrompido, `.docx` incompleto no meio do salvamento), a linha diz isso e espera o próximo salvamento.
- **A conversa ao lado** recebe o Markdown regravado (decisão 9).

### Comparar normas

```
┌ Comparar  Res. CNE/CP 1/2021 (em vigor) ⇄ Res. CNE/CP 2/2026 (aguardando publicação) ┐
│ ⚠ Correspondência em rascunho, sem revisão jurídica: indicação, não fundamento        │
├──────────────────────────────────┬───┬───────────────────────────────────────────────┤
│ Art. 2º …                        │ ≈ │ Art. 1º, § 1º …  /  Art. 1º, § 2º …           │
│ Art. 10. …                       │ = │ Art. 47. … (também corresponde ao art. 11)    │
│ Art. 27. …                       │ − │ (sem correspondente)                          │
├──────────────────────────────────┴───┴───────────────────────────────────────────────┤
│ Novos na 2/2026: Art. 29 …                                                            │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- **O que é.** Uma tela que põe duas normas que se sucedem lado a lado, com o selo de vigência de cada uma (hoje, a 1/2021 em vigor até a 2/2026 ser publicada). No meio, a relação de cada linha, nos termos da tabela:
  - = equivalente, que pode ter a redação mudada;
  - ≈ parcial, com a nota da tabela;
  - − sem equivalente;
  - \+ novo.
- **De onde vem o alinhamento.** Da tabela de `base-conhecimento/correspondencias/`, hoje uma, a 1/2021 → 2/2026 (`br-cne-cp-res-2021-1--br-cne-cp-res-2026-2.yaml`, 168 itens).
  - Sem tabela, não há "Comparar": o app não alinha normas por conta própria, nem com IA.
  - O aviso de rascunho fica fixo no topo enquanto a tabela tiver `status: rascunho`.
- **A ordem é a da origem.** A tabela tem 22 itens 1→N, 26 destinos com mais de uma origem e mais de cem inversões de ordem, então nenhuma lista segue os dois textos ao mesmo tempo.
  - Uma linha por item da origem, na ordem dela. O dispositivo sem item próprio herda o do ancestral mais próximo, como em `correspondenciaEm`.
  - **1→N:** os destinos empilham na célula direita.
  - **N→1:** o destino se repete, com "também corresponde ao art. X".
  - **Novos:** "novo" se calcula por artigo do destino, e é o artigo que nenhum item aponta, nem por um dispositivo dele. Os novos vão para o fim, em "Novos na 2/2026", na ordem do destino.
  - **Artigo detalhado só pelo caput** (fora dos arts. 16, 20, 24, 25 e 26 da origem): a célula mostra o caput e "17 incisos", com link para o leitor.
  - Por ser uma lista de linhas numa rolagem só, não há dois documentos a sincronizar.
- **O que mudou.** Num par, só as palavras que mudaram levam o grifo, com os tokens de `index.css` (e a regra `.dark`), sem o verde e vermelho de programador. Acima de cerca de 60% de palavras mudadas, o grifo por palavra sai e o par aparece inteiro. "Só o que mudou" esconde os pares de texto idêntico depois de normalizar, não os `equivalente`.
- **Entradas:**
  - no leitor de uma norma que tem tabela, como origem ou como destino: "Comparar com a sucessora" ou "Comparar com a anterior";
  - no Ler do painel;
  - na paleta.
- **Perguntar à IA sobre a diferença.** Em cada linha, abre a conversa ao lado com os dois dispositivos como fichas, os links `ifpr://`.
- **Arquitetura:**
  - **`packages/kb`:** uma função pura `alinhamentoEm(tabela, fonte)` em `normas/correspondencia.ts`, com as regras acima, e a diferença palavra a palavra, outra função pura.
    - Hoje `FonteCorrespondencia` só traz os artigos da origem, sem ordem nem descendentes (`correspondencia.ts:104-111`, carregada em `db/consultas-normas.ts`). Ela passa a trazer os dispositivos ordenados das duas normas, com tipo, rótulo e pai.
  - **Servidor:** um RPC de leitura da base que chama a função; a interface não lê a tabela.
  - **Web:** a rota `/explorar/comparar?a=…&b=…`.
  - **Dependências:** nenhuma de MCP, IA ou do leitor de vários documentos, porque a tela mostra o texto dos dispositivos, não dois `Documento`. Só o "Perguntar à IA" depende da conversa ao lado.
- **Depois:** comparar dois PPCs por seção, e o PPC em revisão contra um PPC semelhante da base. Pede alinhamento de seções, que hoje é heurístico.

### Continuidade

- **Ao reabrir, voltar onde se estava:** a última rota e o estado do painel (aba, trilha, documentos marcados, conversa), nas preferências do servidor (`persistencia/Preferencias.ts`).
  - Grava-se com espera de 1 s depois da navegação e no `before-quit`.
  - Só voltam `/`, `/explorar/*`, `/conversa?id` e `/revisao-ppc?id` que ainda existam; o resto volta ao Início. Nunca voltam o `compacto=1` e os formulários de `/tarefa/$nome`.
- **Revisão apagada:** a trilha, os documentos marcados e a continuidade descartam os links `ifpr://revisao-ppc/…` dela, com "Esta revisão foi apagada". A prévia do apagar (`DialogoApagar`) lista também a pasta da conversa ao lado com o Markdown do PPC, que a pessoa pode apagar junto.
- **Várias janelas:** só a janela principal grava e volta; as outras não. Fechada a principal, a próxima janela aberta passa a gravar, sem voltar (etapa 10).
- **Rolagem lembrada** por documento e pela revisão. É a sobra "guardar a rolagem ao voltar" do [plano do app](app-simplifica-if.md) ("Leitor e Explorar, sobras"), que sai de lá quando entrar aqui. O `scrollRestoration` continua desligado no roteador (`router.ts:9`); guarda-se por chave de documento.
- **"Continuar de onde parou" no Início:** o que está rodando, o que terminou sem ser visto e o que ficou aberto, a partir das atividades. O cartão da revisão continua a `UltimaRevisao` que o Início já compõe (`routes/index.tsx`).

### Persistência

Mudanças no `conversas.sqlite`, cada uma numa migração nova registrada em `Banco.ts`, com teste de upgrade em `apps/server/test/migracoes.test.ts`:

- **Núcleo:**
  - em `conversas`, a origem (rótulo e rota), o `vista_em` e a continuação (`continua_de`);
  - as fichas no item `Mensagem` (`packages/contratos-app/src/conversa.ts`), gravadas nos dados do evento.
- **Módulo** (a migração chama uma função do módulo e entra na lista dos arquivos de composição):
  - o arquivo acompanhado e o SHA-256 da última conferência;
  - a IA de cada bloco e de cada pendência da leitura com IA.
- **Preferências:** o estado do painel e a última rota.

### Dados e aviso de uso

- **O texto do aviso de uso** (`AvisoUso.tsx`) passa a dizer "o que você escreve, anexa ou deixa nas fichas de contexto". Também diz que continuar com outra IA leva o histórico e as fichas a outra empresa. Entra na revisão do aviso pelo encarregado de dados (decisão em aberto 7 do [plano do app](app-simplifica-if.md)).
- **A notificação** não mostra o título da conversa (ver [Em andamento](#em-andamento)).

### Depois

- **Comparar PPCs** por seção (ver [Comparar normas](#comparar-normas)).
- **Trilha em colunas** no Ler, para as remissões em cadeia (norma → norma citada → outra), só se o uso pedir.

## Etapas

Cada etapa termina com `pnpm fmt && pnpm lint && pnpm typecheck && pnpm test` e com teste de navegador do cenário que ela resolve. Quando a etapa tocar neles, também:
- `apps/web/test/ingles.ts`, sem termos em inglês nos textos novos;
- o teste de fronteira (`ferramentas/oxlint-plugin/test/fronteira-repositorio.test.ts`);
- o de migrações;
- testes Effect com `TestClock`.

1. **O painel, primeiro passo.**
   - O `ControlePainel` só com o Ler, usado na revisão (`Leitura.tsx:70`), e a paleta abrindo nele.
   - Não depende do leitor de vários documentos, porque a tela da revisão não tem `Documento`; só o painel tem.
   - Teste: na revisão, ⌘K, "Res. 2/2026", ↵; a norma abre ao lado e a revisão continua na tela.
   - Implementada em 27/11/2026: `painel/ControlePainel.ts` (aberto e trilha, `obter`/`observar`) no `ContextoApp`, `painel/PainelDoApp.tsx` montado em `routes/__root.tsx` ao lado do `<main>` (recolhido em `/conversa` até a etapa 3), a revisão usando o painel (`useApp().painel`, sem assinar o estado) no lugar do estado local, apagar a revisão tirando o PPC dela da trilha (`esquecerLinks`) e da memória das leituras, e a paleta abrindo no painel numa tela de trabalho (a revisão se declara por `useTelaDeTrabalho`, e o núcleo não cita a rota dela), com ⇧↵ para a tela. Teste em `modulos/revisao-ppc/fluxo.browser.test.tsx`.
2. **Leitor para mais de um documento.** Vem antes de qualquer "Abrir ao lado" que ponha dois documentos na janela.
   - `IR_PARA` e `MONTAR_TUDO` por instância (contexto do leitor), no lugar de `window`, também em `Leitor.tsx:204`.
   - **Destaques:** um registro por nome de `CSS.highlights` que junta as faixas de todas as instâncias, mantendo os nomes fixos que o `index.css` estiliza.
   - **⌘F:** vale para o leitor em foco.
   - **Âncoras e `id`:** a `FaixaTrecho`, `ver.tsx:68` e as âncoras de `Markdown.tsx:40` resolvidas dentro do contêiner, e os `id` de dispositivo com prefixo por instância.
   - **Impressão:** só a instância que pediu.
   - **Cache:** um cache de documento compartilhado (`MemoriaLeitor`), que invalida na reconexão, como o `explorar/indice.ts`.
   - Teste de navegador com a mesma norma na tela e no painel: busca, ⌘F, faixa do trecho e âncora em cada um.
   - Implementada em 27/11/2026: `leitor/instancia.ts` (eventos `irPara` e `montarTudo` por instância, prefixo de `id`, raiz `data-leitor` e `imprimirLeitor` com `data-imprimir` no `index.css`), `leitor/destaques.ts` (as faixas somadas por nome), o ⌘F do leitor em foco ou do último usado (`BuscaPainel.tsx`), e a `MemoriaLeitor` única por conexão (`memoriaDa`, posta na moldura). O painel usa o prefixo `painel-`; a página do Explorar, nenhum. O ⌘P (ou o menu) imprime só o leitor em foco ou o último usado, e só ele monta o texto inteiro (`raizAImprimir`); "Imprimir" no painel sem texto pronto não imprime. Teste em `leitor/dois-leitores.browser.test.tsx` (com a âncora `#…` e a nota de rodapé) e em `leitor/carga.test.ts`.
3. **O painel completo.**
   - As abas Conversar (vazia até a etapa 5) e Pasta, o "Buscar na base" e os documentos marcados.
   - A conversa usa o painel, e a regra "trocar de conversa fecha o painel" sai.
   - `abrirLink` único, com ⌥-clique e ⇧↵, e "Abrir ao lado" no Explorar.
   - Coluna ou sobreposição, com *container queries* na revisão e na conversa.
   - A `CatchBoundary` do `<Outlet />` e os atalhos no menu.
   - Implementada em 27/11/2026: o `ControlePainel` com a aba, os documentos marcados (`marcar`/`desmarcar`, até cinco, um por documento, que saem com `esquecerLinks`) e "Prender ao lado" (`prender`, guardado no `localStorage` por computador, como a largura, até a etapa 7 levar o estado do painel às preferências); `painel/PainelDoApp.tsx` com as abas Ler (o `PainelLeitura` com o marcador, a prateleira e "Abrir em tela cheia"), Conversar (só o texto do lugar) e Pasta (a `PainelPasta` da conversa da tela, sem o cabeçalho próprio), "Buscar na base" e fechar; coluna ou sobreposição pela largura medida da linha da moldura menos a do painel (`MINIMO_TELA`, 760 px; largura padrão `min(40rem, 38vw)`, 519 px no notebook), com o foco ao abrir e de volta ao fechar, e, por cima, Esc e o clique fora (o que não mexeu no painel) recolhendo, sem `aria-modal`; `painel/abrirLink.ts` (`useAbrirLink`, `OndeAbrir`, `ondeDoClique`) no lugar da conversa, do `Leitura.tsx`, do `ver.tsx` (com "Abrir ao lado"), da paleta (⇧↵ e Alt+clique no outro lugar, com a dica na linha também fora da tela de trabalho), do Comparar e dos links do Explorar (`painel/LinkDaBase.tsx`); a conversa usa o painel do app (tela de trabalho, sem a regra de fechar ao trocar de conversa) e "Pasta da tarefa" abre a aba Pasta; `@container/tela` no `<main>`, com `@min-[960px]/tela:` na revisão e `@3xl/tela:` na barra de conversas; o "Abrir ao lado" da revisão foi para o ⋯ ("Abrir o PPC ao lado"); a `CatchBoundary` do `<Outlet />`, que se refaz ao mudar de endereço; Ctrl/⌘+\ na moldura e, no desktop, "Buscar na base" e "Mostrar ou esconder o painel" no menu Ver (`registerAccelerator: false`, pelo canal `atalhoDoMenu` da ponte); a detecção do macOS em `lib/teclado.ts`. Teste em `painel/painel.browser.test.tsx` (Explorar com ⌥-clique, ⇧↵ e "Abrir ao lado"; sobreposição em 1093 × 614 com Esc, clique fora e "Prender ao lado" lembrado; erro numa tela com o painel aberto; documentos marcados; a conversa com o painel do app e a aba Pasta) e em `painel/ControlePainel.test.ts`.
4. **Conferência ao salvar.** Antes, os pontos de [A conferir](#a-conferir).
   - `ListaViva.conferirSalvamento`, `revisaoPpc.acompanharLista`, o vigia e o arquivo acompanhado, com a liberação e a migração do módulo.
   - "Acompanhar no Word" ainda sem o modo compacto.
   - Testes: com a leitura com IA pausada e em andamento, e o vigia com `TestClock`.

   É a de maior valor para quem revisa e não depende do painel.
   - Implementada em 27/11/2026: `ListaViva.conferirSalvamento` (o arquivo salvo convertido e conferido de novo sobre a mesma lista, com a linha do que mudou), `ListaViva.acompanhar` e `ListaViva.verificarAcompanhado` (o sha256 decide se houve salvamento); os RPCs `revisaoPpc.acompanharLista` (o fluxo de mudanças da lista acompanhada) e `revisaoPpc.conferirAcompanhado`; o vigia (`modulos/revisao-ppc/vigia.ts`: vigia a pasta, ignora os temporários do Word e dos outros editores, espera 2 s sem mudança, uma verificação por vez e no mínimo 15 s entre conferências, e para com registro no log onde o `watch` falha); a migração 3 (`arquivo_acompanhado`, `sha256_conferido`, `codigo_conferido`); a liberação da cópia pelo servidor (`liberarCopia`), para a ponte abrir no Word o `.docx` acompanhado; "Acompanhar no Word" no cabeçalho, "Acompanhar outro arquivo…" no ⋯ e "Reconferir com a IA" para os critérios que a mudança tocou (`Acompanhamento.tsx`). Regras decididas: (a) o "Feito" da pessoa se mantém a cada salvamento se o ponto e o texto não mudaram, e reabre, com registro no histórico, se o texto mudou; (b) "Enviar a versão corrigida" com outro arquivo encerra o acompanhamento; (c) a interface confere ao focar a janela pelo evento `focus`, sem canal do desktop. O A conferir 1 está resolvido (a cópia comentada converte igual ao original, com as mesmas pendências; teste em `packages/ppc/test/revisao-previa.test.ts`); o 2 e o 3 dependem do Word real (o vigia tem filtro defensivo e confere pelo sha256). Testes em `apps/server/test/modulos/revisao-ppc/` (`lista-viva`, `vigia` com `TestClock`, `revisao-ppc`), em `migracoes.test.ts` e em `modulos/revisao-ppc/acompanhar.browser.test.tsx`.
5. **A conversa ao lado.**
   - `GerenteConversas` e `VistaConversa`, com `ItemConversa` e `ApagarConversas`.
   - A aba Conversar, as fichas de contexto e `revisaoPpc.conversarSobre` com `PastasTrabalho.gravar`.
   - As entradas: pendência, trecho, Explorar, paleta e ⌘J; a origem na lista; o texto do aviso de uso.
   - A migração das fichas e da origem.
   - Teste: a ficha removida não deixa arquivo na pasta.
   - Implementada em 27/11/2026: `conversa/GerenteConversas.ts` (um `ControleConversa` por conversa, com contagem de referências; soltar a última só para de acompanhar, sem encerrar a sessão; a IA escolhida por último; as conversas apagadas), no `ContextoApp` no lugar do controle único (`useControleConversa`, `useEstadoConversa`), e o `ControleConversa` de uma conversa só (sem `nova()`; `enviar` com as fichas, devolvendo `avisoNaoAceito` sem item na conversa); `conversa/VistaConversa.tsx`, usada na rota `/conversa` e na aba Conversar (`painel/AbaConversar.tsx`: o rascunho com a IA trocável até o envio, ⤢ com "Aberta na tela cheia" e "Trazer de volta", "Nova conversa", "Conversa apagada" e o aviso de uso não aceito sem perder o texto nem as fichas); `ItemConversa` (a aprovação pelo controle da vista) e `ApagarConversas` (`GerenteConversas.apagada`) sem o controle único; as fichas (`FichaContexto`: link, arquivo e texto, no contrato; `conversa/FichasContexto.tsx`, removíveis pelo teclado, gravadas na mensagem e mandadas à IA num bloco depois do texto, `textoDasFichas`); o `ControlePainel` com a conversa ao lado (fichas, ofertas, texto, origem com `preparar`, uma conversa por origem) e o contexto da tela (`declararContexto`, ⌘J). Núcleo: `PastasTrabalho.gravar`, `Conversas.iniciar` com origem e `mudarOrigem`, a origem na lista de conversas (rótulo e "Ir para a origem"). Módulo: `ConversaAoLado` (`revisaoPpc.conversarSobre`: a pasta "PPC <curso> – conversa", o Markdown com sumário de seções e linhas e a nota com o `.docx`, gravados no envio e só com a ficha, regravados quando o texto muda, com "atualizado às HH:MM" na ficha; o `.docx` pela ficha "Anexar o .docx"; `apagarLista` passa a origem a "revisão apagada"), o texto do último arquivo conferido guardado na conferência ao salvar (`markdown_conferido`), `conversaAoLado` na lista e, no web, `modulos/revisao-ppc/conversa.ts` (as fichas da revisão, a IA dela e o aviso da leitura com IA em andamento; o link `ifpr://revisao/…` vira a ficha do PPC, pela composição em `inicializar.ts`). Entradas: "Conversar sobre esta pendência" (`LinhaPendencia`), a barra da seleção no leitor (`leitor/BarraSelecao.tsx`, com o dispositivo do começo da seleção), "Perguntar à IA sobre isto" sem navegar, a última linha da paleta e ⌘J nela, ⌘J/Ctrl+J na moldura e no menu Ver (`conversar`), e "Perguntar à IA sobre a diferença" no Comparar. A prévia do apagar da revisão lista a pasta da conversa ao lado, que pode ir à Lixeira; o aviso de uso cita as fichas. Migração 4 (`origem_rotulo`, `origem_rota`; no módulo, `conversa_id`, `conversa_pasta`, `markdown_conferido`). Fica para a etapa 6 a frase do aviso sobre continuar com outra IA. Testes em `painel/conversa-ao-lado.browser.test.tsx`, `painel/ControlePainel.test.ts`, `modulos/revisao-ppc/apagar.test.ts`, `apps/server/test/modulos/revisao-ppc/lista-viva.test.ts` (a conversa ao lado), `conversas.test.ts` (as fichas) e `migracoes.test.ts`. Depois das revisões: o estado do painel é só dado (a origem é `{ chave, ia }`; quem prepara cada mensagem e dá o aviso reativo da leitura com IA é o módulo, por `OrigensConversa` no contexto do app, `origensDaRevisao`); a pendência só guia a instrução se a ficha dela ficou ("começando pela seção"), e a instrução fica à vista na ficha da mensagem gravada, que abre por teclado; o Markdown tem nome fixo (`PPC em revisão.md`) e é regravado no servidor logo depois de toda escrita que troca o texto da lista (a conferência ao salvar, "Enviar a versão corrigida", "Qual é o curso?", que também leva a origem da conversa à lista nova), se já está na pasta, valha a próxima mensagem do painel ou da tela cheia; `conversarSobre` corre na vez da lista e lê o `.docx` antes de criar a pasta, que sai se a conversa não abre; `PastasTrabalho.gravar` não segue link nem grava o que não mudou e recusa as pastas do app; a conversa ao lado apagada sai da lista ao subir o servidor; a apagada não prende o pedido seguinte; o envio só tira da caixa o que foi e devolve o que não saiu; a IA do rascunho troca com a origem; apagar a revisão esquece a origem no painel, e a opção da Lixeira (também em "Revisões recentes") apaga a conversa ao lado junto com a pasta; "Trazer de volta" volta à tela de onde o ⤢ saiu; o `GerenteConversas` sem vazamentos (`novo` com referência, a apagada sem ninguém sai, a carga depois de soltar não acompanha, `encerrar`) e `useControleConversa` por `useSyncExternalStore`; a barra da seleção abaixo da seleção na primeira linha, Tab e Esc, a cópia que falha, o dispositivo só no clique; "Conversar sobre esta pendência" não junta a pendência que o Ler mostra; o `?pedido=` do Início e das boas-vindas saiu.
6. **Em andamento e limite.**
   - O serviço `Atividades`, `atividades.acompanhar` e `conversa.marcarVista`.
   - A bandeja com a aprovação e a notificação do sistema.
   - O cartão de limite com `continuaDe`, e `revisaoPpc.continuarIaCom`.
   - As migrações do visto, da continuação e da IA por bloco.
   - Testes de servidor com duas conversas e um pedido de aprovação; a notificação pela ponte, com `Notification` falso.
   - Implementada em 27/11/2026: no núcleo, o serviço `Atividades` (`apps/server/src/Atividades.ts`: guarda e distribui, sem republicar o igual) e o grupo `atividades.acompanhar` (`contratos-app/src/atividades.ts`: título, rota opaca, situação `andamento`, `permissao`, `pronta` ou `limite`, a IA e o pedido de aprovação); as `Conversas` publicam o início e o fim do turno, o pedido e a decisão de aprovação (pendentes em memória), a cota, a conversa vista e a apagada, e na partida as que terminaram sem ser vistas (`Historico.naoVistas`, pelo último `FimTurno` depois do `vista_em`); `conversa.marcarVista`; `conversa.iniciar` com `continuaDe` (a pasta e a tarefa da antiga; devolve a `continuacao`: a ficha "Histórico da conversa com o <IA> (N mensagens; as mais antigas ficam de fora)", as fichas da última mensagem e a última pergunta, `continuacaoDe`) e `continuadaCom` no resumo, derivado do `continua_de` da nova. A preferência `avisosDoSistema` (ligada de fábrica, `preferencias.avisarNoSistema`). No módulo, a `PausaRevisao` com `causa` (`cota`, `indisponivel`, `outra`: o `ehLimite` só com a cota; fora do ar ainda para tudo na hora, sem troca de IA), a leitura publicando o andamento ("IA: 7 de 12 partes") e a pausa no limite nas atividades, `revisaoPpc.continuarIaCom` (`RevisaoIa.continuarCom`: troca a IA da leitura pausada e lê só os blocos que faltam), a IA de cada bloco e de cada pendência (`julgadaPor`, "Julgada pelo Claude"). Migração 5 (`vista_em`, as conversas antigas contadas como vistas; `continua_de`; no módulo, `revisao_ppc_blocos_ia.provider` e `revisao_ppc_pendencias_vivas.ia`). Web: o `ControleAtividades` (retrato a cada conexão, o anúncio e o aviso do que passa a pronta ou a pedir permissão, sem anunciar na região viva a conversa que está na tela, e a contagem para o selo), "Em andamento" no cabeçalho (`atividades/EmAndamento.tsx`: popover com `aria-expanded`, setas e Home/End, Permitir e Negar com o texto da conversa, região `aria-live`), a `ListaConversas` com o selo da atividade e recarga quando elas mudam, a vista que marca a conversa como vista, o cartão do limite (`ItemConversa`, "Continuar com ChatGPT/Gemini" com as IAs prontas e não desligadas; a nova abre na tela cheia com a caixa da continuação, ou fica na aba Conversar, `ControlePainel.continuada`) e "Continuada com o <IA>" com o link; a faixa da IA da revisão com "Continuar com…" na pausa por cota; Configurações › Avisos (só no desktop); o aviso de uso diz que continuar com outra IA leva o histórico e as fichas a outra empresa. Desktop: `avisos.ts` (a `Notification` pelo processo principal, pelos canais `avisar`, `selo` e `abrirRota` da ponte; só com a janela sem foco; texto fixo sem o título; o clique traz a janela e manda a rota; o selo só no macOS), `app.setAppUserModelId` no Windows (o `ID_DO_APP`, que o empacotamento passou a importar daqui). Ficam de fora: o critério "janela oculta" do modo compacto (etapa 8); o `setOverlayIcon` do Windows (pede uma imagem de selo); o horário em que o limite volta (nenhum provider o informa no `Erro`); a leitura pausada no limite antes de reiniciar o servidor volta à bandeja só quando a revisão muda. Testes em `apps/server/test/conversas.test.ts` (duas conversas, a aprovação, a resposta pronta até ser vista, o limite, o retrato depois de reabrir e a continuação), `migracoes.test.ts`, `modulos/revisao-ppc/revisao-ia.test.ts` (a cota no meio continuada com o Gemini, com a IA de cada pendência), `apps/desktop/test/avisos.test.ts` (`Notification` e janela falsas) e `apps/web/src/atividades/atividades.browser.test.tsx` (a bandeja com a aprovação, o aviso e o selo pela ponte; o cartão do limite e a continuação). Depois das revisões: a bandeja que esvazia aberta fecha de vez (não reabre sozinha, sem relógio à toa) e as setas partem do item de Permitir e Negar; a conversa só conta como vista com a janela visível e em foco (ou quando a pessoa volta a ela), e a região viva cala só a conversa que uma vista mostra (`GerenteConversas.mostrar`); o primeiro retrato manda o selo, mesmo 0; o acompanhamento recomeça uma vez por conexão, e o segundo pedido de aprovação também se anuncia; o aviso lê as preferências em qualquer tela, desligado até lê-las; `avisoValido` recusa barra invertida, caractere de controle e outra origem, e as notificações guardadas saem no `failed`, com teto; no servidor, `Atividades.atualizar` lê o estado na vez das mudanças (nem a conversa apagada nem a leitura parada voltam à bandeja), a decisão de aprovação e a vista na `travaItens` (sem gravar na conversa apagada), o `fimNaoVisto` antes do `FimTurno`, a apagada deixa de ser a `continuadaCom`; a continuação recusa a conversa que ainda responde, leva a origem e o sem web da antiga, e só a pergunta que parou no limite volta à caixa (o cartão de um limite antigo não oferece outra IA); a conversa ao lado da revisão continuada segue com ela (`ControlePainel.continuada` e `conversarSobre`, pela `continuadaCom`); `continuarCom` só na pausa por cota e troca a IA na vez da lista, depois das conferências; a etapa do bloco não relê o banco para a bandeja; índice em `continua_de` (migração 5); a caixa da continuação guarda o que a pessoa tirou, e os rascunhos saem com a conversa apagada; a revisão pausada atualiza as IAs de "Continuar com…", e a faixa não repete a frase do motivo. Os testes de navegador não param servidores (os arquivos rodam em paralelo): saem com o processo dos testes, que não os espera.
7. **Continuidade.** A última rota e o painel ao reabrir, a rolagem lembrada, a revisão apagada e o "Continuar de onde parou".
   - Implementada em 27/11/2026: no contrato, `Continuidade` (a rota e o `PainelGuardado`: aberto, aba, trilha com até 50 links, até cinco marcados, preso e a conversa da aba Conversar com a origem) em `Preferencias.continuidade` e `preferencias.guardarContinuidade`; no servidor, a chave `continuidade` de `Preferencias.ts` (a que não decodifica conta como ausente). Na interface (núcleo), `continuidade/ControleContinuidade.ts` no `ContextoApp`, ligado pela moldura ao roteador: grava 1 s depois de cada navegação ou mudança do painel (só se mudou), no `pagehide`, no `encerrar` e, no desktop, antes de fechar (o canal `antesDeSair`/`prontoParaSair` da ponte: `apps/desktop/src/antesDeSair.ts` espera a janela até 1 s no `before-quit` e ao fechar a janela, antes de encerrar o servidor); ao abrir, com as boas-vindas feitas, confere o guardado contra o que existe (`continuidade/conferir.ts`: `/`, `/explorar/*`, `/conversa?id` da lista de conversas e a rota que um módulo diz existir; o `compacto=1` sai ao gravar e ao voltar; o resto vai ao Início), volta à rota só se o app abriu no Início e a pessoa não saiu dele, e ao painel só se ela não mexeu nele ("Prender ao lado" volta sempre, e saiu do `localStorage`); o Início espera enquanto decide. O módulo responde pelo que é dele (`modulos/revisao-ppc/continuidade.ts`, pela composição em `inicializar.ts`): a rota `/revisao-ppc?id`, os links `ifpr://revisao/<lista>/…` da trilha e dos marcados e a origem `revisao:<lista>` da conversa ao lado voltam só se a revisão existe; a apagada sai com o aviso "Esta revisão foi apagada" na moldura (`AvisoContinuidade`), e a conversa segue como livre. Apagar a revisão no app já tirava os links e a origem do painel (etapas 1 e 5), e a continuidade grava o painel como ficou; a prévia do apagar lista a pasta da conversa ao lado (etapa 5, conferido). A rolagem lembrada (`lib/rolagem.ts`, só na memória da janela, por chave de documento: `tela:` na página do Explorar, `painel:` no Ler, `revisao:<id>` na tela da revisão pela `Pagina`), reaplicada enquanto o conteúdo chega e até a pessoa mexer; o link com `#` só volta à rolagem lembrada se é o mesmo link; a página nova do Explorar começa do topo; a revisão apagada esquece as dela. "Continuar de onde parou" no Início (`continuidade/ContinuarDeOndeParou.tsx`): as atividades (o que roda, o que pede permissão, o que terminou sem ser visto, o limite), o documento do Ler e a conversa ao lado que ficaram abertos no painel, e a `UltimaRevisao` (que saiu de "Recentes"). Nos testes de navegador, a continuidade vem desligada (`montarApp(…, { continuidade: true })` a liga), para um teste não voltar onde o outro parou. A sobra "guardar a rolagem ao voltar" saiu do plano do app. Testes em `apps/server/test/preferencias.test.ts`, `apps/desktop/test/antes-de-sair.test.ts`, `continuidade/conferir.test.ts`, `painel/ControlePainel.test.ts`, `continuidade/continuidade.browser.test.tsx` (reabrir volta à rota e ao painel, a rota que sumiu vai ao Início, o `compacto=1` não volta, a revisão apagada com o aviso, a rolagem ao voltar de outra tela, "Continuar de onde parou") e `painel/painel.browser.test.tsx` ("Prender ao lado" pelas preferências).
8. **Modo compacto.** O canal `janela.compacta`, a moldura compacta e a vista compacta da revisão. Teste das medidas e da restauração com `BrowserWindow` falso em `apps/desktop/test`.
   - Implementada em 27/11/2026: no desktop (núcleo), `compacta.ts` (`criarJanelaCompacta`: guarda as medidas, o maximizado e a tela cheia; sai da tela cheia esperando o `leave-full-screen`, com 1,5 s de reserva, e do maximizado; mínimo 320 × 400; 380 px na borda direita da área útil da tela da janela, `screen.getDisplayMatching`, com a altura toda; `setAlwaysOnTop(true, "floating")` e, no macOS, `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`; o alfinete `naFrente`; ao desligar, tudo desfeito, as medidas, o maximizado e a tela cheia de volta e o mínimo 800 × 560; um pedido por vez), os canais `janelaCompacta` e `janelaNaFrente` da ponte (`JanelaDesktop.compacta` e `naFrente`), a página que navega (recarregada) devolvendo a janela ao normal (`did-navigate`), e o aviso do sistema no modo compacto só com a janela oculta ou minimizada (`avisos.ts`). Na interface (núcleo), `janela-compacta.ts` (`ControleJanelaCompacta` no `ContextoApp`, `useJanelaCompacta`; sem a ponte, `disponivel` falso e o modo não existe), a moldura compacta em `routes/__root.tsx` (o título que o módulo dá, o alfinete com `aria-pressed` e ⤢ "Voltar ao app inteiro", com `data-botoes`), o painel cobrindo a coluna inteira com "Voltar" no lugar de fechar, `ControlePainel.conversar(pedido, { mostrar: false })` e a `CaixaDaConversaAoLado` (a caixa da aba Conversar fora do painel). No módulo, "Acompanhar no Word" no desktop abre o arquivo (a cópia comentada na primeira vez, o acompanhado depois, e o botão fica para voltar à coluna) e liga o modo; `/revisao-ppc?id=…&compacto=1` mostra a `VistaCompacta` (a dica "Deixe o Word à esquerda", com ⊞+← no Windows; o PPC e "N de M feitas"; "Salvo às… · conferido sem IA" e o que mudou, `linhasConferencia`; o filtro por gravidade, `doFiltro`; a lista com uma aberta por vez, o trecho com "Copiar trecho" e "Ver no PPC", Feito/Desfazer e F, Norma ou Normas no painel e Sugerir texto; "Resolvido ao salvar" e "Novo"; no rodapé, a caixa curta com o PPC e a pendência aberta, cuja resposta abre o painel por cima da coluna). O `compacto=1` sem a janela compacta (⤢ ou a página recarregada) sai da URL, e a revisão volta à tela inteira: a continuidade (etapa 7) não deve guardá-lo. Testes em `apps/desktop/test/compacta.test.ts` (macOS, Windows maximizado, tela cheia, a reserva da espera, a janela fechada), `avisos.test.ts` (o critério do compacto), `modulos/revisao-ppc/compacta.browser.test.tsx` (a coluna inteira com o salvamento e a conversa, a página recarregada com `compacto=1`, o navegador sem o modo), `lista.test.ts` e `acompanhar.browser.test.tsx` (ajustado: ⤢ antes de conferir na tela inteira, e o botão que fica). Depois das revisões: no macOS, sem `setVisibleOnAllWorkspaces` (com `visibleOnFullScreen`, o Electron esconde o ícone do Dock e tira o app do ⌘Tab enquanto o modo vale, e o alfinete fazia o Dock piscar; com `skipTransformProcessType`, a janela de um app comum não aparece por cima de outro em tela cheia): a coluna fica só `setAlwaysOnTop(true, "floating")`, por cima do Word em janela e não do Word em tela cheia, a decidir no piloto (decisão 10); no modo, a janela não se maximiza nem vai à tela cheia (`setMaximizable`/`setFullScreenable`, devolvidos ao desligar), e desligar sai antes do maximizado ou da tela cheia em que ela tenha entrado mesmo assim; a reserva de 1,5 s que vence com a janela ainda em tela cheia não liga o modo (`compacta` devolve se ligou), e a revisão avisa ("saia da tela cheia e clique de novo"); a espera cancela o relógio e o ouvinte que sobram; as medidas restauradas que já não caem numa tela (o monitor desligado) vão ao centro da tela da coluna (`medidasNumaTela`); a página que navega desliga o modo sem conferir se está ligado (o ligar ainda na fila); com o alfinete solto, o aviso do sistema volta a valer sem foco (`porCima`). Na interface, sair do compacto é a resposta para qualquer navegação para fora da vista compacta: quem liga dá os endereços dela (a revisão: `/revisao-ppc` com `compacto=1`), e a moldura desliga o modo no `onBeforeNavigate` (⤢ do Ler e da conversa, Comparar, a paleta na tela, o aviso do sistema, Voltar no histórico); no compacto, todo link abre no painel, salvo o que pede a tela; ligar não grava outra entrada no histórico (`replace`), recolhe o painel aberto e não liga se a pessoa saiu da revisão enquanto o Word abria; ⤢ no meio do pedido de ligar desiste dele; religar só troca o título, e o alfinete fica como está. A tela embaixo do painel que cobre a coluna fica `inert`, e a barra do painel cabe em 320 px (← "Voltar" à esquerda, as abas sem ícone, a busca só com a lupa). A caixa curta toma a conversa do painel só na entrada e só sem rascunho de outra conversa (com rascunho, oferece "Conversar sobre esta revisão"); depois, a pendência aberta troca só a ficha da pendência, e só na conversa da revisão (a ficha do PPC tirada não volta, e a conversa trocada no painel não é puxada de volta); a caixa remonta com a origem (a IA da revisão, decisão 11). Na coluna, os glifos dos filtros são só visuais, a contagem é a das linhas que o filtro mostra, a conferência ao salvar vai em parágrafos, e o F e as setas são anunciados (`aria-keyshortcuts`, a dica da lista, também na tela inteira, com o teclado da lista num só lugar, `teclado.ts`); "Acompanhar no Word" espera o Word e a janela antes de aceitar outro clique. Testes novos em `compacta.test.ts`, `avisos.test.ts`, `apps/web/src/janela-compacta.test.ts` e `compacta.browser.test.tsx`.
9. **Comparar normas.**
   - A `FonteCorrespondencia` com as duas normas, `alinhamentoEm` e a diferença palavra a palavra.
   - Testes com os casos 1→N, N→1, novo por artigo e artigo só com caput, sobre a tabela 1/2021 → 2/2026.
   - O RPC e a tela.

   Independe das outras etapas e pode correr em paralelo; o "Perguntar à IA sobre a diferença" entra quando a etapa 5 existir.
   - Implementada em 27/11/2026: em `packages/kb`, a `FonteCorrespondencia` com os dispositivos ordenados das duas normas (tipo, rótulo e pai, de `db/consultas-normas.ts`), `alinhamentoEm` em `normas/correspondencia.ts` (uma linha por dispositivo da origem, herança do ancestral, 1→N, N→1 com "também corresponde", novos por artigo, artigo só pelo caput) e `diferencaPalavras` em `normas/diferenca.ts` (grifo por palavra até 60% de mudança), com testes sobre a tabela 1/2021 → 2/2026; o RPC de leitura `compararNormas` (`packages/mcp/src/comparar.ts`, `leitura/comparar.ts`); `comparar_com` no índice do Explorar e `comparacoes` na resposta da busca; a tela `/explorar/comparar?a=…&b=…` (aviso fixo de rascunho, selo de vigência de cada lado, "Só o que mudou", "Novos na 2/2026", rótulos que abrem o leitor, grifo `mark.diferenca` com o token `--grifo`). Entradas: "Comparar com a sucessora/anterior" no leitor da norma, também no leitor do painel, e o grupo "Comparar normas" da paleta; as duas abrem o Comparar em tela cheia, também numa tela de trabalho. A tela não tem âncoras de dispositivo, então não há `id` a colidir com os do painel. Teste em `explorar/explorar.browser.test.tsx` (pela tela, pela paleta e pelo painel). Fica para a etapa 5 o "Perguntar à IA sobre a diferença".
10. **Várias janelas.** "Abrir em nova janela" no menu e no ⇧⌘-clique; o servidor não muda.
   - A variável `janela` vira um conjunto (`main.ts:97`).
   - O IPC usa `BrowserWindow.fromWebContents(evento.sender)` no lugar de `contexto.janela()` (`ipc.ts:51-78`, e a ponte do módulo).
   - A aparência é sincronizada em todas as janelas.
   - Teste com duas janelas no desktop (`BrowserWindow` falso) e duas conexões no navegador.
   - Implementada em 27/11/2026: no desktop (núcleo), `janelas.ts` (o conjunto na ordem de uso, a principal, `porJanela`, `remetenteConfiavel` e `rotaValida`); em `main.ts`, `criarJanela(rota?)`, `abrirJanela` (deslocada da última usada), o modo compacto por janela, a aparência sincronizada em todas, o `second-instance` e os atalhos do menu na última usada (ou na em foco), as tentativas de carga por janela, a recarga de todas com o servidor reiniciado e o `window-all-closed` saindo; no IPC, `BrowserWindow.fromWebContents(evento.sender)` no lugar de `contexto.janela()`, com a janela que pediu passada a quem atende (diálogos presos a ela, também na ponte do módulo), e o canal `abrirJanela` (rota do app até 4 000 caracteres; o `setWindowOpenHandler` continua negando). Avisos do sistema: todas as janelas pedem, só sem nenhuma janela à vista, e o clique vai à janela que mostra a rota (sem o `compacto=1`) ou à última usada; o selo segue único. Continuidade (decisão): só a janela principal grava (também ao fechar) e volta; as outras ficam com a continuidade desligada; fechada a principal, as que ficam não gravam. Na interface, "Abrir em nova janela" no menu Arquivo e ⇧⌘N (Ctrl+Shift+N), com a rota atual sem o compacto (`rotaParaGuardar`), e ⇧⌘-clique (Ctrl+Shift+clique) num link `ifpr://` (`ondeDoClique` → `abrirLink(link, "janela")`), numa conversa da lista e num resultado da paleta; sem o desktop, a opção não existe e o clique vale como o comum. O tema escolhido numa janela chega às outras pelo `storage`. O servidor não mudou. Testes: `apps/desktop/test/janelas.test.ts`, o compacto por janela em `compacta.test.ts`, o aviso com duas janelas em `avisos.test.ts`; no navegador, `src/janelas.browser.test.tsx` e `modulos/revisao-ppc/duas-janelas.browser.test.tsx` (duas conexões na mesma revisão acompanhada: o Feito de uma chega à outra pelo `acompanharLista`, nos dois sentidos). Depois das revisões: ⇧⌘N não repete com a tecla segurada (`evento.repeat`), e o processo principal abre no máximo 10 janelas (`MAXIMO_JANELAS`); a janela nova abre a partir da que pediu (não da última usada), em cascata e dentro da área útil da tela dela, voltando à borda quando não cabe, e no centro dessa área, com o tamanho normal, quando a que pediu está no modo compacto, maximizada ou em tela cheia (`medidasDaJanelaNova`). Continuidade (decisão): fechada a principal, a próxima janela aberta passa a ser a principal e grava daí em diante, mas não volta (nem a rota nem o painel da que fechou), porque abriu na rota que a pessoa pediu; voltar é só da janela que abre com o app. O preload lê `--simplifica-continuidade=so-grava|nenhuma` em `JanelaDesktop.continuidade` (`completa`, `so-grava`, `nenhuma`, no lugar de `extra`). Avisos do sistema: vale o primeiro pedido, de qualquer janela, e os iguais (tipo e rota) que chegam em 2 s saem descartados, de modo que o aviso sai mesmo com a última usada recarregando ou recém-aberta; o clique na janela que já mostra a rota só a traz à frente, sem navegar (a revisão no compacto fica no compacto); a preferência `avisosDoSistema` é lida do servidor a cada aviso, e a mudada numa janela vale nas outras. O seletor de Configurações › Aparência acompanha o tema escolhido em outra janela (`storage`). O ⇧⌘-clique sem o desktop vale como o clique comum (`ondeDoClique`), e no desktop o ⇧-clique ou ⌘-clique num link do app (o pedido de janela nova do Chromium) abre uma janela do app em vez de ir ao navegador. Robustez: a janela que fecha no meio da saída da tela cheia cancela o relógio e o ouvinte da espera (`porJanela` com `aoEsquecer`, `JanelaCompacta.esquecer`); a principal destruída ainda no conjunto cede o lugar à nova; o IPC não lê o `webContents` de janela destruída (`remetenteDoEvento`); `prontoParaSair` só vale da janela a que o pedido foi; e a nova tentativa de carga volta à URL que falhou, não à de quando a janela abriu. Testes novos em `janelas.test.ts`, `compacta.test.ts`, `avisos.test.ts`, `antes-de-sair.test.ts`, `ControleContinuidade.test.ts`, `janelas.browser.test.tsx` (a extra com continuidade guardada fica no Início e não grava; a que virou a principal grava sem voltar; a preferência dos avisos entre duas conexões; a tecla repetida) e `app.browser.test.tsx` (o seletor de tema).

As etapas 1, 3 e 5 resolvem os dois cenários de partida (revisar e pesquisar; revisar e conversar). A 4 resolve o vaivém entre o app e o Word. A 6 torna seguro sair de uma tela com algo rodando.

## Depois da implementação

**A revisão de conjunto (27/11/2026)** achou o que só aparece com as etapas juntas. Corrigido:
- "Qual é o curso?" (que troca o id da lista) leva o painel junto: a origem da conversa ao lado e os links do PPC no Ler passam à lista nova (`ControlePainel.trocarOrigem` e `trocarLinks`, pela composição: `ControleRevisao` avisa a troca, e `depoisDeTrocarCurso` a aplica), e reabrir o app não diz mais que a revisão foi apagada.
- A cadeia da continuação (C1 → C2) na conversa ao lado: `conversarSobre` diz `nova` quando a lista passa à continuação (a tela relê a lista); "Qual é o curso?" e apagar a revisão mudam a origem de todas as conversas de origem na revisão; apagar com a pasta na Lixeira apaga todas as conversas da pasta.
- A continuação feita na tela cheia, com a conversa ao lado levada a ela (⤢), passa o painel à nova (`continuada` sem caixa); "Continuada com… · Abrir a conversa" segue a continuação como o cartão do limite (no painel, troca a aba).
- A conversa apagada em outra janela: o fim do `conversa.acompanhar` (que só termina com a conversa apagada) avisa o `GerenteConversas`, e a aba diz "Conversa apagada"; a revisão apagada em outra janela (o fim do `revisaoPpc.acompanharLista`) sai da tela com "Esta revisão foi apagada." e do painel.
- No modo compacto: "Em andamento" na moldura compacta (decisão 8); o clique na bandeja ou no aviso da conversa da aba Conversar abre no painel (`useAbrirRota`); o ⌥-clique no Ler fica no painel; ⤢ da aba Conversar guarda a volta sem o `compacto=1` e sai mesmo do modo (a revisão não desfaz mais a navegação para fora dela).
- ⌘J com o PPC no Ler em outra pendência leva só a pendência da tela (`juntarPedidos`, um pedido por origem); "Pasta da tarefa" abre a pasta da conversa da tela; o painel que a continuidade reabre não toma o foco.
- Recusado: juntar a caixa do painel e a da tela cheia da mesma conversa. As fichas da revisão (o PPC, o `.docx`) só se preparam pela origem, no painel; a tela cheia mostra "Há uma pergunta começada na caixa do painel", com "Trazer de volta".

**A dividir** (arquivos que passaram de mil linhas com as etapas; nada mudou de comportamento):
- `apps/server/src/modulos/revisao-ppc/ListaViva.ts`: a conferência ao salvar (`acompanhar`, `verificarAcompanhado`, `conferirSalvamento`, `acompanharLista` com o vigia) num serviço `AcompanhamentoWord.ts`, e a exportação CSV à parte;
- `apps/server/src/Conversas.ts`: a continuação (`continuacaoDe`, `contextoDoHistorico`, `textoDasFichas`) e a publicação nas `Atividades` em arquivos próprios;
- `apps/server/src/PastasTrabalho.ts`: o Desfazer (as cópias por turno, a restauração e as mudanças fora da conversa) à parte do resto da pasta;
- `apps/server/src/modulos/revisao-ppc/persistencia/RevisoesPpc.ts`: as listas vivas separadas das revisões com IA;
- `apps/web/src/modulos/revisao-ppc/ControleRevisao.ts`: a leitura com IA e a conferência ao salvar em classes auxiliares;
- os testes que acompanham (`lista-viva.test.ts`: o acompanhamento e a conversa ao lado num arquivo próprio).

**A conferir no Word e no Electron de verdade** (os testes usam o `BrowserWindow` e a ponte falsos):
- os itens 2 e 3 de [A conferir](#a-conferir): os arquivos que o Word cria ao salvar e a leitura com ele aberto;
- o modo compacto no macOS e no Windows (a borda, o alfinete, os botões do sistema, o Word em tela cheia);
- as várias janelas no macOS e no Windows (a cascata, os avisos, a principal que fecha);
- a gravação da continuidade ao fechar (`antesDeSair`, o `before-quit` e a janela fechada).

## A conferir

1. **A conversão ignora os comentários da cópia comentada?** Resolvido em 27/11/2026: a cópia comentada converte no mesmo Markdown do original, byte a byte, e tem as mesmas pendências, também com o run em negrito dividido pelo comentário, com o controle de alterações, a caixa de texto e as fixtures de conversão (teste em `packages/ppc/test/revisao-previa.test.ts`). O que segue é o registro da pergunta. A conferência ao salvar lê a cópia comentada, que tem os comentários do app (`packages/docx/src/comentarios.ts`: `w:commentRangeStart`, `w:commentRangeEnd` e o run de `w:commentReference` no `document.xml`, e o texto em `comments.xml`).
   - O leitor do `packages/docx` parece pular as marcas. Falta ver o run que `comentarios.ts` divide no meio do texto, que pode sair com a formatação partida (`**a****b**`).
   - **Como conferir:** converter o `.docx` original e a cópia comentada de um PPC da base e comparar os Markdown, que devem sair iguais, byte a byte. Rodar a pré-conferência nos dois e comparar as pendências. Se der certo, fixar num gabarito de `packages/ppc/test/fixtures/conversao-docx/`.
   - **Se não sair igual:** a conversão passa a pular as marcas de comentário e a juntar os runs divididos, ou a conferência ao salvar tira os comentários antes de converter.
2. **Que arquivos o Word cria ao salvar, no Windows e no macOS?** Pendente, a medir no piloto: a etapa 4 entrou com um filtro defensivo no vigia (`ehTemporario`: todo `~…`, `.tmp`, `Word Work File …`, `.wbk`, ocultos), a espera de 2 s e o sha256 decidindo se houve salvamento; a medição pode ajustar o filtro e a espera. O vigia precisa saber o que ignorar e quando o salvamento acabou.
   - **No Windows, conhecidos:**
     - `~$<nome>.docx`, o arquivo de dono enquanto o documento está aberto;
     - `~WRL####.tmp` e `~WRD####.tmp`, os temporários do salvamento;
     - a troca do arquivo por renomeação.
   - **No macOS:** pastas e arquivos temporários do Word e a mesma troca por renomeação.
   - **Como conferir:** registrar os eventos do `FileSystem.watch` na pasta enquanto se salva com o Word 365 nos dois sistemas, em três situações:
     - um salvamento simples;
     - com o autossalvamento ligado;
     - na pasta do OneDrive com arquivos sob demanda.

     Daí saem o filtro de nomes, a espera (os 2 s são chute) e se o evento final chega como `rename` ou `change`.
3. **O app lê o arquivo enquanto o Word o tem aberto?** Pendente, a medir no piloto. Até lá, a leitura que falha é avisada na tela e não conta como conferida, e o próximo evento do vigia (ou o foco da janela) tenta de novo. No Windows, o Word abre o documento com bloqueio de escrita, e a leitura em geral passa.
   - **Como conferir:** ler o `.docx` com o Word aberto, logo depois de salvar, nos dois sistemas, também numa pasta de rede.
   - **Se a leitura falhar:** copiar o arquivo antes de ler, ou tentar de novo no próximo evento.
4. **A leitura do PPC inteiro nos três providers.** Antes da etapa 5. Com o PPC do p90 (cerca de 440 mil caracteres), medir em cada IA:
   - quantas chamadas de leitura o "ler inteiro" faz;
   - quanto contexto sobra para a conversa;
   - quanto da cota vai na primeira resposta.

   Se a leitura inteira não couber num provider, nele o pedido passa a "ler o sumário e a seção da pendência, e o resto sob demanda".

## O que não fazer

- Não mandar à IA contexto que a pessoa não vê: toda ficha aparece antes do envio e na mensagem gravada, e o arquivo de uma ficha removida não vai para a pasta.
- Não abrir janela, painel ou notificação sem um gesto da pessoa ou sem algo que termine e a espere.
- Não ler a tela nem a janela do Word.
- Não pôr abas, grade de painéis nem barra lateral de "abertos" antes de o piloto pedir.
- Não fazer o núcleo importar o módulo. A revisão chama o painel, a pasta, as atividades e a janela compacta; o núcleo não conhece a revisão, e a bandeja só tem rotas opacas e ações do núcleo.
- Não limitar o número de conversas abertas.
- Não usar cores fixas nas peças novas: só os tokens de `index.css`, que têm a variante escura.

## Decisões em aberto

Nenhuma. As da revisão final de 27/11/2026 (a pasta com o Markdown sempre atual, a troca de IA na leitura da revisão e o modo compacto à direita com a dica) estão nas decisões 4, 9 e 10.
