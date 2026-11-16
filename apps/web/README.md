# @simplifica-if/web

A interface do app desktop Simplifica IF (M1.1): React 19, TanStack Router com rotas por arquivo, Tailwind 4 e shadcn sobre Base UI, na stack do T3 Code. Fala com o servidor local (`apps/server`) só por `effect/rpc` sobre WebSocket, com os contratos de [`@simplifica-if/contratos-app`](../../packages/contratos-app/src/contratos.ts). Toda a interface é em português; as cores e a tipografia são as da identidade do IFPR (skill `ifpr-design`), em tema claro e escuro.

Este é o shell funcional. O Modo Servidor completo (tarefas, etapas da skill, pasta de trabalho, "Desfazer") é o M1.9; o leitor `ifpr://` completo é o M1.6.

## Telas

- **Início** (`/`): Claude, ChatGPT (Codex) e Gemini (Antigravity), cada um com `providers.detectar` (instalado, login, versão, plano), "Instalar" (`providers.instalar`, com a barra de progresso de `EstadoInstalacao`) e "Entrar" (`providers.entrar`; em `aguardando`, a URL de login aparece como link, e o desktop a abre no navegador do sistema). Os botões só aparecem quando a detecção diz que o app oferece a operação (`podeInstalar`, `podeEntrar`); senão, a orientação provisória para fazer no Terminal (`orientacao` em `src/providers.ts`): instalar o Claude Code pelo instalador oficial e entrar com `claude`; entrar no Codex com `codex login`.
- **Conversa** (`/conversa`): escolhe o provider e a pasta de trabalho (no desktop, o seletor de pastas do sistema; no navegador, um campo de texto) e conversa: texto parcial e final em Markdown, ferramentas como etapas (nome e resumo), pedido de aprovação com "Permitir" e "Negar", "Interromper" e "Nova conversa". Os links `ifpr://` das respostas, na sintaxe de link do Markdown ou soltos no texto (`src/components/linksIfpr.ts`), abrem um painel lateral com o `lerLink` do `GrupoLeitura`, em Markdown.
- **Conversas gravadas (M1.2):** a barra lateral da Conversa (em tela larga) e o Início listam as conversas do servidor (`conversa.listar`, `src/components/ListaConversas.tsx`). A conversa aberta fica na URL (`/conversa?id=…`): recarregar a tela a reabre com o histórico (`conversa.carregar`) e, se havia resposta em andamento, continua a acompanhá-la (`conversa.acompanhar`). Quando a IA caiu, a conversa avisa que a próxima mensagem a retoma.
- **Analisar um PPC** (`/revisao-ppc`, M1.11, etapa 3; botão provisório no Início até os cartões do M1.9): a revisão prévia sem IA. No desktop, "Escolher o PPC (.docx)…" abre o diálogo do sistema (`escolherDocx`); no navegador, o caminho é digitado. Durante a análise, o andamento; depois, o resumo (quantos pontos precisam de ajuste e quantos são para conferir, o curso considerado, "12 de 80 critérios conferidos automaticamente; os demais exigem leitura", a data da base), "Abrir o documento comentado" e "Mostrar na pasta" (só no desktop) e as pendências agrupadas por tema, na ordem do parecer da PROENS (`src/revisao/agrupar.ts`), com estados em linguagem comum ("Precisa de ajuste", "Para conferir", "Em ordem", "Não se aplica"), o que fazer, o trecho, as fontes (o endereço oficial abre no navegador), "Também em" (as outras fichas que apontam o mesmo trecho; a mensagem mantém as quebras de linha da transição) e onde ficou o comentário no DOCX (no trecho, na lista do comentário do título, ou só na tela).
- **Revisar comigo** (M1.11, etapa 5b; `src/revisao/Roteiro.tsx`, textos em `src/revisao/roteiro.ts`): depois da análise (com ou sem IA), a lista viva do servidor (`revisaoPpc.lista`). Duas formas de ver: "uma parada por vez" (as paradas na ordem do parecer, com ✓ nas vistas, "Parada 3 de 12 · tema", "Parada anterior" e "Próxima parada: …") ou "ver tudo de uma vez". O aviso de cobertura diz quantas paradas a pessoa viu e quais (com quantas pendências) ainda não viu; "parar aqui não quer dizer que o resto está em ordem". Em cada pendência: a situação ("Aberta", "Vou ajustar", "Resolvida", "Retirada após contestação", "Mantida, com a sua discordância"), "Vou ajustar", "Já resolvi" (que oferece escolher o arquivo atualizado para o app conferir só aquele critério), "Reabrir", "Discordo…" (campo do motivo, com a regra dita na tela e a estimativa antes de enviar) e "Sugerir texto" (estimativa, confirmação, a redação com "Copiar", os fatos que o app não conferiu e o aviso de que é sugestão); o histórico de cada pendência. No topo, o resumo das situações, a cobertura, o uso das ações com IA, a cópia comentada e "Gerar a cópia comentada com a situação atual". Ao abrir a tela, "Continuar de onde parei" volta à lista mais recente (`revisaoPpc.ultimaLista`).
- **Gerar relatório com IA (revisão completa)** (M1.11, etapa 4; `src/revisao/RevisaoComIa.tsx`), depois da pré-conferência: a pessoa escolhe a IA (Claude, ChatGPT, Gemini) e o modo ("O que mais devolve PPC" ou "Todos os critérios"), vê a estimativa (`revisaoPpc.prepararIa`: critérios, etapas, "cerca de X% de uma janela do plano", minutos e, no Claude, US$ equivalentes; `src/revisao/ia.ts`) e confirma. Durante a revisão, o andamento por tema na ordem do parecer (os blocos de cada tema ficando prontos, pelo stream `revisaoPpc.acompanharIa`), "Pausar" e "Retomar"; limite de taxa e cota aparecem como aviso com a frase do servidor, não como erro. Quando termina, o resultado unificado substitui o da pré-conferência: a mesma lista, com "avaliação da IA" ou "conferido pela base" em cada item, a cobertura ("34 de 80 critérios conferidos: 12 pelo código e 22 pela IA…") e a nova cópia comentada. Depois de recarregar a tela, a revisão com IA mais recente que não terminou volta (`revisaoPpc.listarIa`, `revisaoParaRetomar`), com o andamento e "Retomar".
- No cabeçalho, o estado da conexão (conectado, reconectando com a contagem e "Tentar agora") e o tema (sistema, claro, escuro).

