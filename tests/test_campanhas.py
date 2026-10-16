"""Campanhas agendadas no feed (16/10/2026) — substitui o agente da Base44/AppVerse.

Ele cria e aprova cada campanha; o cron só republica o que ele aprovou, nos horários
09/15/21h, com trava anti-lotação (1 por horário, teto por dia somando os perfis) e
Achadinhos nunca com preço. Design: docs/superpowers/specs/2026-10-16-campanhas-agendadas-design.md

Rodar: pytest tests/test_campanhas.py -v
"""
import os
from datetime import date, datetime, timedelta, timezone

import pytest

from core import campanhas as C

BRT = timezone(timedelta(hours=-3))


def _utc(ano, mes, dia, hora, minuto=0):
    return datetime(ano, mes, dia, hora, minuto, tzinfo=timezone.utc)


# ── horário do disparo ──────────────────────────────────────────────────────

@pytest.mark.parametrize('agora_utc, esperado', [
    (_utc(2026, 10, 16, 12, 0), (date(2026, 10, 16), 9)),     # 09:00 BRT
    (_utc(2026, 10, 16, 12, 59), (date(2026, 10, 16), 9)),    # cron atrasado no Hobby
    (_utc(2026, 10, 16, 17, 59), (date(2026, 10, 16), 9)),    # 14:59 ainda é a faixa das 9
    (_utc(2026, 10, 16, 18, 5), (date(2026, 10, 16), 15)),
    (_utc(2026, 10, 17, 0, 10), (date(2026, 10, 16), 21)),    # 21:10 BRT = dia anterior em BRT
    (_utc(2026, 10, 17, 9, 0), (date(2026, 10, 17), None)),   # 06:00 BRT: madrugada, nada
])
def test_slot_do_momento(agora_utc, esperado):
    assert C.slot_do_momento(agora_utc) == esperado


# ── próxima data ────────────────────────────────────────────────────────────

def test_proxima_por_intervalo():
    camp = {'regra': 'intervalo', 'intervalo_dias': 2}
    assert C.proxima_data(camp, date(2026, 10, 16)) == date(2026, 10, 18)


def test_proxima_por_dias_da_semana():
    # 16/10/2026 é sexta (weekday 4). Dias marcados: seg (0) e sex (4) → próxima é seg 19/10.
    camp = {'regra': 'semana', 'dias_semana': [0, 4]}
    assert C.proxima_data(camp, date(2026, 10, 16)) == date(2026, 10, 19)
    # Só sexta → a próxima é a sexta seguinte, nunca o mesmo dia.
    assert C.proxima_data({'regra': 'semana', 'dias_semana': [4]}, date(2026, 10, 16)) == date(2026, 10, 23)


def test_primeira_data_por_dias_da_semana_aceita_o_proprio_dia():
    assert C.primeira_data({'regra': 'semana', 'dias_semana': [4]}, date(2026, 10, 16)) == date(2026, 10, 16)
    assert C.primeira_data({'regra': 'semana', 'dias_semana': [0]}, date(2026, 10, 16)) == date(2026, 10, 19)
    assert C.primeira_data({'regra': 'intervalo', 'intervalo_dias': 3}, date(2026, 10, 16)) == date(2026, 10, 16)


# ── escolha (anti-lotação) ──────────────────────────────────────────────────

HOJE = date(2026, 10, 16)


def _camp(id_, proxima, horario=9, ativa=True, ultima_em=None, vezes=0):
    return {'id': id_, 'proxima_em': proxima.isoformat(), 'horario': horario, 'ativa': ativa,
            'ultima_em': ultima_em, 'vezes': vezes}


def test_escolhe_a_mais_atrasada_primeiro():
    lista = [_camp('b', HOJE), _camp('a', HOJE - timedelta(days=2)), _camp('c', HOJE + timedelta(days=1))]
    assert [c['id'] for c in C.candidatas(lista, HOJE, 9, teto=1)] == ['a', 'b']


