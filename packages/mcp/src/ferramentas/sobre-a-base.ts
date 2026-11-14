/** Ferramenta 15, `sobre_a_base`: versão, data de referência e conteúdo da base. */
import { z } from "zod";
import { esquemaLink, responder } from "../envelope.ts";
import { linkCampus } from "../links.ts";
import { comLink, dataBr } from "../texto.ts";
import { definirFerramenta } from "./ferramenta.ts";

const entrada = z.strictObject({});

const dados = z.strictObject({
  /** Linhas por tabela do banco, de `meta.contagens_json`. */
  contagens: z.record(z.string(), z.number().int().min(0)),
  /** Valores do filtro `tipo` da busca em PPCs. */
  tipos_de_secao: z.array(z.string()),
  /** Níveis de curso e de PPC. */
  niveis: z.array(z.string()),
  /** `id` é o valor dos filtros `campus` (`curitiba`). */
  campi: z.array(z.strictObject({ id: z.string(), nome: z.string(), link: esquemaLink })),
});

/** Rótulos das contagens no texto, na ordem de leitura; o JSON traz todas as tabelas. */
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
  ["fichas", "fichas da analise-ppc"],
];

const linhasTipo = z.array(z.object({ tipo: z.string() }));
const linhasNivel = z.array(z.object({ nivel: z.string() }));
const linhasCampus = z.array(z.object({ campus_id: z.string(), nome: z.string() }));

export const sobreABase = definirFerramenta({
  nome: "sobre_a_base",
  titulo: "Sobre a base",
  descricao:
    "Versão, data de referência e conteúdo da base. Use quando o servidor perguntar o que a base contém ou de quando ela é.",
  entrada,
  dados,
  executar(_entrada, { db, meta, base }) {
    // ORDER BY com a colação BINARY do SQLite ordena por code point, como compararTexto do kb.
    const tipos = linhasTipo.parse(db.query("SELECT DISTINCT tipo FROM secoes ORDER BY tipo").all());
    const niveis = linhasNivel.parse(
      db.query("SELECT nivel FROM ppcs UNION SELECT nivel FROM cursos WHERE nivel IS NOT NULL ORDER BY nivel").all(),
    );
    const campi = linhasCampus.parse(db.query("SELECT campus_id, nome FROM campi ORDER BY campus_id").all());
    return responder(base, {
      contagens: meta.contagens,
      tipos_de_secao: tipos.map((t) => t.tipo),
      niveis: niveis.map((n) => n.nivel),
      campi: campi.map((c) => ({ id: c.campus_id, nome: c.nome, link: linkCampus(c.campus_id) })),
    });
  },
  texto({ base, dados }) {
    const conteudo = ROTULOS_CONTAGEM.filter(([tabela]) => dados.contagens[tabela] !== undefined).map(
      ([tabela, rotulo]) => `${dados.contagens[tabela]} ${rotulo}`,
    );
    return [
      `Base de conhecimento do IFPR, versão \`${base.versao}\` (canal ${base.canal}), com vigência calculada em ${dataBr(base.data_referencia)}.`,
      `Conteúdo: ${conteudo.join(", ")}.`,
      `Níveis: ${dados.niveis.join(", ")}.`,
      `Tipos de seção de PPC (filtro \`tipo\`): ${dados.tipos_de_secao.map((t) => `\`${t}\``).join(", ")}.`,
      `Campi (o ID entre crases é o valor do filtro \`campus\`): ${dados.campi.map((c) => `${comLink(c.nome, c.link)} \`${c.id}\``).join(", ")}.`,
    ].join("\n\n");
  },
});
