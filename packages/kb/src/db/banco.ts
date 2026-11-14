/**
 * Abertura do `kb.sqlite` pela CLI, com recompilação automática quando o banco está ausente ou
 * mais velho que as fontes (regras em `fontes.ts`). `KB_SQLITE` muda o caminho do banco;
 * `KB_RECOMPILAR=nunca` desliga a recompilação (falha se o banco faltar) e `KB_RECOMPILAR=sempre`
 * força uma compilação.
 *
 * Fora do repositório (o servidor MCP, um binário com só o `kb.sqlite`), a abertura é
 * `abrirBanco({ caminho, recompilar: false })`: não procura o checkout, não confere as fontes e não
 * compila; só abre o arquivo para leitura.
 */
import { DatabaseSync } from "node:sqlite";
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
    const db = new DatabaseSync(caminho, { readOnly: true });
    try {
      return new Map(
        esquemaMeta.parse(db.prepare("SELECT chave, valor FROM meta").all()).map((m) => [m.chave, m.valor]),
      );
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
  const mtimeFontes = mtimeMaisRecente(raiz, arquivos);
  if (mtimeFontes <= mtimeBanco) return { estado: "fresco", motivo: "mtime" };
  if (meta.get("fontes_sha256") === hashConteudo(raiz, arquivos)) {
    // o banco avança até o mtime das fontes lido antes do hash, não até agora: uma fonte editada
    // durante o hash fica mais nova que o banco e é conferida na próxima abertura
    const instante = new Date(mtimeFontes);
    utimesSync(caminho, instante, instante);
    return { estado: "fresco", motivo: "conteudo-igual" };
  }
  return { estado: "velho", motivo: "conteudo" };
}

export interface OpcoesAbertura {
  raiz?: string;
  caminho?: string;
  /** Mensagens de progresso (stderr, para não sujar o `--json`). */
  log?: (mensagem: string) => void;
  /** Padrão `true`. `false` abre para escrita (testes); as consultas nunca escrevem. */
  somenteLeitura?: boolean;
  /**
   * Padrão `true`: confere o banco contra as fontes do checkout e recompila se preciso (a CLI).
   * `false`: abre o `caminho` (obrigatório) como está, sem procurar o repositório nem ler fontes;
   * falha se o arquivo não existe. `KB_RECOMPILAR` não se aplica.
   */
  recompilar?: boolean;
}

/** Abre o banco só para leitura, recompilando antes se preciso (salvo `recompilar: false`). */
export function abrirBanco(opcoes: OpcoesAbertura = {}): DatabaseSync {
  const somenteLeitura = opcoes.somenteLeitura ?? true;
  if (opcoes.recompilar === false) {
    if (!opcoes.caminho) throw new Error("abrirBanco com recompilar: false exige o caminho do kb.sqlite");
    if (!existsSync(opcoes.caminho)) throw new Error(`kb.sqlite não encontrado: ${opcoes.caminho}`);
    return new DatabaseSync(opcoes.caminho, { readOnly: somenteLeitura });
  }
  const raiz = opcoes.raiz ?? raizRepositorio();
  const caminho = opcoes.caminho ?? caminhoBancoPadrao(raiz);
  const log = opcoes.log ?? ((m: string) => process.stderr.write(`${m}\n`));
  const politica = process.env.KB_RECOMPILAR ?? "auto";
  const estado: Estado = politica === "sempre" ? { estado: "velho", motivo: "conteudo" } : estadoDoBanco(raiz, caminho);
  if (estado.estado === "velho") {
    if (politica === "nunca") {
      throw new Error(
        `kb.sqlite ${estado.motivo === "ausente" ? "ausente" : "desatualizado"} (${caminho}); rode pnpm kb:compilar`,
      );
    }
    log(`kb: compilando ${caminho} (motivo: ${estado.motivo})…`);
    const inicio = performance.now();
    compilarBanco({ raiz, destino: caminho });
    log(`kb: banco compilado em ${((performance.now() - inicio) / 1000).toFixed(1)} s`);
  }
  return new DatabaseSync(caminho, { readOnly: somenteLeitura });
}
