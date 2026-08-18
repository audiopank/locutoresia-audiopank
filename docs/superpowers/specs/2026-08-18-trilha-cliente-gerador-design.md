# Trilha do cliente no Gerador de Anúncios — design

**Data:** 2026-08-18
**Status:** aprovado pelo usuário (brainstorming completo)

## Problema

O select "Trilha de fundo" do Gerador de Anúncios (`/gerador`) só oferece três
caminhos hoje: "Deixar a IA escolher" (do acervo da Biblioteca de Trilhas),
uma trilha específica do acervo, ou locução seca. **Não existe jeito de usar o
jingle/trilha que o próprio cliente já tem** — e cliente com jingle próprio é
um caso comum de verdade (foi exatamente o cenário da automação de volume na
MiniDAW na semana passada: jingle cantado + instrumental do cliente).

A inspiração veio do Moises ("Add a track" → "My files"), mas o escopo aqui é
deliberadamente menor: **usar o arquivo do cliente como trilha de fundo**, não
gerar música nova nem analisar semelhança.

## Decisões do usuário

| Pergunta | Resposta |
|---|---|
| Quais frentes entram | Só "Subir trilha do cliente" (IA ouvir amostra de referência e SFX por IA ficaram de fora) |
| Onde o arquivo vive | Sobe pro Supabase Storage na hora (padrão de signed upload URL já existente) — ganha `file_url` |
| Reuso em spots futuros | Sim — aparece no select num grupo separado "Trilhas de clientes" |
| IA automática pode escolhê-las? | **NUNCA** — o "Deixar a IA escolher" fica cego a trilhas de clientes |

## O que NÃO muda

O "Deixar a IA escolher" continua sendo a opção padrão e continua funcionando
exatamente como hoje: `recommend-tracks` lê o roteiro e o Gemini escolhe do
acervo. A feature nova é só mais uma opção no select — não tira nenhuma
autonomia da IA no caso comum (cliente sem trilha própria).

## Arquitetura

**Reuso máximo — quase nada de backend novo.** A infraestrutura de upload já
existe inteira e é usada pela Biblioteca de Trilhas:

1. `POST /api/tracks/upload-url` → signed upload URL do Supabase Storage
   (bucket `TRACKS_BUCKET`, caminho `tracks/<uuid>.<ext>`). O navegador envia o
   arquivo DIRETO pro Storage — contorna o limite de ~4.5MB do corpo de
   requisição da Vercel. Endpoint já existe, não muda.
2. `POST /api/tracks/upload-metadata` → grava a linha na `music_tracks`.
   Endpoint já existe e já aceita `genre` arbitrário — o Gerador manda
   **`genre='trilha_cliente'`**. Mesmo truque do `genre='demo_voz'` das
   amostras da Vitrine: sobe hoje, sem SQL novo no Supabase.
3. A trilha vira uma linha real da `music_tracks` com `file_url` público —
   pro resto do sistema é uma trilha como outra qualquer. **"Abrir na
   MiniDAW", "Regerar só a voz" e Spots guardados funcionam de graça**
   (todos dependem só de `file_url`).

**Frontend (`static/gerador.js` + `templates/gerador.html`):**

- O select "Trilha de fundo" ganha a opção **"📤 Subir trilha do cliente..."**
  (valor `upload`) e passa a montar o catálogo em dois `<optgroup>`:
  **"Acervo"** (`genre != 'trilha_cliente'`) e **"Trilhas de clientes"**
  (`genre == 'trilha_cliente'`). As opções fixas "Deixar a IA escolher" e
  "Sem trilha" continuam no topo, fora dos grupos.
