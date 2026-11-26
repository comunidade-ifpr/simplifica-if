// @effect-diagnostics nodeBuiltinImport:off -- teste: pastas do app, pacotes adulterados e bancos corrompidos em pastas temporárias
/**
 * Os cenários do M1.10 contra um servidor HTTP local, com manifesto e pacotes gerados pela fábrica
 * (`gerarCanal`) e assinados por um par descartável. Nada sai para a rede.
 */
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { afterEach, describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as HttpClient from "effect/http/HttpClient";
import { VERSAO_ESQUEMA } from "@simplifica-if/kb/db/esquema";
import {
  APP_MINIMO_PADRAO,
  conferirContraPublicado,
  conferirEsquema,
  conferirVersoesSkills,
  gerarCanal,
  hashSkill,
  promoverManifesto,
  type SkillDaFabrica,
} from "../src/fabrica.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ARQUIVO_TRAVA,
  caminhos,
  escreverAtomico,
  lerInfoBanco,
  type OrigemCatalogo,
  prepararAbertura,
  trava,
} from "../src/local.ts";
import {
  atende,
  compararVersoes,
  decodificarManifesto,
  instanteDe,
  LIMITE_MANIFESTO,
  maiorVersao,
  problemaDataCommit,
} from "../src/manifesto.ts";
import { caminhoSeguro } from "../src/pacote-skill.ts";
import { lerRetiradas, nomesRetirados, retiradasAindaNoCatalogo, soAcrescimos } from "../src/retiradas.ts";
import { validarBancoEmWorker } from "../src/pesado.ts";
import { baixar, layerHttp, PRAZO_DOWNLOAD } from "../src/remoto.ts";
import { gerarChaves } from "../src/minisign.ts";
import { abrir, criarBanco, estadoNoDisco, limparTemporarios, pastaTemporaria } from "../src/testes/apoio.ts";
import { type Cenario, cenario, dataDoDia } from "../src/testes/cenario.ts";

afterEach(limparTemporarios);

const semPendente = (c: Cenario) => {
  expect(NodeFS.existsSync(caminhos(c.pastaApp).pendente)).toBe(false);
  expect(NodeFS.existsSync(caminhos(c.pastaApp).baixando)).toBe(false);
  expect(estadoNoDisco(c.pastaApp).pendente).toBeUndefined();
};

describe("atualização da base", () => {
  it("normal: baixa o pacote inteiro, deixa pendente e troca na abertura seguinte", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13" });
      expect(await c.atualizar()).toMatchObject({ tipo: "baixada", versao: "2026.11.13", via: "inteiro" });
      expect(estadoNoDisco(c.pastaApp).pendente?.versao).toBe("2026.11.13");
      const abertura = await abrir({ pasta: c.pastaApp, bancoEmpacotado: c.empacotada });
      expect(abertura).toMatchObject({ origem: "baixada", banco: caminhos(c.pastaApp).atual });
      expect(abertura.info?.versao).toBe("2026.11.13");
      expect(estadoNoDisco(c.pastaApp).novidades).toMatchObject({ versao: "2026.11.13", vista: false });
      // Conferir de novo: em dia, nada se baixa além do manifesto.
      c.servidor.pedidos.length = 0;
      expect(await c.atualizar()).toEqual({ tipo: "em-dia" });
      expect(c.servidor.pedidos).toEqual(["beta/beta.json", "beta/beta.json.minisig"]);
    } finally {
      await c.fechar();
    }
  });

  it("patch: com a versão anterior em uso, baixa só o patch", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13", anteriores: [c.empacotada] });
      expect(await c.atualizar()).toMatchObject({ tipo: "baixada", via: "patch" });
      expect(c.servidor.pedidos).toContain("beta/base-2026.11.10-2026.11.13.patch.zst");
      expect(c.servidor.pedidos).not.toContain("beta/base-2026.11.13.sqlite.zst");
      expect((await abrir({ pasta: c.pastaApp, bancoEmpacotado: c.empacotada })).info?.versao).toBe("2026.11.13");
    } finally {
      await c.fechar();
    }
  });

  it("assinatura de outra chave: manifesto recusado, nada baixado", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13", chave: gerarChaves() });
      await expect(c.atualizar()).rejects.toThrow("manifesto recusado");
      expect(c.servidor.pedidos).toEqual(["beta/beta.json", "beta/beta.json.minisig"]);
      semPendente(c);
    } finally {
      await c.fechar();
    }
  });

  it("manifesto alterado depois de assinado: recusado", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13" });
      const arquivo = NodePath.join(c.raiz, "servido", "beta", "beta.json");
      NodeFS.writeFileSync(arquivo, NodeFS.readFileSync(arquivo, "utf8").replace('"0.1.0"', '"0.0.1"'));
      await expect(c.atualizar()).rejects.toThrow("assinatura inválida");
    } finally {
      await c.fechar();
    }
  });

  it("sha256 errado no pacote: recusado, base em uso intacta", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13" });
      const pacote = NodePath.join(c.raiz, "servido", "beta", "base-2026.11.13.sqlite.zst");
      const bytes = NodeFS.readFileSync(pacote);
      bytes[100] = bytes[100]! ^ 0xff;
      NodeFS.writeFileSync(pacote, bytes);
      await expect(c.atualizar()).rejects.toThrow("sha256 diferente do manifesto");
      semPendente(c);
      expect((await abrir({ pasta: c.pastaApp, bancoEmpacotado: c.empacotada })).origem).toBe("empacotada");
    } finally {
      await c.fechar();
    }
  });

  it("app_minimo maior que o app: avisa e não baixa nada", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13", appMinimo: "0.2.0" });
      expect(await c.atualizar()).toEqual({ tipo: "app-desatualizado", appMinimo: "0.2.0", versao: "2026.11.13" });
      expect(c.servidor.pedidos).toHaveLength(2);
      semPendente(c);
    } finally {
      await c.fechar();
    }
  });

  it("banco corrompido ou de outro esquema: recusado depois do hash, base em uso intacta", async () => {
    const c = await cenario();
    try {
      const banco = criarBanco(NodePath.join(c.fabrica, "corrompido.sqlite"), "2026.11.13");
      const bytes = NodeFS.readFileSync(banco);
      bytes.fill(0x5a, bytes.length - 3 * 4096, bytes.length - 4096);
      NodeFS.writeFileSync(banco, bytes);
      expect(lerInfoBanco(banco)?.versao).toBe("2026.11.13");
      c.publicar({ versao: "2026.11.13", banco });
      await expect(c.atualizar()).rejects.toThrow(/corrompida|não pôde ser lida|não abre/);
      semPendente(c);

      const outroEsquema = criarBanco(NodePath.join(c.fabrica, "esquema.sqlite"), "2026.11.14", { esquema: 999 });
      c.publicar({ versao: "2026.11.14", banco: outroEsquema });
      await expect(c.atualizar()).rejects.toThrow("outro esquema");
      semPendente(c);
    } finally {
      await c.fechar();
    }
  });

  it("rede cai no meio do download: falha limpa, e a próxima conferência baixa", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13" });
      c.servidor.cortar.add("beta/base-2026.11.13.sqlite.zst");
      await expect(c.atualizar()).rejects.toThrow(/caiu no meio|sem conexão|tamanho diferente/);
      semPendente(c);
      c.servidor.cortar.clear();
      expect(await c.atualizar()).toMatchObject({ tipo: "baixada" });
    } finally {
      await c.fechar();
    }
  });

  it("manifesto antigo servido de novo (bem assinado) não faz voltar", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.09" });
      expect(await c.atualizar()).toEqual({ tipo: "em-dia" });
      semPendente(c);
    } finally {
      await c.fechar();
    }
  });

  it("skills: baixa as elegíveis e mais novas, e a pasta entra na abertura", async () => {
    const c = await cenario();
    try {
      const skill = (nome: string, extra: Partial<SkillDaFabrica> = {}): SkillDaFabrica => ({
        nome,
        versao: "1.1.0",
        appMinimo: "0.1.0",
        baseMinima: "2026.11.01",
        arquivos: [{ caminho: "SKILL.md", conteudo: Buffer.from(`---\nname: ${nome}\n---\n`) }],
        ...extra,
      });
      c.publicar({
        versao: "2026.11.13",
        skills: [
          skill("conferir-a"),
          skill("so-no-app-novo", { appMinimo: "9.0.0" }),
          skill("base-futura", { baseMinima: "2030.01.01" }),
        ],
      });
      expect(await c.atualizar()).toMatchObject({ tipo: "baixada", skills: 1 });
      const abertura = await abrir({ pasta: c.pastaApp, bancoEmpacotado: c.empacotada });
      expect(abertura.pastasSkills).toEqual([NodePath.join(c.pastaApp, "skills", "2026.11.13")]);
      expect(NodeFS.readdirSync(abertura.pastasSkills[0]!)).toEqual(["conferir-a"]);
    } finally {
      await c.fechar();
    }
  });
});

