"""Prévia da vitrine no WhatsApp (28/09/2026).

Pedido dele: todo link da vitrine mandado nos grupos de WhatsApp já sai com a
logo padrão do Locutores IA. O WhatsApp monta a prévia pelas etiquetas Open
Graph do cabeçalho; a imagem precisa de URL ABSOLUTA e pública (sem login).

Rodar: pytest tests/test_vitrine_previa_whatsapp.py -v
"""
import os

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
URL_VITRINE = 'https://locutoresia-audiopank-ai.vercel.app/vitrine'
URL_LOGO = 'https://locutoresia-audiopank-ai.vercel.app/static/og/locutores-ia-logo.jpg'


def _anonimo():
    from backend.app import app
    app.config['TESTING'] = True
    return app.test_client()                       # SEM login: é o que o WhatsApp vê


def test_vitrine_tem_as_etiquetas_da_previa():
    html = _anonimo().get('/vitrine').get_data(as_text=True)
    for t in ('<meta property="og:type" content="website">',
              f'<meta property="og:url" content="{URL_VITRINE}">',
              f'<meta property="og:image" content="{URL_LOGO}">',
              f'<meta property="og:image:secure_url" content="{URL_LOGO}">',
              '<meta property="og:image:type" content="image/jpeg">',
              '<meta property="og:image:width" content="1024">',
              '<meta property="og:image:height" content="1020">',
              '<meta property="og:title" content="Locutores IA',
              '<meta property="og:description" content="',
              '<meta property="og:locale" content="pt_BR">',
              '<meta name="twitter:card" content="summary">'):
        assert t in html, t


def test_logo_publica_e_leve():
    caminho = os.path.join(RAIZ, 'static', 'og', 'locutores-ia-logo.jpg')
    assert os.path.getsize(caminho) < 300 * 1024      # WhatsApp ignora imagem pesada
    r = _anonimo().get('/static/og/locutores-ia-logo.jpg')
    assert r.status_code == 200 and r.mimetype == 'image/jpeg'
