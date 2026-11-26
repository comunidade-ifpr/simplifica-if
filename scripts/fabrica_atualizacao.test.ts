/**
 * A fábrica sem rede nem chave real: a árvore sai do commit (um repositório git temporário), os
 * comandos `gh` são montados por função pura e só mostrados sem `--executar`, e o par minisign é gerado
 * numa pasta temporária.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Command from "effect/cli/Command";
import type { Manifesto } from "@simplifica-if/atualizacao/manifesto";
import { gerarChaves, lerChaveSecreta } from "@simplifica-if/atualizacao/minisign";
import { cenario } from "@simplifica-if/atualizacao/testes/cenario";
import * as Option from "effect/Option";
import * as Configuracao from "./configuracao.ts";
import {
  arvoreDoCommit,
  comandoFabrica,
  comandosPublicacao,
  comandosPublicacaoApp,
  conferirDescendencia,
  conferirPrimeiraPublicacao,
  gerarChave,
  proximaVersao,
  skillsDoApp,
  manifestoPublicado,
  registrosAnteriores,
  skillsRetiradas,
  tarefasDoCatalogo,
  textoComando,
} from "./fabrica_atualizacao.ts";
import * as Git from "./git.ts";

const servicos = Layer.mergeAll(NodeServices.layer, Configuracao.layerAmbiente({ HOME: "/home/falso" }));

const pastaTemporaria = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.makeTempDirectoryScoped({ prefix: "simplifica-fabrica-" });
});

/** Um manifesto de tarefa de teste. */
const tarefaYaml = (id: string, abre: string) =>
  `id: ${id}\ntitulo: Tarefa ${id}\nresumo: Resumo.\narea: ensino\nsituacao: estavel\nmantenedor: { nome: Pessoa de Teste, github: pessoa-de-teste }\nabre: ${abre}\n`;

/** Console que guarda o que o programa escreve no stdout. */
const capturarSaida = (saida: string[]) => {
  const ignorar = () => {};
  return Effect.provideService(Console.Console, {
    ...globalThis.console,
    error: ignorar,
    warn: ignorar,
    log: (...partes: ReadonlyArray<unknown>) => saida.push(partes.join(" ")),
  });
};

describe("comandos gh da publicação", () => {
  it("base: release da versão, release do canal (pode já existir) e o manifesto trocado nele", () => {
    const comandos = comandosPublicacao({
      canal: "beta",
      versao: "2026.11.20",
      repositorio: "dono/repo",
      pacotes: ["/f/base.sqlite.zst", "/f/skills.tar.zst"],
      manifesto: ["/f/beta.json", "/f/beta.json.minisig"],
    });
    expect(comandos.map((comando) => textoComando(comando.args))).toEqual([
      '$ gh release create base-2026.11.20 /f/base.sqlite.zst /f/skills.tar.zst --repo dono/repo --title "Base 2026.11.20" --notes "Base de conhecimento 2026.11.20." --latest=false',
      '$ gh release create canal-beta --repo dono/repo --prerelease --latest=false --title "Canal beta" --notes "Manifesto do canal. Não apague: o app procura aqui."',
      "$ gh release upload canal-beta /f/beta.json /f/beta.json.minisig --clobber --repo dono/repo",
    ]);
    expect(comandos.map((comando) => comando.podeJaExistir === true)).toEqual([false, true, false]);
  });

  it("promoção (sem pacotes): não recria o release da versão", () => {
    const comandos = comandosPublicacao({
      canal: "estavel",
      versao: "2026.11.20",
      repositorio: "dono/repo",
      pacotes: [],
      manifesto: ["/f/estavel.json", "/f/estavel.json.minisig"],
    });
    expect(comandos.map((comando) => comando.args.slice(0, 4).join(" "))).toEqual([
      "gh release create canal-estavel",
      "gh release upload canal-estavel",
    ]);
  });

  it("app: instaladores no release app-v<versao> e os yml no release do canal", () => {
    const comandos = comandosPublicacaoApp({
      canal: "beta",
      versao: "0.2.0",
      repositorio: "dono/repo",
      instaladores: ["/p/Simplifica-IF-0.2.0-arm64.dmg"],
      ymls: ["/s/latest-mac.yml"],
    });
    expect(comandos.map((comando) => textoComando(comando.args))).toEqual([
      '$ gh release create app-v0.2.0 /p/Simplifica-IF-0.2.0-arm64.dmg --repo dono/repo --title "Simplifica IF 0.2.0" --notes "Instaladores do app." --latest=false',
      "$ gh release upload canal-beta /s/latest-mac.yml --clobber --repo dono/repo",
    ]);
  });
});

