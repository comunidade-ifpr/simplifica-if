/**
 * O leitor `ifpr://revisao/…` do módulo, que o `Leitor.tsx` do núcleo despacha (arquivo de composição).
 */
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert.tsx";
import { useApi } from "../../contexto.tsx";
import { useCarga } from "../../leitor/carga.ts";
import { Documento } from "../../leitor/Documento.tsx";
import { BotaoLink, Cabecalho, ComCarga, FaixaTrecho, Secao } from "../../leitor/pecas.tsx";

/**
 * O PPC que a pessoa está revisando (`ifpr://revisao/<lista>/<versão>#p-<chave>`): o texto convertido do
 * `.docx`, guardado na lista, rolado e destacado no trecho da pendência. Não é a base: não tem citação
 * nem ficha do curso, e o aviso lembra que a formatação do Word não aparece.
 */
export function LeitorRevisao({
  caminho,
  fragmento,
  aoAbrirLink,
}: {
  readonly caminho: string;
  readonly fragmento: string | null;
  readonly aoAbrirLink: (link: string) => void;
}) {
  const api = useApi();
  const lista = caminho.split("/")[0]!;
  const documento = useCarga(`revisao:${caminho}`, () => api.chamar((c) => c["revisaoPpc.documento"]({ lista })));
  const link = `ifpr://revisao/${caminho}`;
  return (
    <ComCarga carga={documento} titulo="Não foi possível ler o PPC revisado">
      {(doc) => {
        const atual = fragmento === null ? undefined : doc.ancoras.find((a) => a.id === fragmento);
        const secoes = doc.ancoras.filter((a) => a.tipo !== "pendencia");
        return (
          <article aria-label="PPC em revisão" className="leitor-impressao space-y-4">
            <Cabecalho
              tipo="PPC em revisão"
              titulo={doc.titulo}
              resumo={
                <p className="max-w-[68ch] in-[.painel-leitura]:max-w-none text-muted-foreground text-sm">
                  Texto convertido do seu arquivo: a formatação do Word (layout, imagens, numeração automática) não
                  aparece.
                </p>
              }
            />

            {secoes.length > 0 ? (
              <details className="nao-imprimir rounded-md border border-border p-2 text-sm">
                <summary className="cursor-pointer font-semibold">Seções ({secoes.length})</summary>
                <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
                  {secoes.map((s) => (
                    <li key={s.id}>
                      <BotaoLink link={`${link}#${s.id}`} aoAbrirLink={aoAbrirLink}>
                        {s.rotulo}
                      </BotaoLink>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            {fragmento !== null && atual === undefined ? (
              <Alert variant="warning">
                <AlertTitle>Trecho não encontrado no texto</AlertTitle>
                <AlertDescription>
                  Não achamos este trecho no texto convertido (ele pode estar numa caixa de texto ou ter mudado na
                  versão corrigida). Abaixo, o documento inteiro.
                </AlertDescription>
              </Alert>
            ) : atual !== undefined ? (
              <FaixaTrecho rotulo={atual.tipo === "pendencia" ? "o trecho apontado" : atual.rotulo} alvo={atual.id} />
            ) : null}

            <Secao titulo="Texto do PPC">
              <Documento
                documento={{ markdown: doc.markdown, ancoras: doc.ancoras, link }}
                alvo={atual === undefined ? null : atual.id}
                aoAbrirLink={aoAbrirLink}
                rotulo="Texto do PPC em revisão"
                realce={doc.trechos.find((t) => t.id === atual?.id)?.texto ?? null}
              />
            </Secao>
          </article>
        );
      }}
    </ComCarga>
  );
}
