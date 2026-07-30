# Gerador de Anúncios — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar `/gerador` — uma tela onde o produtor escolhe um pedido, clica uma vez, e em ~30s tem o spot completo (roteiro por IA + locução + trilha do acervo + mixagem com efeitos) tocando no player, pronto pra ouvir e enviar ao cliente.

**Architecture:** Quase tudo já existe em peças soltas. O trabalho é (a) extrair o motor de mixagem do `minidaw.js` pra um módulo compartilhado, (b) criar o único endpoint que falta (roteiro publicitário por IA), e (c) escrever o orquestrador que encadeia sete chamadas sem clique no meio. Mixagem roda no navegador (Web Audio) porque `ffmpeg`/`numpy` não existem na Vercel.

**Tech Stack:** Flask + Jinja2, JS vanilla (sem build step), Web Audio API, Gemini 2.5 Flash via `from google import genai`, Supabase (`supabase_manager.newpost_manager_client`), Bootstrap 5 + Font Awesome 6.4.0.

---

## Contexto para quem for implementar

- Projeto **Locutores IA** — Flask em `backend/app.py` (8743 linhas, arquivo grande) + templates Jinja em `templates/` + JS solto em `static/`.
- **Spec completa:** `docs/superpowers/specs/2026-07-30-gerador-anuncios-design.md`. Leia antes de começar.
- Rodar local: `python start_simple.py` → `http://localhost:5000/`.
- **SDK do Gemini:** use `from google import genai` + `genai.Client(api_key=...)`. **Nunca** `import google.generativeai` — esse SDK antigo não está instalado e é um erro recorrente neste repo.
- **Supabase:** use sempre `supabase_manager.newpost_manager_client`, nunca `locutores_client` (aponta pro projeto errado).
- **Vercel é read-only:** nada de escrever arquivo fora de `/tmp`. E `/tmp` é efêmero entre invocações.
- **`escapeHtml` que não escapa aspas é bug recorrente aqui.** Todo texto interpolado em HTML precisa escapar `"` e `'` também. A versão correta está em `static/enviar-entrega.js:20-25`.

### Contratos dos endpoints que já existem (verificados no código)

```
POST /api/generate-audio
  IN : {text, voice, style, language, api}   // api: 'auto'|'google'|'elevenlabs'; 'gemini' vira 'google'
                                             // limite: 5000 caracteres
  OUT: {success:true, filename, download_url:'/api/download/<filename>'}  // sempre .wav
  ERR: {error:"..."} com status 400/500

POST /api/voxcraft/recommend-tracks
  IN : {descricao}                           // obrigatório, max 3000 chars
  OUT: {success:true, status:'ok', resumo, tracks:[{id,name,artist,genre,mood,bpm,duration,file_url,motivo}]}
  OUT: {success:true, status:'sem_trilhas', message}   // ATENÇÃO: success=true mas SEM tracks
  ERR: {success:false, error} 500

POST /api/voxcraft/mix-recipe
  IN : {tracks:[{type,name,duration}], contexto}
  OUT: {success:true, fonte:'ia'|'base', resumo,
        voz:{volume,pan,fade_in,fade_out,effects:{hpf,compressor,presence,limiter,reverb,eq}, motivo},
        trilha:{...}}                        // volumes clampados no backend; trilha < voz garantido

POST /api/qualidade/checar
  IN : {roteiro, plano, duracao_segundos}
  OUT: avisos de duração × plano e frase legal por setor. Determinístico (regex), não usa IA.

GET  /api/pedidos
  OUT: {pedidos:[{id, cliente_nome, whatsapp, email, tipo, plano, valor, roteiro,
                  estilo_voz, referencia_trilha, prazo, status, entrega_id}]}

GET  /api/voices     → lista de vozes disponíveis
GET  /api/tracks     → acervo de trilhas (music_tracks)
```

### Já pronto, só chamar

```js
window.enviarParaEntrega(blob, nomeArquivo)   // static/enviar-entrega.js:103
// Abre modal, sobe pro Storage por signed URL, cria a entrega, vincula ao pedido.
// NÃO reimplementar.
```

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `tests/test_gerador_roteiro.py` | Testes do endpoint de roteiro | Criar |
| `backend/app.py` | `POST /api/gerador/roteiro` + rota `GET /gerador` | Modificar (aditivo) |
| `static/mix-engine.js` | Motor de mixagem compartilhado (Web Audio puro) | Criar (extração) |
| `static/minidaw.js` | Passa a delegar pro mix-engine | Modificar |
| `templates/gerador.html` | A tela | Criar |
| `static/gerador.js` | O orquestrador do pipeline | Criar |
| `templates/index.html` | 1 linha no menu | Modificar (aditivo) |

---

## Task 1: Endpoint de roteiro por IA — funções puras primeiro

**Files:**
- Create: `tests/test_gerador_roteiro.py`
- Modify: `backend/app.py` (adicionar antes da seção `# API de Trilhas Sonoras`, por volta da linha 759)

- [ ] **Step 1: Instalar pytest (dev only — NÃO vai pro requirements.txt)**

```bash
pip install pytest
```

`requirements.txt` é o que a Vercel instala em produção. Adicionar pytest lá só engorda o
deploy. Ele fica como ferramenta local.

- [ ] **Step 2: Escrever os testes que falham**

Create `tests/test_gerador_roteiro.py`:

```python
"""Testes das funções puras do Gerador de Anúncios.

Rodar: pytest tests/test_gerador_roteiro.py -v

Só funções determinísticas aqui — nada que chame o Gemini ou o Supabase.
O endpoint em si é verificado manualmente (ver plano, Task 7).
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from backend.app import estimar_duracao_locucao, duracao_alvo_do_plano


class TestEstimarDuracaoLocucao:
    def test_texto_vazio_da_zero(self):
        assert estimar_duracao_locucao('') == 0.0

    def test_so_espaco_da_zero(self):
        assert estimar_duracao_locucao('   \n  ') == 0.0

    def test_dez_palavras_a_2_5_por_segundo_da_4_segundos(self):
        texto = 'um dois tres quatro cinco seis sete oito nove dez'
        assert estimar_duracao_locucao(texto) == 4.0

    def test_pontuacao_nao_conta_como_palavra(self):
        # "Compre já!" = 2 palavras = 0.8s
        assert estimar_duracao_locucao('Compre já!') == 0.8

    def test_arredonda_para_uma_casa(self):
        # 7 palavras / 2.5 = 2.8
        assert estimar_duracao_locucao('a b c d e f g') == 2.8


class TestDuracaoAlvoDoPlano:
    def test_spot_30_45(self):
        assert duracao_alvo_do_plano('spot_30_45') == (30, 45)

    def test_teaser_5s(self):
        assert duracao_alvo_do_plano('teaser_5s') == (3, 8)

    def test_spot_60_90(self):
        assert duracao_alvo_do_plano('spot_60_90') == (60, 90)

    def test_jingle_nao_tem_grade_fixa(self):
        # jingle e 'outro' não têm faixa — o gerador NÃO deve inventar alvo
        assert duracao_alvo_do_plano('jingle') is None

    def test_outro_nao_tem_grade_fixa(self):
        assert duracao_alvo_do_plano('outro') is None

    def test_plano_desconhecido_nao_tem_grade(self):
        assert duracao_alvo_do_plano('plano_que_nao_existe') is None
```

- [ ] **Step 3: Rodar e confirmar que falha**

```bash
pytest tests/test_gerador_roteiro.py -v
```

Esperado: `ImportError: cannot import name 'estimar_duracao_locucao'`

- [ ] **Step 4: Implementar as duas funções puras**

Em `backend/app.py`, logo depois da rota `/roteiros` (linha 756) e antes do comentário
`# API de Trilhas Sonoras`:

```python
# ═══════════════════════════════════════════════════════════════════════════
# GERADOR DE ANÚNCIOS — o roteiro publicitário por IA.
# Determinístico primeiro: as duas funções abaixo não usam IA, então continuam
# funcionando quando a cota do Gemini estoura (que falha em ~0,4s e em silêncio).
# ═══════════════════════════════════════════════════════════════════════════

# Locução comercial roda por volta de 2,5 palavras por segundo. Não é exato —
# voz mais pausada baixa isso — mas serve pra IA escrever no tamanho certo em
# vez de entregar um texto de 60s pra um spot de 30s.
PALAVRAS_POR_SEGUNDO = 2.5


def estimar_duracao_locucao(texto):
    """Segundos estimados de locução para um texto. Só conta palavras."""
    palavras = [p for p in re.split(r'\s+', str(texto or '').strip()) if p]
    if not palavras:
        return 0.0
    return round(len(palavras) / PALAVRAS_POR_SEGUNDO, 1)


def duracao_alvo_do_plano(plano):
    """Faixa (min, max) em segundos do plano vendido, ou None se não tem grade.

    jingle e 'outro' NÃO têm grade fixa — devolve None de propósito, pra o
    gerador não inventar um alvo que o cliente não comprou.
    """
    return DURACAO_POR_PLANO.get(str(plano or ''))
```

**Atenção:** `DURACAO_POR_PLANO` é definido mais abaixo no arquivo (linha ~2682). Em Python
isso funciona porque a função só resolve o nome quando é chamada, não na definição. `re` já
está importado (`backend/app.py:9`), não precisa adicionar.

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
pytest tests/test_gerador_roteiro.py -v
```

Esperado: 11 passed

- [ ] **Step 6: Commit**

```bash
git add tests/test_gerador_roteiro.py backend/app.py
git commit -m "feat(gerador): estimativa de duracao e faixa por plano"
```

---

## Task 2: Endpoint `POST /api/gerador/roteiro`

**Files:**
- Modify: `backend/app.py` (logo abaixo das funções da Task 1)

- [ ] **Step 1: Implementar o endpoint**

```python
@app.route('/api/gerador/roteiro', methods=['POST', 'OPTIONS'])
def gerador_roteiro():
    """Briefing do cliente -> roteiro de spot pronto pra locução.

    É o único passo do pipeline do Gerador que não existia. Segue o mesmo
    contrato defensivo do /api/voxcraft/mix-recipe: se a IA não responder
    (sem chave, cota estourada, JSON quebrado), devolve fonte='base' com o
    briefing limpo em vez de falhar — o produtor edita na tela e segue.
    """
    if request.method == 'OPTIONS':
        response = make_response()
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        return response

    try:
        data = request.get_json() or {}
        briefing = (data.get('briefing') or '').strip()[:3000]
        if not briefing:
            return jsonify({"success": False, "error": "Sem briefing não dá pra escrever o roteiro."}), 400

        plano = str(data.get('plano') or 'outro')
        tipo = str(data.get('tipo') or '')[:80]
        estilo_voz = str(data.get('estilo_voz') or '')[:300]
        faixa = duracao_alvo_do_plano(plano)

        def responder_base():
            # Fallback: o briefing vira o roteiro. Não é bonito, mas é honesto —
            # e não queima o pipeline inteiro por causa de uma cota estourada.
            return jsonify({
                "success": True, "fonte": "base", "roteiro": briefing,
                "tempo_leitura_estimado": estimar_duracao_locucao(briefing),
                "faixa_alvo": list(faixa) if faixa else None,
                "aviso": "A IA não respondeu agora — este é o briefing do cliente como veio. Edite antes de aprovar."
            })

        api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_AI_STUDIO_API_KEY")
        if not api_key:
            return responder_base()

        if faixa:
            alvo_txt = (f"O spot precisa durar entre {faixa[0]} e {faixa[1]} segundos falados. "
                        f"Isso significa aproximadamente {int(faixa[0] * PALAVRAS_POR_SEGUNDO)} a "
                        f"{int(faixa[1] * PALAVRAS_POR_SEGUNDO)} palavras. Respeite esse tamanho.")
        else:
            alvo_txt = "Não há duração fixa contratada — escreva no tamanho que o conteúdo pedir."

        prompt = f"""Você é redator publicitário de rádio no Brasil. Escreva o TEXTO FALADO de um spot comercial.

BRIEFING DO CLIENTE:
{briefing}

Tipo de peça: {tipo or 'não informado'}
Estilo de voz pedido: {estilo_voz or 'não informado'}
{alvo_txt}

REGRAS:
- Escreva APENAS o que o locutor fala. Nada de rubrica, marcação de trilha, "LOCUTOR:", colchetes ou instrução de produção.
- Português do Brasil, falado, natural na boca. Frases curtas.
- Comece com um gancho e termine com chamada pra ação (endereço, telefone ou "procure já").
- Números e siglas por extenso, como se fala (ex: "vinte e quatro horas", não "24h").
- Não invente preço, endereço, telefone ou prazo que não estejam no briefing.

Devolva SOMENTE um JSON válido, sem markdown:
{{"roteiro": "o texto falado", "resumo": "1 frase sobre a escolha criativa"}}"""

        try:
            from google import genai
            client = genai.Client(api_key=api_key)
            gem = client.models.generate_content(model='gemini-2.5-flash', contents=prompt)
            texto = (gem.text or '').replace('```json', '').replace('```', '').strip()
            parsed = json.loads(texto)
            roteiro = (parsed.get('roteiro') or '').strip()
            if not roteiro:
                raise ValueError("IA devolveu roteiro vazio")
        except Exception as ia_err:
            print(f"IA de roteiro falhou, usando base: {ia_err}")
            return responder_base()

        return jsonify({
            "success": True, "fonte": "ia",
            "roteiro": roteiro[:5000],
            "resumo": (parsed.get('resumo') or '').strip()[:300],
            "tempo_leitura_estimado": estimar_duracao_locucao(roteiro),
            "faixa_alvo": list(faixa) if faixa else None
        })

    except Exception as e:
        print(f"Erro no roteiro do Gerador: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": "Não consegui escrever o roteiro agora."}), 500
