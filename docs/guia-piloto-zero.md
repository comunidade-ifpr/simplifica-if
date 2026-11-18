# Guia de instalação do piloto zero

Para a equipe da PROENS/DENS e as coordenações que vão testar a base de conhecimento do IFPR dentro de uma IA (Claude, Codex ou Gemini). Depois de instalado, a IA consulta normas, PPCs, cursos e o CNCT da base e responde com o texto literal e um link `ifpr://` para cada fonte. O servidor não acessa a internet: ele só lê um arquivo no seu computador. O que a IA lê dele segue para o provedor da IA como o resto da conversa, então use os mesmos cuidados de sempre com dados pessoais.

Situação em 14/11/2026.

Este guia serve para usar a base num app de IA que você já tem, sem o app Simplifica IF. O app desktop Simplifica IF traz o mesmo servidor e a base embutidos: quem usa o app não precisa deste guia.

## 1. Os dois arquivos

Você precisa de dois arquivos, que a equipe do projeto entrega:

| Arquivo | O que é |
|---|---|
| `simplifica-mcp` (no Windows, `simplifica-mcp.exe`) | o programa que liga a IA à base (cerca de 140 MB) |
| `kb.sqlite` | a base, numa data de referência (cerca de 140 MB) |

**Hoje quem prepara os arquivos é a equipe do projeto.** Ainda não há um instalador nem um link de download: isso é o passo M0.2 do plano. Até lá, a equipe gera o programa (`pnpm mcp:executavel`, com `--alvo win-x64` para o Windows) e a base (`pnpm kb:compilar`, que grava `tmp/kb.sqlite`) a partir do repositório, e os envia a você. Quando a base for atualizada, você recebe só um `kb.sqlite` novo e substitui o antigo.

## 2. Onde pôr os arquivos

Crie uma pasta `SimplificaIF` na sua pasta pessoal e ponha os dois arquivos nela.

| Sistema | Pasta | Caminho completo (troque `seu-usuario`) |
|---|---|---|
| macOS | `SimplificaIF`, na sua pasta de início | `/Users/seu-usuario/SimplificaIF/` |
| Windows | `SimplificaIF`, em `C:\Users\seu-usuario` | `C:\Users\seu-usuario\SimplificaIF\` |

Nas configurações abaixo, escreva sempre o **caminho completo**, sem `~` e sem `%USERPROFILE%`: nem todo programa os entende. Para copiar o caminho exato de um arquivo: no macOS, clique no arquivo com o botão direito, segure a tecla Option e escolha **Copiar "…" como Nome de Caminho**; no Windows, clique com o botão direito segurando Shift e escolha **Copiar como caminho**.

**Primeira execução.** O programa ainda não tem assinatura digital (também é do M0.2), e o sistema pode bloqueá-lo. No macOS, se aparecer um aviso de que ele não pode ser aberto, vá em **Ajustes do Sistema › Privacidade e Segurança** e clique em **Abrir Mesmo Assim**. No Windows, se o SmartScreen avisar, clique em **Mais informações › Executar assim mesmo**. Na dúvida, chame a equipe.

## 3. Configurar a sua IA

Em todos os exemplos, o servidor se chama `ifpr`. Troque os caminhos pelos seus. No Windows, dentro de arquivos `.json`, cada `\` vira `\\`.

### Claude Desktop

1. Abra **Configurações › Desenvolvedor › Editar configuração** (*Settings › Developer › Edit Config*). Isso abre o arquivo `claude_desktop_config.json` (no macOS, em `~/Library/Application Support/Claude/`; no Windows, em `%APPDATA%\Claude\`).
2. Ponha este conteúdo. Se o arquivo já tiver um bloco `"mcpServers"`, acrescente só a parte `"ifpr": { … }` dentro dele.

macOS:

```json
{
  "mcpServers": {
    "ifpr": {
      "command": "/Users/seu-usuario/SimplificaIF/simplifica-mcp",
      "args": ["--banco", "/Users/seu-usuario/SimplificaIF/kb.sqlite"]
    }
  }
}
```

Windows:

```json
{
  "mcpServers": {
    "ifpr": {
      "command": "C:\\Users\\seu-usuario\\SimplificaIF\\simplifica-mcp.exe",
      "args": ["--banco", "C:\\Users\\seu-usuario\\SimplificaIF\\kb.sqlite"]
    }
  }
}
```

3. **Feche o Claude Desktop por completo** (no macOS, Claude › Sair; no Windows, também pelo ícone perto do relógio) e abra de novo.

### Claude Code

No Terminal (macOS) ou no PowerShell (Windows), uma linha só:

```bash
claude mcp add --scope user ifpr -- /Users/seu-usuario/SimplificaIF/simplifica-mcp --banco /Users/seu-usuario/SimplificaIF/kb.sqlite
```

No Windows, com os caminhos `C:\Users\seu-usuario\SimplificaIF\simplifica-mcp.exe` e `C:\Users\seu-usuario\SimplificaIF\kb.sqlite` (aqui sem dobrar a barra). `--scope user` deixa o servidor disponível em qualquer pasta; sem ele, só na pasta em que você rodou o comando. Para conferir: `claude mcp list` deve mostrar `ifpr` com **✔ Connected**.

### Codex

No Terminal ou no PowerShell:

```bash
codex mcp add ifpr -- /Users/seu-usuario/SimplificaIF/simplifica-mcp --banco /Users/seu-usuario/SimplificaIF/kb.sqlite
```

Ou edite o arquivo `config.toml` da pasta `.codex` da sua pasta pessoal e acrescente:

```toml
[mcp_servers.ifpr]
command = "/Users/seu-usuario/SimplificaIF/simplifica-mcp"
args = ["--banco", "/Users/seu-usuario/SimplificaIF/kb.sqlite"]
```

No Windows, no `.toml`, use aspas simples, que não exigem dobrar a barra: `command = 'C:\Users\seu-usuario\SimplificaIF\simplifica-mcp.exe'`. Dentro do Codex, `/mcp` lista os servidores ativos.

### Gemini CLI

A página oficial do Gemini CLI informa que ele foi substituído pelo Antigravity CLI em 18/06/2026. Para quem ainda o usa, acrescente ao arquivo `settings.json` da pasta `.gemini` da sua pasta pessoal:

```json
{
  "mcpServers": {
    "ifpr": {
      "command": "/Users/seu-usuario/SimplificaIF/simplifica-mcp",
      "args": ["--banco", "/Users/seu-usuario/SimplificaIF/kb.sqlite"]
    }
  }
}
```

Ou, no terminal: `gemini mcp add --scope user ifpr /Users/seu-usuario/SimplificaIF/simplifica-mcp --banco /Users/seu-usuario/SimplificaIF/kb.sqlite`. Dentro do Gemini, `/mcp` lista os servidores e as ferramentas.

## 4. Testar

Abra uma conversa nova e pergunte:

> Qual é a carga horária mínima do curso Técnico em Enfermagem no CNCT? Cite a fonte e a data da base.

O que esperar:

- A IA pede permissão para usar uma ferramenta do servidor `ifpr` (como `ficha_curso` ou `listar_cursos`). Autorize.
- A resposta diz **1.200 horas**, com um link `ifpr://cnct/tecnico-em-enfermagem` e a data da base (por exemplo, "13/11/2026").
- Respostas sobre normas trazem o texto do artigo entre aspas ou em citação, com o link `ifpr://norma/…`. Avisos como "vigência a confirmar" e "fato extraído sem revisão" são parte da resposta: leve-os em conta.

