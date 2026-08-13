# Persistência de áudio nos Projetos VIP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ao clicar "Salvar VIP" no Audio Pank Studio, o áudio de cada faixa vira permanente de verdade (sobe pro Supabase Storage como MP3), em vez do link `blob:` que morre ao fechar a aba — reabrir o projeto de qualquer lugar, dias depois, volta com som.

**Architecture:** Porta o padrão já validado na MiniDAW clássica (mesmo backend, `/api/projects` + `/api/client-deliveries/upload-url`) pro lado React. Novo módulo `projectStorage.ts` decide por faixa se precisa subir áudio ou pode reaproveitar o que já está persistente, evitando reupload desnecessário. Compressão pra MP3 128kbps (não WAV) reaproveitando funções já existentes da Masterização. Faxina do áudio órfão no Storage quando um projeto é excluído.

**Tech Stack:** TypeScript (upload/orquestração), reaproveita `@breezystack/lamejs` via `audioFile.js` (compressão MP3, já testado), Flask/Python (limpeza no delete), Supabase Storage (bucket `client-deliveries`, já existente).

**Spec:** `docs/superpowers/specs/2026-08-13-persistencia-audio-projetos-vip-design.md`

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `minidaw-react/src/lib/projectStorage.ts` (novo) | Decide e executa como tornar o áudio de UMA faixa permanente. Não sabe nada de UI. |
| `minidaw-react/src/components/VipProjects.tsx` (modificar) | `save()` chama o módulo acima antes de gravar o projeto; `openProject()` corrige o nome do campo do áudio ao ler de volta. |
| `backend/app.py` (modificar) | `delete_vip_project`: apaga do Storage os áudios que o projeto excluído tinha subido. |

**Por que um arquivo novo e não direto dentro de `VipProjects.tsx`:** a lógica de "pra cada faixa, decidir se reusa, referencia ou sobe" não tem nada de React/UI — é dado entrando, dado saindo. Mantém `VipProjects.tsx` focado em orquestrar o fluxo de salvar/abrir, e deixa essa peça testável/lida isoladamente (mesmo sem `node --test`, por ser I/O de rede/Blob que não roda fora do navegador).

**Sem testes automatizados nesta plan:** ao contrário de `loudness.js`/`gate.js` (matemática pura), este módulo depende de `fetch`, `Blob`, `AudioContext` — APIs de navegador que não existem em `node --test` sem polyfill pesado, e a spec já definiu que a verificação é manual (Task 4).

---

### Task 1: `garantirArmazenamentoPermanente` — decide e sobe o áudio de uma faixa

**Files:**
- Create: `minidaw-react/src/lib/projectStorage.ts`

- [ ] **Step 1: Escrever o arquivo**

