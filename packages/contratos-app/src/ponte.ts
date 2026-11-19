/**
 * `@simplifica-if/contratos-app/ponte`: o que o processo principal do desktop, o preload, a interface e
 * o servidor combinam fora do RPC. Sem nenhum import, como `motor/politica-atualizacao.ts`: o processo
 * principal do Electron, que não carrega o Effect (`apps/desktop/README.md`), importa daqui sem
 * arrastar nada para o `main.cjs`. O `@simplifica-if/contratos-app` reexporta as constantes; os
 * schemas que as usam (`EnvelopePartida`, `LinhaPartida`) ficam em `partida.ts`.
 *
 * - Os caminhos HTTP do servidor e a variável do token;
 * - as extensões de documento que a pasta da tarefa aceita e o sufixo da cópia comentada;
 * - a linha de partida, que o desktop decodifica à mão;
 * - `PonteDesktop`, o que o preload expõe em `window.simplifica`, e os canais do IPC.
 */

/* ================================================================== servidor */

/** O caminho do WebSocket do RPC. */
export const CAMINHO_RPC = "/rpc";

/** O caminho que troca o token (`Authorization: Bearer`) por um ingresso do WebSocket (`POST`). */
export const CAMINHO_INGRESSO = "/ingresso";

/** `POST` com `Authorization: Bearer <tokenDesktop>` e `{ "arquivo": "<caminho absoluto>" }`: libera o arquivo. */
export const CAMINHO_LIBERAR_ARQUIVO = "/revisao-ppc/liberar";

/** A variável de ambiente com o token, a alternativa ao `EnvelopePartida` no stdin; o desktop a tira do filho. */
export const VARIAVEL_TOKEN = "SIMPLIFICA_SERVIDOR_TOKEN";

/** Menor token aceito: 32 caracteres (o desktop gera 32 bytes aleatórios, em base64url). */
export const TAMANHO_MINIMO_TOKEN = 32;

/**
 * A linha JSON que o servidor imprime no stdout quando está pronto; é a única coisa no stdout. O
 * schema (`LinhaPartida` de `partida.ts`) a confere no servidor; o desktop a decodifica sem Effect.
 */
export interface LinhaPartida {
  readonly servidor: "simplifica-if";
  readonly pid: number;
  readonly porta: number;
  /** `ws://127.0.0.1:<porta>/rpc` */
  readonly rpc: string;
  /** `http://127.0.0.1:<porta MCP>/mcp`, o servidor MCP `ifpr` das sessões. */
  readonly mcp: string;
}

/* ================================================================== arquivos */

/**
 * O sufixo da cópia comentada: `<nome> - revisão prévia (Simplifica IF).docx` (depois ` (2)`, ` (3)`…),
 * na pasta do original. O servidor grava com ele; o desktop só abre arquivos com ele.
 */
export const SUFIXO_REVISAO_PREVIA = " - revisão prévia (Simplifica IF)";

/**
 * As extensões de documento que a pasta da tarefa aceita no "Anexar" e que "Abrir" abre no programa
 * padrão: Word e ODF atuais, PDF, texto, planilhas, apresentações, JSON e imagens. Nada que o sistema
 * execute (`.app`, `.exe`, `.command`, `.sh`, `.bat`, `.html`…) nem os formatos antigos com macro
 * (`.doc`, `.xls`): a IA escreve na pasta, e "Abrir" não pode virar "rodar".
 */
export const EXTENSOES_DOCUMENTO = [
  ".docx",
  ".odt",
  ".rtf",
  ".pdf",
  ".md",
  ".txt",
  ".csv",
  ".xlsx",
  ".ods",
  ".pptx",
  ".odp",
  ".json",
  ".png",
  ".jpg",
  ".jpeg",
] as const;

/** O arquivo tem extensão de documento (`EXTENSOES_DOCUMENTO`)? */
export const ehExtensaoDocumento = (nome: string): boolean => {
  const ponto = nome.lastIndexOf(".");
  return ponto > 0 && (EXTENSOES_DOCUMENTO as ReadonlyArray<string>).includes(nome.slice(ponto).toLowerCase());
};

/* ================================================================== window.simplifica */

/** Onde está o servidor local e com que token falar com ele. */
export interface CredenciaisServidor {
  /** `http://127.0.0.1:<porta>`: o `POST /ingresso` e o WebSocket `/rpc` ficam nela. */
  readonly urlServidor: string;
  /**
   * O token do RPC desta execução do servidor; muda quando o servidor reinicia. Vai só no
   * `Authorization` do `POST /ingresso`, nunca numa URL.
   */
  readonly token: string;
}

/**
 * O que `window.simplifica` oferece no app desktop (o preload). No navegador (o `apps/web` fora do
 * Electron), `window.simplifica` não existe. O token só sai por `conexao()`, e só para a janela do app
 * (o processo principal confere quem pede).
 */