```

- [ ] **Step 2: Subir o servidor e testar o caminho feliz**

```bash
python start_simple.py
```

Noutro terminal:

```bash
curl -X POST http://localhost:5000/api/gerador/roteiro \
  -H "Content-Type: application/json" \
  -d "{\"briefing\":\"Padaria do Ze, pao quentinho todo dia as 6 da manha, rua das Flores 100\",\"plano\":\"spot_30_45\",\"tipo\":\"spot\"}"
```

Esperado: `success: true`, `fonte: "ia"`, `roteiro` com texto falado (sem "LOCUTOR:"),
`tempo_leitura_estimado` entre 25 e 50, `faixa_alvo: [30, 45]`.

- [ ] **Step 3: Testar o fallback (o caminho que mais importa)**

Pare o servidor, rode sem a chave:

```bash
GEMINI_API_KEY= GOOGLE_AI_STUDIO_API_KEY= python start_simple.py
```

Repita o curl do Step 2. Esperado: `success: true`, `fonte: "base"`, `roteiro` igual ao
briefing, campo `aviso` presente. **Não pode retornar erro** — se retornar, o fallback está
quebrado e o pipeline inteiro cai junto quando a cota do Gemini estourar.

- [ ] **Step 4: Testar briefing vazio**

```bash
curl -X POST http://localhost:5000/api/gerador/roteiro \
  -H "Content-Type: application/json" -d "{\"briefing\":\"\"}"
```

Esperado: HTTP 400, `success: false`.

- [ ] **Step 5: Commit**

```bash
git add backend/app.py
git commit -m "feat(gerador): endpoint de roteiro publicitario por IA com fallback"
```

---

## Task 3: Extrair o motor de mixagem para `static/mix-engine.js`

**A task de maior risco do plano.** A MiniDAW clássica (`/minidaw`) é a versão estável — o
comportamento de export dela não pode mudar. Faça a medição de referência ANTES de tocar
em qualquer linha.

**Files:**
- Create: `static/mix-engine.js`
- Modify: `static/minidaw.js` (linhas 1149, 1216, 1350, 1391, 1646, 1714)

- [ ] **Step 1: Medir o comportamento atual (linha de base)**

1. `python start_simple.py`, abra `http://localhost:5000/minidaw`
2. Suba uma voz e uma trilha
3. Aplique a Receita da IA (botão ⚡)
4. Exporte o mix
5. **Anote:** duração do arquivo em segundos e tamanho em bytes
6. Guarde o arquivo exportado como `baseline.mp3` fora do repo

Sem esse número, não há como provar que a extração não quebrou nada.

- [ ] **Step 2: Criar `static/mix-engine.js` movendo as funções verbatim**

Crie o arquivo com este cabeçalho:

```js
/**
 * Motor de mixagem — Web Audio puro, sem DOM.
 *
 * Extraído do static/minidaw.js pra ser usado por DUAS telas: a MiniDAW
 * clássica (/minidaw) e o Gerador de Anúncios (/gerador). Antes vivia como
 * método da classe MiniDAW; o corpo é o mesmo, o que mudou é que as
 * dependências que vinham de `this` agora entram por parâmetro.
 *
 * Por que não duplicar: mixagem errada é cara de descobrir (o bug do EQ que
 * disputava um filtro só passou despercebido até o export sair sem graves).
 * Uma fonte de verdade só.
 *
 * Não use `document` aqui dentro. Se precisar de UI, é sinal de que a função
 * pertence à tela, não ao motor.
 */
(function (global) {
    'use strict';
```

