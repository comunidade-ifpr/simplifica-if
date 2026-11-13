/**
 * Abertura do `kb.sqlite` pela CLI, com recompilação automática quando o banco está ausente ou
 * mais velho que as fontes (regras em `fontes.ts`). `KB_SQLITE` muda o caminho do banco;
 * `KB_RECOMPILAR=nunca` desliga a recompilação (falha se o banco faltar) e `KB_RECOMPILAR=sempre`
 * força uma compilação.
 */
import { Database } from "bun:sqlite";
import { existsSync, statSync, utimesSync } from "node:fs";
import { z } from "zod";
import { raizRepositorio } from "../normas/registro.ts";
import { caminhoBancoPadrao, compilarBanco } from "./compilar.ts";
import { VERSAO_ESQUEMA } from "./esquema.ts";
import { arquivosFonte, hashConteudo, hashLista, mtimeMaisRecente } from "./fontes.ts";

export type Estado =
  | { estado: "fresco"; motivo: "mtime" | "conteudo-igual" }
  | { estado: "velho"; motivo: "ausente" | "esquema" | "lista-de-fontes" | "conteudo" };

const esquemaMeta = z.array(z.strictObject({ chave: z.string(), valor: z.string() }));

function lerMeta(caminho: string): Map<string, string> | null {
  try {
    const db = new Database(caminho, { readonly: true });
    try {
      return new Map(esquemaMeta.parse(db.query("SELECT chave, valor FROM meta").all()).map((m) => [m.chave, m.valor]));
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/** Decide se o banco em `caminho` corresponde às fontes do checkout em `raiz`. */
export function estadoDoBanco(raiz: string, caminho: string): Estado {
  if (!existsSync(caminho)) return { estado: "velho", motivo: "ausente" };
  const meta = lerMeta(caminho);
  if (!meta || meta.get("versao_esquema") !== String(VERSAO_ESQUEMA)) return { estado: "velho", motivo: "esquema" };
  const arquivos = arquivosFonte(raiz);
  if (meta.get("fontes_lista_sha256") !== hashLista(arquivos)) return { estado: "velho", motivo: "lista-de-fontes" };
  const mtimeBanco = statSync(caminho).mtimeMs;
  if (mtimeMaisRecente(raiz, arquivos) <= mtimeBanco) return { estado: "fresco", motivo: "mtime" };
  if (meta.get("fontes_sha256") === hashConteudo(raiz, arquivos)) {
    const agora = new Date();
    utimesSync(caminho, agora, agora);
    return { estado: "fresco", motivo: "conteudo-igual" };
  }
  return { estado: "velho", motivo: "conteudo" };
}

export interface OpcoesAbertura {
  raiz?: string;
  caminho?: string;
  /** Mensagens de progresso (stderr, para não sujar o `--json`). */
  log?: (mensagem: string) => void;
}

/** Abre o banco só para leitura, recompilando antes se preciso. */
export function abrirBanco(opcoes: OpcoesAbertura = {}): Database {
  const raiz = opcoes.raiz ?? raizRepositorio();
  const caminho = opcoes.caminho ?? caminhoBancoPadrao(raiz);
  const log = opcoes.log ?? ((m: string) => process.stderr.write(`${m}\n`));
  const politica = process.env.KB_RECOMPILAR ?? "auto";
  const estado: Estado = politica === "sempre" ? { estado: "velho", motivo: "conteudo" } : estadoDoBanco(raiz, caminho);
  if (estado.estado === "velho") {
    if (politica === "nunca") {
      throw new Error(
        `kb.sqlite ${estado.motivo === "ausente" ? "ausente" : "desatualizado"} (${caminho}); rode bun run kb:compilar`,
      );
    }
    log(`kb: compilando ${caminho} (motivo: ${estado.motivo})…`);
    const inicio = performance.now();
    compilarBanco({ raiz, destino: caminho });
    log(`kb: banco compilado em ${((performance.now() - inicio) / 1000).toFixed(1)} s`);
  }
  return new Database(caminho, { readonly: true, strict: true });
}
