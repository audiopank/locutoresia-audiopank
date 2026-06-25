// Carrega todas as vozes (Gemini + Edge TTS + ElevenLabs)
let allVoices = [];
let currentVoices = [];
let selectedVoice = null;
let lastGeneratedAudioBlob = null;

function showToast(title, description = '', variant = 'success') {
    const toast = document.createElement('div');
    toast.className = 'position-fixed bottom-0 end-0 p-3 z-toast';
    const bgClass = variant === 'destructive' ? 'bg-danger' : 'bg-success';
    toast.innerHTML = `
        <div class="toast align-items-center border-0 ${bgClass} text-white" role="alert">
            <div class="d-flex">
                <div class="toast-body">
                    <strong>${title}</strong>
                    ${description ? `<br><small>${description}</small>` : ''}
                </div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
            </div>
        </div>
    `;
    document.body.appendChild(toast);
    const bootstrapToast = new bootstrap.Toast(toast.querySelector('.toast'), { delay: 3500 });
    bootstrapToast.show();
    setTimeout(() => toast.remove(), 4000);
}

document.addEventListener('DOMContentLoaded', function() {
    console.log('??? Locutores IA - Inicializando...');
    
    loadAllVoices();
    updateStats();

    // Botão Gerar áudio
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

    console.log('? Locutores IA - Inicialização completa!');
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
                // Adicionar style padrão para vozes ElevenLabs
                const elevenWithStyle = elevenResult.voices.map(v => ({
                    ...v,
                    style: v.style || 'professional'
                }));
                currentVoices = [...currentVoices, ...elevenWithStyle];
            }
        } catch (elevenError) {
            console.log('?? Vozes ElevenLabs não carregadas:', elevenError);
        }
        
        // Carregar vozes clonadas do localStorage
        try {
            const storedCloned = localStorage.getItem('cloned_voices_library');
            if (storedCloned) {
                const clonedVoices = JSON.parse(storedCloned);
                const clonedWithFormat = clonedVoices.map(v => ({
                    id: v.lmntVoiceId || v.id,
                    name: `${v.name} (Clonada)`,
                    description: v.description || 'Voz clonada personalizada',
                    gender: v.gender || 'neutral',
                    language: 'pt-BR',
                    style: 'professional',
                    avatar: `https://picsum.photos/seed/cloned-${v.id}/80/80`,
                    model: v.lmntVoiceId || v.id,
                    provider: 'cloned',
                    sampleText: 'Olá! Esta é uma amostra da minha voz clonada.'
                }));
                currentVoices = [...currentVoices, ...clonedWithFormat];
            }
        } catch (clonedError) {
            console.log('?? Vozes clonadas não carregadas:', clonedError);
        }
        
        // Check if there's a selected voice from localStorage (from cloned voices page)
        const selectedVoiceId = localStorage.getItem('selectedVoiceId');
        const selectedVoiceName = localStorage.getItem('selectedVoiceName');
        if (selectedVoiceId && selectedVoiceName) {
            setTimeout(() => {
                const select = document.getElementById('voiceSelect');
                if (select) {
                    // Try to find the voice in the currentVoices
                    const voiceExists = currentVoices.find(v => String(v.id) === String(selectedVoiceId));
                    if (voiceExists) {
                        select.value = selectedVoiceId;
                        selectVoice(selectedVoiceId);
                    }
                    // Clear the selection from localStorage so it doesn't persist
                    localStorage.removeItem('selectedVoiceId');
                    localStorage.removeItem('selectedVoiceName');
                }
            }, 500);
        }
        
        console.log(`? ${currentVoices.length} vozes carregadas (incluindo Gemini e ElevenLabs)!`);
        allVoices = [...currentVoices];
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
        elevenlabsGroup.label = '?? ElevenLabs';
        elevenlabsVoices.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.id;
            opt.textContent = v.name;
            elevenlabsGroup.appendChild(opt);
        });
        select.appendChild(elevenlabsGroup);
        console.log('Grupo ElevenLabs adicionado com', elevenlabsVoices.length, 'vozes');
    }

    // Grupo Vozes Clonadas
    const clonedVoices = currentVoices.filter(v => v.provider === 'cloned');
    if (clonedVoices.length > 0) {
        const clonedGroup = document.createElement('optgroup');
        clonedGroup.label = '?? Vozes Clonadas';
        clonedVoices.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.id;
            opt.textContent = v.name;
            clonedGroup.appendChild(opt);
        });
        select.appendChild(clonedGroup);
        console.log('Grupo Vozes Clonadas adicionado com', clonedVoices.length, 'vozes');
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

// ── Gerar áudio ───────────────────────────────────────────────────────────
async function generateAudio() {
    const text = document.getElementById('textInput').value.trim();
    const voiceId = document.getElementById('voiceSelect').value;
    const speechStyle = document.getElementById('styleSelect').value;

    if (!text) { alert('Por favor, digite o texto para gerar o áudio.'); return; }
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
                provider: voice.provider === 'cloned' ? 'lmnt' : ((voice.provider && voice.provider !== 'cloned') ? voice.provider : 'auto') 
            })
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
