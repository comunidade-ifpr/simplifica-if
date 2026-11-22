/**
 * "Configurações › Diagnóstico": a seção `#diagnostico` da tela de Configurações. Quando algo não
 * funciona, a pessoa gera um pacote `.zip` com os registros do app e as versões em uso e o anexa ao
 * relato do problema.
 *
 * - "Ver o que vai no pacote" (`diagnostico.preparar`): a lista dos arquivos com o tamanho, o que ficou
 *   de fora (com o motivo), o fim de cada registro já saneado e o `sistema.json`, em blocos recolhidos.
 * - "Gerar diagnóstico" (`diagnostico.gerar`), só depois da prévia: grava o `.zip` em
 *   `Documentos/Simplifica IF/Diagnósticos/` e mostra o caminho, com "Mostrar na pasta" no desktop
 *   (`mostrarArquivoTarefa`). O pacote é montado na hora: pode trazer linhas registradas depois da prévia.
 *
 * O resultado e o andamento saem numa região viva (`role="status"`) montada vazia desde o começo, para o
 * leitor de tela anunciar a mudança; os botões com spinner ficam com `aria-busy`.
 *
 * Nada sai do computador por aqui. "Detalhes técnicos" (`AvisoErro.tsx`) leva para cá quando o erro tem
 * código.
 */
