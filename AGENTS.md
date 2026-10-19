# 品香 Pinxiang project instructions

- This repository is `trandainho27-source/Pinxaing`, dedicated to the independent Pinxiang storefront and merchant console.
- The Chinese brand name is 品香. Use it consistently in customer pages, administration, exports, and emails. Keep the existing repository, domain, Worker/database identifiers and cryptographic contexts when correcting display text.
- Read README.md and docs/PRODUCT.md before changing scope. Product direction is single-store physical commerce; the user has explicitly superseded the original digital-goods assumption.
- Keep customer storefront free of administration links. Administration lives under `/admin` and all mutations require server-side authorization.
- Never commit environment secrets, inventory content, customer records or database exports. `.dev.vars.example` contains names only.
- Keep demo flows gated server-side by DEMO_MODE. Production defaults to false. Never label a mock payment as real.
- Money is integer minor units; prices come from the database. Physical stock reservation, fixed CNY 20 shipping and one encrypted Telegram gift per order must remain atomic and replay-safe. Payment confirmation must not mark an order shipped.
- Address and contact are optional. Customer shipping UI derives its state from the tracking number: empty/blank/无 means 未发货, a populated number means 已发货 and displays that number. WeChat, Alipay and USDT are intentionally disabled placeholders. Do not reactivate legacy payment or supplier routes.
- Gift accounts are reserved at creation but MUST NOT be decrypted or returned to customers until payment is confirmed server-side (paid status and paid_at evidence). Keep them hidden in creation/replay/lookup responses before payment. Keep assigned accounts bound to their order for legacy exposure safety; cancellation and expiry release only physical stock.
- Append schema migrations for deployed databases. Keep migrations schema-only; examples are seeded only in demo mode.
- For changes to transactions or permissions run npm test and npm run verify:worker after building; run npm run typecheck for TypeScript edits.
- Preserve Sites integration and existing project_id. The target Cloudflare deployment and private Sites environment use separate databases and secrets.
- Record real limitations honestly in docs/VALIDATION.md. Passing unit tests is not a production certification.
