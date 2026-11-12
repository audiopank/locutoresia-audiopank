"""🎙️ Gerar voz aqui (12/11/2026) — MiniDAW clássica.

Pedido dele: na faixa de VOZ vazia, um gerador de voz igual ao da tela inicial, pra não
precisar sair da MiniDAW. Mesmo motor do 🔁 Regerar trecho: `entrega: 'inline'` (nada no
Supabase) e a voz entra na faixa pelo MESMO caminho de um arquivo escolhido (loadAudioFile).

Rodar: pytest tests/test_gerar_voz_na_faixa.py -v
"""
import os

RAIZ = os.path.join(os.path.dirname(__file__), '..')


def _ler(*p):
    return open(os.path.join(RAIZ, *p), encoding='utf-8').read()


def test_botao_so_na_faixa_de_voz_vazia():
    js = _ler('static', 'minidaw.js')
    zona = js[js.index('<div class="drop-zone-track" id="drop_${track.id}"'):]
    zona = zona[:zona.index('` : `')]
    assert "${track.type === 'voice' ?" in zona
    assert "RegerarTrecho.gerarVozNaFaixa('${track.id}')" in zona and '🎙️ Gerar voz aqui' in zona


def test_mesmo_motor_inline_e_mesmo_caminho_do_arquivo():
    rt = _ler('static', 'regerar-trecho.js')
    assert rt.count("fetch('/api/generate-audio'") == 1 and "entrega: 'inline'" in rt                # um pedido só, usado pelos dois quadros
    assert 'async function pedirVozInline(' in rt
    assert rt.count('await pedirVozInline(') == 2              # Regerar + Gerar voz aqui
    assert 'function gerarVozNaFaixa(' in rt and 'gerarVozNaFaixa,' in rt
    assert 'd.loadAudioFile(new File(' in rt                   # entra como arquivo escolhido
    assert "localStorage.setItem('minidaw_ultima_geracao'" in rt   # Regerar depois já acha a voz


def test_versoes():
    html = _ler('templates', 'minidaw.html')
    assert '/static/minidaw.js?v=90' in html and '/static/regerar-trecho.js?v=3' in html
