# Variações de Roteiro (ScriptPanel) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar ao editor de roteiros a geração de **3 variações** de um texto pronto, com ângulos diferentes (emocional, racional, urgência, curiosidade), para o produtor escolher a mais forte.

**Architecture:** Novo endpoint Flask `/api/gemini/variations` chamando o Gemini 2.5 Flash **direto** (`google.genai`), espelhando os endpoints existentes `/api/gemini/script` e `/api/gemini/improve`. No frontend React, o `ScriptPanel` ganha um botão "Gerar Variações" que exibe as 3 opções em cards clicáveis; clicar joga a variação no editor.

**Tech Stack:** Flask 2.3 / Python 3.12, `google.genai` (Gemini 2.5 Flash), React + Vite + Tailwind (minidaw-react), shadcn/ui.

**Decisões fechadas:**
- **3 variações fixas** (count fixo no backend; sem expor seletor ao usuário, pra não confundir).
- Reaproveitar o padrão dos endpoints irmãos: chave via `GEMINI_API_KEY`/`GOOGLE_AI_STUDIO_API_KEY`, handler de `OPTIONS`/CORS idêntico, model `gemini-2.5-flash`.
- **NÃO** usar o Lovable AI Gateway da Edge Function original — chamada Gemini direta como o resto do app.
- O projeto não tem suíte pytest; a verificação segue o padrão do repo (script `test_*.py` na raiz + curl manual).

---

## Estrutura de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `backend/app.py` | Modificar (inserir após a função `gemini_generate_script`, ~linha 5308) | Novo endpoint `/api/gemini/variations` + helper de parsing do array |
| `test_gemini_variations.py` | Criar (raiz) | Teste do parser e smoke test do endpoint (padrão dos `test_*.py` existentes) |
| `minidaw-react/src/components/ScriptPanel.tsx` | Modificar | Botão "Gerar Variações" + estado + cards clicáveis |
| `templates/minidaw-react.html` e `static/minidaw-react/index.html` | Modificar (hashes dos assets) | Apontar para o novo bundle após `vite build` |

---

## Task 1: Helper de parsing das variações (backend, puro)

A resposta do Gemini pode vir como array JSON ou como lista numerada. Isolar a extração num helper puro torna possível testá-la sem chamar a API.

**Files:**
- Modify: `backend/app.py` (inserir o helper logo acima do bloco `# Gemini API Routes for Script Editor`, ~linha 5217)
- Test: `test_gemini_variations.py` (criar na raiz)

- [ ] **Step 1: Escrever o teste do parser (deve falhar)**

Criar `test_gemini_variations.py`:

```python
"""Testes do parser de variações de roteiro (sem chamar a API)."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

from app import _parse_variations


def test_parse_json_array():
    raw = '["Texto A", "Texto B", "Texto C"]'
    assert _parse_variations(raw, 3) == ["Texto A", "Texto B", "Texto C"]


def test_parse_json_array_com_lixo_em_volta():
    raw = 'Aqui estão:\n```json\n["Um", "Dois", "Tres"]\n```\nEspero que ajude!'
    assert _parse_variations(raw, 3) == ["Um", "Dois", "Tres"]


def test_parse_fallback_lista_numerada():
    raw = "1. Primeira opcao do texto\n2. Segunda opcao do texto\n3. Terceira opcao do texto"
    out = _parse_variations(raw, 3)
    assert out == ["Primeira opcao do texto", "Segunda opcao do texto", "Terceira opcao do texto"]


def test_parse_corta_no_count():
    raw = '["A muito longa aqui", "B muito longa aqui", "C muito longa aqui", "D muito longa aqui"]'
    assert len(_parse_variations(raw, 3)) == 3


if __name__ == "__main__":
    test_parse_json_array()
    test_parse_json_array_com_lixo_em_volta()
    test_parse_fallback_lista_numerada()
    test_parse_corta_no_count()
    print("OK: todos os testes do parser passaram")
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `python test_gemini_variations.py`
Expected: FAIL com `ImportError: cannot import name '_parse_variations'`

- [ ] **Step 3: Implementar o helper `_parse_variations`**

Em `backend/app.py`, inserir imediatamente antes do comentário `# Gemini API Routes for Script Editor` (~linha 5217):

