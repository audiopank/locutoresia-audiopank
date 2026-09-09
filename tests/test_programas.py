"""Preset de programa (Vida Saudável) no Gerador: partes fixas, miolo, CTA e endpoints.

Rodar: pytest tests/test_programas.py -v

Sem rede e sem IA: o Gemini e o feed entram como dublês.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest

from core import programas as pr


# ── funções puras ────────────────────────────────────────────────────────────

@pytest.mark.parametrize('n,esperado', [
    (1, 'um'), (2, 'dois'), (3, 'três'), (10, 'dez'), (15, 'quinze'), (19, 'dezenove'),
    (20, 'vinte'), (21, 'vinte e um'), (99, 'noventa e nove'), (100, 'cem'),
    (101, 'cento e um'), (250, 'duzentos e cinquenta'), (365, 'trezentos e sessenta e cinco'),
    (1000, '1000'), ('7', 'sete'), ('x', 'x'),
])
def test_numero_por_extenso(n, esperado):
    assert pr.numero_por_extenso(n) == esperado


def test_montar_roteiro_tem_as_quatro_partes_na_ordem():
    r = pr.montar_roteiro('vida', 3, 'Miolo do episódio.')
    partes = r.split('\n\n')
    assert partes[0] == 'Vida Saudável, um minuto e meio por dia sobre saúde e bem-estar. Episódio três.'
    assert partes[1] == 'Miolo do episódio.'
    assert partes[2] == 'Este conteúdo é informativo e não substitui a orientação do seu médico.'
    assert partes[3].startswith('Vida Saudável é produzido por Locutores IA, Áudio Pank Produtora. Esse espaço pode ser da sua marca.')
    assert partes[3].endswith('oitenta e cinco, nove, nove dois dois seis, dois dois nove sete.')
    assert len(partes) == 4


def test_montar_roteiro_com_patrocinador_troca_o_slot():
    r = pr.montar_roteiro('vida', 4, 'Miolo.', patrocinador='Farmácia Boa Saúde')
    assert 'Um oferecimento de Farmácia Boa Saúde.' in r
    assert 'Esse espaço pode ser da sua marca' not in r


def test_montar_roteiro_limpa_direcao_e_rotulo_do_miolo():
    r = pr.montar_roteiro('vida', 1, '[fale calmo]\nLOCUTOR: Texto do miolo.\n\n\n\nSegunda parte.')
    assert '[fale calmo]' not in r and 'LOCUTOR' not in r
    assert 'Texto do miolo.\n\nSegunda parte.' in r


ROTEIRO_SUNO = """[Falado - Ritmo jornalístico]
Vida Saudável, um minuto e meio por dia sobre saúde e bem-estar. Episódio TRÊS:

Você bate a meta de 5 porções de frutas e verduras por dia? Atenção!
Um novo estudo revela que só isso pode não ser suficiente para proteger o seu coração.

O segredo está nos flavonoides![45-80s - DADO DE IMPACTO + SOLUÇÃO][Falado - Tom de alerta + esperança]
O problema? A maioria das pessoas não alcança a ingestão ideal dessas substâncias!

Fica a dica! Mais cor no prato, mais vida no coração!
Este conteúdo é informativo e não substitui a orientação do seu médico.

