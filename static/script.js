let currentVoices = [];
let selectedVoice = null;
let lastGeneratedAudioBlob = null;

document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Locutores IA - Inicializando...');
    
    loadAllVoices();
    updateStats();

    const audioInput = document.getElementById('audioFileInput');
    if (audioInput) {
        audioInput.addEventListener('change', handleAudioFileSelect);
    }

    console.log('✅ Locutores IA - Inicialização completa!');
});

// ── Carregar TODAS as vozes (Gemini + Edge TTS + ElevenLabs) ───────────────────
async function loadAllVoices() {
    try {
        const response = await fetch('/api/voices');
        const result = await response.json();
        
        if (response.ok && result.voices && result.voices.length > 0) {
            currentVoices = result.voices.map((v, i) => ({
                id: v.id,
                name: getVoiceName(v),
                description: getVoiceDescription(v),
                gender: v.gender,
                language: v.language,
                style: 'professional',
                avatar: `https://picsum.photos/seed/${v.id}/80/80`,
                model: v.id,
                provider: getVoiceProvider(v.id),
                sampleText: getSampleText(v)
            }));
        }
        
        // Carregar vozes da ElevenLabs também
        try {
            const elevenResponse = await fetch('/api/list-elevenlabs-voices');
            const elevenResult = await elevenResponse.json();
            if (elevenResponse.ok && elevenResult.success && elevenResult.voices) {
                currentVoices = [...currentVoices, ...elevenResult.voices];
            }
        } catch (elevenError) {
            console.log('⚠️ Vozes ElevenLabs não carregadas:', elevenError);
        }
        
        console.log(`✅ ${currentVoices.length} vozes carregadas (incluindo Gemini e ElevenLabs)!`);
        renderVoices(currentVoices);
        populateVoiceSelect();
    } catch (error) {
        console.error('Erro ao carregar vozes:', error);
        // Fallback para voz padrão
        currentVoices = [
            { id: 'Sadachbia', name: 'Sadachbia - Gemini', description: 'Voz masculina clara e profissional', gender: 'male', language: 'pt-BR', style: 'professional', avatar: 'https://picsum.photos/seed/Sadachbia/80/80', model: 'Sadachbia', provider: 'gemini', sampleText: 'Bem-vindo à nossa plataforma. Estamos aqui para oferecer o melhor serviço possível.' }
        ];
        renderVoices(currentVoices);
        populateVoiceSelect();
    }
}

function getVoiceName(voice) {
    const geminiVozes = ['Sadachbia', 'Puck', 'Charon', 'Kore', 'Lira', 'Nova', 'Onyx', 'Fenrir', 'Vega', 'Shamash'];
    if (geminiVozes.includes(voice.id)) {
        return `${voice.id} - Gemini`;
    }
    return voice.name || voice.id;
}

function getVoiceDescription(voice) {
    const geminiVozes = ['Sadachbia', 'Puck', 'Charon', 'Kore', 'Lira', 'Nova', 'Onyx', 'Fenrir', 'Vega', 'Shamash'];
    if (geminiVozes.includes(voice.id)) {
        return `Voz ${voice.gender === 'male' ? 'masculina' : 'feminina'} do Google Gemini`;
    }
    return `Voz ${voice.gender === 'male' ? 'masculina' : 'feminina'} de alta qualidade`;
}

function getVoiceProvider(voiceId) {
    const geminiVozes = ['Sadachbia', 'Puck', 'Charon', 'Kore', 'Lira', 'Nova', 'Onyx', 'Fenrir', 'Vega', 'Shamash'];
    const edgeVozes = ['pt-BR-AntonioNeural', 'pt-BR-FranciscaNeural', 'pt-BR-DanielNeural'];
    if (geminiVozes.includes(voiceId)) return 'gemini';
    if (edgeVozes.includes(voiceId)) return 'edge';
    return 'other';
}

function getSampleText(voice) {
    return `Olá! Esta é uma amostra da voz ${voice.id} gerada com inteligência artificial.`;
}

// ── Renderizar vozes ───────────────────────────────────────────────────────
function renderVoices(voices) {
    const container = document.getElementById('voicesContainer');
    container.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'row';
    voices.forEach(voice => row.appendChild(createVoiceCard(voice)));
    container.appendChild(row);
}

