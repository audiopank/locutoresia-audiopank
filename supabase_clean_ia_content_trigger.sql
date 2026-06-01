-- ============================================================================
-- NewPost-IA — Limpeza automática de conteúdo de posts de IA/agentes
-- ----------------------------------------------------------------------------
-- O QUE FAZ: a cada INSERT/UPDATE em public.posts, SE o post for is_ia_generated,
--   limpa a coluna "content":
--     • remove HTML cru (<img>, <br>, <p>, <a>, ...) preservando parágrafos
--     • decodifica entidades comuns (&amp; &nbsp; &quot; ...)
--     • remove a linha de fonte DUPLICADA ("... Fonte: https://..."),
--       já que o feed mostra source_url como link separado
--     • normaliza espaços/linhas em excesso
--
-- SEGURANÇA: só age em posts com is_ia_generated = true.
--   Posts de usuários humanos NÃO são afetados. Os agentes do Telegram
--   continuam postando normalmente — o banco limpa sozinho.
--
-- COMO USAR (no Supabase → SQL Editor):
--   PASSO 1: rode a SEÇÃO 1 (DRY-RUN) e confira o "depois". Nada é alterado.
--   PASSO 2: se gostou do resultado, rode a SEÇÃO 2 (cria a função + trigger).
--   PASSO 3 (opcional): rode a SEÇÃO 3 pra limpar os posts ANTIGOS já existentes.
-- ============================================================================


-- ============================================================================
-- SEÇÃO 0 — Função de limpeza (necessária para o dry-run e para o trigger)
-- ============================================================================
create or replace function public.np_clean_content(c text)
returns text
language plpgsql
immutable
as $$
begin
  if c is null or c = '' then
    return c;
  end if;

  -- 1) <br>, </p>, </div>, </li>, </h1..6> -> quebra de linha (preserva parágrafos)
  c := regexp_replace(c, '<\s*br\s*/?\s*>', E'\n', 'gi');
  c := regexp_replace(c, '<\s*/\s*(p|div|li|h[1-6])\s*>', E'\n', 'gi');

  -- 2) remove TODAS as demais tags HTML (inclui <img ...>, <a ...>)
  c := regexp_replace(c, '<[^>]+>', '', 'g');

  -- 3) decodifica entidades HTML mais comuns
  c := replace(c, '&nbsp;', ' ');
  c := replace(c, '&amp;',  '&');
  c := replace(c, '&quot;', '"');
  c := replace(c, '&#39;',  '''');
  c := replace(c, '&apos;', '''');
  c := replace(c, '&lt;',   '<');
  c := replace(c, '&gt;',   '>');

  -- 4) remove a linha de fonte DUPLICADA: qualquer linha com "Fonte:" seguida de URL
  --    (mantém créditos sem URL, ex.: "Fonte: Notícias Gerais")
  c := regexp_replace(c, '(^|\n)[^\n]*Fonte:[ \t]*https?://[^\n]*', '\1', 'gi');

  -- 5) normaliza espaços e quebras de linha em excesso
  c := regexp_replace(c, '[ \t]+', ' ', 'g');
  c := regexp_replace(c, '\n[ \t]+', E'\n', 'g');
  c := regexp_replace(c, '\n{3,}', E'\n\n', 'g');
  c := btrim(c);

  return c;
end;
$$;


-- ============================================================================
-- SEÇÃO 1 — DRY-RUN (NÃO altera nada). Veja o antes/depois.
--   Lista posts de IA cujo conteúdo MUDARIA com a limpeza.
-- ============================================================================
select
  id,
  left(content, 160)               as antes,
  left(np_clean_content(content), 160) as depois
from public.posts
where coalesce(is_ia_generated, false) = true
  and content is distinct from np_clean_content(content)
order by created_at desc
limit 30;


-- ============================================================================
-- SEÇÃO 2 — Cria o TRIGGER (rode só depois de aprovar o dry-run)
-- ============================================================================
create or replace function public.trg_clean_ia_post_content()
returns trigger
language plpgsql
as $$
begin
  -- só limpa posts gerados por IA/agentes; humanos passam intactos
  if coalesce(NEW.is_ia_generated, false) is distinct from true then
    return NEW;
  end if;
  NEW.content := public.np_clean_content(NEW.content);
  return NEW;
end;
$$;

drop trigger if exists clean_ia_post_content on public.posts;
create trigger clean_ia_post_content
  before insert or update of content on public.posts
  for each row
  execute function public.trg_clean_ia_post_content();


-- ============================================================================
-- SEÇÃO 3 — (OPCIONAL) Backfill: limpa os posts de IA já existentes.
--   Só atualiza os que realmente mudam. Posts humanos não são tocados.
-- ============================================================================
-- update public.posts
-- set content = np_clean_content(content)
-- where coalesce(is_ia_generated, false) = true
--   and content is distinct from np_clean_content(content);
