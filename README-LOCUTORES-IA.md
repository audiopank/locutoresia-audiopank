# 🎙️ Studio Audio Pank — Export para Locutores IA (Trae.AI)

Pacote completo com **119 arquivos** do Studio para migrar para sua nova aplicação.

## 📦 Estrutura do ZIP

```
src/
├── App.tsx                          # Rotas (adapte ao seu router)
├── index.css                        # ⚠️ Design tokens (HSL) — COPIE INTEGRAL
├── pages/
│   ├── Studio.tsx                   # Página principal /studio
│   ├── Projects.tsx                 # Lista de projetos
│   ├── VIPProjects.tsx              # Projetos VIP
│   └── ApiKeysSettings.tsx          # Painel de chaves (server/local)
├── components/
│   ├── AudioStudio/                 # 25 componentes (DAW completo)
│   ├── VoxCraftAssistant/           # Assistente IA flutuante
│   └── ui/                          # shadcn/ui (50+ componentes)
├── hooks/                           # useAudioProjects, useVIPBackup etc
├── services/                        # TTS, mixer, encoder, IA
├── integrations/supabase/           # ⚠️ Client + types (gerar de novo)
├── lib/                             # utils + api
└── store/                           # daw.ts (Zustand)

supabase/
├── config.toml
└── functions/                       # 11 edge functions
    ├── elevenlabs-tts/
    ├── google-tts/
    ├── lmnt-tts/
    ├── openai-tts/
    ├── generate-music/
    ├── freesound-sfx/
    ├── ai-audio-producer/
    ├── voxcraft-assistant/
    ├── check-secrets/
    ├── publish-to-newpost/
    └── generate-audio-for-post/

tailwind.config.ts
package.json
```

## 🚀 Como usar no Trae.AI

### 1. Stack base obrigatória
React 18 + Vite + TypeScript + Tailwind v3 + shadcn/ui.

### 2. Instalar dependências
Copie do `package.json`. Principais:
```bash
npm i @supabase/supabase-js @tanstack/react-query react-router-dom \
  wavesurfer.js @breezystack/lamejs zustand lucide-react sonner \
  react-hook-form zod @hookform/resolvers class-variance-authority \
  tailwind-merge tailwindcss-animate
# + todos @radix-ui/* do package.json
```

### 3. Supabase
- Crie um projeto Supabase novo no Trae.AI.
- Substitua `src/integrations/supabase/client.ts` com SUA URL e anon key.
- Regenere `types.ts` via `supabase gen types typescript`.
- Recrie tabelas: `audio_projects`, `project_versions`, `notifications`, `user_roles`, `vip_backups` (rode os SQLs que já te passei).
- Crie bucket `audio-projects` (público).

### 4. Secrets (Edge Functions)
Configure no Supabase Dashboard → Edge Functions → Secrets:
- `LOVABLE_API_KEY` (Gemini, via gateway)
- `ELEVENLABS_API_KEY_1`
- `GOOGLE_TTS_API_KEY`
- `LMNT_API_KEY`
- `OPENAI_API_KEY`
- `REPLICATE_API_TOKEN` (MusicGen)
- `FREESOUND_API_KEY`

### 5. Design tokens
**NÃO** sobrescreva o `index.css` com defaults — ele tem o tema dark/studio com gradientes. As cores são todas HSL semânticas (`--primary`, `--studio-knob`, `bg-gradient-studio` etc).

### 6. Rotas
Adapte `App.tsx` ao seu router:
- `/studio` → `Studio.tsx`
- `/projects` → `Projects.tsx`
- `/projects/vip` → `VIPProjects.tsx`
- `/settings/api-keys` → `ApiKeysSettings.tsx`

## ⚠️ Pontos de atenção

1. **`SpectrumAnalyzer.tsx`** usa cores HSL/Hex hardcoded de propósito (Canvas não lê CSS vars) — não troque por `var(--primary)`.
2. **TTS Fallback** (`ttsFallbackService.ts`): ordem ElevenLabs → Google → OpenAI.
3. **Mixagem é 100% client-side** (Web Audio API). Edge functions só geram áudio bruto.
4. **Fade-out automático** de trilha musical: 1.0s após fim da locução (em `audioMixer.ts`).
5. **Export MP3** usa `@breezystack/lamejs` em chunks.
6. **Edge functions** com `verify_jwt = false` precisam ficar no `config.toml`.

## 📋 Checklist de migração

- [ ] Copiar arquivos do ZIP
- [ ] Instalar deps do `package.json`
- [ ] Criar projeto Supabase + rodar SQLs
- [ ] Atualizar `client.ts` com novas credenciais
- [ ] Configurar secrets das edge functions
- [ ] Fazer deploy das 11 edge functions
- [ ] Testar fluxo: roteiro → voz → mix → export

Boa migração! 🚀
