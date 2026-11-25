// @effect-diagnostics nodeBuiltinImport:off -- carregador síncrono de fatos-ppc.yaml, usado pelo validar_base e pela compilação do banco
/**
 * Revisão humana dos fatos de PPC (`base-conhecimento/fatos-ppc.yaml`): a fonte curada e versionada
 * do status `revisado`. Os fatos nascem por regra na compilação (`ppc.ts`, status `extraido`); a
 * revisão de uma pessoa entra aqui, com revisor e data, e a compilação a aplica por cima da extração
 * (princípio 4 do plano da base: nada inferido entra sem revisão humana versionada).
 *
 * Cada revisão diz o valor e, nos fatos de horas, a unidade conhecida (hora-relógio, ou hora-aula de
 * 50 ou 45 minutos), com o trecho literal do PPC que a sustenta. O `validar_base` confere o PPC e o
 * trecho no arquivo.
 *
 * - `carregarRevisoesFatos(raiz)`: lê e valida o contrato do arquivo;
 * - `validarRevisoesFatos(raiz, revisoes, ppcs)`: PPC na base e trecho literal no Markdown;
 * - `aplicarRevisoes(fatos, revisoes, markdown)`: os fatos de um PPC com as revisões aplicadas.
 */
import * as Schema from "effect/Schema";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { parse } from "yaml";
import { CAMINHOS, noCheckout } from "../caminhos.ts";
import { analisarReferenciaPpc } from "../ppcs/ids.ts";
import { FATOS_PPC, type FatoPpc, type NomeFatoPpc } from "./ppc.ts";

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const textoNaoVazio = Schema.String.check(Schema.isMinLength(1));
/** Unidades que uma revisão pode dar: só as conhecidas, com a duração da hora-aula. */
export const UNIDADES_REVISADAS = ["hora-relogio", "hora-aula-50min", "hora-aula-45min"] as const;

/** `ppc:<campus>/<curso>/<versao>`: a revisão vale para uma versão do PPC, nunca para "o vigente". */
const idPpcComVersao = Schema.String.check(
  Schema.makeFilter((valor: string) => valor.startsWith("ppc:") && analisarReferenciaPpc(valor)?.versao !== undefined, {
    message: "ppc deve ser ppc:<campus>/<curso>/<versao>",
  }),
);

const esquemaRevisao = Schema.Struct({
  ppc: idPpcComVersao,
  fato: Schema.Literals(FATOS_PPC),
  /** Horas em número inteiro (`1600`); `sim` ou `nao` no estágio obrigatório. */
  valor: textoNaoVazio,
  /** Unidade das horas; só nos fatos de horas, onde é obrigatória. */
  unidade: Schema.optionalKey(Schema.Literals(UNIDADES_REVISADAS)),
  /** Trecho literal do PPC (dentro de uma linha) que sustenta o valor e a unidade. */
  trecho: textoNaoVazio,
  /** Quem revisou: o nome da pessoa. */
  revisor: textoNaoVazio,
  revisado_em: Schema.String.check(Schema.isPattern(RE_DATA, { message: "revisado_em deve ser AAAA-MM-DD" })),
  nota: Schema.optionalKey(textoNaoVazio),
}).check(
  Schema.makeFilter((revisao) => {
    const problemas: Schema.FilterIssue[] = [];
    if (revisao.fato === "estagio_obrigatorio") {
      if (revisao.valor !== "sim" && revisao.valor !== "nao")
        problemas.push({ path: ["valor"], issue: "estagio_obrigatorio é sim ou nao" });
      if (revisao.unidade !== undefined)
        problemas.push({ path: ["unidade"], issue: "estagio_obrigatorio não tem unidade" });
    } else {
      if (!/^[1-9]\d*$/.test(revisao.valor))
        problemas.push({ path: ["valor"], issue: "horas em número inteiro, sem separador" });
      if (revisao.unidade === undefined)
        problemas.push({ path: ["unidade"], issue: `${revisao.fato} exige a unidade revisada` });
    }
    return problemas;
  }),
);
export type RevisaoFato = typeof esquemaRevisao.Type;

export const esquemaRevisoesFatos = Schema.Struct({ revisoes: Schema.Array(esquemaRevisao) }).check(
  Schema.makeFilter((arquivo) => {
    const vistos = new Set<string>();
    const problemas: Schema.FilterIssue[] = [];
    arquivo.revisoes.forEach((revisao, indice) => {
      const chave = `${revisao.ppc} ${revisao.fato}`;
      if (vistos.has(chave))
        problemas.push({ path: ["revisoes", indice], issue: `revisão repetida: ${revisao.ppc}, ${revisao.fato}` });
      vistos.add(chave);
    });
    return problemas;
  }),
);

