/**
 * O começo de uma tarefa (M1.9), comum à caixa do Início e ao formulário da tarefa: a pasta em
 * `Documentos/Simplifica IF/<título>` (`pasta.criar`), os anexos copiados para ela (`pasta.anexar`), a
 * conversa com a tarefa e o pedido enviado. E os dois controles do começo: a escolha da IA e os anexos.
 */
import type { Provider } from "@simplifica-if/contratos-app";
import { PaperclipIcon, XIcon } from "lucide-react";
import { useId } from "react";
import { MarcaIa } from "../components/MarcaIa.tsx";
import { Button } from "../components/ui/button.tsx";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../components/ui/select.tsx";
import type { Api } from "../conexao/api.ts";
import type { ControleConversa } from "../conversa/ControleConversa.ts";
import { ponteDesktop } from "../ponte-desktop.ts";
import { DESCRICOES, PROVIDERS } from "../providers.ts";
import { usePreferencias } from "./perfil.ts";

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

/**
 * A escolha da IA, com a marca de cada uma ao lado do nome (no botão e na lista). É o `Select` do Base
 * UI (combobox com teclado e leitor de tela), não o `<select>` nativo, cujas opções não aceitam ícone.
 * `compacta` (na caixa de pedido): só a marca, o nome e um chevron, discretos, e o rótulo "IA" só para o
 * leitor de tela.
 */
export function EscolhaIa({
  valor,
  aoMudar,
  compacta = false,
}: {
  readonly valor: Provider;
  readonly aoMudar: (provider: Provider) => void;
  readonly compacta?: boolean;
}) {
  const id = useId();
  // As IAs que a pessoa deixou de usar no app (Configurações › Sua IA) saem da lista, menos a escolhida.
  const desligadas = usePreferencias().preferencias?.iasDesligadas ?? [];
  const opcoes = PROVIDERS.filter((provider) => provider === valor || !desligadas.includes(provider));
  const escolha = (
    <Select
      value={valor}
      onValueChange={(provider) => provider !== null && aoMudar(provider)}
      itemToStringLabel={(provider: Provider) => NOMES_IA[provider]}
    >
      <SelectTrigger
        id={id}
        variant={compacta ? "ghost" : "default"}
        size="sm"
        className={compacta ? "w-auto rounded-full font-medium" : "w-auto min-w-0"}
        title={`IA: ${DESCRICOES[valor].nome}`}
        {...(compacta ? { "aria-label": "IA" } : {})}
      >
        <SelectValue className="flex items-center gap-1.5">
          {(provider: Provider) => (
            <>
              <MarcaIa provider={provider} />
              {NOMES_IA[provider]}
            </>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup alignItemWithTrigger={false}>
        {opcoes.map((provider) => (
          <SelectItem key={provider} value={provider}>
            <span className="flex items-center gap-2">
              <MarcaIa provider={provider} />
              {NOMES_IA[provider]}
            </span>
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
  if (compacta) return escolha;
  return (
    <span className="flex items-center gap-1.5 text-sm">
      <label htmlFor={id} className="text-muted-foreground">
        IA
      </label>
      {escolha}
    </span>
  );
}

/**
 * O clipe de "Anexar arquivo" (só no app: o diálogo do sistema; o processo principal libera o arquivo
 * no servidor), um botão redondo só com o ícone, e a lista dos escolhidos, com "Tirar". Com `rotulo`
 * (o campo de arquivo do formulário da tarefa), o botão mostra o texto ao lado do clipe.
 */
export function Anexos({
  anexos,
  aoMudar,
  aceita,
  rotulo,
}: {
  readonly anexos: ReadonlyArray<string>;
  readonly aoMudar: (anexos: ReadonlyArray<string>) => void;
  readonly aceita?: ReadonlyArray<string> | undefined;
  readonly rotulo?: string | undefined;
}) {
  const escolher = ponteDesktop()?.escolherAnexo;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {escolher === undefined ? (
        <span className="text-muted-foreground text-xs">Para anexar arquivos, use o app no computador.</span>
      ) : (
        <Button
          type="button"
          {...(rotulo === undefined
            ? ({
                variant: "ghost",
                size: "icon-sm-pill",
                className: "text-muted-foreground hover:text-foreground",
                "aria-label": "Anexar arquivo",
                title: "Anexar arquivo",
              } as const)
            : ({ variant: "outline", size: "sm" } as const))}
          onClick={async () => {
            const arquivo = await escolher(aceita);
            if (arquivo !== null && !anexos.includes(arquivo)) aoMudar([...anexos, arquivo]);
          }}
        >
          <PaperclipIcon aria-hidden />
          {rotulo}
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
