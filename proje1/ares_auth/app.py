"""
ARES - AI-Driven Resilient & Evolutionary Systems
Autonomous Self-Healing Authentication & Adaptive Security
Flask Backend Application
"""

import os
import secrets
from datetime import datetime, timedelta
from functools import wraps
from flask import (
    Flask, render_template, request, redirect,
    url_for, session, jsonify, flash
)
from risk_engine import RiskEngine
from auth_store import AuthStore
from oauth_providers import (
    google_auth_url, google_exchange_code, google_is_configured,
    facebook_auth_url, facebook_exchange_code, facebook_is_configured,
    OAuthConfigError, OAuthCallbackError
)

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", secrets.token_hex(32))
app.permanent_session_lifetime = timedelta(hours=2)

# ── Singletons ───────────────────────────────────────────────────────────────
risk_engine = RiskEngine()
auth_store   = AuthStore()

# ── Helpers ───────────────────────────────────────────────────────────────────
def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user" not in session:
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return decorated

def get_client_ip():
    return request.headers.get("X-Forwarded-For", request.remote_addr)

# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    if "user" in session:
        return redirect(url_for("dashboard"))
    return redirect(url_for("login"))


@app.route("/login", methods=["GET", "POST"])
def login():
    if "user" in session:
        return redirect(url_for("dashboard"))

    error     = None
    risk_info = None

    if request.method == "POST":
        identifier = request.form.get("identifier", "").strip()
        password   = request.form.get("password", "").strip()
        ip         = get_client_ip()
        user_agent = request.headers.get("User-Agent", "")

        # ── Risk Assessment ────────────────────────────────────────────────
        print(f"  [LOGIN] identifier={identifier} ip={ip}")
        print(f"  [LOGIN] user_agent={user_agent[:120]}")
        risk_result = risk_engine.assess(
            identifier=identifier,
            ip=ip,
            user_agent=user_agent
        )
        print(f"  [LOGIN] risk_score={risk_result['risk_score']} "
              f"breakdown={risk_result['score_breakdown']} "
              f"llm_error={risk_result.get('llm_error')}")

        if risk_result["blocked"]:
            error = (
                f"Account locked after too many failures. "
                f"Wait {risk_result['lockout_remaining']}s."
            )
            return render_template("login.html", error=error, risk_info=risk_result)

        # ── Credential Check ───────────────────────────────────────────────
        user = auth_store.verify(identifier, password)

        if user:
            risk_engine.reset_failures(identifier)
            risk_engine.register_known_ip(identifier, ip)
            session.permanent = True
            session["user"] = {
                "id":       user["id"],
                "name":     user["name"],
                "email":    user["email"],
                "provider": "local",
                "avatar":   None
            }
            session["login_ip"]   = ip
            session["login_time"] = datetime.utcnow().isoformat()
            return redirect(url_for("dashboard"))
        else:
            risk_engine.record_failure(identifier, ip, user_agent)
            updated = risk_engine.assess(identifier, ip, user_agent)
            error   = "Invalid credentials. Please try again."
            if updated["risk_score"] >= 60:
                risk_info = updated
            if updated["blocked"]:
                error = (
                    f"Account locked after too many failures. "
                    f"Wait {updated['lockout_remaining']}s."
                )

    return render_template("login.html", error=error, risk_info=risk_info)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/register", methods=["GET", "POST"])
def register():
    error = None
    if request.method == "POST":
        name     = request.form.get("name", "").strip()
        email    = request.form.get("email", "").strip()
        password = request.form.get("password", "").strip()

        if not name or not email or not password:
            error = "All fields are required."
        elif auth_store.exists(email):
            error = "An account with that email already exists."
        else:
            auth_store.create_user(name, email, password)
            flash("Account created! Please log in.", "success")
            return redirect(url_for("login"))

    return render_template("register.html", error=error)


@app.route("/dashboard")
@login_required
def dashboard():
    return render_template("dashboard.html", user=session["user"])


# ── OAuth 2.0 — Google ───────────────────────────────────────────────────────

@app.route("/auth/google")
def auth_google():
    if not google_is_configured():
        flash("Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.", "danger")
        return redirect(url_for("login"))
    state = secrets.token_urlsafe(16)
    session["oauth_state"]    = state
    session["oauth_provider"] = "google"
    redirect_uri = f"{_base_url()}/auth/google/callback"
    try:
        auth_url = google_auth_url(redirect_uri, state)
    except OAuthConfigError as e:
        flash(str(e), "danger")
        return redirect(url_for("login"))
    return redirect(auth_url)


@app.route("/auth/google/callback")
def auth_google_callback():
    state = request.args.get("state", "")
    if not state or state != session.pop("oauth_state", None):
        flash("OAuth state mismatch — possible CSRF attack.", "danger")
        return redirect(url_for("login"))

    error = request.args.get("error")
    if error:
        flash(f"Google login cancelled: {error}", "warn")
        return redirect(url_for("login"))

    code         = request.args.get("code", "")
    redirect_uri = f"{_base_url()}/auth/google/callback"

    try:
        user_info = google_exchange_code(code, redirect_uri)
    except (OAuthConfigError, OAuthCallbackError) as e:
        flash(f"Google login failed: {e}", "danger")
        return redirect(url_for("login"))

    session.permanent = True
    session["user"] = {
        "id":       user_info["id"],
        "name":     user_info["name"],
        "email":    user_info["email"],
        "provider": "google",
        "avatar":   user_info.get("avatar"),
    }
    print(f"  [OAUTH] Google login: {user_info['email']}")
    return redirect(url_for("dashboard"))


