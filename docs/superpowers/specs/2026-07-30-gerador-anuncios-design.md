# Gerador de Anúncios — Super Agente de produção de spot

**Data:** 30/07/2026
**Status:** design aprovado, aguardando plano de implementação

## 1. O problema

Hoje, produzir um spot a partir de um pedido exige atravessar quatro telas na mão:

1. Studio (`/`) — cola o roteiro, escolhe a voz, gera o áudio
2. `sendToMiniDAW()` serializa o áudio em **base64 no localStorage** e abre a MiniDAW
   em aba nova (`templates/index.html:1386-1425`) — teto de ~5MB, então áudio longo falha
3. MiniDAW (`/minidaw`) — sobe a trilha ou escolhe da biblioteca, ajusta volume, aplica
   efeitos, mixa, exporta
4. `/entregas-clientes` — cadastra a entrega

O passo 4 já foi resolvido: `window.enviarParaEntrega(blob, nome)`
(`static/enviar-entrega.js:103`) manda o áudio direto pro Storage por signed URL e cria a
entrega vinculada ao pedido. O que continua doendo é o pulo do passo 2 e o trabalho manual
do passo 3.

**A causa real não é falta de motor.** Cada peça da produção já existe e funciona; o que
não existe é algo que as encadeie. Falta um orquestrador, não um recurso.

## 2. Decisões tomadas

| Decisão | Escolha | Motivo |
|---|---|---|
| Onde construir | Neste repositório (Locutores IA) | O motor todo já está aqui. Não há nada a reaproveitar do VoiceFlow. |
| Modelo de negócio | **Ferramenta interna** | Preserva a decisão "produtora, não plataforma": o cliente nunca entra no app. Sem auth, sem créditos. |
| Onde mixar | **No navegador** (Web Audio) | `pydub` exige o binário `ffmpeg`, ausente na Vercel serverless; `numpy` foi removido de propósito. Mixagem server-side está fora. |
| Grau de automação | **1 clique numa aba aberta** | Consequência do item acima: o pipeline roda no navegador. Como o áudio precisa passar pelo ouvido do produtor antes de sair, produzir sem ele presente não economizaria tempo real. |
| Portão de revisão | **Só o áudio final** (full-auto até lá) | Decisão do usuário. A IA escolhe o roteiro e produz o spot inteiro; o julgamento é sobre o resultado. |
| Onde fica a tela | Rota nova `/gerador` | Feature nova ganha URL própria. Nada de deslocar `/`, `/studio` ou as MiniDAWs. |
| Motor de mix | **Extrair o completo** da MiniDAW | O usuário quer reverb, compressor e EQ aplicados automaticamente — exatamente o que a cadeia existente faz. Escrever um render enxuto duplicaria pior. |

## 3. Escopo

**Entra:**
- Tela `/gerador` com o layout de referência (briefing → resultado no player)
- Pipeline automático: roteiro por IA → voz → trilha → receita de mix → mixagem
- Roteiro editável no resultado, com "Regerar só a voz" (reaproveita trilha e receita)
- Checagem automática de qualidade (duração × plano vendido + frase legal do setor)
- Enviar pro cliente pela estrutura de entrega existente
- Escape hatch: "Abrir na MiniDAW" pra ajuste fino manual
- Extração do motor de mix pra módulo compartilhado

**Fica fora (YAGNI):**
- Saldo/contador de créditos — é ferramenta interna, não há cliente pagando por uso
- Auth / login
- Geração em lote e variações (15s/30s) — outro gargalo, outra fase
- Consertar a Biblioteca de Roteiros (ver §8) — o gerador não depende dela
- Mixagem server-side

## 4. Arquitetura

Três arquivos novos, uma extração, um endpoint novo. Nada existente é movido ou renomeado.

### 4.1 `static/mix-engine.js` (novo — extração)

Move do `static/minidaw.js` as funções que **já são DOM-free** (verificado: zero
referências a `document` nas linhas 1391-1583):

