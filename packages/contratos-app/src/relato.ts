/**
 * "Isto está errado" (M1.12): o relato de uma resposta errada para a curadoria da base.
 *
 * - **Pacote:** a pergunta, a resposta, as fontes citadas (`ifpr://`), as versões do app, da base e da
 *   tarefa (skill) e a IA. Nunca os anexos nem os arquivos da pasta da tarefa: só o que a pessoa vê na
 *   tela e aprova. O servidor monta o rascunho (`relato.preparar`) a partir da conversa gravada.
 * - **Consentimento:** a interface mostra o relato exatamente como vai sair (`montarRelato`), e a
 *   pessoa retira trechos da pergunta e da resposta, fontes ou as versões antes de enviar.
 * - **Destino:** o repositório da curadoria na política de fábrica (`curadoria.repositorio`). O app não
 *   guarda token do GitHub: abre `issues/new` já preenchida no navegador do sistema (`montarUrlIssue`),
 *   onde a pessoa revisa e envia com a própria conta. Com o repositório `null` (ainda não é público),
 *   ou para quem não tem conta, "Salvar o relato" grava um `.md` na pasta da tarefa e "Copiar" copia
 *   o texto. Cada envio fica registrado no servidor local (`relato.registrar`).
 */
import { SessaoDesconhecida } from "@simplifica-if/motor/erros";
import { Provider } from "@simplifica-if/motor/eventos";
import * as Schema from "effect/Schema";
import { Rpc, RpcGroup } from "effect/rpc";

/* ================================================================== schemas */

export const VersoesRelato = Schema.Struct({
  app: Schema.String,
  /** A versão da base (`2026.11.13`) e o commit das fontes, quando conhecido. */
  base: Schema.String,
  baseCommit: Schema.NullOr(Schema.String),
  /** A tarefa (skill) da conversa; `null` na conversa livre. */
  tarefa: Schema.NullOr(Schema.Struct({ nome: Schema.String, titulo: Schema.String, versao: Schema.String })),
  provider: Provider,
  /** A versão da CLI do provider, se a detecção respondeu a tempo. */
  versaoProvider: Schema.NullOr(Schema.String),
  modelo: Schema.NullOr(Schema.String),
});
export type VersoesRelato = typeof VersoesRelato.Type;

/** O que o servidor junta da conversa gravada para o relato de um turno. */
export const RascunhoRelato = Schema.Struct({
  sessao: Schema.String,
  turno: Schema.Number,
  pergunta: Schema.String,
  resposta: Schema.String,
  /** Os links `ifpr://` da resposta, sem repetição, na ordem. */
  citacoes: Schema.Array(Schema.String),
  versoes: VersoesRelato,
  /** O `dono/repo` da curadoria na política de fábrica; `null` enquanto o repositório não é público. */
  repositorio: Schema.NullOr(Schema.String),
  rotulos: Schema.Array(Schema.String),
  /** A conversa tem pasta de tarefa do app (onde "Salvar o relato" grava). */
  temPasta: Schema.Boolean,
});
export type RascunhoRelato = typeof RascunhoRelato.Type;

/** Como o relato saiu: issue no navegador, arquivo na pasta da tarefa ou cópia. */
export const ViaRelato = Schema.Literals(["github", "arquivo", "copia"]);
export type ViaRelato = typeof ViaRelato.Type;

export const RelatoRegistrado = Schema.Struct({
  id: Schema.Number,
  /** O `.md` gravado na pasta da tarefa (só com `via: "arquivo"`). */
  arquivo: Schema.NullOr(Schema.String),
});
export type RelatoRegistrado = typeof RelatoRegistrado.Type;

/** Uma recusa do relato, com a frase para a pessoa em `motivo`. */
export class FalhaRelato extends Schema.TaggedError<FalhaRelato>()("FalhaRelato", { motivo: Schema.String }) {
  override get message(): string {
    return this.motivo;
  }
}
export const ehFalhaRelato = Schema.is(FalhaRelato);

