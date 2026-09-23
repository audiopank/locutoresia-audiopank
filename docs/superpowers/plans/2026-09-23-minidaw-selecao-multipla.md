# Seleção múltipla de objetos na MiniDAW clássica (23/09/2026)

**Pedido:** "Imagine poder dar um Ctrl+A e selecionar todos os objetos que estão nos tracks (como no
Samplitude) + passar o mouse por cima de um objeto e, com o botão direito, selecionar apenas 1 objeto."

**Hoje:** a seleção é de UM objeto (`clipSelecionado`), feita pelo clique; Ctrl+C/X/V, arrasto e
Time Stretch trabalham nele. Delete apaga o clip sob a linha de corte (mouse), não o selecionado.

## Escopo (um commit)

- **Modelo:** `selecionados = [{trackId, clipId}]` (o `clipSelecionado` continua como o "principal",
  pra Ctrl+C simples e Time Stretch). Realce pela classe `.selecionado` já existente, reaplicado
  no redesenho.
- **Gestos:**
  - Clique = só este (como hoje). Ctrl+clique = liga/desliga no grupo. **Ctrl+A** = todos os objetos
    de todas as faixas. **Esc** = limpa.
  - **Botão direito** num objeto = seleciona SÓ ele (a menos que já esteja num grupo) e abre o menu
    de contexto: Copiar · Recortar · Colar aqui · Dividir aqui · Time Stretch exato… · Apagar ·
    Selecionar todos. "Colar aqui" e "Dividir aqui" usam a faixa e o tempo do clique direito (o
    mouse vai estar sobre o menu, não sobre a lane).
- **Operações que respeitam o grupo:**
  - **Arrastar** um objeto do grupo move TODOS juntos (mesma faixa cada um, sem cross-track para
    grupos): mesmo delta, imã do objeto agarrado, ninguém passa do 0:00, nenhum selecionado invade
    um NÃO selecionado da própria faixa (senão o grupo não anda). Um Ctrl+Z desfaz o grupo inteiro.
  - **Delete/Backspace** com grupo (≥2) apaga todos (um Ctrl+Z). Com 1 selecionado e mouse fora
    das lanes, apaga o selecionado. Mouse sobre uma lane com seleção simples: continua apagando o
    clip sob a linha (comportamento de hoje).
  - **Ctrl+C / Ctrl+X** com grupo copiam o conjunto com as posições relativas e a faixa de origem;
    **Ctrl+V** cola o conjunto NAS MESMAS faixas, ancorado no tempo do mouse/cursor; se alguma faixa
    sumiu ou algum objeto não cabe, nada é colado (aviso). Seleção simples continua como hoje
    (cola na faixa sob o mouse).
- **Fora:** seleção por laço (arrastar um retângulo no vazio), mover grupo entre faixas, Time
  Stretch em grupo.

## Testes
- pytest `tests/test_selecao_multipla.py`: modelo e gestos no código (Ctrl+A, Esc, Delete em grupo,
  botão direito seleciona só um, menu com os itens, arrasto em grupo com clamp em 0 e colisão,
  colar grupo nas mesmas faixas), versão `minidaw.js?v=68`.

## Status
- Implementado 23/09/2026; aguardando ele usar.
