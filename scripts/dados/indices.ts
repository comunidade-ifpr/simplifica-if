// @effect-diagnostics nodeBuiltinImport:off -- grava e confere os índices das coleções institucionais com node:fs síncrono (gerar_base, validar_base)
/**
 * Índices das coleções institucionais (`institucional/ifpr/<coleção>/index.json`). Os registros são
 * a fonte; o índice só os lista, com os campos de filtro mais usados e o `path` de cada arquivo
 * (relativo a `base-conhecimento/`, como nos manifestos), para quem lê a base publicada sem listar
 * diretórios. Não tem data: muda só quando os registros mudam. Gerado por `gerar_base.ts` e
 * conferido por `validar_base.ts`.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { compararTexto } from "../dominio/comum.ts";
import { chaveCurso } from "../dominio/curso.ts";
import {
  ARQUIVO_INDICE,
  caminhosRegistro,
  RAIZ_DADOS_INSTITUCIONAIS,
  textoRegistro,
  type DadosInstitucionais,
} from "./institucional.ts";

/** Caminho publicado de um registro: `institucional/ifpr/<coleção>/...`, com `/` em qualquer sistema. */
const publicado = (relativo: string) => ["institucional", "ifpr", ...relativo.split(NodePath.sep)].join("/");

export interface IndiceInstitucional {
  id: string;
  title: string;
  descricao: string;
  tipo_item: string;
  total_itens: number;
  items: Array<Record<string, unknown>>;
}

/** Coleção, pasta e id da coleção no `institucional_manifest.json`. */
export const COLECOES = [
  { pasta: "campi", id: "campi-ifpr" },
  { pasta: "cursos", id: "cursos-ifpr" },
  { pasta: "processos-seletivos", id: "processos-seletivos-ifpr" },
  { pasta: "editais", id: "editais-ingresso-ifpr" },
  { pasta: "ofertas", id: "ofertas-ingresso-ifpr" },
] as const;
export type PastaColecao = (typeof COLECOES)[number]["pasta"];

function indice(
  pasta: PastaColecao,
  title: string,
  descricao: string,
  tipoItem: string,
  items: Array<Record<string, unknown>>,
): IndiceInstitucional {
  const id = COLECOES.find((colecao) => colecao.pasta === pasta)!.id;
  return { id, title, descricao, tipo_item: tipoItem, total_itens: items.length, items };
}

const porId = (a: Record<string, unknown>, b: Record<string, unknown>) => compararTexto(String(a.id), String(b.id));

export function montarIndices(dados: DadosInstitucionais): Record<PastaColecao, IndiceInstitucional> {
  return {
    campi: indice(
      "campi",
      "Campi do IFPR",
      "Campi e campi avançados do Instituto Federal do Paraná, um arquivo por campus.",
      "campus",
      dados.campi
        .map((c) => ({ id: c.campus_id, nome: c.nome, path: publicado(caminhosRegistro.campus(c)) }))
        .sort(porId),
    ),
    cursos: indice(
      "cursos",
      "Cursos do IFPR",
      "Cursos de cada campus, com PPC, SUAP e habilitação do CNCT, um arquivo por curso (cursos/<campus_id>/<curso_slug>.json).",
      "curso",
      dados.cursos
        .map((c) => ({
          id: chaveCurso(c.campus_id, c.curso_slug),
          campus_id: c.campus_id,
          curso_slug: c.curso_slug,
          nome: c.nome,
          nivel: c.nivel,
          forma_oferta: c.forma_oferta,
          modalidade: c.modalidade,
          situacao: c.situacao,
          cnct_id: c.cnct_id,
          path: publicado(caminhosRegistro.curso(c)),
        }))
        .sort(porId),
    ),
    "processos-seletivos": indice(
      "processos-seletivos",
      "Processos seletivos do IFPR",
      "Processos seletivos de ingresso; editais e ofertas ficam nas coleções próprias e apontam para o processo.",
      "processo_seletivo",
      dados.processos
        .map((p) => ({
          id: p.processo_seletivo_id,
          nome: p.nome,
          ano_ingresso: p.ano_ingresso,
          path: publicado(caminhosRegistro.processo(p)),
        }))
        .sort(porId),
    ),
    editais: indice(
      "editais",
      "Editais de ingresso do IFPR",
      "Editais dos processos seletivos, um arquivo por edital.",
      "edital_ingresso",
      dados.editais
        .map((e) => ({
          id: e.edital_id,
          titulo: e.titulo,
          ano: e.ano,
          processos: e.processos,
          path: publicado(caminhosRegistro.edital(e)),
        }))
        .sort(porId),
    ),
    ofertas: indice(
      "ofertas",
      "Ofertas de ingresso do IFPR",
      "Vagas por curso em cada processo seletivo, com o trecho do edital, um arquivo por oferta (ofertas/<processo>/<oferta_id>.json).",
      "oferta_ingresso",
      dados.ofertas
        .map((o) => ({
          id: `${o.processos[0] ?? ""}/${o.oferta_id}`,
          processo_seletivo_id: o.processos[0],
          campus_id: o.campi?.[0] ?? o.campus_id_original,
          curso_id: o.cursos?.[0],
          curso_nome: o.curso_nome,
          tipo_oferta: o.tipo_oferta,
          vagas: o.vagas,
          path: publicado(caminhosRegistro.oferta(o)),
        }))
        .sort(porId),
    ),
  };
}

const caminhoIndice = (raiz: string, pasta: PastaColecao) => NodePath.join(raiz, pasta, ARQUIVO_INDICE);

/** Grava os índices que mudaram; devolve os caminhos gravados (relativos a `institucional/ifpr/`). */
export function gravarIndices(dados: DadosInstitucionais, raiz: string = RAIZ_DADOS_INSTITUCIONAIS): string[] {
  const gravados: string[] = [];
  for (const [pasta, conteudo] of Object.entries(montarIndices(dados)) as Array<[PastaColecao, IndiceInstitucional]>) {
    const destino = caminhoIndice(raiz, pasta);
    const texto = textoRegistro(conteudo);
    if (NodeFS.existsSync(destino) && NodeFS.readFileSync(destino, "utf-8") === texto) continue;
    NodeFS.mkdirSync(NodePath.dirname(destino), { recursive: true });
    NodeFS.writeFileSync(destino, texto, "utf-8");
    gravados.push(NodePath.join(pasta, ARQUIVO_INDICE));
  }
  return gravados;
}

/** Índices ausentes ou diferentes do que os registros geram. */
export function verificarIndices(dados: DadosInstitucionais, raiz: string = RAIZ_DADOS_INSTITUCIONAIS): string[] {
  return (Object.entries(montarIndices(dados)) as Array<[PastaColecao, IndiceInstitucional]>).flatMap(
    ([pasta, conteudo]) => {
      const destino = caminhoIndice(raiz, pasta);
      const atual = NodeFS.existsSync(destino) ? NodeFS.readFileSync(destino, "utf-8") : null;
      if (atual === textoRegistro(conteudo)) return [];
      return [
        `institucional/ifpr/${pasta}/${ARQUIVO_INDICE} ${atual === null ? "ausente" : "desatualizado"}; rode node scripts/gerar_base.ts`,
      ];
    },
  );
}
