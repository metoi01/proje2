# ARES Authentication System
**CS458 — Software Testing & Quality Assurance**

Advanced Risk Evaluation System — a Flask-based authentication platform with
real Google + Facebook OAuth, LLM-powered fraud detection, risk scoring, and a
self-healing Selenium test suite.

---

## One-Time Setup

### 1. Install Python packages
```powershell
pip install flask selenium requests undetected-chromedriver
```

### 2. Install ngrok
1. Download from https://ngrok.com/download → Windows ZIP → extract `ngrok.exe` to `C:\ngrok\`
2. Sign up for a free account at https://ngrok.com
3. Copy your auth token from https://dashboard.ngrok.com/get-started/your-authtoken
4. Connect your account (run once, never again):
   ```powershell
   C:\ngrok\ngrok.exe authtoken YOUR_TOKEN_HERE
   ```

### 3. Set up OAuth credentials

**Google:**
1. Go to https://console.developers.google.com
2. Create a project → Credentials → Create OAuth 2.0 Client ID → Web application
3. Under Authorized redirect URIs add:
   ```
   https://YOUR_NGROK_URL/auth/google/callback
   ```
4. Copy the Client ID and Client Secret

**Facebook:**
1. Go to https://developers.facebook.com → My Apps → Create App
2. Add Facebook Login product → Settings
3. Under Valid OAuth Redirect URIs add:
   ```
   https://YOUR_NGROK_URL/auth/facebook/callback
   ```
4. Copy the App ID and App Secret

> ngrok gives you a new URL every time it restarts (free tier).
> Each session you must update the redirect URIs in both Google and Facebook
> consoles AND update SERVER_BASE_URL below.

---

## Every Session — Startup Steps

You need two PowerShell windows open at the same time.

### Window 1 — Start ngrok
```powershell
C:\ngrok\ngrok.exe http 5000
```
Look for the Forwarding line and copy the https://xxxx.ngrok-free.app URL.

### Window 2 — Start Flask
```powershell
cd C:\Users\Hakan\Desktop\ares_auth

$env:ANTHROPIC_API_KEY    = "sk-ant-..."
$env:GOOGLE_CLIENT_ID     = "862165790575-iolanro6901pi8cd5o47en3hou85qnnf.apps.googleusercontent.com"
$env:GOOGLE_CLIENT_SECRET = "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"
$env:FACEBOOK_APP_ID      = "935369569028206"
$env:FACEBOOK_APP_SECRET  = "bd1c676c2edc872b668616ed1f73c4fa"
$env:SERVER_BASE_URL      = "https://xxxx.ngrok-free.app"

python app.py --clear-logs
```
Replace xxxx.ngrok-free.app with the URL from Window 1.

### Open in browser
```
https://xxxx.ngrok-free.app
```

> ngrok warning page: The first time you visit the ngrok URL in a browser session
> you will see a page saying "You are about to visit..." — click Visit Site.
> This appears once per browser session. Selenium handles this automatically
> via the bypass_ngrok_warning() helper which clicks Visit Site whenever seen.

---

## Running the Tests

### All tests (headless)
```powershell
python tests.py --base-url https://xxxx.ngrok-free.app
```

### All tests with visible browser
```powershell
python tests.py --base-url https://xxxx.ngrok-free.app --headed
```

### Single test
```powershell
python tests.py --base-url https://xxxx.ngrok-free.app --test tc4
```

### Available test IDs

| ID  | Test Case                          | Type           |
|-----|------------------------------------|----------------|
| tc1 | Dynamic ID Recovery                | Self-healing   |
| tc2 | Multimodal Failure (Popup + LLM)   | Self-healing   |
| tc3 | Cross-Browser CSS Consistency      | Self-healing   |
| tc4 | Social Auth Handshake (OAuth)      | Integration    |
| tc5 | Rate Limiting / Lockout            | Security       |
| tc6 | Empty & Malformed Input Handling   | Edge case      |
| rc1 | F-Score Failure Table              | Risk criterion |
| rc2 | IP-Score New vs Known IP           | Risk criterion |
| rc3 | UA-Score Suspicious Agent          | Risk criterion |
| rc4 | Fraud Log Persistence (LLM)        | Risk criterion |

---

## TC4 — Full OAuth Login with Selenium

By default TC4 only verifies that the OAuth redirect to Google/Facebook happens.
To have Selenium type real credentials and complete the full login loop, set
these env vars before running (use dedicated dummy accounts with no 2FA):