describe("catálogo de tarefas pelo canal", () => {
  const tarefa = (id: string) => ({ id, titulo: `Tarefa ${id}`, abre: { modulo: "revisao-ppc" } });
  const noDisco = (c: Cenario, arquivo: "catalogoAtual" | "catalogoPendente") =>
    JSON.parse(NodeFS.readFileSync(caminhos(c.pastaApp)[arquivo], "utf8")) as unknown;

  it("o manifesto traz o catálogo inteiro: fica pendente e troca o anterior, sem mesclar, na abertura", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13", tarefas: [tarefa("a"), tarefa("b")], skillsRetiradas: ["skill-velha"] });
      expect(await c.atualizar()).toMatchObject({ tipo: "baixada", catalogo: true });
      // Nada além do manifesto e da base se baixa: o catálogo vem dentro do manifesto assinado.
      expect(c.servidor.pedidos).toEqual([
        "beta/beta.json",
        "beta/beta.json.minisig",
        "beta/base-2026.11.13.sqlite.zst",
      ]);
      expect(estadoNoDisco(c.pastaApp).catalogoPendente).toBe("2026.11.13");
      expect(noDisco(c, "catalogoPendente")).toEqual({
        versao: "2026.11.13",
        commit: "abc1234",
        data_commit: "2026-11-13T12:00:00Z",
        tarefas: [tarefa("a"), tarefa("b")],
        skills_retiradas: ["skill-velha"],
      });
      const primeira = await abrir({ pasta: c.pastaApp, bancoEmpacotado: c.empacotada });
      expect(primeira.catalogo).toEqual({ versao: "2026.11.13", tarefas: [tarefa("a"), tarefa("b")] });
      expect(primeira.versaoEmpacotada).toBe("2026.11.10");
      expect(primeira.skillsRetiradas).toEqual(["skill-velha"]);
      expect(primeira.eventos).toContain("catálogo de tarefas 2026.11.13 aplicado");
      expect(estadoNoDisco(c.pastaApp).catalogoPendente).toBeUndefined();

      // A versão seguinte tira a tarefa "a" do repositório: ela some do app, não fica do catálogo anterior.
      c.publicar({ versao: "2026.11.14", tarefas: [tarefa("b"), tarefa("c")] });
      expect(await c.atualizar()).toMatchObject({ tipo: "baixada", catalogo: true });
      const segunda = await abrir({ pasta: c.pastaApp, bancoEmpacotado: c.empacotada });
      expect(segunda.catalogo).toEqual({ versao: "2026.11.14", tarefas: [tarefa("b"), tarefa("c")] });
      // O manifesto seguinte não repete a retirada, e ela continua: a lista do app só cresce.
      expect(segunda.skillsRetiradas).toEqual(["skill-velha"]);
      expect(NodeFS.readdirSync(caminhos(c.pastaApp).catalogo)).toEqual(["atual.json"]);
      // Em dia: o mesmo manifesto não regrava o catálogo.
      expect(await c.atualizar()).toEqual({ tipo: "em-dia" });
    } finally {
      await c.fechar();
    }
  });

  it("vale o de commit mais recente entre o baixado e o do app; no empate, o do instalador só se for o mesmo commit; o do checkout sempre", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13", tarefas: [tarefa("a")], skillsRetiradas: ["skill-velha"] });
      await c.atualizar();
      const abrirCom = (catalogoEmpacotado: OrigemCatalogo) =>
        abrir({ pasta: c.pastaApp, bancoEmpacotado: c.empacotada, catalogoEmpacotado });
      const instalador = (dataCommit: string, commit = "def5678"): OrigemCatalogo => ({
        tipo: "instalador",
        commit,
        dataCommit,
      });
      expect((await abrirCom({ tipo: "sem-pasta" })).catalogo?.versao).toBe("2026.11.13");
      // O mesmo instante, noutro fuso, do mesmo commit (abreviado): empate, vale o do instalador.
      expect((await abrirCom(instalador("2026-11-13T09:00:00-03:00", "abc1234"))).catalogo).toBeNull();
      expect((await abrirCom(instalador("2026-11-13T09:00:00-03:00", "abc12"))).catalogo).toBeNull();
      // O mesmo segundo, de outro commit: vale o publicado (a fábrica só publica descendendo do anterior).
      expect((await abrirCom(instalador("2026-11-13T09:00:00-03:00"))).catalogo?.versao).toBe("2026.11.13");
      expect((await abrirCom(instalador("2026-11-13T11:59:59Z"))).catalogo?.versao).toBe("2026.11.13");
      // Data do instalador que não dá instante: não decide, cai na regra da versão contra a base empacotada
      // (2026.11.10), em vez de deixar o do instalador para sempre.
      const semData = await abrirCom(instalador("2026-02-30T10:00:00Z"));
      expect(semData.catalogo?.versao).toBe("2026.11.13");
      expect(semData.eventos.some((evento) => evento.startsWith("aviso: a data do commit"))).toBe(true);
      const perde = await abrirCom(instalador("2026-11-20T08:00:00-03:00"));
      expect(perde.catalogo).toBeNull();
      // As retiradas valem mesmo quando o catálogo baixado perde.
      expect(perde.skillsRetiradas).toEqual(["skill-velha"]);
      expect(perde.eventos).toContain(
        "catálogo de tarefas baixado 2026.11.13 (commit de 2026-11-13T12:00:00Z) não é mais novo que o do instalador (commit def5678, de 2026-11-20T08:00:00-03:00): vale o do instalador",
      );
      // No desenvolvimento (quem sobe o servidor diz que a pasta é a do checkout), o local vence sempre.
      const checkout = await abrirCom({ tipo: "checkout" });
      expect(checkout.catalogo).toBeNull();
      expect(checkout.eventos).toContain("catálogo de tarefas baixado 2026.11.13 ignorado: vale o do checkout");
    } finally {
      await c.fechar();
    }
  });

  it("instalador de base dev-* com tarefa nova não a perde para um catálogo publicado antes dela", async () => {
    const c = await cenario();
    try {
      // O canal publicou o catálogo do commit de 13/11, sem a tarefa "nova".
      c.publicar({ versao: "2026.11.13", tarefas: [tarefa("velha")] });
      // O instalador saiu de um commit de 20/11 com a base de desenvolvimento (dev-<hash>, a menor das versões).
      const dev = criarBanco(NodePath.join(c.raiz, "dev", "kb.sqlite"), "2026.11.20");
      const db = new NodeSqlite.DatabaseSync(dev);
      db.exec("DELETE FROM meta WHERE chave = 'versao'");
      db.prepare("INSERT INTO meta VALUES (?, ?)").run("fontes_sha256", "ab12cd34ef56");
      db.close();
      expect(lerInfoBanco(dev)?.versao).toBe("dev-ab12cd34");
      const doBuild: OrigemCatalogo = {
        tipo: "instalador",
        commit: "def5678",
        dataCommit: "2026-11-20T10:00:00-03:00",
      };
      await c.atualizar("beta", new Map(), { catalogoEmpacotado: doBuild });
      const aberta = await abrir({ pasta: c.pastaApp, bancoEmpacotado: dev, catalogoEmpacotado: doBuild });
      // A base publicada vence a de desenvolvimento, mas o catálogo do instalador (com a tarefa nova) fica.
      expect(aberta.origem).toBe("baixada");
      expect(aberta.catalogo).toBeNull();
    } finally {
      await c.fechar();
    }
  });

  it("catálogo mais velho que o do instalador não se grava; o baixado ilegível cai no do instalador", async () => {
    const c = await cenario();
    try {
      // O manifesto é da versão 2026.11.09, e o instalador (a base empacotada), da 2026.11.10.
      c.publicar({ versao: "2026.11.09", tarefas: [tarefa("velha")] });
      expect(await c.atualizar()).toEqual({ tipo: "em-dia" });
      expect(NodeFS.existsSync(caminhos(c.pastaApp).catalogoPendente)).toBe(false);

      NodeFS.mkdirSync(caminhos(c.pastaApp).catalogo, { recursive: true });
      NodeFS.writeFileSync(caminhos(c.pastaApp).catalogoAtual, '{"versao":"2030.01.01","tarefas":"não é lista"}');
      const abertura = await abrir({ pasta: c.pastaApp, bancoEmpacotado: c.empacotada });
      expect(abertura.catalogo).toBeNull();
      expect(abertura.skillsRetiradas).toEqual([]);
      expect(abertura.eventos).toContain("catálogo de tarefas baixado não se lê: vale o do app");
    } finally {
      await c.fechar();
    }
  });

  it("só entra o que a assinatura cobre: catálogo trocado no manifesto depois de assinado é recusado", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13", tarefas: [tarefa("a")] });
      const arquivo = NodePath.join(c.raiz, "servido", "beta", "beta.json");
      NodeFS.writeFileSync(arquivo, NodeFS.readFileSync(arquivo, "utf8").replace("Tarefa a", "Tarefa de outro"));
      await expect(c.atualizar()).rejects.toThrow("assinatura inválida");
      expect(NodeFS.existsSync(caminhos(c.pastaApp).catalogoPendente)).toBe(false);
      expect(estadoNoDisco(c.pastaApp).catalogoPendente).toBeUndefined();
    } finally {
      await c.fechar();
    }
  });
});