Agora mova os corpos, **sem alterar a lógica**:

| Origem em `minidaw.js` | Nome no módulo | Mudança |
|---|---|---|
| `detectarTrechosDeVoz` (linha 1149) | `detectarTrechosDeVoz(voiceTracks)` | nenhuma |
| `aplicarDucking` (linha 1216) | `aplicarDucking(gainParam, trechos, nivel, ateQuando, offset)` | nenhuma |
| `masterizarBuffer` (linha 1350) | `masterizarBuffer(buffer, alvoDbfs)` | nenhuma |
| `_renderizarParaExport` (linha 1391) | `renderizarMix(opcoes)` | ver abaixo |
| `bufferToWav` (linha 1646) | `bufferToWav(buffer)` | nenhuma |
| `bufferToMp3` (linha 1714) | `bufferToMp3(buffer, kbps)` | `this.bufferToWav` → `bufferToWav` |

`renderizarMix` recebe um objeto em vez de ler `this`:

```js
    /**
     * @param {Object}  o
     * @param {Array}   o.tracks         faixas a renderizar (as que entram no arquivo)
     * @param {Array}   o.todasAsTracks  projeto inteiro — duração e ducking saem daqui,
     *                                   é o que faz um stem somar de volta no mix
     * @param {number}  o.duration       duração do projeto em segundos
     * @param {number}  o.sampleRate     ex: 44100
     * @param {Function} [o.aoProgredir] (percentual, texto) => void
     * @returns {Promise<AudioBuffer>}
     */
    async function renderizarMix(o) {
        const tracks = o.tracks || [];
        const todasAsTracks = o.todasAsTracks || tracks;
        const sampleRate = o.sampleRate;
        const aoProgredir = o.aoProgredir;
        const tracksWithAudio = todasAsTracks.filter(t => t.audioBuffer);
        let duration = o.duration;

        // ... corpo de _renderizarParaExport (minidaw.js:1391-1583) daqui pra baixo,
        // com estas substituições mecânicas:
        //   this.tracks              -> todasAsTracks
        //   this.duration            -> duration
        //   this.audioContext.sampleRate -> sampleRate
        //   this.aplicarDucking(     -> aplicarDucking(
        //   this.detectarTrechosDeVoz( -> detectarTrechosDeVoz(
        //   tracksParaRenderizar     -> tracks
    }
```

Feche o módulo expondo tudo:

```js
    global.MixEngine = {
        renderizarMix, masterizarBuffer, bufferToWav, bufferToMp3,
        detectarTrechosDeVoz, aplicarDucking
    };
})(window);
```

- [ ] **Step 3: Checar a sintaxe antes de plugar**

```bash
node --check static/mix-engine.js
```

Esperado: sem saída (sintaxe válida). Se acusar erro, corrija antes de seguir.

- [ ] **Step 4: Fazer o `minidaw.js` delegar**

Substitua os corpos dos seis métodos por delegação. Exemplo do mais complexo:

```js
    async _renderizarParaExport(tracksParaRenderizar, aoProgredir) {
        return MixEngine.renderizarMix({
            tracks: tracksParaRenderizar,
            todasAsTracks: this.tracks,
            duration: this.duration,
            sampleRate: this.audioContext.sampleRate,
            aoProgredir: aoProgredir
        });
    }

    masterizarBuffer(buffer, alvoDbfs) {
        return MixEngine.masterizarBuffer(buffer, alvoDbfs);
    }

    bufferToWav(buffer) {
        return MixEngine.bufferToWav(buffer);
    }

    async bufferToMp3(buffer, kbps) {
        return MixEngine.bufferToMp3(buffer, kbps);
    }

    detectarTrechosDeVoz(voiceTracks) {
        return MixEngine.detectarTrechosDeVoz(voiceTracks);
    }

    aplicarDucking(gainParam, trechos, nivel, ateQuando, offset = 0) {
        return MixEngine.aplicarDucking(gainParam, trechos, nivel, ateQuando, offset);
    }
```

- [ ] **Step 5: Carregar o módulo ANTES do minidaw.js**

Em `templates/minidaw.html`, linha 868, insira a linha nova acima:

```html
    <script src="/static/mix-engine.js?v=1"></script>
    <script src="/static/minidaw.js?v=12"></script>
```

Note o bump de `v=11` pra `v=12` — sem isso o navegador serve o JS velho do cache e você
vai debugar um arquivo que não está rodando.

- [ ] **Step 6: Provar que não houve regressão**

Repita exatamente o Step 1 (mesma voz, mesma trilha, mesma receita) e compare:

- Duração: **idêntica** à baseline
- Tamanho: mesma ordem de grandeza (variação de MP3 é normal, mas não 2x)
- Ouça os dois: voz à frente, trilha ao fundo, ducking presente, fade no fim

Depois confirme que estes continuam funcionando: **Ouvir Prévia**, **Otimizar e Exportar**,
**exportar stems** e **Enviar para entrega**. Se qualquer um quebrar, a extração errou uma
substituição — não siga adiante.

- [ ] **Step 7: Commit**

```bash
git add static/mix-engine.js static/minidaw.js templates/minidaw.html
git commit -m "refactor(minidaw): extrai motor de mixagem para mix-engine.js"
```

---

## Task 4: Rota `/gerador` e o esqueleto da tela

**Files:**
- Modify: `backend/app.py` (junto das outras rotas de página, perto da linha 756)
- Create: `templates/gerador.html`

- [ ] **Step 1: Adicionar a rota**

