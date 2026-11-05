# 🔁 Regerar trecho — MiniDAW clássica

**Data:** 05/11/2026 · **Status:** desenho aprovado pelo produtor (05/11)
**Origem:** "Modo Especial" do pedido dos 3 modos. A IA errou a pronúncia no meio de uma
locução de 30 s ("Silvestre Arruda"); o produtor marca só aquele trecho na faixa de voz e
gera uma fala nova SÓ ali, sem regerar tudo.

**Fora do escopo agora:** Modo Simples (Studio já tem "Enviar fatiado") e Modo Avançado
(caixa única juntando Studio + Narrativa + Gerador) — ficam pra depois do Modo 3 aprovado de
ouvido. MiniDAW React também fica pra depois (mesmo caminho da Pré-escuta).

## Decisões do produtor

| Pergunta | Escolha |
|---|---|
| Por onde começar | Só o Modo 3 |
| Qual MiniDAW | Clássica primeiro |
| Fala nova com tamanho diferente do trecho | Empurra o resto da MESMA faixa de voz; trilha e efeitos não se mexem |
| De onde vem o texto do trecho | O produtor digita (0 cota extra); sem transcrição por IA |

## Fluxo na tela

1. Tesoura armada numa faixa de **voz**, trecho marcado (`this.selecoes[trackId]`).
2. Barra da Tesoura ganha **"🔁 Regerar trecho"** — só em `track.type === 'voice'`, só com
   UM trecho marcado (seleção múltipla → aviso, igual Remover/Manter/Dividir).
3. Janelinha (painel fixo, padrão do Vídeo do cliente/Pré-escuta):
   - **Frase** (textarea): digitada do jeito que deve soar ("Sil-vés-tre Ar-rú-da"), aceita
     `[direção]` em colchetes (o backend já trata: Gemini obedece, ElevenLabs/Edge coam).
   - **Frases do roteiro** em botõezinhos, se houver `localStorage.minidaw_pending_roteiro`
     (o Studio já grava). Clique preenche a caixa. Divisão por frase: `.`, `!`, `?`, quebra de linha.
   - **Voz / estilo / provedor / idioma** pré-preenchidos:
     1º `localStorage.minidaw_ultima_geracao` (NOVO — o Studio grava `{voice, style, provider, language}`
     no mesmo ponto em que grava o roteiro);
     2º nome do clip (`Callirrhoe_-_Gemini_…` → voz Callirrhoe, provedor gemini);
     3º nada → o produtor escolhe. Lista de vozes de `/api/voices`.
   - Botões: **Gerar** · **Ouvir antes** · **Ouvir depois** · **Aplicar** · **Tentar de novo** · **Cancelar**.
4. **Gerar** = 1 `POST /api/generate-audio` (mesmo payload do Studio) → baixa com
   `window.baixarAudioEmPartes` → decodifica. Erro 429 → mensagem honesta da cota (sem retry em laço).
5. **Ouvir antes/depois**: toca 2 s antes do trecho + trecho (original ou novo) + 2 s depois,
   só a faixa de voz, sem mexer no projeto.
6. **Aplicar** costura (abaixo) com UM `_guardarUndo` → Ctrl+Z desfaz tudo.
   **Tentar de novo** = novo Gerar (mais 1 TTS). **Cancelar** = nada muda.

## Costura (função pura, testável no node)

`RegerarTrecho.costurar(clips, ini, fim, novo, opts)` em `static/regerar-trecho.js` (UMD):

- `novo` = `{ buffer, falaIni, falaFim }` — bordas da fala achadas com
  `AlinharFalas.bordasDaFala` (mesma régua do 🧲 Alinhar falas; folgas 40/80 ms).
- `ganhoDb` da fala nova = medição de fala da voz em volta (mesma lógica do
  `ClipModel.igualarDb`: janelas 20 ms, ignora > 30 dB abaixo do pico) − medição da fala nova;
  limite ±18 dB (limite do `ganhoDb` existente).
- Passos: (1) `ClipModel.silenciarTrecho(clips, ini, fim, 0.015)` — tira [ini, fim] SEM puxar
  (os pedaços ficam no lugar, com micro-fade nas bordas novas);
  (2) insere o clip novo em `inicio = ini`, `offset = falaIni`, `duracao = falaFim − falaIni`,
  com `fadeIn`/`fadeOut` de crossfade (padrão 15 ms) e os pedaços vizinhos ganham fade igual na
  borda nova; (3) `delta = duracaoNova − (fim − ini)`; todo clip da MESMA faixa com
  `inicio ≥ fim` anda `delta` (pra frente ou pra trás); (4) `ordenarClips`.
- Clips com cadeado (`estaTravado`) depois do trecho: NÃO andam → se o empurrão causaria
  sobreposição, `costurar` devolve `{ erro }` e a tela avisa (nada aplicado).
- Devolve `{ clips, delta }`. Não toca em outras faixas.

## Integração na minidaw.js

- `regerarTrecho(trackId)` abre o painel; `aplicarRegeracao(trackId, novo)` chama `costurar`,
  `_guardarUndo`, grava clips, `_sincronizarDerivados` / `aposMudancaDeClips`, limpa a seleção,
  aviso: "Trecho regerado — o resto da voz andou +0,30 s".
- Efeitos da faixa (EQ, compressor, gate, presença…) valem pra fala nova por ser clip da mesma faixa.
- Tecla de atalho: a escolher na implementação, sem colidir com Q / Shift+Q / Ctrl+Q / W / R /
  Alt+1/2 / Espaço (candidata: **G** com a Tesoura armada).
- Take gravado ao vivo (clip vindo do ● Gravação): o botão aparece, mas avisa que voz
  gravada se regrava no microfone (não há voz IA pra imitar).

## Studio (static/script.js)

- No ponto onde já grava `minidaw_pending_roteiro`, gravar também
  `minidaw_ultima_geracao = JSON.stringify({voice, style, provider, language})`. Só isso.

## Arquivos

- NOVO `static/regerar-trecho.js` (puro + painel), carregado depois de `alinhar-falas.js` e
  `minidaw.js` em `templates/minidaw.html` (`?v=1`).
- `static/minidaw.js` (bump de versão → atualizar os ~23 testes .py que fixam `minidaw.js?v=`).
- `static/script.js` (bump `?v=` no template do Studio).
- Testes: `tests/regerar-trecho.test.mjs` (costura: delta +/−, fade nas emendas, cadeado,
  ganho limitado, outros clips intocados) + teste no Chrome (puppeteer, voz real ou seno,
  `/api/generate-audio` interceptado pra não gastar cota).

## Não fazer

- Nada no Supabase além do que a geração normal já faz.
- Não mexer em trilha/efeitos/outras faixas nem no tempo delas.
- Não mexer no som aprovado (Regra do Eudes): a costura só troca o trecho marcado.
