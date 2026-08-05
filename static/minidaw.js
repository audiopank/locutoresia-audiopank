// Marcador de versão. Existe por um motivo prático: quando um controle novo
// "não aparece", a primeira pergunta é sempre se o navegador está rodando o
// arquivo novo ou uma cópia velha do cache. Abra o console (F12) e leia.
// Suba este número junto com o ?v= do minidaw.html a cada mudança visível.
const MINIDAW_VERSAO = 36;
console.log(`%c MiniDAW v${MINIDAW_VERSAO} carregada `,
            'background:#ec4899;color:#fff;font-weight:bold;padding:2px 6px;border-radius:3px');

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
        this.playbackBase = null;   // t=0 do projeto no relógio do AudioContext (null = parado)
        // ── TIMELINE ─────────────────────────────────────────────────────
        // Escala ÚNICA de tempo (px por segundo) compartilhada por régua e
        // todas as pistas — sem ela "10 segundos" teria tamanhos diferentes em
        // cada faixa e arrastar entre faixas não teria sentido geométrico.
        this.pxPorSegundo = 24;
        this.clipDrag = null;     // estado do arrasto em andamento (Task 7)
        this.clipTrim = false;    // trim em andamento (guard dos atalhos)
        this.cursorTempo = null;  // tempo do projeto sob o mouse (linha de corte)
        this.cursorLane = null;   // trackId da lane sob o mouse
        // Undo/redo de CLIPS (só posições/cortes/trims — efeitos ficam fora;
        // Encurtar Pausas tem o próprio Desfazer). Snapshots são baratos:
        // cópia rasa dos objetos clip, buffers por referência.
        this.undoClips = [];      // pilha de snapshots (cap 30)
        this.redoClips = [];
        this.globalZoom = 1;
        this.autoFadeEnabled = true;
        // ⚠️ autoFadeDuration NÃO está ligado em nada — o código usa 2.02 fixo em
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

        // Atalhos de precisão (pedido do produtor, estilo Samplitude):
        // D ou T = dividir o clip sob a linha de corte, no ponto exato.
        // Não dispara digitando em campo de texto (nome da faixa, roteiro...).
        document.addEventListener('keydown', (e) => {
            const alvo = e.target;
            if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.isContentEditable)) return;
            // Gesto de mouse em andamento: mexer nos clips por baixo dele
            // cometeria um objeto órfão no soltar. Atalhos esperam.
            if (this.clipDrag || this.clipTrim) return;
            const k = e.key.toLowerCase();
            // Ctrl+Z/Ctrl+Y (e Ctrl+Shift+Z) desfazem/refazem edições de clips.
            // Fica ANTES do guard geral de ctrl/meta/alt porque aquele guard
            // existe pra deixar D/T (sem modificador) passarem batido — aqui é
            // o oposto: só entra quando HÁ ctrl/meta.
            if ((e.ctrlKey || e.metaKey) && !e.altKey) {
                if (k === 'z' && !e.shiftKey) { e.preventDefault(); this.desfazerClips(); return; }
                if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); this.refazerClips(); return; }
                return;   // outros Ctrl+... seguem pro navegador (ex.: Ctrl+C)
            }
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            if ((k === 'd' || k === 't') && this.cursorLane != null && this.cursorTempo != null) {
                e.preventDefault();
                this.cutTrackAtTime(this.cursorLane, this.cursorTempo);
            }
            if ((e.key === 'Delete' || e.key === 'Backspace') && this.cursorLane != null && this.cursorTempo != null) {
                e.preventDefault();
                this.deletarClipNoPonto(this.cursorLane, this.cursorTempo);
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
                limiter: true,
                gate: false
            },
            // Sensibilidade do gate em % do pico: quanto MAIOR, mais coisa
            // vira pausa e mais respiração some — mas passar do ponto começa
            // a comer o comecinho das palavras. Acha-se de ouvido.
            gateSettings: { sensibilidade: 12 },
            // Modo compacto: recolhe sliders/efeitos e deixa só cabeçalho +
            // timeline — com vários tracks é o único jeito de ver tudo de uma vez.
            compacto: false,
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
        trackCard.className = 'track-card' + (track.compacto ? ' compacta' : '');
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
                    <button class="btn btn-sm btn-outline-light" onclick="minidaw.alternarCompacto('${track.id}')"
                            title="${track.compacto ? 'Expandir efeitos' : 'Recolher efeitos (só timeline)'}">
                        <i class="fas fa-chevron-${track.compacto ? 'down' : 'up'}"></i>
                    </button>
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
                <div class="clips-lane" id="lane_${track.id}">
                    <div class="lane-conteudo">
                        <!-- Guia do corte da Tesoura (agora dentro da lane) -->
                        <div class="sel-regiao" id="selreg_${track.id}"></div>
                        <div class="sel-haste sel-haste-ini" id="selini_${track.id}"></div>
                        <div class="sel-haste sel-haste-fim" id="selfim_${track.id}"></div>
                    </div>
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

        // A lane nasce vazia; os blocos entram no próximo quadro (o canvas
        // recém-inserido mede 0 agora — mesmo motivo do drawWaveform antigo).
        if (track.audioBuffer) requestAnimationFrame(() => this.renderizarTimeline());
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
        delayFeedback.gain.value = 0.06;
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
            nodes.delayMix.gain.value = track.effects.delay ? 0.12 : 0;
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
        // Por CLIPS: os trechos saem já na posição do projeto, e o gate fecha
        // também nos BURACOS entre clips (não tem fala lá mesmo).
        const clips = this._clipsDaFaixa(track);
        const trechos = MixEngine.detectarTrechosDeClips(clips, 0.25, sens);
        MixEngine.aplicarGate(param, trechos, this._fimDaFaixa(track), quando, g);
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
        if (nodes && this.isPlaying && this.playbackBase != null) this.agendarGate(track, nodes, this.playbackBase);
        clearTimeout(this._gateSaveTimer);
        this._gateSaveTimer = setTimeout(() => this.saveToLocalStorage(), 300);
    }

    // ── TIMELINE: régua + blocos de clip ─────────────────────────────────
    _larguraDaTimeline() {
        // Sempre um respiro à direita pra ter onde soltar clip no fim.
        return Math.max(60, (this.duration + 10) * this.pxPorSegundo);
    }

    desenharRegua() {
        const regua = document.getElementById('timelineRegua');
        if (!regua) return;
        const largura = this._larguraDaTimeline();
        // Marca a cada 5s (a cada 1s com zoom alto).
        const passo = this.pxPorSegundo >= 60 ? 1 : 5;
        let html = '';
        for (let t = 0; t * this.pxPorSegundo <= largura; t += passo) {
            html += `<div class="marca" style="left:${t * this.pxPorSegundo}px">${this.formatTime(t)}</div>`;
        }
        regua.innerHTML = html;
    }

    // Posiciona a linha de corte em TODAS as lanes no tempo sob o mouse.
    desenharLinhaDeCorte() {
        const t = this.cursorTempo;
        const px = (t != null) ? (t * this.pxPorSegundo) + 'px' : null;
        document.querySelectorAll('.clips-lane .linha-corte').forEach(linha => {
            if (px == null) { linha.style.display = 'none'; return; }
            linha.style.display = 'block';
            linha.style.left = px;
            const rotulo = linha.querySelector('.linha-tempo');
            if (rotulo) rotulo.textContent = t.toFixed(2) + 's';
        });
    }

    // Redesenha os blocos de clip de UMA faixa dentro da lane dela.
    renderizarClips(track) {
        const lane = document.getElementById(`lane_${track.id}`);
        if (!lane) return;
        if (!lane._scrollSync) {
            lane._scrollSync = true;
            // Timeline tem UMA escala; o scroll também precisa ser um só —
            // lane rolada sozinha desalinha da régua e mata o arrasto entre faixas.
            lane.addEventListener('scroll', () => {
                if (this._syncandoScroll) return;
                this._syncandoScroll = true;
                const x = lane.scrollLeft;
                document.querySelectorAll('.clips-lane').forEach(l => { if (l !== lane) l.scrollLeft = x; });
                const regua = document.getElementById('timelineRegua');
                if (regua) regua.scrollLeft = x;
                this._syncandoScroll = false;
            });
        }
        // Linha de corte: uma por lane, seguindo o mouse em TODAS as lanes ao
        // mesmo tempo — o produtor enxerga o ponto exato antes do D/T dividir.
        if (!lane._linhaCorte) {
            lane._linhaCorte = true;
            lane.addEventListener('mousemove', (e) => {
                this.cursorTempo = this._tempoNoPonto(e, track);
                this.cursorLane = track.id;
                this.desenharLinhaDeCorte();
            });
            lane.addEventListener('mouseleave', () => {
                if (this.cursorLane === track.id) {
                    this.cursorTempo = null;
                    this.cursorLane = null;
                    this.desenharLinhaDeCorte();
                }
            });
        }
        const conteudo = lane.querySelector('.lane-conteudo');
        if (!conteudo) return;
        conteudo.style.width = this._larguraDaTimeline() + 'px';
        if (!conteudo.querySelector('.linha-corte')) {
            const linha = document.createElement('div');
            linha.className = 'linha-corte';
            linha.innerHTML = '<span class="linha-tempo"></span>';
            conteudo.appendChild(linha);
        }
        // Remove só os blocos de clip — as guias da Tesoura (selreg_/selini_/
        // selfim_) moram na mesma lane e precisam sobreviver ao redesenho.
        conteudo.querySelectorAll('.clip-bloco').forEach(el => el.remove());
        for (const clip of this._clipsDaFaixa(track)) {
            const el = document.createElement('div');
            el.className = 'clip-bloco';
            el.id = `clip_el_${clip.id}`;
            el.style.left = (clip.inicio * this.pxPorSegundo) + 'px';
            el.style.width = Math.max(8, clip.duracao * this.pxPorSegundo) + 'px';
            el.innerHTML = `
                <canvas></canvas>
                <div class="clip-alca ini" data-borda="ini"></div>
                <div class="clip-alca fim" data-borda="fim"></div>`;
            const nome = document.createElement('span');
            nome.className = 'clip-nome';
            nome.textContent = track.name;   // textContent: nome é DADO, não HTML (XSS recorrente da casa)
            el.appendChild(nome);
            el.addEventListener('mousedown', (ev) => this.mousedownClip(ev, track.id, clip.id));
            conteudo.appendChild(el);
            this.desenharOndaDoClip(track, clip, el.querySelector('canvas'));
        }
    }

    // Waveform da JANELA do clip (offset..offset+duracao) — mesmo algoritmo
    // de envelope min/max por coluna do drawWaveform clássico.
    desenharOndaDoClip(track, clip, canvas) {
        // isConnected: o retry por RAF não pode continuar pra sempre se o
        // bloco foi removido do DOM (renderizarClips recria tudo a cada redesenho).
        if (!canvas || !canvas.isConnected || !clip.buffer) return;
        const width = Math.floor(canvas.offsetWidth);
        const height = Math.floor(canvas.offsetHeight);
        if (!width || !height) {
            requestAnimationFrame(() => this.desenharOndaDoClip(track, clip, canvas));
            return;
        }
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        const dados = clip.buffer.getChannelData(0);
        const sr = clip.buffer.sampleRate;
        const a0 = Math.floor(clip.offset * sr);
        const a1 = Math.min(dados.length, Math.floor((clip.offset + clip.duracao) * sr));
        const meio = height / 2;
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = 'rgba(255,255,255,.18)';
        ctx.fillRect(0, Math.round(meio), width, 1);
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        const amostrasPorPixel = (a1 - a0) / width;
        for (let px = 0; px < width; px++) {
            const ini = a0 + Math.floor(px * amostrasPorPixel);
            const fim = Math.min(a0 + Math.floor((px + 1) * amostrasPorPixel), a1);
            if (fim <= ini) continue;
            let min = 1.0, max = -1.0;
            for (let i = ini; i < fim; i++) {
                const v = dados[i];
                if (v < min) min = v;
                if (v > max) max = v;
            }
            const topo = meio - max * meio;
            ctx.fillRect(px, topo, 1, Math.max(1, (max - min) * meio));
        }
    }

    // ── ARRASTO DE CLIP (tempo + entre faixas) ───────────────────────────
    // Um handler só decide o gesto pelo alvo: alça = trim (Task 9), corpo com
    // Tesoura armada = seleção de corte, corpo normal = arrastar.
    mousedownClip(ev, trackId, clipId) {
        if (this.clipDrag) return;   // drag anterior ainda ativo (mouseup perdido)
        const track = this.tracks.find(t => t.id === trackId);
        if (!track) return;
        const clip = this._clipsDaFaixa(track).find(c => c.id === clipId);
        if (!clip) return;

        const borda = ev.target.dataset && ev.target.dataset.borda;
        if (borda) {
            // Alça de trim — Task 9 implementa; até lá, ignora o clique.
            if (typeof this.iniciarTrim === 'function') this.iniciarTrim(ev, track, clip, borda);
            return;
        }
        if (this.trackTesoura === trackId) return this.iniciarSelecao(ev, trackId);

        ev.preventDefault();
        const el = document.getElementById(`clip_el_${clip.id}`);
        if (!el) return;
        const x0 = ev.clientX, y0 = ev.clientY;
        const inicioOriginal = clip.inicio;
        const snapshotPreDrag = this._snapshotClips();
        this.clipDrag = { track, clip, moveu: false };
        el.classList.add('arrastando');

        const mover = (e) => {
            if (!(e.buttons & 1)) return soltar();   // mouseup aconteceu fora da janela
            const dx = e.clientX - x0;
            if (!this.clipDrag.moveu && Math.abs(dx) < 3 && Math.abs(e.clientY - y0) < 3) return;
            this.clipDrag.moveu = true;

            // Alvos do imã: bordas dos OUTROS clips (todas as faixas), 0:00 e
            // o cursor de reprodução — igual ao "Snap to objects" do Samplitude.
            // Também as posições onde o FIM deste clip encosta numa borda.
            const alvos = [0, this.currentTime || 0];
            for (const t of this.tracks) {
                for (const c of this._clipsDaFaixa(t)) {
                    if (c.id === clip.id) continue;
                    alvos.push(c.inicio, ClipModel.fimDoClip(c));
                    alvos.push(c.inicio - clip.duracao, ClipModel.fimDoClip(c) - clip.duracao);
                }
            }
            const tol = 8 / this.pxPorSegundo;    // 8px de imã, em segundos
            let novoInicio = ClipModel.calcularSnap(
                Math.max(0, inicioOriginal + dx / this.pxPorSegundo), alvos, tol);

            // Faixa de destino: a lane sob o mouse (vertical).
            const alvo = document.elementFromPoint(e.clientX, e.clientY);
            const laneAlvo = alvo && alvo.closest ? alvo.closest('.clips-lane') : null;
            const idAlvo = laneAlvo ? laneAlvo.id.replace('lane_', '') : track.id;
            this.clipDrag.trackAlvoId = idAlvo;

            const faixaAlvo = this.tracks.find(t => t.id === idAlvo) || track;
            const clipsAlvo = (faixaAlvo === track)
                ? this._clipsDaFaixa(track)
                : this._clipsDaFaixa(faixaAlvo).concat([clip]);
            novoInicio = ClipModel.moverClip(clipsAlvo, clip, novoInicio);

            clip.inicio = novoInicio;
            el.style.left = (novoInicio * this.pxPorSegundo) + 'px';
            document.querySelectorAll('.clips-lane').forEach(l =>
                l.style.outline = (l.id === `lane_${idAlvo}` && idAlvo !== track.id)
                    ? '2px dashed #ec4899' : '');
        };

        const soltar = () => {
            document.removeEventListener('mousemove', mover);
            document.removeEventListener('mouseup', soltar);
            el.classList.remove('arrastando');
            document.querySelectorAll('.clips-lane').forEach(l => l.style.outline = '');
            const d = this.clipDrag; this.clipDrag = null;
            if (!d || !d.moveu) return;
            this._guardarUndo(snapshotPreDrag);

            if (d.trackAlvoId && d.trackAlvoId !== track.id) {
                this.moverClipParaFaixa(track, clip, d.trackAlvoId, inicioOriginal);
            } else {
                track.clips = ClipModel.ordenarClips(this._clipsDaFaixa(track));
                if (ClipModel.temSobreposicao(track.clips, clip)) {
                    // Vão menor que o clip: volta pra onde estava (não comete overlap).
                    clip.inicio = inicioOriginal;
                    track.clips = ClipModel.ordenarClips(track.clips);
                }
                this.aposMudancaDeClips([track]);
            }
        };
        document.addEventListener('mousemove', mover);
        document.addEventListener('mouseup', soltar);
    }

    // ── TRIM PELAS BORDAS (não-destrutivo) ───────────────────────────────
    // Encurtar esconde áudio (offset/duracao); esticar de volta recupera —
    // o arquivo nunca muda. A validação de vizinho usa temSobreposicao:
    // borda não invade clip do lado.
    iniciarTrim(ev, track, clip, borda) {
        ev.preventDefault();
        ev.stopPropagation();
        if (this.clipDrag) return;      // arrasto em andamento (mouseup perdido)
        const el = document.getElementById(`clip_el_${clip.id}`);
        if (!el) return;
        this.clipTrim = true;
        const canvas = el.querySelector('canvas');
        let moveu = false;
        const snapshotPreTrim = this._snapshotClips();

        const mover = (e) => {
            if (!(e.buttons & 1)) return soltar();   // mouseup fora da janela
            const lane = document.getElementById(`lane_${track.id}`);
            if (!lane) return;
            const conteudo = lane.querySelector('.lane-conteudo');
            if (!conteudo) return;
            const r = conteudo.getBoundingClientRect();
            const t = (e.clientX - r.left) / this.pxPorSegundo;

            // Imã nas bordas dos outros clips + 0 + cursor de reprodução.
            const alvos = [0, this.currentTime || 0];
            for (const tr of this.tracks) {
                for (const c of this._clipsDaFaixa(tr)) {
                    if (c.id === clip.id) continue;
                    alvos.push(c.inicio, ClipModel.fimDoClip(c));
                }
            }
            const ajustado = ClipModel.calcularSnap(t, alvos, 8 / this.pxPorSegundo);

            const novo = ClipModel.aplicarTrim(clip, borda, ajustado);
            // Borda não pode invadir o clip vizinho.
            if (ClipModel.temSobreposicao(this._clipsDaFaixa(track), Object.assign({}, novo, { id: clip.id }))) return;

            moveu = true;
            Object.assign(clip, novo, { id: clip.id });   // muta in-place, id fica
            el.style.left = (clip.inicio * this.pxPorSegundo) + 'px';
            el.style.width = Math.max(8, clip.duracao * this.pxPorSegundo) + 'px';
            this.desenharOndaDoClip(track, clip, canvas);
        };
        const soltar = () => {
            this.clipTrim = false;
            document.removeEventListener('mousemove', mover);
            document.removeEventListener('mouseup', soltar);
            if (!moveu) return;      // clique seco: nada mudou, nada a fazer
            this._guardarUndo(snapshotPreTrim);
            this._sincronizarDerivados(track);
            this.aposMudancaDeClips([track]);
        };
        document.addEventListener('mousemove', mover);
        document.addEventListener('mouseup', soltar);
    }

    // Move o clip pra outra faixa. O clip HERDA o canal de destino: efeitos,
    // volume e o TIPO (voz→trilha muda ducking) são da faixa, não do clip.
    // `inicioOriginal` é a posição de partida — se não couber no destino sem
    // overlap, o clip devolve pra origem nessa posição em vez de commitar.
    moverClipParaFaixa(origem, clip, destinoId, inicioOriginal) {
        const destino = this.tracks.find(t => t.id === destinoId);
        if (!destino) return;
        // Capturado ANTES de tocar em origem.clips: se precisar devolver, usa
        // esta lista (sem o clip) em vez de reconsultar _clipsDaFaixa, que
        // regeneraria um clip novo do buffer inteiro se origem tivesse ficado
        // vazia (audioBuffer ainda não foi zerado neste ponto).
        const origemSemClip = this._clipsDaFaixa(origem).filter(c => c.id !== clip.id);
        const clipsDestino = this._clipsDaFaixa(destino);
        clip.inicio = ClipModel.moverClip(clipsDestino.concat([clip]), clip, clip.inicio);
        if (ClipModel.temSobreposicao(clipsDestino.concat([clip]), clip)) {
            // Não coube no destino: devolve pra origem, na posição de partida.
            clip.inicio = (inicioOriginal != null) ? inicioOriginal : 0;
            origem.clips = ClipModel.ordenarClips(origemSemClip.concat([clip]));
            this._sincronizarDerivados(origem);
            this.aposMudancaDeClips([origem]);
            return;
        }
        origem.clips = origemSemClip;
        destino.clips = ClipModel.ordenarClips(clipsDestino.concat([clip]));
        // Sincroniza os campos derivados legados dos DOIS lados.
        this._sincronizarDerivados(origem);
        this._sincronizarDerivados(destino);
        if (!origem.clips.length) this.updateTrackUI(origem);   // vira drop-zone de verdade
        this.aposMudancaDeClips([origem, destino]);
    }

    // Campos legados derivados dos clips — o resto do arquivo (e o export)
    // ainda lê audioBuffer/duration da faixa.
    _sincronizarDerivados(track) {
        const clips = track.clips || [];
        track.audioBuffer = clips.length ? clips[0].buffer : null;
        track._clipsBuffer = track.audioBuffer;
        track.duration = ClipModel.fimDaFaixa(clips);
        // Card decide lane vs drop-zone pelo audioUrl: faixa que ganhou clip
        // por arrasto precisa de um marcador truthy, senão Mute/Solo recriam o
        // card como drop-zone com áudio dentro.
        if (clips.length && !track.audioUrl) track.audioUrl = 'clips://local';
        if (!clips.length) track.audioUrl = null;
    }

    // Pós-edição de clips: re-render + reagendamento se estiver tocando +
    // persistência local. UMA porta de saída pra todos os gestos.
    aposMudancaDeClips(faixas) {
        this.renderizarTimeline();
        if (this.isPlaying) {
            // stop() zera currentTime; preserva a posição pra não jogar o
            // produtor de volta pro início ao arrastar de ouvido.
            const pos = this.currentTime;
            this.stop();
            this.currentTime = pos;
            this.play();
        } else {
            // Ducking/gate agendados mudaram de lugar — limpa pro próximo play.
            for (const t of (faixas || [])) {
                const nodes = this.trackNodes.get(t.id);
                if (nodes) this.aplicarVolumeAgora(t, nodes);
            }
        }
        this.saveToLocalStorage();
    }

    // ── UNDO/REDO DE CLIPS ───────────────────────────────────────────────
    _snapshotClips() {
        return this.tracks.map(t => ({
            trackId: t.id,
            clips: (t.clips || []).map(c => Object.assign({}, c))
        }));
    }

    // Empilha um snapshot tirado ANTES da mutação. Sempre zera o redo:
    // edição nova invalida o "refazer" (comportamento padrão de editor).
    _guardarUndo(snapshot) {
        this.undoClips.push(snapshot);
        if (this.undoClips.length > 30) this.undoClips.shift();
        this.redoClips = [];
    }

    _restaurarSnapshotClips(snap) {
        const afetadas = [];
        for (const entrada of snap) {
            const track = this.tracks.find(t => t.id === entrada.trackId);
            if (!track) continue;   // faixa removida depois do snapshot: ignora
            const tinhaLane = !!document.getElementById(`lane_${track.id}`);
            track.clips = entrada.clips.map(c => Object.assign({}, c));
            this._sincronizarDerivados(track);
            // Card decide lane vs drop-zone no HTML estático do createTrackUI:
            // se o restore mudou o estado (vazia↔com clips), reconstrói o card,
            // senão o undo fica certo nos dados e invisível na tela.
            if (tinhaLane !== (track.clips.length > 0)) this.updateTrackUI(track);
            afetadas.push(track);
        }
        this.aposMudancaDeClips(afetadas);
    }

    desfazerClips() {
        if (!this.undoClips.length) {
            this.showNotification('Nada para desfazer', 'info');
            return;
        }
        this.redoClips.push(this._snapshotClips());
        this._restaurarSnapshotClips(this.undoClips.pop());
        this.showNotification('Desfeito', 'info');
    }

    refazerClips() {
        if (!this.redoClips.length) {
            this.showNotification('Nada para refazer', 'info');
            return;
        }
        this.undoClips.push(this._snapshotClips());
        this._restaurarSnapshotClips(this.redoClips.pop());
        this.showNotification('Refeito', 'info');
    }

    // Delete/Backspace: apaga o clip sob a linha de corte. As "sobras" de
    // edição (farelos de divisão, pedaços que não vão pro spot) saem com uma
    // tecla — e Ctrl+Z desfaz, então não precisa de confirmação.
    deletarClipNoPonto(trackId, tempo) {
        const track = this.tracks.find(t => t.id === trackId);
        if (!track || !track.audioBuffer) return;
        const clips = this._clipsDaFaixa(track);
        const clip = ClipModel.clipNoPonto(clips, tempo);
        if (!clip) {
            this.showNotification('Nenhum clip sob a linha de corte', 'info');
            return;
        }
        this._guardarUndo(this._snapshotClips());
        track.clips = clips.filter(c => c.id !== clip.id);
        this._sincronizarDerivados(track);
        // Faixa esvaziou: o card precisa virar drop-zone (mesma regra do
        // cross-move e do undo).
        if (!track.clips.length) this.updateTrackUI(track);
        this.aposMudancaDeClips([track]);
        this.showNotification('Clip removido — Ctrl+Z desfaz', 'success');
    }

    // Redesenha timeline inteira (régua + todas as lanes). Chamar depois de
    // qualquer mudança de clip, zoom ou duração.
    _renderizarTimelineAgora() {
        this.calculateDuration();
        this.desenharRegua();
        // TODAS as faixas, mesmo sem áudio: uma faixa que perdeu o último clip
        // (arrasto pra outra faixa) precisa limpar os blocos velhos da lane —
        // renderizarClips com _clipsDaFaixa vazio já remove sem desenhar nada.
        for (const t of this.tracks) this.renderizarClips(t);
    }

    // Coalescência: várias chamadas no mesmo tick (import, updateTrackUI,
    // drawWaveform legado) viram UM redesenho no próximo quadro — redesenhar a
    // timeline inteira 3x por import era só desperdício.
    renderizarTimeline() {
        if (this._timelineAgendada) return;
        this._timelineAgendada = true;
        requestAnimationFrame(() => {
            this._timelineAgendada = false;
            this._renderizarTimelineAgora();
        });
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
        // A onda agora é desenhada POR CLIP na lane (desenharOndaDoClip).
        // Mantido porque meia dúzia de pontos do arquivo chama drawWaveform
        // depois de mexer no áudio — todos querem dizer "redesenha a faixa".
        this.renderizarTimeline();
    }

    updateTrackName(trackId, name) {
        const track = this.tracks.find(t => t.id === trackId);
        if (track) {
            track.name = name;
            this.saveToLocalStorage();
            this.renderizarTimeline();   // atualiza o nome já escrito nos .clip-nome
        }
    }

    toggleMute(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (track) {
            track.muted = !track.muted;
            this.aplicarVolumeAgora(track, this.trackNodes.get(trackId));
            this.updateTrackUI(track);
            this.saveToLocalStorage();
        }
    }

    toggleSolo(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (track) {
            track.solo = !track.solo;
            // Solo e mute passam pela MESMA agenda central do volume: durante
            // o play, setar .value com ducking marcado não segura — o próximo
            // evento desfaz. aplicarVolumeAgora decide certo nos dois estados.
            this.tracks.forEach(t => {
                this.aplicarVolumeAgora(t, this.trackNodes.get(t.id));
            });
            this.updateTrackUI(track);
            this.saveToLocalStorage();
        }
    }

    updateTrackVolume(trackId, volume) {
        const track = this.tracks.find(t => t.id === trackId);
        if (track) {
            track.volume = volume;
            // Durante o play, mexer direto no .value era briga perdida: o
            // próximo evento agendado do ducking puxava o ganho de volta.
            this.aplicarVolumeAgora(track, this.trackNodes.get(trackId));
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
            // Fades agora moram no CLIP: o slider da faixa controla o primeiro
            // clip (fade de entrada) — comportamento idêntico com 1 clip.
            const clips = this._clipsDaFaixa(track);
            if (clips.length) {
                ClipModel.ordenarClips(clips)[0].fadeIn = track.fadeIn;
            }
            if (this.isPlaying) {
                // stop() zera currentTime; preserva a posição pra não jogar o
                // produtor de volta pro início ao ajustar de ouvido.
                const pos = this.currentTime;
                this.stop();
                this.currentTime = pos;
                this.play();
            }
            this.saveToLocalStorage();
        }
    }

    updateTrackFadeOut(trackId, fadeOut) {
        const track = this.tracks.find(t => t.id === trackId);
        if (track) {
            track.fadeOut = parseFloat(fadeOut);
            const clips = this._clipsDaFaixa(track);
            if (clips.length) {
                const ord = ClipModel.ordenarClips(clips);
                ord[ord.length - 1].fadeOut = track.fadeOut;
            }
            if (this.isPlaying) {
                // stop() zera currentTime; preserva a posição pra não jogar o
                // produtor de volta pro início ao ajustar de ouvido.
                const pos = this.currentTime;
                this.stop();
                this.currentTime = pos;
                this.play();
            }
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
            
            // Stop audio if playing. Sources agora são POR CLIP (array
            // sourceNodes) — parar só o sourceNode antigo deixava o áudio
            // tocando até o fim do clip depois de remover a faixa.
            if (track.audioBuffer) {
                const nodes = this.trackNodes.get(trackId);
                if (nodes) {
                    for (const s of (nodes.sourceNodes || [])) {
                        try { s.stop(); } catch (e) { /* já parado */ }
                    }
                    nodes.sourceNodes = [];
                    if (nodes.sourceNode) {
                        try { nodes.sourceNode.stop(); } catch (e) { /* já parado */ }
                        nodes.sourceNode = null;
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

    // ── CLIPS DA FAIXA (migração preguiçosa) ─────────────────────────────
    // O resto do arquivo seta track.audioBuffer em vários pontos (upload, TTS,
    // biblioteca, projeto reaberto). Em vez de caçar todos, o modelo de clips
    // nasce AQUI: na primeira leitura após o buffer mudar, vira 1 clip cobrindo
    // o arquivo. Operações de timeline (dividir/mover/trim) gravam em
    // track.clips e carimbam _clipsBuffer — enquanto o buffer não trocar de
    // novo, os clips editados valem.
    _clipsDaFaixa(track) {
        if (!track.audioBuffer) { track.clips = []; return track.clips; }
        if (!track.clips || !track.clips.length || track._clipsBuffer !== track.audioBuffer) {
            const c = ClipModel.clipInteiro(track.audioBuffer);
            c.fadeIn = track.fadeIn || 0;
            c.fadeOut = track.fadeOut || 0;
            track.clips = [c];
            track._clipsBuffer = track.audioBuffer;
        }
        return track.clips;
    }

    // Fim da última posição de áudio da faixa (tempo do PROJETO). Substitui o
    // track.duration "do arquivo" nos cálculos de duração/gate/fade.
    _fimDaFaixa(track) {
        return ClipModel.fimDaFaixa(this._clipsDaFaixa(track));
    }

    // Todos os clips de VOZ do projeto, no formato do detectarTrechosDeClips.
    _clipsDeVoz() {
        const clips = [];
        for (const t of this.tracks) {
            if (t.type !== 'voice' || !t.audioBuffer) continue;
            for (const c of this._clipsDaFaixa(t)) clips.push(c);
        }
        return clips;
    }

    calculateDuration() {
        const faixas = this.tracks
            .filter(t => t.audioBuffer)
            .map(t => ({ type: t.type, clips: this._clipsDaFaixa(t) }));
        this.duration = ClipModel.duracaoDoProjeto(faixas);
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

    // ── AGENDA DE VOLUME (fades + ducking) DE UMA FAIXA ────────────────────
    // Centralizada e começando SEMPRE por cancelScheduledValues: era daqui
    // que vinham os "altos e baixos" do preview — cada play empilhava uma
    // agenda nova de ducking por cima da anterior, e eventos antigos com
    // horário ainda no futuro disparavam no meio da execução seguinte.
    //
    // `base` = instante, no relógio do AudioContext, em que o t=0 do projeto
    // aconteceu. Eventos com horário no passado o navegador executa na hora,
    // em ordem — reagendar tudo pela mesma base "avança o filme" e cai no
    // estado certo, inclusive retomando do meio.
    agendarVolumeDaFaixa(track, nodes, base) {
        // Relógio do AudioContext não aceita tempo negativo. Contexto
        // recém-criado retomando do meio cairia aí — clampa (desvio raro e
        // inofensivo: só atrasa eventos que já passaram).
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
            // Fade final: desce ao zero em 2.02s depois do fim da voz (igual
            // ao export — era 1.05s, apressado demais, ajustado de ouvido).
            g.linearRampToValueAtTime(0, base + fimDaVoz + 2.02);
        }
    }

    // Aplica o estado de volume de UMA faixa do jeito certo pro momento:
    // tocando -> reagenda tudo com o nível novo; parado -> limpa sobras de
    // agenda e seta direto (sem limpar, evento esquecido da sessão anterior
    // desfazia o ajuste do slider).
    aplicarVolumeAgora(track, nodes) {
        if (!nodes || !nodes.gainNode) return;
        if (this.isPlaying && this.playbackBase != null) {
            this.agendarVolumeDaFaixa(track, nodes, this.playbackBase);
        } else {
            const haSolo = this.tracks.some(t => t.solo);
            const silenciada = track.muted || (haSolo && !track.solo);
            nodes.gainNode.gain.cancelScheduledValues(0);
            nodes.gainNode.gain.value = silenciada ? 0 : track.volume / 100;
        }
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

        // Base de tempo: o instante (no relógio do AudioContext) em que o t=0
        // do PROJETO aconteceu (ver comentário do agendarVolumeDaFaixa).
        const base = this.audioContext.currentTime - (this.currentTime || 0);
        this.playbackBase = base;

        // Um BufferSource POR CLIP, cada um com seu clipGain (fades do clip).
        // O clipGain é separado do gainNode da faixa de propósito: fades de
        // clip e ducking da faixa no MESMO AudioParam brigariam (regra da casa).
        nodes.sourceNodes = nodes.sourceNodes || [];
        const agora = this.currentTime || 0;
        for (const clip of this._clipsDaFaixa(track)) {
            const fimClip = ClipModel.fimDoClip(clip);
            if (fimClip <= agora) continue;               // clip já passou

            const source = this.audioContext.createBufferSource();
            source.buffer = clip.buffer;

            const clipGain = this.audioContext.createGain();
            const g = clipGain.gain;
            g.setValueAtTime(1, 0);
            if (clip.fadeIn > 0) {
                g.setValueAtTime(0, Math.max(0, base + clip.inicio));
                g.linearRampToValueAtTime(1, Math.max(0, base + clip.inicio + clip.fadeIn));
            }
            if (clip.fadeOut > 0) {
                g.setValueAtTime(1, Math.max(0, base + fimClip - clip.fadeOut));
                g.linearRampToValueAtTime(0, Math.max(0, base + fimClip));
            }

            source.connect(clipGain);
            clipGain.connect(nodes.inputNode);

            if (agora > clip.inicio) {
                // Retomando no meio do clip: entra já andado.
                source.start(0, clip.offset + (agora - clip.inicio), fimClip - agora);
            } else {
                source.start(base + clip.inicio, clip.offset, clip.duracao);
            }
            nodes.sourceNodes.push(source);
        }

        // Gate e volume/ducking: agendas centralizadas — e as duas começam
        // CANCELANDO a agenda anterior (ver agendarVolumeDaFaixa).
        this.agendarGate(track, nodes, base);
        this.agendarVolumeDaFaixa(track, nodes, base);

        // O fim do playback é vigiado pelo updatePlaybackTime (currentTime >=
        // duration) — onended por source não serve mais: cada clip acaba numa
        // hora e o primeiro a acabar pararia o projeto inteiro.
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

        // Stop all clip sources
        this.trackNodes.forEach(nodes => {
            for (const s of (nodes.sourceNodes || [])) {
                try { s.stop(); } catch (e) { /* already stopped */ }
            }
            nodes.sourceNodes = [];
            if (nodes.sourceNode) {           // legado (não deve existir mais)
                try { nodes.sourceNode.stop(); } catch (e) { /* ok */ }
                nodes.sourceNode = null;
            }
        });

        // Zera a base e limpa TODA agenda de ganho: sobra de automação de uma
        // sessão disparava na seguinte — era a fonte dos altos e baixos.
        this.playbackBase = null;
        this.tracks.forEach(t => {
            const n = this.trackNodes.get(t.id);
            if (!n) return;
            if (n.gainNode) {
                n.gainNode.gain.cancelScheduledValues(0);
                n.gainNode.gain.value = t.muted ? 0 : t.volume / 100;
            }
            if (n.gateGain) {
                n.gateGain.gain.cancelScheduledValues(0);
                n.gateGain.gain.value = 1;
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
            // Stop audio if playing. Sources agora são POR CLIP (array
            // sourceNodes) — parar só o sourceNode antigo deixava o áudio
            // tocando até o fim do clip depois de limpar tudo.
            if (track.audioBuffer) {
                const nodes = this.trackNodes.get(track.id);
                if (nodes) {
                    for (const s of (nodes.sourceNodes || [])) {
                        try { s.stop(); } catch (e) { /* já parado */ }
                    }
                    nodes.sourceNodes = [];
                    if (nodes.sourceNode) {
                        try { nodes.sourceNode.stop(); } catch (e) { /* já parado */ }
                        nodes.sourceNode = null;
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

        // Trocar o buffer recola a faixa num clip único (migração preguiçosa):
        // divisões e trims da timeline se perdem. Avisa antes, não impede —
        // Encurtar Pausas continua sendo o jeito certo de tratar a voz CRUA.
        const temEdicaoDeClips = this.tracks.some(t =>
            t.type === 'voice' && t.clips && t.clips.length > 1);
        if (temEdicaoDeClips) {
            this.showNotification('Atenção: Encurtar Pausas junta os clips divididos da voz num só', 'warning');
        }

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
        // Clips podem estar OBSOLETOS se o buffer trocou depois do último play
        // (Encurtar Pausas, corte): a migração preguiçosa só roda na leitura.
        // Refresca aqui pra o export nunca renderizar áudio velho (prévia = arquivo).
        this.tracks.forEach(t => this._clipsDaFaixa(t));
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
                audioBuffer: null,
                // Clips carregam o AudioBuffer (viraria {} no JSON, lixo puro)
                // e _clipsBuffer é só a referência de cache — nenhum dos dois
                // sobrevive a um reload; a migração preguiçosa recria os clips
                // a partir do audioBuffer restaurado.
                clips: undefined,
                _clipsBuffer: undefined
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
            // A onda antiga sumiu; agora o cursor de mira vai na lane de clips.
            const lane = document.getElementById(`lane_${t.id}`);
            if (lane) lane.style.cursor = (this.trackTesoura === t.id) ? 'crosshair' : 'default';
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

    // Recolhe/expande a área de efeitos do card. O estado vive na FAIXA
    // (não no DOM): updateTrackUI recria o card e a classe volta certa.
    alternarCompacto(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (!track) return;
        track.compacto = !track.compacto;
        this.updateTrackUI(track);
        this.saveToLocalStorage();
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
        // Tempo do PROJETO no ponto do mouse — a lane tem escala única, então
        // é só posição/pxPorSegundo (antes era fração da duração da faixa).
        const lane = document.getElementById(`lane_${track.id}`);
        if (!lane) return 0;
        const conteudo = lane.querySelector('.lane-conteudo');
        if (!conteudo) return 0;
        const r = conteudo.getBoundingClientRect();
        return Math.max(0, (ev.clientX - r.left) / this.pxPorSegundo);
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

        if (!s || !track.audioBuffer) {
            reg.style.display = hIni.style.display = hFim.style.display = 'none';
            barra.classList.remove('ativa');
            return;
        }

        // Escala única da timeline: posição absoluta em px, não % da faixa.
        const pIni = s.ini * this.pxPorSegundo;
        const pFim = s.fim * this.pxPorSegundo;
        reg.style.display = (s.fim > s.ini) ? 'block' : 'none';
        reg.style.left = pIni + 'px';
        reg.style.width = (pFim - pIni) + 'px';
        hIni.style.display = hFim.style.display = 'block';
        hIni.style.left = pIni + 'px';
        hFim.style.left = pFim + 'px';

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
    //       'dividir' (parte o clip no início da marcação)
    // Agora NÃO-DESTRUTIVO: nada de copiar buffers — só matemática de clips
    // (offset/duracao). "Restaurar" deixou de precisar de rede de segurança:
    // esticar a borda de volta (trim) recupera o áudio.
    aplicarCorte(trackId, modo) {
        const track = this.tracks.find(t => t.id === trackId);
        const s = (this.selecoes || {})[trackId];
        if (!track || !track.audioBuffer || !s) return;

        const clips = this._clipsDaFaixa(track);
        const snapshotPreCorte = this._snapshotClips();
        const clip = ClipModel.clipNoPonto(clips, s.ini);
        if (!clip) {
            this.showNotification('Marque em cima de um clip (a marcação caiu num buraco)', 'warning');
            return;
        }

        if (modo === 'dividir') {
            const partes = ClipModel.dividirClip(clip, s.ini);
            if (!partes) {
                this.showNotification('Muito perto da borda pra dividir', 'warning');
                return;
            }
            this._guardarUndo(snapshotPreCorte);
            track.clips = ClipModel.ordenarClips(
                clips.filter(c => c.id !== clip.id).concat(partes));
        } else if (modo === 'remover') {
            if (s.fim - s.ini < 0.01) {
                this.showNotification('Arraste sobre a onda pra marcar o trecho primeiro', 'warning');
                return;
            }
            const novos = ClipModel.removerTrecho(clips, clip, s.ini, s.fim);
            if (!novos.length) {
                this.showNotification('Isso apagaria a faixa inteira', 'warning');
                return;
            }
            this._guardarUndo(snapshotPreCorte);
            track.clips = novos;
        } else {   // manter
            if (s.fim - s.ini < 0.01) {
                this.showNotification('Arraste sobre a onda pra marcar o trecho primeiro', 'warning');
                return;
            }
            this._guardarUndo(snapshotPreCorte);
            // Escopo no CLIP alvo, não na faixa: os outros clips (vinheta,
            // assinatura...) ficam onde estão — apagar tudo era o comportamento
            // do mundo 1-faixa-1-arquivo e virou perda de dados no multi-clip.
            track.clips = ClipModel.ordenarClips(
                clips.filter(c => c.id !== clip.id)
                     .concat([ClipModel.manterTrecho(clip, s.ini, s.fim)]));
        }

        this._sincronizarDerivados(track);
        this.cancelarSelecao(trackId);
        this.aposMudancaDeClips([track]);
        const nomes = { dividir: 'Clip dividido em dois', remover: 'Trecho removido', manter: 'Ficou só o trecho marcado' };
        this.showNotification(`${nomes[modo]} — arraste os clips como quiser`, 'success');
    }

    stopPlayback() {
        this.stop();
        this.currentTime = 0;
        this.updatePlaybackTime();
    }

    // ── ZOOM ANCORADO ────────────────────────────────────────────────────
    // O zoom acontece AO REDOR do ponto sob o mouse (linha de corte); sem
    // mouse na timeline, ao redor do centro da vista. Sem âncora, o zoom
    // jogava tudo pra esquerda e o produtor perdia o ponto que estava mirando.
    _zoomAncorado(novoPx) {
        const lane = document.querySelector('.clips-lane');
        let anchorT = null, anchorX = 0;
        if (lane) {
            if (this.cursorTempo != null) {
                anchorT = this.cursorTempo;
                anchorX = anchorT * this.pxPorSegundo - lane.scrollLeft;
            } else {
                anchorX = lane.clientWidth / 2;
                anchorT = (lane.scrollLeft + anchorX) / this.pxPorSegundo;
            }
        }
        this.pxPorSegundo = novoPx;
        // Síncrono de propósito: o scroll novo depende do layout novo — a
        // versão coalescida (RAF) aplicaria o scroll antes do redesenho.
        this._renderizarTimelineAgora();
        if (anchorT != null) {
            const scroll = Math.max(0, anchorT * this.pxPorSegundo - anchorX);
            this._syncandoScroll = true;
            document.querySelectorAll('.clips-lane').forEach(l => { l.scrollLeft = scroll; });
            const regua = document.getElementById('timelineRegua');
            if (regua) regua.scrollLeft = scroll;
            this._syncandoScroll = false;
        }
        this.desenharLinhaDeCorte();
        this.updateZoomIndicator();
    }

    // Zoom functions melhoradas
    zoomIn() {
        this._zoomAncorado(Math.min(200, this.pxPorSegundo * 1.4));
    }

    zoomOut() {
        this._zoomAncorado(Math.max(6, this.pxPorSegundo / 1.4));
    }

    // Zoom por faixa não existe mais: a timeline tem UMA escala (senão "10s"
    // teria tamanhos diferentes por faixa e arrastar entre elas não fecharia).
    trackZoomIn() { this.zoomIn(); }
    trackZoomOut() { this.zoomOut(); }

    updateZoomIndicator() {
        const indicator = document.getElementById('zoomIndicator');
        if (indicator) {
            // 100% = escala padrão da timeline (24 px/s); globalZoom morreu
            // junto com o zoom por faixa e ficava travado em "100%".
            indicator.textContent = `${Math.round((this.pxPorSegundo / 24) * 100)}%`;
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
        
        // Aplica fade out de 2.02s nas trilhas musicais (mesma folga do motor)
        musicTracks.forEach(track => {
            this.updateTrackFadeOut(track.id, 2.02);
            
            // Mostra indicador
            const indicator = document.getElementById(`autoFade_${track.id}`);
            if (indicator) {
                indicator.classList.add('active');
            }
        });

        // Inicia monitoramento de silêncio
        this.startSilenceDetection();

        this.showNotification('Auto Fade ativado (2.02s)', 'success');
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
        const fadeSteps = 40; // ~2.02s / 50ms (acompanha o fade final do motor)
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
                        eqSettings: track.eqSettings,
                        gateSettings: track.gateSettings
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
                const clips = this._clipsDaFaixa(t);
                const td = {
                    name: t.name, type: t.type,
                    volume: t.volume, pan: t.pan,
                    fadeIn: t.fadeIn, fadeOut: t.fadeOut,
                    effects: t.effects, eqSettings: t.eqSettings,
                    gateSettings: t.gateSettings,
                    buffers: [], clips: []
                };
                // Um upload por BUFFER DISTINTO (clips de um corte compartilham
                // o arquivo — subir por clip duplicaria áudio à toa).
                const indicePorBuffer = new Map();
                for (const c of clips) {
                    if (!indicePorBuffer.has(c.buffer)) {
                        const idx = td.buffers.length;
                        indicePorBuffer.set(c.buffer, idx);
                        const urlEstavel = t.audioUrl && /^https?:/i.test(t.audioUrl)
                            && !/\/object\/sign\/|token=/i.test(t.audioUrl);   // signed URL de 1h NÃO é referência estável
                        if (c.buffer === t.audioBuffer && urlEstavel) {
                            // Já está no Storage com URL estável (ex.: trilha da Biblioteca,
                            // /object/public/...). NÃO reenvia — evita reupload de arquivo
                            // grande (era o gargalo) e aponta direto pra URL pública.
                            passo = `referenciar faixa ${i + 1} (${t.name}) — já no Storage`;
                            console.log('[projeto] ' + passo);
                            td.buffers.push({ audio_url_direct: t.audioUrl });
                        } else {
                            // Voz gerada / arquivo local (blob:) / clip solto — sobe o WAV.
                            passo = `converter áudio ${idx + 1} da faixa ${i + 1} (${t.name}) para WAV`;
                            console.log('[projeto] ' + passo);
                            const wav = this.bufferToWav(c.buffer);
                            passo = `enviar áudio ${idx + 1} da faixa ${i + 1} — ${(wav.size / 1024 / 1024).toFixed(1)}MB`;
                            console.log('[projeto] ' + passo);
                            td.buffers.push({ audio_path: await this._uploadAudioProjeto(wav) });
                        }
                    }
                    td.clips.push({
                        buffer: indicePorBuffer.get(c.buffer),
                        inicio: c.inicio, offset: c.offset, duracao: c.duracao,
                        fadeIn: c.fadeIn || 0, fadeOut: c.fadeOut || 0
                    });
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
            // Snapshots apontam pra faixas que não existem mais — Ctrl+Z
            // depois de abrir projeto diria "Desfeito" sem fazer nada.
            this.undoClips = [];
            this.redoClips = [];

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
                track.gateSettings = td.gateSettings || track.gateSettings;
                if (td.clips && td.clips.length && td.buffers) {
                    // Projeto novo: baixa cada buffer e reconstrói os clips
                    // nas posições exatas em que foram salvos.
                    const buffers = [];
                    for (const b of td.buffers) {
                        if (!b.audio_url) { buffers.push(null); continue; }
                        const resp = await fetch(b.audio_url);
                        if (!resp.ok) { buffers.push(null); continue; }   // URL expirada/inválida — vira aviso abaixo, não EncodingError
                        const arr = await resp.arrayBuffer();
                        buffers.push(await this.audioContext.decodeAudioData(arr));
                    }
                    if (buffers.some(b => !b)) {
                        // Clip sem áudio assinado seria descartado em silêncio e
                        // um save em seguida tornaria a perda PERMANENTE — avisa.
                        this.showNotification(`Atenção: parte do áudio de "${td.name}" não pôde ser baixada — NÃO salve por cima antes de conferir`, 'warning');
                    }
                    track.clips = td.clips
                        .filter(c => buffers[c.buffer])
                        .map(c => ({
                            id: ClipModel.novoId(), buffer: buffers[c.buffer],
                            inicio: c.inicio, offset: c.offset, duracao: c.duracao,
                            fadeIn: c.fadeIn || 0, fadeOut: c.fadeOut || 0
                        }));
                    this._sincronizarDerivados(track);
                } else if (td.audio_url) {
                    // Projeto antigo: 1 áudio por faixa → migração preguiçosa
                    // vira 1 clip em 0:00 na primeira leitura. Nada quebra.
                    await this.loadAudioFromUrl(td.audio_url, track.id, td.name);
                }
                this.updateTrackUI(track);
            }
            this.renderizarTimeline();
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
    cutTrackAtTime(trackId, cutTime) {
        // Legado: dividir criava outra FAIXA ("Parte 2"). No modelo de clips a
        // divisão acontece DENTRO da faixa — mesmo canal, dois objetos.
        this.selecoes = this.selecoes || {};
        this.selecoes[trackId] = { ini: cutTime, fim: cutTime };
        this.aplicarCorte(trackId, 'dividir');
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
