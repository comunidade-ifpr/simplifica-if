# Planos

Planos de trabalho do projeto. Cada plano registra decisões, entregas e critérios de aceite; o andamento fica no próprio plano.

| Plano | Escopo | Situação |
|---|---|---|
| [PLANO-ARQUITETURA.md](../../PLANO-ARQUITETURA.md) | Base de conhecimento, `packages/kb`, CLI `kb`, migração Python → TypeScript | Fases 0 a 6 em `main`; ainda na raiz |
| [app-simplifica-if.md](app-simplifica-if.md) | App desktop Simplifica IF até o Marco 2: app próprio no monorepo com a stack do T3, motor, língua do código, interface em português | Direção revista em 14/11/2026: app próprio, sem fork. Em `main`: M1.0, M1.1 (servidor, desktop, interface), M1.2 e M1.7 mínimos, M1.4, M1.5; skills do app nas conversas (M0.4 e M1.11 em parte, 16/11/2026) |
| [m0-simplifica-mcp.md](m0-simplifica-mcp.md) | M0.1: servidor MCP `simplifica-mcp`, 16 ferramentas, banco autossuficiente | T0 a T7 prontos (16 ferramentas, instruções, [guia do piloto zero](../guia-piloto-zero.md), suítes transversais e CI no GitHub Actions); falta o critério de uso real (10 perguntas no Claude Code e no Codex) |
| [consolidacao-stack-t3.md](consolidacao-stack-t3.md) | Migração do repositório para a stack do T3 Code: Node, pnpm, Effect 4, Effect Schema (etapas C0 a C3) | C0 a C3 em `main`; consolidação concluída |
| [app-seguranca-dados.md](app-seguranca-dados.md) | Credenciais SUAP e SEI, níveis de sensibilidade, garantias de retenção dos providers (ZDR), LGPD | Suspenso: SUAP e SEI fora do app até o Marco 2 |

Documentos de apoio:

| Documento | Para quê |
|---|---|
| [upstream-t3.md](../upstream-t3.md) | Código copiado do T3 Code: origem, commit, adaptações; `pnpm upstream:t3 status\|diff` |
| [guia-piloto-zero.md](../guia-piloto-zero.md) | Guia de uma página para instalar o `simplifica-mcp` no app que a pessoa já usa (M0.6) |
| [packages/motor/README.md](../../packages/motor/README.md) | Achados da PoC do motor (M1.0): como cada provider recebe o MCP, detecção, armadilhas |
