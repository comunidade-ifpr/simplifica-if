/**
 * Normas da fixture, acrescentadas ao banco de `criarBancoFixture` (`inserirNormas`): duas
 * resoluções da base (a de 2021, revogada pela de 2026, publicada em 12/11/2026), um stub, uma
 * referência externa, dispositivos com caput, subordinados, nota e revogação, relações, intervalos
 * de vigência, uma regra de transição e uma tabela de correspondência em rascunho. Os textos são
 * inventados; os formatos são os do `kb.sqlite`.
 */
import * as NodeSqlite from "node:sqlite";
import { emTransacao } from "@simplifica-if/kb/db/transacao";
import { radicais } from "@simplifica-if/kb/busca/tokens";
import { markdownSintetico } from "./fixture.ts";

export const DCN_2021 = "br/cne-cp/res/2021/1";
export const DCN_2026 = "br/cne-cp/res/2026/2";
export const STUB = "br/cne-ceb/res/2012/6";
export const EXTERNO = "externo:abnt/nbr/6023";
export const TABELA = "base-conhecimento/correspondencias/br-cne-cp-res-2021-1--br-cne-cp-res-2026-2.yaml";

const MD_2021 = "base-conhecimento/normas/br/resolucoes/RESOLUCAO_CNE-CP_1-2021_dcnept.md";
const MD_2026 = "base-conhecimento/normas/br/resolucoes/RESOLUCAO_CNE-CP_2-2026_dcnept.md";
const STUBS = "base-conhecimento/normas/stubs.yaml";

/** Artigos numerados da 2021, todos na tabela de correspondência: a norma inteira tem duas páginas. */
export const ARTIGOS_NUMERADOS = 12;
/** Incisos do art. 28 da 2026, longos: o artigo com os subordinados passa do teto de `buscar_norma`. */
export const INCISOS_ART28 = 20;
/** O art. 36 da 2026 tem mais de 12 mil caracteres. */
export const TAMANHO_ART36 = 12_500;

interface Norma {
  id: string;
  situacao: "base" | "stub" | "externo";
  titulo: string;
  tipo_documento?: string;
  numero?: string;
  ano?: number;
  orgao?: string;
  assinada_em?: string;
  publicada_em?: string;
  status_vigencia?: string;
  ementa: string;
  fonte_url?: string;
  fonte_referencia?: string;
  path?: string;
  aliases: string[];
  front_matter?: Record<string, unknown>;
  /** Linha dos metadados (1 no Markdown; a do stub em stubs.yaml). */
  linha: number;
}

const NORMAS: Norma[] = [
  {
    id: DCN_2021,
    situacao: "base",
    titulo: "Resolução CNE/CP nº 1/2021",
    tipo_documento: "Resolução",
    numero: "1",
    ano: 2021,
    orgao: "CNE/CP",
    assinada_em: "2021-01-05",
    publicada_em: "2021-01-06",
    status_vigencia: "revogada",
    ementa: "Define as Diretrizes Curriculares Nacionais Gerais para a Educação Profissional e Tecnológica.",
    fonte_url: "https://www.in.gov.br/dcnept-2021",
    path: MD_2021,
    aliases: ["Resolução CNE/CP nº 1/2021", "DCNEPT 2021"],
    front_matter: {
      id: DCN_2021,
      assinada_em: "2021-01-05",
      publicada_em: "2021-01-06",
      vigente_de: "2021-01-06",
    },
    linha: 1,
  },
  {
    id: DCN_2026,
    situacao: "base",
    titulo: "Resolução CNE/CP nº 2/2026",
    tipo_documento: "Resolução",
    numero: "2",
    ano: 2026,
    orgao: "CNE/CP",
    assinada_em: "2026-11-11",
    publicada_em: "2026-11-12",
    status_vigencia: "vigente",
    ementa: "Define as Diretrizes Curriculares Nacionais para a Educação Profissional e Tecnológica.",
    fonte_url: "https://www.in.gov.br/dcnept-2026",
    path: MD_2026,
    aliases: ["Resolução CNE/CP nº 2/2026", "DCNEPT 2026"],
    front_matter: {
      id: DCN_2026,
      assinada_em: "2026-11-11",
      publicada_em: "2026-11-12",
      vigente_de: "2026-11-12",
      pontos_chave: ["O PPC descreve o acompanhamento de egressos (art. 28, XVIII)."],
      notas_da_fonte: ["Texto convertido do PDF assinado."],
    },
    linha: 1,
  },
  {
    id: STUB,
    situacao: "stub",
    titulo: "Resolução CNE/CEB nº 6/2012",
    assinada_em: "2012-09-20",
    publicada_em: "2012-09-21",
    status_vigencia: "revogada",
    ementa: "Define Diretrizes Curriculares Nacionais para a Educação Profissional Técnica de Nível Médio.",
    aliases: ["Resolução CNE/CEB nº 6/2012"],
    linha: 10,
  },
  {
    id: EXTERNO,
    situacao: "externo",
    titulo: "ABNT NBR 6023",
    ementa: "Norma técnica da ABNT para elaboração de referências.",
    aliases: ["ABNT NBR 6023", "NBR 6023"],
    linha: 40,
  },
];

