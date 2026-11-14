/**
 * Testes de contrato: o registro, as descrições, os schemas e as duas ferramentas do T1, chamadas
 * diretamente e pelo protocolo (Client do SDK ligado ao servidor em memória).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { z } from "zod";
import { ErroEntrada } from "../src/envelope.ts";
import { FERRAMENTAS } from "../src/ferramentas/index.ts";
import { etapa } from "../src/ferramentas/etapa.ts";
import { sobreABase } from "../src/ferramentas/sobre-a-base.ts";
import { criarContexto, criarServidor, INSTRUCOES, NOME_SERVIDOR, VERSAO_PACOTE } from "../src/servidor.ts";
import { CONTAGENS, criarBancoFixture, diretorioTemporario, limparTemporarios } from "./fixture.ts";

afterEach(limparTemporarios);

/** As 16 ferramentas da especificação M0.1, na ordem da tabela "Ferramentas". */
const PREVISTAS = [
  "buscar_norma",
  "ler_dispositivos",
  "ficha_norma",
  "correspondencia",
  "resolver_citacoes",
  "citacoes_da_norma",
  "impacto_da_norma",
  "adequacao_art71",
  "buscar_secoes",
  "ler_secao",
  "listar_cursos",
  "ficha_curso",
  "fatos_ppc",
  "pacote_contexto",
  "sobre_a_base",
  "etapa",
];

/** Descrições da especificação sem a palavra "Use". */
const SEM_USE = new Set([
  "ficha_norma",
  "correspondencia",
  "citacoes_da_norma",
  "adequacao_art71",
  "ler_secao",
  "ficha_curso",
  "fatos_ppc",
]);

/** Texto exato da especificação (seção "Ferramentas"): mudar a descrição muda o comportamento do modelo. */
const DESCRICOES: Record<string, string> = {
  buscar_norma:
    'Busca na legislação e nas normas da base do IFPR. Uma citação ou um ID ("Res. CNE/CP 2/2026, art. 28, VII", "br/lei/1996/9394#art36") vai direto ao dispositivo; termos fazem busca textual nos dispositivos e nos metadados das normas. Use antes de afirmar qualquer obrigação normativa. Devolve o texto literal, com o caput herdado.',
  ler_dispositivos:
    "Lê dispositivos pelo ID (até 20 por chamada), com o caput herdado, as notas de redação e, se pedido, os incisos, alíneas e parágrafos. Use quando já tiver o ID, vindo de `buscar_norma`, de `resolver_citacoes` ou de uma ficha.",
  ficha_norma:
    "Situação de uma norma numa data: a vigência, com o que a determina e o que está a confirmar; as relações com outras normas nos dois sentidos (revoga, altera, regulamenta, fundamenta-se em); as normas sucessoras; e as regras de transição. Norma revogada não é inaplicável: confira as transições antes de concluir.",
  correspondencia:
    "Dispositivo correspondente na norma sucessora, por exemplo do art. 20 da Res. CNE/CP 1/2021 para a Res. CNE/CP 2/2026. A tabela é rascunho, sem revisão jurídica: use como indicação, nunca como fundamento.",
  resolver_citacoes:
    "Identifica citações normativas escritas em texto livre (até 50 por chamada) e devolve o ID canônico, o dispositivo, a regra usada e a confiança. Use para conferir a fundamentação de um documento. Confiança abaixo de 0,9 pede conferência no trecho original.",
  citacoes_da_norma:
    "PPCs da base que citam uma norma ou um dispositivo, com linha, trecho e confiança. Sem `ppc`, devolve um resumo por PPC; com `ppc`, as ocorrências.",
  impacto_da_norma:
    'O que uma norma (revogada, alterada ou nova) atinge na base: os PPCs que a citam, as fichas da `revisar-ppc`, as normas que a citam, as relações, as sucessoras e as transições. Use para responder "o que muda com esta norma".',
  adequacao_art71:
    "Cursos técnicos em oferta alcançados pelo art. 71 da Res. CNE/CP nº 2/2026, que dá prazo de adequação, com a DCN que cada PPC cita. Sem filtros, devolve os totais por indicador; filtre por campus, curso ou indicador para ver a lista.",
  buscar_secoes:
    "Busca trechos dos PPCs da base (todos os campi e níveis), com radicais e sinônimos por tipo de seção. Use para ver como outros cursos escreveram uma seção (estágio, egressos, avaliação…). PPCs são exemplos institucionais, não norma.",
  ler_secao: "Lê uma seção inteira de PPC pelo ID, vindo de `buscar_secoes` ou de um link `ifpr://ppc/…#secao`.",
  listar_cursos:
    "Cursos do IFPR na base, com CNCT, eixo, ofertas e turno. Use filtros: a lista sem filtro é longa. Para os detalhes de um curso, use `ficha_curso`.",
  ficha_curso:
    "Tudo sobre um curso do IFPR: dados institucionais, PPC vigente, CNCT, ofertas, fatos do PPC cruzados com o SUAP (divergências), normas que o PPC cita e prazos de adequação.",
  fatos_ppc:
    "Fatos extraídos de PPCs (carga horária, estágio, ano), com o trecho de origem, cruzados com as matrizes do SUAP publicadas na base. Os fatos são extraídos por regra, sem revisão humana: confira o trecho antes de afirmar uma divergência.",
  sobre_a_base:
    "Versão, data de referência e conteúdo da base. Use quando o usuário (um servidor do IFPR) perguntar o que a base contém ou de quando ela é.",
  etapa: "Informa ao app em que etapa da tarefa você está. Use só quando a skill pedir.",
};

