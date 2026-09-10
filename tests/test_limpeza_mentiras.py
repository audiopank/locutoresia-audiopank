"""Limpeza do menu Ferramentas (10/09/2026): as telas inventadas viraram redirect
e as reais perderam os números fixos. Rodar: pytest tests/test_limpeza_mentiras.py -v

Os testes de página batem na rede (Supabase do feed) via /api/health e
/api/advanced/trends — são lentos, mas é isso que prova que sobrou só o medido.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest


@pytest.fixture(scope='module')
def cliente():
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c


@pytest.mark.parametrize('rota,destino', [
    ('/automation', '/agendamento'),
    ('/draft_approval', '/social-posts'),
    ('/painel', '/studio'),
])
def test_telas_inventadas_viraram_redirect(cliente, rota, destino):
    r = cliente.get(rota)
    assert r.status_code in (301, 302)
    assert r.headers['Location'].endswith(destino)


@pytest.mark.parametrize('rota', ['/api/automation/state', '/api/automation/execute/news'])
def test_endpoints_falsos_da_automacao_sumiram(cliente, rota):
    assert cliente.get(rota).status_code in (404, 405)


def test_health_so_traz_o_medido_ou_conferido(cliente):
    d = cliente.get('/api/health').get_json()
    assert 'system_metrics' not in d and 'endpoints' not in d
    assert set(d['services']) == {'api', 'supabase', 'gemini', 'tts'}
    assert 'tokens' not in d['services']['gemini'] and 'detalhe' in d['services']['gemini']
    assert 'usage' not in d['services']['tts'] and 'detalhe' in d['services']['tts']
    assert 'LMNT' not in d['services']['tts']['detalhe']
    assert d['services']['supabase']['latency_ms'] not in (120, 500)


# "Sentimento" sozinho não entra: em /noticias é o tom emocional que a IA
# analisou de verdade numa notícia. O falso era o placeholder 40/45/15.
MENTIRAS_DE_TELA = ['24/7', 'Sentimento Geral', 'Distribuição de Sentimentos', 'Análise de Sentimentos',
                    'vs período anterior', 'Tendência positiva', 'Equilibrado', 'Precisão ML',
                    'Métricas do Sistema', 'Endpoints da API', 'href="/automation"', 'href="/draft_approval"',
                    'href="/painel"', 'Backup Completo', 'Limpeza Automática', 'CPU Usage']


@pytest.mark.parametrize('rota', ['/api/status', '/dashboard', '/dashboard-advanced', '/dashboard-profissional',
                                  '/agendamento', '/ai-dashboard', '/contato', '/noticias', '/social-posts'])
def test_paginas_reais_sem_mentiras(cliente, rota):
    r = cliente.get(rota)
    assert r.status_code == 200, rota
    html = r.get_data(as_text=True)
    sobras = [m for m in MENTIRAS_DE_TELA if m in html]
    assert not sobras, f'{rota} ainda mostra {sobras}'


def test_dashboards_mantem_o_que_e_real(cliente):
    html = cliente.get('/dashboard').get_data(as_text=True)
    assert 'dados reais do feed' in html and 'stat-posts' in html
    html = cliente.get('/dashboard-profissional').get_data(as_text=True)
    assert 'Tópicos em Alta' in html and 'sourcesChart' in html and 'sentimentChart' not in html


def test_trends_nao_inventa_sentimento(cliente):
    d = cliente.get('/api/advanced/trends?hours=24').get_json()
    assert d['success']
    assert 'sentiment_distribution' not in d['trends']
    assert 'by_source' in d['trends'] and 'trending_topics' in d['trends']
