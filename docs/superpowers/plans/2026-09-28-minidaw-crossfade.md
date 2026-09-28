# Crossfade dentro da faixa — MiniDAW clássica (28/09/2026)

Pedido dele (Samplitude, item 1 de 3; volume do trecho e cadeado já aprovados).

## Regra
- Dois objetos da MESMA faixa podem se sobrepor; a sobreposição vira crossfade
  automático de potência constante (sai cos, entra sen), derivado na hora — nada
  novo é salvo no projeto: a posição dos objetos já define o crossfade.
- Sobreposição válida (`ClipModel.sobreposicaoInvalida`): não começar junto
  (< 50 ms), não conter o vizinho inteiro, nunca 3 ao mesmo tempo, nunca com
  objeto travado. Inválida → comportamento antigo (encosta no vizinho).

## Onde vale
- Arrastar (`ClipModel.moverComCrossfade`), aparar a borda por cima do vizinho,
  Time Stretch (alça e exato), mover de faixa, arrasto em grupo.
- Colar segue SEM sobrepor (colar no meio de um objeto criaria crossfade surpresa).

## Som (prévia = arquivo)
- `MixEngine.crossfadesDoClip` + `agendarCrossfadeDoClip`: GainNode próprio
  (source → fades → volume → crossfade), curva em 16 segmentos lineares (funciona
  retomando o play no meio, onde setValueCurveAtTime não serve).

## Tela
- Região amarela com X por cima da sobreposição + curvas nas ondas.
- Aviso "Crossfade de 0,45 s" ao soltar.

## Testes
- tests/crossfade.test.mjs (modelo + motor), tests/test_crossfade_faixa.py (ligação).
- Versões: mix-engine v17 (minidaw, gerador, narrativa), clip-model v8, minidaw v71.
