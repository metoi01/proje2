"""
ARES Auth Store
In-memory user database with SHA-256 password hashing.
Pre-seeded with test users for the CS458 project.
"""

import hashlib
import uuid


def _hash(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


class AuthStore:
    def __init__(self):
        # Pre-seeded test users
        self._users: dict = {}
        self._seed_test_users()

    def _seed_test_users(self):
        test_accounts = [
            {"name": "Alice Johnson",  "email": "alice@ares.test",   "phone": "+905001112233", "password": "Test1234!"},
            {"name": "Bob Smith",      "email": "bob@ares.test",     "phone": "+905004445566", "password": "Secure99#"},
            {"name": "Carol White",    "email": "carol@ares.test",   "phone": None,             "password": "Pass@word1"},
            {"name": "Dave Brown",     "email": "dave@ares.test",    "phone": "+905007778899", "password": "Dave2025$"},
            {"name": "Eve (Facebook)", "email": "fb.user@facebook.com", "phone": None,          "password": "FbUser001!"},
            {"name": "Frank (Google)", "email": "google.user@gmail.com","phone": None,          "password": "GoogUser1!"},
        ]
        for acct in test_accounts:
            uid = str(uuid.uuid4())
            key = acct["email"]
            self._users[key] = {
                "id":       uid,
                "name":     acct["name"],
                "email":    acct["email"],
                "phone":    acct.get("phone"),
                "password": _hash(acct["password"]),
                "active":   True
            }
            # Also index by phone if available
            if acct.get("phone"):
                self._users[acct["phone"]] = self._users[key]

    # ── Public API ────────────────────────────────────────────────────────────

    def verify(self, identifier: str, password: str):
        """Return user dict on success, None on failure."""
        user = self._users.get(identifier)
        if user and user["active"] and user["password"] == _hash(password):
            return user
        return None

    def exists(self, identifier: str) -> bool:
        return identifier in self._users

    def create_user(self, name: str, email: str, password: str):
        uid = str(uuid.uuid4())
        self._users[email] = {
            "id":       uid,
            "name":     name,
            "email":    email,
            "phone":    None,
            "password": _hash(password),
            "active":   True
        }

    def list_users(self) -> list:
        """Return unique users without passwords (for /api/users endpoint)."""
        seen = set()
        result = []
        for u in self._users.values():
            if u["id"] not in seen:
                seen.add(u["id"])
                result.append({
                    "id":    u["id"],
                    "name":  u["name"],
                    "email": u["email"],
                    "phone": u.get("phone")
                })
        return result
