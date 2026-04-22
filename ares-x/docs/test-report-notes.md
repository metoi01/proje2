# ARES-X Test Report Notes

Bu dosya raporda test kodlarıyla birlikte açıklanacak notları içerir. Her senaryo için amaç, test edilen sistem bileşeni, beklenen sonuç ve gerçekleşen sonuç verilmiştir.

## Test Execution Summary

| Komut | Sonuç | Not |
| --- | --- | --- |
| `npm test` | Passed | Vitest: 2 test file, 14 test passed. `gbcr.test.ts`: 6/6, `api.test.ts`: 8/8. |
| `npm run typecheck` | Passed | TypeScript typecheck hata üretmeden tamamlandı. |
| `npm run build:web` | Passed | Vite production build başarılı tamamlandı. |
| Gradle `testDebugUnitTest` | Passed | Android JUnit: `BUILD SUCCESSFUL in 22s`. |
| `npm run test:e2e:web` | Blocked by environment | Headless Chrome açılmadan Selenium Manager WebDriver bulma hatası verdi. Uygulama assertion'larına geçilemedi. |
| `npm run test:e2e:mobile` | Blocked by environment | Appium server ve `uiautomator2` driver yüklendi, fakat bağlı Android device/emulator bulunamadı. |
| `npm run test:e2e:sync` | Blocked by environment | Senaryo Android Appium session ile başladığı için bağlı cihaz/emulator yokluğunda durdu. |

## 1. Shared GBCR/RCLR Unit Tests

Kaynak: `tests/unit/gbcr.test.ts`

### 1.1 Valid Branching DAG

Test kodu:

```ts
const result = validateDag(buildSeedSurvey());
expect(result.valid).toBe(true);
expect(result.roots).toEqual(['q-channel']);
```

| Alan | Açıklama |
| --- | --- |
| Amaç | Seed survey graph'ının geçerli bir directed acyclic graph olduğunu doğrulamak. |
| Test edilen bileşen | GBCR DAG validation: `validateDag`. |
| Beklenen sonuç | DAG valid olmalı ve root node `q-channel` olmalı. |
| Gerçekleşen sonuç | Passed. Vitest içinde beklenti sağlandı. |

### 1.2 Cycle Detection

Test kodu:

```ts
schema.edges.push({
  id: 'e-cycle',
  from: 'q-final',
  to: 'q-channel',
  predicate: { kind: 'answered', questionId: 'q-final' }
});
const result = validateDag(schema);
expect(result.valid).toBe(false);
expect(result.issues.some((issue) => issue.code === 'CYCLE_DETECTED')).toBe(true);
```

| Alan | Açıklama |
| --- | --- |
| Amaç | Conditional edge ile cycle oluşursa GBCR'nin bunu yakaladığını göstermek. |
| Test edilen bileşen | GBCR cycle detection ve validation issue üretimi. |
| Beklenen sonuç | Schema invalid olmalı ve `CYCLE_DETECTED` issue dönmeli. |
| Gerçekleşen sonuç | Passed. Cycle beklenen şekilde reddedildi. |

### 1.3 Send Button Gating

Test kodu:

```ts
const start = resolveVisibility(schema, {});
expect(start.visibleQuestionIds).toEqual(['q-channel']);
expect(start.sendEnabled).toBe(false);

const branched = resolveVisibility(schema, { 'q-channel': 'mobile' });
expect(branched.visibleQuestionIds).toContain('q-mobile-rating');
expect(branched.sendEnabled).toBe(false);

const complete = resolveVisibility(schema, { 'q-channel': 'mobile', 'q-mobile-rating': 4 });
expect(complete.sendEnabled).toBe(true);
expect(complete.blockers).toEqual([]);
```

| Alan | Açıklama |
| --- | --- |
| Amaç | Send butonunun yalnızca görünür required sorular tamamlanınca aktif olduğunu doğrulamak. |
| Test edilen bileşen | RCLR visibility resolution ve completion gating. |
| Beklenen sonuç | Başta Send kapalı, branch açılınca hâlâ kapalı, required path tamamlanınca açık olmalı. |
| Gerçekleşen sonuç | Passed. `sendEnabled` doğru durumlarda değişti. |