function createVoiceCard(voice) {
    const col = document.createElement('div');
    col.className = 'col-md-6 col-lg-4 mb-3';
    const providerBadge = getProviderBadge(voice.provider);
    col.innerHTML = `
        <div class="voice-card" onclick="selectVoice('${voice.id}')">
            <div class="text-center">
                <img src="${voice.avatar}" alt="${voice.name}" class="voice-avatar">
                <div class="voice-name">${voice.name} ${providerBadge}</div>
                <div class="voice-description">${voice.description}</div>
                <div class="mb-2">
                    <span class="badge-custom">${getGenderLabel(voice.gender)}</span>
                    <span class="badge-custom">${getLanguageLabel(voice.language)}</span>
                </div>
                <div class="voice-actions justify-content-center">
                    <button class="btn btn-sm btn-outline-primary" onclick="playSample(event, '${voice.id}')">
                        <i class="fas fa-play me-1"></i>Amostra
                    </button>
                    <button class="btn btn-sm btn-outline-secondary" onclick="likeVoice(event, '${voice.id}')">
                        <i class="far fa-heart"></i>
                    </button>
                </div>
            </div>
        </div>`;
    return col;
}

function getProviderBadge(provider) {
    if (provider === 'gemini') {
        return '<span class="badge bg-primary ms-1">Gemini</span>';
    } else if (provider === 'elevenlabs') {
        return '<span class="badge bg-warning text-dark ms-1">ElevenLabs</span>';
    }
    return '<span class="badge bg-success ms-1">Free</span>';
}

// ── Populate select agrupado ───────────────────────────────────────────────
function populateVoiceSelect() {
    const select = document.getElementById('voiceSelect');
    if (!select) {
        console.error('ERRO: Elemento voiceSelect não encontrado!');
        return;
    }

    console.log('Populando voiceSelect com', currentVoices.length, 'vozes');

    select.innerHTML = '<option value="">Selecione uma voz</option>';

    // Grupo Gemini (PRIMEIRO)
    const geminiVoices = currentVoices.filter(v => v.provider === 'gemini');
    if (geminiVoices.length > 0) {
        const geminiGroup = document.createElement('optgroup');
        geminiGroup.label = '🌟 Gemini 3.1 Flash TTS (Recomendado)';
        geminiVoices.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.id;
            opt.textContent = v.name;
            geminiGroup.appendChild(opt);
        });
        select.appendChild(geminiGroup);
        console.log('Grupo Gemini adicionado com', geminiVoices.length, 'vozes');
    }

    // Grupo Edge TTS
    const edgeVoices = currentVoices.filter(v => v.provider === 'edge');
    if (edgeVoices.length > 0) {
        const edgeGroup = document.createElement('optgroup');
        edgeGroup.label = '🎙️ Edge TTS (Gratuito)';
        edgeVoices.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.id;
            opt.textContent = v.name;
            edgeGroup.appendChild(opt);
        });
        select.appendChild(edgeGroup);
        console.log('Grupo Edge TTS adicionado com', edgeVoices.length, 'vozes');
    }

    // Grupo ElevenLabs
    const elevenlabsVoices = currentVoices.filter(v => v.provider === 'elevenlabs');
    if (elevenlabsVoices.length > 0) {
        const elevenlabsGroup = document.createElement('optgroup');
        elevenlabsGroup.label = '🚀 ElevenLabs';
        elevenlabsVoices.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.id;
            opt.textContent = v.name;
            elevenlabsGroup.appendChild(opt);
        });
        select.appendChild(elevenlabsGroup);
        console.log('Grupo ElevenLabs adicionado com', elevenlabsVoices.length, 'vozes');
    }

    console.log('VoiceSelect populado com sucesso!');
}

// ── Selecionar voz ─────────────────────────────────────────────────────────
function selectVoice(voiceId) {
    selectedVoice = currentVoices.find(v => String(v.id) === String(voiceId));
    document.getElementById('voiceSelect').value = voiceId;
    if (selectedVoice) document.getElementById('textInput').value = selectedVoice.sampleText;
    document.querySelector('.generation-panel').scrollIntoView({ behavior: 'smooth' });
}

// ── Filtros ────────────────────────────────────────────────────────────────
function applyFilters() {
    const gender = document.getElementById('genderFilter').value;
    const language = document.getElementById('languageFilter').value;
    const style = document.getElementById('styleFilter').value;
    currentVoices = currentVoices.filter(v =>
        (!gender || v.gender === gender) &&
        (!language || v.language === language) &&
        (!style || v.style === style)
    );
    renderVoices(currentVoices);
}

function resetFilters() {
    loadAllVoices();
}