describe("skills: retirada, guarda de versão e nomes que viram caminho", () => {
  const skill = (nome: string, versao: string, corpo = "corpo"): SkillDaFabrica => ({
    nome,
    versao,
    appMinimo: "0.1.0",
    baseMinima: "2026.11.01",
    arquivos: [{ caminho: "SKILL.md", conteudo: Buffer.from(`---\nname: ${nome}\n---\n${corpo}\n`) }],
  });

  it("retiradas.yaml: lê, dá os nomes e só aceita acréscimos", () => {
    const antes = lerRetiradas(
      "retiradas:\n  - { skill: skill-velha, data: 2026-11-26, motivo: Citava norma revogada. }\n",
    );
    expect(nomesRetirados(antes)).toEqual(["skill-velha"]);
    expect(nomesRetirados(lerRetiradas(""))).toEqual([]);
    const depois = lerRetiradas(
      "retiradas:\n" +
        "  - { skill: skill-velha, data: 2026-11-26, motivo: Citava norma revogada. }\n" +
        "  - { skill: outra, data: 2026-12-01, motivo: Substituída. }\n",
    );
    expect(soAcrescimos(antes, depois)).toEqual([]);
    expect(soAcrescimos(depois, antes)).toEqual(["a retirada da skill outra saiu do registro"]);
    expect(
      soAcrescimos(antes, lerRetiradas("retiradas:\n  - { skill: skill-velha, data: 2026-11-27, motivo: x }\n")),
    ).toEqual(["a retirada da skill skill-velha foi alterada"]);
    expect(retiradasAindaNoCatalogo(depois, ["outra", "nova"])).toEqual(["outra"]);
    // Nome que não é de skill, data fora do formato e campo desconhecido são recusados.
    expect(() => lerRetiradas("retiradas:\n  - { skill: ../fora, data: 2026-11-26, motivo: x }\n")).toThrow();
    expect(() => lerRetiradas("retiradas:\n  - { skill: a, data: 26/11/2026, motivo: x }\n")).toThrow();
    expect(() => lerRetiradas("retiradas:\n  - { skill: a, data: 2026-11-26, motivo: x, volta: true }\n")).toThrow();
  });

  it("a fábrica leva as retiradas ao manifesto e recusa publicar uma skill retirada", async () => {
    const c = await cenario();
    try {
      const { gerado } = c.publicar({
        versao: "2026.11.13",
        skills: [skill("conferir-a", "1.0.0")],
        skillsRetiradas: ["skill-velha", "outra", "skill-velha"],
      });
      expect(gerado.manifesto.skills_retiradas).toEqual(["outra", "skill-velha"]);
      expect(() =>
        c.publicar({ versao: "2026.11.14", skills: [skill("conferir-a", "1.0.0")], skillsRetiradas: ["conferir-a"] }),
      ).toThrow("skill retirada não se publica: conferir-a");
    } finally {
      await c.fechar();
    }
  });

  it("guarda de versão: conteúdo novo com a versão da última publicação é recusado, com a skill e o que fazer", async () => {
    const c = await cenario();
    try {
      const primeira = c.publicar({
        versao: "2026.11.13",
        skills: [skill("conferir-a", "1.0.0"), skill("b", "2.0.0")],
      });
      expect(primeira.gerado.skillsPublicadas).toEqual([
        { nome: "conferir-a", versao: "1.0.0", sha256: hashSkill(skill("conferir-a", "1.0.0").arquivos) },
        { nome: "b", versao: "2.0.0", sha256: hashSkill(skill("b", "2.0.0").arquivos) },
      ]);
      const publicacoes = [
        {
          versao: "2026.11.10",
          origem: "registro-local" as const,
          skills: [{ nome: "conferir-a", versao: "0.9.0", sha256: "0".repeat(64) }],
        },
        { versao: "2026.11.13", origem: "registro-local" as const, skills: primeira.gerado.skillsPublicadas },
      ];
      // O mesmo conteúdo com a mesma versão sai de novo; conteúdo novo com versão nova, também.
      c.publicar({
        versao: "2026.11.14",
        skills: [skill("conferir-a", "1.0.0"), skill("b", "2.1.0", "novo")],
        publicacoes,
      });
      // Conteúdo novo com a versão de antes: recusado antes de gravar qualquer arquivo.
      const antes = NodeFS.readdirSync(NodePath.join(c.raiz, "servido", "beta")).sort();
      expect(() =>
        c.publicar({ versao: "2026.11.15", skills: [skill("conferir-a", "1.0.0", "editada")], publicacoes }),
      ).toThrow(
        "skill conferir-a: o conteúdo mudou desde a versão 2026.11.13 gerada neste computador (tmp/fabrica/bases; pode não ter sido publicada) " +
          "e a versão continua 1.0.0; suba simplifica.versao no SKILL.md da skill e faça o commit",
      );
      expect(NodeFS.readdirSync(NodePath.join(c.raiz, "servido", "beta")).sort()).toEqual(antes);
    } finally {
      await c.fechar();
    }
  });

  it("guarda de versão: compara com toda publicação que levou a skill naquela versão", () => {
    const a1 = skill("a", "1.0.0");
    const publicada = (s: SkillDaFabrica) => ({ nome: s.nome, versao: s.versao, sha256: hashSkill(s.arquivos) });
    // A skill saiu do catálogo numa versão e voltou: vale toda publicação em que ela esteve.
    const anteriores = [
      { versao: "2026.11.20", origem: "registro-local" as const, skills: [] },
      { versao: "2026.11.13", origem: "registro-local" as const, skills: [publicada(a1)] },
      { versao: "2026.11.10", origem: "registro-local" as const, skills: [publicada(a1)] },
    ];
    expect(conferirVersoesSkills([a1], anteriores)).toEqual([]);
    expect(conferirVersoesSkills([skill("a", "1.0.0", "outra")], anteriores)).toHaveLength(1);
    expect(conferirVersoesSkills([skill("a", "1.0.1", "outra"), skill("nova", "0.1.0")], anteriores)).toEqual([]);
    // Um arquivo a mais ou com outro nome muda o conteúdo.
    const comArquivo = { ...a1, arquivos: [...a1.arquivos, { caminho: "ref.md", conteudo: Buffer.from("") }] };
    expect(conferirVersoesSkills([comArquivo], anteriores)).toHaveLength(1);
    // A versão não desce da maior já saída, mesmo com outro conteúdo.
    const comA2 = [
      ...anteriores,
      { versao: "2026.11.21", origem: "canal" as const, skills: [publicada(skill("a", "2.0.0"))] },
    ];
    expect(conferirVersoesSkills([skill("a", "1.5.0", "outra")], comA2)).toEqual([
      "skill a: a versão 1.5.0 é menor que a 2.0.0 de a versão 2026.11.21 publicada no canal; " +
        "suba simplifica.versao no SKILL.md para mais que 2.0.0 e faça o commit (o app nunca troca uma skill pela de versão menor)",
    ]);
    expect(conferirVersoesSkills([skill("a", "2.0.1", "outra")], comA2)).toEqual([]);
  });

  it("guarda de versão: registro local com o conteúdo editado não esconde o publicado no canal", () => {
    const original = skill("a", "1.0.0");
    const editada = skill("a", "1.0.0", "editada");
    const publicada = (s: SkillDaFabrica) => ({ nome: s.nome, versao: s.versao, sha256: hashSkill(s.arquivos) });
    const recusa = (versao: string) =>
      `skill a: o conteúdo mudou desde a versão ${versao} publicada no canal e a versão continua 1.0.0; ` +
      "suba simplifica.versao no SKILL.md da skill e faça o commit (sem isso, a mudança não chega a quem já tem a skill)";
    // Gerada (não publicada) depois do canal, já com a edição: a do canal continua valendo.
    const localMaisNovo = [
      { versao: "2026.11.14", origem: "registro-local" as const, skills: [publicada(editada)] },
      { versao: "2026.11.13", origem: "canal" as const, skills: [publicada(original)] },
    ];
    expect(conferirVersoesSkills([editada], localMaisNovo)).toEqual([recusa("2026.11.13")]);
    // Mesma versão do canal no registro local: o publicado vem antes, nas duas ordens de entrada.
    const empate = [
      { versao: "2026.11.13", origem: "registro-local" as const, skills: [publicada(skill("a", "1.0.0", "rascunho"))] },
      { versao: "2026.11.13", origem: "canal" as const, skills: [publicada(original)] },
    ];
    expect(conferirVersoesSkills([editada], empate)).toEqual([recusa("2026.11.13")]);
    expect(conferirVersoesSkills([editada], [...empate].reverse())).toEqual([recusa("2026.11.13")]);
  });

  it("fábrica contra o manifesto publicado: retiradas não encolhem, versão não desce, mesma versão tem o mesmo conteúdo", async () => {
    const c = await cenario();
    try {
      const { gerado } = c.publicar({
        versao: "2026.11.13",
        skills: [skill("conferir-a", "1.0.0")],
        skillsRetiradas: ["velha"],
      });
      const publicado = gerado.manifesto;
      // O hash do conteúdo vai no manifesto assinado: a guarda não depende do computador de quem publica.
      expect(publicado.skills[0]?.sha256_conteudo).toBe(hashSkill(skill("conferir-a", "1.0.0").arquivos));
      expect(() =>
        c.publicar({ versao: "2026.11.14", skills: [skill("conferir-a", "1.0.0")], skillsRetiradas: [], publicado }),
      ).toThrow("skill retirada no canal publicado (versão 2026.11.13) saiu da lista de retiradas: velha");
      expect(() =>
        c.publicar({
          versao: "2026.11.14",
          skills: [skill("conferir-a", "1.0.0", "editada")],
          skillsRetiradas: ["velha"],
          publicado,
        }),
      ).toThrow(
        "skill conferir-a: o conteúdo mudou desde a versão 2026.11.13 publicada no canal e a versão continua 1.0.0",
      );
      expect(() =>
        c.publicar({
          versao: "2026.11.14",
          skills: [skill("conferir-a", "0.9.0")],
          skillsRetiradas: ["velha"],
          publicado,
        }),
      ).toThrow("skill conferir-a: a versão 0.9.0 é menor que a 1.0.0 de a versão 2026.11.13 publicada no canal");
      // Com a versão subida e as retiradas mantidas (e mais uma), passa.
      expect(
        c.publicar({
          versao: "2026.11.14",
          skills: [skill("conferir-a", "1.0.1", "editada")],
          skillsRetiradas: ["velha", "outra"],
          publicado,
        }).gerado.manifesto.skills_retiradas,
      ).toEqual(["outra", "velha"]);
    } finally {
      await c.fechar();
    }
  });

  it("a fábrica não assina um manifesto acima do limite que o app baixa", async () => {
    const c = await cenario();
    try {
      const grande = Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, resumo: "x".repeat(30 * 1024) }));
      expect(() => c.publicar({ versao: "2026.11.13", tarefas: grande })).toThrow(
        `acima do limite de ${LIMITE_MANIFESTO} que o app baixa`,
      );
      expect(() => c.publicar({ versao: "2026.11.13", tarefas: grande.slice(0, 10) })).not.toThrow();
    } finally {
      await c.fechar();
    }
  });

  it("a fábrica não assina versão de skill fora do X.Y.Z nem nome que escaparia da pasta", async () => {
    const c = await cenario();
    try {
      expect(() => c.publicar({ versao: "2026.11.13", skills: [skill("conferir-a", "1.0")] })).toThrow();
      expect(() => c.publicar({ versao: "2026.11.13", skillsRetiradas: ["../fora"] })).toThrow();
    } finally {
      await c.fechar();
    }
  });

  it("caminho vindo do canal não escapa da pasta de destino: o manifesto e o pacote recusam", () => {
    const sha = "a".repeat(64);
    const manifesto = (skill: object, retiradas: ReadonlyArray<string> = []) =>
      JSON.stringify({
        canal: "beta",
        versao: "2026.11.13",
        commit: "abc",
        data_commit: "2026-11-13T00:00:00Z",
        gerado_em: "2026-11-13T00:00:00.000Z",
        base: {
          arquivo: "b.zst",
          sha256: sha,
          bytes: 1,
          sha256_banco: sha,
          data_referencia: "2026-11-13",
          patches: [],
        },
        skills: [
          {
            nome: "a",
            versao: "1.0.0",
            arquivo: "skill-a.zst",
            sha256: sha,
            bytes: 1,
            sha256_conteudo: sha,
            app_minimo: "0.1.0",
            base_minima: "2026.01.01",
            ...skill,
          },
        ],
        skills_retiradas: retiradas,
        tarefas: [],
        app_minimo: "0.1.0",
        novidades: [],
      });
    expect(decodificarManifesto(manifesto({})).skills[0]?.nome).toBe("a");
    expect(() => decodificarManifesto(manifesto({ nome: "../../fora" }))).toThrow();
    expect(() => decodificarManifesto(manifesto({ nome: "a/b" }))).toThrow();
    expect(() => decodificarManifesto(manifesto({ arquivo: "../skill.zst" }))).toThrow();
    expect(() => decodificarManifesto(manifesto({}, ["..\\fora"]))).toThrow();
    for (const caminho of [
      "../SKILL.md",
      "/etc/passwd",
      "a/../../b",
      "a\\b",
      "",
      "C:/x.md",
      "c:x.md",
      "ref.md:fluxo",
    ]) {
      expect(caminhoSeguro(caminho)).toBe(false);
    }
    expect(caminhoSeguro("references/relatorio.md")).toBe(true);
  });
});

