class MiniDAW {
    constructor() {
        this.tracks = [];
        this.isPlaying = false;
        this.currentTime = 0;
        this.duration = 0;
        this.exportFormat = 'wav';
        this.mp3Bitrate = 192;
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.audioContext.createGain();
        this.masterGain.connect(this.audioContext.destination);
        this.trackNodes = new Map();
        this.updateInterval = null;
        
        // Novas funcionalidades
        this.scissorMode = false;
        this.trackTesoura = null;   // qual faixa está com a tesoura armada
        this.selecoes = {};         // trackId -> {ini, fim} em segundos
        this.globalZoom = 1;
        this.autoFadeEnabled = true;
        // ⚠️ autoFadeDuration NÃO está ligado em nada — o código usa 1.05 fixo em
        // todos os pontos (playback, export, botão de auto-fade). Mudar aqui não
        // muda o áudio. Mantido pra não quebrar quem lê, mas não confie nele.
        this.autoFadeDuration = 1.10;

        // ── DUCKING — TODOS os ajustes num lugar só, afináveis de ouvido ──
        // duckGain: o quanto a trilha abaixa embaixo da voz (multiplicador).
        //   0.28 ≈ -11 dB (quase some) | 0.45 ≈ -7 dB (padrão) | 0.60 ≈ -4 dB
        this.duckGain = 0.45;
        // duckAttack: tempo pra ABAIXAR quando a voz entra. Menor = mais brusco.
        //   0.08 era abrupto ("baixa de uma vez"); 0.20 desce suave sem tapar a sílaba.
        this.duckAttack = 0.20;
        // duckRelease: tempo pra SUBIR quando a voz para. Maior = mais suave.
        this.duckRelease = 0.65;
        // duckHold: pausas menores que isso NÃO soltam a trilha. Era 0.30 e a trilha
        //   pulava (bombeava) entre frases; 0.70 mantém ela quieta nas respiradas.
        this.duckHold = 0.70;

        // ── OTIMIZAR (mastering leve) ─────────────────────────────────────
        // Alvo de loudness do "Otimizar 1-clique". null = desligado (export
        // normal). Quando setado (dBFS RMS aprox.), o export normaliza o mix pro
        // alvo e aplica soft-limiter em -1dB. NÃO é LUFS certificado — é
        // "profissional, alto e consistente". Presets em otimizarPresets.
        this.masterTarget = null;
        this.otimizarPresets = {
            streaming: -15,  // alto (YouTube/Insta/WhatsApp) — padrão
            podcast:   -19,
            radio:     -23,  // padrão de broadcast (mais baixo/normalizado)
        };

        this.voiceEndDetected = new Map();
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.updateUI();
        // Limpar tracks antigos do localStorage para evitar tracks mocados
        this.clearSavedTracks();
    }

    clearSavedTracks() {
        // Limpa apenas os tracks salvos, mantém as configurações
        try {
            const saved = localStorage.getItem('minidaw_project');
            if (saved) {
                const data = JSON.parse(saved);
                // Mantém apenas configurações, remove tracks
                const cleanedData = {
                    tracks: [],
                    exportFormat: data.exportFormat || 'wav',
                    mp3Bitrate: data.mp3Bitrate || 192
                };
                localStorage.setItem('minidaw_project', JSON.stringify(cleanedData));
            }
        } catch (error) {
            console.error('Error clearing saved tracks:', error);
        }
    }

