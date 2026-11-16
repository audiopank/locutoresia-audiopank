# Pacotes de créditos — plano (16/11/2026, aprovado: "PODE CONSTRUIR")

1 crédito = 1 spot pronto até 45 s (60–90 s = 2). Pacotes na Kiwify: 5=R$350, 10=R$550,
Agência 25=R$950, Emissora 50=R$1.650. Cliente nunca entra no app.

## Dados (sem SQL)
`app_config` chave `creditos` = `{"movimentos": [...]}`; movimento =
`{id, quando, nome, email, whatsapp, delta, valor, motivo, ref}`.
Saldo de um cliente = soma dos `delta` cujo e-mail bate (minúsculo) OU os últimos 8
dígitos do telefone batem — a mesma regra que o webhook já usa pra pedidos.

## Tarefas
1. `backend/app.py`: `PACOTES_CREDITOS` (4 pacotes + links), funções puras
   `creditos_do_produto(nome)`, `mesmo_cliente(...)`, `saldo_creditos(movs, email, tel)`,
   `resumo_creditos(movs)`, `creditos_do_plano(plano)`.
2. Webhook Kiwify: produto com "Pacote" no nome → soma créditos (dedup por order_id) e
   NUNCA toca em `pedidos`. Avulso segue igual.
3. API interna: `GET /api/creditos` (clientes, vendidos no mês, saldo por pedido, pedidos
   pagos com crédito), `POST /api/creditos/ajuste` (à mão, ±), `POST /api/pedidos/<id>/usar-credito`
   (1 ou 2 créditos; recusa jingle/outro, saldo curto, pedido já pago, débito repetido).
4. `/entregas-clientes`: saldo no cartão do pedido, botão "Pagar com crédito", badge
   "Pago com crédito", Recebimentos do mês não conta esses; quadro "🎟️ Créditos".
5. `/vitrine`: seção "Pacotes de créditos" (Jinja, de `PACOTES_CREDITOS`), ⭐ no de 10.
6. Testes: tests/test_pacotes_creditos.py (funções, webhook com Supabase falso, rotas, vitrine).

Fora: vencimento automático de 12 meses; cliente consultar saldo sozinho.
