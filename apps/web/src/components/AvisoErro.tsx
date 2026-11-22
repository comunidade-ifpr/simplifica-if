/**
 * Um erro para a pessoa: a frase em português e, quando há, o texto técnico original e o código do erro
 * num "Detalhes técnicos" recolhido (o texto muitas vezes em inglês, da CLI do provider). Com o código,
 * um link discreto leva a "Configurações › Diagnóstico", para gerar o pacote que acompanha o relato
 * (fora da própria seção, que o esconde com `semLinkDiagnostico`).
 */
import { Link } from "@tanstack/react-router";
import { CircleAlertIcon } from "lucide-react";
import type { MensagemErro } from "../conexao/erros.ts";
import { Alert, AlertDescription } from "./ui/alert.tsx";

/**
 * O texto técnico e o código do erro (`codigoDoErro`), que a pessoa informa ao relatar o problema: com ele,
 * acha-se o pedido no log do app.
 */
export function DetalhesTecnicos({
  detalhe,
  codigo,
  semLinkDiagnostico = false,
}: {
  readonly detalhe: string | undefined;
  readonly codigo?: string | undefined;
  /** Sem o link "Gerar diagnóstico" (na própria seção Diagnóstico, ele levaria a ela mesma). */
  readonly semLinkDiagnostico?: boolean;
}) {
  const temDetalhe = detalhe !== undefined && detalhe.length > 0;
  if (!temDetalhe && codigo === undefined) return null;
  return (
    <details className="mt-1 text-small" data-texto-tecnico>
      <summary className="cursor-pointer select-none font-medium">Detalhes técnicos</summary>
      {codigo === undefined ? null : (
        <p className="mt-1">
          Código do erro: <span className="select-all font-mono">{codigo}</span> (informe-o ao relatar o problema).
          {semLinkDiagnostico ? null : (
            <>
              {" "}
              <Link to="/configuracoes" hash="diagnostico" className="underline underline-offset-2">
                Gerar diagnóstico
              </Link>
            </>
          )}
        </p>
      )}
      {temDetalhe ? <pre className="mt-1 whitespace-pre-wrap break-words font-mono">{detalhe}</pre> : null}
    </details>
  );
}

export function AvisoErro({
  erro,
  icone = false,
  semLinkDiagnostico = false,
}: {
  readonly erro: MensagemErro;
  readonly icone?: boolean;
  /** Sem o link "Gerar diagnóstico" em "Detalhes técnicos" (na própria seção Diagnóstico). */
  readonly semLinkDiagnostico?: boolean;
}) {
  return (
    <Alert variant="error">
      {icone ? <CircleAlertIcon /> : null}
      <AlertDescription>
        <p>{erro.texto}</p>
        <DetalhesTecnicos detalhe={erro.detalhe} codigo={erro.codigo} semLinkDiagnostico={semLinkDiagnostico} />
      </AlertDescription>
    </Alert>
  );
}
