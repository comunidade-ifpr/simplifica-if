/**
 * "Configurações › Atualizações" (M1.10): a seção `#atualizacoes` da tela de Configurações do Modo
 * Servidor (M1.9, `routes/configuracoes.tsx`).
 *
 * - **Base e skills** (servidor, `atualizacao.*`): versões em uso, canal (beta ou estável), "Procurar
 *   agora", "Usar agora" (reinicia o servidor local, que troca a base na abertura; recusado enquanto
 *   uma revisão roda) e "Voltar para a versão anterior da base".
 * - **App**: versão instalada (`estado.versaoApp`).
 */
import { CanalAtualizacao, type EstadoAtualizacao, type ResultadoTroca } from "@simplifica-if/contratos-app";
import { DownloadIcon, RefreshCwIcon, RotateCcwIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AvisoErro, DetalhesTecnicos } from "../components/AvisoErro.tsx";
import { Alert, AlertDescription } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { explicarErro, type MensagemErro } from "../conexao/erros.ts";
import { useApi } from "../contexto.tsx";
import { ponteDesktop } from "../ponte-desktop.ts";
import {
  avisoSemConfirmacao,
  descreverBase,
  descreverSituacao,
  textoConfirmarVolta,
  versaoComoData,
} from "./textos.ts";

/** Reinicia o servidor pelo desktop; no navegador (desenvolvimento), pede para reabrir o app. */
async function reiniciar(resultado: ResultadoTroca): Promise<string> {
  if (resultado.resultado !== "reiniciar") return resultado.mensagem;
  const ponte = ponteDesktop();
  if (ponte === undefined) return "Feche e abra o Simplifica IF de novo para trocar a base.";
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
    <section id="atualizacoes" aria-labelledby="titulo-atualizacoes" className="flex flex-col gap-5">
      <h2 id="titulo-atualizacoes" className="text-title">
        Atualizações
      </h2>
      {erro !== null ? <AvisoErro erro={erro} icone /> : null}
      {aviso !== null ? (
        <Alert variant="info">
          <AlertDescription>{aviso}</AlertDescription>
        </Alert>
      ) : null}

      <section aria-labelledby="titulo-base" className="flex flex-col gap-3">
        <h3 id="titulo-base" className="font-semibold">
          Base de conhecimento e tarefas
        </h3>
        {estado === null ? (
          <p role="status" className="flex items-center gap-2 text-muted-foreground text-sm">
            <Spinner /> Lendo o estado das atualizações…
          </p>
        ) : (
          <>
            <p className="text-sm">{descreverBase(estado)}</p>
            <p className="text-sm">
              Tarefas:{" "}
              {estado.skills === "empacotadas" ? "as que vieram com o app" : `de ${versaoComoData(estado.skills)}`}.
            </p>
            <p role="status" className="text-muted-foreground text-sm">
              {descreverSituacao(estado)}
            </p>
            {estado.situacao === "erro" ? <DetalhesTecnicos detalhe={estado.erro ?? undefined} /> : null}
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
              {CanalAtualizacao.literals.map((canal) => (
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
            <p className="text-muted-foreground text-small">
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
              <p className="text-muted-foreground text-small">
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

      {estado === null ? null : (
        <section aria-labelledby="titulo-app" className="flex flex-col gap-2 border-border border-t pt-5">
          <h3 id="titulo-app" className="font-semibold">
            App
          </h3>
          <p className="text-sm">Simplifica IF {estado.versaoApp}</p>
        </section>
      )}
    </section>
  );
}
