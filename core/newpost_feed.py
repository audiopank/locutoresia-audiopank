"""
Publicação no FEED da NewPost-IA (https://www.newpostia.app/).

Contexto (31/08/2026): a NewPost-IA saiu da Lovable e migrou pra um projeto
Supabase próprio. Duas coisas mudaram e este módulo é a resposta às duas:

1. **RLS fechou a porta do anônimo.** Antes a anon key inseria em `posts`;
   agora dá `42501`. Pra publicar é preciso LOGAR como uma conta da rede
   (e-mail/senha, GoTrue) e inserir com `author_id` = a própria conta.
2. **A tabela `posts` mudou de forma.** Não existem mais `title`, `category`,
   `source_url`, `image_url`, `published_at`. O título vai DENTRO do `content`.

Configuração (só por variável de ambiente — senha nunca entra no código):

    NEWPOST_FEED_URL            https://<ref>.supabase.co do projeto da NewPost-IA
    NEWPOST_FEED_ANON_KEY       anon key (pública) desse projeto
    NEWPOST_FEED_EMAIL          conta principal (assina News Auto Post / curadoria)
    NEWPOST_FEED_SENHA
    NEWPOST_FEED_EMAIL_FUTURO   opcional: conta "Futuro em Pauta" (Busca Notícias)
    NEWPOST_FEED_SENHA_FUTURO   — se faltar, cai na principal
    NEWPOST_FEED_EMAIL_LOCUTORES  opcional: perfil da produtora (spots do Gerador)
    NEWPOST_FEED_SENHA_LOCUTORES
    NEWPOST_FEED_EMAIL_VIDA     opcional: programa "Vida Saudável" (podcast diário)
    NEWPOST_FEED_SENHA_VIDA

Sem fallback de URL de propósito: URL morta escondida como fallback foi o que
deixou a integração quebrada em silêncio quando o projeto antigo desligou.
"""
import os
import re
import time
import hashlib
import logging
import threading
import unicodedata

import requests

logger = logging.getLogger(__name__)

CONTAS = {
    'principal': ('NEWPOST_FEED_EMAIL', 'NEWPOST_FEED_SENHA'),
    'futuro': ('NEWPOST_FEED_EMAIL_FUTURO', 'NEWPOST_FEED_SENHA_FUTURO'),
    # Perfil da produtora ("LOCUTORES IA - Áudio Pank") — assina os SPOTS do
    # Gerador no feed; contas que faltarem caem na principal.
    'locutores': ('NEWPOST_FEED_EMAIL_LOCUTORES', 'NEWPOST_FEED_SENHA_LOCUTORES'),
    # Programa "Vida Saudável" — podcast diário de saúde e bem-estar, vitrine do
    # produto "Podcast Diário com a marca do cliente" (decisão de 04/09/2026).
    'vida': ('NEWPOST_FEED_EMAIL_VIDA', 'NEWPOST_FEED_SENHA_VIDA'),
}

# Cache de sessão por e-mail (vive enquanto a instância viver — na Vercel, por
# instância quente; o pior caso é relogar, que custa uma chamada).
_sessoes = {}
_trava = threading.Lock()


class FeedNaoConfigurado(Exception):
    """Falta variável de ambiente — erro de configuração, não de rede."""


def _cfg():
    return os.getenv('NEWPOST_FEED_URL', '').strip().rstrip('/'), os.getenv('NEWPOST_FEED_ANON_KEY', '').strip()


def configurado():
    """True quando URL + anon key existem (leitura já funciona; publicar ainda exige conta)."""
    url, anon = _cfg()
    return bool(url and anon)


def _credenciais(conta):
    var_email, var_senha = CONTAS.get(conta, CONTAS['principal'])
    email = os.getenv(var_email, '').strip()
    senha = os.getenv(var_senha, '')
    if not (email and senha) and conta != 'principal':
        email = os.getenv('NEWPOST_FEED_EMAIL', '').strip()
        senha = os.getenv('NEWPOST_FEED_SENHA', '')
    return email, senha


def conta_configurada(conta):
    """True quando a conta tem e-mail/senha PRÓPRIOS no ambiente.

    Diferente de `_credenciais`, NÃO considera o fallback pra principal: serve
    pra quem precisa recusar em vez de assinar com o perfil errado (ex.: spot
    pedido "como Vida Saudável" saindo assinado NewPost-IA ✓ sem ninguém ver).
    """
    var_email, var_senha = CONTAS.get(conta, CONTAS['principal'])
    return bool(os.getenv(var_email, '').strip() and os.getenv(var_senha, ''))