```python
def _parse_variations(content: str, count: int) -> list:
    """Extrai uma lista de variações de texto da resposta do Gemini.

    Tenta primeiro um array JSON em qualquer ponto do texto; se não houver,
    cai num fallback que quebra por linhas (lista numerada/marcadores).
    Sempre devolve no máximo `count` itens não vazios.
    """
    import json, re

    content = content or ""
    variations = []

    match = re.search(r"\[[\s\S]*\]", content)
    if match:
        try:
            parsed = json.loads(match.group(0))
            variations = [str(v).strip() for v in parsed if str(v).strip()]
        except (ValueError, TypeError):
            variations = []

    if not variations:
        for line in content.split("\n"):
            line = line.strip()
            if not line or line.startswith("#") or line.startswith("`"):
                continue
            # remove prefixos tipo "1.", "1)", "- ", "* " e aspas externas
            line = re.sub(r'^[\d]+[\.\)]\s*', "", line)
            line = re.sub(r'^[\-\*]\s*', "", line)
            line = line.strip().strip('"').strip("'").strip()
            if len(line) > 10:
                variations.append(line)

    return variations[:count]
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `python test_gemini_variations.py`
Expected: `OK: todos os testes do parser passaram`

- [ ] **Step 5: Commit**

```bash
git add test_gemini_variations.py backend/app.py
git commit -m "feat(roteiro): helper _parse_variations para extrair variacoes do Gemini"
```

---

## Task 2: Endpoint `/api/gemini/variations`

**Files:**
- Modify: `backend/app.py` (inserir após o fim da função `gemini_generate_script`, logo depois da ~linha 5308)

- [ ] **Step 1: Implementar o endpoint**

Em `backend/app.py`, inserir logo após o `return` final / bloco `except` da função `gemini_generate_script` (~linha 5308):

```python
@app.route('/api/gemini/variations', methods=['POST', 'OPTIONS'])
def gemini_generate_variations():
    """Gera 3 variações de um roteiro com ângulos diferentes (emocional,
    racional, urgência, curiosidade) usando o Gemini."""
    if request.method == 'OPTIONS':
        response = make_response()
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        return response

    try:
        data = request.get_json() or {}
        text = (data.get('text') or '').strip()
        if not text:
            return jsonify({"success": False, "error": "Dados inválidos: 'text' é obrigatório"}), 400

        count = 3  # fixo: 3 variações para não sobrecarregar o usuário

        api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_AI_STUDIO_API_KEY")
        if not api_key:
            return jsonify({"success": False, "error": "API Key do Gemini não configurada"}), 500

        from google import genai

        client = genai.Client(api_key=api_key)
        model_name = 'gemini-2.5-flash'

        prompt = (
            "Você é um redator publicitário especializado em roteiros de locução em português do Brasil.\n"
            f"Crie {count} variações diferentes do texto abaixo. Cada variação deve:\n"
            "- Manter a mensagem e as informações principais (telefones, nomes, ofertas)\n"
            "- Usar uma abordagem diferente entre si (emocional, racional, urgência, curiosidade)\n"
            "- Ter tamanho similar ao original e soar natural para ser narrada\n\n"
            "Responda APENAS com um array JSON de strings, sem comentários, no formato:\n"
            '["variação 1", "variação 2", "variação 3"]\n\n'
            f'Texto original:\n"{text}"'
        )

        response = client.models.generate_content(model=model_name, contents=prompt)
        variations = _parse_variations(response.text or '', count)

        if not variations:
            return jsonify({"success": False, "error": "Não foi possível gerar variações"}), 502

        return jsonify({"success": True, "variations": variations})

    except Exception as e:
        print(f"[GEMINI variations] ERRO: {e}")
        import traceback
        print(traceback.format_exc())
        return jsonify({"success": False, "error": str(e)}), 500
```

- [ ] **Step 2: Subir o servidor local**

