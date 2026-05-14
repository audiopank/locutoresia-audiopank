// Database de vozes IA simuladas
const voicesDatabase = [
    {
        id: 1,
        name: "Alex Professional",
        description: "Voz masculina ideal para narrativas corporativas e institucionais",
        gender: "masculine",
        language: "pt-BR",
        style: "professional",
        avatar: "https://picsum.photos/seed/alex/80/80",
        model: "Charon",
        sampleText: "Bem-vindo à nossa empresa. Estamos aqui para oferecer o melhor serviço possível."
    },
    {
        id: 2,
        name: "Maria Amigável",
        description: "Voz feminina calorosa, perfeita para campanhas educativas",
        gender: "feminine",
        language: "pt-BR",
        style: "friendly",
        avatar: "https://picsum.photos/seed/maria/80/80",
        model: "Puck",
        sampleText: "Olá! Que bom ter você aqui. Vamos aprender juntos algo novo hoje."
    },
    {
        id: 3,
        name: "Carlos Energético",
        description: "Voz masculina vibrante, ótima para comerciais e promoções",
        gender: "masculine",
        language: "pt-BR",
        style: "energetic",
        avatar: "https://picsum.photos/seed/carlos/80/80",
        model: "Charon",
        sampleText: "Promoção imperdível! Venha agora e aproveite os melhores preços!"
    },
    {
        id: 4,
        name: "Ana Suave",
        description: "Voz feminina calma, ideal para meditações e conteúdo relaxante",
        gender: "feminine",
        language: "pt-BR",
        style: "calm",
        avatar: "https://picsum.photos/seed/ana/80/80",
        model: "Puck",
        sampleText: "Respire fundo e relaxe. Este é um momento de paz e tranquilidade."
    },
    {
        id: 5,
        name: "James Corporate",
        description: "Voz masculina em inglês para apresentações internacionais",
        gender: "masculine",
        language: "en-US",
        style: "professional",
        avatar: "https://picsum.photos/seed/james/80/80",
        model: "Charon",
        sampleText: "Welcome to our global conference. We're excited to share our innovations."
    },
    {
        id: 6,
        name: "Sophie Elegant",
        description: "Voz feminina sofisticada para marcas de luxo",
        gender: "feminine",
        language: "pt-BR",
        style: "professional",
        avatar: "https://picsum.photos/seed/sophie/80/80",
        model: "Puck",
        sampleText: "Experimente a exclusividade e elegância que só nossa marca pode oferecer."
    }
];

let currentVoices = [...voicesDatabase];
let selectedVoice = null;

// Inicialização
document.addEventListener('DOMContentLoaded', function() {
    renderVoices(currentVoices);
    populateVoiceSelect();
    updateStats();
    loadClonedVoices();
    loadElevenLabsVoices();
    
    // Setup file input listener
    document.getElementById('audioFileInput').addEventListener('change', handleAudioFileSelect);
});

// Renderizar vozes na tela
function renderVoices(voices) {
    const container = document.getElementById('voicesContainer');
    container.innerHTML = '';

    voices.forEach(voice => {
        const voiceCard = createVoiceCard(voice);
        container.appendChild(voiceCard);
    });
}

// Criar card de voz
function createVoiceCard(voice) {
    const col = document.createElement('div');
    col.className = 'col-md-6 col-lg-4';
    
    col.innerHTML = `
        <div class="voice-card" onclick="selectVoice(${voice.id})">
            <div class="text-center">
                <img src="${voice.avatar}" alt="${voice.name}" class="voice-avatar">
                <div class="voice-name">${voice.name}</div>
                <div class="voice-description">${voice.description}</div>
                <div class="mb-2">
                    <span class="badge-custom">${getGenderLabel(voice.gender)}</span>
                    <span class="badge-custom">${getLanguageLabel(voice.language)}</span>
                    <span class="badge-custom">${getStyleLabel(voice.style)}</span>
                </div>
                <div class="voice-actions">
                    <button class="btn btn-sm btn-outline-primary" onclick="playSample(event, ${voice.id})">
                        <i class="fas fa-play me-1"></i>Amostra
                    </button>
                    <button class="btn btn-sm btn-outline-secondary" onclick="likeVoice(event, ${voice.id})">
                        <i class="far fa-heart"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-info" onclick="saveVoice(event, ${voice.id})">
                        <i class="far fa-bookmark"></i>
                    </button>
                </div>
            </div>
        </div>
    `;
    
    return col;
}