    setupEventListeners() {
        // Prevent default drag behaviors
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            document.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) {
            e.preventDefault();
            e.stopPropagation();
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Tecla + para zoom in
            if (e.key === '+' || e.key === '=') {
                e.preventDefault();
                this.zoomIn();
            }
            // Tecla - para zoom out
            else if (e.key === '-' || e.key === '_') {
                e.preventDefault();
                this.zoomOut();
            }
            // Espaço para play/pause
            else if (e.key === ' ') {
                e.preventDefault();
                this.togglePlayback();
            }
            // S para stop
            else if (e.key === 's' || e.key === 'S') {
                e.preventDefault();
                this.stopPlayback();
            }
            // C para tesoura
            else if (e.key === 'c' || e.key === 'C') {
                e.preventDefault();
                this.toggleScissorMode();
            }
        });

        // O handler de clique que cortava a faixa saiu daqui: agora quem trata
        // é o onmousedown do próprio .waveform-container (iniciarSelecao), que
        // suporta arrastar pra marcar início e fim. Manter os dois faria o
        // clique cortar a faixa no meio do arrasto.
    }

    addTrack(type = 'voice') {
        const trackId = 'track_' + Date.now();
        const trackName = type === 'voice' ? `Voz ${this.tracks.filter(t => t.type === 'voice').length + 1}` : `Trilha ${this.tracks.filter(t => t.type === 'music').length + 1}`;
        
        const track = {
            id: trackId,
            name: trackName,
            type: type,
            audioUrl: null,
            audioBuffer: null,
            sourceNode: null,
            gainNode: null,
            volume: 100,
            pan: 0,
            fadeIn: 0,
            fadeOut: 0,
            muted: false,
            solo: false,
            effects: {
                reverb: false,
                delay: false,
                compressor: false,
                eq: false,
                hpf: true,
                presence: false,
                limiter: true,
                gate: false
            },
            // Sensibilidade do gate em % do pico: quanto MAIOR, mais coisa
            // vira pausa e mais respiração some — mas passar do ponto começa
            // a comer o comecinho das palavras. Acha-se de ouvido.
            gateSettings: { sensibilidade: 12 },
            color: type === 'voice' ? '#3b82f6' : '#a855f7'
        };

        this.tracks.push(track);
        this.createTrackUI(track);
        this.updateUI();
        this.saveToLocalStorage();
    }

    createTrackUI(track) {
        const container = document.getElementById('tracksContainer');
        const emptyState = document.getElementById('emptyState');
        
        if (emptyState) {
            emptyState.style.display = 'none';
        }

        const trackCard = document.createElement('div');
        trackCard.className = 'track-card';
        trackCard.id = `track_${track.id}`;
        
        trackCard.innerHTML = `
            <div class="track-header">
                <div class="auto-fade-indicator" id="autoFade_${track.id}">
                    <i class="fas fa-magic me-1"></i>
                    Auto Fade Ativo
                </div>
                <div class="track-zoom-controls">
                    <button class="track-zoom-btn" onclick="minidaw.trackZoomIn('${track.id}')" title="Zoom In (+)">
                        <i class="fas fa-plus"></i>
                    </button>
                    <button class="track-zoom-btn" onclick="minidaw.trackZoomOut('${track.id}')" title="Zoom Out (-)">
                        <i class="fas fa-minus"></i>
                    </button>
                </div>
                <div class="d-flex align-items-center gap-3">
                    <div class="track-type ${track.type}" onclick="minidaw.alternarTipoFaixa('${track.id}')"
                         title="Clique para trocar entre Voz e Trilha. Isto NÃO é só um rótulo: só faixa de Voz aciona o ducking e o auto fade-out da trilha.">
                        ${track.type === 'voice' ? 'Voz' : 'Trilha'}
                        <i class="fas fa-repeat ms-1" style="font-size:.7em;opacity:.7;"></i>
                    </div>
                    <input type="text" class="form-control form-control-sm" value="${track.name}" 
                           onchange="minidaw.updateTrackName('${track.id}', this.value)" style="max-width: 200px;">
                </div>
                <div class="d-flex gap-2">
                    <button class="btn btn-sm btn-outline-secondary ${track.muted ? 'active' : ''}" onclick="toggleMute('${track.id}')" title="Mudo">
                        <i class="fas fa-volume-mute"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-info ${track.solo ? 'active' : ''}" onclick="toggleSolo('${track.id}')" title="Solo">
                        <i class="fas fa-headphones"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-warning" onclick="minidaw.baixarFaixa('${track.id}')"
                            title="Salvar esta faixa (baixa o áudio como está, já editado)">
                        <i class="fas fa-floppy-disk"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger" onclick="removeTrack('${track.id}')" title="Remover Track">
                        <i class="fas fa-trash"></i>
                    </button>
                    <button class="btn btn-sm btn-success" onclick="addTrack('${track.type}')" title="Criar Novo Track">
                        <i class="fas fa-plus"></i>
                    </button>
                </div>
            </div>
            
            ${!track.audioUrl ? `
                <div class="drop-zone-track" id="drop_${track.id}" 
                     ondrop="minidaw.handleTrackDrop(event, '${track.id}')" 
                     ondragover="minidaw.handleDragOver(event)" 
                     ondragleave="minidaw.handleDragLeave(event)">
                    <i class="fas fa-cloud-upload-alt"></i>
                    <p>Arraste áudio aqui ou clique para escolher</p>
                    <input type="file" accept="audio/*" style="display: none;" 
                           onchange="minidaw.handleTrackFileSelect(event, '${track.id}')">
                    <button class="btn btn-daw btn-sm mt-2" onclick="document.querySelector('#drop_${track.id} input').click()">
                        Escolher Arquivo
                    </button>
                </div>
            ` : `
                <div class="waveform-container" id="wfbox_${track.id}"
                     onmousedown="minidaw.iniciarSelecao(event, '${track.id}')">
                    <canvas id="waveform_${track.id}" class="waveform"></canvas>
                    <!-- Guia do corte: região destacada + as duas hastes -->
                    <div class="sel-regiao" id="selreg_${track.id}"></div>
                    <div class="sel-haste sel-haste-ini" id="selini_${track.id}"></div>
                    <div class="sel-haste sel-haste-fim" id="selfim_${track.id}"></div>
                </div>
                <div class="barra-corte" id="barracorte_${track.id}">
                    <span class="corte-info" id="corteinfo_${track.id}"></span>
                    <button class="btn btn-sm btn-danger" onclick="minidaw.aplicarCorte('${track.id}', 'remover')">
                        <i class="fas fa-eraser me-1"></i>Remover trecho
                    </button>
                    <button class="btn btn-sm btn-primary" onclick="minidaw.aplicarCorte('${track.id}', 'manter')">
                        <i class="fas fa-crop me-1"></i>Manter só isto
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="minidaw.aplicarCorte('${track.id}', 'dividir')">
                        <i class="fas fa-scissors me-1"></i>Dividir no início
                    </button>
                    <button class="btn btn-sm btn-outline-light" onclick="minidaw.cancelarSelecao('${track.id}')">
                        Cancelar
                    </button>
                </div>
                <div class="controls-panel">
                    <div class="control-group">
                        <span class="control-label">Volume:</span>
                        <input type="range" class="form-range volume-slider" min="0" max="150" value="${track.volume}"
                               onchange="minidaw.updateTrackVolume('${track.id}', this.value)">
                        <span class="control-label">${track.volume}%</span>
                    </div>
                    <div class="control-group">
                        <span class="control-label">Pan:</span>
                        <input type="range" class="form-range pan-slider" min="-100" max="100" value="${track.pan * 100}"
                               onchange="minidaw.updateTrackPan('${track.id}', this.value)">
                    </div>
                    <div class="control-group">
                        <span class="control-label">Fade In:</span>
                        <input type="range" class="form-range fade-slider" min="0" max="5" step="0.1" value="${track.fadeIn}"
                               onchange="minidaw.updateTrackFadeIn('${track.id}', this.value)">
                    </div>
                    <div class="control-group">
                        <span class="control-label">Fade Out:</span>
                        <input type="range" class="form-range fade-slider" min="0" max="5" step="0.1" value="${track.fadeOut}"
                               onchange="minidaw.updateTrackFadeOut('${track.id}', this.value)">
                    </div>
                </div>
                <div class="track-effects">
                            <button class="effect-btn" onclick="abrirBibliotecaModal()" title="Biblioteca de Trilhas (adiciona sem apagar a voz)">
                                <i class="fas fa-book-open"></i> Biblioteca
                            </button>
                            <button class="effect-btn" onclick="window.open('https://app.lmnt.com/', '_blank')" title="LMNT Studio">
                                <i class="fas fa-external-link-alt"></i> LMNT
                            </button>
                            <button class="effect-btn ${this.trackTesoura === track.id ? 'active' : ''}"
                                    id="btntesoura_${track.id}"
                                    onclick="minidaw.toggleScissorMode('${track.id}')" title="Tesoura">
                                <i class="fas fa-cut"></i> Tesoura
                            </button>
                            <button class="effect-btn" onclick="minidaw.normalizeVolumes()" title="Normalizar">
                                <i class="fas fa-sliders-h"></i> Normalizar
                            </button>
                            <button class="effect-btn" onclick="minidaw.applyAutoFade()" title="Auto Fade">
                                <i class="fas fa-wave-square"></i> Auto Fade
                            </button>
                            <div class="ms-2 border-start border-secondary px-2"></div>
                            <button class="effect-btn ${track.effects.reverb ? 'active' : ''}" 
                                    onclick="minidaw.toggleEffect('${track.id}', 'reverb')">
                                <i class="fas fa-water"></i> Reverb
                            </button>
                            <button class="effect-btn ${track.effects.delay ? 'active' : ''}" 
                                    onclick="minidaw.toggleEffect('${track.id}', 'delay')">
                                <i class="fas fa-clock"></i> Delay
                            </button>
                            <button class="effect-btn ${track.effects.compressor ? 'active' : ''}" 
                                    onclick="minidaw.toggleEffect('${track.id}', 'compressor')">
                                <i class="fas fa-compress"></i> Compressor
                            </button>
                            <button class="effect-btn ${track.effects.eq ? 'active' : ''}" 
                                    onclick="minidaw.toggleEffect('${track.id}', 'eq')">
                                <i class="fas fa-sliders-h"></i> EQ
                            </button>
                            ${track.type === 'voice' ? `
                                <button class="effect-btn ${track.effects.gate ? 'active' : ''}"
                                        onclick="minidaw.toggleEffect('${track.id}', 'gate')"
                                        title="Gate: abaixa a faixa entre as falas — é onde mora a respiração da voz de IA">
                                    <i class="fas fa-door-closed"></i> Gate
                                </button>
                                <button class="effect-btn ${track.effects.hpf ? 'active' : ''}"
                                        onclick="minidaw.toggleEffect('${track.id}', 'hpf')">
                                    <i class="fas fa-filter"></i> HPF
                                </button>
                                <button class="effect-btn ${track.effects.presence ? 'active' : ''}" 
                                        onclick="minidaw.toggleEffect('${track.id}', 'presence')">
                                    <i class="fas fa-volume-up"></i> Presença
                                </button>
                                <button class="effect-btn ${track.effects.limiter ? 'active' : ''}" 
                                        onclick="minidaw.toggleEffect('${track.id}', 'limiter')">
                                    <i class="fas fa-stop-circle"></i> Limit
                                </button>
                            ` : ''}
                        </div>
                ${track.type === 'voice' ? `
                <div class="gate-panel ${track.effects.gate ? 'ativo' : ''}" id="gatepanel_${track.id}">
                    <div class="effect-label">
                        Gate — sensibilidade
                        <strong id="gateval_${track.id}">${(track.gateSettings?.sensibilidade ?? 12).toFixed(1)}</strong>
                    </div>
                    <input type="range" class="form-range" min="1" max="30" step="0.1"
                           value="${track.gateSettings?.sensibilidade ?? 12}"
                           oninput="minidaw.updateGateSensibilidade('${track.id}', this.value)"
                           title="Sobe = corta mais respiração. Passou do ponto, começa a comer o início das palavras.">
                    <small>
                        Dê play e vá subindo até a respiração sumir. Se a fala começar
                        cortada, volte um pouco.
                    </small>
                </div>` : ''}
                <div class="effects-panel ${track.effects.eq ? 'active' : ''}" id="effects_${track.id}">
                    <div class="effect-control">
                        <div class="effect-label">Equalizador</div>
                        <input type="range" class="form-range" min="-20" max="20" value="${track.eqSettings?.low || 0}"
                               oninput="minidaw.updateEQ('${track.id}', 'low', this.value)"
                               title="Graves — 200Hz (corpo, peito)">
                        <small>Graves</small>
                    </div>
                    <div class="effect-control">
                        <input type="range" class="form-range" min="-20" max="20" value="${track.eqSettings?.mid || 0}"
                               oninput="minidaw.updateEQ('${track.id}', 'mid', this.value)"
                               title="Médios — 1kHz (corpo da voz)">
                        <small>Médios</small>
                    </div>
                    <div class="effect-control">
                        <input type="range" class="form-range" min="-20" max="20" value="${track.eqSettings?.high || 0}"
                               oninput="minidaw.updateEQ('${track.id}', 'high', this.value)"
                               title="Agudos — 3.5kHz (definição das consoantes)">
                        <small>Agudos</small>
                    </div>
                    <div class="effect-control">
                        <input type="range" class="form-range" min="-12" max="12" value="${track.eqSettings?.air || 0}"
                               oninput="minidaw.updateEQ('${track.id}', 'air', this.value)"
                               title="Brilho — 10kHz (o ar da voz; suba pouco, 2 a 4 já aparece)">
                        <small>Brilho</small>
                    </div>
                </div>
            `}
        `;
        
        container.appendChild(trackCard);
        
        if (track.audioUrl) {
            this.drawWaveform(track);
        }
    }

    async loadAudioFile(file, trackId) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            
            const track = this.tracks.find(t => t.id === trackId);
            if (track) {
                // Initialize missing properties
                track.audioUrl = URL.createObjectURL(file);
                track.audioBuffer = audioBuffer;
                track.duration = audioBuffer.duration;
                track.zoom = track.zoom || 1;
                track.eqSettings = track.eqSettings || { low: 0, mid: 0, high: 0, air: 0 };
                
                // Update duration if this is the longest track
                if (audioBuffer.duration > this.duration) {
                    this.duration = audioBuffer.duration;
                    this.updateDuration();
                }
                
                this.createTrackNodes(track);
                this.updateTrackUI(track);
                this.drawWaveform(track);
                this.saveToLocalStorage();
                
                console.log(`Audio loaded successfully for track ${trackId}:`, file.name);
                this.showNotification(`Áudio "${file.name}" carregado com sucesso!`, 'success');
            }
        } catch (error) {
            console.error('Error loading audio file:', error);
            this.showNotification('Erro ao carregar arquivo de áudio', 'error');
        }
    }

    async loadAudioFromUrl(url, trackId, name = 'Trilha') {
        try {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            
            const track = this.tracks.find(t => t.id === trackId);
            if (track) {
                // Initialize missing properties
                track.audioUrl = url;
                track.audioBuffer = audioBuffer;
                track.duration = audioBuffer.duration;
                track.zoom = track.zoom || 1;
                track.eqSettings = track.eqSettings || { low: 0, mid: 0, high: 0, air: 0 };
                track.name = name;
                
                // Update duration if this is the longest track
                if (audioBuffer.duration > this.duration) {
                    this.duration = audioBuffer.duration;
                    this.updateDuration();
                }
                
                this.createTrackNodes(track);
                this.updateTrackUI(track);
                this.drawWaveform(track);
                this.saveToLocalStorage();
                
                console.log(`Audio loaded successfully for track ${trackId}:`, name);
                this.showNotification(`Trilha "${name}" carregada com sucesso!`, 'success');
            }
        } catch (error) {
            console.error('Error loading audio from URL:', error);
            this.showNotification('Erro ao carregar trilha da biblioteca', 'error');
        }
    }

    createTrackNodes(track) {
        // Create effect nodes
        // 1. High-pass filter (removes low-frequency rumble)
        const hpfNode = this.audioContext.createBiquadFilter();
        hpfNode.type = 'highpass';
        hpfNode.frequency.value = 80; // 80Hz
        
        // 2. EQ de 4 BANDAS. Antes era UM filtro só pros três sliders: mexer nos
        //    Agudos reapontava o filtro pra 4kHz e mexer nos Graves o levava pra
        //    250Hz, APAGANDO o ajuste anterior. Agora cada banda tem o seu.
        const eqLowNode = this.audioContext.createBiquadFilter();
        eqLowNode.type = 'lowshelf';
        eqLowNode.frequency.value = 200;      // corpo / peito
        eqLowNode.gain.value = 0;

        const eqNode = this.audioContext.createBiquadFilter();   // médios
        eqNode.type = 'peaking';
        eqNode.frequency.value = 1000;        // presença de corpo médio
        eqNode.gain.value = 0;
        eqNode.Q.value = 1;

        const eqHighNode = this.audioContext.createBiquadFilter();
        eqHighNode.type = 'peaking';
        eqHighNode.frequency.value = 3500;    // definição das consoantes
        eqHighNode.gain.value = 0;
        eqHighNode.Q.value = 0.9;

        const eqAirNode = this.audioContext.createBiquadFilter();
        eqAirNode.type = 'highshelf';
        eqAirNode.frequency.value = 10000;    // BRILHO / ar — o que faltava
        eqAirNode.gain.value = 0;

        // 3. Presence boost (clarity)
        const presenceNode = this.audioContext.createBiquadFilter();
        presenceNode.type = 'highshelf';
        presenceNode.frequency.value = 4000;
        presenceNode.gain.value = 0;

        // 4. Compressor
        const compressorNode = this.audioContext.createDynamicsCompressor();
        compressorNode.threshold.value = -24;
        compressorNode.knee.value = 30;
        compressorNode.ratio.value = 12;
        compressorNode.attack.value = 0.003;
        compressorNode.release.value = 0.25;
        
        // 5. Limiter
        const limiterNode = this.audioContext.createDynamicsCompressor();
        limiterNode.threshold.value = -6;
        limiterNode.knee.value = 0;
        limiterNode.ratio.value = 20;
        limiterNode.attack.value = 0.001;
        limiterNode.release.value = 0.1;

        // Reverb
        const reverbNode = this.audioContext.createConvolver();
        this.createReverbImpulse(reverbNode);
        reverbNode.normalize = true;

        const reverbGain = this.audioContext.createGain();
        reverbGain.gain.value = 0.3;

        // Delay: 280ms com realimentação curta. Em spot isso é efeito de
        // destaque (chamada, assinatura), não ambiente — por isso tempo curto
        // e feedback baixo, senão vira eco de caverna por cima da locução.
        const delayNode = this.audioContext.createDelay(2.0);
        delayNode.delayTime.value = 0.28;
        const delayFeedback = this.audioContext.createGain();
        delayFeedback.gain.value = 0.15;
        const delayMix = this.audioContext.createGain();
        delayMix.gain.value = 0;      // desligado até o botão pedir

        // GATE — nó próprio, antes do volume. Não dá pra reusar o gainNode:
        // ele já carrega volume, fade e ducking, e duas automações no mesmo
        // AudioParam brigam.
        const gateGain = this.audioContext.createGain();
        gateGain.gain.value = 1;

        // Create analyser for silence detection
        const analyser = this.audioContext.createAnalyser();
        analyser.fftSize = 2048;

        // Create gain node
        const gainNode = this.audioContext.createGain();
        gainNode.gain.value = track.volume / 100;
        
        // Create pan node
        const panNode = this.audioContext.createStereoPanner();
        panNode.pan.value = track.pan;
        
        // Connect nodes: HPF -> EQ -> Presence -> Compressor -> Limiter -> Analyser -> Gain -> Pan -> Master
        // Reverb is parallel: Limiter -> Reverb -> ReverbGain -> Pan
        hpfNode.connect(eqLowNode);
        eqLowNode.connect(eqNode);
        eqNode.connect(eqHighNode);
        eqHighNode.connect(eqAirNode);
        eqAirNode.connect(presenceNode);
        presenceNode.connect(compressorNode);
        compressorNode.connect(limiterNode);
        limiterNode.connect(gateGain);
        gateGain.connect(analyser);
        analyser.connect(gainNode);
        limiterNode.connect(reverbNode);
        reverbNode.connect(reverbGain);
        reverbGain.connect(panNode);
        // DELAY — existia como botão desde sempre, mas sem nó nenhum: clicar
        // só virava a flag `effects.delay`, que ninguém lia (nem o playback,
        // nem o export). Agora é um envio paralelo igual ao reverb, com
        // realimentação pra dar as repetições.
        limiterNode.connect(delayNode);
        delayNode.connect(delayFeedback);
        delayFeedback.connect(delayNode);     // eco que repete e vai morrendo
        delayNode.connect(delayMix);
        // Entra no gainNode (volume da faixa), NÃO direto no pan: assim o eco
        // acompanha o slider de volume. Ligado no pan, abaixar a faixa deixava
        // o delay no mesmo nível e ele ia ficando desproporcional. O export já
        // liga no trackGain — as duas pontas precisam bater.
        delayMix.connect(gainNode);
        gainNode.connect(panNode);
        panNode.connect(this.masterGain);
        
        // Store nodes
        this.trackNodes.set(track.id, {
            inputNode: hpfNode,
            hpfNode,
            eqLowNode,
            eqNode,          // médios
            eqHighNode,
            eqAirNode,
            presenceNode,
            compressorNode,
            limiterNode,
            gateGain,
            analyser,
            reverbNode,
            reverbGain,
            delayNode,
            delayFeedback,
            delayMix,
            gainNode,
            panNode,
            sourceNode: null
        });

        // Apply initial effect states
        this.applyEffectStates(track);
    }

    createReverbImpulse(convolver) {
        // Create a simple reverb impulse response
        const sampleRate = this.audioContext.sampleRate;
        const length = sampleRate * 2; // 2 seconds
        const impulse = this.audioContext.createBuffer(2, length, sampleRate);
        
        for (let channel = 0; channel < 2; channel++) {
            const channelData = impulse.getChannelData(channel);
            for (let i = 0; i < length; i++) {
                // Exponential decay
                channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
            }
        }
        
        convolver.buffer = impulse;
    }

    applyEffectStates(track) {
        const nodes = this.trackNodes.get(track.id);
        if (!nodes) return;

        // High-pass filter
        if (track.effects.hpf) {
            nodes.hpfNode.frequency.value = 80;
        } else {
            nodes.hpfNode.frequency.value = 10; // Bypass (frequência muito baixa)
        }

        // EQ — as QUATRO bandas (antes só os médios eram aplicados)
        const eq = track.eqSettings || {};
        const ligado = track.effects.eq;
        nodes.eqLowNode.gain.value  = ligado ? (eq.low  || 0) : 0;
        nodes.eqNode.gain.value     = ligado ? (eq.mid  || 0) : 0;
        nodes.eqHighNode.gain.value = ligado ? (eq.high || 0) : 0;
        nodes.eqAirNode.gain.value  = ligado ? (eq.air  || 0) : 0;

        // Presence boost
        nodes.presenceNode.gain.value = track.effects.presence ? 4 : 0; // +4dB de presença

        // Compressor
        nodes.compressorNode.threshold.value = track.effects.compressor ? -24 : 0;

        // Limiter
        if (track.effects.limiter) {
            nodes.limiterNode.threshold.value = -6;
            nodes.limiterNode.ratio.value = 20;
        } else {
            nodes.limiterNode.threshold.value = 0;
            nodes.limiterNode.ratio.value = 1; // Bypass
        }

        // Reverb
        nodes.reverbGain.gain.value = track.effects.reverb ? 0.3 : 0;

        // Delay (o botão existia sem nenhum efeito por trás até agora)
        if (nodes.delayMix) {
            nodes.delayMix.gain.value = track.effects.delay ? 0.35 : 0;
        }

        // GATE — desligar tem que APAGAR a automação já agendada, senão a
        // faixa continua abrindo e fechando sozinha até a última marcação.
        // Quem liga é o playTrack, que sabe o instante em que o som começa.
        if (nodes.gateGain) {
            if (!track.effects.gate) {
                nodes.gateGain.gain.cancelScheduledValues(this.audioContext.currentTime);
                nodes.gateGain.gain.setValueAtTime(1, this.audioContext.currentTime);
            }
        }
    }

    // Recalcula o gate desta faixa e devolve quantos trechos de fala achou.
    // Chamado pelo playTrack (com o instante do play) e pela prévia.
    agendarGate(track, nodes, quando) {
        if (!nodes || !nodes.gateGain || !track.audioBuffer) return 0;
        const param = nodes.gateGain.gain;
        param.cancelScheduledValues(quando);
        if (!track.effects.gate) {
            param.setValueAtTime(1, quando);
            return 0;
        }
        const g = track.gateSettings || {};
        const sens = (g.sensibilidade != null ? g.sensibilidade : 12) / 100;
        // hold 0.25s: pausa entre frases é curta; o 0.70 do ducking juntaria
        // tudo num bloco só e o gate não fecharia em lugar nenhum.
        const trechos = MixEngine.detectarTrechosDeVoz([track], 0.25, sens);
        MixEngine.aplicarGate(param, trechos, track.duration, quando, g);
        return trechos.length;
    }

    // Slider de sensibilidade. Reagenda na hora pra dar pra ajustar ouvindo.
    updateGateSensibilidade(trackId, valor) {
        const track = this.tracks.find(t => t.id === trackId);
        if (!track) return;
        track.gateSettings = track.gateSettings || {};
        track.gateSettings.sensibilidade = Math.min(30, Math.max(1, parseFloat(valor) || 12));

        const rotulo = document.getElementById(`gateval_${trackId}`);
        if (rotulo) rotulo.textContent = track.gateSettings.sensibilidade.toFixed(1);

        const nodes = this.trackNodes.get(trackId);
        if (nodes && this.isPlaying) this.agendarGate(track, nodes, this.audioContext.currentTime);
        clearTimeout(this._gateSaveTimer);
        this._gateSaveTimer = setTimeout(() => this.saveToLocalStorage(), 300);
    }

    // ── FORMA DE ONDA ────────────────────────────────────────────────────
    // O produtor precisa ENXERGAR o que tem na faixa: sem isso a Tesoura vira
    // chute, porque não dá pra marcar início e fim de corte às cegas.
    //
    // ANTES: um lineTo() por AMOSTRA de áudio. Numa trilha de 104s a 44.1kHz
    // são 4,6 MILHÕES de pontos num canvas de ~1000px — o navegador engasgava
    // e saía uma mancha, ou nada (aí aparecia só o gradiente do CSS, que é o
    // "fundo liso" que parecia faixa vazia).
    //
    // AGORA: envelope min/max por COLUNA DE PIXEL, que é como todo editor de
    // áudio desenha. Mil colunas em vez de milhões de pontos, e a silhueta
    // mostra de verdade onde a fala entra e onde ela para.
    drawWaveform(track) {
        const canvas = document.getElementById(`waveform_${track.id}`);
        if (!canvas || !track.audioBuffer) return;

        const width = Math.floor(canvas.offsetWidth);
        const height = Math.floor(canvas.offsetHeight);

        // Canvas ainda sem layout (faixa recém-criada, aba oculta): desenhar
        // agora pintaria num canvas 0x0 e a faixa ficaria muda pra sempre.
        // Tenta de novo no próximo quadro, uma vez só.
        if (!width || !height) {
            if (!track._waveformRetry) {
                track._waveformRetry = true;
                requestAnimationFrame(() => {
                    track._waveformRetry = false;
                    this.drawWaveform(track);
                });
            }
            return;
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        const data = track.audioBuffer.getChannelData(0);
        ctx.clearRect(0, 0, width, height);

        const meio = height / 2;

        // Linha de silêncio, pra dar referência visual do zero.
        ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
        ctx.fillRect(0, Math.round(meio), width, 1);

        // Branco quase sólido: o fundo do .waveform é um gradiente azul/roxo e
        // a cor da faixa (azul na voz, roxo na trilha) sumia em cima dele.
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';

        const amostrasPorPixel = data.length / width;
        for (let px = 0; px < width; px++) {
            const ini = Math.floor(px * amostrasPorPixel);
            const fim = Math.min(Math.floor((px + 1) * amostrasPorPixel), data.length);
            if (fim <= ini) continue;

            let min = 1.0, max = -1.0;
            for (let i = ini; i < fim; i++) {
                const v = data[i];
                if (v < min) min = v;
                if (v > max) max = v;
            }

            const topo = meio - max * meio;
            // Altura mínima de 1px: trecho em silêncio ainda marca a linha,
            // senão o silêncio vira buraco e parece faixa cortada.
            const altura = Math.max(1, (max - min) * meio);
            ctx.fillRect(px, topo, 1, altura);
        }
    }

    updateTrackName(trackId, name) {
        const track = this.tracks.find(t => t.id === trackId);
        if (track) {
            track.name = name;
            this.saveToLocalStorage();
        }
    }

    toggleMute(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (track) {
            track.muted = !track.muted;
            const nodes = this.trackNodes.get(trackId);
            if (nodes && nodes.gainNode) {
                nodes.gainNode.gain.value = track.muted ? 0 : track.volume / 100;
            }
            this.updateTrackUI(track);
            this.saveToLocalStorage();
        }
    }

    toggleSolo(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (track) {
            track.solo = !track.solo;
            const hasSolo = this.tracks.some(t => t.solo);
            this.tracks.forEach(t => {
                const nodes = this.trackNodes.get(t.id);
                if (nodes && nodes.gainNode) {
                    if (hasSolo) {
                        nodes.gainNode.gain.value = t.solo ? t.volume / 100 : 0;
                    } else {
                        nodes.gainNode.gain.value = t.muted ? 0 : t.volume / 100;
                    }
                }
            });
            this.updateTrackUI(track);
            this.saveToLocalStorage();
        }
    }

    updateTrackVolume(trackId, volume) {
        const track = this.tracks.find(t => t.id === trackId);
        if (track) {
            track.volume = volume;
            const nodes = this.trackNodes.get(trackId);
            if (nodes && nodes.gainNode) {
                nodes.gainNode.gain.value = volume / 100;
            }
            this.updateVolumeLabel(trackId, volume);
            this.saveToLocalStorage();
        }
    }

    updateTrackPan(trackId, pan) {
        const track = this.tracks.find(t => t.id === trackId);
        if (track) {
            track.pan = pan / 100;
            const nodes = this.trackNodes.get(trackId);
            if (nodes && nodes.panNode) {
                nodes.panNode.pan.value = track.pan;
            }
            this.saveToLocalStorage();
        }
    }

    updateTrackFadeIn(trackId, fadeIn) {
        const track = this.tracks.find(t => t.id === trackId);
        if (track) {
            track.fadeIn = parseFloat(fadeIn);
            this.saveToLocalStorage();
        }
    }

    updateTrackFadeOut(trackId, fadeOut) {
        const track = this.tracks.find(t => t.id === trackId);
        if (track) {
            track.fadeOut = parseFloat(fadeOut);
            this.saveToLocalStorage();
        }
    }

    updateVolumeLabel(trackId, volume) {
        const trackCard = document.getElementById(`track_${trackId}`);
        if (trackCard) {
            const label = trackCard.querySelector('.volume-slider + .control-label');
            if (label) {
                label.textContent = `${volume}%`;
            }
        }
    }

    toggleEffect(trackId, effect) {
        const track = this.tracks.find(t => t.id === trackId);
        if (track) {
            track.effects[effect] = !track.effects[effect];
            this.updateEffectsUI(track);
            this.applyEffectStates(track);
            this.saveToLocalStorage();
            
            // Mostrar notificação
            const status = track.effects[effect] ? 'ativado' : 'desativado';
            this.showNotification(`${effect.toUpperCase()} ${status} na track`, 'info');
        }
    }

    updateEffectsUI(track) {
        const trackCard = document.getElementById(`track_${track.id}`);
        if (!trackCard) return;
        
        // Update effect buttons
        Object.keys(track.effects).forEach(effect => {
            const btn = trackCard.querySelector(`.effect-btn[onclick*="${effect}"]`);
            if (btn) {
                btn.classList.toggle('active', track.effects[effect]);
            }
        });
        
        // Update effects panel
        const effectsPanel = trackCard.querySelector('.effects-panel');
        if (effectsPanel) {
            effectsPanel.classList.toggle('active', track.effects.eq);
        }

        // O slider do gate só aparece com o gate ligado — igual ao EQ.
        const gatePanel = trackCard.querySelector('.gate-panel');
        if (gatePanel) {
            gatePanel.classList.toggle('ativo', !!track.effects.gate);
        }
    }

    updateEQ(trackId, band, value) {
        const track = this.tracks.find(t => t.id === trackId);
        if (!track) return;

        if (!track.eqSettings) track.eqSettings = {};
        track.eqSettings[band] = parseFloat(value);

        const nodes = this.trackNodes.get(trackId);
        if (nodes && track.effects.eq) {
            // Cada banda no SEU filtro. Antes todas disputavam o mesmo nó, então
            // a última mexida apagava as outras.
            const alvo = { low: nodes.eqLowNode, mid: nodes.eqNode,
                           high: nodes.eqHighNode, air: nodes.eqAirNode }[band];
            if (alvo) alvo.gain.value = track.eqSettings[band];
        }
        // O áudio muda na hora; salvar é que não precisa rodar a cada pixel do
        // arraste (o slider usa oninput pra soar em tempo real).
        clearTimeout(this._eqSaveTimer);
        this._eqSaveTimer = setTimeout(() => this.saveToLocalStorage(), 300);
    }

    updateReverbAmount(trackId, amount) {
        const track = this.tracks.find(t => t.id === trackId);
        if (!track) return;

        track.reverbAmount = parseFloat(amount) / 100;

        const nodes = this.trackNodes.get(trackId);
        if (nodes && track.effects.reverb) {
            nodes.reverbGain.gain.value = track.reverbAmount;
        }
        this.saveToLocalStorage();
    }

    updateCompressor(trackId, param, value) {
        const track = this.tracks.find(t => t.id === trackId);
        if (!track) return;

        if (!track.compressorSettings) track.compressorSettings = {};
        track.compressorSettings[param] = parseFloat(value);

        const nodes = this.trackNodes.get(trackId);
        if (nodes && track.effects.compressor) {
            switch(param) {
                case 'threshold':
                    nodes.compressorNode.threshold.value = parseFloat(value);
                    break;
                case 'ratio':
                    nodes.compressorNode.ratio.value = parseFloat(value);
                    break;
                case 'attack':
                    nodes.compressorNode.attack.value = parseFloat(value) / 1000;
                    break;
                case 'release':
                    nodes.compressorNode.release.value = parseFloat(value) / 1000;
                    break;
            }
        }
        this.saveToLocalStorage();
    }

    removeTrack(trackId) {
        if (!confirm('Tem certeza que deseja remover esta faixa?')) {
            return;
        }
        
        const index = this.tracks.findIndex(t => t.id === trackId);
        if (index !== -1) {
            const track = this.tracks[index];
            
            // Stop audio if playing
            if (track.audioBuffer) {
                const nodes = this.trackNodes.get(trackId);
                if (nodes && nodes.sourceNode) {
                    try {
                        nodes.sourceNode.stop();
                    } catch (e) {
                        // Already stopped
                    }
                }
            }
            
            // Clean up nodes
            this.trackNodes.delete(trackId);
            
            // Remove from array
            this.tracks.splice(index, 1);
            
            // Remove UI
            const trackCard = document.getElementById(`track_${trackId}`);
            if (trackCard) {
                trackCard.remove();
            }
            
            // Recalculate duration
            this.calculateDuration();
            this.updateUI();
            this.saveToLocalStorage();
            
            this.showNotification('Faixa removida com sucesso!', 'success');
        }
    }

    calculateDuration() {
        const voiceTracks = this.tracks.filter(t => t.type === 'voice' && t.audioBuffer);
        const musicTracks = this.tracks.filter(t => t.type === 'music' && t.audioBuffer);
        
        let maxDuration = 0;
        
        if (voiceTracks.length > 0) {
            // If there are voice tracks: max voice duration + 1.05s
            const maxVoiceDuration = Math.max(...voiceTracks.map(t => t.duration), 0);
            maxDuration = maxVoiceDuration + 1.05;
        } else {
            // Otherwise, just the max of all tracks
            maxDuration = Math.max(...this.tracks.filter(t => t.audioBuffer).map(t => t.duration), 0);
        }
        
        this.duration = maxDuration;
        this.updateDuration();
    }

    togglePlayback() {
        if (this.isPlaying) {
            this.stop();
        } else {
            this.play();
        }
    }

    play() {
        if (this.tracks.filter(t => t.audioBuffer).length === 0) {
            this.showNotification('Adicione arquivos de áudio primeiro', 'warning');
            return;
        }

        this.isPlaying = true;
        this.setPlayIcon('fas fa-pause');

        // Start all tracks
        this.tracks.forEach(track => {
            if (track.audioBuffer) {
                this.playTrack(track);
            }
        });

        // Start update interval
        this.updateInterval = setInterval(() => {
            this.updatePlaybackTime();
        }, 100);
    }

    playTrack(track) {
        let nodes = this.trackNodes.get(track.id);
        // Faixa com áudio mas sem cadeia de efeitos ficava MUDA no play, e o
        // return calado não deixava pista nenhuma. Se o áudio está aí, remonta
        // a cadeia em vez de desistir.
        if (!nodes && track.audioBuffer) {
            this.createTrackNodes(track);
            if (typeof this.applyEffectStates === 'function') this.applyEffectStates(track);
            nodes = this.trackNodes.get(track.id);
        }
        if (!nodes || !track.audioBuffer) return;

        // Create source node
        const sourceNode = this.audioContext.createBufferSource();
        sourceNode.buffer = track.audioBuffer;

        // Gate: a automação é agendada AQUI porque depende do instante em que
        // o som começa a tocar (mesma razão do offset no ducking).
        this.agendarGate(track, nodes, this.audioContext.currentTime);
        
        // Apply fade in
        if (track.fadeIn > 0) {
            nodes.gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
            nodes.gainNode.gain.linearRampToValueAtTime(
                track.volume / 100, 
                this.audioContext.currentTime + track.fadeIn
            );
        } else {
            nodes.gainNode.gain.setValueAtTime(track.volume / 100, this.audioContext.currentTime);
        }

        // Apply fade out (manual) or auto fade out for music tracks
        const voiceTracks = this.tracks.filter(t => t.type === 'voice' && t.audioBuffer);
        if (track.type === 'music' && voiceTracks.length > 0) {
            // Auto fade-out for music tracks
            const maxVoiceDuration = Math.max(...voiceTracks.map(t => t.duration), 0);
            // DUCKING NO PREVIEW: mesma automação do export, mas deslocada pra
            // base de tempo do playback. Sem isto o ducking só aparecia no arquivo
            // exportado e não dava pra ajustar de ouvido antes de renderizar.
            const trechosDeVoz = this.detectarTrechosDeVoz(voiceTracks);
            const ducou = this.aplicarDucking(
                nodes.gainNode.gain, trechosDeVoz, track.volume / 100,
                maxVoiceDuration, this.audioContext.currentTime
            );
            if (!ducou) {
                nodes.gainNode.gain.linearRampToValueAtTime(
                    track.volume / 100,
                    this.audioContext.currentTime + maxVoiceDuration
                );
            }
            nodes.gainNode.gain.linearRampToValueAtTime(
                0,
                this.audioContext.currentTime + maxVoiceDuration + 1.05
            );
        } else {
            // Manual fade out
            if (track.fadeOut > 0) {
                const fadeOutStart = track.duration - track.fadeOut;
                nodes.gainNode.gain.linearRampToValueAtTime(
                    track.volume / 100,
                    this.audioContext.currentTime + fadeOutStart
                );
                nodes.gainNode.gain.linearRampToValueAtTime(
                    0,
                    this.audioContext.currentTime + track.duration
                );
            }
        }

        // Connect to effect chain: source -> EQ -> Compressor -> ...
        sourceNode.connect(nodes.inputNode);
        sourceNode.start(0, this.currentTime);
        
        nodes.sourceNode = sourceNode;

        // Handle end
        sourceNode.onended = () => {
            if (this.isPlaying && this.currentTime >= this.duration) {
                this.stop();
            }
        };
    }

    // Mantém os dois botões de play (topo e o de baixo das faixas) no mesmo
    // estado. Antes o ícone era mexido direto pelo id, o que deixaria o segundo
    // botão mostrando "play" com o áudio tocando.
    setPlayIcon(classe) {
        ['playIcon', 'playIconBottom'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.className = classe;
        });
    }

    stop() {
        this.isPlaying = false;
        this.currentTime = 0;

        this.setPlayIcon('fas fa-play');

        // Stop all tracks
        this.trackNodes.forEach(nodes => {
            if (nodes.sourceNode) {
                try {
                    nodes.sourceNode.stop();
                } catch (e) {
                    // Already stopped
                }
                nodes.sourceNode = null;
            }
        });

        // Clear update interval
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }

        this.updatePlaybackTime();
    }

    updatePlaybackTime() {
        if (this.isPlaying) {
            this.currentTime += 0.1;
            if (this.currentTime >= this.duration) {
                this.stop();
            }
        }

        // Atualiza os dois transportes (topo e o de baixo das faixas).
        const txt = this.formatTime(this.currentTime);
        ['currentTime', 'currentTimeBottom'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = txt;
        });
    }

    updateDuration() {
        const txt = this.formatTime(this.duration);
        ['totalDuration', 'totalDurationBottom'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = txt;
        });
    }

    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    normalizeVolumes() {
        const tracksWithAudio = this.tracks.filter(t => t.audioBuffer);
        if (tracksWithAudio.length === 0) {
            this.showNotification('Nenhuma faixa com áudio para normalizar', 'warning');
            return;
        }

        // Calculate average volume
        const avgVolume = tracksWithAudio.reduce((sum, t) => sum + t.volume, 0) / tracksWithAudio.length;
        
        // Apply to all tracks
        tracksWithAudio.forEach(track => {
            this.updateTrackVolume(track.id, avgVolume);
        });

        this.showNotification('Volumes normalizados', 'success');
    }

    // (Havia um segundo applyAutoFade idêntico aqui. Em JS a definição de
    //  baixo sobrescreve a de cima, então esta versão nunca rodava — ler o
    //  arquivo dava a impressão errada de qual código estava valendo. A que
    //  vale é a de baixo, que também liga o autoFadeEnabled.)

    clearAllTracks(skipConfirm = false) {
        if (this.tracks.length === 0) return;

        if (!skipConfirm && !confirm('Tem certeza que deseja remover todas as faixas?')) {
            return;
        }
        
        this.stop();
        
        // Clear all tracks sem confirmacao
        const tracksToRemove = [...this.tracks];
        tracksToRemove.forEach(track => {
            // Stop audio if playing
            if (track.audioBuffer) {
                const nodes = this.trackNodes.get(track.id);
                if (nodes && nodes.sourceNode) {
                    try {
                        nodes.sourceNode.stop();
                    } catch (e) {
                        // Already stopped
                    }
                }
            }
            
            // Clean up nodes
            this.trackNodes.delete(track.id);
            
            // Remove UI
            const trackCard = document.getElementById(`track_${track.id}`);
            if (trackCard) {
                trackCard.remove();
            }
        });
        
        // Clear array
        this.tracks = [];

        // Show empty state
        const emptyState = document.getElementById('emptyState');
        if (emptyState) {
            emptyState.style.display = 'block';
        }
        
        // Reset duration
        this.duration = 0;
        this.updateDuration();

        this.saveToLocalStorage();
        this.showNotification('Todas as faixas removidas', 'info');
    }

    setFormat(format) {
        this.exportFormat = format;
        
        // Update UI
        document.querySelectorAll('.format-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        event.target.classList.add('active');

        // Show/hide bitrate selector
        const bitrateGroup = document.getElementById('mp3BitrateGroup');
        if (bitrateGroup) {
            bitrateGroup.style.display = format === 'mp3' ? 'flex' : 'none';
        }

        if (format === 'mp3') {
            this.mp3Bitrate = parseInt(document.getElementById('mp3Bitrate').value);
        }
    }

    // ── DUCKING AUTOMÁTICO ───────────────────────────────────────────────
    // Abaixa a trilha quando a voz entra e devolve o volume nas pausas — é o que
    // separa "voz por cima de música" de spot de rádio. Antes a trilha tocava no
    // volume cheio durante toda a locução e só caía no fade final.
    //
    // Detecta fala de verdade (RMS por janela) em vez de simplesmente abaixar do
    // início ao fim: nas respiradas entre frases a trilha sobe, que é o movimento
    // que dá vida ao spot.
    detectarTrechosDeVoz(voiceTracks) {
        return MixEngine.detectarTrechosDeVoz(voiceTracks, this.duckHold);
    }

    // Escreve a automação de ganho da trilha a partir dos trechos de voz.
    // `nivel` é o volume normal da faixa (0..1); devolve true se ducou algo.
    //
    // `offset` existe porque os dois caminhos usam bases de tempo diferentes:
    // o export (OfflineAudioContext) agenda a partir de 0, e o playback agenda a
    // partir de audioContext.currentTime. Sem o offset, o ducking no preview
    // cairia todo no passado e não aconteceria nada.
    aplicarDucking(gainParam, trechos, nivel, ateQuando, offset = 0) {
        return MixEngine.aplicarDucking(gainParam, trechos, nivel, ateQuando, offset, {
            gain: this.duckGain, attack: this.duckAttack,
            release: this.duckRelease, hold: this.duckHold
        });
    }

    // ── ENCURTAR PAUSAS (strip silence) ─────────────────────────────────
    // Reconstrói o buffer de voz encurtando o SILÊNCIO entre as falas pra no
    // máximo `pausaMax` segundos. A fala fica intacta (com folga de 60ms nas
    // pontas pra não cortar palavra/respiração) e há um fade de 6ms nas junções
    // pra não dar clique. Reusa detectarTrechosDeVoz (mesma detecção do ducking).
    // O `pausaMax` é o controle do usuário: maior = mais respiro (não sufoca).
    encurtarPausas(buffer, trechos, pausaMax) {
        const sr = buffer.sampleRate;
        const nch = buffer.numberOfChannels;
        const N = buffer.length;
        if (!trechos || trechos.length === 0) return buffer;   // sem fala: não mexe

        const PAD = Math.round(0.06 * sr);                       // 60ms de folga
        const CAP = Math.round(Math.max(0.05, pausaMax) * sr);   // pausa máx (min 50ms)
        const XF = Math.round(0.006 * sr);                       // 6ms fade anti-clique
        const clamp = (x) => Math.max(0, Math.min(N, x));
        const segs = trechos.map(([a, b]) => [Math.round(a * sr), Math.round(b * sr)]);

        // Monta as faixas [ini,fim] (amostras) a copiar; o excedente de silêncio
        // entre elas é PULADO.
        const ranges = [];
        for (let i = 0; i < segs.length; i++) {
            let ini = clamp(segs[i][0] - PAD);
            let fim = clamp(segs[i][1] + PAD);
            if (i === 0) ini = clamp(segs[0][0] - CAP);          // pré-silêncio capado
            if (i < segs.length - 1) {
                const proxIni = clamp(segs[i + 1][0] - PAD);
                const gap = proxIni - fim;
                fim = fim + Math.max(0, Math.min(gap, CAP));     // mantém só CAP de silêncio
            } else {
                fim = clamp(fim + CAP);                          // tail capado
            }
            if (ranges.length && ini <= ranges[ranges.length - 1][1]) {
                ranges[ranges.length - 1][1] = Math.max(ranges[ranges.length - 1][1], fim);
            } else {
                ranges.push([ini, fim]);
            }
        }

        const outLen = ranges.reduce((s, [a, b]) => s + (b - a), 0);
        if (outLen <= 0 || outLen >= N) return buffer;           // nada a ganhar

        const out = this.audioContext.createBuffer(nch, outLen, sr);
        for (let ch = 0; ch < nch; ch++) {
            const src = buffer.getChannelData(ch);
            const dst = out.getChannelData(ch);
            let pos = 0;
            for (let r = 0; r < ranges.length; r++) {
                for (let i = ranges[r][0]; i < ranges[r][1]; i++) dst[pos++] = src[i];
            }
            // fades curtos nas junções (silêncio, mas garante zero clique)
            let acc = 0;
            for (let r = 0; r < ranges.length; r++) {
                const len = ranges[r][1] - ranges[r][0];
                if (r > 0) for (let k = 0; k < XF && k < len; k++) dst[acc + k] *= k / XF;
                if (r < ranges.length - 1) for (let k = 0; k < XF && k < len; k++) dst[acc + len - 1 - k] *= k / XF;
                acc += len;
            }
        }
        return out;
    }

    // Aplica o encurtar em todas as faixas de voz. Guarda o buffer ORIGINAL na
    // primeira vez, e aplica SEMPRE a partir dele — assim o usuário mexe no valor
    // e re-aplica sem degradar, e o Desfazer volta 100%.
    encurtarPausasVoz(pausaMax) {
        if (!this.vozOriginais) this.vozOriginais = new Map();
        const vozes = this.tracks.filter(t => t.type === 'voice' && t.audioBuffer);
        if (vozes.length === 0) { this.showNotification('Nenhuma voz na timeline', 'warning'); return; }

        let mexeu = false;
        for (const t of vozes) {
            if (!this.vozOriginais.has(t.id)) this.vozOriginais.set(t.id, t.audioBuffer);
            const original = this.vozOriginais.get(t.id);
            const trechos = this.detectarTrechosDeVoz([{ audioBuffer: original }]);
            const novo = this.encurtarPausas(original, trechos, pausaMax);
            t.audioBuffer = novo;
            t.duration = novo.duration;
            this.drawWaveform(t);
            if (novo.duration < original.duration - 0.01) mexeu = true;
        }
        // recalcula a duração total
        this.duration = Math.max(0, ...this.tracks.filter(t => t.audioBuffer).map(t => t.duration));
        this.updateDuration();
        this.showNotification(mexeu
            ? `Pausas encurtadas (máx ${pausaMax}s entre falas). Ouça — se sufocou, aumente o valor.`
            : 'Nenhuma pausa longa pra encurtar nesse valor.', mexeu ? 'success' : 'info');
    }

    desfazerEncurtar() {
        if (!this.vozOriginais || this.vozOriginais.size === 0) {
            this.showNotification('Nada pra desfazer', 'info'); return;
        }
        for (const t of this.tracks) {
            if (t.type === 'voice' && this.vozOriginais.has(t.id)) {
                t.audioBuffer = this.vozOriginais.get(t.id);
                t.duration = t.audioBuffer.duration;
                this.drawWaveform(t);
            }
        }
        this.vozOriginais.clear();
        this.duration = Math.max(0, ...this.tracks.filter(t => t.audioBuffer).map(t => t.duration));
        this.updateDuration();
        this.showNotification('Voz restaurada ao original', 'success');
    }

    // Normaliza o loudness do mix renderizado pro alvo (dBFS RMS aprox.) e aplica
    // um soft-limiter (tanh) no teto de -1dB. Dá o "alto e consistente": todo
    // export sai no mesmo nível, sem clipar. Trabalha in-place no buffer.
    // NÃO é LUFS certificado (o navegador não mede LUFS de verdade) — é uma
    // normalização por RMS, honesta e consistente.
    masterizarBuffer(buffer, alvoDbfs) {
        return MixEngine.masterizarBuffer(buffer, alvoDbfs);
    }

    // ═══════════════════════════════════════════════════════════════════
    // RENDER — o motor de mixagem num lugar só (antes vivia inline dentro
    // do exportMix). Recebe QUAIS faixas entram no render, mas a duração e
    // o ducking continuam vindo do projeto INTEIRO: renderizar uma faixa
    // sozinha (stem) devolve exatamente o que ela é DENTRO do mix, então
    // os stems somam de volta no mix final — é isso que faz stem ser stem.
    // ═══════════════════════════════════════════════════════════════════
    async _renderizarParaExport(tracksParaRenderizar, aoProgredir) {
        return MixEngine.renderizarMix({
            tracks: tracksParaRenderizar,
            todasAsTracks: this.tracks,
            duration: this.duration,
            sampleRate: this.audioContext.sampleRate,
            aoProgredir: aoProgredir,
            duck: {
                gain: this.duckGain, attack: this.duckAttack,
                release: this.duckRelease, hold: this.duckHold
            }
        });
    }

    async exportMix() {
        const tracksWithAudio = this.tracks.filter(t => t.audioBuffer);
        if (tracksWithAudio.length === 0) {
            this.showNotification('Adicione arquivos de áudio primeiro', 'warning');
            return;
        }

        // Trilha sem nenhuma faixa de Voz: o motor não aplica ducking nem o
        // fade final, e a duração do mix vira a da trilha inteira. Isso sai
        // como spot errado e só se percebe ouvindo o arquivo pronto — melhor
        // perguntar antes de gastar a exportação.
        const temVoz = tracksWithAudio.some(t => t.type === 'voice');
        const temTrilha = tracksWithAudio.some(t => t.type === 'music');
        if (temTrilha && !temVoz) {
            const segue = confirm(
                'Nenhuma faixa está marcada como VOZ neste projeto.\n\n' +
                'Sem isso a trilha não abaixa embaixo da locução, não some no fim, ' +
                'e o mix vai durar a trilha inteira em vez de acabar com a fala.\n\n' +
                'Se uma dessas faixas é a locução, cancele e clique na etiqueta ' +
                '"TRILHA" dela pra virar "VOZ".\n\nExportar assim mesmo?');
            if (!segue) return;
        }

        this.showMixingStatus(true);
        this.updateMixingProgress(0, 'Preparando mixagem...');

        try {
            const renderedBuffer = await this._renderizarParaExport(
                tracksWithAudio, (p, t) => this.updateMixingProgress(p, t)
            );

            // OTIMIZAR: se um alvo foi escolhido, normaliza o loudness do mix e
            // limita os picos. É o "alto e consistente" do mastering leve.
            if (this.masterTarget != null) {
                this.updateMixingProgress(93, 'Otimizando (loudness + limiter)...');
                this.masterizarBuffer(renderedBuffer, this.masterTarget);
            }

            this.updateMixingProgress(95, 'Convertendo formato...');

            // Convert to desired format
            let blob;
            let filename;
            
            if (this.exportFormat === 'wav') {
                blob = this.bufferToWav(renderedBuffer);
                filename = `mix_${Date.now()}.wav`;
            } else {
                blob = await this.bufferToMp3(renderedBuffer);
                // Sem encoder, bufferToMp3 devolve WAV — o nome acompanha.
                const ext = blob.type === 'audio/mpeg' ? 'mp3' : 'wav';
                filename = `mix_${Date.now()}.${ext}`;
            }

            this.updateMixingProgress(100, 'Concluído!');

            // Download
            this.downloadBlob(blob, filename);

            // Guarda o mix pra o botão "Enviar para entrega" mandar direto pro
            // cadastro do cliente, sem o vaivém de baixar e subir o mesmo arquivo.
            this.ultimoMixBlob = blob;
            this.ultimoMixNome = filename;
            const btnEnviar = document.getElementById('btnEnviarEntrega');
            if (btnEnviar) btnEnviar.style.display = '';

            setTimeout(() => {
                this.showMixingStatus(false);
                this.showNotification('Mix exportado com sucesso!', 'success');
            }, 1000);

        } catch (error) {
            console.error('Error exporting mix:', error);
            this.showMixingStatus(false);
            this.showNotification('Erro ao exportar mix', 'error');
        }
    }

    bufferToWav(buffer) {
        return MixEngine.bufferToWav(buffer);
    }

    // MP3 DE VERDADE. Antes esta função devolvia o WAV com nome .mp3 — o
    // arquivo "mp3" tinha 10x o tamanho e podia ser recusado por player/WhatsApp.
    // O lamejs já vinha carregado no minidaw.html e nunca era usado.
    // Se o encoder não estiver disponível, devolve WAV MESMO (type audio/wav) e
    // quem chama ajusta a extensão — melhor entregar .wav do que mentir no nome.
    async bufferToMp3(buffer, kbps) {
        return MixEngine.bufferToMp3(buffer, kbps || this.mp3Bitrate);
    }

    // Cópia independente do buffer. Necessária porque masterizarBuffer trabalha
    // IN-PLACE: sem copiar, masterizar o mesmo mix em dois alvos (alto e rádio)
    // faria o segundo mastering em cima do áudio já limitado do primeiro.
    _copiarBuffer(buffer) {
        const copia = this.audioContext.createBuffer(
            buffer.numberOfChannels, buffer.length, buffer.sampleRate
        );
        for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
            copia.getChannelData(ch).set(buffer.getChannelData(ch));
        }
        return copia;
    }

    // ═══════════════════════════════════════════════════════════════════
    // PACOTE DE STEMS — voz.wav + trilha.wav + mix em dois formatos, tudo
    // num ZIP. Sem biblioteca de ZIP: uso o método "store" (sem compressão)
    // porque WAV/MP3 já são densos e não encolhem com deflate — seriam
    // ~100KB de dependência externa pra economizar ~0%.
    // ═══════════════════════════════════════════════════════════════════

    _crc32(u8) {
        if (!MiniDAW._crcTabela) {
            const t = new Uint32Array(256);
            for (let n = 0; n < 256; n++) {
                let c = n;
                for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
                t[n] = c >>> 0;
            }
            MiniDAW._crcTabela = t;
        }
        const t = MiniDAW._crcTabela;
        let c = 0xFFFFFFFF;
        for (let i = 0; i < u8.length; i++) c = t[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }

    // arquivos: [{ nome: 'stems/voz.wav', dados: Uint8Array }]
    _zipStore(arquivos) {
        const enc = new TextEncoder();
        const partes = [];      // corpo (headers locais + dados)
        const central = [];     // diretório central
        let offset = 0;

        const agora = new Date();
        const horaDos = ((agora.getHours() << 11) | (agora.getMinutes() << 5) | (agora.getSeconds() >> 1)) & 0xFFFF;
        const dataDos = (((agora.getFullYear() - 1980) << 9) | ((agora.getMonth() + 1) << 5) | agora.getDate()) & 0xFFFF;

        for (const a of arquivos) {
            const nome = enc.encode(a.nome);
            const dados = a.dados;
            const crc = this._crc32(dados);

            const lh = new DataView(new ArrayBuffer(30));
            lh.setUint32(0, 0x04034b50, true);   // assinatura do header local
            lh.setUint16(4, 20, true);           // versão necessária (2.0)
            lh.setUint16(6, 0x0800, true);       // flag bit 11: nome em UTF-8
            lh.setUint16(8, 0, true);            // método 0 = store
            lh.setUint16(10, horaDos, true);
            lh.setUint16(12, dataDos, true);
            lh.setUint32(14, crc, true);
            lh.setUint32(18, dados.length, true);
            lh.setUint32(22, dados.length, true);
            lh.setUint16(26, nome.length, true);
            lh.setUint16(28, 0, true);           // sem campo extra
            partes.push(new Uint8Array(lh.buffer), nome, dados);

            const cd = new DataView(new ArrayBuffer(46));
            cd.setUint32(0, 0x02014b50, true);   // assinatura do diretório central
            cd.setUint16(4, 20, true);           // versão que criou
            cd.setUint16(6, 20, true);           // versão necessária
            cd.setUint16(8, 0x0800, true);
            cd.setUint16(10, 0, true);
            cd.setUint16(12, horaDos, true);
            cd.setUint16(14, dataDos, true);
            cd.setUint32(16, crc, true);
            cd.setUint32(20, dados.length, true);
            cd.setUint32(24, dados.length, true);
            cd.setUint16(28, nome.length, true);
            cd.setUint16(30, 0, true);
            cd.setUint16(32, 0, true);
            cd.setUint16(34, 0, true);
            cd.setUint16(36, 0, true);
            cd.setUint32(38, 0, true);
            cd.setUint32(42, offset, true);      // onde está o header local
            central.push(new Uint8Array(cd.buffer), nome);

            offset += 30 + nome.length + dados.length;
        }

        let tamCentral = 0;
        for (const p of central) tamCentral += p.length;

        const eocd = new DataView(new ArrayBuffer(22));
        eocd.setUint32(0, 0x06054b50, true);
        eocd.setUint16(4, 0, true);
        eocd.setUint16(6, 0, true);
        eocd.setUint16(8, arquivos.length, true);
        eocd.setUint16(10, arquivos.length, true);
        eocd.setUint32(12, tamCentral, true);
        eocd.setUint32(16, offset, true);
        eocd.setUint16(20, 0, true);

        return new Blob(partes.concat(central, [new Uint8Array(eocd.buffer)]), { type: 'application/zip' });
    }

    _slugArquivo(s) {
        // ̀-ͯ = marcas de acento que o NFD separa da letra.
        return String(s || 'faixa')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // tira acento
            .replace(/[^a-zA-Z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .toLowerCase() || 'faixa';
    }

    async pacoteDeStems() {
        const comAudio = this.tracks.filter(t => t.audioBuffer);
        if (comAudio.length === 0) {
            this.showNotification('Adicione voz/trilha antes de gerar o pacote', 'warning');
            return;
        }

        this.showMixingStatus(true);
        this.updateMixingProgress(0, 'Preparando o pacote...');
        const bytes = async (blob) => new Uint8Array(await blob.arrayBuffer());

        try {
            const arquivos = [];
            const linhas = [];

            // 1. STEMS — cada faixa renderizada SOZINHA, mas com a mesma cadeia
            //    de efeitos, o mesmo ducking e a mesma duração que ela tem
            //    dentro do mix. Somando os stems você tem o mix de volta.
            const usados = {};
            for (let i = 0; i < comAudio.length; i++) {
                const t = comAudio[i];
                this.updateMixingProgress(5 + (i / comAudio.length) * 45, `Stem: ${t.name}...`);
                const buf = await this._renderizarParaExport([t]);
                let nome = this._slugArquivo(t.name);
                usados[nome] = (usados[nome] || 0) + 1;
                if (usados[nome] > 1) nome += '-' + usados[nome];
                const caminho = `stems/${nome}.wav`;
                arquivos.push({ nome: caminho, dados: await bytes(this.bufferToWav(buf)) });
                linhas.push(`${caminho}  —  ${t.type === 'voice' ? 'voz' : 'trilha'}, isolada, já com os efeitos da mixagem`);
            }

            // 2. MIX completo renderizado UMA vez e masterizado em dois alvos.
            //    Cada alvo numa CÓPIA: masterizarBuffer trabalha in-place.
            this.updateMixingProgress(55, 'Renderizando o mix final...');
            const mix = await this._renderizarParaExport(comAudio);

            this.updateMixingProgress(70, 'Mix alto (MP3 320kbps)...');
            const alto = this._copiarBuffer(mix);
            this.masterizarBuffer(alto, this.otimizarPresets.streaming);
            const blobAlto = await this.bufferToMp3(alto, 320);
            const extAlto = blobAlto.type === 'audio/mpeg' ? 'mp3' : 'wav';
            arquivos.push({ nome: `mix_final_alto.${extAlto}`, dados: await bytes(blobAlto) });
            linhas.push(`mix_final_alto.${extAlto}  —  mix pronto, volume ALTO (o mesmo do "Otimizar e Exportar"). WhatsApp, Instagram, YouTube, Spotify.`);

            this.updateMixingProgress(85, 'Mix rádio/TV (WAV)...');
            const radio = this._copiarBuffer(mix);
            this.masterizarBuffer(radio, this.otimizarPresets.radio);
            arquivos.push({ nome: 'mix_final_radio.wav', dados: await bytes(this.bufferToWav(radio)) });
            linhas.push('mix_final_radio.wav  —  mesmo mix no nível baixo de broadcast (-23), WAV. Só pra emissora que exige; soa mais baixo de propósito.');

            // 3. LEIA-ME — o cliente/emissora abre o ZIP e sabe o que é cada coisa.
            const sr = mix.sampleRate;
            const leiame = [
                'PACOTE DE ÁUDIO — Studio Audio Pank',
                'Gerado em ' + new Date().toLocaleString('pt-BR'),
                '',
                'CONTEÚDO:',
                ...linhas.map(l => '  • ' + l),
                '',
                'ESPECIFICAÇÃO: ' + sr + ' Hz, 16 bits, estéreo. Picos limitados a -1 dBFS.',
                'Os stems somam de volta no mix (mesma cadeia, mesmo ducking, mesma duração).',
                'Níveis por normalização de RMS — profissional e consistente, não LUFS certificado.',
                ''
            ].join('\r\n');
            arquivos.push({ nome: 'LEIA-ME.txt', dados: new TextEncoder().encode(leiame) });

            this.updateMixingProgress(95, 'Compactando...');
            const zip = this._zipStore(arquivos);
            const nomeZip = `pacote-${this._slugArquivo(this.projetoNome || 'locucao')}-${Date.now()}.zip`;

            this.ultimoPacoteBlob = zip;
            this.ultimoPacoteNome = nomeZip;
            this.downloadBlob(zip, nomeZip);

            this.updateMixingProgress(100, 'Pacote pronto!');
            setTimeout(() => this.showMixingStatus(false), 800);
            this._mostrarOpcoesPacote(arquivos, zip.size);
        } catch (e) {
            console.error('[pacote] falhou:', e);
            this.showMixingStatus(false);
            alert('Não consegui montar o pacote.\nErro: ' + e.message);
        }
    }

    // Depois de baixar o ZIP: as duas saídas que evitam o vaivém manual —
    // link direto de 7 dias (pra colar no WhatsApp) ou entrega de cliente
    // (reusa o cadastro que já existe; NÃO é um sistema de entrega novo).
    _mostrarOpcoesPacote(arquivos, tamanho) {
        const esc = (s) => String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

        const antigo = document.getElementById('modal-pacote');
        if (antigo) antigo.remove();

        const modal = document.createElement('div');
        modal.id = 'modal-pacote';
        modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.75);' +
            'display:flex;align-items:center;justify-content:center;padding:1rem;';
        modal.innerHTML = `
            <div style="background:#141a2e;color:#e6e8f0;border:1px solid #2a3350;border-radius:14px;
                        max-width:560px;width:100%;padding:1.25rem;max-height:90vh;overflow:auto;">
                <h5 style="margin:0 0 .25rem;">📦 Pacote pronto — ${(tamanho / 1024 / 1024).toFixed(1)} MB</h5>
                <p style="font-size:.85rem;opacity:.7;margin:0 0 .9rem;">
                    O ZIP já foi baixado. Se quiser, mande direto pro cliente daqui.
                </p>
                <div style="background:#0e1424;border:1px solid #2a3350;border-radius:8px;
                            padding:.6rem .8rem;margin-bottom:1rem;font-size:.8rem;line-height:1.7;">
                    ${arquivos.map(a => '<div>📄 ' + esc(a.nome) + '</div>').join('')}
                </div>
                <div id="pacoteStatus" style="font-size:.85rem;margin-bottom:.75rem;min-height:1.2em;"></div>
                <div style="display:flex;gap:.5rem;flex-wrap:wrap;justify-content:flex-end;">
                    <button id="pacoteFechar" style="padding:.5rem 1rem;border-radius:8px;
                            background:#2a3350;color:#e6e8f0;border:none;cursor:pointer;">Fechar</button>
                    <button id="pacoteLink" style="padding:.5rem 1rem;border-radius:8px;
                            background:#3b82f6;color:#fff;border:none;font-weight:600;cursor:pointer;">
                        🔗 Link de 7 dias</button>
                    <button id="pacoteEntrega" style="padding:.5rem 1rem;border-radius:8px;
                            background:#22c55e;color:#052e16;border:none;font-weight:600;cursor:pointer;">
                        📨 Enviar para entrega</button>
                </div>
            </div>`;
        document.body.appendChild(modal);

        const status = modal.querySelector('#pacoteStatus');
        modal.querySelector('#pacoteFechar').onclick = () => modal.remove();

        modal.querySelector('#pacoteEntrega').onclick = () => {
            modal.remove();
            window.enviarParaEntrega(this.ultimoPacoteBlob, this.ultimoPacoteNome);
        };

        modal.querySelector('#pacoteLink').onclick = async (ev) => {
            const btn = ev.currentTarget;
            btn.disabled = true;
            status.style.color = '#93c5fd';
            try {
                status.textContent = 'Enviando o pacote...';
                const ru = await fetch('/api/client-deliveries/upload-url', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename: this.ultimoPacoteNome, kind: 'pacote' })
                });
                const u = await ru.json();
                if (!u.success) throw new Error(u.error || 'Falha ao preparar o envio');

                const fd = new FormData();
                fd.append('file', this.ultimoPacoteBlob, this.ultimoPacoteNome);
                const up = await fetch(u.upload_url, {
                    method: 'PUT',
                    headers: { 'apikey': u.apikey, 'Authorization': `Bearer ${u.apikey}` },
                    body: fd
                });
                if (!up.ok) throw new Error('Falha ao enviar o pacote pro armazenamento');

                status.textContent = 'Gerando o link...';
                const rl = await fetch('/api/stems/share-link', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: u.path })
                });
                const l = await rl.json();
                if (!l.success) throw new Error(l.error || 'Falha ao gerar o link');

                status.style.color = '#4ade80';
                status.innerHTML = '✅ Link válido por 7 dias (já copiado):<br>' +
                    '<input readonly value="' + esc(l.url) + '" style="width:100%;margin-top:.4rem;' +
                    'padding:.4rem;border-radius:6px;background:#0e1424;color:#93c5fd;' +
                    'border:1px solid #2a3350;font-size:.75rem;">';
                try { await navigator.clipboard.writeText(l.url); } catch (_) { /* sem permissão: fica no campo */ }
            } catch (e) {
                status.style.color = '#f87171';
                status.textContent = '❌ ' + e.message;
                btn.disabled = false;
            }
        };
    }

    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    showMixingStatus(show) {
        const status = document.getElementById('mixingStatus');
        if (status) {
            status.classList.toggle('active', show);
        }
    }

    updateMixingProgress(percent, text) {
        const progressFill = document.getElementById('progressFill');
        const statusText = document.getElementById('mixingStatusText');
        
        if (progressFill) {
            progressFill.style.width = `${percent}%`;
        }
        
        if (statusText) {
            statusText.textContent = text;
        }
    }

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `alert alert-${this.getAlertClass(type)} alert-dismissible fade show position-fixed`;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            min-width: 300px;
            max-width: 500px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        `;
        
        notification.innerHTML = `
            <div class="d-flex align-items-center">
                <i class="fas fa-${this.getIcon(type)} me-2"></i>
                <div class="flex-grow-1">${message}</div>
                <button type="button" class="btn-close ms-2" onclick="this.parentElement.parentElement.remove()"></button>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 5000);
        
        // Also log to console
        console.log(`${type.toUpperCase()}: ${message}`);
    }
    
    getAlertClass(type) {
        const classes = {
            'success': 'success',
            'error': 'danger',
            'warning': 'warning',
            'info': 'info'
        };
        return classes[type] || 'info';
    }
    
    getIcon(type) {
        const icons = {
            'success': 'check-circle',
            'error': 'exclamation-triangle',
            'warning': 'exclamation-circle',
            'info': 'info-circle'
        };
        return icons[type] || 'info-circle';
    }

    updateUI() {
        const emptyState = document.getElementById('emptyState');
        if (emptyState) {
            emptyState.style.display = this.tracks.length === 0 ? 'block' : 'none';
        }
    }

    // Recria o card da faixa NO MESMO LUGAR e religa os efeitos.
    //
    // Duas coisas quebravam aqui e apareciam como "perdeu os efeitos":
    //
    // 1) createTrackUI faz container.appendChild(), então toda recriação
    //    jogava a faixa pro FIM da lista. Cortar ou trocar o tipo embaralhava
    //    a ordem sozinho — parecia que "a ordem" causava o problema.
    // 2) O card voltava com os botões certos, mas a CADEIA DE ÁUDIO ficava
    //    com o estado antigo: sem applyEffectStates, o que se vê aceso na
    //    tela não é o que está ligado no som.
    updateTrackUI(track) {
        const cardAntigo = document.getElementById(`track_${track.id}`);
        if (!cardAntigo) return;

        const container = cardAntigo.parentNode;
        const ancora = cardAntigo.nextSibling;   // vizinho de baixo, pra voltar no lugar
        cardAntigo.remove();

        this.createTrackUI(track);               // entra no fim...
        const cardNovo = document.getElementById(`track_${track.id}`);
        if (cardNovo && container) {
            container.insertBefore(cardNovo, ancora);   // ...e volta pra posição original
        }

        // Sem nós de áudio a faixa fica muda no play (playTrack sai calado se
        // não achar a entrada no Map). Corte e troca de tipo passam por aqui.
        if (!this.trackNodes.get(track.id) && track.audioBuffer) {
            this.createTrackNodes(track);
        }
        if (typeof this.applyEffectStates === 'function') this.applyEffectStates(track);
        if (typeof this.updateEffectsUI === 'function') this.updateEffectsUI(track);
    }

    // File handling
    handleDrop(event) {
        event.preventDefault();
        event.stopPropagation();
        
        const files = Array.from(event.dataTransfer.files).filter(file => file.type.startsWith('audio/'));
        
        if (files.length > 0) {
            files.forEach(file => {
                this.addTrack();
                const trackId = this.tracks[this.tracks.length - 1].id;
                this.loadAudioFile(file, trackId);
            });
        }
        
        this.removeDragOver();
    }

    handleDragOver(event) {
        event.preventDefault();
        event.stopPropagation();
        
        const dropZone = document.getElementById('dropZone');
        if (dropZone) {
            dropZone.classList.add('dragover');
        }
    }

    handleDragLeave(event) {
        event.preventDefault();
        event.stopPropagation();
        this.removeDragOver();
    }

    removeDragOver() {
        const dropZone = document.getElementById('dropZone');
        if (dropZone) {
            dropZone.classList.remove('dragover');
        }
    }

    handleFileSelect(event) {
        const files = Array.from(event.target.files);
        
        files.forEach(file => {
            this.addTrack();
            const trackId = this.tracks[this.tracks.length - 1].id;
            this.loadAudioFile(file, trackId);
        });
        
        // Reset file input
        event.target.value = '';
    }

    handleTrackDrop(event, trackId) {
        event.preventDefault();
        event.stopPropagation();
        
        const files = Array.from(event.dataTransfer.files).filter(file => file.type.startsWith('audio/'));
        
        if (files.length > 0) {
            this.loadAudioFile(files[0], trackId);
        }
        
        this.removeTrackDragOver(trackId);
    }

    handleTrackDragOver(event, trackId) {
        event.preventDefault();
        event.stopPropagation();
        
        const dropZone = document.getElementById(`drop_${trackId}`);
        if (dropZone) {
            dropZone.classList.add('dragover');
        }
    }

    handleTrackDragLeave(event, trackId) {
        event.preventDefault();
        event.stopPropagation();
        this.removeTrackDragOver(trackId);
    }

    removeTrackDragOver(trackId) {
        const dropZone = document.getElementById(`drop_${trackId}`);
        if (dropZone) {
            dropZone.classList.remove('dragover');
        }
    }

    handleTrackFileSelect(event, trackId) {
        const file = event.target.files[0];
        if (file) {
            this.loadAudioFile(file, trackId);
        }
    }

    // Import from TTS
    // Diálogo de escolha dos áudios do TTS. Devolve a lista escolhida, ou []
    // se cancelar. O mais recente vem marcado — é quase sempre o que se acabou
    // de gerar no Studio, então o caso comum é abrir e confirmar.
    //
    // Monta os nós com textContent (nunca innerHTML com dado de fora): nome de
    // arquivo entra literal aqui e innerHTML abriria buraco de injeção.
    escolherAudiosDoTTS(files) {
        return new Promise((resolve) => {
            const fundo = document.createElement('div');
            fundo.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.7);' +
                'display:flex;align-items:center;justify-content:center;padding:1rem;';

            const caixa = document.createElement('div');
            caixa.style.cssText = 'background:#141a2e;color:#e6e8f0;border:1px solid #2a3350;' +
                'border-radius:14px;max-width:560px;width:100%;padding:1.25rem;max-height:85vh;' +
                'display:flex;flex-direction:column;font-family:inherit;';

            const titulo = document.createElement('h5');
            titulo.textContent = 'Importar do TTS';
            titulo.style.cssText = 'margin:0 0 .25rem;';
            caixa.appendChild(titulo);

            const sub = document.createElement('p');
            sub.textContent = 'Escolha quais áudios entram no projeto. Cada um vira uma faixa.';
            sub.style.cssText = 'font-size:.85rem;opacity:.7;margin:0 0 1rem;';
            caixa.appendChild(sub);

            const lista = document.createElement('div');
            lista.style.cssText = 'overflow:auto;flex:1;margin-bottom:1rem;';

            files.forEach((f, i) => {
                const linha = document.createElement('label');
                linha.style.cssText = 'display:flex;gap:.6rem;align-items:center;padding:.5rem .6rem;' +
                    'border:1px solid #2a3350;border-radius:8px;margin-bottom:.4rem;cursor:pointer;';

                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.value = String(i);
                cb.checked = (i === 0);   // o mais recente já vem marcado
                linha.appendChild(cb);

                const txt = document.createElement('div');
                txt.style.cssText = 'min-width:0;';
                const nome = document.createElement('div');
                nome.textContent = f.filename;
                nome.style.cssText = 'font-size:.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
                const meta = document.createElement('div');
                const kb = f.size ? Math.round(f.size / 1024) + ' KB' : '';
                meta.textContent = [f.modified, kb].filter(Boolean).join(' · ');
                meta.style.cssText = 'font-size:.75rem;opacity:.6;';
                txt.appendChild(nome);
                txt.appendChild(meta);
                linha.appendChild(txt);
                lista.appendChild(linha);
            });
            caixa.appendChild(lista);

            const acoes = document.createElement('div');
            acoes.style.cssText = 'display:flex;gap:.5rem;justify-content:flex-end;';

            const btnCancelar = document.createElement('button');
            btnCancelar.textContent = 'Cancelar';
            btnCancelar.style.cssText = 'padding:.5rem 1rem;border-radius:8px;background:#2a3350;' +
                'color:#e6e8f0;border:none;cursor:pointer;';

            const btnOk = document.createElement('button');
            btnOk.textContent = 'Importar';
            btnOk.style.cssText = 'padding:.5rem 1rem;border-radius:8px;background:#22c55e;' +
                'color:#052e16;border:none;font-weight:600;cursor:pointer;';

            acoes.appendChild(btnCancelar);
            acoes.appendChild(btnOk);
            caixa.appendChild(acoes);
            fundo.appendChild(caixa);
            document.body.appendChild(fundo);

            const fechar = (resultado) => {
                document.body.removeChild(fundo);
                resolve(resultado);
            };
            btnCancelar.onclick = () => fechar([]);
            btnOk.onclick = () => {
                const marcados = Array.from(lista.querySelectorAll('input:checked'))
                    .map(cb => files[parseInt(cb.value, 10)]);
                fechar(marcados);
            };
            // Clicar fora cancela — mas só no fundo, não dentro da caixa.
            fundo.onclick = (e) => { if (e.target === fundo) fechar([]); };
        });
    }

    async importFromTTS() {
        try {
            this.showNotification('Buscando áudios recentes...', 'info');
            
            // Get recent audio files from TTS with timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);
            
            const serverUrl = `${window.location.origin}/api/recent-audio`;
            const response = await fetch(serverUrl, {
                signal: controller.signal,
                headers: { 'Accept': 'application/json' }
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            const files = data.files || data;
            
            if (!files || files.length === 0) {
                this.showNotification('Nenhum áudio recente encontrado no TTS. Gere alguns áudios primeiro!', 'warning');
                return;
            }

            // ANTES: `files.slice(0, 5)` e importava os cinco de uma vez. O
            // comentário aqui dizia "Create selection dialog", mas o diálogo
            // nunca foi escrito — então todo import enchia o projeto com 5
            // faixas e não dava pra mixar UM spot: o export levava tudo junto.
            const selectedFiles = await this.escolherAudiosDoTTS(files);
            if (!selectedFiles || selectedFiles.length === 0) return;   // cancelou
            let loadedCount = 0;

            const falhas = [];
            for (const fileInfo of selectedFiles) {
                let trackId = null;
                try {
                    const audioResponse = await fetch(`/api/download/${fileInfo.filename}`);
                    if (!audioResponse.ok) {
                        throw new Error(`Failed to download ${fileInfo.filename}`);
                    }

                    const blob = await audioResponse.blob();
                    this.addTrack('voice');
                    trackId = this.tracks[this.tracks.length - 1].id;
                    const file = new File([blob], fileInfo.filename, { type: 'audio/wav' });
                    await this.loadAudioFile(file, trackId);
                    loadedCount++;
                } catch (error) {
                    console.error(`Error loading ${fileInfo.filename}:`, error);
                    // A faixa já tinha sido criada quando o carregamento falhou:
                    // deixá-la aí é o que produzia as "Voz 3", "Voz 5" mudas no
                    // projeto. Faixa sem áudio não toca nem exporta — é só lixo
                    // na tela, e o erro morria calado no console.
                    if (trackId) this.removeTrack(trackId);
                    falhas.push(fileInfo.filename);
                }
            }

            if (falhas.length) {
                this.showNotification(
                    `${loadedCount} importado(s). Falhou: ${falhas.join(', ')} — o arquivo pode ter expirado no servidor.`,
                    loadedCount > 0 ? 'warning' : 'error');
            } else {
                this.showNotification(`${loadedCount} áudio(s) importado(s) do TTS`, 'success');
            }
        } catch (error) {
            console.error('Error importing from TTS:', error);
            if (error.name === 'AbortError') {
                this.showNotification('Timeout: TTS não respondeu em 8 segundos. Verifique a conexão.', 'error');
            } else {
                this.showNotification(`Erro TTS: ${error.message}`, 'error');
            }
        }
    }

    // Local storage
    saveToLocalStorage() {
        const data = {
            tracks: this.tracks.map(track => ({
                ...track,
                audioUrl: null, // Don't store audio URLs in localStorage
                audioBuffer: null
            })),
            exportFormat: this.exportFormat,
            mp3Bitrate: this.mp3Bitrate
        };
        
        localStorage.setItem('minidaw_project', JSON.stringify(data));
    }

    loadFromLocalStorage() {
        try {
            const saved = localStorage.getItem('minidaw_project');
            if (saved) {
                const data = JSON.parse(saved);
                
                // Restore settings
                this.exportFormat = data.exportFormat || 'wav';
                this.mp3Bitrate = data.mp3Bitrate || 192;
                
                // Restore tracks (without audio)
                data.tracks.forEach(trackData => {
                    this.addTrack(trackData.type);
                    const track = this.tracks[this.tracks.length - 1];
                    Object.assign(track, trackData);
                    this.createTrackUI(track);
                });
                
                this.updateUI();
            }
        } catch (error) {
            console.error('❌ Erro ao carregar localStorage:', error.message);
            console.warn('🧹 Limpando dados corrompidos...');
            localStorage.removeItem('minidaw_project');
            this.showNotification('Dados salvos corrompidos foram removidos. O MiniDAW foi resetado.', 'warning');
        }
    }

    // Novas funcionalidades
    // ── TESOURA ──────────────────────────────────────────────────────────
    // O botão nunca acendia: toggleScissorMode procurava getElementById
    // ('scissorBtn'), elemento que não existe — o botão do card não tem id.
    // E o corte era "clicou, partiu em duas": não dava pra marcar início e fim
    // de um trecho, que é o que se precisa pra tirar um respiro ou um erro.
    //
    // Agora a tesoura é POR FAIXA: liga naquela faixa, você arrasta em cima da
    // onda pra marcar o trecho, e escolhe o que fazer com ele.
    toggleScissorMode(trackId) {
        // Sem argumento (atalho C) mira na faixa que já está armada, ou na
        // primeira que tenha áudio — assim a tecla continua útil.
        if (!trackId) {
            trackId = this.trackTesoura ||
                (this.tracks.find(t => t.audioBuffer) || {}).id;
            if (!trackId) {
                this.showNotification('Nenhuma faixa com áudio pra cortar', 'warning');
                return;
            }
        }

        const ligando = this.trackTesoura !== trackId;
        // Só uma faixa armada por vez: duas seleções ao mesmo tempo só
        // confundem na hora de decidir onde o corte vai cair.
        const anterior = this.trackTesoura;
        this.trackTesoura = ligando ? trackId : null;
        this.scissorMode = ligando;

        if (anterior && anterior !== trackId) this.cancelarSelecao(anterior);
        if (!ligando) this.cancelarSelecao(trackId);

        this.tracks.forEach(t => {
            const btn = document.getElementById(`btntesoura_${t.id}`);
            if (btn) btn.classList.toggle('active', this.trackTesoura === t.id);
            const box = document.getElementById(`wfbox_${t.id}`);
            if (box) box.style.cursor = (this.trackTesoura === t.id) ? 'crosshair' : 'default';
        });

        this.showNotification(
            ligando ? 'Tesoura ligada — arraste em cima da onda pra marcar o trecho'
                    : 'Tesoura desligada',
            ligando ? 'info' : 'success');
    }

    // Troca Voz <-> Trilha. Não é cosmético: o motor de mixagem decide o
    // ducking, o auto fade-out e ATÉ A DURAÇÃO DO MIX pelo tipo da faixa
    //
    //     const voiceTracks = tracks.filter(t => t.type === 'voice');
    //     if (track.type === 'music' && voiceTracks.length > 0) { ...ducking... }
    //
    // Uma locução rotulada como Trilha deixa o projeto sem nenhuma faixa de
    // voz: a trilha nunca abaixa, nunca some no fim, e o mix passa a durar a
    // trilha inteira em vez de acabar junto com a fala. Até aqui não havia como
    // corrigir isso pela tela — a etiqueta era decidida na criação e ponto.
    alternarTipoFaixa(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (!track) return;

        track.type = (track.type === 'voice') ? 'music' : 'voice';
        track.color = (track.type === 'voice') ? '#3b82f6' : '#a855f7';

        this.updateTrackUI(track);
        requestAnimationFrame(() => this.drawWaveform(track));
        this.saveToLocalStorage();

        const temVoz = this.tracks.some(t => t.audioBuffer && t.type === 'voice');
        const temTrilha = this.tracks.some(t => t.audioBuffer && t.type === 'music');
        let recado = track.type === 'voice'
            ? `"${track.name}" agora é VOZ — a trilha vai abaixar embaixo dela e sumir no fim.`
            : `"${track.name}" agora é TRILHA.`;
        if (temTrilha && !temVoz) {
            recado += ' ⚠️ Nenhuma faixa de Voz no projeto: sem ducking e sem fade automático.';
        }
        this.showNotification(recado, temTrilha && !temVoz ? 'warning' : 'success');
    }

    // Salva SÓ esta faixa, no estado em que ela está (já cortada/editada).
    // O "Salvar Projeto" guarda a mixagem inteira no Supabase; isto aqui é a
    // rede de segurança da faixa em si — corte bom não se perde por causa de
    // um F5 ou de um clique errado depois.
    baixarFaixa(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (!track || !track.audioBuffer) {
            this.showNotification('Esta faixa ainda não tem áudio', 'warning');
            return;
        }
        const blob = this.bufferToWav(track.audioBuffer);
        const nome = String(track.name || 'faixa')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\w\-]+/g, '-').replace(/^-|-$/g, '') || 'faixa';
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${nome}.wav`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        this.showNotification(`"${track.name}" salva (${track.duration.toFixed(2)}s)`, 'success');
    }

    _tempoNoPonto(ev, track) {
        const box = document.getElementById(`wfbox_${track.id}`);
        const r = box.getBoundingClientRect();
        const frac = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
        return frac * track.duration;
    }

    iniciarSelecao(ev, trackId) {
        if (this.trackTesoura !== trackId) return;      // tesoura desligada nesta faixa
        const track = this.tracks.find(t => t.id === trackId);
        if (!track || !track.audioBuffer) return;
        ev.preventDefault();

        const t0 = this._tempoNoPonto(ev, track);
        this.selecoes = this.selecoes || {};
        this.selecoes[trackId] = { ini: t0, fim: t0 };

        const mover = (e) => {
            const t = this._tempoNoPonto(e, track);
            const s = this.selecoes[trackId];
            // Arrastar pra trás é válido: normaliza na hora de desenhar.
            s.ini = Math.min(t0, t);
            s.fim = Math.max(t0, t);
            this.desenharSelecao(trackId);
        };
        const soltar = () => {
            document.removeEventListener('mousemove', mover);
            document.removeEventListener('mouseup', soltar);
            const s = this.selecoes[trackId];
            // Clique seco (sem arrastar) marca um ponto — serve pra "Dividir".
            if (s && s.fim - s.ini < 0.01) { s.fim = s.ini; }
            this.desenharSelecao(trackId);
        };
        document.addEventListener('mousemove', mover);
        document.addEventListener('mouseup', soltar);
        this.desenharSelecao(trackId);
    }

    desenharSelecao(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        const s = (this.selecoes || {})[trackId];
        const reg = document.getElementById(`selreg_${trackId}`);
        const hIni = document.getElementById(`selini_${trackId}`);
        const hFim = document.getElementById(`selfim_${trackId}`);
        const barra = document.getElementById(`barracorte_${trackId}`);
        const info = document.getElementById(`corteinfo_${trackId}`);
        if (!track || !reg || !hIni || !hFim || !barra) return;

        if (!s || !track.duration) {
            reg.style.display = hIni.style.display = hFim.style.display = 'none';
            barra.classList.remove('ativa');
            return;
        }

        const pIni = (s.ini / track.duration) * 100;
        const pFim = (s.fim / track.duration) * 100;
        reg.style.display = (s.fim > s.ini) ? 'block' : 'none';
        reg.style.left = pIni + '%';
        reg.style.width = (pFim - pIni) + '%';
        hIni.style.display = hFim.style.display = 'block';
        hIni.style.left = pIni + '%';
        hFim.style.left = pFim + '%';

        barra.classList.add('ativa');
        const fmt = (t) => {
            const m = Math.floor(t / 60);
            const seg = (t % 60).toFixed(2).padStart(5, '0');
            return `${m}:${seg}`;
        };
        info.textContent = (s.fim > s.ini)
            ? `trecho ${fmt(s.ini)} → ${fmt(s.fim)}  (${(s.fim - s.ini).toFixed(2)}s)`
            : `ponto ${fmt(s.ini)}`;
    }

    cancelarSelecao(trackId) {
        if (this.selecoes) delete this.selecoes[trackId];
        this.desenharSelecao(trackId);
    }

    // modo: 'remover' (tira o trecho), 'manter' (fica só o trecho),
    //       'dividir' (parte a faixa no início da marcação)
    async aplicarCorte(trackId, modo) {
        const track = this.tracks.find(t => t.id === trackId);
        const s = (this.selecoes || {})[trackId];
        if (!track || !track.audioBuffer || !s) return;

        const sr = track.audioBuffer.sampleRate;
        const total = track.audioBuffer.length;
        const aIni = Math.max(0, Math.min(total, Math.floor(s.ini * sr)));
        const aFim = Math.max(0, Math.min(total, Math.floor(s.fim * sr)));

        if (modo !== 'dividir' && aFim - aIni < 1) {
            this.showNotification('Arraste sobre a onda pra marcar o trecho primeiro', 'warning');
            return;
        }
        if (modo === 'dividir') {
            this.cancelarSelecao(trackId);
            return this.cutTrackAtTime(trackId, s.ini);
        }

        // Guarda o original UMA vez, pra "Restaurar voz" continuar valendo
        // depois de cortar (mesma rede de segurança do Encurtar Pausas).
        // O Map é criado sob demanda no resto do arquivo — sem este `if` o
        // corte feito antes de "Encurtar Pausas" ficaria sem volta.
        if (!this.vozOriginais) this.vozOriginais = new Map();
        if (track.type === 'voice' && !this.vozOriginais.has(track.id)) {
            this.vozOriginais.set(track.id, track.audioBuffer);
        }

        const nch = track.audioBuffer.numberOfChannels;
        const novoTam = (modo === 'manter') ? (aFim - aIni) : (total - (aFim - aIni));
        if (novoTam < 1) {
            this.showNotification('Isso apagaria a faixa inteira', 'warning');
            return;
        }

        const novo = this.audioContext.createBuffer(nch, novoTam, sr);
        // Fade de 5ms na emenda: corte seco no meio da onda estala.
        const XF = Math.min(Math.round(0.005 * sr), Math.floor(novoTam / 2));

        for (let ch = 0; ch < nch; ch++) {
            const orig = track.audioBuffer.getChannelData(ch);
            const dest = novo.getChannelData(ch);
            if (modo === 'manter') {
                for (let i = 0; i < novoTam; i++) dest[i] = orig[aIni + i];
            } else {
                for (let i = 0; i < aIni; i++) dest[i] = orig[i];
                for (let i = aFim; i < total; i++) dest[aIni + (i - aFim)] = orig[i];
            }
            // Suaviza as bordas do que sobrou
            for (let i = 0; i < XF; i++) {
                const g = i / XF;
                dest[i] *= g;
                dest[novoTam - 1 - i] *= g;
            }
        }

        track.audioBuffer = novo;
        track.duration = novo.length / sr;
        track.audioUrl = URL.createObjectURL(this.bufferToWav(novo));
        this.cancelarSelecao(trackId);
        // updateTrackUI RECRIA o card (createTrackUI + remove o antigo), então
        // ele tem que vir ANTES: desenhar primeiro pintava num canvas que era
        // jogado fora em seguida, e a faixa cortada aparecia sem onda.
        this.updateTrackUI(track);
        // E no quadro seguinte, pra o canvas novo já ter largura — recém
        // inserido no DOM ele mede 0 e o desenho sairia vazio.
        requestAnimationFrame(() => this.drawWaveform(track));
        this.duration = Math.max(0, ...this.tracks.filter(t => t.audioBuffer).map(t => t.duration));
        this.updateDuration();
        this.saveToLocalStorage();

        this.showNotification(
            (modo === 'manter'
                ? `Ficou só o trecho marcado (${track.duration.toFixed(2)}s)`
                : `Trecho removido — a faixa agora tem ${track.duration.toFixed(2)}s`)
            + ' · 💾 no topo da faixa salva esta versão',
            'success');
    }

    stopPlayback() {
        this.stop();
        this.currentTime = 0;
        this.updatePlaybackTime();
    }

    // Zoom functions melhoradas
    zoomIn() {
        this.globalZoom = Math.min(4, this.globalZoom + 0.25);
        this.updateZoomIndicator();
        this.applyZoomToAllTracks();
    }

    zoomOut() {
        this.globalZoom = Math.max(0.5, this.globalZoom - 0.25);
        this.updateZoomIndicator();
        this.applyZoomToAllTracks();
    }

    trackZoomIn(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (track) {
            track.zoom = Math.min(4, track.zoom + 0.25);
            this.updateTrackUI(track);
        }
    }

    trackZoomOut(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (track) {
            track.zoom = Math.max(0.5, track.zoom - 0.25);
            this.updateTrackUI(track);
        }
    }

    updateZoomIndicator() {
        const indicator = document.getElementById('zoomIndicator');
        if (indicator) {
            indicator.textContent = `${Math.round(this.globalZoom * 100)}%`;
        }
    }

    applyZoomToAllTracks() {
        this.tracks.forEach(track => {
            track.zoom = this.globalZoom;
        });
        this.updateUI();
    }

    // Auto Fade melhorado
    applyAutoFade() {
        const voiceTracks = this.tracks.filter(t => t.type === 'voice' && t.audioBuffer);
        const musicTracks = this.tracks.filter(t => t.type === 'music' && t.audioBuffer);

        if (voiceTracks.length === 0 || musicTracks.length === 0) {
            this.showNotification('Adicione pelo menos uma voz e uma trilha', 'warning');
            return;
        }

        this.autoFadeEnabled = true;
        
        // Aplica fade out de 1.05s nas trilhas musicais
        musicTracks.forEach(track => {
            this.updateTrackFadeOut(track.id, 1.05);
            
            // Mostra indicador
            const indicator = document.getElementById(`autoFade_${track.id}`);
            if (indicator) {
                indicator.classList.add('active');
            }
        });

        // Inicia monitoramento de silêncio
        this.startSilenceDetection();

        this.showNotification('Auto Fade ativado (1.05s)', 'success');
    }

    startSilenceDetection() {
        if (this.silenceInterval) {
            clearInterval(this.silenceInterval);
        }

        this.silenceInterval = setInterval(() => {
            if (!this.isPlaying || !this.autoFadeEnabled) return;

            const voiceTracks = this.tracks.filter(t => t.type === 'voice' && t.audioBuffer);
            const musicTracks = this.tracks.filter(t => t.type === 'music' && t.audioBuffer);

            voiceTracks.forEach(voiceTrack => {
                const nodes = this.trackNodes.get(voiceTrack.id);
                if (!nodes || !nodes.analyser) return;

                const analyser = nodes.analyser;
                const dataArray = new Uint8Array(analyser.frequencyBinCount);
                analyser.getByteTimeDomainData(dataArray);

                // Detecta silêncio
                let sum = 0;
                for (let i = 0; i < dataArray.length; i++) {
                    const normalized = (dataArray[i] - 128) / 128;
                    sum += normalized * normalized;
                }
                const rms = Math.sqrt(sum / dataArray.length);
                const isSilent = rms < 0.01;

                // Se detectou silêncio no final da track
                if (isSilent && voiceTrack.duration && (this.currentTime >= voiceTrack.duration - 2)) {
                    if (!this.voiceEndDetected.has(voiceTrack.id)) {
                        this.voiceEndDetected.set(voiceTrack.id, true);
                        
                        // Aplica fade out nas trilhas musicais
                        musicTracks.forEach(musicTrack => {
                            this.applyMusicFadeOut(musicTrack);
                        });
                    }
                } else if (!isSilent) {
                    this.voiceEndDetected.delete(voiceTrack.id);
                }
            });
        }, 100);
    }

    applyMusicFadeOut(musicTrack) {
        const nodes = this.trackNodes.get(musicTrack.id);
        if (!nodes || !nodes.gainNode) return;

        const gainNode = nodes.gainNode;
        const currentGain = gainNode.gain.value;
        const fadeSteps = 21; // 1.05s / 50ms
        const fadeStep = currentGain / fadeSteps;
        let step = 0;

        const fadeInterval = setInterval(() => {
            step++;
            const newGain = Math.max(0, currentGain - (fadeStep * step));
            gainNode.gain.setValueAtTime(newGain, this.audioContext.currentTime);
            
            if (step >= fadeSteps) {
                clearInterval(fadeInterval);
                gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
            }
        }, 50);
    }

    // Projeto VIP
    async saveVipProject() {
        try {
            this.showNotification('Salvando projeto VIP...', 'info');

            const project = {
                name: `Projeto_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}`,
                version: '1.0',
                createdAt: new Date().toISOString(),
                tracks: [],
                audioData: {}
            };

            // Converte todos os áudios para base64
            for (const track of this.tracks) {
                if (track.audioUrl && track.audioBuffer) {
                    // Converte buffer para WAV
                    const wavBlob = this.bufferToWav(track.audioBuffer);
                    const base64 = await new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result);
                        reader.readAsDataURL(wavBlob);
                    });

                    project.tracks.push({
                        id: track.id,
                        name: track.name,
                        type: track.type,
                        volume: track.volume,
                        pan: track.pan,
                        fadeIn: track.fadeIn,
                        fadeOut: track.fadeOut,
                        effects: track.effects,
                        eqSettings: track.eqSettings
                    });

                    project.audioData[track.id] = base64;
                }
            }

            // Salva como arquivo .vip
            const projectBlob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(projectBlob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `${project.name}.vip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            this.showNotification('Projeto VIP salvo com sucesso!', 'success');
        } catch (error) {
            console.error('Erro ao salvar projeto VIP:', error);
            this.showNotification('Erro ao salvar projeto VIP', 'error');
        }
    }

    async loadVipProject() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.vip';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                const text = await file.text();
                const project = JSON.parse(text);

                // Limpa projeto atual
                this.clearAllTracks();

                // Carrega tracks do projeto
                for (const trackData of project.tracks) {
                    this.addTrack(trackData.type);
                    const track = this.tracks[this.tracks.length - 1];
                    
                    // Restaura configurações
                    Object.assign(track, trackData);
                    
                    // Carrega áudio do base64
                    if (project.audioData[track.id]) {
                        const base64Data = project.audioData[track.id];
                        const response = await fetch(base64Data);
                        const blob = await response.blob();
                        
                        await this.loadAudioFile(blob, track.id);
                    }
                }

                this.showNotification(`Projeto "${project.name}" carregado com sucesso!`, 'success');
            } catch (error) {
                console.error('Erro ao carregar projeto VIP:', error);
                this.showNotification('Erro ao carregar projeto VIP', 'error');
            }
        };

        input.click();
    }

    // ═══════════════════════════════════════════════════════════════════
    // PROJETOS NO SUPABASE — salvar a mixagem (voz+trilha+efeitos) e reabrir
    // DEPOIS trazendo o áudio de volta. Substitui o .vip de disco e o
    // localStorage-sem-áudio, que faziam o projeto "voltar vazio".
    // O áudio de cada faixa sobe pro Storage (signed URL, kind='projeto') e a
    // linha guarda só o caminho — nada de base64 gigante.
    // ═══════════════════════════════════════════════════════════════════

    // Sobe um WAV da faixa pro Storage e devolve o audio_path.
    async _uploadAudioProjeto(blob) {
        const ru = await fetch('/api/client-deliveries/upload-url', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: `faixa-${Date.now()}.wav`, kind: 'projeto' })
        });
        const u = await ru.json();
        if (!u.success) throw new Error(u.error || 'Falha ao preparar o envio do áudio');
        const fd = new FormData();
        fd.append('file', blob, 'faixa.wav');
        const up = await fetch(u.upload_url, {
            method: 'PUT',
            headers: { 'apikey': u.apikey, 'Authorization': `Bearer ${u.apikey}` },
            body: fd
        });
        if (!up.ok) throw new Error('Falha ao enviar o áudio da faixa');
        return u.path;
    }

    async salvarProjetoSupabase() {
        const comAudio = this.tracks.filter(t => t.audioBuffer);
        if (comAudio.length === 0) {
            this.showNotification('Adicione voz/trilha antes de salvar', 'warning');
            return;
        }
        const nome = prompt('Nome do projeto:', this.projetoNome || 'Meu projeto');
        if (!nome) return;
        let passo = 'início';
        try {
            this.showNotification('Salvando projeto (enviando áudios)...', 'info');
            const tracks = [];
            for (let i = 0; i < comAudio.length; i++) {
                const t = comAudio[i];
                const td = {
                    name: t.name, type: t.type,
                    volume: t.volume, pan: t.pan,
                    fadeIn: t.fadeIn, fadeOut: t.fadeOut,
                    effects: t.effects, eqSettings: t.eqSettings
                };
                if (t.audioUrl && /^https?:/i.test(t.audioUrl)) {
                    // Já está no Storage com URL estável (ex.: trilha da Biblioteca,
                    // /object/public/...). NÃO reenvia — evita reupload de arquivo
                    // grande (era o gargalo) e aponta direto pra URL pública.
                    passo = `referenciar faixa ${i + 1} (${t.name}) — já no Storage`;
                    console.log('[projeto] ' + passo);
                    td.audio_url_direct = t.audioUrl;
                } else {
                    // Voz gerada / arquivo local (blob:) — sobe o WAV.
                    passo = `converter faixa ${i + 1} (${t.name}) para WAV`;
                    console.log('[projeto] ' + passo);
                    const wav = this.bufferToWav(t.audioBuffer);
                    passo = `enviar áudio da faixa ${i + 1} (${t.name}) — ${(wav.size / 1024 / 1024).toFixed(1)}MB`;
                    console.log('[projeto] ' + passo);
                    td.audio_path = await this._uploadAudioProjeto(wav);
                }
                tracks.push(td);
            }
            passo = 'gravar o projeto no banco';
            console.log('[projeto] ' + passo);
            const body = { name: nome, tracks };
            if (this.projetoId) body.id = this.projetoId;   // atualiza em vez de duplicar
            const r = await fetch('/api/projects', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const d = await r.json();
            if (!d.success) throw new Error(d.error || 'Falha ao gravar no banco');
            this.projetoId = d.project.id;
            this.projetoNome = nome;
            console.log('[projeto] salvo:', d.project.id);
            this.showNotification(`Projeto "${nome}" salvo! Reabra por "Meus Projetos".`, 'success');
        } catch (e) {
            console.error('[projeto] FALHOU em:', passo, e);
            // alert (não some) pra o erro não passar despercebido como antes.
            alert(`Não consegui salvar o projeto.\nOnde parou: ${passo}\nErro: ${e.message}`);
        }
    }

    async abrirMeusProjetos() {
        try {
            const r = await fetch('/api/projects');
            const d = await r.json();
            const projetos = (d && d.projects) ? d.projects : [];
            const esc = (s) => String(s == null ? '' : s)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

            const modal = document.createElement('div');
            modal.id = 'modal-projetos';
            modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.75);' +
                'display:flex;align-items:center;justify-content:center;padding:1rem;';
            const linhas = projetos.length ? projetos.map(p => `
                <div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;
                            background:#0e1424;border:1px solid #2a3350;border-radius:8px;padding:.6rem .8rem;margin-bottom:.5rem;">
                    <div style="min-width:0;">
                        <div style="color:#e6e8f0;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(p.name)}</div>
                        <div style="color:#8b93a7;font-size:.75rem;">${p.tracks_count || 0} faixa(s) · ${(p.updated_at || '').slice(0,16).replace('T',' ')}</div>
                    </div>
                    <div style="display:flex;gap:.4rem;flex-shrink:0;">
                        <button data-abrir="${esc(p.id)}" style="background:#22c55e;color:#052e16;border:none;border-radius:6px;padding:.4rem .7rem;font-weight:600;cursor:pointer;">Abrir</button>
                        <button data-excluir="${esc(p.id)}" style="background:#3a1620;color:#f87171;border:1px solid #7f1d1d;border-radius:6px;padding:.4rem .6rem;cursor:pointer;">🗑️</button>
                    </div>
                </div>`).join('') : '<div style="color:#8b93a7;text-align:center;padding:1.5rem;">Nenhum projeto salvo ainda.</div>';

            modal.innerHTML = `
                <div style="background:#141a2e;border:1px solid #2a3350;border-radius:14px;max-width:520px;width:100%;padding:1.25rem;max-height:85vh;overflow:auto;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem;">
                        <h5 style="margin:0;color:#e6e8f0;">📂 Meus Projetos</h5>
                        <button id="proj-fechar" style="background:#2a3350;color:#e6e8f0;border:none;border-radius:6px;padding:.35rem .7rem;cursor:pointer;">Fechar</button>
                    </div>
                    <div>${linhas}</div>
                </div>`;
            document.body.appendChild(modal);

            const fechar = () => modal.remove();
            modal.querySelector('#proj-fechar').onclick = fechar;
            modal.onclick = (e) => { if (e.target === modal) fechar(); };
            modal.querySelectorAll('[data-abrir]').forEach(b =>
                b.onclick = () => { fechar(); this.carregarProjetoSupabase(b.getAttribute('data-abrir')); });
            modal.querySelectorAll('[data-excluir]').forEach(b =>
                b.onclick = async () => {
                    if (!confirm('Excluir este projeto? O áudio salvo continua no Storage.')) return;
                    await fetch(`/api/projects/${b.getAttribute('data-excluir')}`, { method: 'DELETE' });
                    fechar(); this.abrirMeusProjetos();
                });
        } catch (e) {
            this.showNotification('Erro ao listar projetos: ' + e.message, 'error');
        }
    }

    async carregarProjetoSupabase(id) {
        try {
            this.showNotification('Abrindo projeto...', 'info');
            const r = await fetch(`/api/projects/${id}`);
            const d = await r.json();
            if (!d.success) throw new Error(d.error || 'Projeto não encontrado');
            const proj = d.project;

            this.clearAllTracks(true);   // true = sem confirmação

            for (const td of (proj.tracks || [])) {
                this.addTrack(td.type || 'music');
                const track = this.tracks[this.tracks.length - 1];
                // Restaura SÓ os ajustes — NÃO o id (manter o id novo evita o
                // descasamento de DOM que o load do .vip tinha).
                track.name      = td.name ?? track.name;
                track.volume    = (td.volume    != null) ? td.volume    : 100;
                track.pan       = (td.pan       != null) ? td.pan       : 0;
                track.fadeIn    = (td.fadeIn    != null) ? td.fadeIn    : 0;
                track.fadeOut   = (td.fadeOut   != null) ? td.fadeOut   : 0;
                track.effects   = td.effects    || track.effects;
                track.eqSettings= td.eqSettings || track.eqSettings;
                if (td.audio_url) {
                    await this.loadAudioFromUrl(td.audio_url, track.id, td.name);
                }
                this.updateTrackUI(track);
            }
            this.projetoId = proj.id;
            this.projetoNome = proj.name;
            this.showNotification(`Projeto "${proj.name}" aberto com áudio e efeitos!`, 'success');
        } catch (e) {
            this.showNotification('Erro ao abrir projeto: ' + e.message, 'error');
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // BIBLIOTECA DE TRILHAS — agora ABRE EM MODAL, sem sair da MiniDAW.
    // Antes o botão fazia window.location.href='/library', o que RECARREGAVA a
    // página e matava a voz que já estava nas faixas (o áudio gerado vive só na
    // memória). A trilha escolhida é ADICIONADA à sessão atual, não substitui.
    // ═══════════════════════════════════════════════════════════════════
    async abrirBibliotecaModal() {
        try {
            const r = await fetch('/api/tracks');
            const d = await r.json();
            const tracks = (d && d.tracks) ? d.tracks : [];
            const esc = (s) => String(s == null ? '' : s)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

            const modal = document.createElement('div');
            modal.id = 'modal-biblioteca';
            modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.75);' +
                'display:flex;align-items:center;justify-content:center;padding:1rem;';
            const linhas = tracks.length ? tracks.map(t => `
                <div style="background:#0e1424;border:1px solid #2a3350;border-radius:8px;padding:.6rem .8rem;margin-bottom:.5rem;">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;">
                        <div style="color:#e6e8f0;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(t.name)}</div>
                        <button data-usar="${esc(t.file_url)}" data-nome="${esc(t.name)}"
                            style="background:#22c55e;color:#052e16;border:none;border-radius:6px;padding:.4rem .8rem;font-weight:600;cursor:pointer;flex-shrink:0;">
                            + Usar
                        </button>
                    </div>
                    <audio controls preload="none" src="${esc(t.file_url)}" style="width:100%;margin-top:.4rem;height:32px;"></audio>
                </div>`).join('') : '<div style="color:#8b93a7;text-align:center;padding:1.5rem;">Nenhuma trilha na biblioteca ainda.</div>';

            modal.innerHTML = `
                <div style="background:#141a2e;border:1px solid #2a3350;border-radius:14px;max-width:560px;width:100%;padding:1.25rem;max-height:85vh;overflow:auto;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;">
                        <h5 style="margin:0;color:#e6e8f0;">📚 Biblioteca de Trilhas</h5>
                        <button id="bib-fechar" style="background:#2a3350;color:#e6e8f0;border:none;border-radius:6px;padding:.35rem .7rem;cursor:pointer;">Fechar</button>
                    </div>
                    <p style="color:#8b93a7;font-size:.78rem;margin:0 0 .75rem;">A trilha entra como uma nova faixa — a voz e os efeitos que já estão continuam.</p>
                    <div>${linhas}</div>
                </div>`;
            document.body.appendChild(modal);

            const fechar = () => modal.remove();
            modal.querySelector('#bib-fechar').onclick = fechar;
            modal.onclick = (e) => { if (e.target === modal) fechar(); };
            modal.querySelectorAll('[data-usar]').forEach(b =>
                b.onclick = async () => {
                    const url = b.getAttribute('data-usar');
                    const nome = b.getAttribute('data-nome') || 'Trilha';
                    fechar();
                    try {
                        this.showNotification('Carregando trilha...', 'info');
                        this.addTrack('music');                 // ADICIONA — não limpa nada
                        const track = this.tracks[this.tracks.length - 1];
                        await this.loadAudioFromUrl(url, track.id, nome);
                        this.showNotification(`Trilha "${nome}" adicionada!`, 'success');
                    } catch (e) {
                        this.showNotification('Erro ao carregar a trilha: ' + e.message, 'error');
                    }
                });
        } catch (e) {
            this.showNotification('Erro ao abrir a biblioteca: ' + e.message, 'error');
        }
    }

    // Cut track at position
    async cutTrackAtTime(trackId, cutTime) {
        const track = this.tracks.find(t => t.id === trackId);
        if (!track || !track.audioBuffer) {
            this.showNotification('Track sem áudio para cortar', 'error');
            return;
        }

        try {
            const sampleRate = track.audioBuffer.sampleRate;
            const cutSample = Math.floor(cutTime * sampleRate);

            // Primeira parte
            const firstBuffer = this.audioContext.createBuffer(
                track.audioBuffer.numberOfChannels,
                cutSample,
                sampleRate
            );

            // Segunda parte
            const secondLength = track.audioBuffer.length - cutSample;
            const secondBuffer = this.audioContext.createBuffer(
                track.audioBuffer.numberOfChannels,
                secondLength,
                sampleRate
            );

            // Copia dados
            for (let channel = 0; channel < track.audioBuffer.numberOfChannels; channel++) {
                const originalData = track.audioBuffer.getChannelData(channel);
                
                // Primeira parte
                const firstData = firstBuffer.getChannelData(channel);
                for (let i = 0; i < cutSample; i++) {
                    firstData[i] = originalData[i];
                }

                // Segunda parte
                const secondData = secondBuffer.getChannelData(channel);
                for (let i = 0; i < secondLength; i++) {
                    secondData[i] = originalData[cutSample + i];
                }
            }

            // Converte para blobs
            const firstBlob = this.bufferToWav(firstBuffer);
            const secondBlob = this.bufferToWav(secondBuffer);

            // Cria nova track para segunda parte
            const newTrackId = 'track_' + Date.now();
            const newTrack = {
                id: newTrackId,
                name: `${track.name} (Parte 2)`,
                type: track.type,
                audioUrl: URL.createObjectURL(secondBlob),
                audioBuffer: secondBuffer,
                duration: secondBuffer.length / sampleRate,
                volume: track.volume,
                pan: track.pan,
                fadeIn: 0,
                fadeOut: track.fadeOut,
                effects: { ...track.effects },
                color: track.color
            };

            // Atualiza track original
            track.audioBuffer = firstBuffer;
            track.audioUrl = URL.createObjectURL(firstBlob);
            track.duration = firstBuffer.length / sampleRate;
            track.fadeOut = 0;

            // Adiciona nova track
            this.tracks.push(newTrack);
            this.createTrackNodes(newTrack);

            // createTrackNodes monta só os nós de ÁUDIO. Sem createTrackUI a
            // Parte 2 nascia sem card nenhum na tela — existia no projeto e
            // entrava no export, mas invisível pra quem estava editando.
            this.createTrackUI(newTrack);
            this.updateTrackUI(track);     // a Parte 1 encurtou: recria o card
            this.updateUI();
            requestAnimationFrame(() => {
                this.drawWaveform(track);
                this.drawWaveform(newTrack);
            });
            this.duration = Math.max(0, ...this.tracks.filter(t => t.audioBuffer).map(t => t.duration));
            this.updateDuration();
            this.showNotification(`Track "${track.name}" cortado em ${cutTime.toFixed(2)}s`, 'success');

        } catch (error) {
            console.error('Erro ao cortar track:', error);
            this.showNotification('Erro ao cortar track', 'error');
        }
    }
}

