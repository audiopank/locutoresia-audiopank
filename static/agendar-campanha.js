// "📅 Agendar" do Gerador (16/10/2026): transforma o spot mixado numa CAMPANHA que
// o feed repete nos dias/horários escolhidos (página /campanhas). Módulo à parte —
// só lê o resultado do Gerador (#playerResultado, #textoComercial, #inputNome,
// #selectContaFeed), não mexe nele. Formulário em static/campanha-form.js.
(function () {
    'use strict';

    const $ = id => document.getElementById(id);

    function montarJanela() {
        let fundo = $('agendarCampanhaFundo');
        if (fundo) return fundo;
        fundo = document.createElement('div');
        fundo.id = 'agendarCampanhaFundo';
        fundo.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,.75);z-index:3000;display:none;' +
            'align-items:flex-start;justify-content:center;overflow:auto;padding:24px 12px;';
        fundo.innerHTML =
            '<div style="background:#1e293b;border:1px solid #334155;border-radius:14px;max-width:640px;width:100%;padding:18px;color:#f1f5f9">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
            '<strong style="font-size:1.1rem">📅 Agendar como campanha</strong>' +
            '<button type="button" id="agendarFechar" class="btn btn-sm btn-outline-light">✕</button></div>' +
            '<div id="agendarForm"></div>' +
            '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">' +
            '<a href="/campanhas" target="_blank" class="btn btn-sm btn-outline-light">Ver campanhas</a>' +
            '<button type="button" id="agendarSalvar" class="btn btn-sm btn-primary">Agendar</button></div></div>';
        document.body.appendChild(fundo);
        $('agendarFechar').onclick = () => { fundo.style.display = 'none'; };
        return fundo;
    }

    async function abrir() {
        const player = $('playerResultado');
        if (!player || !player.src) {
            alert('Gere ou mixe o spot primeiro — o Agendar usa o áudio que está no player.');
            return;
        }
        const fundo = montarJanela();
        const texto = ($('textoComercial') && $('textoComercial').value || '').trim();
        const form = window.CampanhaForm.montar($('agendarForm'), {
            comAudio: true,
            valores: {
                conta: $('selectContaFeed') ? $('selectContaFeed').value : 'locutores',
                titulo: ($('inputNome') && $('inputNome').value || '').trim(),
                legenda: texto
            }
        });
        fundo.style.display = 'flex';

        const btn = $('agendarSalvar');
        btn.onclick = async () => {
            btn.disabled = true;
            btn.textContent = 'Agendando...';
            form.erro('');
            try {
                const v = form.ler();
                const extras = {};
                if (v.levarAudio) {
                    const blob = await (await fetch(player.src)).blob();
                    const dataUrl = await window.CampanhaForm.blobParaDataUrl(blob);
                    extras.audio_url = await window.CampanhaForm.subirMidia(v.conta, 'audio', v.titulo || 'campanha', dataUrl, 'audio/mpeg');
                    extras.transcricao = texto;   // vira "Ver transcrição" no post
                }
                const c = await window.CampanhaForm.criar(form, extras);
                fundo.style.display = 'none';
                const [a, m, d] = c.proxima_em.split('-');
                alert(`📅 Campanha agendada!\nPrimeira saída: ${d}/${m}/${a} às ${String(c.horario).padStart(2, '0')}h ` +
                      `(se o teto do dia deixar).\nAcompanhe em Campanhas.`);
            } catch (e) {
                form.erro(e.message);
            } finally {
                btn.disabled = false;
                btn.textContent = 'Agendar';
            }
        };
    }

    document.addEventListener('DOMContentLoaded', () => {
        const b = $('btnAgendarCampanha');
        if (b) b.onclick = abrir;
    });
})();
