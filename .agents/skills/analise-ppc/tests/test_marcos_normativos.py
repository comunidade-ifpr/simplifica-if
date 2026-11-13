from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

SKILL_DIR = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = SKILL_DIR / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from common import FICHAS_DIR, MARCOS_NORMATIVOS_PATH, read_json
from subagents import contexto_fundamentacao_normativa
from validar_base_analise import (
    _carregar_manifest_normas,
    _carregar_marcos,
    _norma_da_referencia,
    _validar_marcos_normativos,
    _validar_referencias_vigentes,
)

DCN_EPT_2026 = "Resolução CNE/CP nº 2/2026"

MANIFEST_SINTETICO = [
    {
        "title": "Resolução CNE/CP nº 1/2021",
        "tipo_documento": "Resolução",
        "numero": "1",
        "ano": 2021,
        "orgao": "CNE/CP",
        "aliases": ["Resolução CNE/CP nº 1/2021", "DCNEPT"],
        "status_vigencia": "revogada",
        "path": "normas/br/resolucoes/RESOLUCAO_CNE-CP_1-2021_dcnept.md",
    },
    {
        "title": "Resolução CNE/CP nº 2/2026",
        "tipo_documento": "Resolução",
        "numero": "2",
        "ano": 2026,
        "orgao": "CNE/CP",
        "aliases": ["DCNEPT 2026"],
        "status_vigencia": "vigente",
    },
    {
        "title": "Resolução CNE/CEB nº 3/2025",
        "tipo_documento": "Resolução",
        "numero": "3",
        "ano": 2025,
        "orgao": "CNE/CEB",
        "aliases": [],
        "status_vigencia": "parcialmente revogada",
    },
    {
        "title": "Resolução CONSUP/IFPR nº 64/2022",
        "tipo_documento": "Resolução",
        "numero": "64",
        "ano": 2022,
        "orgao": "CONSUP/IFPR",
        "aliases": [],
        "status_vigencia": "vigente",
    },
    {
        "title": "Lei nº 9.394/1996",
        "tipo_documento": "Lei",
        "numero": "9394",
        "ano": 1996,
        "orgao": "Presidência da República",
        "aliases": [],
        "status_vigencia": "vigente",
    },
]

MARCOS_SINTETICOS = [
    {
        "id": "dcn_ept",
        "substitui": ["Resolução CNE/CP nº 1/2021", "Resolução CNE/CP nº 1/2022"],
        "antecessoras_historicas": ["Resolução CNE/CEB nº 6/2012"],
        "dispositivos_revogados": ["Resolução CNE/CEB nº 3/2025, art. 6º, III"],
    }
]


def _fichas() -> dict[str, dict]:
    return {ficha["id"]: ficha for ficha in (read_json(path) for path in sorted(FICHAS_DIR.glob("ct-*.json")))}


def _texto(ficha: dict) -> str:
    return " ".join(
        str(ficha.get(campo, "")) for campo in ("pergunta", "rubrica", "boa_evidencia", "ma_evidencia", "escalonar_quando")
    )


@pytest.mark.parametrize(
    ("referencia", "titulo"),
    [
        ("Resolução CNE/CP nº 1/2021, art. 53", "Resolução CNE/CP nº 1/2021"),
        ("Res. CNE/CP n° 1/2021", "Resolução CNE/CP nº 1/2021"),
        ("Resolução CNE/CP nº 1, de 5 de janeiro de 2021", "Resolução CNE/CP nº 1/2021"),
        ("RESOLUÇÃO CNE/CP 01/2021, art. 3º", "Resolução CNE/CP nº 1/2021"),
        ("Resolução IFPR 64/2022", "Resolução CONSUP/IFPR nº 64/2022"),
        ("Resolução Consup/IFPR nº 64/2022, art. 16", "Resolução CONSUP/IFPR nº 64/2022"),
        ("Lei 9.394/1996", "Lei nº 9.394/1996"),
        ("DCNEPT 2026", DCN_EPT_2026),
    ],
)
def test_referencia_casa_variantes_de_grafia(referencia: str, titulo: str) -> None:
    norma = _norma_da_referencia(referencia, MANIFEST_SINTETICO)
    assert norma is not None and norma["title"] == titulo