// Global functions for HTML onclick handlers
let minidaw;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    minidaw = new MiniDAW();
});

// Global functions for onclick handlers
window.addTrack = (type) => minidaw.addTrack(type);
window.removeTrack = (id) => minidaw.removeTrack(id);
window.updateTrackName = (id, name) => minidaw.updateTrackName(id, name);
window.updateTrackVolume = (id, volume) => minidaw.updateTrackVolume(id, volume);
window.updateTrackPan = (id, pan) => minidaw.updateTrackPan(id, pan);
window.updateTrackFadeIn = (id, fadeIn) => minidaw.updateTrackFadeIn(id, fadeIn);
window.updateTrackFadeOut = (id, fadeOut) => minidaw.updateTrackFadeOut(id, fadeOut);
window.toggleEffect = (id, effect) => minidaw.toggleEffect(id, effect);
window.toggleMute = (id) => minidaw.toggleMute(id);
window.toggleSolo = (id) => minidaw.toggleSolo(id);
window.updateEQ = (id, band, value) => minidaw.updateEQ(id, band, value);
window.togglePlayback = () => minidaw.togglePlayback();
window.setFormat = (format) => minidaw.setFormat(format);
window.exportMix = () => minidaw.exportMix();
// Otimizar 1-clique: usa o alvo ALTO (streaming), que o usuario aprovou como
// "claro, forte, com brilho". Exporta e volta o alvo pra null (pra o "Exportar"
// normal continuar sem otimizacao).
window.exportarOtimizado = () => {
    minidaw.masterTarget = minidaw.otimizarPresets.streaming;
    Promise.resolve(minidaw.exportMix()).finally(() => { minidaw.masterTarget = null; });
};
// Encurtar pausas: lê o input de pausa máxima e aplica na voz.
window.encurtarPausas = () => {
    const el = document.getElementById('pausaMax');
    let v = el ? parseFloat(el.value) : 0.4;
    if (!isFinite(v) || v <= 0) v = 0.4;
    v = Math.max(0.1, Math.min(1.5, v));
    minidaw.encurtarPausasVoz(v);
};
window.desfazerEncurtar = () => minidaw.desfazerEncurtar();
// Pacote de Stems: stems separados + mix em dois formatos, num ZIP só.
window.pacoteDeStems = () => minidaw.pacoteDeStems();
window.normalizeVolumes = () => minidaw.normalizeVolumes();
window.applyAutoFade = () => minidaw.applyAutoFade();
window.clearAllTracks = () => minidaw.clearAllTracks();
window.importFromTTS = () => minidaw.importFromTTS();
window.zoomIn = () => minidaw.zoomIn();
window.zoomOut = () => minidaw.zoomOut();
window.handleDrop = (e) => minidaw.handleDrop(e);
window.handleDragOver = (e) => minidaw.handleDragOver(e);
window.handleDragLeave = (e) => minidaw.handleDragLeave(e);
window.handleFileSelect = (e) => minidaw.handleFileSelect(e);
window.handleTrackDrop = (e, id) => minidaw.handleTrackDrop(e, id);
window.handleTrackDragOver = (e, id) => minidaw.handleTrackDragOver(e, id);
window.handleTrackDragLeave = (e, id) => minidaw.handleTrackDragLeave(e, id);
window.handleTrackFileSelect = (e, id) => minidaw.handleTrackFileSelect(e, id);

