// @effect-diagnostics nodeBuiltinImport:off -- confere o banco com as APIs síncronas de arquivos e roda o executável (node:crypto, node:child_process)
/**
 * O `kb.sqlite` compilado da base real (num diretório temporário, pelo `Compilador`): determinismo,
 * recall da busca de seções, coerência com os gabaritos da avaliação, literalidade das respostas e
 * igualdade entre o banco e a API de arquivos da fase 5 (dispositivos, correspondência, relações,
 * marcos, vigência e transições).
 *
 * Paridade (T0): os mesmos serviços (`Normas`, `Ppcs`, `Cursos`, `Impacto`, `PacoteContexto`)
 * rodam sobre `FontesNormativas.layerBanco` e sobre `FontesNormativas.layerArquivos({ raiz })`, as
 * duas sobre o mesmo `SqlClient` do banco compilado, e dão a mesma saída JSON; a exceção aceita é o
 * `impacto`, que sobre o banco só vê as fichas das skills. Sem o repositório: o tipo de
 * `layerSomenteLeitura` não exige `FileSystem`, e todas as consultas rodam sobre ela numa cópia do
 * banco num diretório vazio, também num executável (Node SEA). Compila três vezes (cerca de 10 s
 * cada; a terceira com `versao`, `commit` e `canal`).
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, expectTypeOf, layer, vi } from "@effect/vitest";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";
import { build as empacotar } from "vite-plus/pack";
import * as BaseKb from "../BaseKb.ts";
import * as Compilador from "../Compilador.ts";
import * as Cursos from "../Cursos.ts";
import * as FontesNormativas from "../FontesNormativas.ts";
import * as Impacto from "../Impacto.ts";
import * as Layers from "../layers.ts";
import * as Normas from "../Normas.ts";
import * as PacoteContexto from "../PacoteContexto.ts";
import * as Ppcs from "../Ppcs.ts";
import { INDICADORES } from "../adequacao/art71.ts";
import { avaliarBusca } from "../avaliacao/busca-secoes.ts";
import { lerSinonimos } from "../busca/sinonimos.ts";
import { carregarCorrespondencias } from "../normas/correspondencia.ts";
import { carregarDispositivos, descendentes, indiceDispositivos } from "../normas/estrutura.ts";
import { obterDispositivo as obterDispositivoArquivos } from "../normas/estrutura.ts";
import { atosComVigencia } from "../normas/fontes-db.ts";
import { raizRepositorio } from "../caminhos.ts";
import { caminhoStubs, carregarRegistro, lerRegistroStubs } from "../normas/registro.ts";
import { carregarRelacoes, sucessorasDe } from "../normas/relacoes.ts";
import {
  carregarFonteVigencia,
  carregarTransicoes,
  dataReferencia,
  derivarLinha,
  efeitoDaRelacao,
  inicioVigencia,
  statusEm,
  transicoesAplicaveis,
} from "../normas/vigencia.ts";
import {
  lerTextoSecao,
  normasCitadasDoArquivo,
  ppcsQueCitam as ppcsQueCitamArquivos,
  relatorioCitacoes,
} from "../ppcs/citacoes.ts";
import { palavrasDeCampi } from "../ppcs/secoes.ts";
import { lerTopicosFichas, lerTopicosSecoes } from "../ppcs/topicos.ts";
import { CITACOES, consultasDoExecutavel, NORMAS, PPC, todasAsConsultas } from "../testes/consultas.ts";
import * as PpcAvulso from "./ppc-avulso.ts";
import { tabelasCorrespondencia, transicoesDosAtos, vigenciaNaData } from "./consultas-normas.ts";
import type { FiltrosSecoes } from "./consultas-secoes.ts";
import { VERSAO_ESQUEMA } from "./esquema.ts";
import * as Sql from "./sql.ts";

const raiz = raizRepositorio();
const vigenciaArquivos = carregarFonteVigencia(raiz);
/** Registro e léxico do checkout, para o banco do PPC avulso. */
const doCheckout = () => ({ registro: carregarRegistro(raiz), sinonimos: lerSinonimos(raiz) });
/** Instante do relógio de teste durante as compilações: vira o mtime de cada banco. */
const INSTANTE = DateTime.toEpochMillis(DateTime.makeUnsafe("2026-11-13T12:00:00Z"));
const FICHAS_DA_ANALISE = "base-conhecimento/revisao-ppc/fichas/";

/* ------------------------------------------------------------------ layers */

/** Os três bancos compilados num diretório temporário (removido no fim). */
class Compilados extends Context.Service<Compilados, { readonly a: string; readonly b: string; readonly c: string }>()(
  "@simplifica-if/kb/db/base.test/Compilados",
) {}

const layerCompilados = Layer.effect(
  Compilados,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const compilador = yield* Compilador.Compilador;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "kb-base-" });
    const [a, b, c] = ["a", "b", "c"].map((nome) => path.join(dir, `${nome}.sqlite`)) as [string, string, string];
    // relógio de teste parado: o instante lido antes das fontes é conhecido
    yield* TestClock.setTime(INSTANTE);
    yield* compilador.compilar({ raiz, destino: a });
    yield* compilador.compilar({ raiz, destino: b });
    yield* compilador.compilar({ raiz, destino: c, versao: "2026.11.13", commit: "0123abcd", canal: "beta" });
    return { a, b, c };
  }),
);

/** O `SqlClient` (só leitura) do banco `a`. */
const layerSqlA = Layer.unwrap(Effect.map(Compilados, (c) => BaseKb.layerSqlite({ caminho: c.a })));

/** Os serviços de consulta sobre as fontes lidas dos arquivos, montados à parte do contexto principal. */
class LadoArquivos extends Context.Service<
  LadoArquivos,
  Context.Context<Exclude<Layers.ServicosConsulta, SqlClient.SqlClient>>
>()("@simplifica-if/kb/db/base.test/LadoArquivos") {}

const layerLadoArquivos = Layer.effect(
  LadoArquivos,
  // `fresh`: memo próprio, para que nenhum serviço do lado do banco seja reaproveitado
  Layer.build(Layer.fresh(Layers.layerConsultas.pipe(Layer.provideMerge(FontesNormativas.layerArquivos({ raiz }))))),
);

/**
 * Contexto dos testes: os serviços sobre `FontesNormativas.layerBanco` e, em `LadoArquivos`, os
 * mesmos serviços sobre `FontesNormativas.layerArquivos`; os dois sobre o `SqlClient` do banco `a`.
 */
