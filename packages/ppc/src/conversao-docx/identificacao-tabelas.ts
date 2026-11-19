/**
 * Dados das tabelas de identificação do PPC: pares campo | valor, ou "Campo: valor" numa coluna só.
 *
 * Cada linha campo | valor vira uma chave com o nome do campo normalizado (`tipo_de_matricula`);
 * além disso, os rótulos conhecidos preenchem chaves canônicas (`nome_curso`, `campus`, `turno`…).
 * A identificação que vai para o `metadata.json` da rodada é a de `../identificacao.ts`, sobre o
 * `PPC.md`; estes dados só preenchem o que ela não achar.
 */
import { search, sub } from "@simplifica-if/kb/primitivas/regex";
import { semMarcas } from "@simplifica-if/kb/primitivas/texto";
import { aparar } from "@simplifica-if/kb/texto";
import { type TabelaNormalizada, todasAsLinhas } from "@simplifica-if/docx/tabelas";

const r = String.raw;

/**
 * Os rótulos de identificação (curso, oferta, modalidade, eixo, campus) só valem no início da
 * célula e com dois-pontos: "Base legal específica do curso: Resolução CNE/CP nº 1/2021" não é
 * nome de curso. Mesma regra do caminho Markdown (`../identificacao.ts`).
 */
const INICIO = r`^\s*(?:\d+(?:\.\d+)*\.?\s*[-–—.)]?\s*)?`;

const PADROES_EM_LINHA: Array<[campo: string, padroes: string[]]> = [
  [
    "nome_curso",
    [INICIO + r`nome\s+do\s+curso\s*:\s*(.+)`, INICIO + r`denomina[çc][ãa]o(?:\s+do\s+curso)?\s*:\s*(.+)`],
  ],
  ["forma_oferta", [INICIO + r`forma\s+de\s+oferta\s*:\s*(.+)`]],
  ["modalidade_ensino", [INICIO + r`modalidade(?:\s+de\s+(?:oferta|ensino))?\s*:\s*(.+)`]],
  ["eixo_tecnologico", [INICIO + r`eixo\s+tecnol[óo]gico\s*:\s*(.+)`]],
  [
    "campus",
    [INICIO + r`(?:local\s+de\s+realiza[çc][ãa]o\s*/\s*)?c[âa]mpus\s*:\s*(.+)`, INICIO + r`unidade\s*:\s*(.+)`],
  ],
  ["carga_horaria_total", [r`carga[\s-]hor[áa]ria\s+total[^:]*[:\s]+(.+)`, r`ch\s+total[:\s]+(.+)`]],
  [
    "duracao",
    [
      r`tempo\s+de\s+dura[çc][ãa]o[^:]*[:\s]+(.+)`,
      r`tempo\s+de\s+integraliza[çc][ãa]o[:\s]+(.+)`,
      r`dura[çc][ãa]o\s+do\s+curso[:\s]+(.+)`,
    ],
  ],
  ["turno", [r`turno[^:]*[:\s]+(.+)`]],
  ["vagas", [r`total\s+de\s+vagas[^:]*[:\s]+(.+)`, r`vagas[:\s]+(\d+)`, r`n[úu]mero\s+de\s+vagas[:\s]+(\d+)`]],
  ["horario_oferta", [r`hor[áa]rio\s+de\s+oferta[^:]*[:\s]+(.+)`]],
  ["tipo_matricula", [r`tipo\s+de\s+matr[íi]cula[:\s]+(.+)`]],
  ["periodicidade", [r`periodicidade[:\s]+(.+)`]],
  ["etapas_regime_avaliacao", [r`etapas/regime\s+de\s+avalia[çc][ãa]o[:\s]+(.+)`]],
  ["regime_oferta", [r`regime\s+de\s+oferta[:\s]+(.+)`]],
  ["carga_horaria_estagio", [r`carga\s+hor[áa]ria\s+de\s+est[áa]gio[^:]*[:\s]+(.+)`]],
  [
    "ano_vigencia",
    [
      r`in[íi]cio\s+(?:da\s+)?(?:nova\s+)?matriz[^:]*[:\s]+(\d{4})`,
      r`ano\s+de\s+vig[êe]ncia[:\s]+(\d{4})`,
      r`vig[êe]ncia[:\s]+(\d{4})`,
    ],
  ],
];

/** Preenche as chaves canônicas ainda ausentes com os "Campo: valor" do texto. */
function extrairValoresEmLinha(texto: string, dados: Map<string, string>): void {
  for (const [campo, padroes] of PADROES_EM_LINHA) {
    if (dados.has(campo)) continue;
    for (const padrao of padroes) {
      const m = search(padrao, texto, { ignoreCase: true });
      if (!m) continue;
      dados.set(campo, aparar(m[1]!));
      break;
    }
  }
}

/** Nome de campo como chave: sem acentos, minúsculo, sem pontuação e com `_` no lugar dos espaços. */
export function normalizarNomeDeCampo(campo: string): string {
  return sub(r`\s+`, "_", sub(r`[^\w\s]`, "", semMarcas(campo).toLowerCase()));
}

/** Pares campo-valor de uma tabela de identificação, na ordem em que aparecem. */
export function extrairDadosDeIdentificacao(tabela: TabelaNormalizada): Map<string, string> {
  const dados = new Map<string, string>();
  for (const linha of todasAsLinhas(tabela)) {
    if (linha.length === 1) {
      extrairValoresEmLinha(aparar(linha[0]!), dados);
      continue;
    }
    if (linha.length < 2) continue;
    const campo = aparar(linha[0]!);
    const valor = aparar(linha[1]!);
    if (!campo || !valor) continue;
    extrairValoresEmLinha(campo, dados);
    extrairValoresEmLinha(valor, dados);
    dados.set(normalizarNomeDeCampo(campo), valor);
  }
  return dados;
}
