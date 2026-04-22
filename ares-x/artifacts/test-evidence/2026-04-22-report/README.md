# Test Evidence Index

Bu klasor 2026-04-22 tarihinde tekrar calistirilan verification kosularinin log ve ekran goruntulerini tutar.

## Terminal Output Evidence

| Command | Raw Log | Screenshot |
| --- | --- | --- |
| Vitest shared/backend unit tests | `logs/vitest.log` | `terminal-shots/vitest.png` |
| Android Kotlin unit tests | `logs/android-unit.log` | `terminal-shots/android-unit.png` |
| Selenium Web Architect automation | `logs/selenium-web.log` | `terminal-shots/selenium-web.png` |
| Appium mobile automation suite | `logs/appium-mobile.log` | `terminal-shots/appium-mobile.png` |
| Selenium + Appium sync-conflict automation | `logs/sync-conflict.log` | `terminal-shots/sync-conflict.png` |

## Appium Mobile Screenshots

Kayit dosyasi: `mobile-appium/evidence-map.json`

1. `mobile-appium/01-survey-loading.png` - Survey Loading Test
2. `mobile-appium/02-conditional-visibility.png` - Conditional Visibility Test
3. `mobile-appium/03-question-rendering.png` - Question Rendering Test
4. `mobile-appium/04-dag-path-validation.png` - DAG Path Validation Test
5. `mobile-appium/05-recursive-logic.png` - Recursive Logic Execution Test
6. `mobile-appium/06-answer-persistence.png` - Answer Persistence Test
7. `mobile-appium/07-send-button-activation.png` - Send Button Activation Test
8. `mobile-appium/08-end-to-end-completion.png` - End-to-End Survey Completion Test
9. `mobile-appium/09-back-navigation-logic.png` - Back Navigation Logic Test
10. `mobile-appium/10-invalid-state-prevention.png` - Invalid State Prevention Test

## Sync-Conflict Screenshots

Kayit dosyasi: `sync-conflict/evidence-map.json`

- `sync-conflict/01-web-before-mutation.png`
- `sync-conflict/02-mobile-before-conflict.png`
- `sync-conflict/03-mobile-after-conflict.png`
- `sync-conflict/04-web-after-mutation.png`
