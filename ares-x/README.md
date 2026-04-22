# ARES-X Integrated Adaptive Survey Ecosystem

ARES-X is a CS458 Project 2 implementation with a responsive Web Architect, Express/TypeScript backend, native Android Kotlin client, GBCR/RCLR conditional logic, schema versioning, and cross-platform verification.

## Structure

- `backend/src`: Express API and JSON-backed store.
- `shared/src`: TypeScript GBCR/RCLR logic and seeded fixtures.
- `web/src`: React/Vite Survey Architect.
- `mobile/app/src`: Native Android Kotlin app.
- `tests/unit`: Vitest/Supertest tests.
- `tests/e2e`: Selenium, Appium, and synchronized conflict automation.
- `docs`: UML diagrams, TDD log, screenshots, and report source/PDF.

## Test Accounts

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@ares.test` | `Admin123!` |
| Mobile user | `alice@ares.test` | `Test1234!` |
| Mobile user | `bob@ares.test` | `Secure99#` |
| Mobile user | `carol@ares.test` | `Pass@word1` |

## Setup

```powershell
cd C:\Users\merto\Desktop\proje2\ares-x
npm install
```

For Android commands in PowerShell:

```powershell
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
```

## Run Locally

One-click launchers are available at the repository root:

```text
RUN_ARES_X_MAC.command
RUN_ARES_X_WINDOWS.bat
```

Double-click the file for your operating system. The launcher installs/verifies npm packages, starts the backend and web architect, starts Appium when available, builds/installs/opens the Android app when the Android SDK/emulator or a device is available, and prints the local/LAN URLs. Closing that terminal window or pressing `Ctrl-C` stops the services opened by the launcher.

Backend:

```powershell
npm run dev:backend
```

Web Architect:

```powershell
npm run dev:web
```

Open `http://localhost:5173`. The Android emulator reaches the backend through `http://10.0.2.2:3001`.

## Build And Test

```powershell
npm test
npm run typecheck
npm run build:web
```

Android:

```powershell
& "$env:USERPROFILE\.gradle\wrapper\dists\gradle-8.7-bin\bhs2wmbdwecv87pi65oeuq5iu\gradle-8.7\bin\gradle.bat" -p mobile clean testDebugUnitTest "-Pkotlin.incremental=false" "-Dkotlin.compiler.execution.strategy=in-process" --no-daemon
& "$env:USERPROFILE\.gradle\wrapper\dists\gradle-8.7-bin\bhs2wmbdwecv87pi65oeuq5iu\gradle-8.7\bin\gradle.bat" -p mobile assembleDebug "-Pkotlin.incremental=false" "-Dkotlin.compiler.execution.strategy=in-process" --no-daemon
```

E2E:

```powershell
npm run test:e2e:web
npx appium driver install uiautomator2@4.2.9
npx appium --address 127.0.0.1 --port 4723 --base-path /
npm run test:e2e:mobile
npm run test:e2e:sync
```

## LLM Disclosure

The codebase, tests, documentation structure, and report draft were LLM-assisted with OpenAI Codex/GPT-5 in Codex Desktop on 2026-04-21. Students should review, personalize, and own the report wording, group details, screenshots, and final submission email before sending.
