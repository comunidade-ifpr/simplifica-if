/** Validação de `dados/institucional/`: schema, caminho de cada arquivo e as regras da auditoria institucional. */
import { auditarBase } from "../dominio/auditoria.ts";
import { carregarDadosInstitucionais, paraDominio, RAIZ_DADOS_INSTITUCIONAIS } from "./institucional.ts";

export function validarDadosInstitucionais(raiz: string = RAIZ_DADOS_INSTITUCIONAIS): {
  erros: string[];
  total: number;
} {
  const { dados, erros } = carregarDadosInstitucionais(raiz);
  if (erros.length) return { erros, total: 0 };
  // As movimentações ainda vivem no Notion; aqui valem as regras dos registros locais e de suas relações.
  const auditoria = auditarBase({ ...paraDominio(dados), movimentacoes: [] });
  const total =
    dados.campi.length + dados.cursos.length + dados.processos.length + dados.editais.length + dados.ofertas.length;
  return { erros: auditoria.map((erro) => `dados/institucional: ${erro}`), total };
}