@pytest.mark.parametrize(
    "referencia",
    [
        "Resolução CNE/CP nº 1/20210",
        "Resolução CNE/CEB nº 1/2021",  # mesmo número e ano, outro órgão
        "DCNEPT",  # sigla sem número é ambígua entre versões
        "DCNEPT/2026",
        "CNCT",
    ],
)
def test_referencia_nao_casa_falsos_positivos(referencia: str) -> None:
    norma = _norma_da_referencia(referencia, MANIFEST_SINTETICO)
    assert norma is None or norma["title"] != "Resolução CNE/CP nº 1/2021"


def test_validador_aponta_norma_revogada_substituida_e_dispositivo_revogado() -> None:
    fichas = {
        "CT-X-01": {"referencias_normativas": ["Res. CNE/CP n° 1/2021, art. 20"]},
        "CT-X-02": {"referencias_normativas": [f"{DCN_EPT_2026}, art. 29", "Resolução CNE/CEB nº 3/2025, art. 5º"]},
        "CT-X-03": {"referencias_normativas": ["Resolução CNE/CP nº 1/2022"]},
        "CT-X-04": {"referencias_normativas": ["Resolução CNE/CEB nº 3/2025, art. 6º, III"]},
        "CT-X-05": {"referencias_normativas": ["Resolução CNE/CEB nº 6/2012"]},
    }

    erros = _validar_referencias_vigentes(fichas, MANIFEST_SINTETICO, MARCOS_SINTETICOS)
    por_ficha = {erro.split(":", 1)[0] for erro in erros}

    assert por_ficha == {"CT-X-01", "CT-X-03", "CT-X-04", "CT-X-05"}
    assert any("RESOLUCAO_CNE-CP_1-2021_dcnept.md" in erro for erro in erros if erro.startswith("CT-X-01"))
    assert any("substituída no marco dcn_ept" in erro for erro in erros if erro.startswith("CT-X-03"))
    assert any("dispositivo revogado" in erro for erro in erros if erro.startswith("CT-X-04"))


def _marco_valido(**sobrescritas) -> dict:
    marco = {
        "id": "dcn_ept",
        "tema": "DCN da EPT",
        "vigente": DCN_EPT_2026,
        "aplica_a": "Cursos técnicos.",
        "substitui": ["Resolução CNE/CP nº 1/2021"],
        "antecessoras_historicas": [],
        "dispositivos_revogados": [],
        "fichas_responsaveis": ["CT-SUP-12"],
        "fichas_base_legal": ["CT-SUP-12"],
        "transicao": "",
        "orientacao_analise": "Teste.",
    }
    marco.update(sobrescritas)
    return marco


def _gravar_marcos(tmp_path: Path, *marcos: dict) -> Path:
    path = tmp_path / "marcos.json"
    path.write_text(json.dumps({"versao": 2, "descricao": "teste", "marcos": list(marcos)}, ensure_ascii=False), encoding="utf-8")
    return path


def test_validador_aceita_marco_valido(tmp_path: Path) -> None:
    path = _gravar_marcos(tmp_path, _marco_valido())
    assert _validar_marcos_normativos(MANIFEST_SINTETICO, path, {"CT-SUP-12": {}}) == []


def test_validador_aponta_marco_inconsistente(tmp_path: Path) -> None:
    path = _gravar_marcos(
        tmp_path,
        _marco_valido(
            vigente="Resolução CNE/CP nº 1/2021",
            substitui=[DCN_EPT_2026],
            fichas_base_legal=["CT-INEXISTENTE"],
        ),
    )

    erros = _validar_marcos_normativos(MANIFEST_SINTETICO, path, {"CT-SUP-12": {}})

    assert any("norma marcada como vigente está revogada" in erro for erro in erros)
    assert any("norma listada como substituída está vigente" in erro for erro in erros)
    assert any("ficha desconhecida: CT-INEXISTENTE" in erro for erro in erros)