### 1.4 Hidden Answer Cleanup

Test kodu:

```ts
const result = resolveVisibility(schema, {
  'q-channel': 'mobile',
  'q-web-rating': 5
});
expect(result.visibleQuestionIds).not.toContain('q-web-rating');
expect(result.hiddenClearedAnswerIds).toEqual(['q-web-rating']);
```

| Alan | Açıklama |
| --- | --- |
| Amaç | Seçilmeyen branch'e ait stale answer'ın completion hesabına katılmadığını doğrulamak. |
| Test edilen bileşen | RCLR hidden answer detection. |
| Beklenen sonuç | `q-web-rating` görünür olmamalı ve temizlenecek cevaplar listesine eklenmeli. |
| Gerçekleşen sonuç | Passed. Hidden answer doğru raporlandı. |

### 1.5 Atomic State Recovery

Test kodu:

```ts
const oldSchema = buildSeedSurvey(1);
const newSchema = buildSeedSurvey(2);
newSchema.questions.find((q) => q.id === 'q-final')!.title =
  'Any last note for the research team?';

const resolution = resolveSyncConflict(oldSchema, newSchema, {
  'q-channel': 'mobile',
  'q-mobile-rating': 4
});
expect(resolution.action).toBe('atomic_recovery');
expect(resolution.preservedAnswers).toEqual({
  'q-channel': 'mobile',
  'q-mobile-rating': 4
});
```

| Alan | Açıklama |
| --- | --- |
| Amaç | Compatible schema drift durumunda cevapların yeni schema'ya korunarak taşındığını göstermek. |
| Test edilen bileşen | Atomic state recovery: `resolveSyncConflict`. |
| Beklenen sonuç | Action `atomic_recovery` olmalı ve uyumlu cevaplar korunmalı. |
| Gerçekleşen sonuç | Passed. Cevaplar korunarak map edildi. |

### 1.6 Rollback After Deleted Answered Node

Test kodu:

```ts
newSchema.questions = newSchema.questions.filter((q) => q.id !== 'q-mobile-rating');
newSchema.edges = newSchema.edges.filter((edge) =>
  edge.from !== 'q-mobile-rating' && edge.to !== 'q-mobile-rating'
);

const resolution = resolveSyncConflict(oldSchema, newSchema, {
  'q-channel': 'mobile',
  'q-mobile-rating': 4
});
expect(resolution.action).toBe('rollback');
expect(resolution.droppedAnswerIds).toEqual(['q-mobile-rating']);
expect(resolution.rollbackStableNodeId).toBe('q-channel');
```

| Alan | Açıklama |
| --- | --- |
| Amaç | Cevaplanmış görünür node silinirse session'ın son stable node'a dönmesini doğrulamak. |
| Test edilen bileşen | RCLR rollback mechanism. |
| Beklenen sonuç | Action `rollback`, dropped answer `q-mobile-rating`, rollback node `q-channel` olmalı. |
| Gerçekleşen sonuç | Passed. Rollback talimatı doğru üretildi. |

## 2. Backend API Unit Tests

Kaynak: `tests/unit/api.test.ts`

### 2.1 Seeded Login

Test kodu:

```ts
const response = await request(testApp())
  .post('/api/auth/login')
  .send({ email: 'alice@ares.test', password: 'Test1234!' })
  .expect(200);

expect(response.body.user.email).toBe('alice@ares.test');
```

| Alan | Açıklama |
| --- | --- |
| Amaç | Project 1'den gelen seeded user login akışının çalıştığını doğrulamak. |
| Test edilen bileşen | Backend auth endpoint: `POST /api/auth/login`. |
| Beklenen sonuç | HTTP 200 ve doğru kullanıcı email'i dönmeli. |
| Gerçekleşen sonuç | Passed. Login başarılı döndü. |

### 2.2 Publish Version Increment

Test kodu:

```ts
const before = await request(app)
  .get('/api/surveys/customer-feedback/schema')
  .expect(200);

const published = await request(app)
  .post('/api/surveys/customer-feedback/publish')
  .send({})
  .expect(200);

expect(published.body.survey.version).toBe(before.body.schema.version + 1);
```