interface Dispositivo {
  norma: string;
  /** `#art20-i` */
  dispositivo: string;
  tipo: "artigo" | "paragrafo" | "inciso";
  rotulo: string;
  pai?: string;
  texto: string;
  estrutura?: string[];
  notas?: { tipo: string; texto: string }[];
  revogado?: boolean;
}

function dispositivos(): Dispositivo[] {
  const lista: Dispositivo[] = [];
  const cap1 = ["CAPÍTULO I", "DISPOSIÇÕES GERAIS"];
  for (let n = 1; n <= ARTIGOS_NUMERADOS; n += 1) {
    lista.push({
      norma: DCN_2021,
      dispositivo: `#art${n}`,
      tipo: "artigo",
      rotulo: `Art. ${n}.`,
      texto: `Art. ${n}. Disposição ${n} da resolução de 2021 sobre a educação profissional.`,
      estrutura: cap1,
    });
  }
  lista.push(
    {
      norma: DCN_2021,
      dispositivo: "#art20",
      tipo: "artigo",
      rotulo: "Art. 20.",
      texto: "Art. 20. A estruturação dos cursos técnicos deve ainda considerar:",
      estrutura: ["CAPÍTULO V"],
    },
    {
      norma: DCN_2021,
      dispositivo: "#art20-i",
      tipo: "inciso",
      rotulo: "I",
      pai: "#art20",
      texto: "I - a matriz tecnológica do eixo;",
      estrutura: ["CAPÍTULO V"],
    },
    {
      norma: DCN_2021,
      dispositivo: "#art20-ii",
      tipo: "inciso",
      rotulo: "II",
      pai: "#art20",
      texto: "II - o núcleo politécnico comum do eixo tecnológico.",
      estrutura: ["CAPÍTULO V"],
    },
    {
      norma: DCN_2021,
      dispositivo: "#art63",
      tipo: "artigo",
      rotulo: "Art. 63.",
      texto: "Art. 63. Os processos em tramitação podem ser adequados a esta Resolução.",
      estrutura: ["CAPÍTULO XI"],
    },
    {
      norma: DCN_2026,
      dispositivo: "#art22",
      tipo: "artigo",
      rotulo: "Art. 22.",
      texto: "Art. 22. Os cursos técnicos devem considerar os seguintes elementos em sua organização:",
      estrutura: ["CAPÍTULO IV"],
    },
    {
      norma: DCN_2026,
      dispositivo: "#art22-v",
      tipo: "inciso",
      rotulo: "V",
      pai: "#art22",
      texto: "V - a base tecnológica, de composição obrigatória;",
      estrutura: ["CAPÍTULO IV"],
    },
    {
      norma: DCN_2026,
      dispositivo: "#art28",
      tipo: "artigo",
      rotulo: "Art. 28.",
      texto: "Art. 28. O PPC de curso técnico deve conter, no mínimo:",
      estrutura: ["CAPÍTULO V"],
    },
  );
  for (let n = 1; n <= INCISOS_ART28; n += 1) {
    const romano = ROMANOS[n - 1]!;
    lista.push({
      norma: DCN_2026,
      dispositivo: `#art28-${romano.toLowerCase()}`,
      tipo: "inciso",
      rotulo: romano,
      pai: "#art28",
      texto: `${romano} – elemento ${n} do projeto pedagógico: ${"descrição detalhada do itinerário formativo e do acompanhamento de egressos ".repeat(5).trim()};`,
      estrutura: ["CAPÍTULO V"],
      ...(n === 7 ? { notas: [{ tipo: "redacao", texto: "(Redação dada pela Resolução CNE/CP nº 3/2026)" }] } : {}),
      ...(n === 20 ? { revogado: true } : {}),
    });
  }
  const repeticao = "A prática profissional supervisionada integra o currículo e tem carga horária própria. ";
  lista.push(
    {
      norma: DCN_2026,
      dispositivo: "#art36",
      tipo: "artigo",
      rotulo: "Art. 36.",
      texto: `Art. 36. ${repeticao.repeat(Math.ceil(TAMANHO_ART36 / repeticao.length)).trim()}`,
      estrutura: ["CAPÍTULO VI"],
    },
    {
      norma: DCN_2026,
      dispositivo: "#art71",
      tipo: "artigo",
      rotulo: "Art. 71.",
      texto:
        "Art. 71. Para a adequação dos cursos técnicos autorizados e em oferta é assegurado período de transição de até dois anos, a partir da vigência desta Resolução.",
      estrutura: ["CAPÍTULO XIV"],
    },
    {
      norma: DCN_2026,
      dispositivo: "#art71-parunico",
      tipo: "paragrafo",
      rotulo: "Parágrafo único.",
      pai: "#art71",
      texto: "Parágrafo único. Aos estudantes matriculados fica assegurado o direito de conclusão de seus cursos.",
      estrutura: ["CAPÍTULO XIV"],
    },
    {
      norma: DCN_2026,
      dispositivo: "#art74",
      tipo: "artigo",
      rotulo: "Art. 74.",
      texto: "Art. 74. Ficam revogadas:",
      estrutura: ["CAPÍTULO XIV"],
    },
    {
      norma: DCN_2026,
      dispositivo: "#art74-ii",
      tipo: "inciso",
      rotulo: "II",
      pai: "#art74",
      texto: "II – a Resolução CNE/CP nº 1, de 5 de janeiro de 2021;",
      estrutura: ["CAPÍTULO XIV"],
    },
  );
  return lista;
}

