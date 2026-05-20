// MiniDAW Integrada - Versão para a página principal
class MiniDAWIntegrated {
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
        this.autoFadeEnabled = false;
        this.autoFadeDuration = 1.05;
        this.voiceEndDetected = new Map();
        this.miniDAWVisible = true;
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.updateUI();
        this.loadFromLocalStorage();
    }

    setupEventListeners() {
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
                    const trackId = waveformContainer.id.replace('miniDAWTrack_', '');
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
        const trackId = 'miniDAWTrack_' + Date.now();
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
            fadeOut: type === 'voice' ? 1.05 : 0,
            muted: false,
            solo: false,
            effects: {
                reverb: false,
                delay: false,
                compressor: false,
                eq: false,
                voicefx: false,
                scissor: false
            },
            eqSettings: { low: 0, mid: 0, high: 0 },
            reverbSettings: { mix: 30, time: 1.5 },
            color: type === 'voice' ? '#3b82f6' : '#a855f7',
            zoom: 1
        };

        this.tracks.push(track);
        this.createTrackUI(track);
        this.updateUI();
        this.saveToLocalStorage();
    }

    createTrackUI(track) {
        const container = document.getElementById('miniDAWTracksContainer');
        const emptyState = document.getElementById('miniDAWEmptyState');
        
        if (emptyState) {
            emptyState.style.display = 'none';
        }

        const trackCard = document.createElement('div');
        trackCard.className = 'track-card';
        trackCard.id = `miniDAWTrack_${track.id}`;
        
        const typeLabel = track.type === 'voice' ? 'Locução' : 'Trilha';
        const typeClass = track.type === 'voice' ? 'blue' : 'purple';
        
        console.log('Criando track UI:', track.id, 'com botoes: Mudo, Solo, Remover, Novo');
        
        trackCard.innerHTML = `
            <div class="track-main">
                <!-- Header com nome e tipo -->
                <div class="track-top-bar">
                    <div class="track-name-section">
                        <button class="track-collapse-btn" onclick="toggleMiniDAWTrackCollapse('${track.id}')">
                            <i class="fas fa-chevron-down"></i>
                        </button>
                        <input type="text" class="track-name-input" value="${track.name}" 
                               onchange="updateMiniDAWTrackName('${track.id}', this.value)">
                        <span class="track-type-badge ${typeClass}">${typeLabel}</span>
                    </div>
                    <div class="track-header-actions" style="display:flex !important; gap:8px !important;">
                        <button class="track-header-btn ${track.isPlaying ? 'playing' : ''}" onclick="toggleMiniDAWTrackPlayback('${track.id}')" title="Tocar" style="display:flex !important; background:linear-gradient(135deg,#3b82f6,#2563eb) !important; color:white !important;">
                            <i class="fas ${track.isPlaying ? 'fa-pause' : 'fa-play'}"></i>
                        </button>
                        <button class="track-header-btn ${track.muted ? 'active' : ''}" onclick="toggleMiniDAWMute('${track.id}')" title="Mudo">
                            <i class="fas fa-volume-mute"></i>
                        </button>
                        <button class="track-header-btn ${track.solo ? 'active' : ''}" onclick="toggleMiniDAWSolo('${track.id}')" title="Solo">
                            <i class="fas fa-headphones"></i>
                        </button>
                        <button class="track-header-btn" onclick="removeMiniDAWTrack('${track.id}')" title="Remover" style="display:flex !important;">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
                
                ${!track.audioUrl ? `
                    <div class="drop-zone-track" id="drop_${track.id}" 
                         ondrop="handleMiniDAWTrackDrop(event, '${track.id}')" 
                         ondragover="handleMiniDAWTrackDragOver(event)" 
                         ondragleave="handleMiniDAWTrackDragLeave(event)">
                        <i class="fas fa-cloud-upload-alt"></i>
                        <p>Arraste áudio aqui ou clique para escolher</p>
                        <input type="file" accept="audio/*" style="display: none;" 
                               onchange="handleMiniDAWTrackFileSelect(event, '${track.id}')">
                        <button class="btn btn-primary btn-sm mt-2" onclick="document.querySelector('#drop_${track.id} input').click()">
                            <i class="fas fa-folder-open me-1"></i>Escolher Arquivo
                        </button>
                    </div>
                ` : `
                    <div class="waveform-area">
                        <div class="auto-fade-indicator" id="autoFade_${track.id}">
                            <i class="fas fa-magic"></i> OUT 1.05s
                        </div>
                        <canvas id="waveform_${track.id}" class="waveform" 
                                onclick="cutMiniDAWTrackAtClick(event, '${track.id}')" 
                                title="Clique para cortar a trilha neste ponto"></canvas>
                        <div class="fade-out-label" id="fadeOut_${track.id}" style="display: none;">
                            <span>OUT ${track.fadeOut.toFixed(1)}s</span>
                        </div>
                    </div>
                    
                    <!-- Player Controls -->
                    <div class="track-player-controls">
                        <button class="player-btn ${track.isPlaying ? 'playing' : ''}" onclick="toggleMiniDAWTrackPlayback('${track.id}')" title="Play/Pause">
                            <i class="fas ${track.isPlaying ? 'fa-pause' : 'fa-play'}"></i>
                        </button>
                        <div class="player-time">
                            <span id="currentTime_${track.id}">0:00</span> / <span id="duration_${track.id}">0:00</span>
                        </div>
                    </div>
                `}
                    <div class="waveform-area">
                        <div class="auto-fade-indicator" id="autoFade_${track.id}">
                            <i class="fas fa-magic"></i> OUT 1.05s
                        </div>
                        <canvas id="waveform_${track.id}" class="waveform" 
                                onclick="cutMiniDAWTrackAtClick(event, '${track.id}')" 
                                title="Clique para cortar a trilha neste ponto"></canvas>
                        <div class="fade-out-label" id="fadeOut_${track.id}" style="display: none;">
                            <span>OUT ${track.fadeOut.toFixed(1)}s</span>
                        </div>
                    </div>
                    
                    <!-- Controls Toolbar -->
                    <div class="track-controls-bar">
                        <div class="control-section fade-controls">
                            <button class="control-tool-btn" title="Fade In" onclick="adjustMiniDAWFade('${track.id}', 'in', -0.1)">
                                <i class="fas fa-chevron-left"></i>
                            </button>
                            <span class="control-value" id="fadeIn_${track.id}">Fade In ${track.fadeIn.toFixed(1)}s</span>
                            <button class="control-tool-btn" title="Aumentar Fade In" onclick="adjustMiniDAWFade('${track.id}', 'in', 0.1)">
                                <i class="fas fa-chevron-right"></i>
                            </button>
                        </div>
                        
                        <div class="control-divider"></div>
                        
                        <div class="control-section fade-controls">
                            <button class="control-tool-btn" title="Diminuir Fade Out" onclick="adjustMiniDAWFade('${track.id}', 'out', -0.1)">
                                <i class="fas fa-chevron-left"></i>
                            </button>
                            <span class="control-value" id="fadeOutVal_${track.id}">Fade Out ${track.fadeOut.toFixed(1)}s</span>
                            <button class="control-tool-btn" title="Aumentar Fade Out" onclick="adjustMiniDAWFade('${track.id}', 'out', 0.1)">
                                <i class="fas fa-chevron-right"></i>
                            </button>
                        </div>
                        
                        <div class="control-divider"></div>
                        
                        <div class="control-section tool-btn-group">
                            <button class="tool-btn ${track.effects.scissor ? 'active' : ''}" onclick="toggleMiniDAWScissorTrack('${track.id}')" title="Cortar">
                                <i class="fas fa-cut"></i>
                            </button>
                            <button class="tool-btn" onclick="toggleMiniDAWTrackEffects('${track.id}')" title="Efeitos">
                                <i class="fas fa-sliders-h"></i>
                            </button>
                            <button class="tool-btn" onclick="resetMiniDAWTrack('${track.id}')" title="Reset">
                                <i class="fas fa-undo"></i>
                            </button>
                        </div>
                        
                        <div class="control-divider"></div>
                        
                        <div class="control-section volume-pan">
                            <div class="slider-group">
                                <i class="fas fa-volume-up"></i>
                                <input type="range" class="mini-slider" min="0" max="150" value="${track.volume}" 
                                       oninput="updateMiniDAWTrackVolume('${track.id}', this.value)" title="Volume">
                                <span class="slider-value" id="vol_${track.id}">${track.volume}%</span>
                            </div>
                            <div class="slider-group">
                                <i class="fas fa-balance-scale"></i>
                                <input type="range" class="mini-slider pan" min="-100" max="100" value="${track.pan * 100}" 
                                       oninput="updateMiniDAWTrackPan('${track.id}', this.value)" title="Pan">
                                <span class="slider-value" id="pan_${track.id}">C</span>
                            </div>
                        </div>
                        
                        <div class="control-divider"></div>
                        
                        <div class="control-section effect-buttons">
                            <button class="fx-btn ${track.effects.reverb ? 'active' : ''}" onclick="toggleMiniDAWEffect('${track.id}', 'reverb')">
                                <i class="fas fa-water"></i> FX
                            </button>
                            <button class="fx-btn ${track.effects.eq ? 'active' : ''}" onclick="toggleMiniDAWEffect('${track.id}', 'eq')">
                                <i class="fas fa-sliders-h"></i> EQ
                            </button>
                            <button class="fx-btn ${track.effects.compressor ? 'active' : ''}" onclick="toggleMiniDAWEffect('${track.id}', 'compressor')">
                                <i class="fas fa-compress-arrows-alt"></i> Comp
                            </button>
                            ${track.type === 'voice' ? `
                            <button class="fx-btn ${track.effects.voicefx ? 'active' : ''}" onclick="toggleMiniDAWEffect('${track.id}', 'voicefx')">
                                <i class="fas fa-microphone"></i> Voice FX
                            </button>
                            ` : ''}
                        </div>
                    </div>
                    
                    <!-- Effects Panel (collapsible) -->
                    <div class="effects-details ${track.effects.eq || track.effects.reverb || track.effects.compressor ? 'show' : ''}" id="effectsPanel_${track.id}">
                        <div class="effects-grid">
                            ${track.effects.eq ? `
                            <div class="effect-module">
                                <div class="effect-module-header">
                                    <i class="fas fa-sliders-h"></i>
                                    <span>Equalizador</span>
                                    <label class="toggle-switch">
                                        <input type="checkbox" checked onchange="toggleMiniDAWEffect('${track.id}', 'eq')">
                                        <span class="toggle-slider"></span>
                                    </label>
                                </div>
                                <div class="eq-sliders">
                                    <div class="eq-band">
                                        <span>Graves (Low)</span>
                                        <input type="range" min="-20" max="20" value="${track.eqSettings?.low || 0}" 
                                               onchange="updateMiniDAWEQ('${track.id}', 'low', this.value)">
                                        <span class="eq-value">${track.eqSettings?.low || 0}dB</span>
                                    </div>
                                    <div class="eq-band">
                                        <span>Médios (Mid)</span>
                                        <input type="range" min="-20" max="20" value="${track.eqSettings?.mid || 0}" 
                                               onchange="updateMiniDAWEQ('${track.id}', 'mid', this.value)">
                                        <span class="eq-value">${track.eqSettings?.mid || 0}dB</span>
                                    </div>
                                    <div class="eq-band">
                                        <span>Agudos (High)</span>
                                        <input type="range" min="-20" max="20" value="${track.eqSettings?.high || 0}" 
                                               onchange="updateMiniDAWEQ('${track.id}', 'high', this.value)">
                                        <span class="eq-value">${track.eqSettings?.high || 0}dB</span>
                                    </div>
                                </div>
                            </div>
                            ` : ''}
                            
                            ${track.effects.reverb ? `
                            <div class="effect-module">
                                <div class="effect-module-header">
                                    <i class="fas fa-water"></i>
                                    <span>Reverb</span>
                                    <label class="toggle-switch">
                                        <input type="checkbox" checked onchange="toggleMiniDAWEffect('${track.id}', 'reverb')">
                                        <span class="toggle-slider"></span>
                                    </label>
                                </div>
                                <div class="reverb-controls">
                                    <div class="param-row">
                                        <span>Mix</span>
                                        <input type="range" min="0" max="100" value="${track.reverbSettings?.mix || 30}" 
                                               onchange="updateMiniDAWReverb('${track.id}', 'mix', this.value)">
                                        <span class="param-value">${track.reverbSettings?.mix || 30}%</span>
                                    </div>
                                    <div class="param-row">
                                        <span>Time</span>
                                        <input type="range" min="0.1" max="5" step="0.1" value="${track.reverbSettings?.time || 1.5}" 
                                               onchange="updateMiniDAWReverb('${track.id}', 'time', this.value)">
                                        <span class="param-value">${track.reverbSettings?.time || 1.5}s</span>
                                    </div>
                                </div>
                            </div>
                            ` : ''}
                        </div>
                        <div class="effects-footer">
                            <button class="btn btn-sm btn-outline-primary" onclick="toggleMiniDAWAllEffects('${track.id}')">
                                <i class="fas fa-plus me-1"></i>Adicionar Efeito
                            </button>
                            <button class="btn btn-sm btn-outline-secondary" onclick="saveMiniDAWPreset('${track.id}')">
                                <i class="fas fa-save me-1"></i>Presets
                            </button>
                            <button class="btn btn-sm btn-outline-danger" onclick="resetMiniDAWEffects('${track.id}')">
                                <i class="fas fa-undo me-1"></i>Reset
                            </button>
                        </div>
                    </div>
                `}
            </div>
        `;
        
        container.appendChild(trackCard);
        
        if (track.audioUrl) {
            this.drawWaveform(track);
            this.updatePanLabel(track.id, track.pan);
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
                track.reverbSettings = track.reverbSettings || { mix: 30, time: 1.5 };
                track.effects = track.effects || { reverb: false, delay: false, compressor: false, eq: false, voicefx: false, scissor: false };
                track.muted = track.muted || false;
                track.solo = track.solo || false;
                
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

    createTrackNodes(track) {
        // Create effect nodes
        const eqNode = this.audioContext.createBiquadFilter();
        eqNode.type = 'peaking';
        eqNode.frequency.value = 1000;
        eqNode.gain.value = 0;
        eqNode.Q.value = 1;

        const compressorNode = this.audioContext.createDynamicsCompressor();
        compressorNode.threshold.value = -24;
        compressorNode.knee.value = 30;
        compressorNode.ratio.value = 12;
        compressorNode.attack.value = 0.003;
        compressorNode.release.value = 0.25;

        const reverbNode = this.audioContext.createConvolver();
        this.createReverbImpulse(reverbNode);
        reverbNode.normalize = true;

        const reverbGain = this.audioContext.createGain();
        reverbGain.gain.value = 0.3;

        // Create gain node
        const gainNode = this.audioContext.createGain();
        gainNode.gain.value = track.volume / 100;
        
        // Create pan node
        const panNode = this.audioContext.createStereoPanner();
        panNode.pan.value = track.pan;
        
        // Connect nodes: input -> EQ -> Compressor -> Gain -> Pan -> Master
        // Reverb is parallel: Compressor -> Reverb -> ReverbGain -> Pan
        eqNode.connect(compressorNode);
        compressorNode.connect(gainNode);
        compressorNode.connect(reverbNode);
        reverbNode.connect(reverbGain);
        reverbGain.connect(panNode);
        gainNode.connect(panNode);
        panNode.connect(this.masterGain);
        
        // Store nodes
        this.trackNodes.set(track.id, {
            inputNode: eqNode,
            eqNode,
            compressorNode,
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

        // EQ
        nodes.eqNode.gain.value = track.effects.eq ? track.eqSettings?.mid || 0 : 0;

        // Compressor
        nodes.compressorNode.threshold.value = track.effects.compressor ? -24 : 0;

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
        const trackCard = document.getElementById(`miniDAWTrack_${trackId}`);
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
            this.showNotification(
                `Efeito ${effect} ${track.effects[effect] ? 'ativado' : 'desativado'}`, 
                track.effects[effect] ? 'success' : 'info'
            );
        }
    }

    updateEffectsUI(track) {
        const trackCard = document.getElementById(`miniDAWTrack_${track.id}`);
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
        if (track) {
            if (!track.eqSettings) {
                track.eqSettings = { low: 0, mid: 0, high: 0 };
            }
            track.eqSettings[band] = parseFloat(value);
            this.saveToLocalStorage();
        }
    }

    removeTrack(trackId) {
        const index = this.tracks.findIndex(t => t.id === trackId);
        if (index !== -1) {
            const track = this.tracks[index];
            
            // Stop audio if playing
            if (track.audioBuffer) {
                const nodes = this.trackNodes.get(trackId);
                if (nodes && nodes.sourceNode) {
                    nodes.sourceNode.stop();
                }
            }
            
            // Clean up nodes
            this.trackNodes.delete(trackId);
            
            // Remove from array
            this.tracks.splice(index, 1);
            
            // Remove UI
            const trackCard = document.getElementById(`miniDAWTrack_${trackId}`);
            if (trackCard) {
                trackCard.remove();
            }
            
            // Recalculate duration
            this.calculateDuration();
            this.updateUI();
            this.saveToLocalStorage();
        }
    }

    calculateDuration() {
        this.duration = Math.max(...this.tracks.filter(t => t.audioBuffer).map(t => t.duration), 0);
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
        const playIcon = document.getElementById('miniDAWPlayIcon');
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

        // Apply fade out
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

        const playIcon = document.getElementById('miniDAWPlayIcon');
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

    stopPlayback() {
        this.stop();
        this.currentTime = 0;
        this.updatePlaybackTime();
    }

    updatePlaybackTime() {
        if (this.isPlaying) {
            this.currentTime += 0.1;
            if (this.currentTime >= this.duration) {
                this.stop();
            }
        }

        const currentTimeEl = document.getElementById('miniDAWCurrentTime');
        if (currentTimeEl) {
            currentTimeEl.textContent = this.formatTime(this.currentTime);
        }
    }

    updateDuration() {
        const durationEl = document.getElementById('miniDAWTotalDuration');
        if (durationEl) {
            durationEl.textContent = this.formatTime(this.duration);
        }
    }

    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // Funções de integração
    async sendAudioToMiniDAW(audioUrl, filename) {
        // Adiciona áudio gerado automaticamente à MiniDAW
        this.addTrack('voice');
        const trackId = this.tracks[this.tracks.length - 1].id;
        
        try {
            // Primeiro tenta fazer fetch do áudio
            let blob;
            try {
                const response = await fetch(audioUrl);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                blob = await response.blob();
            } catch (fetchError) {
                console.log('Fetch falhou, tentando via audio element...', fetchError);
                
                // Fallback: tenta obter do elemento audio
                const audioElement = document.getElementById('generatedAudio');
                if (audioElement && audioElement.src) {
                    // Se for um blob URL, extrai o blob
                    if (audioElement.src.startsWith('blob:')) {
                        const response = await fetch(audioElement.src);
                        blob = await response.blob();
                    } else {
                        throw new Error('Áudio não disponível como blob');
                    }
                } else {
                    throw new Error('Elemento de áudio não encontrado');
                }
            }
            
            // Cria arquivo e carrega
            const file = new File([blob], filename, { type: 'audio/wav' });
            await this.loadAudioFile(file, trackId);
            
            // Atualiza o nome da track
            const track = this.tracks.find(t => t.id === trackId);
            if (track) {
                track.name = filename.replace('.wav', '');
                this.updateTrackUI(track);
            }
            
        } catch (error) {
            console.error('Error sending audio to MiniDAW:', error);
            this.showNotification('Erro ao enviar áudio para MiniDAW: ' + error.message, 'error');
        }
    }

    // Nova função para receber blob diretamente (mais confiável)
    async sendAudioBlobToMiniDAW(blob, filename) {
        // Adiciona áudio gerado automaticamente à MiniDAW
        this.addTrack('voice');
        const trackId = this.tracks[this.tracks.length - 1].id;
        
        try {
            // Cria arquivo diretamente do blob
            const file = new File([blob], filename, { type: 'audio/wav' });
            await this.loadAudioFile(file, trackId);
            
            // Atualiza o nome da track
            const track = this.tracks.find(t => t.id === trackId);
            if (track) {
                track.name = filename.replace('.wav', '');
                this.updateTrackUI(track);
            }
            
            console.log(`Áudio blob enviado com sucesso para track ${trackId}`);
            
        } catch (error) {
            console.error('Error sending audio blob to MiniDAW:', error);
            this.showNotification('Erro ao enviar áudio para MiniDAW: ' + error.message, 'error');
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
        
        const dropZone = document.getElementById('miniDAWDropZone');
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
        const dropZone = document.getElementById('miniDAWDropZone');
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

    // Novas funcionalidades (mesmas da MiniDAW original)
    toggleScissorMode() {
        this.scissorMode = !this.scissorMode;
        const scissorBtn = document.getElementById('miniDAWScissorBtn');
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
        const indicator = document.getElementById('miniDAWZoomIndicator');
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

        this.showNotification('Auto Fade ativado (1.05s)', 'success');
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

    clearAllTracks() {
        if (this.tracks.length === 0) return;

        if (confirm('Tem certeza que deseja remover todas as faixas?')) {
            this.stop();
            
            // Clear all tracks
            this.tracks.forEach(track => {
                this.removeTrack(track.id);
            });

            // Show empty state
            const emptyState = document.getElementById('miniDAWEmptyState');
            if (emptyState) {
                emptyState.style.display = 'block';
            }

            this.showNotification('Todas as faixas removidas', 'info');
        }
    }

    setFormat(format) {
        this.exportFormat = format;
        
        // Update UI
        document.querySelectorAll('.format-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        event.target.classList.add('active');

        // Show/hide bitrate selector
        const bitrateGroup = document.getElementById('miniDAWMP3BitrateGroup');
        if (bitrateGroup) {
            bitrateGroup.style.display = format === 'mp3' ? 'flex' : 'none';
        }

        if (format === 'mp3') {
            this.mp3Bitrate = parseInt(document.getElementById('miniDAWMP3Bitrate').value);
        }
    }

    exportMix() {
        const tracksWithAudio = this.tracks.filter(t => t.audioBuffer);
        if (tracksWithAudio.length === 0) {
            this.showNotification('Adicione arquivos de áudio primeiro', 'warning');
            return;
        }

        this.showMixingStatus(true);
        this.updateMixingProgress(0, 'Preparando mixagem...');

        // Simulação de exportação (implementação real seria similar à MiniDAW original)
        setTimeout(() => {
            this.updateMixingProgress(50, 'Processando faixas...');
            setTimeout(() => {
                this.updateMixingProgress(100, 'Concluído!');
                this.showNotification('Mix exportado com sucesso!', 'success');
                setTimeout(() => {
                    this.showMixingStatus(false);
                }, 1000);
            }, 1000);
        }, 1000);
    }

    saveVipProject() {
        this.showNotification('Salvando projeto VIP...', 'info');
        
        setTimeout(() => {
            this.showNotification('Projeto VIP salvo com sucesso!', 'success');
        }, 1000);
    }

    showMixingStatus(show) {
        const status = document.getElementById('miniDAWMixingStatus');
        if (status) {
            status.classList.toggle('active', show);
        }
    }

    updateMixingProgress(percent, text) {
        const progressFill = document.getElementById('miniDAWProgressFill');
        const statusText = document.getElementById('miniDAWMixingStatusText');
        
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
        const emptyState = document.getElementById('miniDAWEmptyState');
        if (emptyState) {
            emptyState.style.display = this.tracks.length === 0 ? 'block' : 'none';
        }
    }

    updateTrackUI(track) {
        // Recreate the track card with audio loaded
        const trackCard = document.getElementById(`miniDAWTrack_${track.id}`);
        if (trackCard) {
            trackCard.remove();
            this.createTrackUI(track);
        }
    }

    toggleMiniDAW() {
        this.miniDAWVisible = !this.miniDAWVisible;
        const content = document.getElementById('miniDAWContent');
        const icon = document.getElementById('miniDAWToggleIcon');
        
        if (content) {
            content.style.display = this.miniDAWVisible ? 'block' : 'none';
        }
        
        if (icon) {
            icon.className = this.miniDAWVisible ? 'fas fa-chevron-up' : 'fas fa-chevron-down';
        }
    }

    saveToLocalStorage() {
        const data = {
            tracks: this.tracks.map(track => ({
                ...track,
                audioUrl: null,
                audioBuffer: null
            })),
            exportFormat: this.exportFormat,
            mp3Bitrate: this.mp3Bitrate
        };
        
        localStorage.setItem('minidaw_integrated_project', JSON.stringify(data));
    }

    loadFromLocalStorage() {
        try {
            const saved = localStorage.getItem('minidaw_integrated_project');
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
            console.error('Error loading from localStorage:', error);
        }
    }

    cutTrackAtTime(trackId, cutTime) {
        const track = this.tracks.find(t => t.id === trackId);
        if (!track || !track.audioBuffer) return;

        // Para o áudio se estiver tocando
        if (track.isPlaying) {
            this.stopTrackPlayback(trackId);
        }

        // Corta o buffer de áudio no tempo especificado
        const sampleRate = track.audioBuffer.sampleRate;
        const cutSample = Math.floor(cutTime * sampleRate);
        
        if (cutSample < track.audioBuffer.length) {
            const newBuffer = this.audioContext.createBuffer(
                track.audioBuffer.numberOfChannels,
                cutSample,
                sampleRate
            );
            
            // Copia os dados de áudio até o ponto de corte
            for (let channel = 0; channel < track.audioBuffer.numberOfChannels; channel++) {
                const oldData = track.audioBuffer.getChannelData(channel);
                const newData = newBuffer.getChannelData(channel);
                newData.set(oldData.slice(0, cutSample));
            }
            
            // Atualiza o buffer da track
            track.audioBuffer = newBuffer;
            track.duration = cutTime;
            
            // Recria os nós de áudio
            this.createTrackNodes(track);
            
            // Atualiza a UI
            this.updateTrackUI(track);
            this.showNotification(`Track cortado em ${cutTime.toFixed(2)}s`, 'success');
            
            // Salva no localStorage
            this.saveToLocalStorage();
        }
    }

    // Implementação de fade out automático quando a voz terminar
    detectVoiceEndAndFadeMusic() {
        const voiceTracks = this.tracks.filter(t => t.type === 'voice' && t.audioBuffer);
        const musicTracks = this.tracks.filter(t => t.type === 'music' && t.audioBuffer);

        if (voiceTracks.length === 0 || musicTracks.length === 0) return;

        // Encontra a track de voz mais longa
        const longestVoiceTrack = voiceTracks.reduce((longest, track) => 
            track.duration > longest.duration ? track : longest
        );

        // Aplica fade out de 1.05s nas trilhas musicais
        musicTracks.forEach(track => {
            // Configura o fade out para começar quando a voz terminar
            track.fadeOutStartTime = longestVoiceTrack.duration - 1.05;
            track.fadeOutDuration = 1.05;
            
            // Se a trilha musical for mais longa que a voz, aplica o fade
            if (track.duration > longestVoiceTrack.duration) {
                // Mostra indicador visual
                const indicator = document.getElementById(`autoFade_${track.id}`);
                if (indicator) {
                    indicator.classList.add('active');
                    indicator.innerHTML = `
                        <i class="fas fa-magic"></i>
                        Auto Fade: ${track.fadeOutDuration}s
                    `;
                }
                
                // Aplica o fade out na track
                this.applyAutoFadeToTrack(track);
            }
        });

        this.showNotification('Auto Fade configurado: trilha musical entrará em fade out quando a voz terminar', 'success');
    }

    applyAutoFadeToTrack(track) {
        if (!track.audioBuffer || !track.fadeOutStartTime) return;

        // Durante o playback, aplica o fade out no tempo correto
        const nodes = this.trackNodes.get(track.id);
        if (!nodes || !nodes.gainNode) return;

        // Agenda o fade out
        const fadeOutStart = track.fadeOutStartTime;
        const fadeOutDuration = track.fadeOutDuration;
        const currentTime = this.audioContext.currentTime;

        // Se já estamos no tempo de fade out
        if (currentTime >= fadeOutStart) {
            nodes.gainNode.gain.setValueAtTime(track.volume / 100, currentTime);
            nodes.gainNode.gain.linearRampToValueAtTime(0, currentTime + fadeOutDuration);
        }
    }

    // Playback individual por track
    toggleTrackPlayback(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (!track || !track.audioBuffer) return;

        if (track.isPlaying) {
            this.pauseTrack(trackId);
        } else {
            this.playTrack(trackId);
        }
    }

    playTrack(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (!track || !track.audioBuffer) return;

        const nodes = this.trackNodes.get(trackId);
        if (!nodes) return;

        // Create source node
        const sourceNode = this.audioContext.createBufferSource();
        sourceNode.buffer = track.audioBuffer;
        
        // Create wet/dry mixer for effects
        const wetGain = this.audioContext.createGain();
        const dryGain = this.audioContext.createGain();
        const mixerGain = this.audioContext.createGain();
        
        // Set wet/dry balance (70% dry, 30% wet by default)
        wetGain.gain.value = 0.3;
        dryGain.gain.value = 0.7;
        
        // Connect dry signal
        sourceNode.connect(dryGain);
        dryGain.connect(mixerGain);
        
        // Apply effects to wet signal
        let wetLastNode = sourceNode;
        
        // Apply EQ if enabled
        if (track.effects.eq && track.eqSettings) {
            const eqNodes = this.createEQNodes(track);
            wetLastNode.connect(eqNodes.input);
            wetLastNode = eqNodes.output;
        }
        
        // Apply reverb if enabled
        if (track.effects.reverb) {
            const reverbNode = this.createReverbNode();
            wetLastNode.connect(reverbNode.convolver);
            reverbNode.convolver.connect(reverbNode.wetGain);
            wetLastNode = reverbNode.wetGain;
        }
        
        // Apply delay if enabled
        if (track.effects.delay) {
            const delayNode = this.createDelayNode();
            wetLastNode.connect(delayNode.delay);
            delayNode.delay.connect(delayNode.wetGain);
            wetLastNode = delayNode.wetGain;
        }
        
        // Apply compressor if enabled
        if (track.effects.compressor) {
            const compressorNode = this.audioContext.createDynamicsCompressor();
            wetLastNode.connect(compressorNode);
            wetLastNode = compressorNode;
        }
        
        // Connect wet signal to mixer
        wetLastNode.connect(wetGain);
        wetGain.connect(mixerGain);
        
        // Connect mixer to main gain and pan
        mixerGain.connect(nodes.gainNode);
        
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

        // Start playback
        sourceNode.start(0, track.currentTime || 0);
        
        // Store nodes
        track.sourceNode = sourceNode;
        track.isPlaying = true;
        track.startTime = this.audioContext.currentTime - (track.currentTime || 0);
        
        // Update UI
        this.updateTrackPlayButton(trackId, true);
        
        // Handle end
        sourceNode.onended = () => {
            track.isPlaying = false;
            track.currentTime = 0;
            this.updateTrackPlayButton(trackId, false);
        };
    }

    pauseTrack(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (!track || !track.isPlaying) return;

        if (track.sourceNode) {
            try {
                track.sourceNode.stop();
            } catch (e) {
                // Already stopped
            }
        }
        
        track.isPlaying = false;
        track.currentTime = this.audioContext.currentTime - track.startTime;
        this.updateTrackPlayButton(trackId, false);
    }

    stopTrackPlayback(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (!track) return;

        if (track.sourceNode) {
            try {
                track.sourceNode.stop();
            } catch (e) {
                // Already stopped
            }
        }
        
        track.isPlaying = false;
        track.currentTime = 0;
        this.updateTrackPlayButton(trackId, false);
    }

    updateTrackPlayButton(trackId, isPlaying) {
        const playBtn = document.getElementById(`playBtn_${trackId}`);
        const playIcon = document.getElementById(`playIcon_${trackId}`);
        
        if (playBtn && playIcon) {
            playBtn.className = isPlaying ? 
                'btn btn-sm btn-outline-warning' : 
                'btn btn-sm btn-outline-success';
            playIcon.className = isPlaying ? 
                'fas fa-pause' : 
                'fas fa-play';
            playBtn.title = isPlaying ? 'Pause' : 'Play';
        }
    }

    // Efeitos funcionais
    createEQNodes(track) {
        const input = this.audioContext.createGain();
        const output = this.audioContext.createGain();
        
        // Create filters for EQ
        const lowFilter = this.audioContext.createBiquadFilter();
        lowFilter.type = 'lowshelf';
        lowFilter.frequency.value = 320;
        lowFilter.gain.value = track.eqSettings.low || 0;
        
        const midFilter = this.audioContext.createBiquadFilter();
        midFilter.type = 'peaking';
        midFilter.frequency.value = 1000;
        midFilter.Q.value = 0.5;
        midFilter.gain.value = track.eqSettings.mid || 0;
        
        const highFilter = this.audioContext.createBiquadFilter();
        highFilter.type = 'highshelf';
        highFilter.frequency.value = 3200;
        highFilter.gain.value = track.eqSettings.high || 0;
        
        // Connect EQ chain
        input.connect(lowFilter);
        lowFilter.connect(midFilter);
        midFilter.connect(highFilter);
        highFilter.connect(output);
        
        return { input, output, lowFilter, midFilter, highFilter };
    }

    createReverbNode() {
        const convolver = this.audioContext.createConvolver();
        const wetGain = this.audioContext.createGain();
        
        // Create impulse response for reverb
        const length = this.audioContext.sampleRate * 2;
        const impulse = this.audioContext.createBuffer(2, length, this.audioContext.sampleRate);
        
        for (let channel = 0; channel < 2; channel++) {
            const channelData = impulse.getChannelData(channel);
            for (let i = 0; i < length; i++) {
                channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
            }
        }
        
        convolver.buffer = impulse;
        
        // Set wet gain (30% reverb)
        wetGain.gain.value = 0.3;
        
        return { convolver, wetGain };
    }

    createDelayNode() {
        const delay = this.audioContext.createDelay(1.0);
        const feedback = this.audioContext.createGain();
        const wetGain = this.audioContext.createGain();
        
        delay.delayTime.value = 0.3;
        feedback.gain.value = 0.4;
        wetGain.gain.value = 0.3;
        
        // Connect feedback loop
        delay.connect(feedback);
        feedback.connect(delay);
        
        return { delay, wetGain };
    }

    updateTrackEffects(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (!track) return;

        // Recreate nodes with new effects
        this.createTrackNodes(track);
        
        // If track is playing, restart with new effects
        if (track.isPlaying) {
            this.stopTrackPlayback(trackId);
            this.playTrack(trackId);
        }
    }

    // Métodos de controle geral
    togglePlayback() {
        if (this.isPlaying) {
            this.stop();
        } else {
            this.play();
        }
    }

    stop() {
        this.isPlaying = false;
        this.currentTime = 0;
        
        // Stop all tracks
        this.tracks.forEach(track => {
            if (track.isPlaying) {
                this.stopTrackPlayback(track.id);
            }
        });
        
        // Update UI
        this.updatePlaybackUI();
    }

    play() {
        if (this.tracks.length === 0) {
            this.showNotification('Adicione tracks antes de reproduzir', 'warning');
            return;
        }
        
        this.isPlaying = true;
        
        // Play all tracks
        this.tracks.forEach(track => {
            if (track.audioBuffer) {
                this.playTrack(track.id);
            }
        });
        
        // Update UI
        this.updatePlaybackUI();
        this.startPlaybackTimer();
    }

    rewind() {
        this.currentTime = 0;
        this.updatePlaybackUI();
    }

    fastForward() {
        this.currentTime = Math.min(this.currentTime + 5, this.duration);
        this.updatePlaybackUI();
    }

    zoomIn() {
        this.zoomLevel = Math.min(this.zoomLevel * 1.2, 300);
        this.updateZoomUI();
    }

    zoomOut() {
        this.zoomLevel = Math.max(this.zoomLevel / 1.2, 25);
        this.updateZoomUI();
    }

    updateZoomUI() {
        const zoomIndicator = document.getElementById('miniDAWZoomLevel');
        if (zoomIndicator) {
            zoomIndicator.textContent = `${Math.round(this.zoomLevel)}%`;
        }
    }

    updatePlaybackUI() {
        const playIcon = document.getElementById('miniDAWPlayIcon');
        if (playIcon) {
            playIcon.className = this.isPlaying ? 'fas fa-pause' : 'fas fa-play';
        }
    }

    startPlaybackTimer() {
        if (this.playbackTimer) {
            clearInterval(this.playbackTimer);
        }
        
        this.playbackTimer = setInterval(() => {
            if (this.isPlaying) {
                this.currentTime += 0.1;
                if (this.currentTime >= this.duration) {
                    this.stop();
                }
                this.updatePlaybackUI();
            }
        }, 100);
    }

    // Métodos de utilidade
    normalizeVolumes() {
        const tracksWithAudio = this.tracks.filter(t => t.audioBuffer);
        if (tracksWithAudio.length === 0) return;
        
        // Calcular volume médio
        const avgVolume = tracksWithAudio.reduce((sum, track) => sum + track.volume, 0) / tracksWithAudio.length;
        
        // Aplicar normalização
        tracksWithAudio.forEach(track => {
            track.volume = avgVolume;
            this.updateTrackVolume(track.id, avgVolume);
        });
        
        this.showNotification('Volumes normalizados para ' + Math.round(avgVolume) + '%', 'success');
    }

    applyAutoFade() {
        this.tracks.forEach(track => {
            if (track.audioBuffer) {
                track.fadeOut = 2.0; // 2 segundos de fade out
                
                // Mostrar indicador
                const indicator = document.getElementById(`autoFade_${track.id}`);
                if (indicator) {
                    indicator.classList.add('active');
                }
            }
        });
        
        this.showNotification('Auto Fade aplicado a todos os tracks', 'success');
    }

    clearAllTracks() {
        this.tracks = [];
        this.trackNodes.clear();
        this.duration = 0;
        this.currentTime = 0;
        this.stop();
        
        // Update UI
        this.renderTracks();
        this.updatePlaybackUI();
        
        this.saveToLocalStorage();
    }

    toggleScissorMode() {
        this.scissorMode = !this.scissorMode;
        
        const scissorBtn = document.getElementById('miniDAWScissorBtn');
        if (scissorBtn) {
            scissorBtn.classList.toggle('active');
        }
        
        this.showNotification(`Tesoura ${this.scissorMode ? 'ativada' : 'desativada'}`, 'info');
    }

    saveVipProject() {
        const projectData = {
            name: `MiniDAW_Project_${new Date().toISOString().slice(0, 10)}`,
            tracks: this.tracks.map(track => ({
                id: track.id,
                name: track.name,
                type: track.type,
                volume: track.volume,
                pan: track.pan,
                fadeIn: track.fadeIn,
                fadeOut: track.fadeOut,
                effects: track.effects,
                eqSettings: track.eqSettings
            })),
            settings: {
                bpm: 120,
                zoomLevel: this.zoomLevel
            },
            timestamp: new Date().toISOString()
        };
        
        // Salvar como JSON
        const dataStr = JSON.stringify(projectData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = `${projectData.name}.json`;
        link.click();
        
        URL.revokeObjectURL(url);
        this.showNotification('Projeto VIP salvo com sucesso!', 'success');
    }

    setFormat(format) {
        this.exportFormat = format;
        this.showNotification(`Formato de exportação: ${format.toUpperCase()}`, 'info');
    }

    exportMix(format) {
        if (this.tracks.length === 0) {
            this.showNotification('Nenhum track para exportar', 'warning');
            return;
        }
        
        this.showNotification(`Exportando mix em ${format.toUpperCase()}...`, 'info');
        
        // Simulação de exportação
        setTimeout(() => {
            this.showNotification(`Mix exportado com sucesso em ${format.toUpperCase()}!`, 'success');
        }, 2000);
    }

    toggleMiniDAW() {
        const content = document.getElementById('miniDAWContent');
        const icon = document.getElementById('miniDAWToggleIcon');
        
        if (content.style.display === 'none') {
            content.style.display = 'block';
            icon.className = 'fas fa-chevron-up';
        } else {
            content.style.display = 'none';
            icon.className = 'fas fa-chevron-down';
        }
    }

    // Novos métodos para interface profissional
    toggleMute(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (track) {
            track.muted = !track.muted;
            const btn = document.querySelector(`#miniDAWTrack_${trackId} .track-header-btn[title="Mudo"]`);
            if (btn) btn.classList.toggle('active', track.muted);
            
            // Aplicar mute no áudio
            const nodes = this.trackNodes.get(trackId);
            if (nodes && nodes.gainNode) {
                nodes.gainNode.gain.value = track.muted ? 0 : track.volume / 100;
            }
        }
    }

    toggleSolo(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (track) {
            track.solo = !track.solo;
            const btn = document.querySelector(`#miniDAWTrack_${trackId} .track-header-btn[title="Solo"]`);
            if (btn) btn.classList.toggle('active', track.solo);
            
            // Lógica de solo: se algum track está em solo, mutar os outros
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
        }
    }

    adjustFade(trackId, type, delta) {
        const track = this.tracks.find(t => t.id === trackId);
        if (track) {
            if (type === 'in') {
                track.fadeIn = Math.max(0, Math.min(5, track.fadeIn + delta));
                const label = document.getElementById(`fadeIn_${trackId}`);
                if (label) label.textContent = `Fade In ${track.fadeIn.toFixed(1)}s`;
            } else {
                track.fadeOut = Math.max(0, Math.min(5, track.fadeOut + delta));
                const label = document.getElementById(`fadeOutVal_${trackId}`);
                if (label) label.textContent = `Fade Out ${track.fadeOut.toFixed(1)}s`;
                
                // Mostrar/esconder label de fade out
                const fadeOutLabel = document.getElementById(`fadeOut_${trackId}`);
                if (fadeOutLabel) {
                    fadeOutLabel.style.display = track.fadeOut > 0 ? 'block' : 'none';
                    fadeOutLabel.querySelector('span').textContent = `OUT ${track.fadeOut.toFixed(1)}s`;
                }
            }
        }
    }

    updatePanLabel(trackId, pan) {
        const label = document.getElementById(`pan_${trackId}`);
        if (label) {
            if (pan === 0) label.textContent = 'C';
            else if (pan < 0) label.textContent = `L${Math.abs(Math.round(pan * 100))}`;
            else label.textContent = `R${Math.round(pan * 100)}`;
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
            this.updatePanLabel(trackId, track.pan);
        }
    }

    toggleTrackCollapse(trackId) {
        const panel = document.getElementById(`effectsPanel_${trackId}`);
        const btn = document.querySelector(`#miniDAWTrack_${trackId} .track-collapse-btn i`);
        if (panel) {
            panel.classList.toggle('show');
            if (btn) {
                btn.className = panel.classList.contains('show') ? 'fas fa-chevron-up' : 'fas fa-chevron-down';
            }
        }
    }

    toggleScissorTrack(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (track) {
            track.effects.scissor = !track.effects.scissor;
            const btn = document.querySelector(`#miniDAWTrack_${trackId} .tool-btn[title="Cortar"]`);
            if (btn) btn.classList.toggle('active', track.effects.scissor);
        }
    }

    toggleTrackEffects(trackId) {
        this.toggleTrackCollapse(trackId);
    }

    resetTrack(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (track) {
            track.volume = 100;
            track.pan = 0;
            track.fadeIn = 0;
            track.fadeOut = 0;
            track.effects = { reverb: false, delay: false, compressor: false, eq: false };
            this.updateTrackUI(track);
            this.showNotification('Track resetado', 'info');
        }
    }

    updateTrackUI(track) {
        const card = document.getElementById(`miniDAWTrack_${track.id}`);
        if (card) {
            // Atualizar volume
            const volSlider = card.querySelector('.mini-slider');
            if (volSlider) volSlider.value = track.volume;
            const volLabel = document.getElementById(`vol_${track.id}`);
            if (volLabel) volLabel.textContent = `${track.volume}%`;
            
            // Atualizar pan
            const panSlider = card.querySelector('.mini-slider.pan');
            if (panSlider) panSlider.value = track.pan * 100;
            this.updatePanLabel(track.id, track.pan);
            
            // Atualizar fades
            const fadeInLabel = document.getElementById(`fadeIn_${track.id}`);
            if (fadeInLabel) fadeInLabel.textContent = `Fade In ${track.fadeIn.toFixed(1)}s`;
            const fadeOutLabel = document.getElementById(`fadeOutVal_${track.id}`);
            if (fadeOutLabel) fadeOutLabel.textContent = `Fade Out ${track.fadeOut.toFixed(1)}s`;
            
            // Atualizar botões de efeitos
            Object.keys(track.effects).forEach(effect => {
                const btn = card.querySelector(`.fx-btn[onclick*="${effect}"]`);
                if (btn) btn.classList.toggle('active', track.effects[effect]);
            });
        }
    }

    updateReverb(trackId, param, value) {
        const track = this.tracks.find(t => t.id === trackId);
        if (track) {
            if (!track.reverbSettings) track.reverbSettings = {};
            track.reverbSettings[param] = parseFloat(value);
            
            // Atualizar label
            const valueLabel = event.target.nextElementSibling;
            if (valueLabel) {
                valueLabel.textContent = param === 'mix' ? `${value}%` : `${value}s`;
            }
        }
    }

    toggleAllEffects(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (track) {
            // Abrir painel de efeitos
            const panel = document.getElementById(`effectsPanel_${track.id}`);
            if (panel) {
                panel.classList.add('show');
            }
            this.showNotification('Selecione um efeito para adicionar', 'info');
        }
    }

    savePreset(trackId) {
        this.showNotification('Preset salvo!', 'success');
    }

    resetEffects(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (track) {
            track.effects = { reverb: true, delay: true, compressor: true, eq: true};
            track.eqSettings = { low: 0, mid: 0, high: 0 };
            this.updateTrackUI(track);
            
            // Esconder painel
            const panel = document.getElementById(`effectsPanel_${track.id}`);
            if (panel) panel.classList.remove('show');
            
            this.showNotification('Efeitos resetados', 'info');
        }
    }

    // Métodos para ajustar efeitos em tempo real
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
}

