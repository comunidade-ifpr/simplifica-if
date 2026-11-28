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
export const CAMINHO_LIBERAR_ARQUIVO = "/arquivos/liberar";

/** `GET` com `Authorization: Bearer <tokenDesktop>`: devolve `{ "originais": [...], "acompanhados": [...] }` das revisões de PPC ativas. */
export const CAMINHO_ARQUIVOS_LIBERADOS = "/arquivos/liberados";

/** A variável de ambiente com o token, a alternativa ao `EnvelopePartida` no stdin; o desktop a tira do filho. */
export const VARIAVEL_TOKEN = "SIMPLIFICA_SERVIDOR_TOKEN";

/** Menor token aceito: 32 caracteres (o desktop gera 32 bytes aleatórios, em base64url). */
export const TAMANHO_MINIMO_TOKEN = 32;

/**
 * A linha JSON que o servidor imprime no stdout quando está pronto; é a única coisa no stdout. O
 * schema (`LinhaPartida` de `partida.ts`) a confere no servidor e no desktop.
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

/* ================================================================== diagnóstico */

/**
 * O código de um erro, o mesmo na interface e no log: os 8 primeiros caracteres do `traceId` do pedido.
 * O `RpcClient` abre um span por chamada e manda o `traceId` ao servidor, e o span do handler é filho
 * dele; a interface mostra o código em "Detalhes técnicos", e o log do servidor e o da interface o trazem.
 */
export const codigoDoErro = (traceId: string): string => traceId.slice(0, 8).toUpperCase();

/** O maior registro que a interface manda ao log do app (`PonteDesktop.registrarErro`); o resto é cortado. */
export const LIMITE_REGISTRO_INTERFACE = 4000;

/**
 * O registro cortado para caber em `limite` caracteres (unidades UTF-16), já com o "…" do corte, sem
 * partir um par de surrogates. A interface corta assim; o processo principal corta de novo, por defesa.
 */
export const cortarRegistro = (texto: string, limite: number = LIMITE_REGISTRO_INTERFACE): string => {
  if (texto.length <= limite) return texto;
  let fim = Math.max(0, limite - 1);
  const ultimo = texto.charCodeAt(fim - 1);
  if (fim > 0 && ultimo >= 0xd800 && ultimo <= 0xdbff) fim -= 1;
  return `${texto.slice(0, fim)}…`;
};

/* ================================================================== arquivos */

/**
 * Composição (módulo `revisao-ppc`). O sufixo da cópia comentada: `<nome> - revisão prévia (Simplifica IF).docx`, na pasta do original,
 * regravada a cada revisão (` (2)`, ` (3)`… quando ela está travada ou foi editada pela pessoa). O
 * servidor grava com ele; o desktop só abre arquivos com ele.
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

/** As pastas da raiz (`Documentos/Simplifica IF`) que o app grava e que não são de tarefa. */
export const PASTA_RELATOS = "Relatos de erro";
export const PASTA_DIAGNOSTICOS = "Diagnósticos";

