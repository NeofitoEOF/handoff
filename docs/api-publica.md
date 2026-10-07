# API pública e webhooks

## API keys

Somente o Admin da Empresa cria e revoga API keys.

Criação:

`POST /v1/admin/api-keys`

A resposta contém o token apenas uma vez. O banco armazena somente SHA-256.

Exemplo de uso:

```http
Authorization: Bearer hnd_<tenant-uuid>_<segredo>
```

Escopo inicial:

- `requests:read`

Endpoints públicos:

- `GET /v1/public-api/requests`
- `GET /v1/public-api/requests/:id`

As consultas continuam passando pelo contexto RLS do tenant derivado da API key.

## Webhooks

Eventos iniciais:

- `request.approved`
- `request.overdue`

Cadastro:

`POST /v1/admin/webhooks`

O segredo de assinatura é devolvido apenas na criação e fica cifrado em repouso.

O destino deve usar HTTPS público. Endereços localhost e faixas privadas literais
são rejeitados.

## Payload

```json
{
  "id": "uuid-do-evento",
  "type": "request.approved",
  "createdAt": "2026-10-07T12:00:00.000Z",
  "data": {
    "requestId": "uuid",
    "status": "APPROVED"
  }
}
```

## Assinatura

Headers enviados:

- `X-Handoff-Event`
- `X-Handoff-Event-Id`
- `X-Handoff-Timestamp`
- `X-Handoff-Signature`

A assinatura é:

```text
HMAC-SHA256(secret, timestamp + "." + rawBody)
```

O header usa:

```text
X-Handoff-Signature: sha256=<hex>
```

O consumidor deve:

1. rejeitar timestamp antigo (recomendado: mais de 5 minutos);
2. calcular HMAC sobre o corpo **exatamente como recebido**;
3. comparar a assinatura em tempo constante;
4. guardar `X-Handoff-Event-Id` para idempotência.

## Retry

Falhas HTTP/non-2xx entram novamente no outbox.

- máximo: 8 tentativas;
- backoff exponencial limitado;
- entrega é **at-least-once**;
- consumidores devem ser idempotentes.

A combinação tenant + webhook + dedupe key impede criação duplicada do mesmo
evento lógico no outbox.
