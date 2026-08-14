# Automação de volume por pontos na MiniDAW clássica — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O produtor desenha pontos de volume manuais direto na timeline de uma trilha (clique cria, arrasta move, duplo-clique remove) — enquanto existir pelo menos 1 ponto, eles substituem o Ducking automático NAQUELA trilha; sem pontos, o comportamento de hoje continua idêntico.

**Architecture:** A automação entra na "agenda central" de ganho que já existe (`agendarVolumeDaFaixa` no playback, o bloco equivalente em `renderizarMix` no export) — sem nó de áudio novo, sem sistema paralelo. A função que agenda os pontos é **uma só**, compartilhada, em `static/mix-engine.js` (mesma regra da casa: "prévia e arquivo idênticos"). A interface reaproveita o padrão já existente da Tesoura (botão liga/desliga por trilha, mousedown/mousemove/mouseup sem framework novo) e o `.lane-conteudo` da timeline de clips já existente.

**Tech Stack:** JavaScript vanilla (sem build), Web Audio API (`GainNode.gain`, `setValueAtTime`/`linearRampToValueAtTime`), SVG inline pra desenhar a linha/pontos, CSS já existente em `templates/minidaw.html`.

**Spec:** `docs/superpowers/specs/2026-08-14-automacao-volume-pontos-minidaw-classica-design.md`

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `static/mix-engine.js` (modificar) | Nova função compartilhada `agendarAutomacaoVolume`; usada tanto pelo playback quanto pelo export. |
| `static/minidaw.js` (modificar) | Campo `automacaoVolume` na trilha; integra a função no playback; botão + modo de edição; overlay visual (SVG); interação de criar/arrastar/remover pontos; persistência Supabase. |
| `templates/minidaw.html` (modificar) | CSS novo pro overlay SVG e pros pontos. |

**Por que a função de agendamento mora em `mix-engine.js` e não em `minidaw.js`:** é o mesmo motivo do arquivo inteiro existir — "Não use `document` aqui dentro... Uma fonte de verdade só" (comentário do topo do arquivo). `agendarAutomacaoVolume` só mexe em `AudioParam`, sem DOM, então pertence ao motor compartilhado entre a MiniDAW clássica e o Gerador de Anúncios, exatamente como `aplicarDucking`/`aplicarGate`.

---

### Task 1: Motor — função compartilhada de automação por pontos

**Files:**
- Modify: `static/mix-engine.js` (nova função + export)

- [ ] **Step 1: Adicionar `agendarAutomacaoVolume` logo depois de `aplicarGate`**

Em `static/mix-engine.js`, localize o fim da função `aplicarGate` (fecha com `return true; }` por volta da linha 238) e adicione logo depois:

```javascript
    // ── AUTOMAÇÃO DE VOLUME POR PONTOS ───────────────────────────────────
    // Pontos manuais desenhados pelo produtor na timeline SUBSTITUEM o
    // Ducking nesta faixa -- os dois nunca coexistem no mesmo AudioParam
    // (mesmo motivo do Gate ter nó próprio: automações concorrentes
    // brigam pelo valor). `pontos` = [{tempo, volume}] (volume 0-150,
    // igual ao fader). Ordena por tempo, liga com rampa reta -- mesma
    // disciplina do Ducking/Gate, sem curva suavizada nova. Antes do
    // primeiro ponto e depois do último, o volume fica parado naquele
    // extremo -- nunca "cai" pro fader escondido no meio da automação.
    // Devolve true se aplicou (mesma convenção de retorno do aplicarDucking).
    function agendarAutomacaoVolume(gainParam, pontos, offset) {
        if (!pontos || !pontos.length) return false;
        const off = offset || 0;
        const ordenados = pontos.slice().sort((a, b) => a.tempo - b.tempo);
        gainParam.setValueAtTime(ordenados[0].volume / 100, off);
        for (let i = 1; i < ordenados.length; i++) {
            gainParam.linearRampToValueAtTime(ordenados[i].volume / 100, off + ordenados[i].tempo);
        }
        return true;
    }
```

- [ ] **Step 2: Exportar a função em `global.MixEngine`**

