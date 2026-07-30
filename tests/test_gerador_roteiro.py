"""Testes das funções puras do Gerador de Anúncios.

Rodar: pytest tests/test_gerador_roteiro.py -v

Só funções determinísticas aqui — nada que chame o Gemini ou o Supabase.
O endpoint em si é verificado manualmente (ver plano, Task 7).
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from backend.app import estimar_duracao_locucao, duracao_alvo_do_plano


class TestEstimarDuracaoLocucao:
    def test_texto_vazio_da_zero(self):
        assert estimar_duracao_locucao('') == 0.0

    def test_so_espaco_da_zero(self):
        assert estimar_duracao_locucao('   \n  ') == 0.0

    def test_dez_palavras_a_2_5_por_segundo_da_4_segundos(self):
        texto = 'um dois tres quatro cinco seis sete oito nove dez'
        assert estimar_duracao_locucao(texto) == 4.0

    def test_pontuacao_nao_conta_como_palavra(self):
        # "Compre já!" = 2 palavras = 0.8s
        assert estimar_duracao_locucao('Compre já!') == 0.8

    def test_arredonda_para_uma_casa(self):
        # 7 palavras / 2.5 = 2.8
        assert estimar_duracao_locucao('a b c d e f g') == 2.8


class TestDuracaoAlvoDoPlano:
    def test_spot_30_45(self):
        assert duracao_alvo_do_plano('spot_30_45') == (30, 45)

    def test_teaser_5s(self):
        assert duracao_alvo_do_plano('teaser_5s') == (3, 8)

    def test_spot_60_90(self):
        assert duracao_alvo_do_plano('spot_60_90') == (60, 90)

    def test_jingle_nao_tem_grade_fixa(self):
        # jingle e 'outro' não têm faixa — o gerador NÃO deve inventar alvo
        assert duracao_alvo_do_plano('jingle') is None

    def test_outro_nao_tem_grade_fixa(self):
        assert duracao_alvo_do_plano('outro') is None

    def test_plano_desconhecido_nao_tem_grade(self):
        assert duracao_alvo_do_plano('plano_que_nao_existe') is None
