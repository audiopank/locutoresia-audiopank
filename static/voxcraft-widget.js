/**
 * VoxCraft AI — widget compartilhado (Gerador, MiniDAW).
 *
 * O que ele faz além de conversar (10/09/2026, níveis 2 e 3):
 *  - manda o CONTEXTO da tela a cada mensagem: a página define
 *    window.voxcraftContexto() e devolve um objeto (tela, roteiro, plano...);
 *    o backend calcula o diagnóstico e a IA critica com número de verdade.
 *  - renderiza as AÇÕES que o backend devolve (ex.: "Abrir no Gerador" com o
 *    episódio montado): na própria tela do Gerador aplica direto via
 *    window.aplicarPrefillVoxcraft(campos); de outra tela, guarda em
 *    sessionStorage.voxcraft_prefill e navega — o Gerador aplica ao abrir.
 *  - guarda o histórico da conversa na aba (sessionStorage), então a
 *    conversa continua quando ele muda de tela.
 * A home (index.html) ainda usa a cópia antiga do widget, sem ações.
 */
(function () {
    'use strict';

    const chat = document.getElementById('voxcraftChat');
    const box = document.getElementById('voxcraftMessages');
    const input = document.getElementById('voxcraftInput');
    const sendBtn = document.getElementById('voxcraftSendBtn');
    const typing = document.getElementById('voxcraftTyping');
    const toggle = document.getElementById('voxcraftToggleBtn');
    if (!chat || !box || !input || !sendBtn || !toggle) return;

    const CHAVE_HIST = 'voxcraft_historico';
    const CHAVE_PREFILL = 'voxcraft_prefill';
    let historico = [];
    try { historico = JSON.parse(sessionStorage.getItem(CHAVE_HIST) || '[]'); } catch (e) { historico = []; }
    if (!Array.isArray(historico)) historico = [];

    function guardarHistorico() {
        try { sessionStorage.setItem(CHAVE_HIST, JSON.stringify(historico.slice(-20))); } catch (e) { /* aba sem storage */ }
    }

    function botaoAcao(a) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'voxcraft-acao';
        b.textContent = a.rotulo || 'Abrir no Gerador';
        b.onclick = () => executarAcao(a);
        return b;
    }

    function executarAcao(a) {
        if (!a || a.tipo !== 'abrir_gerador') return;
        const campos = a.campos || {};
        if (location.pathname === '/gerador' && typeof window.aplicarPrefillVoxcraft === 'function') {
            window.aplicarPrefillVoxcraft(campos);
            chat.classList.remove('open');
            return;
        }
        try { sessionStorage.setItem(CHAVE_PREFILL, JSON.stringify(campos)); } catch (e) { /* segue sem prefill */ }
        location.href = '/gerador';
    }

    function addMessage(content, isUser, acoes) {
        const div = document.createElement('div');
        div.className = 'voxcraft-message ' + (isUser ? 'user' : 'assistant');
        div.textContent = content;
        if (!isUser && Array.isArray(acoes) && acoes.length) {
            const wrap = document.createElement('div');
            wrap.className = 'voxcraft-acoes';
            acoes.forEach(a => wrap.appendChild(botaoAcao(a)));
            div.appendChild(wrap);
        }
        box.appendChild(div);
        box.scrollTop = box.scrollHeight;
    }

    function contextoDaTela() {
        try {
            if (typeof window.voxcraftContexto === 'function') {
                const c = window.voxcraftContexto();
                if (c && typeof c === 'object') return c;
            }
        } catch (e) { /* contexto é extra: sem ele o chat segue */ }
        return { tela: location.pathname };
    }

    async function enviar() {
        const texto = input.value.trim();
        if (!texto) return;
        addMessage(texto, true);
        input.value = '';
        typing.classList.add('show');
        sendBtn.disabled = true;
        try {
            const r = await fetch('/api/voxcraft/chat', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [...historico, { role: 'user', content: texto }],
                    contexto: contextoDaTela()
                })
            });
            const d = await r.json();
            typing.classList.remove('show');
            if (d.success) {
                addMessage(d.message, false, d.acoes);
                historico.push({ role: 'user', content: texto }, { role: 'assistant', content: d.message });
                guardarHistorico();
            } else {
                addMessage('Não consegui responder: ' + (d.error || 'erro desconhecido'), false);
            }
        } catch (e) {
            typing.classList.remove('show');
            addMessage('Erro de conexão com o servidor. Tente de novo.', false);
        } finally {
            sendBtn.disabled = false;
            input.focus();
        }
    }

    // Conversa da aba volta na tela nova (as últimas 10 mensagens).
    historico.slice(-10).forEach(m => addMessage(m.content, m.role === 'user'));

    toggle.addEventListener('click', () => {
        chat.classList.toggle('open');
        if (chat.classList.contains('open')) input.focus();
    });
    sendBtn.addEventListener('click', enviar);
    input.addEventListener('keypress', e => { if (e.key === 'Enter') enviar(); });
})();
