/**
 * "Configurações › Atualizações" (M1.10), como componente isolado: a tela de Configurações do Modo
 * Servidor (M1.9) o monta na seção dela; até lá, a rota provisória `/atualizacoes` o mostra.
 *
 * - **Base e skills** (servidor, `atualizacao.*`): versões em uso, canal (beta ou estável), "Procurar
 *   agora", "Usar agora" (reinicia o servidor local, que troca a base na abertura; recusado enquanto
 *   uma análise roda) e "Voltar para a versão anterior da base".
 * - **App** (desktop, `electron-updater`): versão, situação e "Reiniciar para atualizar". Fora do
 *   desktop, ou com o app sem assinatura de código, a seção diz por que está desligada.
 */
import type { CanalAtualizacao, EstadoAtualizacao, ResultadoTroca } from "@simplifica-if/contratos-app";
import { DownloadIcon, RefreshCwIcon, RotateCcwIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AvisoErro } from "../components/AvisoErro.tsx";
import { Alert, AlertDescription } from "../components/ui/alert.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { explicarErro, type MensagemErro } from "../conexao/erros.ts";
import { useApi } from "../contexto.tsx";
import { type EstadoAtualizacaoApp, ponteDesktop } from "../ponte-desktop.ts";
import {
  avisoSemConfirmacao,
  descreverBase,
  descreverSituacao,
  textoConfirmarVolta,
  versaoComoData,
} from "./textos.ts";

/** Reinicia o servidor pelo desktop; no navegador (desenvolvimento), pede para reiniciar à mão. */
async function reiniciar(resultado: ResultadoTroca): Promise<string> {
  if (resultado.resultado !== "reiniciar") return resultado.mensagem;
  const ponte = ponteDesktop();
  if (ponte?.reiniciarServidor === undefined) return "Reinicie o servidor local para trocar a base.";
  await ponte.reiniciarServidor();
  return resultado.mensagem;
}

export function Atualizacoes() {
  const api = useApi();
  const [estado, setEstado] = useState<EstadoAtualizacao | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<MensagemErro | null>(null);
  const [confirmandoVolta, setConfirmandoVolta] = useState(false);
  // A hora da abertura da seção, para o aviso de 14 dias (o render não lê o relógio).
  const [agora] = useState(() => Date.now());

  useEffect(() => {
    let ativo = true;
    api
      .chamar((cliente) => cliente["atualizacao.estado"]({}))
      .then((lido) => ativo && setEstado(lido))
      .catch((falha) => ativo && setErro(explicarErro(falha)));
    return () => {
      ativo = false;
    };
  }, [api]);

  const agir = useCallback(async (rotulo: string, acao: () => Promise<void>) => {
    setOcupado(rotulo);
    setErro(null);
    setAviso(null);
    try {
      await acao();
    } catch (falha) {
      setErro(explicarErro(falha));
    } finally {
      setOcupado(null);
    }
  }, []);

  const procurar = () =>
    agir("procurar", async () => setEstado(await api.chamar((cliente) => cliente["atualizacao.procurar"]({}))));
  const trocarCanal = (canal: CanalAtualizacao) =>
    agir("canal", async () => setEstado(await api.chamar((cliente) => cliente["atualizacao.trocarCanal"]({ canal }))));
  const aplicar = () =>
    agir("aplicar", async () =>
      setAviso(await reiniciar(await api.chamar((cliente) => cliente["atualizacao.aplicar"]({})))),
    );
  const voltar = () =>
    agir("voltar", async () => {
      setConfirmandoVolta(false);
      setAviso(await reiniciar(await api.chamar((cliente) => cliente["atualizacao.voltar"]({}))));
    });

  return (
    <section aria-labelledby="titulo-atualizacoes" className="flex flex-col gap-5">
      <h2 id="titulo-atualizacoes" className="font-semibold text-xl">
        Atualizações
      </h2>
      {erro !== null ? <AvisoErro erro={erro} icone /> : null}
      {aviso !== null ? (
        <Alert variant="info">
          <AlertDescription>{aviso}</AlertDescription>
        </Alert>
      ) : null}

      <section aria-labelledby="titulo-base" className="flex flex-col gap-3 rounded-lg border p-4">
        <h3 id="titulo-base" className="font-semibold">
          Base de conhecimento e skills
        </h3>
        {estado === null ? (
          <p role="status" className="flex items-center gap-2 text-muted-foreground text-sm">
            <Spinner /> Lendo o estado das atualizações…
          </p>
        ) : (
          <>
            <p className="text-sm">{descreverBase(estado)}</p>
            <p className="text-sm">
              Skills:{" "}
              {estado.skills === "empacotadas" ? "as que vieram com o app" : `de ${versaoComoData(estado.skills)}`}.
            </p>
            <p role="status" className="text-muted-foreground text-sm">
              {descreverSituacao(estado)}
            </p>
            {estado.aviso !== null ? (
              <Alert variant="warning">
                <AlertDescription>{estado.aviso}</AlertDescription>
              </Alert>
            ) : null}
            {avisoSemConfirmacao(estado, agora) !== null ? (
              <Alert variant="warning">
                <AlertDescription>{avisoSemConfirmacao(estado, agora)}</AlertDescription>
              </Alert>
            ) : null}
            <fieldset className="flex flex-wrap items-center gap-2" disabled={ocupado !== null}>
              <legend className="mb-1 text-sm">Canal</legend>
              {(["beta", "estavel"] as const).map((canal) => (
                <Button
                  key={canal}
                  size="sm"
                  variant={estado.canal === canal ? "default" : "outline"}
                  aria-pressed={estado.canal === canal}
                  onClick={() => trocarCanal(canal)}
                >
                  {canal === "beta" ? "Beta (piloto)" : "Estável"}
                </Button>
              ))}
            </fieldset>
            <p className="text-muted-foreground text-xs">
              O beta recebe a base nova primeiro; o estável, depois de alguns dias sem erro confirmado. Trocar para o
              estável não volta a base: ela fica até sair uma versão estável mais nova.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={ocupado !== null || estado.desligada !== null}
                onClick={procurar}
              >
                {ocupado === "procurar" ? <Spinner /> : <RefreshCwIcon />} Procurar agora
              </Button>
              {estado.pendente !== null || estado.skillsPendentes !== null ? (
                <Button size="sm" disabled={ocupado !== null} onClick={aplicar}>
                  <DownloadIcon /> Usar a versão nova agora
                </Button>
              ) : null}
              {estado.anterior !== null && !confirmandoVolta ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={ocupado !== null}
                  onClick={() => setConfirmandoVolta(true)}
                >
                  <RotateCcwIcon /> Voltar para a versão anterior da base ({versaoComoData(estado.anterior)})
                </Button>
              ) : null}
            </div>
            {estado.anterior === null && estado.base.origem === "baixada" ? (
              <p className="text-muted-foreground text-xs">
                Não há versão anterior para onde voltar: ou a anterior é a de que você acabou de voltar, ou a troca já
                foi pedida. Uma versão mais nova da base aparece aqui quando sair.
              </p>
            ) : null}
            {confirmandoVolta && estado.anterior !== null ? (
              <Alert variant="warning" role="alertdialog" aria-label="Confirmar a volta da base">
                <AlertDescription>
                  <p>{textoConfirmarVolta(estado)}</p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" disabled={ocupado !== null} onClick={voltar}>
                      Voltar para {versaoComoData(estado.anterior)}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setConfirmandoVolta(false)}>
                      Cancelar
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            ) : null}
          </>
        )}
      </section>

      <AtualizacaoDoApp />
    </section>
  );
}