| Alan | Açıklama |
| --- | --- |
| Amaç | Publish sırasında schema version'ın artırıldığını doğrulamak. |
| Test edilen bileşen | Schema versioning endpoint: `POST /api/surveys/:id/publish`. |
| Beklenen sonuç | Publish edilen schema version, önceki version + 1 olmalı. |
| Gerçekleşen sonuç | Passed. Version increment doğru çalıştı. |

### 2.3 Create Valid Conditional Survey

Test kodu:

```ts
const schema = buildSeedSurvey();
schema.id = 'report-conditional-survey';

const response = await request(testApp())
  .post('/api/surveys')
  .send(schema)
  .expect(201);

expect(response.body.validation.valid).toBe(true);
expect(response.body.survey.edges.some((edge) => edge.id === 'e-channel-mobile')).toBe(true);
```

| Alan | Açıklama |
| --- | --- |
| Amaç | Backend'in valid conditional logic içeren survey oluşturmayı kabul ettiğini göstermek. |
| Test edilen bileşen | Survey create endpoint ve GBCR validation. |
| Beklenen sonuç | HTTP 201, validation valid ve conditional edge korunmuş olmalı. |
| Gerçekleşen sonuç | Passed. Survey valid olarak kaydedildi. |

### 2.4 Block Publish For Cyclic Schema

Test kodu:

```ts
schema.edges.push({
  id: 'e-report-cycle',
  from: 'q-final',
  to: 'q-channel',
  predicate: { kind: 'answered', questionId: 'q-final' }
});

const draft = await request(app)
  .put('/api/surveys/customer-feedback')
  .send(schema)
  .expect(200);
expect(draft.body.validation.valid).toBe(false);

const publish = await request(app)
  .post('/api/surveys/customer-feedback/publish')
  .send({})
  .expect(400);
expect(publish.body.validation.issues.some((issue) =>
  issue.code === 'CYCLE_DETECTED'
)).toBe(true);
```

| Alan | Açıklama |
| --- | --- |
| Amaç | Invalid DAG publish edilmeden önce backend tarafından bloklandığını doğrulamak. |
| Test edilen bileşen | Backend publish guard ve GBCR validation. |
| Beklenen sonuç | Draft validation invalid, publish HTTP 400 ve `CYCLE_DETECTED` issue dönmeli. |
| Gerçekleşen sonuç | Passed. Cyclic schema publish edilmedi. |

### 2.5 Schema Update Recomputes Hash

Test kodu:

```ts
const before = await request(app)
  .get('/api/surveys/customer-feedback/schema')
  .expect(200);

const schema = before.body.schema;
schema.questions = [
  ...schema.questions,
  { id: 'q-api-added', type: 'text', title: 'API-added audit note', required: false, stable: false }
];

const updated = await request(app)
  .put('/api/surveys/customer-feedback')
  .send(schema)
  .expect(200);

expect(updated.body.validation.valid).toBe(true);
expect(updated.body.survey.schemaHash).not.toBe(before.body.schema.schemaHash);
```

| Alan | Açıklama |
| --- | --- |
| Amaç | Schema değiştiğinde hash'in yeniden hesaplandığını doğrulamak. |
| Test edilen bileşen | Backend schema update ve `computeSchemaHash`. |
| Beklenen sonuç | Validation valid kalmalı ve schema hash değişmeli. |
| Gerçekleşen sonuç | Passed. Hash değişimi doğrulandı. |

### 2.6 Answer Submission Completion

Test kodu:

```ts
const session = await request(app)
  .post('/api/sessions')
  .send({ surveyId: 'customer-feedback', userId: 'u-alice' })
  .expect(201);

const sync = await request(app)
  .patch(`/api/sessions/${session.body.session.id}/answers`)
  .send({
    clientSchemaVersion: 1,
    answers: { 'q-channel': 'mobile', 'q-mobile-rating': 5 }
  })
  .expect(200);

expect(sync.body.resolution.action).toBe('ok');
expect(sync.body.resolution.visibility.sendEnabled).toBe(true);
```

