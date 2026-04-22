# ARES-X Verification Test Coverage Table

Bu tablo rapora direkt alinabilecek sekilde 10 Appium mobile automation testi ve 1 adet ozel Sync-Conflict testini ozetler.

| Test Name | Purpose | Tool | Scenario | Expected Result |
| --- | --- | --- | --- | --- |
| Survey Loading Test | Mobil istemcinin survey semasini backend'den dogru cekmesini dogrulamak | Appium | Kullanici login olur, survey listesinden `customer-feedback` secilir | `Schema v1` gorunur ve survey ekrani acilir |
| Question Rendering Test | Rating, multiple-choice ve open-ended soru tiplerinin dogru render edilmesini dogrulamak | Appium | Mobile branch secilir ve rating sorusu cevaplanir | `q-mobile-rating`, `q-mobile-pain`, `q-final` UI'da gorunur |
| Conditional Visibility Test | Verilen cevaba gore dogru child question'in gorunmesini test etmek | Appium | `q-channel=mobile` secilir | `q-mobile-rating` gorunur, web branch gorunmez |
| DAG Path Validation Test | Survey path'inin tekrarsiz ve DAG mantigina uygun olmasini kontrol etmek | Appium | Mobile branch rating verildikten sonra visible path okunur | Path `q-channel -> q-mobile-rating -> q-mobile-pain -> q-final` olur ve tekrar eden node bulunmaz |
| Recursive Logic Execution Test | Birden fazla conditional edge oldugunda recursive path hesaplamasini dogrulamak | Appium | Rating cevabi sonrasi downstream sorular acilir | Path hem `q-mobile-pain` hem `q-final` dugumlerine ilerler |
| Answer Persistence Test | Session icinde secilen cevabin rerender sonrasi korunmasini dogrulamak | Appium | `q-mobile-pain-sync` secilir ve ekran yeniden render edilir | Checkbox secimi korunur (`checked=true`) |
| Send Button Activation Test | Survey tamamlanmadan Send butonunun aktif olmamasini, tamamlaninca aktif olmasini test etmek | Appium | Mobile branch secildikten sonra rating once bos, sonra dolu hale getirilir | Rating oncesi Send pasif, rating sonrasi aktif olur |
| Back Navigation Logic Test | Kullanici onceki cevabi degistirdiginde logic'in yeniden hesaplanmasini test etmek | Appium | Kullanici mobile branch'ten web branch'e doner | `q-web-rating` gorunur, mobile path gizlenir, Send yeniden pasif olur |
| Invalid State Prevention Test | Undefined UI state veya orphan question olusmasini engellemek | Appium | Backend schema'dan `q-mobile-rating` silinir, client mobile branch'e doner | Sistem `RCLR_ROLLBACK` / conflict uretir; `undefined` veya `zombie` path olusmaz |
| End-to-End Survey Completion Test | Survey baslatma, cevaplama ve gonderme akisinin uc uca calismasini dogrulamak | Appium | Kullanici mobile path'i doldurur ve `Send`e basar | Survey gonderme aksiyonu hatasiz tetiklenir |
| Sync-Conflict Test | Survey doldurulurken backend logic degisince sistemin stabil kalmasini dogrulamak | Selenium + Appium | Mobile user cevap verirken Web Architect tarafinda schema degisimi yapilir | Mobile client crash olmaz; conflict detect eder veya stable node'a rollback yapar |

## Verified Commands

```bash
npm test
/Users/mertokhan/.gradle/wrapper/dists/gradle-8.9-all/6m0mbzute7p0zdleavqlib88a/gradle-8.9/bin/gradle -p mobile testDebugUnitTest --no-daemon
npm run test:e2e:web
APPIUM_SERVER_URL=http://127.0.0.1:4723 APPIUM_DEVICE_NAME=ARES_X_API_35 node tests/e2e/mobile.appium.mjs
APPIUM_SERVER_URL=http://127.0.0.1:4723 APPIUM_DEVICE_NAME=ARES_X_API_35 node tests/e2e/sync-conflict.mjs
```