| Função | Origem | Assinatura no módulo |
|---|---|---|
| `_renderizarParaExport` | `minidaw.js:1391` | `renderizarMix({tracks, duration, sampleRate, aoProgredir})` → `AudioBuffer` |
| `aplicarDucking` | `minidaw.js:1216` | `aplicarDucking(gainParam, trechos, nivel, ateQuando, offset)` |
| `detectarTrechosDeVoz` | `minidaw.js:1149` | `detectarTrechosDeVoz(voiceTracks)` |
| `masterizarBuffer` | `minidaw.js:1350` | `masterizarBuffer(buffer, alvoDbfs)` |
| `bufferToWav` | `minidaw.js:1646` | `bufferToWav(buffer)` → `Blob` |
| `bufferToMp3` | `minidaw.js:1714` | `bufferToMp3(buffer, kbps)` → `Promise<Blob>` |

O motor tem exatamente cinco dependências de `this` (`tracks`, `duration`, `audioContext`,
`aplicarDucking`, `detectarTrechosDeVoz`). As três primeiras entram por parâmetro; as duas
últimas viajam junto no módulo. `audioContext` só era usado pra ler `sampleRate` — o
parâmetro substitui.

Os métodos da classe `MiniDAW` passam a delegar em uma linha cada. **Restrição:** o
comportamento de export da MiniDAW clássica não pode mudar — ela é a versão estável.
Atenção a `bufferToMp3`, que chama `this.bufferToWav` internamente (`minidaw.js:1750`) e
no módulo deve chamar a função local.

### 4.2 `static/gerador.js` (novo — o orquestrador)

O Super Agente. Encadeia os passos sem clique intermediário, expõe progresso e degrada com
elegância quando um passo falha (§6). Não contém lógica de áudio própria: consome o
`mix-engine.js` e os endpoints existentes.

### 4.3 `templates/gerador.html` + rota `/gerador` (novo)

Layout de referência: coluna esquerda com os controles (modo, voz, trilha, nome do áudio),
coluna direita com o texto do comercial, barra fixa embaixo com player, waveform, Download
e Enviar. Carrega `mix-engine.js`, `gerador.js` e o `enviar-entrega.js` já existente.

Diferenças conscientes em relação à imagem de referência:
- **Sem badge de créditos** — ferramenta interna
- **Seletor de pedido no topo** — o briefing vem de `/api/pedidos`, não é digitado do zero
- "Revisar texto" vira automático (roda no fim do pipeline, não como botão manual)

**Quem escolhe a voz:** o pipeline é full-auto, mas a voz **não** é escolhida pela IA — o
campo `estilo_voz` do pedido é texto livre e não mapeia pra um ID de voz de forma
confiável. O dropdown de voz vem pré-selecionado com uma voz padrão e o produtor pode
trocar **antes** de clicar em "Gerar anúncio". O pipeline usa o que está selecionado na
tela. O mesmo vale pro modo Padrão/Expressivo.

**Modo Padrão vs Expressivo** — mapeamento explícito:
- **Expressivo** → ElevenLabs (interpretação melhor, custo por caractere real)
- **Padrão** → Google TTS

Padrão **não** usa `edge-tts`: ele responde 403 quando roda na Vercel. Serve em dev local,
não em produção. Cuidado também com voz fora dos mapas de provider — ela acaba roteada pro
LMNT sem aviso.

### 4.4 `POST /api/gerador/roteiro` (novo — o único buraco real)

Não existe nada que gere roteiro publicitário. `/roteiros` é CRUD de texto escrito à mão, e
`/api/voice-agent` é feito pra notícia (resumo viral + hashtags).

**Entrada:** `{briefing, tipo, plano, estilo_voz, duracao_alvo}`
**Saída:** `{success, roteiro, tempo_leitura_estimado, fonte}`

