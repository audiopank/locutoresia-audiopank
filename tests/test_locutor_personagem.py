"""Cartões de locutor na vitrine (12/11/2026): cada demo de voz pode ter um "locutor" (personagem).

O nome mora na coluna `artist` da music_tracks (sem SQL novo): o padrão "Locutores IA" = sem
personagem. GET /api/voice-demos devolve `locutor`; PATCH aceita `locutor` ('' ou '-' tira).
Rodar: pytest tests/test_locutor_personagem.py -v
"""
import types

import pytest


class _Consulta:
    def __init__(self, banco):
        self.banco, self.filtros, self.mudanca = banco, [], None

    def select(self, *a):
        return self

    def eq(self, campo, valor):
        self.filtros.append((campo, valor))
        return self

    def order(self, *a, **k):
        return self

    def update(self, campos):
        self.mudanca = campos
        return self

    def execute(self):
        linhas = [l for l in self.banco if all(l.get(c) == v for c, v in self.filtros)]
        if self.mudanca is not None:
            for l in linhas:
                l.update(self.mudanca)
        return types.SimpleNamespace(data=linhas)


@pytest.fixture
def cliente(monkeypatch):
    import backend.app as m
    banco = [
        {'id': 'v1', 'name': 'Locutores IA- Voz Iapetus', 'description': 'Masculino • Adulto', 'mood': 'institucional',
         'genre': 'demo_voz', 'is_active': True, 'file_url': 'https://x/v1.mp3', 'artist': 'Locutores IA'},
        {'id': 'v2', 'name': 'Locutores IA- Voz Puck', 'description': '', 'mood': 'jovem',
         'genre': 'demo_voz', 'is_active': True, 'file_url': 'https://x/v2.mp3', 'artist': 'Adriano Satti'},
    ]
    sup = types.SimpleNamespace(newpost_manager_client=types.SimpleNamespace(table=lambda t: _Consulta(banco)))
    monkeypatch.setattr(m, 'supabase_manager', sup)
    m.app.config['TESTING'] = True
    c = m.app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c, banco


def _demos(c):
    d = c.get('/api/voice-demos').get_json()
    return {dm['id']: dm for cat in d['categorias'] for dm in cat['demos']}


def test_get_devolve_o_locutor_e_esconde_o_padrao(cliente):
    c, _ = cliente
    demos = _demos(c)
    assert demos['v2']['locutor'] == 'Adriano Satti'
    assert demos['v1']['locutor'] is None                 # "Locutores IA" = sem personagem


def test_patch_da_e_tira_o_locutor(cliente):
    c, banco = cliente
    r = c.patch('/api/voice-demos/v1', json={'locutor': '  Marta Brasil  '})
    assert r.status_code == 200
    assert banco[0]['artist'] == 'Marta Brasil'
    c.patch('/api/voice-demos/v1', json={'locutor': '-'})
    assert banco[0]['artist'] == 'Locutores IA'
    assert banco[0]['name'] == 'Locutores IA- Voz Iapetus'   # o resto não mexe


def test_vitrine_e_demos_mostram_o_locutor():
    import os
    raiz = os.path.join(os.path.dirname(__file__), '..')
    vit = open(os.path.join(raiz, 'templates', 'landing.html'), encoding='utf-8').read()
    assert 'class="amostra-avatar"' in vit and 'personagens das nossas vozes de IA' in vit
    adm = open(os.path.join(raiz, 'templates', 'demos-voz.html'), encoding='utf-8').read()
    assert "Nome do locutor (personagem)" in adm
