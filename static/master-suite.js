/**
 * Suíte Master da MiniDAW clássica (16/09/2026).
 *
 *  Módulo A — analisador de espectro + medidores do barramento de saída.
 *    SÓ ESCUTA: AnalyserNodes pendurados em `minidaw.masterOut`.
 *  Módulo B — EQ master de 4 bandas com curva arrastável (Samplitude 1-2-3-4).
 *    Entra ENTRE masterIn e masterOut na prévia; o export recebe os mesmos
 *    4 biquads (mix-engine.js, `o.masterEq`) — prévia = arquivo. Stems
 *    isolados ficam crus (o master é do MIX, não das partes).
 *
 * Números, com honestidade:
 *  - VU L/R: pico por amostra em dBFS (retenção de 1,5 s) + CLIP (≥ -0,1 dBFS).
 *  - LUFS-M: loudness MOMENTÂNEO, K-weighting (BS.1770) num bloco de ~370 ms.
 *    O integrado com os dois portões e o pico REAL (inter-amostra) só existem
 *    no ARQUIVO exportado: medirArquivo() usa static/loudness.js.
 *  - Curva do EQ: getFrequencyResponse dos próprios BiquadFilterNodes vivos —
 *    o desenho é a resposta real dos nós, não uma fórmula à parte.
 */
