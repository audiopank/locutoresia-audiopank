# Estúdio de Narrativa (multivoz por parágrafo) — 11/09/2026

## Por quê
O produtor viu o Story Studio do Fish e quis o equivalente "mantendo toda a nossa
estrutura sem quebrar nada — o que já temos é sagrado". Hoje o Gerador faz 2 vozes por
chamada (Diálogo / Narração revezada) e a MiniDAW tem a timeline. Falta: N vozes,
uma por parágrafo, com direção por parágrafo, regeneração de um parágrafo só, e a
montagem automática.

## Regra de ouro
Página NOVA (`/narrativa`, `templates/narrativa.html`, `static/narrativa.js`). Não toca
em Gerador, MiniDAW nem tts_generator. Reusa: `/api/voices`, `/api/generate-audio`
(1 chamada por bloco, direção entre colchetes só no Google), `MixEngine.masterizarBuffer`
+ `bufferToMp3` (export), o handoff `localStorage.minidaw_projeto_gerador` (a MiniDAW
já recebe), e o upload de rascunho (o MP3 final vai pros "Spots guardados" do Gerador,
com .txt v2 → Reabrir → Feed/Enviar funcionam sem código novo).

## Modelo
Narrativa = { nome, pausa_s (0.6), vozes: {Personagem → {voz_id, provider, direcao_padrao}},
blocos: [{ id, personagem, direcao, texto, audio? }] }.
Texto colado com "Nome: fala" por parágrafo vira blocos; parágrafo sem nome = "Narrador".
Persistência: `narrativas/<carimbo>_<slug>.json` no bucket client-deliveries via
`/api/narrativas` (GET lista, POST salva, GET /<arquivo>, DELETE) — JSON pequeno,
upload server-side. Rascunho automático no localStorage.

## Tela
1. Cabeçalho: nome, botão Abrir/Guardar narrativa, pausa entre blocos, contador
   "N blocos = N locuções (cota do dia: ~10)".
2. Área "Roteiro": textarea + botão "Dividir em blocos".
3. Vozes: uma linha por personagem detectado — select de voz (catálogo com ♂/♀ e
   provedor) + direção padrão.
4. Blocos: cartão por parágrafo — personagem, direção (opcional, sobrescreve), texto
   editável, status (pendente / gerado / desatualizado quando o texto muda), botões
   "Gerar este" e "Ouvir".
5. Barra: "Gerar tudo (só o que falta)", "Ouvir montagem", "Exportar MP3", "Guardar nos
   Spots guardados", "Abrir na MiniDAW" (narração montada como UMA faixa de voz; trilha e
   efeitos ele coloca lá).

## Verificação
- pytest: endpoints de narrativa (salvar/listar/ler/apagar contra o Storage real),
  função pura de dividir em blocos (nomes, Narrador, linhas vazias), página renderiza.
- Ao vivo: 3 blocos com 2 vozes → 3 TTS → montagem → MP3 → Spots guardados → Reabrir.