const layerTeste = Layer.mergeAll(
  Layers.layerConsultas.pipe(Layer.provideMerge(FontesNormativas.layerBanco)),
  layerLadoArquivos,
).pipe(
  Layer.provideMerge(layerSqlA),
  Layer.provideMerge(layerCompilados),
  Layer.provideMerge(Compilador.layer),
  Layer.provideMerge(NodeServices.layer),
);

/* ------------------------------------------------------------------ apoio */

/** O mesmo efeito sobre as fontes do banco e sobre as dos arquivos: `[banco, arquivos]`. */
const nasDuas = <A, E>(efeito: Effect.Effect<A, E, Layers.ServicosConsulta>) =>
  Effect.gen(function* () {
    const arquivos = yield* LadoArquivos;
    const doBanco = yield* efeito;
    const dosArquivos = yield* Effect.provideContext(efeito, arquivos);
    return [doBanco, dosArquivos] as const;
  });

/** Saída igual byte a byte (JSON, com a ordem das chaves), não só igualdade estrutural. */
const mesmoJson = (banco: unknown, arquivos: unknown) => expect(JSON.stringify(banco)).toBe(JSON.stringify(arquivos));

/** `nasDuas` com `mesmoJson`. */
const paridade = <A, E>(efeito: Effect.Effect<A, E, Layers.ServicosConsulta>) =>
  Effect.map(nasDuas(efeito), ([banco, arquivos]) => {
    mesmoJson(banco, arquivos);
    return banco;
  });

const lerTexto = (relativo: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(NodePath.join(raiz, relativo)));
const lerJson = (relativo: string) => Effect.map(lerTexto(relativo), (texto) => JSON.parse(texto) as unknown);
const linhasDe = (relativo: string) => Effect.map(lerTexto(relativo), (texto) => texto.split("\n"));

const sha256 = (arquivo: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    Effect.map(fs.readFile(arquivo), (bytes) => NodeCrypto.createHash("sha256").update(bytes).digest("hex")),
  );

/** Véspera de uma data AAAA-MM-DD, em UTC. */
const vesperaDe = (data: string): string =>
  DateTime.formatIsoDateUtc(DateTime.subtract(DateTime.makeUnsafe(`${data}T00:00:00Z`), { days: 1 }));

const Texto = Schema.String;
const linhasSecoes = Sql.todas(
  Schema.Struct({
    id: Texto,
    tipo: Texto,
    titulo: Texto,
    linha_inicio: Schema.Number,
    linha_fim: Schema.Number,
    linha_texto: Schema.Number,
    texto: Texto,
  }),
);
const linhasCitacoes = Sql.todas(
  Schema.Struct({
    linha: Schema.Number,
    trecho: Texto,
    ato_id: Schema.NullOr(Texto),
    regra: Texto,
    secao_tipo: Schema.NullOr(Texto),
    papel: Texto,
  }),
);
const primeiroMarco = Sql.primeira(Schema.Struct({ vigente: Texto, normas_json: Texto }));
const linhasVigencias = Sql.todas(Schema.Struct({ de: Schema.NullOr(Texto) }));

/** Seções de um PPC, sem o prefixo do ID (o PPC avulso tem outro). */
const secoesDe = (ppcId: string) =>
  Effect.map(
    linhasSecoes(
      "SELECT id, tipo, titulo, linha_inicio, linha_fim, linha_texto, texto FROM secoes WHERE ppc_id = ? ORDER BY linha_inicio",
      [ppcId],
    ),
    (secoes) => secoes.map((s) => ({ ...s, id: s.id.slice(s.id.indexOf("#") + 1) })),
  );
const citacoesDe = (ppcId: string) =>
  linhasCitacoes(
    "SELECT linha, trecho, ato_id, regra, secao_tipo, papel FROM citacoes WHERE ppc_id = ? ORDER BY ordem",
    [ppcId],
  );

const servicos = Effect.all({
  normas: Normas.Normas,
  ppcs: Ppcs.Ppcs,
  cursos: Cursos.Cursos,
  impacto: Impacto.Impacto,
  pacote: PacoteContexto.PacoteContexto,
});

/* ------------------------------------------------------------------ testes */

// O layer sem nome monta os bancos num `beforeEach` preso ao sinal do teste: quem limita a montagem (três
// compilações da base, cerca de um minuto num runner lento) é o tempo do teste, não o `timeout` do layer.
// Com os 60 s do padrão, a montagem interrompida recomeçava a cada teste e a suíte passava de 30 min na CI.
vi.setConfig({ testTimeout: 300_000 });

