"""Testes do que ainda é Python na analise-ppc: relatório HTML e publicação no Surge.

A orquestração (preparar-documento, grupos, prompts, mescla e validar-resultados)
foi portada para TypeScript e é testada em `orquestracao.test.ts`. Aqui a rodada é
criada pelo próprio entrypoint TypeScript, como no fluxo real (cadeia mista).
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

SKILL_DIR = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = SKILL_DIR / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from gerar_relatorio_html import (
    ErroResultadosSubagents,
    _resolver_anchor_evidencia,
    gerar_blocos_ppc,
    gerar_relatorio_html,
)
from analise_ppc import main as analise_ppc_main
from publicar_surge import dominio_surge_padrao, preparar_site_surge, publicar_site_surge
from common import FICHAS_DIR, VALIDACOES_CRUZADAS_DIR, read_json, round_paths, write_json


def _markdown_base() -> str:
    return """# Curso Técnico em Informática

Curso: Curso Técnico em Informática
Campus: Assis Chateaubriand
Modalidade: Integrado

## 1. Apresentação

O curso apresenta objetivos, perfil do egresso e justificativa institucional.
"""


def _criar_rodada(tmp_path: Path) -> Path:
    """Cria a rodada pelo `preparar-documento` do entrypoint TypeScript."""
    arquivo_md = tmp_path / "PPC.md"
    arquivo_md.write_text(_markdown_base(), encoding="utf-8")
    saida = tmp_path / "output"
    subprocess.run(
        ["bun", "run", str(SCRIPTS_DIR / "analise_ppc.ts"), "preparar-documento", str(arquivo_md), "--saida-base", str(saida)],
        check=True,
        capture_output=True,
    )
    (rodada_dir,) = list(saida.iterdir())
    return rodada_dir


def _fichas_ordenadas() -> list[dict[str, object]]:
    fichas = [read_json(caminho) for caminho in sorted(FICHAS_DIR.glob("*.json"))]
    return sorted(fichas, key=lambda ficha: str(ficha.get("id", "")))


def _primeira_validacao_cruzada() -> str:
    return sorted(str(read_json(caminho)["id"]) for caminho in VALIDACOES_CRUZADAS_DIR.glob("*.json"))[0]




def _resultado(ficha_id: str, estado: str = "ATENDE", evidencias: int = 3) -> dict[str, object]:
    return {
        "ficha_id": ficha_id,
        "estado": estado,
        "confianca": 0.9,
        "justificativa": f"Justificativa da ficha {ficha_id}.",
        "evidencias": [f"Evidência {indice} de {ficha_id}" for indice in range(1, evidencias + 1)],
        "lacunas": [],
        "revisao_humana_obrigatoria": False,
    }

def _payload_resultados_completos() -> dict[str, object]:
    fichas = _fichas_ordenadas()
    grupos = []
    for indice in range(0, len(fichas), 20):
        grupos.append(
            {
                "grupo_id": f"grupo-{indice // 20 + 1:03d}",
                "resultados": [
                    _resultado(ficha["id"], evidencias=int(ficha.get("evidencia_minima", 3)))
                    for ficha in fichas[indice : indice + 20]
                ],
            }
        )
    return {
        "metadata": {"origem": "teste"},
        "grupos": grupos,
    }

def test_gerar_blocos_ppc_cria_ids_estaveis_por_bloco() -> None:
    blocos = gerar_blocos_ppc(_markdown_base())

    assert [bloco.id for bloco in blocos[:3]] == ["ppc-b00001", "ppc-b00002", "ppc-b00003"]
    assert blocos[0].kind == "heading"
    assert blocos[0].text == "Curso Técnico em Informática"
    assert any("objetivos" in bloco.text for bloco in blocos)

def test_gerar_blocos_ppc_preserva_br_html_como_quebra_de_linha() -> None:
    blocos = gerar_blocos_ppc(
        """## Ementário