// Novas funcionalidades
window.toggleScissorMode = () => minidaw.toggleScissorMode();
window.stopPlayback = () => minidaw.stopPlayback();
window.trackZoomIn = (id) => minidaw.trackZoomIn(id);
window.trackZoomOut = (id) => minidaw.trackZoomOut(id);
window.saveVipProject = () => minidaw.saveVipProject();   // export .vip (backup em disco) — mantido
window.loadVipProject = () => minidaw.loadVipProject();   // import .vip — mantido
// Fluxo NOVO (Supabase): salvar/reabrir projeto com áudio de verdade.
window.salvarProjetoSupabase = () => minidaw.salvarProjetoSupabase();
window.abrirMeusProjetos = () => minidaw.abrirMeusProjetos();
window.abrirBibliotecaModal = () => minidaw.abrirBibliotecaModal();

// Efeitos de áudio
window.updateReverbAmount = (id, amount) => minidaw.updateReverbAmount(id, amount);
window.updateCompressor = (id, param, value) => minidaw.updateCompressor(id, param, value);

// ⚡ Incorporar Receita da IA (VoxCraft fase 3): pede a receita de mixagem pro
// backend e aplica nos tracks — voz à frente, trilha de fundo com fade e a
// cadeia de efeitos. IA = cérebro, MiniDAW = mãos.
window.incorporarReceitaIA = async () => {
    const btn = document.getElementById('recipeBtn');
    if (!minidaw || !minidaw.tracks || minidaw.tracks.length === 0) {
        alert('Suba a voz e a trilha no MiniDAW primeiro.');
        return;
    }
    const comAudio = minidaw.tracks.filter(t => t.audioBuffer);
    if (comAudio.length === 0) {
        alert('Carregue o áudio das faixas antes de aplicar a receita.');
        return;
    }

    const original = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Montando receita...'; }
    try {
        // CONTEXTO: sem isto a IA decidia quase às cegas (só o tipo e a duração
        // das faixas) e a receita caía sempre nos mesmos números. Agora vai o
        // briefing digitado + o roteiro, quando o áudio veio do Studio.
        const briefing = (document.getElementById('briefingIA')?.value || '').trim();
        if (briefing) localStorage.setItem('minidaw_briefing', briefing);   // não some ao recarregar
        const roteiro = (localStorage.getItem('minidaw_pending_roteiro') || '').trim();

        const contexto = [
            briefing ? `Briefing: ${briefing}` : '',
            roteiro ? `Roteiro da locução: ${roteiro.slice(0, 700)}` : ''
        ].filter(Boolean).join('\n');

        const payload = {
            tracks: comAudio.map(t => ({ type: t.type, name: t.name, duration: t.duration || 0 })),
            contexto
        };
        const resp = await fetch(window.location.origin + '/api/voxcraft/mix-recipe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await resp.json();
        if (!result.success) throw new Error(result.error || 'Falha ao montar a receita');

        let aplicadas = 0;
        comAudio.forEach(track => {
            const r = track.type === 'voice' ? result.voz
                    : (track.type === 'music' ? result.trilha : null);
            if (!r) return;

            // Volume / pan / fades — setters oficiais atualizam track + áudio.
            minidaw.updateTrackVolume(track.id, r.volume);
            minidaw.updateTrackPan(track.id, r.pan);       // slider -100..100
            minidaw.updateTrackFadeIn(track.id, r.fade_in);
            minidaw.updateTrackFadeOut(track.id, r.fade_out);

            // Efeitos: mescla os booleanos da receita e aplica no grafo de áudio.
            if (r.effects && track.effects) {
                Object.keys(track.effects).forEach(fx => {
                    if (r.effects[fx] !== undefined) track.effects[fx] = !!r.effects[fx];
                });
                if (typeof minidaw.applyEffectStates === 'function') minidaw.applyEffectStates(track);
            }

            // Redesenha o card refletindo sliders + estado dos botões de efeito.
            if (typeof minidaw.updateTrackUI === 'function') minidaw.updateTrackUI(track);
            if (typeof minidaw.updateEffectsUI === 'function') minidaw.updateEffectsUI(track);
            aplicadas++;
        });

        if (typeof minidaw.saveToLocalStorage === 'function') minidaw.saveToLocalStorage();

        // Diz de onde veio a receita: 'ia' = o Gemini decidiu; 'base' = a receita
        // padrão (IA fora do ar ou sem chave). Antes não dava pra saber.
        const origem = result.fonte === 'ia'
            ? (contexto ? '🧠 IA, com o seu contexto' : '🧠 IA (sem briefing — dica: preencha o Briefing)')
            : '⚙️ Receita padrão (a IA não respondeu agora)';
        alert('🎚️ Receita aplicada em ' + aplicadas + ' faixa(s)!\n' + origem + '\n\n' +
              (result.resumo || '') + '\n\nÉ só dar play e refinar o que quiser.');
    } catch (error) {
        console.error('Erro ao incorporar receita:', error);
        alert('Erro ao montar a receita: ' + error.message);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = original; }
    }
};

