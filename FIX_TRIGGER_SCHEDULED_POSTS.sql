-- FIX_TRIGGER_SCHEDULED_POSTS.sql
-- Rodar no SQL Editor do projeto Supabase "ykswhzqdjoshjoaruhqs".
--
-- CONTEXTO (diagnosticado em 20/07/2026)
-- A função public.trigger_scheduled_posts() é chamada pelo pg_cron (job 14, */1 * * * *)
-- e nunca publicou nada desde que existe. Tinha três defeitos:
--
--   1. INSERT INTO public.posts (..., user_id, ...) — a tabela 'posts' NÃO tem a coluna
--      'user_id'; tem 'author_id'. Todo insert levantava exceção.
--   2. EXCEPTION WHEN OTHERS THEN UPDATE ... SET status='cancelled' — sem log, sem
--      mensagem. O post agendado virava 'cancelled' e o motivo se perdia. Foi isso que
--      escondeu o defeito 1 por meses.
--   3. v_agora_brasilia era declarada TIMESTAMP WITH TIME ZONE mas recebia
--      NOW() AT TIME ZONE 'America/Sao_Paulo' (que devolve timestamp SEM tz), sendo
--      reconvertida pelo fuso do servidor -> resultado 3h deslocado, gravado em
--      created_at/updated_at do post.
--
-- Estado encontrado: app_scheduled_posts tinha 2 registros, ambos 'cancelled', ambos
-- posts de teste. Nenhum conteúdo real foi perdido.
--
-- ATENÇÃO: nada neste repositório escreve em app_scheduled_posts. Esta função é o
-- consumidor; o produtor (tela/endpoint de agendamento) ainda não existe.

-- 1. Guardar o motivo da falha em vez de descartá-lo
ALTER TABLE public.app_scheduled_posts ADD COLUMN IF NOT EXISTS error_message text;

-- 2. Permitir o status 'failed' (substitui o CHECK atual, qualquer que seja o nome)
DO $$
DECLARE c_name text;
BEGIN
  SELECT conname INTO c_name FROM pg_constraint
   WHERE conrelid = 'public.app_scheduled_posts'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%status%';
  IF c_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.app_scheduled_posts DROP CONSTRAINT %I', c_name);
  END IF;
END $$;

ALTER TABLE public.app_scheduled_posts
  ADD CONSTRAINT app_scheduled_posts_status_check
  CHECK (status IN ('scheduled','published','failed','cancelled'));

-- 3. A função corrigida
DROP FUNCTION IF EXISTS public.trigger_scheduled_posts();

CREATE FUNCTION public.trigger_scheduled_posts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post         RECORD;
  v_posted_count INTEGER := 0;
  v_agora        TIMESTAMPTZ := now();   -- timestamptz puro: sem dupla conversão
  v_erro         TEXT;
BEGIN
  FOR v_post IN
    SELECT id, title, content, image_url, owner_id
      FROM public.app_scheduled_posts
     WHERE scheduled_at <= v_agora
       AND status = 'scheduled'
     ORDER BY scheduled_at ASC
  LOOP
    BEGIN
      INSERT INTO public.posts
        (title, content, image_url, author_id, created_at, updated_at, status)
      VALUES
        (v_post.title, v_post.content, v_post.image_url, v_post.owner_id,
         v_agora, v_agora, 'published');

      UPDATE public.app_scheduled_posts
         SET status = 'published', updated_at = v_agora, error_message = NULL
       WHERE id = v_post.id;

      v_posted_count := v_posted_count + 1;

    EXCEPTION WHEN OTHERS THEN
      -- Preserva o erro: coluna error_message + WARNING nos logs do Postgres.
      GET STACKED DIAGNOSTICS v_erro = MESSAGE_TEXT;
      RAISE WARNING 'trigger_scheduled_posts: post % falhou -> %', v_post.id, v_erro;
      UPDATE public.app_scheduled_posts
         SET status = 'failed', updated_at = v_agora, error_message = v_erro
       WHERE id = v_post.id;
    END;
  END LOOP;

  RETURN v_posted_count;
END;
$$;

-- 4. TESTE — ressuscita um dos posts de teste e deixa o cron pegar (até 1 minuto)
-- UPDATE public.app_scheduled_posts
--    SET status = 'scheduled', scheduled_at = now() - interval '1 minute', error_message = NULL
--  WHERE title LIKE '%TESTE DE TIMEZONE%';
--
-- Conferir depois:
-- SELECT id, title, status, error_message, updated_at FROM public.app_scheduled_posts;
