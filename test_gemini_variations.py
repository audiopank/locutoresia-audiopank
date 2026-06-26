"""Testes do parser de variações de roteiro (sem chamar a API)."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

from app import _parse_variations


def test_parse_json_array():
    raw = '["Texto A", "Texto B", "Texto C"]'
    assert _parse_variations(raw, 3) == ["Texto A", "Texto B", "Texto C"]


def test_parse_json_array_com_lixo_em_volta():
    raw = 'Aqui estão:\n```json\n["Um", "Dois", "Tres"]\n```\nEspero que ajude!'
    assert _parse_variations(raw, 3) == ["Um", "Dois", "Tres"]


def test_parse_fallback_lista_numerada():
    raw = "1. Primeira opcao do texto\n2. Segunda opcao do texto\n3. Terceira opcao do texto"
    out = _parse_variations(raw, 3)
    assert out == ["Primeira opcao do texto", "Segunda opcao do texto", "Terceira opcao do texto"]


def test_parse_corta_no_count():
    raw = '["A muito longa aqui", "B muito longa aqui", "C muito longa aqui", "D muito longa aqui"]'
    assert len(_parse_variations(raw, 3)) == 3


if __name__ == "__main__":
    test_parse_json_array()
    test_parse_json_array_com_lixo_em_volta()
    test_parse_fallback_lista_numerada()
    test_parse_corta_no_count()
    print("OK: todos os testes do parser passaram")
