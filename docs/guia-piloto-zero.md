# Guia de instalação do piloto zero

Para a equipe da PROENS/DENS e as coordenações que vão usar a base de conhecimento do IFPR dentro de um app de IA que já têm (Claude, Codex ou Antigravity), sem o app Simplifica IF. Depois de instalado, a IA consulta normas, PPCs, cursos e o CNCT da base e responde com o texto literal e um link `ifpr://` para cada fonte. O servidor não acessa a internet: ele só lê um arquivo no seu computador. O que a IA lê dele segue para o provedor da IA como o resto da conversa, então use os mesmos cuidados de sempre com dados pessoais.

O app desktop Simplifica IF traz o mesmo servidor e a base embutidos: quem usa o app não precisa deste guia.

Use a versão mais recente do seu app de IA. O `simplifica-mcp` acompanha a versão atual do protocolo MCP, sem compatibilidade com versões antigas, e funciona como servidor local: a própria IA abre o programa no seu computador (transporte stdio). Não há endereço na internet para configurar.

## 1. Os dois arquivos

| Arquivo | O que é |
|---|---|
| `simplifica-mcp` (no Windows, `simplifica-mcp.exe`) | o programa que liga a IA à base; não precisa de Node instalado |
| `kb.sqlite` | a base, numa data de referência (cerca de 200 MB) |

**Quem entrega os arquivos é a equipe do projeto.** O programa é construído pela integração contínua do repositório para macOS (Apple Silicon), Windows e Linux (`pnpm mcp:executavel`; `--alvo` ou `--todos` para outra plataforma, como o macOS Intel), e a base sai de `pnpm kb:compilar` (`tmp/kb.sqlite`). Ainda não há link público de download nem assinatura digital do programa. Quando a base for atualizada, você recebe um `kb.sqlite` novo e substitui o antigo; se o programa recusar a base nova, peça também o programa novo.

## 2. Onde pôr os arquivos

Crie uma pasta `SimplificaIF` na sua pasta pessoal e ponha os dois arquivos nela: no macOS, `/Users/seu-usuario/SimplificaIF/`; no Windows, `C:\Users\seu-usuario\SimplificaIF\`.

Nas configurações abaixo, escreva sempre o **caminho completo**, sem `~` e sem `%USERPROFILE%`: nem todo programa os entende. Para copiar o caminho exato: no macOS, botão direito no arquivo, segure Option e escolha **Copiar "…" como Nome de Caminho**; no Windows, botão direito segurando Shift e **Copiar como caminho**.

**Primeira execução.** Como o programa não tem assinatura digital, o sistema pode bloqueá-lo. No macOS, vá em **Ajustes do Sistema › Privacidade e Segurança** e clique em **Abrir Mesmo Assim**. No Windows, se o SmartScreen avisar, clique em **Mais informações › Executar assim mesmo**.

## 3. Configurar a sua IA

Em todos os exemplos, o servidor se chama `ifpr` e recebe a base em `--banco`. Troque os caminhos pelos seus. No Windows, use `simplifica-mcp.exe` e, dentro de arquivos `.json`, dobre cada `\`.

**Claude Code** (Terminal ou PowerShell). `--scope user` deixa o servidor disponível em qualquer pasta; `claude mcp list` deve mostrar `ifpr` como conectado.

```bash
claude mcp add --scope user ifpr -- /Users/seu-usuario/SimplificaIF/simplifica-mcp --banco /Users/seu-usuario/SimplificaIF/kb.sqlite
```

**Codex.** Dentro do Codex, `/mcp` lista os servidores ativos.

```bash
codex mcp add ifpr -- /Users/seu-usuario/SimplificaIF/simplifica-mcp --banco /Users/seu-usuario/SimplificaIF/kb.sqlite
```

**Antigravity (`agy`, o sucessor do Gemini CLI).** O comando grava em `.gemini/config/mcp_config.json`, na sua pasta pessoal; `agy mcp list` confere.

```bash
agy mcp add ifpr -- /Users/seu-usuario/SimplificaIF/simplifica-mcp --banco /Users/seu-usuario/SimplificaIF/kb.sqlite
```

**Claude Desktop.** Em **Configurações › Desenvolvedor › Editar configuração**, abra o `claude_desktop_config.json` e ponha o bloco abaixo (se já houver `"mcpServers"`, acrescente só `"ifpr": { … }` dentro dele). Depois, feche o Claude Desktop por completo e abra de novo.

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

## 4. Testar

Abra uma conversa nova e pergunte:

> Qual é a carga horária mínima do curso Técnico em Enfermagem no CNCT? Cite a fonte e a data da base.

A IA pede permissão para usar uma ferramenta do servidor `ifpr` (como `ficha_curso` ou `listar_cursos`); autorize. A resposta deve dizer **1.200 horas**, com o link `ifpr://cnct/tecnico-em-enfermagem` e a data da base. Avisos como "vigência a confirmar" e "fato extraído sem revisão" fazem parte da resposta. Outras boas perguntas: "Quais cursos técnicos do campus Curitiba precisam se adequar à Resolução CNE/CP nº 2/2026?" e "Como outros PPCs escreveram a seção de acompanhamento de egressos?".

## 5. Se não aparecer

1. **Feche e abra a IA de novo.** Ela só lê a configuração ao iniciar.
2. **Confira os caminhos e o arquivo de configuração.** Os nomes têm de ser exatamente os da pasta (no Windows, com `.exe`); no `.json`, uma vírgula a mais ou uma barra não dobrada impede a leitura.
3. **Veja o estado do servidor:** `claude mcp list`, `agy mcp list` ou `/mcp` no Codex; no Claude Desktop, os registros ficam em `~/Library/Logs/Claude/` (macOS) ou `%APPDATA%\Claude\logs\` (Windows), no arquivo `mcp-server-ifpr.log`. As mensagens mais comuns:
   - `kb.sqlite não encontrado ou ilegível`: o caminho depois de `--banco` está errado;
   - `base incompatível com esta versão do simplifica-mcp; atualize`: a base e o programa são de versões diferentes; peça os dois à equipe.
4. **Ainda não funcionou?** Mande à equipe o nome da IA, o sistema, a sua configuração e a mensagem do registro.