Run: `python start_simple.py` (em outro terminal; deixar rodando)
Expected: servidor sobe em `http://localhost:5000` (ou porta configurada) sem erro de import.

- [ ] **Step 3: Smoke test do endpoint via curl**

Run:
```bash
curl -s -X POST http://localhost:5000/api/gemini/variations \
  -H "Content-Type: application/json" \
  -d '{"text":"Pizzaria do Ze: toda terca pizza grande pela metade do preco. Pe a sua pelo zap."}'
```
Expected: JSON `{"success": true, "variations": ["...", "...", "..."]}` com 3 itens. (Requer `GEMINI_API_KEY` no `.env`; se ausente, espera-se `{"success": false, "error": "API Key do Gemini não configurada"}` — que também valida o caminho de erro.)

- [ ] **Step 4: Teste de validação (texto vazio)**

Run:
```bash
curl -s -X POST http://localhost:5000/api/gemini/variations \
  -H "Content-Type: application/json" -d '{"text":""}'
```
Expected: HTTP 400 com `{"success": false, "error": "Dados inválidos: 'text' é obrigatório"}`

- [ ] **Step 5: Commit**

```bash
git add backend/app.py
git commit -m "feat(roteiro): endpoint /api/gemini/variations (3 variacoes via Gemini)"
```

---

## Task 3: Botão "Gerar Variações" + cards no ScriptPanel

**Files:**
- Modify: `minidaw-react/src/components/ScriptPanel.tsx`

O componente já tem `value`, `onChange`, `isGenerating`, e o `useToast`. Vamos adicionar estado para as variações e para o loading próprio do botão (não reusar `isGenerating`, que é do "Gerar Roteiro").

- [ ] **Step 1: Adicionar estado e a função `generateVariations`**

Em `ScriptPanel.tsx`, dentro do componente, logo após a linha `const [isGenerating, setIsGenerating] = useState(false);` (linha 23), inserir:

```tsx
  const [variations, setVariations] = useState<string[]>([]);
  const [isVarying, setIsVarying] = useState(false);

  const generateVariations = async () => {
    if (!value.trim()) {
      toast({ title: "Escreva o roteiro primeiro", description: "Preciso de um texto base para gerar variações.", variant: "destructive" });
      return;
    }
    setIsVarying(true);
    try {
      const res = await fetch("/api/gemini/variations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: value }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Falha ao gerar variações");
      setVariations(data.variations || []);
      toast({ title: "Variações geradas!", description: "Clique na que você preferir para usá-la." });
    } catch (e: any) {
      toast({ title: "Erro ao gerar variações", description: e.message || "Tente novamente", variant: "destructive" });
    } finally {
      setIsVarying(false);
    }
  };

  const pickVariation = (v: string) => {
    onChange(v);
    setVariations([]);
    toast({ title: "Variação aplicada", description: "Texto atualizado no editor." });
  };
```

- [ ] **Step 2: Adicionar o ícone `Copy` ao import do lucide-react**

Em `ScriptPanel.tsx` linha 6, trocar:

```tsx
import { FileText, Wand2, Loader2, Mic } from "lucide-react";
```

por:

```tsx
import { FileText, Wand2, Loader2, Mic, Copy } from "lucide-react";
```

- [ ] **Step 3: Adicionar o botão "Gerar Variações" e a lista de cards**

Em `ScriptPanel.tsx`, logo após o bloco do contador de caracteres (a `<div>` que termina em `{value.length} caracteres</div>`, linha 95) e antes da `<div className="flex justify-end">` do botão "Enviar para Gerar Voz" (linha 98), inserir:

```tsx
        {/* Variações de roteiro */}
        <div className="space-y-3">
          <Button
            type="button"
            variant="outline"
            onClick={generateVariations}
            disabled={isVarying || !value.trim()}
            className="gap-2 border-white/20 bg-white/5 text-white hover:bg-white/10"
          >
            {isVarying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />}
            Gerar Variações
          </Button>

          {variations.length > 0 && (
            <div className="grid gap-2">
              {variations.map((v, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => pickVariation(v)}
                  className="text-left rounded-md border border-white/15 bg-white/5 p-3 text-sm text-white/90 hover:border-purple-400 hover:bg-white/10 transition-colors"
                >
                  <span className="block text-xs font-semibold text-purple-300 mb-1">Variação {i + 1}</span>
                  {v}
                </button>
              ))}
            </div>
          )}
        </div>
```

