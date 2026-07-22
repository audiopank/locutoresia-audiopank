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
        this.globalZoom = 1;
        this.autoFadeEnabled = true;
        // ⚠️ autoFadeDuration NÃO está ligado em nada — o código usa 1.05 fixo em
        // todos os pontos (playback, export, botão de auto-fade). Mudar aqui não
        // muda o áudio. Mantido pra não quebrar quem lê, mas não confie nele.
        this.autoFadeDuration = 1.10;

        // DUCKING — o quanto a trilha abaixa embaixo da voz (multiplicador do
        // volume da faixa). Ajuste este número de ouvido:
        //   0.28 ≈ -11 dB  trilha quase some (era o valor inicial, ficou baixo demais)
        //   0.45 ≈  -7 dB  trilha presente embaixo da voz  ← padrão atual
        //   0.60 ≈  -4 dB  trilha bem audível, disputa mais com a locução
        this.duckGain = 0.45;

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

        // Waveform click handler para tesoura
        document.addEventListener('click', (e) => {
            if (this.scissorMode && e.target.closest('.waveform-container')) {
                const waveformContainer = e.target.closest('.track-card');
                if (waveformContainer) {
                    const trackId = waveformContainer.id.replace('track_', '');
                    const rect = e.target.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const width = rect.width;
                    const track = this.tracks.find(t => t.id === trackId);
                    
                    if (track && track.audioBuffer) {
                        const cutTime = (x / width) * track.duration;
                        this.cutTrackAtTime(trackId, cutTime);
                    }
                }
            }
        });
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
                limiter: true
            },
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
                    <div class="track-type ${track.type}">${track.type === 'voice' ? 'Voz' : 'Trilha'}</div>
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
                <div class="waveform-container">
                    <canvas id="waveform_${track.id}" class="waveform"></canvas>
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
                            <button class="effect-btn" onclick="window.location.href='/library'" title="Biblioteca de Trilhas">
                                <i class="fas fa-book-open"></i> Biblioteca
                            </button>
                            <button class="effect-btn" onclick="window.open('https://app.lmnt.com/', '_blank')" title="LMNT Studio">
                                <i class="fas fa-external-link-alt"></i> LMNT
                            </button>
                            <button class="effect-btn" onclick="minidaw.toggleScissorMode()" title="Tesoura">
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
                <div class="effects-panel ${track.effects.eq ? 'active' : ''}" id="effects_${track.id}">
                    <div class="effect-control">
                        <div class="effect-label">Equalizador</div>
                        <input type="range" class="form-range" min="-20" max="20" value="0" 
                               onchange="minidaw.updateEQ('${track.id}', 'low', this.value)">
                        <small>Graves</small>
                    </div>
                    <div class="effect-control">
                        <input type="range" class="form-range" min="-20" max="20" value="0" 
                               onchange="minidaw.updateEQ('${track.id}', 'mid', this.value)">
                        <small>Médios</small>
                    </div>
                    <div class="effect-control">
                        <input type="range" class="form-range" min="-20" max="20" value="0" 
                               onchange="minidaw.updateEQ('${track.id}', 'high', this.value)">
                        <small>Agudos</small>
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
                track.eqSettings = track.eqSettings || { low: 0, mid: 0, high: 0 };
                
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
                track.eqSettings = track.eqSettings || { low: 0, mid: 0, high: 0 };
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
        
        // 2. EQ
        const eqNode = this.audioContext.createBiquadFilter();
        eqNode.type = 'peaking';
        eqNode.frequency.value = 1000;
        eqNode.gain.value = 0;
        eqNode.Q.value = 1;
        
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
        hpfNode.connect(eqNode);
        eqNode.connect(presenceNode);
        presenceNode.connect(compressorNode);
        compressorNode.connect(limiterNode);
        limiterNode.connect(analyser);
        analyser.connect(gainNode);
        limiterNode.connect(reverbNode);
        reverbNode.connect(reverbGain);
        reverbGain.connect(panNode);
        gainNode.connect(panNode);
        panNode.connect(this.masterGain);
        
        // Store nodes
        this.trackNodes.set(track.id, {
            inputNode: hpfNode,
            hpfNode,
            eqNode,
            presenceNode,
            compressorNode,
            limiterNode,
            analyser,
            reverbNode,
            reverbGain,
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

        // EQ
        nodes.eqNode.gain.value = track.effects.eq ? (track.eqSettings?.mid || 0) : 0;

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
    }

    drawWaveform(track) {
        const canvas = document.getElementById(`waveform_${track.id}`);
        if (!canvas || !track.audioBuffer) return;
        
        const ctx = canvas.getContext('2d');
        const data = track.audioBuffer.getChannelData(0);
        const width = canvas.width = canvas.offsetWidth;
        const height = canvas.height = canvas.offsetHeight;
        
        ctx.clearRect(0, 0, width, height);
        ctx.strokeStyle = track.color;
        ctx.lineWidth = 2;
        
        const sliceWidth = width / data.length;
        let x = 0;
        
        ctx.beginPath();
        for (let i = 0; i < data.length; i++) {
            const v = data[i];
            const y = (v + 1) / 2 * height;
            
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
            
            x += sliceWidth;
        }
        
        ctx.stroke();
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
    }

    updateEQ(trackId, band, value) {
        const track = this.tracks.find(t => t.id === trackId);
        if (!track) return;

        if (!track.eqSettings) track.eqSettings = {};
        track.eqSettings[band] = parseFloat(value);

        const nodes = this.trackNodes.get(trackId);
        if (nodes && track.effects.eq) {
            switch(band) {
                case 'low':
                    nodes.eqNode.frequency.value = 250;
                    nodes.eqNode.gain.value = track.eqSettings[band];
                    break;
                case 'mid':
                    nodes.eqNode.frequency.value = 1000;
                    nodes.eqNode.gain.value = track.eqSettings[band];
                    break;
                case 'high':
                    nodes.eqNode.frequency.value = 4000;
                    nodes.eqNode.gain.value = track.eqSettings[band];
                    break;
            }
        }
        this.saveToLocalStorage();
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
        const playIcon = document.getElementById('playIcon');
        if (playIcon) {
            playIcon.className = 'fas fa-pause';
        }

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
        const nodes = this.trackNodes.get(track.id);
        if (!nodes || !track.audioBuffer) return;

        // Create source node
        const sourceNode = this.audioContext.createBufferSource();
        sourceNode.buffer = track.audioBuffer;
        
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

    stop() {
        this.isPlaying = false;
        this.currentTime = 0;

        const playIcon = document.getElementById('playIcon');
        if (playIcon) {
            playIcon.className = 'fas fa-play';
        }

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

        const currentTimeEl = document.getElementById('currentTime');
        if (currentTimeEl) {
            currentTimeEl.textContent = this.formatTime(this.currentTime);
        }
    }

    updateDuration() {
        const durationEl = document.getElementById('totalDuration');
        if (durationEl) {
            durationEl.textContent = this.formatTime(this.duration);
        }
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

    applyAutoFade() {
        const voiceTracks = this.tracks.filter(t => t.type === 'voice' && t.audioBuffer);
        const musicTracks = this.tracks.filter(t => t.type === 'music' && t.audioBuffer);

        if (voiceTracks.length === 0 || musicTracks.length === 0) {
            this.showNotification('Adicione pelo menos uma voz e uma trilha', 'warning');
            return;
        }

        // Apply fade out to music tracks (1.05 seconds before voice ends)
        musicTracks.forEach(track => {
            this.updateTrackFadeOut(track.id, 1.05);
        });

        this.showNotification('Auto fade aplicado (1.05s)', 'success');
    }

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
        const JANELA = 0.03;      // 30ms — resolução da análise
        const HOLD = 0.30;        // junta trechos separados por menos que isso
        const segmentos = [];

        for (const track of voiceTracks) {
            const buf = track.audioBuffer;
            if (!buf) continue;
            const sr = buf.sampleRate;
            const passo = Math.max(1, Math.floor(JANELA * sr));
            const dados = buf.getChannelData(0);

            // RMS por janela + pico, pra calibrar o limiar na gravação real
            // (locução baixinha e locução alta precisam do mesmo comportamento).
            const rms = [];
            let pico = 0;
            for (let i = 0; i < dados.length; i += passo) {
                let soma = 0;
                const fim = Math.min(i + passo, dados.length);
                for (let j = i; j < fim; j++) soma += dados[j] * dados[j];
                const v = Math.sqrt(soma / Math.max(1, fim - i));
                rms.push(v);
                if (v > pico) pico = v;
            }

            // Piso ABSOLUTO antes do limiar relativo. Sem ele, uma faixa que só
            // tem ruído de fundo (pico ~-60dBFS) passaria no "8% do próprio pico"
            // e a trilha ficaria abaixada o spot inteiro sem ninguém falando.
            // 0.003 ≈ -50 dBFS: bem abaixo de qualquer locução real.
            if (pico < 0.003) continue;

            const limiar = pico * 0.08;              // 8% do pico = tem voz
            let inicio = null;
            for (let k = 0; k < rms.length; k++) {
                const temVoz = rms[k] >= limiar;
                if (temVoz && inicio === null) inicio = k * JANELA;
                if (!temVoz && inicio !== null) {
                    segmentos.push([inicio, k * JANELA]);
                    inicio = null;
                }
            }
            if (inicio !== null) segmentos.push([inicio, rms.length * JANELA]);
        }

        if (!segmentos.length) return [];

        // Une trechos próximos (respiradas curtas não devem soltar a trilha).
        segmentos.sort((a, b) => a[0] - b[0]);
        const unidos = [segmentos[0].slice()];
        for (let i = 1; i < segmentos.length; i++) {
            const ult = unidos[unidos.length - 1];
            if (segmentos[i][0] - ult[1] <= HOLD) {
                ult[1] = Math.max(ult[1], segmentos[i][1]);
            } else {
                unidos.push(segmentos[i].slice());
            }
        }
        return unidos;
    }

    // Escreve a automação de ganho da trilha a partir dos trechos de voz.
    // `nivel` é o volume normal da faixa (0..1); devolve true se ducou algo.
    //
    // `offset` existe porque os dois caminhos usam bases de tempo diferentes:
    // o export (OfflineAudioContext) agenda a partir de 0, e o playback agenda a
    // partir de audioContext.currentTime. Sem o offset, o ducking no preview
    // cairia todo no passado e não aconteceria nada.
    aplicarDucking(gainParam, trechos, nivel, ateQuando, offset = 0) {
        const ATTACK = 0.08, RELEASE = 0.45;
        if (!trechos.length) return false;
        const abaixado = nivel * this.duckGain;

        // NÃO ancora em t=0: quem cuida do início é o fade-in do chamador (mexer
        // aqui criaria dois eventos no mesmo instante e brigaria com ele).
        for (const [ini, fim] of trechos) {
            if (ini >= ateQuando) break;
            const t0 = Math.max(0, ini - ATTACK);
            const t1 = Math.min(fim, ateQuando);
            if (t0 > 0) gainParam.setValueAtTime(nivel, offset + t0);
            gainParam.linearRampToValueAtTime(abaixado, offset + Math.min(ini, ateQuando));
            gainParam.setValueAtTime(abaixado, offset + t1);   // segura embaixo
            // Release NÃO é cortado em `ateQuando`: no último trecho isso criaria
            // dois eventos no mesmo instante e a trilha saltaria do valor abaixado
            // pra cheia de uma vez (clique). Deixando passar, ela sobe suave e o
            // fade final leva a zero por cima.
            gainParam.linearRampToValueAtTime(nivel, offset + t1 + RELEASE);
        }
        return true;
    }

    async exportMix() {
        const tracksWithAudio = this.tracks.filter(t => t.audioBuffer);
        if (tracksWithAudio.length === 0) {
            this.showNotification('Adicione arquivos de áudio primeiro', 'warning');
            return;
        }

        this.showMixingStatus(true);
        this.updateMixingProgress(0, 'Preparando mixagem...');

        try {
            // Encontra a track de voz mais longa
            const voiceTracks = tracksWithAudio.filter(t => t.type === 'voice');
            let maxVoiceDuration = 0;
            let finalDuration = this.duration;
            
            if (voiceTracks.length > 0) {
                maxVoiceDuration = voiceTracks.reduce((max, track) => Math.max(max, track.duration), 0);
                finalDuration = maxVoiceDuration + 1.05;
            }

            // Create offline audio context for rendering
            const offlineContext = new OfflineAudioContext(
                2, // stereo
                finalDuration * this.audioContext.sampleRate,
                this.audioContext.sampleRate
            );

            // Create master gain
            const masterGain = offlineContext.createGain();
            masterGain.connect(offlineContext.destination);

            // Mix all tracks
            for (let i = 0; i < tracksWithAudio.length; i++) {
                const track = tracksWithAudio[i];
                this.updateMixingProgress((i / tracksWithAudio.length) * 80, `Processando ${track.name}...`);

                // Create source
                const source = offlineContext.createBufferSource();
                source.buffer = track.audioBuffer;

                // Build effect chain
                // 1. High-pass filter
                const hpfNode = offlineContext.createBiquadFilter();
                hpfNode.type = 'highpass';
                if (track.effects.hpf) {
                    hpfNode.frequency.value = 80;
                } else {
                    hpfNode.frequency.value = 10; // Bypass
                }
                
                // 2. EQ
                const eqNode = offlineContext.createBiquadFilter();
                eqNode.type = 'peaking';
                eqNode.frequency.value = 1000;
                eqNode.gain.value = track.effects.eq ? (track.eqSettings?.mid || 0) : 0;
                eqNode.Q.value = 1;
                
                // 3. Presence
                const presenceNode = offlineContext.createBiquadFilter();
                presenceNode.type = 'highshelf';
                presenceNode.frequency.value = 4000;
                presenceNode.gain.value = track.effects.presence ? 4 : 0;

                // 4. Compressor
                const compressorNode = offlineContext.createDynamicsCompressor();
                compressorNode.threshold.value = track.effects.compressor ? -24 : 0;
                compressorNode.knee.value = 30;
                compressorNode.ratio.value = 12;
                compressorNode.attack.value = 0.003;
                compressorNode.release.value = 0.25;
                
                // 5. Limiter
                const limiterNode = offlineContext.createDynamicsCompressor();
                if (track.effects.limiter) {
                    limiterNode.threshold.value = -6;
                    limiterNode.knee.value = 0;
                    limiterNode.ratio.value = 20;
                    limiterNode.attack.value = 0.001;
                    limiterNode.release.value = 0.1;
                } else {
                    limiterNode.threshold.value = 0;
                    limiterNode.ratio.value = 1; // Bypass
                }

                // 6. Reverb
                const reverbNode = offlineContext.createConvolver();
                const sampleRate = offlineContext.sampleRate;
                const length = sampleRate * 2;
                const impulse = offlineContext.createBuffer(2, length, sampleRate);
                for (let channel = 0; channel < 2; channel++) {
                    const channelData = impulse.getChannelData(channel);
                    for (let j = 0; j < length; j++) {
                        channelData[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / length, 2);
                    }
                }
                reverbNode.buffer = impulse;
                reverbNode.normalize = true;

                const reverbGain = offlineContext.createGain();
                reverbGain.gain.value = track.effects.reverb ? 0.3 : 0;

                const trackGain = offlineContext.createGain();
                trackGain.gain.value = track.volume / 100;

                const pan = offlineContext.createStereoPanner();
                pan.pan.value = track.pan;

                // Apply fades
                let currentTime = 0;
                if (track.fadeIn > 0) {
                    trackGain.gain.setValueAtTime(0, currentTime);
                    trackGain.gain.linearRampToValueAtTime(track.volume / 100, track.fadeIn);
                } else {
                    trackGain.gain.setValueAtTime(track.volume / 100, currentTime);
                }

                // Apply fade out (manual or auto)
                if (track.type === 'music' && voiceTracks.length > 0) {
                    // Auto fade-out for music tracks
                    // DUCKING: abaixa a trilha nos trechos com voz e devolve o
                    // volume nas pausas. Antes ficava no volume cheio a locução
                    // inteira e só caía no fade final — voz e música competindo.
                    const trechosDeVoz = this.detectarTrechosDeVoz(voiceTracks);
                    const ducou = this.aplicarDucking(
                        trackGain.gain, trechosDeVoz, track.volume / 100, maxVoiceDuration
                    );
                    if (!ducou) {
                        // Sem voz detectada (faixa muda?) — comportamento antigo.
                        trackGain.gain.linearRampToValueAtTime(
                            track.volume / 100,
                            maxVoiceDuration
                        );
                    }
                    // Fade final continua igual: some 1.05s depois do fim da voz.
                    trackGain.gain.linearRampToValueAtTime(
                        0,
                        maxVoiceDuration + 1.05
                    );
                } else {
                    // Manual fade out
                    if (track.fadeOut > 0) {
                        const fadeOutStart = track.duration - track.fadeOut;
                        trackGain.gain.linearRampToValueAtTime(
                            track.volume / 100,
                            fadeOutStart
                        );
                        trackGain.gain.linearRampToValueAtTime(
                            0,
                            track.duration
                        );
                    }
                }

                // Connect the entire chain
                source.connect(hpfNode);
                hpfNode.connect(eqNode);
                eqNode.connect(presenceNode);
                presenceNode.connect(compressorNode);
                compressorNode.connect(limiterNode);
                limiterNode.connect(trackGain);
                limiterNode.connect(reverbNode);
                reverbNode.connect(reverbGain);
                reverbGain.connect(trackGain);
                trackGain.connect(pan);
                pan.connect(masterGain);

                // Start source
                source.start(0);
            }

            this.updateMixingProgress(90, 'Renderizando áudio...');

            // Render
            const renderedBuffer = await offlineContext.startRendering();

            this.updateMixingProgress(95, 'Convertendo formato...');

            // Convert to desired format
            let blob;
            let filename;
            
            if (this.exportFormat === 'wav') {
                blob = this.bufferToWav(renderedBuffer);
                filename = `mix_${Date.now()}.wav`;
            } else {
                blob = await this.bufferToMp3(renderedBuffer);
                filename = `mix_${Date.now()}.mp3`;
            }

            this.updateMixingProgress(100, 'Concluído!');

            // Download
            this.downloadBlob(blob, filename);

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
        const length = buffer.length * buffer.numberOfChannels * 2;
        const arrayBuffer = new ArrayBuffer(44 + length);
        const view = new DataView(arrayBuffer);
        const channels = [];
        let offset = 0;
        let pos = 0;

        // Write WAV header
        const setUint16 = (data) => {
            view.setUint16(pos, data, true);
            pos += 2;
        };
        const setUint32 = (data) => {
            view.setUint32(pos, data, true);
            pos += 4;
        };

        // RIFF identifier
        setUint32(0x46464952);
        // file length
        setUint32(36 + length);
        // WAVE identifier
        setUint32(0x45564157);
        // fmt chunk identifier
        setUint32(0x20746d66);
        // chunk length
        setUint32(16);
        // sample format (PCM)
        setUint16(1);
        // channel count
        setUint16(buffer.numberOfChannels);
        // sample rate
        setUint32(buffer.sampleRate);
        // byte rate
        setUint32(buffer.sampleRate * buffer.numberOfChannels * 2);
        // block align
        setUint16(buffer.numberOfChannels * 2);
        // bits per sample
        setUint16(16);
        // data chunk identifier
        setUint32(0x61746164);
        // data chunk length
        setUint32(length);

        // Write interleaved data
        for (let i = 0; i < buffer.numberOfChannels; i++) {
            channels.push(buffer.getChannelData(i));
        }

        while (offset < buffer.length) {
            for (let i = 0; i < buffer.numberOfChannels; i++) {
                let sample = Math.max(-1, Math.min(1, channels[i][offset]));
                sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
                view.setInt16(pos, sample, true);
                pos += 2;
            }
            offset++;
        }

        return new Blob([arrayBuffer], { type: 'audio/wav' });
    }

    async bufferToMp3(buffer) {
        // This is a simplified MP3 conversion
        // In production, you'd use a proper MP3 encoder library
        const wavBlob = this.bufferToWav(buffer);
        return wavBlob; // For now, return WAV as MP3 placeholder
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

    updateTrackUI(track) {
        const trackCard = document.getElementById(`track_${track.id}`);
        if (!trackCard) return;

        // Recreate the track card with audio loaded
        const newCard = document.createElement('div');
        newCard.className = 'track-card';
        newCard.id = `track_${track.id}`;
        
        // This would recreate the track UI with the audio loaded
        // For simplicity, we'll just update the existing card
        this.createTrackUI(track);
        
        // Remove old card
        const oldCard = document.getElementById(`track_${track.id}`);
        if (oldCard && oldCard !== newCard) {
            oldCard.remove();
        }
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

            // Create selection dialog
            const selectedFiles = files.slice(0, 5); // Limit to 5 most recent
            let loadedCount = 0;
            
            for (const fileInfo of selectedFiles) {
                try {
                    const audioResponse = await fetch(`/api/download/${fileInfo.filename}`);
                    if (!audioResponse.ok) {
                        throw new Error(`Failed to download ${fileInfo.filename}`);
                    }
                    
                    const blob = await audioResponse.blob();
                    this.addTrack('voice');
                    const trackId = this.tracks[this.tracks.length - 1].id;
                    const file = new File([blob], fileInfo.filename, { type: 'audio/wav' });
                    await this.loadAudioFile(file, trackId);
                    loadedCount++;
                } catch (error) {
                    console.error(`Error loading ${fileInfo.filename}:`, error);
                }
            }

            this.showNotification(`${loadedCount} de ${selectedFiles.length} áudios importados do TTS`, loadedCount > 0 ? 'success' : 'warning');
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
    toggleScissorMode() {
        this.scissorMode = !this.scissorMode;
        const scissorBtn = document.getElementById('scissorBtn');
        if (scissorBtn) {
            scissorBtn.classList.toggle('active', this.scissorMode);
            scissorBtn.classList.toggle('scissor-mode', this.scissorMode);
        }
        
        // Update cursor on all waveforms
        document.querySelectorAll('.waveform-container').forEach(waveform => {
            waveform.style.cursor = this.scissorMode ? 'crosshair' : 'default';
        });
        
        this.showNotification(
            this.scissorMode ? 'Modo tesoura ativado (C para desativar)' : 'Modo tesoura desativado',
            this.scissorMode ? 'info' : 'success'
        );
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

            // Atualiza UI
            this.updateUI();
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
window.saveVipProject = () => minidaw.saveVipProject();
window.loadVipProject = () => minidaw.loadVipProject();

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
        const payload = {
            tracks: comAudio.map(t => ({ type: t.type, name: t.name, duration: t.duration || 0 }))
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
        alert('🎚️ Receita aplicada em ' + aplicadas + ' faixa(s)!\n\n' + (result.resumo || '') + '\n\nÉ só dar play e refinar o que quiser.');
    } catch (error) {
        console.error('Erro ao incorporar receita:', error);
        alert('Erro ao montar a receita: ' + error.message);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = original; }
    }
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
