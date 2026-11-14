/**
 * Import de texto do Bun (`import x from "./a.md" with { type: "text" }`): o conteúdo cru do arquivo,
 * embutido no bundle e no binário compilado. Sem o atributo, o Bun converte `.md` em HTML.
 * Com TypeScript 7.1 o `@types/bun` passa a tipar pelo atributo e esta declaração pode sair.
 */
declare module "*.md" {
  const texto: string;
  export default texto;
}
