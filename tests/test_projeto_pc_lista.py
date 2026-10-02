"""Abrir do PC com LISTA dos spots da pasta geral + pasta lembrada (30/09/2026).

Pedido dele: "e quando tiver 5 projetos de spots diferentes dentro dessa pasta geral?"
Agora, escolhendo a pasta geral no Abrir do PC, a MiniDAW lista os projetos que estão
nas subpastas (nome + data do último salvamento, mais recente primeiro) e abre com um
clique — parecido com os projetos recentes do Samplitude. A pasta geral fica LEMBRADA
(IndexedDB do navegador): da próxima vez, um clique de permissão e a lista aparece.
Pasta de UM projeto só continua abrindo direto, como antes.

Rodar: pytest tests/test_projeto_pc_lista.py -v
"""
import os

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _js():
    return open(os.path.join(RAIZ, 'static', 'minidaw.js'), encoding='utf-8').read()


def _metodo(js, assinatura):
    ini = js.index(assinatura)
    return js[ini:js.index('\n    }\n', ini)]


def test_abrir_usa_a_pasta_lembrada_com_um_clique_de_permissao():
    a = _metodo(_js(), '    async abrirDoComputador() {')
    # A permissão da pasta lembrada é pedida PRIMEIRO, dentro do clique (senão o
    # navegador recusa, como aconteceu com o seletor em 30/09).
    assert a.index('await this._permissaoDaPasta(geral)') < a.index('await window.showDirectoryPicker(')
    assert 'await this._abrirOuListarPasta(pasta);' in a
    antes_do_seletor = a[a.index('try {'):a.index('await window.showDirectoryPicker(')]
    for dialogo in ('prompt(', 'confirm(', 'alert('):
        assert dialogo not in antes_do_seletor, dialogo                  # nada que gaste o gesto do clique


def test_pasta_de_um_projeto_abre_direto_e_pasta_geral_vira_lista():
    js = _js()
    f = _metodo(js, '    async _abrirOuListarPasta(pasta) {')
    assert 'if (!subs.length && raiz) return this._abrirProjetoDaPasta(raiz.pasta, raiz.proj);' in f
    assert 'await this._lembrarPastaGeral(pasta);' in f
    assert 'this._mostrarListaDoPC(pasta, lista);' in f
    p = _metodo(js, '    async _projetosNaPasta(pasta) {')
    assert 'for await (const [nome, h] of pasta.entries())' in p
    assert "if (h.kind !== 'directory' || nome === 'Audio') continue;" in p
    assert "lista.sort((a, b) => String(b.proj.salvo_em || '').localeCompare(String(a.proj.salvo_em || '')));" in p


def test_lista_mostra_nome_e_data_sem_virar_html():
    l = _metodo(_js(), '    _mostrarListaDoPC(pasta, lista) {')
    assert 'nome.textContent = item.proj.name' in l                   # nome é DADO, não HTML
    assert 'this._dataHoraBrasil(item.proj.salvo_em)' in l
    assert "'Escolher outra pasta'" in l
    assert 'this._abrirProjetoDaPasta(item.pasta, item.proj)' in l
    assert 'innerHTML' not in l                                        # tudo por createElement/textContent


def test_pasta_geral_fica_lembrada_no_navegador():
    js = _js()
    assert "indexedDB.open('locutores-ia', 1)" in js
    assert "put(pasta, 'pastaGeral')" in js and "get('pastaGeral')" in js
    assert 'minidaw._carregarPastaGeral();' in js                       # carrega ao abrir a página
    s = _metodo(js, '    async salvarNoComputador(ev) {')
    assert "startIn: this._pastaGeral || 'documents'" in s              # seletor já abre na pasta geral
    assert 'await this._lembrarPastaGeral(pai);' in s                   # salvar numa subpasta lembra a geral


def test_versao():
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    assert 'minidaw.js?v=80' in c.get('/minidaw').get_data(as_text=True)
