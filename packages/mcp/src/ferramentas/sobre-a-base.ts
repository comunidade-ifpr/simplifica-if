/** Ferramenta 15, `sobre_a_base`: versão, dia da vigência e conteúdo da base. */
import * as Schema from "effect/Schema";
import { EsquemaLink } from "../contratos.ts";
import { inteiro } from "../esquema.ts";
import { comLink, dataBr } from "../texto.ts";
import { definirFerramenta } from "./ferramenta.ts";

export const Entrada = Schema.Struct({});

export const Dados = Schema.Struct({
  /** O dia em que as consultas sem data calculam a vigência (no app, hoje). */
  vigencia_em: Schema.String,
  /** Linhas por tabela do banco, de `meta.contagens_json`, sem as da revisão de PPC (`revisao_ppc_*`). */
  contagens: Schema.Record(Schema.String, inteiro({ minimo: 0 })),
  /** Valores do filtro `tipo` da busca em PPCs. */
  tipos_de_secao: Schema.Array(Schema.String),
  /** Níveis de curso e de PPC. */
  niveis: Schema.Array(Schema.String),
  /** `id` é o valor dos filtros `campus` (`curitiba`). */
  campi: Schema.Array(Schema.Struct({ id: Schema.String, nome: Schema.String, link: EsquemaLink })),
});

/** Rótulos das contagens no texto, na ordem de leitura; o JSON traz todas as tabelas da base. */
const ROTULOS_CONTAGEM: [tabela: string, rotulo: string][] = [
  ["normas", "normas (base, stubs e externas)"],
  ["dispositivos", "dispositivos de normas"],
  ["relacoes", "relações entre normas"],
  ["transicoes", "regras de transição"],
  ["ppcs", "PPCs"],
  ["secoes", "seções de PPC"],
  ["citacoes", "citações normativas em PPCs"],
  ["cursos", "cursos"],
  ["ofertas", "ofertas de ingresso"],
  ["cnct", "cursos do CNCT"],
  ["campi", "campi"],
];

export const sobreABase = definirFerramenta({
  nome: "sobre_a_base",
  titulo: "Sobre a base",
  descricao:
    "Versão, dia da vigência e conteúdo da base. Use quando o usuário (um servidor do IFPR) perguntar o que a base contém ou de quando ela é.",
  entrada: Entrada,
  dados: Dados,
  texto({ base, dados }) {
    const conteudo = ROTULOS_CONTAGEM.filter(([tabela]) => dados.contagens[tabela] !== undefined).map(
      ([tabela, rotulo]) => `${dados.contagens[tabela]} ${rotulo}`,
    );
    return [
      `Base de conhecimento do IFPR, ${base.data === null ? "em desenvolvimento" : `de ${dataBr(base.data)}`}, versão \`${base.versao}\` (canal ${base.canal}). A vigência das normas é calculada em ${dataBr(dados.vigencia_em)}, salvo quando a consulta pede outra data.`,
      `Conteúdo: ${conteudo.join(", ")}.`,
      `Níveis: ${dados.niveis.join(", ")}.`,
      `Tipos de seção de PPC (filtro \`tipo\`): ${dados.tipos_de_secao.map((t) => `\`${t}\``).join(", ")}.`,
      `Campi (o ID entre crases é o valor do filtro \`campus\`): ${dados.campi.map((c) => `${comLink(c.nome, c.link)} \`${c.id}\``).join(", ")}.`,
    ].join("\n\n");
  },
});
