# Receita do dia (perfil Receitas Favoritas) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tela interna `/receita-do-dia` onde a IA sugere receitas da Receiteria e prepara texto e foto. O produtor revisa e publica no perfil "Receitas Favoritas Grandes Dicas" da NewPost-IA. Substitui a automação da Base44 sem publicar nada sozinho.

**Architecture:**
- A lógica pura fica em `core/receita_do_dia.py`: ler o RSS, filtros de época/sensível/já publicada, montar a legenda, chamar o Gemini.
- O acesso ao feed fica em `core/newpost_feed.py`: conta nova `receitas`, `subir_imagem` no bucket `post-media` e `conteudos_da_conta`.
- Quatro rotas privadas `/api/receitas/*` e a página ficam em `backend/app.py`.
- A tela é `templates/receita_do_dia.html` com `static/receita-do-dia.js`.
- Toda foto vira JPEG de até 1080 px no navegador antes de subir.

**Tech Stack:** Flask, requests, xml.etree, google-genai 2.8.0 (`gemini-2.5-flash` texto, `gemini-2.5-flash-image` foto), JS puro, pytest.

**Fatos conferidos em 01/10/2026:**
- **RSS da Receiteria:** responde 200 com User-Agent de navegador. Traz 10 itens por página, e `?paged=80` ainda funciona (arquivo de anos).
- **Foto por IA:** a cota grátis de imagem do Gemini é `limit: 0`. A foto por IA só funciona com o faturamento ligado; até lá a tela oferece "Foto do computador" e "Sem foto".
- **Login da conta receitas:** `NEWPOST_FEED_*_RECEITAS` funcionam (perfil `3d5e6489`, 445 posts antigos).
- **Bucket das fotos:** o site da NewPost-IA sobe fotos em `post-media/<user_id>/<ts>-<n>.<ext>` (MediaUploadModal.tsx).

**Mudanças durante a execução (01/10/2026):**
- **Fonte:** passou a ser o feed de RECEITAS `/feed/?post_type=receita` (`&paged=N`, `PAGINA_MAX=150`). O `/feed/` principal só trazia matérias e listas, e o site posta pouco nele.
- **Página da receita:** o item do feed de receitas não tem resumo. Ao "Preparar", a rota lê a página da receita UMA vez (`detalhes_da_receita`): `og:description` e, do JSON-LD Recipe, ingredientes, `totalTime` e `recipeYield`. É o chão da IA pra não inventar.
- **Repetição:** os 340 posts antigos do perfil usam link curto `abrir.receiteria.com.br/s/…`. Eles foram resolvidos UMA vez (302) e a lista ficou em `core/receitas_publicadas_antigas.txt`, somada aos links completos lidos do feed.

---

### Task 1: Conta `receitas` + foto e leitura no feed (`core/newpost_feed.py`)

**Files:**
- Modify: `core/newpost_feed.py` (CONTAS, TAGS_POR_CONTA, docstring, novas `subir_imagem` e `conteudos_da_conta`)
- Test: `tests/test_receita_do_dia.py`

- [ ] **Step 1: Teste que falha**

```python
def test_conta_receitas_com_variaveis_proprias_e_hashtags_da_casa():
    from core import newpost_feed as nf
    assert nf.CONTAS['receitas'] == ('NEWPOST_FEED_EMAIL_RECEITAS', 'NEWPOST_FEED_SENHA_RECEITAS')
    assert nf.tags_da_conta('receitas') == ['ReceitasFavoritas', 'receitas', 'NewPostIA', 'Culinária', 'Dicas']
    assert nf.tags_da_conta('achadinhos') == ['Achadinhos', 'Ofertas']        # as outras não mudaram
    assert callable(nf.subir_imagem) and callable(nf.conteudos_da_conta)
```

- [ ] **Step 2:** `pytest tests/test_receita_do_dia.py -q` → FAIL (KeyError 'receitas').

- [ ] **Step 3: Implementar.** Em CONTAS, depois de `achadinhos`:

```python
    # Perfil "Receitas Favoritas Grandes Dicas" (receitas@gmail.com, da casa) —
    # assina a Receita do dia (/receita-do-dia), que substitui a Base44 (01/10/2026).
    'receitas': ('NEWPOST_FEED_EMAIL_RECEITAS', 'NEWPOST_FEED_SENHA_RECEITAS'),
```

Em TAGS_POR_CONTA: `'receitas': ['ReceitasFavoritas', 'receitas', 'NewPostIA', 'Culinária', 'Dicas'],`

Depois de `subir_audio`:

```python
def subir_imagem(nome, dados, conta='principal', mime='image/jpeg'):
    """Sobe uma FOTO pro storage do feed (bucket `post-media`, o mesmo do upload de
    mídia do próprio site — MediaUploadModal.tsx) e devolve a URL pública.

    Caminho no padrão do site: `<user_id>/<timestamp>-<slug>.<ext>`.
    Levanta exceção com mensagem clara em falha — quem chama decide a tela.
    """
    s = sessao(conta)
    url, anon = _cfg()
    ext = 'png' if mime == 'image/png' else 'jpg'
    caminho = f"{s['user_id']}/{int(time.time())}-{_slug_ascii(nome)}.{ext}"
    r = requests.post(f"{url}/storage/v1/object/post-media/{caminho}",
                      headers={'apikey': anon,
                               'Authorization': f"Bearer {s['access_token']}",
                               'Content-Type': mime},
                      data=dados, timeout=60)
    if not r.ok:
        raise RuntimeError(f'upload da imagem falhou ({r.status_code}): {(r.text or "")[:160]}')
    return f"{url}/storage/v1/object/public/post-media/{caminho}"


def conteudos_da_conta(conta, contem='', limite=1000):
    """`content` dos posts da PRÓPRIA conta (logado), do mais novo pro mais antigo.

    `contem` filtra por trecho (ILIKE). Serve pra saber o que já foi publicado
    (ex.: links da Receiteria). Levanta exceção se o feed não responder.
    """
    s = sessao(conta)
    url, anon = _cfg()
    params = {'select': 'content', 'author_id': f"eq.{s['user_id']}",
              'order': 'created_at.desc', 'limit': str(int(limite))}
    if contem:
        params['content'] = f'ilike.*{contem}*'
    r = requests.get(f'{url}/rest/v1/posts',
                     headers={'apikey': anon, 'Authorization': f"Bearer {s['access_token']}"},
                     params=params, timeout=20)
    r.raise_for_status()
    return [l.get('content') or '' for l in (r.json() or [])]
```

Na docstring do topo, depois de `NEWPOST_FEED_SENHA_VIDA`: `NEWPOST_FEED_EMAIL_RECEITAS` / `NEWPOST_FEED_SENHA_RECEITAS` (opcional, perfil Receitas Favoritas, Receita do dia).

- [ ] **Step 4:** teste passa.

### Task 2: Lógica da receita (`core/receita_do_dia.py`)

**Files:**
- Create: `core/receita_do_dia.py`
- Test: `tests/test_receita_do_dia.py`

Funções do módulo:
- RSS: `ler_feed(xml_bytes)`, `baixar_pagina(p)`.
- Filtros: `normalizar_link`, `links_publicados(conteudos)`, `_pascoa(ano)`, `fora_de_epoca(item, hoje)`, `motivo_bloqueio(item)`, `sugestoes(itens, publicados, hoje, maximo=8)`.
- Texto: `montar_legenda(emoji, titulo, resumo, link, extras)`, `hashtags_do_texto(texto)`, `preparar_texto(item)`.
- Foto: `gerar_foto(prompt)` → `(bytes, mime)`, com o erro próprio `FotoSemFaturamento`.