export class GrupoRelato extends RpcGroup.make(
  /** O rascunho do relato da resposta de um turno, da conversa gravada. */
  Rpc.make("relato.preparar", {
    payload: Schema.Struct({ sessao: Schema.String, turno: Schema.Number }),
    success: RascunhoRelato,
    error: Schema.Union([SessaoDesconhecida, FalhaRelato]),
  }),
  /**
   * Registra o relato como a pessoa o aprovou (título e corpo já montados) e, com `via: "arquivo"`,
   * grava `Relato de erro (turno N).md` na pasta da tarefa. Nada sai do computador por aqui: a issue é
   * a pessoa quem envia, no navegador.
   */
  Rpc.make("relato.registrar", {
    payload: Schema.Struct({
      sessao: Schema.String,
      turno: Schema.Number,
      via: ViaRelato,
      titulo: Schema.String,
      corpo: Schema.String,
    }),
    success: RelatoRegistrado,
    error: Schema.Union([SessaoDesconhecida, FalhaRelato]),
  }),
) {}

/* ================================================================== montagem */

/** Os trechos de um texto: os parágrafos separados por linha em branco (um bloco de código fica inteiro). */
export function trechosDe(texto: string): ReadonlyArray<string> {
  const trechos: Array<string> = [];
  let atual: Array<string> = [];
  let emCodigo = false;
  for (const linha of texto.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(linha)) emCodigo = !emCodigo;
    if (!emCodigo && linha.trim() === "") {
      if (atual.length > 0) trechos.push(atual.join("\n"));
      atual = [];
      continue;
    }
    atual.push(linha);
  }
  if (atual.length > 0) trechos.push(atual.join("\n"));
  return trechos;
}

/** O que a pessoa escreveu e o que ela deixou no relato. */
export interface EscolhasRelato {
  /** "O que está errado", nas palavras da pessoa. */
  readonly descricao: string;
  /** Os índices (de `trechosDe`) retirados da pergunta e da resposta. */
  readonly retiradosPergunta: ReadonlySet<number>;
  readonly retiradosResposta: ReadonlySet<number>;
  /** As fontes retiradas (o link). */
  readonly retiradasCitacoes: ReadonlySet<string>;
  /** Tirar as versões do app, da base, da tarefa e da IA. */
  readonly semVersoes: boolean;
}

export const ESCOLHAS_INICIAIS: EscolhasRelato = {
  descricao: "",
  retiradosPergunta: new Set(),
  retiradosResposta: new Set(),
  retiradasCitacoes: new Set(),
  semVersoes: false,
};

export const TRECHO_RETIRADO = "_[trecho retirado por quem enviou]_";

export const NOMES_PROVIDER: Readonly<Record<Provider, string>> = {
  claude: "Claude (Claude Code)",
  codex: "ChatGPT (Codex)",
  antigravity: "Gemini (Antigravity)",
};

/** Um texto em citação de Markdown (`> `), com os trechos retirados trocados pelo aviso. */
function citar(texto: string, retirados: ReadonlySet<number>): string {
  const trechos = trechosDe(texto);
  if (trechos.length === 0) return "> _(vazio)_";
  return trechos
    .map((trecho, indice) => (retirados.has(indice) ? TRECHO_RETIRADO : trecho))
    .map((trecho) =>
      trecho
        .split("\n")
        .map((linha) => (linha === "" ? ">" : `> ${linha}`))
        .join("\n"),
    )
    .join("\n>\n");
}