describe("canal no app: manifesto antigo, retiradas, catálogo pendente e base mínima", () => {
  const skill = (nome: string, versao: string, extra: Partial<SkillDaFabrica> = {}): SkillDaFabrica => ({
    nome,
    versao,
    appMinimo: "0.1.0",
    baseMinima: "2026.11.01",
    arquivos: [{ caminho: "SKILL.md", conteudo: Buffer.from(`---\nname: ${nome}\n---\n${versao}\n`) }],
    ...extra,
  });
  const tarefa = (id: string) => ({ id, titulo: `Tarefa ${id}`, abre: { modulo: "revisao-ppc" } });
  const abrirApp = (c: Cenario) => abrir({ pasta: c.pastaApp, bancoEmpacotado: c.empacotada });

  it("manifesto antigo servido de novo não baixa de novo a skill retirada nem tira a mais nova", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13", skills: [skill("a", "1.0.0"), skill("b", "1.0.0")], tarefas: [tarefa("x")] });
      await c.atualizar();
      await abrirApp(c);
      // A 2026.11.14 retira a "a" e sobe a "b".
      c.publicar({
        versao: "2026.11.14",
        skills: [skill("b", "1.1.0")],
        skillsRetiradas: ["a"],
        tarefas: [tarefa("y")],
      });
      const disponiveis = new Map([
        ["a", "1.0.0"],
        ["b", "1.0.0"],
      ]);
      expect(await c.atualizar("beta", disponiveis)).toMatchObject({ tipo: "baixada", skills: 1 });
      const segunda = await abrirApp(c);
      // A "a", retirada, não passa para a pasta nova.
      expect(NodeFS.readdirSync(segunda.pastasSkills[0]!)).toEqual(["b"]);
      expect(segunda.skillsRetiradas).toEqual(["a"]);

      // O manifesto da 2026.11.13, bem assinado, servido de novo: nada se baixa nem se grava.
      c.publicar({ versao: "2026.11.13", skills: [skill("a", "1.0.0"), skill("b", "1.0.0")], tarefas: [tarefa("x")] });
      c.servidor.pedidos.length = 0;
      expect(await c.atualizar("beta", new Map([["b", "1.1.0"]]))).toEqual({ tipo: "em-dia" });
      expect(c.servidor.pedidos).toEqual(["beta/beta.json", "beta/beta.json.minisig"]);
      const terceira = await abrirApp(c);
      expect(terceira.pastasSkills).toEqual(segunda.pastasSkills);
      expect(NodeFS.readdirSync(terceira.pastasSkills[0]!)).toEqual(["b"]);
      expect(terceira.catalogo).toEqual({ versao: "2026.11.14", tarefas: [tarefa("y")] });
    } finally {
      await c.fechar();
    }
  });

  it("canal mais velho que o instalador não traz skills nem catálogo", async () => {
    const c = await cenario();
    try {
      // O instalador é da 2026.11.10; o canal (o estável, atrasado), da 2026.11.09.
      c.publicar({ versao: "2026.11.09", skills: [skill("a", "1.0.0")], tarefas: [tarefa("velha")] });
      expect(await c.atualizar()).toEqual({ tipo: "em-dia" });
      expect(c.servidor.pedidos).toEqual(["beta/beta.json", "beta/beta.json.minisig"]);
      expect(NodeFS.existsSync(caminhos(c.pastaApp).catalogoPendente)).toBe(false);
    } finally {
      await c.fechar();
    }
  });

  it("skill das retiradas conhecidas (as do instalador) não se baixa", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13", skills: [skill("a", "1.0.0"), skill("b", "1.0.0")] });
      expect(await c.atualizar("beta", new Map(), { skillsRetiradas: new Set(["a"]) })).toMatchObject({ skills: 1 });
      expect(c.servidor.pedidos).not.toContain("beta/skill-a-1.0.0.zst");
      expect(NodeFS.readdirSync((await abrirApp(c)).pastasSkills[0]!)).toEqual(["b"]);
    } finally {
      await c.fechar();
    }
  });

  it("as retiradas entram com o app velho demais e quando a base não chega", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13", appMinimo: "0.2.0", skillsRetiradas: ["a"] });
      expect(await c.atualizar()).toMatchObject({ tipo: "app-desatualizado" });
      expect((await abrirApp(c)).skillsRetiradas).toEqual(["a"]);

      c.publicar({ versao: "2026.11.14", skillsRetiradas: ["a", "b"] });
      c.servidor.sumir.add("beta/base-2026.11.14.sqlite.zst");
      await expect(c.atualizar()).rejects.toThrow();
      expect((await abrirApp(c)).skillsRetiradas).toEqual(["a", "b"]);
      // A versão do app fora do padrão não atende mínimo nenhum: o app não baixa nada.
      c.servidor.sumir.clear();
      expect(await c.atualizar("beta", new Map(), { versaoApp: "0.2.0-beta.1" })).toMatchObject({
        tipo: "app-desatualizado",
      });
    } finally {
      await c.fechar();
    }
  });

  it("retirada continua retirada com o catálogo baixado ilegível", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13", tarefas: [tarefa("a")], skillsRetiradas: ["a"] });
      await c.atualizar();
      await abrirApp(c);
      NodeFS.writeFileSync(caminhos(c.pastaApp).catalogoAtual, "{ truncado");
      const aberta = await abrirApp(c);
      expect(aberta.catalogo).toBeNull();
      expect(aberta.skillsRetiradas).toEqual(["a"]);
    } finally {
      await c.fechar();
    }
  });

  it("catálogo pendente ilegível ou não mais novo que o atual: descartado, e o atual fica", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13", tarefas: [tarefa("a")] });
      await c.atualizar();
      expect((await abrirApp(c)).catalogo?.versao).toBe("2026.11.13");
      const pendenteNoDisco = (texto: string, versao: string) => {
        NodeFS.writeFileSync(caminhos(c.pastaApp).catalogoPendente, texto);
        NodeFS.writeFileSync(
          caminhos(c.pastaApp).estado,
          JSON.stringify({ ...estadoNoDisco(c.pastaApp), catalogoPendente: versao }),
        );
      };
      pendenteNoDisco('{"versao":"2026.11.14","tarefas":[', "2026.11.14");
      const truncado = await abrirApp(c);
      expect(truncado.eventos).toContain(
        "catálogo de tarefas pendente 2026.11.14 descartado (não se lê); fica o atual",
      );
      expect(truncado.catalogo).toEqual({ versao: "2026.11.13", tarefas: [tarefa("a")] });
      expect(NodeFS.existsSync(caminhos(c.pastaApp).catalogoPendente)).toBe(false);

      const velho = {
        versao: "2026.11.12",
        commit: "x",
        data_commit: dataDoDia("2026.11.12"),
        tarefas: [],
        skills_retiradas: [],
      };
      pendenteNoDisco(JSON.stringify(velho), "2026.11.12");
      const regride = await abrirApp(c);
      expect(regride.eventos).toContain(
        "catálogo de tarefas pendente 2026.11.12 descartado (não é mais novo que o atual, 2026.11.13)",
      );
      expect(regride.catalogo?.versao).toBe("2026.11.13");
    } finally {
      await c.fechar();
    }
  });

  it("base_minima das skills na segunda tentativa: vale a base pendente, baixada na primeira", async () => {
    const c = await cenario();
    try {
      // A skill pede a base da própria versão, mais nova que a em uso (a do instalador, 2026.11.10).
      c.publicar({ versao: "2026.11.13", skills: [skill("a", "1.0.0", { baseMinima: "2026.11.13" })] });
      c.servidor.sumir.add("beta/skill-a-1.0.0.zst");
      await expect(c.atualizar()).rejects.toThrow();
      expect(estadoNoDisco(c.pastaApp).pendente?.versao).toBe("2026.11.13");
      c.servidor.sumir.clear();
      expect(await c.atualizar()).toMatchObject({ tipo: "baixada", via: "nenhum", skills: 1 });
    } finally {
      await c.fechar();
    }
  });
});