Os testes (fixture XML com Natal, bolo e link de fora) cobrem:
- leitura do RSS: unescape de entidades, data ISO, link de fora ignorado;
- Páscoa 2026-04-05 e 2027-03-28;
- janelas de época: Natal em 01/10 escondido, Natal em 10/12 liberado, janela que vira o ano, categoria também conta;
- motivos das escondidas: já publicada, Copa, sensível, fora de época;
- extração e normalização de links;
- formato exato da legenda: no máximo 2 hashtags extras, sem repetir as fixas;
- preparar sem IA (cai no trecho do RSS) e com IA (Client do google.genai simulado);
- erro 429 `limit: 0` vira `FotoSemFaturamento`.

### Task 3: Rotas privadas (`backend/app.py`)

Ficam antes do comentário `# Publieditorial/oferta de varejo`. NÃO entram em ROTAS_PUBLICAS.
- `GET /receita-do-dia` → `receita_do_dia.html`.
- `GET /api/receitas/sugestoes`:
  - busca a página 1 e uma página sorteada (2..80); com `?outras=1`, só uma sorteada;
  - tira o que já foi publicado (lendo os posts da conta), o sensível, a Copa e o fora de época;
  - devolve `{itens, escondidas, conta_ok, aviso, paginas}`.
- `POST /api/receitas/preparar`:
  - aceita só link `https://www.receiteria.com.br/`;
  - devolve `{texto, prompt_imagem, via_ia}`.
- `POST /api/receitas/foto-ia`:
  - devolve `{imagem_base64, mime}`;
  - sem faturamento: `{success: false, sem_faturamento: true}`.
- `POST /api/receitas/publicar`:
  - sem credenciais próprias → 400 dizendo QUAL variável falta (nunca cai na conta principal);
  - texto obrigatório, até 2200 caracteres;
  - foto opcional: só JPEG (FF D8 FF), até 3,5 MB;
  - `subir_imagem` e depois `publicar(conta='receitas', tags=hashtags_do_texto, chave=normalizar_link(link))`; a mesma receita duas vezes dá `already`.

Os testes de rota (test_client com sessão admin e monkeypatch) cobrem:
- portão: página 302, API 401 sem login;
- recusa sem credenciais;
- publicação com foto: conta, tags, chave e media_types corretos;
- recusa de PNG;
- aviso de duplicada;
- sugestões: página 1 + sorteada, `outras=1` com uma página só, publicada escondida.

### Task 4: Tela + menu

- `templates/receita_do_dia.html` (CRLF, tema escuro igual ao `quanto_tempo.html`).
- `static/receita-do-dia.js`:
  - dado do RSS entra SÓ por `textContent`; o link só se começar com o prefixo da Receiteria;
  - foto de IA ou do computador é redimensionada pra JPEG 1080 px / 0,85 por canvas;
  - pede `confirm()` antes de publicar;
  - depois de publicar, recarrega as sugestões (a publicada some como "já publicada").
- Menu Ferramentas (`templates/index.html`, CRLF): item "Receita do dia" (`fa-utensils`) antes de "Biblioteca de Roteiros", no MESMO commit (regra da casa).
- Testes:
  - sem `innerHTML` no JS;
  - prefixo do link conferido;
  - `toDataURL('image/jpeg', QUALIDADE)`;
  - link no menu;
  - `node --check`.

### Task 5: Verificação real (sem publicar post)

Script no scratchpad, conta `receitas`:
- sobe o JPEG da logo (`static/og/locutores-ia-logo.jpg`) em `post-media`;
- confere que a URL pública responde 200 `image/jpeg`;
- APAGA o arquivo (DELETE no storage);
- lê `conteudos_da_conta('receitas', 'receiteria.com.br')`;
- `baixar_pagina(1)` + `sugestoes`;
- 1 chamada de `preparar_texto`: gasta 1 das ~20 de texto do dia; não é dia de produção do podcast.

Depois roda a suíte inteira. Esperado: tudo verde, menos os 5 testes que dependem do Supabase bloqueado.

### Task 6: Deploy e entrega

- `git add` SÓ dos arquivos desta feature (a árvore tem muita modificação alheia).
- Commit, depois `git push origin HEAD:main`.
- 1 consulta de status no GitHub depois de ~85 s, em segundo plano.
- A primeira publicação real é DELE, pela tela (publicar é mão humana).
- Atualizar a memória.