| Campo |
|---|
| Linha 1<br>Linha 2 |
"""
    )

    html_tabela = next(bloco.html for bloco in blocos if bloco.kind == "table")
    assert "Linha 1<br>Linha 2" in html_tabela
    assert "&lt;br&gt;" not in html_tabela

def test_gerar_relatorio_html_aceita_resultados_validos(tmp_path: Path) -> None:
    rodada_dir = _criar_rodada(tmp_path)
    caminhos = round_paths(rodada_dir)
    resultados_path = caminhos["suporte_dir"] / "resultados-subagents.json"
    write_json(resultados_path, _payload_resultados_completos())

    payload = gerar_relatorio_html(rodada_dir, Path("resultados-subagents.json"))

    assert payload["relatorio_html"] == caminhos["relatorio_html"]
    assert payload["total_fichas"] == len(list(FICHAS_DIR.glob("*.json")))
    assert payload["total_alertas_transversais"] == 0
    html = caminhos["relatorio_html"].read_text(encoding="utf-8")
    assert "PPC anotado" in html
    assert "Curso Técnico em Informática" in html
    assert "CT-IDENT-01" in html
    assert 'id="filtro-busca"' in html
    assert 'id="filtro-modo"' in html

def test_gerar_relatorio_html_ordena_margem_pela_posicao_no_ppc(tmp_path: Path) -> None:
    rodada_dir = _criar_rodada(tmp_path)
    caminhos = round_paths(rodada_dir)
    payload = _payload_resultados_completos()

    def ancorar(ficha_id: str, block_id: str, quote: str, secao: str) -> None:
        for grupo in payload["grupos"]:
            for resultado in grupo["resultados"]:
                if resultado["ficha_id"] != ficha_id:
                    continue
                total = max(3, len(resultado["evidencias"]))
                resultado["evidencias"] = [
                    {
                        "trecho": quote,
                        "secao": secao,
                        "fonte": "PPC.md",
                        "anchor": {"block_id": block_id, "quote": quote},
                    }
                    for _ in range(total)
                ]
                return
        raise AssertionError(f"Ficha não encontrada no payload de teste: {ficha_id}")

    ancorar("CT-CURR-01", "ppc-b00004", "O curso apresenta objetivos", "Apresentação")
    ancorar("CT-IDENT-01", "ppc-b00002", "Curso: Curso Técnico em Informática", "Identificação")
    write_json(caminhos["suporte_dir"] / "resultados-subagents.json", payload)

    gerar_relatorio_html(rodada_dir, Path("resultados-subagents.json"))

    html = caminhos["relatorio_html"].read_text(encoding="utf-8")
    margem = html.index('<aside class="review-margin"')
    pos_ident = html.index('<p class="annotation-kicker">CT-IDENT-01', margem)
    pos_curr = html.index('<p class="annotation-kicker">CT-CURR-01', margem)
    assert pos_ident < pos_curr
    assert 'id="ann-001"' in html[:pos_curr]
    assert 'href="#ann-001"' in html

def test_publicar_site_surge_chama_cli_com_pasta_e_dominio(tmp_path: Path) -> None:
    relatorio = tmp_path / "relatorio.html"
    relatorio.write_text("<!doctype html><html><body><script>ok()</script></body></html>", encoding="utf-8")
    site_dir = preparar_site_surge(relatorio, tmp_path / "surge-site")
    args_path = tmp_path / "args.json"
    fake = tmp_path / "surge-fake.py"
    fake.write_text(
        "\n".join(
            [
                "#!/usr/bin/env python3",
                "import json, sys",
                f"open({str(args_path)!r}, 'w').write(json.dumps(sys.argv[1:]))",
                "print('Success - Published to analise-ppc-teste.surge.sh')",
            ]
        ),
        encoding="utf-8",
    )
    fake.chmod(0o755)

    payload = publicar_site_surge(
        site_dir,
        dominio="analise-ppc-teste.surge.sh",
        comando=[str(fake)],
    )

    assert payload["public_url"] == "https://analise-ppc-teste.surge.sh"
    assert payload["domain"] == "analise-ppc-teste.surge.sh"
    assert "<script>ok()</script>" in (site_dir / "index.html").read_text(encoding="utf-8")
    args = json.loads(args_path.read_text(encoding="utf-8"))
    assert args == [str(site_dir.resolve()), "analise-ppc-teste.surge.sh"]

def test_dominio_surge_padrao_usa_nome_da_rodada() -> None:
    dominio = dominio_surge_padrao(Path("/tmp/2026-06-29t10-00-00-ppc-tecnico-em-informatica---quedas"))

    assert dominio == "analise-ppc-2026-06-29t10-00-00-ppc-tecnico-em-informatica.surge.sh"

def test_cli_gerar_relatorio_html_publica_surge_por_padrao(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    rodada_dir = _criar_rodada(tmp_path)
    caminhos = round_paths(rodada_dir)
    write_json(caminhos["suporte_dir"] / "resultados-subagents.json", _payload_resultados_completos())
    fake = tmp_path / "surge-fake.py"
    fake.write_text(
        "\n".join(
            [
                "#!/usr/bin/env python3",
                "print('Success - Published')",
            ]
        ),
        encoding="utf-8",
    )
    fake.chmod(0o755)
    monkeypatch.setenv("ANALISE_PPC_SURGE_CMD", str(fake))

    assert (
        analise_ppc_main(
            [
                "gerar-relatorio-html",
                "--rodada-dir",
                str(rodada_dir),
                "--surge-domain",
                "relatorio-ppc.surge.sh",
            ]
        )
        == 0
    )

    saida = json.loads(capsys.readouterr().out)
    assert saida["publicacao_servico"] == "surge"
    assert saida["surge_url"] == "https://relatorio-ppc.surge.sh"
    assert saida["mensagem"] == "Relatório pronto: https://relatorio-ppc.surge.sh"
    assert caminhos["relatorio_html"].exists()
    surge_index = caminhos["suporte_dir"] / "surge-site" / "index.html"
    assert surge_index.exists()
    assert "<script" in surge_index.read_text(encoding="utf-8").casefold()
    assert (caminhos["suporte_dir"] / "surge-site" / "assets" / "analise-ppc.css").exists()
    assert (caminhos["suporte_dir"] / "surge-site" / "assets" / "analise-ppc.js").exists()
    publicacao = read_json(caminhos["suporte_dir"] / "surge-publicacao.json")
    assert publicacao["domain"] == "relatorio-ppc.surge.sh"
    assert publicacao["site_dir"] == str((caminhos["suporte_dir"] / "surge-site").resolve())
    assert publicacao["relatorio_html_original"] == str(caminhos["relatorio_html"].resolve())

def test_gerar_relatorio_html_renderiza_fundamentacao_normativa(tmp_path: Path) -> None:
    rodada_dir = _criar_rodada(tmp_path)
    caminhos = round_paths(rodada_dir)
    payload = _payload_resultados_completos()
    primeiro = payload["grupos"][0]["resultados"][0]
    primeiro["fundamentacao_normativa"] = [
        {
            "status": "CONFIRMADA_COM_RESSALVA",
            "trecho_ppc": "O PPC afirma atendimento à Resolução CNE/CP nº 1/2021.",
            "norma": "Resolução CNE/CP nº 1/2021",
            "fonte": "base-conhecimento/normas/br/resolucoes/RESOLUCAO_CNE-CP_1-2021_dcnept.md",
            "dispositivo": "Diretrizes gerais da EPT",
            "evidencia": "A norma trata das DCN gerais para a Educação Profissional e Tecnológica.",
            "analise": "A citação é pertinente, mas precisa indicar o alcance específico usado pelo PPC.",
            "recomendacao": "Explicitar quais diretrizes orientam a organização curricular.",
        }
    ]
    write_json(caminhos["suporte_dir"] / "resultados-subagents.json", payload)

    gerar_relatorio_html(rodada_dir, Path("resultados-subagents.json"))

    html = caminhos["relatorio_html"].read_text(encoding="utf-8")
    assert "Fundamentação normativa verificada" in html
    assert 'class="normative-section normative-confirmada-com-ressalva"' in html
    assert "CONFIRMADA_COM_RESSALVA" in html
    assert "RESOLUCAO_CNE-CP_1-2021_dcnept.md" in html

def test_gerar_relatorio_html_renderiza_evidencia_estruturada(tmp_path: Path) -> None:
    rodada_dir = _criar_rodada(tmp_path)
    caminhos = round_paths(rodada_dir)
    payload = _payload_resultados_completos()
    payload["grupos"][0]["resultados"][0]["evidencias"] = [
        {
            "trecho": "O PPC identifica o curso como Técnico em Informática.",
            "secao": "1",
            "localizador": "Quadro de identificação",
            "fonte": "PPC.md",
            "artefato": "",
        },
        {
            "trecho": "A modalidade é integrada.",
            "secao": "1",
            "localizador": "Identificação",
            "fonte": "PPC.md",
            "artefato": "",
        },
    ]
    write_json(caminhos["suporte_dir"] / "resultados-subagents.json", payload)

    gerar_relatorio_html(rodada_dir, Path("resultados-subagents.json"))

    html = caminhos["relatorio_html"].read_text(encoding="utf-8")
    assert "O PPC identifica o curso como Técnico em Informática." in html
    assert "Seção:</strong> 1" in html
    assert "Localizador:" not in html
    assert "Fonte:</strong> PPC.md" not in html
    assert "Artefato:" not in html

def test_resolver_anchor_por_titulo_de_secao_sem_depender_de_numeracao() -> None:
    blocos = gerar_blocos_ppc(
        """# Curso

