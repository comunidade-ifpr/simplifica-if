/// <reference types="vite-plus/client" />

interface ImportMetaEnv {
  /** Em desenvolvimento no navegador: o endereço do servidor local (`http://127.0.0.1:<porta>` ou a porta). */
  readonly VITE_SIMPLIFICA_SERVIDOR?: string;
  /** Em desenvolvimento no navegador: o token do servidor local. */
  readonly VITE_SIMPLIFICA_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
