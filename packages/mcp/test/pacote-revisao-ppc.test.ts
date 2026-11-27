// @effect-diagnostics nodeBuiltinImport:off -- teste: monta a pasta de trabalho, com arquivos e links simbólicos, no disco
/**
 * `pacote_revisao_ppc` (T4) sobre a fixture de PPCs: contrato (entradas válidas e inválidas, saída no
 * outputSchema), determinismo, orçamento do texto (80 mil caracteres), a pasta de trabalho (`..`,
 * caminho absoluto, link simbólico para fora, arquivo inexistente) e `ppc` contra `arquivo`; na
 * base real, em `transversal/base-real.test.ts`.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, describe, expect, it, test } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ehEntradaInvalida } from "../src/contratos.ts";
import {
  corpoDoPacote,
  type PacoteDaBase,
  pacoteRevisaoPpc,
  TETO_PACOTE_REVISAO_PPC,
} from "../src/ferramentas/pacote-revisao-ppc.ts";
import { layerHandlers } from "../src/ferramentas/toolkit.ts";
import { layerLeituraComPasta } from "../src/servidor.ts";
import { camadaFerramentas, mensagemDeErro, responder, saidaValida } from "./apoio.ts";
import { diretorioTemporario, limparTemporarios } from "./fixture.ts";
import { criarBancoFixturePpcs, PPC_ENFERMAGEM } from "./fixture-ppcs.ts";

afterEach(limparTemporarios);

/** Um PPC mínimo em Markdown, para o `arquivo`. */
const MARKDOWN = [
  "# Projeto Pedagógico do Curso Técnico em Enfermagem",
  "",
  "## 1 Organização curricular",
  "",
  "A organização curricular do curso progride do básico ao específico, conforme a Resolução CNE/CP nº 1/2021, art. 20.",
  "",
  "## 2 Estágio",
  "",
  "O estágio supervisionado obrigatório tem 400 horas.",
  "",
].join("\n");

/** O banco, a pasta de trabalho (com `PPC.md`) e um diretório vizinho, fora da pasta. */
function ambiente() {
  const raiz = diretorioTemporario();
  const pasta = NodePath.join(raiz, "trabalho");
  const fora = NodePath.join(raiz, "fora");
  NodeFS.mkdirSync(NodePath.join(pasta, "rodada"), { recursive: true });
  NodeFS.mkdirSync(fora);
  NodeFS.writeFileSync(NodePath.join(pasta, "PPC.md"), MARKDOWN);
  NodeFS.writeFileSync(NodePath.join(pasta, "rodada", "PPC.md"), MARKDOWN);
  NodeFS.writeFileSync(NodePath.join(fora, "segredo.md"), MARKDOWN);
  return { banco: criarBancoFixturePpcs(), pasta, fora };
}

/** Os handlers e o `Leitura` com a pasta de trabalho, sobre o sistema de arquivos do Node. */
const comPasta = (banco: string, pasta: string) =>
  layerHandlers.pipe(
    Layer.provideMerge(layerLeituraComPasta({ banco, canal: "dev", pastaTrabalho: pasta })),
    Layer.provide(NodeServices.layer),
  );

const chamar = (args: unknown, banco: string, pasta: string) =>
  Effect.gen(function* () {
    const r = yield* responder(pacoteRevisaoPpc, args).pipe(Effect.provide(comPasta(banco, pasta)));
    if (!saidaValida(pacoteRevisaoPpc, r.resposta)) throw new Error("pacote_revisao_ppc: saída fora do outputSchema");
    expect(r.texto.length).toBeLessThanOrEqual(TETO_PACOTE_REVISAO_PPC);
    expect(r.texto.split("\n").at(-1)).toBe("Base de desenvolvimento (versão `dev-ab12cd34`).");
    return r;
  });

