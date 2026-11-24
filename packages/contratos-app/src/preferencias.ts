/**
 * O primeiro uso (M1.8): o perfil da pessoa (campus, cargo e função), o aviso de uso aceito, as
 * boas-vindas concluídas e as IAs que ela deixou de usar no app. Tudo fica só neste computador, no
 * banco do servidor local (`conversas.sqlite`); nada disso vai à IA nem a outro lugar.
 *
 * O perfil segue o SUAP: o campus ou a pró-reitoria, a categoria e o cargo (os do filtro da lista de
 * servidores), e a função de gestão, se houver. Ele se traduz nos públicos do manifesto de skill
 * (`@simplifica-if/mcp/publicos`, por `publicosDoPerfil`): o Início põe primeiro as tarefas que servem
 * a eles.
 */
import { PUBLICOS, type Publico } from "@simplifica-if/mcp/publicos";
import { Provider } from "@simplifica-if/motor/eventos";
import * as Schema from "effect/Schema";
import { Rpc, RpcGroup } from "effect/rpc";

export { PUBLICOS, type Publico };

/**
 * A categoria do servidor, como no filtro "Categoria" da lista de servidores do SUAP (sem a de
 * estagiário, que não usa o app).
 */
export const CATEGORIAS = ["docente", "tecnico-administrativo"] as const;

export const CategoriaPerfil = Schema.Literals(CATEGORIAS);
export type CategoriaPerfil = typeof CategoriaPerfil.Type;

export const ROTULOS_CATEGORIA: Readonly<Record<CategoriaPerfil, string>> = {
  docente: "Docente",
  "tecnico-administrativo": "Técnico-administrativo",
};

export interface DescricaoCargo {
  readonly id: string;
  readonly rotulo: string;
  readonly categoria: CategoriaPerfil;
}

/**
 * Os cargos do filtro "Cargo Emprego" do SUAP com servidor ativo do IFPR na categoria (lista de
 * novembro de 2026), com o nome por extenso. Ficam de fora os cargos de outros planos (servidores
 * cedidos ou redistribuídos, um ou dois cada), que a pessoa marca como "Outro cargo".
 */
