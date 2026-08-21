# Modo Diálogo (2 vozes) no Gerador — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spot em diálogo com 2 vozes no `/gerador`, via multi-speaker nativo do Gemini TTS (1 chamada).

**Architecture:** Select "Formato" no Gerador; roteiro IA ganha variante diálogo (`Nome: fala`, 2 personagens); detecção de personagens é função pura no backend (fonte única da verdade); TTS ganha caminho irmão com `MultiSpeakerVoiceConfig` no MESMO modelo `gemini-2.5-flash-preview-tts`. Do AudioBuffer pra frente (trilha/mix/checagem/MiniDAW), nada muda.

**Tech Stack:** Flask (backend/app.py), vanilla JS sem build (static/gerador.js + templates/gerador.html), google-genai 2.8.0 (`types.MultiSpeakerVoiceConfig` verificado), validação por `python -m py_compile`, `python -c` (testes da detecção) e `node --check`.

**Spec:** `docs/superpowers/specs/2026-08-21-dialogo-2-vozes-gerador-design.md`

**Regra da casa:** implementadores que commitam SEMPRE em série, nunca em paralelo. Arquivos grandes — editar SÓ os trechos exatos indicados. Preservar UTF-8 (mojibake é praga conhecida aqui).

---

### Task 1: Detecção de personagens + texto falado (backend, funções puras)

**Files:**
- Modify: `backend/app.py` (logo após `estimar_duracao_locucao`, ~linha 884)

- [ ] **Step 1: Escrever as duas funções puras**

Localizar em `backend/app.py`:

```python
def duracao_alvo_do_plano(plano):
```

Inserir IMEDIATAMENTE ANTES dessa linha:

```python
# Linha de fala de diálogo: "Nome: fala". O rótulo tem até 30 chars, não
# contém dois-pontos, e PRECISA de espaço depois do ':' — assim "10:30" ou
# uma URL nunca viram personagem. Âncora no início da linha: "às 10: 30" no
# meio de uma fala também não conta.
RE_FALA_DIALOGO = re.compile(r'^\s*([^:\n]{1,30}?):\s+\S', re.MULTILINE)


def detectar_personagens_dialogo(texto):
    """Nomes dos personagens na ORDEM da primeira aparição (sem repetir).

    Fonte única da verdade do formato diálogo: quem valida quantidade de
    vozes (2, nem mais nem menos) são os chamadores — aqui só se detecta.
    """
    vistos = []
    for m in RE_FALA_DIALOGO.finditer(str(texto or '')):
        nome = m.group(1).strip()
        if nome and nome not in vistos:
            vistos.append(nome)
    return vistos


def texto_falado_do_dialogo(texto):
    """Remove os rótulos 'Nome:' do início das linhas — rótulo não é falado.

    Usar SÓ quando formato='dialogo': num spot de voz única, "Atenção: chegou"
    é fala normal, não personagem, e a estimativa não deve perder palavra.
    """
    return re.sub(r'^\s*[^:\n]{1,30}?:\s+', '', str(texto or ''), flags=re.MULTILINE)
```

- [ ] **Step 2: Validar sintaxe**

Run: `python -m py_compile backend/app.py` — expected: exit 0, sem saída.

- [ ] **Step 3: Testes das funções (rodar de verdade)**

Run (uma linha, do diretório raiz):

```bash
python -c "import sys; sys.path.insert(0, 'backend'); from app import detectar_personagens_dialogo as d, texto_falado_do_dialogo as t; assert d('Ana: Oi!\nZe: Ola.\nAna: Tudo bem?') == ['Ana', 'Ze'], d('Ana: Oi!\nZe: Ola.\nAna: Tudo bem?'); assert d('Seu Ze: E ai\nDona Maria: Opa') == ['Seu Ze', 'Dona Maria']; assert d('Abrimos as 10:30 da manha') == []; assert d('Ana: sozinha aqui') == ['Ana']; assert d('A: x\nB: y\nC: z') == ['A', 'B', 'C']; assert t('Ana: Oi tudo bem\nZe: Tudo') == 'Oi tudo bem\nTudo'; print('DETECCAO OK')"
```

