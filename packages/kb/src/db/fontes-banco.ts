/**
 * Leitores do `kb.sqlite` que remontam, a partir das tabelas, as estruturas que as regras do kb
 * recebem dos arquivos: o registro de normas (`Registro`, de `normas`), as datas dos atos (do
 * `front_matter_json` e dos stubs), as relações, as regras de transição, a `FonteVigencia` e o léxico
 * da busca de seções. Nada aqui lê arquivo: é o que deixa o banco responder sem o repositório.
 *
 * Cada leitor guarda o resultado por banco aberto (`WeakMap`): o banco aberto só para leitura não
 * muda enquanto está aberto. `db/base.test.ts` confere que cada um é igual ao lido dos arquivos.
 */
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { esquemaSinonimos, type Sinonimos } from "../busca/sinonimos.ts";
import { type EntradaRegistro, Registro } from "../normas/registro.ts";
import type { Relacao } from "../normas/relacoes.ts";
import {
  type DatasNorma,
  esquemaTransicao,
  type FonteVigencia,
  montarDatas,
  type Transicao,
} from "../normas/vigencia.ts";
import { dataReferenciaBanco, relacoesBanco } from "./consultas-normas.ts";

function memorizado<T>(calcular: (db: DatabaseSync) => T): (db: DatabaseSync) => T {
  const cache = new WeakMap<DatabaseSync, T>();
  return (db) => {
    if (!cache.has(db)) cache.set(db, calcular(db));
    return cache.get(db)!;
  };
}

const textoNulo = z.string().nullable();

const esquemaNormaRegistro = z.strictObject({
  id: z.string(),
  situacao: z.enum(["base", "stub", "externo"]),
  titulo: z.string(),
  data_publicacao: textoNulo,
  status_vigencia: textoNulo,
  status_fonte: textoNulo,
  path: textoNulo,
  aliases_json: z.string(),
  front_matter_json: textoNulo,
});

/** `assinada_em` do registro: a do front matter (norma da base) ou a `data_publicacao` (stub). */
function assinadaEm(n: z.infer<typeof esquemaNormaRegistro>): string | undefined {
  if (n.situacao === "stub") return n.data_publicacao ?? undefined;
  if (n.situacao !== "base" || n.front_matter_json === null) return undefined;
  const valor = (JSON.parse(n.front_matter_json) as Record<string, unknown>)["assinada_em"];
  return typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor : undefined;
}

