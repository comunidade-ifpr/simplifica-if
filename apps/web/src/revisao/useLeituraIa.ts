/**
 * A leitura com IA do resultado aberto (`revisaoPpc.prepararIa`, `iniciarIa`, `pausarIa`,
 * `acompanharIa`), como a faixa da IA a usa:
 *
 * - ao abrir o resultado, retoma a leitura do mesmo arquivo que ficou por terminar (em andamento ou
 *   pausada); senão, estima sozinha com a IA padrão (a primeira pronta que a pessoa não desligou em
 *   Configurações) e o escopo menor, e estima de novo a cada opção trocada;
 * - a estimativa anterior, nunca começada, é apagada no servidor (ela guarda o texto do PPC), e a última
 *   também, quando a tela fecha sem começar;
 * - no fim, entrega o estado concluído a quem abriu (o resultado novo substitui o da tela).
 */
import type { EstadoRevisaoIa, ModoRevisaoIa, Provider } from "@simplifica-if/contratos-app";
import { useEffect, useRef, useState } from "react";
import type { Acompanhamento } from "../conexao/api.ts";
import { explicarErro, type MensagemErro } from "../conexao/erros.ts";
import { useApi } from "../contexto.tsx";
import { PROVIDERS } from "../providers.ts";
import { useIasProntas } from "../tarefas/modelos.ts";
import { usePreferencias } from "../tarefas/perfil.ts";
import { leiturasPorTerminar } from "./ia.ts";

export interface LeituraIa {
  /** A IA da leitura e as que a pessoa pode escolher (as prontas e não desligadas). */
  readonly provider: Provider;
  readonly usaveis: ReadonlyArray<Provider>;
  readonly modo: ModoRevisaoIa;
  readonly escolherProvider: (provider: Provider) => void;
  readonly escolherModo: (modo: ModoRevisaoIa) => void;
  /** A leitura (preparada, em andamento, pausada, concluída ou que falhou); indefinida antes da estimativa. */
  readonly estado: EstadoRevisaoIa | undefined;
  readonly estimando: boolean;
  /** Ainda procurando as IAs prontas ou uma leitura por terminar. */
  readonly carregando: boolean;
  /** Nenhuma IA pronta neste computador. */
  readonly semIa: boolean;
  /** O aviso de uso ainda não foi aceito: nada vai à IA antes. */
  readonly avisoPendente: boolean;
  readonly erro: MensagemErro | undefined;
  readonly ocupada: boolean;
  readonly iniciar: () => void;
  readonly pausar: () => void;
  /** Depois de falhar: volta à estimativa, com o arquivo atual. */
  readonly tentarDeNovo: () => void;
}

const ehAvisoNaoAceito = (erro: unknown) =>
  typeof erro === "object" && erro !== null && (erro as { readonly _tag?: unknown })._tag === "AvisoNaoAceito";

