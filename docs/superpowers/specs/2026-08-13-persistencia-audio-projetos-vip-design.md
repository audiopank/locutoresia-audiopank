# Persistência de áudio nos Projetos VIP (Audio Pank Studio) — design

**Data:** 2026-08-13
**Status:** aprovado pelo usuário (brainstorming completo)

## Problema

O botão "Salvar VIP" (`minidaw-react/src/components/VipProjects.tsx`, aba
Multi-Track do Audio Pank Studio) salva o áudio de cada faixa como um link
`blob:` — uma referência que só existe na memória daquela aba do navegador.
No instante em que a aba fecha ou recarrega, o link morre **para sempre**,
em qualquer sessão, em qualquer navegador.

Confirmado com evidência direta (consulta ao Supabase, projeto `ykswh`,
tabela `minidaw_projects`) num projeto salvo hoje pelo usuário: nome,
duração, efeitos e volume voltam certos ao reabrir (são dados JSON de
verdade), mas o `audioUrl` de cada faixa é literalmente
`blob:https://locutoresia-audiopank-ai.vercel.app/...` — irrecuperável.
**Todo projeto salvo em VIP até hoje está com o áudio permanentemente
perdido**; isso só dá pra evitar daqui pra frente, não consertar
retroativamente (decisão do usuário: não construir nenhum aviso especial
pra esses projetos antigos — ficam como estão).

Achado um segundo bug, menor, no mesmo caminho: o backend devolve o link
resolvido do áudio como `audio_url` (com underscore); a interface
`Track`/JSX da React só lê `audioUrl` (sem underscore). Mesmo depois do
upload funcionar, sem esse ajuste o áudio carregado no GET nunca chegaria
no `<audio src>`.

## Por que existe um caminho pronto pra copiar

A MiniDAW **clássica** já resolveu exatamente esse problema
(`static/minidaw.js`, `salvarProjetoSupabase`/`carregarProjetoSupabase`,
22-23/07/2026, validado ponta a ponta com arquivo grande real) — e usa o
**mesmo backend** que a React (`/api/projects`, tabela `minidaw_projects`,
endpoint de upload assinado `/api/client-deliveries/upload-url` com
`kind='projeto'`). Não é preciso mexer no backend pra isso — só portar a
metade que falta no lado React (upload no save + leitura correta no load).

A React tem um modelo mais simples que a clássica (uma `audioUrl` por
track, sem array de buffers/clips por faixa), então o port fica mais
enxuto que o original.

## Decisões do usuário

| Pergunta | Resposta |
|---|---|
| Quando o áudio vira permanente | No clique de "Salvar VIP" (não no momento de gerar/carregar a faixa) |
| Projetos antigos já quebrados | Nenhum aviso especial — ficam como estão hoje |
| Guardar localmente (ideia trazida do Samplitude) | Descartada — navegador não tem acesso a disco como um app instalado, e destruiria o motivo da feature existir (reabrir de qualquer lugar, dias depois) |
| Preocupação de "não sufocar o Supabase" | Resolvida por compressão (MP3 em vez de WAV) + reuso de upload + faxina de órfão no delete, mantendo tudo na nuvem |

## Arquitetura

**Novo arquivo `minidaw-react/src/lib/projectStorage.ts`** — isola toda a
lógica de "tornar o áudio de uma faixa permanente", separada da UI:

```
garantirArmazenamentoPermanente(track) → { audio_path } | { audio_url_direct }
```

Decide o que fazer com cada faixa, nesta ordem (evita reupload à toa):

1. A faixa já tem `audio_path` de um load anterior (não foi trocada) →
   reusa, sem reupload. Isso é o que faz resalvar um projeto existente (só
   ajustou EQ, por exemplo) não reenviar áudio que não mudou.
2. A faixa já tem `audio_url_direct` (ex.: trilha da Biblioteca, URL
   pública estável) → reusa, sem reupload.
3. `track.audioUrl` já é uma URL `http(s)` estável — não é `blob:` e não é
   um padrão de signed URL de 1h (`/object/sign/` ou `token=` na URL,
   mesmo teste que a clássica já usa) → vira `audio_url_direct`, sem
   reupload.
4. Nenhum dos casos acima (o caso comum: `blob:` de voz gerada ou arquivo
   local) → busca o blob (`fetch(audioUrl)`), decodifica e recomprime pra
   **MP3 128kbps** reaproveitando `decodificar`/`paraMp3` de
   `minidaw-react/src/lib/audioFile.js` (já testados na Masterização — sem
   código de áudio novo), sobe pro Storage via `uploadAudioProjeto`, devolve
   `{ audio_path }`.

`uploadAudioProjeto(blob)` replica o padrão já validado da clássica: POST
`/api/client-deliveries/upload-url` (`kind:'projeto'`) → PUT do blob direto
pro Storage → devolve o `path`. 128kbps (não os 192kbps usados na entrega
pro cliente) porque este é um backup de projeto pra retrabalho interno, não
um arquivo final — qualidade suficiente, metade do tamanho.

## Onde entra no fluxo existente

**`VipProjects.tsx`, `save()`:** antes do `POST /api/projects`, mapeia cada
track de `getCurrent()` por `garantirArmazenamentoPermanente` (em
paralelo). Se qualquer upload falhar, aborta o save inteiro — nunca grava
um projeto pela metade — e mostra erro nomeando qual faixa falhou (mesmo
padrão "onde parou" já usado na clássica). O payload final troca
`audioUrl` (blob morto) por `audio_path`/`audio_url_direct` resolvidos.

**`VipProjects.tsx`, `openProject()`:** ao montar o `ProjectSnapshot` a
partir da resposta do GET, aplica `audioUrl: t.audio_url || t.audioUrl`
preservando `audio_path`/`audio_url_direct` no objeto da track — isso é o
que habilita o passo 1/2 acima num save seguinte.

## Faxina de áudio órfão (fecha a Fase 2 pendente da clássica)

`DELETE /api/projects/<project_id>` (`backend/app.py`) passa a: ler a linha
antes de apagar, coletar os `audio_path` de cada track (nunca
`audio_url_direct` — são URLs compartilhadas/públicas que não pertencem a
este projeto, ex. trilha da Biblioteca usada em vários projetos), chamar
`storage.from_(CLIENT_DELIVERIES_BUCKET).remove([paths])`, e só então
apagar a linha da tabela. Falha na limpeza do Storage não bloqueia a
exclusão do projeto — só é logada (best-effort).

## Erros e UX

Mesmo padrão de erro "onde parou" já usado e aprovado na clássica: qualquer
falha no upload de qualquer faixa aborta o save inteiro com uma mensagem
específica (não um genérico "falha ao salvar"). O botão "Salvar VIP" já
tem estado de loading/disabled (`saving`) — só o texto do toast muda pra
deixar claro que está enviando áudio, não só gravando texto.

## Fora de escopo (decisão do usuário)

- Aviso visual em projetos antigos com áudio já perdido.
- Upload no momento de gerar/carregar a faixa (só acontece ao salvar).
- Guardar arquivo local no computador do usuário.

## Testes

Sem lógica matemática pura aqui (é I/O de rede — fetch/upload), então sem
`node --test`. Verificação manual, mesmo protocolo já usado pra validar a
clássica: salvar um projeto com voz gerada + trilha da Biblioteca, conferir
direto no Supabase que gravou `audio_path`/`audio_url_direct` (não
`blob:`), reabrir numa aba **nova** e confirmar que o áudio toca de
verdade. Testar também: resalvar o mesmo projeto sem trocar nada (não deve
reenviar áudio) e excluir um projeto (confirmar que o arquivo some do
Storage).