| Alan | Açıklama |
| --- | --- |
| Amaç | Backend answer submission sonrası completion state'in doğru hesaplandığını göstermek. |
| Test edilen bileşen | Session create, answer sync endpoint, RCLR visibility. |
| Beklenen sonuç | Resolution `ok`, `sendEnabled` true ve session answers korunmuş olmalı. |
| Gerçekleşen sonuç | Passed. Backend cevapları kabul edip completion state üretti. |

### 2.7 Backend Atomic Recovery

Test kodu:

```ts
await request(app)
  .post('/api/test/change-edge')
  .send({
    edgeId: 'e-channel-mobile',
    predicate: { kind: 'equals', questionId: 'q-channel', value: 'mobile' }
  })
  .expect(200);

const sync = await request(app)
  .patch(`/api/sessions/${session.body.session.id}/answers`)
  .send({
    clientSchemaVersion: 1,
    answers: { 'q-channel': 'mobile', 'q-mobile-rating': 4 }
  })
  .expect(200);

expect(sync.body.resolution.action).toBe('atomic_recovery');
expect(sync.body.resolution.preservedAnswers).toEqual({
  'q-channel': 'mobile',
  'q-mobile-rating': 4
});
```

| Alan | Açıklama |
| --- | --- |
| Amaç | Mobile eski schema version ile gönderdiğinde compatible değişiklikte recovery yapılmasını doğrulamak. |
| Test edilen bileşen | Mobile-backend sync conflict path ve atomic recovery. |
| Beklenen sonuç | Action `atomic_recovery` ve cevaplar korunmuş olmalı. |
| Gerçekleşen sonuç | Passed. Backend recovery talimatı döndü. |

### 2.8 Backend Rollback On Incompatible Sync

Test kodu:

```ts
await request(app)
  .post('/api/test/delete-node')
  .send({ nodeId: 'q-mobile-rating' })
  .expect(200);

const sync = await request(app)
  .patch(`/api/sessions/${session.body.session.id}/answers`)
  .send({
    clientSchemaVersion: 1,
    answers: { 'q-channel': 'mobile', 'q-mobile-rating': 4 }
  })
  .expect(200);

expect(sync.body.resolution.action).toBe('rollback');
expect(sync.body.resolution.conflictCode).toBe('RCLR_ROLLBACK');
```

| Alan | Açıklama |
| --- | --- |
| Amaç | Mobile eski schema version ile silinmiş node cevabı gönderirse rollback talimatı üretildiğini göstermek. |
| Test edilen bileşen | Session rollback mechanism ve backend sync resolution. |
| Beklenen sonuç | Action `rollback`, conflict code `RCLR_ROLLBACK` olmalı. |
| Gerçekleşen sonuç | Passed. Rollback response doğru üretildi. |

## 3. Android Kotlin RCLR Unit Tests

Kaynak: `mobile/app/src/test/java/edu/bilkent/aresx/RclrEngineTest.kt`

### 3.1 Mobile Branch Visibility Parity

Test kodu:

```kotlin
val result = RclrEngine.resolveVisibility(survey(), mapOf("q-channel" to "mobile"))
assertEquals(listOf("q-channel", "q-mobile-rating"), result.visibleQuestionIds)
assertFalse(result.sendEnabled)
```

| Alan | Açıklama |
| --- | --- |
| Amaç | Android RCLR motorunun mobile branch için backend ile aynı visibility sonucunu üretmesini doğrulamak. |
| Test edilen bileşen | Android `RclrEngine.resolveVisibility`. |
| Beklenen sonuç | `q-channel` ve `q-mobile-rating` görünür, Send kapalı olmalı. |
| Gerçekleşen sonuç | Passed. Gradle JUnit içinde başarıyla geçti. |

### 3.2 Android DAG Validation

Test kodu:

```kotlin
assertTrue(RclrEngine.validateDag(survey()))
```

| Alan | Açıklama |
| --- | --- |
| Amaç | Android client'ın valid DAG'i kabul ettiğini göstermek. |
| Test edilen bileşen | Android DAG validation. |
| Beklenen sonuç | `validateDag` true dönmeli. |
| Gerçekleşen sonuç | Passed. |

