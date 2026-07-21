-- ALTER_CLIENT_DELIVERIES_ADD_FINAL.sql
-- Rodar no SQL Editor do projeto Supabase "ykswhzqdjoshjoaruhqs".
--
-- CONTEXTO
-- O fluxo do estúdio é: gera a locução -> manda uma PRÉVIA COM CARIMBO ("este é um
-- exemplo de spot gerado por IA") pro cliente ouvir -> cliente aprova e paga ->
-- estúdio entrega o arquivo DEFINITIVO sem carimbo.
--
-- Até agora a tabela tinha um `storage_path` só, então a entrega do definitivo
-- acontecia FORA do sistema (manualmente pelo WhatsApp, depois do pagamento).
--
-- `final_path` guarda o arquivo limpo. A página de aprovação só libera o download
-- dele quando o pedido correspondente está com `pago = true` — e a checagem é
-- SERVER-SIDE: sem pagamento, a signed URL nem chega a ser gerada.
--
-- Não confundir com `amostra_path`, que já existia e é OUTRA coisa: a amostra de
-- voz que o CLIENTE anexa ao pedir um ajuste.

ALTER TABLE public.client_deliveries
  ADD COLUMN IF NOT EXISTS final_path text;

COMMENT ON COLUMN public.client_deliveries.storage_path IS
  'Prévia que o cliente ouve na página de aprovação (normalmente com carimbo de IA).';
COMMENT ON COLUMN public.client_deliveries.final_path IS
  'Arquivo definitivo sem carimbo. Só liberado para download quando pedidos.pago = true.';
COMMENT ON COLUMN public.client_deliveries.amostra_path IS
  'Amostra de voz enviada pelo CLIENTE ao pedir ajuste (referência de estilo).';

-- Conferir:
-- SELECT id, client_name, storage_path IS NOT NULL AS tem_previa,
--        final_path IS NOT NULL AS tem_final, status
--   FROM public.client_deliveries ORDER BY created_at DESC LIMIT 10;