const ROMANOS = [
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
  "XIII",
  "XIV",
  "XV",
  "XVI",
  "XVII",
  "XVIII",
  "XIX",
  "XX",
];

/** Acrescenta as normas da fixture ao banco em `caminho` (criado por `criarBancoFixture`). */
export function inserirNormas(caminho: string): void {
  const db = new NodeSqlite.DatabaseSync(caminho);
  emTransacao(db, () => {
    const insNorma = db.prepare(
      `INSERT INTO normas (id, situacao, titulo, tipo_documento, numero, ano, orgao, jurisdicao, assinada_em, publicada_em, status_vigencia,
         status_fonte, ementa, fonte_url, fonte_referencia, curadoria, path, aliases_json, keywords_json, front_matter_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insMeta = db.prepare("INSERT INTO normas_metadados (norma_id, texto, path, linha) VALUES (?, ?, ?, ?)");
    const insFtsNorma = db.prepare("INSERT INTO normas_fts (rowid, titulo, texto, radicais) VALUES (?, ?, ?, ?)");
    for (const n of NORMAS) {
      insNorma.run(
        n.id,
        n.situacao,
        n.titulo,
        n.tipo_documento ?? null,
        n.numero ?? null,
        n.ano ?? null,
        n.orgao ?? null,
        n.situacao === "base" ? "BR" : null,
        n.assinada_em ?? null,
        n.publicada_em ?? null,
        n.status_vigencia ?? null,
        n.situacao === "stub" ? DCN_2021 : null,
        n.ementa,
        n.fonte_url ?? null,
        n.fonte_referencia ?? null,
        n.situacao === "base" ? null : "conferido",
        n.path ?? null,
        JSON.stringify(n.aliases),
        "[]",
        n.front_matter ? JSON.stringify(n.front_matter) : null,
      );
      const texto = [...n.aliases, n.ementa].join("\n");
      const { lastInsertRowid } = insMeta.run(n.id, texto, n.path ?? STUBS, n.linha);
      insFtsNorma.run(lastInsertRowid, n.titulo, texto, radicais(`${n.titulo}\n${texto}`).join(" "));
    }

    const insDisp = db.prepare(
      `INSERT INTO dispositivos (id, norma_id, dispositivo, tipo, rotulo, pai, ordem, texto, caput_json, texto_com_caput,
         estrutura_json, notas_json, revogado, vetado, path, linha_inicio, linha_fim)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insFtsDisp = db.prepare("INSERT INTO dispositivos_fts (rowid, texto, radicais) VALUES (?, ?, ?)");
    const lista = dispositivos();
    const porId = new Map(lista.map((d) => [`${d.norma}${d.dispositivo}`, d]));
    const ordens = new Map<string, number>();
    const linhasDoDocumento = new Map<string, Map<number, string>>();
    for (const d of lista) {
      const ordem = ordens.get(d.norma) ?? 0;
      ordens.set(d.norma, ordem + 1);
      const caput: string[] = [];
      for (let pai = d.pai; pai; pai = porId.get(`${d.norma}${pai}`)?.pai) {
        caput.unshift(porId.get(`${d.norma}${pai}`)!.texto);
      }
      const textoComCaput = [...caput, d.texto].join("\n");
      const linha = 100 + ordem * 2;
      const { lastInsertRowid } = insDisp.run(
        `${d.norma}${d.dispositivo}`,
        d.norma,
        d.dispositivo,
        d.tipo,
        d.rotulo,
        d.pai ? `${d.norma}${d.pai}` : null,
        ordem,
        d.texto,
        JSON.stringify(caput),
        textoComCaput,
        JSON.stringify(d.estrutura ?? []),
        JSON.stringify(d.notas ?? []),
        d.revogado ? 1 : 0,
        0,
        d.norma === DCN_2021 ? MD_2021 : MD_2026,
        linha,
        linha,
      );
      insFtsDisp.run(lastInsertRowid, textoComCaput, radicais(textoComCaput).join(" "));
      // o Markdown do leitor: o artigo como cabeçalho, os outros como parágrafo, na linha do dispositivo
      const linhas = linhasDoDocumento.get(d.norma) ?? new Map<number, string>();
      linhas.set(linha, d.tipo === "artigo" ? `#### ${d.texto}` : d.texto);
      linhasDoDocumento.set(d.norma, linhas);
    }
    const insDocumento = db.prepare("INSERT INTO documentos (path, texto) VALUES (?, ?)");
    for (const n of NORMAS) {
      if (n.situacao !== "base" || !n.path) continue;
      const linhas = linhasDoDocumento.get(n.id) ?? new Map<number, string>();
      linhas.set(5, `# ${n.titulo}`);
      linhas.set(7, n.ementa);
      linhas.set(9, `Fonte oficial: [Diário Oficial](${n.fonte_url ?? "https://www.in.gov.br"}).`);
      insDocumento.run(n.path, markdownSintetico(n.id, linhas));
    }

    const insRelacao = db.prepare(
      `INSERT INTO relacoes (ordem, tipo, origem, operador, alvo, alvo_dispositivo, alcance, efeito_de, efeito_em,
         evidencia_em, evidencia_trecho, confirmado_em, proposta, nota, path)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, 'vigencia-da-origem', ?, ?, ?, '2026-11-13', 'front-matter', ?, 'base-conhecimento/relacoes.yaml')`,
    );
    insRelacao.run(
      0,
      "revoga",
      DCN_2026,
      "#art74-ii",
      DCN_2021,
      "2026-11-12",
      `${DCN_2026}#art74-ii`,
      "a Resolução CNE/CP nº 1, de 5 de janeiro de 2021",
      "Regras de transição nos arts. 70 a 72.",
    );
    insRelacao.run(
      1,
      "revoga",
      DCN_2021,
      "#art64",
      STUB,
      "2021-01-06",
      `${DCN_2021}#art64`,
      "a Resolução CNE/CEB nº 6, de 20 de setembro de 2012",
      null,
    );

    const insVigencia = db.prepare(
      "INSERT INTO vigencias (alvo, ordem, de, ate, status, fonte) VALUES (?, ?, ?, ?, ?, ?)",
    );
    insVigencia.run(DCN_2021, 0, null, "2021-01-06", "ainda-nao-vigente", "anterior");
    insVigencia.run(DCN_2021, 1, "2021-01-06", "2026-11-12", "vigente", "inicio");
    insVigencia.run(DCN_2021, 2, "2026-11-12", null, "revogada", `revoga ${DCN_2026}#art74-ii`);
    insVigencia.run(DCN_2026, 0, null, "2026-11-12", "ainda-nao-vigente", "anterior");
    insVigencia.run(DCN_2026, 1, "2026-11-12", null, "vigente", "inicio");

    db.prepare(
      `INSERT INTO transicoes (id, norma_id, dispositivo, tipo, norma_anterior, aplica_a, regra, inicio, fim, inicio_em,
         fim_em, evidencia, path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "dcnept-2026-art71",
      DCN_2026,
      "#art71",
      "prazo-de-adequacao",
      DCN_2021,
      "Cursos técnicos autorizados e em oferta.",
      "Período de transição de até dois anos, a partir da vigência da Res. CNE/CP nº 2/2026, para a adequação dos cursos.",
      "vigencia",
      "P2Y",
      "2026-11-12",
      "2028-11-12",
      "é assegurado período de transição de até dois anos",
      "base-conhecimento/transicoes.yaml",
    );

    db.prepare(
      `INSERT INTO correspondencias_tabelas (arquivo, origem, destino, status, elaborado_em, revisado_por, metodo)
       VALUES (?, ?, ?, 'rascunho', '2026-11-13', NULL, 'leitura comparada')`,
    ).run(TABELA, DCN_2021, DCN_2026);
    const insItem = db.prepare(
      "INSERT INTO correspondencias (tabela, ordem, origem, tipo, destino_json, nota) VALUES (?, ?, ?, ?, ?, ?)",
    );
    let ordem = 0;
    const item = (origem: string, tipo: string, destino: string[], nota: string | null = null) =>
      insItem.run(
        TABELA,
        ordem++,
        `${DCN_2021}${origem}`,
        tipo,
        JSON.stringify(destino.map((d) => `${DCN_2026}${d}`)),
        nota,
      );
    for (let n = 1; n <= ARTIGOS_NUMERADOS; n += 1) item(`#art${n}`, "equivalente", [n === 1 ? "#art22" : "#art28"]);
    item("#art20", "parcial", ["#art22"], "A lista é retomada no art. 22, com acréscimos.");
    item("#art20-i", "equivalente", ["#art22-v"], "Base tecnológica, agora de composição obrigatória.");
    item("#art63", "sem-equivalente", [], "Sem regra correspondente.");
  });
  db.close();
}