const LISTA_CARGOS = [
  // Docentes
  { id: "professor-ebtt", rotulo: "Professor do Ensino Básico, Técnico e Tecnológico", categoria: "docente" },
  { id: "professor-ebtt-substituto", rotulo: "Professor substituto (EBTT)", categoria: "docente" },
  { id: "professor-ebtt-visitante", rotulo: "Professor visitante (EBTT)", categoria: "docente" },
  { id: "professor-magisterio-superior", rotulo: "Professor do Magistério Superior", categoria: "docente" },
  { id: "professor-ensino-basico-federal", rotulo: "Professor do Ensino Básico Federal", categoria: "docente" },
  // Técnico-administrativos (PCCTAE)
  { id: "administrador", rotulo: "Administrador", categoria: "tecnico-administrativo" },
  { id: "analista-ti", rotulo: "Analista de Tecnologia da Informação", categoria: "tecnico-administrativo" },
  { id: "arquiteto-urbanista", rotulo: "Arquiteto e Urbanista", categoria: "tecnico-administrativo" },
  { id: "arquivista", rotulo: "Arquivista", categoria: "tecnico-administrativo" },
  { id: "assistente-aluno", rotulo: "Assistente de Aluno", categoria: "tecnico-administrativo" },
  { id: "assistente-administracao", rotulo: "Assistente em Administração", categoria: "tecnico-administrativo" },
  { id: "assistente-social", rotulo: "Assistente Social", categoria: "tecnico-administrativo" },
  { id: "auditor", rotulo: "Auditor", categoria: "tecnico-administrativo" },
  { id: "auxiliar-administracao", rotulo: "Auxiliar em Administração", categoria: "tecnico-administrativo" },
  {
    id: "auxiliar-assuntos-educacionais",
    rotulo: "Auxiliar em Assuntos Educacionais",
    categoria: "tecnico-administrativo",
  },
  { id: "auxiliar-biblioteca", rotulo: "Auxiliar de Biblioteca", categoria: "tecnico-administrativo" },
  { id: "auxiliar-enfermagem", rotulo: "Auxiliar de Enfermagem", categoria: "tecnico-administrativo" },
  { id: "auxiliar-nutricao", rotulo: "Auxiliar de Nutrição e Dietética", categoria: "tecnico-administrativo" },
  { id: "bibliotecario", rotulo: "Bibliotecário-Documentalista", categoria: "tecnico-administrativo" },
  { id: "contador", rotulo: "Contador", categoria: "tecnico-administrativo" },
  { id: "cozinheiro", rotulo: "Cozinheiro", categoria: "tecnico-administrativo" },
  { id: "economista", rotulo: "Economista", categoria: "tecnico-administrativo" },
  { id: "enfermeiro", rotulo: "Enfermeiro", categoria: "tecnico-administrativo" },
  { id: "engenheiro", rotulo: "Engenheiro", categoria: "tecnico-administrativo" },
  { id: "engenheiro-agronomo", rotulo: "Engenheiro Agrônomo", categoria: "tecnico-administrativo" },
  {
    id: "engenheiro-seguranca-trabalho",
    rotulo: "Engenheiro de Segurança do Trabalho",
    categoria: "tecnico-administrativo",
  },
  { id: "estatistico", rotulo: "Estatístico", categoria: "tecnico-administrativo" },
  { id: "impressor", rotulo: "Impressor", categoria: "tecnico-administrativo" },
  { id: "jornalista", rotulo: "Jornalista", categoria: "tecnico-administrativo" },
  { id: "medico", rotulo: "Médico", categoria: "tecnico-administrativo" },
  { id: "medico-veterinario", rotulo: "Médico Veterinário", categoria: "tecnico-administrativo" },
  { id: "nutricionista", rotulo: "Nutricionista", categoria: "tecnico-administrativo" },
  { id: "pedagogo", rotulo: "Pedagogo", categoria: "tecnico-administrativo" },
  { id: "programador-visual", rotulo: "Programador Visual", categoria: "tecnico-administrativo" },
  { id: "psicologo", rotulo: "Psicólogo", categoria: "tecnico-administrativo" },
  { id: "relacoes-publicas", rotulo: "Relações Públicas", categoria: "tecnico-administrativo" },
  { id: "revisor-textos", rotulo: "Revisor de Textos", categoria: "tecnico-administrativo" },
  { id: "secretario-executivo", rotulo: "Secretário Executivo", categoria: "tecnico-administrativo" },
  { id: "tecnico-agropecuaria", rotulo: "Técnico em Agropecuária", categoria: "tecnico-administrativo" },
  { id: "tecnico-arquivo", rotulo: "Técnico em Arquivo", categoria: "tecnico-administrativo" },
  {
    id: "tecnico-assuntos-educacionais",
    rotulo: "Técnico em Assuntos Educacionais",
    categoria: "tecnico-administrativo",
  },
  { id: "tecnico-audiovisual", rotulo: "Técnico em Audiovisual", categoria: "tecnico-administrativo" },
  { id: "tecnico-contabilidade", rotulo: "Técnico em Contabilidade", categoria: "tecnico-administrativo" },
  { id: "tecnico-enfermagem", rotulo: "Técnico em Enfermagem", categoria: "tecnico-administrativo" },
  { id: "tecnico-laboratorio", rotulo: "Técnico de Laboratório", categoria: "tecnico-administrativo" },
  { id: "tecnico-radiologia", rotulo: "Técnico em Radiologia", categoria: "tecnico-administrativo" },
  { id: "tecnico-secretariado", rotulo: "Técnico em Secretariado", categoria: "tecnico-administrativo" },
  { id: "tecnico-seguranca-trabalho", rotulo: "Técnico em Segurança do Trabalho", categoria: "tecnico-administrativo" },
  { id: "tecnico-ti", rotulo: "Técnico de Tecnologia da Informação", categoria: "tecnico-administrativo" },
  { id: "tecnologo", rotulo: "Tecnólogo", categoria: "tecnico-administrativo" },
  { id: "telefonista", rotulo: "Telefonista", categoria: "tecnico-administrativo" },
  {
    id: "tradutor-interprete-libras",
    rotulo: "Tradutor e Intérprete de Linguagem de Sinais",
    categoria: "tecnico-administrativo",
  },
] as const satisfies ReadonlyArray<DescricaoCargo>;

