# Pinxiang project instructions

- This repository is `trandainho27-source/Pinxaing`, dedicated to the independent Pinxiang storefront and merchant console.
- Read README.md and docs/PRODUCT.md before changing scope. Product direction is currently single-store digital commerce.
- Keep customer storefront free of administration links. Administration lives under `/admin` and all mutations require server-side authorization.
- Never commit environment secrets, inventory content, customer records or database exports. `.dev.vars.example` contains names only.
- Keep demo flows gated server-side by DEMO_MODE. Production defaults to false. Never label a mock payment as real.
- Money is integer minor units; prices come from the database. Inventory reservation and fulfillment must remain atomic and replay-safe.
- Append schema migrations for deployed databases. Keep migrations schema-only; examples are seeded only in demo mode.
- For changes to transactions or permissions run npm test and npm run verify:worker after building; run npm run typecheck for TypeScript edits.
- Preserve Sites integration and existing project_id. The target Cloudflare deployment and private Sites environment use separate databases and secrets.
- Record real limitations honestly in docs/VALIDATION.md. Passing unit tests is not a production certification.