// Devolve o briefing digitado da última vez — recarregar a página não apaga o
// contexto do trabalho em andamento.
document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById('briefingIA');
    const salvo = localStorage.getItem('minidaw_briefing');
    if (el && salvo && !el.value) el.value = salvo;
    window.atualizarChipRoteiro();
});

// Mostra na tela se o roteiro do Studio chegou junto. Antes o contexto ia (ou
// não ia) em silêncio e não havia como conferir.
window.atualizarChipRoteiro = () => {
    const chip = document.getElementById('roteiroChip');
    if (!chip) return;
    const r = (localStorage.getItem('minidaw_pending_roteiro') || '').trim();
    if (!r) { chip.style.display = 'none'; return; }
    chip.style.display = '';
    chip.textContent = '';                       // textContent: nada de HTML do roteiro
    const txt = document.createElement('span');
    txt.textContent = `📄 Roteiro do Studio (${r.length} car.)`;
    const x = document.createElement('a');
    x.href = '#';
    x.textContent = ' ✕';
    x.style.cssText = 'color:#4ade80;text-decoration:none;font-weight:700;';
    x.title = 'Descartar este roteiro';
    x.onclick = (e) => { e.preventDefault(); window.limparRoteiroIA(); };
    chip.appendChild(txt);
    chip.appendChild(x);
    chip.title = r.slice(0, 300);                // passa o mouse e vê o começo
};

