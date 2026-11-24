# Segurança

## Como avisar

Não abra issue pública para falha de segurança. Use o aviso privado do GitHub: na aba **Security** do repositório, **Report a vulnerability** ([link direto](https://github.com/comunidade-ifpr/simplifica-if/security/advisories/new)). Só quem mantém o projeto vê o aviso, e a conversa sobre a correção segue ali até a publicação.

Conte a versão do app, o sistema (macOS ou Windows), os passos para reproduzir e o que alguém conseguiria fazer com a falha. Não mande senha, token nem dado pessoal real; um exemplo inventado basta.

## O que conta

- **App e servidor local** (`apps/desktop`, `apps/server`): outro processo ou uma página web conseguir falar com o servidor local ou com o MCP `ifpr`, ler ou gravar fora da pasta de trabalho, executar código.
- **Atualização** (`packages/atualizacao`, `apps/desktop/src/atualizacaoApp.ts`): pacote da base, das skills ou do app aceito sem assinatura válida, troca de canal ou de feed.
- **`simplifica-mcp`** (`packages/mcp`).
- **Dado pessoal publicado na base** (CPF, RG, celular, matrícula, SIAPE, e-mail particular): avise por aqui, não por issue, para não espalhar o dado mais ainda.
- **Segredo publicado** no repositório ou no histórico do git.

## O que não conta

- Erro de conteúdo da base (norma desatualizada, citação errada, dado de PPC incorreto): use "Isto está errado" no app ou abra uma issue.
- O comportamento das IAs (Claude, ChatGPT, Gemini) e dos programas delas: avise o fornecedor.

## Versões

Só a versão mais recente de cada canal recebe correção.
