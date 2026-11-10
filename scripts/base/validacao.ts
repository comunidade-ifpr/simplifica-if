/** Validação da base pública de conhecimento (antigo scripts/validar_base.py). */
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { type CaminhosBase, naBase, relativo } from "./caminhos.ts";
import {
  analisarFrontMatter,
  arquivosNormas,
  CAMPOS_MANIFEST,
  CAMPOS_OBRIGATORIOS,
  DIRETORIOS_POR_TIPO,
  ErroFrontMatter,
  type FrontMatter,
} from "./front-matter.ts";
import {
  conjuntosIguais,
  ehArquivo,
  ehInteiro,
  ehObjeto,
  ErroDecodificacao,
  glob,
  iguais,
  iterar,
  lerTexto,
  linhasDeArquivo,
  lstrip,
  obter,
  type ObjetoJson,
  ordenarCaminhos,
  ordenarTextos,
  repr,
  RE_TEM_ESPACO,
  rglob,
  str,
  strip,
  tamanho,
  tem,
  urlsplit,
} from "./python.ts";
import { validarJsonSchema } from "./schema.ts";

export const PADROES_LOCAIS = ["/" + "Users/", "Down" + "loads/", "file" + "://"];
const DIRETORIOS_IGNORADOS_PADROES_LOCAIS = new Set([".git", ".venv", "skills"]);
const ARTEFATOS_CONVERSAO_PPC: Array<[string, RegExp]> = [
  ["placeholder de imagem omitida", /picture \[[0-9]+ x [0-9]+\] intentionally omitted/],
  ["marcador de início/fim de texto de imagem", /Start of picture text|End of picture text/],
  [
    "OCR residual isolado",
    /^[\t\n\v\f\r \x1c-\x1f\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*eme<br>[\t\n\v\f\r \x1c-\x1f\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/m,
  ],
  ["rodapé PROENS de conversão", /INSTITUTO FEDERAL DO PARANÁ[^\n]*Pró-Reitoria de Ensino - \*\*PROENS\*\*/],
];
const RE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RE_DATA_NO_INICIO = /^\p{Nd}{4}-\p{Nd}{2}-\p{Nd}{2}_/u;
const RE_ALIAS_COM_ANO = /[_-]\p{Nd}{4}[^\n]*\.md(?=\n?$)/u;
export const CAMPOS_CURSO_CNCT = [
  "id",
  "indice",
  "denominacao",
  "denominacao_normalizada",
  "eixo_tecnologico",
  "area_tecnologica",
  "carga_horaria_minima_horas",
  "descricao_carga_horaria_minima",
  "perfil_profissional",
  "pre_requisitos_ingresso",
  "itinerarios_formativos",
  "campo_atuacao",
  "ocupacoes_cbo",
  "codigos_cbo",
  "infraestrutura_minima",
  "legislacao_profissional",
];
const TIPOS_SECAO_PPC_INDEXADOS = new Set([
  "identificacao",
  "justificativa",
  "objetivos",
  "perfil_egresso",
  "concepcao_pedagogica",
  "organizacao_curricular",
  "matriz_curricular",
  "ementas",
  "avaliacao",
  "estagio_praticas",
  "infraestrutura",
  "corpo_docente",
  "referencias",
]);
const LIMITE_PREVIEW_SECAO_PPC = 500;

type Resultado<T> = [T | null, string[]];

/** Contexto com os caminhos da base e `relative()` já ligado. */
class Validador {
  constructor(readonly c: CaminhosBase) {}

  rel(caminho: string): string {
    return relativo(this.c, caminho);
  }

  carregarJson(caminho: string, rotulo: string): Resultado<unknown> {
    let texto: string;
    try {
      texto = lerTexto(caminho);
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code === "ENOENT")
        return [null, [`${rotulo} não encontrado: ${this.rel(caminho)}`]];
      return [null, [`${rotulo} inválido: ${(erro as Error).message}`]];
    }
    try {
      return [JSON.parse(texto), []];
    } catch (erro) {
      return [null, [`${rotulo} inválido: ${(erro as Error).message}`]];
    }
  }

  validarComSchema(dados: unknown, caminhoSchema: string, rotulo: string): string[] {
    const [schema, erros] = this.carregarJson(caminhoSchema, `schema ${this.rel(caminhoSchema)}`);
    if (erros.length) return erros;
    if (!ehObjeto(schema)) return [`schema ${this.rel(caminhoSchema)} deve conter um objeto JSON`];
    return validarJsonSchema(dados, schema, rotulo);
  }

  validarLinks(caminho: string, texto: string): string[] {
    const erros: string[] = [];
    for (const casamento of texto.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const alvo = casamento[1]!;
      if (["http://", "https://", "#", "mailto:"].some((prefixo) => alvo.startsWith(prefixo))) continue;
      if (alvo.startsWith("/")) {
        erros.push(`${this.rel(caminho)}: link absoluto local ou de raiz: ${alvo}`);
        continue;
      }
      const limpo = alvo.split("#", 1)[0]!;
      if (limpo && !existsSync(path.resolve(path.dirname(caminho), limpo))) {
        erros.push(`${this.rel(caminho)}: link interno inexistente: ${alvo}`);
      }
    }
    return erros;
  }

  validarMarkdown(caminho: string): string[] {
    const erros: string[] = [];
    const texto = lerTexto(caminho);
    for (const padrao of PADROES_LOCAIS) {
      if (texto.includes(padrao)) erros.push(`${this.rel(caminho)}: contém padrão local proibido: ${padrao}`);
    }

    let meta: FrontMatter;
    let corpo: string;
    try {
      ({ meta, corpo } = analisarFrontMatter(texto, this.rel(caminho)));
    } catch (erro) {
      if (erro instanceof ErroFrontMatter) return [erro.message];
      throw erro;
    }

    const ausentes = ordenarTextos(CAMPOS_OBRIGATORIOS.filter((campo) => !(campo in meta)));
    if (ausentes.length) erros.push(`${this.rel(caminho)}: campos obrigatórios ausentes: ${ausentes.join(", ")}`);
    if (!lstrip(corpo).startsWith("## Resumo")) erros.push(`${this.rel(caminho)}: corpo não começa com ## Resumo`);
    const keywords = meta.keywords;
    if (!Array.isArray(keywords) || !keywords.length)
      erros.push(`${this.rel(caminho)}: keywords deve ser lista não vazia`);
    for (const alias of iterar("aliases" in meta ? meta.aliases : [])) {
      if (aliasPareceNomeAntigo(alias))
        erros.push(`${this.rel(caminho)}: alias parece nome antigo de arquivo: ${str(alias)}`);
    }

    erros.push(...this.validarLinks(caminho, texto));
    return erros;
  }

  validarArtefatosConversaoPpc(): string[] {
    const erros: string[] = [];
    for (const caminho of ordenarCaminhos(glob(this.c.ppcs, "*/*.md"))) {
      const texto = lerTexto(caminho, { ignorarErros: true });
      for (const [rotulo, padrao] of ARTEFATOS_CONVERSAO_PPC) {
        if (padrao.test(texto)) erros.push(`${this.rel(caminho)}: contém artefato de conversão: ${rotulo}`);
      }
    }
    return erros;
  }

  validarItemManifest(item: ObjetoJson): string[] {
    const erros: string[] = [];
    const valorPath = obter(item, "path");
    if (typeof valorPath !== "string") return ["manifest.json: item sem path textual"];

    const caminho = naBase(this.c, valorPath);
    if (!existsSync(caminho)) return [`manifest.json aponta para arquivo inexistente: ${valorPath}`];

    if (RE_DATA_NO_INICIO.test(path.basename(caminho)))
      erros.push(`${valorPath}: nome do arquivo não deve começar com data`);

    const jurisdicao = str(obter(item, "jurisdicao"));
    const tipo = str(obter(item, "tipo_documento"));
    const diretorioEsperado = DIRETORIOS_POR_TIPO[`${jurisdicao}|${tipo}`];
    if (diretorioEsperado === undefined) {
      erros.push(
        `manifest.json: item com jurisdição/tipo sem diretório configurado: (${repr(jurisdicao)}, ${repr(tipo)})`,
      );
    } else if (this.rel(path.dirname(caminho)) !== diretorioEsperado) {
      erros.push(`${valorPath}: deveria estar em ${diretorioEsperado}`);
    }

    let meta: FrontMatter;
    try {
      ({ meta } = analisarFrontMatter(lerTexto(caminho), this.rel(caminho)));
    } catch (erro) {
      if (!(erro instanceof ErroFrontMatter)) throw erro;
      erros.push(erro.message);
      return erros;
    }

    for (const campo of CAMPOS_MANIFEST) {
      const valorMeta = campo in meta ? meta[campo] : null;
      if (!iguais(comparavel(campo, obter(item, campo)), comparavel(campo, valorMeta))) {
        erros.push(`${valorPath}: manifest.json diverge do front matter no campo ${campo}`);
      }
    }
    return erros;
  }

  validarPadroesLocais(): string[] {
    const erros: string[] = [];
    for (const caminho of rglob(this.c.raiz, "*")) {
      const partes = this.rel(caminho).split(path.sep);
      if (partes.some((parte) => DIRETORIOS_IGNORADOS_PADROES_LOCAIS.has(parte)) || !ehArquivo(caminho)) continue;
      let texto: string;
      try {
        texto = lerTexto(caminho);
      } catch (erro) {
        if (erro instanceof ErroDecodificacao) continue;
        throw erro;
      }
      for (const padrao of PADROES_LOCAIS) {
        if (texto.includes(padrao)) erros.push(`${this.rel(caminho)} contém padrão local proibido: ${padrao}`);
      }
    }
    return erros;
  }

  carregarManifest(): Resultado<unknown[]> {
    let dados: unknown;
    try {
      dados = JSON.parse(lerTexto(this.c.manifest));
    } catch (erro) {
      return [[], [`manifest.json inválido: ${(erro as Error).message}`]];
    }
    if (!Array.isArray(dados)) return [[], ["manifest.json deve conter uma lista"]];
    return [dados, []];
  }

  validarUrlHttps(valor: unknown, campo: string): string[] {
    if (typeof valor !== "string" || !valor) return [`${campo} deve ser URL textual não vazia`];
    const partes = urlsplit(valor);
    if (partes.scheme !== "https" || !partes.netloc || RE_TEM_ESPACO.test(valor)) {
      return [`${campo} deve ser URL HTTPS absoluta válida`];
    }
    return [];
  }

  validarArquivoCampus(caminho: string, itemIndice: ObjetoJson): string[] {
    const r = this.rel(caminho);
    const [dados, errosJson] = this.carregarJson(caminho, `arquivo de campus ${r}`);
    if (errosJson.length) return errosJson;
    if (!ehObjeto(dados)) return [`${r} deve conter um objeto JSON`];
    const erros = this.validarComSchema(dados, this.c.schemas.campus, r);

    for (const campo of ["id", "nome", "links", "cursos"]) {
      if (!tem(dados, campo)) erros.push(`${r}: campo obrigatório ausente: ${campo}`);
    }

    const campusId = obter(dados, "id");
    if (typeof campusId !== "string" || !RE_SLUG.test(campusId)) erros.push(`${r}: id deve ser slug ASCII minúsculo`);
    else if (path.basename(caminho) !== `${campusId}.json`) erros.push(`${r}: nome do arquivo diverge do id`);

    for (const campo of ["id", "nome"]) {
      if (!iguais(obter(dados, campo), obter(itemIndice, campo)))
        erros.push(`${r}: campo ${campo} diverge do index.json`);
    }

    const links = obter(dados, "links");
    if (!ehObjeto(links)) {
      erros.push(`${r}: links deve ser objeto`);
    } else {
      for (const campo of ["site", "calendario_academico"]) {
        if (!tem(links, campo)) erros.push(`${r}: links.${campo} ausente`);
        else erros.push(...this.validarUrlHttps(links[campo], `${r}: links.${campo}`));
      }
    }

    const cursos = obter(dados, "cursos");
    if (!Array.isArray(cursos)) {
      erros.push(`${r}: cursos deve ser array`);
    } else {
      const slugsVistos = new Set<string>();
      for (const curso of cursos) {
        if (!ehObjeto(curso)) continue;
        const cursoSlug = obter(curso, "curso_slug");
        if (typeof cursoSlug === "string") {
          if (slugsVistos.has(cursoSlug)) erros.push(`${r}: curso duplicado: ${cursoSlug}`);
          slugsVistos.add(cursoSlug);
        }
        if (tem(curso, "url")) erros.push(...this.validarUrlHttps(curso.url, `${r}: cursos[].url`));
        if (tem(curso, "ppc_url")) erros.push(`${r}: cursos[].ppc_url foi substituído por cursos[].ppc.url`);
        const ppc = obter(curso, "ppc");
        if (ppc === null) continue;
        if (!ehObjeto(ppc)) {
          erros.push(`${r}: cursos[].ppc deve ser objeto`);
          continue;
        }
        erros.push(...this.validarUrlHttps(obter(ppc, "url"), `${r}: cursos[].ppc.url`));

        const caminhoMarkdown = obter(ppc, "markdown_path");
        const conversao = obter(ppc, "conversao");
        const statusConversao = ehObjeto(conversao) ? obter(conversao, "status") : "";
        if (statusConversao === "convertido" && typeof caminhoMarkdown !== "string") {
          erros.push(`${r}: cursos[].ppc.markdown_path deve ser texto quando conversao.status=convertido`);
        } else if (
          typeof caminhoMarkdown === "string" &&
          (!caminhoMarkdown.startsWith("institucional/ifpr/ppcs/") || !caminhoMarkdown.endsWith(".md"))
        ) {
          erros.push(`${r}: cursos[].ppc.markdown_path deve apontar para institucional/ifpr/ppcs/*.md`);
        } else if (typeof campusId === "string" && typeof cursoSlug === "string") {
          const esperado = `institucional/ifpr/ppcs/${campusId}/${cursoSlug}.md`;
          if (typeof caminhoMarkdown === "string" && caminhoMarkdown !== esperado) {
            erros.push(`${r}: cursos[].ppc.markdown_path esperado para ${cursoSlug}: ${esperado}`);
          }
        }

        if (!ehObjeto(conversao)) {
          erros.push(`${r}: cursos[].ppc.conversao deve ser objeto`);
        } else if (obter(conversao, "status") === "convertido") {
          if (typeof caminhoMarkdown === "string" && !existsSync(naBase(this.c, caminhoMarkdown))) {
            erros.push(`${r}: markdown convertido inexistente: ${caminhoMarkdown}`);
          }
        }

        const metadados = obter(ppc, "metadados");
        if (ehObjeto(metadados)) {
          const vagas = obter(metadados, "vagas");
          if (vagas !== null && !ehObjeto(vagas))
            erros.push(`${r}: cursos[].ppc.metadados.vagas deve ser objeto contextual`);
        }
      }
    }

    const programas = obter(dados, "programas", []);
    if (!Array.isArray(programas)) {
      erros.push(`${r}: programas deve ser array`);
    } else {
      const programasVistos = new Set<string>();
      for (const programa of programas) {
        if (!ehObjeto(programa)) continue;
        const programaId = obter(programa, "id");
        if (typeof programaId === "string") {
          if (programasVistos.has(programaId)) erros.push(`${r}: programa duplicado: ${programaId}`);
          programasVistos.add(programaId);
        }
        if (tem(programa, "url")) erros.push(...this.validarUrlHttps(programa.url, `${r}: programas[].url`));

        const ofertas = obter(programa, "ofertas");
        if (!Array.isArray(ofertas)) {
          erros.push(`${r}: programas[].ofertas deve ser array`);
          continue;
        }
        const ofertasVistas = new Set<string>();
        for (const oferta of ofertas) {
          if (!ehObjeto(oferta)) continue;
          const ofertaId = obter(oferta, "id");
          if (typeof ofertaId === "string") {
            if (ofertasVistas.has(ofertaId))
              erros.push(`${r}: oferta duplicada em programa ${str(programaId)}: ${ofertaId}`);
            ofertasVistas.add(ofertaId);
          }
          if (tem(oferta, "url")) erros.push(...this.validarUrlHttps(oferta.url, `${r}: programas[].ofertas[].url`));
        }
      }
    }
    return erros;
  }

  colecao(manifest: unknown, chaveLista: string, id: string): ObjetoJson | null | undefined {
    if (!ehObjeto(manifest)) return undefined;
    const lista = obter(manifest, chaveLista);
    if (!Array.isArray(lista)) return undefined;
    return (lista.find((item) => ehObjeto(item) && obter(item, "id") === id) as ObjetoJson | undefined) ?? null;
  }

  arquivosCampi(): string[] {
    return ordenarCaminhos(glob(this.c.campi, "*.json").filter((caminho) => path.basename(caminho) !== "index.json"));
  }

  validarInstitucional(): string[] {
    const erros: string[] = [];
    const [manifest, errosManifest] = this.carregarJson(this.c.manifestInstitucional, "institucional_manifest.json");
    erros.push(...errosManifest);
    const [indice, errosIndice] = this.carregarJson(this.c.indiceCampi, "índice de campi");
    erros.push(...errosIndice);
    if (erros.length) return erros;

    if (!ehObjeto(manifest)) {
      erros.push("institucional_manifest.json deve conter um objeto JSON");
    } else {
      erros.push(
        ...this.validarComSchema(manifest, this.c.schemas.manifestInstitucional, "institucional_manifest.json"),
      );
      const colecoes = obter(manifest, "colecoes");
      if (!Array.isArray(colecoes) || !colecoes.length) {
        erros.push("institucional_manifest.json: colecoes deve ser lista não vazia");
      } else {
        const campi = this.colecao(manifest, "colecoes", "campi-ifpr");
        if (!campi) erros.push("institucional_manifest.json: coleção campi-ifpr ausente");
        else if (!iguais(obter(campi, "path"), this.rel(this.c.indiceCampi))) {
          erros.push("institucional_manifest.json: path da coleção campi-ifpr diverge do índice");
        }
        const verificarPath = (id: string, caminho: string) => {
          const colecao = this.colecao(manifest, "colecoes", id);
          if (colecao && !iguais(obter(colecao, "path"), this.rel(caminho))) {
            erros.push(`institucional_manifest.json: path da coleção ${id} diverge do índice`);
          }
        };
        verificarPath("processos-seletivos-ifpr", this.c.indiceProcessosSeletivos);
        verificarPath("ppcs-ifpr", this.c.indicePpcs);
        verificarPath("ppcps-rede-certifica-ifpr", this.c.indicePpcps);
      }
    }

    const rIndice = this.rel(this.c.indiceCampi);
    if (!ehObjeto(indice)) {
      erros.push(`${rIndice} deve conter um objeto JSON`);
      return erros;
    }
    erros.push(...this.validarComSchema(indice, this.c.schemas.indiceCampi, rIndice));

    const itens = obter(indice, "items");
    if (!Array.isArray(itens) || !itens.length) {
      erros.push(`${rIndice}: items deve ser lista não vazia`);
      return erros;
    }

    const campi = this.colecao(manifest, "colecoes", "campi-ifpr");
    if (campi && !iguais(obter(campi, "total_itens"), itens.length)) {
      erros.push("institucional_manifest.json: total_itens diverge do index.json");
    }

    const idsVistos = new Set<string>();
    const pathsIndice = new Set<string>();
    for (const item of itens) {
      if (!ehObjeto(item)) {
        erros.push(`${rIndice}: item deve ser objeto`);
        continue;
      }
      const campusId = obter(item, "id");
      const valorPath = obter(item, "path");
      if (typeof campusId !== "string" || !RE_SLUG.test(campusId))
        erros.push(`${rIndice}: id inválido: ${str(campusId)}`);
      else if (idsVistos.has(campusId)) erros.push(`${rIndice}: id duplicado: ${campusId}`);
      else idsVistos.add(campusId);
      const nome = obter(item, "nome");
      if (typeof nome !== "string" || !nome) erros.push(`${rIndice}: nome ausente em ${str(campusId)}`);
      if (typeof valorPath !== "string") {
        erros.push(`${rIndice}: path ausente em ${str(campusId)}`);
        continue;
      }
      if (!valorPath.startsWith("institucional/ifpr/campi/") || !valorPath.endsWith(".json")) {
        erros.push(`${rIndice}: path inválido em ${str(campusId)}: ${valorPath}`);
        continue;
      }
      pathsIndice.add(valorPath);
      erros.push(...this.validarArquivoCampus(naBase(this.c, valorPath), item));
    }

    const pathsCampi = new Set(this.arquivosCampi().map((caminho) => this.rel(caminho)));
    if (!conjuntosIguais(pathsIndice, pathsCampi)) {
      erros.push(
        `index.json não cobre exatamente os arquivos de campi: index=${repr(ordenarTextos(pathsIndice))} arquivos=${repr(ordenarTextos(pathsCampi))}`,
      );
    }

    erros.push(...this.validarPpcs(manifest));
    erros.push(...this.validarPpcps(manifest));
    erros.push(...this.validarProcessosSeletivos(manifest));
    return erros;
  }

  /** Campus JSON legíveis com `id` textual, em ordem de caminho. */
  *campiLegiveis(): Generator<[string, ObjetoJson]> {
    for (const caminho of this.arquivosCampi()) {
      const [dados, erros] = this.carregarJson(caminho, `campus ${this.rel(caminho)}`);
      if (erros.length || !ehObjeto(dados)) continue;
      const campusId = obter(dados, "id");
      if (typeof campusId !== "string") continue;
      yield [campusId, dados];
    }
  }

  ppcsConvertidosDosCampi(): Map<string, string> {
    const ppcs = new Map<string, string>();
    for (const [campusId, dados] of this.campiLegiveis()) {
      for (const curso of iterar(obter(dados, "cursos", []))) {
        if (!ehObjeto(curso)) continue;
        const cursoSlug = obter(curso, "curso_slug");
        const ppc = obter(curso, "ppc");
        if (typeof cursoSlug !== "string" || !ehObjeto(ppc)) continue;
        const conversao = obter(ppc, "conversao");
        const caminhoMarkdown = obter(ppc, "markdown_path");
        if (
          ehObjeto(conversao) &&
          obter(conversao, "status") === "convertido" &&
          typeof caminhoMarkdown === "string" &&
          existsSync(naBase(this.c, caminhoMarkdown))
        ) {
          ppcs.set(`${campusId}/${cursoSlug}`, caminhoMarkdown);
        }
      }
    }
    return ppcs;
  }

  cursosPorCampus(): Map<string, Set<string>> {
    const cursosPorCampus = new Map<string, Set<string>>();
    for (const [campusId, dados] of this.campiLegiveis()) {
      const cursos = new Set<string>();
      for (const curso of iterar(obter(dados, "cursos", []))) {
        if (!ehObjeto(curso)) continue;
        const cursoSlug = obter(curso, "curso_slug");
        if (typeof cursoSlug === "string") cursos.add(cursoSlug);
      }
      cursosPorCampus.set(campusId, cursos);
    }
    return cursosPorCampus;
  }

  validarSecoesPpc(itensIndicePorId: Map<string, ObjetoJson>): string[] {
    const raizSecoes = this.c.secoesPpcs;
    const rSecoes = this.rel(raizSecoes);
    let ehDiretorio = false;
    try {
      ehDiretorio = statSync(raizSecoes).isDirectory();
    } catch {}
    if (!ehDiretorio) return [`${rSecoes} não encontrado`];

    const erros: string[] = [];
    const obrigatorios = [
      "id",
      "ppc_id",
      "campus_id",
      "curso_slug",
      "curso_nome",
      "section_kind",
      "heading",
      "path",
      "preview",
    ];
    const idsVistos = new Set<string>();
    const arquivosEsperados = new Set([...TIPOS_SECAO_PPC_INDEXADOS].map((tipo) => `${tipo}.jsonl`));
    const arquivos = glob(raizSecoes, "*.jsonl");
    const arquivosAtuais = new Set(arquivos.map((caminho) => path.basename(caminho)));
    for (const nome of ordenarTextos([...arquivosEsperados].filter((nome) => !arquivosAtuais.has(nome)))) {
      erros.push(`${this.rel(path.join(raizSecoes, nome))} não encontrado`);
    }
    for (const nome of ordenarTextos([...arquivosAtuais].filter((nome) => !arquivosEsperados.has(nome)))) {
      erros.push(`${this.rel(path.join(raizSecoes, nome))} não esperado`);
    }

    for (const caminho of ordenarCaminhos(arquivos)) {
      const tipoEsperado = path.basename(caminho).replace(/\.[^.]*$/, "");
      const r = this.rel(caminho);
      linhasDeArquivo(lerTexto(caminho)).forEach((linhaBruta, indice) => {
        const n = indice + 1;
        const linha = strip(linhaBruta);
        if (!linha) {
          erros.push(`${r}:${n}: linha vazia`);
          return;
        }
        let item: unknown;
        try {
          item = JSON.parse(linha);
        } catch (erro) {
          erros.push(`${r}:${n}: JSON inválido: ${(erro as Error).message}`);
          return;
        }
        if (!ehObjeto(item)) {
          erros.push(`${r}:${n}: item deve ser objeto`);
          return;
        }
        const ausentes = ordenarTextos(obrigatorios.filter((campo) => !tem(item, campo)));
        if (ausentes.length) {
          erros.push(`${r}:${n}: campos ausentes: ${ausentes.join(", ")}`);
          return;
        }
        const secaoId = obter(item, "id");
        const ppcId = obter(item, "ppc_id");
        if (typeof secaoId !== "string" || typeof ppcId !== "string") {
          erros.push(`${r}:${n}: id e ppc_id devem ser texto`);
          return;
        }
        if (idsVistos.has(secaoId)) erros.push(`${r}:${n}: id duplicado: ${secaoId}`);
        idsVistos.add(secaoId);
        if (!secaoId.startsWith(`${ppcId}#`)) erros.push(`${r}:${n}: id não deriva de ppc_id: ${secaoId}`);
        const itemPpc = itensIndicePorId.get(ppcId);
        if (itemPpc === undefined) {
          erros.push(`${r}:${n}: ppc_id inexistente no índice: ${ppcId}`);
          return;
        }
        for (const campo of ["campus_id", "curso_slug", "curso_nome", "path"]) {
          if (!iguais(obter(item, campo), obter(itemPpc, campo)))
            erros.push(`${r}:${n}: campo ${campo} diverge do índice para ${ppcId}`);
        }
        const tipo = obter(item, "section_kind");
        if (typeof tipo !== "string" || !TIPOS_SECAO_PPC_INDEXADOS.has(tipo))
          erros.push(`${r}:${n}: section_kind inválido: ${str(tipo)}`);
        else if (tipo !== tipoEsperado) erros.push(`${r}:${n}: section_kind diverge do arquivo: ${tipo}`);
        for (const campo of ["heading", "preview"]) {
          const valor = obter(item, campo);
          if (typeof valor !== "string" || !strip(valor)) erros.push(`${r}:${n}: ${campo} deve ser texto não vazio`);
        }
        const preview = obter(item, "preview");
        if (typeof preview === "string" && tamanho(preview) > LIMITE_PREVIEW_SECAO_PPC) {
          erros.push(`${r}:${n}: preview excede ${LIMITE_PREVIEW_SECAO_PPC} caracteres`);
        }
      });
    }

    const legado = path.join(path.dirname(raizSecoes), "secoes.jsonl");
    if (existsSync(legado)) {
      erros.push(`${this.rel(legado)} não deve mais ser versionado; use arquivos por seção em ${rSecoes}`);
    }
    if (!idsVistos.size) erros.push(`${rSecoes}: deve conter ao menos uma seção`);
    return erros;
  }

  validarPpcs(manifest: unknown): string[] {
    const rIndice = this.rel(this.c.indicePpcs);
    const [indice, errosIndice] = this.carregarJson(this.c.indicePpcs, "índice de PPCs");
    if (errosIndice.length) return errosIndice;
    if (!ehObjeto(indice)) return [`${rIndice} deve conter um objeto JSON`];

    const erros = this.validarComSchema(indice, this.c.schemas.indicePpcs, rIndice);
    const secoes = obter(indice, "secoes");
    if (!ehObjeto(secoes)) {
      erros.push(`${rIndice}: secoes deve ser objeto`);
    } else {
      if (!iguais(obter(secoes, "preview_limite"), LIMITE_PREVIEW_SECAO_PPC)) {
        erros.push(`${rIndice}: secoes.preview_limite deve ser ${LIMITE_PREVIEW_SECAO_PPC}`);
      }
      const esperados = Object.fromEntries(
        [...TIPOS_SECAO_PPC_INDEXADOS].map((tipo) => [tipo, this.rel(path.join(this.c.secoesPpcs, `${tipo}.jsonl`))]),
      );
      if (!iguais(obter(secoes, "paths"), esperados))
        erros.push(`${rIndice}: secoes.paths diverge dos caminhos esperados`);
    }

    const itens = obter(indice, "items");
    if (!Array.isArray(itens) || !itens.length) {
      erros.push(`${rIndice}: items deve ser lista não vazia`);
      return erros;
    }
    if (!iguais(obter(indice, "total_itens"), itens.length)) erros.push(`${rIndice}: total_itens diverge de items`);

    const colecao = this.colecao(manifest, "colecoes", "ppcs-ifpr");
    if (colecao === null) erros.push("institucional_manifest.json: coleção ppcs-ifpr ausente");
    else if (colecao && !iguais(obter(colecao, "total_itens"), itens.length)) {
      erros.push("institucional_manifest.json: total_itens de ppcs-ifpr diverge do index.json");
    }

    const ppcsEsperados = this.ppcsConvertidosDosCampi();
    const idsVistos = new Set<string>();
    const itensPorId = new Map<string, ObjetoJson>();
    for (const item of itens) {
      if (!ehObjeto(item)) {
        erros.push(`${rIndice}: item deve ser objeto`);
        continue;
      }
      const ppcId = obter(item, "id");
      const campusId = obter(item, "campus_id");
      const cursoSlug = obter(item, "curso_slug");
      const valorPath = obter(item, "path");
      if (typeof ppcId !== "string") {
        erros.push(`${rIndice}: item sem id textual`);
        continue;
      }
      if (idsVistos.has(ppcId)) erros.push(`${rIndice}: id duplicado: ${ppcId}`);
      idsVistos.add(ppcId);
      itensPorId.set(ppcId, item);
      if (typeof campusId === "string" && typeof cursoSlug === "string" && ppcId !== `${campusId}/${cursoSlug}`) {
        erros.push(`${rIndice}: id diverge de campus_id/curso_slug: ${ppcId}`);
      }
      if (typeof valorPath !== "string") {
        erros.push(`${rIndice}: path ausente em ${ppcId}`);
        continue;
      }
      if (!existsSync(naBase(this.c, valorPath))) erros.push(`${rIndice}: path inexistente em ${ppcId}: ${valorPath}`);
      const esperado = ppcsEsperados.get(ppcId);
      if (esperado !== undefined && valorPath !== esperado) {
        erros.push(`${rIndice}: path diverge do campus JSON em ${ppcId}: ${valorPath}`);
      }
    }

    const idsEsperados = new Set(ppcsEsperados.keys());
    if (!conjuntosIguais(idsVistos, idsEsperados)) {
      erros.push(
        `índice de PPCs não cobre exatamente os PPCs convertidos dos campi: index=${repr(ordenarTextos(idsVistos))} campi=${repr(ordenarTextos(idsEsperados))}`,
      );
    }

    erros.push(...this.validarSecoesPpc(itensPorId));
    return erros;
  }

  validarPpcps(manifest: unknown): string[] {
    const rIndice = this.rel(this.c.indicePpcps);
    const [indice, errosIndice] = this.carregarJson(this.c.indicePpcps, "índice de PPCPs");
    const erros = [...errosIndice];
    if (!ehObjeto(indice)) return erros;

    erros.push(...this.validarComSchema(indice, this.c.schemas.indicePpcps, rIndice));
    const itens = obter(indice, "items");
    if (!Array.isArray(itens) || !itens.length) return erros;
    if (!iguais(obter(indice, "total_itens"), itens.length)) erros.push(`${rIndice}: total_itens diverge de items`);

    const colecao = this.colecao(manifest, "colecoes", "ppcps-rede-certifica-ifpr");
    if (colecao === null) erros.push("institucional_manifest.json: coleção ppcps-rede-certifica-ifpr ausente");
    else if (colecao && !iguais(obter(colecao, "total_itens"), itens.length)) {
      erros.push("institucional_manifest.json: total_itens de ppcps-rede-certifica-ifpr diverge do index.json");
    }

    const idsVistos = new Set<string>();
    const pathsIndice = new Set<string>();
    for (const item of itens) {
      if (!ehObjeto(item)) continue;
      const itemId = obter(item, "id");
      const valorPath = obter(item, "path");
      if (typeof itemId === "string") {
        if (idsVistos.has(itemId)) erros.push(`${rIndice}: id duplicado: ${itemId}`);
        idsVistos.add(itemId);
      }
      if (typeof valorPath !== "string") continue;
      if (pathsIndice.has(valorPath)) erros.push(`${rIndice}: path duplicado: ${valorPath}`);
      pathsIndice.add(valorPath);
      const caminho = naBase(this.c, valorPath);
      if (!existsSync(caminho)) {
        erros.push(`${rIndice}: path inexistente: ${valorPath}`);
        continue;
      }
      erros.push(...this.validarLinks(caminho, lerTexto(caminho)));
    }

    const pathsMarkdown = new Set(glob(this.c.ppcps, "*.md").map((caminho) => this.rel(caminho)));
    if (!conjuntosIguais(pathsIndice, pathsMarkdown)) {
      erros.push(
        `índice de PPCPs não cobre exatamente os Markdown da coleção: index=${repr(ordenarTextos(pathsIndice))} arquivos=${repr(ordenarTextos(pathsMarkdown))}`,
      );
    }
    return erros;
  }

  validarProcessosSeletivos(manifest: unknown): string[] {
    const cursosPorCampus = this.cursosPorCampus();
    const rIndice = this.rel(this.c.indiceProcessosSeletivos);
    const [indice, errosIndice] = this.carregarJson(this.c.indiceProcessosSeletivos, "índice de processos seletivos");
    if (errosIndice.length) return errosIndice;
    if (!ehObjeto(indice)) return [`${rIndice} deve conter um objeto JSON`];

    const erros = this.validarComSchema(indice, this.c.schemas.indiceProcessosSeletivos, rIndice);
    const itens = obter(indice, "items");
    if (!Array.isArray(itens) || !itens.length) {
      erros.push(`${rIndice}: items deve ser lista não vazia`);
      return erros;
    }

    const colecao = this.colecao(manifest, "colecoes", "processos-seletivos-ifpr");
    if (colecao && !iguais(obter(colecao, "total_itens"), itens.length)) {
      erros.push("institucional_manifest.json: total_itens de processos-seletivos-ifpr diverge do index.json");
    }
    if (!iguais(obter(indice, "total_itens"), itens.length)) erros.push(`${rIndice}: total_itens diverge de items`);

    const idsVistos = new Set<string>();
    const anosVistos = new Set<number>();
    const pathsIndice = new Set<string>();
    for (const item of itens) {
      if (!ehObjeto(item)) {
        erros.push(`${rIndice}: item deve ser objeto`);
        continue;
      }
      const processoId = obter(item, "id");
      const ano = obter(item, "ano_ingresso");
      const valorPath = obter(item, "path");
      if (typeof processoId !== "string" || !RE_SLUG.test(processoId))
        erros.push(`${rIndice}: id inválido: ${str(processoId)}`);
      else if (idsVistos.has(processoId)) erros.push(`${rIndice}: id duplicado: ${processoId}`);
      else idsVistos.add(processoId);
      if (ehInteiro(ano)) {
        if (anosVistos.has(Number(ano))) erros.push(`${rIndice}: ano_ingresso duplicado: ${str(ano)}`);
        anosVistos.add(Number(ano));
      }
      if (typeof valorPath !== "string") {
        erros.push(`${rIndice}: path ausente em ${str(processoId)}`);
        continue;
      }
      if (!valorPath.startsWith("institucional/ifpr/processos-seletivos/") || !valorPath.endsWith(".json")) {
        erros.push(`${rIndice}: path inválido em ${str(processoId)}: ${valorPath}`);
        continue;
      }
      pathsIndice.add(valorPath);

      const caminhoProcesso = naBase(this.c, valorPath);
      const [dados, errosJson] = this.carregarJson(caminhoProcesso, `processo seletivo ${valorPath}`);
      erros.push(...errosJson);
      if (!ehObjeto(dados)) continue;
      erros.push(...this.validarComSchema(dados, this.c.schemas.processoSeletivo, valorPath));
      if (!iguais(obter(dados, "id"), processoId)) erros.push(`${valorPath}: id diverge do index.json`);
      if (!iguais(obter(dados, "ano_ingresso"), ano)) erros.push(`${valorPath}: ano_ingresso diverge do index.json`);
      if (!iguais(obter(dados, "nome"), obter(item, "nome"))) erros.push(`${valorPath}: nome diverge do index.json`);
      if (path.basename(caminhoProcesso) !== `${str(processoId)}.json`)
        erros.push(`${valorPath}: nome do arquivo diverge do id`);
      for (const fonte of iterar(obter(dados, "fontes", []))) {
        erros.push(...this.validarUrlHttps(fonte, `${valorPath}: fontes[]`));
      }
      for (const edital of iterar(obter(dados, "editais", []))) {
        if (ehObjeto(edital)) erros.push(...this.validarUrlHttps(obter(edital, "url"), `${valorPath}: editais[].url`));
      }
      const ofertasVistas = new Set<string>();
      for (const oferta of iterar(obter(dados, "ofertas", []))) {
        if (!ehObjeto(oferta)) continue;
        const ofertaId = obter(oferta, "id");
        if (typeof ofertaId === "string") {
          if (ofertasVistas.has(ofertaId)) erros.push(`${valorPath}: oferta duplicada: ${ofertaId}`);
          ofertasVistas.add(ofertaId);
        }
        const campusId = obter(oferta, "campus_id");
        if (typeof campusId === "string") {
          const cursoSlug = obter(oferta, "curso_slug");
          if (typeof cursoSlug === "string") {
            const cursos = cursosPorCampus.get(campusId);
            if (cursos === undefined) {
              erros.push(`${valorPath}: ofertas[].curso_slug informado para campus_id não cadastrado: ${campusId}`);
            } else if (!cursos.has(cursoSlug)) {
              erros.push(`${valorPath}: ofertas[].curso_slug inexistente em ${campusId}: ${cursoSlug}`);
            }
          }
        } else if (tem(oferta, "curso_slug")) {
          erros.push(`${valorPath}: ofertas[].curso_slug informado sem campus_id textual`);
        }
        const fonte = obter(oferta, "fonte");
        if (ehObjeto(fonte))
          erros.push(...this.validarUrlHttps(obter(fonte, "url"), `${valorPath}: ofertas[].fonte.url`));
      }
    }

    const pathsProcessos = new Set(
      glob(this.c.processosSeletivos, "*.json")
        .filter((caminho) => path.basename(caminho) !== "index.json")
        .map((caminho) => this.rel(caminho)),
    );
    if (!conjuntosIguais(pathsIndice, pathsProcessos)) {
      erros.push(
        `index.json de processos seletivos não cobre exatamente os arquivos: index=${repr(ordenarTextos(pathsIndice))} arquivos=${repr(ordenarTextos(pathsProcessos))}`,
      );
    }
    return erros;
  }

  validarArquivoCursoCnct(caminho: string, itemIndice: ObjetoJson): string[] {
    const r = this.rel(caminho);
    const [dados, errosJson] = this.carregarJson(caminho, `curso CNCT ${r}`);
    if (errosJson.length) return errosJson;
    if (!ehObjeto(dados)) return [`${r} deve conter um objeto JSON`];
    const erros = this.validarComSchema(dados, this.c.schemas.cursoCnct, r);

    const cursoId = obter(dados, "id");
    if (typeof cursoId !== "string" || !RE_SLUG.test(cursoId)) erros.push(`${r}: id deve ser slug ASCII minúsculo`);
    else if (path.basename(caminho) !== `${cursoId}.json`) erros.push(`${r}: nome do arquivo diverge do id`);

    for (const campo of [
      "id",
      "denominacao",
      "denominacao_normalizada",
      "eixo_tecnologico",
      "area_tecnologica",
      "carga_horaria_minima_horas",
      "codigos_cbo",
    ]) {
      if (!iguais(obter(dados, campo), obter(itemIndice, campo)))
        erros.push(`${r}: campo ${campo} diverge do index.json`);
    }

    const codigosCbo = obter(dados, "codigos_cbo");
    if (Array.isArray(codigosCbo)) {
      const vistos = new Set<string>();
      const ocupacoes = str(obter(dados, "ocupacoes_cbo", ""));
      for (const codigo of codigosCbo) {
        if (typeof codigo !== "string") continue;
        if (vistos.has(codigo)) erros.push(`${r}: codigos_cbo duplicado: ${codigo}`);
        vistos.add(codigo);
        if (!ocupacoes.includes(codigo)) erros.push(`${r}: codigos_cbo não aparece em ocupacoes_cbo: ${codigo}`);
      }
    }
    return erros;
  }

  validarCatalogos(): string[] {
    const erros: string[] = [];
    const [manifestCatalogos, e1] = this.carregarJson(this.c.manifestCatalogos, "catalogos_manifest.json");
    erros.push(...e1);
    const [manifestCnct, e2] = this.carregarJson(this.c.manifestCnct, "manifesto CNCT");
    erros.push(...e2);
    const [indiceCnct, e3] = this.carregarJson(this.c.indiceCnct, "índice CNCT");
    erros.push(...e3);
    if (erros.length) return erros;

    const rManifestCnct = this.rel(this.c.manifestCnct);
    const rIndiceCnct = this.rel(this.c.indiceCnct);

    if (!ehObjeto(manifestCatalogos)) {
      erros.push("catalogos_manifest.json deve conter um objeto JSON");
    } else {
      erros.push(
        ...this.validarComSchema(manifestCatalogos, this.c.schemas.manifestCatalogos, "catalogos_manifest.json"),
      );
      const catalogos = obter(manifestCatalogos, "catalogos");
      if (!Array.isArray(catalogos) || !catalogos.length) {
        erros.push("catalogos_manifest.json: catalogos deve ser lista não vazia");
      } else {
        const cnct = this.colecao(manifestCatalogos, "catalogos", "cnct");
        if (!cnct) erros.push("catalogos_manifest.json: catálogo cnct ausente");
        else if (!iguais(obter(cnct, "path"), rManifestCnct)) {
          erros.push("catalogos_manifest.json: path do catálogo cnct diverge do manifesto CNCT");
        }
      }
    }

    if (!ehObjeto(manifestCnct)) {
      erros.push(`${rManifestCnct} deve conter um objeto JSON`);
    } else {
      erros.push(...this.validarComSchema(manifestCnct, this.c.schemas.manifestCnct, rManifestCnct));
      if (!iguais(obter(manifestCnct, "index_path"), rIndiceCnct))
        erros.push(`${rManifestCnct}: index_path diverge do índice CNCT`);
      if (!iguais(obter(manifestCnct, "campos_curso"), CAMPOS_CURSO_CNCT)) {
        erros.push(`${rManifestCnct}: campos_curso diverge do contrato esperado`);
      }
      for (const campo of ["fonte_url", "atos_normativos_url", "catalogo_pdf_url"]) {
        erros.push(...this.validarUrlHttps(obter(manifestCnct, campo), `${rManifestCnct}: ${campo}`));
      }
    }

    if (!ehObjeto(indiceCnct)) {
      erros.push(`${rIndiceCnct} deve conter um objeto JSON`);
      return erros;
    }
    erros.push(...this.validarComSchema(indiceCnct, this.c.schemas.indiceCnct, rIndiceCnct));

    const itens = obter(indiceCnct, "items");
    if (!Array.isArray(itens) || !itens.length) {
      erros.push(`${rIndiceCnct}: items deve ser lista não vazia`);
      return erros;
    }

    const cnct = this.colecao(manifestCatalogos, "catalogos", "cnct");
    if (cnct && !iguais(obter(cnct, "total_itens"), itens.length)) {
      erros.push("catalogos_manifest.json: total_itens do CNCT diverge do index.json");
    }
    if (ehObjeto(manifestCnct) && !iguais(obter(manifestCnct, "total_cursos"), itens.length)) {
      erros.push(`${rManifestCnct}: total_cursos diverge do index.json`);
    }
    if (!iguais(obter(indiceCnct, "total_cursos"), itens.length))
      erros.push(`${rIndiceCnct}: total_cursos diverge de items`);

    const idsVistos = new Set<string>();
    const indicesVistos = new Set<number>();
    const pathsIndice = new Set<string>();
    for (const item of itens) {
      if (!ehObjeto(item)) {
        erros.push(`${rIndiceCnct}: item deve ser objeto`);
        continue;
      }
      const cursoId = obter(item, "id");
      const valorPath = obter(item, "path");
      if (typeof cursoId !== "string" || !RE_SLUG.test(cursoId))
        erros.push(`${rIndiceCnct}: id inválido: ${str(cursoId)}`);
      else if (idsVistos.has(cursoId)) erros.push(`${rIndiceCnct}: id duplicado: ${cursoId}`);
      else idsVistos.add(cursoId);
      if (typeof valorPath !== "string") {
        erros.push(`${rIndiceCnct}: path ausente em ${str(cursoId)}`);
        continue;
      }
      const esperado = `catalogos/cnct/cursos/${str(cursoId)}.json`;
      if (valorPath !== esperado) {
        erros.push(`${rIndiceCnct}: path inválido em ${str(cursoId)}: ${valorPath}`);
        continue;
      }
      if (pathsIndice.has(valorPath)) erros.push(`${rIndiceCnct}: path duplicado: ${valorPath}`);
      pathsIndice.add(valorPath);

      const antes = erros.length;
      erros.push(...this.validarArquivoCursoCnct(naBase(this.c, valorPath), item));
      if (erros.length === antes) {
        const [dadosCurso] = this.carregarJson(naBase(this.c, valorPath), `curso CNCT ${valorPath}`);
        if (ehObjeto(dadosCurso)) {
          const indice = obter(dadosCurso, "indice");
          if (ehInteiro(indice)) {
            if (indicesVistos.has(Number(indice))) erros.push(`${valorPath}: indice duplicado: ${str(indice)}`);
            indicesVistos.add(Number(indice));
          }
        }
      }
    }

    const pathsCursos = new Set(glob(this.c.cursosCnct, "*.json").map((caminho) => this.rel(caminho)));
    if (!conjuntosIguais(pathsIndice, pathsCursos)) {
      erros.push(
        `index.json não cobre exatamente os arquivos de cursos CNCT: index=${repr(ordenarTextos(pathsIndice))} arquivos=${repr(ordenarTextos(pathsCursos))}`,
      );
    }

    const esperados = new Set([rManifestCnct, rIndiceCnct, ...pathsCursos]);
    const atuais = new Set(rglob(this.c.catalogos, "*.json").map((caminho) => this.rel(caminho)));
    atuais.delete("catalogos_manifest.json");
    if (!conjuntosIguais(atuais, esperados)) {
      erros.push(
        `catalogos/ contém arquivos JSON fora do contrato esperado: esperado=${repr(ordenarTextos(esperados))} arquivos=${repr(ordenarTextos(atuais))}`,
      );
    }
    return erros;
  }
}

function aliasPareceNomeAntigo(alias: unknown): boolean {
  if (typeof alias !== "string" || !alias.endsWith(".md")) return false;
  return RE_DATA_NO_INICIO.test(alias) || RE_ALIAS_COM_ANO.test(alias);
}

function comparavel(campo: string, valor: unknown): unknown {
  if (campo === "ano" && valor !== null && valor !== undefined) return str(valor);
  return valor;
}

export type ResultadoValidacao = { erros: string[]; totalNormas: number };

/** Executa todas as validações da base, na mesma ordem do script Python. */
export function validarBase(caminhos: CaminhosBase, opcoes: { artefatosPpc?: boolean } = {}): ResultadoValidacao {
  const v = new Validador(caminhos);
  const erros: string[] = [];
  erros.push(...v.validarPadroesLocais());

  const [manifestLido, errosManifest] = v.carregarManifest();
  const manifest = manifestLido ?? [];
  erros.push(...errosManifest);

  const markdownsNaRaiz = glob(caminhos.raiz, "*.md")
    .map((caminho) => path.basename(caminho))
    .filter((nome) => nome !== "AGENTS.md" && nome !== "README.md");
  if (markdownsNaRaiz.length)
    erros.push(`normas não devem ficar na raiz do repositório: ${repr(ordenarTextos(markdownsNaRaiz))}`);

  const pathsManifest = new Set(manifest.filter(ehObjeto).map((item) => obter(item, "path")));
  const pathsMarkdown = new Set(rglob(caminhos.normas, "*.md").map((caminho) => v.rel(caminho)));
  if (!conjuntosIguais(pathsManifest as Set<unknown>, pathsMarkdown as Set<unknown>)) {
    erros.push(
      `manifest.json não cobre exatamente as normas publicadas: manifest=${repr(ordenarTextos([...pathsManifest].map(str)))} markdown=${repr(ordenarTextos(pathsMarkdown))}`,
    );
  }

  const textoReadme = lerTexto(caminhos.readme);
  for (const padrao of PADROES_LOCAIS) {
    if (textoReadme.includes(padrao)) erros.push(`README.md contém padrão local proibido: ${padrao}`);
  }
  erros.push(...v.validarLinks(caminhos.readme, textoReadme));
  erros.push(...v.validarInstitucional());
  erros.push(...v.validarCatalogos());
  if (opcoes.artefatosPpc) erros.push(...v.validarArtefatosConversaoPpc());

  for (const caminho of arquivosNormas(caminhos)) erros.push(...v.validarMarkdown(caminho));

  for (const item of manifest) {
    if (!ehObjeto(item)) {
      erros.push("manifest.json contém item que não é objeto");
      continue;
    }
    for (const campo of [...CAMPOS_MANIFEST, "path"]) {
      if (!tem(item, campo)) erros.push(`manifest.json: item sem campo ${campo}: ${repr(item)}`);
    }
    erros.push(...v.validarItemManifest(item));
  }

  return { erros, totalNormas: manifest.length };
}
