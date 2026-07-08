# Card de Encomenda no Painel de Filtros — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preencher o espaço vazio abaixo do painel de Filtros na home (`templates/index.html`) com um card de CTA para o serviço de encomenda/atendimento personalizado, com link direto pro WhatsApp, e tornar o painel de Filtros inteiro sticky no scroll (desktop).

**Architecture:** Mudança 100% frontend em um único arquivo (`templates/index.html`): novo wrapper `.filters-sticky-wrapper` envolve o `.filter-panel` existente + um novo bloco `.encomenda-cta`; CSS novo escopado a essas duas classes; nenhuma rota de backend, nenhum JS de estado é necessário (o botão é um link `<a href>` puro).

**Tech Stack:** Jinja2 template estático + CSS (Bootstrap 5 grid já em uso) + Font Awesome 6.4.0 (já carregado, `fab fa-whatsapp` disponível).

---

## Contexto para quem for implementar

- `templates/index.html` é a home do Locutores IA. A seção relevante ("Content Area") tem uma `.row` do Bootstrap com duas colunas: `col-lg-3` (painel de Filtros) e `col-lg-9` (Editor de Roteiro + grade de cards de locutores).
- Bootstrap `.row` é `display:flex` com `align-items:stretch` por padrão — por isso a coluna `col-lg-3` (curta, só 3 dropdowns + 2 botões) estica até a altura da `col-lg-9` (bem mais alta), deixando um espaço vazio visível.
- O breakpoint `lg` do Bootstrap 5 é `992px`: abaixo disso, `col-lg-3`/`col-lg-9` empilham em largura total (uma embaixo da outra). O sticky **não pode** se aplicar nesse caso, senão o painel gruda esquisito no topo de um layout empilhado.
- Não existe header fixo no desktop nesta página (`.mobile-header` só é `display:flex` abaixo do breakpoint mobile) — então um `position: sticky; top: 20px;` simples não precisa descontar altura de nenhuma barra.
- Spec completa (com justificativas de cada decisão de design, aprovada pelo usuário): `docs/superpowers/specs/2026-07-08-card-encomenda-filtros-design.md`.
- Como rodar localmente pra testar visualmente: `python start_simple.py` (sobe Flask em `http://localhost:5000/`, debug ativo). A home é a rota `/`.

---

## Task 1: Envolver o `.filter-panel` num wrapper sticky e adicionar o card de Encomenda (HTML)

**Files:**
- Modify: `templates/index.html:801-842`

Hoje o bloco é:

```html
                    <!-- Filter Panel -->
                    <div class="col-lg-3">
                        <div class="filter-panel">
                            <h5><i class="fas fa-filter"></i>Filtros</h5>
                            
                            <div class="mb-3">
                                <label class="form-label">Gênero</label>
                                <select class="form-select" id="genderFilter">
                                    <option value="">Todos</option>
                                    <option value="male">Masculino</option>
                                    <option value="female">Feminino</option>
                                </select>
                            </div>
                            
                            <div class="mb-3">
                                <label class="form-label">Idioma</label>
                                <select class="form-select" id="languageFilter">
                                    <option value="">Todos</option>
                                    <option value="pt-BR">Português (BR)</option>
                                    <option value="en-US">Inglês (EUA)</option>
                                    <option value="es-ES">Espanhol</option>
                                </select>
                            </div>
                            
                            <div class="mb-3">
                                <label class="form-label">Estilo</label>
                                <select class="form-select" id="styleFilter">
                                    <option value="">Todos</option>
                                    <option value="professional">Profissional</option>
                                    <option value="friendly">Amigável</option>
                                    <option value="energetic">Enérgico</option>
                                </select>
                            </div>
                            
                            <button class="btn btn-generate w-100 mb-2">
                                <i class="fas fa-search me-2"></i>Buscar
                            </button>
                            
                            <button class="btn btn-outline-light w-100" id="clearFilters">
                                <i class="fas fa-redo me-2"></i>Limpar Filtros
                            </button>
                        </div>
                    </div>
```

- [ ] **Step 1: Substituir o bloco inteiro acima por este** (adiciona o wrapper sticky e o card, sem alterar nada dentro do `.filter-panel`):

