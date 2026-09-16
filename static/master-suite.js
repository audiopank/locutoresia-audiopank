/**
 * Suíte Master — módulo A (16/09/2026): analisador de espectro + medidores do
 * barramento de saída da MiniDAW clássica.
 *
 * SÓ ESCUTA. Os AnalyserNodes ficam pendurados em `minidaw.masterOut`; nada
 * entra no caminho do som. EQ (módulo B) e limiter (módulo C) entrarão entre
 * masterIn e masterOut depois — o painel já está pronto pra mostrar IN/OUT.
 *
 * Números, com honestidade:
 *  - VU L/R: pico por amostra em dBFS (retenção de 1,5 s) + CLIP (≥ -0,1 dBFS).
 *  - LUFS-M: loudness MOMENTÂNEO, K-weighting (BS.1770) num bloco de ~370 ms
 *    (fftSize 16384 a 44,1 kHz). É "M", não integrado — o integrado com os dois
 *    portões e o pico REAL (inter-amostra) só existem no ARQUIVO exportado:
 *    medirArquivo() usa static/loudness.js (porta da MiniDAW React).
 */
(function (global) {
    'use strict';

    const BANDAS_HZ = [60, 80, 100, 130, 170, 230, 310, 420, 600, 800, 1000, 1400, 2000, 2800, 4000, 5500, 7500, 10000, 13000, 16000];
    const ROTULOS = { 60: '60', 170: '170', 310: '310', 600: '600', 1000: '1K', 3000: '3K', 6000: '6K', 13000: '13K', 16000: '16K' };
    const PISO_DB = -60;          // fundo dos VU
    const ESPECTRO_MIN = -84, ESPECTRO_MAX = -6;
    const HOLD_MS = 1500;
    const QUEDA_DB = 0.6;         // queda visual por quadro (~36 dB/s)

    const $ = id => document.getElementById(id);
    let daw = null, ctx = null, anL = null, anR = null, anSpec = null;
    let bufL = null, bufR = null, bufSpec = null;
    let raf = null, ligado = false, ultimoLufsMs = 0, lufsM = -Infinity, clip = false;
    const vu = { L: { db: -Infinity, hold: -Infinity, t: 0 }, R: { db: -Infinity, hold: -Infinity, t: 0 } };
    let picosEspectro = [];

    function dbDe(x) { return x > 0 ? 20 * Math.log10(x) : -Infinity; }
    function fmt(db) { return Number.isFinite(db) ? db.toFixed(1).replace('.', ',') : '−∞'; }
    function pct(db) { return Math.max(0, Math.min(100, (db - PISO_DB) / (0 - PISO_DB) * 100)); }

    function instalar(minidaw) {
        daw = minidaw;
        ctx = daw.audioContext;
        if (!daw.masterOut || !$('masterSuite')) return false;
        const splitter = ctx.createChannelSplitter(2);
        daw.masterOut.connect(splitter);
        anL = ctx.createAnalyser(); anR = ctx.createAnalyser();
        anL.fftSize = anR.fftSize = 16384;                    // ~370 ms @ 44,1 kHz pro LUFS-M
        anL.smoothingTimeConstant = anR.smoothingTimeConstant = 0;
        splitter.connect(anL, 0);
        splitter.connect(anR, 1);
        anSpec = ctx.createAnalyser();
        anSpec.fftSize = 4096;
        anSpec.smoothingTimeConstant = 0.75;
        daw.masterOut.connect(anSpec);
        bufL = new Float32Array(anL.fftSize);
        bufR = new Float32Array(anR.fftSize);
        bufSpec = new Float32Array(anSpec.frequencyBinCount);
        picosEspectro = BANDAS_HZ.map(() => ({ db: ESPECTRO_MIN, t: 0 }));
        window.addEventListener('resize', () => desenhar(0));
        desenhar(0);
        return true;
    }

    function ligar() {
        ligado = true;
        clip = false;
        const led = $('msClip');
        if (led) led.classList.remove('on');
        if (!raf) raf = requestAnimationFrame(quadro);
    }
    function desligar() { ligado = false; }   // o laço decai sozinho e para

    function atualizarVu(p, buf, ts) {
        let max = 0;
        for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > max) max = a; }
        const inst = dbDe(max);
        if (inst >= -0.1) clip = true;
        p.db = Math.max(inst, Number.isFinite(p.db) ? p.db - QUEDA_DB : -Infinity);
        if (inst >= p.hold || !Number.isFinite(p.hold)) { p.hold = inst; p.t = ts; }
        else if (ts - p.t > HOLD_MS) { p.hold = p.db; p.t = ts; }
    }

    function loudnessMomentaneo() {
        const L = global.Loudness;
        if (!L) return -Infinity;
        const sr = ctx.sampleRate;
        const kL = L.filtroK(bufL, sr), kR = L.filtroK(bufR, sr);
        let s = 0;
        for (let i = 0; i < kL.length; i++) s += kL[i] * kL[i] + kR[i] * kR[i];
        const ms = s / kL.length;
        return ms > 1e-12 ? -0.691 + 10 * Math.log10(ms) : -Infinity;
    }

    function quadro(ts) {
        raf = null;
        if (!anL) return;
        anL.getFloatTimeDomainData(bufL);
        anR.getFloatTimeDomainData(bufR);
        atualizarVu(vu.L, bufL, ts);
        atualizarVu(vu.R, bufR, ts);
        if (ligado) {
            if (ts - ultimoLufsMs > 100) { ultimoLufsMs = ts; lufsM = loudnessMomentaneo(); }
        } else {
            lufsM = -Infinity;
        }
        anSpec.getFloatFrequencyData(bufSpec);
        desenhar(ts);
        // Tocando: segue. Parado: mais alguns quadros até os VU descerem ao piso.
        if (ligado || vu.L.db > PISO_DB || vu.R.db > PISO_DB) raf = requestAnimationFrame(quadro);
    }

    function desenhar(ts) {
        for (const ch of ['L', 'R']) {
            const p = vu[ch];
            const cobre = $('msCobre' + ch), pico = $('msPico' + ch), txt = $('msDb' + ch);
            if (cobre) cobre.style.width = (100 - pct(p.db)) + '%';
            if (pico) { pico.style.left = pct(p.hold) + '%'; pico.style.opacity = Number.isFinite(p.hold) && p.hold > PISO_DB ? 1 : 0; }
            if (txt) txt.textContent = fmt(p.db);
        }
        const l = $('msLufsM');
        if (l) l.textContent = fmt(lufsM);
        const led = $('msClip');
        if (led) led.classList.toggle('on', clip);
        desenharEspectro(ts);
    }

    function desenharEspectro(ts) {
        const canvas = $('msEspectro');
        if (!canvas) return;
        const w = Math.floor(canvas.offsetWidth), h = Math.floor(canvas.offsetHeight);
        if (!w || !h) return;
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        const c = canvas.getContext('2d');
        c.clearRect(0, 0, w, h);
        const rodape = 13, topo = 4;
        const alt = h - rodape - topo;
        const n = BANDAS_HZ.length;
        const larg = w / n;
        const sr = ctx ? ctx.sampleRate : 44100;
        const binHz = anSpec ? sr / anSpec.fftSize : 1;
        // Linhas de grade (-12, -24, -36, -48 dB relativos ao topo da escala)
        c.strokeStyle = 'rgba(148,163,184,.12)';
        c.lineWidth = 1;
        for (let g = ESPECTRO_MAX - 12; g > ESPECTRO_MIN; g -= 12) {
            const y = topo + alt * (1 - (g - ESPECTRO_MIN) / (ESPECTRO_MAX - ESPECTRO_MIN));
            c.beginPath(); c.moveTo(0, Math.round(y) + .5); c.lineTo(w, Math.round(y) + .5); c.stroke();
        }
        for (let i = 0; i < n; i++) {
            // Banda = do meio geométrico com a vizinha de baixo ao meio com a de cima.
            const lo = i === 0 ? BANDAS_HZ[0] / 1.2 : Math.sqrt(BANDAS_HZ[i - 1] * BANDAS_HZ[i]);
            const hi = i === n - 1 ? BANDAS_HZ[i] * 1.2 : Math.sqrt(BANDAS_HZ[i] * BANDAS_HZ[i + 1]);
            let db = ESPECTRO_MIN;
            if (bufSpec && anSpec) {
                const b0 = Math.max(0, Math.floor(lo / binHz)), b1 = Math.min(bufSpec.length - 1, Math.ceil(hi / binHz));
                for (let b = b0; b <= b1; b++) if (bufSpec[b] > db) db = bufSpec[b];
            }
            if (!ligado && !(vu.L.db > PISO_DB || vu.R.db > PISO_DB)) db = ESPECTRO_MIN;
            const frac = Math.max(0, Math.min(1, (db - ESPECTRO_MIN) / (ESPECTRO_MAX - ESPECTRO_MIN)));
            const x = Math.round(i * larg) + 2, bw = Math.max(2, Math.floor(larg) - 4);
            const y = topo + alt * (1 - frac);
            const grad = c.createLinearGradient(0, topo + alt, 0, topo);
            grad.addColorStop(0, '#22c55e'); grad.addColorStop(.7, '#eab308'); grad.addColorStop(1, '#ef4444');
            c.fillStyle = grad;
            c.fillRect(x, y, bw, topo + alt - y);
            // Pico retido da banda
            const p = picosEspectro[i];
            if (db >= p.db || !p.t) { p.db = db; p.t = ts || 0; }
            else if ((ts || 0) - p.t > 1000) { p.db = Math.max(ESPECTRO_MIN, p.db - 1.5); }
            const fp = Math.max(0, Math.min(1, (p.db - ESPECTRO_MIN) / (ESPECTRO_MAX - ESPECTRO_MIN)));
            if (fp > 0) {
                c.fillStyle = 'rgba(248,250,252,.85)';
                c.fillRect(x, Math.round(topo + alt * (1 - fp)), bw, 1);
            }
            const rot = ROTULOS[BANDAS_HZ[i]];
            if (rot) {
                c.fillStyle = '#8b93a7';
                c.font = '9px system-ui, sans-serif';
                c.textAlign = 'center';
                c.fillText(rot, x + bw / 2, h - 3);
            }
        }
    }

    // Medição EXATA do arquivo exportado (BS.1770-4 integrado + pico real).
    function medirArquivo(buffer, nome) {
        const el = $('msArquivo');
        if (!el) return;
        if (!global.Loudness) { el.textContent = 'Medidor do arquivo indisponível (loudness.js não carregou).'; return; }
        el.textContent = 'Medindo o arquivo exportado...';
        setTimeout(() => {
            try {
                const m = global.Loudness.medir(buffer);
                el.textContent = `${nome}: ${fmt(m.lufs)} LUFS integrado · pico real ${fmt(m.picoDb)} dBTP · faixa dinâmica ${fmt(m.faixaDinamica)} dB`;
                el.title = 'Medido no arquivo que saiu: BS.1770-4 com os dois portões; pico inter-amostra por Catmull-Rom 4x. Nunca o valor pedido.';
                el.classList.add('medido');
            } catch (e) {
                el.textContent = 'Não consegui medir o arquivo: ' + e.message;
            }
        }, 30);
    }

    global.MasterSuite = { instalar, ligar, desligar, medirArquivo, BANDAS_HZ };
})(window);