describe("revisão: skills, trava, proxy, temporários e Worker", () => {
  const skill = (nome: string, versao: string): SkillDaFabrica => ({
    nome,
    versao,
    appMinimo: "0.1.0",
    baseMinima: "2026.11.01",
    arquivos: [{ caminho: "SKILL.md", conteudo: Buffer.from(`---\nname: ${nome}\n---\n${versao}\n`) }],
  });

  it("skill baixada antes continua quando chega outra numa versão seguinte", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13", skills: [skill("conferir-a", "1.1.0")] });
      await c.atualizar();
      const primeira = await abrir({ pasta: c.pastaApp, bancoEmpacotado: c.empacotada });
      expect(NodeFS.readdirSync(primeira.pastasSkills[0]!)).toEqual(["conferir-a"]);
      // No servidor, o catálogo já tem a A 1.1.0 baixada: só a B é nova.
      c.publicar({ versao: "2026.11.14", skills: [skill("conferir-a", "1.1.0"), skill("conferir-b", "1.0.0")] });
      expect(await c.atualizar("beta", new Map([["conferir-a", "1.1.0"]]))).toMatchObject({
        tipo: "baixada",
        skills: 1,
      });
      const segunda = await abrir({ pasta: c.pastaApp, bancoEmpacotado: c.empacotada });
      expect(segunda.pastasSkills).toEqual([NodePath.join(c.pastaApp, "skills", "2026.11.14")]);
      expect(NodeFS.readdirSync(segunda.pastasSkills[0]!).sort()).toEqual(["conferir-a", "conferir-b"]);
    } finally {
      await c.fechar();
    }
  });

  it.live("trava: outro processo vivo segura a pasta; trava de processo morto se retoma", () =>
    Effect.gen(function* () {
      const pasta = pastaTemporaria();
      const empacotada = criarBanco(NodePath.join(pasta, "emp", "kb.sqlite"), "2026.11.10");
      const comTrava = <A>(dentro: (tomada: boolean) => A) =>
        Effect.scoped(Effect.map(trava(pasta), dentro)).pipe(Effect.provide(NodeServices.layer));
      NodeFS.writeFileSync(NodePath.join(pasta, ARQUIVO_TRAVA), String(process.ppid));
      expect(yield* comTrava((tomada) => tomada)).toBe(false);
      const abertura = yield* Effect.promise(() => abrir({ pasta, bancoEmpacotado: empacotada }));
      expect(abertura.eventos).toContain(
        "outro processo usa esta pasta de atualização; a troca fica para a próxima abertura",
      );
      NodeFS.writeFileSync(NodePath.join(pasta, ARQUIVO_TRAVA), "999999999");
      const dentro = yield* comTrava((tomada) => ({
        tomada,
        dono: NodeFS.readFileSync(NodePath.join(pasta, ARQUIVO_TRAVA), "utf8"),
      }));
      expect(dentro).toEqual({ tomada: true, dono: String(process.pid) });
      // O escopo fechou: a trava foi solta.
      expect(NodeFS.existsSync(NodePath.join(pasta, ARQUIVO_TRAVA))).toBe(false);
    }),
  );

  it.live("abertura: o estado se lê dentro da trava da pasta", () =>
    Effect.gen(function* () {
      const pasta = pastaTemporaria();
      const empacotada = criarBanco(NodePath.join(pasta, "emp", "kb.sqlite"), "2026.11.10");
      NodeFS.writeFileSync(NodePath.join(pasta, "atualizacao.json"), JSON.stringify({ canal: "beta" }));
      const comTrava: boolean[] = [];
      yield* Effect.gen(function* () {
        const real = yield* FileSystem.FileSystem;
        const vigiado: FileSystem.FileSystem = {
          ...real,
          readFileString: (caminho, codificacao) => {
            if (caminho.endsWith("atualizacao.json")) {
              comTrava.push(NodeFS.existsSync(NodePath.join(pasta, ARQUIVO_TRAVA)));
            }
            return real.readFileString(caminho, codificacao);
          },
        };
        yield* prepararAbertura({ pasta, bancoEmpacotado: empacotada }).pipe(
          Effect.provideService(FileSystem.FileSystem, vigiado),
        );
      }).pipe(Effect.provide(NodeServices.layer));
      expect(comTrava.length).toBeGreaterThan(0);
      expect(comTrava.every((tomada) => tomada)).toBe(true);
    }),
  );

  it.live("proxy: o download passa pela proxy HTTP dada (como a do Electron ou a de HTTP_PROXY)", () =>
    Effect.gen(function* () {
      const c = yield* Effect.promise(() => cenario());
      const vistos: string[] = [];
      const proxy = NodeHttp.createServer((pedido, resposta) => {
        vistos.push(pedido.url ?? "");
        const alvo = new URL(pedido.url ?? "");
        NodeHttp.get(alvo, { agent: new NodeHttp.Agent() }, (r) => {
          resposta.writeHead(r.statusCode ?? 502, r.headers);
          r.pipe(resposta);
        });
      });
      yield* Effect.promise(() => new Promise<void>((pronto) => proxy.listen(0, "127.0.0.1", pronto)));
      yield* Effect.ensuring(
        Effect.gen(function* () {
          c.publicar({ versao: "2026.11.13" });
          const url = `${c.servidor.url}beta/beta.json`;
          const porta = (proxy.address() as { port: number }).port;
          const baixarPor = (proxyConfig: Parameters<typeof layerHttp>[0]) =>
            baixar(url, 1024 * 1024).pipe(Effect.provide(layerHttp(proxyConfig)));
          const dados = yield* baixarPor({ httpProxy: `http://127.0.0.1:${porta}` });
          expect(Buffer.from(dados).toString("utf8")).toContain('"canal": "beta"');
          expect(vistos).toEqual([url]);
          // NO_PROXY tira o endereço da proxy.
          yield* baixarPor({ httpProxy: `http://127.0.0.1:${porta}`, noProxy: "127.0.0.1" });
          expect(vistos).toHaveLength(1);
        }),
        Effect.promise(async () => {
          proxy.closeAllConnections();
          proxy.close();
          await c.fechar();
        }),
      );
    }),
  );

  it.live("temporários: falha na escrita não deixa .tmp, e a abertura apaga sobras", () =>
    Effect.gen(function* () {
      const pasta = pastaTemporaria();
      const destino = NodePath.join(pasta, "base", "ocupado");
      NodeFS.mkdirSync(NodePath.join(destino, "dentro"), { recursive: true });
      const erro = yield* escreverAtomico(destino, Buffer.from("x")).pipe(
        Effect.provide(NodeServices.layer),
        Effect.flip,
      );
      expect(erro.message).toContain("não foi possível gravar a base baixada");
      expect(NodeFS.readdirSync(NodePath.join(pasta, "base")).filter((nome) => nome.endsWith(".tmp"))).toEqual([]);
      NodeFS.writeFileSync(NodePath.join(pasta, "atualizacao.json.123.tmp"), "{");
      NodeFS.writeFileSync(NodePath.join(pasta, "base", "baixando.sqlite"), "x");
      NodeFS.mkdirSync(NodePath.join(pasta, "skills", "2026.11.20.baixando"), { recursive: true });
      const empacotada = criarBanco(NodePath.join(pasta, "emp", "kb.sqlite"), "2026.11.10");
      const abertura = yield* Effect.promise(() => abrir({ pasta, bancoEmpacotado: empacotada }));
      expect(abertura.eventos.filter((e) => e.startsWith("sobra apagada")).length).toBe(3);
      expect(NodeFS.existsSync(NodePath.join(pasta, "atualizacao.json.123.tmp"))).toBe(false);
    }),
  );

  it.live("Worker: confere o banco fora do event loop, com as mesmas recusas", () =>
    Effect.gen(function* () {
      const pasta = pastaTemporaria();
      const bom = criarBanco(NodePath.join(pasta, "bom.sqlite"), "2026.11.20");
      expect(yield* validarBancoEmWorker(bom, { versao: "2026.11.20", dataReferencia: "2026-11-20" })).toMatchObject({
        versao: "2026.11.20",
      });
      const erroVersao = yield* validarBancoEmWorker(bom, { versao: "2026.11.21", dataReferencia: "2026-11-20" }).pipe(
        Effect.flip,
      );
      expect(erroVersao.message).toContain("diz ser a versão 2026.11.20");
      const ruim = criarBanco(NodePath.join(pasta, "ruim.sqlite"), "2026.11.20", { esquema: 999 });
      const erroEsquema = yield* validarBancoEmWorker(ruim, {
        versao: "2026.11.20",
        dataReferencia: "2026-11-20",
      }).pipe(Effect.flip);
      expect(erroEsquema.message).toContain("outro esquema");
    }),
  );

  it.effect("prazo: um servidor que não responde falha com FalhaDownload no prazo, pelo relógio do Effect", () =>
    Effect.gen(function* () {
      const mudo = Layer.succeed(HttpClient.HttpClient)(HttpClient.make(() => Effect.never));
      const download = yield* baixar("https://exemplo.invalid/beta/beta.json?token=segredo", 1024).pipe(
        Effect.provide(mudo),
        Effect.flip,
        Effect.forkChild,
      );
      yield* TestClock.adjust(PRAZO_DOWNLOAD);
      const erro = yield* Fiber.join(download);
      expect(erro).toMatchObject({ _tag: "FalhaDownload", categoria: "prazo", host: "exemplo.invalid" });
      // A URL (com a consulta) fica só em `cause`, nunca na mensagem.
      expect(erro.message).not.toContain("token");
      expect(erro.message).not.toContain("beta.json");
    }),
  );
});