describe("registros das versões geradas", () => {
  it("em ordem de versão, só os anteriores à que se gera; o último é a versão imediatamente antes", () => {
    const registro = (versao: string) => ({ versao, commit: `c-${versao}` });
    const registros = ["2026.11.20.json", "2026.11.20.2.json", "2026.11.19", "2026.11.21", "2026.11.20.10"].map(
      (nome) => registro(nome.replace(/\.json$/, "")),
    );
    expect(registrosAnteriores(registros, "2026.11.21").map((r) => r.versao)).toEqual([
      "2026.11.19",
      "2026.11.20",
      "2026.11.20.2",
      "2026.11.20.10",
    ]);
    expect(registrosAnteriores(registros, "2026.11.20.2").at(-1)?.commit).toBe("c-2026.11.20");
  });
});

describe("versão nova do canal", () => {
  it("a data de hoje; com versão no mesmo dia, o .N seguinte", () => {
    expect(proximaVersao("2026-11-24", [])).toBe("2026.11.24");
    expect(proximaVersao("2026-11-24", ["2026.11.20", "2026.11.24"])).toBe("2026.11.24.2");
    expect(proximaVersao("2026-11-24", ["2026.11.24", "2026.11.24.3", "2026.11.24.2"])).toBe("2026.11.24.4");
    expect(proximaVersao("2026-11-24", ["2026.11.24.x", "2026.11.240"])).toBe("2026.11.24");
    // A publicada é de um dia posterior ao local (outro fuso, relógio adiantado): a nova passa dela.
    expect(proximaVersao("2026-11-24", ["2026.11.25"])).toBe("2026.11.25.2");
    expect(proximaVersao("2026-11-24", ["2026.11.20", "2026.11.25.3"])).toBe("2026.11.25.4");
  });
});

