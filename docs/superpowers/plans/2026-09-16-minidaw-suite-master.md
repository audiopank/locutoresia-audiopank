# Suíte de Masterização na MiniDAW clássica (16/09/2026)

**Pedido:** "Só falta uma coisa pra MiniDAW ficar perfeita, coisa de engenheiro de som": a
Mastering Suite do Samplitude (EQ com curva, Enhancer, Multimax, Limiter, Analyzer) na caixa
vazia ao lado de "Exportar Mix Final".

**Princípio (regra da casa):** prévia = arquivo. O que o produtor ouve no master é o que sai
no export. Número na tela é sempre MEDIDO, nunca o pedido. Nada de LUFS "aprox" onde dá pra
medir de verdade — a biblioteca já existe em `minidaw-react/src/lib/loudness.js` (BS.1770-4,
pico real por Catmull-Rom, aprovada de ouvido em 10/08/2026).

## Escopo v1 (três módulos, um commit por módulo)

### A. Analisador + medidores (ao vivo e no arquivo)
- Barramento master ganha cadeia: `masterGain → [EQ master] → [limiter] → analyserOut → destination`,
  com `analyserIn` antes do EQ (medidor IN/OUT como no Samplitude).
- Painel "Master" na caixa vermelha: espectro em barras (60 Hz–16 kHz, escala log, pico com
  retenção), dois VU L/R com pico retido em dBFS e indicador de clip, e loudness momentâneo
  (K-weighting num bloco de 400 ms, rotulado "LUFS-M").
- Depois de cada export: medição EXATA do arquivo (`lufsIntegrado`, `picoRealDbTodos`,
  faixa dinâmica) exibida no painel: "Arquivo: -14,1 LUFS · pico real -0,9 dBTP · DR 8".
- Porta: `static/loudness.js` = cópia de `minidaw-react/src/lib/loudness.js` com wrapper
  global (`window.Loudness`), sem ES modules. Teste em node compara com a fonte React.

### B. EQ master de 4 bandas com curva (Samplitude 1-2-3-4)
- Bandas: 1 low-shelf 100 Hz · 2 peaking 1 kHz · 3 peaking 3,5 kHz · 4 high-shelf 10 kHz.
  Ganho ±12 dB; frequência arrastável; Q das peaking pela roda do mouse sobre o ponto.
- Curva desenhada com `getFrequencyResponse` dos BiquadFilterNodes vivos (grade 100 Hz / 1 kHz /
  10 kHz, ±15 dB). Pontos numerados arrastáveis. Botões: liga/desliga (bypass) e reset.
- Mesmos parâmetros aplicados no export (OfflineAudioContext, no master) — mix final e
  "Otimizar". Stems seguem crus (o master é do MIX, não das partes).

### C. Limiter + loudness de verdade (substitui o "Otimizar" por RMS)
- Destino (mesmos alvos do React, `destinos.js`): Rádio -16 · Redes -14 · WhatsApp -12 ·
  PDV -9 LUFS; teto de pico real -1 dBTP (PDV -0,5).
- Export "Otimizar": ganho = alvo − LUFS medido do mix, limiter (DynamicsCompressor no teto
  −0,5 dB) e rede de segurança de pico real; resultado MEDIDO e mostrado.
- Prévia: EQ + limiter ao vivo (o ganho pro alvo depende do LUFS integrado do mix inteiro,
  que só existe depois de renderizar — o painel diz isso).
- Persistência: `master` (eq, limiter, destino) no rascunho local e no projeto salvo
  (coluna `master jsonb` — `MINIDAW_MASTER.sql`, backend tolerante como os marcadores).

## Fora da v1 (dizer ao produtor)
- Multimax (compressor multibanda) e Enhancer (largura estéreo): fazíveis em Web Audio, mas
  cada um é um dia de trabalho e de ouvido. Entram se ele pedir depois de usar a v1.

## Verificação
- Testes: porta do loudness.js (node, mesmos números da fonte React), marcas do motor
  (EQ/limiter no render), projeto com `master` salva com e sem a coluna, versões dos scripts.
- Ouvido dele: EQ na prévia = EQ no arquivo; "Otimizar" chega no alvo (±1 LUFS) sem passar
  do teto (pico real medido).

## Status
- A no ar em 16/09/2026 (0849c46). Visto funcionando por ele.
- B no ar em 16/09/2026 (5131a3e). Aprovado de ouvido ("som real = perfeito").
- C no ar em 17/09/2026. Decisões de implementação: makeup automático do DynamicsCompressor anulado por ganho de compensação (`MixEngine.paramsLimiterMaster`); Otimizar por LUFS com até 2 passadas e rede de segurança de pico real; Otimizar antigo preservado atrás de uma caixinha.