# ── OAuth 2.0 — Facebook ──────────────────────────────────────────────────────
# Requires HTTPS redirect URI — set SERVER_BASE_URL to your ngrok https URL:
#   $env:SERVER_BASE_URL = "https://xxxx.ngrok-free.app"
# Register this in Facebook Login → Settings → Valid OAuth Redirect URIs:
#   https://xxxx.ngrok-free.app/auth/facebook/callback
# ─────────────────────────────────────────────────────────────────────────────

def _base_url():
    """Return SERVER_BASE_URL env var or fall back to Flask's external URL."""
    base = os.environ.get("SERVER_BASE_URL", "").rstrip("/")
    return base if base else request.host_url.rstrip("/")


@app.route("/auth/facebook")
def auth_facebook():
    if not facebook_is_configured():
        flash("Facebook OAuth is not configured. Set FACEBOOK_APP_ID and FACEBOOK_APP_SECRET.", "danger")
        return redirect(url_for("login"))
    state = secrets.token_urlsafe(16)
    session["oauth_state"]    = state
    session["oauth_provider"] = "facebook"
    redirect_uri = f"{_base_url()}/auth/facebook/callback"
    try:
        auth_url = facebook_auth_url(redirect_uri, state)
    except OAuthConfigError as e:
        flash(str(e), "danger")
        return redirect(url_for("login"))
    return redirect(auth_url)


@app.route("/auth/facebook/callback")
def auth_facebook_callback():
    state = request.args.get("state", "")
    if not state or state != session.pop("oauth_state", None):
        flash("OAuth state mismatch — possible CSRF attack.", "danger")
        return redirect(url_for("login"))

    error = request.args.get("error")
    if error:
        flash(f"Facebook login cancelled: {error}", "warn")
        return redirect(url_for("login"))

    code         = request.args.get("code", "")
    redirect_uri = f"{_base_url()}/auth/facebook/callback"

    try:
        user_info = facebook_exchange_code(code, redirect_uri)
    except (OAuthConfigError, OAuthCallbackError) as e:
        flash(f"Facebook login failed: {e}", "danger")
        return redirect(url_for("login"))

    session.permanent = True
    session["user"] = {
        "id":       user_info["id"],
        "name":     user_info["name"],
        "email":    user_info.get("email", ""),
        "provider": "facebook",
        "avatar":   user_info.get("avatar"),
    }
    print(f"  [OAUTH] Facebook login: {user_info['name']}")
    return redirect(url_for("dashboard"))


# ── API Endpoints ─────────────────────────────────────────────────────────────

@app.route("/api/risk-status")
def api_risk_status():
    identifier = request.args.get("identifier", "")
    return jsonify(risk_engine.get_state(identifier))


@app.route("/api/reset-lockout", methods=["POST"])
def api_reset_lockout():
    data       = request.get_json(silent=True) or {}
    identifier = data.get("identifier", "")
    risk_engine.reset_failures(identifier)
    return jsonify({"status": "ok", "identifier": identifier})


@app.route("/api/users")
def api_users():
    return jsonify(auth_store.list_users())


@app.route("/api/debug-oauth")
def api_debug_oauth():
    """Shows exactly what redirect URIs will be sent to Google and Facebook."""
    base = os.environ.get("SERVER_BASE_URL", "").rstrip("/")
    if base:
        google_uri   = f"{base}/auth/google/callback"
        facebook_uri = f"{base}/auth/facebook/callback"
        source = "SERVER_BASE_URL env var"
    else:
        with app.test_request_context():
            google_uri   = url_for("auth_google_callback",   _external=True)
            facebook_uri = url_for("auth_facebook_callback", _external=True)
        source = "url_for() — SERVER_BASE_URL not set"
    return jsonify({
        "google_redirect_uri":   google_uri,
        "facebook_redirect_uri": facebook_uri,
        "source": source,
        "tip": "These URIs must exactly match what is registered in Google/Facebook consoles"
    })


@app.route("/api/health")
def api_health():
    from oauth_providers import google_is_configured, facebook_is_configured
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    return jsonify({
        "status":             "healthy",
        "ts":                 datetime.utcnow().isoformat(),
        "llm_ready":          bool(key),
        "api_key":            (key[:8] + "..." + key[-4:]) if key else "NOT SET",
        "google_configured":  google_is_configured(),
        "facebook_configured": facebook_is_configured(),
    })