// ── Gerar áudio ───────────────────────────────────────────────────────────
async function generateAudio() {
    const text = document.getElementById('textInput').value.trim();
    const voiceId = document.getElementById('voiceSelect').value;
    const speechStyle = document.getElementById('speechStyle').value;

    if (!text) { alert('Por favor, digite o texto para gerar o áudio.'); return; }
    if (!voiceId) { alert('Por favor, selecione uma voz IA.'); return; }

    const voice = currentVoices.find(v => String(v.id) === String(voiceId));
    document.getElementById('loadingSpinner').style.display = 'block';
    document.getElementById('audioPlayer').style.display = 'none';

    try {
        const response = await fetch('/api/generate-audio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, voice: voice.model, style: speechStyle, language: voice.language, provider: voice.provider })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Erro ao gerar áudio');
        
        const audioUrl = result.download_url + '?t=' + Date.now();
        const audioPlayer = document.getElementById('generatedAudio');
        
        // Fetch do áudio e salvar como blob
        try {
            const audioResponse = await fetch(audioUrl);
            lastGeneratedAudioBlob = await audioResponse.blob();
            audioPlayer.src = URL.createObjectURL(lastGeneratedAudioBlob);
        } catch (blobError) {
            console.error('Erro ao criar blob:', blobError);
            audioPlayer.src = audioUrl;
        }
        
        audioPlayer.load();
        document.getElementById('loadingSpinner').style.display = 'none';
        const playerDiv = document.getElementById('audioPlayer');
        playerDiv.style.display = 'block';
        playerDiv.classList.add('active');
        console.log('✅ Player de áudio exibido');
        updateStats();
    } catch (error) {
        console.error('Erro ao gerar áudio:', error);
        document.getElementById('loadingSpinner').style.display = 'none';
        alert('Erro ao gerar áudio: ' + error.message + '\n\nPor favor, tente novamente.');
    }
}

function playSample(event, voiceId) {
    event.stopPropagation();
    const voice = currentVoices.find(v => String(v.id) === String(voiceId));
    document.getElementById('textInput').value = voice.sampleText;
    document.getElementById('voiceSelect').value = voiceId;
    generateAudio();
}

function likeVoice(event, voiceId) {
    event.stopPropagation();
    const heart = event.target.closest('button').querySelector('i');
    heart.classList.toggle('far');
    heart.classList.toggle('fas');
    heart.style.color = heart.classList.contains('fas') ? '#e74c3c' : '';
}

function downloadAudio() {
    const audio = document.getElementById('generatedAudio');
    const a = document.createElement('a');
    a.href = audio.src;
    a.download = `locucao_${Date.now()}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function shareAudio() {
    if (navigator.share) {
        navigator.share({ title: 'Locução IA', text: 'Confira esta locução!', url: window.location.href });
    } else {
        navigator.clipboard.writeText(window.location.href);
        alert('Link copiado!');
    }
}

// ── Enviar áudio para MiniDAW externa ─────────────────────────────────────
function sendToMiniDAW() {
    const audioPlayer = document.getElementById('generatedAudio');
    if (!audioPlayer || !audioPlayer.src || audioPlayer.src === window.location.href) {
        alert('Gere um áudio primeiro!');
        return;
    }
    localStorage.setItem('minidaw_pending_audio', audioPlayer.src);
    localStorage.setItem('minidaw_pending_timestamp', Date.now().toString());
    window.open('/minidaw', '_blank');
}

function updateStats() {
    const el = document.getElementById('audiosCount');
    const n = parseInt(el.textContent.replace(/\D/g, ''));
    el.textContent = (n + 1) + '+';
}

function getGenderLabel(g) {
    return { masculine: 'Masculino', feminine: 'Feminino', male: 'Masculino', female: 'Feminino', neutral: 'Neutro', cloned: 'Clonada' }[g] || g;
}

function getLanguageLabel(l) {
    return { 'pt-BR': 'Português BR', 'pt-PT': 'Português PT', 'en-US': 'Inglês US', 'en-GB': 'Inglês UK', 'es-ES': 'Espanhol', 'fr-FR': 'Francês', 'de-DE': 'Alemão', 'it-IT': 'Italiano', 'ja-JP': 'Japonês', 'zh-CN': 'Chinês' }[l] || l;
}

function getStyleLabel(s) {
    return { professional: 'Profissional', friendly: 'Amigável', energetic: 'Energético', calm: 'Calmo' }[s] || s;
}

// ── Clonagem (desabilitada) ────────────────────────────────────────────────
let audioFileBase64 = null;

function handleAudioFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { alert('Arquivo muito grande. Máximo: 10MB'); return; }
    const reader = new FileReader();
    reader.onload = e => {
        audioFileBase64 = e.target.result;
        document.getElementById('previewAudio').src = audioFileBase64;
        document.getElementById('audioPreview').style.display = 'block';
    };
    reader.readAsDataURL(file);
}

async function cloneVoice() {
    alert('Clonagem de voz requer plano pago no ElevenLabs.\nAcesse elevenlabs.io para fazer upgrade.');
}