describe("esquema da base na abertura e na fábrica", () => {
  // o esquema deste app e o anterior (a base baixada pelo app antigo)
  const ATUAL = VERSAO_ESQUEMA;
  const ANTIGO = VERSAO_ESQUEMA - 1;

  it("base baixada de outro esquema, mesmo mais nova, não vence a empacotada", async () => {
    const pasta = pastaTemporaria();
    const empacotada = criarBanco(NodePath.join(pasta, "Resources", "kb.sqlite"), "2026.11.10");
    criarBanco(caminhos(pasta).atual, "2026.11.20", { esquema: ANTIGO });
    const abertura = await abrir({ pasta, bancoEmpacotado: empacotada, versaoEsquema: ATUAL });
    // a empacotada é do esquema deste app (criarBanco grava o VERSAO_ESQUEMA do kb)
    expect(lerInfoBanco(empacotada)?.versaoEsquema).toBe(ATUAL);
    expect(abertura.origem).toBe("empacotada");
    expect(abertura.info?.versao).toBe("2026.11.10");
    expect(abertura.eventos).toContain(
      `base baixada 2026.11.20 é do esquema ${ANTIGO}, e este app lê o ${ATUAL}: abre a empacotada`,
    );
  });

  it('"Voltar" para uma anterior de outro esquema cai na empacotada', async () => {
    const pasta = pastaTemporaria();
    const empacotada = criarBanco(NodePath.join(pasta, "Resources", "kb.sqlite"), "2026.11.10");
    const c = caminhos(pasta);
    criarBanco(c.atual, "2026.11.20");
    criarBanco(c.anterior, "2026.11.15", { esquema: ANTIGO });
    NodeFS.writeFileSync(NodePath.join(pasta, "atualizacao.json"), JSON.stringify({ voltar: true }));
    const abertura = await abrir({ pasta, bancoEmpacotado: empacotada, versaoEsquema: ATUAL });
    expect(abertura.origem).toBe("empacotada");
    expect(abertura.eventos.some((e) => e.startsWith(`base baixada 2026.11.15 é do esquema ${ANTIGO}`))).toBe(true);
    // a mesma base, no esquema certo, vence a empacotada mais velha
    const certa = await abrir({ pasta, bancoEmpacotado: empacotada, versaoEsquema: ANTIGO });
    expect(certa.origem).toBe("baixada");
  });

  it("o app atual (apps/desktop) passa na regra da fábrica para a primeira base do esquema que ele lê", () => {
    const pacote = JSON.parse(
      NodeFS.readFileSync(NodePath.resolve(import.meta.dirname, "../../../apps/desktop/package.json"), "utf8"),
    ) as { version: string };
    expect(VERSAO_ESQUEMA).toBeGreaterThan(0);
    expect(compararVersoes(pacote.version, APP_MINIMO_PADRAO)).toBeGreaterThan(0);
    const pasta = pastaTemporaria();
    const anterior = criarBanco(NodePath.join(pasta, "antiga.sqlite"), "2026.11.10", { esquema: ANTIGO });
    const nova = lerInfoBanco(criarBanco(NodePath.join(pasta, "nova.sqlite"), "2026.11.20"))!;
    expect(nova.versaoEsquema).toBe(VERSAO_ESQUEMA);
    expect(() => conferirEsquema(nova, [anterior], APP_MINIMO_PADRAO)).toThrow("informe --app-minimo");
    expect(() => conferirEsquema(nova, [anterior], pacote.version)).not.toThrow();
  });

  it("fábrica: base que sobe o esquema só sai com --app-minimo", () => {
    const pasta = pastaTemporaria();
    const anterior = criarBanco(NodePath.join(pasta, "antiga.sqlite"), "2026.11.10", { esquema: 3 });
    const nova = lerInfoBanco(criarBanco(NodePath.join(pasta, "nova.sqlite"), "2026.11.20", { esquema: 4 }))!;
    expect(() => conferirEsquema(nova, [anterior], "0.1.0")).toThrow(
      "a base 2026.11.20 é do esquema 4, e a 2026.11.10 era do 3: informe --app-minimo",
    );
    expect(() => conferirEsquema(nova, [anterior], "0.2.0")).not.toThrow();
    const mesma = criarBanco(NodePath.join(pasta, "mesma.sqlite"), "2026.11.15", { esquema: 4 });
    expect(() => conferirEsquema(nova, [mesma], "0.1.0")).not.toThrow();
  });
});

describe("versão da base de desenvolvimento", () => {
  it("o banco compilado sem --versao é dev-<hash>, não a data de referência", () => {
    const caminho = criarBanco(NodePath.join(pastaTemporaria(), "dev.sqlite"), "2026.11.13");
    const db = new NodeSqlite.DatabaseSync(caminho);
    db.exec("DELETE FROM meta WHERE chave = 'versao'");
    db.prepare("INSERT INTO meta VALUES (?, ?)").run("fontes_sha256", "ab12cd34ef56");
    db.close();
    expect(lerInfoBanco(caminho)).toMatchObject({ versao: "dev-ab12cd34", dataReferencia: "2026-11-13" });
  });

  it("vem antes de toda versão publicada, para a atualização trocá-la", () => {
    expect(compararVersoes("2026.11.20", "dev-ab12cd34")).toBeGreaterThan(0);
    expect(compararVersoes("dev-ab12cd34", "2000.01.01")).toBeLessThan(0);
    expect(compararVersoes("dev-ab12cd34", "dev-ffffffff")).toBe(0);
    expect(compararVersoes("2026.11.20.2", "2026.11.20")).toBeGreaterThan(0);
  });

  it("versão com segmento que não é só dígitos não se compara, e o mínimo falha fechado", () => {
    for (const lixo of ["0.2.0-beta.1", "2026-12-31", "0.2.x", "0.2.0 ", ".1", ""]) {
      expect(compararVersoes(lixo, "0.1.0")).toBeNaN();
      expect(compararVersoes("0.1.0", lixo)).toBeNaN();
      expect(atende("0.1.0", lixo)).toBe(false);
      expect(atende(lixo, "9.9.9")).toBe(false);
    }
    // O primeiro segmento já decide, e ainda assim o resto é conferido (antes, `0.2.x` passava por 0.2).
    expect(compararVersoes("1.0.x", "0.9.0")).toBeNaN();
    expect(atende("0.2.0", "0.2.0")).toBe(true);
    expect(maiorVersao(["2026.11.13", "lixo", undefined, "2026.11.13.2"])).toBe("2026.11.13.2");
  });
});