/** A mensagem de uma chamada que falha, conferido que o erro é `EntradaInvalida`. */
const erroDeEntrada = (args: unknown, banco: string, pasta: string) =>
  Effect.gen(function* () {
    const camada = comPasta(banco, pasta);
    const erro = yield* Effect.flip(responder(pacoteRevisaoPpc, args).pipe(Effect.provide(camada)));
    expect(ehEntradaInvalida(erro)).toBe(true);
    return yield* mensagemDeErro(pacoteRevisaoPpc, args).pipe(Effect.provide(camada));
  });

describe("pacote_revisao_ppc: contrato", () => {
  it.effect("PPC da base: o pacote do kb, com a ficha e o tamanho do PPC inteiro", () =>
    Effect.gen(function* () {
      const { banco, pasta } = ambiente();
      const { resposta, texto } = yield* chamar({ tarefa: "CT-CURR-12", ppc: PPC_ENFERMAGEM }, banco, pasta);
      const dados = resposta.dados as PacoteDaBase;
      expect(dados.tarefa).toBe("CT-CURR-12");
      expect(dados.fichas_ids).toEqual(["CT-CURR-12"]);
      expect(dados.ppc.id).toBe(`ppc:${PPC_ENFERMAGEM}`);
      expect(dados.tamanho.caracteres_ppc_inteiro).toBe(12000);
      expect(texto).toContain("**Pacote de contexto da revisão de PPC: CT-CURR-12**");
      // a ficha da fixture não traz o título no JSON
      expect(texto).toContain("### CT-CURR-12\n");
      expect(texto).toContain(`ifpr://ppc/${PPC_ENFERMAGEM}`);
    }),
  );

  it.effect("aceita o PPC como link ifpr:// ou com o prefixo ppc:", () =>
    Effect.gen(function* () {
      const { banco, pasta } = ambiente();
      const a = yield* chamar({ tarefa: "CT-CURR-12", ppc: PPC_ENFERMAGEM }, banco, pasta);
      const b = yield* chamar({ tarefa: "CT-CURR-12", ppc: `ifpr://ppc/${PPC_ENFERMAGEM}` }, banco, pasta);
      const c = yield* chamar({ tarefa: "CT-CURR-12", ppc: `ppc:${PPC_ENFERMAGEM}` }, banco, pasta);
      expect(b.resposta).toEqual(a.resposta);
      expect(c.resposta).toEqual(a.resposta);
    }),
  );

  it.effect("arquivo: o pacote do .md, com o caminho relativo à pasta de trabalho", () =>
    Effect.gen(function* () {
      const { banco, pasta } = ambiente();
      const { resposta, texto } = yield* chamar({ tarefa: "CT-CURR-12", arquivo: "rodada/PPC.md" }, banco, pasta);
      const dados = resposta.dados as { path: string; tamanho: { caracteres_ppc_inteiro: number } };
      expect(dados.path).toBe("rodada/PPC.md");
      expect(dados.tamanho.caracteres_ppc_inteiro).toBe(MARKDOWN.length);
      expect(texto).toContain("arquivo `rodada/PPC.md` (PPC fora da base");
    }),
  );

  it.effect("exatamente um de ppc e arquivo", () =>
    Effect.gen(function* () {
      const { banco, pasta } = ambiente();
      const esperada =
        'informe exatamente um destes: ppc (um PPC da base, como "curitiba/tecnico-em-enfermagem") ou arquivo (um .md dentro da pasta de trabalho do servidor)';
      expect(yield* erroDeEntrada({ tarefa: "CT-CURR-12" }, banco, pasta)).toBe(esperada);
      expect(yield* erroDeEntrada({ tarefa: "CT-CURR-12", ppc: PPC_ENFERMAGEM, arquivo: "PPC.md" }, banco, pasta)).toBe(
        esperada,
      );
    }),
  );

  it.effect("tarefa e PPC desconhecidos: mensagem legível", () =>
    Effect.gen(function* () {
      const { banco, pasta } = ambiente();
      expect(yield* erroDeEntrada({ tarefa: "CT-XXXX-99", ppc: PPC_ENFERMAGEM }, banco, pasta)).toBe(
        "tarefa não reconhecida (ficha, tópico ou todas): CT-XXXX-99",
      );
      expect(yield* erroDeEntrada({ tarefa: "CT-CURR-12", ppc: "curitiba/inexistente" }, banco, pasta)).toBe(
        'PPC não encontrado: ppc:curitiba/inexistente. Use "campus/curso/versao" (como "curitiba/tecnico-em-enfermagem/2023") ou o curso, "campus/curso", para o PPC vigente, vindo de listar_cursos ou de ficha_curso',
      );
      expect(yield* erroDeEntrada({ tarefa: "CT-CURR-12", ppc: "só-um-segmento" }, banco, pasta)).toMatch(
        /^ppc: esperava "campus\/curso\/versao"/,
      );
    }),
  );

  it.effect("entrada fora do schema: erro do transporte, em português", () =>
    Effect.gen(function* () {
      const { banco, pasta } = ambiente();
      const camada = comPasta(banco, pasta);
      expect(yield* mensagemDeErro(pacoteRevisaoPpc, { ppc: PPC_ENFERMAGEM }).pipe(Effect.provide(camada))).toMatch(
        /tarefa/,
      );
      expect(
        yield* mensagemDeErro(pacoteRevisaoPpc, { tarefa: "CT-CURR-12", ppc: PPC_ENFERMAGEM, extra: 1 }).pipe(
          Effect.provide(camada),
        ),
      ).toMatch(/extra/);
    }),
  );

  it.effect("sem pasta de trabalho (o Leitura do app), arquivo é recusado e ppc funciona", () =>
    Effect.gen(function* () {
      const { banco } = ambiente();
      const camada = camadaFerramentas(banco);
      const erro = yield* mensagemDeErro(pacoteRevisaoPpc, { tarefa: "CT-CURR-12", arquivo: "PPC.md" }).pipe(
        Effect.provide(camada),
      );
      expect(erro).toBe(
        "arquivo: este servidor não tem pasta de trabalho e não lê arquivos; use ppc, com um PPC da base",
      );
      const { resposta } = yield* responder(pacoteRevisaoPpc, { tarefa: "CT-CURR-12", ppc: PPC_ENFERMAGEM }).pipe(
        Effect.provide(camada),
      );
      expect((resposta.dados as PacoteDaBase).fichas_ids).toEqual(["CT-CURR-12"]);
    }),
  );
});

