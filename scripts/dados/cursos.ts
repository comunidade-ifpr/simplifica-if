/** Aplicação do relatório de coleta das matrizes do SUAP nos registros de curso. */
import * as Schema from "effect/Schema";
import { chaveCurso } from "../dominio/curso.ts";
import {
  consolidarMatrizes,
  resumoMatrizesAtivas,
  urlsMatrizesAtivas,
  type MatrizSuap,
  type RelatorioMatrizes,
} from "../dominio/matriz-suap.ts";
import {
  caminhosRegistro,
  carregarDadosInstitucionais,
  gravarRegistro,
  problemasCursoGravado,
  RAIZ_DADOS_INSTITUCIONAIS,
  type CursoLocal,
} from "./institucional.ts";

/** O bloco `suap.matrizes` do registro do curso. */
type MatrizesRegistro = NonNullable<NonNullable<CursoLocal["suap"]>["matrizes"]>;

/** Os campos de `suap.matrizes` que fazem uma mudança substantiva; `coletado_em` sozinho não faz. */
const CAMPOS_SUBSTANTIVOS = ["situacao", "carga_horaria_comum_h", "urls", "resumo"] as const;

/** Um curso cujo registro muda com o relatório. */
export interface MudancaMatrizes {
  readonly curso_id: string;
  readonly suap_id: number;
  readonly antes: MatrizesRegistro | undefined;
  readonly depois: MatrizesRegistro;
  readonly campos: ReadonlyArray<(typeof CAMPOS_SUBSTANTIVOS)[number]>;
  readonly registro: CursoLocal;
}

/** O que a aplicação de um relatório faria, conferido contra todos os registros antes de gravar. */
export interface PlanoMatrizes {
  readonly mudancas: ReadonlyArray<MudancaMatrizes>;
  /** Cursos do relatório cujo registro já tem as mesmas matrizes. */
  readonly semMudanca: number;
  /** Cursos do relatório que não conferem com o registro: ausentes, repetidos ou com outro SUAP. */
  readonly divergencias: ReadonlyArray<string>;
}

/** O bloco `suap.matrizes` gravado a partir das matrizes brutas: a consolidação é calculada aqui. */
function matrizesDoRegistro(matrizes: ReadonlyArray<MatrizSuap>, coletadoEm: string): MatrizesRegistro {
  const { situacao, carga_horaria_comum_h } = consolidarMatrizes(matrizes);
  return {
    resumo: resumoMatrizesAtivas(matrizes),
    urls: urlsMatrizesAtivas(matrizes),
    carga_horaria_comum_h: carga_horaria_comum_h ?? undefined,
    situacao,
    coletado_em: coletadoEm,
  };
}

/** Registros de `institucional/ifpr/` que não passam no esquema; leva a lista de problemas. */
class RegistrosInvalidos extends Schema.TaggedError<RegistrosInvalidos>()("RegistrosInvalidos", {
  problemas: Schema.Array(Schema.String),
}) {
  override get message(): string {
    return `institucional/ifpr/ inválido:\n- ${this.problemas.join("\n- ")}`;
  }
}

export const ehRegistrosInvalidos = Schema.is(RegistrosInvalidos);

/** O resultado da gravação das mudanças, conferido na releitura. */
type ResultadoGravacao =
  | { readonly _tag: "Gravada"; readonly naoConfirmados: ReadonlyArray<string> }
  | {
      readonly _tag: "Interrompida";
      readonly gravados: ReadonlyArray<string>;
      readonly falhou: string;
      readonly cause: unknown;
    }
  | { readonly _tag: "ReleituraInvalida"; readonly problemas: ReadonlyArray<string> };

/** O valor como o arquivo do registro o guarda (sem as chaves `undefined`). */
const comoNoArquivo = (valor: unknown) => JSON.stringify(valor ?? null);

export class RepositorioCursosLocal {
  private readonly raiz: string;

