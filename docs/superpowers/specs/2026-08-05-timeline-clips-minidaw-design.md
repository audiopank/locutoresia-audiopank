# Timeline de Clips na MiniDAW Clássica — Design (Fase 1)

**Data:** 2026-08-05
**Status:** Aprovado pelo usuário (conversa de 05/08/2026)
**Onde:** MiniDAW clássica (`/minidaw` — `static/minidaw.js` + `static/mix-engine.js` + `templates/minidaw.html`)

## Por que

O usuário produz os spots reais no Samplitude Pro X porque a MiniDAW não tem o conceito
de "posição no tempo": toda faixa toca a partir de 0:00, uma faixa = um áudio. Montar um
spot de verdade (vinheta em 0:00, voz entrando em 0:08, efeito sonoro em 0:22, assinatura
no fim) exige objetos livres numa timeline. Esta é a única capacidade que hoje OBRIGA a
sair do app — as demais telas do Samplitude (mesa de canais, EQ paramétrico) já têm
versão simplificada na MiniDAW e ficam para fases futuras.

**Fatiamento acordado:** Fase 1 = timeline com clips (esta spec). Fase 2 = mesa de
mixagem completa. Fase 3 = EQ paramétrico com curva. Fases 2 e 3 NÃO fazem parte desta
entrega.

**Onde nasce (decidido):** na MiniDAW **clássica**, não na React — é nela que vivem o
Gate, o Delay, a Tesoura, o ducking, o salvar/reabrir projeto no Supabase, a ponte com o
Gerador e o export idêntico ao `mix-engine.js`. Construir na React criaria uma segunda
bancada sem o resto do fluxo.

## Caminho escolhido

**Evoluir o modelo atual** (não reescrever em canvas único, não adotar biblioteca
externa): cada faixa vira um *canal com vários clips*; cards, efeitos e motor atuais
continuam de pé; a timeline entra por cima.

## Modelo de dados

- `track.clips[]` substitui o par `audioBuffer`/`audioUrl` único. Cada clip:
  - `id`
  - `inicio` — posição na timeline do projeto (segundos)
  - `offset` — a partir de que ponto do arquivo o clip toca (trim não-destrutivo)
  - `duracao` — quanto do arquivo toca
  - `fadeIn` / `fadeOut` — **fades passam a ser POR CLIP** (hoje são por faixa)
  - referência ao buffer/arquivo de origem (clips de um mesmo corte compartilham o buffer)
- **Efeitos continuam POR FAIXA** (EQ 4 bandas, compressor, reverb, Gate, Delay, volume,
  mute/solo, pan) — a faixa é o canal; tudo que passa por ela é processado igual.
- **O tipo (Voz/Trilha) continua da FAIXA.** Clip movido para outra faixa herda o
  comportamento do canal de destino (ducking, auto fade-out).

## Tela

- **Régua de tempo** no topo do container de faixas; **todas as pistas na mesma escala**
  (px/segundo comum).
- **Zoom horizontal global** substitui o zoom por faixa atual (que perde o sentido quando
  as pistas compartilham escala).
- Clip = bloco com waveform dentro da pista: corpo arrasta, bordas têm alça de trim.
- **Imã (snap)**: bordas de outros clips, 0:00 e posição do cursor de reprodução.
  Sem grade musical/BPM (não existe esse conceito no app).
- Cards de faixa (header com nome, tipo, mute/solo, efeitos) permanecem como são.

## Gestos (os 4 da v1)

1. **Arrastar no tempo** — mover clip para esquerda/direita na pista.
2. **Mover entre faixas** — arrastar para cima/baixo; o clip entra no canal de destino.
3. **Cortar em objetos** — a Tesoura divide o clip em dois clips independentes no ponto
   do corte (em vez de só remover trecho). O modo atual de remover seleção continua
   existindo.
4. **Encurtar pelas bordas (trim)** — não-destrutivo: ajusta `offset`/`duracao`; arrastar
   a borda de volta recupera o áudio escondido.

## Motor (playback)

- Cada clip agenda seu próprio `BufferSource` com `start(base + clip.inicio,
  clip.offset, clip.duracao)`.
- Toda automação de ganho entra na **agenda central** (`agendarVolumeDaFaixa`, padrão da
  casa pós-ducking, commit `dde3393`): cancel-first, `base = ctxTime - currentTime`.
  Fades por clip são agendados dentro dela.
- **Ducking e Gate passam a enxergar as posições reais**: `detectarTrechosDeVoz`
  considera `inicio`/`offset`/`duracao` de cada clip de voz — a trilha abaixa quando a
  voz entra DE VERDADE, não a partir do zero.
- Duração do mix = **fim do último clip de voz + 1.05s** (regra atual preservada, agora
  computada sobre posições).

## Export

- `static/mix-engine.js` atualizado **na mesma entrega** (regra dos dois lugares:
  prévia e arquivo idênticos). Mesmo agendamento de clips, mesmo ducking por posição.
- O Gerador (`/gerador`) usa o mix-engine — continua funcionando: recebe voz+trilha como
  1 clip cada em 0:00 (comportamento idêntico ao atual).

## Persistência e compatibilidade

- `clips[]` entra nos **três lugares** da persistência (lição registrada): os dois
  payloads de `salvarProjetoSupabase` e a restauração ao reabrir.
- **Projeto antigo abre sem quebrar:** faixa sem `clips[]` é migrada na leitura para
  1 clip em `inicio=0` cobrindo o arquivo inteiro (fades da faixa viram fades do clip).
- Import de áudio (upload, TTS, Biblioteca) continua criando faixa nova com 1 clip em
  0:00 — de lá o usuário arrasta.

## Fora da v1 (de propósito)

- Crossfade automático entre clips que se tocam
- Multi-seleção e copiar/colar clips
- Grade musical/BPM
- Mesa de mixagem completa (Fase 2)
- EQ paramétrico com curva (Fase 3)

## Riscos e cuidados conhecidos

- `updateTrackUI` recria o card e **desliga efeitos / muda ordem** se não reaplicar
  (`applyEffectStates`) — qualquer redesenho de pista tem que respeitar isso.
- Automação de ganho fora da agenda central reintroduz os "altos e baixos" — proibido.
- Subir `MINIDAW_VERSAO` + `?v=` do template **juntos**; usuário testa em produção
  (conferir `git show origin/main:...` antes de caçar cache).
- Vercel é só o entregador dos estáticos — feature é 100% client-side, sem risco de
  timeout/filesystem.

## Critérios de sucesso

1. Montar o equivalente do spot "LMN AGOSTO DOURADO" da tela do Samplitude: vinhetas e
   locuções espalhadas em 2+ pistas, trilha contínua embaixo, tudo posicionado.
2. Prévia e MP3 exportado soam idênticos (ducking abaixando nos lugares certos).
3. Salvar, fechar, reabrir: clips voltam nas posições exatas.
4. Projeto antigo e fluxo do Gerador continuam funcionando sem mudança perceptível.
5. Validação final: o ouvido do usuário, em produção.
