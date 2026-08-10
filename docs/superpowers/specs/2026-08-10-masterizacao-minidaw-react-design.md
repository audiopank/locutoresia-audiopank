# Masterização no Audio Pank Studio (MiniDAW React) — design

**Data:** 2026-08-10
**Status:** aprovado pelo usuário (brainstorming completo)

## Problema

O produtor faz jingles, e a MiniDAW clássica não atende esse trabalho: ela foi
construída para spot (voz + trilha). Ele apontou quatro faltas — masterização,
medição, montagem musical e controle fino de EQ/compressão — e hoje resolve a
masterização **fora do app**, no Moises (visto em tela masterizando o
"JINGLE MAURO FILHO 01-4455-Pankilhas").

Faltas identificadas no código antes do design:

- `minidaw-react/src/components/LUFSMeter.tsx` **existe, não é usado por
  ninguém** e o número que ele exibiria é fabricado: média das barras do
  `getByteFrequencyData` mapeada linearmente para −24..0 e rotulada "LUFS".
  Não é LUFS, não é RMS, e o componente desenha uma vez e congela (não há loop
  de atualização). Confirma a memória do projeto: *"LUFS real não existe no
  projeto (não prometer)"*.
- `minidaw-react/src/lib/mixer.ts` tem 193 linhas; o "master" é um único
  `DynamicsCompressor` em −1 dB.

## Fatiamento acordado

As quatro faltas são subsistemas independentes. Só a primeira entra nesta spec:

- **A — Masterização + Medição** (esta spec). São inseparáveis: não existe
  mirar um alvo sem medir de verdade. É o último elo da cadeia e o único que
  **funciona sozinho**, servindo inclusive o acervo já produzido.
- **B — Montagem musical** (pistas, loops, grade de compasso/BPM). Gaveta.
- **C — EQ paramétrico + compressão visível** por faixa. Gaveta. (Espelha a
  Fase 3 da clássica, também engavetada.)

B e C alimentam A; por isso A vem primeiro.

## Decisões do usuário

| Pergunta | Resposta |
|---|---|
| Escopo do som | Volume certo **+ tom + imitar uma faixa de referência** |
| Onde vive | **Aba própria**, aceita qualquer arquivo (não só mix da React) |
| Destinos reais | Rádio FM/AM, Redes sociais, WhatsApp/cliente, PDV/carro de som |
| Arquitetura | **Tudo no navegador** |
| Match de referência | **Bandas largas** (4 fixas), com slider de intensidade |
| Camada de IA | Sim, **mas depois** — v1 sem IA |

## Por que tudo no navegador

O caminho servidor (Python + `ffmpeg loudnorm`) seria tecnicamente mais direto,
mas bate de frente com as restrições já conhecidas desta hospedagem: Vercel tem
filesystem read-only, teto de ~4,5 MB por upload e timeout curto de função — um
jingle WAV de 3 min tem ~30 MB. Exigiria upload assinado para o Storage mais um
worker externo. Além disso `numpy` foi removido do projeto por
incompatibilidade com Python 3.12, então a base de cálculo nem está disponível.

No navegador não há custo, não há limite de tamanho, não há timeout, e a React
**já faz mixagem client-side** — é continuar o que existe. `lamejs` já está nas
dependências, então o export MP3 está resolvido.

## Arquitetura

### `src/lib/loudness.ts` — medição (funções PURAS)

Sem DOM e sem Web Audio, para rodar em `node --test`, seguindo o padrão que já
provou dar certo com `static/clip-model.js`.

- `filtroK(canal, sr)` — os dois estágios do ITU-R BS.1770: shelf de agudos +
  passa-alta RLB. Aproxima o peso que o ouvido dá a cada frequência.
- `lufsIntegrado(canais, sr)` — blocos de 400 ms com 75% de sobreposição,
  portão absoluto em −70 LUFS e portão relativo em −10 LU. O portão é o que
  impede o silêncio entre as frases de puxar a média para baixo.
- `picoReal(canal, sr)` — sobre-amostragem 4× com interpolação. O pico que
  estoura na conversão para MP3 mora **entre** as amostras e não aparece em
  medidor comum.
- `faixaDinamica(canais, sr)` — distância entre pico e volume médio (PLR).
- `balancoTonal(canais, sr)` — energia média por banda larga, base do match de
  referência.

