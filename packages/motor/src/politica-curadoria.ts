/**
 * O destino dos relatos de "Isto está errado" (M1.12), na política de fábrica, num módulo sem
 * dependências (como `politica-atualizacao.ts`): a interface e o servidor o leem.
 *
 * - `repositorio`: o `dono/repo` do GitHub onde a curadoria recebe os relatos como issue. O app não
 *   guarda token do GitHub: monta a página `issues/new` já preenchida e a abre no navegador do sistema,
 *   onde a pessoa revisa e envia com a própria conta. Fica `null` enquanto o repositório não é público
 *   (como o feed da atualização): o app oferece só "Salvar o relato" e "Copiar".
 * - `rotulos`: os rótulos da issue (o GitHub só os aplica se existirem no repositório e se quem envia
 *   puder rotular; senão, ignora).
 */
export const CURADORIA_FABRICA = {
  repositorio: null as string | null,
  rotulos: ["relato-do-app"] as ReadonlyArray<string>,
};
