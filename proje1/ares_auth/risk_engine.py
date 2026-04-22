"""
ARES Risk Engine
================
Risk Score Formula:
    R = min(F_score + IP_score + UA_score + T_score, 100)

    Factor              | Condition                        | Points
    --------------------|----------------------------------|-------
    F_score (failures)  | 1-2 failures                     | +15
                        | 3-4 failures                     | +35
                        | 5-9 failures                     | +55
                        | 10+ failures                     | +75
    IP_score (new IP)   | IP never seen for this user      | +20
    UA_score (bad UA)   | Known automation tool keyword    | +30
    T_score (time)      | Login between 00:00-05:00 UTC    | +10

    LLM fraud analysis triggered when R >= 60.
    Account locked when failures >= LOCKOUT_THRESHOLD (5).

    REQUIRES: ANTHROPIC_API_KEY environment variable.
    If the key is missing or the API call fails, llm_analysis is set to
    None and the reason is logged to the server console. No fallback logic.
"""

import time
import json
import os
import hashlib
import urllib.request
import urllib.error
from datetime import datetime, timezone

# ── Constants ────────────────────────────────────────────────────────────────
LOCKOUT_THRESHOLD = 5
LOCKOUT_DURATION  = 60      # seconds
LLM_TRIGGER_SCORE = 60
FRAUD_LOG_PATH    = "fraud_log.json"

FAILURE_SCORE_TABLE = [
    (10, 75),
    (5,  55),
    (3,  35),
    (1,  15),
    (0,   0),
]

IP_NEW_SCORE  = 20
UA_SUSPICIOUS = 30
TIME_ANOMALY  = 10

SUSPICIOUS_UA_KEYWORDS = [
    "sqlmap", "nikto", "nmap", "masscan", "zgrab",
    "python-requests", "go-http-client", "curl/",
    "wget/", "libwww", "scrapy", "hydra", "burpsuite"
]

NIGHT_HOUR_START = 0
NIGHT_HOUR_END   = 5


class LLMUnavailableError(Exception):
    """Raised when the Claude API cannot be reached or returns an error."""
    pass


