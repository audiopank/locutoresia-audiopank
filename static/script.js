// Carrega todas as vozes (Gemini + Edge TTS + ElevenLabs)
let allVoices = [];
let currentVoices = [];
let selectedVoice = null;
let lastGeneratedAudioBlob = null;

document.addEventListener('DOMContentLoaded', function() {
    console.log('🎙️ Locutores IA - Inicializando...');
    
    loadAllVoices();
    updateStats();

    // Botão Gerar Áudio
    const generateBtn = document.getElementById('generateBtn');
    if (generateBtn) {
        generateBtn.addEventListener('click', generateAudio);
    }

    // Botões de Filtro
    const filterBtn = document.querySelector('.filter-panel .btn-generate');
    if (filterBtn) {
        filterBtn.addEventListener('click', applyFilters);
    }

    const clearBtn = document.getElementById('clearFilters');
    if (clearBtn) {
        clearBtn.addEventListener('click', resetFilters);
    }

    const audioInput = document.getElementById('audioFileInput');
    if (audioInput) {
        audioInput.addEventListener('change', handleAudioFileSelect);
    }

    console.log('✅ Locutores IA - Inicialização completa!');
});

// ÔöÇÔöÇ Carregar TODAS as vozes (Gemini + Edge TTS + ElevenLabs) ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
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
        
        // Carregar vozes da ElevenLabs tamb├®m
        try {
            const elevenResponse = await fetch('/api/list-elevenlabs-voices');
            const elevenResult = await elevenResponse.json();
            if (elevenResponse.ok && elevenResult.success && elevenResult.voices) {
                // Adicionar style padrão para vozes ElevenLabs
                const elevenWithStyle = elevenResult.voices.map(v => ({
                    ...v,
                    style: v.style || 'professional'
                }));
                currentVoices = [...currentVoices, ...elevenWithStyle];
            }
        } catch (elevenError) {
            console.log('ÔÜá´©Å Vozes ElevenLabs n├úo carregadas:', elevenError);
        }
        
        console.log(`Ô£à ${currentVoices.length} vozes carregadas (incluindo Gemini e ElevenLabs)!`);
        allVoices = [...currentVoices];
        renderVoices(currentVoices);
        populateVoiceSelect();
    } catch (error) {
        console.error('Erro ao carregar vozes:', error);
        // Fallback para voz padr├úo
        currentVoices = [
            { id: 'Sadachbia', name: 'Sadachbia - Gemini', description: 'Voz masculina clara e profissional', gender: 'male', language: 'pt-BR', style: 'professional', avatar: 'https://picsum.photos/seed/Sadachbia/80/80', model: 'Sadachbia', provider: 'gemini', sampleText: 'Bem-vindo ├á nossa plataforma. Estamos aqui para oferecer o melhor servi├ºo poss├¡vel.' }
        ];
        renderVoices(currentVoices);
        populateVoiceSelect();
    }
}

function getVoiceName(voice) {
    const geminiVozes = [
        'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe',
        'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
        'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'
    ];
    if (geminiVozes.includes(voice.id)) {
        return `${voice.id} - Gemini`;
    }
    return voice.name || voice.id;
}

function getVoiceDescription(voice) {
    const geminiVozes = [
        'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe',
        'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
        'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'
    ];
    if (geminiVozes.includes(voice.id)) {
        return `Voz ${voice.gender === 'male' ? 'masculina' : 'feminina'} do Google Gemini`;
    }
    return `Voz ${voice.gender === 'male' ? 'masculina' : 'feminina'} de alta qualidade`;
}

function getVoiceProvider(voiceId) {
    const geminiVozes = [
        'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe',
        'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
        'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'
    ];
    const edgeVozes = ['pt-BR-AntonioNeural', 'pt-BR-FranciscaNeural', 'pt-BR-DanielNeural'];
    if (geminiVozes.includes(voiceId)) return 'gemini';
    if (edgeVozes.includes(voiceId)) return 'edge';
    return 'other';
}

function getSampleText(voice) {
    return `Ol├í! Esta ├® uma amostra da voz ${voice.id} gerada com intelig├¬ncia artificial.`;
}

// ÔöÇÔöÇ Renderizar vozes ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
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

