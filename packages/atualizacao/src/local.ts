// @effect-diagnostics nodeBuiltinImport:off -- arquivos da pasta do app e leitura do meta com node:sqlite, síncronos, antes de qualquer layer
/**
 * O lado local da atualização: a pasta do app, o estado gravado e a troca na abertura.
 *
 * ```
 * <pasta do app>/
 *   atualizacao.json        estado: canal, pendente, novidades, pedido de voltar
 *   base/kb.sqlite          a base baixada em uso
 *   base/kb.anterior.sqlite a versão anterior, para "voltar"
 *   base/pendente.sqlite    baixada e conferida, entra na próxima abertura
 *   base/baixando.*         temporários de um download em curso
 *   skills/<versao>/<nome>/ as skills baixadas de um manifesto
 * ```
 *
 * **A troca só acontece com o banco fechado**, na abertura do servidor (`prepararAbertura`), antes de
 * qualquer layer abrir o `kb.sqlite`: no Windows, renomear um arquivo aberto falha, e no macOS o
 * servidor continuaria lendo o arquivo antigo. Cada passo é um `rename` na mesma pasta (atômico), e o
 * arquivo pendente é conferido de novo (sha256) antes de entrar.
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { VERSAO_ESQUEMA } from "@simplifica-if/kb/db/esquema";
import { type Canal, compararVersoes, type Novidade, versaoDeData } from "./manifesto.ts";

export const ARQUIVO_ESTADO = "atualizacao.json";

export interface EstadoGravado {
  canal?: Canal;
  ultimaConferencia?: string;
  /** A base conferida em `base/pendente.sqlite`. */
  pendente?: { versao: string; sha256: string; novidades: ReadonlyArray<Novidade> };
  /** Pedido de voltar para a versão anterior, atendido na próxima abertura. */
  voltar?: boolean;
  /** A versão de que se voltou: não se baixa de novo; só uma mais nova. */
  recusada?: string;
  /** As novidades da última base aplicada; `vista` depois do aviso. */
  novidades?: { versao: string; itens: ReadonlyArray<Novidade>; vista: boolean };
  /** O conjunto de skills baixado em uso (`skills/<versao>`) e o que entra na próxima abertura. */
  skills?: string;
  skillsPendentes?: string;
  /** O `gerado_em` do último manifesto conferido: mais de 14 dias, e a tela avisa que não confirmou a base. */
  manifestoGeradoEm?: string;
}

export const caminhos = (pasta: string) => ({
  estado: NodePath.join(pasta, ARQUIVO_ESTADO),
  base: NodePath.join(pasta, "base"),
  atual: NodePath.join(pasta, "base", "kb.sqlite"),
  anterior: NodePath.join(pasta, "base", "kb.anterior.sqlite"),
  pendente: NodePath.join(pasta, "base", "pendente.sqlite"),
  baixando: NodePath.join(pasta, "base", "baixando.sqlite"),
  recusada: NodePath.join(pasta, "base", "kb.recusada.sqlite"),
  skills: NodePath.join(pasta, "skills"),
});

export function lerEstado(pasta: string): EstadoGravado {
  try {
    const lido: unknown = JSON.parse(NodeFS.readFileSync(caminhos(pasta).estado, "utf8"));
    return typeof lido === "object" && lido !== null ? (lido as EstadoGravado) : {};
  } catch {
    return {};
  }
}

/** Grava o estado por arquivo temporário e `rename`. */
export function gravarEstado(pasta: string, estado: EstadoGravado): void {
  const destino = caminhos(pasta).estado;
  NodeFS.mkdirSync(pasta, { recursive: true });
  const temporario = `${destino}.${process.pid}.tmp`;
  try {
    NodeFS.writeFileSync(temporario, `${JSON.stringify(estado, null, 2)}\n`);
    NodeFS.renameSync(temporario, destino);
  } catch (erro) {
    NodeFS.rmSync(temporario, { force: true });
    throw erro;
  }
}

/* ------------------------------------------------------------------ trava */

export const ARQUIVO_TRAVA = "atualizacao.trava";