```typescript
// minidaw-react/src/lib/projectStorage.ts
// Torna o áudio de uma faixa do Projeto VIP permanente antes de salvar.
// Sem isso, `track.audioUrl` costuma ser um link `blob:` — válido só na
// aba que o criou, morto assim que ela fecha. Reaproveita o mesmo backend
// já usado e validado pela MiniDAW clássica (/api/client-deliveries/upload-url,
// kind='projeto'), sem mudar nada nele.
import { decodificar, paraMp3 } from "./audioFile.js";

export interface FaixaComAudio {
  name?: string;
  audioUrl: string;
  audio_path?: string;
  audio_url_direct?: string;
}

export interface ArmazenamentoResolvido {
  audio_path?: string;
  audio_url_direct?: string;
}

// http(s) mas NÃO uma signed URL de leitura de 1h (essas expiram — salvar
// uma delas de novo criaria outro link morto, só que daqui a 1h em vez de
// já nascer morto). Mesmo teste usado em static/minidaw.js.
const URL_ESTAVEL = /^https?:/i;
const URL_TEMPORARIA = /\/object\/sign\/|token=/i;

async function uploadAudioProjeto(blob: Blob): Promise<string> {
  const filename = `faixa-${Date.now()}.mp3`;
  const ru = await fetch("/api/client-deliveries/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, kind: "projeto" }),
  });
  const u = await ru.json();
  if (!u.success) throw new Error(u.error || "Falha ao preparar o envio do áudio");

  const fd = new FormData();
  fd.append("file", blob, filename);
  const up = await fetch(u.upload_url, {
    method: "PUT",
    headers: { apikey: u.apikey, Authorization: `Bearer ${u.apikey}` },
    body: fd,
  });
  if (!up.ok) throw new Error("Falha ao enviar o áudio da faixa");
  return u.path as string;
}

/**
 * Decide o que fazer com o áudio de UMA faixa, em ordem (evita reupload à toa):
 *  1. Já tem `audio_path` de um load anterior (não trocou) -> reusa.
 *  2. Já tem `audio_url_direct` (ex.: trilha da Biblioteca) -> reusa.
 *  3. `audioUrl` já é http(s) estável (não é blob:, não é signed URL de 1h) -> vira audio_url_direct.
 *  4. Senão (blob: comum de voz gerada / upload local) -> baixa, recomprime pra MP3 128kbps, sobe.
 */
export async function garantirArmazenamentoPermanente(
  track: FaixaComAudio
): Promise<ArmazenamentoResolvido> {
  const nome = track.name || "sem nome";

  if (track.audio_path) return { audio_path: track.audio_path };
  if (track.audio_url_direct) return { audio_url_direct: track.audio_url_direct };

  const url = track.audioUrl || "";
  if (!url) throw new Error(`Faixa "${nome}" não tem áudio`);

  if (URL_ESTAVEL.test(url) && !URL_TEMPORARIA.test(url)) {
    return { audio_url_direct: url };
  }

  let blob: Blob;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    blob = await res.blob();
  } catch (e: any) {
    throw new Error(`Faixa "${nome}": falha ao ler o áudio (${e.message})`);
  }

  let mp3: Blob;
  try {
    const buffer = await decodificar(blob);
    mp3 = paraMp3(buffer, 128);
  } catch (e: any) {
    throw new Error(`Faixa "${nome}": falha ao comprimir o áudio (${e.message})`);
  }

  try {
    const path = await uploadAudioProjeto(mp3);
    return { audio_path: path };
  } catch (e: any) {
    throw new Error(`Faixa "${nome}": falha ao enviar o áudio (${e.message})`);
  }
}
```

- [ ] **Step 2: Checar TypeScript**

Run: `cd minidaw-react && npx tsc --noEmit -p . 2>&1 | grep -E "projectStorage|audioFile"`
Expected: nenhuma saída (sem erros). O projeto já roda com `strict: false` e tem erros pré-existentes em arquivos não relacionados — não é escopo desta task.

- [ ] **Step 3: Commit**

```bash
git add minidaw-react/src/lib/projectStorage.ts
git commit -m "feat(master): garantirArmazenamentoPermanente sobe audio da faixa pro Storage (MP3)"
```

---

### Task 2: `VipProjects.tsx` — usar o armazenamento permanente no save e corrigir o load

**Files:**
- Modify: `minidaw-react/src/components/VipProjects.tsx`

- [ ] **Step 1: Importar o módulo novo**

No topo do arquivo, trocar:
```typescript
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Star, X, FolderOpen, Trash2, Save, Loader2, Music2 } from "lucide-react";
import { useToast } from "@/hooks/useToast";
```
por:
```typescript
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Star, X, FolderOpen, Trash2, Save, Loader2, Music2 } from "lucide-react";
import { useToast } from "@/hooks/useToast";
import { garantirArmazenamentoPermanente } from "@/lib/projectStorage";
```

- [ ] **Step 2: `save()` sobe o áudio de cada faixa antes de gravar o projeto**

Trocar:
```typescript
  const save = async () => {
    if (!name.trim()) {
      toast({ title: "Nome obrigatório", description: "Dê um nome ao projeto VIP.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const snap = getCurrent();
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, ...snap }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Falha ao salvar");
      toast({ title: "⭐ Projeto VIP salvo!", description: name });
      setName("");
      setDescription("");
      refresh();
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };
```
por:
```typescript
  const save = async () => {
    if (!name.trim()) {
      toast({ title: "Nome obrigatório", description: "Dê um nome ao projeto VIP.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const snap = getCurrent();
      toast({ title: "Enviando áudio(s)...", description: "Preparando as faixas antes de salvar." });
      const tracks = await Promise.all(
        snap.tracks.map(async (t: any) => {
          const armazenamento = await garantirArmazenamentoPermanente(t);
          const { audioUrl, ...resto } = t;
          return { ...resto, ...armazenamento };
        })
      );
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, ...snap, tracks }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Falha ao salvar");
      toast({ title: "⭐ Projeto VIP salvo!", description: name });
      setName("");
      setDescription("");
      refresh();
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };
```