def sessao(conta='principal'):
    """Devolve {'access_token','refresh_token','expira','user_id','email'} logado.

    Renova pelo refresh_token quando tem; senão loga por senha. Levanta
    FeedNaoConfigurado (falta env) ou RuntimeError (login recusado).
    """
    url, anon = _cfg()
    if not (url and anon):
        raise FeedNaoConfigurado('NEWPOST_FEED_URL / NEWPOST_FEED_ANON_KEY não configuradas')
    email, senha = _credenciais(conta)
    if not (email and senha):
        raise FeedNaoConfigurado(f'conta "{conta}" sem NEWPOST_FEED_EMAIL / NEWPOST_FEED_SENHA')

    with _trava:
        s = _sessoes.get(email)
        if s and s['expira'] > time.time() + 60:
            return s

        cabecalhos = {'apikey': anon, 'Content-Type': 'application/json'}
        dados = None
        if s and s.get('refresh_token'):
            try:
                r = requests.post(f'{url}/auth/v1/token?grant_type=refresh_token',
                                  headers=cabecalhos, json={'refresh_token': s['refresh_token']}, timeout=20)
                if r.ok:
                    dados = r.json()
            except requests.RequestException as e:
                logger.warning(f'[newpost_feed] refresh falhou, vai relogar: {e}')
        if not dados:
            r = requests.post(f'{url}/auth/v1/token?grant_type=password',
                              headers=cabecalhos, json={'email': email, 'password': senha}, timeout=20)
            if not r.ok:
                raise RuntimeError(f'login na NewPost-IA recusado ({r.status_code}): {(r.text or "")[:160]}')
            dados = r.json()

        s = {
            'access_token': dados['access_token'],
            'refresh_token': dados.get('refresh_token'),
            'expira': time.time() + int(dados.get('expires_in') or 3600),
            'user_id': (dados.get('user') or {}).get('id'),
            'email': email,
        }
        _sessoes[email] = s
        return s


def montar_conteudo(titulo, conteudo, source_url=''):
    """Título + corpo + link num `content` só (o feed não tem mais coluna title).

    Não repete o título quando o corpo já começa com ele; não repete o link
    quando já está no texto.
    """
    titulo = (titulo or '').strip()
    conteudo = (conteudo or '').strip()
    partes = []
    if titulo and not conteudo.lower().startswith(titulo.lower()) and not conteudo.lower().startswith(f'📰 {titulo.lower()}'):
        partes.append(f'📰 {titulo}')
    if conteudo:
        partes.append(conteudo)
    src = (source_url or '').strip()
    if src.lower().startswith('http') and src not in conteudo:
        partes.append(f'🔗 {src}')
    return '\n\n'.join(partes)


def _chave_idempotente(user_id, base):
    h = hashlib.sha1((base or '').encode('utf-8')).hexdigest()[:24]
    return f'{user_id}-locutores-{h}'


def publicar(conteudo, conta='principal', tags=None, media_urls=None, media_types=None,
             is_ia=True, chave=None, audio_url=None):
    """Insere um post no feed como a conta indicada.

    `chave` (ex.: link da notícia) vira idempotency_key — o mesmo artigo não
    posta duas vezes. Devolve dict: success/post_id ou error (+ already=True
    quando o banco acusou duplicado, + nao_configurado=True quando falta env).
    Nunca levanta exceção: quem chama decide o que fazer com o status.
    """
    conteudo = (conteudo or '').strip()
    if not conteudo:
        return {'success': False, 'error': 'conteúdo vazio'}
    try:
        s = sessao(conta)
    except FeedNaoConfigurado as e:
        return {'success': False, 'error': str(e), 'nao_configurado': True}
    except Exception as e:
        return {'success': False, 'error': str(e)}

    url, anon = _cfg()
    payload = {
        'author_id': s['user_id'],
        'content': conteudo,
        'status': 'published',
        'privacy': 'public',
        'is_ia_generated': bool(is_ia),
        'tags': list(tags or []),
        'content_hash': hashlib.md5(conteudo.encode('utf-8')).hexdigest(),
        'idempotency_key': _chave_idempotente(s['user_id'], chave or conteudo),
    }
    if media_urls:
        payload['media_urls'] = list(media_urls)
        payload['media_types'] = list(media_types or (['image'] * len(media_urls)))
    if audio_url:
        payload['audio_url'] = audio_url

    cabecalhos = {
        'apikey': anon,
        'Authorization': f"Bearer {s['access_token']}",
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
    }
    try:
        r = requests.post(f'{url}/rest/v1/posts', headers=cabecalhos, json=payload, timeout=30)
    except requests.RequestException as e:
        return {'success': False, 'error': f'rede: {e}'}

    if r.status_code in (200, 201):
        try:
            d = r.json()
            pid = d[0]['id'] if isinstance(d, list) and d else None
        except Exception:
            pid = None
        return {'success': True, 'post_id': pid, 'author_id': s['user_id']}

    texto = r.text or ''
    if '23505' in texto:
        return {'success': False, 'already': True, 'status_code': r.status_code,
                'error': 'já publicado antes (duplicado)'}
    if r.status_code == 401:
        # token invalidado no servidor: derruba o cache pra próxima chamada relogar
        with _trava:
            _sessoes.pop(s['email'], None)
    return {'success': False, 'status_code': r.status_code, 'error': f'{r.status_code}: {texto[:200]}'}