`duracao_alvo` (em segundos) é **derivada do `plano` do pedido**, lida de
`DURACAO_POR_PLANO` (`backend/app.py:2682`) — a mesma tabela que `/api/qualidade/checar`
usa. Faixas atuais: `teaser_5s` (3-8s), `spot_30_45` (30-45s), `spot_60_90` (60-90s).

Atenção: **`jingle` e `outro` não têm grade fixa.** Nesses casos o roteiro sai sem alvo de
duração e a checagem só informa a duração medida. O gerador não deve inventar um alvo.

Não confundir com `get_planos_config()`, que o `/admin` edita: aquela config governa
**preço, label e link de checkout**, não duração.

Segue o padrão já estabelecido em `/api/voxcraft/mix-recipe`:
- Gemini 2.5 Flash via `from google import genai` (SDK novo — **nunca** `google.generativeai`)
- Prompt pede JSON puro, sem markdown
- **Fallback determinístico obrigatório:** sem `GEMINI_API_KEY` ou com erro/cota 429,
  devolve `fonte: "base"` com o briefing limpo como roteiro, em vez de falhar
- Tempo de leitura estimado por contagem de palavras (~2,5 palavras/segundo em locução
  comercial), pra o roteiro já sair no tamanho do plano vendido

## 5. Fluxo de dados

```
[1] Produtor abre /gerador e escolhe um pedido
    GET /api/pedidos → cliente_nome, tipo, plano, valor, roteiro,
                       estilo_voz, referencia_trilha, prazo
    ↓ (briefing preenche a tela)

[2] Clica "Gerar anúncio" — daqui em diante, sem intervenção

[3] POST /api/gerador/roteiro          {briefing, tipo, plano, estilo_voz}
    ← roteiro + tempo de leitura estimado

[4] POST /api/generate-audio           {text, voice, provider}
    ← áudio da locução
    voice e modo vêm do que está SELECIONADO NA TELA (§4.3), não da IA

[5] POST /api/voxcraft/recommend-tracks {roteiro, contexto}
    ← trilha do acervo real (music_tracks)
    GET file_url da trilha → decodifica no navegador

[6] POST /api/voxcraft/mix-recipe      {tracks:[voz,trilha], contexto: roteiro}
    ← {voz:{volume,pan,fade_in,fade_out,effects{...}}, trilha:{...}, resumo, fonte}
      volumes clampados no backend; trilha nunca passa a voz

[7] mix-engine.renderizarMix({tracks, duration, sampleRate})
    aplica a receita, ducking automático e masterização (loudness + limiter -1dBFS)
    ← AudioBuffer → bufferToMp3 → Blob

[8] POST /api/qualidade/checar          {roteiro, plano, duracao_segundos}
    ← avisos de duração × plano vendido e frase legal por setor
    determinístico (regex + aritmética): não usa IA, não cai com cota do Gemini

[9] Player toca o resultado — PORTÃO HUMANO (o ouvido do produtor)
    Mostra: roteiro usado (editável), trilha escolhida, resumo da receita, avisos

[10] Saídas possíveis:
     • Enviar    → enviarParaEntrega(blob, nome) → Storage + entrega + link /aprovacao
     • Download  → arquivo local
     • Regerar só a voz → volta ao [4] com o texto editado, reusa trilha e receita
     • Abrir na MiniDAW → ajuste fino manual
```

Formato de faixa aceito pelo motor (espelha `minidaw.js:148-167`):

```js
{ id, name, type: 'voice'|'music', audioBuffer, duration,
  volume: 100, pan: 0, fadeIn: 0, fadeOut: 0, muted: false, solo: false,
  effects: { reverb, delay, compressor, eq, hpf, presence, limiter } }
```

## 6. Tratamento de erros

O pipeline tem sete passos em série; qualquer um pode falhar. Princípio: **degradar com o
que já se tem, nunca perder o trabalho dos passos anteriores.** O progresso é visível por
passo, com o erro nomeado no passo que falhou.