```python
@app.route('/gerador')
def gerador_page():
    """Gerador de Anúncios — briefing do pedido vira spot mixado em 1 clique.

    Rota PRÓPRIA de propósito: não desloca '/', '/studio' nem as MiniDAWs.
    A mixagem roda no navegador (Web Audio) — ffmpeg/numpy não existem na
    Vercel, então não há como produzir isto no servidor.
    """
    return render_template('gerador.html')
```

- [ ] **Step 2: Criar `templates/gerador.html`**

Estrutura (siga o visual das outras páginas internas — Bootstrap 5 + Font Awesome, tema
escuro como `entregas-clientes.html`):

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Gerador de Anúncios — Locutores IA</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
</head>
<body>
    <!-- Topo: seletor de pedido. O briefing vem de /api/pedidos, não digitado do zero. -->
    <select id="selectPedido"></select>
    <button id="btnGerar">Gerar anúncio</button>

    <!-- Coluna esquerda: controles. Voz e modo são escolhidos AQUI, antes do clique —
         a IA não escolhe voz (estilo_voz do pedido é texto livre, não mapeia pra ID). -->
    <select id="selectModo">
        <option value="padrao" selected>Modo Padrão</option>
        <option value="expressivo">Modo Expressivo</option>
    </select>
    <select id="selectVoz"></select>
    <select id="selectTrilha"><option value="auto" selected>Deixar a IA escolher</option></select>
    <input id="inputNome" type="text" placeholder="Nome do áudio">

    <!-- Coluna direita: o roteiro. Editável DEPOIS de gerado (permite "Regerar só a voz"). -->
    <textarea id="textoComercial" maxlength="5000"></textarea>
    <div id="contadorChars"></div>
    <div id="tempoEstimado"></div>

    <!-- Progresso do pipeline: cada passo aparece nomeado. -->
    <div id="progresso"></div>
    <div id="avisos"></div>

    <!-- Barra fixa embaixo: player + ações -->
    <div id="barraResultado" style="display:none;">
        <audio id="playerResultado" controls></audio>
        <button id="btnRegerarVoz">Regerar só a voz</button>
        <button id="btnDownload">Download</button>
        <button id="btnEnviar">Enviar</button>
        <button id="btnAbrirMiniDAW">Abrir na MiniDAW</button>
    </div>

    <script src="/static/mix-engine.js?v=1"></script>
    <script src="/static/enviar-entrega.js?v=1"></script>
    <script src="/static/gerador.js?v=1"></script>
</body>
</html>
```

O `enviar-entrega.js` é o que já existe — não reimplemente o envio.

**Corte consciente vs. a imagem de referência:** ela mostra uma waveform desenhada na barra
do player. Aqui o player é o `<audio controls>` nativo. A waveform é cosmética — não muda o
que você ouve nem o que o cliente recebe — e traria uma dependência a mais (wavesurfer). Se
depois de usar a ferramenta ela fizer falta pra navegar no áudio, entra como polimento, não
como parte do pipeline.

- [ ] **Step 3: Verificar que a página abre**

```bash
python start_simple.py
```

Abra `http://localhost:5000/gerador`. Esperado: página carrega, sem erro no console
(exceto os selects vazios, que a Task 5 preenche).

- [ ] **Step 4: Commit**

```bash
git add backend/app.py templates/gerador.html
git commit -m "feat(gerador): rota /gerador e esqueleto da tela"
```

---

## Task 5: O orquestrador (`static/gerador.js`)

**Files:**
- Create: `static/gerador.js`

- [ ] **Step 1: Escrever o carregamento inicial**

```js
/**
 * Gerador de Anúncios — o orquestrador.
 *
 * Encadeia o que já existia solto atrás de cliques em telas diferentes:
 * roteiro -> voz -> trilha -> receita de mix -> mixagem. Não tem lógica de
 * áudio própria: quem mixa é o MixEngine, quem envia é o enviarParaEntrega.
 *
 * Princípio de erro: degradar com o que já se tem. Perder o TTS já gerado
 * porque a trilha falhou seria queimar crédito à toa.
 */
(function () {
    'use strict';

    const estado = {
        pedido: null,      // pedido escolhido
        roteiro: '',       // roteiro em uso
        vozBuffer: null,   // AudioBuffer da locução
        trilha: null,      // {name, file_url, ...}
        trilhaBuffer: null,
        receita: null,     // resposta do mix-recipe
        mixBlob: null      // resultado final
    };

    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Escapa aspas também: este texto vai parar dentro de atributo HTML.
    // Sem isso, um cliente chamado O'Brien quebra a página (bug recorrente aqui).
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function passo(n, total, texto) {
        document.getElementById('progresso').textContent = `[${n}/${total}] ${texto}`;
    }

    function avisar(texto, tipo) {
        const el = document.createElement('div');
        el.className = 'aviso aviso-' + (tipo || 'info');
        el.textContent = texto;
        document.getElementById('avisos').appendChild(el);
    }

    async function carregarPedidos() {
        const r = await fetch('/api/pedidos');
        const d = await r.json();
        const sel = document.getElementById('selectPedido');
        const abertos = (d.pedidos || []).filter(p => !p.entrega_id);
        sel.innerHTML = '<option value="">— escolha um pedido —</option>' +
            abertos.map(p =>
                `<option value="${esc(p.id)}">${esc(p.cliente_nome)} — ${esc(p.plano || p.tipo || 'pedido')}</option>`
            ).join('');
        sel.onchange = () => {
            estado.pedido = abertos.find(p => String(p.id) === sel.value) || null;
            if (estado.pedido) {
                document.getElementById('textoComercial').value = estado.pedido.roteiro || '';
                document.getElementById('inputNome').value =
                    'spot-' + (estado.pedido.cliente_nome || 'cliente').toLowerCase().replace(/\s+/g, '-');
            }
        };
    }

    async function carregarVozes() {
        const r = await fetch('/api/voices');
        const d = await r.json();
        const vozes = d.voices || d.vozes || [];
        document.getElementById('selectVoz').innerHTML = vozes.map((v, i) => {
            const id = v.id || v.voice_id || v.name || v;
            const nome = v.name || v.nome || id;
            return `<option value="${esc(id)}"${i === 0 ? ' selected' : ''}>${esc(nome)}</option>`;
        }).join('');
    }

    async function carregarTrilhas() {
        const r = await fetch('/api/tracks');
        const d = await r.json();
        const sel = document.getElementById('selectTrilha');
        sel.innerHTML = '<option value="auto" selected>Deixar a IA escolher</option>' +
            '<option value="nenhuma">Sem trilha (locução seca)</option>' +
            (d.tracks || []).map(t =>
                `<option value="${esc(t.id)}">${esc(t.name)}</option>`
            ).join('');
    }
})();
```