def listar(limit=20, author_id=None):
    """Últimos posts do feed (leitura pública, só anon key). Lista vazia se não configurado."""
    url, anon = _cfg()
    if not (url and anon):
        return []
    params = {
        'select': 'id,author_id,content,status,privacy,tags,media_urls,is_ia_generated,created_at',
        'order': 'created_at.desc',
        'limit': str(int(limit)),
    }
    if author_id:
        params['author_id'] = f'eq.{author_id}'
    try:
        r = requests.get(f'{url}/rest/v1/posts', headers={'apikey': anon, 'Authorization': f'Bearer {anon}'},
                         params=params, timeout=20)
        return r.json() if r.ok else []
    except Exception as e:
        logger.error(f'[newpost_feed] listar falhou: {e}')
        return []


def _slug_ascii(nome):
    """Nome de arquivo seguro pro Storage do feed: só ASCII, dígitos e hífen.

    O Storage do Supabase recusa chave com acento ("InvalidKey") — o primeiro
    spot do Vida Saudável ("...Saudável #1: ... amamentação") quebrou aqui em
    04/09/2026. `\\w` do Python aceita letra acentuada, por isso o slug antigo
    deixava passar. Tira o acento (NFKD) antes de filtrar.
    """
    texto = unicodedata.normalize('NFKD', str(nome or 'spot')).encode('ascii', 'ignore').decode()
    return re.sub(r'[^A-Za-z0-9-]+', '-', texto).strip('-')[:60] or 'spot'


def subir_audio(nome, dados, conta='principal'):
    """Sobe um MP3 pro storage do FEED (bucket `post-audio`) e devolve a URL pública.

    Caminho no padrão do próprio feed: `<user_id>/<timestamp>-<slug>.mp3`
    (verificado ao vivo em 31/08/2026: upload autenticado responde 200).
    Levanta exceção com mensagem clara em falha — quem chama decide a tela.
    """
    s = sessao(conta)
    url, anon = _cfg()
    caminho = f"{s['user_id']}/{int(time.time())}-{_slug_ascii(nome)}.mp3"
    r = requests.post(f"{url}/storage/v1/object/post-audio/{caminho}",
                      headers={'apikey': anon,
                               'Authorization': f"Bearer {s['access_token']}",
                               'Content-Type': 'audio/mpeg'},
                      data=dados, timeout=60)
    if not r.ok:
        raise RuntimeError(f'upload do áudio falhou ({r.status_code}): {(r.text or "")[:160]}')
    return f"{url}/storage/v1/object/public/post-audio/{caminho}"


def apagar(post_id, conta='principal'):
    """Apaga um post da própria conta (logado, a RLS permite o dono apagar). Bool."""
    try:
        s = sessao(conta)
    except Exception as e:
        logger.error(f'[newpost_feed] apagar sem sessão: {e}')
        return False
    url, anon = _cfg()
    try:
        r = requests.delete(f'{url}/rest/v1/posts', params={'id': f'eq.{post_id}'},
                            headers={'apikey': anon, 'Authorization': f"Bearer {s['access_token']}",
                                     'Prefer': 'return=representation'}, timeout=20)
        return r.ok and bool(r.json())
    except Exception as e:
        logger.error(f'[newpost_feed] apagar falhou: {e}')
        return False