Trocar:
```javascript
    global.MixEngine = {
        renderizarMix, masterizarBuffer, bufferToWav, bufferToMp3,
        detectarTrechosDeVoz, detectarTrechosDeClips, aplicarDucking, aplicarGate,
        DUCK_PADRAO, GATE_PADRAO
    };
```
por:
```javascript
    global.MixEngine = {
        renderizarMix, masterizarBuffer, bufferToWav, bufferToMp3,
        detectarTrechosDeVoz, detectarTrechosDeClips, aplicarDucking, aplicarGate,
        agendarAutomacaoVolume,
        DUCK_PADRAO, GATE_PADRAO
    };
```

- [ ] **Step 3: Usar a função no export (`renderizarMix`)**

Dentro de `renderizarMix`, localize este trecho (por volta da linha 482-498):

```javascript
                // Nível da faixa (fades agora são por clip, no clipGain).
                trackGain.gain.setValueAtTime(track.volume / 100, 0);

                if (track.type === 'music' && clipsDeVoz.length > 0) {
                    // DUCKING por posição: a trilha abaixa quando a voz ENTRA
                    // de verdade na timeline, não a partir do zero.
                    const trechosDeVoz = detectarTrechosDeClips(clipsDeVoz, duck.hold);
                    const ducou = aplicarDucking(
                        trackGain.gain, trechosDeVoz, track.volume / 100, fimDaVoz, 0, duck
                    );
                    if (!ducou) {
                        trackGain.gain.linearRampToValueAtTime(track.volume / 100, fimDaVoz);
                    }
                    // Fade final: desce ao zero em 3.05s depois do fim da voz
                    // (calibrado pelo produtor contra o Samplitude).
                    trackGain.gain.linearRampToValueAtTime(0, fimDaVoz + 3.05);
                }
```

Trocar por:

```javascript
                // Automação por pontos manuais: SUBSTITUI Ducking/fade final
                // nesta faixa. Precisa ser IDÊNTICO ao playback (mesma regra
                // "prévia e arquivo idênticos" do resto do motor).
                if (!agendarAutomacaoVolume(trackGain.gain, track.automacaoVolume, 0)) {
                    // Nível da faixa (fades agora são por clip, no clipGain).
                    trackGain.gain.setValueAtTime(track.volume / 100, 0);

                    if (track.type === 'music' && clipsDeVoz.length > 0) {
                        // DUCKING por posição: a trilha abaixa quando a voz ENTRA
                        // de verdade na timeline, não a partir do zero.
                        const trechosDeVoz = detectarTrechosDeClips(clipsDeVoz, duck.hold);
                        const ducou = aplicarDucking(
                            trackGain.gain, trechosDeVoz, track.volume / 100, fimDaVoz, 0, duck
                        );
                        if (!ducou) {
                            trackGain.gain.linearRampToValueAtTime(track.volume / 100, fimDaVoz);
                        }
                        // Fade final: desce ao zero em 3.05s depois do fim da voz
                        // (calibrado pelo produtor contra o Samplitude).
                        trackGain.gain.linearRampToValueAtTime(0, fimDaVoz + 3.05);
                    }
                }
```

- [ ] **Step 4: Checar que o arquivo não tem erro de sintaxe**

Run: `node --check static/mix-engine.js`
Expected: sem saída, sem erro (só valida sintaxe, não executa — o arquivo usa `window`/globals de navegador).

- [ ] **Step 5: Commit**

```bash
git add static/mix-engine.js
git commit -m "feat(master): agendarAutomacaoVolume no motor compartilhado, ja plugado no export"
```

---

### Task 2: Campo `automacaoVolume` por trilha — criação, integração no playback, persistência

**Files:**
- Modify: `static/minidaw.js` (`addTrack`, `agendarVolumeDaFaixa`, `salvarProjetoSupabase`, `carregarProjetoSupabase`)

- [ ] **Step 1: Adicionar o campo em `addTrack`**

Em `static/minidaw.js`, dentro do objeto `track` criado por `addTrack` (por volta da linha 226-262), logo depois do campo `gateSettings`, adicionar:

```javascript
            gateSettings: { sensibilidade: 12 },
            // Pontos de automação de volume manual: [{id, tempo, volume}].
            // Enquanto tiver pelo menos 1 ponto, SUBSTITUI o Ducking nesta
            // trilha (ver agendarVolumeDaFaixa). Vazio = comportamento de
            // hoje (fader + Ducking automático), sem mudança nenhuma.
            automacaoVolume: [],
```

- [ ] **Step 2: Usar o campo em `agendarVolumeDaFaixa` (playback)**

Localize `agendarVolumeDaFaixa` (por volta da linha 1925-1958):

```javascript
    agendarVolumeDaFaixa(track, nodes, base) {
        base = Math.max(0, base);

        const g = nodes.gainNode.gain;
        g.cancelScheduledValues(0);

        const haSolo = this.tracks.some(t => t.solo);
        if (track.muted || (haSolo && !track.solo)) {
            g.setValueAtTime(0, this.audioContext.currentTime);
            return;
        }

        const nivel = track.volume / 100;
        // Fades agora são POR CLIP e vivem no clipGain de cada source (ver
        // playTrack) — aqui fica só o nível da faixa + ducking + fade final.
        g.setValueAtTime(nivel, base);

        const haVoz = this.tracks.some(t => t.type === 'voice' && t.audioBuffer);
        if (track.type === 'music' && haVoz) {
            const clipsDeVoz = this._clipsDeVoz();
            const fimDaVoz = ClipModel.fimDaFaixa(clipsDeVoz);
            const trechosDeVoz = MixEngine.detectarTrechosDeClips(clipsDeVoz, this.duckHold);
            const ducou = this.aplicarDucking(g, trechosDeVoz, nivel, fimDaVoz, base);
            if (!ducou) {
                g.linearRampToValueAtTime(nivel, base + fimDaVoz);
            }
            // Fade final: desce ao zero em 3.05s depois do fim da voz (igual
            // ao export — calibrado pelo produtor contra o Samplitude).
            g.linearRampToValueAtTime(0, base + fimDaVoz + 3.05);
        }
    }
```

Trocar por:

```javascript
    agendarVolumeDaFaixa(track, nodes, base) {
        base = Math.max(0, base);

        const g = nodes.gainNode.gain;
        g.cancelScheduledValues(0);

        const haSolo = this.tracks.some(t => t.solo);
        if (track.muted || (haSolo && !track.solo)) {
            g.setValueAtTime(0, this.audioContext.currentTime);
            return;
        }

        // Automação por pontos manuais: SUBSTITUI Ducking/fade final nesta
        // faixa (nunca convivem no mesmo AudioParam). Mesma função do export
        // em mix-engine.js -- prévia e arquivo idênticos.
        if (MixEngine.agendarAutomacaoVolume(g, track.automacaoVolume, base)) return;

        const nivel = track.volume / 100;
        // Fades agora são POR CLIP e vivem no clipGain de cada source (ver
        // playTrack) — aqui fica só o nível da faixa + ducking + fade final.
        g.setValueAtTime(nivel, base);

        const haVoz = this.tracks.some(t => t.type === 'voice' && t.audioBuffer);
        if (track.type === 'music' && haVoz) {
            const clipsDeVoz = this._clipsDeVoz();
            const fimDaVoz = ClipModel.fimDaFaixa(clipsDeVoz);
            const trechosDeVoz = MixEngine.detectarTrechosDeClips(clipsDeVoz, this.duckHold);
            const ducou = this.aplicarDucking(g, trechosDeVoz, nivel, fimDaVoz, base);
            if (!ducou) {
                g.linearRampToValueAtTime(nivel, base + fimDaVoz);
            }
            // Fade final: desce ao zero em 3.05s depois do fim da voz (igual
            // ao export — calibrado pelo produtor contra o Samplitude).
            g.linearRampToValueAtTime(0, base + fimDaVoz + 3.05);
        }
    }
```

- [ ] **Step 3: Persistir no Supabase — salvar**

Em `salvarProjetoSupabase` (por volta da linha 3864-3871), localize:

```javascript
                const td = {
                    name: t.name, type: t.type,
                    volume: t.volume, pan: t.pan,
                    fadeIn: t.fadeIn, fadeOut: t.fadeOut,
                    effects: t.effects, eqSettings: t.eqSettings,
                    gateSettings: t.gateSettings,
                    buffers: [], clips: []
                };
```

Trocar por:

```javascript
                const td = {
                    name: t.name, type: t.type,
                    volume: t.volume, pan: t.pan,
                    fadeIn: t.fadeIn, fadeOut: t.fadeOut,
                    effects: t.effects, eqSettings: t.eqSettings,
                    gateSettings: t.gateSettings,
                    automacaoVolume: t.automacaoVolume,
                    buffers: [], clips: []
                };
```

- [ ] **Step 4: Persistir no Supabase — carregar**

Em `carregarProjetoSupabase` (por volta da linha 4002-4009), localize:

```javascript
                track.name      = td.name ?? track.name;
                track.volume    = (td.volume    != null) ? td.volume    : 100;
                track.pan       = (td.pan       != null) ? td.pan       : 0;
                track.fadeIn    = (td.fadeIn    != null) ? td.fadeIn    : 0;
                track.fadeOut   = (td.fadeOut   != null) ? td.fadeOut   : 0;
                track.effects   = td.effects    || track.effects;
                track.eqSettings= td.eqSettings || track.eqSettings;
                track.gateSettings = td.gateSettings || track.gateSettings;
```

Trocar por:

```javascript
                track.name      = td.name ?? track.name;
                track.volume    = (td.volume    != null) ? td.volume    : 100;
                track.pan       = (td.pan       != null) ? td.pan       : 0;
                track.fadeIn    = (td.fadeIn    != null) ? td.fadeIn    : 0;
                track.fadeOut   = (td.fadeOut   != null) ? td.fadeOut   : 0;
                track.effects   = td.effects    || track.effects;
                track.eqSettings= td.eqSettings || track.eqSettings;
                track.gateSettings = td.gateSettings || track.gateSettings;
                // Projetos salvos ANTES desta feature não têm esse campo —
                // td.automacaoVolume vem undefined e cai no [] que addTrack
                // já deu à track (mesmo padrão de fallback de effects/eqSettings/gateSettings acima).
                track.automacaoVolume = td.automacaoVolume || track.automacaoVolume;
```

- [ ] **Step 5: `localStorage` não precisa de nenhuma mudança**

Confirme lendo `saveToLocalStorage` (por volta da linha 3199-3217): ela espalha `...track` inteiro pro JSON, só zerando explicitamente `audioUrl`/`audioBuffer`/`clips`/`_clipsBuffer`. `automacaoVolume` é um array plano de objetos simples (`{id, tempo, volume}`), serializa em JSON sem problema nenhum e passa direto por esse spread — não precisa tocar nesse método nem em `loadFromLocalStorage`.

- [ ] **Step 6: Checar sintaxe**

Run: `node --check static/minidaw.js`
Expected: sem saída, sem erro.

- [ ] **Step 7: Commit**

```bash
git add static/minidaw.js
git commit -m "feat(master): campo automacaoVolume por trilha, entra no playback e na persistencia"
```

---

### Task 3: Botão "Automação" por trilha (modo de edição, exclusivo com a Tesoura)

**Files:**
- Modify: `static/minidaw.js` (`createTrackUI`, novo método `toggleAutomacaoVolume`, ajuste em `toggleScissorMode`)
- Modify: `templates/minidaw.html` (CSS do indicador "tem pontos")

- [ ] **Step 1: Adicionar o botão no HTML da trilha**

Em `createTrackUI` (por volta da linha 406-410), localize o botão da Tesoura:

```javascript
                            <button class="effect-btn ${this.trackTesoura === track.id ? 'active' : ''}"
                                    id="btntesoura_${track.id}"
                                    onclick="minidaw.toggleScissorMode('${track.id}')" title="Tesoura">
                                <i class="fas fa-cut"></i> Tesoura
                            </button>
```

Adicionar logo depois:

```javascript
                            <button class="effect-btn ${this.trackAutomacao === track.id ? 'active' : ''} ${(track.automacaoVolume && track.automacaoVolume.length) ? 'tem-automacao' : ''}"
                                    id="btnautomacao_${track.id}"
                                    onclick="minidaw.toggleAutomacaoVolume('${track.id}')" title="Automação de volume (pontos manuais — substitui o Ducking nesta faixa enquanto tiver pontos)">
                                <i class="fas fa-wave-square"></i> Automação
                            </button>
```

- [ ] **Step 2: CSS do indicador "tem pontos salvos"**

Em `templates/minidaw.html`, logo depois da regra `.effect-btn.active` (por volta da linha 437-441):

```css
        .effect-btn.active {
            background: var(--accent-color);
            color: white;
            border-color: var(--accent-color);
        }
```

Adicionar logo depois:

```css
        /* Trilha tem pontos de automação salvos mas o modo de edição está
           fechado agora -- sem isto, o Ducking parece "quebrado" sem
           explicação nenhuma na tela (ele está desligado por causa dos
           pontos, só que a linha deles está escondida). */
        .effect-btn.tem-automacao:not(.active) {
            border-color: #fbbf24;
            color: #fbbf24;
        }
```

- [ ] **Step 3: Método `toggleAutomacaoVolume`**

Adicionar logo depois do fim de `toggleScissorMode` (procure o fechamento `}` que vem depois do `this.showNotification(...)` daquele método, por volta da linha 3290):

```javascript
    // ── AUTOMAÇÃO DE VOLUME POR PONTOS ───────────────────────────────────
    // Modo por faixa, mesmo padrão da Tesoura: liga só numa faixa por vez.
    // Nunca liga junto com a Tesoura NA MESMA faixa -- a lane não teria
    // como distinguir "clique pra marcar corte" de "clique pra criar ponto".
    toggleAutomacaoVolume(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (!track) return;

        const ligando = this.trackAutomacao !== trackId;
        this.trackAutomacao = ligando ? trackId : null;

        if (ligando && this.trackTesoura === trackId) {
            this.cancelarSelecao(trackId);
            this.trackTesoura = null;
            this.scissorMode = false;
            const btnTesoura = document.getElementById(`btntesoura_${trackId}`);
            if (btnTesoura) btnTesoura.classList.remove('active');
        }

        const btn = document.getElementById(`btnautomacao_${trackId}`);
        if (btn) btn.classList.toggle('active', ligando);
        this.desenharAutomacaoVolume(track);

        this.showNotification(
            ligando ? 'Automação de volume ligada — clique na linha pra criar pontos'
                    : 'Automação de volume desligada',
            ligando ? 'info' : 'success');
    }
```

- [ ] **Step 4: Ajustar `toggleScissorMode` pra desligar a Automação na mesma faixa**

Dentro de `toggleScissorMode`, localize:

```javascript
        const ligando = this.trackTesoura !== trackId;
        // Só uma faixa armada por vez: duas seleções ao mesmo tempo só
        // confundem na hora de decidir onde o corte vai cair.
        const anterior = this.trackTesoura;
        this.trackTesoura = ligando ? trackId : null;
        this.scissorMode = ligando;

        if (anterior && anterior !== trackId) this.cancelarSelecao(anterior);
        if (!ligando) this.cancelarSelecao(trackId);
```

Trocar por:

```javascript
        const ligando = this.trackTesoura !== trackId;
        // Só uma faixa armada por vez: duas seleções ao mesmo tempo só
        // confundem na hora de decidir onde o corte vai cair.
        const anterior = this.trackTesoura;
        this.trackTesoura = ligando ? trackId : null;
        this.scissorMode = ligando;

        if (anterior && anterior !== trackId) this.cancelarSelecao(anterior);
        if (!ligando) this.cancelarSelecao(trackId);

        // Nunca as duas ligadas juntas na mesma faixa (ver toggleAutomacaoVolume).
        if (ligando && this.trackAutomacao === trackId) {
            this.trackAutomacao = null;
            const btnAuto = document.getElementById(`btnautomacao_${trackId}`);
            if (btnAuto) btnAuto.classList.remove('active');
            const t = this.tracks.find(tr => tr.id === trackId);
            if (t) this.desenharAutomacaoVolume(t);
        }
```