// ÔöÇÔöÇ Populate select agrupado ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
function populateVoiceSelect() {
    const select = document.getElementById('voiceSelect');
    if (!select) {
        console.error('ERRO: Elemento voiceSelect n├úo encontrado!');
        return;
    }

    console.log('Populando voiceSelect com', currentVoices.length, 'vozes');

    select.innerHTML = '<option value="">Selecione uma voz</option>';

    // Grupo Gemini (PRIMEIRO)
    const geminiVoices = currentVoices.filter(v => v.provider === 'gemini');
    if (geminiVoices.length > 0) {
        const geminiGroup = document.createElement('optgroup');
        geminiGroup.label = '­ƒîƒ Gemini 3.1 Flash TTS (Recomendado)';
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
        edgeGroup.label = '­ƒÄÖ´©Å Edge TTS (Gratuito)';
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
        elevenlabsGroup.label = '­ƒÜÇ ElevenLabs';
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

// ÔöÇÔöÇ Selecionar voz ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
function selectVoice(voiceId) {
    selectedVoice = currentVoices.find(v => String(v.id) === String(voiceId));
    document.getElementById('voiceSelect').value = voiceId;
    if (selectedVoice) document.getElementById('textInput').value = selectedVoice.sampleText;
    document.querySelector('.generation-panel').scrollIntoView({ behavior: 'smooth' });
}

// ÔöÇÔöÇ Filtros ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
function applyFilters() {
    const gender = document.getElementById('genderFilter').value;
    const language = document.getElementById('languageFilter').value;
    const style = document.getElementById('styleFilter').value;
    console.log('Applying filters:', { gender, language, style });
    console.log('All voices:', allVoices);
    
    currentVoices = allVoices.filter(v => {
        const matchGender = !gender || v.gender === gender || (gender === 'male' && v.gender === 'masculine') || (gender === 'female' && v.gender === 'feminine');
        const matchLanguage = !language || v.language === language;
        const matchStyle = !style || v.style === style;
        console.log('Checking voice:', v.id, { matchGender, matchLanguage, matchStyle });
        return matchGender && matchLanguage && matchStyle;
    });
    renderVoices(currentVoices);
    console.log('Filtered voices:', currentVoices);
}

function resetFilters() {
    loadAllVoices();
}

// ÔöÇÔöÇ Gerar ├íudio ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
async function generateAudio() {
    const text = document.getElementById('textInput').value.trim();
    const voiceId = document.getElementById('voiceSelect').value;
    const speechStyle = document.getElementById('styleSelect').value;

    if (!text) { alert('Por favor, digite o texto para gerar o ├íudio.'); return; }
    if (!voiceId) { alert('Por favor, selecione uma voz IA.'); return; }

    console.log('Looking for voiceId:', voiceId);
    console.log('Current voices:', currentVoices);
    
    let voice = currentVoices.find(v => String(v.id) === String(voiceId));
    if (!voice) {
        // Fallback: try allVoices
        voice = allVoices.find(v => String(v.id) === String(voiceId));
        if (!voice) {
            alert('Voz não encontrada. Por favor, recarregue a página.');
            return;
        }
    }
    
    console.log('Found voice:', voice);
    document.getElementById('loadingSpinner').style.display = 'block';
    document.getElementById('audioPlayer').style.display = 'none';

    try {
        const response = await fetch('/api/generate-audio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                text, 
                voice: voice.model || voiceId, 
                style: speechStyle, 
                language: voice.language || 'pt-BR', 
                provider: voice.provider || 'auto' 
            })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Erro ao gerar ├íudio');
        
        const audioUrl = result.download_url + '?t=' + Date.now();
        const audioPlayer = document.getElementById('generatedAudio');
        
        // Fetch do ├íudio e salvar como blob
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
        console.log('Ô£à Player de ├íudio exibido');
        updateStats();
    } catch (error) {
        console.error('Erro ao gerar ├íudio:', error);
        document.getElementById('loadingSpinner').style.display = 'none';
        alert('Erro ao gerar ├íudio: ' + error.message + '\n\nPor favor, tente novamente.');
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
        navigator.share({ title: 'Locu├º├úo IA', text: 'Confira esta locu├º├úo!', url: window.location.href });
    } else {
        navigator.clipboard.writeText(window.location.href);
        alert('Link copiado!');
    }
}

// ÔöÇÔöÇ Enviar ├íudio para MiniDAW externa ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
function sendToMiniDAW() {
    const audioPlayer = document.getElementById('generatedAudio');
    if (!audioPlayer || !audioPlayer.src || audioPlayer.src === window.location.href) {
        alert('Gere um ├íudio primeiro!');
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
    return { 'pt-BR': 'Portugu├¬s BR', 'pt-PT': 'Portugu├¬s PT', 'en-US': 'Ingl├¬s US', 'en-GB': 'Ingl├¬s UK', 'es-ES': 'Espanhol', 'fr-FR': 'Franc├¬s', 'de-DE': 'Alem├úo', 'it-IT': 'Italiano', 'ja-JP': 'Japon├¬s', 'zh-CN': 'Chin├¬s' }[l] || l;
}

function getStyleLabel(s) {
    return { professional: 'Profissional', friendly: 'Amig├ível', energetic: 'Energ├®tico', calm: 'Calmo' }[s] || s;
}

// ÔöÇÔöÇ Clonagem (desabilitada) ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
let audioFileBase64 = null;

function handleAudioFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { alert('Arquivo muito grande. M├íximo: 10MB'); return; }
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
