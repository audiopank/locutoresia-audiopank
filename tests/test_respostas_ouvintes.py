"""Respostas dos ouvintes no card Programa + checagem que reconhece conteúdo editorial (17/09/2026).

Rodar: pytest tests/test_respostas_ouvintes.py -v  (a lista de respostas bate no feed real; NÃO chama o Gemini).
"""
import os

import pytest

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

EP8 = ('Vida Saudável! Um minuto e meio por dia sobre saúde e bem-estar! Episódio oito! '
       'Novo estudo identifica combinações de medicamentos potencialmente prejudiciais para os idosos! '
       'Remédios comuns, como estatinas e até suplementos de ferro, podem causar reações adversas! '
       'Leve para a consulta a lista de tudo que você toma, incluindo vitaminas! ')
AVISO = 'Este conteúdo é informativo e não substitui a orientação do seu médico!'


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


@pytest.fixture(scope='module')
def cliente():
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c


def _checar(cliente, **corpo):
    d = cliente.post('/api/qualidade/checar', json=corpo).get_json()
    assert d['success']
    return d, [a['titulo'] for a in d['avisos']]


def test_episodio_de_programa_nao_leva_aviso_de_anuncio(cliente):
    """O ep.8 falava de remédios e suplementos e levou dois vermelhos de ANÚNCIO. É editorial."""
    d, titulos = _checar(cliente, roteiro=EP8 + AVISO, plano='outro', duracao_segundos=77.6, programa='vida')
    assert d['ok'] and d['total_erros'] == 0, d
    assert not any('falta o aviso legal' in t for t in titulos), titulos
    assert 'Aviso do programa presente' in titulos and any(t.startswith('Duração OK pro programa') for t in titulos)


def test_sem_programa_o_anuncio_continua_sendo_cobrado(cliente):
    d, titulos = _checar(cliente, roteiro=EP8 + AVISO, plano='outro', duracao_segundos=77.6)
    assert not d['ok'] and any('falta o aviso legal' in t for t in titulos), titulos    # spot de farmácia segue protegido


def test_programa_sem_o_aviso_dele_e_longo_demais_acusa(cliente):
    d, titulos = _checar(cliente, roteiro=EP8, plano='outro', duracao_segundos=101.0, programa='vida')
    assert 'Falta o aviso do programa' in titulos and any(t.startswith('Longo demais pro programa') for t in titulos)
    assert d['total_erros'] == 2


def test_lista_de_respostas_vem_do_feed(cliente):
    d = cliente.get('/api/gerador/programa/vida/respostas').get_json()
    assert d['success'] and isinstance(d['respostas'], list)
    for r in d['respostas']:
        assert set(r) >= {'id', 'episodio', 'autor', 'quando', 'quando_br', 'audio_url', 'texto', 'proprio'}
        assert r['episodio'] is None or isinstance(r['episodio'], int)
    assert cliente.get('/api/gerador/programa/nao-existe/respostas').status_code == 404


def test_transcrever_so_aceita_audio_do_proprio_feed(cliente):
    for url in ('https://exemplo.com/a.webm', 'http://169.254.169.254/latest/meta-data/', ''):
        r = cliente.post('/api/gerador/programa/resposta/transcrever', json={'audio_url': url})
        assert r.status_code == 400, url                                        # nada de baixar URL arbitrária


def test_tela_tem_o_painel_e_nao_injeta_html_de_terceiros(cliente):
    html = cliente.get('/gerador').get_data(as_text=True)
    for t in ('id="btnRespostas"', 'id="badgeRespostas"', 'id="listaRespostas"', '.resposta-item {', 'gerador.js?v=25'):
        assert t in html, t
    js = _ler('static', 'gerador.js')
    for marca in ("programa: (document.getElementById('selectPrograma') || {}).value || ''",
                  "async function carregarRespostas() {", "function alternarRespostas() {",
                  "carregarRespostas();      // em segundo plano", "if (btnResp) btnResp.onclick = alternarRespostas;"):
        assert marca in js, marca
    desenho = js[js.index("function desenharRespostas() {"):js.index("function alternarRespostas() {")]
    assert "cab.textContent = `Ep. " in desenho and "saida.textContent = " in desenho
    assert desenho.count("innerHTML") == 1 and "box.innerHTML = '';" in desenho      # só pra LIMPAR; nome e texto entram por textContent