def test_respeita_horario_e_pausa():
    lista = [_camp('tarde', HOJE, horario=15), _camp('pausada', HOJE, ativa=False), _camp('manha', HOJE)]
    assert [c['id'] for c in C.candidatas(lista, HOJE, 9, teto=3)] == ['manha']
    assert [c['id'] for c in C.candidatas(lista, HOJE, 15, teto=3)] == ['manha', 'tarde']


def test_teto_do_dia_trava_tudo():
    saiu_hoje = (datetime(2026, 10, 16, 9, 20, tzinfo=BRT)).astimezone(timezone.utc).isoformat()
    lista = [_camp('ja', HOJE + timedelta(days=2), ultima_em=saiu_hoje), _camp('outra', HOJE)]
    assert C.candidatas(lista, HOJE, 15, teto=1) == []
    assert [c['id'] for c in C.candidatas(lista, HOJE, 15, teto=2)] == ['outra']


def test_um_por_horario_mesmo_com_teto_folgado():
    saiu_agora = (datetime(2026, 10, 16, 15, 3, tzinfo=BRT)).astimezone(timezone.utc).isoformat()
    lista = [_camp('ja', HOJE + timedelta(days=2), horario=15, ultima_em=saiu_agora), _camp('outra', HOJE)]
    assert C.candidatas(lista, HOJE, 15, teto=3) == []


# ── trava de preço (Achadinhos) ─────────────────────────────────────────────

@pytest.mark.parametrize('texto', [
    'Fone bluetooth por R$ 49,90 hoje', 'só R$12', 'sai por 29 reais', 'apenas 1.299,00 reais', 'r$ 5'])
def test_preco_e_detectado(texto):
    assert C.trecho_com_preco(texto)


@pytest.mark.parametrize('texto', [
    'Encontre as melhores ofertas na Shopee e no Mercado Livre', 'descontos de 20% toda sexta',
    'Entre agora: https://chat.whatsapp.com/CWaD93tnvlBCzaxbdA9TyD', 'realmente vale a pena'])
def test_texto_sem_preco_passa(texto):
    assert C.trecho_com_preco(texto) is None


# ── validação da campanha ───────────────────────────────────────────────────

def _valida(**kw):
    base = {'conta': 'locutores', 'titulo': 'Locutores IA', 'legenda': 'Vozes que vendem.',
            'regra': 'intervalo', 'intervalo_dias': 2, 'horario': 9, 'comeca_em': '2026-10-16'}
    base.update(kw)
    return C.validar(base, hoje=HOJE)


def test_validacao_ok_monta_a_linha():
    linha, erro = _valida(tags='#LocutoresIA, Spots  #vozes')
    assert erro is None
    assert linha['proxima_em'] == '2026-10-16' and linha['horario'] == 9
    assert linha['tags'] == ['LocutoresIA', 'Spots', 'vozes']
    assert linha['intervalo_dias'] == 2 and linha['dias_semana'] == []


@pytest.mark.parametrize('kw, pedaco', [
    ({'conta': 'midia'}, 'Perfil'),
    ({'horario': 12}, '09h, 15h ou 21h'),
    ({'legenda': '  '}, 'legenda'),
    ({'regra': 'semana', 'dias_semana': []}, 'dia da semana'),
    ({'intervalo_dias': 0}, '1 a 30'),
    ({'comeca_em': '2026-10-10'}, 'passado'),
    ({'conta': 'achadinhos', 'legenda': 'Panela por R$ 89,90'}, 'R$ 89'),
])
def test_validacao_recusa(kw, pedaco):
    linha, erro = _valida(**kw)
    assert linha is None and pedaco in erro


def test_achadinhos_checa_tambem_a_fala_do_audio():
    linha, erro = _valida(conta='achadinhos', transcricao='hoje sai por 19 reais')
    assert linha is None and '19 reais' in erro


# ── rotas e cron (feed simulado) ────────────────────────────────────────────