/** O cargo fora da lista, em qualquer categoria. */
export const OUTRO_CARGO = "outro";

export const CARGOS = [...LISTA_CARGOS.map((cargo) => cargo.id), OUTRO_CARGO] as const;

export const CargoPerfil = Schema.Literals(CARGOS);
export type CargoPerfil = typeof CargoPerfil.Type;

/** Os cargos de uma categoria, em ordem de nome, sem o "Outro cargo". */
export function cargosDaCategoria(categoria: CategoriaPerfil): ReadonlyArray<DescricaoCargo> {
  return LISTA_CARGOS.filter((cargo) => cargo.categoria === categoria).sort((a, b) =>
    a.rotulo.localeCompare(b.rotulo, "pt-BR"),
  );
}

export function rotuloCargo(cargo: CargoPerfil): string {
  return LISTA_CARGOS.find((descricao) => descricao.id === cargo)?.rotulo ?? "Outro cargo";
}

/**
 * As funções de gestão a que o app dá apoio próprio. A lista não esgota as funções do IFPR: quem
 * ocupa outra, ou nenhuma, marca "Nenhuma das opções" (sem `funcao`).
 */
export const FUNCOES = ["coordenacao-curso", "coordenacao-ensino", "direcao-ensino"] as const;

export const FuncaoPerfil = Schema.Literals(FUNCOES);
export type FuncaoPerfil = typeof FuncaoPerfil.Type;

export const ROTULOS_FUNCAO: Readonly<Record<FuncaoPerfil, string>> = {
  "coordenacao-curso": "Coordenação de Curso",
  "coordenacao-ensino": "Coordenação de Ensino",
  "direcao-ensino": "Direção de Ensino",
};

/**
 * As pró-reitorias, que o SUAP lista no filtro "Campus" ao lado dos campi.
 */
export const PRO_REITORIAS = [
  { id: "proad", nome: "Pró-Reitoria de Administração (PROAD)" },
  { id: "proens", nome: "Pró-Reitoria de Ensino (PROENS)" },
  { id: "proeppi", nome: "Pró-Reitoria de Extensão, Pesquisa, Pós-Graduação e Inovação (PROEPPI)" },
  { id: "progepe", nome: "Pró-Reitoria de Gestão de Pessoas (PROGEPE)" },
  { id: "proplan", nome: "Pró-Reitoria de Planejamento e Desenvolvimento Institucional (PROPLAN)" },
] as const;

export const ehProReitoria = (id: string): boolean => PRO_REITORIAS.some((unidade) => unidade.id === id);

/** Os cargos cujo trabalho é pedagógico: o público `pedagogia` dos manifestos. */
const CARGOS_PEDAGOGIA: ReadonlyArray<CargoPerfil> = ["pedagogo", "tecnico-assuntos-educacionais"];

/**
 * Os públicos de manifesto que servem à pessoa: a docência pela categoria, a pedagogia pelo cargo, as
 * coordenações e a direção de ensino pela função, a PROENS (e a DENS, diretoria dela) pela unidade.
 * Vazio sem nada disso (nada se filtra).
 */
export function publicosDoPerfil(perfil: Perfil | undefined): ReadonlyArray<Publico> {
  if (perfil === undefined) return [];
  const publicos: Array<Publico> = [];
  if (perfil.funcao !== undefined) publicos.push(perfil.funcao);
  if (perfil.cargo !== undefined && CARGOS_PEDAGOGIA.includes(perfil.cargo)) publicos.push("pedagogia");
  if (perfil.categoria === "docente") publicos.push("docente");
  if (perfil.campus?.id === "proens") publicos.push("proens", "dens");
  return publicos;
}