const vivo = (pid: number) => {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (erro) {
    // EPERM: o processo existe, de outro usuário.
    return (erro as NodeJS.ErrnoException).code === "EPERM";
  }
};

/**
 * Toma a trava da pasta (`atualizacao.trava`, criada com `wx` e o pid dentro), para dois processos não
 * mexerem na mesma pasta ao mesmo tempo. Uma trava de processo que já morreu (ou deste mesmo pid,
 * sobra de uma execução anterior) é velha e se retoma. Devolve a função que solta, ou `null` se outro
 * processo vivo a tem. O app e o `simplifica-mcp` usam pastas próprias; a trava é a rede de proteção.
 */
export function tomarTrava(pasta: string): (() => void) | null {
  NodeFS.mkdirSync(pasta, { recursive: true });
  const arquivo = NodePath.join(pasta, ARQUIVO_TRAVA);
  for (let tentativa = 0; tentativa < 2; tentativa += 1) {
    try {
      const descritor = NodeFS.openSync(arquivo, "wx");
      NodeFS.writeSync(descritor, String(process.pid));
      NodeFS.closeSync(descritor);
      return () => NodeFS.rmSync(arquivo, { force: true });
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code !== "EEXIST") throw erro;
      let dono = Number.NaN;
      try {
        dono = Number.parseInt(NodeFS.readFileSync(arquivo, "utf8"), 10);
      } catch {
        // sumiu entre o open e a leitura: tenta de novo
      }
      if (vivo(dono)) return null;
      NodeFS.rmSync(arquivo, { force: true });
    }
  }
  return null;
}

/* ------------------------------------------------------------------ o banco */

export interface InfoBanco {
  readonly versao: string;
  readonly dataReferencia: string | null;
  readonly commit: string | null;
}

