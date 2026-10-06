# Vídeo do episódio (MP4 9:16 pro YouTube Shorts) — Fase 1

**Pedido (06/10/2026):** substituir o Filmora. O episódio gerado vira um MP4 vertical com o molde que ele já usa no canal Genius Social.

**Regras dele:**
- O foco é a NewPost-IA; isto é "algo a mais".
- Não pode quebrar nada do que já existe.

**O molde do Filmora:**
1. Capa no início.
2. "Episódio N", em letras laranja e amarelas grandes.
3. Capa até o fim, com "ESCUTE A DICA" por cima por alguns segundos.
4. Final com SEGUIR, INFORMAÇÕES, a capa, o WhatsApp e um botão LIKE.

**Arquitetura (isolada):**
- **Novo `static/video-episodio.js`:**
  - Parte pura, testável em Node:
    - `roteiro(duracao)` → camadas com início e fim;
    - `camadasEm(rot, t)`;
    - `formatarWhatsApp(texto)`.
  - Parte de navegador:
    - desenha cada quadro num canvas 1080×1920;
    - codifica com WebCodecs (H.264 + AAC) e empacota com `mp4-muxer` (jsdelivr);
    - roda mais rápido que o tempo real e não depende da aba ficar em primeiro plano.
  - O painel lê o áudio do `#playerResultado`, o episódio do `#inputEpisodio` e o programa do `#selectPrograma`.
  - **Não toca no `gerador.js`.**
- **`gerador.html`:**
  - botão "🎬 Vídeo" na barra do resultado;
  - seção `#painelVideo`;
  - a capa é escolhida no PC e lembrada por programa (IndexedDB próprio, `locutores-ia-video`).
- **`core/programas.py`:** `lista_para_tela()` ganha `whatsapp`, tirado do fecho (só leitura, aditivo).
- **Sem servidor:** a Vercel não tem ffmpeg nem aguenta arquivo grande.

**Fora desta fase:** envio direto pro YouTube (Fase 2: OAuth + videos.insert, que sobe privado até a auditoria do Google).

**Testes:**
- `tests/video-episodio.test.mjs`: roteiro e WhatsApp.
- `tests/test_video_episodio.py`: ganchos na tela e o whatsapp do programa.
- Render real no Chrome headless: um MP4 curto, conferido com o `ffprobe` ou pelos bytes do arquivo.
