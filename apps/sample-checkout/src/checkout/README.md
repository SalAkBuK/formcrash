# Bundled sample checkout

This application is FormCrash Lab's independent local system under test. It does
not import from or require the dashboard or control server.

## Deterministic modes

- `http://localhost:4200/?mode=vulnerable` intentionally accepts every valid
  request and creates an order for each rapid trigger.
- `http://localhost:4200/?mode=fixed` immediately guards the UI and uses the
  checkout-attempt key as a server idempotency key.

An absent or invalid mode resolves to the safe `fixed` mode. Invalid values also
produce a visible notice. Only `vulnerable` and `fixed` reach server behavior.

## Sample data and lifecycle

The cart always contains one Resilience Mug (`$18.00`) and one Retry Notebook
(`$12.50`). Customer and address inputs are fictional test data. The application
does not request or store payment, password, bank, or government-identifier data.

Orders, request attempts, fixed-mode results, and in-flight operations live in one
`globalThis` process-local store. Restarting the sample-checkout process resets
that store. Resetting through the UI or API also clears orders, attempts, fixed
idempotency results, and safely invalidates outstanding operations.

## Local API

### `POST /api/orders`

The JSON body contains:

- `mode`: `vulnerable` or `fixed`.
- `checkoutAttemptKey`: a non-empty attempt/idempotency key.
- `contact`: fake `name` and valid `email`.
- `shipping`: `addressLine1`, `city`, `region`, and `postalCode`.
- `products`: known product IDs and integer quantities from 1 through 10.

Product names, unit prices, line totals, and subtotal are calculated from the
server catalogue. Browser-supplied price or total fields are ignored. New orders
return `201`; fixed-mode repeats return the original order with `200`; validation
errors return structured `400` responses without stack traces.

### Test-support endpoints

- `GET /api/test-support/state` returns separate order and request-attempt arrays
  plus accepted, deduplicated, rejected, request, and order counts.
- `POST /api/test-support/reset` clears all process-local sample state.

These endpoints intentionally make the bundled test target observable and
repeatable. They are not a production API pattern and must not be copied into a
real checkout.

## Why fixed mode protects twice

The fixed React interface uses a synchronous ref before its rendered loading state
can update, then disables Submit Order and shows an honest processing state. That
protects ordinary users, but requests can bypass a browser interface. The server
therefore independently keeps completed idempotency results and shares one
in-flight creation promise for concurrent requests with the same key. Every
request is still recorded: the first is `accepted`, and repeats are
`deduplicated`.

Vulnerable mode deliberately uses neither protection. It leaves Submit Order
available while requests are in flight and the store creates a distinct order for
every valid request, even when attempt keys match.

## Stable `data-formcrash` selector contract

Presentation changes must preserve these semantic values:

```text
checkout-ready
cart
cart-next
contact-step
contact-email
contact-name
contact-next
shipping-step
shipping-address-line-1
shipping-city
shipping-region
shipping-postal-code
shipping-next
review-step
submit-order
submission-status
confirmation-step
confirmation-order-id
order-records
order-record
request-attempts
request-attempt
reset-sample
mode-indicator
```

The selector contract has an automated source-usage test. `checkout-ready` is
attached only after React hydration, and the runner waits for it before the first
interaction. Generated order and attempt IDs are content, never selector names.

## Manual vulnerable verification

1. Open `/?mode=vulnerable` and select **Reset sample data**.
2. Complete contact and shipping using fake values.
3. On Review, activate **Submit Order** rapidly at least twice.
4. Observe at least two `accepted` request attempts and two distinct order records
   in the evidence panel.

## Manual fixed verification

1. Open `/?mode=fixed` and reset sample data.
2. Complete the same checkout and rapidly attempt to activate **Submit Order**.
3. Observe immediate processing/disabled behavior and one confirmation/order.
4. Independently verify server idempotency from PowerShell with one repeated key:

```powershell
$body = @{
  mode = 'fixed'
  checkoutAttemptKey = 'manual-fixed-proof'
  contact = @{ name = 'Ava Example'; email = 'ava@example.test' }
  shipping = @{
    addressLine1 = '42 Test Lane'
    city = 'Demo City'
    region = 'Test Region'
    postalCode = '00042'
  }
  products = @(
    @{ productId = 'resilience-mug'; quantity = 1 },
    @{ productId = 'retry-notebook'; quantity = 1 }
  )
} | ConvertTo-Json -Depth 5

1..2 | ForEach-Object {
  Invoke-RestMethod -Method Post -Uri http://localhost:4200/api/orders `
    -ContentType 'application/json' -Body $body
}
Invoke-RestMethod http://localhost:4200/api/test-support/state
```

Both responses identify the same order; state shows two attempts and one order.
Automated tests additionally prove the truly concurrent `Promise.all` case.

## Intentionally deferred

Playwright, visible-Chromium control, saved journey replay, FormCrash assertions,
run persistence, SSE, screenshots, results, comparisons, and reports belong to
later roadmap chunks.
