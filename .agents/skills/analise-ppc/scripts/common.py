"""Caminhos e JSON da rodada para o que ainda é Python na analise-ppc.

A orquestração foi portada para TypeScript (`rodada.ts`, trilha T1 do
PLANO-ARQUITETURA.md). Este módulo mínimo atende só `gerar_relatorio_html.py`
e `analise_ppc.py` (subcomando `gerar-relatorio-html`), até a trilha T2.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

APP_DIR = Path(__file__).resolve().parents[1]
BASE_ANALISE_DIR = APP_DIR / "base-analise"
FICHAS_DIR = BASE_ANALISE_DIR / "fichas"
VALIDACOES_CRUZADAS_DIR = BASE_ANALISE_DIR / "validacoes-cruzadas"


def ensure_directory(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    ensure_directory(path.parent)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_fichas(fichas_dir: Path | None = None) -> list[dict[str, Any]]:
    diretorio = fichas_dir or FICHAS_DIR
    return [read_json(caminho) for caminho in sorted(diretorio.glob("*.json"))]


def round_paths(rodada_dir: Path) -> dict[str, Path]:
    """Mesmos caminhos de `caminhosRodada` em `rodada.ts`."""
    rodada_dir = rodada_dir.resolve()
    legacy_root_files = (
        rodada_dir / "PPC.md",
        rodada_dir / "metadata.json",
        rodada_dir / "manifesto-rodada.json",
    )
    suporte_dir = rodada_dir / "arquivos-suporte"
    base_dir = rodada_dir if not suporte_dir.exists() and any(path.exists() for path in legacy_root_files) else suporte_dir
    return {
        "rodada_dir": rodada_dir,
        "suporte_dir": base_dir,
        "ppc": base_dir / "PPC.md",
        "metadata": base_dir / "metadata.json",
        "resultados_subagents": base_dir / "resultados-subagents.json",
        "relatorio_html": rodada_dir / "relatorio-analise.html",
    }
