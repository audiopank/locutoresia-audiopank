class MiniDAWReactApp {
    constructor() {
        this.tracks = [];
        this.isPlaying = false;
        this.currentTime = 0;
        this.duration = 0;
        this.selectedVoice = null;
        this.selectedStyle = 'normal';
        this.textInput = '';
        this.playbackTimer = null;
        this.trackColors = {
            voice: { primary: '#3b82f6', secondary: '#1d4ed8', light: 'rgba(59, 130, 246, 0.2)' },
            music: { primary: '#8b5cf6', secondary: '#6d28d9', light: 'rgba(139, 92, 246, 0.2)' },
            effect: { primary: '#10b981', secondary: '#059669', light: 'rgba(16, 185, 129, 0.2)' }
        };
        this.voices = [];
        this.init();
    }

    async init() {
        console.log('MiniDAW React App initialized');
        await this.loadVoices();
        this.renderApp();
    }

    async loadVoices() {
        try {
            const response = await fetch('/api/voices');
            const result = await response.json();
            if (result.voices && result.voices.length > 0) {
                this.voices = result.voices;
            }
        } catch (error) {
            console.error('Erro ao carregar vozes:', error);
        }
    }

    renderApp() {
        const container = document.getElementById('react-daw-container');
        if (!container) return;

        container.innerHTML = `
            <div class="minidaw-app-layout">
                <div class="generator-panel">
                    <div class="panel-header">
                        <h3><i class="fas fa-magic"></i> Gerador de Voz IA</h3>
                    </div>
                    
                    <div class="panel-content">
                        <div class="form-group">
                            <label>Texto para Gerar</label>
                            <textarea id="text-input-generator" class="form-control" rows="6" 
                                      placeholder="Digite o texto que sera falado pela voz IA...">${this.textInput}</textarea>
                        </div>

                        <div class="form-group">
                            <label>Selecione uma Voz</label>
                            <select id="voice-select-generator" class="form-control">
                                <option value="">Selecione uma voz</option>
                                ${this.renderVoiceOptions()}
                            </select>
                        </div>

                        <div class="form-group">
                            <label>Estilo de Fala</label>
                            <select id="style-select-generator" class="form-control">
                                <option value="normal" ${this.selectedStyle === 'normal' ? 'selected' : ''}>Normal</option>
                                <option value="fast" ${this.selectedStyle === 'fast' ? 'selected' : ''}>Rapido</option>
                                <option value="slow" ${this.selectedStyle === 'slow' ? 'selected' : ''}>Lento</option>
                                <option value="cheerful" ${this.selectedStyle === 'cheerful' ? 'selected' : ''}>Alegre</option>
                                <option value="serious" ${this.selectedStyle === 'serious' ? 'selected' : ''}>Serio</option>
                            </select>
                        </div>

                        <div class="quick-actions">
                            <button onclick="minidawReact.addTrack('music')" class="btn btn-purple">
                                <i class="fas fa-music"></i> Adicionar Trilha
                            </button>
                            <button onclick="minidawReact.addTrack('effect')" class="btn btn-green">
                                <i class="fas fa-bolt"></i> Adicionar Efeito
                            </button>
                        </div>
                    </div>
                </div>

                <div class="daw-panel">
                    <div class="time-display-panel">
                        <div class="time-display-item">
                            <div class="time-display-label">Position</div>
                            <div class="time-display-value" id="time-position">00:00:00</div>
                        </div>
                        <div class="time-display-item">
                            <div class="time-display-label">Range Length</div>
                            <div class="time-display-value" id="time-length">00:00:00</div>
                        </div>
                        <div class="time-display-item">
                            <div class="time-display-label">Range End</div>
                            <div class="time-display-value" id="time-end">00:00:00</div>
                        </div>
                    </div>
                    <div class="minidaw-transport">
                        <div class="transport-left">
                            <button onclick="minidawReact.stopAll()" class="transport-btn stop-btn" title="Parar Tudo">
                                <i class="fas fa-stop"></i>
                            </button>
                            <button onclick="minidawReact.togglePlay()" class="transport-btn play-btn ${this.isPlaying ? 'playing' : ''}" title="Tocar/Parar">
                                <i class="fas ${this.isPlaying ? 'fa-pause' : 'fa-play'}"></i>
                            </button>
                            <button onclick="minidawReact.rewind()" class="transport-btn rewind-btn" title="Voltar ao Inicio">
                                <i class="fas fa-undo"></i>
                            </button>
                        </div>
                        
                        <div class="transport-center">
                            <div class="time-display">
                                <span class="current-time">${this.formatTime(this.currentTime)}</span>
                                <span class="separator">/</span>
                                <span class="total-time">${this.formatTime(this.duration)}</span>
                            </div>
                            <div class="progress-bar-container">
                                <div class="progress-bar" style="width: ${this.duration > 0 ? (this.currentTime / this.duration) * 100 : 0}%"></div>
                            </div>
                        </div>

                        <div class="transport-right">
                            <button onclick="minidawReact.exportMix()" class="btn btn-export">
                                <i class="fas fa-download"></i> Exportar
                            </button>
                        </div>
                    </div>

                    <div class="minidaw-tracks">
                        <div class="tracks-header">
                            <div class="track-header-title">
                                <i class="fas fa-layer-group"></i> Tracks
                            </div>
                            <div class="track-header-info">
                                <span>${this.tracks.length} track(s)</span>
                            </div>
                        </div>
                        <div class="tracks-container">
                            ${this.renderTracks()}
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.attachEventListeners();
    }

    renderVoiceOptions() {
        if (this.voices.length === 0) {
            return '<option value="">Carregando vozes...</option>';
        }

        let html = '';
        
        const geminiVoices = this.voices.filter(v => v.provider === 'gemini');
        if (geminiVoices.length > 0) {
            html += '<optgroup label="Gemini 3.1 Flash TTS">';
            geminiVoices.forEach(v => {
                html += `<option value="gemini||${v.id}">${v.name}</option>`;
            });
            html += '</optgroup>';
        }
        
        const elevenlabsVoices = this.voices.filter(v => v.provider === 'elevenlabs');
        if (elevenlabsVoices.length > 0) {
            html += '<optgroup label="ElevenLabs">';
            elevenlabsVoices.forEach(v => {
                html += `<option value="elevenlabs||${v.id}">${v.name}</option>`;
            });
            html += '</optgroup>';
        }
        
        return html;
    }

    attachEventListeners() {
        const textInput = document.getElementById('text-input-generator');
        const voiceSelect = document.getElementById('voice-select-generator');
        const styleSelect = document.getElementById('style-select-generator');

        if (textInput) {
            textInput.addEventListener('input', (e) => {
                this.textInput = e.target.value;
            });
        }

        if (voiceSelect) {
            voiceSelect.addEventListener('change', (e) => {
                this.selectedVoice = e.target.value;
            });
        }

        if (styleSelect) {
            styleSelect.addEventListener('change', (e) => {
                this.selectedStyle = e.target.value;
            });
        }

        setTimeout(() => {
            this.drawAllWaveforms();
        }, 100);
    }

    drawAllWaveforms() {
        this.tracks.forEach(track => {
            if (track.audioUrl) {
                this.drawWaveform(track.id);
            }
        });
    }

    drawWaveform(trackId) {
        const canvas = document.getElementById(`waveform_${trackId}`);
        if (!canvas) return;

        const track = this.tracks.find(t => t.id === trackId);
        if (!track || !track.audioUrl) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.parentElement.clientWidth || 400;
        const height = 80;
        canvas.width = width;
        canvas.height = height;

        const colors = this.trackColors[track.type];
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, colors.primary);
        gradient.addColorStop(1, colors.secondary);

        ctx.fillStyle = colors.light;
        ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = gradient;
        ctx.lineWidth = 2;
        ctx.beginPath();

        for (let x = 0; x < width; x++) {
            const y = height / 2 + Math.sin(x * 0.05 + Math.random()) * (height / 3);
            if (x === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();

        ctx.fillStyle = gradient;
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        for (let x = 0; x < width; x++) {
            const y = height / 2 + Math.sin(x * 0.05 + Math.random()) * (height / 3);
            ctx.lineTo(x, y);
        }
        ctx.lineTo(width, height / 2);
        ctx.fill();
    }

    trimTrack(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (!track || !track.audioUrl) return;

        alert('Funcao de corte (Trim) em desenvolvimento!\n\nPara agora, voce pode usar o Preview para ouvir e decidir o audio.');
    }

    saveProject() {
        const projectData = {
            name: 'Projeto MiniDAW',
            createdAt: new Date().toISOString(),
            tracks: this.tracks,
            textInput: this.textInput,
            selectedVoice: this.selectedVoice,
            selectedStyle: this.selectedStyle
        };

        try {
            localStorage.setItem('minidaw_project', JSON.stringify(projectData));
            alert('Projeto salvo com sucesso!\n\nVocê pode carregá-lo depois usando "Carregar Projeto".');
        } catch (error) {
            alert('Erro ao salvar o projeto: ' + error.message);
        }
    }

    loadProject() {
        try {
            const savedProject = localStorage.getItem('minidaw_project');
            if (!savedProject) {
                alert('Nenhum projeto salvo encontrado!');
                return;
            }

            const projectData = JSON.parse(savedProject);
            this.tracks = projectData.tracks || [];
            this.textInput = projectData.textInput || '';
            this.selectedVoice = projectData.selectedVoice || null;
            this.selectedStyle = projectData.selectedStyle || 'normal';

            this.renderApp();
            alert(`Projeto carregado com sucesso!\n\nData: ${new Date(projectData.createdAt).toLocaleString()}\nTracks: ${this.tracks.length}`);

            setTimeout(() => {
                this.drawAllWaveforms();
                this.attachEventListeners();
            }, 200);

        } catch (error) {
            alert('Erro ao carregar o projeto: ' + error.message);
        }
    }

    async mixAll() {
        const audioTracks = this.tracks.filter(t => t.audioUrl && !t.muted);
        if (audioTracks.length === 0) {
            alert('Adicione pelo menos uma track com audio para mixar');
            return;
        }

        try {
            if (audioTracks.length === 1) {
                window.open(audioTracks[0].audioUrl, '_blank');
                return;
            }

            alert(`Mixando ${audioTracks.length} track(s)...\n\nMixagem completa em desenvolvimento!\n\nPara agora, você pode baixar cada track individualmente usando o botão Preview.`);
            
            this.tracks.forEach(track => {
                if (track.audioUrl && !track.muted) {
                    console.log(`Track: ${track.name}, Volume: ${track.volume}%, Type: ${track.type}`);
                }
            });

        } catch (error) {
            console.error('Erro ao mixar:', error);
            alert('Erro ao mixar tracks: ' + error.message);
        }
    }

    renderTracks() {
        if (this.tracks.length === 0) {
            return `
                <div class="empty-state">
                    <div class="empty-icon">
                        <i class="fas fa-music fa-4x"></i>
                    </div>
                    <h3>Nenhuma track adicionada</h3>
                    <p>Use o gerador de voz ao lado ou adicione trilhas/efeitos</p>
                </div>
            `;
        }

        return this.tracks.map((track, index) => {
            const colors = this.trackColors[track.type];
            const typeIcons = {
                voice: 'fa-microphone',
                music: 'fa-music',
                effect: 'fa-bolt'
            };
            const typeLabels = {
                voice: 'Locucao',
                music: 'Trilha',
                effect: 'Efeito'
            };

            return `
                <div class="track-item" style="border-left: 4px solid ${colors.primary};">
                    <div class="track-left">
                        <div class="track-icon" style="background: ${colors.light}; color: ${colors.primary};">
                            <i class="fas ${typeIcons[track.type]}"></i>
                        </div>
                        <div class="track-info">
                            <div class="track-name" title="${track.name}">${track.name}</div>
                            <div class="track-type" style="color: ${colors.primary};">
                                <span class="badge" style="background: ${colors.light}; color: ${colors.primary};">
                                    ${typeLabels[track.type]}
                                </span>
                            </div>
                        </div>
                        <div class="track-controls-left">
                            <button onclick="minidawReact.toggleTrackMute('${track.id}')" class="control-btn ${track.muted ? 'active' : ''}" title="Mudo">
                                <i class="fas ${track.muted ? 'fa-volume-mute' : 'fa-volume-up'}"></i>
                            </button>
                            <button onclick="minidawReact.toggleTrackSolo('${track.id}')" class="control-btn ${track.solo ? 'active' : ''}" title="Solo">
                                <i class="fas fa-headphones"></i>
                            </button>
                        </div>
                    </div>

                    <div class="track-center">
                        <div class="waveform-container" style="background: ${colors.light};">
                            ${track.audioUrl ? `
                                <canvas class="waveform-canvas" id="waveform_${track.id}"></canvas>
                            ` : `
                                <div class="waveform-placeholder">
                                    <i class="fas fa-cloud-upload-alt"></i>
                                    <span>Arraste arquivo ou clique para adicionar</span>
                                </div>
                            `}
                        </div>
                    </div>

                    <div class="track-right">
                        <div class="volume-control">
                            <i class="fas fa-volume-down"></i>
                            <input type="range" min="0" max="100" value="${track.volume}" 
                                   oninput="minidawReact.updateTrackVolume('${track.id}', this.value)">
                            <span class="volume-value">${track.volume}%</span>
                        </div>
                        <div class="track-controls-right">
                            <button onclick="minidawReact.toggleTrackPlayback('${track.id}')" 
                                    class="control-btn play ${track.isPlaying ? 'active' : ''}" title="Tocar">
                                <i class="fas ${track.isPlaying ? 'fa-pause' : 'fa-play'}"></i>
                            </button>
                            ${track.audioUrl ? `
                                <button onclick="minidawReact.trimTrack('${track.id}')" class="control-btn" title="Cortar (Trim)">
                                    <i class="fas fa-cut"></i>
                                </button>
                                <button onclick="minidawReact.previewTrack('${track.id}')" class="control-btn" title="Preview">
                                    <i class="fas fa-eye"></i>
                                </button>
                            ` : `
                                <button onclick="minidawReact.uploadAudioToTrack('${track.id}')" class="control-btn" title="Adicionar Audio">
                                    <i class="fas fa-plus"></i>
                                </button>
                            `}
                            <button onclick="minidawReact.removeTrack('${track.id}')" class="control-btn danger" title="Remover">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    async generateVoiceFromHeader() {
        const voiceSelect = document.getElementById('voice-select-generator');
        const textInput = document.getElementById('text-input-generator');
        const styleSelect = document.getElementById('style-select-generator');
        
        if (!voiceSelect || !voiceSelect.value || !textInput || !textInput.value.trim()) {
            alert('Digite o texto e selecione uma voz no painel ao lado!');
            return;
        }

        const originalText = textInput.value;
        const originalVoice = voiceSelect.value;
        const originalStyle = styleSelect ? styleSelect.value : 'normal';

        try {
            const parts = originalVoice.split('||');
            const provider = parts[0];
            const voiceId = parts[1];
            
            const response = await fetch('/api/generate-audio', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: originalText,
                    voice: voiceId,
                    style: originalStyle,
                    provider: provider
                })
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Erro ao gerar voz');
            }
            
            this.addTrackWithAudio('voice', result.download_url, `${voiceId} - ${originalText.substring(0, 30)}...`);
            
            alert('Voz gerada com sucesso! Adicionada a track.');
            this.renderApp();
            
        } catch (error) {
            console.error('Erro:', error);
            alert('Erro ao gerar voz: ' + error.message);
        }
    }

    addTrack(type) {
        const typeNames = {
            voice: 'Locucao',
            music: 'Trilha',
            effect: 'Efeito'
        };
        const count = this.tracks.filter(t => t.type === type).length + 1;
        
        const newTrack = {
            id: Date.now().toString(),
            name: `${typeNames[type]} ${count}`,
            type,
            audioUrl: null,
            volume: 100,
            muted: false,
            solo: false,
            isPlaying: false
        };
        this.tracks.push(newTrack);
        this.renderApp();
    }

    addTrackWithAudio(type, audioUrl, name) {
        const typeNames = {
            voice: 'Locucao',
            music: 'Trilha',
            effect: 'Efeito'
        };
        const count = this.tracks.filter(t => t.type === type).length + 1;
        
        const newTrack = {
            id: Date.now().toString(),
            name: name || `${typeNames[type]} ${count}`,
            type,
            audioUrl,
            volume: 100,
            muted: false,
            solo: false,
            isPlaying: false
        };
        this.tracks.push(newTrack);
        this.renderApp();
        
        setTimeout(() => {
            this.drawWaveform(newTrack.id);
        }, 150);
    }

    removeTrack(trackId) {
        if (confirm('Tem certeza que deseja remover esta track?')) {
            this.tracks = this.tracks.filter(t => t.id !== trackId);
            this.renderApp();
        }
    }

    toggleTrackMute(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (track) {
            track.muted = !track.muted;
            this.renderApp();
        }
    }

    toggleTrackSolo(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (track) {
            track.solo = !track.solo;
            this.renderApp();
        }
    }

    toggleTrackPlayback(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (!track || !track.audioUrl) return;

        track.isPlaying = !track.isPlaying;
        let audioEl = document.getElementById(`audio_${trackId}`);
        
        if (!audioEl && track.audioUrl) {
            audioEl = document.createElement('audio');
            audioEl.id = `audio_${trackId}`;
            audioEl.src = track.audioUrl;
            audioEl.volume = track.muted ? 0 : track.volume / 100;
            document.body.appendChild(audioEl);
        }
        
        if (audioEl) {
            if (track.isPlaying) {
                audioEl.play().catch(() => {});
            } else {
                audioEl.pause();
            }
        }
        
        this.renderApp();
    }

    updateTrackVolume(trackId, value) {
        const track = this.tracks.find(t => t.id === trackId);
        if (track) {
            track.volume = Number(value);
            const audioEl = document.getElementById(`audio_${trackId}`);
            if (audioEl) {
                audioEl.volume = track.muted ? 0 : track.volume / 100;
            }
            this.renderApp();
        }
    }

    previewTrack(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (track && track.audioUrl) {
            window.open(track.audioUrl, '_blank');
        }
    }

    uploadAudioToTrack(trackId) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'audio/*';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                const url = URL.createObjectURL(file);
                const track = this.tracks.find(t => t.id === trackId);
                if (track) {
                    track.audioUrl = url;
                    track.name = file.name;
                    this.renderApp();
                }
            }
        };
        input.click();
    }

    togglePlay() {
        this.isPlaying = !this.isPlaying;
        
        if (this.isPlaying) {
            this.startPlaybackTimer();
        } else {
            this.stopPlaybackTimer();
        }
        
        this.tracks.forEach(track => {
            if (track.audioUrl) {
                let audioEl = document.getElementById(`audio_${track.id}`);
                if (!audioEl) {
                    audioEl = document.createElement('audio');
                    audioEl.id = `audio_${track.id}`;
                    audioEl.src = track.audioUrl;
                    document.body.appendChild(audioEl);
                }
                
                const shouldPlay = this.isPlaying && !track.muted && 
                    (!this.tracks.some(t => t.solo) || track.solo);
                
                audioEl.volume = track.muted ? 0 : track.volume / 100;
                
                if (shouldPlay) {
                    audioEl.play().catch(() => {});
                } else {
                    audioEl.pause();
                }
                
                track.isPlaying = shouldPlay;
            }
        });
        
        this.renderApp();
    }

    startPlaybackTimer() {
        this.stopPlaybackTimer();
        this.playbackTimer = setInterval(() => {
            this.updatePlayback();
        }, 100);
    }

    stopPlaybackTimer() {
        if (this.playbackTimer) {
            clearInterval(this.playbackTimer);
            this.playbackTimer = null;
        }
    }

    updatePlayback() {
        let maxDuration = 0;
        let currentPos = 0;
        
        this.tracks.forEach(track => {
            if (track.audioUrl) {
                const audioEl = document.getElementById(`audio_${track.id}`);
                if (audioEl && !isNaN(audioEl.duration)) {
                    if (audioEl.duration > maxDuration) {
                        maxDuration = audioEl.duration;
                    }
                    if (audioEl.currentTime > currentPos) {
                        currentPos = audioEl.currentTime;
                    }
                    
                    if (track.type === 'voice') {
                        this.handleVoiceFadeOut(track, audioEl);
                    }
                }
            }
        });
        
        this.currentTime = currentPos;
        this.duration = maxDuration;
        this.updateTimeDisplay();
        
        if (this.isPlaying && maxDuration > 0 && currentPos >= maxDuration - 0.1) {
            this.stopAll();
        }
    }

    handleVoiceFadeOut(track, audioEl) {
        const fadeOutDuration = 1.5;
        const timeRemaining = audioEl.duration - audioEl.currentTime;
        
        const voiceTracks = this.tracks.filter(t => t.type === 'voice' && t.isPlaying && !t.muted);
        const musicTracks = this.tracks.filter(t => t.type === 'music');
        
        if (voiceTracks.length > 0) {
            musicTracks.forEach(musicTrack => {
                const musicEl = document.getElementById(`audio_${musicTrack.id}`);
                if (musicEl) {
                    if (timeRemaining <= fadeOutDuration && timeRemaining > 0) {
                        const fadeProgress = timeRemaining / fadeOutDuration;
                        const duckedVolume = (musicTrack.muted ? 0 : musicTrack.volume / 100) * 0.3;
                        const newVolume = duckedVolume * fadeProgress;
                        musicEl.volume = Math.max(0, newVolume);
                    } else {
                        const duckedVolume = (musicTrack.muted ? 0 : musicTrack.volume / 100) * 0.3;
                        musicEl.volume = duckedVolume;
                    }
                }
            });
        } else {
            musicTracks.forEach(musicTrack => {
                const musicEl = document.getElementById(`audio_${musicTrack.id}`);
                if (musicEl) {
                    musicEl.volume = musicTrack.muted ? 0 : musicTrack.volume / 100;
                }
            });
        }
    }

    updateTimeDisplay() {
        const posEl = document.getElementById('time-position');
        const lenEl = document.getElementById('time-length');
        const endEl = document.getElementById('time-end');
        
        if (posEl) posEl.textContent = this.formatTimeHMS(this.currentTime);
        if (lenEl) lenEl.textContent = this.formatTimeHMS(this.duration);
        if (endEl) endEl.textContent = this.formatTimeHMS(this.duration);
    }

    formatTimeHMS(seconds) {
        if (!seconds || isNaN(seconds)) return '00:00:00';
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    stopAll() {
        this.isPlaying = false;
        this.stopPlaybackTimer();
        this.tracks.forEach(track => {
            track.isPlaying = false;
            const audioEl = document.getElementById(`audio_${track.id}`);
            if (audioEl) {
                audioEl.pause();
                audioEl.currentTime = 0;
                audioEl.volume = track.muted ? 0 : track.volume / 100;
            }
        });
        this.currentTime = 0;
        this.updateTimeDisplay();
        this.renderApp();
    }

    rewind() {
        this.stopAll();
    }

    async mixAll() {
        const audioTracks = this.tracks.filter(t => t.audioUrl && !t.muted);
        if (audioTracks.length === 0) {
            alert('Adicione pelo menos uma track com audio para mixar');
            return;
        }

        try {
            if (audioTracks.length === 1) {
                window.open(audioTracks[0].audioUrl, '_blank');
                return;
            }

            alert(`Mixando ${audioTracks.length} track(s)...\n\n(Exportacao de mix completo em desenvolvimento. Para agora, voce pode baixar cada track individualmente)`);
            
            this.tracks.forEach(track => {
                if (track.audioUrl && !track.muted) {
                    console.log(`Track: ${track.name}, Volume: ${track.volume}%, Type: ${track.type}`);
                }
            });

        } catch (error) {
            console.error('Erro ao mixar:', error);
            alert('Erro ao mixar tracks: ' + error.message);
        }
    }

    exportMix() {
        const audioTracks = this.tracks.filter(t => t.audioUrl);
        if (audioTracks.length === 0) {
            alert('Adicione pelo menos uma track com audio para exportar');
            return;
        }
        
        if (audioTracks.length === 1) {
            window.open(audioTracks[0].audioUrl, '_blank');
        } else {
            alert(`Exportacao de mix com ${audioTracks.length} tracks em desenvolvimento!\n\nPara agora, voce pode baixar cada track individualmente.`);
        }
    }

    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
}

