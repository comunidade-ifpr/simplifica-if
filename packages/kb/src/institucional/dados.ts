// @effect-diagnostics nodeBuiltinImport:off -- carregador síncrono dos registros institucionais, usado pela compilação do banco
/**
 * Leitura dos registros institucionais (`base-conhecimento/institucional/ifpr/`: campi, cursos,
 * processos seletivos, editais e ofertas) pelo núcleo `packages/kb` (compilação do `kb.sqlite`).
 *
 * O contrato estrito desses arquivos é o de `scripts/dados/institucional.ts`, conferido por
 * `node scripts/validar_base.ts`; aqui os esquemas são frouxos (`StructWithRest`) e só exigem os
 * campos que o banco usa, para que a dependência continue num sentido só (scripts → kb).
 * Cada registro vem com o caminho do arquivo, relativo à raiz do repositório. O `index.json` de cada
 * coleção é gerado e não é registro.
 */
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { formatarErro } from "../esquema/mensagens.ts";
import { compararTexto } from "../texto.ts";

/** Pasta dos registros institucionais, relativa à raiz do repositório. */
export const PASTA_INSTITUCIONAL = "base-conhecimento/institucional/ifpr";
/** O índice gerado de cada coleção, que não é registro. */
export const ARQUIVO_INDICE = "index.json";

const texto = Schema.optionalKey(Schema.String);
const inteiro = Schema.optionalKey(Schema.Int);
const resto = [Schema.Record(Schema.String, Schema.Unknown)] as const;
/** Objeto frouxo: exige os campos dados e deixa os demais na saída. */
const solto = <Campos extends Schema.Struct.Fields>(campos: Campos) =>
  Schema.StructWithRest(Schema.Struct(campos), resto);

export const esquemaCampus = solto({ campus_id: Schema.String, nome: Schema.String, site: texto });

export const esquemaCurso = solto({
  campus_id: Schema.String,
  curso_slug: Schema.String,
  nome: Schema.String,
  nivel: texto,
  forma_oferta: texto,
  modalidade: texto,
  situacao: texto,
  pagina_oficial: texto,
  cnct_id: texto,
  cnct_ausencia: texto,
  suap: Schema.optionalKey(
    solto({
      id: inteiro,
      codigo: texto,
      vagas: inteiro,
      matrizes: Schema.optionalKey(
        solto({
          resumo: texto,
          urls: Schema.optionalKey(Schema.Array(Schema.String)),
          carga_horaria_comum_h: inteiro,
          situacao: texto,
          coletado_em: texto,
        }),
      ),
    }),
  ),
  ppc: Schema.optionalKey(
    solto({
      url: texto,
      markdown_path: texto,
      ano_documento: inteiro,
      curadoria_ano: texto,
      data_curadoria_ano: texto,
      vagas: texto,
      observacoes: texto,
    }),
  ),
});

export const esquemaProcesso = solto({
  processo_seletivo_id: Schema.String,
  nome: Schema.String,
  ano_ingresso: inteiro,
  status_curadoria: texto,
});

export const esquemaEdital = solto({
  edital_id: Schema.String,
  titulo: Schema.String,
  url: Schema.String,
  numero: texto,
  ano: inteiro,
  tipo: texto,
  processos: Schema.Array(Schema.String),
});

export const esquemaOferta = solto({
  oferta_id: Schema.String,
  processos: Schema.Array(Schema.String),
  curso_nome: Schema.String,
  tipo_oferta: Schema.String,
  vagas: inteiro,
  url_fonte: Schema.String,
  pagina_fonte: inteiro,
  trecho_fonte: texto,
  status_curadoria: texto,
  modalidade: texto,
  turno: texto,
  turno_padronizado: texto,
  turno_nota: texto,
  campi: Schema.optionalKey(Schema.Array(Schema.String)),
  cursos: Schema.optionalKey(Schema.Array(Schema.String)),
  editais: Schema.optionalKey(Schema.Array(Schema.String)),
  campus_id_original: texto,
  curso_slug_original: texto,
});

export type Registro<T> = { arquivo: string; conteudo: string; dados: T };

