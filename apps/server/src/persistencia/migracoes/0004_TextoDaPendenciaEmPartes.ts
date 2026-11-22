/**
 * Migração 4: o texto da pendência em partes. O `mensagem` único (a justificativa da IA seguida de
 * "Falta: a; b; c.") dá lugar a `titulo` (o problema numa frase), `explicacao` (o resto, ou `null`) e
 * `faltas` (a lista do que falta), nos três lugares em que uma pendência fica gravada em JSON:
 * `pendencias_vivas.pendencia` e a lista `pendencias` do `resultado` de `listas_pendencias` e de
 * `revisoes_ia`.
 *
 * A separação daqui é a única vez em que o texto antigo é lido de volta: o que o servidor grava depois
 * desta migração já nasce em partes (`itensDaIa`, em `packages/ppc`). Por isso a regra fica copiada
 * neste arquivo, e não importada: a migração não pode mudar junto com o código. Nenhuma palavra se
 * perde; o que não é o título nem a lista vai para a explicação. A chave da pendência (`chave`) não muda.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

const JsonDesconhecido = Schema.fromJsonString(Schema.Unknown);
const lerJson = Schema.decodeUnknownEffect(JsonDesconhecido);
const codificarJson = Schema.encodeEffect(JsonDesconhecido);

/** Palavras que terminam em ponto sem fechar a frase ("art. 28", "Res. CNE/CP", "nº"). */
const ABREVIATURA =
  /(?:^|[\s(“"])(?:arts?|incs?|als?|n|nº|res|resol|port|dec|cf|ex|p|pp|par|parág|sec|cap|prof|profa|dr|dra|sr|sra|obs|vs|fls?|proc|etc)$/i;

/** A primeira frase (ou a primeira linha) e o resto. */
function tituloEExplicacao(texto: string): { titulo: string; explicacao: string | null } {
  const limpo = texto.trim();
  const quebra = limpo.indexOf("\n");
  let corte = quebra;
  const fim = /[.!?](?=\s+[A-ZÀ-Ý“"(])/g;
  for (let m = fim.exec(limpo); m !== null; m = fim.exec(limpo)) {
    if (quebra !== -1 && m.index > quebra) break;
    const antes = limpo.slice(0, m.index);
    if (antes.length < 24 || (m[0] === "." && ABREVIATURA.test(antes))) continue;
    corte = m.index + 1;
    break;
  }
  if (corte <= 0) return { titulo: limpo, explicacao: null };
  const explicacao = limpo.slice(corte).trim();
  return { titulo: limpo.slice(0, corte).trim(), explicacao: explicacao === "" ? null : explicacao };
}

/** `mensagem` → `titulo`, `explicacao` e `faltas`, no lugar dela; a pendência já em partes fica como está. */
function emPartes(pendencia: unknown): unknown {
  if (typeof pendencia !== "object" || pendencia === null || Array.isArray(pendencia)) return pendencia;
  const { mensagem, ...resto } = pendencia as Record<string, unknown>;
  if (typeof mensagem !== "string") return pendencia;
  // Só a pendência da IA trazia as lacunas no fim, como "Falta: a; b; c.".
  // O último "Falta: " (a justificativa pode ter a palavra): o servidor o punha no fim, numa linha só.
  const onde = resto["origem"] === "ia" ? mensagem.lastIndexOf("Falta: ") : -1;
  const lacunas =
    onde === 0 || (onde > 0 && /\s/.test(mensagem[onde - 1]!))
      ? /^Falta: ([^\n]+?)\.?\s*$/.exec(mensagem.slice(onde))
      : null;
  const corpo = (lacunas === null ? mensagem : mensagem.slice(0, onde)).trim();
  const partes =
    corpo === ""
      ? { titulo: mensagem.trim(), explicacao: null, faltas: [] }
      : {
          ...tituloEExplicacao(corpo),
          faltas: lacunas === null ? [] : lacunas[1]!.split("; "),
        };
  // As partes entram onde estava a mensagem, antes de `oQueFazer`, como o servidor passa a gravar.
  const saida: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(pendencia as Record<string, unknown>)) {
    if (chave === "mensagem") Object.assign(saida, partes);
    else saida[chave] = valor;
  }
  return saida;
}

/** O `resultado` de uma revisão, com cada pendência em partes. */
function resultadoEmPartes(resultado: unknown): unknown {
  if (typeof resultado !== "object" || resultado === null) return resultado;
  const { pendencias } = resultado as { pendencias?: unknown };
  return Array.isArray(pendencias) ? { ...resultado, pendencias: pendencias.map(emPartes) } : resultado;
}

/** Lê o JSON, aplica a mudança e devolve o texto novo; `null` se o JSON gravado não se lê. */
const converter = (texto: string, mudar: (valor: unknown) => unknown, onde: string) =>
  lerJson(texto).pipe(
    Effect.map(mudar),
    Effect.flatMap(codificarJson),
    Effect.catch(() => Effect.logWarning(`migração 4: JSON inválido em ${onde}`).pipe(Effect.as(null))),
  );

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const vivas = yield* sql<{ lista_id: string; chave: string; pendencia: string }>`
    SELECT lista_id, chave, pendencia FROM pendencias_vivas
  `;
  for (const viva of vivas) {
    const novo = yield* converter(viva.pendencia, emPartes, `pendencias_vivas ${viva.lista_id}/${viva.chave}`);
    if (novo !== null && novo !== viva.pendencia)
      yield* sql`
        UPDATE pendencias_vivas SET pendencia = ${novo} WHERE lista_id = ${viva.lista_id} AND chave = ${viva.chave}
      `;
  }

  const listas = yield* sql<{ id: string; resultado: string }>`SELECT id, resultado FROM listas_pendencias`;
  for (const lista of listas) {
    const novo = yield* converter(lista.resultado, resultadoEmPartes, `listas_pendencias ${lista.id}`);
    if (novo !== null && novo !== lista.resultado)
      yield* sql`UPDATE listas_pendencias SET resultado = ${novo} WHERE id = ${lista.id}`;
  }

  const revisoes = yield* sql<{ id: string; resultado: string }>`
    SELECT id, resultado FROM revisoes_ia WHERE resultado IS NOT NULL
  `;
  for (const revisao of revisoes) {
    const novo = yield* converter(revisao.resultado, resultadoEmPartes, `revisoes_ia ${revisao.id}`);
    if (novo !== null && novo !== revisao.resultado)
      yield* sql`UPDATE revisoes_ia SET resultado = ${novo} WHERE id = ${revisao.id}`;
  }
});
