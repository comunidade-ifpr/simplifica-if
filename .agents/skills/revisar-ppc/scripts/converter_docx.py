"""Converte um PPC .docx nos artefatos estruturados (Markdown, dados, matriz, ementário).

Exceção Python temporária (trilha T3 do PLANO-ARQUITETURA.md): o `preparar-documento`
em TypeScript chama este script por subprocesso só para a conversão DOCX, que ainda
depende de `python-docx`. Imprime em stdout um JSON com os caminhos dos artefatos.

Uso: python3 converter_docx.py <arquivo.docx> <diretorio-de-saida>
"""

from __future__ import annotations

import contextlib
import json
import os
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from conversao_docx import ConversionService  # noqa: E402


# Formato aceito em `REVISAR_PPC_AGORA`, o mesmo de `RE_AGORA` em `rodada.ts`.
_RE_AGORA = re.compile(r"\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?)?")


def _fixar_relogio(instante: str) -> None:
    """Fixa o `data_conversao` dos dados extraídos (como `REVISAR_PPC_AGORA` no TypeScript).

    Data sem hora é meia-noite local, e data-hora sem fuso é hora local, como em `rodada.ts`;
    fora de `_RE_AGORA`, o valor é recusado.
    """
    import datetime as dt

    from conversao_docx import markdown_writer

    if not _RE_AGORA.fullmatch(instante):
        raise ValueError(f"REVISAR_PPC_AGORA inválida: {instante}")
    try:
        fixo = dt.datetime.fromisoformat(instante.replace("Z", "+00:00")).astimezone().replace(tzinfo=None)
    except ValueError as erro:
        raise ValueError(f"REVISAR_PPC_AGORA inválida: {instante}") from erro

    class Relogio(dt.datetime):
        @classmethod
        def now(cls, tz=None):  # type: ignore[override]
            return fixo if tz is None else fixo.astimezone(tz)

    markdown_writer.datetime = Relogio  # type: ignore[misc]


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("Uso: converter_docx.py <arquivo.docx> <diretorio-de-saida>", file=sys.stderr)
        return 2
    arquivo, saida = Path(argv[0]), Path(argv[1])
    saida.mkdir(parents=True, exist_ok=True)
    if os.environ.get("REVISAR_PPC_AGORA"):
        _fixar_relogio(os.environ["REVISAR_PPC_AGORA"])
    # Avisos da conversão vão para stderr: stdout leva só o JSON de resposta.
    with contextlib.redirect_stdout(sys.stderr):
        artefatos = ConversionService().convert(arquivo_docx=arquivo, output_dir=saida, verbose=False)
    caminhos = {
        "output_dir": artefatos.output_dir,
        "markdown": artefatos.markdown,
        "markdown_bruto": artefatos.markdown_bruto,
        "dados": artefatos.dados,
        "matriz_curricular": artefatos.matriz_curricular,
        "ementario": artefatos.ementario,
    }
    print(json.dumps({chave: str(valor) if valor else None for chave, valor in caminhos.items()}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
