"""
ARES OAuth 2.0 Providers
=========================
Real OAuth 2.0 flows for Google and Facebook.
No third-party libraries — uses only urllib from stdlib.

Required environment variables:
    GOOGLE_CLIENT_ID
    GOOGLE_CLIENT_SECRET
    FACEBOOK_APP_ID
    FACEBOOK_APP_SECRET

Redirect URIs to register in each provider's console:
    Google:   http://127.0.0.1:5000/auth/google/callback
    Facebook: http://127.0.0.1:5000/auth/facebook/callback
"""

import os
import json
import urllib.request
import urllib.parse
import urllib.error


# ── Google OAuth 2.0 ─────────────────────────────────────────────────────────
GOOGLE_AUTH_URL     = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL    = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
GOOGLE_SCOPES       = "openid email profile"

# ── Facebook OAuth 2.0 ───────────────────────────────────────────────────────
FACEBOOK_AUTH_URL     = "https://www.facebook.com/v19.0/dialog/oauth"
FACEBOOK_TOKEN_URL    = "https://graph.facebook.com/v19.0/oauth/access_token"
FACEBOOK_USERINFO_URL = "https://graph.facebook.com/me?fields=id,name,picture"


class OAuthConfigError(Exception):
    """Raised when required OAuth env vars are missing."""
    pass


class OAuthCallbackError(Exception):
    """Raised when the OAuth callback contains an error."""
    pass


# ── Google ────────────────────────────────────────────────────────────────────

def google_is_configured() -> bool:
    return bool(os.environ.get("GOOGLE_CLIENT_ID") and
                os.environ.get("GOOGLE_CLIENT_SECRET"))


def google_auth_url(redirect_uri: str, state: str) -> str:
    """Build the Google authorization URL to redirect the user to."""
    client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
    if not client_id:
        raise OAuthConfigError(
            "GOOGLE_CLIENT_ID is not set. "
            "Get credentials at console.cloud.google.com"
        )
    params = {
        "client_id":     client_id,
        "redirect_uri":  redirect_uri,
        "response_type": "code",
        "scope":         GOOGLE_SCOPES,
        "state":         state,
        "access_type":   "online",
        "prompt":        "select_account",   # always show account picker
    }
    return GOOGLE_AUTH_URL + "?" + urllib.parse.urlencode(params)


def google_exchange_code(code: str, redirect_uri: str) -> dict:
    """
    Exchange authorization code for tokens, then fetch user info.
    Returns normalized user dict: { id, name, email, avatar, provider, access_token }
    """
    client_id     = os.environ.get("GOOGLE_CLIENT_ID", "")
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET", "")
    if not client_id or not client_secret:
        raise OAuthConfigError("Google OAuth credentials not configured.")

    # Step 1: Exchange code for access token
    token_data = urllib.parse.urlencode({
        "code":          code,
        "client_id":     client_id,
        "client_secret": client_secret,
        "redirect_uri":  redirect_uri,
        "grant_type":    "authorization_code",
    }).encode("utf-8")

    token_req = urllib.request.Request(
        GOOGLE_TOKEN_URL,
        data=token_data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(token_req, timeout=10) as resp:
            tokens = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise OAuthCallbackError(f"Google token exchange failed: {detail}") from e

    access_token = tokens.get("access_token", "")
    if not access_token:
        raise OAuthCallbackError("Google returned no access token.")

    # Step 2: Fetch user info
    userinfo_req = urllib.request.Request(
        GOOGLE_USERINFO_URL,
        headers={"Authorization": f"Bearer {access_token}"}
    )
    try:
        with urllib.request.urlopen(userinfo_req, timeout=10) as resp:
            userinfo = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise OAuthCallbackError(f"Google userinfo fetch failed: {detail}") from e

    return {
        "id":           userinfo.get("sub", ""),
        "name":         userinfo.get("name", "Google User"),
        "email":        userinfo.get("email", ""),
        "avatar":       userinfo.get("picture"),
        "provider":     "google",
        "access_token": access_token,
    }


# ── Facebook ──────────────────────────────────────────────────────────────────

def facebook_is_configured() -> bool:
    return bool(os.environ.get("FACEBOOK_APP_ID") and
                os.environ.get("FACEBOOK_APP_SECRET"))


def facebook_auth_url(redirect_uri: str, state: str) -> str:
    """Build the Facebook authorization URL to redirect the user to."""
    app_id = os.environ.get("FACEBOOK_APP_ID", "")
    if not app_id:
        raise OAuthConfigError(
            "FACEBOOK_APP_ID is not set. "
            "Get credentials at developers.facebook.com"
        )
    params = {
        "client_id":     app_id,
        "redirect_uri":  redirect_uri,
        "state":         state,
        "scope":         "public_profile",
        "response_type": "code",
    }
    return FACEBOOK_AUTH_URL + "?" + urllib.parse.urlencode(params)


def facebook_exchange_code(code: str, redirect_uri: str) -> dict:
    """
    Exchange authorization code for tokens, then fetch user info.
    Returns normalized user dict: { id, name, email, avatar, provider, access_token }
    """
    app_id     = os.environ.get("FACEBOOK_APP_ID", "")
    app_secret = os.environ.get("FACEBOOK_APP_SECRET", "")
    if not app_id or not app_secret:
        raise OAuthConfigError("Facebook OAuth credentials not configured.")

    # Step 1: Exchange code for access token
    token_url = FACEBOOK_TOKEN_URL + "?" + urllib.parse.urlencode({
        "client_id":     app_id,
        "client_secret": app_secret,
        "redirect_uri":  redirect_uri,
        "code":          code,
    })
    try:
        with urllib.request.urlopen(token_url, timeout=10) as resp:
            tokens = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise OAuthCallbackError(f"Facebook token exchange failed: {detail}") from e

    access_token = tokens.get("access_token", "")
    if not access_token:
        raise OAuthCallbackError("Facebook returned no access token.")

    # Step 2: Fetch user info
    userinfo_url = FACEBOOK_USERINFO_URL + f"&access_token={access_token}"
    try:
        with urllib.request.urlopen(userinfo_url, timeout=10) as resp:
            userinfo = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise OAuthCallbackError(f"Facebook userinfo fetch failed: {detail}") from e

    avatar = None
    if userinfo.get("picture", {}).get("data", {}).get("url"):
        avatar = userinfo["picture"]["data"]["url"]

    return {
        "id":           userinfo.get("id", ""),
        "name":         userinfo.get("name", "Facebook User"),
        "email":        userinfo.get("email", ""),
        "avatar":       avatar,
        "provider":     "facebook",
        "access_token": access_token,
    }