const minidawStyles = `
    .minidaw-app-layout {
        display: grid;
        grid-template-columns: 380px 1fr;
        gap: 1.5rem;
        height: calc(100vh - 140px);
        min-height: 600px;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    }

    .generator-panel {
        background: rgba(30, 41, 59, 0.95);
        border: 1px solid #334155;
        border-radius: 12px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        backdrop-filter: blur(10px);
    }

    .panel-header {
        background: linear-gradient(135deg, #6366f1, #8b5cf6);
        padding: 1rem 1.25rem;
        color: white;
    }

    .panel-header h3 {
        margin: 0;
        font-size: 1.1rem;
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .panel-content {
        padding: 1.25rem;
        flex: 1;
        overflow-y: auto;
    }

    .form-group {
        margin-bottom: 1.25rem;
    }

    .form-group label {
        display: block;
        color: #94a3b8;
        margin-bottom: 0.5rem;
        font-weight: 500;
        font-size: 0.9rem;
    }

    .form-control {
        width: 100%;
        padding: 0.75rem;
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 8px;
        color: #f1f5f9;
        font-size: 0.95rem;
        transition: all 0.2s ease;
    }

    .form-control:focus {
        outline: none;
        border-color: #6366f1;
        box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
    }

    .quick-actions {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        margin-top: 1.5rem;
    }

    .daw-panel {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .time-display-panel {
        background: #0f172a;
        border: 1px solid #334155;
        border-radius: 8px;
        padding: 0.75rem 1.5rem;
        margin-bottom: 1rem;
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 1rem;
        font-family: 'Courier New', monospace;
    }

    .time-display-item {
        text-align: center;
    }

    .time-display-label {
        color: #64748b;
        font-size: 0.75rem;
        margin-bottom: 0.25rem;
        text-transform: uppercase;
        letter-spacing: 1px;
    }

    .time-display-value {
        color: #f1f5f9;
        font-size: 1.75rem;
        font-weight: 700;
        letter-spacing: 2px;
    }

    .minidaw-transport {
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: rgba(30, 41, 59, 0.9);
        padding: 1rem 1.5rem;
        border-radius: 12px;
        border: 1px solid #334155;
        backdrop-filter: blur(10px);
    }

    .transport-left, .transport-right {
        display: flex;
        gap: 0.75rem;
    }

    .transport-center {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        margin: 0 2rem;
    }

    .time-display {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 0.5rem;
        color: #94a3b8;
        font-weight: 600;
        font-family: 'Courier New', monospace;
    }

    .current-time {
        color: #6366f1;
    }

    .progress-bar-container {
        width: 100%;
        height: 8px;
        background: #334155;
        border-radius: 4px;
        overflow: hidden;
    }

    .progress-bar {
        height: 100%;
        background: linear-gradient(90deg, #6366f1, #8b5cf6);
        border-radius: 4px;
        transition: width 0.1s linear;
    }

    .transport-btn {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        border: none;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s ease;
        font-size: 1.25rem;
    }

    .play-btn {
        background: linear-gradient(135deg, #6366f1, #8b5cf6);
        color: white;
    }

    .play-btn:hover {
        transform: scale(1.1);
        box-shadow: 0 4px 15px rgba(99, 102, 241, 0.4);
    }

    .play-btn.playing {
        background: linear-gradient(135deg, #ef4444, #dc2626);
    }

    .stop-btn {
        background: #475569;
        color: white;
    }

    .stop-btn:hover {
        background: #ef4444;
        transform: scale(1.1);
    }

    .rewind-btn {
        background: #475569;
        color: white;
    }

    .rewind-btn:hover {
        background: #3b82f6;
        transform: scale(1.1);
    }

    .minidaw-tracks {
        background: rgba(30, 41, 59, 0.9);
        border-radius: 12px;
        border: 1px solid #334155;
        backdrop-filter: blur(10px);
        overflow: hidden;
        flex: 1;
        display: flex;
        flex-direction: column;
    }

    .tracks-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1rem 1.5rem;
        border-bottom: 1px solid #334155;
        background: rgba(15, 23, 42, 0.5);
    }

    .track-header-title {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        color: #f1f5f9;
        font-weight: 600;
        font-size: 1.1rem;
    }

    .track-header-info {
        color: #94a3b8;
        font-size: 0.875rem;
    }

    .tracks-container {
        flex: 1;
        overflow-y: auto;
    }

    .track-item {
        display: grid;
        grid-template-columns: 280px 1fr 200px;
        gap: 1rem;
        padding: 1rem 1.5rem;
        background: rgba(15, 23, 42, 0.3);
        border-bottom: 1px solid #334155;
        transition: background 0.2s ease;
    }

    .track-item:hover {
        background: rgba(99, 102, 241, 0.1);
    }

    .track-left {
        display: flex;
        align-items: center;
        gap: 1rem;
    }

    .track-icon {
        width: 48px;
        height: 48px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.5rem;
    }

    .track-info {
        flex: 1;
        min-width: 0;
    }

    .track-name {
        color: #f1f5f9;
        font-weight: 600;
        font-size: 0.95rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .track-type {
        font-size: 0.75rem;
        margin-top: 0.25rem;
    }

    .track-controls-left {
        display: flex;
        gap: 0.5rem;
    }

    .track-center {
        display: flex;
        align-items: center;
    }

    .waveform-container {
        width: 100%;
        height: 80px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
    }

    .waveform-placeholder {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        color: #64748b;
    }

    .track-right {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .volume-control {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .volume-control i {
        color: #94a3b8;
        width: 16px;
    }

    .volume-control input[type="range"] {
        flex: 1;
    }

    .volume-value {
        color: #94a3b8;
        font-size: 0.75rem;
        width: 36px;
        text-align: right;
        font-family: 'Courier New', monospace;
    }

    .track-controls-right {
        display: flex;
        gap: 0.5rem;
        justify-content: flex-end;
    }

    .control-btn {
        width: 36px;
        height: 36px;
        border-radius: 8px;
        border: 1px solid #334155;
        background: #1e293b;
        color: #94a3b8;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .control-btn:hover {
        background: #334155;
        color: #f1f5f9;
    }

    .control-btn.active {
        background: #6366f1;
        border-color: #6366f1;
        color: white;
    }

    .control-btn.danger:hover {
        background: #ef4444;
        border-color: #ef4444;
        color: white;
    }

    .control-btn.play.active {
        background: #10b981;
        border-color: #10b981;
    }

    .btn {
        padding: 0.625rem 1.25rem;
        border-radius: 8px;
        border: none;
        cursor: pointer;
        font-weight: 600;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        transition: all 0.2s ease;
        font-size: 0.9rem;
    }

    .btn-primary {
        background: linear-gradient(135deg, #3b82f6, #1d4ed8) !important;
        border: none !important;
        color: white !important;
    }

    .btn-primary:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
    }

    .btn-purple {
        background: linear-gradient(135deg, #8b5cf6, #6d28d9);
        color: white;
    }

    .btn-purple:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(139, 92, 246, 0.4);
    }

    .btn-green {
        background: linear-gradient(135deg, #10b981, #059669);
        color: white;
    }

    .btn-green:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
    }

    .btn-export {
        background: linear-gradient(135deg, #6366f1, #8b5cf6);
        color: white;
    }

    .btn-export:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
    }

    .empty-state {
        text-align: center;
        padding: 4rem 2rem;
        color: #94a3b8;
    }

    .empty-icon {
        margin-bottom: 1.5rem;
        opacity: 0.5;
    }

    .empty-state h3 {
        color: #cbd5e1;
        margin-bottom: 0.5rem;
    }

    .empty-state p {
        margin-bottom: 1.5rem;
    }

    @media (max-width: 1200px) {
        .minidaw-app-layout {
            grid-template-columns: 1fr;
        }
    }
`;

const styleEl = document.createElement('style');
styleEl.textContent = minidawStyles;
document.head.appendChild(styleEl);

let minidawReact;
window.minidawReact = null;
document.addEventListener('DOMContentLoaded', function() {
    minidawReact = new MiniDAWReactApp();
    window.minidawReact = minidawReact;
    console.log('MiniDAW React carregado!');
});

window.generateVoiceFromHeader = function() {
    if (window.minidawReact) {
        window.minidawReact.generateVoiceFromHeader();
    } else {
        alert('MiniDAW nao esta carregada');
    }
};
