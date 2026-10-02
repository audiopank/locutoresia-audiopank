"""Busca Notícias publica também como MÍDIA DIGITAL (02/10/2026) — saída da Base44, fase 2.

A Base44 publicava notícias SOZINHA no perfil MÍDIA DIGITAL (1–3/dia). Pra desligá-la sem
deixar o perfil morrer, a Busca Notícias (que já publica direto no feed, sem o banco
bloqueado) ganha a escolha do perfil: Futuro em Pauta (como sempre) ou MÍDIA DIGITAL.
Sempre pela mão do produtor. Sem as credenciais próprias da conta 'midia' o publicar RECUSA
e diz o nome da variável que falta — nunca assina como outro perfil.

Rodar: pytest tests/test_busca_noticias_midia.py -v
"""
import os

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


def _cliente():
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c


NOTICIA = {'titulo': 'Fleury adquire laboratório', 'conteudo': 'O Fleury comprou o Unilab por R$ 55 milhões.',
           'categoria': 'Economia', 'link': 'https://www.infomoney.com.br/negocios/fleury-unilab/'}


def _publicar_falso(monkeypatch):
    from core import newpost_feed
    chamadas = []

    def _pub(conteudo, **kw):
        chamadas.append((conteudo, kw))
        return {'success': True, 'post_id': 'p1'}

    monkeypatch.setattr(newpost_feed, 'publicar', _pub)
    return chamadas


def test_conta_midia_com_variaveis_proprias():
    from core import newpost_feed as nf
    assert nf.CONTAS['midia'] == ('NEWPOST_FEED_EMAIL_MIDIA', 'NEWPOST_FEED_SENHA_MIDIA')
    assert nf.CONTAS['futuro'] == ('NEWPOST_FEED_EMAIL_FUTURO', 'NEWPOST_FEED_SENHA_FUTURO')   # não mudou


def test_sem_conta_escolhida_continua_futuro_em_pauta(monkeypatch):
    chamadas = _publicar_falso(monkeypatch)
    d = _cliente().post('/api/news/publish-to-newpost', json=NOTICIA).get_json()
    assert d['success'] and d['author'] == 'Futuro em Pauta'
    _, kw = chamadas[0]
    assert kw['conta'] == 'futuro' and kw['tags'] == ['Notícias', 'FuturoEmPauta']
    assert kw['chave'] == NOTICIA['link']


def test_publica_como_midia_digital(monkeypatch):
    monkeypatch.setenv('NEWPOST_FEED_EMAIL_MIDIA', 'midia@exemplo.com')
    monkeypatch.setenv('NEWPOST_FEED_SENHA_MIDIA', 'senha-de-teste')
    chamadas = _publicar_falso(monkeypatch)
    d = _cliente().post('/api/news/publish-to-newpost', json={**NOTICIA, 'conta': 'midia'}).get_json()
    assert d['success'] and d['author'] == 'MÍDIA DIGITAL'
    conteudo, kw = chamadas[0]
    assert kw['conta'] == 'midia' and kw['tags'] == ['Notícias', 'MídiaDigital']
    assert NOTICIA['link'] in conteudo                       # o link da fonte vai no fim do texto


def test_midia_sem_credenciais_recusa_e_diz_qual_falta(monkeypatch):
    monkeypatch.setenv('NEWPOST_FEED_EMAIL_MIDIA', 'midia@exemplo.com')
    monkeypatch.delenv('NEWPOST_FEED_SENHA_MIDIA', raising=False)
    chamadas = _publicar_falso(monkeypatch)
    r = _cliente().post('/api/news/publish-to-newpost', json={**NOTICIA, 'conta': 'midia'})
    assert r.status_code == 400 and chamadas == []           # nunca cai na conta principal
    erro = r.get_json()['error']
    assert 'NEWPOST_FEED_SENHA_MIDIA' in erro and 'NEWPOST_FEED_EMAIL_MIDIA' not in erro


def test_conta_desconhecida_e_recusada(monkeypatch):
    chamadas = _publicar_falso(monkeypatch)
    r = _cliente().post('/api/news/publish-to-newpost', json={**NOTICIA, 'conta': 'principal'})
    assert r.status_code == 400 and chamadas == []


def test_filtro_sensivel_continua_valendo_pra_midia(monkeypatch):
    monkeypatch.setenv('NEWPOST_FEED_EMAIL_MIDIA', 'midia@exemplo.com')
    monkeypatch.setenv('NEWPOST_FEED_SENHA_MIDIA', 'senha-de-teste')
    chamadas = _publicar_falso(monkeypatch)
    d = _cliente().post('/api/news/publish-to-newpost',
                        json={**NOTICIA, 'conta': 'midia', 'titulo': 'Tiroteio deixa feridos'}).get_json()
    assert d['blocked'] is True and chamadas == []


def test_tela_tem_a_escolha_do_perfil_e_manda_a_conta():
    html = _ler('templates', 'busca-noticias.html')
    assert 'id="perfil-container"' in html
    assert 'data-conta="futuro"' in html and 'data-conta="midia"' in html
    assert 'conta: contaEscolhida' in html
    assert "localStorage.setItem('busca_noticias_conta'" in html
    assert "showToast('✅ Publicado no feed como ' + (data.author || 'Futuro em Pauta') + '!');" in html