Expected: `DETECCAO OK`. (Se o import do app falhar por env vars, exportar antes: o app importa sem crash em dev — padrão já usado nos scripts `check_*` do repo.)

- [ ] **Step 4: Commit**

```bash
git add backend/app.py
git commit -m "feat(dialogo): deteccao de personagens e texto falado (funcoes puras)"
```

Trailer (linha em branco antes): `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 2: Roteiro IA — variante diálogo

**Files:**
- Modify: `backend/app.py`, função `gerador_roteiro` (~linhas 911-1013)

- [ ] **Step 1: Ler `formato` e ajustar o fallback**

Localizar:

```python
        plano = str(data.get('plano') or 'outro')
        tipo = str(data.get('tipo') or '')[:80]
        estilo_voz = str(data.get('estilo_voz') or '')[:300]
        faixa = duracao_alvo_do_plano(plano)
```

Substituir por:

```python
        plano = str(data.get('plano') or 'outro')
        tipo = str(data.get('tipo') or '')[:80]
        estilo_voz = str(data.get('estilo_voz') or '')[:300]
        formato = 'dialogo' if str(data.get('formato') or '') == 'dialogo' else 'unico'
        faixa = duracao_alvo_do_plano(plano)

        def estimar(texto_roteiro):
            # No diálogo, os rótulos "Nome:" não são falados — descontar.
            base = texto_falado_do_dialogo(texto_roteiro) if formato == 'dialogo' else texto_roteiro
            return estimar_duracao_locucao(base)
```

- [ ] **Step 2: Usar `estimar` nos dois pontos de estimativa**

Localizar (dentro de `responder_base`):

```python
                "tempo_leitura_estimado": estimar_duracao_locucao(briefing),
```

Substituir por:

```python
                "tempo_leitura_estimado": estimar(briefing),
```

Localizar (na resposta de sucesso, perto do fim da função):

```python
            "tempo_leitura_estimado": estimar_duracao_locucao(roteiro),
```

Substituir por:

```python
            "tempo_leitura_estimado": estimar(roteiro),
```

- [ ] **Step 3: Variante diálogo no prompt**

Localizar:

```python
        prompt = f"""Você é redator publicitário de rádio no Brasil. Escreva o TEXTO FALADO de um spot comercial.
```

Inserir IMEDIATAMENTE ANTES dessa linha:

```python
        # Diálogo: as regras extras entram como bloco no MESMO prompt — a
        # grade de duração e as regras gerais continuam valendo igual.
        if formato == 'dialogo':
            regras_formato = """
FORMATO OBRIGATÓRIO — DIÁLOGO ENTRE 2 PERSONAGENS:
- Exatamente DOIS personagens, com nomes curtos e coerentes com o briefing (ex: Ana, Seu Zé).
- CADA fala em uma linha própria, no formato exato "Nome: fala" (nome, dois-pontos, espaço, fala).
- Só as falas — sem narrador, sem descrição de cena, sem rubrica.
- Os nomes dos personagens NÃO contam como palavras faladas.
- A conversa precisa vender: um personagem tem a necessidade, o outro apresenta a solução, e o fecho traz a chamada pra ação."""
        else:
            regras_formato = ""
```

Depois, na primeira linha do prompt, localizar:

```python
        prompt = f"""Você é redator publicitário de rádio no Brasil. Escreva o TEXTO FALADO de um spot comercial.