  constructor(raiz: string = RAIZ_DADOS_INSTITUCIONAIS) {
    this.raiz = raiz;
  }

  private carregar() {
    const { dados, erros } = carregarDadosInstitucionais(this.raiz);
    if (erros.length) throw new RegistrosInvalidos({ problemas: erros });
    return dados;
  }

  private cursosPorChave(): Map<string, CursoLocal> {
    return new Map(this.carregar().cursos.map((curso) => [chaveCurso(curso.campus_id, curso.curso_slug), curso]));
  }

  /**
   * Confere todos os cursos do relatório contra os registros (`suap.id` e `suap.codigo`) e calcula as
   * mudanças substantivas, sem gravar nada.
   */
  planejarMatrizes(relatorio: RelatorioMatrizes): PlanoMatrizes {
    const cursos = this.cursosPorChave();
    const vistos = new Set<string>();
    const divergencias: string[] = [];
    const mudancas: MudancaMatrizes[] = [];
    let semMudanca = 0;
    for (const coletado of relatorio.cursos) {
      const { curso_id: chave, suap_id: suapId, codigo } = coletado;
      if (vistos.has(chave)) {
        divergencias.push(`${chave}: repetido no relatório`);
        continue;
      }
      vistos.add(chave);
      const curso = cursos.get(chave);
      if (!curso) {
        divergencias.push(`${chave}: não encontrado em institucional/ifpr/cursos/`);
        continue;
      }
      const suap = curso.suap;
      if (suap?.id !== suapId || (suap.codigo ?? "") !== codigo) {
        divergencias.push(
          `${chave}: no registro, SUAP ${suap?.id ?? "ausente"} código ${suap?.codigo ?? "ausente"}; ` +
            `no relatório, SUAP ${suapId} código ${codigo}`,
        );
        continue;
      }
      const antes = suap.matrizes;
      const depois = matrizesDoRegistro(coletado.matrizes, relatorio.coletado_em);
      const campos = CAMPOS_SUBSTANTIVOS.filter(
        (campo) => comoNoArquivo(antes?.[campo]) !== comoNoArquivo(depois[campo]),
      );
      if (antes && !campos.length) {
        semMudanca += 1;
        continue;
      }
      const registro: CursoLocal = { ...curso, suap: { ...suap, matrizes: depois } };
      const invalidos = problemasCursoGravado(registro);
      if (invalidos.length) {
        divergencias.push(`${chave}: o registro gravado seria inválido (${invalidos.join("; ")})`);
        continue;
      }
      mudancas.push({ curso_id: chave, suap_id: suapId, antes, depois, campos, registro });
    }
    return { mudancas, semMudanca, divergencias };
  }

  /**
   * Grava os registros das mudanças, na ordem, e relê a base para confirmar. Uma falha de gravação para
   * no curso em que aconteceu e diz quais já foram gravados.
   */
  gravarMatrizes(mudancas: ReadonlyArray<MudancaMatrizes>): ResultadoGravacao {
    const gravados: string[] = [];
    for (const { curso_id, registro } of mudancas) {
      try {
        gravarRegistro(caminhosRegistro.curso(registro), registro, this.raiz);
      } catch (cause) {
        return { _tag: "Interrompida", gravados, falhou: curso_id, cause };
      }
      gravados.push(curso_id);
    }
    if (!mudancas.length) return { _tag: "Gravada", naoConfirmados: [] };
    let cursos: Map<string, CursoLocal>;
    try {
      cursos = this.cursosPorChave();
    } catch (erro) {
      if (ehRegistrosInvalidos(erro)) return { _tag: "ReleituraInvalida", problemas: erro.problemas };
      throw erro;
    }
    const naoConfirmados = mudancas
      .filter(({ curso_id, depois }) => comoNoArquivo(cursos.get(curso_id)?.suap?.matrizes) !== comoNoArquivo(depois))
      .map(({ curso_id }) => curso_id);
    return { _tag: "Gravada", naoConfirmados };
  }
}