### 3.3 Android Cycle Rejection

Test kodu:

```kotlin
val cyclic = survey().copy(
    edges = survey().edges + ConditionalEdge(
        "e-cycle",
        "q-final",
        "q-channel",
        Predicate("answered", "q-final", null)
    )
)
assertFalse(RclrEngine.validateDag(cyclic))
```

| Alan | Açıklama |
| --- | --- |
| Amaç | Android tarafında cyclic graph'ın reddedildiğini doğrulamak. |
| Test edilen bileşen | Android cycle detection. |
| Beklenen sonuç | `validateDag` false dönmeli. |
| Gerçekleşen sonuç | Passed. |

### 3.4 Send Unlocks After Visible Required Path

Test kodu:

```kotlin
val result = RclrEngine.resolveVisibility(
    survey(),
    mapOf("q-channel" to "mobile", "q-mobile-rating" to 4)
)
assertTrue(result.sendEnabled)
assertEquals("q-mobile-rating", result.stableNodeId)
```

| Alan | Açıklama |
| --- | --- |
| Amaç | Android UI'daki Send state'in RCLR sonucuna göre açılacağını doğrulamak. |
| Test edilen bileşen | Android RCLR completion gating ve stable node seçimi. |
| Beklenen sonuç | Send enabled ve stable node `q-mobile-rating` olmalı. |
| Gerçekleşen sonuç | Passed. |

### 3.5 Unselected Branch Not Rendered

Test kodu:

```kotlin
val result = RclrEngine.resolveVisibility(survey(), mapOf("q-channel" to "web"))
assertEquals(listOf("q-channel"), result.visibleQuestionIds)
assertEquals("q-channel", result.stableNodeId)
```

| Alan | Açıklama |
| --- | --- |
| Amaç | Seçilmeyen mobile branch sorularının Android görünür path'e eklenmediğini doğrulamak. |
| Test edilen bileşen | Android recursive visibility resolution. |
| Beklenen sonuç | Sadece `q-channel` görünür olmalı ve stable node `q-channel` kalmalı. |
| Gerçekleşen sonuç | Passed. |

### 3.6 Hidden Answers Reported For Clearing

Test kodu:

```kotlin
val result = RclrEngine.resolveVisibility(
    survey(),
    mapOf("q-channel" to "web", "q-mobile-rating" to 4)
)
assertEquals(listOf("q-channel"), result.visibleQuestionIds)
assertEquals(listOf("q-mobile-rating"), result.hiddenClearedAnswerIds)
```

| Alan | Açıklama |
| --- | --- |
| Amaç | Android tarafında stale hidden answer cleanup bilgisinin üretildiğini doğrulamak. |
| Test edilen bileşen | Android hidden answer detection. |
| Beklenen sonuç | `q-mobile-rating` hidden-cleared listesine girmeli. |
| Gerçekleşen sonuç | Passed. |

## 4. E2E Test Scenarios

### 4.1 Selenium Web Architect Scenario

Kaynak: `tests/e2e/web-architect.selenium.mjs`

Test kodu:

```js
const driver = await new Builder()
  .forBrowser('chrome')
  .setChromeOptions(options)
  .build();

await driver.get('http://localhost:5173');
await driver.findElement(By.css('[data-testid="web-login-submit"]')).click();

const status = await driver.findElement(By.css('[data-testid="dag-status"]')).getText();
assert.match(status, /DAG valid/);

await driver.findElement(By.css('[data-testid="new-question-title"]'))
  .sendKeys('Selenium audit note');
await driver.findElement(By.css('[data-testid="add-question"]')).click();

await driver.findElement(By.css('[data-testid="publish-survey"]')).click();
```

