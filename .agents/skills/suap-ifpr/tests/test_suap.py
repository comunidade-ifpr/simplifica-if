from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "suap.py"
sys.path.insert(0, str(SCRIPT.parent))
SPEC = importlib.util.spec_from_file_location("suap_consultas", SCRIPT)
assert SPEC and SPEC.loader
suap = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = suap
SPEC.loader.exec_module(suap)


LISTING = """
<table>
  <tr><th>#</th><th>Foto</th><th>Dados gerais</th><th>Matrícula</th><th>Campus</th></tr>
  <tr>
    <th><a href="/edu/professor/905/">Visualizar</a></th>
    <td></td>
    <td>Nome: Docénte Exemplo CPF: 000.000.000-00 Setor: CCTADM/CURITIBA
        E-mail: docente@example.invalid</td>
    <td>1234567</td><td>CTBADG</td>
  </tr>
</table>
"""

PROFILE = """
<html><body>
  <aside><a href="/rh/servidor/111/">Perfil do usuário autenticado</a></aside>
  <main id="content">
    <a href="/rh/servidor/321/">Dados funcionais da pessoa pesquisada</a>
    <select name="ano-periodo">
      <option>2026.2</option><option selected>2026.1</option><option>2025.2</option>
    </select>
    <div id="dados-gerais"><dl><dt>Nome</dt><dd>Docente Exemplo</dd></dl></div>
    <div id="diarios">
      <table>
        <tr><th>Período</th><th>Diário</th><th>Turma</th><th>Campus</th><th>Tipo</th><th>Ativo</th></tr>
        <tr><td>2026.2</td><td>123 - LICENCIATURA.44 - GEOGRAFIA HUMANA - Graduação [40 h]</td>
            <td>20262.1.CTB1004.1.1V</td><td>CTBADG</td><td>Principal</td><td>Sim</td></tr>
        <tr><td>2026.2</td><td>124 - LICENCIATURA.45 - DISCIPLINA INATIVA - Graduação [40 h]</td>
            <td>20262.1.CTB1004.1.1V</td><td>CTBADG</td><td>Principal</td><td>Não</td></tr>
      </table>
    </div>
    <div id="cursos-lecionados"><ul>
      <li>CTB1004 - LICENCIATURA EM PEDAGOGIA (Campus Curitiba)</li>
    </ul></div>
  </main>
</body></html>
"""

EMPLOYEE = """
<html><body><main id="content">
  <h2>Docente Exemplo (7654321)</h2>
  <dl>
    <dt>CPF</dt><dd>000.000.000-00</dd>
    <dt>Cargo</dt><dd>PROFESSOR EBTT - 707001</dd>
    <dt>Função Atual</dt><dd>COORDENADOR</dd>
    <dt>Lotação SIAPE</dt><dd>CURITIBA (Campus: Curitiba)</dd>
    <dt>Setor de Exercício</dt><dd>DIREN/CTB</dd>
  </dl>
</main></body></html>
"""

WRONG_EMPLOYEE = EMPLOYEE.replace("Docente Exemplo", "Usuário Autenticado")

SERVER_LISTING = """
<html><body><main id="content"><table id="result_list">
  <tr><th>#</th><th>Foto</th><th>Nome/Matrícula</th><th>Contatos</th>
      <th>Cargo/Função/Situação</th><th>Setor</th></tr>
  <tr>
    <td><a href="/rh/servidor/7000001/">Visualizar</a></td><td></td>
    <td><h3>Pessoa Técnica Exemplo (7000001)</h3></td>
    <td><dl><dt>E-mail institucional</dt><dd>pessoa@example.invalid</dd></dl></td>
    <td><dl>
      <dt>Cargo</dt><dd>ASSISTENTE EM ADMINISTRACAO</dd>
      <dt>FG0001 - SETOR/UNI</dt><dd>CHEFE DE SECAO</dd>
      <dt>Situação</dt><dd>ATIVO PERMANENTE - 01</dd>
    </dl></td>
    <td><dl>
      <dt>SIAPE Lotação</dt><dd>UNIDADE</dd>
      <dt>SIAPE Exercício</dt><dd>SETOR/UNI</dd>
      <dt>SUAP</dt><dd>SETOR/UNI</dd>
    </dl></td>
  </tr>
</table></main></body></html>
"""

