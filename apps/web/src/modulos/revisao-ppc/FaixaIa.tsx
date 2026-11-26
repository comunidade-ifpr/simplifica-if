/**
 * A faixa da IA, enquanto a leitura não leu tudo: quantos critérios faltam ler, a estimativa já
 * calculada e "Conferir com o Claude"; as opções (a IA, o escopo e o detalhe do uso) ficam num popover.
 * Durante a leitura, a faixa vira o andamento, com "Pausar"; pausada, diz por quê e oferece "Retomar"
 * e, com algum tema já lido, "Encerrar conferência por aqui"; se falhar, diz o que fazer. "Ver andamento"
 * abre, sob demanda, o painel bloco a bloco (a tela continua quieta). O fim fica na tela
 * (`ConclusaoIa`), não aqui.
 */
import type { Provider } from "@simplifica-if/contratos-app";
import type { EstadoRevisaoIa, ModoRevisaoIa } from "@simplifica-if/contratos-app/modulos/revisao-ppc";
import { Link } from "@tanstack/react-router";
import { ChevronDownIcon, PauseIcon, PlayIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { AvisoErro } from "../../components/AvisoErro.tsx";
import { MarcaIa } from "../../components/MarcaIa.tsx";
import { Button, buttonVariants } from "../../components/ui/button.tsx";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "../../components/ui/popover.tsx";
import { RadioCartao } from "../../components/ui/radio-cartao.tsx";
import { Segmented } from "../../components/ui/segmented.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";
import { useRevisao } from "./contexto.ts";
import { ponteDesktop } from "../../ponte-desktop.ts";
import { DESCRICOES } from "../../providers.ts";
import { cn } from "~/lib/utils";
import { providerEfetivoIa, semIaDisponivel } from "./ControleRevisao.ts";
import {
  blocosProntos,
  contagemTemas,
  type LinhaAndamento,
  linhasAndamento,
  rodapeAndamento,
  textoAndamento,
  textoEstimativa,
} from "./ia.ts";
import { plural } from "../../lib/texto.ts";

export const nomeIa = (provider: Provider) => DESCRICOES[provider].nome;

function Caixa({
  children,
  rotulo,
  abaixo,
}: {
  readonly children: React.ReactNode;
  readonly rotulo: string;
  /** O que abre embaixo da faixa (o painel "Ver andamento"). */
  readonly abaixo?: React.ReactNode;
}) {
  return (
    <section aria-label={rotulo} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">{children}</div>
      {abaixo}
    </section>
  );
}

/** O relógio da tela, a cada segundo, só enquanto `ativo` (o painel aberto com algo lendo). */
function useAgora(ativo: boolean): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (!ativo) return;
    const relogio = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(relogio);
  }, [ativo]);
  return agora;
}

const MARCA: Readonly<Record<LinhaAndamento["situacao"], string>> = {
  pronto: "bg-grav-ok",
  lendo: "bg-primary animate-pulse motion-reduce:animate-none",
  pausado: "bg-grav-conferir",
  fila: "border border-grav-nao-lido",
};

const ROTULO_SITUACAO: Readonly<Record<LinhaAndamento["situacao"], string>> = {
  pronto: "Pronto",
  lendo: "Conferindo",
  pausado: "Parou aqui",
  fila: "Na fila",
};