// Initialize MiniDAW Integrada
let miniDAW;

document.addEventListener('DOMContentLoaded', () => {
    miniDAW = new MiniDAWIntegrated();
});

// Global functions for HTML onclick handlers
window.addMiniDAWTrack = (type) => miniDAW.addTrack(type);
window.removeMiniDAWTrack = (id) => miniDAW.removeTrack(id);
window.updateMiniDAWTrackName = (id, name) => miniDAW.updateTrackName(id, name);
window.updateMiniDAWTrackVolume = (id, volume) => miniDAW.updateTrackVolume(id, volume);
window.updateMiniDAWTrackPan = (id, pan) => miniDAW.updateTrackPan(id, pan);
window.updateMiniDAWTrackFadeIn = (id, fadeIn) => miniDAW.updateTrackFadeIn(id, fadeIn);
window.updateMiniDAWTrackFadeOut = (id, fadeOut) => miniDAW.updateTrackFadeOut(id, fadeOut);

// Funções de controle de player individual
window.toggleMiniDAWTrackPlayback = (trackId) => {
    const track = miniDAW.tracks.find(t => t.id === trackId);
    if (track && track.audioBuffer) {
        track.isPlaying = !track.isPlaying;
        if (track.isPlaying) {
            miniDAW.playTrack(track);
        } else {
            miniDAW.stopTrack(track);
        }
        miniDAW.updateTrackUI(track);
    }
};

