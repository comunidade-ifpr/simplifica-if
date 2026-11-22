/**
 * O resultado da revisão: o que corrigir primeiro e quanto do PPC já foi lido. De cima para baixo, o
 * cabeçalho do documento, a frase-resultado com a régua de critérios, a faixa da IA (enquanto ela não
 * leu tudo), o bloqueio do curso (quando o CNCT não reconheceu o curso) e a lista em duas colunas: os temas à
 * esquerda e as pendências à direita, uma aberta por vez. As ressalvas ficam juntas em "Sobre esta
 * revisão", no pé da coluna de temas.
 *
 * A leitura com IA entra na mesma lista, bloco a bloco: a cada bloco pronto (e no fim), a lista é
 * recarregada, e só as pendências que ela não tinha ganham "Novo".
 *
 * "Qual é o curso?" refaz a lista com o curso escolhido sem perder a leitura com IA (`trocarCurso`);
 * com a leitura em andamento, ele e "Enviar a versão corrigida" esperam a pausa (o servidor recusa), e
 * a leitura pausada sai.
 * Uma ação que precisa reler o arquivo depois que o app foi fechado pede para escolhê-lo de novo e se
 * repete com ele.
 *
 * Teclado na lista: ↑ e ↓ andam pelas linhas, Enter abre e fecha, F marca como feito (ou desfaz).
 */
import type { EstadoRevisaoIa, ListaPendencias } from "@simplifica-if/contratos-app";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { AvisoErro } from "../components/AvisoErro.tsx";
import { PainelLeitura } from "../components/PainelLeitura.tsx";
import { Pagina } from "../components/Pagina.tsx";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { Nota } from "../components/ui/nota.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { explicarErro, type MensagemErro } from "../conexao/erros.ts";
import { useApi } from "../contexto.tsx";
import {
  abrir as abrirNoHistorico,
  avancar,
  HISTORICO_VAZIO,
  type Historico,
  linkAtual,
  voltar,
} from "../leitor/historico.ts";
import { dataCurta } from "../lib/formato.ts";
import { ponteDesktop } from "../ponte-desktop.ts";
import { obterArquivo, pedeArquivoDeNovo, textoMesmoArquivo } from "./arquivo.ts";
import { BloqueioCurso } from "./BloqueioCurso.tsx";
import { CabecalhoDocumento } from "./CabecalhoDocumento.tsx";
import { ConclusaoIa, FaixaIa, nomeIa } from "./FaixaIa.tsx";
import { blocosProntos, textoConclusao } from "./ia.ts";
import { LinhaPendencia } from "./LinhaPendencia.tsx";
import {
  chavesNovas,
  contagens,
  descreverCurso,
  doBloqueio,
  fraseResultado,
  linkDoPpc,
  naoLidos,
  nomeDoArquivo,
  ordenar,
  passouPelaIa,
  plural,
  principais,
  temasDaNavegacao,
  textoArquivoNovo,
  textoFeitas,
  versaoDoPpc,
} from "./lista.ts";
import { NavTemas, SeletorTema } from "./NavTemas.tsx";
import { ReguaCriterios } from "./ReguaCriterios.tsx";
import { useLeituraIa } from "./useLeituraIa.ts";

