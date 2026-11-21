# Segurança de dados do app

> **Suspenso.** O app não acessa SUAP nem SEI até depois do Marco 2 e só trabalha com dados públicos ([decisão 6 do plano do app](app-simplifica-if.md#decisões-13112026)). O desenho de credenciais, sessões e ferramentas do SUAP e do SEI pertence ao repositório privado das ferramentas com login e fica fora do app até depois do Marco 2. Aqui ficam só as conclusões sobre retenção de dados dos providers e LGPD, que valem para qualquer caminho de IA do app.

Fontes conferidas em 13/11/2026.

## Conclusão

1. **ZDR é contrato, não sinal técnico.** Nenhuma CLI de provider informa "esta conta tem retenção zero". O que dá para verificar é o *caminho* (provider, modo de login, plano, organização, endpoint), a comparar com evidência documental de cada provider. O comportamento real do provider e se a pessoa religou o treino não dá.
2. **Nenhuma assinatura pessoal tem ZDR:**
   - **Anthropic:** Free, Pro, Max e Ultra ficam fora do ZDR, inclusive no Claude Code. O ZDR existe para o Claude Code no Claude for Enterprise (habilitado pela Anthropic por organização, depois de análise) e para chaves de API de organizações comerciais com acordo de ZDR.
   - **OpenAI:** o ZDR é concedido mediante pedido, para endpoints elegíveis da API; o guia de implantação do Codex diz que o acesso local com Work Cloud não dá ZDR estrito; nada cobre Plus ou Pro.
   - **Google:** o ZDR no Vertex AI depende de configuração e de aprovação de exceção ao monitoramento de abuso. Login pessoal e chave gratuita podem ser usados para treino (fonte secundária, a confirmar).
3. **Com a pessoa pagando a IA, dado restrito não vai para IA na nuvem.** Os [caminhos para dado restrito](#caminhos-para-n2) são o canal lateral, o modelo local e uma rota institucional.
4. **Além do ZDR, há a LGPD.** Dado pessoal enviado a um provider no exterior é transferência internacional. Ela depende de instrumento do controlador (o IFPR), como as cláusulas-padrão da Res. CD/ANPD nº 19/2024, e uma assinatura pessoal não é esse instrumento. Qualquer uso de dado não público com assinatura pessoal depende de parecer do encarregado de dados e da procuradoria.

## Níveis de sensibilidade

A classificação é pelo conteúdo, não pelo caminho de acesso.

| Nível | O que é | Quem pode receber |
|---|---|---|
| **N0, público** | Conteúdo publicado ou publicável (a base de conhecimento) | Qualquer provider |
| **N1, institucional** | Dado não publicado, sem identificadores pessoais | Provider que não treina com os dados, sujeito a parecer |
| **N2, restrito** | Dado pessoal identificável ou de acesso restrito | Só caminho com ZDR contratado ou modelo local |
| **N3, sigiloso** | Sigilo legal ou dado pessoal sensível (LGPD, art. 5º, II) | Nenhuma IA |

## Caminhos para N2

1. **Canal lateral.** O dado restrito vai para os olhos da pessoa, num painel do app, e a IA trabalha sobre a estrutura.
2. **Modelo local.** Um driver `opencode` com Ollama ou LM Studio: o dado não sai do computador. A qualidade e o hardware decidem se vale (ver [OpenCode e OpenRouter](opencode-openrouter.md)).
3. **Rota institucional (decisão do IFPR).** Um contrato com ZDR (API da Anthropic, Claude Enterprise, API da OpenAI, Vertex AI ou Bedrock) e com as cláusulas-padrão da ANPD.

## LGPD: perguntas ao encarregado de dados e à procuradoria

1. Dado não público com a assinatura pessoal da pessoa é aceitável? Em que condições (treino desligado, plano mínimo, tipos de dado)?
2. Para uma rota institucional, o contrato precisa das cláusulas-padrão da Res. CD/ANPD nº 19/2024, já que os providers estão no exterior?
3. É necessário um relatório de impacto à proteção de dados (RIPD) antes de o app tratar dado não público?

## Fontes

Cada uma precisa ser relida antes de fundamentar uma decisão: os termos dos providers mudam com frequência.

- Anthropic, [API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)
- Anthropic, [Claude Code — Data usage](https://code.claude.com/docs/en/data-usage)
- OpenAI, [Enterprise privacy](https://openai.com/enterprise-privacy/)
- OpenAI, [Codex — Admin rollout guide](https://developers.openai.com/codex/enterprise/)
- Google Cloud, [Vertex AI and zero data retention](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/vertex-ai-zero-data-retention)
- Res. CD/ANPD nº 19/2024 (fontes secundárias; conferir no DOU): [Mattos Filho](https://www.mattosfilho.com.br/unico/regulamentacao-transferencia-internacional-dados/), [Lefosse](https://lefosse.com/noticias/transferencia-internacional-de-dados-prazo-para-adocao-das-clausulas-padrao-da-anpd-se-encerra-em-23-de-agosto/)