- [ ] **Step 2: Escrever os helpers de áudio**

Dentro do mesmo IIFE:

```js
    async function baixarEDecodificar(url) {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`Falha ao buscar o áudio (HTTP ${r.status})`);
        const arr = await r.arrayBuffer();
        return await ctx.decodeAudioData(arr);
    }

    // Monta uma faixa no formato que o MixEngine espera (espelha minidaw.js:148-167).
    function montarTrack(id, nome, tipo, audioBuffer, receitaPapel) {
        const r = receitaPapel || {};
        return {
            id: id, name: nome, type: tipo,
            audioBuffer: audioBuffer,
            duration: audioBuffer.duration,
            volume: r.volume != null ? r.volume : 100,
            pan: r.pan != null ? r.pan : 0,
            fadeIn: r.fade_in != null ? r.fade_in : 0,
            fadeOut: r.fade_out != null ? r.fade_out : 0,
            muted: false, solo: false,
            effects: Object.assign(
                { reverb: false, delay: false, compressor: false, eq: false,
                  hpf: tipo === 'voice', presence: false, limiter: true },
                r.effects || {}
            )
        };
    }
```

- [ ] **Step 3: Escrever o pipeline**

```js
    async function gerarAnuncio() {
        const btn = document.getElementById('btnGerar');
        btn.disabled = true;
        document.getElementById('avisos').innerHTML = '';
        const TOTAL = 6;

        try {
            // [1] ROTEIRO — falha aqui não interrompe: cai no briefing do cliente.
            passo(1, TOTAL, 'Escrevendo o roteiro...');
            const briefing = document.getElementById('textoComercial').value.trim()
                || (estado.pedido && estado.pedido.roteiro) || '';
            if (!briefing) throw new Error('Escolha um pedido ou escreva o briefing antes de gerar.');

            const rRot = await fetch('/api/gerador/roteiro', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    briefing: briefing,
                    plano: (estado.pedido && estado.pedido.plano) || 'outro',
                    tipo: (estado.pedido && estado.pedido.tipo) || '',
                    estilo_voz: (estado.pedido && estado.pedido.estilo_voz) || ''
                })
            });
            const dRot = await rRot.json();
            if (!dRot.success) throw new Error(dRot.error || 'Falha ao escrever o roteiro');
            estado.roteiro = dRot.roteiro;
            document.getElementById('textoComercial').value = estado.roteiro;
            if (dRot.fonte === 'base') {
                avisar('⚙️ Roteiro veio do briefing do cliente — a IA não respondeu agora.', 'atencao');
            }

            // [2] VOZ — sem locução não há spot: este é o único passo que interrompe.
            passo(2, TOTAL, 'Gravando a locução...');
            const modo = document.getElementById('selectModo').value;
            const rVoz = await fetch('/api/generate-audio', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: estado.roteiro,
                    voice: document.getElementById('selectVoz').value,
                    // Expressivo = ElevenLabs. Padrão = Google (edge-tts dá 403 na Vercel).
                    api: modo === 'expressivo' ? 'elevenlabs' : 'google',
                    language: 'pt-BR'
                })
            });
            const dVoz = await rVoz.json();
            if (!dVoz.success) throw new Error(dVoz.error || 'Falha ao gerar a locução');
            // Buscar JÁ — o arquivo vive em /tmp, que é efêmero na Vercel.
            estado.vozBuffer = await baixarEDecodificar(dVoz.download_url);

            // [3] TRILHA — falha aqui NÃO interrompe: locução seca é entregável.
            passo(3, TOTAL, 'Escolhendo a trilha...');
            estado.trilha = null;
            estado.trilhaBuffer = null;
            const escolha = document.getElementById('selectTrilha').value;
            try {
                if (escolha === 'nenhuma') {
                    avisar('Sem trilha, por escolha sua.', 'info');
                } else if (escolha === 'auto') {
                    const rTr = await fetch('/api/voxcraft/recommend-tracks', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ descricao: estado.roteiro })
                    });
                    const dTr = await rTr.json();
                    // ATENÇÃO: 'sem_trilhas' vem com success=true e sem tracks.
                    if (dTr.status === 'sem_trilhas') {
                        avisar('Biblioteca de trilhas vazia — seguindo com locução seca.', 'atencao');
                    } else if (dTr.success && dTr.tracks && dTr.tracks.length) {
                        estado.trilha = dTr.tracks[0];
                    }
                } else {
                    const rT = await fetch('/api/tracks');
                    const dT = await rT.json();
                    estado.trilha = (dT.tracks || []).find(t => String(t.id) === escolha) || null;
                }
                if (estado.trilha) estado.trilhaBuffer = await baixarEDecodificar(estado.trilha.file_url);
            } catch (e) {
                avisar('Não consegui carregar a trilha (' + e.message + ') — seguindo com locução seca.', 'atencao');
                estado.trilha = null;
                estado.trilhaBuffer = null;
            }

            // [4] RECEITA — falha cai na receita-base que o próprio endpoint devolve.
            passo(4, TOTAL, 'Definindo a mixagem...');
            const tracksInfo = [{ type: 'voice', name: 'locucao', duration: estado.vozBuffer.duration }];
            if (estado.trilhaBuffer) {
                tracksInfo.push({ type: 'music', name: estado.trilha.name, duration: estado.trilhaBuffer.duration });
            }
            const rRec = await fetch('/api/voxcraft/mix-recipe', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tracks: tracksInfo, contexto: 'Roteiro da locução: ' + estado.roteiro.slice(0, 700) })
            });
            estado.receita = await rRec.json();
            if (!estado.receita.success) {
                // O endpoint caiu de vez (500). Não interrompe: montarTrack aplica
                // os defaults e o spot sai — só sem o ajuste fino da IA.
                avisar('Não consegui montar a receita — mixando com os valores padrão.', 'atencao');
                estado.receita = {};
            } else if (estado.receita.fonte === 'base') {
                avisar('⚙️ Mixagem com a receita padrão — a IA não respondeu agora.', 'atencao');
            }

            // [5] MIXAGEM
            passo(5, TOTAL, 'Mixando...');
            const tracks = [montarTrack('voz', 'Locução', 'voice', estado.vozBuffer, estado.receita.voz)];
            if (estado.trilhaBuffer) {
                tracks.push(montarTrack('trilha', estado.trilha.name, 'music', estado.trilhaBuffer, estado.receita.trilha));
            }
            const duracao = estado.vozBuffer.duration + 1.05;   // mesma folga do motor
            const buffer = await MixEngine.renderizarMix({
                tracks: tracks, todasAsTracks: tracks,
                duration: duracao, sampleRate: ctx.sampleRate,
                aoProgredir: (p, t) => passo(5, TOTAL, `Mixando... ${Math.round(p)}% ${t || ''}`)
            });
            // -15 LUFS-ish é o preset 'streaming' da MiniDAW (minidaw.js:44) — o
            // mesmo que o botão "Otimizar e Exportar" usa e que o usuário já
            // aprovou de ouvido. Não invente outro valor.
            MixEngine.masterizarBuffer(buffer, -15);
            estado.mixBlob = await MixEngine.bufferToMp3(buffer, 192);

            // [6] CHECAGEM — só avisa, nunca bloqueia.
            passo(6, TOTAL, 'Conferindo duração e frase legal...');
            try {
                const rQ = await fetch('/api/qualidade/checar', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        roteiro: estado.roteiro,
                        plano: (estado.pedido && estado.pedido.plano) || 'outro',
                        duracao_segundos: buffer.duration
                    })
                });
                const dQ = await rQ.json();
                (dQ.avisos || []).forEach(a => avisar(`${a.titulo}: ${a.detalhe || ''}`, a.nivel));
            } catch (e) {
                avisar('Não deu pra rodar a checagem de qualidade — confira na mão.', 'atencao');
            }

            // Resultado
            document.getElementById('playerResultado').src = URL.createObjectURL(estado.mixBlob);
            document.getElementById('barraResultado').style.display = 'flex';
            passo(6, TOTAL, '✅ Pronto — ouça antes de enviar.');

        } catch (e) {
            passo(0, TOTAL, '❌ ' + e.message);
            // Não perde o TTS já gasto: se a voz existe, deixa baixar.
            if (estado.vozBuffer && !estado.mixBlob) {
                avisar('A locução foi gerada e continua disponível — só a mixagem falhou.', 'atencao');
            }
        } finally {
            btn.disabled = false;
        }
    }
```

