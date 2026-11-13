"""Subcomando `gerar-relatorio-html` da analise-ppc, ainda em Python.

O ponto de entrada da skill é `analise_ppc.ts`, que delega a este script só o
`gerar-relatorio-html` (mesmos argumentos e código de saída) até a trilha T2
do PLANO-ARQUITETURA.md. Os demais subcomandos rodam em TypeScript.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from common import round_paths, write_json
from gerar_relatorio_html import gerar_relatorio_html
from publicar_surge import dominio_surge_padrao, preparar_site_surge, publicar_site_surge


def _print_payload(payload: object) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def _relatorio_payload(path: Path, publicacao: dict[str, object] | None = None) -> dict[str, object]:
    relatorio = path.resolve()
    payload: dict[str, object] = {
        "relatorio_html": str(relatorio),
        "relatorio_url": relatorio.as_uri(),
        "mensagem": f"Relatório pronto: {relatorio.as_uri()}",
    }
    if publicacao:
        public_url = str(publicacao.get("public_url") or "")
        payload.update(
            {
                "publicacao_servico": publicacao.get("servico"),
                "publicacao_url": public_url,
                "surge_url": public_url,
                "surge_domain": publicacao.get("domain"),
                "mensagem": f"Relatório pronto: {public_url or relatorio.as_uri()}",
            }
        )
    return payload


def cmd_gerar_relatorio_html(args: argparse.Namespace) -> int:
    payload = gerar_relatorio_html(
        rodada_dir=Path(args.rodada_dir),
        resultados_path=Path(args.resultados),
    )
    publicacao = None
    if not args.sem_surge:
        caminhos = round_paths(Path(args.rodada_dir))
        site_dir = preparar_site_surge(
            payload["relatorio_html"],
            caminhos["suporte_dir"] / "surge-site",
        )
        publicacao = publicar_site_surge(
            site_dir,
            dominio=args.surge_domain or dominio_surge_padrao(caminhos["rodada_dir"]),
        )
        publicacao["relatorio_html_original"] = str(Path(payload["relatorio_html"]).resolve())
        write_json(caminhos["suporte_dir"] / "surge-publicacao.json", publicacao)
    _print_payload(_relatorio_payload(payload["relatorio_html"], publicacao=publicacao))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Análise de PPC: relatório HTML (delegado por analise_ppc.ts)")
    subparsers = parser.add_subparsers(dest="subcomando", required=True)

    parser_relatorio = subparsers.add_parser("gerar-relatorio-html", help="Gerar o relatório HTML final")
    parser_relatorio.add_argument("--rodada-dir", type=str, required=True, help="Diretório da rodada")
    parser_relatorio.add_argument(
        "--resultados",
        type=str,
        default="resultados-subagents.json",
        help="JSON coletado dos sub-agentes; relativo a arquivos-suporte quando não absoluto",
    )
    parser_relatorio.add_argument(
        "--sem-surge",
        action="store_true",
        help="Gerar apenas o HTML local, sem publicar no Surge.",
    )
    parser_relatorio.add_argument(
        "--surge-domain",
        type=str,
        help="Domínio Surge de publicação; padrão: analise-ppc-<rodada>.surge.sh.",
    )
    parser_relatorio.set_defaults(func=cmd_gerar_relatorio_html)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