/** O nome é de uma pasta do app (comparado sem caixa nem forma Unicode)? */
export const ehPastaDoApp = (nome: string): boolean =>
  [PASTA_RELATOS, PASTA_DIAGNOSTICOS].some(
    (pasta) => pasta.normalize("NFC").toLowerCase() === nome.normalize("NFC").toLowerCase(),
  );

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
  /** Abre um link http(s) no navegador do sistema, ou um `mailto:` no programa de e-mail; outros esquemas são recusados. */
  abrirExterno(url: string): Promise<void>;
  /*
   * Composição: a parte do módulo `revisao-ppc` (`escolherDocx`, `soltarDocx`, `abrirDocumento`,
   * `mostrarNaPasta`), estreita, por caso de uso; o preload a tira de `apps/desktop/src/modulos/revisao-ppc/`.
   */
  /** O diálogo de arquivo do sistema, só `.docx`; `null` se a pessoa cancelar. */
  escolherDocx(): Promise<string | null>;
  /**
   * O `.docx` solto na área de soltar da revisão (arrastar e soltar), com a regra de `escolherDocx`: o
   * preload tira o caminho do `File` (`webUtils.getPathForFile`) e o processo principal confere e libera
   * no servidor (para `revisaoPpc.revisar`, `abrirDocumento` e `mostrarNaPasta`). `null` se recusado
   * (outra extensão, pasta, `File` sem caminho).
   */
  soltarDocx(arquivo: File): Promise<string | null>;
  /**
   * Abre no programa padrão (o Word) a cópia comentada de um `.docx` escolhido por `escolherDocx`, ou o
   * próprio `.docx` escolhido nesta execução (o que a revisão acompanha no Word); outro arquivo é recusado.
   */
  abrirDocumento(caminho: string): Promise<void>;
  /**
   * Mostra na pasta (Finder, Explorador) só a cópia comentada de um `.docx` escolhido por `escolherDocx`,
   * e não o `.docx` acompanhado que `abrirDocumento` também aceita.
   */
  mostrarNaPasta(caminho: string): Promise<void>;
  /**
   * O diálogo de arquivo para anexar à tarefa (M1.9), filtrado por `extensoes` (só documentos; ver
   * `EXTENSOES_DOCUMENTO`); o processo principal libera o arquivo escolhido no servidor, e
   * `pasta.anexar` o copia para a pasta da tarefa. `null` se a pessoa cancelar.
   */
  escolherAnexo(extensoes?: ReadonlyArray<string>): Promise<string | null>;
  /**
   * Os arquivos soltos na caixa de pedido (arrastar e soltar), com a mesma regra de `escolherAnexo`: o
   * preload tira o caminho de cada `File` (`webUtils.getPathForFile`, que só o dá para arquivo vindo do
   * sistema) e o processo principal confere e libera no servidor. Devolve, na ordem dos arquivos, o
   * caminho liberado ou `null` para o recusado (pasta, extensão fora de `extensoes`, `File` sem caminho).
   */
  anexarSoltos(arquivos: ReadonlyArray<File>, extensoes?: ReadonlyArray<string>): Promise<ReadonlyArray<string | null>>;
  /** Abre no programa padrão um documento da pasta de uma tarefa (`Documentos/Simplifica IF/<tarefa>/`). */
  abrirArquivoTarefa(caminho: string): Promise<void>;
  /** Mostra no Finder ou no Explorador um arquivo da pasta de uma tarefa. */
  mostrarArquivoTarefa(caminho: string): Promise<void>;
  /**
   * Manda à Lixeira do sistema a pasta de uma tarefa (`Documentos/Simplifica IF/<tarefa>`), depois de a
   * conversa dela ser apagada. Só a pasta filha direta da raiz, que não é link nem uma pasta do app
   * (relatos, diagnósticos); nunca apaga de vez.
   */
  pastaParaLixeira(caminho: string): Promise<void>;
  /**
   * Reinicia o servidor local (novo token e nova porta; a janela recarrega). A atualização da base usa
   * para trocar o arquivo: a troca só acontece na abertura do servidor (M1.10).
   */
  reiniciarServidor(): Promise<void>;
  /**
   * Grava no log do app (`simplifica-if.log`) um erro da interface: o console da janela ninguém vê no app
   * empacotado. Uma linha de texto, cortada em `LIMITE_REGISTRO_INTERFACE`.
   */
  registrarErro(texto: string): Promise<void>;
  /**
   * A janela sem a barra de título do sistema (`apps/desktop/src/janela.ts`): a interface transforma o
   * cabeçalho na barra e reserva o lugar dos botões do sistema. Só existe no desktop.
   */
  janela: JanelaDesktop;
}

/** O que uma janela do desktop faz da continuidade (`JanelaDesktop.continuidade`). */
export type ContinuidadeDaJanela = "completa" | "so-grava" | "nenhuma";