| Alan | Açıklama |
| --- | --- |
| Amaç | Web Architect üzerinden login, DAG status, question/edge ekleme, preview path ve publish akışını uçtan uca doğrulamak. |
| Test edilen bileşen | React Web Architect, Express backend, Selenium browser automation. |
| Beklenen sonuç | Headless Chrome açılmalı, DAG valid görülmeli, yeni soru/edge eklenmeli, publish sonrası version v2 olmalı. |
| Gerçekleşen sonuç | Environment blocked. Backend ve Vite server açıldı, fakat Selenium Manager Chrome driver bulamadı: `Unable to obtain browser driver`, `TypeError: Cannot read properties of undefined (reading 'toString')`. Uygulama assertion'larına geçilemedi. |

### 4.2 Appium Mobile Logic Suite

Kaynak: `tests/e2e/mobile.appium.mjs`

Test kodu:

```js
const driver = await createAppiumSession(server, {
  platformName: 'Android',
  'appium:automationName': 'UiAutomator2',
  'appium:deviceName': 'Medium_Phone_API_35',
  'appium:app': app
});

await driver.tap('login-submit');
await driver.tap('survey-card-customer-feedback');
assert.match(await driver.text('schema-version'), /Schema v1/);

await driver.tap('answer-q-channel-mobile');
assert.match(await driver.text('question-q-mobile-rating'), /mobile/i);

await driver.tap('answer-q-mobile-rating-4');
assert.match(await driver.text('visible-path'), /q-final/);
assert.equal(await driver.enabled('send-button'), true);
```

| Alan | Açıklama |
| --- | --- |
| Amaç | Native Android client'ta login, survey load, dynamic rendering, branch traversal, send gating, atomic recovery ve rollback akışlarını doğrulamak. |
| Test edilen bileşen | Android UI, Kotlin RCLR engine, backend sync API, Appium UiAutomator2. |
| Beklenen sonuç | Android emulator üzerinde tüm 10 mobile logic adımı geçmeli. |
| Gerçekleşen sonuç | Environment blocked. Appium server ve `uiautomator2` driver başarıyla yüklendi, fakat `adb devices` boş olduğu için session açılamadı: `Could not find a connected Android device in 20000ms`. Uygulama assertion'larına geçilemedi. |

### 4.3 Selenium + Appium Sync Conflict Scenario

Kaynak: `tests/e2e/sync-conflict.mjs`

Test kodu:

```js
const selectMobile = appium.tap('answer-q-channel-mobile');
const mutateWebLogic = fetch('http://localhost:3001/api/test/delete-node', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ nodeId: 'q-mobile-rating' })
});
await Promise.all([selectMobile, mutateWebLogic]);

const banner = await appium.text('conflict-banner');
assert.match(banner, /RCLR_ROLLBACK|RCLR_CONFLICT/);

const pathText = await appium.text('visible-path');
assert.doesNotMatch(pathText, /q-mobile-rating.*q-mobile-rating/);
```

| Alan | Açıklama |
| --- | --- |
| Amaç | Mobile cevap seçerken web/backend tarafında schema node deletion olduğunda sync conflict resolution'ın rollback/conflict ürettiğini doğrulamak. |
| Test edilen bileşen | Cross-platform synchronization, backend schema mutation, Appium mobile client, Selenium web setup. |
| Beklenen sonuç | Conflict banner `RCLR_ROLLBACK` veya `RCLR_CONFLICT` göstermeli ve duplicate/zombie path oluşmamalı. |
| Gerçekleşen sonuç | Environment blocked. Senaryo Android Appium session açarak başladığı için bağlı emulator/cihaz yokluğunda durdu: `Could not find a connected Android device in 20000ms`. Assertion'lara geçilemedi. |

## Environment Notes

- Testler 2026-04-22 tarihinde macOS ortamında, proje dizini `/Users/mertokhan/Downloads/proje2/ares-x` altında çalıştırıldı.
- `node_modules` Windows/macOS karışık optional dependency durumu gösterdiği için `npm install` çalıştırılarak macOS Rollup optional dependency'leri geri yüklendi.
- Appium cache içinde `uiautomator2.installPath` Windows path gösterdiği için local Appium cache macOS path'e güncellendi; bundan sonra Appium driver başarıyla yüklendi.
- `adb devices` bağlı cihaz/emulator göstermediği için Appium tabanlı e2e testler uygulama assertion'larına geçemedi.
