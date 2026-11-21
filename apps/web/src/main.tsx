/**
 * A entrada da interface: o tema, a origem da conexão (desktop ou navegador), a `Api` e o roteador.
 */
// A Open Sans com os eixos de peso e de largura (o `text-display` estreita a 87,5 %), e a Source Serif 4,
// a voz do documento.
import "@fontsource-variable/open-sans/wdth.css";
import "@fontsource-variable/source-serif-4";
import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { origemDaPagina } from "./conexao/origem.ts";
import { inicializar } from "./inicializar.ts";
import { criarRoteador } from "./router.ts";
import { acompanharSistema, aplicarTema, lerPreferencia } from "./tema.ts";

aplicarTema(lerPreferencia());
acompanharSistema();

const { contexto } = await inicializar(origemDaPagina());
const roteador = criarRoteador();

createRoot(document.getElementById("raiz")!).render(
  <StrictMode>
    <App contexto={contexto} roteador={roteador} />
  </StrictMode>,
);
