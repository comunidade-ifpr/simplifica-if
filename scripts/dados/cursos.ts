/** Leitura dos cursos locais para a coleta de matrizes do SUAP e aplicação do relatório nos registros. */
import { chaveCurso } from "../dominio/curso.ts";
import {
  consolidarMatrizes,
  resumoMatrizesAtivas,
  urlsMatrizesAtivas,
  type CursoParaColeta,
  type MatrizSuap,
  type RelatorioMatrizes,
} from "../dominio/matriz-suap.ts";
import {
  caminhosRegistro,
  carregarDadosInstitucionais,
  gravarRegistro,
  RAIZ_DADOS_INSTITUCIONAIS,
  type CursoLocal,
} from "./institucional.ts";

/** O bloco `suap.matrizes` do registro do curso. */
export type MatrizesRegistro = NonNullable<NonNullable<CursoLocal["suap"]>["matrizes"]>;

/** Os campos de `suap.matrizes` que fazem uma mudança substantiva; `coletado_em` sozinho não faz. */
export const CAMPOS_SUBSTANTIVOS = ["situacao", "carga_horaria_comum_h", "urls", "resumo"] as const;

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
export function matrizesDoRegistro(matrizes: ReadonlyArray<MatrizSuap>, coletadoEm: string): MatrizesRegistro {
  const { situacao, carga_horaria_comum_h } = consolidarMatrizes(matrizes);
  return {
    resumo: resumoMatrizesAtivas(matrizes),
    urls: urlsMatrizesAtivas(matrizes),
    carga_horaria_comum_h: carga_horaria_comum_h ?? undefined,
    situacao,
    coletado_em: coletadoEm,
  };
}

/** O valor como o arquivo do registro o guarda (sem as chaves `undefined`). */
const comoNoArquivo = (valor: unknown) => JSON.stringify(valor ?? null);

export class RepositorioCursosLocal {
  private readonly raiz: string;

  constructor(raiz: string = RAIZ_DADOS_INSTITUCIONAIS) {
    this.raiz = raiz;
  }

  private carregar() {
    const { dados, erros } = carregarDadosInstitucionais(this.raiz);
    if (erros.length) throw new Error(`institucional/ifpr/ inválido:\n- ${erros.join("\n- ")}`);
    return dados;
  }

  private cursosPorChave(): Map<string, CursoLocal> {
    return new Map(this.carregar().cursos.map((curso) => [chaveCurso(curso.campus_id, curso.curso_slug), curso]));
  }

  listarParaColeta(): CursoParaColeta[] {
    const dados = this.carregar();
    const nomesCampus = new Map(dados.campi.map((campus) => [campus.campus_id, campus.nome]));
    return dados.cursos.flatMap((curso) => {
      if (curso.suap?.id === undefined) return [];
      const campus = nomesCampus.get(curso.campus_id);
      if (campus === undefined) throw new Error(`Curso ${curso.suap.id} sem campus local: ${curso.nome}`);
      return [
        {
          curso_id: chaveCurso(curso.campus_id, curso.curso_slug),
          nome: curso.nome,
          campus,
          forma: curso.forma_oferta ?? "",
          codigo: curso.suap.codigo ?? "",
          suap_id: curso.suap.id,
        },
      ];
    });
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
      mudancas.push({ curso_id: chave, suap_id: suapId, antes, depois, campos, registro });
    }
    return { mudancas, semMudanca, divergencias };
  }

  /**
   * Grava os registros das mudanças e relê a base para confirmar. Devolve os cursos cuja releitura não
   * confere com o que foi gravado.
   */
  gravarMatrizes(mudancas: ReadonlyArray<MudancaMatrizes>): string[] {
    for (const { registro } of mudancas) gravarRegistro(caminhosRegistro.curso(registro), registro, this.raiz);
    if (!mudancas.length) return [];
    const cursos = this.cursosPorChave();
    return mudancas
      .filter(({ curso_id, depois }) => comoNoArquivo(cursos.get(curso_id)?.suap?.matrizes) !== comoNoArquivo(depois))
      .map(({ curso_id }) => curso_id);
  }
}