- [ ] **Step 4: Escrever as ações do resultado e ligar tudo**

```js
    // Regerar só a voz: reaproveita trilha e receita já escolhidas. Evita gastar
    // o pipeline inteiro quando o problema era só o texto.
    async function regerarVoz() {
        const btn = document.getElementById('btnRegerarVoz');
        btn.disabled = true;
        try {
            estado.roteiro = document.getElementById('textoComercial').value.trim();
            passo(1, 2, 'Regravando a locução...');
            const modo = document.getElementById('selectModo').value;
            const r = await fetch('/api/generate-audio', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: estado.roteiro,
                    voice: document.getElementById('selectVoz').value,
                    api: modo === 'expressivo' ? 'elevenlabs' : 'google',
                    language: 'pt-BR'
                })
            });
            const d = await r.json();
            if (!d.success) throw new Error(d.error || 'Falha ao regerar');
            estado.vozBuffer = await baixarEDecodificar(d.download_url);

            passo(2, 2, 'Remixando...');
            const tracks = [montarTrack('voz', 'Locução', 'voice', estado.vozBuffer, estado.receita.voz)];
            if (estado.trilhaBuffer) {
                tracks.push(montarTrack('trilha', estado.trilha.name, 'music', estado.trilhaBuffer, estado.receita.trilha));
            }
            const buffer = await MixEngine.renderizarMix({
                tracks: tracks, todasAsTracks: tracks,
                duration: estado.vozBuffer.duration + 1.05, sampleRate: ctx.sampleRate
            });
            MixEngine.masterizarBuffer(buffer, -14);
            estado.mixBlob = await MixEngine.bufferToMp3(buffer, 192);
            document.getElementById('playerResultado').src = URL.createObjectURL(estado.mixBlob);
            passo(2, 2, '✅ Locução trocada.');
        } catch (e) {
            passo(0, 2, '❌ ' + e.message);
        } finally {
            btn.disabled = false;
        }
    }

    function nomeArquivo() {
        const base = (document.getElementById('inputNome').value || 'spot').trim()
            .replace(/[^\w\-]+/g, '-');
        return base + '.mp3';
    }

    document.addEventListener('DOMContentLoaded', async () => {
        await Promise.all([carregarPedidos(), carregarVozes(), carregarTrilhas()]);

        document.getElementById('btnGerar').onclick = gerarAnuncio;
        document.getElementById('btnRegerarVoz').onclick = regerarVoz;

        document.getElementById('btnDownload').onclick = () => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(estado.mixBlob);
            a.download = nomeArquivo();
            a.click();
        };

        // Reusa o que já existe — não reimplementar o envio.
        document.getElementById('btnEnviar').onclick = () => {
            window.enviarParaEntrega(estado.mixBlob, nomeArquivo());
        };

        // Escape hatch: ajuste fino manual na MiniDAW completa.
        document.getElementById('btnAbrirMiniDAW').onclick = () => {
            const fr = new FileReader();
            fr.onloadend = () => {
                localStorage.setItem('minidaw_pending_audio', fr.result);
                localStorage.setItem('minidaw_pending_filename', nomeArquivo());
                localStorage.setItem('minidaw_pending_timestamp', Date.now());
                localStorage.setItem('minidaw_pending_roteiro', estado.roteiro.slice(0, 900));
                window.open('/minidaw', '_blank');
            };
            fr.readAsDataURL(estado.mixBlob);
        };

        // Contador de caracteres e tempo estimado, como na referência.
        const ta = document.getElementById('textoComercial');
        const atualizar = () => {
            document.getElementById('contadorChars').textContent =
                (5000 - ta.value.length) + ' caracteres restantes';
            const palavras = ta.value.trim().split(/\s+/).filter(Boolean).length;
            document.getElementById('tempoEstimado').textContent =
                palavras ? `~${(palavras / 2.5).toFixed(1)}s de locução` : '';
        };
        ta.addEventListener('input', atualizar);
        atualizar();
    });
```