export function Leitura({
  inicial,
  aoSair,
}: {
  readonly inicial: ListaPendencias;
  /** Volta à entrada ("Revisar outro arquivo", depois de apagar). */
  readonly aoSair: () => void;
}) {
  const api = useApi();
  const ponte = ponteDesktop();
  const [lista, setLista] = useState(inicial);
  const [tema, setTema] = useState<number | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [novas, setNovas] = useState<ReadonlySet<string>>(new Set());
  const [conclusao, setConclusao] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<MensagemErro | undefined>(undefined);
  const [marcando, setMarcando] = useState<string | null>(null);
  const [abrindo, setAbrindo] = useState(false);
  const [caminhoCopia, setCaminhoCopia] = useState<string | null>(null);
  const [confirmarApagar, setConfirmarApagar] = useState(false);
  const [pedirCaminho, setPedirCaminho] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [trocandoCurso, setTrocandoCurso] = useState(false);
  /** A ação que falhou porque o app pede o arquivo de novo; escolhido o mesmo, ela se repete. */
  const [refazer, setRefazer] = useState<(() => void) | null>(null);
  const [leitura, setLeitura] = useState<Historico>(HISTORICO_VAZIO);
  const listaRef = useRef<HTMLUListElement>(null);

  const r = lista.resultado;
  const pessoa = r.curso.origem === "pessoa";
  /** A lista de agora, para o diff das pendências novas (os retornos chegam depois do render). */
  const atual = useRef(lista);
  useEffect(() => {
    atual.current = lista;
  });
  /** Quantas pendências a leitura em curso já trouxe (para a frase do fim). */
  const novasDaLeitura = useRef(0);
  /**
   * A lista recarregada do servidor (a mesma, com os blocos da IA já mesclados): as chaves que ela não
   * tinha ganham "Novo". Devolve a lista e quantas chegaram.
   */
  const recarregar = async (): Promise<{ nova: ListaPendencias; chegaram: number } | undefined> => {
    try {
      const nova = await api.chamar((c) => c["revisaoPpc.lista"]({ lista: atual.current.id }));
      const chegaram = chavesNovas(atual.current, nova);
      atual.current = nova;
      setLista(nova);
      if (chegaram.length)
        setNovas((antes) => {
          const todas = new Set(antes);
          for (const chave of chegaram) todas.add(chave);
          return todas;
        });
      return { nova, chegaram: chegaram.length };
    } catch (motivo) {
      setErro(explicarErro(motivo));
      return undefined;
    }
  };
  const ia = useLeituraIa({
    arquivo: lista.arquivoOriginal,
    sha256: lista.sha256,
    cnct: pessoa ? r.curso.cnct?.slug : undefined,
    forma: pessoa ? (r.curso.forma ?? undefined) : undefined,
    ativa: r.leituraIa !== "completa",
    aoConcluir: (estado: EstadoRevisaoIa) =>
      void recarregar().then((recarregada) => {
        if (recarregada === undefined) return;
        const encontrados = novasDaLeitura.current + recarregada.chegaram;
        novasDaLeitura.current = 0;
        setConclusao(textoConclusao(nomeIa(estado.provider), recarregada.nova.resultado, encontrados));
        setAberta(null);
      }),
    aoEncerrar: () => void recarregar(),
  });
  const prontos = ia.estado === undefined ? 0 : blocosProntos(ia.estado);
  const lendoAgora = ia.estado?.situacao === "em_andamento";
  // Cada bloco pronto já está na lista: recarrega e marca como "Novo" só o que chegou (inclusive se o
  // bloco irmão terminou junto com uma pausa).
  const vistos = useRef(prontos);
  const estavaLendo = useRef(lendoAgora);
  useEffect(() => {
    if (prontos > vistos.current && (lendoAgora || estavaLendo.current))
      void recarregar().then((recarregada) => {
        novasDaLeitura.current += recarregada?.chegaram ?? 0;
      });
    vistos.current = prontos;
    estavaLendo.current = lendoAgora;
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- só quando a contagem ou a leitura mudam
  }, [prontos, lendoAgora]);
  const provider = lista.provider ?? ia.provider;

  const usar = async <A,>(acao: () => Promise<A>, repetir?: () => void): Promise<A | undefined> => {
    setErro(undefined);
    setRefazer(null);
    try {
      return await acao();
    } catch (motivo) {
      setErro(explicarErro(motivo));
      if (repetir !== undefined && pedeArquivoDeNovo(motivo)) setRefazer(() => repetir);
      return undefined;
    }
  };

  const escolherDeNovo = async () => {
    if (ponte?.escolherDocx === undefined || refazer === null) return;
    const obtido = await obterArquivo(ponte.escolherDocx);
    if (obtido === undefined) return;
    if ("erro" in obtido) return setErro(obtido.erro);
    if (obtido.arquivo !== lista.arquivoOriginal) return setErro(textoMesmoArquivo(lista.arquivoOriginal));
    setErro(undefined);
    setRefazer(null);
    refazer();
  };

  const marcar = async (chave: string, situacao: "aberta" | "resolvida") => {
    setMarcando(chave);
    const nova = await usar(() => api.chamar((c) => c["revisaoPpc.marcar"]({ lista: lista.id, chave, situacao })));
    setMarcando(null);
    if (nova === undefined) return;
    setLista(nova);
    if (situacao === "resolvida" && aberta === chave) setAberta(null);
  };

  const abrirNoWord = async () => {
    setAbrindo(true);
    const nova = await usar(
      () => api.chamar((c) => c["revisaoPpc.gerarCopia"]({ lista: lista.id })),
      () => void abrirNoWord(),
    );
    if (nova !== undefined) {
      setLista(nova);
      const copia = nova.resultado.arquivoComentado;
      if (ponte?.abrirDocumento === undefined) setCaminhoCopia(copia);
      else
        await ponte.abrirDocumento(copia).catch(() =>
          setErro({
            texto:
              "Não foi possível abrir a cópia comentada. Ela pode estar aberta em outro programa, ou a pasta pode ter mudado; tente de novo.",
          }),
        );
    }
    setAbrindo(false);
  };

  /** "Qual é o curso?": a lista refeita com o curso, com a leitura com IA, se houve. */
  const trocarCurso = async (cnct: string) => {
    setTrocandoCurso(true);
    const forma = r.curso.forma;
    const nova = await usar(
      () =>
        api.chamar((c) => c["revisaoPpc.trocarCurso"]({ lista: lista.id, cnct, ...(forma === null ? {} : { forma }) })),
      () => void trocarCurso(cnct),
    );
    setTrocandoCurso(false);
    if (nova === undefined) return;
    setLista(nova);
    setAberta(null);
    // A leitura pausada saiu no servidor: a faixa volta à estimativa.
    if (ia.estado?.situacao === "pausada") ia.tentarDeNovo();
  };

  const enviarCorrigida = async (arquivo: string) => {
    setPedirCaminho(false);
    setEnviando(true);
    setAviso(null);
    const novo = await usar(() => api.chamar((c) => c["revisaoPpc.revisarArquivoNovo"]({ lista: lista.id, arquivo })));
    setEnviando(false);
    if (novo === undefined) return;
    setLista(novo.lista);
    setAviso(textoArquivoNovo(novo));
    if (ia.estado?.situacao === "pausada") ia.tentarDeNovo();
  };

  const escolherCorrigida = async () => {
    if (ponte?.escolherDocx === undefined) return setPedirCaminho(true);
    const arquivo = await usar(() => ponte.escolherDocx!());
    if (arquivo !== undefined && arquivo !== null) void enviarCorrigida(arquivo);
  };

  const exportar = async () => {
    const csv = await usar(() => api.chamar((c) => c["revisaoPpc.exportarDiscordancias"]({})));
    if (csv === undefined) return;
    const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "discordancias-das-regras (Simplifica IF).csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const apagar = async () => {
    const ok = await usar(() => api.chamar((c) => c["revisaoPpc.apagarLista"]({ lista: lista.id })).then(() => true));
    if (ok === true) aoSair();
  };

  const alternar = (chave: string) => {
    setAberta((atual) => (atual === chave ? null : chave));
    if (novas.has(chave))
      setNovas((atuais) => {
        const resto = new Set(atuais);
        resto.delete(chave);
        return resto;
      });
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
      if (viva !== undefined && marcando === null)
        void marcar(chave, viva.situacao === "resolvida" ? "aberta" : "resolvida");
    }
  };

  const c = contagens(lista);
  const temas = temasDaNavegacao(lista);
  const doTema = principais(lista).filter((v) => tema === null || v.pendencia.ordemTema === tema);
  const linhas = ordenar(doTema);
  const versaoPpc = versaoDoPpc(lista);
  const temaAtual = temas.find((t) => t.ordem === tema);
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
          : `A régua tem os ${r.totalCriterios} critérios da revisão: ${r.conferidos} conferidos pelo app e ${r.conferidosIa} pela IA, com cada trecho e cada norma citados conferidos pelo app.${r.paraConferirIa ? ` ${plural(r.paraConferirIa, "ficou", "ficaram")} para você conferir.` : ""}${r.leituraIa === "parcial" ? ` A leitura com IA ainda não leu ${plural(naoLidos(r), "critério", "critérios")}.` : ""}`}
      </p>
      <p>
        Seu arquivo não é alterado: os comentários vão para uma cópia, “{nomeDoArquivo(r.arquivoComentado)}”, na mesma
        pasta.
      </p>
      <p>
        O app guarda neste computador o texto do PPC e o que você escrever ao discordar, até você apagar esta revisão ou
        depois de 30 dias sem uso.
      </p>
      <p>Base de normas de {dataCurta(r.dataBase)}.</p>
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
                aoAbrirNoWord: () => void abrirNoWord(),
                abrindo,
                aoMostrarNaPasta:
                  ponte?.mostrarNaPasta === undefined
                    ? undefined
                    : () => void usar(() => ponte.mostrarNaPasta!(r.arquivoComentado)),
                // Com a leitura com IA em andamento, a versão corrigida espera a pausa (o servidor recusa).
                aoEnviarCorrigida: lendoAgora ? undefined : () => void escolherCorrigida(),
                aoExportar: discordancias ? () => void exportar() : undefined,
                aoRevisarOutro: aoSair,
                aoApagar: () => setConfirmarApagar(true),
              }}
            />
            {caminhoCopia === null ? null : (
              <p className="break-all text-muted-foreground text-small">Cópia comentada gravada em {caminhoCopia}</p>
            )}
          </header>

          {confirmarApagar ? (
            <div
              role="alertdialog"
              aria-label="Apagar esta revisão?"
              className="flex flex-col gap-3 rounded-xl border border-destructive/40 p-4"
            >
              <p className="font-semibold text-heading">Apagar esta revisão?</p>
              <p className="max-w-[68ch] text-small">
                Some deste computador a lista, com o texto do PPC convertido, o que você marcou e o que escreveu ao
                discordar. Seu arquivo e a cópia comentada ficam.
              </p>
              <div className="flex gap-2">
                <Button variant="destructive" onClick={() => void apagar()}>
                  Apagar a revisão
                </Button>
                <Button variant="ghost" onClick={() => setConfirmarApagar(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          ) : null}

          {pedirCaminho ? (
            <form
              aria-label="Enviar a versão corrigida"
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const caminho = new FormData(e.currentTarget).get("caminho");
                if (typeof caminho === "string" && caminho.trim()) void enviarCorrigida(caminho.trim());
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
            <ReguaCriterios criterios={r.criterios} tema={tema} aoEscolherTema={setTema} />
          </section>

          {enviando ? (
            <p role="status" className="flex items-center gap-2 text-body">
              <Spinner /> Conferindo a versão corrigida…
            </p>
          ) : null}
          {aviso === null ? null : <ConclusaoIa texto={`Versão corrigida: ${aviso}`} aoFechar={() => setAviso(null)} />}
          {conclusao === null ? null : <ConclusaoIa texto={conclusao} aoFechar={() => setConclusao(null)} />}
          {r.leituraIa !== "completa" ? <FaixaIa leitura={ia} faltam={naoLidos(r)} /> : null}
          {bloqueio.length ? (
            <BloqueioCurso
              pendencias={bloqueio}
              conferindo={trocandoCurso}
              emLeitura={lendoAgora}
              aoEscolher={(cnct) => void trocarCurso(cnct)}
            />
          ) : null}
          {erro === undefined ? null : <AvisoErro erro={erro} />}
          {erro === undefined || refazer === null || ponte?.escolherDocx === undefined ? null : (
            <Button variant="outline" className="self-start" onClick={() => void escolherDeNovo()}>
              Escolher o arquivo de novo
            </Button>
          )}

          <div className="grid gap-6 min-[960px]:grid-cols-[15rem_minmax(0,1fr)] min-[960px]:gap-10">
            <aside className="hidden min-[960px]:block">
              <div className="sticky top-6 max-h-[calc(100dvh-8rem)] overflow-y-auto pr-1">
                <NavTemas temas={temas} tema={tema} aoEscolher={setTema} feitas={textoFeitas(c)} sobre={sobre} />
              </div>
            </aside>
            <div className="flex min-w-0 flex-col gap-3">
              <div className="min-[960px]:hidden">
                <SeletorTema temas={temas} tema={tema} aoEscolher={setTema} />
              </div>
              {/* Abaixo de 960 px, o seletor já diz o tema: o título fica só para o leitor de tela. */}
              <h2 className="sr-only text-title min-[960px]:not-sr-only">{temaAtual?.tema ?? "Todos os temas"}</h2>
              {linhas.length ? (
                <ul ref={listaRef} className="border-border border-t" onKeyDown={teclado}>
                  {linhas.map((v) => (
                    <li key={v.chave} data-chave={v.chave}>
                      <LinhaPendencia
                        id={`pendencia-${v.chave.replace(/[^\w-]/g, "_")}`}
                        lista={lista.id}
                        viva={v}
                        provider={provider}
                        aberta={aberta === v.chave}
                        aoAlternar={() => alternar(v.chave)}
                        nova={novas.has(v.chave)}
                        aoAtualizar={setLista}
                        aoMarcar={(situacao) => void marcar(v.chave, situacao)}
                        marcando={marcando === v.chave}
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