function linhasVersoes(versoes: VersoesRelato): ReadonlyArray<string> {
  const ia = [
    NOMES_PROVIDER[versoes.provider],
    versoes.versaoProvider === null ? null : `versão ${versoes.versaoProvider}`,
    versoes.modelo === null ? null : `modelo ${versoes.modelo}`,
  ].filter((parte) => parte !== null);
  return [
    `- App: ${versoes.app}`,
    `- Base: ${versoes.base}${versoes.baseCommit === null ? "" : ` (commit ${versoes.baseCommit.slice(0, 12)})`}`,
    `- Tarefa: ${
      versoes.tarefa === null
        ? "conversa livre"
        : `${versoes.tarefa.titulo} (\`${versoes.tarefa.nome}\` ${versoes.tarefa.versao})`
    }`,
    `- IA: ${ia[0]}${ia.length > 1 ? ` (${ia.slice(1).join(", ")})` : ""}`,
  ];
}

/** O título da issue: a primeira linha da descrição, curta. */
export function tituloRelato(descricao: string): string {
  const primeira = descricao.trim().split("\n")[0]?.trim() ?? "";
  if (primeira === "") return "Isto está errado: resposta do Simplifica IF";
  return `Isto está errado: ${primeira.length > 80 ? `${primeira.slice(0, 79).trimEnd()}…` : primeira}`;
}

/** O relato como vai sair: o título e o corpo em Markdown. É o que a pessoa vê, aprova e envia. */
export function montarRelato(
  rascunho: RascunhoRelato,
  escolhas: EscolhasRelato,
): { readonly titulo: string; readonly corpo: string } {
  const citacoes = rascunho.citacoes.filter((link) => !escolhas.retiradasCitacoes.has(link));
  const descricao = escolhas.descricao.trim();
  const partes = [
    "## O que está errado",
    descricao === "" ? "_(não descrito)_" : descricao,
    "## Pergunta",
    citar(rascunho.pergunta, escolhas.retiradosPergunta),
    "## Resposta da IA",
    citar(rascunho.resposta, escolhas.retiradosResposta),
    "## Fontes citadas na resposta",
    citacoes.length === 0
      ? rascunho.citacoes.length === 0
        ? "_(nenhuma)_"
        : "_(retiradas por quem enviou)_"
      : citacoes.map((link) => `- \`${link}\``).join("\n"),
  ];
  if (!escolhas.semVersoes) partes.push("## Versões", linhasVersoes(rascunho.versoes).join("\n"));
  partes.push(
    "---",
    "_Enviado pelo Simplifica IF (“Isto está errado”). O relato não traz anexos nem arquivos da pasta da tarefa._",
  );
  return { titulo: tituloRelato(descricao), corpo: `${partes.join("\n\n")}\n` };
}

/* ================================================================== issue */

/**
 * O tamanho máximo da URL da issue. O GitHub recusa URLs muito longas (a página de erro aparece perto
 * de 8 KB); acima disso, o corpo vai pela área de transferência.
 */
export const LIMITE_URL_ISSUE = 8000;

export const CORPO_PARA_COLAR =
  "<!-- O relato não coube no endereço da página. O Simplifica IF o copiou: cole aqui (Ctrl+V ou Cmd+V). -->\n";

/**
 * A página `issues/new` do repositório já preenchida. Se a URL completa passar de `limite`, o corpo
 * fica de fora (só o lembrete de colar) e `completa` é `false`: a interface copia o corpo e pede para
 * colar.
 */
export function montarUrlIssue(
  repositorio: string,
  rotulos: ReadonlyArray<string>,
  relato: { readonly titulo: string; readonly corpo: string },
  limite: number = LIMITE_URL_ISSUE,
): { readonly url: string; readonly completa: boolean } {
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repositorio)) throw new Error(`repositório inválido: ${repositorio}`);
  const base = `https://github.com/${repositorio}/issues/new`;
  const consulta = (corpo: string) =>
    [
      `title=${encodeURIComponent(relato.titulo)}`,
      ...(rotulos.length === 0 ? [] : [`labels=${encodeURIComponent(rotulos.join(","))}`]),
      `body=${encodeURIComponent(corpo)}`,
    ].join("&");
  const completa = `${base}?${consulta(relato.corpo)}`;
  if (completa.length <= limite) return { url: completa, completa: true };
  return { url: `${base}?${consulta(CORPO_PARA_COLAR)}`, completa: false };
}

/** Os links `ifpr://` de um texto, sem repetição, sem a pontuação do fim da frase. */
export function citacoesDe(texto: string): ReadonlyArray<string> {
  const vistos = new Set<string>();
  for (const achado of texto.matchAll(/ifpr:\/\/[A-Za-z0-9._~:/#-]+/gi)) {
    const link = achado[0].replace(/[.,:;~-]+$/, "");
    if (link.length > "ifpr://".length) vistos.add(link);
  }
  return [...vistos];
}