- [ ] **Step 5: Checar sintaxe**

Run: `node --check static/minidaw.js`
Expected: sem saída, sem erro. (`desenharAutomacaoVolume` ainda não existe — isso é normal, só é chamado dentro de funções que rodam em runtime, não quebra a sintaxe. A Task 4 cria essa função.)

- [ ] **Step 6: Commit**

```bash
git add static/minidaw.js templates/minidaw.html
git commit -m "feat(master): botao Automacao por trilha, exclusivo com a Tesoura"
```

---

### Task 4: Overlay visual (linha + pontos) e interação de criar/arrastar/remover

**Files:**
- Modify: `static/minidaw.js` (`renderizarClips`, novo método `desenharAutomacaoVolume`, novos métodos `mousedownAutomacao`/`dblclickAutomacao`)
- Modify: `templates/minidaw.html` (CSS do SVG/linha/pontos)

- [ ] **Step 1: CSS do overlay**

Em `templates/minidaw.html`, logo depois da regra `.playhead-regua::before` (por volta da linha 730-734), adicionar:

```css
        /* Linha de automação de volume: some quando a trilha não está no
           modo de edição (mesmo padrão da barra-corte da Tesoura). Sem
           viewBox de propósito -- as coordenadas dos pontos/linha são
           calculadas em pixels, na MESMA escala (pxPorSegundo) dos clips,
           então usar o sistema de coordenadas padrão do SVG (1 unidade =
           1px) encaixa direto, sem conversão. */
        .automacao-svg {
            position: absolute; inset: 0; width: 100%; height: 100%;
            z-index: 5; pointer-events: none; display: none;
        }
        .automacao-svg.ativa { display: block; pointer-events: auto; }
        .automacao-poly { fill: none; stroke: #fbbf24; stroke-width: 2; }
        .automacao-ponto {
            fill: #fbbf24; stroke: #78350f; stroke-width: 1; cursor: grab;
        }
        .automacao-ponto:active { cursor: grabbing; }
```

- [ ] **Step 2: Criar o overlay dentro de `renderizarClips` (uma vez por lane)**

Em `static/minidaw.js`, dentro de `renderizarClips`, localize o bloco que cria `.playhead` (por volta da linha 969-974):

```javascript
        if (!conteudo.querySelector('.playhead')) {
            const ph = document.createElement('div');
            ph.className = 'playhead';
            ph.style.left = ((this.currentTime || 0) * this.pxPorSegundo) + 'px';
            conteudo.appendChild(ph);
        }
```

Adicionar logo depois:

```javascript
        if (!conteudo.querySelector('.automacao-svg')) {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'automacao-svg');
            svg.setAttribute('id', `automacaosvg_${track.id}`);
            svg.innerHTML = '<polyline class="automacao-poly"></polyline>';
            svg.addEventListener('mousedown', (ev) => this.mousedownAutomacao(ev, track.id));
            svg.addEventListener('dblclick', (ev) => this.dblclickAutomacao(ev, track.id));
            conteudo.appendChild(svg);
        }
```

- [ ] **Step 3: Chamar o redesenho no fim de `renderizarClips`**

Ainda em `renderizarClips`, localize o fim do método — o `}` que fecha o `for (const clip of this._clipsDaFaixa(track)) { ... }` (por volta da linha 999), seguido do `}` que fecha o método inteiro (linha 1000):

```javascript
            el.addEventListener('mousedown', (ev) => this.mousedownClip(ev, track.id, clip.id));
            conteudo.appendChild(el);
            this.desenharOndaDoClip(track, clip, el.querySelector('canvas'));
        }
    }
```

Trocar por:

```javascript
            el.addEventListener('mousedown', (ev) => this.mousedownClip(ev, track.id, clip.id));
            conteudo.appendChild(el);
            this.desenharOndaDoClip(track, clip, el.querySelector('canvas'));
        }
        this.desenharAutomacaoVolume(track);
    }
```

Isso garante que a linha de automação sempre se realinha (tanto no zoom horizontal quanto no vertical, via `_ajustarAltura` → `renderizarClips`) sem precisar de nenhum gancho novo — `renderizarClips` já roda em todo redesenho relevante.