describe("pacote_revisao_ppc: pasta de trabalho", () => {
  it.effect("recusa .. para fora da pasta, mesmo com o arquivo existindo", () =>
    Effect.gen(function* () {
      const { banco, pasta } = ambiente();
      for (const arquivo of ["../fora/segredo.md", "rodada/../../fora/segredo.md"]) {
        const erro = yield* erroDeEntrada({ tarefa: "CT-CURR-12", arquivo }, banco, pasta);
        expect(erro).toContain(`arquivo: "${arquivo}" fica fora da pasta de trabalho`);
      }
    }),
  );

  it.effect("recusa caminho absoluto fora da pasta e aceita o absoluto dentro dela", () =>
    Effect.gen(function* () {
      const { banco, pasta, fora } = ambiente();
      const absoluto = NodePath.join(fora, "segredo.md");
      expect(yield* erroDeEntrada({ tarefa: "CT-CURR-12", arquivo: absoluto }, banco, pasta)).toContain(
        "fica fora da pasta de trabalho",
      );
      const dentro = yield* chamar(
        { tarefa: "CT-CURR-12", arquivo: NodePath.join(pasta, "rodada", "PPC.md") },
        banco,
        pasta,
      );
      expect((dentro.resposta.dados as { path: string }).path).toBe("rodada/PPC.md");
    }),
  );

  it.effect("recusa link simbólico dentro da pasta que aponta para fora", () =>
    Effect.gen(function* () {
      const { banco, pasta, fora } = ambiente();
      NodeFS.symlinkSync(NodePath.join(fora, "segredo.md"), NodePath.join(pasta, "atalho.md"));
      NodeFS.symlinkSync(fora, NodePath.join(pasta, "pasta-de-fora"));
      for (const arquivo of ["atalho.md", "pasta-de-fora/segredo.md"]) {
        expect(yield* erroDeEntrada({ tarefa: "CT-CURR-12", arquivo }, banco, pasta)).toContain(
          `arquivo: "${arquivo}" é um link simbólico para fora da pasta de trabalho`,
        );
      }
      // link simbólico que fica dentro da pasta é aceito
      NodeFS.symlinkSync(NodePath.join(pasta, "PPC.md"), NodePath.join(pasta, "interno.md"));
      const r = yield* chamar({ tarefa: "CT-CURR-12", arquivo: "interno.md" }, banco, pasta);
      expect((r.resposta.dados as { path: string }).path).toBe("interno.md");
    }),
  );

  it.effect("arquivo inexistente, que não é .md ou que é pasta", () =>
    Effect.gen(function* () {
      const { banco, pasta } = ambiente();
      expect(yield* erroDeEntrada({ tarefa: "CT-CURR-12", arquivo: "nao-existe.md" }, banco, pasta)).toMatch(
        /^arquivo: "nao-existe\.md" não existe na pasta de trabalho \(/,
      );
      expect(yield* erroDeEntrada({ tarefa: "CT-CURR-12", arquivo: "PPC.docx" }, banco, pasta)).toBe(
        'arquivo: esperava um arquivo .md (o PPC convertido para Markdown), veio "PPC.docx"',
      );
      NodeFS.mkdirSync(NodePath.join(pasta, "pasta.md"));
      expect(yield* erroDeEntrada({ tarefa: "CT-CURR-12", arquivo: "pasta.md" }, banco, pasta)).toBe(
        'arquivo: "pasta.md" não é um arquivo',
      );
    }),
  );
});

describe("pacote_revisao_ppc: ppc contra arquivo", () => {
  it.effect(
    "as fichas e as normas não dependem de onde vem o PPC (marcos e transições dependem das citações do PPC: ver o smoke)",
    () =>
      Effect.gen(function* () {
        const { banco, pasta } = ambiente();
        const daBase = (yield* chamar({ tarefa: "CT-CURR-12", ppc: PPC_ENFERMAGEM }, banco, pasta)).resposta.dados;
        const doArquivo = (yield* chamar({ tarefa: "CT-CURR-12", arquivo: "PPC.md" }, banco, pasta)).resposta.dados;
        for (const parte of ["fichas_ids", "fichas", "normas", "vigencia_em"] as const) {
          expect(doArquivo[parte]).toEqual(daBase[parte]);
        }
        // as seções do arquivo são do banco em memória do kb (`ppc:avulso`)
        for (const s of doArquivo.secoes) expect(s.id.startsWith("ppc:avulso#")).toBe(true);
        expect("tarefa" in doArquivo).toBe(false);
      }),
  );
});

describe("pacote_revisao_ppc: determinismo", () => {
  it.effect("mesma entrada e mesmo banco: mesma saída, byte a byte", () =>
    Effect.gen(function* () {
      const { banco, pasta } = ambiente();
      for (const args of [
        { tarefa: "CT-CURR-12", ppc: PPC_ENFERMAGEM },
        { tarefa: "todas", arquivo: "PPC.md" },
      ]) {
        const a = yield* chamar(args, banco, pasta);
        const b = yield* chamar(args, banco, pasta);
        expect(JSON.stringify(b.resposta)).toBe(JSON.stringify(a.resposta));
        expect(b.texto).toBe(a.texto);
      }
    }),
  );
});

describe("pacote_revisao_ppc: orçamento", () => {
  /** Pacote sintético: `secoes` seções de `tamanhoSecao` caracteres e fichas de `tamanhoFicha`. */
  const sintetico = (secoes: number, tamanhoSecao: number, tamanhoFicha = 100): PacoteDaBase => ({
    tarefa: "todas",
    fichas_ids: ["CT-A-01"],
    ppc: {
      id: `ppc:${PPC_ENFERMAGEM}`,
      curso_nome: "Técnico em Enfermagem",
      campus_nome: "Curitiba",
      nivel: "médio",
      tipo_oferta: "subsequente",
      path: "base-conhecimento/institucional/ifpr/ppcs/curitiba/tecnico-em-enfermagem/2023.md",
      curso_id: null,
      ano_documento: 2023,
      cnct_id: null,
    },
    cnct: null,
    fichas: [{ id: "CT-A-01", titulo: "Ficha", pergunta: "x".repeat(tamanhoFicha) }],
    normas: [
      {
        ref: "br/cne-cp/res/2026/2",
        titulo: "Resolução CNE/CP nº 2/2026",
        status_vigencia: "vigente",
        path: "base-conhecimento/normas/x.md",
        fichas: ["CT-A-01"],
        dispositivos: [
          {
            id: "br/cne-cp/res/2026/2#art9",
            fichas: ["CT-A-01"],
            texto: "Art. 9º curto.",
            path: "base-conhecimento/normas/x.md",
            linha_inicio: 1,
            linha_fim: 1,
          },
        ],
        sem_texto: [],
      },
    ],
    marcos: [],
    vigencia_em: "2026-11-13",
    transicoes: [],
    secoes: Array.from({ length: secoes }, (_, i) => ({
      id: `${PPC_ENFERMAGEM}#secao-${i + 1}`,
      tipo: "outros",
      titulo: `Seção ${i + 1}`,
      path: "base-conhecimento/institucional/ifpr/ppcs/curitiba/tecnico-em-enfermagem/2023.md",
      linha_inicio: 10 * i + 1,
      linha_fim: 10 * i + 9,
      motivo: ["topico:teste"],
      texto: Array.from({ length: Math.ceil(tamanhoSecao / 80) }, () => "y".repeat(79)).join("\n"),
    })),
    fatos: null,
    tamanho: { caracteres: 0, secoes, caracteres_secoes: secoes * tamanhoSecao, caracteres_ppc_inteiro: 1 },
  });

  test("abaixo do teto, nada é cortado", () => {
    const { texto, resumido } = corpoDoPacote(sintetico(3, 2000), 78000);
    expect(resumido).toBe(false);
    expect(texto).not.toContain("[cortado");
  });

  test("acima do teto, as seções longas são cortadas por igual e cada uma continua com o ID e a fonte", () => {
    const orcamento = 78000;
    const { texto, resumido } = corpoDoPacote(sintetico(40, 6000), orcamento);
    expect(resumido).toBe(true);
    expect(texto.length).toBeLessThanOrEqual(orcamento);
    expect(texto.length).toBeGreaterThan(orcamento * 0.9);
    for (let i = 1; i <= 40; i += 1) {
      expect(texto).toContain(`ler_secao("${PPC_ENFERMAGEM}#secao-${i}")`);
      expect(texto).toContain(`tecnico-em-enfermagem/2023.md:${10 * (i - 1) + 1}-${10 * (i - 1) + 9}`);
    }
    // o dispositivo curto não é cortado
    expect(texto).toContain("> Art. 9º curto.");
  });

  test("se nem as partes fixas cabem, corta o fim do texto com a explicação", () => {
    const orcamento = 78000;
    const { texto, resumido } = corpoDoPacote(sintetico(5, 1000, 200000), orcamento);
    expect(resumido).toBe(true);
    expect(texto.length).toBeLessThanOrEqual(orcamento);
    expect(texto.endsWith("peça uma ficha ou um tópico]")).toBe(true);
  });
});