function AtualizacaoDoApp() {
  const ponte = ponteDesktop();
  const [estado, setEstado] = useState<EstadoAtualizacaoApp | null>(null);
  useEffect(() => {
    if (ponte?.atualizacaoApp === undefined) return;
    let ativo = true;
    const ler = () =>
      ponte
        .atualizacaoApp?.()
        .then((lido) => ativo && setEstado(lido))
        .catch(() => undefined);
    void ler();
    // O download do app corre no processo principal; a seção acompanha enquanto está aberta.
    const intervalo = window.setInterval(ler, 5000);
    return () => {
      ativo = false;
      window.clearInterval(intervalo);
    };
  }, [ponte]);

  return (
    <section aria-labelledby="titulo-app" className="flex flex-col gap-3 rounded-lg border p-4">
      <h3 id="titulo-app" className="font-semibold">
        App
      </h3>
      {ponte?.atualizacaoApp === undefined ? (
        <p className="text-muted-foreground text-sm">A atualização do app só aparece no app instalado.</p>
      ) : estado === null ? (
        <p role="status" className="flex items-center gap-2 text-muted-foreground text-sm">
          <Spinner /> Lendo…
        </p>
      ) : (
        <>
          <p className="text-sm">
            Simplifica IF {estado.versao}
            {estado.nova !== null ? (
              <>
                {" "}
                <Badge variant="info">
                  versão {estado.nova} {estado.situacao === "pronta" ? "pronta" : "baixando"}
                </Badge>
              </>
            ) : null}
          </p>
          <p role="status" className="text-muted-foreground text-sm">
            {estado.desligada ??
              {
                parada: "Ainda não procurou.",
                procurando: "Procurando…",
                baixando: `Baixando a versão nova${estado.progresso === null ? "" : ` (${estado.progresso}%)`}…`,
                pronta: "A versão nova está pronta. Ela também se instala quando você fechar o app.",
                "em-dia": "O app está em dia.",
                erro: estado.erro ?? "A procura falhou.",
              }[estado.situacao]}
          </p>
          <div className="flex flex-wrap gap-2">
            {estado.desligada === null ? (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => setEstado((await ponte.procurarAtualizacaoApp?.()) ?? estado)}
              >
                <RefreshCwIcon /> Procurar agora
              </Button>
            ) : null}
            {estado.situacao === "pronta" ? (
              <Button size="sm" onClick={() => void ponte.instalarAtualizacaoApp?.()}>
                <DownloadIcon /> Reiniciar para atualizar
              </Button>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