Note: `{ name, description, ...snap, tracks }` — o `tracks` no final SOBRESCREVE o `tracks` que já vinha dentro de `snap` (ordem importa em spread de objeto). Se qualquer faixa falhar dentro do `Promise.all`, a exceção sobe direto pro `catch` — nada é gravado (o POST nem chega a rodar).

- [ ] **Step 3: `openProject()` corrige o nome do campo do áudio**

Trocar:
```typescript
  const openProject = async (id: string) => {
    try {
      const res = await fetch(`/api/projects/${id}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Falha ao abrir");
      const p = data.project;
      onLoad({ projectId: p.projectId || "", roteiro: p.roteiro || "", tracks: p.tracks || [] });
      toast({ title: "Projeto aberto", description: p.name });
      onClose();
    } catch (e: any) {
      toast({ title: "Erro ao abrir", description: e.message, variant: "destructive" });
    }
  };
```
por:
```typescript
  const openProject = async (id: string) => {
    try {
      const res = await fetch(`/api/projects/${id}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Falha ao abrir");
      const p = data.project;
      // O backend devolve o link resolvido do áudio como `audio_url` (com
      // underscore, convenção da MiniDAW clássica); a React lê `audioUrl`.
      // Preserva `audio_path`/`audio_url_direct` (via ...t) -- é o que deixa
      // um PRÓXIMO save não reenviar áudio que não mudou.
      const tracks = (p.tracks || []).map((t: any) => ({ ...t, audioUrl: t.audio_url || t.audioUrl }));
      onLoad({ projectId: p.projectId || "", roteiro: p.roteiro || "", tracks });
      toast({ title: "Projeto aberto", description: p.name });
      onClose();
    } catch (e: any) {
      toast({ title: "Erro ao abrir", description: e.message, variant: "destructive" });
    }
  };
```

- [ ] **Step 4: Checar TypeScript**

Run: `cd minidaw-react && npx tsc --noEmit -p . 2>&1 | grep -E "VipProjects|projectStorage"`
Expected: nenhuma saída.

- [ ] **Step 5: Commit**

```bash
git add minidaw-react/src/components/VipProjects.tsx
git commit -m "feat(master): Salvar VIP sobe audio permanente, abrir projeto le audio_url certo"
```

---

### Task 3: Faxina do áudio órfão ao excluir um projeto

**Files:**
- Modify: `backend/app.py:9035-9046` (`delete_vip_project`)

- [ ] **Step 1: Ler as faixas antes de apagar a linha e limpar o Storage**

Trocar:
```python
@app.route('/api/projects/<project_id>', methods=['DELETE', 'OPTIONS'])
def delete_vip_project(project_id):
    if request.method == 'OPTIONS':
        return _vip_cors_preflight()
    try:
        if not supabase_manager or not supabase_manager.newpost_manager_client:
            return jsonify({'success': False, 'error': 'Supabase não configurado'}), 500
        supabase_manager.newpost_manager_client.table(MINIDAW_PROJECTS_TABLE) \
            .delete().eq('id', project_id).execute()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
```
por:
```python
@app.route('/api/projects/<project_id>', methods=['DELETE', 'OPTIONS'])
def delete_vip_project(project_id):
    if request.method == 'OPTIONS':
        return _vip_cors_preflight()
    try:
        if not supabase_manager or not supabase_manager.newpost_manager_client:
            return jsonify({'success': False, 'error': 'Supabase não configurado'}), 500

        # Faxina: apaga do Storage os áudios que ESTE projeto subiu (audio_path)
        # antes de apagar a linha. `audio_url_direct` nunca entra aqui -- é URL
        # pública/compartilhada (ex.: trilha da Biblioteca), não pertence só a
        # este projeto. Falha na faxina não impede a exclusão do projeto.
        try:
            r = supabase_manager.newpost_manager_client.table(MINIDAW_PROJECTS_TABLE) \
                .select('tracks').eq('id', project_id).limit(1).execute()
            if r.data:
                paths = [tr.get('audio_path') for tr in (r.data[0].get('tracks') or []) if tr.get('audio_path')]
                if paths:
                    supabase_manager.newpost_manager_client.storage \
                        .from_(CLIENT_DELIVERIES_BUCKET).remove(paths)
        except Exception as cleanup_err:
            print(f'[VIP] faxina de audio orfao falhou (nao bloqueia a exclusao): {cleanup_err}')

        supabase_manager.newpost_manager_client.table(MINIDAW_PROJECTS_TABLE) \
            .delete().eq('id', project_id).execute()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
```

`CLIENT_DELIVERIES_BUCKET` já existe como constante no topo do arquivo (`backend/app.py:1872`, `= 'client-deliveries'`) — não precisa declarar de novo.

- [ ] **Step 2: Checar que o Python compila**

Run: `python -m py_compile backend/app.py`
Expected: sem saída, sem erro (compila limpo).

- [ ] **Step 3: Commit**

```bash
git add backend/app.py
git commit -m "feat(master): exclusao de projeto VIP limpa o audio orfao no Storage"
```

---

### Task 4: Build e publicação

**Files:**
- Modify: `templates/minidaw-react.html`
- Modify: `static/minidaw-react/index.html`

⚠️ **A armadilha desta etapa:** o build da React é manual e os hashes vivem em DOIS arquivos. Atualizar só um entrega página velha em produção. Esta task também inclui a mudança do `backend/app.py` (Task 3) no mesmo push — o backend redeploya automaticamente junto.

- [ ] **Step 1: Rodar a suíte de testes existente (nenhuma nova nesta plan, mas confirma que nada quebrou)**

Run: `node --test tests/clip-model.test.mjs tests/mix-engine-clips.test.mjs tests/loudness.test.mjs tests/gate.test.mjs`
Expected: 0 falhas.

- [ ] **Step 2: Build**

```bash
cd minidaw-react && npm run build
```

- [ ] **Step 3: Copiar para static**

```bash
cp -r minidaw-react/dist/assets/* static/minidaw-react/assets/
```

Os arquivos antigos ficam para trás (o nome tem hash). Não apague no mesmo commit.

- [ ] **Step 4: Descobrir os nomes novos**

Run: `ls static/minidaw-react/assets/`
Anote o `index-XXXX.js` e o `index-XXXX.css` recém-criados.

- [ ] **Step 5: Atualizar os DOIS arquivos de hash**

Em `templates/minidaw-react.html` e em `static/minidaw-react/index.html`, substitua os nomes antigos de `index-*.js` e `index-*.css` pelos novos.

- [ ] **Step 6: Conferir que os dois batem**

Run: `grep -o "index-[A-Za-z0-9_-]*\.\(js\|css\)" templates/minidaw-react.html static/minidaw-react/index.html | sort -u`
Expected: exatamente dois nomes distintos (um .js e um .css), e ambos existem em `static/minidaw-react/assets/`.

- [ ] **Step 7: Commit e publicar**

```bash
git add static/minidaw-react templates/minidaw-react.html
git commit -m "build(master): publica a persistencia de audio nos Projetos VIP"
git push origin testes-local:main
```

- [ ] **Step 8: Confirmar que subiu**

Run: `git show origin/main:templates/minidaw-react.html | grep -o "index-[A-Za-z0-9_-]*\.js"`
Expected: o hash novo.

---

### Task 5: Verificação ponta a ponta (protocolo da spec)

Sem código. É o critério de sucesso da spec. Passo a passo:

1. No Audio Pank Studio, gerar uma voz (IA) e adicionar uma trilha da Biblioteca. Salvar como Projeto VIP com um nome novo de teste.
2. Consultar direto no Supabase (tabela `minidaw_projects`, projeto `ykswh`) a linha salva: confirmar que as faixas têm `audio_path` (a de voz) ou `audio_url_direct` (a de trilha) — **nenhuma deve ter `audioUrl` começando com `blob:`**.
3. Fechar a aba, abrir uma aba **nova** do navegador, ir em Projetos → Abrir esse projeto de teste. Confirmar que o áudio de AMBAS as faixas toca de verdade (não fica em 0:00/0:00).
4. Sem trocar nada, clicar "Salvar VIP" de novo (mesmo nome, para atualizar). Confirmar que a operação é rápida (não reenviou os áudios de novo — checar no log do navegador ou pela ausência de demora perceptível).
5. Excluir o projeto de teste pela lista de Projetos VIP. Consultar o bucket `client-deliveries/projetos/` no Supabase Storage e confirmar que o(s) arquivo(s) MP3 que esse projeto tinha subido não estão mais lá.

Só reportar como concluído depois desse teste real, não só pelo TypeScript/Python compilando limpo.