import type { DiagnosticoGerado, PreviaDiagnostico } from "@simplifica-if/contratos-app";
import { FileArchiveIcon, FolderOpenIcon, ListIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { AvisoErro } from "../components/AvisoErro.tsx";
import { Alert, AlertDescription } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { explicarErro, type MensagemErro } from "../conexao/erros.ts";
import { useApi } from "../contexto.tsx";
import { tamanhoArquivo } from "../lib/formato.ts";
import { ponteDesktop } from "../ponte-desktop.ts";

/** O id da seção, para o link de "Detalhes técnicos" (`/configuracoes#diagnostico`). */
export const SECAO_DIAGNOSTICO = "diagnostico";

function Previa({ previa }: { readonly previa: PreviaDiagnostico }) {
  const total = previa.itens.reduce((soma, item) => soma + item.bytes, 0);
  return (
    <section aria-labelledby="titulo-previa-diagnostico" className="flex flex-col gap-2 rounded-lg border p-4">
      <h3 id="titulo-previa-diagnostico" className="font-semibold">
        O que vai no pacote ({tamanhoArquivo(total)}, antes de compactar)
      </h3>
      {previa.temLogs ? null : (
        <p className="text-muted-foreground text-sm">
          Não há registros do app neste computador: o pacote leva só as versões e o sistema.
        </p>
      )}
      <ul className="flex flex-col divide-y text-sm" aria-label="Arquivos do pacote">
        {previa.itens.map((item) => (
          <li key={item.nome} className="flex flex-wrap items-baseline gap-x-2 py-1.5">
            <span className="font-medium font-mono text-small">{item.nome}</span>
            <span className="text-muted-foreground text-micro">{tamanhoArquivo(item.bytes)}</span>
            <span className="basis-full text-muted-foreground">{item.descricao}</span>
            {item.trecho === undefined || item.trecho === "" ? null : (
              <details className="basis-full text-small">
                <summary className="cursor-pointer select-none">Ver o fim de {item.nome}, como vai</summary>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono">
                  {item.trecho}
                </pre>
              </details>
            )}
          </li>
        ))}
      </ul>
      {previa.foraDoPacote.length === 0 ? null : (
        <div className="text-muted-foreground text-sm">
          <p>Ficam de fora:</p>
          <ul className="list-disc pl-5" aria-label="Arquivos fora do pacote">
            {previa.foraDoPacote.map((item) => (
              <li key={item.nome}>
                <span className="font-mono">{item.nome}</span>: {item.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-muted-foreground text-sm">
        O pacote é montado na hora de gerar: pode trazer registros feitos depois desta prévia, saneados do mesmo jeito.
      </p>
      <details className="text-small">
        <summary className="cursor-pointer select-none font-medium">Ver o conteúdo de sistema.json</summary>
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono">
          {previa.sistema}
        </pre>
      </details>
    </section>
  );
}

function Gerado({
  gerado,
  aoFalhar,
}: {
  readonly gerado: DiagnosticoGerado;
  readonly aoFalhar: (erro: MensagemErro) => void;
}) {
  const ponte = ponteDesktop();
  const nome = gerado.arquivo.split(/[\\/]/).at(-1) ?? gerado.arquivo;
  return (
    <Alert variant="success">
      <FileArchiveIcon />
      <AlertDescription>
        <p>
          Diagnóstico gerado: <span className="font-medium">{nome}</span> ({tamanhoArquivo(gerado.bytes)}). Anexe este
          arquivo ao e-mail ou ao relato do problema.
        </p>
        <p className="mt-1 select-all break-all font-mono text-micro">{gerado.arquivo}</p>
        {ponte?.mostrarArquivoTarefa === undefined ? null : (
          <div className="mt-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                ponte
                  .mostrarArquivoTarefa?.(gerado.arquivo)
                  .catch(() =>
                    aoFalhar({ texto: `Não foi possível mostrar ${nome} na pasta. Ele pode ter sido movido.` }),
                  )
              }
            >
              <FolderOpenIcon /> Mostrar na pasta
            </Button>
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function Diagnostico() {
  const api = useApi();
  const [previa, setPrevia] = useState<PreviaDiagnostico | null>(null);
  const [gerado, setGerado] = useState<DiagnosticoGerado | null>(null);
  const [ocupado, setOcupado] = useState<"previa" | "gerar" | null>(null);
  const [erro, setErro] = useState<MensagemErro | null>(null);

  const agir = useCallback(async (rotulo: "previa" | "gerar", acao: () => Promise<void>) => {
    setOcupado(rotulo);
    setErro(null);
    try {
      await acao();
    } catch (falha) {
      setErro(explicarErro(falha));
    } finally {
      setOcupado(null);
    }
  }, []);

  const verPrevia = () =>
    agir("previa", async () => setPrevia(await api.chamar((cliente) => cliente["diagnostico.preparar"]({}))));
  const gerar = () =>
    agir("gerar", async () => {
      setGerado(null);
      setGerado(await api.chamar((cliente) => cliente["diagnostico.gerar"]({})));
    });

  return (
    <section id={SECAO_DIAGNOSTICO} aria-labelledby="titulo-diagnostico" className="flex flex-col gap-3">
      <h2 id="titulo-diagnostico" className="text-title">
        Diagnóstico
      </h2>
      <p className="max-w-prose text-sm">
        Se algo não funcionou no app, gere um diagnóstico e anexe o arquivo ao relatar o problema. Ele reúne os
        registros do app e as versões em uso, para quem mantém o Simplifica IF encontrar a causa.
      </p>
      <p className="max-w-prose text-muted-foreground text-sm">
        Não vão no pacote: suas conversas, os arquivos que você anexou, as pastas das tarefas, seu perfil e suas senhas.
        Dos registros saem os nomes das pastas das tarefas e dos anexos, e-mails, o nome da sua pasta pessoal, chaves de
        acesso e números como CPF e telefone. O arquivo fica no seu computador e só sai dele se você o enviar.
      </p>
      {erro === null ? null : <AvisoErro erro={erro} icone semLinkDiagnostico />}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={ocupado !== null}
          aria-busy={ocupado === "previa"}
          onClick={verPrevia}
        >
          {ocupado === "previa" ? <Spinner /> : <ListIcon />} Ver o que vai no pacote
        </Button>
        <Button
          size="sm"
          disabled={ocupado !== null || previa === null || !previa.podeGerar}
          aria-busy={ocupado === "gerar"}
          onClick={gerar}
        >
          {ocupado === "gerar" ? <Spinner /> : <FileArchiveIcon />} Gerar diagnóstico
        </Button>
      </div>
      {previa === null ? (
        <p className="text-muted-foreground text-small">Veja o que vai no pacote antes de gerá-lo.</p>
      ) : (
        <Previa previa={previa} />
      )}
      {/* A região viva existe desde o começo (vazia), para o leitor de tela anunciar o que entra nela. */}
      <div role="status" aria-live="polite">
        {ocupado === "previa" ? <span className="sr-only">Preparando a prévia do pacote…</span> : null}
        {ocupado === "gerar" ? <span className="sr-only">Gerando o diagnóstico…</span> : null}
        {gerado === null ? null : <Gerado gerado={gerado} aoFalhar={setErro} />}
      </div>
    </section>
  );
}