export function useLeituraIa({
  arquivo,
  cnct,
  forma,
  ativa,
  aoConcluir,
}: {
  readonly arquivo: string;
  /** O curso escolhido pela pessoa ("Qual é o curso?"), que a leitura usa no lugar do documento. */
  readonly cnct: string | undefined;
  readonly forma: string | undefined;
  /** A faixa aparece: o resultado ainda não passou pela IA. */
  readonly ativa: boolean;
  readonly aoConcluir: (estado: EstadoRevisaoIa) => void;
}): LeituraIa {
  const api = useApi();
  const prontas = useIasProntas();
  const desligadas = usePreferencias().preferencias?.iasDesligadas;
  const usaveis = (prontas ?? []).filter((p) => !(desligadas ?? []).includes(p));
  const [escolhido, setEscolhido] = useState<Provider | undefined>(undefined);
  const provider = escolhido ?? usaveis[0] ?? PROVIDERS[0]!;
  const [modo, setModo] = useState<ModoRevisaoIa>("rapido");
  const [estado, setEstado] = useState<EstadoRevisaoIa | undefined>(undefined);
  const [procurou, setProcurou] = useState(false);
  const [estimando, setEstimando] = useState(false);
  const [ocupada, setOcupada] = useState(false);
  const [erro, setErro] = useState<MensagemErro | undefined>(undefined);
  const [avisoPendente, setAvisoPendente] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const acompanhamento = useRef<Acompanhamento | undefined>(undefined);
  /** A estimativa ainda não começada, que sai do servidor quando outra a substitui ou a tela fecha. */
  const preparada = useRef<string | undefined>(undefined);
  const situacao = useRef<EstadoRevisaoIa["situacao"] | undefined>(undefined);
  const concluir = useRef(aoConcluir);
  useEffect(() => {
    concluir.current = aoConcluir;
  });

  const trocar = (novo: EstadoRevisaoIa | undefined) => {
    situacao.current = novo?.situacao;
    setEstado(novo);
  };
  const descartarPreparada = () => {
    const id = preparada.current;
    preparada.current = undefined;
    if (id !== undefined) void api.chamar((c) => c["revisaoPpc.apagarIa"]({ revisao: id })).catch(() => undefined);
  };

  const acompanhar = (id: string) => {
    acompanhamento.current?.cancelar();
    acompanhamento.current = api.acompanhar(
      (c) => c["revisaoPpc.acompanharIa"]({ revisao: id }),
      (novo) => {
        trocar(novo);
        if (novo.situacao === "concluida" && novo.resultado !== null) concluir.current(novo);
      },
    );
    acompanhamento.current.fim.catch((motivo: unknown) => setErro(explicarErro(motivo)));
  };

  useEffect(
    () => () => {
      acompanhamento.current?.cancelar();
      descartarPreparada();
    },
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- só ao desmontar
    [],
  );

  // Uma leitura deste arquivo que ficou por terminar volta à faixa, com a IA e o escopo dela.
  useEffect(() => {
    if (!ativa) return;
    let vivo = true;
    api
      .chamar((c) => c["revisaoPpc.listarIa"]({}))
      .then((lista) => {
        if (!vivo) return;
        const achada = leiturasPorTerminar(lista).find((e) => e.arquivoOriginal === arquivo);
        if (achada !== undefined) {
          setEscolhido(achada.provider);
          setModo(achada.modo);
          trocar(achada);
          acompanhar(achada.id);
        }
      })
      .catch(() => undefined)
      .finally(() => vivo && setProcurou(true));
    return () => {
      vivo = false;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- uma vez por arquivo
  }, [api, arquivo, ativa]);

  // A estimativa, sozinha, ao abrir e a cada opção trocada (só antes de começar).
  const semIa = prontas !== undefined && usaveis.length === 0;
  const podeEstimar = ativa && procurou && prontas !== undefined && !semIa;
  // A `tentativa` muda a cada "Tentar de novo" (e só dispara outra estimativa).
  useEffect(() => {
    if (!podeEstimar || tentativa < 0) return;
    const atual = situacao.current;
    if (atual !== undefined && atual !== "preparada") return;
    let vivo = true;
    setEstimando(true);
    setErro(undefined);
    api
      .chamar((c) =>
        c["revisaoPpc.prepararIa"]({
          arquivo,
          provider,
          modo,
          ...(cnct === undefined ? {} : { cnct }),
          ...(forma === undefined ? {} : { forma }),
        }),
      )
      .then(
        (novo) => {
          // A estimativa de opções que já mudaram não vale mais: sai do servidor.
          if (!vivo)
            return void api.chamar((c) => c["revisaoPpc.apagarIa"]({ revisao: novo.id })).catch(() => undefined);
          const anterior = preparada.current;
          preparada.current = novo.id;
          if (anterior !== undefined)
            void api.chamar((c) => c["revisaoPpc.apagarIa"]({ revisao: anterior })).catch(() => undefined);
          setAvisoPendente(false);
          situacao.current = novo.situacao;
          setEstado(novo);
        },
        (motivo: unknown) => {
          if (!vivo) return;
          if (ehAvisoNaoAceito(motivo)) setAvisoPendente(true);
          else setErro(explicarErro(motivo));
        },
      )
      .finally(() => vivo && setEstimando(false));
    return () => {
      vivo = false;
    };
  }, [api, podeEstimar, arquivo, provider, modo, cnct, forma, tentativa]);

  const chamar = async (acao: () => Promise<EstadoRevisaoIa>, depois?: (e: EstadoRevisaoIa) => void) => {
    setOcupada(true);
    setErro(undefined);
    try {
      const novo = await acao();
      trocar(novo);
      depois?.(novo);
    } catch (motivo) {
      if (ehAvisoNaoAceito(motivo)) setAvisoPendente(true);
      else setErro(explicarErro(motivo));
    } finally {
      setOcupada(false);
    }
  };

  return {
    provider,
    usaveis,
    modo,
    escolherProvider: setEscolhido,
    escolherModo: setModo,
    estado,
    estimando,
    carregando: !procurou || prontas === undefined,
    semIa,
    avisoPendente,
    erro,
    ocupada,
    iniciar: () => {
      if (estado === undefined) return;
      const id = estado.id;
      // Começada, a estimativa deixa de ser descartável.
      if (preparada.current === id) preparada.current = undefined;
      void chamar(
        () => api.chamar((c) => c["revisaoPpc.iniciarIa"]({ revisao: id })),
        () => acompanhar(id),
      );
    },
    pausar: () => {
      if (estado !== undefined) void chamar(() => api.chamar((c) => c["revisaoPpc.pausarIa"]({ revisao: estado.id })));
    },
    tentarDeNovo: () => {
      acompanhamento.current?.cancelar();
      trocar(undefined);
      setTentativa((n) => n + 1);
    },
  };
}