def test_validador_exige_schema_do_marco(tmp_path: Path) -> None:
    marco = _marco_valido()
    del marco["fichas_responsaveis"]
    erros = _validar_marcos_normativos(MANIFEST_SINTETICO, _gravar_marcos(tmp_path, marco))
    assert any("campo obrigatório ausente: fichas_responsaveis" in erro for erro in erros)


def test_base_real_nao_cita_norma_revogada_e_registro_aponta_dcn_ept_2026() -> None:
    manifest = _carregar_manifest_normas()
    fichas = _fichas()
    assert manifest
    assert _validar_referencias_vigentes(fichas, manifest, _carregar_marcos()) == []
    assert _validar_marcos_normativos(manifest, fichas_por_id=fichas) == []

    marcos = {marco["id"]: marco for marco in read_json(MARCOS_NORMATIVOS_PATH)["marcos"]}
    dcn_ept = marcos["dcn_ept"]
    assert dcn_ept["vigente"] == DCN_EPT_2026
    assert {
        "Resolução CNE/CP nº 1/2021",
        "Resolução CNE/CEB nº 1/2014",
        "Resolução CNE/CP nº 1/2022",
        "Resolução CNE/CP nº 3/2022",
    } <= set(dcn_ept["substitui"])
    assert "art. 70" in dcn_ept["transicao"]
    assert "têm assegurado o direito de concluir" in dcn_ept["transicao"]
    assert dcn_ept["fichas_responsaveis"] == ["CT-SUP-12"]


def test_contexto_normativo_dos_subagentes_inclui_marcos() -> None:
    contexto = contexto_fundamentacao_normativa()
    ids = {marco["id"] for marco in contexto["marcos_normativos"]}
    assert {"dcn_ept", "dcnem", "eja"} <= ids


def test_fichas_aplicam_regras_materiais_da_dcn_ept_2026() -> None:
    fichas = _fichas()

    curr_02 = _texto(fichas["CT-CURR-02"])
    assert "3.000 horas" in curr_02
    assert "art. 37, § 3º" in curr_02
    assert "até 300 horas" in curr_02 and "art. 30 e parágrafo único" in curr_02
    assert "300 horas" in _texto(fichas["CT-CURR-03"])
    assert "2.100 horas" in _texto(fichas["CT-CURR-03"])
    assert "um terço da carga horária mínima" in _texto(fichas["CT-CURR-20"])
    assert "dois anos" in _texto(fichas["CT-IDENT-18"])
    assert "prática profissional supervisionada" in _texto(fichas["CT-CURR-19"])
    assert "itinerário formativo profissional é obrigatória" in _texto(fichas["CT-CURR-17"])
    assert "art. 42, II, dispensa" in _texto(fichas["CT-CURR-15"])
    assert "art. 69" in _texto(fichas["CT-IDENT-02"])


def test_ficha_formato_de_oferta_separa_bases_de_calculo() -> None:
    formato = _fichas()["CT-CURR-27"]
    texto = _texto(formato)

    assert "exclusivamente atividades presenciais" in texto
    assert "30% da carga horária mínima do curso no CNCT" in texto
    assert "70% da carga horária total" in texto
    assert "5% da carga horária total" in texto
    assert "190/2024, art. 5º" in texto
    assert "art. 53, § 7º" in texto
    assert {"identificacao_oferta", "matriz_curricular"} == set(formato["topicos_tematicos"])


def test_fichas_de_base_legal_tratam_dcnept_2021_como_revogada() -> None:
    fichas = _fichas()
    for ficha_id in ("CT-IDENT-05", "CT-IDENT-08", "CT-SUP-09", "CT-SUP-12", "CT-SUP-14"):
        ficha = fichas[ficha_id]
        assert any(ref.startswith(DCN_EPT_2026) for ref in ficha["referencias_normativas"]), ficha_id
        assert "DCNEPT 2021" not in _texto(ficha), ficha_id
    assert fichas["CT-SUP-12"]["criticidade"] == "OBRIG"