/** Registro de normas (o de `carregarRegistro`: base, stubs e externos) pela tabela `normas`. */
export const registroBanco = memorizado((db: DatabaseSync): Registro => {
  const linhas = z
    .array(esquemaNormaRegistro)
    .parse(
      db
        .prepare(
          "SELECT id, situacao, titulo, data_publicacao, status_vigencia, status_fonte, path, aliases_json, front_matter_json " +
            "FROM normas ORDER BY id",
        )
        .all(),
    );
  return new Registro(
    // chaves na ordem de carregarRegistro; no registro, o path é relativo a base-conhecimento/
    linhas.map((n): EntradaRegistro => ({
      id: n.id,
      title: n.titulo,
      situacao: n.situacao,
      ...(assinadaEm(n) !== undefined ? { assinada_em: assinadaEm(n) } : {}),
      ...(n.data_publicacao !== null ? { data_publicacao: n.data_publicacao } : {}),
      ...(n.status_vigencia !== null ? { status_vigencia: n.status_vigencia } : {}),
      ...(n.status_fonte !== null ? { status_fonte: n.status_fonte } : {}),
      aliases: z.array(z.string()).parse(JSON.parse(n.aliases_json)),
      ...(n.path !== null ? { path: n.path.replace(/^base-conhecimento\//, "") } : {}),
    })),
  );
});

/** Datas dos atos (as de `carregarDatas`): front matter das normas da base e `data_publicacao` dos stubs. */
export const datasBanco = memorizado((db: DatabaseSync): Map<string, DatasNorma> => {
  const normas = z
    .array(z.strictObject({ id: z.string(), front_matter_json: z.string() }))
    .parse(
      db
        .prepare(
          "SELECT id, front_matter_json FROM normas WHERE situacao = 'base' AND front_matter_json IS NOT NULL ORDER BY id",
        )
        .all(),
    )
    .map((n) => ({ id: n.id, meta: z.record(z.string(), z.unknown()).parse(JSON.parse(n.front_matter_json)) }));
  return montarDatas(normas, registroBanco(db));
});

const esquemaLinhaTransicao = z.strictObject({
  id: z.string(),
  norma_id: z.string(),
  dispositivo: z.string(),
  tipo: z.string(),
  norma_anterior: textoNulo,
  aplica_a: z.string(),
  regra: z.string(),
  inicio: z.string(),
  fim: z.string(),
  evidencia: z.string(),
});

/** Regras de transição (as de `carregarTransicoes`), na ordem do arquivo. */
export const transicoesBanco = memorizado((db: DatabaseSync): Transicao[] =>
  z
    .array(esquemaLinhaTransicao)
    .parse(
      db
        .prepare(
          "SELECT id, norma_id, dispositivo, tipo, norma_anterior, aplica_a, regra, inicio, fim, evidencia FROM transicoes ORDER BY rowid",
        )
        .all(),
    )
    .map((t) =>
      esquemaTransicao.parse({
        id: t.id,
        norma: t.norma_id,
        dispositivo: t.dispositivo,
        tipo: t.tipo,
        ...(t.norma_anterior !== null ? { norma_anterior: t.norma_anterior } : {}),
        aplica_a: t.aplica_a,
        regra: t.regra,
        inicio: t.inicio,
        fim: t.fim,
        evidencia: t.evidencia,
      }),
    ),
);

const relacoesMemorizadas = memorizado((db: DatabaseSync): Relacao[] => relacoesBanco(db));

/** A vigência (`statusEm`, `transicoesAplicaveis`, `derivarLinha`...) sobre o banco. */
export const fonteVigenciaBanco = memorizado((db: DatabaseSync): FonteVigencia => ({
  registro: () => registroBanco(db),
  datas: () => datasBanco(db),
  relacoes: () => relacoesMemorizadas(db),
  transicoes: () => transicoesBanco(db),
}));

/** `data_referencia` gravada em `meta` (de `base-conhecimento/config/vigencia.yaml`). */
export { dataReferenciaBanco };

/** Léxico da busca de seções (o de `lerSinonimos`), pelas tabelas `sinonimos_tipos` e `sinonimos_grupos`. */
export const sinonimosBanco = memorizado((db: DatabaseSync): Sinonimos => {
  const tipos = z
    .array(z.strictObject({ tipo: z.string(), termos_json: z.string() }))
    .parse(db.prepare("SELECT tipo, termos_json FROM sinonimos_tipos ORDER BY ordem").all());
  const grupos = z
    .array(z.strictObject({ termos_json: z.string() }))
    .parse(db.prepare("SELECT termos_json FROM sinonimos_grupos ORDER BY ordem").all());
  return esquemaSinonimos.parse({
    tipos: Object.fromEntries(tipos.map((t) => [t.tipo, JSON.parse(t.termos_json)])),
    grupos: grupos.map((g) => JSON.parse(g.termos_json)),
  });
});

/** Linhas de `meta` (versão do esquema, data de referência, hashes, contagens; versão, commit e canal do build, se houver). */
export function metaBanco(db: DatabaseSync): Record<string, string> {
  return Object.fromEntries(
    z
      .array(z.strictObject({ chave: z.string(), valor: z.string() }))
      .parse(db.prepare("SELECT chave, valor FROM meta ORDER BY chave").all())
      .map((m) => [m.chave, m.valor]),
  );
}
