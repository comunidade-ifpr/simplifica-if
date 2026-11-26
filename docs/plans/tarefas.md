# Plano das tarefas do app

Situação em 26/11/2026. Plano vivo: como o Simplifica IF recebe muitas tarefas, de um cartão que abre um site até a "Revisar um PPC", com telas e tabelas próprias. As etapas 1 (catálogo de tarefas), 2 (canal), 3 (conversa por tarefa), 4 (limpezas da revisão) e 5 (a revisão como módulo) estão implementadas na árvore de trabalho, sem commit; nada deste plano está em `main`. A etapa 6 (o segundo módulo) é a próxima.

Complementa o [plano do app](app-simplifica-if.md), que traz a visão, os princípios e a política de fábrica. A seção "Manifesto de skill" de lá descreve o que existe hoje; este plano diz para onde ela vai.

## Problema

Antes da etapa 1, o Início tinha duas tarefas, e cada uma tinha entrado no app de um jeito:

- "Conferir a fundamentação normativa" é uma skill: o `SKILL.md` com o bloco `simplifica:`, que viaja pelo canal de atualização.
- "Revisar um PPC" é código do app, citado pelo nome em arquivos de todas as camadas (ver [o acoplamento de hoje](#o-acoplamento-de-hoje)).

Muitas outras virão, de complexidade variada. Falta o modelo que diga o que é uma tarefa, o que ela declara e como uma tarefa com código entra no app sem se espalhar pelo núcleo.

## Decisões (26/11/2026)

1. **O nome é "tarefa".** Não se cria "plugin", "extensão" nem "habilidade". "Extensão" já é área do catálogo e extensão de arquivo; "habilidade" é a tradução de *skill* e termo dos PPCs; "plugin" é o que a política de fábrica desliga nas sessões. "Tarefa" já está no princípio "Tarefa antes de chat", na rota `/tarefas` e no "Sugerir tarefa" do M2.4.
2. **Três coisas distintas:** a tarefa (o cartão, que é dado), a skill (dado, com cartão ou sem) e o módulo (código). Ver [Modelo](#modelo-tarefa-skill-e-módulo).
3. **Catálogo único, escrito por quem roda o repositório.** Quem propõe uma tarefa faz o checkout, escreve a tarefa, testa com `pnpm app:dev` e manda um PR, que passa pela curadoria do projeto. Não há catálogo de terceiros nem instalação de tarefa pela pessoa. A tarefa local, fora do catálogo, fica como [possibilidade futura](#para-depois).
4. **Código só no build.** Módulo e ferramenta MCP vivem no monorepo e saem com o instalador assinado. O app não carrega código baixado. Tarefas e skills são dados e viajam pelo canal, sem release do app.
5. **A conversa do cartão leva só a skill dele; a conversa livre leva todas.** Antes da etapa 3, todas iam para toda conversa (`apps/server/src/CatalogoSkills.ts`); na conversa livre continua assim: cada skill custa uma linha de descrição. `publico` diz a quem a tarefa interessa e só ordena e filtra os cartões; nunca tira skill de uma conversa. A seleção sob demanda entra quando o catálogo passar de umas 30 skills.
6. **Link com login pode; skill e ferramenta com login, não.** A tarefa que abre um link só chama o navegador do sistema: o app não vê a página nem a credencial. Continua valendo a regra do plano do app: nenhuma skill ou ferramenta acessa SUAP, SEI ou outro sistema com login.
7. **O núcleo não importa módulo.** Só os arquivos de composição, nomeados neste plano, citam um módulo.
8. **Sem interface genérica com um exemplo só.** O contrato do módulo sai da "Revisar um PPC" e só vira interface quando existir o segundo módulo. Até lá, a composição é explícita, com imports nomeados.
9. **O manifesto só restringe.** Uma tarefa pode fechar o que a política de fábrica abre (a busca na web, por exemplo); nunca abre o que ela fecha. Dado baixado pelo canal não ganha poder sobre a sessão.
10. **Campo só entra com quem o consome.** Um campo do manifesto entra junto com a tela, a regra ou o script que o usa.
11. **Sem selo de "oficial".** O cartão mostra quem mantém a tarefa e não diz que ela é oficial de uma unidade do IFPR: o projeto é independente e ninguém atesta esse selo.
12. **As skills do app moram em `catalogo/skills/`; `.agents/skills/` é só de quem mantém o repositório.** Tudo o que viaja para o app como dado fica numa pasta só, `catalogo/` (`tarefas/<id>.yaml` e `skills/<nome>/`). A skill do app só fala das ferramentas MCP `ifpr`, sem alternativa pela CLI, e não é skill do agente no checkout: testa-se pelo app ou por `pnpm avaliacao:skill`. A skill de `.agents/skills/` roda no checkout e nunca vai para o app.

## Modelo: tarefa, skill e módulo

| | O que é | Onde mora | Como chega ao app |
|---|---|---|---|
| **Tarefa** | O cartão: título, resumo, a quem serve, quem mantém e a **abertura** (o campo `abre`: o que acontece ao clicar) | `catalogo/tarefas/<id>.yaml`, um arquivo por tarefa | canal, no catálogo (inteiro, dentro do manifesto assinado) |
| **Skill** | As instruções que a IA lê numa conversa | `catalogo/skills/<nome>/` | canal, um pacote por skill; sai pela lista de retiradas |
| **Módulo** | Código de um fluxo próprio: telas, RPC, tabelas, serviços | pastas de módulo no monorepo | release do app |

A tarefa tem uma de três aberturas:

- **link:** abre um sistema externo no navegador.
- **conversa:** abre uma conversa, com um pedido inicial, um formulário curto e, se houver, uma skill.
- **módulo:** abre a tela de um módulo do app.

Separar as três coisas resolve casos que uma "tarefa com tipo" não acomoda: a skill sem cartão (a `explicar-novidade` do M2.2, aberta pelo aviso do "Para você"), dois cartões sobre a mesma skill com formulários diferentes, um módulo com mais de um cartão, e a conversa sem skill (as perguntas prontas por perfil do Marco 2).

A pessoa vê sempre um cartão de tarefa. A abertura aparece só no que muda para ela: o cartão de link diz que abre o navegador e mostra o domínio de destino.

**Curadoria não é tarefa.** A skill que cura a base (hoje a `revisar-conversao-ppc`) edita o repositório: roda scripts, grava em `base-conhecimento/` e termina num commit. O app não tem repositório, só os pacotes, e não traz terminal nem git. Essa skill fica em `.agents/skills/`, a pasta das skills de quem mantém o repositório, sem o bloco `simplifica:` (o `validar_base.ts` recusa o bloco ali), roda só no checkout e não entra no catálogo, nem escondida: o que a impede no app é o lugar onde grava, não quem vê o cartão. O que o app pode oferecer a quem tem um documento para a base é uma tarefa de contribuição, cuja saída é uma proposta para a curadoria (o "Propor norma" e o "Propor um PPC" do M2.4).

### Código para uma tarefa: dois caminhos

Entre a conversa, que é só dado, e o módulo há um degrau grande. O caminho normal de uma tarefa de conversa que precisa de código é uma **ferramenta MCP nova** no Toolkit (`packages/mcp/src/ferramentas/`): determinística, só de leitura, testada. A skill passa a exigir `app_minimo`. "Construir o calendário acadêmico" feito no app seria isso: uma ferramenta que conta os dias letivos entre datas, e uma skill que a usa.

O módulo fica para o fluxo que precisa de tela própria, estado longo ou tabelas.

## Manifesto da tarefa

Um arquivo por tarefa, em Effect Schema (`ManifestoTarefa`), conferido pelo `validar_base.ts`. O servidor lista as tarefas num RPC (`tarefas.listar`, no lugar de `skills.listar`), e a interface deixa de ter o caso especial `TAREFAS_NATIVAS`.

```yaml
# catalogo/tarefas/calendario-academico.yaml
id: calendario-academico          # permanente; nunca muda nem se reaproveita
titulo: Construir o calendário acadêmico
resumo: Monta o calendário letivo do campus a partir dos dias letivos e dos feriados.
area: ensino
publico: [coordenacao-ensino, direcao-ensino]
situacao: estavel
mantenedor: { nome: Fulano de Tal, github: fulano }
limites: Não substitui a aprovação do calendário pelo colegiado.
abre:
  link: { url: "https://exemplo.ifpr.edu.br/calendario", requer_login: false }
```

```yaml
# catalogo/tarefas/conferir-fundamentacao-normativa.yaml
abre:
  conversa:
    skill: verificar-fundamentacao-normativa   # opcional
    pedido: "Confira a fundamentação normativa de {documento}."
    entradas:
      - { id: documento, tipo: arquivo, rotulo: "Documento a conferir" }
    web: true                                   # só restringe: false desliga a busca e a leitura na web
```

```yaml
# catalogo/tarefas/revisar-ppc.yaml
abre:
  modulo: revisao-ppc    # a rota é do código do módulo, com o tipo do roteador
```

| Campo | Obrigatório | Quem consome |
|---|---|---|
| `id`, `titulo`, `resumo`, `area` | sim | o cartão e o catálogo |
| `abre` (a abertura) | sim | o clique no cartão |
| `mantenedor` | sim | o relato de erro (no corpo da issue) e um CODEOWNERS gerado dos manifestos |
| `situacao` | sim | `experimental` só aparece no canal beta; `descontinuada` sai do catálogo e continua nomeando as conversas antigas |
| `publico` | não | a ordem e o filtro do Início; vazio serve a todos |
| `limites`, `autoria`, `duracao_estimada` | não | a página da tarefa, antes de começar |
| `app_minimo`, `base_minima` | não | o servidor esconde a tarefa que o app ou a base instalada não atendem; `app_minimo` é X.Y.Z e `base_minima` é AAAA.MM.DD (os padrões do manifesto do canal), e versão malformada invalida o manifesto |

A tarefa não tem `versao`: o catálogo viaja inteiro (ver [Distribuição](#distribuição)). O que a tarefa usa (IA, web, o que grava) a página da tarefa mostra a partir da abertura e da política efetiva da sessão, sem lista declarada à mão.

**Entram quando houver consumidor:** `palavras_chave` (com a busca no catálogo), `fundamentos` (IDs das normas em que a tarefa se apoia, com um script `pnpm tarefas:impacto <norma>` que cruza os manifestos com as relações; o `kb impacto-da-norma` lê só o `kb.sqlite` e não muda), `escopo` por campus, `ajuda`, `exemplo`.

**Regras do link.** Só `https`, regra do schema: o filtro do desktop (`urlExternaSegura`) aceita `http`, `https` e `mailto`. Sem encurtador nem redirecionador. Abre no navegador do sistema, nunca numa janela do app.

**Dados pessoais.** O manifesto é público. Nome de autor e mantenedor entram com consentimento; o contato é o usuário do GitHub. A varredura de dados pessoais do `validar_base.ts` cobre, além de `base-conhecimento/`, `catalogo/` (tarefas e skills do app) e `.agents/skills/`.

### A skill

A skill do app mora em `catalogo/skills/<nome>/` (decisão 12). O bloco `simplifica:` continua no `SKILL.md`, obrigatório ali, só com o que é da skill: `versao` (X.Y.Z, que sobe a cada edição), `app_minimo`, `base_minima`, `ferramentas`, `arquivos` e `etapas` (o texto da skill marca cada etapa pelo `id`, com a ferramenta `etapa`). Saem dele, para a tarefa, `titulo`, `resumo`, `area`, `publico`, `entradas` e `duracao_estimada`.

A skill segue descrevendo a si mesma, com cartão ou sem. O texto só usa as ferramentas `ifpr`, sem alternativa pela CLI do repositório: no app não há outra coisa, e quem usa o `simplifica-mcp` fora do app tem as mesmas ferramentas. A skill sem cartão é escolha: o `validar_base.ts` avisa (sem reprovar) a skill de `catalogo/skills/` que nenhuma tarefa cita.

`ferramentas` continua conferência estática (a skill só cita ferramenta que existe) e não vira trava da sessão: as ferramentas `ifpr` são só leitura sobre dado público, e bloqueá-las tira respostas do turno seguinte sem ganho de segurança.

## Distribuição

Implementada na etapa 2; o fluxo e os formatos estão no [README de `packages/atualizacao`](../../packages/atualizacao/README.md).

- **Catálogo atômico.** A fábrica junta todos os `catalogo/tarefas/*.yaml` do commit dentro do manifesto assinado do canal (o campo `tarefas`, um objeto por tarefa). Dentro do manifesto, e não num pacote à parte: o catálogo é pequeno, a assinatura o cobre sem um segundo download, e a promoção do manifesto já o leva. O app grava o catálogo (`catalogo/pendente.json`, com `fsync`) e, na abertura seguinte, o troca inteiro, sem mesclar com o anterior nem com o do instalador: tirar o arquivo do repositório tira o cartão dos computadores. O pendente só passa a atual se for legível e de versão do canal mais nova que a do atual; senão, vai ao log e o atual fica. A conferência não grava o catálogo que a abertura descartaria por perder para o do app (`baixadoVence`, com a origem do catálogo daquela execução: o do checkout no `pnpm app:dev`, o de um instalador de commit mais novo), e a tela não anuncia "tarefas novas" que não viriam; o manifesto fica processado assim mesmo. O servidor o lê no modo tolerante da pasta (campo desconhecido ignorado; tarefa inválida no log, sem derrubar as outras). A fábrica não assina manifesto acima de 1 MB (`LIMITE_MANIFESTO`, o mesmo que o app baixa).
- **O mais novo entre o baixado e o do instalador, pela data do commit.** O manifesto traz `data_commit`, a data do commit de que a fábrica gerou o catálogo; o build grava em `<Resources>/tarefas/origem.json` o commit e a data dele. Vence o de commit mais recente. No empate do instante (um segundo, a resolução do git), o do instalador só se for o mesmo commit; de commits diferentes, o baixado. A versão da base não entra: o instalador feito com a base de desenvolvimento (`dev-<hash>`) não perde mais a tarefa nova para um catálogo publicado antes dela.
  - **A pasta do checkout é declarada, não inferida.** O servidor rodando do código-fonte (o `catalogo/tarefas` padrão) e o desktop em desenvolvimento (`--tarefas-do-checkout`) dizem que a pasta é a do checkout, cujo catálogo vence sempre. Sem a flag, a pasta é a do instalador.
  - **Instalador sem origem confiável.** O `origem.json` ausente e o ilegível têm o mesmo tratamento, com aviso no log (`OrigemCatalogo` `sem-origem`): vale o baixado só se a versão do manifesto dele for mais nova que a da base empacotada, que saiu do mesmo build. Assim, um instalador quebrado não congela o catálogo nem aceita um baixado mais velho que ele. A data que não dá instante (`NaN`) cai na mesma regra.
  - **Datas.** `DataHora` recusa a data que não existe no calendário (`instanteDe`: `2026-13-45`, `2026-02-30`, `24:00`). O build do desktop e a fábrica recusam data do commit posterior a agora mais 10 min (`problemaDataCommit`): relógio adiantado ou commit com data trocada ganhariam de todo catálogo seguinte. A fábrica recusa `data_commit` anterior à do manifesto publicado (um rebase), e o commit novo tem de descender do publicado.
- **Skills e catálogo nunca de manifesto mais velho.** O app não processa as skills e o catálogo de um manifesto mais velho que o último processado (`ultimoManifesto`, no `atualizacao.json`), e só de manifesto mais novo que a base do instalador: um manifesto antigo e bem assinado, servido de novo, não volta uma skill retirada nem tira uma mais nova, e um canal mais velho que o instalador não traz nada além da base (que já tem a própria regra). O mesmo manifesto se reprocessa: baixa a skill elegível que falta (a que pedia um app mais novo, depois de o app subir) numa pasta nova (`skills/<versao>+<n>`, sem reescrever a em uso e sem baixar de novo as que já estão) e regrava o catálogo só se nem o atual nem o pendente o têm legível. A `base_minima` das skills compara com a maior entre a base em uso e a pendente.
- **O que o app não atende, não mostra.** O servidor esconde a tarefa cuja abertura pede um módulo que o app instalado não tem, uma skill ausente (ou retirada) ou um `app_minimo` maior. Uma versão fora do padrão (`0.2.0-beta.1`) não se compara, e o mínimo falha fechado. A fábrica e o `validar_base.ts` exigem que o `app_minimo` da tarefa não seja menor que o da skill que ela cita (`conferirAppMinimo`).
- **Retirada de skill.** Somar não tira: a skill empacotada vencia quando a baixada sumia. O manifesto do canal traz `skills_retiradas`, os nomes de `catalogo/skills/retiradas.yaml` (registro só de acréscimos: `skill`, `data`, `motivo`), e o servidor deixa de usar a skill retirada, venha do instalador ou de um download. O app guarda a lista num arquivo próprio, só de acréscimos (`retiradas.json`), gravado logo depois de conferir a assinatura: antes de baixar a base e também quando o app é velho demais para o manifesto. Ela não depende do catálogo baixado, e a skill retirada continua retirada com ele ilegível. O instalador também leva a lista, e as duas se somam. A atualização não baixa nem mantém skill retirada, e cada sessão apaga a pasta dela em `.simplifica/skills/` da pasta de trabalho (só ela; as de outra conversa ficam). Um nome retirado não volta.
  - **A retirada de uma skill em uso** nesta execução (do instalador ou baixada) sai no resultado da conferência (`retiradasPendentes`), também em dia e com o app velho demais, e o `Atualizador` a conta como pendente (`haPendente`): a tela oferece "Usar a versão nova agora", e o reinício a tira do catálogo. Só sai se ficou gravada (em `retiradas.json` ou no catálogo baixado): sem nenhum dos dois, o reinício não a tiraria, e o aviso se repetiria para sempre.
  - **`retiradas.json` perdido.** O catálogo baixado guarda também as retiradas do manifesto dele (`skills_retiradas` de `catalogo/atual.json`), e a abertura soma as duas listas. Com `retiradas.json` ausente ou ilegível e skills baixadas na pasta, valem as do catálogo; sem nenhum dos dois legível, a pasta de skills baixadas não entra naquela abertura (a conferência seguinte regrava o arquivo, que agora existe desde o primeiro manifesto, mesmo vazio).
  - **Falha ao gravar `retiradas.json`** vira aviso (no log e na tela, `avisos` do resultado) e não interrompe a conferência: as retiradas do manifesto valem para os downloads dela, e as do catálogo baixado, na abertura.
  - **O servidor sem pasta de skills nem skills baixadas** usa o catálogo de skills vazio só se também não conhece retirada nenhuma: com retiradas, as sessões continuam apagando a skill retirada da pasta de trabalho.
- **O `atualizacao.json` tem trava curta.** Um semáforo do `Atualizador` só para ler-modificar-gravar o arquivo (`Contexto.travaEstado`), usado por "trocar o canal", "voltar", "novidades vistas" e pelas gravações da conferência (`remoto.ts`), nunca tomado durante um download: a tela de Configurações não espera downloads. O `rename` do que foi baixado e a gravação do estado andam juntos dentro dele. A abertura (`prepararAbertura`) lê o estado dentro da trava da pasta. Sem pasta de atualização (o servidor sem a atualização configurada), nada vai ao disco: o estado gravado é vazio e o canal fica só na memória.
- **Canal trocado com um download em curso.** O canal muda na hora. A conferência do canal antigo termina, mas o que ela ainda não pôs no lugar não se põe: antes de cada `rename`, na trava do estado, ela pergunta se o canal ainda é o dela (`Contexto.vale`); se não, apaga o baixado e devolve `descartada`. O que já estava pendente antes da troca fica, como se ela tivesse terminado antes; as retiradas gravadas também. O download não se interrompe: termina e é jogado fora.
- **Guardas da fábrica contra o canal publicado.** O manifesto traz o `sha256_conteudo` de cada skill (`hashSkill`). Ao gerar, a fábrica lê o manifesto publicado do canal, com a assinatura conferida (baixado de `--repositorio`, sempre que ele vem, ou dado por `--manifesto-publicado`, que com `--repositorio` tem de ser igual ao baixado; sem nenhum, só com `--primeira-publicacao`, que não vai junto com `--manifesto-publicado` e exige o canal vazio: com `--repositorio`, o 404 do manifesto basta; sem ele, `tmp/fabrica/bases/` sem versão, e a recusa diz o que fazer, sem mandar de volta para outra recusa), e exige (`conferirContraPublicado`, `conferirDescendencia`): a versão nova é estritamente maior que a publicada (sem `--versao`, a fábrica escolhe uma que passa dela, também quando a publicada é de um dia posterior ao local); canal vazio é só o 404 do manifesto (com o manifesto no ar, a assinatura que falta é erro); o `HEAD` descende do commit publicado (`git merge-base --is-ancestor`; o commit publicado ausente do clone é recusado com mensagem, em vez de pular a conferência); a data do commit não é anterior à publicada nem está no futuro; as retiradas novas contêm as publicadas; a versão de uma skill não desce da maior já saída; a mesma versão tem o mesmo conteúdo de toda saída anterior nessa versão (um registro local mais novo não esconde o publicado, e no empate de versão o publicado vem antes). Os registros locais passam pelos schemas de versão (`VersaoBase`, `Semver`): o malformado é recusado com o nome do arquivo, e a guarda de versão falha fechada diante de versão que não se compara. Os registros de `tmp/fabrica/bases/<versao>.json` continuam como segunda referência, e a mensagem diz se a versão anterior foi publicada no canal ou só gerada naquele computador. O "só de acréscimos" de `retiradas.yaml` e de `novidades.yaml` compara com o commit do manifesto publicado e com o da versão gerada imediatamente antes (em ordem de versão). O banco compila num temporário e só vai para `tmp/fabrica/bases/` com o registro, no fim.
- **Promoção.** Beta → estável reaproveita os pacotes e leva o catálogo e as retiradas, que estão no manifesto. Confere do mesmo jeito contra o manifesto publicado do estável (versão maior, commit que descende, data não anterior, retiradas que só crescem), com as mesmas opções de origem.
- **O build do desktop** aplica as regras do `validar_base.ts` e da fábrica ao catálogo que leva: tarefa que cita skill que não vai no app, módulo que o app não tem ou `app_minimo` menor que o da skill (`conferirAppMinimo`) faz o build falhar. O `dist` recusa a base de desenvolvimento (`dev-<hash>`); `--base-dev` a aceita, para um instalador local que não se distribui.

## O módulo: a "Revisar um PPC"

### O acoplamento antes da etapa 5

O domínio da revisão já estava separado (`packages/ppc`, `packages/docx`). O que prendia a tarefa ao núcleo era a fiação (os caminhos são os de antes da etapa 5; os de hoje estão em [O módulo hoje](#o-módulo-hoje-etapa-5)):

| Camada | Onde a revisão é citada pelo nome |
|---|---|
| Catálogo | `catalogo/tarefas/revisar-ppc.yaml`; o nome do módulo em `MODULOS` (`packages/mcp/src/modulos.ts`) e a rota dele em `ROTAS_MODULO` (`apps/web/src/tarefas/abrir.ts`). Antes da etapa 1, `TAREFAS_NATIVAS` |
| Início e boas-vindas | `UltimaRevisao` chama `revisaoPpc.listas` (`apps/web/src/routes/index.tsx`); o exemplo do módulo `revisao-ppc` (`MODULO_EXEMPLO` em `apps/web/src/tarefas/exemplo.ts`, que também fixa a skill do exemplo de conversa) |
| Estado da interface | o `ControleRevisao` criado na partida e posto no contexto global (`apps/web/src/inicializar.ts`, `contexto.tsx`) |
| Apagar | nada, desde a etapa 4: os textos da revisão ficam em `apps/web/src/revisao/apagar.ts` e chegam ao `DialogoApagar` como `TextosApagar`; `plural` e `nomeDoArquivo` foram para `apps/web/src/lib/texto.ts`. Antes, `apps/web/src/apagar/textos.ts` importava `../revisao/lista.ts` |
| Leitor | `LeitorRevisao`, para `ifpr://revisao/…` (`apps/web/src/leitor/Leitor.tsx`); o caso `"revisao"` em `apps/web/src/tarefas/textos.ts` |
| Contratos | 20 RPCs em `packages/contratos-app/src/revisao-ppc.ts`, dentro do `GrupoApp` |
| Ponte do desktop | `SUFIXO_REVISAO_PREVIA`, `escolherDocx`, `soltarDocx`, `abrirDocumento` e `mostrarNaPasta` (`apps/desktop/src/ipc.ts`, `preload.ts`), a regra da cópia comentada (`seguranca.ts`) |
| Servidor | cinco layers e duas entradas na lista `fontesDeOcupacao` (`apps/server/src/servidor.ts`); `layerRevisaoPpc` (`handlers.ts`). Saíram na etapa 4 a rota `POST /revisao-ppc/liberar` (hoje `/arquivos/liberar`, que os anexos também usam) e a mensagem "Uma revisão está em andamento" do `Atualizador.ts` |
| Banco | as tabelas da revisão em `0001_Inicial.ts` (`revisoes_ia`, `blocos_ia`, `tentativas_ia`, `listas_pendencias`, `pendencias_vivas`, `eventos_pendencia`, `acoes_ia`, `copias_comentadas`), sem chave estrangeira para `conversas` |
| Build | o Worker `trabalhador-ppc` em `apps/desktop/scripts/construir.ts` |
| Testes | o apoio comum importa o `RevisorPpc` (`apps/server/test/apoio.ts`); `apps/web/src/app.browser.test.tsx` cita a revisão |

As fichas de `base-conhecimento/revisao-ppc/` ficam na base: o MCP (`pacote_contexto`, `impacto_da_norma`, `ifpr://ficha/`) e o Explorar também as leem.

### O alvo

- **Pastas de módulo dentro de cada camada:** `apps/server/src/modulos/revisao-ppc/`, `apps/web/src/modulos/revisao-ppc/`, `apps/desktop/src/modulos/revisao-ppc/` e `packages/contratos-app/src/modulos/revisao-ppc.ts`. O domínio continua em `packages/ppc`. Sem pacote novo nem configuração de build nova.
- **Composição explícita.** Os arquivos de composição citam o módulo pelo nome, e só eles (a lista em [O módulo hoje](#o-módulo-hoje-etapa-5)).
- **Lint de fronteira.** O núcleo não importa de `modulos/`, salvo os arquivos de composição que importam (cada um só do módulo da própria camada), e um módulo não importa de outro.
- **Banco.** As tabelas ficam no `conversas.sqlite`, com prefixo do módulo, criadas no `0001_Inicial.ts`; a coluna `problemas` das tentativas veio na migração 2 (`0002_ProblemasDasTentativas.ts`), para não apagar o banco de desenvolvimento com uma revisão medida. Migrador próprio (a opção `table` do `Migrator` do Effect) só quando o segundo módulo trouxer tabelas.
- **A ponte do desktop continua estreita.** Hoje ela só abre a cópia comentada de um `.docx` que a pessoa escolheu nesta execução. Isso é propriedade de segurança, não acoplamento a limpar: a ponte fica por caso de uso. Quando generalizar, a regra escrita é "só abre o que o servidor gravou, ao lado de um arquivo que a pessoa escolheu nesta execução, com o sufixo do app".
- **A única generalização de agora:** o `servidorOcupado` percorre uma lista de fontes com nome (`fontesDeOcupacao`, em `servidor.ts`), porque já soma quatro. Feito na etapa 4; é só a lista, sem registro de módulos.

**Critério de desacoplamento:** apagar as pastas do módulo e as linhas que o citam nos arquivos de composição; nenhum outro arquivo do núcleo muda, e `pnpm typecheck && pnpm test` passam.

**Pontos de contribuição** (ciclo de vida, leitor, Workers, estado da interface, ponte) são o que a lista dos arquivos de composição mostra. Eles viram interface na etapa 6, com o segundo módulo, e só os que os dois usarem.

**Candidato a segundo módulo:** o "Propor um PPC para a base" do M2.4. Reaproveita a conversão de `packages/ppc` e `packages/docx` que a revisão já usa, e mostra se ele é um segundo cartão do módulo da revisão ou um módulo à parte.

### O módulo hoje (etapa 5)

**Onde mora.** Cada camada tem a pasta do módulo, com os testes ao lado do que o projeto já fazia em cada uma:

| Camada | Código | Testes |
|---|---|---|
| Servidor | `apps/server/src/modulos/revisao-ppc/`: os serviços (`RevisorPpc`, `RevisaoIa`, `ListaViva` e as funções deles), `persistencia/` (`RevisoesPpc`, `CopiasComentadas`, `tabelas.ts`), `handlers.ts` (o `GrupoRevisaoPpc`) e `modulo.ts` (as layers sobre o banco das conversas e as fontes de ocupação) | `apps/server/test/modulos/revisao-ppc/`, com o `apoio.ts` do módulo sobre o comum; os scripts em `apps/server/scripts/modulos/revisao-ppc/` |
| Interface | `apps/web/src/modulos/revisao-ppc/`: as telas (`Tela.tsx`, que a casca da rota usa), o `ControleRevisao` e o `useRevisao` (`contexto.ts`), o `LeitorRevisao`, o `UltimaRevisao` e os textos | ao lado (`*.test.ts`, `*.browser.test.tsx`, com o fluxo pelo servidor de teste em `fluxo.browser.test.tsx`) |
| Desktop | `apps/desktop/src/modulos/revisao-ppc/`: `ipc.ts` (os quatro canais), `preload.ts` (a parte em `window.simplifica`) e `seguranca.ts` (`docxEscolhido`, `copiaComentadaPermitida`, a mesma regra) | `apps/desktop/test/modulos/revisao-ppc/` |
| Contratos | `packages/contratos-app/src/modulos/revisao-ppc.ts`, exportado como `@simplifica-if/contratos-app/modulos/revisao-ppc`; a raiz do pacote não o reexporta | `packages/contratos-app/test/modulos/revisao-ppc.test.ts` |
| Banco | as tabelas `revisao_ppc_revisoes_ia`, `_blocos_ia`, `_tentativas_ia`, `_listas_pendencias`, `_pendencias_vivas`, `_eventos_pendencia`, `_acoes_ia` e `_copias_comentadas`, com os índices de mesmo prefixo, criadas por `tabelas.ts` | `tabelas.test.ts` |

**Arquivos de composição.** A lista única fica em [`ferramentas/oxlint-plugin/modulos.ts`](../../ferramentas/oxlint-plugin/modulos.ts), em duas partes: os que **importam** do módulo (`ARQUIVOS_QUE_IMPORTAM`, cada um só do módulo da própria camada, por caminho relativo) e os que **só o citam pelo nome** (`ARQUIVOS_QUE_CITAM`: `ponte.ts`, `packages/mcp/src/modulos.ts`, `abrir.ts` e `construir.ts`), que não podem importar de `modulos/`. Linhas de código que citam o módulo (sem contar comentário):

| Arquivo | Linhas | O quê |
|---|---|---|
| `packages/contratos-app/src/contratos.ts` | 2 | o import e o `GrupoRevisaoPpc` no `GrupoApp` |
| `packages/contratos-app/src/ponte.ts` | 9 | o `SUFIXO_REVISAO_PREVIA`, os quatro métodos da `PonteDesktop` e os quatro canais (sem import: o módulo é import-free, para o bundle do desktop) |
| `packages/mcp/src/modulos.ts` | 1 | o nome em `MODULOS` (sem import) |
| `apps/server/src/servidor.ts` | 4 | o import, a opção `revisaoIa`, as fontes de ocupação do módulo e a layer |
| `apps/server/src/handlers.ts` | 2 | o import e a layer dos handlers |
| `apps/server/src/persistencia/migracoes/0001_Inicial.ts` | 2 | o import e o bloco das tabelas |
| `apps/server/src/persistencia/migracoes/0002_ProblemasDasTentativas.ts` | 2 | o import e o export da migração do módulo |
| `apps/web/src/routes/revisao-ppc.tsx` | o arquivo (6 linhas de código) | a casca da rota do TanStack |
| `apps/web/src/inicializar.ts` | 4 | o import, o `new ControleRevisao`, o campo no contexto e o `encerrar` |
| `apps/web/src/contexto.tsx` | 2 | o tipo e o campo `revisao` do `ContextoApp` |
| `apps/web/src/leitor/Leitor.tsx` | 4 | o import e o despacho de `ifpr://revisao/` |
| `apps/web/src/routes/index.tsx` | 2 | o import e o `<UltimaRevisao />` |
| `apps/web/src/tarefas/abrir.ts` | 1 | a rota em `ROTAS_MODULO` (sem import) |
| `apps/desktop/src/ipc.ts` | 2 | o import e o `registrarIpcRevisaoPpc` |
| `apps/desktop/src/preload.ts` | 2 | o import e o `...ponteRevisaoPpc` |
| `apps/desktop/scripts/construir.ts` | 1 | o Worker `trabalhador-ppc` (sem import) |

Saíram da lista que o plano previa: `apps/desktop/src/seguranca.ts` (as regras foram para o módulo) e o diálogo de apagar (o módulo passa os textos dele ao `DialogoApagar`, sem composição). Entraram `contexto.tsx`, `routes/index.tsx`, `abrir.ts`, `modulos.ts` e a migração. Ao apagar o módulo, a lista em `ferramentas/oxlint-plugin/modulos.ts` e a linha do `revisao-ppc-base.test.ts` em `TESTES_BASE` (`vite.config.ts`) também saem.

**Superfície do núcleo que o módulo usa** (o rascunho do contrato da etapa 6):

- **Servidor:** o `Motor` (`@simplifica-if/motor`: sessões, `FalhaProvider`, eventos, a política de julgamento sem ferramentas); a leitura da base (`PacoteContexto`, `FontesNormativas`, `Normas`, `Cursos` do `@simplifica-if/kb`, pelo `Leitura` do servidor); o banco das conversas (o `SqlClient` que o `servidor.ts` passa à layer, e `descarregar`, de `persistencia/Banco.ts`); as `Preferencias` (o aviso de uso e as IAs em uso); `ArquivosLiberados`; `WorkerLimitado` (o `Executor` e os limites); `nome-livre.ts`; `observabilidade/resumoDaFalha.ts`; a tradução de erro do transporte (`traducao.ts`); e, do contrato, `AvisoNaoAceito`, `Provider` e o `SUFIXO_REVISAO_PREVIA`.
- **Interface:** a `Api` e o `ContextoApp` (`useApi`, `useApp`, `useEstadoConexao`); `conexao/erros.ts` (`explicarErro`); `ponte-desktop.ts`; `deteccao.ts` e `providers.ts` (as IAs prontas); `diagnostico.ts` (`registrarErro`); o diálogo e a seleção de apagar (`apagar/`); o leitor (`Documento`, `useCarga`, as peças, o histórico) e o `PainelLeitura`; o índice do Explorar (a lista do CNCT de "Qual é o curso?") e `normalizar`; `lib/texto.ts` e `lib/formato.ts`; os componentes comuns (`components/`, `components/ui/`).
- **Desktop:** do IPC do núcleo, o `tratar` (só a janela do app), o `exigirJanela` e o `liberarNoServidor`.

Nada disso é da revisão escondido no núcleo: cada peça tem outro usuário (o "Anexar" usa `ArquivosLiberados`, `WorkerLimitado` e `nome-livre`; a conversa, o leitor e o índice do Explorar). O mais específico é o `servidor.ts` passar o banco e a opção `revisaoIa` à layer do módulo.

**Lint de fronteira.** A regra própria `simplifica-if/fronteira-modulos` (`ferramentas/oxlint-plugin/rules/`), no `pnpm lint`: um arquivo fora de `modulos/<nome>/` (ou `modulos/<nome>.ts`) e fora de `ARQUIVOS_QUE_IMPORTAM` não cita por caminho um módulo (`modulos/<nome>`, também no fim do caminho) nem a pasta de todos (`./modulos`, `../modulos/`); um arquivo de `ARQUIVOS_QUE_IMPORTAM` só importa do módulo da própria camada (`apps/<app>` ou `packages/<pacote>`), por caminho relativo; um módulo não importa de outro. Conta toda forma de citar um arquivo por caminho: `import`, `export … from`, `import()` (também com template sem expressão), `import X = require()`, `type X = import("…").Y`, `require()`, `require.resolve()`, `import.meta.resolve()`, `vi.mock()` e parentes, e `new URL("…", import.meta.url)`; o caminho montado em tempo de execução não se confere. O `no-restricted-imports` do oxlint não servia: com padrões e overrides, a lista dos arquivos de composição ficaria repetida em globs e a regra "um módulo não importa de outro" pediria um override por módulo. O teste `ferramentas/oxlint-plugin/test/fronteira-repositorio.test.ts` (no `pnpm test`) aplica a mesma regra, com as mesmas formas, aos arquivos da raiz e a todos os de `apps/`, `packages/`, `scripts/` e `ferramentas/`, inclusive os que o lint ignora e o código copiado do T3 (`t3/`); ficam de fora só o que é gerado ou de fora (`node_modules`, `dist*`, `.repos`, `tmp`, `outputs`), as pastas de dados (que o teste confere não ter código) e os casos de teste da própria regra, que são imports de `modulos/` dentro de textos. Ele também confere que os arquivos da lista existem.

**A prova manual (26/11/2026).** Numa cópia da árvore (sem `node_modules`, com `pnpm install --offline`), apagar as pastas do módulo, a casca da rota e as linhas dos arquivos de composição, regenerar o `routeTree.gen.ts` (o build do `apps/web`) e rodar `pnpm typecheck`. Quebrou, fora dos arquivos de composição, só em testes:

- `apps/web/test/ponte.ts`, o apoio dos testes de navegador, que montava a `PonteDesktop` com os métodos do módulo: corrigido (os métodos que o teste não passa respondem `null`, sem o nome deles);
- `packages/mcp/test/tarefas.test.ts`, `apps/server/test/catalogo-tarefas.test.ts` e `apps/web/src/tarefas/catalogo.test.ts`, que usam `revisao-ppc` como exemplo de módulo do catálogo (a lista `MODULOS` é fechada): registrado em [Lacunas](#lacunas).

Com o `pnpm test` na mesma cópia, falham também os testes que leem o catálogo do checkout (`catalogo/tarefas/revisar-ppc.yaml`, que cita o módulo e é dado): `servidor.test.ts`, `tarefas-rpc.test.ts`, `pacote-diagnostico.test.ts`, `empacotar.test.ts`, `validar_base.test.ts` e `fabrica_atualizacao.test.ts`. Tirar o módulo do app é tirar também a tarefa do catálogo (ou passá-la a `descontinuada`).

## Etapas

Cada etapa termina com `pnpm fmt && pnpm lint && pnpm typecheck && pnpm test`.

1. **Catálogo de tarefas.** Implementada na árvore de trabalho em 26/11/2026, sem commit. `ManifestoTarefa` (`packages/mcp/src/tarefas.ts`) e `catalogo/tarefas/*.yaml` (`revisar-ppc`, de módulo, e `conferir-fundamentacao-normativa`, de conversa); `tarefas.listar` com as três aberturas (`apps/server/src/CatalogoTarefas.ts`); o bloco `simplifica:` reduzido; saiu `TAREFAS_NATIVAS`; o exemplo das boas-vindas tira o título e o `id` das tarefas do catálogo; a coluna `conversas.tarefa` guarda o `id` da tarefa ou nulo, sem o sentinela `"conversa"`; `validar_base.ts` confere os manifestos e os dados pessoais em `catalogo/` e `.agents/skills/`; o Início põe as tarefas que rodam no app antes das de link (cabem quatro cartões); o build do desktop leva `catalogo/tarefas/` para o app. Depois, com a decisão 12, as tarefas e a skill do app foram para `catalogo/` (`tarefas/` e `skills/`), a skill perdeu a alternativa pela CLI (versão 0.3.0), e o `validar_base.ts` passou a exigir o bloco `simplifica:` em `catalogo/skills/`, a recusá-lo em `.agents/skills/` e a avisar da skill sem cartão. O link está completo e testado com manifestos de teste; a primeira tarefa de link de verdade ficou de fora (ver [Lacunas](#lacunas)).
2. **Canal.** Implementada na árvore de trabalho em 26/11/2026, sem commit. O manifesto do canal traz o catálogo inteiro (`tarefas`) e as skills retiradas (`skills_retiradas`, de `catalogo/skills/retiradas.yaml`); o app guarda o catálogo em `catalogo/pendente.json` e o troca inteiro na abertura (`prepararAbertura`), valendo o mais novo entre o baixado e o do instalador pela ordem de versões do canal; o `CatalogoTarefas` lê o baixado no lugar da pasta (`lerTarefasDoCanal`) e o `CatalogoSkills` tira as retiradas (`maisNovas`), também as do instalador; a fábrica recusa a skill que mudou sem subir a `versao` (`conferirVersoesSkills`, sobre os registros de `tmp/fabrica/bases/`), e `simplifica.versao` é X.Y.Z no schema; a promoção leva tudo, porque está no manifesto. Na segunda revisão de 26/11: a pasta do checkout passou a ser declarada (`--tarefas-do-checkout`), o instalador sem `origem.json` legível cai na regra da versão contra a base empacotada, `DataHora` confere o calendário, o build e a fábrica recusam data no futuro e a fábrica a anterior à publicada, o mesmo manifesto se reprocessa (skill que passou a ser elegível, catálogo perdido) e só o mais velho se bloqueia, a retirada de skill em uso vira pendência na tela, `retiradas.json` perdido se recompõe do catálogo baixado e a falha ao gravá-lo vira aviso, o servidor sem pasta local usa o catálogo e as skills baixados, `compararVersoes` confere também o lado que não é `dev-*`, a troca de canal entrou no semáforo das conferências (depois trocado por uma trava curta só do `atualizacao.json`, na terceira revisão), a fábrica exige versão maior, commit descendente e data não anterior contra o publicado (também no `promover`), a `--primeira-publicacao` só vale sem nada publicado nem gerado, os registros locais passam pelos schemas de versão, e o build do desktop aplica `conferirAppMinimo`. Na primeira revisão de 26/11, o catálogo passou a se ordenar pela data do commit (`data_commit` e `origem.json`), as skills e o catálogo só vêm de manifesto mais novo que o último processado e que o instalador, o pendente é conferido antes da troca, as retiradas ganharam arquivo próprio só de acréscimos e entram antes de tudo, a sessão apaga as skills retiradas da pasta de trabalho, `compararVersoes` recusa segmento que não é número, e a fábrica confere contra o manifesto publicado do canal (com o `sha256_conteudo` das skills), recusa manifesto acima de 1 MB, a versão de skill que desce e a tarefa de `app_minimo` menor que o da skill, e não deixa banco órfão. Na terceira revisão de 26/11: a guarda de versão das skills compara com toda saída da mesma versão (o publicado antes do registro local), `retiradasPendentes` só com a retirada gravada, o `Atualizador` sem pasta não toca o disco, a trava curta do `atualizacao.json` (o canal troca na hora, e o download em curso do canal antigo é descartado), a abertura lê o estado na trava da pasta, `--primeira-publicacao` com `--repositorio` dispensa `bases/` vazia, só o 404 do manifesto é canal vazio, o servidor sem pasta de skills mantém as retiradas, a versão escolhida passa da publicada de dia posterior, o `dist` recusa base `dev-*` sem `--base-dev`, e a conferência não grava o catálogo que a abertura descartaria. Ver [Distribuição](#distribuição).
3. **Conversa por tarefa.** Implementada na árvore de trabalho em 26/11/2026, sem commit. A regra da sessão é do `CatalogoTarefas` (`regraDaSessao`) e as `Conversas` a aplicam a cada sessão aberta (nova, retomada ou recomeçada): a conversa de tarefa leva só a skill que a tarefa cita, ou nenhuma, nas instruções da sessão e em `.simplifica/skills/`; a conversa livre leva todas. `abre.conversa.web: false` vira `ConfigSessao.semWeb`, e o motor abre a sessão com a política do app sem a web (`politicaSemWeb`, pelo caminho da política de julgamento da revisão), nos três providers; o manifesto só restringe. O "sem web" fica gravado na conversa ao nascer (`conversas.sem_web`) e vale quando a coluna ou o manifesto disserem: o manifesto que some do catálogo, ou chega inválido, não religa a web. `conversa.iniciar` recusa a tarefa `experimental` fora do canal beta com mensagem própria (`CatalogoTarefas.recusaDeConversa`, a regra de `tarefas.listar`; `TarefaDesconhecida` com `motivo: "so-no-beta"`). No Codex, a retomada sem instruções manda `developerInstructions` vazio, para as instruções antigas da thread não ficarem. As ferramentas `ifpr` continuam todas em toda sessão. O campo do manifesto passou a se chamar `abre` (era `abertura`).
4. **Limpezas da revisão.** Implementada na árvore de trabalho em 26/11/2026, sem commit. `CAMINHO_LIBERAR_ARQUIVO` é `/arquivos/liberar`; `apagar/textos.ts` não importa de `revisao/` (os textos da revisão estão em `revisao/apagar.ts`, e `plural` e `nomeDoArquivo` em `lib/texto.ts`); a mensagem de troca adiada do `Atualizador` é genérica; o `servidorOcupado` percorre a lista `fontesDeOcupacao`. A ponte do desktop (`seguranca.ts`) não mudou.
5. **A revisão como módulo.** Implementada na árvore de trabalho em 26/11/2026, sem commit. O código da revisão foi para as pastas de módulo de cada camada (servidor, interface, desktop e contratos), com os testes e os scripts; o contrato saiu da raiz de `@simplifica-if/contratos-app` para `@simplifica-if/contratos-app/modulos/revisao-ppc`; as tabelas ganharam o prefixo `revisao_ppc_`, num bloco da migração inicial (`tabelas.ts` do módulo); os handlers do grupo foram para o módulo, com a tradução de erro num arquivo do núcleo (`traducao.ts`); a ponte do desktop (os quatro canais e as regras) mora no módulo, com a mesma regra. O lint de fronteira e o teste que varre o repositório conferem a lista dos arquivos de composição. Ver [O módulo hoje](#o-módulo-hoje-etapa-5).
6. **O segundo módulo.** Com ele, extrair as interfaces que os dois usam e documentar em `docs/internals/` o roteiro de quem propõe tarefa.

As etapas 1 a 4 entregam valor sozinhas e não dependem da 5. As cinco estão implementadas na árvore de trabalho.

## O que não fazer

- Não carregar no app código que não saiu no instalador.
- Não abrir link dentro do app (webview): abre no navegador do sistema.
- Não criar registro, interface ou ponto de contribuição genérico para um módulo só.
- Não alargar a ponte do desktop para "capacidade genérica" sem a regra de segurança escrita.
- Não deixar o manifesto liberar o que a política de fábrica fecha.
- Não pôr no manifesto campo sem consumidor, nem o que o git ou o código já dizem.
- Não aceitar tarefa sem mantenedor.

## Decisões em aberto

- **A. A quem a tarefa interessa, fora do ensino.** O `publico` da tarefa e o perfil da pessoa só conhecem o ensino. Decide-se quando entrar a primeira tarefa de outra área ou de um campus só; até lá, quem fica sem público vê o catálogo inteiro. Os três limites de hoje:
  - **Não há público fora do ensino.** Os sete públicos (`packages/mcp/src/publicos.ts`) são do ensino. O perfil já aceita PROAD, PROGEPE, PROEPPI e PROPLAN como unidade, mas só a PROENS vira público (`publicosDoPerfil`, em `packages/contratos-app/src/preferencias.ts`).
  - **A pessoa tem uma função só,** entre três (coordenação de curso, coordenação de ensino, direção de ensino). Quem acumula funções, ou tem outra, não consegue dizer.
  - **O campus não filtra.** O perfil guarda o campus, e a tarefa não tem como dizer que vale só para um.

  O que se decide: se o vocabulário continua lista fechada, aumentada a cada tarefa, ou passa a derivar da área da tarefa, da unidade e do cargo; se o perfil aceita mais de uma função, e quais; se a tarefa ganha um `escopo` de campus, separado do público. Proposta de partida: públicos derivados da área e da unidade, função múltipla no perfil e `escopo` à parte.

## Lacunas

O que a segunda e a terceira revisão de 26/11 (fronteira do módulo e canal) deixaram de fora:

- **Retirada com o app velho demais e `retiradas.json` perdido.** A retirada que chega num manifesto que o app não atende (`app-desatualizado`) só vai para `retiradas.json`; o catálogo baixado guardado é o do último manifesto processado. Se o arquivo se perde nesse intervalo, a recomposição pelo catálogo não a tem, e a skill retirada que estava na pasta baixada volta até a conferência seguinte.
- **O empate de um segundo entre commits diferentes** dá o baixado: a fábrica só publica descendendo do publicado, mas um instalador feito de um commit mais novo no mesmo segundo perderia para ele.
- **`--primeira-publicacao` sem `--repositorio`** não tem como perguntar ao canal: só confere que `tmp/fabrica/bases/` está vazia. No `promover`, nem isso (o beta já está nas bases).
- **Skill do instalador retirada pelo canal, com as duas listas perdidas.** Cenário: o canal retira a skill `x`, que vem no instalador e não na lista do instalador (`Resources/skills/retiradas.yaml`); depois, `retiradas.json` e `catalogo/atual.json` ficam ilegíveis (ou somem) ao mesmo tempo. Na abertura seguinte, a pasta de skills baixadas fica de fora, mas a `x` do instalador volta ao catálogo de skills, às sessões e aos cartões que a citam até a conferência seguinte regravar `retiradas.json` e o servidor reiniciar. Fechar isso sem uma terceira cópia exigiria tirar todas as skills do instalador nessa abertura (a lista perdida não diz quais foram retiradas), o que deixa o app sem nenhuma skill até um reinício que a pessoa pode demorar dias para fazer; uma terceira cópia (no `atualizacao.json`) só diminui a chance. Fica como está: as duas perdas juntas são improváveis, e a volta dura até a próxima conferência e reinício.
- **O download do canal antigo não se interrompe.** Com o canal trocado no meio, a conferência em curso baixa até o fim (até 10 min por arquivo) e só então descarta: interromper o fiber exigiria cancelar a conferência a partir da tela e tratar a trava da pasta e os temporários no meio. "Procurar agora" logo depois da troca espera essa conferência terminar.
- **A guarda de versão das skills no `promover`** não roda: a promoção confere a versão, o commit, a data e as retiradas contra o estável publicado, não as versões de skill (o manifesto do beta já passou pela guarda contra o beta).

O que a etapa 5 deixou de fora:

- **Testes do catálogo com o único módulo.** Os testes do manifesto e do catálogo (`packages/mcp/test/tarefas.test.ts`, `apps/server/test/catalogo-tarefas.test.ts`, `apps/server/test/tarefas-rpc.test.ts`, `apps/server/test/atualizador.test.ts`, `apps/web/src/tarefas/catalogo.test.ts`, o servidor de teste da interface e o `app.browser.test.tsx`, que abre a tarefa de módulo de teste) usam `revisao-ppc` como o exemplo de módulo: `MODULOS` é uma lista fechada, e uma tarefa de módulo precisa de um módulo que existe. Sem o módulo, eles mudam de exemplo. Com o segundo módulo (etapa 6), ou com um módulo só de teste, deixam de depender deste.
- **Citações só pelo nome, fora da lista.** O exemplo das boas-vindas acha a tarefa do módulo pelo nome (`MODULO_EXEMPLO`, em `apps/web/src/tarefas/exemplo.ts`, um texto: sem o módulo, a tarefa não vem no catálogo e o exemplo sai); o nome curto do link `ifpr://revisao/` fica em `nomeCurtoLink` (`apps/web/src/tarefas/textos.ts`); o tipo de link `revisao` não é de nenhuma lista. Nenhum é import, e nenhum quebra sem o módulo.
- **As fontes de ocupação mudaram de ordem.** As duas do módulo vêm antes das do núcleo na lista `fontesDeOcupacao`; só muda qual nome vai ao log quando duas estão ocupadas ao mesmo tempo.
- **O contrato do módulo.** As peças que o módulo usa do núcleo estão em [O módulo hoje](#o-módulo-hoje-etapa-5); viram interface só com o segundo módulo (decisão 8).

O que as etapas 1 a 4 deixaram de fora:

- **Primeira tarefa de link.** O catálogo não tem nenhuma: falta a URL de um sistema real e quem a mantém. O schema, o servidor, o cartão e a página da tarefa já a atendem.
- **Nenhuma tarefa usa `web: false`.** A regra está testada com manifestos de teste e com os drivers falsos; falta o teste real por provider (`*real.test.ts`) de uma sessão sem web.
- **A página da tarefa não diz o que a sessão usa.** O `web` do manifesto não vai à interface (`tarefas.listar`): a página ainda não mostra "sem busca na web" nem a skill que a conversa leva.
- **Sobras em `.simplifica/skills/`.** O motor grava na pasta só as skills da sessão e apaga as retiradas, mas não as que outra conversa gravou na mesma pasta de trabalho (uma conversa livre aberta ali ainda aponta para elas). A sessão da tarefa não as lista nas instruções; os arquivos continuam no disco.
- **Tarefa sem manifesto.** A conversa antiga de uma tarefa cujo arquivo saiu do repositório fica sem skill (o "sem web" continua, gravado na conversa). A skill com que ela nasceu não fica gravada: se o manifesto volta com outra skill, a conversa passa a levar a nova.
- **Codex: limpar as instruções na retomada.** O `thread/resume` aceita `developerInstructions` como texto ou `null`, e o schema do protocolo (`packages/effect-codex-app-server`) não diz qual dos dois apaga as instruções com que a thread nasceu. O driver manda a string vazia quando a sessão retomada não tem instruções (`instrucoesThreadCodex`); falta confirmar num teste real (`real.test.ts`) que a thread retomada deixa de ver as antigas. O caso é o da conversa de tarefa sem skill e com `web: false` (a sessão sem instruções do app): nenhuma tarefa do catálogo é assim hoje.
- **A data do catálogo do instalador é a do `HEAD`.** O build grava a data do commit de que saiu; com `catalogo/` modificado fora do commit, ele avisa e leva o disco com a data do `HEAD`. Sem git, o build falha.
- **Catálogo que chega todo inválido.** A troca é inteira e a leitura é tolerante: se um app velho não entende nenhuma tarefa do catálogo novo, fica sem cartões até o próximo. A fábrica só publica o que o schema de hoje aceita; não há trava para "o app de versão X ainda lê este catálogo".
- **As guardas veem o último manifesto publicado, não o histórico.** A guarda de versão compara com o manifesto publicado do canal e com os registros locais de `tmp/fabrica/bases/`: num computador sem os registros, uma skill que saiu do catálogo numa versão intermediária (sem ser retirada) e volta com a mesma versão e outro conteúdo não é recusada. O "só de acréscimos" de `retiradas.yaml` e de `novidades.yaml` lê o commit do manifesto publicado pelo git: num clone sem esse commit (raso), não há o que conferir, e só os nomes das retiradas são conferidos, pelo manifesto. O patch da base ainda depende dos bancos guardados em `tmp/fabrica/bases/`.
- **Retirada sem volta.** Um nome em `retiradas.yaml` não sai mais; falta decidir se uma skill retirada por engano pode voltar com o mesmo nome (hoje, entra com outro).
- **A tela não distingue catálogo de skills.** "Atualizações" mostra "tarefas novas" para as skills e para o catálogo pendentes (o mesmo campo `skillsPendentes` do estado), sem a versão do catálogo em uso.
- **Mantenedor das duas tarefas.** O `github` dos manifestos é o dono do repositório (`comunidade-ifpr`, uma organização): trocar pelo usuário de quem mantém antes de gerar o CODEOWNERS.
- **Mantenedor no relato.** O relato de erro leva o `id` e o título da tarefa e a skill com a versão; o mantenedor no corpo da issue e o CODEOWNERS gerado dos manifestos ficam com o "Relato por tarefa", abaixo.
- **`app_minimo` da skill.** O bloco `simplifica:` mudou de formato na etapa 1 sem mudar o `app_minimo` da `verificar-fundamentacao-normativa`: o app não tem usuários. A `versao` subiu para 0.3.0 com a saída da alternativa pela CLI. `versao` continua opcional no schema (sem ela, a fábrica publica `0.1.0`). A tarefa `conferir-fundamentacao-normativa` ganhou `app_minimo: 0.2.0`, o da skill, pela regra nova.
- **Trocar de canal para trás.** As skills e o catálogo só vêm de manifesto mais novo que o último processado: quem passa do beta para o estável só recebe skills e catálogo do estável quando ele passar da versão do beta que o app já processou. A base segue a regra dela.

O que o plano ainda não resolve e precisa de resposta antes de o catálogo crescer:

- **Relato por tarefa.** O GitHub ignora o rótulo de quem não pode rotular (`packages/motor/src/politica-curadoria.ts`) e o relato neutraliza as menções. O `id` da tarefa e o mantenedor vão no corpo da issue, e uma Action do repositório rotula. O relato hoje exige uma conversa (`Relatos.ts`): falta o caminho para link quebrado e para problema num módulo.
- **Tarefa retirada com conversa antiga.** Hoje a conversa mostra o título da tarefa, sem as etapas, enquanto o manifesto existir (`descontinuada`, ou que o app não atende); quando o arquivo sai do repositório, fica o título da conversa. Falta decidir o que mais ela mostra e o `substituida_por`.
- **Links.** Checagem periódica das URLs num CI agendado, fora do `validar_base.ts`, que é offline.
- **Catálogo grande.** Busca e filtro em `/tarefas` e na paleta.
- **Critério de entrada da conversa.** Um caso em `pnpm avaliacao:skill`, rodado em pelo menos dois providers, antes de `situacao: estavel`.
- **Base que voltou.** `base_minima` é conferida no download, não na abertura: depois de voltar uma versão da base, uma skill pode ficar ativa contra uma base mais velha que a mínima dela.
- **Erros de módulo no RPC.** A tradução de erros em `handlers.ts` saneia os tipos que conhece; o contrato do módulo precisa dizer como os erros dele chegam à interface e ao log.
- **Métricas.** "Tarefas por pessoa e semana" pede o `id` da tarefa no evento agregado.
- **Documentação:** a seção de skills e tarefas do `AGENTS.md`, os READMEs de `packages/atualizacao`, `packages/mcp`, `packages/motor`, `apps/server`, `apps/web` e `apps/desktop` e a seção "Manifesto de skill" do plano do app descrevem as etapas 1 a 4.

## Para depois

- **Tarefa local, fora do catálogo.** Pode haver tarefa tão específica (de um setor, de um campus, de uma pessoa) que o autor nem queira mandá-la ao repositório. O app poderia carregar de uma pasta do computador uma tarefa e a skill dela, marcadas como locais, só naquele computador. É dado, não código, e cabe na decisão 4. O mesmo mecanismo serviria de modo de autor, para quem escreve uma tarefa sem rodar o repositório ver o cartão e o formulário antes de propor. O que pesa contra, e por que fica para depois: uma pasta de tarefa passada de mão em mão vira catálogo paralelo sem curadoria, o contrário da decisão 3; e hoje quem escreve tarefa roda o repositório. Decide-se junto com o "Sugerir tarefa" do M2.4. Enquanto isso, uma skill pessoal já funciona fora do app, no app de IA da pessoa com o `simplifica-mcp`.
- **Modo avançado.** Um portão escondido, como o modo desenvolvedor do Android (um gesto repetido na versão do app, ou uma variável de ambiente), para o que não deve ficar ao alcance de quem não procura: a tarefa local, as tarefas com `situacao: experimental` (que hoje o plano prende ao canal beta) e o diagnóstico. O portão controla visibilidade e só serve onde a visibilidade é o que falta: não transforma curadoria em tarefa do app.
