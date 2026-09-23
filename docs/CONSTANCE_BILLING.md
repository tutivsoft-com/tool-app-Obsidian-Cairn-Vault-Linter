# Cairn Constance billing integration

Status: current account-linked integration, release 3.4.14.

Cairn is a backend-less Obsidian plugin. It therefore uses the current
authenticated client flow at `https://app.tutivsoft.com`, not the signed
server-to-server callback pattern.

## Active request flow

- `POST /api/v1/auth/login` or `/auth/register` creates a billing session.
- `POST /api/v1/billing/installations/link` links the stable random
  `installation_id` (`app_id: cairn-vault-linter`, platform `obsidian`).
- `GET /api/v1/billing/entitlements/me` is the authoritative balance and
  entitlement poll. Expired access tokens are renewed through `/auth/refresh`.
- `POST /api/v1/billing/free-usage/claim` consumes the server-authoritative
  daily free allowance with a persisted stable event ID; an unknown claim is
  retried before a new claim is created.
- `POST /api/v1/billing/credits/spend` spends one paid repair credit with a
  persisted stable event ID. Unknown responses are retried with that same ID;
  Cairn never invents a replacement event ID.
- `POST /api/v1/billing/checkout` receives `{app_id, plan_code,
  installation_id, quantity, coupon_code}` and an `Idempotency-Key`. The
  current live pack codes are `one_time` ($1/100) and `standard` ($10/1,000).
- `GET /api/v1/billing/checkouts/{checkout_id}` is polled after checkout opens;
  a settled checkout triggers another entitlement poll. Payment webhooks remain
  authoritative on the central service.

## Contract applicability

- `app_id` is fixed to `cairn-vault-linter` and the installation ID is random,
  persistent, and not hardware-derived.
- HMAC `X-Tutiv-*` request headers, child-app entitlement callbacks, raw-body
  callback verification, and callback deduplication are not applicable because
  Cairn has no backend or callback URL. Cairn does not hold a shared secret.
- There is no recurring subscription interval. Paddle price IDs are verified
  only for the Contract v9 `/buy` compatibility fallback; current authenticated
  checkout resolves the server-owned plan code and does not trust a client
  price ID.
- The legacy `/buy` URL is used only when an older central returns 404/405 for
  authenticated checkout. Current transaction errors do not fall back, which
  prevents duplicate purchases and preserves idempotency.

Constance has no free-usage claim refund endpoint. Cairn validates the repair plan and prepares the rollback journal before claiming, but a later vault write failure can still consume a free use.

The plugin persists billing session state, pending free-usage/spend IDs, and
pending checkout idempotency keys in Obsidian plugin settings. Passwords and
shared secrets are never stored.