/** A versão de um `kb.sqlite` pelo `meta` (`versao`, ou a data de referência); `null` se não abrir. */
export function lerInfoBanco(caminho: string): InfoBanco | null {
  if (!NodeFS.existsSync(caminho)) return null;
  try {
    const db = new NodeSqlite.DatabaseSync(caminho, { readOnly: true });
    try {
      const meta = new Map(
        db
          .prepare("SELECT chave, valor FROM meta")
          .all()
          .map((linha) => [String(linha["chave"]), String(linha["valor"])]),
      );
      const data = meta.get("data_referencia") ?? null;
      const versao = meta.get("versao") ?? (data === null ? null : versaoDeData(data));
      if (versao === null) return null;
      return { versao, dataReferencia: data, commit: meta.get("commit") ?? null };
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/**
 * Confere um banco baixado antes de ele virar pendente: abre, `quick_check`, versão do esquema igual à
 * deste app, versão e data de referência iguais às do manifesto. Lança com o motivo em português.
 *
 * Só usa os parâmetros e globais: o `Worker` (`validarBancoEmWorker`) roda o texto desta função.
 */
export function validarBancoNucleo(
  sqlite: typeof NodeSqlite,
  versaoEsquema: number,
  caminho: string,
  esperado: { versao: string; dataReferencia?: string },
): InfoBanco {
  let db: NodeSqlite.DatabaseSync;
  try {
    db = new sqlite.DatabaseSync(caminho, { readOnly: true });
  } catch (erro) {
    throw new Error(`a base baixada não abre: ${String(erro)}`, { cause: erro });
  }
  try {
    const checagem = db.prepare("PRAGMA quick_check").all();
    const resultado = checagem.map((linha) => String(Object.values(linha)[0])).join("; ");
    if (resultado !== "ok") throw new Error(`a base baixada está corrompida (${resultado.slice(0, 200)})`);
    const meta = new Map(
      db
        .prepare("SELECT chave, valor FROM meta")
        .all()
        .map((linha) => [String(linha["chave"]), String(linha["valor"])]),
    );
    if (meta.get("versao_esquema") !== String(versaoEsquema)) {
      throw new Error(
        `a base baixada é de outro esquema (${meta.get("versao_esquema") ?? "sem versão"}; este app lê o ${versaoEsquema})`,
      );
    }
    if (meta.get("versao") !== esperado.versao) {
      throw new Error(
        `a base baixada diz ser a versão ${meta.get("versao") ?? "?"}, e o manifesto, ${esperado.versao}`,
      );
    }
    if (esperado.dataReferencia !== undefined && meta.get("data_referencia") !== esperado.dataReferencia) {
      throw new Error("a data de referência da base baixada não é a do manifesto");
    }
    return {
      versao: esperado.versao,
      dataReferencia: meta.get("data_referencia") ?? null,
      commit: meta.get("commit") ?? null,
    };
  } catch (erro) {
    if (erro instanceof Error && erro.message.startsWith("a base baixada")) throw erro;
    throw new Error(`a base baixada não pôde ser lida: ${String(erro)}`, { cause: erro });
  } finally {
    db.close();
  }
}

export const validarBanco = (caminho: string, esperado: { versao: string; dataReferencia?: string }): InfoBanco =>
  validarBancoNucleo(NodeSqlite, VERSAO_ESQUEMA, caminho, esperado);

export function sha256Arquivo(caminho: string): string {
  const hash = NodeCrypto.createHash("sha256");
  const descritor = NodeFS.openSync(caminho, "r");
  try {
    const bloco = Buffer.alloc(4 * 1024 * 1024);
    for (;;) {
      const lidos = NodeFS.readSync(descritor, bloco, 0, bloco.length, null);
      if (lidos === 0) break;
      hash.update(bloco.subarray(0, lidos));
    }
  } finally {
    NodeFS.closeSync(descritor);
  }
  return hash.digest("hex");
}

const remover = (caminho: string) => NodeFS.rmSync(caminho, { force: true, recursive: true });

/** Escreve um arquivo por temporário + fsync + rename (o destino nunca fica pela metade). */
export function escreverAtomico(destino: string, dados: Uint8Array): void {
  NodeFS.mkdirSync(NodePath.dirname(destino), { recursive: true });
  const temporario = `${destino}.${process.pid}.tmp`;
  try {
    const descritor = NodeFS.openSync(temporario, "w");
    try {
      NodeFS.writeSync(descritor, dados);
      NodeFS.fsyncSync(descritor);
    } finally {
      NodeFS.closeSync(descritor);
    }
    NodeFS.renameSync(temporario, destino);
  } catch (erro) {
    NodeFS.rmSync(temporario, { force: true });
    throw erro;
  }
}

/** Sobras de uma execução que caiu: `*.tmp` da pasta e de `base/`, `baixando.sqlite` e `skills/*.baixando`. */
export function limparSobras(pasta: string): ReadonlyArray<string> {
  const c = caminhos(pasta);
  const sobras: string[] = [];
  const varrer = (dir: string, teste: (nome: string) => boolean) => {
    if (!NodeFS.existsSync(dir)) return;
    for (const nome of NodeFS.readdirSync(dir)) {
      if (!teste(nome)) continue;
      NodeFS.rmSync(NodePath.join(dir, nome), { recursive: true, force: true });
      sobras.push(NodePath.relative(pasta, NodePath.join(dir, nome)));
    }
  };
  varrer(pasta, (nome) => nome.endsWith(".tmp"));
  varrer(c.base, (nome) => nome.endsWith(".tmp") || nome === "baixando.sqlite");
  varrer(c.skills, (nome) => nome.endsWith(".baixando"));
  return sobras;
}

/* ------------------------------------------------------------------ abertura */

export interface Abertura {
  /** O `kb.sqlite` que o servidor abre. */
  readonly banco: string;
  readonly origem: "empacotada" | "baixada";
  readonly info: InfoBanco | null;
  /** Pastas de skills baixadas, além das empacotadas (o `CatalogoSkills` escolhe a versão maior de cada). */
  readonly pastasSkills: ReadonlyArray<string>;
  /** O que aconteceu, para o log. */
  readonly eventos: ReadonlyArray<string>;
}

/**
 * Na abertura do servidor, antes de abrir a base: atende o pedido de voltar, põe a pendente no lugar
 * (guardando a atual como anterior), passa as skills pendentes a atuais e escolhe a base mais nova
 * entre a baixada e a empacotada (um app novo pode trazer uma base mais nova que a baixada).
 */
export function prepararAbertura(opcoes: { readonly pasta: string; readonly bancoEmpacotado: string }): Abertura {
  const c = caminhos(opcoes.pasta);
  const estado = lerEstado(opcoes.pasta);
  const eventos: string[] = [];
  NodeFS.mkdirSync(c.base, { recursive: true });
  // A troca só com a trava: outro processo baixando na mesma pasta não vê os arquivos mudando de nome.
  const soltar = tomarTrava(opcoes.pasta);
  if (soltar === null) {
    eventos.push("outro processo usa esta pasta de atualização; a troca fica para a próxima abertura");
  } else {
    try {
      for (const sobra of limparSobras(opcoes.pasta)) eventos.push(`sobra apagada: ${sobra}`);

      if (estado.voltar === true) {
        const saindo = lerInfoBanco(c.atual);
        if (NodeFS.existsSync(c.anterior)) {
          remover(c.recusada);
          if (NodeFS.existsSync(c.atual)) NodeFS.renameSync(c.atual, c.recusada);
          NodeFS.renameSync(c.anterior, c.atual);
          if (NodeFS.existsSync(c.recusada)) NodeFS.renameSync(c.recusada, c.anterior);
        } else if (NodeFS.existsSync(c.atual)) {
          // Sem anterior baixada: volta para a empacotada, guardando a que sai.
          NodeFS.renameSync(c.atual, c.anterior);
        }
        if (saindo !== null) estado.recusada = saindo.versao;
        delete estado.voltar;
        delete estado.novidades;
        if (estado.pendente !== undefined) {
          remover(c.pendente);
          delete estado.pendente;
        }
        eventos.push(`voltou da base ${saindo?.versao ?? "?"} para a anterior`);
      } else if (estado.pendente !== undefined) {
        const pendente = estado.pendente;
        if (NodeFS.existsSync(c.pendente) && sha256Arquivo(c.pendente) === pendente.sha256) {
          if (NodeFS.existsSync(c.atual)) NodeFS.renameSync(c.atual, c.anterior);
          NodeFS.renameSync(c.pendente, c.atual);
          estado.novidades = { versao: pendente.versao, itens: pendente.novidades, vista: false };
          eventos.push(`base ${pendente.versao} aplicada`);
        } else {
          remover(c.pendente);
          eventos.push(`base pendente ${pendente.versao} descartada (arquivo ausente ou alterado)`);
        }
        delete estado.pendente;
      }

      if (estado.skillsPendentes !== undefined) {
        const anterior = estado.skills;
        estado.skills = estado.skillsPendentes;
        delete estado.skillsPendentes;
        eventos.push(`skills ${estado.skills} aplicadas`);
        if (NodeFS.existsSync(c.skills)) {
          for (const pasta of NodeFS.readdirSync(c.skills)) {
            if (pasta !== estado.skills && pasta !== anterior) remover(NodePath.join(c.skills, pasta));
          }
        }
      }
      gravarEstado(opcoes.pasta, estado);
    } finally {
      soltar();
    }
  }

  const baixada = lerInfoBanco(c.atual);
  const empacotada = lerInfoBanco(opcoes.bancoEmpacotado);
  const usarBaixada =
    baixada !== null && (empacotada === null || compararVersoes(baixada.versao, empacotada.versao) >= 0);
  const pastaSkills = estado.skills === undefined ? undefined : NodePath.join(c.skills, estado.skills);
  return {
    banco: usarBaixada ? c.atual : opcoes.bancoEmpacotado,
    origem: usarBaixada ? "baixada" : "empacotada",
    info: usarBaixada ? baixada : empacotada,
    pastasSkills: pastaSkills !== undefined && NodeFS.existsSync(pastaSkills) ? [pastaSkills] : [],
    eventos,
  };
}
