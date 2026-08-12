// Gate de respiração: fecha a faixa nos trechos SEM fala e devolve o volume
// quando ela volta. Voz gerada por IA respira alto entre frases — um chiado
// de ar que some no fone mas aparece feio no rádio/PDV, ainda mais depois do
// limiter puxar tudo pra cima. Porta o algoritmo já calibrado e aprovado da
// MiniDAW clássica (static/mix-engine.js), reescrito como matemática pura
// sobre buffer — sem AudioParam/AudioContext — pra dar pra testar por
// `node --test`, no mesmo padrão de loudness.js.

const JANELA = 0.03;   // 30ms por bloco de análise RMS
const HOLD = 0.25;     // funde trechos de fala separados por pausas curtas

export const GATE_PADRAO = {
    sensibilidade: 12,  // 1-30, mesmo range/default da clássica
    piso: 0.06,          // -24dB nas pausas — nunca muda total (soaria "com buracos")
    attack: 0.02,        // abre 20ms ANTES da palavra
    release: 0.12,       // fecha suave, sem cortar a cauda da fala
};

// Acha os trechos [inicio, fim] (em segundos) com fala num canal mono.
// `sensibilidade` 1-30: quanto maior, mais alto o limiar em relação ao pico
// — logo mais generoso em classificar trechos baixinhos (respiração) como
// pausa, e não como fala.
export function detectarTrechos(dadosCanal, sr, sensibilidade) {
    const passo = Math.max(1, Math.floor(JANELA * sr));
    const sens = sensibilidade != null ? sensibilidade : GATE_PADRAO.sensibilidade;
    const pct = Math.min(0.30, Math.max(0.01, sens / 100));

    const rms = [];
    let pico = 0;
    for (let i = 0; i < dadosCanal.length; i += passo) {
        let soma = 0;
        const fim = Math.min(i + passo, dadosCanal.length);
        for (let j = i; j < fim; j++) soma += dadosCanal[j] * dadosCanal[j];
        const v = Math.sqrt(soma / Math.max(1, fim - i));
        rms.push(v);
        if (v > pico) pico = v;
    }
    // Piso absoluto: buffer só com ruído de fundo não vira um "gate" sem sentido.
    if (pico < 0.003) return [];

    const limiar = pico * pct;
    const segmentos = [];
    let inicio = null;
    for (let k = 0; k < rms.length; k++) {
        const temFala = rms[k] >= limiar;
        if (temFala && inicio === null) inicio = k * JANELA;
        if (!temFala && inicio !== null) {
            segmentos.push([inicio, k * JANELA]);
            inicio = null;
        }
    }
    if (inicio !== null) segmentos.push([inicio, rms.length * JANELA]);
    if (!segmentos.length) return [];

    const unidos = [segmentos[0].slice()];
    for (let i = 1; i < segmentos.length; i++) {
        const ult = unidos[unidos.length - 1];
        if (segmentos[i][0] - ult[1] <= HOLD) {
            ult[1] = Math.max(ult[1], segmentos[i][1]);
        } else {
            unidos.push(segmentos[i].slice());
        }
    }
    return unidos;
}

// Aplica o envelope de ganho direto no canal (in-place). `trechos` vem de
// detectarTrechos. Como HOLD (0.25s) é sempre maior que attack+release
// (0.14s por padrão), trechos não fundidos nunca se sobrepõem ao abrir a
// rampa de attack/release — cada abertura/fechamento fica isolado no tempo.
export function aplicarGate(canal, sr, trechos, opcoes) {
    if (!trechos || !trechos.length) return;
    const o = opcoes || {};
    const piso = o.piso != null ? o.piso : GATE_PADRAO.piso;
    const attack = o.attack != null ? o.attack : GATE_PADRAO.attack;
    const release = o.release != null ? o.release : GATE_PADRAO.release;
    const duracao = canal.length / sr;

    const pontos = [[0, piso]];
    for (const [ini, fim] of trechos) {
        const abre = Math.max(0, ini - attack);
        const fecha = Math.min(duracao, fim + release);
        pontos.push([abre, piso], [ini, 1], [fim, 1], [fecha, piso]);
    }
    pontos.push([duracao, piso]);

    let idx = 0;
    for (let i = 0; i < canal.length; i++) {
        const t = i / sr;
        while (idx < pontos.length - 2 && pontos[idx + 1][0] <= t) idx++;
        const [t0, g0] = pontos[idx];
        const [t1, g1] = pontos[idx + 1];
        const ganho = t1 > t0 ? g0 + (g1 - g0) * ((t - t0) / (t1 - t0)) : g1;
        canal[i] *= ganho;
    }
}
