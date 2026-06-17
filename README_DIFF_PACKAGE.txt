PriceOCR diff package
Generated: 2026-06-14 14:18
Base commit: origin/main = a0ae6e9 (after pull, conflicts resolved)

=== IMPORTANT: post-extract steps ===
After overwriting files into the repo root, run on target machine:
  1) npx prisma db push        # apply Issue table to local sqlite
  2) npx prisma generate       # regenerate Prisma Client
  3) restart dev / production server

=== Highlights ===
  + Issue feedback module
      - prisma/schema.prisma:  added Issue model
      - src/actions/issues.ts: createIssue / listIssues / resolveIssue / reopenIssue / confirmIssueDone
      - src/components/feedback-fab.tsx: floating "feedback" button with image upload
      - src/app/issues/{page,board-client}.tsx: TAPD-style two-column board
      - dashboard top-bar / mobile menu now has "issue board" entry
      - public/issue-uploads/: per-issue subdir for uploaded images, auto-cleaned on confirm

Usage: extract this zip into the repo root and overwrite existing files.
No package.json/lock changes.

Included files:
  - prisma/schema.prisma
  - src/actions/issues.ts
  - src/app/issues/page.tsx
  - src/app/issues/board-client.tsx
  - src/app/layout.tsx
  - src/components/dashboard-client.tsx
  - src/components/feedback-fab.tsx
  - public/issue-uploads/.keep