function contexto() {
  return criarContexto({ banco: criarBancoFixture(), pastaTrabalho: diretorioTemporario(), canal: "dev" });
}

describe("registro", () => {
  test("nomes únicos, em snake_case e previstos na especificação", () => {
    const nomes = FERRAMENTAS.map((f) => f.nome);
    expect(new Set(nomes).size).toBe(nomes.length);
    for (const nome of nomes) {
      expect(nome).toMatch(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);
      expect(PREVISTAS).toContain(nome);
    }
    // na ordem da tabela da especificação
    expect(nomes).toEqual(PREVISTAS.filter((nome) => nomes.includes(nome)));
    // todas as previstas menos `pacote_contexto` (T4)
    for (const nome of PREVISTAS.filter((nome) => nome !== "pacote_contexto")) {
      expect(nomes).toContain(nome);
    }
  });

  test("descrições: texto da especificação e curtas", () => {
    for (const f of FERRAMENTAS) {
      expect(f.descricao).toBe(DESCRICOES[f.nome]!);
      expect(f.descricao.length).toBeLessThanOrEqual(600);
      // A especificação dá "quando usar" em todas, mas estas dizem isso sem a palavra "Use".
      if (!SEM_USE.has(f.nome)) expect(f.descricao).toMatch(/\bUse\b/);
      expect(f.titulo.length).toBeGreaterThan(0);
    }
  });

  test("anotações: só leitura, idempotente, mundo fechado", () => {
    for (const f of FERRAMENTAS) {
      expect(f.anotacoes).toEqual({
        title: f.titulo,
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
  });

  test("entrada e saída viram JSON Schema de objeto", () => {
    for (const f of FERRAMENTAS) {
      expect(z.toJSONSchema(f.entrada, { io: "input" })).toMatchObject({ type: "object" });
      expect(z.toJSONSchema(f.saida, { io: "output" })).toMatchObject({
        type: "object",
        required: ["base", "dados", "avisos"],
      });
    }
  });
});

describe("sobre_a_base", () => {
  test("saída válida no outputSchema, com contagens, tipos, níveis e campi ordenados", () => {
    const ctx = contexto();
    const { resposta } = sobreABase.responder({}, ctx);
    expect(sobreABase.saida.safeParse(resposta).success).toBe(true);
    expect(resposta.base).toEqual({
      versao: "dev-ab12cd34",
      commit: null,
      data_referencia: "2026-11-13",
      canal: "dev",
    });
    expect(resposta.avisos).toEqual([]);
    expect(resposta.dados).toEqual({
      contagens: CONTAGENS,
      tipos_de_secao: ["avaliacao", "estagio_praticas"],
      niveis: ["médio", "superior"],
      campi: [
        { id: "assis-chateaubriand", nome: "Assis Chateaubriand", link: "ifpr://campus/assis-chateaubriand" },
        { id: "curitiba", nome: "Curitiba", link: "ifpr://campus/curitiba" },
        { id: "foz-do-iguacu", nome: "Foz do Iguaçu", link: "ifpr://campus/foz-do-iguacu" },
      ],
    });
  });

  test("texto: conteúdo, filtros com links e rodapé", () => {
    const { texto } = sobreABase.responder({}, contexto());
    expect(texto).toContain("versão `dev-ab12cd34` (canal dev)");
    expect(texto).toContain("Conteúdo: 1 PPCs, 3 seções de PPC, 2 cursos, 3 campi.");
    expect(texto).toContain("[Foz do Iguaçu](ifpr://campus/foz-do-iguacu) `foz-do-iguacu`");
    expect(texto).not.toContain("Atenção:");
    expect(texto.split("\n").at(-1)).toBe("Base de 13/11/2026 (versão dev).");
  });

  test("determinismo: mesma entrada e mesmo banco, mesma saída byte a byte", () => {
    const ctx = contexto();
    const a = sobreABase.responder({}, ctx);
    const b = sobreABase.responder({}, ctx);
    expect(JSON.stringify(b.resposta)).toBe(JSON.stringify(a.resposta));
    expect(b.texto).toBe(a.texto);
  });

  test("entrada inválida: erro legível", () => {
    expect(() => sobreABase.responder({ consulta: "x" }, contexto())).toThrow(ErroEntrada);
    expect(() => sobreABase.responder({ consulta: "x" }, contexto())).toThrow('"consulta"');
  });
});

describe("etapa", () => {
  test("não registra nada fora do app; saída válida", () => {
    const ctx = contexto();
    for (const args of [{ id: "fase-1" }, { id: "fase-1", progresso: { feito: 2, total: 5 } }]) {
      const { resposta, texto } = etapa.responder(args, ctx);
      expect(resposta.dados).toEqual({ registrado: false });
      expect(etapa.saida.safeParse(resposta).success).toBe(true);
      expect(texto).toContain("Etapa não registrada");
    }
  });

  test("entrada inválida: erro legível com o campo", () => {
    const ctx = contexto();
    expect(() => etapa.responder({}, ctx)).toThrow("→ at id");
    expect(() => etapa.responder({ id: "x", progresso: { feito: 3, total: 2 } }, ctx)).toThrow(
      "feito não pode passar de total",
    );
    expect(() => etapa.responder({ id: "" }, ctx)).toThrow(ErroEntrada);
  });
});

describe("pelo protocolo MCP (em memória)", () => {
  async function conectar() {
    const ctx = contexto();
    const servidor = criarServidor(ctx);
    const [lado, outro] = InMemoryTransport.createLinkedPair();
    await servidor.connect(lado);
    const cliente = new Client({ name: "teste", version: "0" });
    await cliente.connect(outro);
    return { cliente, servidor, ctx };
  }

  test("identifica o servidor e entrega as instruções", async () => {
    const { cliente, servidor } = await conectar();
    expect(cliente.getServerVersion()).toMatchObject({ name: NOME_SERVIDOR, version: VERSAO_PACOTE });
    expect(cliente.getInstructions()).toBe(INSTRUCOES);
    await cliente.close();
    await servidor.close();
  });

  test("chamada válida: structuredContent é a Resposta, content é o texto", async () => {
    const { cliente, servidor, ctx } = await conectar();
    // O Client valida structuredContent contra o outputSchema listado.
    const r = await cliente.callTool({ name: "sobre_a_base", arguments: {} });
    const direto = sobreABase.responder({}, ctx);
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toEqual(direto.resposta);
    expect(r.content).toEqual([{ type: "text", text: direto.texto }]);
    await cliente.close();
    await servidor.close();
  });

  test("entrada inválida: resultado de erro com mensagem em português e o campo", async () => {
    const { cliente, servidor } = await conectar();
    const r = await cliente.callTool({ name: "etapa", arguments: { progresso: { feito: 1, total: 0 } } });
    expect(r.isError).toBe(true);
    const texto = (r.content as { text: string }[])[0]!.text;
    // SDK 2.x: "Input validation error: Invalid arguments for tool etapa: id: <mensagem>, progresso.total: …"
    expect(texto).toContain("Invalid arguments for tool etapa");
    expect(texto).toContain("id: Entrada inválida: esperava um texto");
    expect(texto).toContain("progresso.total: ");
    await cliente.close();
    await servidor.close();
  });
});

describe("pacote", () => {
  test("instruções: no máximo 400 palavras, 7 itens, só ferramentas previstas", () => {
    expect(INSTRUCOES.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(400);
    for (let i = 1; i <= 7; i += 1) expect(INSTRUCOES).toContain(`\n${i}. **`);
    const citadas = [...INSTRUCOES.matchAll(/`([a-z0-9]+(?:_[a-z0-9]+)+)`/g)].map((m) => m[1]!);
    expect(citadas.length).toBeGreaterThan(0);
    for (const nome of citadas) expect(PREVISTAS).toContain(nome);
  });

  test("a versão do servidor é a do package.json", () => {
    const pacote = JSON.parse(readFileSync(path.join(import.meta.dir, "../package.json"), "utf8")) as {
      version: string;
    };
    expect(VERSAO_PACOTE).toBe(pacote.version);
  });
});
