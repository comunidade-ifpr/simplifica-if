# Plano de segurança de dados do app

> **Suspenso em 13/11/2026.** O app não acessa SUAP nem SEI até o Marco 2 e só trabalha com dados públicos ([decisão 6 do plano do app](app-simplifica-if.md#decisões-13112026)). Este documento guarda o desenho para quando os sistemas voltarem ao escopo. Nada aqui é entrega dos Marcos 0 a 2. As menções a marcos abaixo são do encaixe original e precisam ser refeitas na retomada.

Situação em 13/11/2026. Complementa o [plano do app](app-simplifica-if.md). Desde 19/11/2026, as ferramentas de SUAP e SEI citadas abaixo ficam num repositório privado à parte; o texto descreve o estado de 13/11/2026.

**Escopo:**

- níveis de sensibilidade dos dados;
- porteiro que decide o que cada IA recebe;
- garantias de retenção dos providers (ZDR);
- credenciais do SUAP e do SEI;
- registro de acesso;
- LGPD.

## Conclusão

1. **ZDR é contrato, não sinal técnico.** Nenhuma CLI de provider informa "esta conta tem retenção zero". O app identifica o *caminho* (provider, modo de login, plano, organização) e compara com um [registro de garantias](#registro-de-garantias) que exige evidência documental. Caminho desconhecido vale como N0, público.
2. **Nas fontes conferidas em 13/11/2026, nenhuma assinatura pessoal tem ZDR:**
   - **Anthropic:** os planos Free, Pro, Max e Ultra ficam fora do ZDR, inclusive no Claude Code. O ZDR existe para:
     - o Claude Code no Claude for Enterprise, habilitado pela Anthropic por organização, depois de análise;
     - chaves de API de organizações comerciais com acordo de ZDR.
   - **OpenAI:**
     - o ZDR é concedido mediante pedido, para endpoints elegíveis da API;
     - o guia de implantação do Codex diz que o acesso local com Work Cloud não dá ZDR estrito;
     - nada cobre Plus ou Pro.
   - **Google:**
     - o ZDR no Vertex AI depende de configuração e de aprovação de exceção ao monitoramento de abuso;
     - login pessoal e chave gratuita podem ser usados para treino. Esta última informação vem de fonte secundária e precisa ser confirmada.
3. **Consequência da decisão de o servidor pagar a IA.** Dado restrito (N2) não vai para IA na nuvem. Há três saídas, descritas em [caminhos para N2](#caminhos-para-n2):
   - canal lateral: o dado vai para os olhos do servidor, não para a IA;
   - modelo local;
   - rota institucional, se o IFPR contratar uma. A arquitetura já comporta.
4. **Além do ZDR, há a LGPD.** Dado pessoal enviado a um provider no exterior é transferência internacional. Ela depende de instrumento do controlador (o IFPR), como as cláusulas-padrão da Res. CD/ANPD nº 19/2024, e uma assinatura pessoal não é esse instrumento. O nível N1 com assinatura pessoal e o Marco 2.5 dependem de parecer do encarregado de dados e da procuradoria.
5. **A senha nunca chega à IA nem ao shell do agente.** O padrão é o [login assistido](#desenho): o servidor digita a senha na página oficial, e o app só guarda a sessão.

## Níveis de sensibilidade

A classificação é pelo conteúdo, não pelo caminho de acesso. A matriz de um curso no SUAP é N0, embora exija login.

| Nível | O que é | Exemplos | Quem pode receber |
|---|---|---|---|
| **N0 — Público** | Conteúdo publicado ou publicável | Base de conhecimento; matriz e carga horária de curso no SUAP; tutoriais | Qualquer provider |
| **N1 — Institucional** | Dado não publicado, ou dado funcional de pessoa em ato oficial, sem identificadores pessoais | Processo SEI de acesso público, com identificadores removidos; cargo, função e lotação de servidor; disciplinas de docente | Provider que não treina com os dados: plano organizacional, chave de API paga ou assinatura pessoal com treino desligado e [atestado](#atestação-do-servidor-para-n1). Sujeito a parecer |
| **N2 — Restrito** | Dado pessoal identificável ou de acesso restrito | Documento SEI restrito; dados de estudante; CPF, SIAPE, endereço, contato e dados bancários de servidor | Só caminho com ZDR registrado ou modelo local. Nos outros, [canal lateral](#porteiro) |
| **N3 — Sigiloso** | Sigilo legal ou dado pessoal sensível (LGPD, art. 5º, II) | Processo SEI sigiloso; processo disciplinar; saúde | Nenhuma IA. O app não busca esse conteúdo |

### Classificação das ferramentas

| Ferramenta | Nível | Observação |
|---|---|---|
| `kb.*` (base de conhecimento) | N0 | Só fontes publicáveis entram no pacote |
| SUAP: curso, matriz, horários | N0 | |
| SUAP: servidor (cargo, função, situação, lotação) | N1 | A skill `suap-ifpr` já exclui CPF, SIAPE, e-mail, telefone, endereço e dados bancários; a regra vira código no porteiro |
| SUAP: docente (cursos e disciplinas) | N1 | |
| SUAP: estudante | N2 | Fora do Marco 2 |
| SEI: metadados e andamentos de processo público | N1 | |
| SEI: documento público | N1 | Com remoção de identificadores |
| SEI: documento restrito | N2 | |
| SEI: qualquer conteúdo sigiloso | N3 | Não buscado |
| SEI: conteúdo sem nível de acesso identificado | N2 | Na dúvida, menos acesso |

O nível vem declarado em cada ferramenta e, quando depende do dado, é calculado no resultado. O nível de um documento do SEI vem do campo de nível de acesso do próprio SEI. O `sei-cli` ainda não extrai esse campo; essa extração é entrega do Marco 2.

## Porteiro

O porteiro fica dentro do `simplifica-mcp`, por onde passa todo dado de sistema. Ele não depende de a IA obedecer a instruções.

**Como ele sabe quem vai ler.** Este é o patch 3 do fork:

- ao abrir cada sessão de provider, o app emite um token para o `simplifica-mcp` com o descritor do caminho: driver, modo de login, plano, organização ou conta quando houver e endpoint, no caso de modelo local;
- o app calcula o nível permitido pelo registro de garantias e pela atestação;
- o `simplifica-mcp` confere o token com o app por IPC local e associa o nível à sessão;
- sessão sem token vale N0. É o caso do `simplifica-mcp` usado fora do app, no Marco 0.

**Decisão sobre cada resultado**

1. Calcular o nível do resultado.
2. Se o nível for menor ou igual ao permitido, entregar. Em N1, remover antes os identificadores.
3. Se for maior e a ferramenta tiver **canal lateral**:
   - a IA recebe só um identificador e um resumo sem conteúdo restrito, por exemplo "o processo tem 3 documentos restritos: 2 despachos e 1 parecer, de 03/2026";
   - o app mostra o conteúdo ao servidor num painel;
   - se o servidor colar esse conteúdo na conversa, o app avisa que o trecho veio de um documento restrito e mostra o nível da IA conectada.
4. Nos outros casos, negar, explicando o motivo e as alternativas (modelo local ou rota institucional).
5. Registrar no [registro de acesso](#registro-de-acesso).

**Nível da conversa.** Cada conversa guarda o maior nível de dado que a IA já recebeu nela. Com isso:

- **Troca de provider ou de modelo:** a troca para um caminho de nível menor é bloqueada, e o app oferece uma nova conversa sem o histórico.
- **Compactação, transferência de contexto entre providers e delegação de tarefas a outro provider:** o T3 tem as três. Seguem a mesma regra, e só caminhos de nível igual ou maior recebem o contexto.
- **Saídas:** exportar, "Isto está errado" e "Propor norma", numa conversa N2 ou acima, não enviam conteúdo da conversa.

**Remoção de identificadores (N1)**

- **Padrões determinísticos:** CPF, RG, SIAPE, matrícula, e-mail, telefone, CEP e endereço, dados bancários.
- **Nomes:**
  - o nome de quem assina um ato oficial fica;
  - os outros nomes viram pseudônimos (`[PESSOA_1]`), e a tabela de correspondência fica só na memória do app, que reexibe os nomes reais para o servidor.
- **Limite:** a remoção é atenuação, não garantia, e por isso não rebaixa N2 para N1.

**Injeção de instruções.** O conteúdo de documentos do SEI e de páginas do SUAP é dado, não instrução. Regras:

- nenhuma ferramenta do `simplifica-mcp` aceita uma URL livre nem envia dado para fora;
- o `simplifica-mcp` só fala com o domínio do SUAP, com `https://sei.ifpr.edu.br` e com o canal de pacotes;
- as funções que enviam algo para fora (relato, proposta) passam por prévia humana e pela regra de nível;
- com Sistemas ligado, a política fixa a configuração de cada provider:
  - ferramentas de rede próprias (busca, leitura de páginas) desligadas ou sob aprovação;
  - navegador do agente desligado (`enableAgentBrowserAccess: false`);
  - nada pré-aprovado fora do `simplifica-mcp`.

  Isso precisa ser conferido provider a provider.
- **Limite:** a própria documentação do T3 diz que o modo de permissão não é um sandbox. Um agente com shell continua sendo um agente com shell; o modo `approval-required` faz o servidor aprovar cada comando.

## Garantias dos providers (ZDR)

### O que dá para verificar

- **Dá:** o caminho, ou seja, provider, modo de login, plano, organização ou conta e endpoint, e se ele está no registro com evidência válida.
- **Não dá:**
  - o comportamento real do provider;
  - se o servidor religou o treino depois de atestar;
  - a conformidade com a LGPD. Esta é uma questão do contrato do controlador.

### Como o app identifica o caminho

O T3 já lê parte disso para mostrar o plano na interface:

| Provider | O que o T3 já lê | O que falta |
|---|---|---|
| Claude | Tipo de assinatura (Free, Pro, Max, Ultra, Team, Enterprise), chave de API, rota Bedrock (`apiProvider`) | ID da organização, para conferir o ZDR de Enterprise ou de chave de API |
| Codex | Plano da conta ChatGPT (`planType`: free, go, plus, pro, business, enterprise, edu) ou chave de API | ID do workspace ou da organização |
| Antigravity (Gemini) | Modo de login (`authMethod`: conta Google, Gemini Enterprise com projeto GCP, chave de API) | Se o projeto tem ZDR configurado |
| OpenCode com modelo local | Endpoint configurado | Confirmar que o endpoint é `localhost` e que nenhum provider remoto está ativo na instância |

Descobrir como obter o ID da organização em cada CLI é tarefa do Marco 1. Enquanto não houver rota institucional, esse dado não muda nada, porque a lista institucional está vazia.

### Registro de garantias

O arquivo é `config/garantias-providers.yaml`, versionado e publicado assinado no canal. Exemplo de entrada:

```yaml
- id: claude-assinatura-pessoal
  provider: claudeAgent
  caminho: { login: assinatura, planos: [free, pro, max, ultra] }
  zdr: false
  treino: escolha-do-usuario
  nivel_maximo: N1
  exige_atestacao: treino-desligado   # sem atestação, N0
  evidencias:
    - url: https://platform.claude.com/docs/en/manage-claude/api-and-data-retention
      trecho: "<trecho literal da página>"
  conferido_em: 2026-11-13
  revisar_em: 2027-05-13
```

**Proposta inicial.** Cada linha precisa de evidência da página oficial antes de valer:

| Caminho | ZDR | Nível máximo proposto |
|---|---|---|
| Claude, assinatura pessoal (Free, Pro, Max, Ultra) | Não | N1 com atestação; N0 sem ela |
| Claude Team | Não (a confirmar) | N1 |
| Claude Enterprise com ZDR do Claude Code habilitado | Sim, se a organização estiver na lista institucional | N2 |
| Claude, chave de API de organização com acordo de ZDR | Sim, se a organização estiver na lista | N2 |
| Claude via Bedrock, Vertex AI ou Foundry | Vale a política do provedor de nuvem | N2 só para conta na lista |
| ChatGPT, plano pessoal (Free, Go, Plus, Pro) | Não | N1 com atestação; N0 sem ela |
| ChatGPT Business, Enterprise ou Edu | Não estrito no Codex local | N1 |
| OpenAI, chave de API com ZDR aprovado | Sim, se a organização estiver na lista | N2 |
| Gemini com conta Google pessoal ou chave gratuita | Não; pode haver treino | N0 |
| Gemini com chave de API paga | Não por padrão | N1 |
| Gemini Enterprise ou Vertex AI com ZDR configurado | Sim, se o projeto estiver na lista | N2 |
| Modelo local | Não se aplica: o dado não sai do computador | N2 |

**Lista institucional.** São as organizações, contas e projetos que o IFPR contratou com ZDR e cláusulas-padrão. Fica vazia enquanto o servidor paga a IA.

### Atestação do servidor para N1

- **Checklist no primeiro uso e em "Sua IA":** para cada provider, o passo a passo para desligar o uso das conversas em treino, com o link da configuração. O servidor confirma.
- **Registro:** o app guarda a data e repete a pergunta a cada 90 dias e sempre que o plano ou o provider mudar.
- **É uma declaração:** o app não consegue conferir, e por isso ela entra no registro de acesso.
- **Depende do parecer:** pode ser decidido que N1 exige plano organizacional. Nesse caso, a linha muda no registro e nenhum código muda.

### Manutenção do registro

- Toda entrada tem evidência (URL e trecho literal), `conferido_em` e `revisar_em`, com no máximo 6 meses entre as duas.
- O CI da fábrica falha quando alguma entrada passa do `revisar_em`. Isso força a releitura periódica dos termos dos providers, que mudam com frequência.
- Mudanças no registro exigem aprovação dos donos da área de segurança e do encarregado de dados (CODEOWNERS).
- No app, registro ausente, inválido ou com assinatura errada faz tudo valer N0.

### Caminhos para N2

1. **Canal lateral (Marco 2).** O servidor vê o dado restrito num painel do app, e a IA trabalha sobre a estrutura. Exemplo: a IA monta a lista de verificação do processo pela Portaria PROENS 121/2024, e o servidor confere os documentos restritos com os próprios olhos. Esse caminho cobre boa parte das tarefas de revisão de processo.
2. **Modelo local (Marco 2, experimental).**
   - Driver `opencode` do T3 com Ollama ou LM Studio. O dado não sai do computador.
   - A qualidade e o hardware decidem se o caminho vale; o conjunto de casos N2 mede isso.
3. **Rota institucional (fora do escopo, decisão do IFPR).**
   - Um contrato com ZDR (API da Anthropic, Claude Enterprise, API da OpenAI, Vertex AI ou Bedrock) e com cláusulas-padrão da ANPD.
   - A política gerenciada fixa a instância do provider (por exemplo, `CLAUDE_CODE_USE_BEDROCK=1` em `limits.providers.instances`), e o registro passa a listar a conta.
   - O N2 passa a funcionar sem mudar o app.

## Credenciais do SUAP e do SEI

### Em 13/11/2026

- **SUAP:** a skill `suap-ifpr`:
  - lê `SUAP_USUARIO` e `SUAP_SENHA` do ambiente ou do `.env.local` da raiz;
  - guarda os cookies só em memória;
  - faz login só com usuário e senha. CAPTCHA, segundo fator, Gov.br e troca obrigatória de senha exigem uma pessoa.
- **SEI:** o `sei-cli` lê `SEI_USUARIO` e `SEI_SENHA` do ambiente ou de `packages/sei-cli/.env.local` e navega com Playwright.
- **O problema:** os agentes rodam esses scripts pelo shell, e um agente com shell consegue ler o `.env.local`. Para curadores no repositório, isso é aceitável. No app, não.

### Ameaças

1. A IA lê a senha num arquivo, numa variável de ambiente, num argumento ou num log.
2. Um documento do SEI ou do SUAP traz instruções que levam a IA a vazar dados.
3. Alguém rouba a sessão do disco.
4. A IA, ou o servidor sem perceber, altera algo no sistema.
5. Um dado acima do nível chega ao provider.

### Desenho

1. **Só o `simplifica-mcp` usa credencial e sessão.**
   - O processo do agente nunca as recebe: nem por variável de ambiente, argumento, arquivo da pasta de trabalho ou resultado de ferramenta.
   - O que for guardado vai para o cofre do sistema operacional (Keychain no macOS, Gerenciador de Credenciais no Windows, Secret Service no Linux). O desktop do T3 já usa `@napi-rs/keyring`.
2. **Login assistido (padrão).**
   - **Como funciona:** o app abre a página oficial de login do SUAP ou do SEI numa janela própria, separada da conversa. O servidor digita a senha e, se for o caso, o segundo fator ou o Gov.br. O app guarda só o cookie de sessão daquele domínio e o entrega ao `simplifica-mcp`.
   - **O que isso resolve:** a senha não passa pelo app, e o login funciona com CAPTCHA, segundo fator e Gov.br, que os scripts de hoje não tratam.
3. **Sessão.**
   - **Onde fica:** na memória do `simplifica-mcp`. Opcionalmente, também no cofre do sistema, cifrada, com "manter conectado por até N horas"; a política define o máximo.
   - **Quando expira:** o app mostra o cartão "Reconectar ao SUAP".
4. **Senha guardada (opcional, desligada por padrão).**
   - É para quando o login assistido não for possível, e a política decide se pode.
   - Fica só no cofre do sistema. No macOS, o acesso ao item é restrito ao binário assinado do `simplifica-mcp`.
5. **Navegação.**
   - O `sei-cli` usa Playwright hoje. No app, a navegação pode usar:
     - uma janela oculta do Electron com a mesma sessão do login assistido;
     - ou o navegador que o T3 já baixa para as prévias de página.
   - Decidir no Marco 1, medindo o tamanho do binário e a fragilidade de cada opção.
6. **Superfície mínima.**
   - Só ferramentas de leitura de alto nível, só os domínios oficiais, e todo resultado passa pelo porteiro.
   - Nenhuma ferramenta genérica de HTTP, e a IA nunca recebe HTML autenticado.
7. **Escrita.**
   - Nenhuma até o Marco 2.
   - Depois, toda escrita exige confirmação na interface do app, fora da conversa, mostrando exatamente o que muda.
   - Assinatura de documento nunca é automática.
8. **Desconectar.** "Seus sistemas → Desconectar" apaga a sessão e os itens do cofre. Desinstalar oferece "Esquecer tudo".
9. **Acesso remoto.** O T3 pode ser controlado pelo celular. Credenciais e sessões ficam no computador, e o login assistido só acontece nele.
10. **Rastreabilidade nos sistemas.** As consultas aparecem nos logs do SUAP e do SEI como acesso do próprio servidor. É o correto: a IA age como o servidor e com as permissões dele.

### Investigação com a DTI (Marco 1)

- **SUAP:**
  - existe API REST com token por usuário?
  - existe OAuth2 ("Login com SUAP") para um app registrado?
  - se existir, o token com escopo substitui o cookie.
- **SEI:**
  - qual é a política de sessão e de segundo fator?
  - os web services do SEI são cadastrados por sistema, não por usuário. Não servem para agir com as permissões de cada servidor.
- **Termos de uso:** limites de requisições para automação nos dois sistemas e domínios oficiais.

## Registro de acesso

É um registro local, só de acréscimos, que responde "o que a IA viu". Para cada entrega de dado de sistema ou recusa, ele guarda:

- quando, a conversa, a ferramenta, o sistema e o identificador do recurso (processo, curso);
- o nível do resultado e o que foi entregue: completo, sem identificadores, só resumo ou negado;
- o provider, o plano, o nível permitido e a atestação vigente;
- um hash do conteúdo entregue. O conteúdo em si fica no histórico da conversa.

O registro nunca guarda senha nem sessão.

- **Visualização:** em "Registro de acesso", por conversa. A exportação para o encarregado só acontece a pedido do servidor.
- **Retenção:** 180 dias por padrão, e a política pode mudar.
- **Disco:** o histórico das conversas fica no computador, com os resultados N1 e N2 que a IA recebeu. O app exige ou recomenda a criptografia de disco do sistema (FileVault, BitLocker), conforme o parecer. A política pode apagar conversas N2 depois de um prazo.

## LGPD e governança

**Perguntas para o encarregado de dados e a procuradoria, antes do Marco 2.5:**

1. N1 com assinatura pessoal do servidor é aceitável? Em que condições (atestação de treino desligado, plano mínimo, tipos de dado)?
2. Para N2 por rota institucional: o contrato precisa das cláusulas-padrão da Res. CD/ANPD nº 19/2024, já que os providers estão no exterior?
3. É necessário um relatório de impacto à proteção de dados (RIPD) do app antes de ligar os Sistemas?
4. Qual o texto do termo de uso mostrado ao servidor no primeiro uso?

**Na base de conhecimento (Marco 0):**

- incorporar a LGPD (Lei 13.709/2018) e a Res. CD/ANPD nº 19/2024 pelo procedimento normal de inclusão de norma. Hoje `kb buscar-norma "LGPD"` não encontra nada;
- procurar normas internas do IFPR sobre proteção de dados e uso de IA e incorporar as que houver.

## Entregas (encaixe original nos marcos, a refazer)

| Marco | Entregas |
|---|---|
| 0 | Nível declarado em cada ferramenta; registro de garantias v0 com evidências; LGPD e Res. CD/ANPD nº 19/2024 na base; teste "a senha nunca aparece" no `simplifica-mcp` |
| 1 | Token por sessão com o descritor do caminho; porteiro e nível da conversa; regras de troca de provider, compactação, transferência e delegação; atestação N1; investigação com a DTI; consulta ao encarregado; estrutura do registro de acesso |
| 2 | Login assistido no SUAP e no SEI; cofre do sistema; extração do nível de acesso no `sei-cli`; ferramentas de leitura classificadas; remoção de identificadores; canal lateral; registro de acesso visível; configuração fixa dos providers com Sistemas ligado; parecer e RIPD antes de ligar |

## Testes obrigatórios

- **Senha:** uma senha de teste é procurada nos logs, no ambiente do processo do provider, nos arquivos da pasta de trabalho, na transcrição da conversa e no registro de acesso. Nenhuma ocorrência é aceita.
- **Matriz níveis × caminhos:** para cada nível de resultado e cada caminho de provider do registro, o resultado esperado (entrega, entrega sem identificadores, canal lateral ou recusa).
- **Nível da conversa:** troca de provider, compactação e delegação numa conversa N2 são bloqueadas.
- **Injeção:** um documento de teste com instruções de vazamento não gera nenhuma chamada de saída.
- **Registro de garantias:** entrada vencida faz o CI falhar; registro ausente ou inválido no app faz tudo valer N0.

## Fontes

Conferidas por busca em 13/11/2026. Cada entrada do registro precisa do trecho literal da página oficial antes de valer.

- Anthropic, [API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)
- Anthropic, [Claude Code — Data usage](https://code.claude.com/docs/en/data-usage)
- OpenAI, [Enterprise privacy](https://openai.com/enterprise-privacy/)
- OpenAI, [Codex — Admin rollout guide](https://developers.openai.com/codex/enterprise/)
- Google Cloud, [Vertex AI and zero data retention](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/vertex-ai-zero-data-retention)
- Res. CD/ANPD nº 19/2024 (fontes secundárias; conferir no DOU): [Mattos Filho](https://www.mattosfilho.com.br/unico/regulamentacao-transferencia-internacional-dados/), [Lefosse](https://lefosse.com/noticias/transferencia-internacional-de-dados-prazo-para-adocao-das-clausulas-padrao-da-anpd-se-encerra-em-23-de-agosto/)
- T3 Code, documentação no checkout do T3 Code (`$T3CODE_DIR/docs/user/`): `managed-policy.md`, `secrets.md`, `html-renders.md`