// processo filho e arquivos reais: `it.live`, sem o TestClock
describe("fábrica da atualização", () => {
  it.live("a árvore sai do commit: sem não rastreados, ignorados e mudanças fora do commit", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const repo = yield* pastaTemporaria;
        const git = (...args: string[]) =>
          Git.executar(["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo });
        yield* git("init", "-q");
        for (const pasta of ["base-conhecimento", "packages/kb", "catalogo/skills", "catalogo/tarefas"]) {
          yield* fs.makeDirectory(path.join(repo, pasta), { recursive: true });
          yield* fs.writeFileString(path.join(repo, pasta, "LEIAME"), "x\n");
        }
        yield* fs.writeFileString(path.join(repo, "base-conhecimento", "norma.md"), "texto do commit\n");
        yield* fs.writeFileString(path.join(repo, ".gitignore"), "base-conhecimento/ignorado.md\n");
        yield* git("add", ".");
        yield* git("commit", "-q", "-m", "x");
        yield* fs.writeFileString(path.join(repo, "base-conhecimento", "norma.md"), "editado no disco\n");
        yield* fs.writeFileString(path.join(repo, "base-conhecimento", "novo.md"), "não rastreado\n");
        yield* fs.writeFileString(path.join(repo, "base-conhecimento", "ignorado.md"), "ignorado\n");

        const arvore = yield* arvoreDoCommit("HEAD", path.join(yield* pastaTemporaria, "arvore"), repo);

        expect((yield* fs.readDirectory(path.join(arvore, "base-conhecimento"))).sort()).toEqual([
          "LEIAME",
          "norma.md",
        ]);
        expect(yield* fs.readFileString(path.join(arvore, "base-conhecimento", "norma.md"))).toBe("texto do commit\n");
        // O catálogo (tarefas e skills) vai na árvore do commit.
        expect((yield* fs.readDirectory(path.join(arvore, "catalogo"))).sort()).toEqual(["skills", "tarefas"]);
      }),
    ).pipe(Effect.provide(servicos)),
  );

  const skillMd = (nome: string, bloco: boolean) =>
    `---\nname: ${nome}\ndescription: x\n${bloco ? "simplifica:\n  versao: 1.2.0\n  ferramentas: []\n  arquivos: [ref.md]\n" : ""}---\nCorpo.\n`;

  /** Uma árvore de commit de mentira, com os arquivos dados (caminho relativo → texto). */
  const arvoreCom = Effect.fn("teste.arvoreCom")(function* (arquivos: Readonly<Record<string, string>>) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const arvore = yield* pastaTemporaria;
    for (const [caminho, texto] of Object.entries(arquivos)) {
      const alvo = path.join(arvore, ...caminho.split("/"));
      yield* fs.makeDirectory(path.dirname(alvo), { recursive: true });
      yield* fs.writeFileString(alvo, texto);
    }
    return arvore;
  });

  it.live("catálogo do commit: as skills com os arquivos do pacote e as tarefas juntas, em ordem de id", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const arvore = yield* arvoreCom({
          "catalogo/skills/conferir/SKILL.md": skillMd("conferir", true),
          "catalogo/skills/conferir/ref.md": "referência\n",
          "catalogo/skills/conferir/scripts/nao-vai.ts": "// fica no repositório\n",
          "catalogo/skills/retiradas.yaml": "retiradas: []\n",
          "catalogo/tarefas/revisar.yaml": tarefaYaml("revisar", "{ modulo: revisao-ppc }"),
          "catalogo/tarefas/conferir.yaml": tarefaYaml(
            "conferir",
            '{ conversa: { skill: conferir, pedido: "Confira." } }',
          ),
        });
        const skills = yield* skillsDoApp(arvore);
        expect(skills.map((skill) => [skill.nome, skill.versao, skill.arquivos.map((a) => a.caminho)])).toEqual([
          ["conferir", "1.2.0", ["SKILL.md", "ref.md"]],
        ]);
        const tarefas = yield* tarefasDoCatalogo(arvore, [{ nome: "conferir", appMinimo: "0.1.0" }]);
        expect(tarefas.map((tarefa) => tarefa["id"])).toEqual(["conferir", "revisar"]);
        expect(tarefas[0]).toMatchObject({ abre: { conversa: { skill: "conferir", pedido: "Confira." } } });
        // Sem a skill publicada, a tarefa que a cita não sai; a árvore sem catálogo dá um catálogo vazio.
        expect(yield* Effect.flip(tarefasDoCatalogo(arvore, []))).toMatchObject({
          _tag: "ConferenciaRecusada",
          conferencia: "tarefas",
          itens: ["tarefa conferir: cita skill que não existe: conferir"],
        });
        const vazia = yield* arvoreCom({ "base-conhecimento/LEIAME": "x\n" });
        expect(yield* skillsDoApp(vazia)).toEqual([]);
        expect(yield* tarefasDoCatalogo(vazia, [])).toEqual([]);
        expect(yield* skillsRetiradas(vazia, vazia, [])).toEqual([]);
      }),
    ).pipe(Effect.provide(servicos)),
  );

  it.live("catálogo do commit: recusa skill sem o bloco, tarefa inválida e campo desconhecido", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const arvore = yield* arvoreCom({
          "catalogo/skills/esquecida/SKILL.md": skillMd("esquecida", false),
          "catalogo/tarefas/a-mais.yaml": `${tarefaYaml("a-mais", "{ modulo: revisao-ppc }")}versao: 1.0.0\n`,
          "catalogo/tarefas/sem-modulo.yaml": tarefaYaml("sem-modulo", "{ modulo: calendario }"),
        });
        expect(yield* Effect.flip(skillsDoApp(arvore))).toMatchObject({
          _tag: "ConferenciaRecusada",
          conferencia: "skills",
          itens: ["skill esquecida: sem o bloco simplifica: no SKILL.md"],
        });
        const recusa = yield* Effect.flip(tarefasDoCatalogo(arvore, []));
        expect(recusa).toMatchObject({ _tag: "ConferenciaRecusada", conferencia: "tarefas" });
        expect(recusa.message).toContain("tarefa a-mais.yaml: manifesto inválido");
        expect(recusa.message).toContain("tarefa sem-modulo: cita modulo que não existe: calendario");
      }),
    ).pipe(Effect.provide(servicos)),
  );

  it.live("tarefa de app_minimo menor que o da skill que ela cita não se publica", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const arvore = yield* arvoreCom({
          "catalogo/tarefas/conferir.yaml": tarefaYaml(
            "conferir",
            '{ conversa: { skill: conferir, pedido: "Confira." } }',
          ),
        });
        expect(yield* Effect.flip(tarefasDoCatalogo(arvore, [{ nome: "conferir", appMinimo: "0.2.0" }]))).toMatchObject(
          {
            _tag: "ConferenciaRecusada",
            conferencia: "tarefas",
            itens: [
              "tarefa conferir: app_minimo ausente (0.1.0) é menor que o 0.2.0 da skill conferir; declare app_minimo: 0.2.0 ou maior na tarefa",
            ],
          },
        );
      }),
    ).pipe(Effect.provide(servicos)),
  );

  it.live("skills retiradas: os nomes do commit; recusa entrada apagada desde cada commit anterior", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const repo = yield* pastaTemporaria;
        const git = (...args: string[]) =>
          Git.executar(["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo });
        const arquivo = path.join(repo, "catalogo", "skills", "retiradas.yaml");
        const entrada = (skill: string) => `  - { skill: ${skill}, data: 2026-11-26, motivo: Erro grave. }\n`;
        yield* git("init", "-q");
        yield* fs.makeDirectory(path.dirname(arquivo), { recursive: true });
        yield* fs.writeFileString(arquivo, `retiradas:\n${entrada("velha")}`);
        yield* git("add", ".");
        yield* git("commit", "-q", "-m", "retira a velha");
        const primeiro = (yield* git("rev-parse", "HEAD")).trim();

        // Só acréscimo desde o commit da última versão: passa, com os nomes em ordem. Um commit que o git
        // não tem (o do manifesto publicado num clone raso) não tem o que conferir.
        yield* fs.writeFileString(arquivo, `retiradas:\n${entrada("velha")}${entrada("antiga")}`);
        expect(yield* skillsRetiradas(repo, repo, [primeiro, "0000000"])).toEqual(["antiga", "velha"]);
        // Apagar uma entrada (a skill "voltaria" só para quem não atualizou) é recusado.
        yield* fs.writeFileString(arquivo, `retiradas:\n${entrada("antiga")}`);
        expect(yield* Effect.flip(skillsRetiradas(repo, repo, [primeiro]))).toMatchObject({
          _tag: "ConferenciaRecusada",
          itens: ["a retirada da skill velha foi alterada"],
        });
      }),
    ).pipe(Effect.provide(servicos)),
  );

  it.live("publicar sem --executar só mostra os comandos gh, com os pacotes da saída do canal", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const raiz = yield* pastaTemporaria;
        const saidaCanal = path.join(raiz, "tmp", "fabrica", "beta-2026.11.20");
        yield* fs.makeDirectory(saidaCanal, { recursive: true });
        for (const nome of ["beta.json", "beta.json.minisig", "base-2026.11.20.sqlite.zst"]) {
          yield* fs.writeFileString(path.join(saidaCanal, nome), "x");
        }
        const saida: string[] = [];
        const executar = (argv: ReadonlyArray<string>) =>
          Command.runWith(comandoFabrica({ raiz, node: "node" }), { version: "teste" })(argv).pipe(
            capturarSaida(saida),
            Effect.exit,
          );

        const exit = yield* executar(["publicar", "--versao", "2026.11.20", "--repositorio", "dono/repo"]);

        expect(Exit.isSuccess(exit)).toBe(true);
        expect(saida).toEqual([
          `$ gh release create base-2026.11.20 ${path.join(saidaCanal, "base-2026.11.20.sqlite.zst")} --repo dono/repo --title "Base 2026.11.20" --notes "Base de conhecimento 2026.11.20." --latest=false`,
          '$ gh release create canal-beta --repo dono/repo --prerelease --latest=false --title "Canal beta" --notes "Manifesto do canal. Não apague: o app procura aqui."',
          `$ gh release upload canal-beta ${path.join(saidaCanal, "beta.json")} ${path.join(saidaCanal, "beta.json.minisig")} --clobber --repo dono/repo`,
          "\n(só mostrei os comandos; rode de novo com --executar para publicar)",
        ]);

        // Repositório inválido e canal sem saída são recusados antes de qualquer comando.
        saida.length = 0;
        expect(Exit.isFailure(yield* executar(["publicar", "--versao", "2026.11.20", "--repositorio", "x"]))).toBe(
          true,
        );
        const semSaida = yield* executar(["publicar", "--versao", "2000.01.01", "--repositorio", "dono/repo"]);
        expect(semSaida).toMatchObject({ _tag: "Failure" });
        expect(saida.filter((linha) => linha.startsWith("$ gh"))).toEqual([]);
      }),
    ).pipe(Effect.provide(servicos)),
  );

  it.live("gerar-chave grava o par fora do repositório e não sobrescreve uma chave existente", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const raiz = yield* pastaTemporaria;
        const pasta = path.join(yield* pastaTemporaria, "chave");
        const saida: string[] = [];

        yield* gerarChave(pasta, raiz).pipe(capturarSaida(saida));

        const secreta = path.join(pasta, "simplifica-fabrica.key");
        expect(((yield* fs.stat(secreta)).mode & 0o777).toString(8)).toBe("600");
        expect(lerChaveSecreta(yield* fs.readFileString(secreta)).chave).toHaveLength(32);
        expect(saida[0]).toBe(`chave secreta: ${secreta} (sem senha)`);
        expect(saida[2]).toBe((yield* fs.readFileString(path.join(pasta, "simplifica-fabrica.pub"))).split("\n")[1]);

        expect(yield* Effect.flip(gerarChave(pasta, raiz))).toMatchObject({
          _tag: "ChaveIndisponivel",
          motivo: "ja-existe",
        });
        expect(yield* Effect.flip(gerarChave(path.join(raiz, "chave"), raiz))).toMatchObject({
          _tag: "ChaveIndisponivel",
          motivo: "dentro-do-repositorio",
        });
      }),
    ).pipe(Effect.provide(servicos)),
  );
});

