# Planos

Planos vivos do projeto: decisões, o que está em `main` e o que falta. O trabalho concluído sai do plano e fica no histórico do git.

| Plano | Escopo | Situação |
|---|---|---|
| [app-simplifica-if.md](app-simplifica-if.md) | App desktop Simplifica IF até o Marco 2: decisões, arquitetura, situação dos marcos e o que falta | Marcos M0 e M1 em `main`, salvo assinatura, feed de produção, avaliação real com Codex e Antigravity e o piloto; Marco 2 por fazer |
| [arquitetura-base.md](arquitetura-base.md) | Base de conhecimento, `packages/kb`, CLI `kb` e MCP: IDs canônicos, banco derivado, proveniência, vigência | Fases 0 e 2 a 7 em `main`; em aberto as revisões humanas e jurídicas |
| [revisao-ppc-interface.md](revisao-ppc-interface.md) | Redesenho do "Revisar um PPC" (régua de critérios, lista por gravidade, faixa da IA) e do sistema visual do app (tokens, tipografia, componentes) | Em `main` desde 21/11/2026; em aberto o tom do cabeçalho no tema escuro, a cor da barra de título do desktop e o teste de navegador de "Continuar" e "Escolher o arquivo de novo" |
| [app-seguranca-dados.md](app-seguranca-dados.md) | Retenção de dados nos providers (ZDR), níveis de sensibilidade, LGPD | Suspenso: SUAP e SEI fora do app até o Marco 2 |
| [opencode-openrouter.md](opencode-openrouter.md) | Caminho para modelos do OpenRouter com retenção zero (ZDR) e modelos locais: OpenCode por ACP | Pesquisa de 19/11/2026; nada implementado |

Documentos de apoio:

| Documento | Para quê |
|---|---|
| [upstream-t3.md](../upstream-t3.md) | Código copiado do T3 Code: origem, commit, adaptações; `pnpm upstream:t3 status\|diff` |
| [guia-piloto-zero.md](../guia-piloto-zero.md) | Guia de uma página para usar o `simplifica-mcp` fora do app, no app de IA que a pessoa já usa |
| [packages/motor/README.md](../../packages/motor/README.md) | Como cada provider recebe o MCP, detecção, armadilhas |