- [ ] **Step 4: Método `desenharAutomacaoVolume`**

Adicionar logo depois do método `renderizarClips` (depois do `}` que fecha ele, antes de `desenharOndaDoClip`):

```javascript
    // Redesenha a linha + pontos de automação de UMA faixa. Esconde tudo
    // (via a classe `.ativa`) se o modo de edição não está ligado nela —
    // "a linha some quando não está em uso" (decisão do produtor).
    desenharAutomacaoVolume(track) {
        const lane = document.getElementById(`lane_${track.id}`);
        if (!lane) return;
        const conteudo = lane.querySelector('.lane-conteudo');
        if (!conteudo) return;
        const svg = conteudo.querySelector('.automacao-svg');
        if (!svg) return;

        const ativo = this.trackAutomacao === track.id;
        svg.classList.toggle('ativa', ativo);
        if (!ativo) return;   // nada pra desenhar com o modo desligado

        const pontos = track.automacaoVolume || [];
        const altura = track.altura || MiniDAW.ALTURA_LANE_PADRAO;
        const yDoVolume = (v) => altura - (Math.max(0, Math.min(150, v)) / 150) * altura;

        const ordenados = pontos.slice().sort((a, b) => a.tempo - b.tempo);
        const poly = svg.querySelector('.automacao-poly');
        poly.setAttribute('points', ordenados.map(p => `${p.tempo * this.pxPorSegundo},${yDoVolume(p.volume)}`).join(' '));

        svg.querySelectorAll('.automacao-ponto').forEach(el => el.remove());
        for (const p of ordenados) {
            const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            c.setAttribute('class', 'automacao-ponto');
            c.setAttribute('cx', p.tempo * this.pxPorSegundo);
            c.setAttribute('cy', yDoVolume(p.volume));
            c.setAttribute('r', 5);
            c.dataset.pontoId = p.id;
            svg.appendChild(c);
        }
    }
```

- [ ] **Step 5: Métodos de interação — criar, arrastar, remover**

Adicionar logo depois de `desenharAutomacaoVolume`:

```javascript
    // Converte a posição Y do mouse (relativa ao topo da .lane-conteudo) num
    // volume 0-150, mesma escala do fader. Recalcula o retângulo TODA vez
    // (mesmo padrão do _tempoNoPonto já existente) em vez de cachear no
    // início do arrasto — a lane não rola verticalmente, mas a PÁGINA pode
    // rolar durante um arrasto longo, e um rect cacheado ficaria errado.
    _volumeNoPonto(ev, track) {
        const lane = document.getElementById(`lane_${track.id}`);
        if (!lane) return 0;
        const conteudo = lane.querySelector('.lane-conteudo');
        if (!conteudo) return 0;
        const altura = track.altura || MiniDAW.ALTURA_LANE_PADRAO;
        const r = conteudo.getBoundingClientRect();
        const y = ev.clientY - r.top;
        return Math.max(0, Math.min(150, 150 - (y / altura) * 150));
    }

    mousedownAutomacao(ev, trackId) {
        if (this.trackAutomacao !== trackId) return;   // modo desligado nesta faixa
        const track = this.tracks.find(t => t.id === trackId);
        if (!track) return;
        ev.preventDefault();
        ev.stopPropagation();

        if (ev.target.classList.contains('automacao-ponto')) {
            // Arrastar ponto existente — tempo E volume seguem o mouse juntos.
            const ponto = track.automacaoVolume.find(p => p.id === ev.target.dataset.pontoId);
            if (!ponto) return;
            const mover = (e) => {
                ponto.tempo = Math.max(0, this._tempoNoPonto(e, track));
                ponto.volume = this._volumeNoPonto(e, track);
                this.desenharAutomacaoVolume(track);
            };
            const soltar = () => {
                document.removeEventListener('mousemove', mover);
                document.removeEventListener('mouseup', soltar);
                this.saveToLocalStorage();
                this.aplicarVolumeAgora(track, this.trackNodes.get(trackId));
            };
            document.addEventListener('mousemove', mover);
            document.addEventListener('mouseup', soltar);
            return;
        }

        // Clique em espaço vazio: cria um ponto novo ali.
        const eraPrimeiro = track.automacaoVolume.length === 0;
        track.automacaoVolume.push({
            id: ClipModel.novoId(),
            tempo: Math.max(0, this._tempoNoPonto(ev, track)),
            volume: this._volumeNoPonto(ev, track)
        });
        this.desenharAutomacaoVolume(track);
        this.saveToLocalStorage();
        this.aplicarVolumeAgora(track, this.trackNodes.get(trackId));
        if (eraPrimeiro) {
            this.showNotification('Primeiro ponto criado — o Ducking automático desligou nesta faixa.', 'info');
        }
    }

    dblclickAutomacao(ev, trackId) {
        if (this.trackAutomacao !== trackId) return;
        if (!ev.target.classList.contains('automacao-ponto')) return;
        const track = this.tracks.find(t => t.id === trackId);
        if (!track || !track.automacaoVolume) return;
        ev.preventDefault();
        ev.stopPropagation();

        const idx = track.automacaoVolume.findIndex(p => p.id === ev.target.dataset.pontoId);
        if (idx === -1) return;
        track.automacaoVolume.splice(idx, 1);
        this.desenharAutomacaoVolume(track);
        this.saveToLocalStorage();
        this.aplicarVolumeAgora(track, this.trackNodes.get(trackId));
        if (track.automacaoVolume.length === 0) {
            this.showNotification('Automação removida — o Ducking automático voltou nesta faixa.', 'info');
        }
    }
```