## Rodar em desenvolvimento

O caminho mais curto é o servidor de teste: o `apps/server` de verdade, com drivers de demonstração (nenhum provider real é chamado) e o banco de fixture do MCP.

```bash
# terminal 1: imprime {"porta":…,"urlServidor":…,"token":…,"pasta":…}
pnpm --filter @simplifica-if/web servidor:teste

# terminal 2
pnpm --filter @simplifica-if/web dev          # http://localhost:5190
```

Abra `http://localhost:5190/?servidor=<porta>&token=<token>`. A interface guarda as credenciais no `sessionStorage` da aba e as tira da barra de endereço. Para conversar, use a `pasta` da linha do servidor de teste. Na demonstração, uma mensagem com "escrev" pede aprovação, e uma com "demor" só termina com "Interromper".

Contra o servidor com os providers reais:

```bash
pnpm kb:compilar
SIMPLIFICA_SERVIDOR_TOKEN=$(openssl rand -base64 32) \
  node apps/server/src/bin.ts --banco tmp/kb.sqlite --origem http://localhost:5190
# {"servidor":"simplifica-if","pid":…,"porta":61885,…}
```

e abra `http://localhost:5190/?servidor=61885&token=<o mesmo token>`. O `--origem` é obrigatório: o servidor recusa (403) o `Origin` que não conhece, e a página do `vp dev` tem a origem `http://localhost:5190`.

Em vez dos parâmetros na URL, o `vp dev` também lê `VITE_SIMPLIFICA_SERVIDOR` (a porta ou `http://127.0.0.1:<porta>`) e `VITE_SIMPLIFICA_TOKEN`.

## Conexão