- [ ] **Step 4: Verificar o build do React (dev)**

Run: `cd minidaw-react && npm run build`
Expected: build conclui sem erro de TypeScript; gera `minidaw-react/dist/assets/index-<hash>.js` e `.css` com **novos hashes**.

- [ ] **Step 5: Commit (código-fonte React)**

```bash
git add minidaw-react/src/components/ScriptPanel.tsx
git commit -m "feat(roteiro): botao Gerar Variacoes com cards clicaveis no ScriptPanel"
```

---

## Task 4: Publicar o build do MiniDAW React

O build do React é manual (ver memória `project_minidaw_react_build`): copiar `dist/assets` para `static/minidaw-react/assets` e atualizar os hashes nos dois HTML.

**Files:**
- Modify: `static/minidaw-react/` (assets copiados)
- Modify: `templates/minidaw-react.html` (linhas 7-8)
- Modify: `static/minidaw-react/index.html` (linhas 8-9)

- [ ] **Step 1: Copiar os assets do build para static**

Run (PowerShell):
```powershell
Copy-Item -Recurse -Force minidaw-react/dist/* static/minidaw-react/
```
Expected: novos `static/minidaw-react/assets/index-<novohash>.js` e `.css` presentes.

- [ ] **Step 2: Descobrir os novos hashes**

Run:
```bash
ls static/minidaw-react/assets/
```
Expected: anotar os nomes exatos `index-<hash>.js` e `index-<hash>.css` gerados no Step 1.

- [ ] **Step 3: Atualizar os hashes em `templates/minidaw-react.html`**

Nas linhas 7-8, substituir `index-a33bc944.js` e `index-7259c2a6.css` pelos novos hashes anotados no Step 2. (Se o `vite build` do Step 1 da Task 4 sobrescreveu o próprio `static/minidaw-react/index.html`, ele já pode trazer os hashes certos — conferir.)

- [ ] **Step 4: Atualizar os hashes em `static/minidaw-react/index.html`**

Nas linhas 8-9, garantir que apontam para os mesmos novos hashes do Step 3.

- [ ] **Step 5: Verificação manual no navegador**

Run: `python start_simple.py` e abrir `http://localhost:5000/minidaw-react`
Expected (checklist):
1. Painel "Roteiro com IA" aparece com o botão **"Gerar Variações"**.
2. Com um texto no editor, clicar em "Gerar Variações" mostra **3 cards** "Variação 1/2/3".
3. Clicar num card **substitui o texto do editor** pela variação e some com os cards.
4. Sem texto no editor, o botão fica desabilitado.

- [ ] **Step 6: Commit do build publicado**

```bash
git add static/minidaw-react/ templates/minidaw-react.html
git commit -m "build(minidaw-react): publica bundle com Gerar Variacoes"
```

---

## Self-Review (preenchido pelo autor do plano)

- **Spec coverage:** endpoint `/api/gemini/variations` (Task 2) ✓; 3 variações fixas (count=3 no backend) ✓; ângulos emocional/racional/urgência/curiosidade (prompt da Task 2) ✓; Gemini direto, sem Lovable (Task 2) ✓; botão + cards clicáveis que jogam no editor (Task 3) ✓; publicação do build (Task 4) ✓.
- **Placeholder scan:** sem TBD/TODO; todo código mostrado por extenso.
- **Type consistency:** `_parse_variations(content, count)` definido na Task 1 e chamado igual na Task 2; `variations`/`isVarying`/`pickVariation` consistentes na Task 3.
- **Realidade do repo:** sem pytest formal — teste roda via `python test_gemini_variations.py` (padrão dos `test_*.py` existentes); build React manual conforme memória `project_minidaw_react_build`.
