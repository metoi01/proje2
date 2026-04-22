# End-to-End Automation Tests

Bu klasor proje dokumanindaki cross-platform automation beklentilerini karsilar.

## Required Files

- `mobile.appium.mjs`
  - Dokumanda istenen `10` Appium mobile automation senaryosunu tek suite icinde calistirir.
  - Kapsam:
    - Survey Loading
    - Question Rendering
    - Conditional Visibility
    - DAG Path Validation
    - Recursive Logic Execution
    - Answer Persistence
    - Send Button Activation
    - Back Navigation Logic
    - Invalid State Prevention
    - End-to-End Survey Completion

- `sync-conflict.mjs`
  - Dokumanda ozel olarak istenen synchronized Selenium + Appium testidir.
  - Mobile client mid-session iken Web Architect tarafinda logic degisimi yapilir ve rollback/conflict davranisi dogrulanir.

## Supporting Files

- `web-architect.selenium.mjs`
  - Web Architect tarafinin otomasyon dogrulamalari.
- `_appium-client.mjs`
  - Kucuk Appium client helper'i.
- `_harness.mjs`
  - Backend/web server startup helper'i.
- `cross-platform-consistency.mjs`
  - Ek consistency senaryosu; zorunlu testlere destekleyici niteliktedir.
