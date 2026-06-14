PriceOCR diff package
Generated: 2026-06-14 13:38
Base commit: origin/main = 88defa1 (after pull, conflicts resolved)

Highlights since previous diff:
  - next.config.ts: migrate experimental.serverComponentsExternalPackages
    to top-level serverExternalPackages (Next.js 16 compatibility, no functional change).

Full feature list (same as PriceOCR_diff_20260614_1248.zip plus the next.config fix):
  1) Mapping page - new "no compare" option in dropdown.
  2) Effective rules - self-alias shown as a separate "no compare" card.
  3) Compare board - hide products marked "no compare", filter placeholder price <= 1.
  4) Import page - alert when OCR price differs from server last price by > 20;
     market quick switch (express/guanghuo) added in the data console header.
  5) next.config.ts: deprecated config key migration.

Usage: extract this zip into the repo root and overwrite existing files.
No package.json/lock or prisma schema changes.

Included files:
  - next.config.ts
  - src/actions/get-dashboard-data.ts
  - src/actions/get-latest-prices.ts
  - src/actions/mapping.ts
  - src/app/import/page.tsx
  - src/app/mapping/page.tsx
  - src/components/dashboard-client.tsx
  - src/lib/mapping-constants.ts