```html
                    <!-- Filter Panel -->
                    <div class="col-lg-3">
                        <div class="filters-sticky-wrapper">
                            <div class="filter-panel">
                                <h5><i class="fas fa-filter"></i>Filtros</h5>

                                <div class="mb-3">
                                    <label class="form-label">Gênero</label>
                                    <select class="form-select" id="genderFilter">
                                        <option value="">Todos</option>
                                        <option value="male">Masculino</option>
                                        <option value="female">Feminino</option>
                                    </select>
                                </div>

                                <div class="mb-3">
                                    <label class="form-label">Idioma</label>
                                    <select class="form-select" id="languageFilter">
                                        <option value="">Todos</option>
                                        <option value="pt-BR">Português (BR)</option>
                                        <option value="en-US">Inglês (EUA)</option>
                                        <option value="es-ES">Espanhol</option>
                                    </select>
                                </div>

                                <div class="mb-3">
                                    <label class="form-label">Estilo</label>
                                    <select class="form-select" id="styleFilter">
                                        <option value="">Todos</option>
                                        <option value="professional">Profissional</option>
                                        <option value="friendly">Amigável</option>
                                        <option value="energetic">Enérgico</option>
                                    </select>
                                </div>

                                <button class="btn btn-generate w-100 mb-2">
                                    <i class="fas fa-search me-2"></i>Buscar
                                </button>

                                <button class="btn btn-outline-light w-100" id="clearFilters">
                                    <i class="fas fa-redo me-2"></i>Limpar Filtros
                                </button>
                            </div>

                            <div class="encomenda-cta">
                                <h6 class="encomenda-cta-title">Não quer mexer em nada?</h6>
                                <p class="encomenda-cta-text">
                                    Nossa equipe cria sua locução do zero — roteiro, voz e áudio
                                    pronto pra usar, direto no seu WhatsApp.
                                </p>
                                <a href="https://wa.me/5585992262297?text=Ol%C3%A1!%20Quero%20encomendar%20uma%20locu%C3%A7%C3%A3o%20personalizada."
                                   target="_blank" rel="noopener" class="encomenda-cta-btn">
                                    <i class="fab fa-whatsapp"></i> Falar no WhatsApp
                                </a>
                            </div>
                        </div>
                    </div>
```

- [ ] **Step 2: Salvar o arquivo.** Não há teste automatizado para template Jinja estático neste projeto — a verificação é visual (Task 3).

- [ ] **Step 3: Commit**

```bash
git add templates/index.html
git commit -m "feat(home): adiciona card de Encomenda no painel de Filtros"
```

---

## Task 2: CSS do wrapper sticky e do card de Encomenda

**Files:**
- Modify: `templates/index.html:287-304` (logo após as regras existentes de `.filter-panel`, antes de `.voice-card`)

Hoje, logo depois de `.filter-panel h5 i { ... }` (linha 304), vem `.voice-card { ... }` (linha 306). Vamos inserir as novas regras entre as duas.

- [ ] **Step 1: Inserir o CSS abaixo** logo após o bloco `.filter-panel h5 i { margin-right: 10px; color: var(--primary-color); }` e antes de `.voice-card {`:

```css
        .filters-sticky-wrapper {
            position: sticky;
            top: 20px;
        }

        .encomenda-cta {
            background: #1B4332;
            color: #F5F0DC;
            border-radius: 16px;
            padding: 24px;
            margin-top: 16px;
        }

        .encomenda-cta-title {
            color: #F5F0DC;
            font-weight: 600;
            margin-bottom: 10px;
        }

        .encomenda-cta-text {
            color: #F5F0DC;
            opacity: 0.9;
            font-size: 0.9rem;
            margin-bottom: 16px;
        }

        .encomenda-cta-btn {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: #F2C94C;
            color: #1B4332;
            font-weight: 600;
            border-radius: 8px;
            padding: 10px 16px;
            text-decoration: none;
            width: 100%;
            justify-content: center;
            transition: background 0.2s ease;
        }

        .encomenda-cta-btn:hover {
            background: #E6BE45;
            color: #1B4332;
        }

        @media (max-width: 991.98px) {
            .filters-sticky-wrapper {
                position: static;
            }
        }
```

O resultado deve ficar assim (trecho completo, para conferência):