1. **De onde vêm as credenciais** (`src/conexao/origem.ts`): no desktop, de `window.simplifica.conexao()` (o `preload`; contrato em `src/ponte-desktop.ts`), chamada a cada conexão; no navegador, de `?servidor=…&token=…` ou das variáveis `VITE_`.
2. **Ingresso** (`src/conexao/ingresso.ts`): `POST /ingresso` com o token no `Authorization` e depois `ws://127.0.0.1:<porta>/rpc?ingresso=…`. O ingresso vale uma conexão só; o token nunca vai numa URL.
3. **Reconexão** (`src/conexao/Conexao.ts`): o protocolo do `effect/rpc` não reabre o socket; quando ele cai (ou o ping passa de 15 s), o laço pede as credenciais de novo, compra outro ingresso e abre outro socket, com espera de 0,5 s a 10 s. As chamadas feitas sem conexão esperam a próxima; as que estavam em andamento falham, e a conversa no servidor fica órfã por 2 minutos à espera de ser adotada.
4. **Interface** (`src/conexao/api.ts`, `src/contexto.tsx`): `api.chamar`, `api.acompanhar` (streams) e o estado da conexão para o React. A conversa vive fora do React (`src/conversa/ControleConversa.ts`, com o redutor puro `src/conversa/estado.ts`) e sobrevive à troca de tela.

## Build

```bash
pnpm --filter @simplifica-if/web build     # apps/web/dist, com caminhos relativos (base "./")
```

O desktop serve o `dist/`. Num arquivo local (`file:`), o roteador usa o histórico no `#`.

## Testes

```bash
pnpm --filter @simplifica-if/web test      # os dois projetos
pnpm --filter @simplifica-if/web exec vp test run --project unidade
pnpm --filter @simplifica-if/web exec vp test run --project navegador
```

- **`unidade`** (Node): a origem da conexão, os erros, o redutor da conversa e, contra o `apps/server` de verdade no próprio processo (drivers de demonstração), o ingresso, as recusas, a reconexão quando o servidor cai e volta na mesma porta, a conversa inteira pela `ControleConversa` (aprovação, link `ifpr://`, interromper, nova conversa, reabrir a conversa noutra interface, com a resposta em andamento) e instalar e entrar.
- **`navegador`** (Chromium headless pelo Playwright, como o T3): o app inteiro conectado ao `test/servidor-teste.ts`, que um comando do `vite.config.ts` sobe num processo Node; percorre o Início e a Conversa (até reabrir a conversa pela lista lateral) e confere que não aparece texto em inglês dos componentes copiados. Precisa do Chromium do Playwright 1.65 (`pnpm --filter @simplifica-if/web exec playwright install chromium` numa máquina nova; o CI instala só o headless shell, com `--only-shell`, e o guarda em cache pela versão do Playwright).

## Código do T3

Os componentes de `src/components/ui` (button, badge, input, textarea, alert, separator, spinner) e o `cn` de `src/lib/utils.ts` são cópias do T3 Code, com cabeçalho de atribuição e `LICENSE-T3`; ficam fora do `vp fmt`. O registro, com as adaptações, está em [`docs/upstream-t3.md`](../../docs/upstream-t3.md).

## Pendências

- **Etapas da skill e "detalhes técnicos" (M1.9):** as ferramentas aparecem todas como etapas, sem agrupamento.
- **Leitor completo (M1.6):** o painel mostra só o Markdown do `lerLink`.
- **Login do Claude e do Codex, instalação do Claude (M1.8):** o motor só oferece `entrar` no Antigravity e `instalar` no Codex e no Antigravity. Nos outros, a Início mostra uma orientação provisória para o Terminal; o passo guiado é do M1.8.
- **Erros dos providers em português (M1.14):** `src/conexao/erros.ts` traduz as falhas conhecidas (sem login, CLI ausente, MCP que não subiu, modelo fora da conta, tempo esgotado) pela `operacao`, pelo provider e por padrões do detalhe, e as outras viram "não conseguiu <operação>"; o texto original fica em "Detalhes técnicos", recolhido. Falta a tradução completa por tipo de erro, com os erros reais de cada CLI catalogados.
- **Ícone e identidade final:** sem ícone; o nome e as cores seguem a skill `ifpr-design`.
- **knip:** a tabela da stack prevê o knip, que o repositório ainda não usa.