**Critério de verificação:** seno a −20 dBFS deve medir ≈ −20 LUFS.

### `src/lib/mastering.ts` — a cadeia

Ordem fixa, em `OfflineAudioContext`:

1. **Corte baixo** — remove sub-grave inaudível que consome headroom
2. **Acabamento de tom** — **exatamente 4 bandas** (grave, médio-grave,
   médio-agudo, agudo), mirando o alvo (preset **ou** referência),
   multiplicadas pela intensidade, com **correção limitada a ±6 dB por banda**
   para nunca destruir o material. Quatro e não mais: cada banda a mais é uma
   chance a mais de artefato e uma explicação a menos que o produtor consegue
   dar ao ouvir o resultado.
3. **Corte alto** — opcional
4. **Ganho** — calculado da medição real para alcançar o alvo
5. **Limiter** no teto

6. **Re-medição do resultado.** O número exibido na versão é o **medido depois
   de processar**, nunca o pedido. Se o alvo não foi alcançado, a interface diz
   — não finge. Este é o princípio que separa esta feature do `LUFSMeter` atual.

### `src/components/MasterizarPanel.tsx` — a tela

Aba "Masterizar" ao lado de Roteiro / Trilha / Mix.

1. Solta um arquivo → decodifica, desenha a onda e **mostra a medição do
   original** (LUFS, pico real, faixa dinâmica). Isso sozinho já responde a
   dor "não sei se está no nível certo".
2. Escolhe destino; opcionalmente sobe uma **faixa de referência**.
3. "Masterizar" gera uma **versão** que entra numa pilha, com preset, volume
   medido e play.
4. Várias versões coexistem e são comparadas contra o Original, que fica fixo
   no topo. Versão ruim se apaga.
5. Baixa uma, ou exporta todas.

A pilha comparável é a ideia central tomada do Moises, e casa com o método do
usuário: ele **escolhe de ouvido** entre candidatos, não acerta de primeira —
foi assim que o fade final da clássica virou 3,05 s.

## Alvos por destino (ponto de partida, a calibrar de ouvido)

| Destino | Alvo | Teto |
|---|---|---|
| Rádio FM/AM | −16 LUFS | −1,0 dB |
| Redes (Reels/TikTok) | −14 LUFS | −1,0 dB |
| WhatsApp / cliente | −12 LUFS | −1,0 dB |
| PDV / carro de som | −9 LUFS | −0,5 dB |
| Personalizado | livre | livre |

**Rádio é o mais baixo de propósito:** a emissora tem processador próprio, e
material espremido faz o processador dela brigar com o nosso — o som chega
pior. Contraria a intuição de "mais alto é melhor".

Estes números são chute inicial informado e devem se mover no ouvido do
produtor, como o 3,05 s se moveu.

## Fora de escopo (v1)

- **Não se chama "AI Mastering"** — não há rede neural. É medição e
  processamento honestos. A camada de IA (Gemini escolhendo os ajustes a partir
  de um briefing, reusando o endpoint da Receita da IA) fica para a v2, e só aí
  o nome "com IA" passa a ser verdade.
- Sem multibanda complexa, sem de-esser, sem alargamento de estéreo.
- Não toca em `mixer.ts` nem no "Otimizar e Exportar" da clássica.
- **`LUFSMeter.tsx` é apagado** — código morto que exibe número falso.

## Critérios de sucesso

1. `node --test` verde na medição, incluindo o seno de −20 dBFS.
2. Masterizar o *JINGLE MAURO FILHO*, já masterizado no Moises, e empatar de
   ouvido na comparação lado a lado.
3. Arquivo de qualquer origem (React, clássica, teclado, terceiros) entra e sai
   pronto, sem servidor.
4. O número exibido é sempre o medido no resultado, nunca o pedido.
5. Validação final: o ouvido do produtor, em produção.

## Riscos e cuidados

- **Build da React é manual** (memória do projeto): `vite build` → copiar
  `dist/assets` → atualizar os hashes em `templates/minidaw-react.html` **e**
  `static/minidaw-react/index.html` → push. Esquecer um dos dois entrega página
  velha.
- Arquivo longo demora alguns segundos por versão gerada — a interface precisa
  de estado "Processando" visível (o Moises tem, e ajuda).
- Correção de tom sem limite destrói material; o teto de ±6 dB por banda não é
  negociável.
- Não prometer LUFS antes de o teste do seno passar.