const decodificar = Schema.decodeUnknownSync(esquemaRevisoesFatos, { onExcessProperty: "error", errors: "all" });

/** As revisões do texto de `fatos-ppc.yaml` (YAML `failsafe`); fora do contrato, lança o `SchemaError`. */
export function revisoesDoYaml(texto: string): readonly RevisaoFato[] {
  return decodificar(parse(texto, { schema: "failsafe", uniqueKeys: true })).revisoes;
}

/** Lê e valida `fatos-ppc.yaml`; sem o arquivo (uma base de teste), nenhuma revisão. */
export function carregarRevisoesFatos(raiz: string): readonly RevisaoFato[] {
  const arquivo = noCheckout(raiz, CAMINHOS.fatosPpc);
  return NodeFS.existsSync(arquivo) ? revisoesDoYaml(NodeFS.readFileSync(arquivo, "utf-8")) : [];
}

/** Linha (desde 1) do primeiro trecho literal no Markdown; `null` se não está numa linha só. */
export function linhaDoTrecho(markdown: string, trecho: string): number | null {
  const indice = markdown
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .findIndex((linha) => linha.includes(trecho));
  return indice === -1 ? null : indice + 1;
}

/**
 * Problemas das revisões contra a base: PPC fora do índice e trecho que não está, literal, numa linha
 * do Markdown. `ppcs` é o índice (`id` e `path` relativo a `base-conhecimento/`).
 */
export function validarRevisoesFatos(
  raiz: string,
  revisoes: readonly RevisaoFato[],
  ppcs: readonly { readonly id: string; readonly path: string }[],
): string[] {
  const porId = new Map(ppcs.map((p) => [p.id, p.path]));
  const erros: string[] = [];
  for (const revisao of revisoes) {
    const rotulo = `${CAMINHOS.fatosPpc}: ${revisao.ppc}, ${revisao.fato}`;
    const path = porId.get(revisao.ppc);
    if (!path) {
      erros.push(`${rotulo}: PPC fora da base`);
      continue;
    }
    const markdown = NodeFS.readFileSync(NodePath.join(noCheckout(raiz, CAMINHOS.base), path), "utf-8");
    if (linhaDoTrecho(markdown, revisao.trecho) === null)
      erros.push(`${rotulo}: trecho não está, literal, numa linha do PPC (${path})`);
  }
  return erros;
}

/** Um fato com a revisão aplicada, quando há: status `revisado`, revisor e data. */
export type FatoCurado = FatoPpc & { readonly revisor: string | null; readonly revisado_em: string | null };

/**
 * Os fatos de um PPC com as revisões dele aplicadas: o fato revisado troca valor, unidade e trecho
 * pelos da revisão, com status `revisado`; a revisão de um fato que a regra não achou o acrescenta.
 * Estágio revisado como `nao` tira a carga do estágio extraída (sem revisão dela).
 */
export function aplicarRevisoes(
  fatos: readonly FatoPpc[],
  revisoes: readonly RevisaoFato[],
  markdown: string,
): FatoCurado[] {
  const porFato = new Map<NomeFatoPpc, RevisaoFato>(revisoes.map((r) => [r.fato, r]));
  const saida: FatoCurado[] = [];
  for (const nome of FATOS_PPC) {
    const revisao = porFato.get(nome);
    const extraido = fatos.find((f) => f.fato === nome);
    if (revisao) {
      saida.push({
        fato: nome,
        valor: revisao.valor,
        valor_num: nome === "estagio_obrigatorio" ? null : Number(revisao.valor),
        unidade: revisao.unidade ?? null,
        linha: linhaDoTrecho(markdown, revisao.trecho) ?? extraido?.linha ?? 1,
        trecho_fonte: revisao.trecho,
        regra: "revisao",
        status_curadoria: "revisado",
        alternativas: [],
        revisor: revisao.revisor,
        revisado_em: revisao.revisado_em,
      });
    } else if (extraido) {
      const semEstagio = nome === "estagio_carga_h" && porFato.get("estagio_obrigatorio")?.valor === "nao";
      if (!semEstagio) saida.push({ ...extraido, revisor: null, revisado_em: null });
    }
  }
  return saida;
}