layer(layerTeste, { timeout: "300 seconds" })((it) => {
  describe("kb.sqlite da base", () => {
    it.effect("dois builds sobre as mesmas fontes dão o mesmo arquivo", () =>
      Effect.gen(function* () {
        const { a, b } = yield* Compilados;
        expect(yield* sha256(a)).toBe(yield* sha256(b));
      }),
    );

    it.effect("o mtime do banco é o instante lido antes das fontes, não o do fim da compilação", () =>
      Effect.gen(function* () {
        // fonte editada durante a compilação fica mais nova que o banco e força a recompilação seguinte
        const fs = yield* FileSystem.FileSystem;
        const { a, c } = yield* Compilados;
        for (const banco of [a, c]) {
          const info = yield* fs.stat(banco);
          expect(Option.map(info.mtime, (d) => d.getTime())).toEqual(Option.some(INSTANTE));
        }
      }),
    );

    it.effect("recall@10 da busca de seções ≥ 0,8 (modo completo)", () =>
      Effect.gen(function* () {
        const resultado = yield* avaliarBusca({ raiz });
        expect(resultado.consultas).toBeGreaterThanOrEqual(20);
        expect(resultado.recall.completo).toBeGreaterThanOrEqual(0.8);
      }),
    );

    it.effect("respostas trazem texto literal e proveniência", () =>
      Effect.gen(function* () {
        const { normas, ppcs } = yield* servicos;
        const secoes = yield* ppcs.buscarSecoes("acompanhamento de egressos", { cnct: "tecnico-em-informatica" });
        expect(secoes.length).toBe(10);
        for (const s of secoes) {
          const linhas = yield* linhasDe(s.path);
          expect(s.trecho.length).toBeGreaterThan(0);
          for (const t of s.trecho) expect(linhas[t.linha - 1]).toBe(t.texto);
        }
        const [artigo] = (yield* normas.buscar("Resolução CNE/CP nº 2/2026, art. 28")).resultados;
        expect(artigo!.origem).toBe("citacao-resolvida");
        expect(artigo!.dispositivo!.id).toBe("br/cne-cp/res/2026/2#art28");
        expect(artigo!.dispositivo!.subordinados.length).toBeGreaterThan(10);
        const linhasNorma = yield* linhasDe(artigo!.dispositivo!.path);
        expect(linhasNorma[artigo!.dispositivo!.linha_inicio - 1]).toContain("Art. 28");
        const [inciso] = (yield* normas.buscar("Res. CNE/CP 2/2026, art. 28, inciso VII")).resultados;
        expect(inciso!.dispositivo!.id).toBe("br/cne-cp/res/2026/2#art28-vii");
        expect(inciso!.dispositivo!.caput.length).toBe(1);
        const textuais = (yield* normas.buscar("estágio supervisionado carga horária")).resultados;
        expect(textuais.length).toBe(10);
        for (const r of textuais.filter((x) => x.dispositivo)) {
          const d = r.dispositivo!;
          expect(d.id).toMatch(/^[a-z-]+(\/[\w-]+)+#[\w-]+$/);
          const linhasD = yield* linhasDe(d.path);
          const trecho = linhasD.slice(d.linha_inicio - 1, d.linha_fim).join("\n");
          expect(trecho).toContain(d.rotulo);
        }
        const divergencias = yield* ppcs.divergencias({ nivel: "médio" });
        for (const p of divergencias.ppcs) {
          for (const f of p.fatos.filter((x) => x.status_curadoria === "extraido")) {
            const linha = (yield* linhasDe(f.path))[f.linha - 1]!;
            expect(linha).toContain(f.trecho_fonte);
          }
        }
      }),
    );

    it.effect("pacote-contexto de uma ficha é menor que o PPC inteiro e traz o artigo citado", () =>
      Effect.gen(function* () {
        const { pacote: servico } = yield* servicos;
        const pacote = yield* servico.montar("CT-CURR-12", PPC);
        expect(pacote.fichas_ids).toEqual(["CT-CURR-12"]);
        expect(pacote.tamanho.caracteres).toBeLessThan(pacote.tamanho.caracteres_ppc_inteiro);
        const dcn = pacote.normas.find((n) => n.ref === "br/cne-cp/res/2026/2");
        // a ficha cita o art. 9º e o inciso VII do art. 28: o inciso vem com o caput do artigo, não o artigo inteiro
        expect(dcn?.dispositivos.map((d) => d.id)).toEqual([
          "br/cne-cp/res/2026/2#art9",
          "br/cne-cp/res/2026/2#art28-vii",
        ]);
        expect(dcn?.dispositivos[1]!.caput?.[0]).toContain("Art. 28");
        expect(pacote.marcos.map((m) => m.marco)).toContain("dcn_ept");
        expect(pacote.transicoes.map((t) => t.id)).toContain("dcnept-2026-art71");
        for (const t of pacote.transicoes) expect(t.texto).not.toBeNull();
        expect(pacote.secoes.some((s) => s.tipo === "matriz_curricular")).toBe(true);
      }),
    );
  });

  describe("PPC fora da base (abrirPpcAvulso)", () => {
    const AMOSTRA = [
      "curitiba/tecnico-em-enfermagem",
      "jacarezinho/tecnico-em-eletromecanica",
      "campo-largo/administracao-proeja",
      "paranagua/tecnico-em-informatica",
      "arapongas/tecnico-em-melhoria-de-processos",
      "curitiba/tecnico-em-processos-fotograficos-integrado-ao-ensino-medio",
    ];

    it.effect("o Markdown segmentado em memória dá as mesmas seções e citações do kb.sqlite", () =>
      Effect.gen(function* () {
        const { pacote } = yield* servicos;
        const palavras = palavrasDeCampi(yield* pacote.nomesDeCampi);
        for (const chave of AMOSTRA) {
          const md = yield* lerTexto(`base-conhecimento/institucional/ifpr/ppcs/${chave}.md`);
          yield* Effect.scoped(
            Effect.gen(function* () {
              const avulso = yield* PpcAvulso.abrirPpcAvulso(md, {
                ppcId: "ppc:avulso",
                palavrasCampi: palavras,
                ...doCheckout(),
              });
              const noAvulso = Effect.provide(avulso);
              expect(yield* noAvulso(secoesDe("ppc:avulso"))).toEqual(yield* secoesDe(`ppc:${chave}`));
              expect(yield* noAvulso(citacoesDe("ppc:avulso"))).toEqual(yield* citacoesDe(`ppc:${chave}`));
            }),
          );
        }
      }),
    );

    it.effect(
      "o pacote avulso de um tópico tem as normas, marcos, transições e seções do tópico do pacote da base",
      () =>
        Effect.gen(function* () {
          const { pacote: servico } = yield* servicos;
          const md = yield* lerTexto("base-conhecimento/institucional/ifpr/ppcs/curitiba/tecnico-em-enfermagem.md");
          const avulso = yield* servico.abrirAvulso(md);
          const base = yield* servico.montar("estagio", PPC);
          const fichas = yield* servico.fichas(base.fichas_ids);
          const pacote = yield* avulso.pacote(fichas);
          expect(pacote.fichas_ids).toEqual(base.fichas_ids);
          expect(pacote.normas).toEqual(base.normas);
          expect(pacote.marcos).toEqual(base.marcos);
          expect(pacote.transicoes).toEqual(base.transicoes);
          const doTopico = (secoes: readonly { id: string; motivo: string[] }[]) =>
            secoes
              .filter((s) => s.motivo.some((m) => m.startsWith("topico:")))
              .map((s) => s.id.slice(s.id.indexOf("#")));
          expect(doTopico(pacote.secoes)).toEqual(doTopico(base.secoes));
          expect(pacote.secoes.every((s) => s.texto.length > 0)).toBe(true);
          const completo = yield* avulso.pacote(fichas, { escopo: "completo" });
          expect(completo.secoes).toEqual([]);
          expect(completo.normas).toEqual(base.normas);
        }),
    );

    it.effect("o banco em memória do PPC avulso fecha com o escopo de quem o abriu, não com a layer", () =>
      Effect.gen(function* () {
        const { pacote: servico } = yield* servicos;
        const md = yield* lerTexto("base-conhecimento/institucional/ifpr/ppcs/curitiba/tecnico-em-enfermagem.md");
        const fichas = yield* servico.fichas(["CT-CURR-12"]);
        const avulso = yield* Effect.scoped(servico.abrirAvulso(md));
        const erro = yield* Effect.flip(avulso.pacote(fichas));
        expect(Sql.ehFalhaNaConsulta(erro)).toBe(true);
      }),
    );

    it.effect("a estrutura segmenta o texto que o banco recebeu: com `titulosNivel1` e CRLF, as seções do pacote", () =>
      Effect.gen(function* () {
        const { pacote: servico } = yield* servicos;
        const original = yield* lerTexto("base-conhecimento/institucional/ifpr/ppcs/curitiba/tecnico-em-enfermagem.md");
        // o primeiro nível em `#`, como o normalizador do `packages/ppc` o põe, e as quebras de linha do Word
        const md = original.replace(/^## /gm, "# ").replace(/\n/g, "\r\n");
        const base = yield* servico.montar("estagio", PPC);
        const fichas = yield* servico.fichas(base.fichas_ids);
        const avulso = yield* servico.abrirAvulso(md, { titulosNivel1: true, todasAsSecoes: true });
        const pacote = yield* avulso.pacote(fichas);
        const { secoes } = avulso.estrutura();
        const chave = (s: { tipo: string; titulo: string; inicio: number; fim: number }) =>
          `${s.tipo}|${s.titulo}|${s.inicio}|${s.fim}`;
        const daEstrutura = new Set(
          secoes.map((s) => chave({ tipo: s.tipo, titulo: s.titulo, inicio: s.linhaInicio, fim: s.linhaFim })),
        );
        expect(pacote.secoes.length).toBeGreaterThan(0);
        for (const s of pacote.secoes)
          expect(daEstrutura, s.id).toContain(
            chave({ tipo: s.tipo, titulo: s.titulo, inicio: s.linha_inicio, fim: s.linha_fim }),
          );
        // e são as seções do Markdown como na base, com `##`
        const comoNaBase = yield* servico.abrirAvulso(original);
        expect(secoes.map((s) => [s.tipo, s.linhaInicio, s.linhaFim])).toEqual(
          comoNaBase.estrutura().secoes.map((s) => [s.tipo, s.linhaInicio, s.linhaFim]),
        );
      }),
    );
  });

  describe("fase 5: o banco dá o mesmo resultado que a API de arquivos", () => {
    it.effect("todos os dispositivos (pelo ID do ato e pelo ID do arquivo) e os descendentes", () =>
      Effect.gen(function* () {
        const { normas } = yield* servicos;
        const indice = indiceDispositivos(raiz);
        expect(indice.size).toBeGreaterThan(4000);
        for (const [id, disp] of indice) {
          expect((yield* normas.dispositivo(id))?.disp).toEqual(disp);
          expect((yield* normas.dispositivo(disp.id))?.disp).toEqual(obterDispositivoArquivos(disp.id, raiz)!);
        }
        for (const disp of carregarDispositivos(raiz).filter((d) => d.norma !== d.ato)) {
          expect((yield* normas.dispositivo(disp.id))?.disp).toEqual(obterDispositivoArquivos(disp.id, raiz)!);
        }
        for (const id of ["br/cne-cp/res/2026/2#art28", "br/lei/1996/9394#art36", "br/cne-cp/res/2021/1#art20"]) {
          expect((yield* normas.descendentes(id)).map((d) => d.disp)).toEqual(descendentes(id, raiz));
        }
        expect(yield* normas.dispositivo("br/cne-cp/res/2026/2#art999")).toBeUndefined();
      }),
    );

    it.effect("correspondência 1/2021 → 2/2026: artigos cobertos, Q07 e Q23 da avaliação", () =>
      Effect.gen(function* () {
        const { normas } = yield* servicos;
        const dcn2021 = "br/cne-cp/res/2021/1";
        expect((yield* normas.correspondencia(dcn2021)).length).toBe(65);
        const [art20] = yield* normas.correspondencia(`${dcn2021}#art20`);
        expect(art20!.item).toMatchObject({ tipo: "parcial", destino: ["#art22"] });
        const [art26par1] = yield* normas.correspondencia(`${dcn2021}#art26-par1`);
        expect(art26par1!.item.destino).toEqual(["#art29-par2", "#art29-par3"]);
        const [herdado] = yield* normas.correspondencia(`${dcn2021}#art5-par1`);
        expect(herdado!.herdado_de).toBe("#art5");
        const tabelas = carregarCorrespondencias(raiz);
        // herança: todo dispositivo sem item próprio, com um ancestral na tabela, herda o item do ancestral
        // mais próximo
        const origens = new Set(
          tabelas.filter((t) => t.origem === dcn2021).flatMap((t) => t.itens.map((i) => i.origem)),
        );
        const indice = indiceDispositivos(raiz);
        let herdados = 0;
        for (const [id, disp] of indice) {
          if (!id.startsWith(`${dcn2021}#`)) continue;
          const sufixo = id.slice(dcn2021.length);
          if (origens.has(sufixo)) continue;
          let ancestral: string | null = null;
          for (
            let pai = disp.pai;
            pai !== null;
            pai = indice.get(`${dcn2021}${pai.slice(pai.indexOf("#"))}`)?.pai ?? null
          ) {
            const sufixoPai = pai.slice(pai.indexOf("#"));
            if (origens.has(sufixoPai)) {
              ancestral = sufixoPai;
              break;
            }
          }
          if (ancestral === null) continue;
          const resultado = yield* normas.correspondencia(id);
          expect(resultado.length, id).toBeGreaterThan(0);
          for (const r of resultado) expect([r.herdado_de, r.item.origem], id).toEqual([ancestral, ancestral]);
          herdados++;
        }
        expect(herdados).toBeGreaterThan(50);
        expect(yield* tabelasCorrespondencia()).toEqual(tabelas);
        for (const origem of new Set(tabelas.map((t) => t.origem))) {
          expect(yield* normas.tabelasDeCorrespondencia(origem)).toEqual(tabelas.filter((t) => t.origem === origem));
        }
      }),
    );

    it.effect("relações e marcos derivados", () =>
      Effect.gen(function* () {
        const fontes = yield* FontesNormativas.FontesNormativas;
        expect(fontes.relacoes).toEqual(carregarRelacoes(raiz));
        const { marcos } = (yield* lerJson("base-conhecimento/revisao-ppc/marcos-normativos.json")) as {
          marcos: { id: string; linha: string[] }[];
        };
        for (const m of marcos) {
          const linha = (yield* primeiroMarco("SELECT vigente, normas_json FROM marcos WHERE id = ?", [m.id]))!;
          const derivado = derivarLinha(m.linha, dataReferencia(raiz), vigenciaArquivos);
          expect(linha.vigente).toBe(derivado.vigente);
          expect(JSON.parse(linha.normas_json)).toMatchObject(derivado);
        }
      }),
    );

    it.effect("vigência de cada ato em cada data em que o status pode mudar (e na véspera)", () =>
      Effect.gen(function* () {
        const atos = atosComVigencia(raiz);
        expect(atos.length).toBeGreaterThan(60);
        const relacoes = carregarRelacoes(raiz);
        for (const ato of atos) {
          const datas = new Set(["1990-01-01", "2026-11-01", "2026-11-12", dataReferencia(raiz), "2030-01-01"]);
          // as datas dos intervalos gravados e, independentemente deles, as que statusEm compara
          const intervalos = yield* linhasVigencias("SELECT de FROM vigencias WHERE alvo = ?", [ato]);
          const inicio = inicioVigencia(ato, vigenciaArquivos);
          const efeitos = relacoes.filter((r) => r.alvo === ato).map((r) => efeitoDaRelacao(r, vigenciaArquivos));
          const comparadas = [inicio, ...efeitos].flatMap((e) => [e.data, e.minimo]);
          for (const de of [...intervalos.map((i) => i.de), ...comparadas]) {
            if (!de) continue;
            datas.add(de).add(vesperaDe(de));
          }
          for (const data of datas) {
            const arquivo = statusEm(ato, data, vigenciaArquivos);
            const banco = yield* vigenciaNaData(ato, data);
            expect({ ato, data, status: banco?.status, certo: banco?.certo }).toEqual({
              ato,
              data,
              status: arquivo.status,
              certo: arquivo.certo,
            });
          }
        }
      }),
    );

    it.effect("regras de transição (datas e situação) em várias datas", () =>
      Effect.gen(function* () {
        const atos = [...new Set(carregarTransicoes(raiz).flatMap((t) => [t.norma, t.norma_anterior ?? t.norma]))];
        for (const ato of atos) {
          for (const data of ["2021-01-01", "2026-11-01", dataReferencia(raiz), "2028-11-14", "2035-01-01"]) {
            const banco = (yield* transicoesDosAtos([ato], data)).map((t) => [t.id, t.inicio_em, t.fim_em, t.situacao]);
            const arquivo = transicoesAplicaveis(ato, data, vigenciaArquivos).map((t) => [
              t.id,
              t.inicio_em,
              t.fim_em,
              t.situacao,
            ]);
            expect(banco).toEqual(arquivo);
          }
        }
      }),
    );

    it.effect("citação resolvida respeita --vigentes e --situacao, com aviso", () =>
      Effect.gen(function* () {
        const { normas } = yield* servicos;
        const citacao = "Resolução CNE/CP nº 1/2021, art. 20";
        expect((yield* normas.buscar(citacao)).resultados[0]!.dispositivo!.id).toBe("br/cne-cp/res/2021/1#art20");
        // revogada em 2026-11-11 pela Res. CNE/CP nº 2/2026 (data_referencia 2026-11-13)
        const vigentes = yield* normas.buscar(citacao, { vigentes: true });
        expect(vigentes.resultados).toEqual([]);
        expect(vigentes.avisos.join("\n")).toMatch(/br\/cne-cp\/res\/2021\/1.*vigente/);
        // antes da revogação, passa
        const antes = yield* normas.buscar(citacao, { vigentes: true, em: "2025-01-01" });
        expect(antes.resultados[0]!.dispositivo!.id).toBe("br/cne-cp/res/2021/1#art20");
        const situacao = yield* normas.buscar(citacao, { situacao: "stub" });
        expect(situacao.resultados).toEqual([]);
        expect(situacao.avisos.join("\n")).toContain("situação base");
        // dispositivo revogado de norma em vigor
        const revogado = yield* normas.buscar("br/lei/1996/9394#art20", { vigentes: true });
        expect(revogado.resultados).toEqual([]);
        expect(revogado.avisos.join("\n")).toContain("revogado");
        const ldb = yield* normas.buscar("Lei 9.394/1996, art. 3º", { vigentes: true });
        expect(ldb.resultados[0]!.dispositivo!.id).toBe("br/lei/1996/9394#art3");
      }),
    );

    it.effect("ID de norma desconhecido devolve aviso, não busca textual", () =>
      Effect.gen(function* () {
        const { normas } = yield* servicos;
        const r = yield* normas.buscar("br/naoexiste/x");
        expect(r.resultados).toEqual([]);
        expect(r.avisos).toEqual(["ID desconhecido: br/naoexiste/x não está entre as normas da base"]);
        expect((yield* normas.buscar("ifpr/consup/res/1900/1#art1")).avisos[0]).toContain("ID desconhecido");
      }),
    );

    it.effect("FTS dos dispositivos acha o texto com o caput herdado", () =>
      Effect.gen(function* () {
        const { normas } = yield* servicos;
        const { resultados } = yield* normas.buscar("carga horária do estágio profissional supervisionado", {
          limite: 5,
        });
        expect(resultados.some((r) => r.dispositivo?.id.startsWith("br/cne-cp/res/2026/2#art37"))).toBe(true);
      }),
    );
  });

  describe("paridade: os serviços sobre layerBanco e sobre layerArquivos dão a mesma saída", () => {
    it.effect("léxico, tópicos, registro, datas, relações, transições e meta", () =>
      Effect.gen(function* () {
        const banco = yield* paridade(
          Effect.map(FontesNormativas.FontesNormativas, (f) => ({
            sinonimos: f.sinonimos,
            topicosSecoes: f.topicosSecoes,
            topicosFichas: f.topicosFichas,
            registro: f.registro.entradas,
            // o Map é consultado por chave: a ordem de inserção (ID no banco, arquivo no checkout) não conta
            datas: [...f.datas].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
            relacoes: f.relacoes,
            transicoes: f.transicoes,
            dataReferencia: f.dataReferencia,
          })),
        );
        // e os carregadores síncronos dos arquivos (os da compilação) dão o mesmo
        mesmoJson(banco.sinonimos, lerSinonimos(raiz));
        mesmoJson(banco.topicosSecoes, lerTopicosSecoes(raiz));
        mesmoJson(banco.topicosFichas, lerTopicosFichas(raiz));
        mesmoJson(banco.registro, carregarRegistro(raiz).entradas);
        const { meta } = yield* BaseKb.BaseKb;
        expect(meta.versao_esquema).toBe(VERSAO_ESQUEMA);
        expect(meta.linhas["versao_esquema"]).toBe(String(VERSAO_ESQUEMA));
        expect(meta.data_referencia).toBe(dataReferencia(raiz));
        expect([meta.versao, meta.commit, meta.canal]).toEqual([null, null, null]);
        expect(["versao", "commit", "canal"].filter((c) => c in meta.linhas)).toEqual([]);
      }),
    );

    it.effect("resolver e buscar-norma", () =>
      Effect.gen(function* () {
        for (const texto of CITACOES) yield* paridade(Effect.flatMap(servicos, (s) => s.normas.resolver(texto)));
        for (const consulta of [...CITACOES, "estágio supervisionado carga horária"]) {
          yield* paridade(Effect.flatMap(servicos, (s) => s.normas.buscar(consulta)));
        }
      }),
    );

    it.effect("citacoes, vigencia e relacoes", () =>
      Effect.gen(function* () {
        const registro = carregarRegistro(raiz);
        for (const id of NORMAS) {
          for (const confianca of [undefined, 0.9]) {
            const opcoes = confianca === undefined ? {} : { confiancaMinima: confianca };
            const banco = yield* paridade(Effect.flatMap(servicos, (s) => s.ppcs.relatorioCitacoes(id, opcoes)));
            // as citações gravadas no banco são as que o resolvedor acha nos Markdown dos PPCs
            mesmoJson(banco, relatorioCitacoes(id, ppcsQueCitamArquivos(id, { raiz, registro, ...opcoes }), registro));
          }
          for (const em of [undefined, "2020-01-01", "2026-11-01", "2030-01-01"]) {
            yield* paridade(Effect.flatMap(servicos, (s) => s.normas.vigencia(id, em ? { em } : {})));
          }
          yield* paridade(Effect.flatMap(servicos, (s) => s.normas.relacoes(id)));
        }
      }),
    );

    it.effect("vigência de cada ato na data de referência (registro, datas e relações de cada fonte)", () =>
      Effect.gen(function* () {
        for (const ato of atosComVigencia(raiz)) {
          yield* paridade(Effect.flatMap(servicos, (s) => s.normas.vigencia(ato)));
        }
      }),
    );

    it.effect("norma: metadados iguais aos do manifest.json e do stubs.yaml", () =>
      Effect.gen(function* () {
        const { normas } = yield* servicos;
        const manifest = (yield* lerJson("base-conhecimento/manifest.json")) as Record<string, unknown>[];
        const nulo = (valor: unknown) => (valor === undefined ? null : valor);
        for (const item of manifest) {
          const pendencia = nulo(item["vigencia_a_confirmar"]);
          mesmoJson(yield* normas.ficha(String(item["id"])), {
            id: item["id"],
            situacao: "base",
            titulo: item["title"],
            tipo_documento: nulo(item["tipo_documento"]),
            numero: item["numero"] === undefined ? null : String(item["numero"]),
            ano: nulo(item["ano"]),
            orgao: nulo(item["orgao"]),
            jurisdicao: nulo(item["jurisdicao"]),
            data_publicacao: nulo(item["data_publicacao"]),
            status_vigencia: nulo(item["status_vigencia"]),
            ementa: nulo(item["ementa"]),
            fonte_url: nulo(item["fonte_url"]),
            fonte_referencia: nulo(item["fonte_referencia"]),
            path: `base-conhecimento/${String(item["path"])}`,
            pendencia_vigencia: pendencia,
            vigencia_a_confirmar: pendencia !== null || item["status_vigencia"] === "a confirmar",
          });
        }
        const stubs = lerRegistroStubs(caminhoStubs(raiz));
        const vazio = { tipo_documento: null, numero: null, ano: null, orgao: null, jurisdicao: null };
        for (const s of stubs.normas) {
          mesmoJson(yield* normas.ficha(s.id), {
            id: s.id,
            situacao: "stub",
            titulo: s.title,
            ...vazio,
            data_publicacao: s.data_publicacao ?? null,
            status_vigencia: s.status_vigencia,
            ementa: s.ementa,
            fonte_url: s.fonte_url ?? null,
            fonte_referencia: s.fonte_referencia ?? null,
            path: null,
            pendencia_vigencia: null,
            vigencia_a_confirmar: s.status_vigencia === "a confirmar",
          });
        }
        for (const s of stubs.externos) {
          mesmoJson(yield* normas.ficha(s.id), {
            id: s.id,
            situacao: "externo",
            titulo: s.title,
            ...vazio,
            data_publicacao: null,
            status_vigencia: null,
            ementa: s.descricao,
            fonte_url: s.fonte_url ?? null,
            fonte_referencia: s.fonte_referencia ?? null,
            path: null,
            pendencia_vigencia: null,
            vigencia_a_confirmar: false,
          });
        }
        expect((yield* normas.ficha("br/cne-cp/res/2021/1#art20"))?.id).toBe("br/cne-cp/res/2021/1");
        expect(yield* normas.ficha("br/lei/1900/1")).toBeNull();
        // a ficha só lê a tabela `normas`: sobre as fontes dos arquivos, a mesma
        for (const id of NORMAS) yield* paridade(Effect.flatMap(servicos, (s) => s.normas.ficha(id)));
      }),
    );

    it.effect("sucessoras de cada ato: a regra de sucessorasDe sobre relacoes.yaml", () =>
      Effect.gen(function* () {
        const relacoes = carregarRelacoes(raiz);
        for (const ato of atosComVigencia(raiz)) {
          mesmoJson(
            yield* paridade(Effect.flatMap(servicos, (s) => s.normas.sucessoras(ato))),
            sucessorasDe(ato, relacoes),
          );
        }
        const { normas } = yield* servicos;
        expect(yield* normas.sucessoras("br/cne-cp/res/2021/1#art20")).toEqual(["br/cne-cp/res/2026/2"]);
      }),
    );

    it.effect("impacto: igual ao dos arquivos restrito às fichas (o banco não tem os outros textos das skills)", () =>
      Effect.gen(function* () {
        const { normas } = yield* servicos;
        const soFichas = <T extends { arquivos: readonly { arquivo: string }[] }>(r: T): T => ({
          ...r,
          arquivos: r.arquivos.filter((a) => a.arquivo.startsWith(FICHAS_DA_ANALISE)),
        });
        let foraDasFichas = 0;
        for (const id of NORMAS) {
          const [banco, arquivos] = yield* nasDuas(Effect.flatMap(servicos, (s) => s.impacto.daNorma(id)));
          expect(yield* normas.sucessoras(id)).toEqual(arquivos.sucessoras);
          foraDasFichas += arquivos.arquivos.length - soFichas(arquivos).arquivos.length;
          mesmoJson(banco, soFichas(arquivos));
        }
        // sobre os arquivos, o impacto vê também prompts, contratos e validações; sobre o banco, só as fichas
        expect(foraDasFichas).toBeGreaterThan(0);
        const opcoes = { incluirPpcs: false, data: "2026-11-01" };
        const [banco, arquivos] = yield* nasDuas(
          Effect.flatMap(servicos, (s) => s.impacto.daNorma("br/cne-cp/res/2021/1", opcoes)),
        );
        mesmoJson(banco, soFichas(arquivos));
      }),
    );

    it.effect("adequacao-art71: todo curso alcançado tem um indicador, e as citações chegam aos PPCs", () =>
      Effect.gen(function* () {
        for (const incluirTecnologia of [undefined, true]) {
          const opcoes = incluirTecnologia === undefined ? {} : { incluirTecnologia };
          const relatorio = yield* paridade(Effect.flatMap(servicos, (s) => s.cursos.adequacaoArt71(opcoes)));
          const soma = INDICADORES.reduce((total, indicador) => total + relatorio.totais[indicador], 0);
          expect(soma).toBe(relatorio.total);
          expect(relatorio.cursos.every((c) => c.situacao === "ativo" || c.situacao === "em_oferta")).toBe(true);
          // se as citações não casassem com o `markdown_path` dos cursos, todo curso ficaria sem PPC
          expect(relatorio.totais["sem-ppc-convertido"]).toBeLessThan(relatorio.total);
          const enfermagem = relatorio.cursos.find((c) => c.curso === "curso:curitiba/tecnico-em-enfermagem");
          expect(enfermagem).toMatchObject({
            ppc: "institucional/ifpr/ppcs/curitiba/tecnico-em-enfermagem.md",
            indicador: "cita-cne-cp-1-2021",
          });
          expect(enfermagem!.dcn_citadas.map((d) => d.id)).toContain("br/cne-cp/res/2021/1");
        }
      }),
    );

    it.effect("buscar-secoes e pacote-contexto (PPC da base e Markdown fora dela)", () =>
      Effect.gen(function* () {
        const buscas: [string, FiltrosSecoes][] = [
          ["acompanhamento de egressos", { cnct: "tecnico-em-informatica" }],
          ["estágio obrigatório", { ppc: PPC }],
          ["avaliação da aprendizagem", { nivel: "médio", tipo: ["avaliacao"] }],
        ];
        for (const [consulta, filtros] of buscas) {
          yield* paridade(Effect.flatMap(servicos, (s) => s.ppcs.buscarSecoes(consulta, filtros)));
        }
        for (const tarefa of ["CT-CURR-12", "estagio", "grupo-002"]) {
          yield* paridade(Effect.flatMap(servicos, (s) => s.pacote.montar(tarefa, PPC)));
        }
        const arquivo = NodePath.join(raiz, "base-conhecimento/institucional/ifpr/ppcs", `${PPC}.md`);
        const markdown = yield* lerTexto(`base-conhecimento/institucional/ifpr/ppcs/${PPC}.md`);
        for (const tarefa of ["CT-CURR-12", "grupo-001"]) {
          yield* paridade(Effect.flatMap(servicos, (s) => s.pacote.doMarkdown(tarefa, arquivo, markdown)));
        }
      }),
    );

    it.effect("normas citadas por um PPC (ficha_curso): iguais às dos arquivos e às contagens de citacoes", () =>
      Effect.gen(function* () {
        const { ppcs } = yield* servicos;
        const indice = (yield* lerJson("base-conhecimento/institucional/ifpr/ppcs/index.json")) as {
          items: { id: string; path: string }[];
        };
        const registro = carregarRegistro(raiz);
        const amostra = [PPC, ...indice.items.filter((_, i) => i % 25 === 0).map((item) => item.id)];
        for (const ppc of amostra) {
          const item = indice.items.find((i) => i.id === ppc)!;
          const banco = yield* paridade(Effect.flatMap(servicos, (s) => s.ppcs.normasCitadas(ppc)));
          mesmoJson(banco, normasCitadasDoArquivo(item.path, registro, raiz));
          expect(yield* ppcs.normasCitadas(`ppc:${ppc}`)).toEqual(banco);
        }
        for (const norma of (yield* ppcs.normasCitadas(PPC))!) {
          const citante = (yield* ppcs.citacoesDaNorma(norma.id)).find((p) => p.ppc === PPC);
          expect(citante?.ocorrencias.length).toBe(norma.ocorrencias);
        }
        expect(yield* ppcs.normasCitadas("curitiba/nao-existe")).toBeNull();
      }),
    );

    it.effect("seção por ID (ler_secao): a do índice de seções, com o texto lido do Markdown", () =>
      Effect.gen(function* () {
        const { ppcs } = yield* servicos;
        const md = `institucional/ifpr/ppcs/${PPC}.md`;
        const indice = (yield* lerJson("base-conhecimento/institucional/ifpr/ppcs/index.json")) as {
          secoes: { paths: Record<string, string> };
        };
        const doIndice: {
          id: string;
          section_kind: string;
          heading: string;
          linha_inicio: number;
          linha_fim: number;
        }[] = [];
        for (const arquivo of Object.values(indice.secoes.paths)) {
          for (const linha of yield* linhasDe(`base-conhecimento/${arquivo}`)) {
            if (!linha.trim()) continue;
            const secao = JSON.parse(linha) as (typeof doIndice)[number] & { path: string };
            if (secao.path === md) doIndice.push(secao);
          }
        }
        doIndice.sort((a, b) => a.linha_inicio - b.linha_inicio || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        expect(doIndice.length).toBeGreaterThan(10);
        expect((yield* ppcs.indiceSecoesDoPpc(PPC)).map((s) => s.id)).toEqual(doIndice.map((s) => s.id));
        const cache = new Map<string, string>();
        for (const [i, esperada] of doIndice.entries()) {
          const lida = (yield* ppcs.lerSecao(esperada.id))!;
          expect({
            tipo: lida.tipo,
            titulo: lida.titulo,
            path: lida.path,
            linha_inicio: lida.linha_inicio,
            linha_fim: lida.linha_fim,
            anterior: lida.anterior,
            proxima: lida.proxima,
          }).toEqual({
            tipo: esperada.section_kind,
            titulo: esperada.heading,
            path: `base-conhecimento/${md}`,
            linha_inicio: esperada.linha_inicio,
            linha_fim: esperada.linha_fim,
            anterior: doIndice[i - 1]?.id ?? null,
            proxima: doIndice[i + 1]?.id ?? null,
          });
          expect(lida.texto).toBe(lerTextoSecao({ path: md, ...esperada }, { raiz, cache }));
          // o texto vai de linha_texto a linha_fim, linha a linha
          if (lida.texto) expect(lida.texto.split("\n").length).toBe(lida.linha_fim - lida.linha_texto + 1);
        }
        expect(yield* ppcs.lerSecao(`${PPC}#nao-existe`)).toBeNull();
      }),
    );

    it.effect("fatos de PPC por campus: o mesmo recorte do filtro sobre todos", () =>
      Effect.gen(function* () {
        const { ppcs } = yield* servicos;
        const todos = yield* ppcs.fatos();
        mesmoJson(
          yield* ppcs.fatos({ campus: "curitiba" }),
          todos.filter((p) => p.ppc.startsWith("ppc:curitiba/")),
        );
        const divergencias = yield* ppcs.divergencias({ nivel: "médio", campus: "curitiba" });
        expect(divergencias.ppcs.every((p) => p.ppc.startsWith("ppc:curitiba/") && p.nivel === "médio")).toBe(true);
        // sem campus, igual ao comando da CLI
        mesmoJson(yield* ppcs.divergencias({}), yield* ppcs.divergencias());
      }),
    );

    it.effect("meta: versao, commit e canal só quando informados no build", () =>
      Effect.gen(function* () {
        const { c } = yield* Compilados;
        const { meta } = yield* BaseKb.BaseKb;
        const comVersao = yield* Effect.provide(
          BaseKb.BaseKb,
          // `fresh`: sem ele, o memo do bloco devolveria o `BaseKb` já montado sobre o banco `a`
          Layer.fresh(BaseKb.layer.pipe(Layer.provide(BaseKb.layerSqlite({ caminho: c })))),
        );
        const { versao, commit, canal, linhas, ...resto } = comVersao.meta;
        expect([versao, commit, canal]).toEqual(["2026.11.13", "0123abcd", "beta"]);
        expect([linhas["versao"], linhas["commit"], linhas["canal"]]).toEqual(["2026.11.13", "0123abcd", "beta"]);
        const { versao: _v, commit: _c, canal: _k, linhas: linhasSem, ...restoSem } = meta;
        expect(resto).toEqual(restoSem);
        const { versao: _lv, commit: _lc, canal: _lk, ...outrasLinhas } = linhas;
        expect(outrasLinhas).toEqual(linhasSem);
      }),
    );
  });

  describe("sem o repositório (layerSomenteLeitura)", () => {
    it("o tipo garante que a layer não exige FileSystem nem Path", () => {
      expectTypeOf<Layer.Services<ReturnType<typeof Layers.layerSomenteLeitura>>>().toEqualTypeOf<never>();
      expectTypeOf<Layer.Services<typeof FontesNormativas.layerBanco>>().toEqualTypeOf<SqlClient.SqlClient>();
      // contraprova: a fonte dos arquivos exige o sistema de arquivos, e o tipo mostra
      expectTypeOf<Layer.Services<ReturnType<typeof FontesNormativas.layerArquivos>>>().toEqualTypeOf<
        FileSystem.FileSystem | Path.Path
      >();
      expectTypeOf<
        Layer.Success<ReturnType<typeof Layers.layerSomenteLeitura>>
      >().toEqualTypeOf<Layers.ServicosConsulta>();
    });

    it.effect("todas as consultas a partir de uma cópia do banco num diretório vazio", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { a } = yield* Compilados;
        const markdown = yield* lerTexto(`base-conhecimento/institucional/ifpr/ppcs/${PPC}.md`);
        const esperado = JSON.stringify(yield* todasAsConsultas(markdown));
        const vazio = yield* fs.makeTempDirectoryScoped({ prefix: "kb-sem-repo-" });
        const caminho = path.join(vazio, "kb.sqlite");
        yield* fs.copyFile(a, caminho);
        const obtido = yield* Effect.provide(todasAsConsultas(markdown), Layers.layerSomenteLeitura({ caminho }));
        expect(JSON.stringify(obtido)).toBe(esperado);
        expect(yield* fs.readDirectory(vazio)).toEqual(["kb.sqlite"]);
        const ausente = yield* Effect.flip(
          Effect.provide(BaseKb.BaseKb, Layers.layerSomenteLeitura({ caminho: path.join(vazio, "nao-existe.sqlite") })),
        );
        expect(ausente._tag).toBe("BaseAusente");
        expect(ausente.message).toContain("não encontrado");
      }),
    );
  });

  describe("num executável (Node SEA, pelo vp pack), só com o kb.sqlite", () => {
    it.effect("o executável roda num diretório vazio e dá a mesma saída que o processo", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { a } = yield* Compilados;
        // a entrada fica em `node_modules/.cache` do pacote, fora do código, para que `effect` se resolva
        // para o mesmo módulo que as layers importam; ela importa as layers e as consultas pelo caminho absoluto
        const cache = path.join(import.meta.dirname, "../../node_modules/.cache");
        yield* fs.makeDirectory(cache, { recursive: true });
        const trabalho = yield* fs.realPath(
          yield* fs.makeTempDirectoryScoped({ directory: cache, prefix: "kb-binario-" }),
        );
        const vazio = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "kb-binario-vazio-" }));
        const entrada = path.join(trabalho, "entrada.ts");
        const modulo = (relativo: string) => JSON.stringify(path.join(import.meta.dirname, relativo));
        yield* fs.writeFileString(
          entrada,
          `import * as Effect from "effect/Effect";
import * as Layers from ${modulo("../layers.ts")};
import { consultasDoExecutavel } from ${modulo("../testes/consultas.ts")};
Effect.runPromise(Effect.provide(consultasDoExecutavel, Layers.layerSomenteLeitura({ caminho: process.argv[2] }))).then(
  (saida) => console.log(JSON.stringify(saida)),
  (erro) => {
    console.error(erro);
    process.exitCode = 1;
  },
);
`,
        );
        // um só chunk, com as dependências dentro: o SEA só resolve os módulos internos do Node
        yield* Effect.promise(() =>
          empacotar({
            entry: [entrada],
            cwd: path.join(import.meta.dirname, "../.."),
            config: false,
            outDir: path.join(trabalho, "dist"),
            platform: "node",
            logLevel: "error",
            report: false,
            deps: { alwaysBundle: () => true, onlyBundle: false },
            outputOptions: { codeSplitting: false },
            // num bundle, todo módulo é o principal: os `if (import.meta.main)` das CLIs (como o de
            // `compilar.ts`) não podem rodar; o Bun fazia essa troca sozinho no `--compile`
            define: { "import.meta.main": "false" },
            exe: { fileName: "kb-modo-banco", outDir: vazio, seaConfig: { useCodeCache: false } },
          }),
        );
        const binario = path.join(vazio, "kb-modo-banco");
        yield* fs.copyFile(a, path.join(vazio, "kb.sqlite"));
        const execucao = NodeChildProcess.spawnSync(binario, ["kb.sqlite"], {
          cwd: vazio,
          env: {},
          encoding: "utf-8",
          maxBuffer: 256 * 1024 * 1024,
        });
        expect(execucao.status, execucao.stderr).toBe(0);
        expect(execucao.stdout.trim()).toBe(JSON.stringify(yield* consultasDoExecutavel));
      }),
    );
  });
});
