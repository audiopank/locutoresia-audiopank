# Áudio para vídeo no Gerador — itens 1 e 2 (23/09/2026)

**Pedido:** chegar ao nível do modal "Ideia para vídeo com IA" (ideia → duração → estilo → cenas
numeradas com título, enredo, legenda e tempo), mas com SOM: "vamos, o item 1 é o modo no Gerador e o
item 2 é exatamente essa tela de cenas, com tempo de verdade".

**O que já existe e é reaproveitado:** Gerador (briefing → roteiro na grade → voz → trilha → receita →
mix → checagem → rascunho/entrega/feed) e o padrão da Narrativa de 1 TTS por bloco com espera no limite
por minuto do Gemini. Vitrine/produtora: nada disso é pro cliente usar; é bancada do produtor.

## Item 1 — Modo "Áudio para vídeo" no Gerador
- Select **Tipo de peça**: "Spot / anúncio" (padrão, nada muda) · "Áudio para vídeo (narração em cenas)".
- No modo vídeo aparecem: **Duração do vídeo** (15 / 30 / 60 / 90 s / livre) e **Estilo da narração**
  (institucional, documentário, tutorial, vlog, unboxing, promocional). A grade do plano fica de fora
  (`plano: 'outro'`); formato de voz é forçado a Locutor único na v1.
- `/api/gerador/roteiro` com `peca: 'video'`: prompt de ROTEIRISTA DE VÍDEO que devolve JSON
  `{titulo, cenas:[{titulo, narracao, ambiente}], resumo}`; número de cenas por duração (15 s: 3–4 ·
  30 s: 4–5 · 60 s: 5–7 · 90 s: 7–9 · livre: 4–8); narração total entre 75% e 100% da duração do vídeo
  (a voz não pode passar do vídeo). Sem IA: 1 cena por parágrafo do briefing (fonte 'base').
- O roteiro volta pro campo de texto em formato reparseável: `CENA n — Título` / narração /
  `[Ambiente: …]`. "Texto pronto do cliente" também é lido assim (ou 1 cena por parágrafo).

## Item 2 — Tela de cenas com tempo de verdade
- Voz: **uma gravação por cena** (mesma voz/estilo/direção), com espera automática no limite por
  minuto do Gemini (padrão da Narrativa). As cenas são emendadas com pausa de 0,35 s num buffer só,
  que segue pelo pipeline normal (trilha, receita, mix, checagem, rascunho, entrega).
- **Painel de cenas** abaixo do resultado: `Cena n · 00:00–00:07 · Título`, narração, ambiente sonoro,
  botão ▶ por cena. Tempo MEDIDO do áudio de cada cena — a diferença pro modal: o deles é chute.
- Linha de conferência: "Narração: 0:28 · vídeo de 30 s" com aviso se passar.
- Botões: **Copiar roteiro cronometrado**, **Baixar .txt** (pro editor cortar em cima) e **Baixar só a
  voz (MP3)** (a voz limpa pro vídeo; o mix com trilha continua no Download de sempre).
- "Regerar só a voz" no modo vídeo relê as cenas do texto e regrava todas.

## Fora da v1 (próximas fases, se ele pedir)
Vídeo do cliente dentro da MiniDAW; efeitos por cena puxados da biblioteca; idiomas; preset por tipo de
vídeo; 2 vozes no modo vídeo; guardar `peca`/duração na bancada (o texto em cenas já vai no rascunho).

## Restrição a lembrar
Vídeo de 6 cenas = 1 chamada de texto + 6 TTS. Cota grátis do Gemini (~15 TTS/dia, 3/min) dá ~2 vídeos
por dia; o billing (pendente desde 31/07) vira pré-requisito se isso virar rotina.

## Testes
- pytest `tests/test_audio_para_video.py`: `cenas_de_texto`/`texto_de_cenas` (cabeçalhos e parágrafos,
  ida e volta), endpoint sem chave → fonte 'base' com cenas, prompt/validação de cenas na IA, tela
  (selects, painel, botões), 429 por minuto com espera, versão `gerador.js?v=26`.

## Status
- Implementado 23/09/2026; aguardando ele usar.