@app.route("/api/trigger-risk", methods=["POST"])
def api_trigger_risk():
    """
    Test endpoint: directly trigger a risk assessment with controlled inputs.
    Bypasses browser/Selenium UA uncertainty.
    Body: { "identifier": str, "ip": str, "user_agent": str, "failures": int }
    """
    data       = request.get_json(silent=True) or {}
    identifier = data.get("identifier", "test@ares.test")
    ip         = data.get("ip", "127.0.0.1")
    user_agent = data.get("user_agent", "Mozilla/5.0")
    failures   = int(data.get("failures", 0))

    # Reset and inject exact failure count
    risk_engine.reset_failures(identifier)
    for _ in range(failures):
        risk_engine.record_failure(identifier, ip, user_agent)

    result = risk_engine.assess(identifier, ip, user_agent)
    return jsonify(result)


@app.route("/api/fraud-log")
def api_fraud_log():
    """Return all persisted LLM fraud analyses from fraud_log.json."""
    import os as _os, json as _json
    entries = risk_engine.get_fraud_log()
    try:
        with open("fraud_log.json", "r") as f:
            entries = _json.load(f)
    except (FileNotFoundError, _json.JSONDecodeError):
        pass
    return jsonify({"count": len(entries), "entries": entries})


# ── Runtime DOM-mutation endpoint (for Test Case 1: Dynamic ID Recovery) ──────
@app.route("/api/mutate-login-btn", methods=["POST"])
def api_mutate_login_btn():
    """
    Signals the frontend to rename the login button ID.
    The page JS polls this endpoint; Selenium then uses the self-healing
    framework to locate the renamed button.
    """
    data = request.get_json(silent=True) or {}
    new_id = data.get("new_id", "login-btn-mutated")
    # Store in session so the login page JS can read it
    session["login_btn_override_id"] = new_id
    return jsonify({"status": "ok", "new_id": new_id})


@app.route("/api/login-btn-id")
def api_login_btn_id():
    override = session.get("login_btn_override_id", "login-btn")
    return jsonify({"id": override})


def _check_api_key():
    """Verify the Anthropic API key is set and reachable at startup."""
    import urllib.request, urllib.error
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    print("=" * 60)
    print("  ARES Auth System  —  http://127.0.0.1:5000")
    print("=" * 60)
    if not key:
        print("  ⚠  ANTHROPIC_API_KEY not set.")
        print("     Fraud analysis will use rule-based fallback.")
        print("     To enable LLM: export ANTHROPIC_API_KEY=sk-ant-...")
    else:
        masked = key[:8] + "..." + key[-4:]
        print(f"  ✓  ANTHROPIC_API_KEY detected ({masked})")
        # Quick connectivity check — send a minimal valid request
        try:
            import json as _json
            _probe = _json.dumps({
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 1,
                "messages": [{"role": "user", "content": "ping"}]
            }).encode("utf-8")
            _req = urllib.request.Request(
                "https://api.anthropic.com/v1/messages",
                data=_probe,
                headers={
                    "Content-Type":      "application/json",
                    "x-api-key":         key,
                    "anthropic-version": "2023-06-01"
                },
                method="POST"
            )
            with urllib.request.urlopen(_req, timeout=6) as _r:
                _r.read()
            print("  ✓  Anthropic API reachable — LLM fraud analysis enabled.")
        except urllib.error.HTTPError as e:
            if e.code == 400:
                # 400 means the API received our request fine (just rejected bad input)
                # which still proves connectivity and auth are working
                print("  ✓  Anthropic API reachable — LLM fraud analysis enabled.")
            elif e.code == 401:
                print(f"  ✗  API key rejected (401 Unauthorized). Check your key.")
                print("     Fraud analysis will use rule-based fallback.")
            elif e.code == 429:
                print(f"  ✓  Anthropic API reachable (rate limited) — LLM enabled.")
            else:
                print(f"  ✗  Anthropic API HTTP {e.code}: {e.reason}")
                print("     Fraud analysis will use rule-based fallback.")
        except urllib.error.URLError as e:
            print(f"  ✗  Anthropic API unreachable: {e.reason}")
            print("     Fraud analysis will use rule-based fallback.")
        except Exception as e:
            print(f"  ✗  Anthropic API check failed: {type(e).__name__}: {e}")
            print("     Fraud analysis will use rule-based fallback.")
    print("=" * 60)
    # OAuth configuration status
    from oauth_providers import google_is_configured, facebook_is_configured
    g = google_is_configured()
    f = facebook_is_configured()
    print(f"  {'✓' if g else '⚠'}  Google OAuth:   {'configured' if g else 'NOT configured (set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET)'}")
    print(f"  {'✓' if f else '⚠'}  Facebook OAuth: {'configured' if f else 'NOT configured (set FACEBOOK_APP_ID + FACEBOOK_APP_SECRET)'}")
    print("=" * 60)


if __name__ == "__main__":
    import argparse as _ap
    parser = _ap.ArgumentParser()
    parser.add_argument("--clear-logs", action="store_true",
                        help="Delete fraud_log.json and heal_log.json before starting")
    args = parser.parse_args()
    if args.clear_logs:
        for _f in ["fraud_log.json", "heal_log.json"]:
            if os.path.exists(_f):
                os.remove(_f)
                print(f"  🗑  Cleared {_f}")
    _check_api_key()
    app.run(debug=True, host="0.0.0.0", port=5000)