```

Substituir por:

```python
        prompt = f"""Você é redator publicitário de rádio no Brasil. Escreva o TEXTO FALADO de um spot comercial.
{regras_formato}
```

- [ ] **Step 4: Validar o formato na resposta da IA (dentro do loop de 2 tentativas)**

Localizar (dentro do `for tentativa in (1, 2):`):

```python
                candidato = json.loads(texto)
                if not (candidato.get('roteiro') or '').strip():
                    raise ValueError('JSON sem o campo roteiro')
                parsed = candidato
                break
```

Substituir por:

```python
                candidato = json.loads(texto)
                if not (candidato.get('roteiro') or '').strip():
                    raise ValueError('JSON sem o campo roteiro')
                if formato == 'dialogo':
                    # Roteiro de diálogo sem exatamente 2 personagens é resposta
                    # malformada — vale a segunda tentativa, igual JSON quebrado.
                    n_pers = len(detectar_personagens_dialogo(candidato['roteiro']))
                    if n_pers != 2:
                        raise ValueError(f'diálogo veio com {n_pers} personagem(ns), preciso de 2')
                parsed = candidato
                break
```

- [ ] **Step 5: Validar sintaxe**

Run: `python -m py_compile backend/app.py` — expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add backend/app.py
git commit -m "feat(dialogo): roteiro IA escreve conversa de 2 personagens no formato Nome: fala"
```

Trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 3: TTS multi-speaker (core/tts_generator.py + run_audio_generation)

**Files:**
- Modify: `core/tts_generator.py` (assinatura de `generate_speech` ~linha 381; bloco Google ~linhas 503-569)
- Modify: `backend/app.py`, função `run_audio_generation` (~linhas 3876-3941)

- [ ] **Step 1: Extrair o executor comum do TTS Google**

Em `core/tts_generator.py`, localizar a função `_synthesize_google` INTEIRA:

```python
    def _synthesize_google(
        self,
        text: str,
        voice: str,
        temperature: float,
        language: str
    ) -> bytes:
        """Síntese síncrona com Google Gemini."""
        try:
            generate_content_config = types.GenerateContentConfig(
                temperature=temperature,
                response_modalities=["AUDIO"],
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(
                            voice_name=voice
                        )
                    )
                ),
            )

            audio_data = io.BytesIO()
            
            response = self.google_client.models.generate_content(
                model=self.google_model,
                contents=text,
                config=generate_content_config,
            )
            
            if response.candidates and len(response.candidates) > 0:
                candidate = response.candidates[0]
                if candidate.content and candidate.content.parts:
                    for part in candidate.content.parts:
                        if part.inline_data and part.inline_data.data:
                            audio_data.write(part.inline_data.data)

            audio_bytes = audio_data.getvalue()
            if not audio_bytes:
                raise RuntimeError("Nenhum dado de áudio recebido")

            mime_type = "audio/L16;rate=24000"
            wav_data = self._convert_to_wav(audio_bytes, mime_type)
            return wav_data

        except Exception as e:
            raise RuntimeError(f"Erro ao sintetizar com Google: {str(e)}") from e
```

Substituir por:

```python
    def _executar_tts_google(self, text: str, speech_config, temperature: float) -> bytes:
        """Executa a chamada TTS do Gemini e devolve WAV.

        Comum aos caminhos de voz única e diálogo — a única diferença entre
        eles é o speech_config (VoiceConfig vs MultiSpeakerVoiceConfig).
        """
        try:
            generate_content_config = types.GenerateContentConfig(
                temperature=temperature,
                response_modalities=["AUDIO"],
                speech_config=speech_config,
            )

            audio_data = io.BytesIO()

            response = self.google_client.models.generate_content(
                model=self.google_model,
                contents=text,
                config=generate_content_config,
            )

            if response.candidates and len(response.candidates) > 0:
                candidate = response.candidates[0]
                if candidate.content and candidate.content.parts:
                    for part in candidate.content.parts:
                        if part.inline_data and part.inline_data.data:
                            audio_data.write(part.inline_data.data)

            audio_bytes = audio_data.getvalue()
            if not audio_bytes:
                raise RuntimeError("Nenhum dado de áudio recebido")

            mime_type = "audio/L16;rate=24000"
            wav_data = self._convert_to_wav(audio_bytes, mime_type)
            return wav_data

        except Exception as e:
            raise RuntimeError(f"Erro ao sintetizar com Google: {str(e)}") from e

    def _synthesize_google(
        self,
        text: str,
        voice: str,
        temperature: float,
        language: str
    ) -> bytes:
        """Síntese síncrona com Google Gemini (voz única)."""
        speech_config = types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                    voice_name=voice
                )
            )
        )
        return self._executar_tts_google(text, speech_config, temperature)

    def _generate_google_dialogo(
        self,
        text: str,
        voice_model: str,
        voice2: str,
        speakers: list,
        style: str,
    ) -> bytes:
        """Diálogo de 2 vozes numa chamada só (multi-speaker nativo do Gemini).

        `speakers` são os nomes dos personagens NA ORDEM de aparição no texto
        (detectados pelo backend) — o texto vai COM os rótulos "Nome:", é
        assim que o modelo roteia as vozes. 1º personagem → voice_model,
        2º → voice2.
        """
        if len(speakers) != 2:
            raise ValueError(f"Diálogo exige exatamente 2 personagens, recebi {len(speakers)}")
        voz1 = GOOGLE_VOICE_MAP.get(voice_model, GOOGLE_VOICE_MAP["default"])
        voz2 = GOOGLE_VOICE_MAP.get(voice2, GOOGLE_VOICE_MAP["default"])
        style = normalizar_estilo(style)
        temperature = STYLE_MAP[style]["temperature"]
        text = aplicar_instrucao_de_tom(text, style)

        speech_config = types.SpeechConfig(
            multi_speaker_voice_config=types.MultiSpeakerVoiceConfig(
                speaker_voice_configs=[
                    types.SpeakerVoiceConfig(
                        speaker=speakers[0],
                        voice_config=types.VoiceConfig(
                            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voz1)
                        ),
                    ),
                    types.SpeakerVoiceConfig(
                        speaker=speakers[1],
                        voice_config=types.VoiceConfig(
                            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voz2)
                        ),
                    ),
                ]
            )
        )
        audio_bytes = self._executar_tts_google(text, speech_config, temperature)
        print(f"✅ Diálogo gerado ({len(audio_bytes)} bytes)")
        return audio_bytes
```

- [ ] **Step 2: `generate_speech` ganha o desvio de diálogo**

Localizar (início do corpo de `generate_speech`, logo após a docstring):

```python
        # Validar texto
        if not text or not text.strip():
            raise ValueError("❌ Texto não pode estar vazio")
```

Substituir por:

```python
        # Validar texto
        if not text or not text.strip():
            raise ValueError("❌ Texto não pode estar vazio")

        # Diálogo (2 vozes): só existe no Gemini (multi-speaker nativo).
        # O desvio vem ANTES da detecção de voz clonada e do roteamento por
        # provider — diálogo nunca cai em LMNT/Edge/ElevenLabs por acidente.
        if dialogo:
            if api not in ("google", "auto"):
                raise ValueError("❌ Diálogo por enquanto é só no Modo Padrão (Google)")
            if not self.google_available:
                raise ValueError("❌ Google Gemini TTS não disponível")
            return self._generate_google_dialogo(text, voice_model, voice2 or "Puck", speakers or [], style)
```

E na assinatura, localizar:

```python
        api: Literal["edge", "google", "elevenlabs", "auto", "lmnt"] = "auto"
    ) -> bytes:
```

Substituir por:

```python
        api: Literal["edge", "google", "elevenlabs", "auto", "lmnt"] = "auto",
        dialogo: bool = False,
        voice2: str = None,
        speakers: list = None
    ) -> bytes:
```

- [ ] **Step 3: `run_audio_generation` repassa e valida**

Em `backend/app.py`, localizar:

```python
        if api == 'gemini':
            api = 'google'
        if len(text.strip()) == 0:
            return {'error': 'Texto não pode estar vazio'}, 400
        if len(text) > 5000:
            return {'error': 'Texto muito longo (máximo 5000 caracteres)'}, 400
```

Substituir por:

```python
        if api == 'gemini':
            api = 'google'
        if len(text.strip()) == 0:
            return {'error': 'Texto não pode estar vazio'}, 400
        if len(text) > 5000:
            return {'error': 'Texto muito longo (máximo 5000 caracteres)'}, 400

        # Diálogo (2 vozes): validar TUDO antes de gastar TTS.
        dialogo = bool(data.get('dialogo'))
        voice2 = str(data.get('voice2') or '')
        speakers = []
        if dialogo:
            if api not in ('google', 'auto'):
                return {'error': 'Diálogo por enquanto é só no Modo Padrão (Google).'}, 400
            api = 'google'
            if not voice2:
                return {'error': 'Escolha a Voz 2 pro diálogo.'}, 400
            speakers = detectar_personagens_dialogo(text)
            if len(speakers) < 2:
                return {'error': 'Marque as falas como "Nome: fala" — preciso de 2 personagens no roteiro.'}, 400
            if len(speakers) > 2:
                return {'error': f'O diálogo suporta 2 vozes; achei {len(speakers)} personagens ({", ".join(speakers[:4])}...). Junte ou corte pra 2.'}, 400
```

Depois, localizar:

```python
            audio_data = tts.generate_speech(
                text=text,
                voice_model=voice_model,
                style=style,
                language=language,
                api=api
            )
```

Substituir por:

```python
            audio_data = tts.generate_speech(
                text=text,
                voice_model=voice_model,
                style=style,
                language=language,
                api=api,
                dialogo=dialogo,
                voice2=voice2 or None,
                speakers=speakers or None
            )
```

E no `retry_payload` do `request_summary`, localizar:

```python
            "retry_payload": {
                "text": text,
                "voice": voice_model,
                "style": style,
                "language": language,
                "api": api,
            }
```

Substituir por:

```python
            "retry_payload": {
                "text": text,
                "voice": voice_model,
                "style": style,
                "language": language,
                "api": api,
                "dialogo": dialogo,
                "voice2": voice2,
            }
```

⚠️ ATENÇÃO à ordem no arquivo: o bloco de validação do diálogo (que define `dialogo`/`voice2`/`speakers`) vem ANTES do `request_summary` — conferir que as variáveis existem quando o `retry_payload` é montado.

- [ ] **Step 4: Validar sintaxe (os dois arquivos)**

Run: `python -m py_compile backend/app.py core/tts_generator.py` — expected: exit 0.

- [ ] **Step 5: Teste da config multi-speaker (sem gastar cota)**

Run:

```bash
python -c "from google.genai import types; c = types.SpeechConfig(multi_speaker_voice_config=types.MultiSpeakerVoiceConfig(speaker_voice_configs=[types.SpeakerVoiceConfig(speaker='Ana', voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name='Zephyr'))), types.SpeakerVoiceConfig(speaker='Ze', voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name='Puck')))])); print('CONFIG OK')"
```

Expected: `CONFIG OK`.

- [ ] **Step 6: Commit**

```bash
git add backend/app.py core/tts_generator.py
git commit -m "feat(dialogo): TTS multi-speaker do Gemini em 1 chamada (2 vozes), validado antes de gastar cota"
```

Trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 4: Frontend — select Formato, Voz 2 e payloads

**Files:**
- Modify: `templates/gerador.html` (painel de controles ~linha 158; cache-buster no fim)
- Modify: `static/gerador.js` (carregarVozes ~linha 81; gerarAnuncio ~linha 354; gerarVoz ~linha 231)

- [ ] **Step 1: HTML — select Formato + bloco Voz 2**

Em `templates/gerador.html`, localizar:

```html
                    <label class="form-label" for="selectModo">Modo</label>
```

Inserir IMEDIATAMENTE ANTES:

```html
                    <label class="form-label" for="selectFormato">Formato</label>
                    <select id="selectFormato" class="form-select mb-1">
                        <option value="unico" selected>Locutor único</option>
                        <option value="dialogo">Diálogo (2 vozes)</option>
                    </select>
                    <div class="hint mb-3">
                        Diálogo: a IA escreve a conversa com 2 personagens
                        ("Nome: fala") e cada um ganha uma voz. Por enquanto,
                        só no Modo Padrão (Google).
                    </div>

```

Depois, localizar o fim do bloco da Voz:

```html
                    <label class="form-label" for="selectVoz">Voz</label>
                    <select id="selectVoz" class="form-select mb-1"></select>
                    <div class="hint mb-3">
                        A IA não escolhe a voz — escolha aqui antes de gerar.
                    </div>
```

Substituir por:

```html
                    <label class="form-label" for="selectVoz">Voz</label>
                    <select id="selectVoz" class="form-select mb-1"></select>
                    <div class="hint mb-3">
                        A IA não escolhe a voz — escolha aqui antes de gerar.
                    </div>

                    <!-- Só aparece no formato Diálogo (2 vozes). -->
                    <div id="grupoVoz2" style="display:none">
                        <label class="form-label" for="selectVoz2">Voz 2</label>
                        <select id="selectVoz2" class="form-select mb-1"></select>
                        <div class="hint mb-3">
                            1ª voz = primeiro personagem que fala no roteiro;
                            Voz 2 = o segundo.
                        </div>
                    </div>
```

E o cache-buster: localizar `<script src="/static/gerador.js?v=6"></script>` e trocar pra `<script src="/static/gerador.js?v=7"></script>`.

- [ ] **Step 2: JS — popular Voz 2 e mostrar/esconder por formato**

Em `static/gerador.js`, localizar a função `aplicarFiltroDeVozes` INTEIRA:

```javascript
    function aplicarFiltroDeVozes() {
        const modo = document.getElementById('selectModo').value;
        const alvo = modo === 'expressivo' ? 'elevenlabs' : 'gemini';
        const sel = document.getElementById('selectVoz');
        const filtradas = estado.vozes.filter(v => v.provider === alvo);

        if (!filtradas.length) {
            sel.innerHTML = '<option value="">— nenhuma voz deste modo —</option>';
            return;
        }
        sel.innerHTML = filtradas.map((v, i) =>
            `<option value="${esc(v.id)}"${i === 0 ? ' selected' : ''}>${esc(v.name)}</option>`
        ).join('');
    }
```

Substituir por:

```javascript
    function aplicarFiltroDeVozes() {
        const modo = document.getElementById('selectModo').value;
        const alvo = modo === 'expressivo' ? 'elevenlabs' : 'gemini';
        const sel = document.getElementById('selectVoz');
        const filtradas = estado.vozes.filter(v => v.provider === alvo);

        if (!filtradas.length) {
            sel.innerHTML = '<option value="">— nenhuma voz deste modo —</option>';
        } else {
            sel.innerHTML = filtradas.map((v, i) =>
                `<option value="${esc(v.id)}"${i === 0 ? ' selected' : ''}>${esc(v.name)}</option>`
            ).join('');
        }

        // Voz 2 (diálogo) é SEMPRE do Gemini — o multi-speaker é dele. Começa
        // na segunda voz da lista pro diálogo não nascer com voz repetida.
        const sel2 = document.getElementById('selectVoz2');
        const gemini = estado.vozes.filter(v => v.provider === 'gemini');
        sel2.innerHTML = gemini.length
            ? gemini.map((v, i) =>
                `<option value="${esc(v.id)}"${i === Math.min(1, gemini.length - 1) ? ' selected' : ''}>${esc(v.name)}</option>`
              ).join('')
            : '<option value="">— catálogo de vozes vazio —</option>';
    }

    function formatoAtual() {
        return document.getElementById('selectFormato').value === 'dialogo' ? 'dialogo' : 'unico';
    }
```

- [ ] **Step 3: JS — fiação do select Formato no DOMContentLoaded**

Localizar (dentro do handler de `DOMContentLoaded`):

```javascript
        document.getElementById('textoComercial').addEventListener('input', atualizarContador);
```

Inserir IMEDIATAMENTE ANTES:

```javascript
        // ── Formato: Locutor único / Diálogo (2 vozes) ───────────────────
        const selFormato = document.getElementById('selectFormato');
        selFormato.addEventListener('change', () => {
            document.getElementById('grupoVoz2').style.display =
                selFormato.value === 'dialogo' ? '' : 'none';
        });

```

- [ ] **Step 4: JS — bloqueio Diálogo fora do Modo Padrão + payloads**

Localizar (início de `gerarAnuncio`):

```javascript
        try {
            // [1] ROTEIRO — falha aqui não interrompe: cai no briefing do cliente.
            passo(1, TOTAL, 'Escrevendo o roteiro...');
```

Substituir por:

```javascript
        try {
            // Diálogo só existe no Gemini (multi-speaker): barrar ANTES de
            // gastar roteiro/TTS. O backend valida de novo (fonte da verdade).
            if (formatoAtual() === 'dialogo' && providerDaVoz() !== 'google') {
                avisar('Diálogo por enquanto é só no Modo Padrão (Google). Troque o Modo ou o Formato.', 'atencao');
                throw new Error('Diálogo é só no Modo Padrão por enquanto.');
            }

            // [1] ROTEIRO — falha aqui não interrompe: cai no briefing do cliente.
            passo(1, TOTAL, 'Escrevendo o roteiro...');
```

Depois, no payload do roteiro, localizar:

```javascript
                    // O select é a fonte do plano: ele já foi sincronizado com o
                    // pedido (quando há um) e cobre o briefing escrito na mão.
                    plano: document.getElementById('selectPlano').value,
```

Substituir por:

```javascript
                    // O select é a fonte do plano: ele já foi sincronizado com o
                    // pedido (quando há um) e cobre o briefing escrito na mão.
                    plano: document.getElementById('selectPlano').value,
                    formato: formatoAtual(),
```

E em `gerarVoz`, localizar:

```javascript
                style: document.getElementById('selectEstilo').value,
                language: 'pt-BR'
```

Substituir por:

```javascript
                style: document.getElementById('selectEstilo').value,
                language: 'pt-BR',
                // Diálogo: o backend detecta os personagens no texto e mapeia
                // 1º -> voice, 2º -> voice2. Fora do diálogo, campos ausentes.
                dialogo: formatoAtual() === 'dialogo',
                voice2: formatoAtual() === 'dialogo'
                    ? document.getElementById('selectVoz2').value : undefined
```

- [ ] **Step 5: Validar sintaxe**

Run: `node --check static/gerador.js` — expected: exit 0, sem saída.

- [ ] **Step 6: Commit**

```bash
git add templates/gerador.html static/gerador.js
git commit -m "feat(dialogo): select Formato + Voz 2 no Gerador; bloqueio fora do Modo Padrao antes de gastar"
```

Trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 5: Verificação manual no navegador (com o produtor — SEM subagente)

Depois do deploy (push pra main):

- [ ] 1. **Regressão voz única**: gerar um spot normal (Locutor único) — tudo como antes, nada de Voz 2 na tela.
- [ ] 2. **Diálogo feliz**: Formato=Diálogo (Voz 2 aparece), briefing na mão, Gerar → roteiro vem como conversa `Nome: fala` com 2 personagens, dentro da grade do plano; áudio sai com DUAS vozes distintas conversando.
- [ ] 3. **Estimativa honesta**: o "~Xs de locução" do diálogo não conta os rótulos dos nomes.
- [ ] 4. **Bloqueio Expressivo**: Formato=Diálogo + Modo Expressivo → aviso claro, nada é gasto.
- [ ] 5. **Texto pronto do cliente**: checkbox marcado + texto com `Ana: ... / Zé: ...` colado → locuta as falas com as 2 vozes sem a IA mexer no texto.
- [ ] 6. **Erro amigável**: checkbox marcado + texto SEM `Nome:` + Formato=Diálogo → erro pedindo o formato, sem gastar TTS.
- [ ] 7. **Fluxo completo**: diálogo + trilha (do acervo ou do cliente) → mix ok, checagem de duração ok, "Abrir na MiniDAW" leva a voz (única faixa de locução) + trilha.
- [ ] 8. **Regerar só a voz** no diálogo: regera com as mesmas 2 vozes.
