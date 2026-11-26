/**
 * O resultado da revisão: o que corrigir primeiro e quanto do PPC já foi lido. De cima para baixo, o
 * cabeçalho do documento, a frase-resultado com a régua de critérios, a faixa da IA (enquanto ela não
 * leu tudo), o bloqueio do curso (quando o CNCT não reconheceu o curso) e a lista em duas colunas: os temas à
 * esquerda e as pendências à direita, uma aberta por vez. As ressalvas ficam juntas em "Sobre esta
 * revisão", no pé da coluna de temas.
 *
 * O estado da revisão e da leitura com IA fica em `ControleRevisao` (`useRevisao`); aqui ficam só
 * controles locais efêmeros (diálogo de apagar, campo de caminho no modo navegador e painel de leitura).
 *
 * Teclado na lista: ↑ e ↓ andam pelas linhas, Enter abre e fecha, F marca como feito (ou desfaz).
 */
import { DIAS_LISTA } from "@simplifica-if/contratos-app/modulos/revisao-ppc";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { DialogoApagar } from "../../apagar/DialogoApagar.tsx";
import { AvisoErro } from "../../components/AvisoErro.tsx";
import { Pagina } from "../../components/Pagina.tsx";
import { PainelLeitura } from "../../components/PainelLeitura.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Nota } from "../../components/ui/nota.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";
import { useRevisao } from "./contexto.ts";
import {
  abrir as abrirNoHistorico,
  avancar,
  HISTORICO_VAZIO,
  type Historico,
  linkAtual,
  voltar,
} from "../../leitor/historico.ts";
import { dataCurta } from "../../lib/formato.ts";
import { ponteDesktop } from "../../ponte-desktop.ts";
import { obterArquivo } from "./arquivo.ts";
import { BloqueioCurso } from "./BloqueioCurso.tsx";
import { CabecalhoDocumento } from "./CabecalhoDocumento.tsx";
import { lendoComIa } from "./ControleRevisao.ts";
import { ConclusaoIa, FaixaIa } from "./FaixaIa.tsx";
import { LinhaPendencia } from "./LinhaPendencia.tsx";
import {
  contagens,
  descreverCurso,
  doBloqueio,
  fraseResultado,
  linkDoPpc,
  naoLidos,
  ordenar,
  passouPelaIa,
  principais,
  temasDaNavegacao,
  textoFeitas,
  versaoDoPpc,
} from "./lista.ts";
import { nomeDoArquivo, plural } from "../../lib/texto.ts";
import { textosApagarRevisao } from "./apagar.ts";
import { NavTemas, SeletorTema } from "./NavTemas.tsx";
import { ReguaCriterios } from "./ReguaCriterios.tsx";

