// O pdfjs-dist não publica tipos para o módulo do worker; só o `WorkerMessageHandler` é usado.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
