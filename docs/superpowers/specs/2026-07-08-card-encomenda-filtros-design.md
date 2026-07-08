# Card de Encomenda no Painel de Filtros — Design

## Contexto e problema

Na home (`templates/index.html`), a coluna de Filtros (`col-lg-3`) contém apenas 3 dropdowns (Gênero, Idioma, Estilo) + botões "Buscar"/"Limpar Filtros". Essa coluna é bem mais curta que a coluna de conteúdo ao lado (`col-lg-9`, com o Editor de Roteiro/Gerar Locução e a grade de cards de locutores). Como as duas colunas ficam na mesma `.row` (flex, `align-items: stretch` por padrão do Bootstrap), a coluna de Filtros estica até a altura da coluna de conteúdo, deixando um espaço vazio grande abaixo do botão "Limpar Filtros" — espaço morto que fica visível o tempo todo enquanto o usuário rola a página vendo os cards de locutores.

## Objetivo

Preencher esse espaço com um card de chamada comercial para o serviço de **"Atendimento Personalizado" / encomenda** (a Áudio Pank Produtora cria a locução do zero para quem não quer mexer na plataforma) — reaproveitando o conteúdo já validado no system prompt do VoxCraft AI (`VOXCRAFT_SYSTEM_PROMPT` em `backend/app.py`), sem construir nenhuma feature nova de backend.

## Escopo

- Mudança é **100% frontend**, só em `templates/index.html` (HTML + CSS + um pequeno trecho de JS/link, se necessário).
- A nova paleta de cores (verde-escuro/marfim/amarelo) se aplica **apenas ao novo card**. O restante do painel de Filtros (dropdowns, botões "Buscar"/"Limpar Filtros") mantém o tema atual (roxo/indigo `#6366f1` sobre slate escuro `#1e293b`).
- Fora de escopo: qualquer alteração no VoxCraft AI, no backend, ou em outras páginas.

## Localização e estrutura

O card é inserido dentro da coluna `col-lg-3`, como um bloco **separado** logo abaixo do `.filter-panel` existente (não uma cor de fundo dentro do painel — um card com identidade visual própria: cantos arredondados, padding, fundo distinto).

```html
<div class="col-lg-3">
    <div class="filters-sticky-wrapper">
        <div class="filter-panel">
            <!-- conteúdo atual: Gênero, Idioma, Estilo, Buscar, Limpar Filtros -->
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

`.filters-sticky-wrapper` é o novo elemento que recebe `position: sticky` — ele envolve tanto o `.filter-panel` existente quanto o novo `.encomenda-cta`, para que os dois acompanhem o scroll juntos como um bloco só.

## Comportamento de scroll (sticky)

- `.filters-sticky-wrapper { position: sticky; top: 20px; }`
- Não há header fixo no desktop nesta página (o `.mobile-header` só existe em telas pequenas, `display: none` acima do breakpoint mobile), então `top: 20px` é suficiente — não precisa descontar altura de barra fixa.
- Em telas mobile/tablet onde o layout já colapsa para coluna única (breakpoint existente do Bootstrap, `col-lg-3`/`col-lg-9` viram full-width empilhados), o sticky **não deve se aplicar** — nesse caso o painel de filtros já fica no fluxo normal da página. Resolver com media query: `@media (max-width: 991.98px) { .filters-sticky-wrapper { position: static; } }` (breakpoint `lg` do Bootstrap é 992px).

## Conteúdo (copy)

- **Título:** "Não quer mexer em nada?"
- **Texto:** "Nossa equipe cria sua locução do zero — roteiro, voz e áudio pronto pra usar, direto no seu WhatsApp."
- **Botão:** "Falar no WhatsApp" com ícone `fab fa-whatsapp` (o projeto já carrega o Font Awesome 6.4.0 completo via CDN em `templates/index.html:16`, que inclui os ícones de marca — confirmado, sem necessidade de alternativa)

## Visual (cores)

Variáveis CSS novas, escopadas ao componente (não sobrescrevem `--primary-color`/`--card-bg` globais):

```css
.encomenda-cta {
    background: #1B4332; /* verde-escuro */
    color: #F5F0DC;       /* marfim */
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
    background: #F2C94C; /* amarelo */
    color: #1B4332;       /* verde-escuro (texto do botão, contraste) */
    font-weight: 600;
    border-radius: 8px;
    padding: 10px 16px;
    text-decoration: none;
    width: 100%;
    justify-content: center;
}

.encomenda-cta-btn:hover {
    background: #E6BE45;
    color: #1B4332;
}
```

Cores exatas são ajustáveis após ver o resultado ao vivo no navegador (o usuário pode pedir ajuste fino de tom sem mudar o design).

## Ação do botão

Link direto `https://wa.me/5585992262297?text=...` com mensagem pré-preenchida, abrindo em nova aba (`target="_blank"`). Não depende de nenhuma rota de backend, do VoxCraft AI, nem de JS adicional além do link em si — é um `<a href>` simples.

## Verificação

- Teste manual no navegador (dev local): conferir que o card aparece preenchendo o espaço vazio abaixo de "Limpar Filtros", que as cores batem com o especificado, que o botão abre o WhatsApp com a mensagem certa.
- Testar o comportamento sticky: rolar a página com muitos cards de locutores visíveis e confirmar que o painel (filtros + card) acompanha o scroll até o fim da coluna de conteúdo, sem sobrepor o rodapé/footer da página.
- Testar responsivo: reduzir a largura da janela abaixo de 992px e confirmar que o sticky é desativado e o layout empilha normalmente (sem quebrar o `.encomenda-cta` visualmente).