export interface DadosInstitucionaisKb {
  campi: Registro<typeof esquemaCampus.Type>[];
  cursos: Registro<typeof esquemaCurso.Type>[];
  processos: Registro<typeof esquemaProcesso.Type>[];
  editais: Registro<typeof esquemaEdital.Type>[];
  ofertas: Registro<typeof esquemaOferta.Type>[];
}

const decodificarCampus = Schema.decodeUnknownResult(esquemaCampus);
const decodificarCurso = Schema.decodeUnknownResult(esquemaCurso);
const decodificarProcesso = Schema.decodeUnknownResult(esquemaProcesso);
const decodificarEdital = Schema.decodeUnknownResult(esquemaEdital);
const decodificarOferta = Schema.decodeUnknownResult(esquemaOferta);

function arquivosJson(dir: string): string[] {
  if (!NodeFS.existsSync(dir)) return [];
  return NodeFS.readdirSync(dir, { withFileTypes: true })
    .flatMap((entrada) => {
      const caminho = NodePath.join(dir, entrada.name);
      if (entrada.isDirectory()) return arquivosJson(caminho);
      return entrada.name.endsWith(".json") && entrada.name !== ARQUIVO_INDICE ? [caminho] : [];
    })
    .sort(compararTexto);
}

function colecao<T>(
  raiz: string,
  subdir: string,
  decodificar: (valor: unknown) => Result.Result<T, Schema.SchemaError>,
): Registro<T>[] {
  return arquivosJson(NodePath.join(raiz, PASTA_INSTITUCIONAL, subdir)).map((arquivo) => {
    const conteudo = NodeFS.readFileSync(arquivo, "utf-8");
    const relativo = NodePath.relative(raiz, arquivo).split(NodePath.sep).join("/");
    const resultado = decodificar(JSON.parse(conteudo));
    if (Result.isFailure(resultado)) throw new Error(`${relativo}: ${formatarErro(resultado.failure)}`);
    return { arquivo: relativo, conteudo, dados: resultado.success };
  });
}

export function carregarDadosInstitucionaisKb(raiz: string): DadosInstitucionaisKb {
  return {
    campi: colecao(raiz, "campi", decodificarCampus),
    cursos: colecao(raiz, "cursos", decodificarCurso),
    processos: colecao(raiz, "processos-seletivos", decodificarProcesso),
    editais: colecao(raiz, "editais", decodificarEdital),
    ofertas: colecao(raiz, "ofertas", decodificarOferta),
  };
}

/** Linha (desde 1) da primeira ocorrência da chave JSON `"chave":` no texto do arquivo, ou 1. */
export function linhaDaChave(conteudo: string, chave: string): number {
  const indice = conteudo.indexOf(`"${chave}":`);
  if (indice < 0) return 1;
  let linha = 1;
  for (let i = 0; i < indice; i += 1) if (conteudo.charCodeAt(i) === 10) linha += 1;
  return linha;
}

/* -------------------------------------------------------------------- SUAP */

export interface MatrizSuap {
  ordem: number;
  matriz_id: number;
  descricao: string;
  ano: number | null;
  ch_exibida_h: number;
  estagio_exigido: boolean;
  ch_estagio_h: number | null;
  /** Linha do resumo, literal. */
  trecho: string;
}

const RE_MATRIZ =
  /^(\d+) — (.+?) — CH exibida: (\d+) h; estágio exigido: (Sim|Não); CH mínima de estágio \(separada\): (?:(\d+)(?: h)?|-)$/;

/** Matrizes do `suap.matrizes.resumo` (uma por linha). Linha fora do formato gera erro. */
export function matrizesDoResumo(resumo: string): MatrizSuap[] {
  return resumo
    .split("\n")
    .filter((linha) => linha.trim())
    .map((linha, ordem) => {
      const m = RE_MATRIZ.exec(linha.trim());
      if (!m) throw new Error(`linha de matriz SUAP fora do formato: ${linha}`);
      const ano = /\s-\s(\d{4})\b/.exec(m[2]!);
      return {
        ordem,
        matriz_id: Number(m[1]),
        descricao: m[2]!,
        ano: ano ? Number(ano[1]) : null,
        ch_exibida_h: Number(m[3]),
        estagio_exigido: m[4] === "Sim",
        ch_estagio_h: m[5] === undefined ? null : Number(m[5]),
        trecho: linha.trim(),
      };
    });
}
