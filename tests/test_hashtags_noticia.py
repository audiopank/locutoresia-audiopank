"""Hashtags das notícias da curadoria (06/10/2026).

No feed saíam "#Geral #NewPostIA #relatam" / "#Prepara" / "#Unido" (3ª hashtag = 2ª palavra do
título), categoria sempre #Geral (o News Auto Post não mandava a categoria no rascunho) e as
hashtags repetidas nas etiquetas azuis (#LocutoresIA #NewPostIA) — o mesmo caso já corrigido
na Receita do dia. Agora: categoria certa + #NewPostIA + até 2 assuntos de verdade do título
(sigla ou nome próprio), só no texto.

Rodar: pytest tests/test_hashtags_noticia.py -v
"""
import os

import pytest

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


@pytest.mark.parametrize('fonte,esperado', [
    ('Tecnologia', 'tecnologia'), ('Economia', 'economia'), ('Política', 'politica'),
    ('Saúde', 'saude'), ('Notícias Gerais', 'geral'), ('', 'geral'), (None, 'geral'), ('Qualquer', 'geral'),
])
def test_categoria_do_news_auto_post(fonte, esperado):
    from core.news_content import categoria_slug
    assert categoria_slug(fonte) == esperado


@pytest.mark.parametrize('titulo,categoria,esperado', [
    ('Programadores relatam exaustão com avanço da IA no trabalho, mostra estudo', 'tecnologia',
     ['Tecnologia', 'NewPostIA', 'IA']),
    ("Reino Unido investiga Meta por recurso 'Instagram Instants'", 'tecnologia',
     ['Tecnologia', 'NewPostIA', 'ReinoUnido', 'Meta']),
    ('Fed Prepara Mudanças na Fiscalização dos Bancos dos EUA e Pode Aliviar Exigências Regulatórias', 'economia',
     ['Economia', 'NewPostIA', 'EUA']),                     # título Em Maiúsculas: só a sigla
    ('Dólar hoje desaba mais de 4% e vai a R$ 4,98', 'economia', ['Economia', 'NewPostIA']),
    ('Bolo de cenoura fofinho', 'geral', ['Notícias', 'NewPostIA']),
    ('Petrobras, Vale, Itaú e BB após eleição: até onde ações podem subir?', 'economia',
     ['Economia', 'NewPostIA', 'BB', 'Vale']),             # 1ª palavra sozinha = começo de frase, não conta
])
def test_hashtags_com_sentido(titulo, categoria, esperado):
    from core.news_content import hashtags_da_noticia
    assert hashtags_da_noticia(titulo, categoria) == esperado


class _R402:
    status_code = 402
    text = 'restricted'

    def json(self):
        return {}


def test_publish_da_curadoria_usa_hashtags_novas_e_nao_repete_nas_etiquetas(monkeypatch):
    from backend import app as modulo
    for m in ('get', 'post', 'patch'):
        monkeypatch.setattr(modulo.requests, m, lambda *a, **k: _R402())
    chamadas = []

    def _feed(**kw):
        chamadas.append(kw)
        return 'publicado'

    monkeypatch.setattr(modulo, 'publicar_no_feed_newpost', _feed)
    monkeypatch.setattr(modulo, 'social_posts_store', [{
        'id': 'n1', 'title': "Reino Unido investiga Meta por recurso 'Instagram Instants'",
        'content': "📰 Reino Unido investiga Meta por recurso 'Instagram Instants'\n\nA Ofcom abriu investigação.",
        'category': 'tecnologia', 'status': 'aprovado'}])
    modulo.app.config['TESTING'] = True
    c = modulo.app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    assert c.post('/api/social/posts/n1/publish').get_json()['success']
    kw = chamadas[0]
    assert kw['conteudo'].rstrip().endswith('#Tecnologia #NewPostIA #ReinoUnido #Meta')
    assert '#Geral' not in kw['conteudo'] and '#Unido' not in kw['conteudo']
    assert kw['tags'] == []                                   # nada de etiquetas repetidas


def test_feed_respeita_lista_vazia_de_etiquetas(monkeypatch):
    from backend import app as modulo
    from core import newpost_feed
    vistos = {}
    monkeypatch.setattr(newpost_feed, 'publicar', lambda texto, **kw: vistos.update(kw) or {'success': True})
    assert modulo.publicar_no_feed_newpost('T', 'corpo', categoria='tecnologia', tags=[]) == 'publicado'
    assert vistos['tags'] == []
    modulo.publicar_no_feed_newpost('T', 'corpo')                                   # outro caminho: igual antes
    assert vistos['tags'] == ['NewPostIA', 'LocutoresIA']


def test_news_auto_post_manda_a_categoria_no_rascunho():
    html = open(os.path.join(RAIZ, 'templates', 'news-auto-post.html'), encoding='utf-8').read()
    assert "category: newsItem.source || ''" in html
    app_py = open(os.path.join(RAIZ, 'backend', 'app.py'), encoding='utf-8').read()
    assert "'category': categoria_slug(data.get('category'))" in app_py