(function (global) {
    'use strict';

    // ── comum ─────────────────────────────────────────────────────────────
    const $ = id => document.getElementById(id);
    let daw = null, ctx = null;
    function fmt(db) { return Number.isFinite(db) ? db.toFixed(1).replace('.', ',') : '−∞'; }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

    // ── A: analisador + medidores ─────────────────────────────────────────
    const BANDAS_HZ = [60, 80, 100, 130, 170, 230, 310, 420, 600, 800, 1000, 1400, 2000, 2800, 4000, 5500, 7500, 10000, 13000, 16000];
    const ROTULOS = { 60: '60', 170: '170', 310: '310', 600: '600', 1000: '1K', 3000: '3K', 6000: '6K', 13000: '13K', 16000: '16K' };
    const PISO_DB = -60;
    const ESPECTRO_MIN = -84, ESPECTRO_MAX = -6;
    const HOLD_MS = 1500;
    const QUEDA_DB = 0.6;

    let anL = null, anR = null, anSpec = null;
    let bufL = null, bufR = null, bufSpec = null;
    let raf = null, ligado = false, ultimoLufsMs = 0, lufsM = -Infinity, clip = false;
    const vu = { L: { db: -Infinity, hold: -Infinity, t: 0 }, R: { db: -Infinity, hold: -Infinity, t: 0 } };
    let picosEspectro = [];

    function dbDe(x) { return x > 0 ? 20 * Math.log10(x) : -Infinity; }
    function pct(db) { return clamp((db - PISO_DB) / (0 - PISO_DB) * 100, 0, 100); }

    function instalar(minidaw) {
        daw = minidaw;
        ctx = daw.audioContext;
        if (!daw.masterOut || !$('masterSuite')) return false;
        const splitter = ctx.createChannelSplitter(2);
        daw.masterOut.connect(splitter);
        anL = ctx.createAnalyser(); anR = ctx.createAnalyser();
        anL.fftSize = anR.fftSize = 16384;
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
        instalarEq();
        window.addEventListener('resize', () => { desenhar(0); desenharEq(); });
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
    function desligar() { ligado = false; }

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
        c.strokeStyle = 'rgba(148,163,184,.12)';
        c.lineWidth = 1;
        for (let g = ESPECTRO_MAX - 12; g > ESPECTRO_MIN; g -= 12) {
            const y = topo + alt * (1 - (g - ESPECTRO_MIN) / (ESPECTRO_MAX - ESPECTRO_MIN));
            c.beginPath(); c.moveTo(0, Math.round(y) + .5); c.lineTo(w, Math.round(y) + .5); c.stroke();
        }
        const ativo = ligado || vu.L.db > PISO_DB || vu.R.db > PISO_DB;
        for (let i = 0; i < n; i++) {
            const lo = i === 0 ? BANDAS_HZ[0] / 1.2 : Math.sqrt(BANDAS_HZ[i - 1] * BANDAS_HZ[i]);
            const hi = i === n - 1 ? BANDAS_HZ[i] * 1.2 : Math.sqrt(BANDAS_HZ[i] * BANDAS_HZ[i + 1]);
            let db = ESPECTRO_MIN;
            if (bufSpec && anSpec && ativo) {
                const b0 = Math.max(0, Math.floor(lo / binHz)), b1 = Math.min(bufSpec.length - 1, Math.ceil(hi / binHz));
                for (let b = b0; b <= b1; b++) if (bufSpec[b] > db) db = bufSpec[b];
            }
            const frac = clamp((db - ESPECTRO_MIN) / (ESPECTRO_MAX - ESPECTRO_MIN), 0, 1);
            const x = Math.round(i * larg) + 2, bw = Math.max(2, Math.floor(larg) - 4);
            const y = topo + alt * (1 - frac);
            const grad = c.createLinearGradient(0, topo + alt, 0, topo);
            grad.addColorStop(0, '#22c55e'); grad.addColorStop(.7, '#eab308'); grad.addColorStop(1, '#ef4444');
            c.fillStyle = grad;
            c.fillRect(x, y, bw, topo + alt - y);
            const p = picosEspectro[i];
            if (db >= p.db || !p.t) { p.db = db; p.t = ts || 0; }
            else if ((ts || 0) - p.t > 1000) { p.db = Math.max(ESPECTRO_MIN, p.db - 1.5); }
            const fp = clamp((p.db - ESPECTRO_MIN) / (ESPECTRO_MAX - ESPECTRO_MIN), 0, 1);
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

    // ── B: EQ MASTER de 4 bandas ──────────────────────────────────────────
    // min/max são limites de arrasto por banda (não vão pro projeto).
    const EQ_PADRAO = () => ([
        { tipo: 'lowshelf',  freq: 100,   ganho: 0, q: 0.7, min: 40,   max: 400   },
        { tipo: 'peaking',   freq: 1000,  ganho: 0, q: 1.0, min: 120,  max: 8000  },
        { tipo: 'peaking',   freq: 3500,  ganho: 0, q: 1.0, min: 300,  max: 12000 },
        { tipo: 'highshelf', freq: 10000, ganho: 0, q: 0.7, min: 2500, max: 16000 },
    ]);
    const G_LIM = 12, G_EIXO = 15, F_MIN = 20, F_MAX = 20000, Q_MIN = 0.3, Q_MAX = 8;
    const eq = { bypass: false, bandas: EQ_PADRAO(), nos: [], arrasto: null };

    function xDe(freq, w) { return Math.log10(freq / F_MIN) / Math.log10(F_MAX / F_MIN) * w; }
    function freqDe(x, w) { return F_MIN * Math.pow(10, (x / w) * Math.log10(F_MAX / F_MIN)); }
    function yDe(g, h) { return h / 2 - (g / G_EIXO) * (h / 2); }
    function gDe(y, h) { return (h / 2 - y) / (h / 2) * G_EIXO; }
    function fmtHz(f) { return f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 0 : 1).replace('.', ',') + ' kHz' : Math.round(f) + ' Hz'; }
    function fmtDb(g) { return (g > 0 ? '+' : '') + g.toFixed(1).replace('.', ','); }

    function instalarEq() {
        if (!daw.masterIn || !daw.masterOut) return;
        // O construtor liga masterIn → masterOut direto (funciona sem a suíte);
        // aqui a cadeia de 4 biquads entra no lugar. Ganho 0 dB = transparente.
        try { daw.masterIn.disconnect(daw.masterOut); } catch (e) { /* já solto */ }
        let no = daw.masterIn;
        eq.nos = eq.bandas.map(b => {
            const f = ctx.createBiquadFilter();
            f.type = b.tipo; f.frequency.value = b.freq; f.Q.value = b.q; f.gain.value = 0;
            no.connect(f);
            no = f;
            return f;
        });
        no.connect(daw.masterOut);
        const canvas = $('msEqCanvas');
        if (canvas) {
            canvas.addEventListener('mousedown', mousedownEq);
            canvas.addEventListener('wheel', wheelEq, { passive: false });
            canvas.addEventListener('dblclick', dblclickEq);
        }
        const bt = $('msEqBypass');
        if (bt) bt.onclick = () => { eq.bypass = !eq.bypass; aplicarEq(); salvarEq(); };
        const br = $('msEqReset');
        if (br) br.onclick = () => { eq.bandas = EQ_PADRAO(); eq.bypass = false; aplicarEq(true); salvarEq(); };
        if (daw._masterPendente) { carregar(daw._masterPendente); daw._masterPendente = null; }
        aplicarEq(true);
    }

    // Leva os parâmetros pros nós vivos. Rampa curta (20 ms) evita "zíper"
    // enquanto arrasta; `imediato` = carregar/reset.
    function aplicarEq(imediato) {
        const t = ctx ? ctx.currentTime : 0;
        eq.bandas.forEach((b, i) => {
            const f = eq.nos[i];
            if (!f) return;
            const g = eq.bypass ? 0 : b.ganho;
            if (f.type !== b.tipo) f.type = b.tipo;
            if (imediato) { f.frequency.value = b.freq; f.Q.value = b.q; f.gain.value = g; }
            else {
                f.frequency.setTargetAtTime(b.freq, t, 0.02);
                f.Q.setTargetAtTime(b.q, t, 0.02);
                f.gain.setTargetAtTime(g, t, 0.02);
            }
        });
        const bt = $('msEqBypass');
        if (bt) bt.classList.toggle('active', !eq.bypass);
        desenharEq();
        desenharBandas();
    }

    function desenharBandas() {
        const el = $('msEqBandas');
        if (!el) return;
        el.innerHTML = '';
        eq.bandas.forEach((b, i) => {
            const d = document.createElement('div');
            const ativoTxt = eq.bypass ? ' (bypass)' : '';
            d.textContent = `${i + 1} · ${fmtHz(b.freq)} · ${fmtDb(b.ganho)} dB` + (b.tipo === 'peaking' ? ` · Q ${b.q.toFixed(1).replace('.', ',')}` : '') + ativoTxt;
            if (Math.abs(b.ganho) > 0.05 && !eq.bypass) d.classList.add('ativa');
            el.appendChild(d);
        });
    }

    function desenharEq() {
        const canvas = $('msEqCanvas');
        if (!canvas || !ctx) return;
        const w = Math.floor(canvas.offsetWidth), h = Math.floor(canvas.offsetHeight);
        if (!w || !h) return;
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        const c = canvas.getContext('2d');
        c.clearRect(0, 0, w, h);
        // Grade: 100 Hz / 1 kHz / 10 kHz e 0 / ±5 / ±10 dB
        c.lineWidth = 1;
        for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
            const x = Math.round(xDe(f, w)) + .5;
            c.strokeStyle = [100, 1000, 10000].includes(f) ? 'rgba(148,163,184,.28)' : 'rgba(148,163,184,.10)';
            c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke();
        }
        for (const g of [-10, -5, 0, 5, 10]) {
            const y = Math.round(yDe(g, h)) + .5;
            c.strokeStyle = g === 0 ? 'rgba(148,163,184,.4)' : 'rgba(148,163,184,.12)';
            c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
        }
        c.fillStyle = '#8b93a7';
        c.font = '9px system-ui, sans-serif';
        c.textAlign = 'left';
        c.fillText('100 Hz', xDe(100, w) + 3, 10);
        c.fillText('1 kHz', xDe(1000, w) + 3, 10);
        c.fillText('10 kHz', xDe(10000, w) + 3, 10);
        c.textAlign = 'right';
        c.fillText('+10', w - 3, yDe(10, h) - 2);
        c.fillText('-10', w - 3, yDe(-10, h) - 2);
        // Curva: resposta REAL dos nós vivos, multiplicada banda a banda.
        const N = 160;
        const freqs = new Float32Array(N), mag = new Float32Array(N), fase = new Float32Array(N), total = new Float32Array(N).fill(1);
        for (let i = 0; i < N; i++) freqs[i] = freqDe(i / (N - 1) * w, w);
        for (const f of eq.nos) { f.getFrequencyResponse(freqs, mag, fase); for (let i = 0; i < N; i++) total[i] *= mag[i]; }
        const cor = eq.bypass ? 'rgba(148,163,184,.7)' : '#60a5fa';
        c.beginPath();
        for (let i = 0; i < N; i++) {
            const y = yDe(clamp(20 * Math.log10(total[i] || 1e-6), -G_EIXO, G_EIXO), h);
            if (i === 0) c.moveTo(0, y); else c.lineTo(i / (N - 1) * w, y);
        }
        c.strokeStyle = cor; c.lineWidth = 2; c.stroke();
        // Área entre a curva e 0 dB (o "azul" do Samplitude)
        c.lineTo(w, yDe(0, h)); c.lineTo(0, yDe(0, h)); c.closePath();
        c.fillStyle = eq.bypass ? 'rgba(148,163,184,.10)' : 'rgba(59,130,246,.22)';
        c.fill();
        // Pontos 1-4
        eq.bandas.forEach((b, i) => {
            const x = xDe(b.freq, w), y = yDe(b.ganho, h);
            c.beginPath(); c.arc(x, y, 9, 0, Math.PI * 2);
            c.fillStyle = eq.bypass ? '#475569' : (eq.arrasto === i ? '#93c5fd' : '#3b82f6');
            c.fill();
            c.strokeStyle = '#e2e8f0'; c.lineWidth = 1.5; c.stroke();
            c.fillStyle = '#f8fafc'; c.font = 'bold 10px system-ui, sans-serif'; c.textAlign = 'center';
            c.fillText(String(i + 1), x, y + 3.5);
        });
    }

    function pontoEm(ev) {
        const canvas = $('msEqCanvas');
        const r = canvas.getBoundingClientRect();
        const x = ev.clientX - r.left, y = ev.clientY - r.top;
        let melhor = -1, d = 14;
        eq.bandas.forEach((b, i) => {
            const dd = Math.hypot(xDe(b.freq, r.width) - x, yDe(b.ganho, r.height) - y);
            if (dd < d) { d = dd; melhor = i; }
        });
        return melhor;
    }
    function mousedownEq(ev) {
        const i = pontoEm(ev);
        if (i < 0) return;
        ev.preventDefault();
        eq.arrasto = i;
        const canvas = $('msEqCanvas');
        const mover = (e) => {
            const r = canvas.getBoundingClientRect();
            const b = eq.bandas[i];
            b.freq = Math.round(clamp(freqDe(e.clientX - r.left, r.width), b.min, b.max));
            b.ganho = Math.round(clamp(gDe(e.clientY - r.top, r.height), -G_LIM, G_LIM) * 10) / 10;
            aplicarEq();
        };
        const soltar = () => {
            document.removeEventListener('mousemove', mover);
            document.removeEventListener('mouseup', soltar);
            eq.arrasto = null;
            desenharEq();
            salvarEq();
        };
        document.addEventListener('mousemove', mover);
        document.addEventListener('mouseup', soltar);
    }
    function wheelEq(ev) {
        const i = pontoEm(ev);
        if (i < 0) return;
        const b = eq.bandas[i];
        if (b.tipo !== 'peaking') return;          // shelf não tem Q útil aqui
        ev.preventDefault();
        b.q = Math.round(clamp(b.q * (ev.deltaY < 0 ? 1.12 : 1 / 1.12), Q_MIN, Q_MAX) * 100) / 100;
        aplicarEq();
        salvarEq();
    }
    function dblclickEq(ev) {
        const i = pontoEm(ev);
        if (i < 0) return;
        ev.preventDefault();
        const padrao = EQ_PADRAO()[i];
        eq.bandas[i] = Object.assign({}, padrao);
        aplicarEq(true);
        salvarEq();
    }

    // ── persistência (rascunho local + projeto) ───────────────────────────
    function estadoParaSalvar() {
        return { eq: { bypass: !!eq.bypass, bandas: eq.bandas.map(b => ({ tipo: b.tipo, freq: b.freq, ganho: b.ganho, q: b.q })) } };
    }
    function carregar(master) {
        const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
        const salvo = (master && master.eq) ? master.eq : null;
        eq.bypass = !!(salvo && salvo.bypass);
        eq.bandas = EQ_PADRAO().map((d, i) => {
            const s = salvo && Array.isArray(salvo.bandas) ? salvo.bandas[i] : null;
            if (!s) return d;
            return Object.assign({}, d, {
                freq: Math.round(clamp(num(s.freq, d.freq), d.min, d.max)),
                ganho: clamp(num(s.ganho, 0), -G_LIM, G_LIM),
                q: clamp(num(s.q, d.q), Q_MIN, Q_MAX),
            });
        });
        if (eq.nos.length) aplicarEq(true);
    }
    function salvarEq() { if (daw && typeof daw.saveToLocalStorage === 'function') daw.saveToLocalStorage(); }
    // Pro motor de export: null = nada a fazer (bypass ou tudo em 0 dB).
    function eqParaRender() {
        if (eq.bypass || eq.bandas.every(b => Math.abs(b.ganho) < 0.05)) return null;
        return eq.bandas.map(b => ({ tipo: b.tipo, freq: b.freq, ganho: b.ganho, q: b.q }));
    }

    global.MasterSuite = { instalar, ligar, desligar, medirArquivo, BANDAS_HZ, estadoParaSalvar, carregar, eqParaRender };
})(window);