SERVER_EMPLOYEE = """
<html><body><main id="content">
  <h2>Pessoa Técnica Exemplo (7000001)</h2>
  <section id="dados-pessoais"><dl>
    <dt>CPF</dt><dd>000.000.000-00</dd>
    <dt>E-mail institucional</dt><dd>pessoa@example.invalid</dd>
    <dt>Endereço</dt><dd>Rua não exportável</dd>
  </dl></section>
  <section id="dados-funcionais"><dl>
    <dt>Setor SUAP</dt><dd>SETOR/UNI (campus: UNIDADE)</dd>
    <dt>Lotação SIAPE</dt><dd>UNIDADE (Campus: UNIDADE)</dd>
    <dt>Exercício SIAPE</dt><dd>SETOR/UNI (Campus: UNIDADE)</dd>
    <dt>Situação</dt><dd>ATIVO PERMANENTE - 01</dd>
    <dt>Regime</dt><dd>REGIME JURIDICO UNICO</dd>
    <dt>Jornada Trabalho</dt><dd>40 HORAS SEMANAIS</dd>
    <dt>Início no Serviço Público</dt><dd>01/02/2020</dd>
    <dt>Data de Posse na Instituição</dt><dd>01/02/2020</dd>
    <dt>Início de Exercício na Instituição</dt><dd>03/02/2020</dd>
    <dt>Data de Posse no Cargo</dt><dd>01/02/2020</dd>
    <dt>Início Exercício no Cargo</dt><dd>03/02/2020</dd>
    <dt>Cargo</dt><dd>ASSISTENTE EM ADMINISTRACAO - 701200</dd>
    <dt>Classe do Cargo</dt><dd>CLASSE D</dd>
    <dt>Padrão</dt><dd>08</dd>
    <dt>Grupo do Cargo</dt><dd>PLANO DE CARREIRA TAE</dd>
    <dt>Participa do PGD (dados do SOU GOV)</dt><dd>Sim</dd>
    <dt>Modalidade do PGD (dados do SOU GOV)</dt><dd>parcial</dd>
  </dl></section>
  <section id="dados-bancarios"><dl><dt>Banco</dt><dd>BANCO TESTE</dd></dl></section>
</main></body></html>
"""


class FakeClient:
    def __init__(self):
        self.paths: list[tuple[str, object]] = []

    def get_text(self, path, params=None):
        self.paths.append((path, params))
        if path == suap.PROFESSOR_LIST_PATH:
            return path, LISTING
        if path == "/edu/professor/905/":
            return path, PROFILE
        if path == "/rh/servidor/321/":
            return path, EMPLOYEE
        raise AssertionError(path)


class RestrictedEmployeeClient(FakeClient):
    def get_text(self, path, params=None):
        if path == "/rh/servidor/321/":
            raise suap.SuapHTTPError(403, path)
        return super().get_text(path, params)


class WrongEmployeeClient(FakeClient):
    def get_text(self, path, params=None):
        if path == "/rh/servidor/321/":
            return path, WRONG_EMPLOYEE
        return super().get_text(path, params)


class ServerClient:
    def __init__(self, employee=SERVER_EMPLOYEE):
        self.employee = employee
        self.paths: list[tuple[str, object]] = []

    def get_text(self, path, params=None):
        self.paths.append((path, params))
        if path == suap.SERVER_LIST_PATH:
            return path, SERVER_LISTING
        if path == "/rh/servidor/7000001/":
            return path, self.employee
        raise AssertionError(path)