window.limparRoteiroIA = () => {
    localStorage.removeItem('minidaw_pending_roteiro');
    window.atualizarChipRoteiro();
};

// 🧹 Helper para limpar cache e resetar MiniDAW (use se der erro)
window.resetMiniDAW = () => {
    localStorage.removeItem('minidaw_project');
    sessionStorage.clear();
    console.log('✅ MiniDAW resetado! Recarregando...');
    window.location.reload();
};

// 📊 Debug: Mostrar estado atual no console
window.debugMiniDAW = () => {
    console.log('📊 ESTADO DO MINIDAW:');
    console.log('- Tracks:', minidaw.tracks.length);
    console.log('- Tracks detalhes:', minidaw.tracks.map(t => ({id: t.id, type: t.type, name: t.name, hasAudio: !!t.audioBuffer})));
    console.log('- Nodes criados:', Array.from(minidaw.trackNodes.keys()));
    console.log('- Is Playing:', minidaw.isPlaying);
    console.log('- Current Time:', minidaw.currentTime);
};

// 🎤 Testar AudioContext
window.testAudioContext = async () => {
    if (minidaw.audioContext.state === 'suspended') {
        await minidaw.audioContext.resume();
        console.log('✅ AudioContext resumido:', minidaw.audioContext.state);
    } else {
        console.log('ℹ️ AudioContext já está:', minidaw.audioContext.state);
    }
};

// Ponte com o cadastro de entrega: usa o mix já exportado (Blob em memória),
// então não refaz o render nem depende de arquivo em disco.
window.enviarMixParaEntrega = () => {
    if (!minidaw.ultimoMixBlob) {
        minidaw.showNotification('Exporte o mix primeiro', 'warning');
        return;
    }
    window.enviarParaEntrega(minidaw.ultimoMixBlob, minidaw.ultimoMixNome);
};
