/**
 * O começo de uma tarefa (M1.9), comum à caixa do Início e ao formulário da tarefa: a pasta em
 * `Documentos/Simplifica IF/<título>` (`pasta.criar`), os anexos copiados para ela (`pasta.anexar`), a
 * conversa com a tarefa e o pedido enviado. E os dois controles do começo: a escolha da IA e os anexos.
 */
import type { Provider } from "@simplifica-if/contratos-app";
import { PaperclipIcon, XIcon } from "lucide-react";
import { useId } from "react";
import { Button } from "../components/ui/button.tsx";
import type { Api } from "../conexao/api.ts";
import type { ControleConversa } from "../conversa/ControleConversa.ts";
import { ponteDesktop } from "../ponte-desktop.ts";
import { DESCRICOES, PROVIDERS } from "../providers.ts";

export async function comecarTarefa(
  api: Api,
  conversa: ControleConversa,
  pedido: {
    readonly titulo: string;
    readonly tarefa: string;
    readonly provider: Provider;
    readonly anexos: ReadonlyArray<string>;
    readonly texto: string;
  },
): Promise<string> {
  const { pasta } = await api.chamar((cliente) => cliente["pasta.criar"]({ titulo: pedido.titulo }));
  for (const arquivo of pedido.anexos) {
    await api.chamar((cliente) => cliente["pasta.anexar"]({ pasta, arquivo }));
  }
  return conversa.comecarTarefa({ provider: pedido.provider, pasta, tarefa: pedido.tarefa, pedido: pedido.texto });
}

/** O nome do arquivo de um caminho (macOS ou Windows). */
export const nomeArquivo = (caminho: string): string => caminho.split(/[\\/]/).at(-1) ?? caminho;

const NOMES_IA: Readonly<Record<Provider, string>> = {
  claude: "Claude",
  codex: "ChatGPT",
  antigravity: "Gemini (mais lento)",
};

export function EscolhaIa({
  valor,
  aoMudar,
}: {
  readonly valor: Provider;
  readonly aoMudar: (provider: Provider) => void;
}) {
  const id = useId();
  return (
    <span className="flex items-center gap-1.5 text-sm">
      <label htmlFor={id} className="text-muted-foreground">
        IA
      </label>
      <select
        id={id}
        value={valor}
        onChange={(evento) => aoMudar(evento.currentTarget.value as Provider)}
        className="h-8 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={DESCRICOES[valor].nome}
      >
        {PROVIDERS.map((provider) => (
          <option key={provider} value={provider}>
            {NOMES_IA[provider]}
          </option>
        ))}
      </select>
    </span>
  );
}

/**
 * "Anexar arquivo…" (só no app: o diálogo do sistema; o processo principal libera o arquivo no
 * servidor) e a lista dos escolhidos, com "Tirar".
 */
export function Anexos({
  anexos,
  aoMudar,
  aceita,
  rotulo = "Anexar arquivo…",
}: {
  readonly anexos: ReadonlyArray<string>;
  readonly aoMudar: (anexos: ReadonlyArray<string>) => void;
  readonly aceita?: ReadonlyArray<string> | undefined;
  readonly rotulo?: string;
}) {
  const escolher = ponteDesktop()?.escolherAnexo;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {escolher === undefined ? (
        <span className="text-muted-foreground text-xs">Para anexar arquivos, use o app no computador.</span>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            const arquivo = await escolher(aceita);
            if (arquivo !== null && !anexos.includes(arquivo)) aoMudar([...anexos, arquivo]);
          }}
        >
          <PaperclipIcon /> {rotulo}
        </Button>
      )}
      {anexos.length === 0 ? null : (
        <ul className="flex flex-wrap gap-1.5" aria-label="Arquivos anexados">
          {anexos.map((arquivo) => (
            <li
              key={arquivo}
              className="flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs"
            >
              <PaperclipIcon aria-hidden className="size-3" />
              {nomeArquivo(arquivo)}
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Tirar ${nomeArquivo(arquivo)}`}
                onClick={() => aoMudar(anexos.filter((outro) => outro !== arquivo))}
              >
                <XIcon className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
