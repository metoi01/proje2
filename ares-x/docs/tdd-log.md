# ARES-X TDD Log

## Red
- Added shared GBCR/RCLR tests for valid DAGs, cycle rejection, send-button gating, hidden-answer clearing, atomic recovery, and rollback after deletion.
- Added backend API tests for Project 1 seeded login, publish version increments, and incompatible schema sync rollback.
- Added Android unit tests for Kotlin RCLR visibility parity, send enablement, and hidden answer clearing.

## Green
- Implemented TypeScript `validateDag`, `resolveVisibility`, `resolveSyncConflict`, schema hashing, and answer sanitization.
- Implemented Express endpoints for login, survey CRUD, publish, schema fetch, sessions, answer sync, reset, edge mutation, and node deletion.
- Implemented Kotlin `RclrEngine` with the same DAG traversal, visibility, blocking, stable-node, and hidden-answer behavior.

## Refactor
- Split Appium automation into a tiny W3C WebDriver client to avoid Selenium browser assumptions.
- Added an explicit removed-visible-path check so concurrent schema deletion is flagged as `RCLR_ROLLBACK` even when the deleted node has not yet been answered.
- Kept UI selectors stable with content descriptions and `data-testid` attributes.

## Verification Commands Run
- `npm test`
- `npm run typecheck`
- `npm run build:web`
- Android `clean testDebugUnitTest`
- Android `assembleDebug`
- `npm run test:e2e:web`
- `npm run test:e2e:mobile`
- `npm run test:e2e:sync`
