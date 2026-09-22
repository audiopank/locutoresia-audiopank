# Suíte Master v2 na MiniDAW clássica (22/09/2026)

**Pedido:** ele mostrou a Mastering Suite do Samplitude Music Studio (MultiMax de 3 bandas com
presets, De-esser fraco/forte, Stereoprozessor) e disse: "os de-essers funcionam de verdade; a
master final passa por essa suíte e o som fica profissional, muito mais som". Pediu o que é ouro
pra nossa MiniDAW e mandou começar pelo de-esser.

**Contexto:** a v1 (16-17/09) entregou analisador + VU + LUFS, EQ master 4 bandas e limiter com
destinos. MultiMax e de-esser ficaram FORA na v1 por decisão dele; reabertos agora porque ele
OUVIU a diferença. Regras da casa que continuam valendo: prévia = arquivo (todo nó novo entra no
playback E no mix-engine com o MESMO construtor); número na tela é medido; nada quebra o que
está aprovado (Suíte v1, Time Stretch, régua por faixa, mute no export).

## Escopo v2 (três módulos, um commit por módulo, validação de OUVIDO dele entre cada um)

### D1. De-esser na faixa de VOZ  ← começa aqui
- **Onde:** efeito por faixa, só em `voice`, botão "De-esser" ao lado de Gate/HPF/Presença, com
  painel (igual ao do Gate) e um slider **Força 1–10** (padrão 5). Fraco/forte do Samplitude
  viram pontos desse slider.
- **Posição na cadeia:** HPF → EQ(4) → Presença → **De-esser** → Compressor → Limiter → Gate →
  volume. Antes do compressor de propósito: o compressor não deve bombear no "sss".
- **Construção (Web Audio, `MixEngine.criarDeesser(ctx)`), igual ao preset "Deesser" do
  MultiMax:** split-band num crossover Linkwitz-Riley de 4ª ordem em 5 kHz (dois biquads
  Butterworth em cascata por banda, Q = 1/√2, as bandas somam plano); a banda ALTA passa por um
  DynamicsCompressorNode (ataque 1 ms, soltura 50 ms, joelho 0) com makeup automático anulado
  (`compDb = 0.6·threshold·(1−1/ratio)`, mesmo truque do `paramsLimiterMaster`); a banda BAIXA
  segue intacta; soma. **Desligado = caminho seco** (dry 1 / wet 0): bit-idêntico ao som de
  antes, nenhum projeto aprovado muda.
- **Parâmetros (`MixEngine.paramsDeesser(forca)`):** threshold = −18 − 2,4·força (−20,4 … −42 dB),
  ratio = 2 + 0,8·força (2,8 … 10). Puro, testável em node.
- **Persistência:** `track.effects.deesser` + `track.deesserSettings.forca` no rascunho local, no
  projeto salvo (Supabase) e no "Copiar Efeitos". Projeto antigo sem o campo = desligado.
- **Export:** mix-engine monta o mesmo nó entre Presença e Compressor com os mesmos parâmetros.
- **Testes:** node (`tests/deesser.test.mjs`: parâmetros monotônicos, bypass, fiação do grafo com
  um AudioContext falso) + pytest (`tests/test_deesser.py`: botão só em voz, painel, cadeia
  igual nos dois arquivos, save/load/copiar, versões).
- **Validação:** ele, de ouvido, numa voz do Gemini com "sss" marcado, comparando força 3 / 5 / 8.
  Critério de sucesso dele: "o sss abaixa e a voz não fica com língua presa".

### D2. MultiMax no master (3 bandas + presets)
- Módulo D da `master-suite.js` entre o EQ master e o limiter (`masterIn → EQ → MultiMax →
  limiter → masterOut`); `masterMultiband` no `renderizarMix`; salvo no `master` jsonb.
- Cortes em 100 Hz e 5 kHz (LR4, mesmo crossover do D1, generalizado pra 3 bandas), um
  DynamicsCompressor + ganho por banda, makeup anulado, medidor de redução por banda (GR).
- **Presets** (o ouro de UX): Loudness fraco / médio / forte, Rádio, Mais presença, Voz
  sibilante, Reset. Cada preset = threshold/ratio/ganho por banda.
- Limitação dita a ele: o DynamicsCompressorNode tem joelho e soltura de programa — dá o "cola e
  enche", não o knob fino do Samplitude.

### D3. Estéreo (barato)
- Botão **Mono** (checagem rádio AM / celular) e slider de **largura** M/S só pra faixas de
  trilha (M = (L+R)/2, S = (L−R)/2 × largura) via ChannelSplitter/Merger — no play e no export.

### Fora (de propósito)
Vocoder, Cassetten NR-B, Karaokê, segundo compressor de master (o MultiMax já é ele).

## Status
- D1: ✅ no ar e aprovado de ouvido no Charon (22/09/2026; v1.1 com faixa do corte e redução ao vivo).
- D2: ✅ no ar e aprovado de ouvido (22/09/2026, "ficou show").
- D3: implementado 22/09/2026 (engine v14, master-suite v6, minidaw v67), aguardando ouvido dele.
