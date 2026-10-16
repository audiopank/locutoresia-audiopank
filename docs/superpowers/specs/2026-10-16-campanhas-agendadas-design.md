# Campanhas agendadas no feed da NewPost-IA — design

**Data:** 16/10/2026 · **Aprovado por ele:** parte 1 (o que ele vê) em 16/10; armazenamento no banco do feed (caminho A).

## Por quê
O agente da Base44/AppVerse posta as campanhas do ecossistema Áudio Pank no feed a cada
2 dias. Cancelar a Base44 mata esse fluxo. O Locutores IA passa a fazer isso, com áudio.

## Regra de ouro (feedback-publicacao-sempre-manual)
Nada é escrito por IA e publicado sem ele ver: a campanha é criada e aprovada por ele
(no Gerador ou na página). A repetição só republica o que ele aprovou.

## O que ele usa
- **Gerador → botão "📅 Agendar"** (ao lado de Feed): janela com perfil, imagem opcional,
  legenda + hashtags (vem do roteiro), "levar o áudio?", repetição, horário, começa em.
- **Página `/campanhas`** (privada, item no menu Ferramentas): contadores, teto por dia,
  lista com próxima saída / vezes / último post / último erro, Pausar·Retomar, Editar
  (legenda, tags, repetição, horário, próxima data), Apagar, "Nova campanha sem áudio".
- Perfis: locutores, principal, futuro, vida, achadinhos (os mesmos do Feed do Gerador).

## Regras
- Horários: **09h, 15h, 21h** (Brasília). Repetição: "a cada N dias" (1–30) ou dias da semana.
- **Anti-lotação:** no máximo 1 campanha por horário e no máximo `teto_diario` (1–3, padrão 1)
  por dia, somando todos os perfis. As outras esperam o próximo horário livre.
- **Achadinhos sem preço:** legenda/transcrição com "R$ 12", "12 reais" etc. é recusada
  (criar e editar), dizendo o trecho.
- **Sem post duplicado:** cada saída usa `idempotency_key` = campanha + data + horário.
- **Falha nunca some:** grava `ultimo_erro`; a campanha continua na fila (tenta no próximo horário).

## Armazenamento (banco do feed `esdgly`)
- `campanhas_locutores` e `campanhas_config` (SQL em `CREATE_CAMPANHAS_FEED.sql`, rodado por ele).
- RLS: cada linha pertence ao `auth.uid()` do perfil que publica. O Locutores IA loga em
  cada perfil (newpost_feed.sessao) — não precisa de chave mestra.
- Áudio (`post-audio`) e imagem (`post-media`) sobem na hora de agendar, pelo perfil escolhido.
- Teto diário: linha de `campanhas_config` do perfil `principal`.

## Disparo
- Vercel Cron em `/api/cron/campanhas`: `0 12`, `0 18`, `0 0` UTC (= 09/15/21h Brasília).
  No plano Hobby pode atrasar até ~59 min: o horário vale pela faixa (09–14h = slot 9,
  15–20h = slot 15, 21–23h = slot 21; madrugada = nada).
- Seleção: ativas com `proxima_em < hoje` ou (`= hoje` e `horario <= slot`), mais
  atrasada primeiro. Publica 1; se falhar, grava o erro e tenta a próxima candidata.
- Depois de publicar: `vezes+1`, `ultima_em`, `ultimo_post_id`, `proxima_em` = hoje+N
  ou o próximo dia da semana marcado.
- `CRON_SECRET` igual ao `/api/cron/publish-news`.

## Fora do escopo
Instagram/TikTok/etc.; roteiro com Gemini dentro da página (fica no Gerador); trocar o
áudio de uma campanha existente (agenda de novo).

## Testes
`tests/test_campanhas.py`: slot, próxima data, escolha com teto/1 por horário, trava de
preço, rotas com feed simulado, cron com segredo. Verificação real: 1 campanha de teste
publicada por ele.