- [ ] **Step 5: Checar a sintaxe**

```bash
node --check static/gerador.js
```

Esperado: sem saída.

- [ ] **Step 6: Commit**

```bash
git add static/gerador.js
git commit -m "feat(gerador): orquestrador do pipeline de producao"
```

---

## Task 6: Item no menu

**Files:**
- Modify: `templates/index.html:808` (seção "Ferramentas")

- [ ] **Step 1: Adicionar a linha**

Logo depois de `<div class="menu-section-title">Ferramentas</div>` (linha 808), como
primeiro item da seção:

```html
                <a href="/gerador" class="menu-item badge-new">
                    <i class="fas fa-wand-magic-sparkles"></i>
                    <span>Gerador de Anúncios</span>
                </a>
```

**Só adicionar.** Não reordenar, renomear ou remover nenhum item existente — a navegação
dele não se mexe.

- [ ] **Step 2: Conferir**

Abra `http://localhost:5000/`, veja o item novo em "Ferramentas", clique e confirme que
chega em `/gerador`. Confirme que os itens antigos continuam todos lá.

- [ ] **Step 3: Commit**

```bash
git add templates/index.html
git commit -m "feat(gerador): link no menu de Ferramentas"
```

---

## Task 7: Verificação end-to-end

Nada aqui é opcional. **Não declare a feature pronta sem ter feito estes sete testes** —
cada um cobre um modo de falha real deste projeto.

- [ ] **Step 1: Caminho feliz**

Pedido real → escolher voz → "Gerar anúncio". Esperado: os 6 passos aparecem nomeados e em
~30s o spot toca no player. Ouça: a voz está à frente, a trilha ao fundo.

- [ ] **Step 2: Regra de ouro do spot**

A trilha **nunca** pode competir com a voz. Se estiver alta, confira o que
`/api/voxcraft/mix-recipe` devolveu (o backend clampa, mas o `montarTrack` pode estar
ignorando o `volume` da receita).

- [ ] **Step 3: IA fora do ar**

Pare o servidor e suba sem chave:

```bash
GEMINI_API_KEY= GOOGLE_AI_STUDIO_API_KEY= python start_simple.py
```

Gere um anúncio. Esperado: **completa mesmo assim**, com dois avisos visíveis de que
roteiro e receita vieram do modo base. Este teste importa porque a cota do Gemini (429)
falha em ~0,4s e em silêncio — sem o aviso na tela, parece que "a IA ficou ruim".

- [ ] **Step 4: Sem trilha**

Escolha "Sem trilha (locução seca)". Esperado: entrega a locução mixada sozinha, sem erro.

- [ ] **Step 5: Regerar só a voz**

Edite o texto no resultado e clique "Regerar só a voz". Esperado: locução nova, **mesma
trilha e mesma receita**, sem refazer o pipeline inteiro.

- [ ] **Step 6: Enviar**

Clique "Enviar", preencha o modal, confirme. Esperado: entrega criada, vinculada ao pedido,
e o link `/aprovacao/<id>` abre e toca o áudio.

- [ ] **Step 7: Não-regressão da MiniDAW**

Volte em `/minidaw` e exporte um projeto. Compare com a `baseline.mp3` da Task 3. Confirme
"Ouvir Prévia", "Otimizar e Exportar" e os stems.

- [ ] **Step 8: Testar em produção**

Faça o push e teste na Vercel. `/tmp` efêmero, limite de ~4.5MB de corpo e o 403 do
edge-tts **só aparecem lá**. Em especial: confirme que o áudio da locução é buscado com
sucesso logo depois de gerado (se der 404 em `/api/download/<filename>`, a instância
mudou entre as duas requisições — anote e reporte, é o risco conhecido da spec §6).

---

## Ordem de execução

Tasks 1 e 2 (backend) são independentes da Task 3 (extração do motor) — dá pra fazer em
paralelo. As Tasks 4, 5 e 6 dependem das anteriores. A Task 7 fecha.

**Se a Task 3 falhar a verificação de não-regressão, pare.** Reverter a extração é
preferível a entregar o Gerador com a MiniDAW quebrada — ela é a ferramenta que hoje paga
as contas.