- [ ] **Step 6: Checar sintaxe**

Run: `node --check static/minidaw.js`
Expected: sem saída, sem erro.

- [ ] **Step 7: Commit**

```bash
git add static/minidaw.js templates/minidaw.html
git commit -m "feat(master): overlay visual e interacao de criar/arrastar/remover pontos de automacao"
```

---

### Task 5: Verificação manual (protocolo do produtor)

Sem código novo — é o critério de sucesso da spec. A MiniDAW clássica não
tem suíte de testes automatizados (é a página `/minidaw`, vanilla JS,
verificada no navegador — diferente da parte React, que tem `node --test`).
Passo a passo:

1. Abrir `/minidaw`, criar um projeto com uma faixa de Voz e uma faixa de
   Trilha (música), com áudio real nas duas.
2. Na faixa de Trilha, clicar em "Automação" — a linha deve aparecer por
   cima da forma de onda, e o botão "Tesoura" (se estivesse ligado)
   desliga sozinho.
3. Clicar em 3-4 pontos em posições/alturas diferentes ao longo da linha
   — cada clique deve criar um ponto na hora, e o primeiro deve mostrar o
   aviso "Ducking automático desligou nesta faixa".
4. Dar play e ouvir: o volume da trilha deve seguir a curva desenhada, não
   mais o Ducking automático baseado na voz.
5. Arrastar um ponto existente (mudar tempo e volume) e confirmar que a
   linha e o áudio acompanham.
6. Dar duplo-clique num ponto pra remover — confirmar que ele some e (se
   era o último) o aviso de "Ducking voltou" aparece.
7. Clicar em "Automação" de novo pra desligar o modo — confirmar que a
   linha some da tela mas os pontos continuam guardados (ligar de novo
   mostra eles do mesmo jeito).
8. **Exportar o mix** (botão de export) e ouvir o arquivo gerado —
   confirmar que a curva de volume no arquivo exportado é IDÊNTICA ao que
   tocou na prévia (a regra "prévia e arquivo idênticos" da casa).
9. Salvar o projeto no Supabase ("Salvar Projeto"), recarregar a página e
   reabrir ("Meus Projetos") — confirmar que os pontos de automação
   voltaram exatamente onde estavam.
10. Testar o cenário de negócio original: uma trilha com um trecho onde a
    locução entra, usando os pontos pra abaixar o volume ali e subir de
    volta quando a locução termina — comparar de ouvido contra o que o
    Ducking automático faria sozinho.

Só reportar como concluído depois desse teste real no navegador.