```css
        .filter-panel h5 i {
            margin-right: 10px;
            color: var(--primary-color);
        }

        .filters-sticky-wrapper {
            position: sticky;
            top: 20px;
        }

        .encomenda-cta {
            background: #1B4332;
            color: #F5F0DC;
            border-radius: 16px;
            padding: 24px;
            margin-top: 16px;
        }

        .encomenda-cta-title {
            color: #F5F0DC;
            font-weight: 600;
            margin-bottom: 10px;
        }

        .encomenda-cta-text {
            color: #F5F0DC;
            opacity: 0.9;
            font-size: 0.9rem;
            margin-bottom: 16px;
        }

        .encomenda-cta-btn {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: #F2C94C;
            color: #1B4332;
            font-weight: 600;
            border-radius: 8px;
            padding: 10px 16px;
            text-decoration: none;
            width: 100%;
            justify-content: center;
            transition: background 0.2s ease;
        }

        .encomenda-cta-btn:hover {
            background: #E6BE45;
            color: #1B4332;
        }

        @media (max-width: 991.98px) {
            .filters-sticky-wrapper {
                position: static;
            }
        }

        .voice-card {
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 16px;
            padding: 24px;
            margin-bottom: 24px;
```

- [ ] **Step 2: Salvar o arquivo.**

- [ ] **Step 3: Commit**

```bash
git add templates/index.html
git commit -m "style(home): sticky no painel de Filtros e cores do card de Encomenda"
```

---

## Task 3: Verificação visual manual

**Files:** nenhum (apenas verificação, sem alterar código)

- [ ] **Step 1: Subir o servidor local**

```bash
python start_simple.py
```

Esperado no terminal: `✓ Flask imported successfully`, `✓ App imported successfully`, e o servidor escutando em `http://localhost:5000/`.

- [ ] **Step 2: Abrir `http://localhost:5000/` no navegador e checar o card**

Checklist visual:
- O espaço abaixo do botão "Limpar Filtros" agora mostra o card verde-escuro (`#1B4332`) com o título "Não quer mexer em nada?", texto em marfim e botão amarelo "Falar no WhatsApp".
- O restante do painel de Filtros (título "Filtros", dropdowns Gênero/Idioma/Estilo, botões "Buscar"/"Limpar Filtros") continua com a aparência atual (roxo/slate) — **sem** mudança de cor.

- [ ] **Step 3: Testar o link do WhatsApp**

Clicar em "Falar no WhatsApp" e confirmar que abre `https://wa.me/5585992262297` numa nova aba, com a mensagem "Olá! Quero encomendar uma locução personalizada." pré-preenchida (ou a tela de instalação do WhatsApp Web, se não estiver logado — isso é esperado e não é bug).

- [ ] **Step 4: Testar o comportamento sticky**

Com a janela do navegador larga (acima de 992px), rolar a página para baixo pela lista de cards de locutores. Esperado: o painel de Filtros (incluindo o card de Encomenda) acompanha o scroll, ficando fixo a ~20px do topo, sem sobrepor o rodapé da página ao chegar no fim do conteúdo.

- [ ] **Step 5: Testar o breakpoint responsivo**

Redimensionar a janela do navegador (ou usar o modo responsivo das DevTools) para uma largura abaixo de 992px. Esperado: o painel de Filtros passa a ficar em largura total, empilhado acima da área de conteúdo (comportamento padrão do Bootstrap), e **não** fica mais sticky — rola normalmente junto com o resto da página.

- [ ] **Step 6: Encerrar o servidor local**

Parar o processo do `python start_simple.py` (Ctrl+C no terminal, ou finalizar o processo em background).

Nenhum commit nesta task — é só verificação. Se algum item do checklist falhar, corrigir na Task 1 ou 2 correspondente e repetir a verificação.

---

## Self-review (cobertura da spec)

- Escopo (só o novo card, resto do `.filter-panel` intacto) → Task 1 mantém o HTML interno do `.filter-panel` idêntico; Task 2 só adiciona classes novas, não toca `--primary-color`/`--card-bg`. ✅
- Localização (bloco separado dentro de `col-lg-3`, abaixo do `.filter-panel`) → Task 1. ✅
- Sticky no painel inteiro + desativação abaixo de 992px → Task 2 (`.filters-sticky-wrapper` + media query). ✅
- Copy do card (título, texto, botão) → Task 1. ✅
- Cores exatas (fundo, texto, botão, hover) → Task 2. ✅
- Ação do botão (link wa.me com mensagem, nova aba) → Task 1. ✅
- Verificação (aparência, sticky, responsivo, link) → Task 3. ✅
