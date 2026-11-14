"""`REVISAR_PPC_AGORA` na conversão DOCX: o mesmo instante que o relógio do TypeScript (`rodada.ts`).

Data sem hora é meia-noite local nos dois; data-hora com fuso é o instante dado, em hora local.
Os valores esperados são os mesmos de `orquestracao.test.ts` (describe `REVISAR_PPC_AGORA`).
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import pytest

SKILL_DIR = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = SKILL_DIR / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import converter_docx  # noqa: E402
from conversao_docx import markdown_writer  # noqa: E402


@pytest.fixture
def fuso(monkeypatch: pytest.MonkeyPatch):
    original = markdown_writer.datetime

    def fixar(nome: str) -> None:
        monkeypatch.setenv("TZ", nome)
        time.tzset()

    yield fixar
    markdown_writer.datetime = original
    monkeypatch.undo()
    time.tzset()


@pytest.mark.parametrize("nome", ["America/Sao_Paulo", "Asia/Tokyo"])
def test_data_sem_hora_e_meia_noite_local(fuso, nome: str) -> None:
    fuso(nome)
    converter_docx._fixar_relogio("2026-11-13")
    assert markdown_writer.datetime.now().isoformat() == "2026-11-13T00:00:00"


def test_data_hora_com_fuso_e_o_instante_dado(fuso) -> None:
    fuso("America/Sao_Paulo")
    converter_docx._fixar_relogio("2026-11-13T12:34:56Z")
    assert markdown_writer.datetime.now().strftime("%Y-%m-%dt%H-%M-%S") == "2026-11-13t09-34-56"


@pytest.mark.parametrize("valor", ["13/11/2026", "2026-02-30", "Nov 13 2026", "20261113"])
def test_valor_invalido_e_recusado(fuso, valor: str) -> None:
    fuso("America/Sao_Paulo")
    with pytest.raises(ValueError, match=f"REVISAR_PPC_AGORA inválida: {valor}"):
        converter_docx._fixar_relogio(valor)