/** O painel "Ver andamento": um tema por linha, na ordem do parecer, e o uso no rodapé. */
export function PainelAndamento({ estado }: { readonly estado: EstadoRevisaoIa }) {
  const lendo = estado.blocos.some((b) => b.estado === "em_andamento");
  const agora = useAgora(lendo);
  const linhas = linhasAndamento(estado, agora);
  return (
    <div className="flex flex-col gap-3 border-border border-t pt-3">
      <ol aria-label="Andamento por tema" className="flex flex-col gap-2">
        {linhas.map((l) => (
          <li key={l.id} className="flex items-start gap-3 text-small">
            <span aria-hidden className={cn("mt-1.5 block size-2 shrink-0 rounded-full", MARCA[l.situacao])} />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span>
                <span className="font-semibold">{l.titulo}</span>{" "}
                <span className="text-muted-foreground">
                  · {ROTULO_SITUACAO[l.situacao]}: {l.detalhe}
                </span>
              </span>
              {l.situacao === "lendo" || l.situacao === "pausado" ? (
                <span className="text-muted-foreground text-micro">{l.criterios.join("; ")}</span>
              ) : null}
              {l.situacao === "pausado" && estado.motivo !== null ? (
                <span className="text-grav-conferir-texto text-micro">{estado.motivo}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
      <p className="text-micro text-muted-foreground">{rodapeAndamento(estado)}</p>
    </div>
  );
}

function BotaoAndamento({ aberto, aoAlternar }: { readonly aberto: boolean; readonly aoAlternar: () => void }) {
  return (
    <Button variant="ghost" size="sm" aria-expanded={aberto} onClick={aoAlternar}>
      Ver andamento
      <ChevronDownIcon className={cn("transition-transform motion-reduce:transition-none", aberto && "rotate-180")} />
    </Button>
  );
}

export function FaixaIa({ faltam }: { readonly faltam: number }) {
  const [revisaoEstado, revisao] = useRevisao();
  const ia = revisaoEstado.ia;
  const { estado } = ia;
  const provider = providerEfetivoIa(ia);
  const [andamento, setAndamento] = useState(false);
  const nome = nomeIa(estado?.provider ?? provider);
  const rotulo = "Conferência com IA";
  const faltamTexto = `${faltam === 1 ? "Falta" : "Faltam"} ${plural(faltam, "critério que pede", "critérios que pedem")} leitura.`;
  const painel =
    andamento && estado !== undefined && estado.blocos.length > 0 ? <PainelAndamento estado={estado} /> : null;
  const verAndamento = <BotaoAndamento aberto={andamento} aoAlternar={() => setAndamento((a) => !a)} />;

  if (estado?.situacao === "em_andamento" || estado?.situacao === "pausada") {
    const pausada = estado.situacao === "pausada";
    const podeEncerrar = pausada && blocosProntos(estado) > 0;
    return (
      <Caixa rotulo={rotulo} abaixo={painel}>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="flex items-center gap-2 font-semibold text-body" role="status">
            {pausada ? null : <Spinner />}
            {pausada ? `Conferência pausada — ${contagemTemas(estado)}` : textoAndamento(estado)}
          </p>
          <p className="max-w-[68ch] text-muted-foreground text-small">
            {pausada
              ? (estado.motivo ?? "Você pausou a conferência.") +
                (estado.limite ? " O que já foi conferido fica guardado; retome quando o limite renovar." : "")
              : `O ${nome} está conferindo os temas um a um. Você pode trabalhar na lista enquanto isso.`}
          </p>
          <ErroDaLeitura />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {verAndamento}
          {podeEncerrar ? (
            <Button variant="ghost" disabled={ia.ocupada} onClick={() => void revisao.cancelarIa()}>
              Encerrar conferência por aqui
            </Button>
          ) : null}
          {pausada ? (
            <Button disabled={ia.ocupada} onClick={() => void revisao.iniciarIa()}>
              <PlayIcon /> Retomar
            </Button>
          ) : (
            <Button variant="outline" disabled={ia.ocupada} onClick={() => void revisao.pausarIa()}>
              <PauseIcon /> Pausar
            </Button>
          )}
        </div>
      </Caixa>
    );
  }

  if (estado?.situacao === "falhou")
    return (
      <Caixa rotulo={rotulo} abaixo={painel}>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-semibold text-body">A conferência com o {nome} não terminou.</p>
          <p className="max-w-[68ch] text-muted-foreground text-small">
            {estado.motivo ?? "A IA parou no meio."} O que já foi conferido fica guardado. Tente de novo; se o erro
            continuar, confira a IA em Configurações › Sua IA.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {verAndamento}
          <Button onClick={() => void revisao.tentarDeNovoIa()}>Tentar de novo</Button>
        </div>
      </Caixa>
    );

  if (semIaDisponivel(ia))
    return (
      <Caixa rotulo={rotulo}>
        <p className="max-w-[68ch] text-body">
          {faltamTexto} Para conferi-los, conecte uma IA (Claude, ChatGPT ou Gemini) em Configurações › Sua IA.
        </p>
        <Link to="/configuracoes" className={buttonVariants({ variant: "outline", className: "shrink-0" })}>
          Abrir Configurações
        </Link>
      </Caixa>
    );

  if (ia.avisoPendente)
    return (
      <Caixa rotulo={rotulo}>
        <p className="max-w-[68ch] text-body">
          {faltamTexto} Antes de usar a IA, leia o aviso de uso e clique em “Entendi” em Configurações › Sua IA.
        </p>
        <Link to="/configuracoes" className={buttonVariants({ variant: "outline", className: "shrink-0" })}>
          Abrir Configurações
        </Link>
      </Caixa>
    );

  const preparada = estado?.situacao === "preparada" ? estado : undefined;
  return (
    <Caixa rotulo={rotulo}>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="max-w-[68ch] text-body">
          {faltamTexto}{" "}
          {preparada === undefined ? null : (
            <span className={ia.estimando ? "text-muted-foreground" : undefined}>
              {textoEstimativa(preparada.estimativa, ia.modo, nome)}
            </span>
          )}
        </p>
        {ia.estimando || (preparada === undefined && ia.erro === undefined) ? (
          <p role="status" className="flex items-center gap-2 text-muted-foreground text-small">
            <Spinner className="size-3.5" /> Calculando quanto a conferência usa do seu plano…
          </p>
        ) : null}
        <ErroDaLeitura />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          disabled={preparada === undefined || ia.estimando || ia.ocupada}
          onClick={() => void revisao.iniciarIa()}
        >
          {ia.ocupada ? <Spinner /> : <MarcaIa provider={estado?.provider ?? provider} />}
          Conferir com o {nome}
        </Button>
        <Opcoes faltam={faltam} />
      </div>
    </Caixa>
  );
}

/** O erro da leitura e, quando o servidor pede o arquivo de novo, o botão para escolhê-lo. */
function ErroDaLeitura() {
  const [estado, revisao] = useRevisao();
  const erro = estado.ia.erro;
  if (erro === undefined) return null;
  const podeEscolher = estado.origemArquivoDeNovo === "ia" && ponteDesktop() !== undefined;
  return (
    <>
      <AvisoErro erro={erro} />
      {podeEscolher ? (
        <Button variant="outline" className="self-start" onClick={() => void revisao.escolherArquivoDeNovo()}>
          Escolher o arquivo de novo
        </Button>
      ) : null}
    </>
  );
}

function Opcoes({ faltam }: { readonly faltam: number }) {
  const [estado, revisao] = useRevisao();
  const ia = estado.ia;
  const usaveis = ia.usaveis ?? [];
  const provider = providerEfetivoIa(ia);
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" />}>
        <SlidersHorizontalIcon /> Opções
      </PopoverTrigger>
      <PopoverContent className="flex w-[22rem] flex-col gap-5 p-5">
        <PopoverTitle className="text-heading">Opções da conferência</PopoverTitle>
        {usaveis.length > 1 ? (
          <div className="flex flex-col gap-2">
            <p className="font-medium text-muted-foreground text-micro">Com qual IA</p>
            <RadioCartao<Provider>
              rotuloAria="Com qual IA"
              valor={provider}
              aoMudar={(p) => revisao.escolherProvider(p)}
              opcoes={usaveis.map((p) => ({
                valor: p,
                titulo: nomeIa(p),
                icone: <MarcaIa provider={p} />,
              }))}
            />
          </div>
        ) : null}
        <div className="flex flex-col gap-2">
          <p className="font-medium text-muted-foreground text-micro">O que conferir</p>
          <Segmented<ModoRevisaoIa>
            cheio
            rotuloAria="O que conferir"
            valor={ia.modo}
            aoMudar={(modo) => revisao.escolherModo(modo)}
            opcoes={[
              { valor: "rapido", rotulo: "O que mais devolve PPC" },
              { valor: "completo", rotulo: `Todos os ${faltam}` },
            ]}
          />
          <p className="text-muted-foreground text-small">
            {ia.modo === "rapido"
              ? "Os critérios que impedem o envio e os temas que a PROENS mais devolve."
              : `Os ${plural(faltam, "critério que pede", "critérios que pedem")} leitura.`}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** O fim da leitura, numa linha que a pessoa fecha: "O Claude leu 72 critérios e encontrou mais 5 pontos." */
export function ConclusaoIa({ texto, aoFechar }: { readonly texto: string; readonly aoFechar: () => void }) {
  return (
    <div role="status" className="flex items-center justify-between gap-3 border-border border-y py-2 text-body">
      <p>{texto}</p>
      <Button variant="ghost" size="icon-sm" aria-label="Fechar" title="Fechar" onClick={aoFechar}>
        <XIcon />
      </Button>
    </div>
  );
}
