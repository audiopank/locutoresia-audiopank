const CLONED_VOICES_KEY = "cloned_voices_library";

class ClonedVoicesLibrary {
  constructor() {
    this.voices = [];
    this.searchQuery = "";
    this.playingVoice = null;
    this.sendingToDAW = null;
    this.audioElement = null;
    this.init();
  }

  init() {
    this.loadVoices();
  }

  loadVoices() {
    try {
      const stored = localStorage.getItem(CLONED_VOICES_KEY);
      if (stored) {
        this.voices = JSON.parse(stored);
      }
    } catch (e) {
      console.error("Error loading cloned voices:", e);
    }
  }

  saveVoices() {
    localStorage.setItem(CLONED_VOICES_KEY, JSON.stringify(this.voices));
  }

  deleteVoice(voiceId, voiceName) {
    this.voices = this.voices.filter(v => v.id !== voiceId);
    this.saveVoices();
    this.showToast("Voz removida", voiceName);
    this.render();
  }

  getFilteredVoices() {
    return this.voices.filter(v =>
      v.name.toLowerCase().includes(this.searchQuery.toLowerCase()) ||
      (v.description && v.description.toLowerCase().includes(this.searchQuery.toLowerCase()))
    );
  }

  async handlePlayPreview(voice) {
    const voiceId = voice.lmntVoiceId || voice.id;
    if (this.playingVoice === voiceId) {
      if (this.audioElement) {
        this.audioElement.pause();
        this.audioElement.currentTime = 0;
      }
      this.playingVoice = null;
      this.render();
      return;
    }

    try {
      this.playingVoice = voiceId;
      this.render();

      if (this.audioElement) this.audioElement.pause();

      const text = "Olá, esta é uma prévia da minha voz clonada.";
      const audioUrl = await this.synthesizeSpeech(text, voiceId, 'pt');

      const audio = new Audio(audioUrl);
      this.audioElement = audio;
      audio.onended = () => {
        this.playingVoice = null;
        this.render();
      };
      audio.onerror = () => {
        this.playingVoice = null;
        this.showToast("Erro ao reproduzir", "", "destructive");
        this.render();
      };
      await audio.play();
    } catch (e) {
      console.error(e);
      this.playingVoice = null;
      this.render();
    }
  }

  handleUseVoice(voice) {
    const selectedVoiceId = voice.lmntVoiceId || voice.id;
    const selectedVoiceName = voice.name;
    localStorage.setItem('selectedVoiceId', selectedVoiceId);
    localStorage.setItem('selectedVoiceName', selectedVoiceName);
    this.showToast("Voz selecionada", `${voice.name} para Text to Speech`);
    window.location.href = '/';
  }

  async handleSendToDAW(voice) {
    const voiceId = voice.lmntVoiceId || voice.id;
    this.sendingToDAW = voiceId;
    this.render();

    try {
      const text = "Olá, esta é uma demonstração da minha voz clonada. Você pode editar este áudio no MiniDAW.";
      const audioUrl = await this.synthesizeSpeech(text, voiceId, 'pt');

      const response = await fetch(audioUrl);
      const blob = await response.blob();
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      localStorage.setItem('importedAudioBase64', base64);
      localStorage.setItem('importedAudioName', `Voz Clonada - ${voice.name}`);
      localStorage.setItem('importedAudioType', 'voiceover');

      this.showToast("Áudio enviado para MiniDAW!");
      window.location.href = '/minidaw';
    } catch (e) {
      console.error(e);
      this.showToast("Erro ao enviar para MiniDAW", "Tente novamente", "destructive");
    } finally {
      this.sendingToDAW = null;
      this.render();
    }
  }