export interface PonteDesktop {
  /** As credenciais do servidor local; espera o servidor ficar pronto. Pode ser chamada de novo a cada reconexão. */
  conexao(): Promise<CredenciaisServidor>;
  /** Abre um link http(s) no navegador do sistema; outros esquemas são recusados. */
  abrirExterno?(url: string): Promise<void>;
  /** O diálogo de pasta do sistema; `null` se a pessoa cancelar. */
  escolherPasta?(): Promise<string | null>;
  /** O diálogo de arquivo do sistema, só `.docx`; `null` se a pessoa cancelar. */
  escolherDocx?(): Promise<string | null>;
  /**
   * Abre no programa padrão (o Word) a cópia comentada de um `.docx` escolhido por `escolherDocx`;
   * outro arquivo é recusado.
   */
  abrirDocumento?(caminho: string): Promise<void>;
  /** Mostra a cópia comentada na pasta (Finder, Explorador); mesma regra de `abrirDocumento`. */
  mostrarNaPasta?(caminho: string): Promise<void>;
  /**
   * O diálogo de arquivo para anexar à tarefa (M1.9), filtrado por `extensoes` (só documentos; ver
   * `EXTENSOES_DOCUMENTO`); o processo principal libera o arquivo escolhido no servidor, e
   * `pasta.anexar` o copia para a pasta da tarefa. `null` se a pessoa cancelar.
   */
  escolherAnexo?(extensoes?: ReadonlyArray<string>): Promise<string | null>;
  /**
   * Os arquivos soltos na caixa de pedido (arrastar e soltar), com a mesma regra de `escolherAnexo`: o
   * preload tira o caminho de cada `File` (`webUtils.getPathForFile`, que só o dá para arquivo vindo do
   * sistema) e o processo principal confere e libera no servidor. Devolve, na ordem dos arquivos, o
   * caminho liberado ou `null` para o recusado (pasta, extensão fora de `extensoes`, `File` sem caminho).
   */
  anexarSoltos?(
    arquivos: ReadonlyArray<File>,
    extensoes?: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<string | null>>;
  /** Abre no programa padrão um documento da pasta de uma tarefa (`Documentos/Simplifica IF/<tarefa>/`). */
  abrirArquivoTarefa?(caminho: string): Promise<void>;
  /** Mostra no Finder ou no Explorador um arquivo da pasta de uma tarefa. */
  mostrarArquivoTarefa?(caminho: string): Promise<void>;
  /**
   * Reinicia o servidor local (novo token e nova porta; a janela recarrega). A atualização da base usa
   * para trocar o arquivo: a troca só acontece na abertura do servidor (M1.10).
   */
  reiniciarServidor?(): Promise<void>;
  /** O estado da atualização do app (`electron-updater`). */
  atualizacaoApp?(): Promise<EstadoAtualizacaoApp>;
  /** Procura uma versão nova do app agora. */
  procurarAtualizacaoApp?(): Promise<EstadoAtualizacaoApp>;
  /** "Reiniciar para atualizar": fecha o app e instala a versão baixada. */
  instalarAtualizacaoApp?(): Promise<void>;
  /**
   * A janela sem a barra de título do sistema (`apps/desktop/src/janela.ts`): a interface transforma o
   * cabeçalho na barra e reserva o lugar dos botões do sistema. Só existe no desktop.
   */
  janela?: JanelaDesktop;
}

/** O que a interface precisa saber da janela para desenhar a barra de título. */
export interface JanelaDesktop {
  /** `process.platform`: no `darwin`, os semáforos à esquerda; nos outros, os botões à direita. */
  readonly plataforma: string;
  /** Se a janela está em tela cheia agora (no macOS, os semáforos somem). */
  telaCheia(): Promise<boolean>;
  /** Avisa quando a janela entra ou sai da tela cheia; devolve a função que para de avisar. */
  aoMudarTelaCheia(ouvinte: (telaCheia: boolean) => void): () => void;
}

/** O estado da atualização do app, como a seção "Atualizações" mostra. */
export interface EstadoAtualizacaoApp {
  readonly versao: string;
  /** `null`: ligada; senão, o motivo (sem assinatura de código, sem feed, desenvolvimento). */
  readonly desligada: string | null;
  readonly situacao: "parada" | "procurando" | "baixando" | "pronta" | "em-dia" | "erro";
  /** A versão nova, baixando ou pronta para instalar. */
  readonly nova: string | null;
  readonly progresso: number | null;
  readonly erro: string | null;
}

/** O nome em `window`. */
export const NOME_PONTE = "simplifica";

/** Os canais do IPC entre o preload e o processo principal. */
export const CANAIS = {
  conexao: "simplifica:conexao",
  abrirExterno: "simplifica:abrir-externo",
  escolherPasta: "simplifica:escolher-pasta",
  escolherDocx: "simplifica:escolher-docx",
  abrirDocumento: "simplifica:abrir-documento",
  mostrarNaPasta: "simplifica:mostrar-na-pasta",
  reiniciarServidor: "simplifica:reiniciar-servidor",
  atualizacaoApp: "simplifica:atualizacao-app",
  procurarAtualizacaoApp: "simplifica:procurar-atualizacao-app",
  instalarAtualizacaoApp: "simplifica:instalar-atualizacao-app",
  escolherAnexo: "simplifica:escolher-anexo",
  anexarSoltos: "simplifica:anexar-soltos",
  abrirArquivoTarefa: "simplifica:abrir-arquivo-tarefa",
  mostrarArquivoTarefa: "simplifica:mostrar-arquivo-tarefa",
  telaCheia: "simplifica:tela-cheia",
  /** Do processo principal para a janela: entrou (`true`) ou saiu (`false`) da tela cheia. */
  telaCheiaMudou: "simplifica:tela-cheia-mudou",
} as const;
