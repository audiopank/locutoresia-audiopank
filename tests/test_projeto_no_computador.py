"""Salvar / Abrir projeto NO COMPUTADOR — modelo do Samplitude (30/09/2026).

Pedido dele depois do bloqueio do Supabase (cota de arquivos estourada pelos WAVs de
projeto): "salvar o VIP (projeto e trilhas + vozes) dentro da própria pasta local".
O projeto vira uma PASTA: projeto.locutores-ia.json + Audio/ com cada voz e trilha em
WAV. Não gasta nada da nuvem e os WAVs abrem no Samplitude. File System Access API
(Chrome/Edge no computador).

Regras testadas aqui:
- UM empacotamento e UMA montagem na tela para nuvem e pasta (o .vip antigo morreu por
  ter o próprio empacotador, que envelheceu e passou a perder cortes/stretch/master).
- Mesmo nome + pasta já vinculada = salva na mesma pasta; nome novo = escolher pasta.
- Pasta com OUTRO projeto dentro: pergunta antes de substituir (lição de 17/09).
- Cada áudio é gravado uma vez por pasta; o .json é gravado por último.
- Abrir do computador não vincula a projeto da nuvem (projetoId = null) e só aceita
  áudio dentro de Audio/ da própria pasta.

Rodar: pytest tests/test_projeto_no_computador.py -v
"""
import os

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


def _js():
    return _ler('static', 'minidaw.js')


def _metodo(js, assinatura):
    ini = js.index(assinatura)
    fim = js.index('\n    }\n', ini)
    return js[ini:fim]


def test_botoes_na_tela_e_versao_nova():
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    html = c.get('/minidaw').get_data(as_text=True)
    assert 'onclick="salvarNoComputador(event)"' in html and 'onclick="abrirDoComputador()"' in html
    # Botão com texto não pode herdar o quadrado de 40px do ícone (o texto quebrava em 3 linhas).
    assert 'class="control-btn com-texto" onclick="salvarNoComputador(event)"' in html and '.control-btn.com-texto {' in html
    assert 'minidaw.js?v=75' in html
    js = _js()
    assert 'window.salvarNoComputador = (ev) => minidaw.salvarNoComputador(ev);' in js
    assert 'window.abrirDoComputador = () => minidaw.abrirDoComputador();' in js


def test_um_so_empacotamento_e_uma_so_montagem():
    js = _js()
    assert js.count('    async _empacotarProjeto(comAudio, guardarAudio) {') == 1
    assert 'td.buffers.push(await guardarAudio(c, t, i, idx));' in js
    assert 'await this._empacotarProjeto(comAudio, guardarNaNuvem)' in _metodo(js, '    async salvarProjetoSupabase() {')
    assert 'await this._empacotarProjeto(comAudio, guardarNaPasta)' in _metodo(js, '    async salvarNoComputador(ev) {')
    assert js.count('    async _montarProjeto(proj, carregarAudio) {') == 1
    assert 'await this._montarProjeto(proj, ' in _metodo(js, '    async carregarProjetoSupabase(id) {')
    assert 'await this._montarProjeto(proj, ' in _metodo(js, '    async abrirDoComputador() {')


def test_salvar_no_computador_regras():
    js = _js()
    s = _metodo(js, '    async salvarNoComputador(ev) {')
    assert 'if (!this._suportaPasta()) {' in s
    # 30/09: o navegador só abre o seletor DENTRO do clique. Nenhum prompt/confirm
    # pode vir antes dele ("Must be handling a user gesture to show a file picker").
    assert s.index('await window.showDirectoryPicker(') < s.index('prompt(')
    assert s.index('await window.showDirectoryPicker(') < s.index('confirm(')
    assert '(!outraPasta && this._pastaProjeto) ? this._pastaProjeto : null' in s   # pasta vinculada = salva direto
    assert 'const outraPasta = !!(ev && ev.shiftKey);' in s                          # Shift+clique = outra pasta
    assert 'await this._permissaoDaPasta(pasta)' in s
    assert 'já tem o projeto' in s and 'confirm(' in s                             # pasta com outro projeto
    assert 'isSameEntry' in s
    assert 'this._arquivosLocais.get(c.buffer)' in s                                # áudio uma vez por pasta
    assert s.index('await this._empacotarProjeto(') < s.index('getFileHandle(ARQUIVO_PROJETO_LOCAL, { create: true })')   # .json por último
    assert "formato: 'locutores-ia-projeto'" in s
    assert "if (e && e.name === 'AbortError') return;" in s                         # cancelar o seletor não é erro


def test_abrir_do_computador_regras():
    js = _js()
    a = _metodo(js, '    async abrirDoComputador() {')
    assert a.index('await this._lerProjetoDaPasta(pasta)') < a.index('this.clearAllTracks(true);') < a.index('await this._montarProjeto(proj, ')
    assert r'/^Audio\/[^\/\\]+$/.test(b.arquivo)' in a
    assert 'this.projetoId = null;' in a
    assert a.index('await this._montarProjeto(proj, ') < a.index('this._pastaProjeto = pasta;')
    assert "const ARQUIVO_PROJETO_LOCAL = 'projeto.locutores-ia.json';" in js


def test_limpar_a_bancada_desvincula_a_pasta():
    js = _js()
    limpar = js[js.index('    clearAllTracks(skipConfirm = false) {'):]
    limpar = limpar[:limpar.index('\n    }\n')]
    assert 'this._pastaProjeto = null;' in limpar
    assert 'this._arquivosLocais = new WeakMap();' in limpar