const Texto = (maximo: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(maximo));

/** Um campus ou uma pró-reitoria: o ID (o de `sobreABase` ou de `PRO_REITORIAS`) e o nome mostrado. */
export const ItemPerfil = Schema.Struct({ id: Texto(200), nome: Texto(300) });
export type ItemPerfil = typeof ItemPerfil.Type;

export const Perfil = Schema.Struct({
  /** O campus ou a pró-reitoria. */
  campus: Schema.optionalKey(ItemPerfil),
  categoria: Schema.optionalKey(CategoriaPerfil),
  cargo: Schema.optionalKey(CargoPerfil),
  funcao: Schema.optionalKey(FuncaoPerfil),
});
export type Perfil = typeof Perfil.Type;

/** O que o servidor local guarda do primeiro uso. As datas são ISO 8601. */
export const Preferencias = Schema.Struct({
  perfil: Schema.optionalKey(Perfil),
  /** Quando a pessoa clicou "Entendi" no aviso de uso. */
  avisoAceitoEm: Schema.optionalKey(Schema.String),
  /** Quando as boas-vindas terminaram (concluídas ou puladas). */
  boasVindasEm: Schema.optionalKey(Schema.String),
  /** As IAs que a pessoa deixou de usar no app (Configurações › Sua IA › "Não usar no app"). */
  iasDesligadas: Schema.Array(Provider),
});
export type Preferencias = typeof Preferencias.Type;

/**
 * A pessoa ainda não aceitou o aviso de uso (`preferencias.aceitarAviso`): o servidor não manda nada à
 * IA antes disso (conversa, revisão com IA, ações com IA da lista de pendências).
 */
export class AvisoNaoAceito extends Schema.TaggedError<AvisoNaoAceito>()("AvisoNaoAceito", {}) {
  override get message(): string {
    return 'Antes de usar a IA, leia o aviso de uso e clique em "Entendi" (Início ou Configurações › Sua IA).';
  }
}

const Vazio = Schema.Struct({});

export class GrupoPreferencias extends RpcGroup.make(
  Rpc.make("preferencias.ler", { payload: Vazio, success: Preferencias }),
  Rpc.make("preferencias.gravarPerfil", { payload: Schema.Struct({ perfil: Perfil }), success: Preferencias }),
  Rpc.make("preferencias.apagarPerfil", { payload: Vazio, success: Preferencias }),
  Rpc.make("preferencias.aceitarAviso", { payload: Vazio, success: Preferencias }),
  Rpc.make("preferencias.concluirBoasVindas", { payload: Vazio, success: Preferencias }),
  /** Volta a usar (`usar: true`) ou deixa de usar no app uma IA, sem sair da conta dela. */
  Rpc.make("preferencias.usarIa", {
    payload: Schema.Struct({ provider: Provider, usar: Schema.Boolean }),
    success: Preferencias,
  }),
) {}

/** "Coordenação de Curso · Campus Curitiba", "Pedagogo · PROENS", ou `undefined` sem nada disso. */
export function linhaDoPerfil(perfil: Perfil | undefined): string | undefined {
  const campus = perfil?.campus?.nome;
  const quem =
    perfil?.funcao !== undefined
      ? ROTULOS_FUNCAO[perfil.funcao]
      : perfil?.cargo !== undefined && perfil.cargo !== OUTRO_CARGO
        ? rotuloCargo(perfil.cargo)
        : perfil?.categoria === undefined
          ? undefined
          : ROTULOS_CATEGORIA[perfil.categoria];
  const sigla = campus === undefined ? undefined : /\(([A-Z]+)\)$/.exec(campus)?.[1];
  const onde =
    campus === undefined
      ? undefined
      : perfil?.campus !== undefined && ehProReitoria(perfil.campus.id) && sigla !== undefined
        ? sigla
        : /^(campus|reitoria)\b/i.test(campus)
          ? campus
          : `Campus ${campus}`;
  return [quem, onde].filter((parte): parte is string => parte !== undefined).join(" · ") || undefined;
}
