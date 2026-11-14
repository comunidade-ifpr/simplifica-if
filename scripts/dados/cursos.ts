/** Leitura e gravação dos cursos locais usadas pela coleta de matrizes do SUAP. */
import { resumoMatrizesAtivas, urlsMatrizesAtivas } from "../dominio/matriz-suap.ts";
import { chaveCurso } from "../dominio/curso.ts";
import type { CursoColetado, CursoParaColeta } from "../suap/matrizes.ts";
import {
  caminhosRegistro,
  carregarDadosInstitucionais,
  gravarRegistro,
  RAIZ_DADOS_INSTITUCIONAIS,
  type CursoLocal,
} from "./institucional.ts";

export class RepositorioCursosLocal {
  private readonly raiz: string;

  constructor(raiz: string = RAIZ_DADOS_INSTITUCIONAIS) {
    this.raiz = raiz;
  }

  private carregar() {
    const { dados, erros } = carregarDadosInstitucionais(this.raiz);
    if (erros.length) throw new Error(`dados/institucional/ inválido:\n- ${erros.join("\n- ")}`);
    return dados;
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

  /** Confere a identidade do curso, grava as matrizes no arquivo do curso e relê para confirmar. */
  gravarMatrizes(coletado: CursoColetado, coletadoEm: string): void {
    const encontrar = () =>
      this.carregar().cursos.find((curso) => chaveCurso(curso.campus_id, curso.curso_slug) === coletado.curso_id);
    const curso = encontrar();
    if (!curso) throw new Error(`Curso não encontrado em dados/institucional/: ${coletado.curso_id}`);
    if (curso.suap?.id !== coletado.suap_id || (curso.suap?.codigo ?? "") !== coletado.codigo) {
      throw new Error(`Curso alterado desde a coleta: ${coletado.suap_id}`);
    }
    const matrizes = {
      resumo: resumoMatrizesAtivas(coletado.matrizes),
      urls: urlsMatrizesAtivas(coletado.matrizes),
      carga_horaria_comum_h: coletado.carga_horaria_comum_h ?? undefined,
      situacao: coletado.situacao,
      coletado_em: coletadoEm,
    };
    const atualizado: CursoLocal = { ...curso, suap: { ...curso.suap, matrizes } };
    gravarRegistro(caminhosRegistro.curso(atualizado), atualizado, this.raiz);

    const salvo = encontrar()?.suap?.matrizes;
    if (JSON.stringify(salvo) !== JSON.stringify(JSON.parse(JSON.stringify(matrizes)))) {
      throw new Error(`Gravação local não confirmada para o curso ${coletado.suap_id}`);
    }
  }
}
