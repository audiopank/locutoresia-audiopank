"""📂 Subir áudio pronto (spot de outra produtora) no Gerador — 19/11/2026.

O arquivo vira o resultado da tela (Vídeo, Download, Enviar) sem gerar voz nem trilha.
Rodar: pytest tests/test_audio_pronto.py -v
"""
import os

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


def test_botao_e_input_no_gerador():
    html = _ler('templates', 'gerador.html')
    assert 'id="btnSubirAudioPronto"' in html
    assert 'id="inputAudioPronto" accept=".mp3,.wav,audio/mpeg,audio/wav"' in html
    assert '/static/gerador.js?v=37' in html


def test_audio_de_fora_vira_resultado_sem_voz_e_sem_alerta_de_trilha():
    js = _ler('static', 'gerador.js')
    corpo = js[js.index('async function subirAudioPronto'):js.index('// ── O pipeline')]
    for trecho in ('estado.mixBlob = new Blob([bytes]', 'estado.vozBuffer = null;', 'mostrarResultado(duracao);',
                   "áudio pronto (de fora)"):
        assert trecho in corpo, trecho
    assert 'sem trilha' not in corpo.split('mostrarResultado(duracao);')[1].replace('"sem trilha"', '')   # o Vídeo não alerta