  handleExportAll() {
    if (this.voices.length === 0) {
      this.showToast("Nada para exportar", "Adicione vozes clonadas primeiro", "destructive");
      return;
    }

    const data = JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      voices: this.voices
    }, null, 2);

    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vozes-clonadas-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.showToast("Exportação concluída", `${this.voices.length} voz(es) exportada(s)`);
  }

  handleImportFile(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(evt.target.result);
        const imported = parsed.voices || parsed;

        if (!Array.isArray(imported) || imported.length === 0) {
          this.showToast("Arquivo inválido", "Nenhuma voz encontrada no arquivo", "destructive");
          return;
        }

        const existingIds = new Set(this.voices.map(v => v.id));
        const newVoices = imported.filter(v => v.name && !existingIds.has(v.id));

        if (newVoices.length === 0) {
          this.showToast("Nenhuma voz nova", "Todas as vozes já existem na biblioteca");
          return;
        }

        this.voices = [...newVoices, ...this.voices];
        this.saveVoices();
        this.showToast("Importação concluída", `${newVoices.length} voz(es) importada(s)`);
        this.render();
      } catch (e) {
        console.error(e);
        this.showToast("Erro ao importar", "Arquivo JSON inválido", "destructive");
      }
    };
    reader.readAsText(file);
  }

  async synthesizeSpeech(text, voiceId, language) {
    try {
      const response = await fetch('/api/tts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: voiceId, lang: language })
      });

      if (!response.ok) throw new Error('TTS failed');

      const data = await response.json();
      if (data.audio_url) {
        return data.audio_url;
      }

      throw new Error('No audio URL');
    } catch (e) {
      console.error('TTS error:', e);
      throw e;
    }
  }

  showToast(title, description = "", variant = "default") {
    const toast = document.createElement('div');
    toast.className = `position-fixed bottom-0 end-0 p-3 z-toast`;
    toast.innerHTML = `
      <div class="toast align-items-center border-0 ${variant === 'destructive' ? 'bg-danger text-white' : 'bg-success text-white'}" role="alert">
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

  render(containerId = 'react-voices-container') {
    const container = document.getElementById(containerId);
    if (!container) return;

    const filteredVoices = this.getFilteredVoices();

    let html = `
      <div style="max-width: 100%; padding: 2rem;">
        <div style="margin-bottom: 2rem; display: flex; flex-direction: column; gap: 1rem;">
          <div>
            <h2 style="color: #E2E8F0; margin-bottom: 0.5rem;">
              <i class="fas fa-microphone me-2" style="color: #6366f1;"></i>Vozes Clonadas
            </h2>
            <p style="color: #94a3b8; margin: 0;">Gerencie suas vozes clonadas personalizadas</p>
          </div>
          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
            <input type="file" accept=".json" id="voices-import-input" style="display: none;">
            <button class="btn btn-outline-light btn-sm" onclick="clonedVoicesLibrary.triggerImport()">
              <i class="fas fa-upload me-1"></i>Importar
            </button>
            <button class="btn btn-outline-light btn-sm" onclick="clonedVoicesLibrary.handleExportAll()" ${this.voices.length === 0 ? 'disabled' : ''}>
              <i class="fas fa-download me-1"></i>Exportar
            </button>
            <button class="btn btn-primary btn-sm" onclick="clonedVoicesLibrary.goToCloning()">
              <i class="fas fa-microphone me-1"></i>Clonar Nova Voz
            </button>
          </div>
        </div>
    `;

    if (this.voices.length > 0) {
      html += `
        <div style="margin-bottom: 1.5rem;">
          <div style="position: relative;">
            <i class="fas fa-search" style="position: absolute; left: 1rem; top: 50%; transform: translateY(-50%); color: #94a3b8;"></i>
            <input type="text" id="voices-search-input" placeholder="Buscar vozes clonadas..." 
                   style="width: 100%; padding: 0.75rem 1rem 0.75rem 3rem; 
                          background: rgba(30,41,59,0.8); border: 1px solid #334155; 
                          border-radius: 8px; color: #E2E8F0;" 
                   value="${this.searchQuery}">
          </div>
        </div>
      `;
    }

    if (filteredVoices.length === 0) {
      html += `
        <div style="background: rgba(30,41,59,0.8); border: 1px solid #334155; border-radius: 12px; padding: 3rem; text-align: center;">
          <i class="fas fa-microphone" style="font-size: 4rem; color: rgba(148,163,184,0.3); margin-bottom: 1rem;"></i>
          <h3 style="color: #E2E8F0; margin-bottom: 0.5rem;">
            ${this.voices.length === 0 ? "Nenhuma voz clonada ainda" : "Nenhum resultado encontrado"}
          </h3>
          <p style="color: #94a3b8; margin-bottom: 1.5rem;">
            ${this.voices.length === 0 ? "Clone sua primeira voz ou importe de outro dispositivo" : "Tente uma busca diferente"}
          </p>
          <div style="display: flex; justify-content: center; gap: 0.75rem;">
            ${this.voices.length === 0 ? `
              <button class="btn btn-primary" onclick="clonedVoicesLibrary.goToCloning()">
                <i class="fas fa-microphone me-1"></i>Clonar Primeira Voz
              </button>
              <button class="btn btn-outline-light" onclick="clonedVoicesLibrary.triggerImport()">
                <i class="fas fa-upload me-1"></i>Importar Arquivo
              </button>
            ` : ''}
          </div>
        </div>
      `;
    } else {
      html += `<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1rem;">`;
      
      filteredVoices.forEach(voice => {
        const voiceId = voice.lmntVoiceId || voice.id;
        html += `
          <div style="background: rgba(30,41,59,0.8); border: 1px solid #334155; border-radius: 12px; padding: 1.25rem;">
            <div style="display: flex; align-items: flex-start; gap: 0.75rem; margin-bottom: 1rem;">
              <div style="width: 48px; height: 48px; border-radius: 50%; background: rgba(99,102,241,0.2); display: flex; align-items: center; justify-content: center;">
                <i class="fas fa-user" style="color: #6366f1; font-size: 1.5rem;"></i>
              </div>
              <div style="flex: 1; min-width: 0;">
                <h4 style="color: #E2E8F0; margin: 0 0 0.25rem; font-size: 1rem; font-weight: 600;">
                  ${voice.name}
                </h4>
                ${voice.description ? `<p style="color: #94a3b8; margin: 0 0 0.5rem; font-size: 0.875rem;">${voice.description}</p>` : ''}
                <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                  ${voice.gender ? `
                    <span style="font-size: 0.75rem; background: rgba(139,92,246,0.2); color: #A78BFA; padding: 0.125rem 0.5rem; border-radius: 9999px; text-transform: capitalize;">
                      ${voice.gender}
                    </span>
                  ` : ''}
                  <span style="font-size: 0.75rem; color: #94a3b8; display: flex; align-items: center; gap: 0.25rem;">
                    <i class="fas fa-clock" style="font-size: 0.75rem;"></i>
                    ${new Date(voice.createdAt).toLocaleDateString('pt-BR')}
                  </span>
                </div>
              </div>
            </div>
            <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
              <button class="btn btn-outline-light btn-sm" style="flex: 1;" onclick="clonedVoicesLibrary.handlePlayPreview(${JSON.stringify(voice).replace(/"/g, '&quot;')})" 
                      ${this.playingVoice === voiceId ? 'disabled' : ''}>
                ${this.playingVoice === voiceId ? '<i class="fas fa-pause me-1"></i>Pausar' : '<i class="fas fa-play me-1"></i>Preview'}
              </button>
              <button class="btn btn-primary btn-sm" style="flex: 1;" onclick="clonedVoicesLibrary.handleUseVoice(${JSON.stringify(voice).replace(/"/g, '&quot;')})">
                <i class="fas fa-microphone me-1"></i>Usar
              </button>
              <button class="btn btn-secondary btn-sm" style="flex: 1;" onclick="clonedVoicesLibrary.handleSendToDAW(${JSON.stringify(voice).replace(/"/g, '&quot;')})"
                      ${this.sendingToDAW === voiceId ? 'disabled' : ''}>
                ${this.sendingToDAW === voiceId ? '<i class="fas fa-spinner fa-spin me-1"></i>Enviando...' : '<i class="fas fa-paper-plane me-1"></i>MiniDAW'}
              </button>
              <button class="btn btn-outline-danger btn-sm" onclick="clonedVoicesLibrary.deleteVoice('${voice.id}', '${voice.name}')">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </div>
        `;
      });

      html += `</div>`;
    }

    html += `</div>`;
    container.innerHTML = html;

    const searchInput = document.getElementById('voices-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value;
        this.render();
      });
    }

    const importInput = document.getElementById('voices-import-input');
    if (importInput) {
      importInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          this.handleImportFile(e.target.files[0]);
        }
      });
    }
  }

  triggerImport() {
    const input = document.getElementById('voices-import-input');
    if (input) input.click();
  }

  goToCloning() {
    window.location.href = '/voice-cloning';
  }
}

let clonedVoicesLibrary = null;

document.addEventListener('DOMContentLoaded', () => {
  clonedVoicesLibrary = new ClonedVoicesLibrary();
});

window.clonedVoicesLibrary = clonedVoicesLibrary;