class ProfessorQueryTests(unittest.TestCase):
    def test_candidate_search_ignores_accents_but_requires_exact_name(self):
        candidates = suap.parse_professor_candidates(LISTING)
        selected = suap.select_exact_candidate(candidates, "Docente Exemplo")

        self.assertEqual("Docénte Exemplo", selected["nome"])
        self.assertEqual("CTBADG", selected["campus"])
        self.assertNotIn("CPF", selected)
        self.assertNotIn("email", selected)

    def test_ambiguous_exact_name_is_not_silently_selected(self):
        candidates = [
            {"nome": "Pessoa Homônima", "campus": "A", "setor_suap": "", "profile_path": "/1/"},
            {"nome": "Pessoa Homônima", "campus": "B", "setor_suap": "", "profile_path": "/2/"},
        ]

        with self.assertRaises(suap.SkillError) as context:
            suap.select_exact_candidate(candidates, "Pessoa Homônima")

        self.assertIn("mais de um", str(context.exception))

        selected = suap.select_exact_candidate(candidates, "Pessoa Homônima", "B")
        self.assertEqual("B", selected["campus"])

    def test_latest_available_period_wins_over_stale_selected_option(self):
        root = suap.parse_html(PROFILE)

        period, reason = suap.choose_period(suap.available_periods(root), None, None)

        self.assertEqual("2026.2", period)
        self.assertIn("mais recente", reason)

    def test_profile_extracts_only_active_disciplines_and_maps_course_by_class(self):
        root = suap.parse_html(PROFILE)
        courses = suap.parse_courses(root)

        disciplines = suap.parse_disciplines(root, courses)

        self.assertEqual(1, len(disciplines))
        self.assertEqual("GEOGRAFIA HUMANA", disciplines[0]["disciplina"])
        self.assertTrue(disciplines[0]["curso"].startswith("CTB1004 -"))
        self.assertNotIn("turma", disciplines[0])

    def test_employment_omits_personal_identifier_and_internal_cargo_code(self):
        employment = suap.parse_employment(EMPLOYEE)

        self.assertEqual("PROFESSOR EBTT", employment["cargo"])
        self.assertEqual("COORDENADOR", employment["funcao"])
        self.assertNotIn("cpf", employment)
        self.assertNotIn("707001", json.dumps(employment))

    def test_employee_link_ignores_authenticated_user_navigation(self):
        root = suap.parse_html(PROFILE)

        self.assertEqual("/rh/servidor/321/", suap.employee_profile_path(root))
        self.assertEqual("Docente Exemplo", suap.employee_profile_name(EMPLOYEE))

    def test_end_to_end_result_has_sources_and_no_unrequested_identifiers(self):
        result = suap.consultar_professor(
            "Docente Exemplo", 2026, 2, None, client=FakeClient()
        )
        serialized = json.dumps(result, ensure_ascii=False).casefold()

        self.assertEqual("PROFESSOR EBTT", result["cargo"])
        self.assertEqual("2026.2", result["periodo_letivo"])
        self.assertIn("ifpr.edu.br/tutoriais", result["fonte"]["tutorial_url"])
        self.assertNotIn("000.000.000-00", serialized)
        self.assertNotIn("1234567", serialized)
        self.assertNotIn("example.invalid", serialized)

    def test_permission_failure_preserves_teaching_data_and_adds_warning(self):
        result = suap.consultar_professor(
            "Docente Exemplo", 2026, 2, None, client=RestrictedEmployeeClient()
        )

        self.assertIsNone(result["cargo"])
        self.assertEqual(1, len(result["disciplinas_ativas"]))
        self.assertTrue(any("permissão" in warning for warning in result["avisos"]))

    def test_mismatched_employee_identity_discards_functional_data(self):
        result = suap.consultar_professor(
            "Docente Exemplo", 2026, 2, None, client=WrongEmployeeClient()
        )

        self.assertIsNone(result["cargo"])
        self.assertEqual(1, len(result["disciplinas_ativas"]))
        self.assertTrue(any("descartados" in warning for warning in result["avisos"]))


class ServerQueryTests(unittest.TestCase):
    def test_listing_extracts_professional_fields_and_omits_contacts(self):
        candidates = suap.parse_server_candidates(SERVER_LISTING)

        self.assertEqual(1, len(candidates))
        self.assertEqual("Pessoa Técnica Exemplo", candidates[0]["nome"])
        self.assertEqual("CHEFE DE SECAO", candidates[0]["funcao"])
        self.assertEqual("SETOR/UNI", candidates[0]["setor_suap"])
        self.assertNotIn("email", candidates[0])

    def test_unique_partial_name_is_accepted_but_unsafe_match_is_rejected(self):
        candidates = suap.parse_server_candidates(SERVER_LISTING)

        selected = suap.select_server_candidate(candidates, "Pessoa Exemplo")
        self.assertEqual("Pessoa Técnica Exemplo", selected["nome"])

        with self.assertRaises(suap.SkillError):
            suap.select_server_candidate(candidates, "Pessoa Diferente")

    def test_end_to_end_server_result_has_only_allowlisted_professional_data(self):
        result = suap.consultar_servidor(
            "Pessoa Técnica Exemplo", None, client=ServerClient()
        )
        serialized = json.dumps(result, ensure_ascii=False).casefold()

        self.assertEqual("ASSISTENTE EM ADMINISTRACAO", result["cargo"])
        self.assertEqual("40 HORAS SEMANAIS", result["jornada_trabalho"])
        self.assertEqual("CLASSE D", result["classe_cargo"])
        self.assertEqual("parcial", result["modalidade_pgd"])
        self.assertNotIn("000.000.000-00", serialized)
        self.assertNotIn("example.invalid", serialized)
        self.assertNotIn("banco teste", serialized)
        self.assertNotIn("7000001", serialized)

    def test_server_profile_identity_must_match_listing(self):
        wrong = SERVER_EMPLOYEE.replace("Pessoa Técnica Exemplo", "Outra Pessoa")

        with self.assertRaises(suap.SkillError):
            suap.consultar_servidor(
                "Pessoa Técnica Exemplo", None, client=ServerClient(wrong)
            )


if __name__ == "__main__":
    unittest.main()