Outras boas perguntas para o piloto: "Quais cursos técnicos do campus Curitiba precisam se adequar à Resolução CNE/CP nº 2/2026?" e "Como outros PPCs escreveram a seção de acompanhamento de egressos?".

## 5. Se não aparecer

1. **Feche e abra a IA de novo.** Ela só lê a configuração ao iniciar.
2. **Confira os caminhos.** Abra a pasta `SimplificaIF` e veja se os nomes dos arquivos são exatamente os da configuração (no Windows, com `.exe`). Um erro de digitação é a causa mais comum.
3. **Confira o arquivo de configuração.** No `.json`, uma vírgula ou chave a mais impede a leitura; no Windows, as barras precisam estar dobradas.
4. **Veja o estado do servidor.** Claude Code: `claude mcp list`. Codex e Gemini: `/mcp` dentro da conversa. Claude Desktop: no botão de anexos à esquerda da caixa de texto, **Conectores › Gerenciar conectores**.
5. **Leia o registro do Claude Desktop.** No macOS, em `~/Library/Logs/Claude/`; no Windows, em `%APPDATA%\Claude\logs\`. O arquivo `mcp-server-ifpr.log` mostra a mensagem do servidor. As mais comuns:
   - `kb.sqlite não encontrado ou ilegível`: o caminho do `--banco` está errado;
   - `base incompatível com esta versão do simplifica-mcp; atualize`: a base e o programa são de versões diferentes; peça os dois à equipe.
6. **Ainda não funcionou?** Mande à equipe do projeto o nome da IA, o sistema (macOS ou Windows), a sua configuração e a mensagem do registro.

## Fontes

Comandos e formatos conferidos em 14/11/2026 na documentação oficial de cada cliente:

- Claude Code, "Connect Claude Code to tools via MCP": <https://code.claude.com/docs/en/mcp> (`claude mcp add [opções] <nome> -- <comando> [args]`, `--scope local|project|user`, `claude mcp list`, `/mcp`). Testado com o Claude Code 2.1.323, em escopo de projeto num diretório temporário, com o executável e o `kb.sqlite` reais.
- Claude Desktop, "Connect to local MCP servers": <https://modelcontextprotocol.io/docs/develop/connect-local-servers> (local do `claude_desktop_config.json`, Settings › Developer › Edit Config, caminhos absolutos, reinício completo, registros em `~/Library/Logs/Claude` e `%APPDATA%\Claude\logs`).
- Codex, "Model Context Protocol": <https://developers.openai.com/codex/mcp> (hoje redireciona para <https://learn.chatgpt.com/docs/extend/mcp?surface=cli>; `~/.codex/config.toml`, `[mcp_servers.<nome>]` com `command` e `args`, `codex mcp add <nome> -- <comando>`, `/mcp`).
- Gemini CLI, "MCP servers with the Gemini CLI": <https://geminicli.com/docs/tools/mcp-server> (`~/.gemini/settings.json`, `mcpServers` com `command` e `args`, `gemini mcp add [opções] <nome> <comando> [args]` com `--scope user|project`, `/mcp`; aviso de substituição pelo Antigravity CLI).