export function Leitura({
  aoSair,
}: {
  /** Volta à entrada ("Revisar outro arquivo", depois de apagar). */
  readonly aoSair: () => void;
}) {
  const [estado, revisao] = useRevisao();
  const ponte = ponteDesktop();
  const [confirmarApagar, setConfirmarApagar] = useState(false);
  const [pedirCaminho, setPedirCaminho] = useState(false);
  const [leitura, setLeitura] = useState<Historico>(HISTORICO_VAZIO);
  const listaRef = useRef<HTMLUListElement>(null);
  const apagou = useRef(false);

  // Ao voltar de Configurações, reconfere as IAs disponíveis sem perturbar uma leitura ativa.
  useEffect(() => {
    void revisao.atualizarIas();
  }, [revisao]);

  const lista = estado.lista;
  if (lista === undefined) return null;

  const r = lista.resultado;
  const lendoAgora = lendoComIa(estado);

  const escolherCorrigida = async () => {
    if (ponte === undefined) {
      setPedirCaminho(true);
      return;
    }
    const obtido = await obterArquivo(ponte.escolherDocx);
    if (obtido !== undefined && "arquivo" in obtido) void revisao.enviarCorrigida(obtido.arquivo);
  };

  const exportar = async () => {
    const csv = await revisao.exportarDiscordancias();
    if (csv === undefined) return;
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "discordancias-das-regras (Simplifica IF).csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const apagar = async (): Promise<null> => {
    await revisao.apagarLista();
    apagou.current = true;
    return null;
  };

  // ↑ e ↓ entre os cabeçalhos das linhas; F marca a linha em foco. Nada nos campos de texto.
  const teclado = (evento: KeyboardEvent<HTMLUListElement>) => {
    const alvo = evento.target as HTMLElement;
    const item = alvo.closest<HTMLElement>("li[data-chave]");
    if (item === null || alvo !== item.querySelector("button")) return;
    const botoes = [...(listaRef.current?.querySelectorAll<HTMLElement>("li[data-chave] > div > button") ?? [])];
    const i = botoes.indexOf(alvo);
    if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
      evento.preventDefault();
      botoes[evento.key === "ArrowDown" ? Math.min(botoes.length - 1, i + 1) : Math.max(0, i - 1)]?.focus();
    } else if ((evento.key === "f" || evento.key === "F") && !evento.metaKey && !evento.ctrlKey && !evento.altKey) {
      evento.preventDefault();
      const chave = item.dataset.chave!;
      const viva = lista.pendencias.find((v) => v.chave === chave);
      if (viva !== undefined && estado.marcando === null) {
        void revisao.marcar(chave, viva.situacao === "resolvida" ? "aberta" : "resolvida");
      }
    }
  };

  const c = contagens(lista);
  const temas = temasDaNavegacao(lista);
  const doTema = principais(lista).filter((v) => estado.tema === null || v.pendencia.ordemTema === estado.tema);
  const linhas = ordenar(doTema);
  const versaoPpc = versaoDoPpc(lista);
  const temaAtual = temas.find((t) => t.ordem === estado.tema);
  const bloqueio = doBloqueio(lista);
  const discordancias = lista.pendencias.some(
    (v) => v.pendencia.origem === "codigo" && v.historico.some((e) => e.acao === "contestar"),
  );
  const sobre = (
    <Nota titulo="Sobre esta revisão">
      <p>
        É uma revisão prévia, para preparar o PPC antes de enviar: não é parecer da PROENS, e não ter pendência não quer
        dizer PPC aprovado.
      </p>
      <p>
        {!passouPelaIa(r)
          ? `A régua tem os ${r.totalCriterios} critérios da revisão. O app confere ${r.conferidos} sozinho; os demais pedem leitura, sua ou da IA.`
          : `A régua tem os ${r.totalCriterios} critérios da revisão: ${r.conferidos} conferidos pelo app e ${r.conferidosIa} pela IA, com cada trecho e cada norma citados conferidos pelo app.${r.paraConferirIa ? ` ${plural(r.paraConferirIa, "ficou", "ficaram")} para você conferir.` : ""}${r.leituraIa === "parcial" ? ` A conferência com IA ainda não passou por ${plural(naoLidos(r), "critério", "critérios")}.` : ""}`}
      </p>
      <p>
        Seu arquivo não é alterado: os comentários vão para uma cópia, “{nomeDoArquivo(r.arquivoComentado)}”, na mesma
        pasta.
      </p>
      <p>
        O app guarda neste computador o texto do PPC e o que você escrever ao discordar, até você apagar esta revisão ou
        depois de {DIAS_LISTA} dias sem uso.
      </p>
      <p>Vigência das normas em {dataCurta(r.dataBase)}.</p>
    </Nota>
  );

  return (
    <div className="flex h-full">
      <div className="h-full min-w-0 flex-1">
        <Pagina largura="larga" className="gap-6">
          <header className="flex flex-col gap-1">
            <h1 className="font-semibold text-muted-foreground text-small">Revisar um PPC</h1>
            <CabecalhoDocumento
              nome={nomeDoArquivo(lista.arquivoOriginal)}
              curso={descreverCurso(r.curso)}
              acoes={{
                aoAbrirAoLado: () => setLeitura((h) => abrirNoHistorico(h, linkDoPpc(lista.id, versaoPpc))),
                aoAbrirNoWord: () => void revisao.abrirNoWord(),
                abrindo: estado.abrindoWord,
                aoMostrarNaPasta:
                  ponte === undefined ? undefined : () => void revisao.mostrarNaPasta(ponte.mostrarNaPasta),
                // Com a leitura com IA em andamento, a versão corrigida espera a pausa (o servidor recusa).
                aoEnviarCorrigida: lendoAgora ? undefined : () => void escolherCorrigida(),
                aoExportar: discordancias ? () => void exportar() : undefined,
                aoRevisarOutro: aoSair,
                aoApagar: () => setConfirmarApagar(true),
              }}
            />
            {estado.caminhoCopia === null ? null : (
              <p className="break-all text-muted-foreground text-small">
                Cópia comentada gravada em {estado.caminhoCopia}
              </p>
            )}
          </header>

          <DialogoApagar
            aberto={confirmarApagar}
            textos={textosApagarRevisao(lista, lendoAgora)}
            aoConfirmar={apagar}
            aoFechar={() => {
              setConfirmarApagar(false);
              if (apagou.current) {
                apagou.current = false;
                aoSair();
              }
            }}
          />

          {pedirCaminho ? (
            <form
              aria-label="Enviar a versão corrigida"
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const caminho = new FormData(e.currentTarget).get("caminho");
                if (typeof caminho === "string" && caminho.trim()) {
                  setPedirCaminho(false);
                  void revisao.enviarCorrigida(caminho.trim());
                }
              }}
            >
              <Input
                nativeInput
                name="caminho"
                aria-label="Caminho da versão corrigida (.docx)"
                placeholder="/Users/voce/Documents/PPC corrigido.docx"
                className="max-w-md"
              />
              <Button type="submit" variant="outline">
                Conferir
              </Button>
              <Button type="button" variant="ghost" onClick={() => setPedirCaminho(false)}>
                Cancelar
              </Button>
            </form>
          ) : null}

          <section aria-labelledby="frase-resultado" className="flex flex-col gap-3">
            <h2 id="frase-resultado" className="text-display">
              {fraseResultado(lista)}
            </h2>
            <ReguaCriterios
              criterios={r.criterios}
              tema={estado.tema}
              aoEscolherTema={(tema) => revisao.escolherTema(tema)}
            />
          </section>

          {estado.enviandoCorrigida ? (
            <p role="status" className="flex items-center gap-2 text-body">
              <Spinner /> Conferindo a versão corrigida…
            </p>
          ) : null}
          {estado.aviso === null ? null : (
            <ConclusaoIa texto={`Versão corrigida: ${estado.aviso}`} aoFechar={() => revisao.fecharAviso()} />
          )}
          {estado.conclusao === null ? null : (
            <ConclusaoIa texto={estado.conclusao} aoFechar={() => revisao.fecharConclusao()} />
          )}
          {r.leituraIa !== "completa" ? <FaixaIa faltam={naoLidos(r)} /> : null}
          {bloqueio.length ? (
            <BloqueioCurso
              pendencias={bloqueio}
              conferindo={estado.trocandoCurso}
              emLeitura={lendoAgora}
              aoEscolher={(cnct) => void revisao.trocarCurso(cnct)}
            />
          ) : null}
          {estado.erro === undefined ? null : <AvisoErro erro={estado.erro} />}
          {estado.erro === undefined || estado.origemArquivoDeNovo !== "lista" || ponte === undefined ? null : (
            <Button variant="outline" className="self-start" onClick={() => void revisao.escolherArquivoDeNovo()}>
              Escolher o arquivo de novo
            </Button>
          )}

          <div className="grid gap-6 min-[960px]:grid-cols-[15rem_minmax(0,1fr)] min-[960px]:gap-10">
            <aside className="hidden min-[960px]:block">
              <div className="sticky top-6 max-h-[calc(100dvh-8rem)] overflow-y-auto pr-1">
                <NavTemas
                  temas={temas}
                  tema={estado.tema}
                  aoEscolher={(tema) => revisao.escolherTema(tema)}
                  feitas={textoFeitas(c)}
                  sobre={sobre}
                />
              </div>
            </aside>
            <div className="flex min-w-0 flex-col gap-3">
              <div className="min-[960px]:hidden">
                <SeletorTema temas={temas} tema={estado.tema} aoEscolher={(tema) => revisao.escolherTema(tema)} />
              </div>
              {/* Abaixo de 960 px, o seletor já diz o tema: o título fica só para o leitor de tela. */}
              <h2 className="sr-only text-title min-[960px]:not-sr-only">{temaAtual?.tema ?? "Todos os temas"}</h2>
              {linhas.length ? (
                <ul ref={listaRef} className="border-border border-t" onKeyDown={teclado}>
                  {linhas.map((v) => (
                    <li key={v.chave} data-chave={v.chave}>
                      <LinhaPendencia
                        id={`pendencia-${v.chave.replace(/[^\w-]/g, "_")}`}
                        viva={v}
                        aoAbrirLink={(link) => setLeitura((h) => abrirNoHistorico(h, link))}
                        linkNoPpc={`${linkDoPpc(lista.id, versaoPpc)}#p-${v.chave}`}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="max-w-[68ch] text-muted-foreground text-body">
                  {temaAtual?.naoLido
                    ? "Ninguém leu este tema ainda: os critérios dele pedem leitura, sua ou da IA."
                    : "Nada para corrigir nem para conferir aqui, nos critérios lidos."}
                </p>
              )}
              <div className="flex flex-col gap-3 pt-4 min-[960px]:hidden">
                <p className="font-semibold text-small tabular-nums">{textoFeitas(c)}</p>
                {sobre}
              </div>
            </div>
          </div>
        </Pagina>
      </div>
      {linkAtual(leitura) === undefined ? null : (
        <div className="h-full w-[min(40rem,45vw)] shrink-0">
          <PainelLeitura
            historico={leitura}
            aoAbrirLink={(link) => setLeitura((h) => abrirNoHistorico(h, link))}
            aoVoltar={() => setLeitura(voltar)}
            aoAvancar={() => setLeitura(avancar)}
            aoFechar={() => setLeitura(HISTORICO_VAZIO)}
          />
        </div>
      )}
    </div>
  );
}