Vida Saudável é produzido por Locutores IA, Áudio Pank Produtora. Esse espaço pode ser da sua marca. Informações pelo WhatsApp: oitenta e cinco, nove, nove dois dois seis, dois dois nove sete.
[SFX: Vinheta de saída]"""


def test_limpar_miolo_tira_marcacoes_em_qualquer_posicao():
    t = pr.limpar_miolo('Frase um.[45-80s - DADO][Falado - alerta]\nFrase dois.\n[SFX: saída]')
    assert '[' not in t and ']' not in t
    assert t == 'Frase um.\nFrase dois.'


def test_extrair_miolo_do_roteiro_inteiro_colado_do_suno():
    miolo, removidas = pr.extrair_miolo('vida', ROTEIRO_SUNO)
    assert removidas == ['vinheta', 'aviso', 'fecho']
    assert miolo.startswith('Você bate a meta de 5 porções')
    assert miolo.endswith('Mais cor no prato, mais vida no coração!')
    assert 'Episódio' not in miolo and 'orientação do seu médico' not in miolo
    assert 'Locutores IA' not in miolo and 'nove sete' not in miolo and '[' not in miolo
    # remontado, o roteiro tem cada parte fixa UMA vez só
    r = pr.montar_roteiro('vida', 3, miolo)
    assert r.count('Episódio três') == 1 and r.count('orientação do seu médico') == 1 and r.count('nove sete') == 1


def test_extrair_miolo_com_patrocinador_no_fecho_colado():
    texto = ('Miolo aqui.\n\nVida Saudável é produzido por Locutores IA, Áudio Pank Produtora. '
             'Um oferecimento de Farmácia X. Informações pelo WhatsApp: oitenta e cinco, nove, nove dois dois seis, dois dois nove sete')
    miolo, removidas = pr.extrair_miolo('vida', texto)
    assert miolo == 'Miolo aqui.' and removidas == ['fecho']


def test_extrair_miolo_sem_partes_fixas_devolve_limpo():
    assert pr.extrair_miolo('vida', '  Só o miolo.  ') == ('Só o miolo.', [])


def test_montar_roteiro_programa_desconhecido():
    with pytest.raises(ValueError):
        pr.montar_roteiro('nao-existe', 1, 'x')


def test_partes_fixas_somam_o_esperado_para_caber_em_90s():
    fixo = pr.montar_roteiro('vida', 3, '')
    assert 50 <= pr.contar_palavras(fixo) <= 65, pr.contar_palavras(fixo)


def test_nome_do_spot_sem_cerquilha():
    assert pr.nome_do_spot('vida', 3, ' sono e imunidade ') == 'Vida Saudável, episódio 3: sono e imunidade'
    assert '#' not in pr.nome_do_spot('vida', 3, 'x')
    assert pr.nome_do_spot('vida', 3, '') == 'Vida Saudável, episódio 3'


def test_cta_da_conta():
    assert pr.cta_da_conta('vida').startswith('Qual tema de saúde')
    assert pr.cta_da_conta('locutores') is None
    assert pr.cta_da_conta('principal') is None


def test_contar_palavras_e_alvo():
    assert pr.contar_palavras('  um  dois\ntrês ') == 3
    assert pr.miolo_dentro_do_alvo('vida', ' '.join(['p'] * 145))
    assert pr.miolo_dentro_do_alvo('vida', ' '.join(['p'] * 120))       # folga de 20
    assert not pr.miolo_dentro_do_alvo('vida', ' '.join(['p'] * 60))
    assert not pr.miolo_dentro_do_alvo('vida', ' '.join(['p'] * 220))


def test_alertas_editoriais():
    assert pr.alertas_editoriais('Beba água e durma bem.') == []
    avisos = pr.alertas_editoriais('Tome 500 mg de vitamina, dois comprimidos, e o remédio cura.')
    assert len(avisos) == 1
    for palavra in ('mg', 'comprimidos', 'remédio', 'cura'):
        assert palavra in avisos[0]


def test_prompt_miolo_carrega_regras_tema_e_alvo():
    p = pr.prompt_miolo('vida', 'sono e imunidade', patrocinador='Farmácia X')
    assert 'sono e imunidade' in p
    assert 'entre 135 e 155 palavras' in p
    assert 'PROIBIDO' in p and 'Um:' in p
    assert 'Farmácia X' in p and 'NÃO o cite' in p
    assert '"miolo"' in p
    assert 'Farmácia' not in pr.prompt_miolo('vida', 'tema')


def test_lista_para_tela_traz_ajustes_que_a_tela_trava():
    lista = pr.lista_para_tela()
    assert lista[0]['id'] == 'vida' and lista[0]['conta_feed'] == 'vida'
    a = lista[0]['ajustes']
    assert a['voz_contem'] == 'Charon' and a['modo'] == 'padrao' and a['gate'] is True
    assert lista[0]['miolo_palavras'] == [135, 155]


# ── endpoints ────────────────────────────────────────────────────────────────

@pytest.fixture
def cliente():
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c


def test_get_programas(cliente):
    d = cliente.get('/api/gerador/programas').get_json()
    assert d['success'] and d['programas'][0]['id'] == 'vida'


def test_proximo_episodio_le_o_feed(cliente, monkeypatch):
    import core.newpost_feed as nf
    monkeypatch.setattr(nf, 'proximo_episodio', lambda conta: 3 if conta == 'vida' else None)
    d = cliente.get('/api/gerador/programa/vida/proximo-episodio').get_json()
    assert d == {'success': True, 'episodio': 3, 'fonte': 'feed'}


def test_proximo_episodio_feed_indisponivel_pede_o_numero(cliente, monkeypatch):
    import core.newpost_feed as nf
    monkeypatch.setattr(nf, 'proximo_episodio', lambda conta: None)
    d = cliente.get('/api/gerador/programa/vida/proximo-episodio').get_json()
    assert d['success'] and d['episodio'] is None and d['fonte'] == 'indisponivel' and d['aviso']


def test_proximo_episodio_programa_desconhecido(cliente):
    assert cliente.get('/api/gerador/programa/xyz/proximo-episodio').status_code == 404


def test_roteiro_com_miolo_pronto_nao_chama_a_ia(cliente, monkeypatch):
    import backend.app as m

    def boom(*a, **k):
        raise AssertionError('não deveria chamar a IA')
    monkeypatch.setattr(m, '_escrever_miolo_com_ia', boom)
    miolo = ' '.join(['palavra'] * 140)
    d = cliente.post('/api/gerador/programa/roteiro', json={
        'programa': 'vida', 'tema': 'sono', 'episodio': 3, 'miolo': miolo, 'patrocinador': ''}).get_json()
    assert d['success'] and d['fonte'] == 'pronto'
    assert d['roteiro'].startswith('Vida Saudável, um minuto e meio por dia sobre saúde e bem-estar. Episódio três.')
    assert d['roteiro'].endswith('dois dois nove sete.')
    assert d['nome_spot'] == 'Vida Saudável, episódio 3: sono'
    assert d['palavras_miolo'] == 140 and d['alvo_miolo'] == [135, 155]
    assert d['conta_feed'] == 'vida' and d['avisos'] == []
    assert d['tempo_leitura_estimado'] > 60


def test_roteiro_sem_miolo_chama_a_ia(cliente, monkeypatch):
    import backend.app as m
    chamadas = []

    def ia(pid, tema, patrocinador=''):
        chamadas.append((pid, tema, patrocinador))
        return ' '.join(['ia'] * 150), 'gancho pela pergunta'
    monkeypatch.setattr(m, '_escrever_miolo_com_ia', ia)
    d = cliente.post('/api/gerador/programa/roteiro', json={
        'programa': 'vida', 'tema': 'hidratação', 'episodio': 5, 'patrocinador': 'Farmácia X'}).get_json()
    assert d['success'] and d['fonte'] == 'ia' and d['resumo'] == 'gancho pela pergunta'
    assert chamadas == [('vida', 'hidratação', 'Farmácia X')]
    assert 'Um oferecimento de Farmácia X.' in d['roteiro']
    assert d['miolo'].startswith('ia ia')


def test_roteiro_ia_falhou_diz_para_colar_o_miolo(cliente, monkeypatch):
    import backend.app as m

    def ia(*a, **k):
        raise RuntimeError('cota estourada')
    monkeypatch.setattr(m, '_escrever_miolo_com_ia', ia)
    d = cliente.post('/api/gerador/programa/roteiro', json={'programa': 'vida', 'tema': 't', 'episodio': 2}).get_json()
    assert not d['success'] and 'cota estourada' in d['error'] and 'miolo' in d['error'].lower()


def test_roteiro_com_roteiro_inteiro_colado_nao_duplica_partes_fixas(cliente):
    d = cliente.post('/api/gerador/programa/roteiro', json={
        'programa': 'vida', 'tema': 'flavonoides', 'episodio': 3, 'miolo': ROTEIRO_SUNO}).get_json()
    assert d['success'] and d['fonte'] == 'pronto'
    assert d['roteiro'].count('Episódio três') == 1
    assert d['roteiro'].count('orientação do seu médico') == 1
    assert d['roteiro'].count('nove sete') == 1
    assert '[' not in d['roteiro']
    assert any('partes fixas' in a for a in d['avisos'])


def test_roteiro_avisa_miolo_fora_do_alvo_e_palavra_proibida(cliente, monkeypatch):
    d = cliente.post('/api/gerador/programa/roteiro', json={
        'programa': 'vida', 'tema': 't', 'episodio': 2, 'miolo': 'Tome dois comprimidos e pronto.'}).get_json()
    assert d['success']
    assert any('alvo' in a for a in d['avisos'])
    assert any('comprimidos' in a for a in d['avisos'])


def test_roteiro_valida_entrada(cliente):
    assert cliente.post('/api/gerador/programa/roteiro', json={'programa': 'xyz', 'episodio': 1, 'miolo': 'x'}).status_code == 400
    assert cliente.post('/api/gerador/programa/roteiro', json={'programa': 'vida', 'episodio': 0, 'miolo': 'x'}).status_code == 400
    assert cliente.post('/api/gerador/programa/roteiro', json={'programa': 'vida', 'episodio': 'abc', 'miolo': 'x'}).status_code == 400
    assert cliente.post('/api/gerador/programa/roteiro', json={'programa': 'vida', 'episodio': 1}).status_code == 400


# ── CTA e episódio explícito no botão Feed ───────────────────────────────────

def _dubles_do_feed(monkeypatch, serie):
    import core.newpost_feed as real
    chamadas = {}
    monkeypatch.setattr(real, 'conta_configurada', lambda conta: True)
    monkeypatch.setattr(real, 'subir_audio', lambda nome, dados, conta='principal': f'https://audio/{conta}.mp3')
    monkeypatch.setattr(real, 'serie_da_conta', lambda conta: serie)

    def publicar(conteudo, **kw):
        chamadas.update(kw, conteudo=conteudo)
        return {'success': True, 'post_id': 'P', 'series_id': kw.get('series_id'), 'episode_number': kw.get('episode_number')}
    monkeypatch.setattr(real, 'publicar', publicar)
    return chamadas


AUDIO = 'data:audio/mpeg;base64,' + 'QUJD' * 10


def test_feed_vida_leva_cta_antes_das_hashtags_e_episodio_explicito(cliente, monkeypatch):
    chamadas = _dubles_do_feed(monkeypatch, {'id': 'S1', 'titulo': 'Vida Saudável'})
    d = cliente.post('/api/gerador/publicar-feed', json={
        'conta': 'vida', 'nome': 'Vida Saudável, episódio 3: sono', 'texto': 'Roteiro.',
        'audio_base64': AUDIO, 'episodio': 3}).get_json()
    assert d['success'] and d['episodio'] == 3
    c = chamadas['conteudo']
    assert c.startswith('🎙️ Vida Saudável, episódio 3: sono\n\nRoteiro.')
    assert '\n\nQual tema de saúde você quer ouvir no próximo episódio? Comenta aqui ou manda um áudio.\n\n#VidaSaudavel' in c
    assert chamadas['episode_number'] == 3


def test_feed_episodio_explicito_vence_o_cerquilha(cliente, monkeypatch):
    chamadas = _dubles_do_feed(monkeypatch, {'id': 'S1', 'titulo': 'Vida Saudável'})
    cliente.post('/api/gerador/publicar-feed', json={
        'conta': 'vida', 'nome': 'Vida Saudável #9: x', 'texto': 'x', 'audio_base64': AUDIO, 'episodio': 4})
    assert chamadas['episode_number'] == 4


def test_feed_locutores_sem_cta(cliente, monkeypatch):
    chamadas = _dubles_do_feed(monkeypatch, None)
    cliente.post('/api/gerador/publicar-feed', json={
        'conta': 'locutores', 'nome': 'Barbearia', 'texto': 'x', 'audio_base64': AUDIO})
    assert 'Qual tema' not in chamadas['conteudo']
    assert chamadas['episode_number'] is None
