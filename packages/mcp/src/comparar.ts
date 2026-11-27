/**
 * O modo Comparar do app: duas normas que se sucedem lado a lado, pela tabela de correspondência
 * entre elas (`Normas.alinhamento`, a regra `alinhamentoEm` do kb), com a diferença palavra a palavra
 * de cada par. Sem tabela, não há comparação: o app não alinha normas por conta própria. Não é
 * ferramenta MCP: a IA tem `correspondencia`, que lê a mesma tabela por dispositivo.
 *
 * Só schemas: este módulo entra no grafo do `grupo-leitura.ts`, que a interface importa, e não pode
 * importar o `kb` nem módulos do Node. A leitura fica em `leitura/comparar.ts`.
 */
import * as Schema from "effect/Schema";
import { EsquemaLink, Resposta } from "./contratos.ts";

/** As duas normas, pelo ID, em qualquer ordem: a origem da tabela fica à esquerda. */
export const EntradaComparar = Schema.Struct({ a: Schema.String, b: Schema.String });

/** Um pedaço do texto do dispositivo; `mudou` nas palavras que o outro lado não tem. */
export const TrechoComparado = Schema.Struct({ texto: Schema.String, mudou: Schema.Boolean });
export type TrechoComparado = typeof TrechoComparado.Type;

const Referencia = Schema.Struct({
  /** ID completo (`br/cne-cp/res/2021/1#art11`). */
  id: Schema.String,
  /** Os rótulos desde o artigo: `Art. 5º, § 2º`. */
  rotulo: Schema.String,
});

export const LadoComparado = Schema.Struct({
  ...Referencia.fields,
  link: EsquemaLink,
  /** O texto sem o rótulo, em trechos; um só, sem marca, quando não há par ou o par foi reescrito. */
  trechos: Schema.Array(TrechoComparado),
  /** Os filhos que a linha não mostra, por tipo (`inciso`, 17): o artigo detalhado só pelo caput. */
  subordinados: Schema.Array(Schema.Struct({ tipo: Schema.String, quantos: Schema.Int })),
});
export type LadoComparado = typeof LadoComparado.Type;

export const DestinoComparado = Schema.Struct({
  ...LadoComparado.fields,
  /** N→1: os outros dispositivos da origem que apontam este mesmo destino. */
  tambem: Schema.Array(Referencia),
});
export type DestinoComparado = typeof DestinoComparado.Type;

export const LinhaComparada = Schema.Struct({
  origem: LadoComparado,
  tipo: Schema.Literals(["equivalente", "parcial", "sem-equivalente"]),
  /** A nota da tabela; `null` sem nota e na linha herdada. */
  nota: Schema.NullOr(Schema.String),
  /** O ancestral de que a linha herdou o item da tabela. */
  herdado_de: Schema.NullOr(Referencia),
  /** 1→N: empilhados, na ordem do item; vazio sem equivalente. */
  destinos: Schema.Array(DestinoComparado),
  /** O mesmo texto dos dois lados, depois de normalizar; sempre `false` na linha herdada. */
  identicos: Schema.Boolean,
  /** Mudou mais de 60% das palavras: o par vai inteiro, sem grifo por palavra. */
  reescrito: Schema.Boolean,
});
export type LinhaComparada = typeof LinhaComparada.Type;

export const NormaComparada = Schema.Struct({
  id: Schema.String,
  titulo: Schema.String,
  /** O status no dia da vigência (`FontesNormativas.diaDaVigencia`): `vigente`, `ainda-nao-vigente`… */
  status_vigencia: Schema.NullOr(Schema.String),
  link: EsquemaLink,
});
export type NormaComparada = typeof NormaComparada.Type;

export const DadosComparar = Schema.Struct({
  /** A tabela de correspondência: `rascunho` até a revisão jurídica. */
  tabela: Schema.Struct({ arquivo: Schema.String, status: Schema.Literals(["rascunho", "revisado"]) }),
  /** A norma de origem da tabela (a anterior). */
  origem: NormaComparada,
  /** A norma de destino (a sucessora). */
  destino: NormaComparada,
  /** Uma linha por dispositivo da origem, na ordem dela. */
  linhas: Schema.Array(LinhaComparada),
  /** Os artigos do destino que nenhum item da tabela aponta, na ordem do destino. */
  novos: Schema.Array(LadoComparado),
});
export type DadosComparar = typeof DadosComparar.Type;

/** A resposta inteira (envelope + dados): o contrato do RPC `compararNormas`. */
export const SaidaComparar = Resposta(DadosComparar);