// Popular select de vozes
function populateVoiceSelect() {
    const select = document.getElementById('voiceSelect');
    select.innerHTML = '<option value="">Selecione uma voz</option>';
    
    voicesDatabase.forEach(voice => {
        const option = document.createElement('option');
        option.value = voice.id;
        option.textContent = `${voice.name} (${getLanguageLabel(voice.language)})`;
        select.appendChild(option);
    });
}

// Selecionar voz
function selectVoice(voiceId) {
    selectedVoice = voicesDatabase.find(v => v.id === voiceId);
    document.getElementById('voiceSelect').value = voiceId;
    
    // Preencher texto de exemplo
    if (selectedVoice) {
        document.getElementById('textInput').value = selectedVoice.sampleText;
    }
    
    // Scroll para o painel de geração
    document.querySelector('.generation-panel').scrollIntoView({ behavior: 'smooth' });
}

// Aplicar filtros
function applyFilters() {
    const gender = document.getElementById('genderFilter').value;
    const language = document.getElementById('languageFilter').value;
    const style = document.getElementById('styleFilter').value;
    
    currentVoices = voicesDatabase.filter(voice => {
        return (!gender || voice.gender === gender) &&
               (!language || voice.language === language) &&
               (!style || voice.style === style);
    });
    
    renderVoices(currentVoices);
}

// Resetar filtros
function resetFilters() {
    document.getElementById('genderFilter').value = '';
    document.getElementById('languageFilter').value = '';
    document.getElementById('styleFilter').value = '';
    
    currentVoices = [...voicesDatabase];
    renderVoices(currentVoices);
}

// Gerar áudio
async function generateAudio() {
    const text = document.getElementById('textInput').value.trim();
    const voiceId = document.getElementById('voiceSelect').value;
    const speechStyle = document.getElementById('speechStyle').value;
    
    if (!text) {
        alert('Por favor, digite o texto para gerar o áudio.');
        return;
    }
    
    if (!voiceId) {
        alert('Por favor, selecione uma voz IA.');
        return;
    }
    
    const voice = currentVoices.find(v => v.id == voiceId);
    
    // Mostrar loading
    document.getElementById('loadingSpinner').style.display = 'block';
    document.getElementById('audioPlayer').style.display = 'none';
    
    try {
        console.log('Enviando requisição para gerar áudio...');
        console.log('Texto:', text);
        console.log('Voz:', voice);
        console.log('Estilo:', speechStyle);
        
        // Fazer chamada direta à API
        const response = await fetch('/api/generate-audio', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text: text,
                voice: voice.model,
                style: speechStyle,
                language: voice.language,
                provider: voice.provider || 'gemini'
            })
        });
        
        console.log('Status da resposta:', response.status);
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Falha na geração de áudio');
        }
        
        const result = await response.json();
        console.log('Resultado da API:', result);
        
        // Criar URL para o arquivo de áudio gerado
        const audioUrl = `/api/download/${result.filename}`;
        console.log('URL do áudio:', audioUrl);
        
        // Configurar player de áudio
        const audioPlayer = document.getElementById('generatedAudio');
        audioPlayer.src = audioUrl;
        audioPlayer.load(); // Forçar carregamento
        
        // Mostrar player
        document.getElementById('loadingSpinner').style.display = 'none';
        document.getElementById('audioPlayer').style.display = 'block';
        
        // Botão "Enviar para MiniDAW" já está visível por padrão
        
        // Atualizar estatísticas
        updateStats();
        
        // Tentar reproduzir automaticamente
        audioPlayer.play().catch(e => {
            console.log('Autoplay bloqueado, usuário precisa clicar para reproduzir');
        });
        
    } catch (error) {
        console.error('Erro ao gerar áudio:', error);
        alert('Erro ao gerar áudio: ' + error.message);
        document.getElementById('loadingSpinner').style.display = 'none';
    }
}

// Simular geração de áudio (substituir por chamada real à API)
async function simulateAudioGeneration(text, voice, style) {
    // Aqui faremos a chamada real ao backend Python
    const response = await fetch('/api/generate-audio', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            text: text,
            voice: voice.model,
            style: style,
            language: voice.language
        })
    });
    
    if (!response.ok) {
        throw new Error('Falha na geração de áudio');
    }
    
    return await response.blob();
}

// Play amostra de voz
function playSample(event, voiceId) {
    event.stopPropagation();
    const voice = voicesDatabase.find(v => v.id === voiceId);
    
    // Preencher texto de exemplo e gerar
    document.getElementById('textInput').value = voice.sampleText;
    document.getElementById('voiceSelect').value = voiceId;
    
    // Gerar áudio automaticamente
    generateAudio();
}