describe("revisão do canal no app: origem do catálogo, datas, reprocessar, retiradas", () => {
  const skill = (nome: string, versao: string, extra: Partial<SkillDaFabrica> = {}): SkillDaFabrica => ({
    nome,
    versao,
    appMinimo: "0.1.0",
    baseMinima: "2026.11.01",
    arquivos: [{ caminho: "SKILL.md", conteudo: Buffer.from(`---\nname: ${nome}\n---\n${versao}\n`) }],
    ...extra,
  });
  const tarefa = (id: string) => ({ id, titulo: `Tarefa ${id}`, abre: { modulo: "revisao-ppc" } });
  const abrirApp = (c: Cenario, catalogoEmpacotado?: OrigemCatalogo) =>
    abrir({
      pasta: c.pastaApp,
      bancoEmpacotado: c.empacotada,
      ...(catalogoEmpacotado === undefined ? {} : { catalogoEmpacotado }),
    });

  it("instalador sem origem.json (ausente ou ilegível): vale o baixado só se for mais novo que a base empacotada, com aviso", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13", tarefas: [tarefa("a")] });
      await c.atualizar();
      for (const motivo of ["ausente", "ilegivel"] as const) {
        const aberta = await abrirApp(c, { tipo: "sem-origem", motivo });
        // 2026.11.13 é mais nova que a base empacotada (2026.11.10): o baixado vale, e o catálogo não congela.
        expect(aberta.catalogo?.versao).toBe("2026.11.13");
        expect(aberta.eventos.some((evento) => evento.startsWith("aviso: a pasta de tarefas do instalador"))).toBe(
          true,
        );
      }
      // Um catálogo baixado que não é mais novo que a base do instalador não vence sem a data do commit.
      const velho = {
        versao: "2026.11.09",
        commit: "x",
        data_commit: dataDoDia("2026.11.09"),
        tarefas: [tarefa("velha")],
        skills_retiradas: [],
      };
      NodeFS.writeFileSync(caminhos(c.pastaApp).catalogoAtual, JSON.stringify(velho));
      expect((await abrirApp(c, { tipo: "sem-origem", motivo: "ausente" })).catalogo).toBeNull();
    } finally {
      await c.fechar();
    }
  });

  it("data e hora: a que não existe no calendário não passa no schema; a fábrica e o build recusam a do futuro", () => {
    expect(Number.isNaN(instanteDe("2026-13-45T10:00:00Z"))).toBe(true);
    expect(Number.isNaN(instanteDe("2026-02-30T10:00:00Z"))).toBe(true);
    expect(Number.isNaN(instanteDe("2026-11-13T24:00:00Z"))).toBe(true);
    expect(instanteDe("2028-02-29T10:00:00-03:00")).toBe(Date.parse("2028-02-29T13:00:00Z"));
    const agora = Date.parse("2026-11-26T12:00:00Z");
    expect(problemaDataCommit("2026-11-26T12:05:00Z", agora)).toBeUndefined();
    expect(problemaDataCommit("2026-11-26T13:00:00Z", agora)).toContain("está no futuro");
    expect(problemaDataCommit("2026-13-45T10:00:00Z", agora)).toContain("não é uma data");
    const pasta = pastaTemporaria();
    const c = { raiz: pasta };
    const banco = criarBanco(NodePath.join(c.raiz, "kb.sqlite"), "2026.11.13");
    const chave = gerarChaves();
    const gerado = gerarCanal({
      saida: NodePath.join(pasta, "saida"),
      canal: "beta",
      commit: "abc1234",
      dataCommit: "2026-11-13T12:00:00Z",
      banco,
      appMinimo: "0.1.0",
      chave,
      nivel: 3,
    });
    const texto = NodeFS.readFileSync(NodePath.join(pasta, "saida", "beta.json"), "utf8");
    expect(decodificarManifesto(texto).versao).toBe(gerado.manifesto.versao);
    expect(() => decodificarManifesto(texto.replace("2026-11-13T12:00:00Z", "2026-13-45T10:00:00Z"))).toThrow(
      "esperava data e hora ISO 8601 com fuso",
    );
  });

  it("o mesmo manifesto se reprocessa: a skill que passou a ser elegível chega, e o catálogo perdido se regrava", async () => {
    const c = await cenario();
    try {
      c.publicar({
        versao: "2026.11.13",
        skills: [skill("a", "1.0.0", { appMinimo: "0.2.0" }), skill("b", "1.0.0")],
        tarefas: [tarefa("x")],
      });
      expect(await c.atualizar()).toMatchObject({ tipo: "baixada", skills: 1 });
      const primeira = await abrirApp(c);
      expect(NodeFS.readdirSync(primeira.pastasSkills[0]!)).toEqual(["b"]);

      // O app subiu para a 0.2.0: o mesmo manifesto traz a "a", numa pasta nova, sem baixar de novo a "b".
      c.servidor.pedidos.length = 0;
      expect(await c.atualizar("beta", new Map([["b", "1.0.0"]]), { versaoApp: "0.2.0" })).toMatchObject({
        tipo: "baixada",
        skills: 1,
        catalogo: false,
      });
      expect(c.servidor.pedidos).toContain("beta/skill-a-1.0.0.zst");
      expect(c.servidor.pedidos).not.toContain("beta/skill-b-1.0.0.zst");
      const segunda = await abrirApp(c);
      expect(segunda.pastasSkills).toEqual([NodePath.join(c.pastaApp, "skills", "2026.11.13+2")]);
      expect(NodeFS.readdirSync(segunda.pastasSkills[0]!).sort()).toEqual(["a", "b"]);
      // Nada falta: em dia, sem refazer.
      const disponiveis = new Map([
        ["a", "1.0.0"],
        ["b", "1.0.0"],
      ]);
      expect(await c.atualizar("beta", disponiveis, { versaoApp: "0.2.0" })).toEqual({ tipo: "em-dia" });

      // O catálogo atual se perdeu (corrompido e apagado): o mesmo manifesto o regrava, e ele volta na abertura.
      NodeFS.rmSync(caminhos(c.pastaApp).catalogoAtual);
      expect(await c.atualizar("beta", disponiveis, { versaoApp: "0.2.0" })).toMatchObject({ catalogo: true });
      expect((await abrirApp(c)).catalogo).toEqual({ versao: "2026.11.13", tarefas: [tarefa("x")] });
      expect(await c.atualizar("beta", disponiveis, { versaoApp: "0.2.0" })).toEqual({ tipo: "em-dia" });

      // Um manifesto mais velho que o último processado, reapresentado, não traz nada.
      c.publicar({ versao: "2026.11.12", skills: [skill("c", "1.0.0")], tarefas: [tarefa("velha")] });
      expect(await c.atualizar("beta", disponiveis, { versaoApp: "0.2.0" })).toEqual({ tipo: "em-dia" });
      expect(NodeFS.existsSync(caminhos(c.pastaApp).catalogoPendente)).toBe(false);
      expect(c.servidor.pedidos).not.toContain("beta/skill-c-1.0.0.zst");
    } finally {
      await c.fechar();
    }
  });

  it("retirada de skill em uso sinaliza pendência, também em dia e com o app velho demais", async () => {
    const c = await cenario();
    try {
      const emUso = new Map([["a", "1.0.0"]]);
      c.publicar({ versao: "2026.11.13", skillsRetiradas: ["a"] });
      expect(await c.atualizar("beta", emUso)).toMatchObject({
        tipo: "baixada",
        retiradasPendentes: { versao: "2026.11.13", skills: ["a"] },
      });
      expect(await c.atualizar("beta", emUso)).toEqual({
        tipo: "em-dia",
        retiradasPendentes: { versao: "2026.11.13", skills: ["a"] },
      });
      // Sem a skill em uso (o servidor já reiniciou), nada pendente.
      expect(await c.atualizar("beta", new Map())).toEqual({ tipo: "em-dia" });
      c.publicar({ versao: "2026.11.14", appMinimo: "0.2.0", skillsRetiradas: ["a", "b"] });
      expect(await c.atualizar("beta", new Map([["b", "1.0.0"]]))).toMatchObject({
        tipo: "app-desatualizado",
        retiradasPendentes: { versao: "2026.11.14", skills: ["b"] },
      });
    } finally {
      await c.fechar();
    }
  });

  it("retiradas.json apagado ou corrompido: recomposto do catálogo baixado; sem ele, as skills baixadas ficam de fora", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13", skills: [skill("a", "1.0.0"), skill("b", "1.0.0")] });
      await c.atualizar();
      await abrirApp(c);
      // A 2026.11.14 retira a "a", que continua na pasta de skills em uso.
      c.publicar({ versao: "2026.11.14", skills: [skill("b", "1.0.0")], skillsRetiradas: ["a"] });
      const emUso = new Map([
        ["a", "1.0.0"],
        ["b", "1.0.0"],
      ]);
      await c.atualizar("beta", emUso);
      const aberta = await abrirApp(c);
      expect(NodeFS.readdirSync(aberta.pastasSkills[0]!).sort()).toEqual(["a", "b"]);
      expect(aberta.skillsRetiradas).toEqual(["a"]);

      for (const estrago of ["apagado", "corrompido"] as const) {
        if (estrago === "apagado") NodeFS.rmSync(caminhos(c.pastaApp).retiradas);
        else NodeFS.writeFileSync(caminhos(c.pastaApp).retiradas, "{ truncado");
        const recomposta = await abrirApp(c);
        expect(recomposta.skillsRetiradas).toEqual(["a"]);
        expect(recomposta.pastasSkills).toEqual(aberta.pastasSkills);
      }
      // Sem o catálogo baixado legível também: a pasta das skills baixadas não entra nesta abertura.
      NodeFS.writeFileSync(caminhos(c.pastaApp).catalogoAtual, "{ truncado");
      const semNada = await abrirApp(c);
      expect(semNada.pastasSkills).toEqual([]);
      expect(semNada.eventos.some((evento) => evento.includes("as skills baixadas ficam de fora"))).toBe(true);
      // A conferência seguinte regrava o arquivo, e a pasta volta.
      await c.atualizar("beta", new Map([["b", "1.0.0"]]));
      expect((await abrirApp(c)).pastasSkills).toEqual(aberta.pastasSkills);
    } finally {
      await c.fechar();
    }
  });

  it("falha ao gravar retiradas.json vira aviso e não derruba a conferência nem a base", async () => {
    const c = await cenario();
    try {
      // Uma pasta no lugar do arquivo: nem se lê, nem se troca pelo `rename`.
      NodeFS.mkdirSync(caminhos(c.pastaApp).retiradas, { recursive: true });
      NodeFS.writeFileSync(NodePath.join(caminhos(c.pastaApp).retiradas, "ocupa"), "x");
      c.publicar({ versao: "2026.11.13", skills: [skill("a", "1.0.0")], skillsRetiradas: ["velha"] });
      const resultado = await c.atualizar();
      expect(resultado).toMatchObject({ tipo: "baixada", via: "inteiro", skills: 1, catalogo: true });
      expect(resultado.avisos?.[0]).toContain("a lista de skills retiradas não foi gravada");
      const aberta = await abrirApp(c);
      expect(aberta.info?.versao).toBe("2026.11.13");
      // As retiradas do catálogo baixado valem assim mesmo.
      expect(aberta.skillsRetiradas).toEqual(["velha"]);
    } finally {
      await c.fechar();
    }
  });

  it("retiradas.json que não se grava: a retirada em uso só vira pendência se ficou no catálogo baixado", async () => {
    const c = await cenario();
    try {
      NodeFS.mkdirSync(caminhos(c.pastaApp).retiradas, { recursive: true });
      NodeFS.writeFileSync(NodePath.join(caminhos(c.pastaApp).retiradas, "ocupa"), "x");
      const emUso = new Map([["velha", "1.0.0"]]);
      // O app velho demais: nada se grava além das retiradas, que falharam. O reinício não tiraria a skill.
      c.publicar({ versao: "2026.11.13", appMinimo: "0.2.0", skillsRetiradas: ["velha"] });
      const velho = await c.atualizar("beta", emUso);
      expect(velho).toMatchObject({ tipo: "app-desatualizado" });
      expect(velho.avisos?.[0]).toContain("a lista de skills retiradas não foi gravada");
      expect(velho.retiradasPendentes).toBeUndefined();
      // Com o app novo, o catálogo baixado guarda a retirada: o reinício a tira, e a pendência aparece.
      expect(await c.atualizar("beta", emUso, { versaoApp: "0.2.0" })).toMatchObject({
        catalogo: true,
        retiradasPendentes: { versao: "2026.11.13", skills: ["velha"] },
      });
    } finally {
      await c.fechar();
    }
  });

  it("catálogo que a abertura descartaria não se grava nem se anuncia: o do checkout e o de instalador mais novo", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13", tarefas: [tarefa("a")] });
      // Instalador de commit posterior ao do manifesto: o baixado perderia na abertura.
      const maisNovo: OrigemCatalogo = { tipo: "instalador", commit: "def5678", dataCommit: "2026-11-20T10:00:00Z" };
      expect(await c.atualizar("beta", new Map(), { catalogoEmpacotado: maisNovo })).toMatchObject({
        tipo: "baixada",
        catalogo: false,
      });
      expect(NodeFS.existsSync(caminhos(c.pastaApp).catalogoPendente)).toBe(false);
      expect(estadoNoDisco(c.pastaApp)).toMatchObject({ ultimoManifesto: "2026.11.13" });
      expect(estadoNoDisco(c.pastaApp).catalogoPendente).toBeUndefined();
      // O mesmo manifesto, de novo: nada a anunciar.
      expect(await c.atualizar("beta", new Map(), { catalogoEmpacotado: maisNovo })).toEqual({ tipo: "em-dia" });
      // No checkout (`pnpm app:dev`), o local vence sempre.
      c.publicar({ versao: "2026.11.14", tarefas: [tarefa("b")] });
      expect(await c.atualizar("beta", new Map(), { catalogoEmpacotado: { tipo: "checkout" } })).toMatchObject({
        catalogo: false,
      });
      expect(NodeFS.existsSync(caminhos(c.pastaApp).catalogoPendente)).toBe(false);
      // Sem pasta de tarefas, o baixado vale: grava-se.
      c.publicar({ versao: "2026.11.15", tarefas: [tarefa("c")] });
      expect(await c.atualizar()).toMatchObject({ catalogo: true });
      expect(NodeFS.existsSync(caminhos(c.pastaApp).catalogoPendente)).toBe(true);
    } finally {
      await c.fechar();
    }
  });

  it("dev-* contra uma versão fora do padrão não se compara", () => {
    expect(compararVersoes("dev-ab12cd34", "lixo")).toBeNaN();
    expect(compararVersoes("lixo", "dev-ab12cd34")).toBeNaN();
    expect(compararVersoes("dev-ab12cd34", "0.2.0-beta.1")).toBeNaN();
    expect(atende("dev-ab12cd34", "lixo")).toBe(false);
    expect(compararVersoes("dev-ab12cd34", "2026.11.20")).toBe(-1);
  });
});

