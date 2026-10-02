"""Presets da MiniDAW sem depender do Supabase (02/10/2026).

Com o ykswh bloqueado (402), o GET de /api/master-presets engolia o erro e respondia
"success, lista vazia": a tela confiou e apagou a cópia local — o "Preset 01 – Crato" sumiu
e nada novo guardava. Agora: o servidor NUNCA mente lista vazia (503 quando não consegue
ler) e nunca regrava a nuvem a partir de uma leitura que falhou; a tela guarda no navegador
(static/presets-locais.js) e usa a nuvem só como bônus. Nasce também o preset POR FAIXA.

Rodar: pytest tests/test_presets_locais.py -v
"""
import os

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


class _Quebrado:
    """Cliente do Supabase que falha como o ykswh bloqueado."""
    def table(self, *_):
        raise RuntimeError("{'message': 'Service for this project is restricted: exceed_storage_size_quota'}")


def _cliente(monkeypatch, gravados=None):
    from backend import app as modulo
    monkeypatch.setattr(modulo.supabase_manager, 'newpost_manager_client', _Quebrado())
    if gravados is not None:
        monkeypatch.setattr(modulo, '_gravar_master_presets', lambda lista: gravados.append(lista))
    modulo.app.config['TESTING'] = True
    c = modulo.app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c


def test_get_com_banco_fora_nao_mente_lista_vazia(monkeypatch):
    r = _cliente(monkeypatch).get('/api/master-presets')
    d = r.get_json()
    assert r.status_code == 503 and d['success'] is False and 'presets' not in d


def test_post_e_delete_com_banco_fora_nao_regravam_a_nuvem(monkeypatch):
    gravados = []
    c = _cliente(monkeypatch, gravados)
    master = {'eq': {'ligado': True}}
    r = c.post('/api/master-presets', json={'nome': 'Crato', 'master': master})
    assert r.status_code == 503 and r.get_json()['success'] is False
    r = c.delete('/api/master-presets/Crato')
    assert r.status_code == 503 and r.get_json()['success'] is False
    assert gravados == []                          # leitura falhou = não sobrescreve a lista da nuvem


def test_master_usa_o_navegador_e_a_nuvem_so_como_bonus():
    html = _ler('templates', 'minidaw.html')
    assert html.index('/static/presets-locais.js?v=2') < html.index('/static/master-suite.js?v=10')
    assert 'id="msPresetsExportar"' in html and 'id="msPresetsImportar"' in html
    suite = _ler('static', 'master-suite.js')
    assert 'PresetsLocais.ler(localStorage)' in suite
    assert "PresetsLocais.mesclar(banco, 'master', d.presets)" in suite        # nuvem que respondeu é mesclada
    assert "localStorage.setItem('minidaw_master_presets', JSON.stringify(presets.lista))" not in suite
    assert "'guardado'} neste computador`" in suite and 'A nuvem está fora' in suite   # aviso honesto
    assert 'PresetsLocais.exportar(banco)' in suite and 'PresetsLocais.importar(banco, texto)' in suite


def test_faixa_tem_presets_com_os_mesmos_efeitos_do_copiar():
    js = _ler('static', 'minidaw.js')
    for f in ('guardarPresetFaixa(trackId)', 'aplicarPresetFaixa(trackId, nome)', 'apagarPresetFaixa(trackId)',
              '_efeitosParaPreset(track)', '_preencherPresetsFaixa(track)'):
        assert f in js, f
    # mesma lista do _copiarEfeitos (volume/pan/fades ficam de fora: dosagem da pista)
    ini = js.index('    _efeitosParaPreset(track) {')
    bloco = js[ini:js.index('\n    }\n', ini)]
    for k in ('effects', 'eqSettings', 'gateSettings', 'deesserSettings', 'compressorSettings',
              'reverbAmount', 'delayAmount'):
        assert k in bloco, k
    for k in ('volume', 'pan', 'fadeIn', 'fadeOut'):
        assert k not in bloco, k
    assert "PresetsLocais.lista(banco, 'faixa', track.type)" in js           # voz só vê preset de voz
    assert 'o.textContent = p.nome;' in js                                    # nome nunca vira HTML
    assert 'id="presetfaixa_${track.id}"' in js
    html = _ler('templates', 'minidaw.html')
    assert 'minidaw.js?v=80' in html


def test_resumo_dos_presets_de_faixa_e_aviso_do_importar_que_se_explica():
    """02/10: importou o preset de VOZ com o projeto vazio, viu '0 novo, 0 atualizado' e achou
    que não importava — preset de faixa mora no cartão da faixa. Agora a barra do master mostra
    quantos existem e o aviso diz o que tinha no arquivo e o que já estava guardado."""
    html = _ler('templates', 'minidaw.html')
    assert 'id="msPresetsFaixaResumo"' in html
    suite = _ler('static', 'master-suite.js')
    assert 'function desenharResumoFaixas()' in suite
    assert "já estava(m) guardado(s) aqui" in suite and 'r.noArquivo.faixa' in suite
    js = _ler('static', 'minidaw.js')
    assert 'MasterSuite.desenharResumoFaixas()' in js