// Curtir voz
function likeVoice(event, voiceId) {
    event.stopPropagation();
    const heart = event.target.closest('button').querySelector('i');
    heart.classList.toggle('far');
    heart.classList.toggle('fas');
    heart.style.color = heart.classList.contains('fas') ? '#e74c3c' : '';
}

// Salvar voz
function saveVoice(event, voiceId) {
    event.stopPropagation();
    const bookmark = event.target.closest('button').querySelector('i');
    bookmark.classList.toggle('far');
    bookmark.classList.toggle('fas');
    bookmark.style.color = bookmark.classList.contains('fas') ? '#3498db' : '';
}

// Download áudio
function downloadAudio() {
    const audio = document.getElementById('generatedAudio');
    const a = document.createElement('a');
    a.href = audio.src;
    a.download = `locução_${Date.now()}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// Compartilhar áudio
function shareAudio() {
    if (navigator.share) {
        navigator.share({
            title: 'Locução IA - Locutores IA',
            text: 'Confira esta locução gerada com IA!',
            url: window.location.href
        });
    } else {
        // Fallback para navegadores sem suporte
        navigator.clipboard.writeText(window.location.href);
        alert('Link copiado para a área de transferência!');
    }
}

// Atualizar estatísticas
function updateStats() {
    // Simular contadores dinâmicos
    const audiosCount = document.getElementById('audiosCount');
    const currentCount = parseInt(audiosCount.textContent.replace('+', ''));
    audiosCount.textContent = (currentCount + 1) + '+';
}

// Labels auxiliares
function getGenderLabel(gender) {
    const labels = {
        'masculine': 'Masculino',
        'feminine': 'Feminino',
        'neutral': 'Neutro'
    };
    return labels[gender] || gender;
}

function getLanguageLabel(language) {
    const labels = {
        'pt-BR': 'Português',
        'en-US': 'Inglês',
        'es-ES': 'Espanhol'
    };
    return labels[language] || language;
}

function getStyleLabel(style) {
    const labels = {
        'professional': 'Profissional',
        'friendly': 'Amigável',
        'energetic': 'Energético',
        'calm': 'Calmo'
    };
    return labels[style] || style;
}

// Funções para clonagem de voz
let audioFileBase64 = null;

function handleAudioFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    // Validar tamanho do arquivo (10MB max)
    if (file.size > 10 * 1024 * 1024) {
        alert('Arquivo muito grande. Tamanho máximo: 10MB');
        event.target.value = '';
        return;
    }
    
    // Validar tipo de arquivo
    if (!file.type.startsWith('audio/')) {
        alert('Por favor, selecione um arquivo de áudio válido');
        event.target.value = '';
        return;
    }
    
    // Ler arquivo e converter para base64
    const reader = new FileReader();
    reader.onload = function(e) {
        audioFileBase64 = e.target.result;
        
        // Mostrar preview do áudio
        const preview = document.getElementById('audioPreview');
        const audio = document.getElementById('previewAudio');
        audio.src = audioFileBase64;
        preview.style.display = 'block';
    };
    
    reader.readAsDataURL(file);
}

async function cloneVoice() {
    const name = document.getElementById('cloneVoiceName').value.trim();
    const description = document.getElementById('cloneVoiceDescription').value.trim();
    const provider = document.getElementById('cloneProvider').value;
    const enhance = document.getElementById('enhanceAudio').checked;
    
    // Validar campos
    if (!name) {
        alert('Por favor, digite um nome para a voz');
        return;
    }
    
    if (!audioFileBase64) {
        alert('Por favor, selecione um arquivo de áudio');
        return;
    }
    
    // Mostrar loading
    document.getElementById('cloneLoadingSpinner').style.display = 'block';
    
    try {
        let endpoint, requestBody;
        
        if (provider === 'elevenlabs') {
            endpoint = '/api/clone-voice-elevenlabs';
            requestBody = {
                name: name,
                description: description,
                audioBase64: audioFileBase64
            };
        } else {
            endpoint = '/api/clone-voice';
            requestBody = {
                name: name,
                description: description,
                audioBase64: audioFileBase64,
                enhance: enhance
            };
        }
        
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.error || 'Erro ao clonar voz');
        }
        
        // Sucesso
        alert(`Voz clonada com sucesso usando ${provider.toUpperCase()}!`);
        
        // Limpar formulário
        document.getElementById('cloneVoiceName').value = '';
        document.getElementById('cloneVoiceDescription').value = '';
        document.getElementById('audioFileInput').value = '';
        document.getElementById('audioPreview').style.display = 'none';
        audioFileBase64 = null;
        
        // Recarregar vozes clonadas
        if (provider === 'elevenlabs') {
            loadElevenLabsVoices();
        } else {
            loadClonedVoices();
        }
        
        // Adicionar voz clonada ao catálogo principal
        if (result.voice) {
            currentVoices.push(result.voice);
            renderVoices(currentVoices);
            populateVoiceSelect();
        }
        
    } catch (error) {
        console.error('Erro ao clonar voz:', error);
        alert('Erro ao clonar voz: ' + error.message);
    } finally {
        document.getElementById('cloneLoadingSpinner').style.display = 'none';
    }
}

async function loadClonedVoices() {
    try {
        const response = await fetch('/api/list-cloned-voices');
        const result = await response.json();
        
        if (response.ok && result.success && result.voices.length > 0) {
            // Mostrar painel de vozes clonadas
            document.getElementById('clonedVoicesPanel').style.display = 'block';
            
            // Renderizar vozes clonadas
            const container = document.getElementById('clonedVoicesContainer');
            container.innerHTML = '';
            
            result.voices.forEach(voice => {
                const voiceCard = createClonedVoiceCard(voice);
                container.appendChild(voiceCard);
            });
            
            // Adicionar vozes clonadas ao catálogo principal
            result.voices.forEach(voice => {
                if (!currentVoices.find(v => v.id === voice.id)) {
                    currentVoices.push(voice);
                }
            });
            
            renderVoices(currentVoices);
            populateVoiceSelect();
        }
    } catch (error) {
        console.error('Erro ao carregar vozes clonadas:', error);
    }
}

function createClonedVoiceCard(voice) {
    const col = document.createElement('div');
    col.className = 'col-md-6 col-lg-4';
    
    col.innerHTML = `
        <div class="voice-card" onclick="selectClonedVoice('${voice.id}')">
            <div class="text-center">
                <img src="${voice.avatar}" alt="${voice.name}" class="voice-avatar">
                <div class="voice-name">${voice.name} <span class="badge bg-success ms-1">Clonada</span></div>
                <div class="voice-description">${voice.description}</div>
                <div class="mb-2">
                    <span class="badge-custom">${getLanguageLabel(voice.language)}</span>
                    <span class="badge-custom">Personalizada</span>
                </div>
                <div class="voice-actions">
                    <button class="btn btn-sm btn-outline-primary" onclick="playClonedSample(event, '${voice.id}')">
                        <i class="fas fa-play me-1"></i>Testar
                    </button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteClonedVoice(event, '${voice.id}')">
                        <i class="fas fa-trash me-1"></i>Excluir
                    </button>
                </div>
            </div>
        </div>
    `;
    
    return col;
}

function selectClonedVoice(voiceId) {
    const voice = currentVoices.find(v => v.id === voiceId);
    if (voice) {
        selectedVoice = voice;
        document.getElementById('voiceSelect').value = voiceId;
        document.getElementById('textInput').value = voice.sampleText;
        
        // Scroll para o painel de geração
        document.querySelector('.generation-panel').scrollIntoView({ behavior: 'smooth' });
    }
}

async function playClonedSample(event, voiceId) {
    event.stopPropagation();
    const voice = currentVoices.find(v => v.id === voiceId);
    
    if (voice) {
        document.getElementById('textInput').value = voice.sampleText;
        document.getElementById('voiceSelect').value = voiceId;
        
        // Usar endpoint específico para vozes clonadas
        await generateClonedAudio();
    }
}

async function generateClonedAudio() {
    const text = document.getElementById('textInput').value.trim();
    const voiceId = document.getElementById('voiceSelect').value;
    
    if (!text || !voiceId) return;
    
    const voice = currentVoices.find(v => v.id === voiceId);
    if (!voice || !voice.isCloned) return;
    
    // Mostrar loading
    document.getElementById('loadingSpinner').style.display = 'block';
    document.getElementById('audioPlayer').style.display = 'none';
    
    try {
        const response = await fetch('/api/synthesize-cloned-voice', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                voice_id: voice.lmntVoiceId,
                text: text
            })
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.error || 'Erro ao gerar áudio');
        }
        
        // Criar URL para o áudio gerado
        const audioUrl = `/api/download/${result.filename}`;
        
        // Configurar player de áudio
        const audioPlayer = document.getElementById('generatedAudio');
        audioPlayer.src = audioUrl;
        
        // Mostrar player
        document.getElementById('loadingSpinner').style.display = 'none';
        document.getElementById('audioPlayer').style.display = 'block';
        
        // Atualizar estatísticas
        updateStats();
        
    } catch (error) {
        console.error('Erro ao gerar áudio clonado:', error);
        alert('Erro ao gerar áudio: ' + error.message);
        document.getElementById('loadingSpinner').style.display = 'none';
    }
}

async function deleteClonedVoice(event, voiceId) {
    event.stopPropagation();
    
    if (!confirm('Tem certeza que deseja excluir esta voz clonada?')) {
        return;
    }
    
    try {
        // Implementar endpoint de exclusão se necessário
        alert('Funcionalidade de exclusão em desenvolvimento');
        
    } catch (error) {
        console.error('Erro ao excluir voz:', error);
        alert('Erro ao excluir voz: ' + error.message);
    }
}

async function loadElevenLabsVoices() {
    try {
        const response = await fetch('/api/list-elevenlabs-voices');
        const result = await response.json();
        
        if (response.ok && result.success && result.voices.length > 0) {
            // Mostrar painel de vozes ElevenLabs
            const existingPanel = document.getElementById('elevenlabsVoicesPanel');
            if (!existingPanel) {
                // Criar painel para vozes ElevenLabs
                const clonedPanel = document.getElementById('clonedVoicesPanel');
                const elevenlabsPanel = document.createElement('div');
                elevenlabsPanel.className = 'generation-panel mb-4';
                elevenlabsPanel.id = 'elevenlabsVoicesPanel';
                elevenlabsPanel.innerHTML = `
                    <h5 class="mb-4"><i class="fas fa-microphone-alt me-2"></i>Vozes ElevenLabs</h5>
                    <div id="elevenlabsVoicesContainer">
                        <!-- ElevenLabs voices will be displayed here -->
                    </div>
                `;
                clonedPanel.parentNode.insertBefore(elevenlabsPanel, clonedPanel.nextSibling);
            }
            
            // Renderizar vozes ElevenLabs
            const container = document.getElementById('elevenlabsVoicesContainer');
            container.innerHTML = '';
            
            result.voices.forEach(voice => {
                const voiceCard = createElevenLabsVoiceCard(voice);
                container.appendChild(voiceCard);
            });
            
            // Adicionar vozes ElevenLabs ao catálogo principal
            result.voices.forEach(voice => {
                if (!currentVoices.find(v => v.id === voice.id)) {
                    currentVoices.push(voice);
                }
            });
            
            renderVoices(currentVoices);
            populateVoiceSelect();
        }
    } catch (error) {
        console.error('Erro ao carregar vozes ElevenLabs:', error);
    }
}

function createElevenLabsVoiceCard(voice) {
    const col = document.createElement('div');
    col.className = 'col-md-6 col-lg-4';
    
    const badgeText = voice.isCloned ? 'Clonada' : 'Predefinida';
    const badgeClass = voice.isCloned ? 'bg-success' : 'bg-info';
    
    col.innerHTML = `
        <div class="voice-card" onclick="selectElevenLabsVoice('${voice.id}')">
            <div class="text-center">
                <img src="${voice.avatar}" alt="${voice.name}" class="voice-avatar">
                <div class="voice-name">${voice.name} <span class="badge ${badgeClass} ms-1">${badgeText}</span></div>
                <div class="voice-description">${voice.description}</div>
                <div class="mb-2">
                    <span class="badge-custom">${getLanguageLabel(voice.language)}</span>
                    <span class="badge-custom">ElevenLabs</span>
                </div>
                <div class="voice-actions">
                    <button class="btn btn-sm btn-outline-primary" onclick="playElevenLabsSample(event, '${voice.id}')">
                        <i class="fas fa-play me-1"></i>Testar
                    </button>
                    ${voice.isCloned ? `
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteElevenLabsVoice(event, '${voice.id}')">
                        <i class="fas fa-trash me-1"></i>Excluir
                    </button>` : ''}
                </div>
            </div>
        </div>
    `;
    
    return col;
}

function selectElevenLabsVoice(voiceId) {
    const voice = currentVoices.find(v => v.id === voiceId);
    if (voice) {
        selectedVoice = voice;
        document.getElementById('voiceSelect').value = voiceId;
        document.getElementById('textInput').value = voice.sampleText;
        
        // Scroll para o painel de geração
        document.querySelector('.generation-panel').scrollIntoView({ behavior: 'smooth' });
    }
}

function sendToMiniDAW() {
    console.log('Iniciando sendToMiniDAW...');
    
    // Verificar se há áudio gerado
    const audioElement = document.getElementById('generatedAudio');
    if (!audioElement || !audioElement.src) {
        console.log('Nenhum áudio encontrado');
        showNotification('Nenhum áudio gerado para enviar', 'warning');
        return;
    }
    
    // Verificar se MiniDAW está disponível
    if (typeof minidaw === 'undefined') {
        console.log('MiniDAW não encontrada');
        showNotification('MiniDAW não está carregada. Recarregue a página.', 'warning');
        return;
    }
    
    console.log('MiniDAW encontrada, criando track...');
    
    // Criar track de voz
    try {
        minidaw.addTrack('voice');
        const newTrack = minidaw.tracks[minidaw.tracks.length - 1];
        console.log('Track criado:', newTrack.id);
        
        // Obter nome da voz selecionada
        const voiceSelect = document.getElementById('voiceSelect');
        const voiceName = voiceSelect.options[voiceSelect.selectedIndex]?.text || 'Voz Gerada';
        const trackName = `Voz: ${voiceName}`;
        
        // Atualizar nome do track
        minidaw.updateTrackName(newTrack.id, trackName);
        console.log('Nome atualizado:', trackName);
        
        // Processar áudio
        console.log('Processando áudio...');
        fetch(audioElement.src)
            .then(response => {
                console.log('Response recebida:', response);
                return response.blob();
            })
            .then(blob => {
                console.log('Blob criado, tamanho:', blob.size);
                const fileName = `voz_gerada_${Date.now()}.wav`;
                const file = new File([blob], fileName, { type: 'audio/wav' });
                console.log('Arquivo criado:', fileName);
                
                // Carregar áudio no track
                return minidaw.loadAudioFile(file, newTrack.id);
            })
            .then(() => {
                console.log('Áudio carregado com sucesso!');
                showNotification('Áudio enviado para MiniDAW com sucesso!', 'success');
                
                // Scroll para MiniDAW
                const minidawContainer = document.querySelector('.minidaw-container');
                if (minidawContainer) {
                    minidawContainer.scrollIntoView({ behavior: 'smooth' });
                }
            })
            .catch(error => {
                console.error('Erro detalhado:', error);
                showNotification('Erro ao enviar áudio para MiniDAW', 'error');
            });
            
    } catch (error) {
        console.error('Erro ao criar track:', error);
        showNotification('Erro ao criar track na MiniDAW', 'error');
    }
}

function createVoiceTrackFromGeneratedAudio(audioSrc) {
    // Cria um card de track de voz com o áudio gerado
    const voicesContainer = document.getElementById('voicesContainer');
    const trackCard = document.createElement('div');
    trackCard.className = 'voice-card mb-3';
    trackCard.style.border = '2px solid #10b981';
    trackCard.style.background = 'linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(6, 182, 212, 0.1))';
    
    // Obtém informações do áudio gerado
    const textInput = document.getElementById('textInput').value;
    const voiceSelect = document.getElementById('voiceSelect');
    const selectedVoice = voiceSelect.options[voiceSelect.selectedIndex]?.text || 'Voz Gerada';
    
    trackCard.innerHTML = `
        <div class="d-flex justify-content-between align-items-start mb-2">
            <div>
                <span class="voice-type cloned">TRACK DE VOZ</span>
                <div class="voice-name">🎵 ${selectedVoice}</div>
                <div class="voice-description">${textInput.substring(0, 100)}${textInput.length > 100 ? '...' : ''}</div>
            </div>
        </div>
        <div class="audio-player">
            <audio controls class="w-100" src="${audioSrc}"></audio>
            <div class="audio-controls mt-2">
                <button class="btn btn-sm btn-primary" onclick="downloadTrackAudio('${audioSrc}', 'track_voz.wav')">
                    <i class="fas fa-download me-1"></i>Baixar
                </button>
                <button class="btn btn-sm btn-danger" onclick="removeTrack(this)">
                    <i class="fas fa-trash me-1"></i>Remover
                </button>
            </div>
        </div>
    `;
    
    // Adiciona no topo da lista de vozes
    voicesContainer.insertBefore(trackCard, voicesContainer.firstChild);
}

function downloadTrackAudio(audioSrc, filename) {
    const a = document.createElement('a');
    a.href = audioSrc;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// Função para remover tracks da MiniDAW (compatível com onclick do HTML)
function removeTrack(trackId) {
    console.log('Função removeTrack chamada para MiniDAW:', trackId);
    
    if (typeof minidaw !== 'undefined') {
        try {
            // Remove da MiniDAW
            minidaw.removeTrack(trackId);
            showNotification('Track removido da MiniDAW com sucesso!', 'success');
        } catch (error) {
            console.error('Erro ao remover track da MiniDAW:', error);
            showNotification('Erro ao remover track', 'error');
        }
    } else {
        // Fallback: remove do DOM se MiniDAW não estiver disponível
        const trackElement = document.getElementById(`track_${trackId}`);
        if (trackElement) {
            trackElement.remove();
            showNotification('Track removido com sucesso!', 'success');
        } else {
            showNotification('Track não encontrado', 'warning');
        }
    }
}

// Função para remover tracks de voz (para cards de voz)
function removeVoiceTrack(button) {
    const trackCard = button.closest('.voice-card');
    if (trackCard) {
        trackCard.remove();
        showNotification('Track de voz removido com sucesso!', 'info');
    }
}

// Função para criar novo track na MiniDAW
function createNewMiniDAWTrack(type = 'voice') {
    console.log('Criando novo track na MiniDAW...');
    
    if (typeof minidaw === 'undefined') {
        console.log('MiniDAW não encontrada');
        showNotification('MiniDAW não está carregada. Recarregue a página.', 'warning');
        return;
    }
    
    try {
        // Criar track
        minidaw.addTrack(type);
        const newTrack = minidaw.tracks[minidaw.tracks.length - 1];
        console.log('Novo track criado:', newTrack.id);
        
        // Nome padrão baseado no tipo
        const trackCount = minidaw.tracks.filter(t => t.type === type).length;
        const defaultName = type === 'voice' ? `Voz ${trackCount}` : `Trilha ${trackCount}`;
        
        // Atualizar nome
        minidaw.updateTrackName(newTrack.id, defaultName);
        console.log('Track nomeado como:', defaultName);
        
        showNotification(`${type === 'voice' ? 'Track de Voz' : 'Track de Trilha'} criado com sucesso!`, 'success');
        
        // Scroll para a MiniDAW
        const minidawContainer = document.querySelector('.minidaw-container');
        if (minidawContainer) {
            minidawContainer.scrollIntoView({ behavior: 'smooth' });
        }
        
        return newTrack.id;
        
    } catch (error) {
        console.error('Erro ao criar track:', error);
        showNotification('Erro ao criar track na MiniDAW', 'error');
        return null;
    }
}

// Função para criar track de voz específica
function createVoiceTrack() {
    return createNewMiniDAWTrack('voice');
}

// Função para criar track de trilha específica
function createMusicTrack() {
    return createNewMiniDAWTrack('music');
}

// Função para limpar todos os tracks da MiniDAW
function clearAllMiniDAWTracks() {
    if (typeof minidaw === 'undefined') {
        showNotification('MiniDAW não está carregada. Recarregue a página.', 'warning');
        return;
    }
    
    if (confirm('Tem certeza que deseja remover todos os tracks da MiniDAW?')) {
        try {
            // Obter todos os tracks atuais
            const trackIds = minidaw.tracks.map(track => track.id);
            
            // Remover cada track
            trackIds.forEach(trackId => {
                minidaw.removeTrack(trackId);
            });
            
            showNotification('Todos os tracks foram removidos com sucesso!', 'success');
            
        } catch (error) {
            console.error('Erro ao limpar tracks:', error);
            showNotification('Erro ao limpar tracks da MiniDAW', 'error');
        }
    }
}

async function playElevenLabsSample(event, voiceId) {
    event.stopPropagation();
    const voice = currentVoices.find(v => v.id === voiceId);
    
    if (voice) {
        document.getElementById('textInput').value = voice.sampleText;
        document.getElementById('voiceSelect').value = voiceId;
        
        // Usar endpoint específico para vozes ElevenLabs
        await generateElevenLabsAudio();
    }
}

// Funções globais para MiniDAW
function addMiniDAWTrack(type) {
    if (typeof miniDAW !== 'undefined') {
        miniDAW.addTrack(type);
        showNotification(`Track ${type === 'voice' ? 'de Voz' : 'de Trilha'} adicionado!`, 'success');
    } else {
        showNotification('MiniDAW não está carregada. Recarregue a página.', 'warning');
    }
}

function toggleMiniDAW() {
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

function toggleMiniDAWScissor() {
    if (typeof miniDAW !== 'undefined') {
        miniDAW.toggleScissor();
    }
}

function normalizeMiniDAWVolumes() {
    if (typeof miniDAW !== 'undefined') {
        miniDAW.normalizeVolumes();
        showNotification('Volumes normalizados!', 'success');
    }
}

function applyMiniDAWAutoFade() {
    if (typeof miniDAW !== 'undefined') {
        miniDAW.applyAutoFade();
        showNotification('Auto Fade aplicado!', 'success');
    }
}

function clearMiniDAWTracks() {
    if (typeof miniDAW !== 'undefined') {
        if (confirm('Tem certeza que deseja limpar todos os tracks?')) {
            miniDAW.clearAllTracks();
            showNotification('Tracks limpos!', 'info');
        }
    }
}

function saveMiniDAWProject() {
    if (typeof miniDAW !== 'undefined') {
        miniDAW.saveProject();
        showNotification('Projeto salvo!', 'success');
    }
}

function toggleMiniDAWPlayback() {
    if (typeof miniDAW !== 'undefined') {
        miniDAW.togglePlayback();
    }
}

function stopMiniDAWPlayback() {
    if (typeof miniDAW !== 'undefined') {
        miniDAW.stop();
    }
}

function rewindMiniDAW() {
    if (typeof miniDAW !== 'undefined') {
        miniDAW.rewind();
    }
}

function fastForwardMiniDAW() {
    if (typeof miniDAW !== 'undefined') {
        miniDAW.fastForward();
    }
}

function zoomMiniDAWIn() {
    if (typeof miniDAW !== 'undefined') {
        miniDAW.zoomIn();
    }
}

function zoomMiniDAWOut() {
    if (typeof miniDAW !== 'undefined') {
        miniDAW.zoomOut();
    }
}

function setExportFormat(format) {
    // Atualizar botões de formato
    document.querySelectorAll('.format-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');
    
    // Salvar formato preferido
    localStorage.setItem('minidaw_export_format', format);
}

function exportMiniDAWMix() {
    if (typeof miniDAW !== 'undefined') {
        const format = localStorage.getItem('minidaw_export_format') || 'wav';
        miniDAW.exportMix(format);
    }
}

async function playElevenLabsSample(event, voiceId) {
    event.stopPropagation();
    const voice = currentVoices.find(v => v.id === voiceId);
    
    if (voice) {
        document.getElementById('textInput').value = voice.sampleText;
        document.getElementById('voiceSelect').value = voiceId;
        
        // Usar endpoint específico para vozes ElevenLabs
        await generateElevenLabsAudio();
    }
}

async function generateElevenLabsAudio() {
    const text = document.getElementById('textInput').value.trim();
    const voiceId = document.getElementById('voiceSelect').value;
    
    if (!text || !voiceId) return;
    
    const voice = currentVoices.find(v => v.id === voiceId);
    if (!voice || voice.provider !== 'elevenlabs') return;
    
    // Mostrar loading
    document.getElementById('loadingSpinner').style.display = 'block';
    document.getElementById('audioPlayer').style.display = 'none';
    
    try {
        const response = await fetch('/api/synthesize-cloned-voice', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                voice_id: voice.elevenlabsVoiceId,
                text: text,
                provider: 'elevenlabs'
            })
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.error || 'Erro ao gerar áudio');
        }
        
        // Criar URL para o áudio gerado
        const audioUrl = `/api/download/${result.filename}`;
        
        // Configurar player de áudio
        const audioPlayer = document.getElementById('generatedAudio');
        audioPlayer.src = audioUrl;
        
        // Mostrar player
        document.getElementById('loadingSpinner').style.display = 'none';
        document.getElementById('audioPlayer').style.display = 'block';
        
        // Atualizar estatísticas
        updateStats();
        
    } catch (error) {
        console.error('Erro ao gerar áudio ElevenLabs:', error);
        alert('Erro ao gerar áudio: ' + error.message);
        document.getElementById('loadingSpinner').style.display = 'none';
    }
}

async function deleteElevenLabsVoice(event, voiceId) {
    event.stopPropagation();
    
    if (!confirm('Tem certeza que deseja excluir esta voz ElevenLabs?')) {
        return;
    }
    
    try {
        // Implementar endpoint de exclusão se necessário
        alert('Funcionalidade de exclusão em desenvolvimento');
        
    } catch (error) {
        console.error('Erro ao excluir voz:', error);
        alert('Erro ao excluir voz: ' + error.message);
    }
}