describe("fábrica contra o publicado: versão, data do commit, promoção e registros malformados", () => {
  it("versão não maior, data do commit anterior à publicada e retirada que sumiu são recusadas", async () => {
    const c = await cenario();
    try {
      const { gerado } = c.publicar({ versao: "2026.11.13", skillsRetiradas: ["velha"] });
      const publicado = gerado.manifesto;
      const nova = { versao: "2026.11.14", dataCommit: "2026-11-14T12:00:00Z", skillsRetiradas: ["velha"] };
      expect(conferirContraPublicado(nova, publicado)).toEqual([]);
      expect(conferirContraPublicado({ ...nova, versao: "2026.11.13" }, publicado)[0]).toContain(
        "não é maior que a 2026.11.13",
      );
      // Um rebase que deixou a data do commit antes da do publicado: o publicado perderia para o instalador.
      expect(conferirContraPublicado({ ...nova, dataCommit: "2026-11-12T12:00:00Z" }, publicado)[0]).toContain(
        "é anterior à do manifesto publicado",
      );
      expect(conferirContraPublicado({ ...nova, skillsRetiradas: [] }, publicado)[0]).toContain("saiu da lista");
      // gerarCanal aplica a mesma conferência.
      expect(() =>
        c.publicar({ versao: "2026.11.14", dataCommit: "2026-11-12T12:00:00Z", skillsRetiradas: ["velha"], publicado }),
      ).toThrow("é anterior à do manifesto publicado");
    } finally {
      await c.fechar();
    }
  });

  it("promover confere contra o manifesto publicado do canal de destino", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13" });
      const texto = NodeFS.readFileSync(NodePath.join(c.raiz, "servido", "beta", "beta.json"), "utf8");
      const assinatura = NodeFS.readFileSync(NodePath.join(c.raiz, "servido", "beta", "beta.json.minisig"), "utf8");
      const { gerado } = c.publicar({ versao: "2026.11.14", canal: "estavel" });
      expect(() =>
        promoverManifesto({
          texto,
          assinatura,
          de: "beta",
          para: "estavel",
          chave: c.chave,
          agora: DateTime.toDateUtc(DateTime.makeUnsafe("2026-11-26T12:00:00Z")),
          publicado: gerado.manifesto,
        }),
      ).toThrow("não é maior que a 2026.11.14, publicada no canal estavel");
    } finally {
      await c.fechar();
    }
  });

  it("guarda de versão: versão malformada num registro anterior falha fechada, dizendo onde", () => {
    const skill: SkillDaFabrica = {
      nome: "a",
      versao: "1.0.0",
      appMinimo: "0.1.0",
      baseMinima: "2026.11.01",
      arquivos: [{ caminho: "SKILL.md", conteudo: Buffer.from("x") }],
    };
    const problemas = conferirVersoesSkills(
      [skill],
      [
        {
          versao: "2026.11.13",
          origem: "registro-local",
          skills: [{ nome: "a", versao: "2.0.x", sha256: "0".repeat(64) }],
        },
      ],
    );
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain('a versão "2.0.x" de a versão 2026.11.13 gerada neste computador');
    expect(conferirVersoesSkills([skill], [{ versao: "lixo", origem: "registro-local", skills: [] }])[0]).toContain(
      "está malformada",
    );
  });
});