## 7.2 Acompanhamento do Egresso

O PPC prevê pesquisas com egressos e uso dos resultados na avaliação do curso.

## 7.3 Registro Profissional

O PPC trata o registro junto ao conselho profissional.
"""
    )

    anchor_id, quote = _resolver_anchor_evidencia(
        {
            "trecho": "pesquisas com egressos",
            "secao": "Acompanhamento do Egresso",
            "fonte": "PPC.md",
        },
        blocos,
    )

    bloco = next(bloco for bloco in blocos if bloco.id == anchor_id)
    assert bloco.kind == "paragraph"
    assert "pesquisas com egressos" in bloco.text
    assert quote == "pesquisas com egressos"

def test_gerar_relatorio_html_usa_assets_externos_e_ppc_anotado(tmp_path: Path) -> None:
    rodada_dir = _criar_rodada(tmp_path)
    caminhos = round_paths(rodada_dir)
    payload = _payload_resultados_completos()
    primeiro = payload["grupos"][0]["resultados"][0]
    primeiro["estado"] = "NAO_ATENDE"
    primeiro["revisao_humana_obrigatoria"] = True
    primeiro["lacunas"] = ["Falta detalhar a aderência da identificação."]
    primeiro["evidencias"] = [
        {
            "trecho": "Curso: Curso Técnico em Informática",
            "secao": "Identificação",
            "localizador": "Cabeçalho",
            "fonte": "PPC.md",
            "artefato": "",
            "anchor": {
                "block_id": "ppc-b00002",
                "quote": "Curso: Curso Técnico em Informática",
            },
        },
        {
            "trecho": "O curso apresenta objetivos",
            "secao": "Apresentação",
            "localizador": "Corpo da seção",
            "fonte": "PPC.md",
            "artefato": "",
            "anchor": {
                "block_id": "ppc-b00004",
                "quote": "O curso apresenta objetivos",
            },
        },
        {
            "trecho": "Campus: Assis Chateaubriand",
            "secao": "Identificação",
            "localizador": "Cabeçalho",
            "fonte": "PPC.md",
            "artefato": "",
            "anchor": {
                "block_id": "ppc-b00002",
                "quote": "Campus: Assis Chateaubriand",
            },
        },
    ]
    write_json(caminhos["suporte_dir"] / "resultados-subagents.json", payload)

    gerar_relatorio_html(rodada_dir, Path("resultados-subagents.json"))

    html = caminhos["relatorio_html"].read_text(encoding="utf-8")
    assert '<link rel="stylesheet" href="assets/analise-ppc.css">' in html
    assert '<script src="assets/analise-ppc.js" defer></script>' in html
    assert "<style>" not in html
    assert "PPC anotado" in html
    assert "Achados detalhados por ficha" not in html
    assert 'id="achados-detalhados"' not in html
    assert 'id="ppc-b00002"' in html
    assert 'class="evidence-link evidence-state-nao-atende" href="#ann-001" data-evidence-ref="ann-001"' in html
    assert '<span class="evidence-ref" aria-hidden="true">CT-CURR-01</span>' in html
    assert 'title="Evidência de CT-CURR-01:' in html
    assert "Curso: Curso Técnico em Informática" in html
    assert 'href="#ann-001"' in html
    assert 'href="#ppc-b00002"' in html
    assert 'href="#ppc-b00004"' in html
    assert "Ir para seção" in html
    assert "Ver no PPC" not in html
    assert '\n          <section id="ppc-b00002"' in html
    assert '></section><section id=' not in html
    assert max(len(linha) for linha in html.splitlines()) < 260
    assert (rodada_dir / "assets" / "analise-ppc.css").exists()
    assert (rodada_dir / "assets" / "analise-ppc.js").exists()

def test_gerar_relatorio_html_rejeita_ficha_duplicada(tmp_path: Path) -> None:
    rodada_dir = _criar_rodada(tmp_path)
    caminhos = round_paths(rodada_dir)
    payload = _payload_resultados_completos()
    primeiro = payload["grupos"][0]["resultados"][0]
    payload["grupos"][1]["resultados"][0] = dict(primeiro)
    write_json(caminhos["suporte_dir"] / "resultados-subagents.json", payload)

    with pytest.raises(ErroResultadosSubagents, match="duplicadas"):
        gerar_relatorio_html(rodada_dir, Path("resultados-subagents.json"))

def test_gerar_relatorio_html_rejeita_ficha_desconhecida(tmp_path: Path) -> None:
    rodada_dir = _criar_rodada(tmp_path)
    caminhos = round_paths(rodada_dir)
    payload = _payload_resultados_completos()
    payload["grupos"][0]["resultados"][0]["ficha_id"] = "CT-NAO-EXISTE"
    write_json(caminhos["suporte_dir"] / "resultados-subagents.json", payload)

    with pytest.raises(ErroResultadosSubagents, match="desconhecidas"):
        gerar_relatorio_html(rodada_dir, Path("resultados-subagents.json"))

def test_gerar_relatorio_html_rejeita_ficha_faltante(tmp_path: Path) -> None:
    rodada_dir = _criar_rodada(tmp_path)
    caminhos = round_paths(rodada_dir)
    payload = _payload_resultados_completos()
    payload["grupos"][0]["resultados"].pop()
    write_json(caminhos["suporte_dir"] / "resultados-subagents.json", payload)

    with pytest.raises(ErroResultadosSubagents, match="sem resultado"):
        gerar_relatorio_html(rodada_dir, Path("resultados-subagents.json"))

def test_gerar_relatorio_html_rejeita_evidencias_abaixo_do_minimo(tmp_path: Path) -> None:
    rodada_dir = _criar_rodada(tmp_path)
    caminhos = round_paths(rodada_dir)
    payload = _payload_resultados_completos()
    payload["grupos"][0]["resultados"][0]["evidencias"] = []
    write_json(caminhos["suporte_dir"] / "resultados-subagents.json", payload)

    with pytest.raises(ErroResultadosSubagents, match="mínimo exigido"):
        gerar_relatorio_html(rodada_dir, Path("resultados-subagents.json"))

def test_gerar_relatorio_html_renderiza_alertas_transversais(tmp_path: Path) -> None:
    rodada_dir = _criar_rodada(tmp_path)
    caminhos = round_paths(rodada_dir)
    payload = _payload_resultados_completos()
    payload["alertas_transversais"] = [
        {
            "id": "ALERTA-001",
            "validacao_id": _primeira_validacao_cruzada(),
            "titulo": "Inconsistência transversal",
            "criticidade": "OBRIG",
            "descricao": "Perfil e matriz precisam de revisão conjunta.",
            "fichas_relacionadas": ["CT-IDENT-01"],
            "evidencias": ["Evidência transversal"],
            "revisao_humana_obrigatoria": True,
        }
    ]
    write_json(caminhos["suporte_dir"] / "resultados-subagents.json", payload)

    relatorio = gerar_relatorio_html(rodada_dir, Path("resultados-subagents.json"))

    assert relatorio["total_alertas_transversais"] == 1
    html = caminhos["relatorio_html"].read_text(encoding="utf-8")
    assert "Alertas transversais" in html
    assert "ALERTA-001" in html
    assert "Validação cruzada" in html
    assert 'id="alertas"' not in html
    assert "transversal-notes" in html

def test_gerar_relatorio_html_renderiza_alerta_transversal_com_multiplas_ancoras(tmp_path: Path) -> None:
    rodada_dir = _criar_rodada(tmp_path)
    caminhos = round_paths(rodada_dir)
    payload = _payload_resultados_completos()
    payload["alertas_transversais"] = [
        {
            "id": "ALERTA-001",
            "validacao_id": _primeira_validacao_cruzada(),
            "titulo": "Divergência entre identificação e apresentação",
            "criticidade": "OBRIG",
            "descricao": "Dois pontos do PPC precisam ser lidos em conjunto.",
            "fichas_relacionadas": ["CT-IDENT-01"],
            "evidencias": [
                {
                    "secao": "Capa",
                    "trecho": "Curso: Curso Técnico em Informática",
                    "papel": "ponto_de_conflito",
                    "fonte": "PPC.md",
                    "anchor": {
                        "block_id": "ppc-b00002",
                        "quote": "Curso: Curso Técnico em Informática",
                    },
                },
                {
                    "secao": "Apresentação",
                    "trecho": "O curso apresenta objetivos",
                    "papel": "ponto_de_conflito",
                    "fonte": "PPC.md",
                    "anchor": {
                        "block_id": "ppc-b00004",
                        "quote": "O curso apresenta objetivos",
                    },
                },
            ],
            "revisao_humana_obrigatoria": True,
        }
    ]
    write_json(caminhos["suporte_dir"] / "resultados-subagents.json", payload)

    gerar_relatorio_html(rodada_dir, Path("resultados-subagents.json"))

    html = caminhos["relatorio_html"].read_text(encoding="utf-8")
    assert 'id="ALERTA-001"' in html
    assert 'href="#ALERTA-001"' in html
    assert 'href="#ppc-b00002"' in html
    assert 'href="#ppc-b00004"' in html
    assert "Pontos no PPC" in html
    assert "ponto_de_conflito" in html
    assert "estado-transversal" in html
    assert 'id="alertas"' not in html

def test_gerar_relatorio_html_exige_validacao_id_em_alerta_transversal(tmp_path: Path) -> None:
    rodada_dir = _criar_rodada(tmp_path)
    caminhos = round_paths(rodada_dir)
    payload = _payload_resultados_completos()
    payload["alertas_transversais"] = [
        {
            "id": "ALERTA-001",
            "titulo": "Inconsistência transversal",
            "criticidade": "OBRIG",
            "descricao": "Perfil e matriz precisam de revisão conjunta.",
            "fichas_relacionadas": ["CT-IDENT-01"],
            "evidencias": ["Evidência transversal"],
            "revisao_humana_obrigatoria": True,
        }
    ]
    write_json(caminhos["suporte_dir"] / "resultados-subagents.json", payload)

    with pytest.raises(ErroResultadosSubagents, match="validacao_id"):
        gerar_relatorio_html(rodada_dir, Path("resultados-subagents.json"))

def test_gerar_relatorio_html_exige_feedback_autores_quando_ficha_solicita(tmp_path: Path) -> None:
    rodada_dir = _criar_rodada(tmp_path)
    caminhos = round_paths(rodada_dir)
    payload = _payload_resultados_completos()
    for grupo in payload["grupos"]:
        for resultado in grupo["resultados"]:
            if resultado["ficha_id"] == "CT-TRANS-08":
                resultado["estado"] = "NAO_ATENDE"
                resultado["revisao_humana_obrigatoria"] = True
                resultado.pop("feedback_autores", None)
    write_json(caminhos["suporte_dir"] / "resultados-subagents.json", payload)

    with pytest.raises(ErroResultadosSubagents, match="feedback_autores"):
        gerar_relatorio_html(rodada_dir, Path("resultados-subagents.json"))

def test_gerar_relatorio_html_renderiza_feedback_autores(tmp_path: Path) -> None:
    rodada_dir = _criar_rodada(tmp_path)
    caminhos = round_paths(rodada_dir)
    payload = _payload_resultados_completos()
    texto_feedback = "Recomenda-se explicitar a articulação entre concepção, perfil e matriz."
    for grupo in payload["grupos"]:
        for resultado in grupo["resultados"]:
            if resultado["ficha_id"] == "CT-TRANS-08":
                resultado["estado"] = "NAO_ATENDE"
                resultado["revisao_humana_obrigatoria"] = True
                resultado["feedback_autores"] = texto_feedback
    write_json(caminhos["suporte_dir"] / "resultados-subagents.json", payload)

    relatorio = gerar_relatorio_html(rodada_dir, Path("resultados-subagents.json"))

    assert relatorio["total_fichas"] == len(list(FICHAS_DIR.glob("*.json")))
    html = caminhos["relatorio_html"].read_text(encoding="utf-8")
    assert "Feedback sugerido aos autores" in html
    assert texto_feedback in html
    assert "Feedback aos autores" in html

def test_nao_ha_codigo_de_execucao_por_cli_ou_tokens() -> None:
    textos = []
    for caminho in SCRIPTS_DIR.rglob("*.py"):
        textos.append(caminho.read_text(encoding="utf-8"))
    conteudo = "\n".join(textos)

    proibidos = [
        "codex exec",
        "ANALISE_PPC_CODEX",
        "ANALISE_PPC_GEMINI",
        "executar_prompt",
        "uso_tokens",
        "contabilizar-tokens",
    ]
    for proibido in proibidos:
        assert proibido not in conteudo
