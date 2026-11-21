/**
 * A faixa da IA, enquanto o resultado não passou por ela: quantos critérios faltam ler, a estimativa já
 * calculada e "Ler com o Claude"; as opções (a IA, o escopo e o detalhe do uso) ficam num popover.
 * Durante a leitura, a faixa vira o andamento, com "Pausar"; pausada, diz por quê e oferece "Retomar";
 * se falhar, diz o que fazer. O fim fica na tela (`ConclusaoIa`), não aqui.
 */
import type { ModoRevisaoIa, Provider } from "@simplifica-if/contratos-app";
import { Link } from "@tanstack/react-router";
import { PauseIcon, PlayIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";
import { AvisoErro } from "../components/AvisoErro.tsx";
import { MarcaIa } from "../components/MarcaIa.tsx";
import { Button, buttonVariants } from "../components/ui/button.tsx";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "../components/ui/popover.tsx";
import { RadioCartao } from "../components/ui/radio-cartao.tsx";
import { Segmented } from "../components/ui/segmented.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { DESCRICOES } from "../providers.ts";
import { contagemTemas, detalheEstimativa, textoAndamento, textoEstimativa } from "./ia.ts";
import { plural } from "./lista.ts";
import type { LeituraIa } from "./useLeituraIa.ts";

export const nomeIa = (provider: Provider) => DESCRICOES[provider].nome;

function Caixa({ children, rotulo }: { readonly children: React.ReactNode; readonly rotulo: string }) {
  return (
    <section
      aria-label={rotulo}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
    >
      {children}
    </section>
  );
}

export function FaixaIa({ leitura, faltam }: { readonly leitura: LeituraIa; readonly faltam: number }) {
  const { estado, provider } = leitura;
  const nome = nomeIa(estado?.provider ?? provider);
  const rotulo = "Leitura com IA";
  const faltamTexto = `${faltam === 1 ? "Falta" : "Faltam"} ${plural(faltam, "critério que pede", "critérios que pedem")} leitura.`;

  if (estado?.situacao === "em_andamento" || estado?.situacao === "pausada") {
    const pausada = estado.situacao === "pausada";
    return (
      <Caixa rotulo={rotulo}>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="flex items-center gap-2 font-semibold text-body" role="status">
            {pausada ? null : <Spinner />}
            {pausada ? `Leitura pausada — ${contagemTemas(estado)}` : textoAndamento(estado)}
          </p>
          <p className="max-w-[68ch] text-muted-foreground text-small">
            {pausada
              ? (estado.motivo ?? "Você pausou a leitura.") +
                (estado.limite ? " O que já foi lido fica guardado; retome quando o limite renovar." : "")
              : `O ${nome} está lendo os temas um a um. Você pode trabalhar na lista enquanto isso.`}
          </p>
          <ErroDaLeitura leitura={leitura} />
        </div>
        {pausada ? (
          <Button className="shrink-0" disabled={leitura.ocupada} onClick={leitura.iniciar}>
            <PlayIcon /> Retomar
          </Button>
        ) : (
          <Button className="shrink-0" variant="outline" disabled={leitura.ocupada} onClick={leitura.pausar}>
            <PauseIcon /> Pausar
          </Button>
        )}
      </Caixa>
    );
  }

  if (estado?.situacao === "falhou")
    return (
      <Caixa rotulo={rotulo}>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-semibold text-body">A leitura com o {nome} não terminou.</p>
          <p className="max-w-[68ch] text-muted-foreground text-small">
            {estado.motivo ?? "A IA parou no meio."} O que já foi lido fica guardado. Tente de novo; se o erro
            continuar, confira a IA em Configurações › Sua IA.
          </p>
        </div>
        <Button className="shrink-0" onClick={leitura.tentarDeNovo}>
          Tentar de novo
        </Button>
      </Caixa>
    );

  if (leitura.semIa)
    return (
      <Caixa rotulo={rotulo}>
        <p className="max-w-[68ch] text-body">
          {faltamTexto} Para lê-los, conecte uma IA (Claude, ChatGPT ou Gemini) em Configurações › Sua IA.
        </p>
        <Link to="/configuracoes" className={buttonVariants({ variant: "outline", className: "shrink-0" })}>
          Abrir Configurações
        </Link>
      </Caixa>
    );

  if (leitura.avisoPendente)
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
            <span className={leitura.estimando ? "text-muted-foreground" : undefined}>
              {textoEstimativa(preparada.estimativa, leitura.modo, nome)}
            </span>
          )}
        </p>
        {leitura.estimando || (preparada === undefined && leitura.erro === undefined) ? (
          <p role="status" className="flex items-center gap-2 text-muted-foreground text-small">
            <Spinner className="size-3.5" /> Calculando quanto a leitura usa do seu plano…
          </p>
        ) : null}
        <ErroDaLeitura leitura={leitura} />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button disabled={preparada === undefined || leitura.estimando || leitura.ocupada} onClick={leitura.iniciar}>
          {leitura.ocupada ? <Spinner /> : null}
          Ler com o {nome}
        </Button>
        <Opcoes leitura={leitura} faltam={faltam} />
      </div>
    </Caixa>
  );
}

/** O erro da leitura e, quando o servidor pede o arquivo de novo, o botão para escolhê-lo. */
function ErroDaLeitura({ leitura }: { readonly leitura: LeituraIa }) {
  if (leitura.erro === undefined) return null;
  return (
    <>
      <AvisoErro erro={leitura.erro} />
      {leitura.escolherArquivo === undefined ? null : (
        <Button variant="outline" className="self-start" onClick={leitura.escolherArquivo}>
          Escolher o arquivo de novo
        </Button>
      )}
    </>
  );
}

function Opcoes({ leitura, faltam }: { readonly leitura: LeituraIa; readonly faltam: number }) {
  const preparada = leitura.estado?.situacao === "preparada" ? leitura.estado : undefined;
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" />}>
        <SlidersHorizontalIcon /> Opções
      </PopoverTrigger>
      <PopoverContent className="flex w-96 flex-col gap-4">
        <PopoverTitle className="font-semibold text-heading">Opções da leitura</PopoverTitle>
        {leitura.usaveis.length > 1 ? (
          <div className="flex flex-col gap-2">
            <p className="font-semibold text-small">Com qual IA</p>
            <RadioCartao<Provider>
              rotuloAria="Com qual IA"
              valor={leitura.provider}
              aoMudar={leitura.escolherProvider}
              opcoes={leitura.usaveis.map((p) => ({
                valor: p,
                titulo: nomeIa(p),
                icone: <MarcaIa provider={p} />,
              }))}
            />
          </div>
        ) : null}
        <div className="flex flex-col gap-2">
          <p className="font-semibold text-small">O que ler</p>
          <Segmented<ModoRevisaoIa>
            rotuloAria="O que ler"
            valor={leitura.modo}
            aoMudar={leitura.escolherModo}
            opcoes={[
              { valor: "rapido", rotulo: "O que mais devolve PPC" },
              { valor: "completo", rotulo: `Todos os ${faltam}` },
            ]}
          />
          <p className="text-muted-foreground text-small">
            {leitura.modo === "rapido"
              ? "Os critérios que impedem o envio e os temas que a PROENS mais devolve."
              : `Os ${plural(faltam, "critério que pede", "critérios que pedem")} leitura.`}
          </p>
        </div>
        {preparada === undefined ? null : (
          <p className="text-muted-foreground text-small">{detalheEstimativa(preparada.estimativa)}</p>
        )}
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