```powershell
$env:TEST_GOOGLE_EMAIL      = "ares.test.cs458@gmail.com"
$env:TEST_GOOGLE_PASSWORD   = "123test456"
$env:TEST_FACEBOOK_EMAIL    = "ares.test.cs458@gmail.com"
$env:TEST_FACEBOOK_PASSWORD = "1234test5678"

python tests.py --base-url https://xxxx.ngrok-free.app --test tc4
```

TC4 automatically detects ngrok mode and uses undetected-chromedriver to bypass
Google and Facebook bot detection. Without it, Selenium triggers a 500 error on
Google's login page. The browser is always headed (visible) during TC4 so you
can see the credential typing and dashboard display.

---

## Risk Scoring Formula

```
R = F_score + IP_score + UA_score + T_score   (max 100)
```

| Component | Max | Trigger                      |
|-----------|-----|------------------------------|
| F_score   |  40 | Failed login attempts        |
| IP_score  |  30 | Unknown / new IP address     |
| UA_score  |  20 | Suspicious User-Agent string |
| T_score   |  10 | Unusual login time           |

LLM fraud analysis (via Anthropic API) is triggered when R >= 60.

---

## Pre-seeded Test Users

| Name          | Email           | Password  |
|---------------|-----------------|-----------|
| Alice Johnson | alice@ares.test | Test1234! |
| Bob Smith     | bob@ares.test   | Secure99# |

---

## Environment Variables Reference

| Variable                 | Required | Description                                        |
|--------------------------|----------|----------------------------------------------------|
| ANTHROPIC_API_KEY        | Yes      | Anthropic API key for LLM fraud detection          |
| GOOGLE_CLIENT_ID         | Yes      | Google OAuth 2.0 Client ID                         |
| GOOGLE_CLIENT_SECRET     | Yes      | Google OAuth 2.0 Client Secret                     |
| FACEBOOK_APP_ID          | Yes      | Facebook App ID                                    |
| FACEBOOK_APP_SECRET      | Yes      | Facebook App Secret                                |
| SERVER_BASE_URL          | Yes      | ngrok HTTPS URL e.g. https://xxxx.ngrok-free.app   |
| TEST_GOOGLE_EMAIL        | Optional | Dummy Google account for TC4 full OAuth loop       |
| TEST_GOOGLE_PASSWORD     | Optional | Password for above                                 |
| TEST_FACEBOOK_EMAIL      | Optional | Dummy Facebook account for TC4 full OAuth loop     |
| TEST_FACEBOOK_PASSWORD   | Optional | Password for above                                 |
| FLASK_SECRET_KEY         | Optional | Overrides auto-generated session secret            |

---

## File Structure

```
ares_auth/
├── app.py                  Flask application & routes
├── auth_store.py           In-memory user/session store
├── risk_engine.py          Risk scoring & LLM integration
├── oauth_providers.py      Google & Facebook OAuth helpers
├── self_healing_driver.py  Self-healing Selenium framework
├── tests.py                Full test suite (TC1-TC6 + RC1-RC4)
└── templates/
    ├── base.html           Base layout (dark theme, animated grid)
    ├── login.html          Login page with risk panel
    ├── dashboard.html      Post-login dashboard
    └── register.html       Registration page
```

---

## Troubleshooting

| Symptom                              | Cause                        | Fix                                              |
|--------------------------------------|------------------------------|--------------------------------------------------|
| redirect_uri_mismatch on Google      | ngrok URL changed            | Update redirect URI in Google Console            |
| URL Engellendi on Facebook           | ngrok URL changed            | Update redirect URI in Facebook dashboard        |
| Google 500 error in Selenium         | Bot detection triggered      | Run: pip install undetected-chromedriver         |
| ngrok warning page shown in tests    | New browser session          | Selenium auto-clicks Visit Site automatically    |
| Flask starts but OAuth fails         | SERVER_BASE_URL not set      | Set the env var to your current ngrok URL        |
| All tests fail with connection error | Flask not running            | Start Flask in Window 2 first                   |
| TC4 credential typing fails          | 2FA enabled on dummy account | Disable 2FA on your test Google/Facebook account |

---

## Notes

- ngrok URL changes every restart — update it in: Google Console redirect URI,
  Facebook redirect URI, SERVER_BASE_URL env var, and --base-url test flag.
- undetected-chromedriver is required for TC4 — it patches Chrome to bypass
  Google/Facebook bot detection so the full OAuth flow completes.
- In-memory database — all users, sessions and logs reset when Flask restarts.
  Use python app.py --clear-logs to also wipe fraud_log.json on startup.
- Rotate credentials — never commit real API keys or secrets to version control.
