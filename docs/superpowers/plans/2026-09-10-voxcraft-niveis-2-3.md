# VoxCraft AI — níveis 2 (contexto) e 3 (ação) — 10/09/2026

## Por quê
Nível 1 (prompt verdadeiro + dados vivos) entrou hoje. O produtor: "o agente só tem
importância de verdade se fizer automaticamente essas funções". É assistente INTERNO
dele (não está na vitrine). Restrição do dia: há spot real (Prefeitura do Crato) pra
gerar — o Gerador não pode quebrar. Por isso: backend primeiro, tela depois.

## Fase A — backend (sem tocar em tela)
1. **Contexto estruturado**: `/api/voxcraft/chat` aceita `contexto` como objeto
   `{tela, roteiro, plano, formato, modo, voz, estilo, direcao, trilha, nome, conta_feed,
   programa, tema, episodio, miolo, duracao_mix, faixas[]}`. `voxcraft_diagnostico()`
   calcula (não deixa o modelo fazer conta): palavras, fala estimada (2,15–2,55 pal/s),
   arquivo (+3,05 s de cauda), veredito contra a grade do plano, frase legal por setor
   (reusa `checar_qualidade`), contagem do miolo contra o alvo do programa e alertas
   editoriais. Vai no prompt como "DIAGNÓSTICO CALCULADO — confie nestes números".
2. **Ferramentas (function calling do Gemini)**, cada uma reusando a view existente
   via `_chamar_view_json(view, data)` (request context aninhado — zero refatoração
   das views, zero risco):
   - `escrever_roteiro_spot(briefing, plano, formato)` → `/api/gerador/roteiro`
   - `montar_episodio(programa, tema, episodio?, miolo?, patrocinador?)` → `/api/gerador/programa/roteiro`
     (sem episódio, lê a série do feed)
   - `escolher_trilha(descricao)` → `/api/voxcraft/recommend-tracks`
   - `checar_roteiro(roteiro, plano)` → estimativa + `/api/qualidade/checar`
   Loop de até 4 rodadas em `_voxcraft_dialogo()`; a chamada ao Gemini fica isolada em
   `_gemini_chat_turn()` (dublê nos testes). Quando uma ferramenta devolve roteiro ou
   episódio, a resposta traz `acoes: [{tipo:'abrir_gerador', rotulo, campos}]` — o
   botão da tela leva tudo preenchido. Gerar áudio, enviar e publicar seguem cliques dele.
3. Prompt: seção FERRAMENTAS; proibido dizer que gerou/publicou.

## Fase B — tela
1. `templates/_voxcraft_widget.html` + `static/voxcraft-widget.js` (uma fonte), incluídos
   em `/gerador` e `/minidaw`. A home mantém a cópia antiga (não mexer na navegação dele).
   O widget chama `window.voxcraftContexto()` a cada envio e renderiza os botões de `acoes`.
2. `gerador.js`: `voxcraftContexto()` (estado da tela) e `aplicarPrefillVoxcraft(campos)`
   (programa/tema/episódio/patrocinador/miolo/roteiro/plano/formato/nome/trilha);
   handoff por `sessionStorage.voxcraft_prefill` quando vem de outra tela.
3. `minidaw`: contexto mínimo (faixas com nome/duração) se o estado estiver acessível.

## Verificação
- pytest: diagnóstico (números), executores (views reais com IA dublada), loop com
  chamada → resposta, `acoes` montadas, contexto string ainda funciona.
- Ao vivo: "monta o episódio 5 sobre hidratação" → roteiro + botão; "escreve um spot
  de 30 s pra prefeitura do Crato…" → roteiro na grade; "que trilha usar?" → 3 do acervo.
- Tela: /gerador renderiza o widget; prefill preenche; spot real do dia gerado normalmente.
