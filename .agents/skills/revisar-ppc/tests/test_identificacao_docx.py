"""Rótulos de identificação na conversão DOCX: só no início da célula ou do parágrafo.

Regressão do T1: "Base legal específica do curso: Resolução CNE/CP nº 1/2021"
virava nome do curso, e "Denominação do curso" (rótulo) virava "do curso".
"""

from __future__ import annotations

import sys
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = SKILL_DIR / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from conversao_docx.docx_reader import ParagraphElement, TableCell, TableElement, TextRun
from conversao_docx.identification_extractor import IdentificationExtractor
from conversao_docx.section_detector import Section, SectionDetector
from conversao_docx.table_extractor import NormalizedTable


def _tabela(linhas: list[list[str]]) -> NormalizedTable:
    return NormalizedTable(
        headers=[],
        rows=linhas,
        original_row_count=len(linhas),
        original_col_count=max(len(linha) for linha in linhas),
    )


def test_tabela_de_identificacao_ignora_rotulo_no_meio_da_celula() -> None:
    dados = IdentificationExtractor().extract_identification_data(
        _tabela(
            [
                ["Base legal específica do curso", "Resolução CNE/CP nº 1/2021"],
                ["Denominação do curso", "Curso Técnico em Enfermagem"],
                ["Observação", "O campus fica no centro; modalidade presencial."],
                ["Campus", "Curitiba"],
            ]
        )
    )
    assert "nome_curso" not in dados
    assert "modalidade_ensino" not in dados
    assert dados["denominacao_do_curso"] == "Curso Técnico em Enfermagem"
    assert dados["campus"] == "Curitiba"


def test_celula_unica_campo_valor_continua_extraida() -> None:
    dados = IdentificationExtractor().extract_identification_data(
        _tabela(
            [
                ["Nome do curso: Técnico em Química"],
                ["1.1.5 Modalidade: Presencial"],
                ["Forma de oferta: Integrado"],
                ["Eixo tecnológico: Produção Industrial"],
                ["Base legal específica do curso: Resolução CNE/CP nº 1/2021"],
            ]
        )
    )
    assert dados == {
        "nome_curso": "Técnico em Química",
        "modalidade_ensino": "Presencial",
        "forma_oferta": "Integrado",
        "eixo_tecnologico": "Produção Industrial",
    }


def _paragrafo(texto: str) -> ParagraphElement:
    return ParagraphElement(runs=[TextRun(texto)])


def test_dicas_da_secao_de_apresentacao_exigem_rotulo_no_inicio() -> None:
    secao = Section(
        number="1",
        title="Apresentação",
        level=1,
        elements=[
            _paragrafo("Base legal específica do curso: Resolução CNE/CP nº 1/2021"),
            _paragrafo("O campus oferta a modalidade presencial."),
            TableElement(
                rows=[
                    [TableCell("Coordenador do curso"), TableCell("Fulano de Tal")],
                    [TableCell("Denominação do curso"), TableCell("Curso Técnico em Enfermagem")],
                    [TableCell("Campus"), TableCell("Curitiba")],
                ]
            ),
            _paragrafo("Modalidade: Presencial"),
        ],
    )
    dados = SectionDetector()._extract_from_section(secao)
    assert dados["nome_curso"] == "Curso Técnico em Enfermagem"
    assert dados["campus"] == "Curitiba"
    assert dados["modalidade"] == "Presencial"
