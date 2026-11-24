/**
 * A entrada da interface: o tema, a origem da conexão (desktop ou navegador), a `Api` e o roteador.
 */
// A Hanken Grotesk, a fonte da interface, e a Source Serif 4, a voz do documento.
import "@fontsource-variable/hanken-grotesk";
import "@fontsource-variable/source-serif-4";
import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { origemDaPagina } from "./conexao/origem.ts";
import { instalarRegistroDeErros } from "./diagnostico.ts";
import { inicializar } from "./inicializar.ts";
import { criarRoteador } from "./router.ts";
import { acompanharSistema, aplicarTema, lerPreferencia } from "./tema.ts";

instalarRegistroDeErros();
aplicarTema(lerPreferencia());
acompanharSistema();

const { contexto } = await inicializar(origemDaPagina());
const roteador = criarRoteador();

createRoot(document.getElementById("raiz")!).render(
  <StrictMode>
    <App contexto={contexto} roteador={roteador} />
  </StrictMode>,
);
