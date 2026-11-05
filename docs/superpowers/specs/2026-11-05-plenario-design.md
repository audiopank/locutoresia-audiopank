# 🏛️ Ambiente "Plenário" — MiniDAW clássica

**Data:** 05/11/2026 · **Status:** desenho aprovado pelo produtor, construído no mesmo dia.
**Origem:** comparando o modo "Discurso" do Suno (voz "projetada", soando no lugar) com o Gerador.
Ele preferiu a voz do Locutores IA; o que faltava era o AMBIENTE.

## Decisões do produtor
| Pergunta | Escolha |
|---|---|
| Onde | MiniDAW clássica (por faixa) |
| Quais ambientes | Só Plenário (Auditório/Igreja/Praça ficaram de fora) |
| Plateia | Não — só a sala; murmúrio/aplauso ele põe numa faixa de Efeito com arquivo |

## Como funciona
- Seletor **"Sala: Estúdio (padrão) · 🏛️ Plenário"** no painel do Reverb de cada faixa.
- Plenário liga o reverb e, se a quantidade estiver < 20%, sugere 25% (ajuste de ouvido 20–35%).
- Botão vira "Reverb 🏛️".
- **Sala Plenário** (`MixEngine.criarImpulsoPlenario`, semente fixa): 1,8 s, pré-delay 18 ms,
  6 primeiras reflexões (lado direito defasado/sinal trocado = estéreo), cauda RT60 1,2 s
  com passa-baixa que fecha 7 kHz → 1,8 kHz.
- **Envio** (`MixEngine.criarEnvioSala`): o retorno passa por "caixa de som" — HP 200 Hz,
  +3 dB em 2,5 kHz, LP 5,5 kHz. A voz SECA não muda (Regra do Eudes).
- **Estúdio** = campo `track.sala` AUSENTE → IR e caminho idênticos ao de antes (envio null).
- Mesmas funções no play (minidaw.js, `_religarSala` quando a sala muda) e no arquivo (mix-engine).
- Viaja no projeto (nuvem e Salvar no PC), abrir projeto, Copiar Efeitos, presets por faixa,
  rascunho no navegador.

## Testes
- `tests/plenario.test.mjs` (6): Estúdio idêntico; Plenário determinístico/estéreo; pré-delay,
  reflexões e queda ~60 dB; cauda escurece; envio HP→meio→LP.
- `tests/test_plenario_minidaw.py` (3): play = export, persistência, seletor e versões.
- Navegador: Estúdio→Plenário→Estúdio sai idêntico; voz seca −11,2/−11,1 dB; cauda morre ~1 s.