class FeedFalso:
    """Simula o banco do feed: campanhas por perfil + publicar."""

    def __init__(self):
        self.linhas = {}
        self.publicados = []
        self.falhar = set()
        self.teto = 1

    def listar(self, conta):
        return [dict(l) for l in self.linhas.values() if l['conta'] == conta]

    def criar(self, conta, linha):
        linha = dict(linha, id=f'id{len(self.linhas) + 1}', conta=conta, vezes=0, ativa=True,
                     ultima_em=None, ultimo_erro=None)
        self.linhas[linha['id']] = linha
        return linha

    def atualizar(self, conta, id_, campos):
        self.linhas[id_].update(campos)
        return dict(self.linhas[id_])

    def apagar(self, conta, id_):
        return self.linhas.pop(id_, None) is not None

    def ler_teto(self):
        return self.teto

    def gravar_teto(self, teto):
        self.teto = teto

    def publicar(self, conteudo, conta, **kw):
        if conta in self.falhar:
            return {'success': False, 'error': 'feed fora'}
        self.publicados.append({'conteudo': conteudo, 'conta': conta, **kw})
        return {'success': True, 'post_id': f'post{len(self.publicados)}'}


@pytest.fixture
def feed(monkeypatch):
    f = FeedFalso()
    monkeypatch.setattr(C, 'banco', f)
    monkeypatch.setattr(C, '_publicar_no_feed', f.publicar)
    monkeypatch.setattr(C, 'contas_configuradas', lambda: ['locutores', 'achadinhos', 'principal'])
    return f


def test_disparo_publica_uma_e_reagenda(feed):
    a = feed.criar('locutores', {'titulo': 'A', 'legenda': 'Vozes que vendem', 'tags': ['LocutoresIA'],
                                 'audio_url': 'https://x/a.mp3', 'transcricao': 'fala', 'imagem_url': 'https://x/a.jpg',
                                 'regra': 'intervalo', 'intervalo_dias': 2, 'dias_semana': [], 'horario': 9,
                                 'proxima_em': '2026-10-16'})
    feed.criar('achadinhos', {'titulo': 'B', 'legenda': 'Comunidade', 'tags': [], 'audio_url': None,
                              'transcricao': None, 'imagem_url': None, 'regra': 'intervalo', 'intervalo_dias': 2,
                              'dias_semana': [], 'horario': 9, 'proxima_em': '2026-10-16'})
    r = C.disparar(_utc(2026, 10, 16, 12, 5))
    assert r['publicada'] == a['id'] and len(feed.publicados) == 1
    p = feed.publicados[0]
    assert p['conta'] == 'locutores' and p['audio_url'] == 'https://x/a.mp3'
    assert p['media_urls'] == ['https://x/a.jpg'] and p['media_types'] == ['image']
    assert p['chave'] == f"campanha-{a['id']}-2026-10-16-9"
    assert '#LocutoresIA' in p['conteudo'] and p['transcricao'] == 'fala'
    l = feed.linhas[a['id']]
    assert l['vezes'] == 1 and l['proxima_em'] == '2026-10-18' and l['ultimo_post_id'] == 'post1'
    # Mesmo horário de novo (cron repetido): nada sai.
    assert C.disparar(_utc(2026, 10, 16, 12, 40))['publicada'] is None
    assert len(feed.publicados) == 1


def test_falha_grava_erro_e_tenta_a_proxima(feed):
    feed.falhar.add('locutores')
    a = feed.criar('locutores', {'titulo': 'A', 'legenda': 'x', 'tags': [], 'audio_url': None, 'transcricao': None,
                                 'imagem_url': None, 'regra': 'intervalo', 'intervalo_dias': 2, 'dias_semana': [],
                                 'horario': 9, 'proxima_em': '2026-10-15'})
    b = feed.criar('principal', {'titulo': 'B', 'legenda': 'y', 'tags': [], 'audio_url': None, 'transcricao': None,
                                 'imagem_url': None, 'regra': 'intervalo', 'intervalo_dias': 2, 'dias_semana': [],
                                 'horario': 9, 'proxima_em': '2026-10-16'})
    r = C.disparar(_utc(2026, 10, 16, 12, 5))
    assert r['publicada'] == b['id']
    assert 'feed fora' in feed.linhas[a['id']]['ultimo_erro']
    assert feed.linhas[a['id']]['proxima_em'] == '2026-10-15'          # continua na fila


@pytest.fixture
def cliente(feed, monkeypatch):
    from backend.app import app
    app.config['TESTING'] = True
    monkeypatch.setattr(C, 'subir_midia', lambda conta, tipo, nome, dados, mime: f'https://feed/{tipo}/{nome}')
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c


