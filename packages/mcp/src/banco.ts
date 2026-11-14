/**
 * Abertura do `kb.sqlite` pelo simplifica-mcp: só leitura, sem recompilar e sem procurar o
 * repositório. O servidor roda com o banco e mais nada (M0.2), ao contrário de
 * `packages/kb/src/db/banco.ts`, que recompila a partir do checkout; por isso este módulo importa
 * do `kb` só o esquema, que não depende de arquivos.
 */
import { Database } from "bun:sqlite";
import { statSync } from "node:fs";
import { VERSAO_ESQUEMA } from "@simplifica-if/kb/db/esquema";
import { z } from "zod";
import { CANAIS, type Canal } from "./envelope.ts";

export const MENSAGEM_INCOMPATIVEL = "base incompatível com esta versão do simplifica-mcp; atualize";

/** Banco ausente, ilegível ou de esquema diferente; a mensagem vai para o usuário. */
export class ErroBanco extends Error {
  override name = "ErroBanco";
}

/** A tabela `meta`, validada. */
export interface MetaBase {
  versao_esquema: number;
  /** Data em que a vigência foi calculada (`config/vigencia.yaml`), AAAA-MM-DD. */
  data_referencia: string;
  fontes_sha256: string;
  contagens: Record<string, number>;
  /** `versao`, `commit` e `canal` entram na `meta` no passo T0; nos bancos de hoje, `null`. */
  versao: string | null;
  commit: string | null;
  canal: Canal | null;
}

export interface Banco {
  db: Database;
  meta: MetaBase;
  caminho: string;
}

const esquemaLinhasMeta = z.array(z.object({ chave: z.string(), valor: z.string() }));

const esquemaMeta = z.object({
  data_referencia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "esperava AAAA-MM-DD"),
  fontes_sha256: z.string().regex(/^[0-9a-f]{64}$/, "esperava um sha256"),
  contagens_json: z.string(),
  versao: z.string().min(1).optional(),
  commit: z.string().min(1).optional(),
  canal: z.enum(CANAIS).optional(),
});

const esquemaContagens = z.record(z.string(), z.number().int().min(0));

function mensagem(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

/** Abre o banco em modo somente leitura e confere a versão do esquema. */
export function abrirBanco(caminho: string): Banco {
  let arquivo = false;
  try {
    arquivo = statSync(caminho).isFile();
  } catch {
    // ausente: tratado abaixo
  }
  if (!arquivo) throw new ErroBanco(`kb.sqlite não encontrado: ${caminho}`);
  let db: Database;
  try {
    db = new Database(caminho, { readonly: true, strict: true });
  } catch (erro) {
    throw new ErroBanco(`não foi possível abrir ${caminho}: ${mensagem(erro)}`);
  }
  try {
    return { db, meta: lerMeta(db), caminho };
  } catch (erro) {
    db.close();
    throw erro;
  }
}

function lerMeta(db: Database): MetaBase {
  let linhas: z.infer<typeof esquemaLinhasMeta>;
  try {
    linhas = esquemaLinhasMeta.parse(db.query("SELECT chave, valor FROM meta").all());
  } catch (erro) {
    throw new ErroBanco(`${MENSAGEM_INCOMPATIVEL} (o arquivo não é um kb.sqlite: ${mensagem(erro)})`);
  }
  const valores = Object.fromEntries(linhas.map((l) => [l.chave, l.valor]));
  if (valores.versao_esquema !== String(VERSAO_ESQUEMA)) {
    throw new ErroBanco(
      `${MENSAGEM_INCOMPATIVEL} (esquema da base: ${valores.versao_esquema ?? "ausente"}; esperado: ${VERSAO_ESQUEMA})`,
    );
  }
  const meta = esquemaMeta.safeParse(valores);
  if (!meta.success) {
    throw new ErroBanco(`${MENSAGEM_INCOMPATIVEL} (tabela meta: ${z.prettifyError(meta.error)})`);
  }
  let contagens: Record<string, number>;
  try {
    contagens = esquemaContagens.parse(JSON.parse(meta.data.contagens_json));
  } catch (erro) {
    throw new ErroBanco(`${MENSAGEM_INCOMPATIVEL} (contagens_json: ${mensagem(erro)})`);
  }
  return {
    versao_esquema: VERSAO_ESQUEMA,
    data_referencia: meta.data.data_referencia,
    fontes_sha256: meta.data.fontes_sha256,
    contagens,
    versao: meta.data.versao ?? null,
    commit: meta.data.commit ?? null,
    canal: meta.data.canal ?? null,
  };
}
