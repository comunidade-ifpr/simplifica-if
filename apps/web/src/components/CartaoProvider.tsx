/**
 * Um provider em Configurações › Sua IA e nas boas-vindas: detecção (instalado, login, versão, plano),
 * "Instalar" com a barra de progresso e "Entrar" com o link da página de login (Codex e Antigravity).
 * Os botões só aparecem quando o app oferece a operação para o provider (`podeInstalar`,
 * `podeEntrar`); o Claude tem o passo guiado (`PassoClaude`), e os demais casos, a orientação para
 * fazer à mão. Em Configurações, "Não usar no app" tira a IA da escolha das conversas sem sair da conta.
 */
import type { EstadoInstalacao, EstadoLogin, EstadoProvider, Provider } from "@simplifica-if/contratos-app";
import { CheckCircle2Icon, CircleAlertIcon, CircleDashedIcon, ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";
import type { Api } from "../conexao/api.ts";
import { explicarErro, type MensagemErro } from "../conexao/erros.ts";
import { useApi } from "../contexto.tsx";
import { abrirExterno } from "../ponte-desktop.ts";
import {
  DESCRICOES,
  explicarMensagemMotor,
  instalacaoTerminou,
  loginTerminou,
  type Orientacao,
  orientacao,
  porcentagemInstalacao,
  tamanhoBaixado,
  textoFaseInstalacao,
  textoFaseLogin,
} from "../providers.ts";
import { AvisoErro, DetalhesTecnicos } from "./AvisoErro.tsx";
import { PassoClaude } from "./PassoClaude.tsx";
import { Alert, AlertDescription } from "./ui/alert.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Spinner } from "./ui/spinner.tsx";
import { MarcaIa } from "./MarcaIa.tsx";

type Deteccao =
  | { readonly fase: "detectando" }
  | { readonly fase: "detectado"; readonly estado: EstadoProvider }
  | { readonly fase: "falhou"; readonly erro: MensagemErro };

/** A detecção do provider, com o erro já em texto. */
function detectar(api: Api, provider: Provider): Promise<Deteccao> {
  return api
    .chamar((cliente) => cliente["providers.detectar"]({ provider }))
    .then(
      (estado): Deteccao => ({ fase: "detectado", estado }),
      (falha: unknown): Deteccao => ({ fase: "falhou", erro: explicarErro(falha) }),
    );
}

function BarraProgresso({ estado }: { readonly estado: EstadoInstalacao }) {
  const porcentagem = porcentagemInstalacao(estado);
  return (
    <div className="flex flex-col gap-1">
      <div
        role="progressbar"
        aria-label={`Instalação de ${DESCRICOES[estado.provider].nome}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={porcentagem}
        aria-valuetext={textoFaseInstalacao(estado.fase)}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={
            porcentagem === undefined
              ? "h-full w-1/3 rounded-full bg-primary motion-safe:animate-pulse"
              : "h-full rounded-full bg-primary transition-[width]"
          }
          style={porcentagem === undefined ? undefined : { width: `${porcentagem}%` }}
        />
      </div>
      <p className="text-muted-foreground text-xs">
        {textoFaseInstalacao(estado.fase)}
        {estado.fase === "baixando" ? ` · ${tamanhoBaixado(estado)}` : ""}
        {estado.versao === undefined ? "" : ` · versão ${estado.versao}`}
        {estado.mensagem === undefined
          ? ""
          : ` · ${explicarMensagemMotor({ mensagem: estado.mensagem, tipoFalha: estado.tipoFalha }).texto}`}
      </p>
      {estado.mensagem === undefined ? null : (
        <DetalhesTecnicos
          detalhe={explicarMensagemMotor({ mensagem: estado.mensagem, tipoFalha: estado.tipoFalha }).detalhe}
        />
      )}
    </div>
  );
}

function PassoLogin({ estado }: { readonly estado: EstadoLogin }) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="flex items-center gap-2">
        {loginTerminou(estado) ? null : <Spinner size="sm" />}
        {textoFaseLogin(estado.fase)}
      </p>
      {estado.fase === "aguardando" && estado.url !== undefined ? (
        <a
          className="inline-flex items-center gap-1 font-semibold text-primary underline underline-offset-2"
          href={estado.url}
          rel="noopener noreferrer"
          target="_blank"
          onClick={(evento) => {
            evento.preventDefault();
            void abrirExterno(estado.url!);
          }}
        >
          Abrir a página de login <ExternalLinkIcon className="size-3.5" />
        </a>
      ) : null}
      {estado.mensagem === undefined ? null : (
        <p className="text-muted-foreground text-xs">
          {explicarMensagemMotor({ mensagem: estado.mensagem, tipoFalha: estado.tipoFalha }).texto}
        </p>
      )}
      <DetalhesTecnicos
        detalhe={
          [
            estado.mensagem === undefined
              ? undefined
              : explicarMensagemMotor({ mensagem: estado.mensagem, tipoFalha: estado.tipoFalha }).detalhe,
            estado.detalhe,
          ]
            .filter((parte) => parte !== undefined)
            .join("\n") || undefined
        }
      />
    </div>
  );
}

function PassoManual({ orientacao }: { readonly orientacao: Orientacao }) {
  return (
    <div className="flex flex-col gap-1.5 text-sm" data-orientacao>
      <p className="text-muted-foreground">{orientacao.texto}</p>
      {orientacao.comando === undefined ? null : (
        <code className="self-start rounded-md bg-muted px-2 py-1 font-mono text-xs">{orientacao.comando}</code>
      )}
    </div>
  );
}

/** "Usar no app": a IA aparece na escolha das conversas. */
export interface UsoNoApp {
  readonly usada: boolean;
  readonly aoMudar: (usar: boolean) => void;
}

export function CartaoProvider({
  provider,
  aoMudarEstado,
  uso,
  avisoPendente = false,
}: {
  readonly provider: Provider;
  /** Cada detecção concluída (as boas-vindas seguem quando a IA fica pronta). */
  readonly aoMudarEstado?: (estado: EstadoProvider) => void;
  /** Em Configurações: o "Não usar no app" / "Voltar a usar". */
  readonly uso?: UsoNoApp;
  /** O aviso de uso ainda não foi aceito: sem "Entrar" até lá (M1.8). */
  readonly avisoPendente?: boolean;
}) {
  const api = useApi();
  const descricao = DESCRICOES[provider];
  const [deteccao, setDeteccao] = useState<Deteccao>({ fase: "detectando" });
  const [conferiu, setConferiu] = useState(false);
  /** A última detecção concluída: o passo do Claude fica na tela enquanto confere de novo. */
  const [ultimo, setUltimo] = useState<EstadoProvider>();
  const [instalacao, setInstalacao] = useState<EstadoInstalacao | undefined>();
  const [login, setLogin] = useState<EstadoLogin | undefined>();
  const [erro, setErro] = useState<MensagemErro | undefined>();

  /** A detecção concluída: a tela, a última conhecida (o passo do Claude) e o aviso ao pai. */
  const aplicar = (resultado: Deteccao) => {
    setDeteccao(resultado);
    if (resultado.fase !== "detectado") return;
    setUltimo(resultado.estado);
    aoMudarEstado?.(resultado.estado);
  };
  const aplicarNoEfeito = useEffectEvent(aplicar);

  useEffect(() => {
    let vivo = true;
    detectar(api, provider).then((resultado) => vivo && aplicarNoEfeito(resultado));
    return () => {
      vivo = false;
    };
  }, [api, provider]);

  const detectarDeNovo = () => {
    setDeteccao({ fase: "detectando" });
    detectar(api, provider).then(aplicar);
  };

  const instalar = () => {
    setErro(undefined);
    setInstalacao({ provider, fase: "parada", baixados: 0 });
    const acompanhamento = api.acompanhar((cliente) => cliente["providers.instalar"]({ provider }), setInstalacao);
    acompanhamento.fim.then(detectarDeNovo, (falha: unknown) => {
      setInstalacao(undefined);
      setErro(explicarErro(falha));
    });
  };

  const entrar = () => {
    setErro(undefined);
    setLogin({ provider, fase: "iniciando" });
    let abriu = false;
    const acompanhamento = api.acompanhar(
      (cliente) => cliente["providers.entrar"]({ provider }),
      (estado) => {
        setLogin(estado);
        // No desktop, a página de login abre sozinha no navegador do sistema, uma vez.
        if (estado.fase === "aguardando" && estado.url !== undefined && !abriu && window.simplifica !== undefined) {
          abriu = true;
          void abrirExterno(estado.url);
        }
      },
    );
    acompanhamento.fim.then(detectarDeNovo, (falha: unknown) => {
      setLogin(undefined);
      setErro(explicarErro(falha));
    });
  };

  const estado = deteccao.fase === "detectado" ? deteccao.estado : undefined;
  const instalando = instalacao !== undefined && !instalacaoTerminou(instalacao);
  const entrando = login !== undefined && !loginTerminou(login);

  return (
    <section
      aria-labelledby={`provider-${provider}`}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-xs/5"
    >
      <header className="flex items-start justify-between gap-2">
        <div>
          <h2 id={`provider-${provider}`} className="flex items-center gap-2 font-semibold text-lg">
            <MarcaIa provider={provider} className="size-5" />
            {descricao.nome}
          </h2>
          <p className="text-muted-foreground text-sm">{descricao.conta}</p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Detectar ${descricao.nome} de novo`}
          disabled={deteccao.fase === "detectando"}
          onClick={detectarDeNovo}
        >
          <RefreshCwIcon />
        </Button>
      </header>

      {deteccao.fase === "detectando" ? (
        <p className="flex items-center gap-2 text-muted-foreground text-sm">
          <Spinner size="sm" /> Detectando…
        </p>
      ) : deteccao.fase === "falhou" ? (
        <AvisoErro erro={deteccao.erro} />
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Instalação</dt>
          <dd className="flex flex-wrap items-center gap-1.5">
            {deteccao.estado.instalado ? (
              <Badge variant="success">
                <CheckCircle2Icon /> Instalado
              </Badge>
            ) : (
              <Badge variant="outline">
                <CircleDashedIcon /> Não instalado
              </Badge>
            )}
            {deteccao.estado.origem === "gerenciada" ? (
              <span className="text-muted-foreground text-xs">cópia do app</span>
            ) : null}
          </dd>
          <dt className="text-muted-foreground">Login</dt>
          <dd>
            {deteccao.estado.autenticado ? (
              <Badge variant="success">
                <CheckCircle2Icon /> Conectado
              </Badge>
            ) : (
              <Badge variant="warning">
                <CircleAlertIcon /> Sem login
              </Badge>
            )}
          </dd>
          {deteccao.estado.versao === undefined ? null : (
            <>
              <dt className="text-muted-foreground">Versão</dt>
              <dd>{deteccao.estado.versao}</dd>
            </>
          )}
          {deteccao.estado.plano === undefined ? null : (
            <>
              <dt className="text-muted-foreground">Plano</dt>
              <dd className="capitalize">{deteccao.estado.plano}</dd>
            </>
          )}
        </dl>
      )}

      {/* A mensagem do motor é técnica; quando falta algo, os botões e o passo guiado explicam. */}
      {estado?.mensagem === undefined || !estado.instalado || !estado.autenticado ? null : (
        <p className="text-muted-foreground text-sm">{explicarMensagemMotor({ mensagem: estado.mensagem }).texto}</p>
      )}
      {estado?.aviso === undefined ? null : (
        <Alert variant="warning">
          <AlertDescription>{estado.aviso}</AlertDescription>
        </Alert>
      )}

      {instalacao === undefined ? null : <BarraProgresso estado={instalacao} />}
      {login === undefined ? null : <PassoLogin estado={login} />}
      {erro === undefined ? null : <AvisoErro erro={erro} />}

      {provider === "claude" && ultimo !== undefined && (!ultimo.instalado || !ultimo.autenticado) ? (
        <PassoClaude
          estado={ultimo}
          conferindo={deteccao.fase === "detectando"}
          conferiu={conferiu}
          aoConferir={() => {
            setConferiu(true);
            detectarDeNovo();
          }}
        />
      ) : null}
      {estado === undefined ? null : (
        <footer className="mt-auto flex flex-col gap-2">
          {(!estado.instalado || instalando) && estado.podeInstalar ? (
            <Button className="self-start" onClick={instalar} disabled={instalando}>
              {instalando ? <Spinner /> : null}
              Instalar
            </Button>
          ) : null}
          {!estado.instalado && !estado.podeInstalar && provider !== "claude" ? (
            <PassoManual orientacao={orientacao(provider, "instalar")} />
          ) : null}
          {estado.instalado && !estado.autenticado && estado.podeEntrar ? (
            avisoPendente ? (
              <p className="text-muted-foreground text-sm">
                Para entrar, leia o aviso de uso acima e clique em "Entendi".
              </p>
            ) : (
              <Button className="self-start" onClick={entrar} disabled={entrando}>
                {entrando ? <Spinner /> : null}
                Entrar
              </Button>
            )
          ) : null}
          {estado.instalado && !estado.autenticado && !estado.podeEntrar && provider !== "claude" ? (
            <PassoManual orientacao={orientacao(provider, "entrar")} />
          ) : null}
        </footer>
      )}
      {uso === undefined || estado === undefined ? null : (
        <div className="flex flex-col gap-1.5 border-border border-t pt-3 text-sm">
          {uso.usada ? null : (
            <p className="text-muted-foreground">Fora da escolha das conversas. Sua conta continua conectada.</p>
          )}
          <Button className="self-start" size="sm" variant="ghost" onClick={() => uso.aoMudar(!uso.usada)}>
            {uso.usada ? "Não usar no app" : "Voltar a usar no app"}
          </Button>
        </div>
      )}
    </section>
  );
}