| Passo falha | Comportamento |
|---|---|
| Roteiro (IA fora / cota 429) | Usa o briefing do cliente como roteiro (`fonte: "base"`) e avisa na tela. Não interrompe. |
| Voz (TTS) | **Para aqui** — sem locução não há spot. Mensagem nomeia o provider que falhou e oferece trocar de modo/voz. |
| Trilha (nenhuma recomendada) | Segue **sem trilha**: locução seca é entregável. Avisa e oferece escolher da biblioteca na mão. |
| Receita de mix | Usa a receita-base determinística que o endpoint já devolve (`fonte: "base"`). |
| Render (Web Audio) | Erro claro + o áudio da voz continua baixável, pra não perder o TTS já gasto. |
| Encoder MP3 (lamejs ausente) | `bufferToMp3` já cai pra WAV com o nome acompanhando (`minidaw.js:1750`). |
| Checagem de qualidade | Só avisos — nunca bloqueia. |

Riscos específicos a tratar no código:
- **Cota do Gemini (429)** derruba os passos 3 e 6 e falha em ~0,4s, silenciosamente. A
  tela deve mostrar `fonte: "base"` de forma visível, senão o produtor conclui que "a IA
  ficou ruim" quando ela apenas não respondeu.
- **`/tmp` efêmero na Vercel:** `UPLOAD_FOLDER` é `/tmp/generated_audio`
  (`backend/app.py:280`), então buscar o áudio numa requisição posterior é frágil. O
  gerador trabalha com o `Blob` que o navegador já tem em mãos — mesmo princípio que o
  `enviar-entrega.js` documenta.
- **XSS em atributo:** todo texto vindo do pedido ou da IA que for interpolado em HTML
  precisa de escape que cubra aspas (`"` e `'`), não só `<`/`>`. Bug recorrente neste
  projeto; `enviar-entrega.js:20-25` tem a versão correta.

## 7. Verificação

Sem framework de teste JS no repositório, a verificação é manual e roteirizada — mas
**obrigatória antes de qualquer alegação de "pronto"**.

**Não-regressão da MiniDAW clássica** (a extração é a parte de risco):
1. Abrir `/minidaw`, montar um projeto com voz + trilha
2. Exportar **antes** da extração; guardar duração e tamanho do arquivo
3. Aplicar a extração
4. Exportar o mesmo projeto e comparar: duração idêntica, tamanho na mesma ordem
5. Conferir que "Ouvir Prévia", "Otimizar e Exportar" e os stems continuam funcionando

**Pipeline do gerador:**
1. Caminho feliz: pedido real → 1 clique → spot mixado toca no player em ~30s
2. Trilha mais baixa que a voz no resultado (regra de ouro do spot)
3. Sem `GEMINI_API_KEY`: pipeline completa com `fonte: "base"` em vez de quebrar
4. Sem trilha disponível: entrega locução seca com aviso
5. "Regerar só a voz" com texto editado: troca a locução mantendo trilha e receita
6. "Enviar": entrega criada, vinculada ao pedido, link `/aprovacao/<id>` abre
7. Em produção (Vercel), não só local — `/tmp` e limites de corpo só aparecem lá

## 8. Pendências conhecidas (fora deste escopo)

- **Biblioteca de Roteiros quebrada em produção:** `save_scripts` (`backend/app.py:8621`)
  grava em `scripts_library.json` na raiz e a Vercel é read-only — salvar roteiro retorna
  500 em produção. Ler funciona (o arquivo está commitado). O gerador **não depende disso**;
  o roteiro usado viaja no `request_description` da entrega. Consertar exige mover a
  persistência pro Supabase, o que é trabalho próprio.
- **`sendToMiniDAW()` via base64 no localStorage** continua existindo no Studio. O gerador
  não usa esse caminho, mas ele segue frágil pra quem usar o Studio direto.

## 9. Fases futuras

- Variações em lote (15s/30s, 2-3 vozes pro cliente escolher)
- Mixagem server-side, se o volume de pedidos justificar sair da Vercel
- Autoatendimento por créditos, se a demanda provar que existe comprador self-service
