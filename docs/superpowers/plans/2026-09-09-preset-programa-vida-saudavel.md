# Preset de programa no Gerador — "Vida Saudável" (09/09/2026)

## Por quê
O episódio 2 do Vida Saudável saiu sem o aviso legal e com a vinheta diferente do episódio 1:
o produtor monta o roteiro na mão e esquece as partes fixas. Ideia dele: um preset com o
"relógio" do programa (vinheta + miolo variável + aviso + fecho), a IA escrevendo só o miolo.
Não é o preset de VOZ rejeitado em 26/06 (ver memória): é formato de programa, como em rádio.

## Desenho
- **`core/programas.py`** (puro, testável): `PROGRAMAS` com as partes fixas do Vida Saudável,
  `montar_roteiro()`, `numero_por_extenso()`, `nome_do_spot()`, `prompt_miolo()`,
  `cta_da_conta()`, `contar_palavras()`, `alertas_editoriais()`.
- **Backend** (`backend/app.py`):
  - `GET /api/gerador/programas` — lista pra tela (id, nome, ajustes que a tela trava).
  - `GET /api/gerador/programa/<id>/proximo-episodio` — lê a série no feed (`newpost_feed.proximo_episodio`), max+1.
  - `POST /api/gerador/programa/roteiro` — {programa, tema, episodio, miolo?, patrocinador?} →
    miolo pela IA quando vazio (Gemini, thinking off, 2 tentativas, alvo 135–155 palavras),
    monta vinheta + miolo + aviso + fecho, devolve roteiro, nome do spot, contagens e avisos.
  - `/api/gerador/publicar-feed` — CTA do programa antes das hashtags; aceita `episodio` explícito.
- **Tela** (`templates/gerador.html` + `static/gerador.js` v=20): card "Programa" no topo.
  Escolher o programa trava formato/modo/voz/estilo/direção/gate/duração/conta do Feed e
  marca "texto pronto". Campos: tema, episódio (auto pelo feed, editável), patrocinador,
  miolo (vazio = IA). Botão "Montar roteiro do episódio" preenche o texto do comercial e o
  nome do áudio; "Gerar anúncio" monta sozinho se o texto estiver vazio.

## Regras que o preset carrega
- Vinheta: "Vida Saudável, um minuto e meio por dia sobre saúde e bem-estar. Episódio N." (N por extenso)
- Aviso: "Este conteúdo é informativo e não substitui a orientação do seu médico."
- Fecho: produzido por Locutores IA, Áudio Pank Produtora + patrocínio ("Esse espaço pode ser da
  sua marca." ou "Um oferecimento de X.") + WhatsApp por extenso em blocos de rádio.
- CTA no post do feed: "Qual tema de saúde você quer ouvir no próximo episódio? Comenta aqui ou manda um áudio."
- Miolo: gancho → tema → "três coisas pra você guardar" → fecho prático; proibido dose, remédio,
  cura, diagnóstico, número inventado.

## Verificação
- `pytest tests/test_programas.py tests/test_newpost_feed_serie.py` (sem rede).
- `proximo_episodio('vida')` contra o feed real → 3.
- Miolo real pela IA para um tema → contagem dentro do alvo.
- Página `/gerador` renderiza com os elementos novos; JS passa no parse.
