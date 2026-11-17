/**
 * O detector de texto em inglês e de jargão técnico nas telas (M1.14). O teste de navegador junta o
 * texto visível e os atributos acessíveis (`textosDaTela`, em `navegador.tsx`) e falha se esta função
 * achar alguma palavra.
 *
 * A heurística é uma lista de palavras: as do inglês que aparecem em interface e em mensagem de erro
 * (as dos componentes copiados do T3 e do shadcn, do roteador, das CLIs dos providers) e que não são
 * também palavras do português ("no", "a", "for", "menu", "total" ficam de fora). Antes de procurar,
 * saem os nomes próprios e os termos aceitos (`EXCECOES`) e os pedaços que são caminho, link, e-mail,
 * nome de arquivo ou versão, porque esses não se traduzem.
 *
 * Também falha com o jargão técnico que não deve aparecer para quem não é técnico, mesmo em português
 * (`JARGAO`): "sessão", "thread", "token", "provider"… ("turno" fica de fora: é também o turno do curso,
 * que a base mostra).
 */

/**
 * Nomes próprios e termos que ficam como estão, comparados com a grafia exata da tela: as IAs e os
 * produtos, os formatos de arquivo, os sistemas e os termos já correntes em português.
 */
export const EXCECOES: ReadonlySet<string> = new Set([
  // As IAs, as empresas e os planos de conta
  "Claude",
  "Code",
  "Codex",
  "ChatGPT",
  "OpenAI",
  "Antigravity",
  "Gemini",
  "Google",
  "Anthropic",
  "Pro",
  "Max",
  "Team",
  "Enterprise",
  "Plus",
  "max",
  // Onde o relato vai e os programas da pessoa
  "GitHub",
  "Word",
  "Excel",
  "LibreOffice",
  "Writer",
  "Finder",
  "Explorer",
  // Formatos de arquivo e siglas que a pessoa conhece
  "DOCX",
  "PDF",
  "ODT",
  "RTF",
  "Markdown",
  "API",
  "URL",
  // Sistemas
  "macOS",
  "Windows",
  "Linux",
  // O nome do app e da instituição
  "Simplifica",
  "IF",
  "IFPR",
]);

/** Palavras do inglês que não são também do português, em minúsculas. */
export const PALAVRAS_INGLES: ReadonlySet<string> = new Set(
  `
  the and or of with from this that these those your you yours our we they it its is are was were be been
  being has have had not can't cannot don't doesn't won't isn't aren't will would should could may might
  must shall there here what which who whom whose when where why how than then into onto about above below
  after before again also any each every something nothing none many much few only just very too
  please thanks thank sorry yes okay
  loading loaded close closed cancel cancelled canceled submit save saved saving open opened opening back
  next previous prev toggle search settings setting preferences edit delete remove removed copy copied
  paste cut undo redo quit hide hidden show showing view window minimize maximize reload refresh help
  new select selected unselect unknown retry try again done dismiss expand collapse expanded collapsed
  less home start started stop stopped continue update updated updating upgrade download downloading
  downloaded install installed installing uninstall sign signed signin signout logout log logged user
  username password upload uploading attach attached attachment attachments file files folder folders
  page pages found something went wrong invalid required warning error errors failed failure success
  succeeded pending running complete completed completing connected disconnected connecting reconnecting
  thinking reasoning tool tools approve approved deny denied allow allowed reject rejected accept accepted
  chat chats message messages model models untitled today yesterday ago minute minutes second seconds hour
  hours day days week weeks month months year years dialog breadcrumb pagination sidebar panel scroll
  light dark theme mode default custom clear filter sort add create created rename share print printing
  send sending sent reply answer question questions response responses request requests timeout timed
  network offline unauthorized forbidden limit limits rate quota reached exceeded usage account accounts
  required please run command commands key keys unexpected unavailable overloaded server client
  details detail more info about version versions latest change changes changed review reviewing approve
  first last step steps off yet still keep left right bottom skill skills commit commits branch merge
  pull push repository
`
    .split(/\s+/)
    .filter((palavra) => palavra.length > 0),
);

/**
 * Jargão técnico que não aparece nas telas, nem em português: o vocabulário é "conversa", "resposta",
 * "IA", "pasta da tarefa".
 */
export const JARGAO: ReadonlySet<string> = new Set([
  "sessão",
  "sessões",
  "thread",
  "threads",
  "token",
  "tokens",
  "provider",
  "providers",
  "prompt",
  "prompts",
  "mcp",
  "cli",
  "rpc",
  "issue",
  "issues",
  "stdio",
  "websocket",
]);

/**
 * Pedaços que não se traduzem: link, caminho, e-mail, nome de arquivo (`PPC.docx`), versão (`2.1.30`),
 * identificador (`claude-opus-4`, `relato-do-app`), atalho de teclado (`⌘K`), código de erro.
 */
const PEDACO_LITERAL =
  /^(?:[a-z][a-z0-9+.-]*:\/\/\S*|\S*[\\/]\S*|\S+@\S+\.\S+|\S+\.[A-Za-z0-9]{1,8}|v?\d[\w.-]*|\S*_\S*|[a-z0-9]+(?:-[a-z0-9]+){2,})$/;

/** Uma palavra suspeita e o pedaço de texto em que apareceu. */
export interface Achado {
  readonly palavra: string;
  readonly motivo: "inglês" | "jargão";
  readonly texto: string;
}

/** As palavras em inglês e de jargão de um texto da tela. */
export function palavrasSuspeitas(texto: string): ReadonlyArray<Achado> {
  const achados: Array<Achado> = [];
  for (const pedaco of texto.split(/\s+/)) {
    const limpo = pedaco.replace(/^[("'“‘«[{]+|[)"'”’»\]}.,;:!?…]+$/g, "");
    if (limpo.length === 0 || PEDACO_LITERAL.test(limpo)) continue;
    for (const palavra of limpo.match(/[A-Za-zÀ-ÖØ-öø-ÿ']+/g) ?? []) {
      if (EXCECOES.has(palavra)) continue;
      const minuscula = palavra.toLowerCase();
      if (JARGAO.has(minuscula)) achados.push({ palavra, motivo: "jargão", texto });
      else if (PALAVRAS_INGLES.has(minuscula)) achados.push({ palavra, motivo: "inglês", texto });
    }
  }
  return achados;
}