/** O que a interface precisa saber da janela para desenhar a barra de título. */
export interface JanelaDesktop {
  /** `process.platform`: no `darwin`, os semáforos à esquerda; nos outros, os botões à direita. */
  readonly plataforma: string;
  /**
   * O que a janela faz da continuidade (`apps/desktop/src/janelas.ts`): `completa`, a principal aberta com o
   * app, grava e volta; `so-grava`, a aberta por "Abrir em nova janela" quando não havia principal, passa a
   * ser a principal e grava, sem voltar (abre na rota pedida); `nenhuma`, as outras de "Abrir em nova
   * janela", não gravam nem voltam.
   */
  readonly continuidade: ContinuidadeDaJanela;
  /**
   * Abre uma janela nova do app na `rota` (`/…`, no formato da rota guardada na continuidade, sem o
   * `compacto=1`): "Abrir em nova janela", ⇧⌘-clique (Ctrl+Shift+clique). Cada janela tem a sua conexão com o
   * servidor. A rota de outra origem é recusada.
   */
  abrirJanela(rota: string): Promise<void>;
  /** Se a janela está em tela cheia agora (no macOS, os semáforos somem). */
  telaCheia(): Promise<boolean>;
  /** Avisa quando a janela entra ou sai da tela cheia; devolve a função que para de avisar. */
  aoMudarTelaCheia(ouvinte: (telaCheia: boolean) => void): () => void;
  /**
   * O tema que a pessoa escolheu na interface: o fundo da janela e os símbolos dos botões do sistema
   * (Windows e Linux) seguem a escolha, e não o tema do sistema.
   */
  temaDoApp(tema: TemaDoApp): Promise<void>;
  /**
   * Avisa quando a pessoa escolhe um atalho no menu (Arquivo: Abrir em nova janela; Ver: Buscar na base,
   * Mostrar ou esconder o painel, Perguntar à IA), ou
   * quando a tecla dele chega ao menu (no macOS, a que a interface não tratou; `apps/desktop/src/menu.ts`).
   * Devolve a função que para de avisar.
   */
  aoAtalhoDoMenu(ouvinte: (atalho: AtalhoMenu) => void): () => void;
  /**
   * O aviso do sistema (`docs/plans/multitarefa.md`, "Em andamento"): "Uma resposta está pronta" ou "A IA
   * pede uma permissão", sem nada da conversa; o processo principal só o mostra com as janelas sem foco
   * (todas pedem; vale o pedido da última usada), e o clique traz a janela que mostra a rota, ou a última
   * usada, e manda a rota a ela (`aoAbrirRota`).
   */
  avisar(aviso: AvisoSistema): Promise<void>;
  /** O selo com a contagem do que espera a pessoa (no macOS, no Dock; 0 tira). */
  selo(contagem: number): Promise<void>;
  /** Avisa quando o clique num aviso do sistema pede uma rota; devolve a função que para de avisar. */
  aoAbrirRota(ouvinte: (rota: string) => void): () => void;
  /**
   * O modo compacto (`docs/plans/multitarefa.md`, "Modo compacto ao lado do Word"): ligado, a janela vira
   * uma coluna de uns 380 px encostada à direita da tela, com a altura toda e sempre por cima; desligado,
   * volta às medidas de antes. A página que recarrega volta com a janela fora do modo. Devolve se o modo
   * ficou ligado: não liga com a janela que não saiu da tela cheia a tempo.
   */
  compacta(ligar: boolean): Promise<boolean>;
  /** O alfinete do modo compacto: solta (`false`) ou prende (`true`) o "sempre por cima". */
  naFrente(sempre: boolean): Promise<void>;
  /**
   * O app vai fechar (sair do app ou fechar a janela): o processo principal espera `gravar` (a continuidade,
   * onde a pessoa estava) terminar, por no máximo 1 s, antes de fechar. Devolve a função que para de ouvir.
   */
  antesDeSair(gravar: () => Promise<void>): () => void;
}

/** O aviso do sistema: a resposta pronta ou o pedido de permissão, e a rota da conversa (ou da revisão). */
export interface AvisoSistema {
  readonly tipo: "resposta" | "permissao";
  readonly rota: string;
}

/** Os atalhos do menu que a interface atende. */
export type AtalhoMenu = "buscar" | "painel" | "conversar" | "novaJanela";

/** A escolha de tema da interface (`apps/web/src/tema.ts`). */
export type TemaDoApp = "sistema" | "claro" | "escuro";

/** O nome em `window`. */
export const NOME_PONTE = "simplifica";

/** Os canais do IPC entre o preload e o processo principal. */
export const CANAIS = {
  conexao: "simplifica:conexao",
  abrirExterno: "simplifica:abrir-externo",
  // Composição: os canais do módulo `revisao-ppc`.
  escolherDocx: "simplifica:escolher-docx",
  soltarDocx: "simplifica:soltar-docx",
  abrirDocumento: "simplifica:abrir-documento",
  mostrarNaPasta: "simplifica:mostrar-na-pasta",
  reiniciarServidor: "simplifica:reiniciar-servidor",
  registrarErro: "simplifica:registrar-erro",
  escolherAnexo: "simplifica:escolher-anexo",
  anexarSoltos: "simplifica:anexar-soltos",
  abrirArquivoTarefa: "simplifica:abrir-arquivo-tarefa",
  mostrarArquivoTarefa: "simplifica:mostrar-arquivo-tarefa",
  pastaParaLixeira: "simplifica:pasta-para-lixeira",
  telaCheia: "simplifica:tela-cheia",
  temaDoApp: "simplifica:tema-do-app",
  /** Do processo principal para a janela: entrou (`true`) ou saiu (`false`) da tela cheia. */
  telaCheiaMudou: "simplifica:tela-cheia-mudou",
  /** Do processo principal para a janela: um atalho escolhido no menu (`AtalhoMenu`). */
  atalhoDoMenu: "simplifica:atalho-do-menu",
  avisar: "simplifica:avisar",
  selo: "simplifica:selo",
  /** Do processo principal para a janela: o clique num aviso do sistema pede esta rota. */
  abrirRota: "simplifica:abrir-rota",
  janelaCompacta: "simplifica:janela-compacta",
  janelaNaFrente: "simplifica:janela-na-frente",
  abrirJanela: "simplifica:abrir-janela",
  /** Do processo principal para a janela: o app vai fechar; a janela grava e responde em `prontoParaSair`. */
  antesDeSair: "simplifica:antes-de-sair",
  prontoParaSair: "simplifica:pronto-para-sair",
} as const;
