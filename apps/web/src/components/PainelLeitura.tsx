/**
 * O painel lateral que lê um link `ifpr://` pelo `lerLink` do `GrupoLeitura`, direto da base, sem
 * passar pela IA, e mostra o texto em Markdown. Os links `ifpr://` do próprio texto abrem no painel,
 * com "Voltar". O leitor completo (dispositivo destacado, selo de vigência, relações, "copiar
 * citação") é o M1.6.
 */
import type { LinkLido } from "@simplifica-if/contratos-app";
import { ArrowLeftIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { mensagemDeErro } from "../conexao/erros.ts";
import { useApi } from "../contexto.tsx";
import { Markdown } from "./Markdown.tsx";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert.tsx";
import { Button } from "./ui/button.tsx";
import { Spinner } from "./ui/spinner.tsx";

const TIPOS: Readonly<Record<LinkLido["tipo"], string>> = {
  norma: "Norma",
  dispositivo: "Dispositivo de norma",
  curso: "Curso",
  ppc: "PPC",
  secao: "Seção de PPC",
  cnct: "Catálogo Nacional de Cursos Técnicos",
  campus: "Campus",
  ficha: "Ficha de análise",
};

type Leitura =
  | { readonly fase: "carregando" }
  | { readonly fase: "lido"; readonly lido: LinkLido }
  | { readonly fase: "falhou"; readonly erro: string };

function ConteudoLink({ link, aoAbrirLink }: { readonly link: string; readonly aoAbrirLink: (link: string) => void }) {
  const api = useApi();
  const [leitura, setLeitura] = useState<Leitura>({ fase: "carregando" });

  useEffect(() => {
    let vivo = true;
    api
      .chamar((cliente) => cliente.lerLink({ link }))
      .then(
        (lido) => vivo && setLeitura({ fase: "lido", lido }),
        (erro: unknown) => vivo && setLeitura({ fase: "falhou", erro: mensagemDeErro(erro) }),
      );
    return () => {
      vivo = false;
    };
  }, [api, link]);

  switch (leitura.fase) {
    case "carregando":
      return (
        <p className="flex items-center gap-2 text-muted-foreground text-sm">
          <Spinner size="sm" /> Lendo na base…
        </p>
      );
    case "falhou":
      return (
        <Alert variant="error">
          <AlertTitle>Não foi possível ler este link</AlertTitle>
          <AlertDescription>{leitura.erro}</AlertDescription>
        </Alert>
      );
    case "lido":
      return (
        <article aria-label={TIPOS[leitura.lido.tipo]}>
          <p className="mb-2 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
            {TIPOS[leitura.lido.tipo]}
          </p>
          <Markdown texto={leitura.lido.texto} aoAbrirLink={aoAbrirLink} />
        </article>
      );
  }
}

export function PainelLeitura({
  historico,
  aoAbrirLink,
  aoVoltar,
  aoFechar,
}: {
  /** Os links abertos, o atual por último. */
  readonly historico: ReadonlyArray<string>;
  readonly aoAbrirLink: (link: string) => void;
  readonly aoVoltar: () => void;
  readonly aoFechar: () => void;
}) {
  const link = historico.at(-1);
  if (link === undefined) return null;
  return (
    <aside
      aria-label="Painel de leitura"
      className="flex h-full w-full flex-col border-border border-l bg-card text-card-foreground"
    >
      <header className="flex items-center gap-1 border-border border-b px-3 py-2">
        {historico.length > 1 ? (
          <Button variant="ghost" size="icon-sm" aria-label="Voltar ao link anterior" onClick={aoVoltar}>
            <ArrowLeftIcon />
          </Button>
        ) : null}
        <p className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs" title={link}>
          {link}
        </p>
        <Button variant="ghost" size="icon-sm" aria-label="Fechar o painel de leitura" onClick={aoFechar}>
          <XIcon />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <ConteudoLink key={link} link={link} aoAbrirLink={aoAbrirLink} />
      </div>
    </aside>
  );
}