def test_rota_cria_lista_edita_e_apaga(cliente, feed, monkeypatch):
    monkeypatch.setattr(C, 'hoje_brt', lambda: HOJE)
    r = cliente.post('/api/campanhas', json={
        'conta': 'locutores', 'titulo': 'Vozes que vendem', 'legenda': 'Spots toda sexta', 'tags': 'LocutoresIA',
        'regra': 'semana', 'dias_semana': [4], 'horario': 15, 'comeca_em': '2026-10-16',
        'audio_url': 'https://feed/audio/x.mp3'})
    d = r.get_json()
    assert d['success'], d
    cid = d['campanha']['id']
    assert d['campanha']['proxima_em'] == '2026-10-16'

    d = cliente.get('/api/campanhas').get_json()
    assert d['success'] and d['teto_diario'] == 1 and [c['id'] for c in d['campanhas']] == [cid]

    d = cliente.patch(f'/api/campanhas/{cid}', json={'conta': 'locutores', 'ativa': False}).get_json()
    assert d['success'] and feed.linhas[cid]['ativa'] is False

    d = cliente.patch(f'/api/campanhas/{cid}', json={'conta': 'locutores', 'legenda': 'nova', 'horario': 21}).get_json()
    assert d['success'] and feed.linhas[cid]['legenda'] == 'nova' and feed.linhas[cid]['horario'] == 21

    assert cliente.post('/api/campanhas/config', json={'teto_diario': 2}).get_json()['success']
    assert feed.teto == 2
    assert cliente.post('/api/campanhas/config', json={'teto_diario': 5}).status_code == 400

    assert cliente.delete(f'/api/campanhas/{cid}?conta=locutores').get_json()['success']
    assert feed.linhas == {}


def test_rota_recusa_preco_no_achadinhos(cliente, monkeypatch):
    monkeypatch.setattr(C, 'hoje_brt', lambda: HOJE)
    r = cliente.post('/api/campanhas', json={
        'conta': 'achadinhos', 'titulo': 'Ofertas', 'legenda': 'Air fryer por R$ 299', 'regra': 'intervalo',
        'intervalo_dias': 2, 'horario': 9, 'comeca_em': '2026-10-16'})
    assert r.status_code == 400 and 'R$ 299' in r.get_json()['error']


def test_rota_sobe_midia(cliente):
    import base64
    d = cliente.post('/api/campanhas/midia', json={
        'conta': 'locutores', 'tipo': 'imagem', 'nome': 'logo', 'mime': 'image/png',
        'base64': 'data:image/png;base64,' + base64.b64encode(b'png').decode()}).get_json()
    assert d['success'] and d['url'] == 'https://feed/imagem/logo'


def test_cron_exige_segredo(cliente, monkeypatch):
    monkeypatch.setenv('CRON_SECRET', 'abc')
    assert cliente.get('/api/cron/campanhas').status_code == 401
    monkeypatch.setattr(C, 'disparar', lambda agora=None: {'publicada': None, 'motivo': 'teste'})
    r = cliente.get('/api/cron/campanhas', headers={'Authorization': 'Bearer abc'})
    assert r.status_code == 200 and r.get_json()['motivo'] == 'teste'


# ── telas ───────────────────────────────────────────────────────────────────

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*p):
    return open(os.path.join(RAIZ, *p), encoding='utf-8').read()


def test_vercel_tem_os_tres_disparos():
    import json
    crons = json.loads(_ler('vercel.json'))['crons']
    horarios = sorted(c['schedule'] for c in crons if c['path'] == '/api/cron/campanhas')
    assert horarios == ['0 0 * * *', '0 12 * * *', '0 18 * * *']


def test_pagina_e_menu(cliente):
    assert cliente.get('/campanhas').status_code == 200
    assert 'href="/campanhas"' in _ler('templates', 'index.html')


def test_gerador_tem_o_botao_agendar():
    html = _ler('templates', 'gerador.html')
    assert 'id="btnAgendarCampanha"' in html and '/static/agendar-campanha.js' in html