class RiskEngine:
    def __init__(self):
        self._state: dict     = {}   # { identifier -> state dict }
        self._known_ips: dict = {}   # { identifier -> [ip, ...] }
        self._llm_cache: dict = {}   # { cache_key -> llm result }
        self._fraud_log: list = []   # in-memory copy of fraud_log.json

    # ── Public API ────────────────────────────────────────────────────────────

    def assess(self, identifier: str, ip: str, user_agent: str) -> dict:
        state = self._get_state(identifier)
        now   = time.time()

        # Lockout check
        if state["locked_until"] and now < state["locked_until"]:
            remaining = int(state["locked_until"] - now)
            return {
                "risk_score":      100,
                "blocked":         True,
                "lockout_remaining": remaining,
                "score_breakdown": {"F_score": 75, "IP_score": 0,
                                    "UA_score": 0,  "T_score": 0},
                "reasons":         [f"Account locked — {remaining}s remaining"],
                "llm_analysis":    None,
                "llm_error":       None,
            }

        failures  = state["failures"]
        breakdown = {}
        reasons   = []

        # F_score
        f_score = next(pts for (thresh, pts) in FAILURE_SCORE_TABLE
                       if failures >= thresh)
        breakdown["F_score"] = f_score
        if f_score > 0:
            reasons.append(f"Failed login attempts: {failures} (+{f_score} pts)")

        # IP_score
        ip_score = 0
        if identifier and ip not in self._known_ips.get(identifier, []):
            ip_score = IP_NEW_SCORE
            reasons.append(f"Login from unrecognised IP {ip} (+{ip_score} pts)")
        breakdown["IP_score"] = ip_score

        # UA_score
        ua_score = 0
        ua_hit   = next((kw for kw in SUSPICIOUS_UA_KEYWORDS
                         if kw in user_agent.lower()), None)
        if ua_hit:
            ua_score = UA_SUSPICIOUS
            reasons.append(f"Automation tool in user-agent: '{ua_hit}' (+{ua_score} pts)")
        breakdown["UA_score"] = ua_score

        # T_score
        t_score  = 0
        utc_hour = datetime.now(timezone.utc).hour
        if NIGHT_HOUR_START <= utc_hour < NIGHT_HOUR_END:
            t_score = TIME_ANOMALY
            reasons.append(f"Unusual login hour {utc_hour:02d}:xx UTC (+{t_score} pts)")
        breakdown["T_score"] = t_score

        total = min(f_score + ip_score + ua_score + t_score, 100)

        # LLM analysis — only when threshold is exceeded
        llm_analysis = None
        llm_error    = None
        if total >= LLM_TRIGGER_SCORE:
            try:
                llm_analysis = self._llm_analyze(
                    identifier, ip, user_agent,
                    failures, reasons, breakdown, total
                )
            except LLMUnavailableError as e:
                llm_error = str(e)
                print(f"  [RISK] LLM unavailable — analysis skipped: {e}")

        return {
            "risk_score":      total,
            "blocked":         False,
            "lockout_remaining": 0,
            "score_breakdown": breakdown,
            "reasons":         reasons,
            "llm_analysis":    llm_analysis,
            "llm_error":       llm_error,
        }

    def record_failure(self, identifier: str, ip: str, user_agent: str):
        state = self._get_state(identifier)
        state["failures"]    += 1
        state["last_failure"] = time.time()
        state["last_ip"]      = ip
        state["history"].append({
            "ts":         datetime.utcnow().isoformat(),
            "ip":         ip,
            "user_agent": user_agent[:120],
        })
        if state["failures"] >= LOCKOUT_THRESHOLD:
            state["locked_until"] = time.time() + LOCKOUT_DURATION

    def reset_failures(self, identifier: str):
        if identifier in self._state:
            self._state[identifier]["failures"]    = 0
            self._state[identifier]["locked_until"] = None

    def register_known_ip(self, identifier: str, ip: str):
        if identifier not in self._known_ips:
            self._known_ips[identifier] = []
        if ip not in self._known_ips[identifier]:
            self._known_ips[identifier].append(ip)

    def get_state(self, identifier: str) -> dict:
        s = self._get_state(identifier)
        return {
            "identifier":   identifier,
            "failures":     s["failures"],
            "locked_until": s["locked_until"],
            "is_locked":    bool(s["locked_until"] and time.time() < s["locked_until"]),
            "known_ips":    self._known_ips.get(identifier, []),
            "history":      s["history"][-10:],
        }

    def get_fraud_log(self) -> list:
        return list(self._fraud_log)

    # ── Private ───────────────────────────────────────────────────────────────

    def _get_state(self, identifier: str) -> dict:
        if identifier not in self._state:
            self._state[identifier] = {
                "failures":    0,
                "last_failure": None,
                "locked_until": None,
                "last_ip":      None,
                "history":      [],
            }
        return self._state[identifier]

    def _llm_analyze(self, identifier, ip, user_agent,
                     failures, reasons, breakdown, risk_score) -> dict:
        """
        Call Claude API for fraud analysis. Raises LLMUnavailableError on
        any failure — no fallback, no silent swallowing of errors.
        Only successful responses are cached and persisted.
        """
        cache_key = hashlib.md5(
            f"{identifier}{ip}{failures}{risk_score}".encode()
        ).hexdigest()
        if cache_key in self._llm_cache:
            return self._llm_cache[cache_key]

        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not api_key:
            raise LLMUnavailableError(
                "ANTHROPIC_API_KEY is not set. "
                "Set it with: export ANTHROPIC_API_KEY=sk-ant-..."
            )

        history = self._get_state(identifier)["history"]
        history_text = "\n".join(
            f"  [{i+1}] {h['ts']}  IP={h['ip']}  UA={h['user_agent'][:80]}"
            for i, h in enumerate(history[-5:])
        ) or "  (no previous attempts recorded)"

        system_prompt = (
            "You are ARES, an AI-powered security fraud-analysis engine. "
            "You receive a structured login event log and must decide whether "
            "to ALLOW, CHALLENGE, or BLOCK the attempt.\n\n"
            "Risk Score Formula:\n"
            "  R = F_score + IP_score + UA_score + T_score  (max 100)\n"
            "  F_score : 1-2 failures=15, 3-4=35, 5-9=55, 10+=75\n"
            "  IP_score: unknown IP=+20\n"
            "  UA_score: automation tool in UA=+30\n"
            "  T_score : login at 00:00-05:00 UTC=+10\n"
            "  LLM triggered when R >= 60\n\n"
            "Respond ONLY with a JSON object — no markdown, no explanation.\n"
            "Exact fields required:\n"
            '{"verdict":"ALLOW"|"CHALLENGE"|"BLOCK",'
            '"confidence":<0-100>,'
            '"summary":"<one sentence>",'
            '"recommended_action":"<specific action>",'
            '"threat_level":"LOW"|"MEDIUM"|"HIGH"|"CRITICAL"}'
        )

        user_content = (
            f"=== LOGIN EVENT LOG ===\n"
            f"Timestamp      : {datetime.utcnow().isoformat()} UTC\n"
            f"Identifier     : {identifier}\n"
            f"IP Address     : {ip}\n"
            f"User-Agent     : {user_agent[:200]}\n"
            f"Failed Attempts: {failures}\n\n"
            f"Score Breakdown:\n"
            f"  F_score  : +{breakdown.get('F_score', 0)}\n"
            f"  IP_score : +{breakdown.get('IP_score', 0)}\n"
            f"  UA_score : +{breakdown.get('UA_score', 0)}\n"
            f"  T_score  : +{breakdown.get('T_score', 0)}\n"
            f"  TOTAL    :  {risk_score}/100\n\n"
            f"Active Triggers:\n"
            + "\n".join(f"  - {r}" for r in reasons) + "\n\n"
            f"Recent History (last 5):\n{history_text}\n\n"
            "Return your JSON verdict."
        )

        payload = json.dumps({
            "model":      "claude-sonnet-4-20250514",
            "max_tokens": 400,
            "system":     system_prompt,
            "messages":   [{"role": "user", "content": user_content}]
        }).encode("utf-8")

        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=payload,
            headers={
                "Content-Type":      "application/json",
                "x-api-key":         api_key,
                "anthropic-version": "2023-06-01"
            },
            method="POST"
        )

        # All exceptions propagate as LLMUnavailableError — no silent fallback
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")[:200]
            raise LLMUnavailableError(f"HTTP {e.code}: {detail}") from e
        except urllib.error.URLError as e:
            raise LLMUnavailableError(f"Network error: {e.reason}") from e
        except Exception as e:
            raise LLMUnavailableError(f"{type(e).__name__}: {e}") from e

        # Parse the LLM response
        try:
            text   = body["content"][0]["text"].strip()
            text   = text.lstrip("```json").lstrip("```").rstrip("```").strip()
            result = json.loads(text)
        except (KeyError, json.JSONDecodeError) as e:
            raise LLMUnavailableError(f"Invalid JSON from LLM: {e}") from e

        result["_source"] = "llm"
        print(f"  [RISK] LLM verdict={result.get('verdict')} "
              f"threat={result.get('threat_level')} "
              f"confidence={result.get('confidence')}%")

        # Cache and persist only on success
        self._llm_cache[cache_key] = result
        self._persist(identifier, ip, user_agent, failures,
                      breakdown, risk_score, result)
        return result

    def _persist(self, identifier, ip, user_agent,
                 failures, breakdown, risk_score, analysis):
        """Append a successful LLM analysis to fraud_log.json."""
        entry = {
            "timestamp":          datetime.utcnow().isoformat() + "Z",
            "identifier":         identifier,
            "ip":                 ip,
            "user_agent":         user_agent[:200],
            "failures":           failures,
            "risk_score":         risk_score,
            "score_breakdown":    breakdown,
            "verdict":            analysis.get("verdict"),
            "threat_level":       analysis.get("threat_level"),
            "confidence":         analysis.get("confidence"),
            "summary":            analysis.get("summary"),
            "recommended_action": analysis.get("recommended_action"),
            "source":             "llm",
        }
        self._fraud_log.append(entry)
        existing = []
        try:
            with open(FRAUD_LOG_PATH, "r") as f:
                existing = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            pass
        existing.append(entry)
        with open(FRAUD_LOG_PATH, "w") as f:
            json.dump(existing, f, indent=2)
