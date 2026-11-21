/**
 * O passo guiado do Claude (M1.8): o app não instala o Claude Code nem faz o login dele (o T3 também
 * não). A pessoa instala pelo instalador oficial da Anthropic, aberto no navegador, entra na conta no
 * Terminal e volta ao app, que confere ("Já fiz, conferir": `providers.detectar`, que procura o
 * `claude` de novo a cada pedido, inclusive em `~/.local/bin`). O app nunca baixa nem roda instalador.
 */
import type { EstadoProvider } from "@simplifica-if/contratos-app";
import { CheckIcon, CopyIcon, ExternalLinkIcon, SearchCheckIcon } from "lucide-react";
import { useState } from "react";
import { abrirExterno } from "../ponte-desktop.ts";
import { Alert, AlertDescription } from "./ui/alert.tsx";
import { Button } from "./ui/button.tsx";
import { Spinner } from "./ui/spinner.tsx";

/** A página oficial de instalação do Claude Code, em português. */
export const URL_INSTALAR_CLAUDE = "https://code.claude.com/docs/pt/setup";

const ehWindows = () => typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent);

/** O comando do instalador oficial para o sistema, como a página da Anthropic o mostra. */
export const comandoInstalarClaude = (windows = ehWindows()): string =>
  windows ? "irm https://claude.ai/install.ps1 | iex" : "curl -fsSL https://claude.ai/install.sh | bash";

function Comando({ comando, rotulo }: { readonly comando: string; readonly rotulo: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="rounded-md bg-muted px-2 py-1 font-mono text-small" aria-label={rotulo}>
        {comando}
      </code>
      <Button
        type="button"
        size="xs"
        variant="outline"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(comando);
            setCopiado(true);
            setTimeout(() => setCopiado(false), 2000);
          } catch {
            // Sem permissão de área de transferência: a pessoa seleciona o texto à mão.
          }
        }}
      >
        {copiado ? <CheckIcon /> : <CopyIcon />}
        {copiado ? "Copiado" : "Copiar"}
      </Button>
    </div>
  );
}

/** O que falta, em linguagem simples, depois de "Já fiz, conferir". */
function falta(estado: EstadoProvider): string | undefined {
  if (!estado.instalado)
    return "Ainda não encontramos o Claude Code neste computador. Confira se o comando de instalação terminou sem erro no Terminal e tente de novo.";
  if (!estado.autenticado)
    return "O Claude Code está instalado, mas falta entrar na sua conta. Faça o passo 2 e tente de novo.";
  return undefined;
}

export function PassoClaude({
  estado,
  conferindo,
  conferiu,
  aoConferir,
}: {
  readonly estado: EstadoProvider;
  readonly conferindo: boolean;
  /** A pessoa já clicou "Já fiz, conferir" ao menos uma vez (só então o que falta aparece). */
  readonly conferiu: boolean;
  readonly aoConferir: () => void;
}) {
  const mensagem = conferiu && !conferindo ? falta(estado) : undefined;
  return (
    <div className="flex flex-col gap-3 text-sm" data-passo-claude>
      <p className="text-muted-foreground">
        Para usar o Claude, o Simplifica IF precisa do <strong>Claude Code</strong>, o programa oficial da Anthropic, e
        de uma conta Claude Pro, Max, Team ou Enterprise (ou uma chave de API da Anthropic). São dois passos, feitos uma
        vez só:
      </p>
      <ol className="flex list-decimal flex-col gap-3 pl-5">
        <li className={estado.instalado ? "text-muted-foreground" : undefined}>
          <span className="font-medium">Instale o Claude Code.</span>{" "}
          {estado.instalado ? (
            <span className="inline-flex items-center gap-1 text-success">
              <CheckIcon className="size-3.5" /> Feito
            </span>
          ) : (
            <span className="flex flex-col gap-2 pt-1">
              <span>
                Abra a página oficial, copie o comando de instalação do seu sistema e cole no Terminal (no Windows, no
                PowerShell). O comando é este:
              </span>
              <Comando comando={comandoInstalarClaude()} rotulo="Comando de instalação" />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="self-start"
                onClick={() => void abrirExterno(URL_INSTALAR_CLAUDE)}
              >
                <ExternalLinkIcon /> Abrir a página de instalação
              </Button>
            </span>
          )}
        </li>
        <li>
          <span className="font-medium">Entre na sua conta.</span>{" "}
          <span className="flex flex-col gap-2 pt-1">
            <span>
              Num Terminal novo, digite o comando abaixo, escolha entrar com a conta Claude e conclua no navegador.
              Quando o Claude Code abrir, pode fechar o Terminal.
            </span>
            <Comando comando="claude" rotulo="Comando de login" />
          </span>
        </li>
      </ol>
      <Button type="button" className="self-start" onClick={aoConferir} disabled={conferindo}>
        {conferindo ? <Spinner /> : <SearchCheckIcon />}
        {conferindo ? "Conferindo…" : "Já fiz, conferir"}
      </Button>
      {mensagem === undefined ? null : (
        <Alert variant="warning">
          <AlertDescription>{mensagem}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