- Escolher "Subir trilha..." abre um `<input type="file" accept="audio/*">`
  (elemento oculto, disparado via JS — padrão comum do repo). Fluxo:
  1. Produtor escolhe o arquivo; um `window.prompt` simples pede o nome da
     trilha, pré-preenchido com o nome do arquivo sem extensão (sem modal
     custom — é ferramenta interna, e a página não tem framework de modal).
     A mensagem do prompt orienta incluir o nome do cliente (ex.: "Jingle
     Padaria do Zé").
  2. O arquivo é decodificado localmente (`decodeAudioData`) — já precisamos
     do buffer pra mixar, e daí sai a `duration` real pros metadados.
  3. Upload pro Storage via signed URL, com indicação de progresso na área
     de avisos já existente (`avisar(...)`).
  4. `upload-metadata` grava a linha com `genre='trilha_cliente'`,
     `description='Trilha enviada pelo cliente'`, `duration` medida,
     `mime_type` e `file_size` do arquivo.
  5. A opção nova entra no optgroup "Trilhas de clientes" **e fica
     selecionada**. O buffer decodificado fica guardado em memória
     (`estado`) — o "Gerar anúncio" da vez usa esse buffer direto, sem
     baixar de volta do Storage.
- Cancelou o seletor de arquivo? O select volta pra opção anterior, sem
  efeito colateral.

**Passo [3] TRILHA do pipeline (`gerarSpot`):** ganha um ramo pro caso "trilha
recém-subida na sessão": se o valor selecionado corresponde à trilha que
acabou de subir e o buffer está em memória, usa o buffer direto. Senão, o
ramo existente (busca por id no `/api/tracks` + `baixarEDecodificar`) já
cobre — inclusive trilhas de clientes subidas em sessões anteriores, que
chegam pelo catálogo normalmente.

## Proteções

- **`/api/voxcraft/recommend-tracks` passa a excluir `genre='trilha_cliente'`
  E `genre='demo_voz'`** na consulta ao acervo. A exclusão de
  `trilha_cliente` é a regra de negócio (jingle do cliente A jamais no
  anúncio do cliente B). A de `demo_voz` é **correção de bug latente
  descoberto neste brainstorming**: `/api/tracks` já filtrava demos, mas o
  `recommend-tracks` não — a IA podia recomendar uma demo de voz como trilha
  de fundo. É a única mudança de backend desta feature.
- Efeito colateral consciente e aceito: trilhas de clientes **aparecem também
  na Biblioteca de Trilhas da MiniDAW** (mesma fonte `/api/tracks`). Positivo:
  dá pra usá-las lá; o nome com o cliente identifica de quem é.

## Erros e casos de borda

- **Upload pro Storage falha** (rede, Storage fora): avisa via `avisar(...)`
  e mantém o buffer decodificado em memória — o spot da vez ainda sai com a
  trilha, com aviso claro de que ela NÃO ficou guardada (não vai aparecer no
  select amanhã nem no "Abrir na MiniDAW" como URL).
- **`upload-metadata` falha com arquivo já no Storage**: mesmo tratamento —
  o spot da vez sai; aviso de que a trilha não ficou catalogada.
- **Arquivo que não decodifica** (formato não suportado, arquivo corrompido):
  erro amigável antes de qualquer upload — nada sobe pro Storage se o áudio
  não toca.
- **Arquivo muito grande**: sem teto rígido (o signed upload já existe pra
  isso), mas aviso orientando MP3 quando passar de ~25MB — WAV de 5 minutos
  pesa no decode e no Storage à toa.
- **Nome vazio no prompt**: usa o nome do arquivo sem extensão.

## Fora de escopo desta v1 (decidido no brainstorming)

- **IA ouvir amostra de referência** (Gemini multimodal escutando 20-30s e
  escolhendo a trilha mais parecida do acervo) — viável tecnicamente, fica
  como possibilidade futura.
- **Efeitos sonoros por IA** (ElevenLabs sound effects posicionados pela
  receita de mix) — ideia registrada, não entra agora.
- **Gerar música/stems por IA** (painel do Moises) — fora de propósito pro
  negócio; sem API de geração musical no stack, e as pagas consomem crédito
  pesado sem demanda comprovada.
- **Excluir/renomear trilha de cliente pela tela do Gerador** — a gestão de
  trilhas já existe na Biblioteca; não duplicar.