describe("fábrica contra o manifesto publicado do canal", () => {
  it.live("lê do arquivo ou baixa do canal, com a assinatura; sem fonte ou com o canal vazio, recusa", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const c = yield* Effect.promise(cenario);
        yield* Effect.addFinalizer(() => Effect.promise(() => c.fechar()));
        c.publicar({ versao: "2026.11.13", skillsRetiradas: ["velha"] });
        const arquivo = path.join(c.raiz, "servido", "beta", "beta.json");
        const base = {
          arquivo: Option.none<string>(),
          url: Option.none<string>(),
          primeiraPublicacao: false,
          chave: c.chave,
          canal: "beta" as const,
        };
        const doArquivo = yield* manifestoPublicado({ ...base, arquivo: Option.some(arquivo) });
        expect(Option.getOrThrow(doArquivo).skills_retiradas).toEqual(["velha"]);
        const baixado = yield* manifestoPublicado({ ...base, url: Option.some(`${c.servidor.url}beta/beta.json`) });
        expect(Option.getOrThrow(baixado).versao).toBe("2026.11.13");
        expect(yield* Effect.flip(manifestoPublicado(base))).toMatchObject({
          _tag: "SemManifestoPublicado",
          motivo: "sem-fonte",
        });
        const vazio = yield* Effect.flip(
          manifestoPublicado({ ...base, canal: "estavel", url: Option.some(`${c.servidor.url}estavel/estavel.json`) }),
        );
        expect(vazio).toMatchObject({ _tag: "SemManifestoPublicado", motivo: "canal-vazio" });
        expect(vazio.message).toContain("--primeira-publicacao");
        expect(yield* manifestoPublicado({ ...base, primeiraPublicacao: true })).toEqual(Option.none());
        // Assinado por outra chave: recusado.
        expect(
          yield* Effect.flip(manifestoPublicado({ ...base, arquivo: Option.some(arquivo), chave: gerarChaves() })),
        ).toMatchObject({ _tag: "EtapaFalhou", etapa: "ler o manifesto publicado" });
      }),
    ).pipe(Effect.provide(servicos)),
  );

  /** Um compilador de mentira na árvore do commit: grava um banco só com o `meta`, como o `kb compilar`. */
  const COMPILAR = [
    'import { DatabaseSync } from "node:sqlite";',
    'import { parseArgs } from "node:util";',
    'const { values } = parseArgs({ options: { destino: { type: "string" }, versao: { type: "string" }, commit: { type: "string" } } });',
    "const db = new DatabaseSync(values.destino);",
    'db.exec("CREATE TABLE meta (chave TEXT PRIMARY KEY, valor TEXT)");',
    'const meta = db.prepare("INSERT INTO meta VALUES (?, ?)");',
    'for (const [chave, valor] of [["versao_esquema", "1"], ["data_referencia", "2026-11-20"], ["versao", values.versao], ["commit", values.commit], ["fontes_sha256", "f".repeat(64)]]) meta.run(chave, valor);',
    "db.close();",
    "",
  ].join("\n");

  it.live("canal: o banco só vai para bases/ com o registro, no fim; uma recusa não deixa banco órfão", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const repo = yield* pastaTemporaria;
        const pastaChave = path.join(yield* pastaTemporaria, "chave");
        yield* gerarChave(pastaChave, repo).pipe(capturarSaida([]));
        const git = (...args: string[]) =>
          Git.executar(["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo });
        const escrever = Effect.fn(function* (caminho: string, texto: string) {
          yield* fs.makeDirectory(path.dirname(path.join(repo, caminho)), { recursive: true });
          yield* fs.writeFileString(path.join(repo, caminho), texto);
        });
        yield* git("init", "-q");
        yield* escrever("base-conhecimento/novidades.yaml", "versoes: []\n");
        yield* escrever("packages/kb/src/cli/compilar.ts", COMPILAR);
        // A tarefa cita uma skill que não existe: a fábrica recusa depois de compilar.
        yield* escrever(
          "catalogo/tarefas/conferir.yaml",
          tarefaYaml("conferir", '{ conversa: { skill: nao-existe, pedido: "Confira." } }'),
        );
        yield* git("add", ".");
        yield* git("commit", "-q", "-m", "x");
        const ambiente = Configuracao.layerAmbiente({
          HOME: "/home/falso",
          SIMPLIFICA_MINISIGN_CHAVE: path.join(pastaChave, "simplifica-fabrica.key"),
        });
        const canal = (...args: string[]) =>
          Command.runWith(comandoFabrica({ raiz: repo, node: process.execPath }), { version: "teste" })([
            "canal",
            "--versao",
            "2026.11.20",
            ...args,
          ]).pipe(capturarSaida([]), Effect.provide(ambiente), Effect.flip);
        const fabrica = path.join(repo, "tmp", "fabrica");
        const bases = path.join(fabrica, "bases");
        const listar = (pasta: string) =>
          Effect.map(fs.exists(pasta), (existe) => existe).pipe(
            Effect.flatMap((existe) => (existe ? fs.readDirectory(pasta) : Effect.succeed([]))),
          );

        // Sem o manifesto publicado nem --primeira-publicacao: recusa antes de compilar.
        expect(yield* canal()).toMatchObject({ _tag: "SemManifestoPublicado", motivo: "sem-fonte" });
        expect(yield* listar(bases)).toEqual([]);

        expect(yield* canal("--primeira-publicacao")).toMatchObject({
          _tag: "ConferenciaRecusada",
          conferencia: "tarefas",
        });
        expect(yield* listar(bases)).toEqual([]);
        expect(yield* listar(path.join(fabrica, "compilando"))).toEqual([]);
        expect(yield* fs.exists(path.join(fabrica, "beta-2026.11.20"))).toBe(false);

        yield* escrever("catalogo/tarefas/conferir.yaml", tarefaYaml("conferir", "{ modulo: revisao-ppc }"));
        yield* git("commit", "-q", "-am", "y");
        const saida: string[] = [];
        const exit = yield* Command.runWith(comandoFabrica({ raiz: repo, node: process.execPath }), {
          version: "teste",
        })(["canal", "--versao", "2026.11.20", "--primeira-publicacao"]).pipe(
          capturarSaida(saida),
          Effect.provide(ambiente),
          Effect.exit,
        );
        expect(Exit.isSuccess(exit)).toBe(true);
        expect((yield* listar(bases)).sort()).toEqual(["2026.11.20.json", "2026.11.20.sqlite"]);
        expect(yield* fs.exists(path.join(fabrica, "compilando"))).toBe(false);
        const manifesto = JSON.parse(yield* fs.readFileString(path.join(fabrica, "beta-2026.11.20", "beta.json"))) as {
          data_commit: string;
        };
        expect(Date.parse(manifesto.data_commit)).not.toBeNaN();
      }),
    ).pipe(Effect.provide(servicos)),
  );

  it.live(
    "canal contra o publicado: versão maior, commit que descende, data não no futuro, primeira publicação só sem nada",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const repo = yield* pastaTemporaria;
          const pastaChave = path.join(yield* pastaTemporaria, "chave");
          yield* gerarChave(pastaChave, repo).pipe(capturarSaida([]));
          const git = (...args: string[]) =>
            Git.executar(["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo });
          const escrever = Effect.fn(function* (caminho: string, texto: string) {
            yield* fs.makeDirectory(path.dirname(path.join(repo, caminho)), { recursive: true });
            yield* fs.writeFileString(path.join(repo, caminho), texto);
          });
          yield* git("init", "-q");
          yield* escrever("base-conhecimento/novidades.yaml", "versoes: []\n");
          yield* escrever("packages/kb/src/cli/compilar.ts", COMPILAR);
          yield* escrever("catalogo/tarefas/conferir.yaml", tarefaYaml("conferir", "{ modulo: revisao-ppc }"));
          yield* git("add", ".");
          yield* git("commit", "-q", "-m", "x");
          const ambiente = Configuracao.layerAmbiente({
            HOME: "/home/falso",
            SIMPLIFICA_MINISIGN_CHAVE: path.join(pastaChave, "simplifica-fabrica.key"),
          });
          const rodar = (...args: string[]) =>
            Command.runWith(comandoFabrica({ raiz: repo, node: process.execPath }), { version: "teste" })(args).pipe(
              capturarSaida([]),
              Effect.provide(ambiente),
            );
          const canal = (...args: string[]) => rodar("canal", ...args).pipe(Effect.flip);
          const bases = path.join(repo, "tmp", "fabrica", "bases");

          yield* rodar("canal", "--versao", "2026.11.20", "--primeira-publicacao");
          // O publicado: o manifesto que saiu, com a assinatura, fora da pasta da fábrica.
          const publicado = path.join(yield* pastaTemporaria, "beta.json");
          yield* fs.copyFile(path.join(repo, "tmp", "fabrica", "beta-2026.11.20", "beta.json"), publicado);
          yield* fs.copyFile(
            path.join(repo, "tmp", "fabrica", "beta-2026.11.20", "beta.json.minisig"),
            `${publicado}.minisig`,
          );

          // --primeira-publicacao: não com as bases já geradas (sem --repositorio), nem com o manifesto publicado.
          const comBases = yield* canal("--versao", "2026.11.21", "--primeira-publicacao", "--mesmas-fontes");
          expect(comBases).toMatchObject({ _tag: "PrimeiraPublicacaoRecusada", motivo: "bases-com-versoes" });
          // A mensagem diz o que fazer, sem mandar de volta para --primeira-publicacao.
          expect(comBases.message).toContain("--repositorio dono/repo");
          expect(comBases.message).toContain("mova ou apague tmp/fabrica/bases/");
          // Com --repositorio, o 404 do canal é a prova: as bases guardadas não barram.
          yield* conferirPrimeiraPublicacao(repo, "beta", true);
          expect(
            yield* canal("--versao", "2026.11.21", "--primeira-publicacao", "--manifesto-publicado", publicado),
          ).toMatchObject({ _tag: "PrimeiraPublicacaoRecusada", motivo: "com-manifesto-publicado" });

          // A versão nova é estritamente maior que a publicada.
          const igual = yield* canal("--versao", "2026.11.20", "--manifesto-publicado", publicado, "--mesmas-fontes");
          expect(igual).toMatchObject({ _tag: "ConferenciaRecusada", conferencia: "publicado" });
          expect(igual.message).toContain("não é maior que a 2026.11.20");

          // Um registro local malformado (versão fora do padrão) é recusado, dizendo o arquivo.
          yield* fs.writeFileString(
            path.join(bases, "2026.11.19.json"),
            JSON.stringify({ versao: "lixo", commit: "abc", skills: [] }),
          );
          const malformado = yield* canal(
            "--versao",
            "2026.11.21",
            "--manifesto-publicado",
            publicado,
            "--mesmas-fontes",
          );
          expect(malformado).toMatchObject({ _tag: "EtapaFalhou" });
          expect(malformado.message).toContain("tmp/fabrica/bases/2026.11.19.json");
          yield* fs.remove(path.join(bases, "2026.11.19.json"));

          // Um commit que não descende do publicado (o histórico reescrito) é recusado.
          yield* git("commit", "-q", "--amend", "-m", "reescrito");
          const fora = yield* canal("--versao", "2026.11.21", "--manifesto-publicado", publicado, "--mesmas-fontes");
          expect(fora).toMatchObject({ _tag: "ConferenciaRecusada", conferencia: "publicado" });
          expect(fora.message).toContain("não descende");

          // A data do commit no futuro (relógio adiantado) é recusada antes de tudo.
          yield* Git.executar(
            ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "futuro"],
            {
              cwd: repo,
              env: { GIT_COMMITTER_DATE: "2099-01-01T00:00:00Z" },
            },
          );
          const futuro = yield* canal("--versao", "2026.11.21", "--manifesto-publicado", publicado, "--mesmas-fontes");
          expect(futuro).toMatchObject({ _tag: "ConferenciaRecusada", conferencia: "data" });
          expect(futuro.message).toContain("está no futuro");

          // O commit publicado que não está no clone: mensagem clara, sem pular a conferência.
          const manifesto = JSON.parse(yield* fs.readFileString(publicado)) as Manifesto;
          expect(
            yield* Effect.flip(conferirDescendencia({ ...manifesto, commit: "0123456789abcdef" }, "HEAD", repo)),
          ).toMatchObject({ _tag: "CommitPublicadoAusente", commit: "0123456789abcdef" });

          // promover também se confere contra o publicado do destino: sem fonte, recusa.
          expect(
            yield* Effect.flip(rodar("promover", "--de", "beta", "--para", "estavel", "--versao", "2026.11.20")),
          ).toMatchObject({
            _tag: "SemManifestoPublicado",
            motivo: "sem-fonte",
          });
        }),
      ).pipe(Effect.provide(servicos)),
  );

  it.live("--repositorio: baixa sempre; a primeira publicação só com o canal vazio; o arquivo dado é o publicado", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const c = yield* Effect.promise(cenario);
        yield* Effect.addFinalizer(() => Effect.promise(() => c.fechar()));
        c.publicar({ versao: "2026.11.13" });
        const arquivo = path.join(c.raiz, "servido", "beta", "beta.json");
        const base = {
          arquivo: Option.none<string>(),
          url: Option.some(`${c.servidor.url}beta/beta.json`),
          primeiraPublicacao: false,
          chave: c.chave,
          canal: "beta" as const,
        };
        expect(yield* Effect.flip(manifestoPublicado({ ...base, primeiraPublicacao: true }))).toMatchObject({
          _tag: "PrimeiraPublicacaoRecusada",
          motivo: "canal-publicado",
          detalhe: "2026.11.13",
        });
        const vazio = { ...base, canal: "estavel" as const, url: Option.some(`${c.servidor.url}estavel/estavel.json`) };
        expect(yield* manifestoPublicado({ ...vazio, primeiraPublicacao: true })).toEqual(Option.none());
        // O arquivo dado e o baixado: o mesmo passa; outro, ou com o canal vazio, não.
        expect(Option.getOrThrow(yield* manifestoPublicado({ ...base, arquivo: Option.some(arquivo) })).versao).toBe(
          "2026.11.13",
        );
        // Outro manifesto do beta, bem assinado, fora do lugar publicado.
        yield* Effect.sync(() => c.publicar({ versao: "2026.11.14", pastaCanal: "estavel" }));
        expect(
          yield* Effect.flip(
            manifestoPublicado({ ...base, arquivo: Option.some(path.join(c.raiz, "servido", "estavel", "beta.json")) }),
          ),
        ).toMatchObject({ _tag: "ManifestoPublicadoDiferente", motivo: "outro", versaoPublicada: "2026.11.13" });
        expect(
          yield* Effect.flip(
            manifestoPublicado({
              ...base,
              url: Option.some(`${c.servidor.url}vazio/beta.json`),
              arquivo: Option.some(arquivo),
            }),
          ),
        ).toMatchObject({ _tag: "ManifestoPublicadoDiferente", motivo: "canal-vazio" });
        // O manifesto no ar sem a assinatura (404 só do .minisig) não é canal vazio: é erro.
        yield* (yield* FileSystem.FileSystem).remove(path.join(c.raiz, "servido", "beta", "beta.json.minisig"));
        expect(yield* Effect.flip(manifestoPublicado({ ...base, primeiraPublicacao: true }))).toMatchObject({
          _tag: "EtapaFalhou",
          etapa: "baixar o manifesto publicado e a assinatura dele",
        });
      }),
    ).pipe(Effect.provide(servicos)),
  );
});
