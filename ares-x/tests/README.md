# Tests Directory

Bu klasor proje tesliminde beklenen test kodlarinin ana giris noktasidir.

## Folder Layout

- `tests/unit/`
  - TypeScript tabanli unit/integration testleri.
  - GBCR/RCLR shared logic ve backend API dogrulamalari burada tutulur.
- `tests/e2e/`
  - Cross-platform automation testleri.
  - Dokumandaki zorunlu `10 Appium mobile test case` ve `1 Selenium + Appium sync-conflict` testi burada bulunur.

## Important Note

Native Android unit testleri Android proje konvansiyonu geregi `mobile/app/src/test/` altinda tutulur. Bu testler de teslimata dahildir, fakat Android toolchain standardina uymasi icin `tests/` klasoru disinda yer alir.
