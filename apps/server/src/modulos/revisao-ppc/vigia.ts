/**
 * O vigia do arquivo acompanhado no Word (a conferência ao salvar): avisa quando um salvamento pode ter
 * mudado o arquivo, e quem o usa (`ListaViva.acompanharLista`) compara o sha256 e confere.
 *
 * - Vigia a pasta, não o arquivo: o Word salva gravando um temporário e trocando o arquivo por ele (a
 *   troca por renomeação), e o vigia de um arquivo perderia o que vem depois da troca.
 * - Ignora os temporários do Word e dos outros editores (`ehTemporario`). O resto da pasta passa: um
 *   salvamento que chegue com outro nome do que se espera ainda é visto, e o sha256 decide.
 * - Espera `ESPERA` sem novas mudanças: o salvamento é uma rajada de eventos.
 * - O erro do `watch` vai ao log sem o caminho da pasta (`resumoDaFalha`).
 * - Uma verificação por vez. Os salvamentos que chegam no meio se juntam num só pedido, e a verificação
 *   lê o arquivo na hora: a última versão vence. Depois de uma conferência (o sha256 mudou), a próxima
 *   espera `INTERVALO_MINIMO`: o autossalvamento do Word 365 salva a cada poucos segundos.
 * - Na pasta em que o `watch` falha (OneDrive, rede), o vigia registra e para de ver os salvamentos; a
 *   interface confere quando a janela ganha foco (`revisaoPpc.conferirAcompanhado`).
 *
 * Os nomes e a espera saem do que se sabe do Word; a medição com o Word real está em "A conferir" do
 * plano da multitarefa (`docs/plans/multitarefa.md`).
 */
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { resumoDaFalha } from "../../observabilidade/resumoDaFalha.ts";

/** Quanto tempo sem novas mudanças na pasta antes de verificar. */
export const ESPERA = Duration.seconds(2);
/** O intervalo mínimo entre duas conferências (o autossalvamento). */
export const INTERVALO_MINIMO = Duration.seconds(15);

/**
 * Os arquivos que o salvamento cria e apaga ao lado do documento:
 * - `~$<nome>.docx`, o dono do documento aberto, e `~WRL0001.tmp`, `~WRD0001.tmp`, os temporários do
 *   salvamento do Word no Windows (todo `~…` e todo `.tmp`);
 * - `Word Work File …`, os do Word para Mac, e a cópia de segurança `.wbk`;
 * - os ocultos (`.~lock.<nome>#` do LibreOffice, `.DS_Store`, o temporário com que o app grava a cópia
 *   comentada) e os que terminam em `#`.
 */
export function ehTemporario(nome: string): boolean {
  const n = nome.trim().toLowerCase();
  return (
    n === "" ||
    n.startsWith("~") ||
    n.startsWith(".") ||
    n.endsWith(".tmp") ||
    n.endsWith(".wbk") ||
    n.endsWith("#") ||
    n.startsWith("word work file")
  );
}

/**
 * Vigia a pasta de `arquivo` e roda `verificar` ao começar e depois de cada salvamento, até ser
 * interrompido. `verificar` diz se conferiu (o arquivo tinha mudado): só então a próxima espera
 * `INTERVALO_MINIMO`. Uma falha de `verificar` é dele: ele a trata e a avisa.
 *
 * A espera conta do instante de cada mudança vista (e não de quando o trabalho acorda): o mesmo resultado
 * qualquer que seja a ordem em que as fibras andam.
 */
export const vigiar = Effect.fn("Vigia.vigiar")(function* (arquivo: string, verificar: Effect.Effect<boolean>) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // Um pedido só esperando: os salvamentos do meio se juntam nele.
  const pedidos = yield* Queue.sliding<void>(1);
  yield* Queue.offer(pedidos, undefined);
  let ultimaMudanca = Number.NEGATIVE_INFINITY;
  let ultimaConferencia = Number.NEGATIVE_INFINITY;

  const trabalhar = Effect.gen(function* () {
    while (true) {
      yield* Queue.take(pedidos);
      // Até `ESPERA` sem mudanças e `INTERVALO_MINIMO` desde a última conferência; uma mudança que chega
      // na espera a estende.
      while (true) {
        const ate = Math.max(
          ultimaMudanca + Duration.toMillis(ESPERA),
          ultimaConferencia + Duration.toMillis(INTERVALO_MINIMO),
        );
        const falta = ate - (yield* Clock.currentTimeMillis);
        if (falta <= 0) break;
        yield* Effect.sleep(Duration.millis(falta));
      }
      // A verificação lê o arquivo agora: cobre os salvamentos que chegaram na espera.
      yield* Queue.clear(pedidos);
      const inicio = yield* Clock.currentTimeMillis;
      if (yield* verificar) ultimaConferencia = inicio;
    }
  });

  const ver = fs.watch(path.dirname(arquivo)).pipe(
    Stream.filter((evento) => !ehTemporario(path.basename(evento.path))),
    Stream.runForEach(() =>
      Clock.currentTimeMillis.pipe(
        Effect.flatMap((agora) => {
          ultimaMudanca = agora;
          return Queue.offer(pedidos, undefined);
        }),
      ),
    ),
    Effect.catch((erro) =>
      Effect.logWarning(
        `conferência ao salvar: a pasta do arquivo acompanhado não pode ser vigiada: ${resumoDaFalha(erro)}`,
      ),
    ),
  );

  return yield* Effect.all([trabalhar, ver], { concurrency: 2, discard: true });
});