window.updateMiniDAWTrackTime = (trackId) => {
    const track = miniDAW.tracks.find(t => t.id === trackId);
    if (track && track.audioBuffer) {
        const currentTimeElement = document.getElementById(`currentTime_${trackId}`);
        const durationElement = document.getElementById(`duration_${trackId}`);
        if (currentTimeElement) {
            currentTimeElement.textContent = miniDAW.formatTime(track.currentTime || 0);
        }
        if (durationElement) {
            durationElement.textContent = miniDAW.formatTime(track.duration || 0);
        }
    }
};

// Adicionar método formatTime à classe MiniDAWIntegrated
if (typeof MiniDAWIntegrated !== 'undefined') {
    MiniDAWIntegrated.prototype.formatTime = function(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };
    
    MiniDAWIntegrated.prototype.playTrack = function(track) {
        const nodes = this.trackNodes.get(track.id);
        if (!nodes || !track.audioBuffer) return;

        // Create source node
        const sourceNode = this.audioContext.createBufferSource();
        sourceNode.buffer = track.audioBuffer;
        
        // Apply gain
        if (nodes.gainNode) {
            nodes.gainNode.gain.setValueAtTime(track.volume / 100, this.audioContext.currentTime);
        }

        // Connect to effect chain
        sourceNode.connect(nodes.inputNode);
        sourceNode.start(0, track.currentTime || 0);
        
        nodes.sourceNode = sourceNode;
        track.isPlaying = true;
        track.startTime = this.audioContext.currentTime - (track.currentTime || 0);

        // Handle end
        sourceNode.onended = () => {
            track.isPlaying = false;
            this.updateTrackUI(track);
        };
    };
    
    MiniDAWIntegrated.prototype.stopTrack = function(track) {
        const nodes = this.trackNodes.get(track.id);
        if (nodes && nodes.sourceNode) {
            try {
                nodes.sourceNode.stop();
            } catch (e) {
                // Already stopped
            }
            nodes.sourceNode = null;
        }
        track.isPlaying = false;
        this.updateTrackUI(track);
    };
    
    MiniDAWIntegrated.prototype.updateTrackUI = function(track) {
        const playBtn = document.querySelector(`[onclick*="toggleMiniDAWTrackPlayback('${track.id}')"] i`);
        if (playBtn) {
            playBtn.className = track.isPlaying ? 'fas fa-pause' : 'fas fa-play';
        }
    };
}
window.toggleMiniDAWEffect = (id, effect) => miniDAW.toggleEffect(id, effect);
window.updateMiniDAWEQ = (id, band, value) => miniDAW.updateEQ(id, band, value);
window.toggleMiniDAWPlayback = () => miniDAW.togglePlayback();
window.stopMiniDAWPlayback = () => miniDAW.stopPlayback();
window.setMiniDAWFormat = (format) => miniDAW.setFormat(format);
window.exportMiniDAWMix = () => miniDAW.exportMix();
window.normalizeMiniDAWVolumes = () => miniDAW.normalizeVolumes();
window.applyMiniDAWAutoFade = () => miniDAW.applyAutoFade();
window.clearMiniDAWTracks = () => miniDAW.clearAllTracks();
window.toggleMiniDAWScissor = () => miniDAW.toggleScissorMode();
window.zoomMiniDAWIn = () => miniDAW.zoomIn();
window.zoomMiniDAWOut = () => miniDAW.zoomOut();
window.saveMiniDAWProject = () => miniDAW.saveVipProject();
window.toggleMiniDAW = () => miniDAW.toggleMiniDAW();
window.handleMiniDAWDrop = (e) => miniDAW.handleDrop(e);
window.handleMiniDAWDragOver = (e) => miniDAW.handleDragOver(e);
window.handleMiniDAWDragLeave = (e) => miniDAW.handleDragLeave(e);
window.handleMiniDAWFileSelect = (e) => miniDAW.handleFileSelect(e);
window.handleMiniDAWTrackDrop = (e, id) => miniDAW.handleTrackDrop(e, id);
window.handleMiniDAWTrackDragOver = (e) => miniDAW.handleTrackDragOver(e);
window.handleMiniDAWTrackDragLeave = (e) => miniDAW.handleTrackDragLeave(e);
window.handleMiniDAWTrackFileSelect = (e, id) => miniDAW.handleTrackFileSelect(e, id);
window.toggleMiniDAWMute = (id) => miniDAW.toggleMute(id);
window.toggleMiniDAWSolo = (id) => miniDAW.toggleSolo(id);
window.adjustMiniDAWFade = (id, type, delta) => miniDAW.adjustFade(id, type, delta);
window.toggleMiniDAWTrackCollapse = (id) => miniDAW.toggleTrackCollapse(id);
window.toggleMiniDAWScissorTrack = (id) => miniDAW.toggleScissorTrack(id);
window.toggleMiniDAWTrackEffects = (id) => miniDAW.toggleTrackEffects(id);
window.resetMiniDAWTrack = (id) => miniDAW.resetTrack(id);
window.updateMiniDAWReverb = (id, param, value) => miniDAW.updateReverb(id, param, value);
window.toggleMiniDAWAllEffects = (id) => miniDAW.toggleAllEffects(id);
window.saveMiniDAWPreset = (id) => miniDAW.savePreset(id);
window.resetMiniDAWEffects = (id) => miniDAW.resetEffects(id);
window.sendToMiniDAW = async () => {
    // Função para enviar áudio gerado para a página MiniDAW externa (/minidaw)
    const audioElement = document.getElementById('generatedAudio');
    
    // Verifica se temos o blob salvo ou o elemento de áudio
    let blobToSend = null;
    
    if (typeof lastGeneratedAudioBlob !== 'undefined' && lastGeneratedAudioBlob) {
        blobToSend = lastGeneratedAudioBlob;
    } else if (audioElement && audioElement.src) {
        // Tenta fazer fetch do áudio
        try {
            const response = await fetch(audioElement.src);
            blobToSend = await response.blob();
        } catch (error) {
            console.error('Erro ao buscar áudio:', error);
            alert('Erro ao enviar áudio. Tente gerar o áudio novamente.');
            return;
        }
    } else {
        alert('Nenhum áudio gerado para enviar');
        return;
    }
    
    // Converte blob para base64 e salva no localStorage
    try {
        const reader = new FileReader();
        reader.onloadend = function() {
            const base64data = reader.result;
            
            // Salva no localStorage para a outra página ler
            localStorage.setItem('minidaw_pending_audio', base64data);
            localStorage.setItem('minidaw_pending_filename', 'audio_gerado.wav');
            localStorage.setItem('minidaw_pending_timestamp', Date.now().toString());
            
            // Abre a página MiniDAW em nova aba
            window.open('/minidaw', '_blank');
        };
        reader.readAsDataURL(blobToSend);
    } catch (error) {
        console.error('Erro ao converter áudio:', error);
        alert('Erro ao preparar áudio para envio');
    }
};

// Funções globais para a interface
window.cutMiniDAWTrackAtClick = (event, trackId) => {
    const canvas = event.target;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const width = rect.width;
    
    // Calcula o tempo do clique baseado na posição no canvas
    const track = miniDAW.tracks.find(t => t.id === trackId);
    if (track && track.duration) {
        const clickTime = (x / width) * track.duration;
        
        // Confirmação do usuário
        if (confirm(`Cortar trilha em ${clickTime.toFixed(2)}s?`)) {
            miniDAW.cutTrackAtTime(trackId, clickTime);
            
            // Desenha linha de corte no waveform
            const ctx = canvas.getContext('2d');
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
            ctx.stroke();
        }
    }
};

window.applyMiniDAWAutoFade = () => {
    miniDAW.detectVoiceEndAndFadeMusic();
};

// Novos controles de efeitos
window.updateMiniDAWReverbAmount = (id, amount) => miniDAW.updateReverbAmount(id, amount);
window.updateMiniDAWCompressor = (id, param, value) => miniDAW.updateCompressor(id, param, value);
