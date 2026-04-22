"""
ARES Self-Healing Selenium Framework
=====================================
Wraps Selenium's findElement calls with:
  1. Detection  — try/except around every locator
  2. Context    — extracts relevant DOM snippet on failure
  3. LLM Repair — sends DOM + old selector to Claude API
  4. Execution  — retries with healed selector
  5. Logging    — persists all healed elements to heal_log.json

Usage:
    driver = webdriver.Chrome(...)
    framework = SelfHealingDriver(driver, api_key="sk-ant-...")
    element = framework.find("login-btn", By.ID)
"""

import json
import os
import time
import re
import hashlib
import urllib.request
import urllib.error
from datetime import datetime
from typing import Optional

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webelement import WebElement
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import (
    NoSuchElementException,
    TimeoutException,
    StaleElementReferenceException
)

HEAL_LOG_PATH = "heal_log.json"
LLM_MODEL     = "claude-sonnet-4-20250514"


class HealedElement:
    """Records a single self-healing event."""
    def __init__(self, original_by, original_value, healed_by, healed_value,
                 url, timestamp, llm_reasoning=""):
        self.original_by    = original_by
        self.original_value = original_value
        self.healed_by      = healed_by
        self.healed_value   = healed_value
        self.url            = url
        self.timestamp      = timestamp
        self.llm_reasoning  = llm_reasoning

    def to_dict(self):
        return {
            "original_selector": f"{self.original_by}={self.original_value}",
            "healed_selector":   f"{self.healed_by}={self.healed_value}",
            "url":               self.url,
            "timestamp":         self.timestamp,
            "llm_reasoning":     self.llm_reasoning
        }


class SelfHealingDriver:
    """
    Wraps a Selenium WebDriver with self-healing find_element capabilities.

    Parameters
    ----------
    driver      : Selenium WebDriver instance
    api_key     : Anthropic API key (falls back to ANTHROPIC_API_KEY env var)
    timeout     : Default explicit wait timeout in seconds
    dom_window  : Characters of page source to send to LLM (trimmed around failure)
    """

    def __init__(self, driver: webdriver.Remote,
                 api_key: str = "",
                 timeout: int = 10,
                 dom_window: int = 6000):
        self.driver     = driver
        self.api_key    = api_key or os.environ.get("ANTHROPIC_API_KEY", "")
        self.timeout    = timeout
        self.dom_window = dom_window
        self._heal_log: list = []
        self._cache: dict    = {}   # original_selector -> (healed_by, healed_value)

    # ── Public API ────────────────────────────────────────────────────────────

    def find(self, value: str, by: str = By.ID,
             wait: bool = True) -> Optional[WebElement]:
        """
        Find an element with automatic self-healing on failure.
        """
        # Check cache first
        cache_key = f"{by}::{value}"
        if cache_key in self._cache:
            healed_by, healed_value = self._cache[cache_key]
            try:
                return self._locate(healed_by, healed_value, wait)
            except (NoSuchElementException, TimeoutException):
                del self._cache[cache_key]  # cached selector also broken

        # Normal attempt
        try:
            return self._locate(by, value, wait)
        except (NoSuchElementException, TimeoutException):
            print(f"  [HEAL] Element not found: {by}='{value}'")
            return self._heal(by, value)

    def find_all(self, value: str, by: str = By.CSS_SELECTOR) -> list:
        """Find multiple elements; returns [] on failure."""
        try:
            return self.driver.find_elements(by, value)
        except Exception:
            return []

    def click(self, value: str, by: str = By.ID) -> bool:
        el = self.find(value, by)
        if el:
            el.click()
            return True
        return False

    def type_into(self, value: str, text: str, by: str = By.ID,
                  clear_first: bool = True) -> bool:
        el = self.find(value, by)
        if el:
            if clear_first:
                el.clear()
            el.send_keys(text)
            return True
        return False

    def save_heal_log(self, path: str = HEAL_LOG_PATH):
        existing = []
        try:
            with open(path, "r") as f:
                existing = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            pass
        existing.extend([h.to_dict() for h in self._heal_log])
        with open(path, "w") as f:
            json.dump(existing, f, indent=2)
        print(f"  [HEAL] Log saved → {path} ({len(self._heal_log)} new entries)")

    @property
    def heal_count(self) -> int:
        return len(self._heal_log)

    # ── Private ───────────────────────────────────────────────────────────────

    def _locate(self, by: str, value: str, wait: bool) -> WebElement:
        if wait:
            return WebDriverWait(self.driver, self.timeout).until(
                EC.presence_of_element_located((by, value))
            )
        return self.driver.find_element(by, value)

    def _heal(self, original_by: str, original_value: str) -> Optional[WebElement]:
        """Extract DOM context, call LLM, apply healed selector."""
        dom_snippet = self._extract_dom_context(original_by, original_value)
        url         = self.driver.current_url

        healed_by, healed_value, reasoning = self._llm_repair(
            original_by, original_value, dom_snippet, url
        )

        if not healed_value:
            print(f"  [HEAL] LLM could not repair selector: {original_by}='{original_value}'")
            return None

        print(f"  [HEAL] Healed: {original_by}='{original_value}' → {healed_by}='{healed_value}'")

        try:
            element = self._locate(healed_by, healed_value, wait=True)
        except (NoSuchElementException, TimeoutException):
            print(f"  [HEAL] Healed selector also failed: {healed_by}='{healed_value}'")
            return None

        # Cache & log
        cache_key = f"{original_by}::{original_value}"
        self._cache[cache_key] = (healed_by, healed_value)
        self._heal_log.append(HealedElement(
            original_by=original_by,
            original_value=original_value,
            healed_by=healed_by,
            healed_value=healed_value,
            url=url,
            timestamp=datetime.utcnow().isoformat(),
            llm_reasoning=reasoning
        ))
        return element

    def _extract_dom_context(self, by: str, value: str) -> str:
        """
        Extract a relevant slice of the page DOM to send to the LLM.
        We try to capture the form region most likely to contain the element.
        """
        try:
            full_source = self.driver.page_source

            # Heuristic: find the area around the original value string
            idx = full_source.lower().find(value.lower())
            if idx == -1:
                # Value not found — send the whole (truncated) source
                return full_source[:self.dom_window]

            half = self.dom_window // 2
            start = max(0, idx - half)
            end   = min(len(full_source), idx + half)
            return full_source[start:end]
        except Exception:
            return ""

    def _llm_repair(self, original_by: str, original_value: str,
                    dom_snippet: str, url: str):
        """
        Send the broken selector + DOM to Claude API.
        Returns (by_strategy, selector_value, reasoning).
        Falls back to heuristic scan if API unavailable.
        """
        if not self.api_key:
            return self._heuristic_repair(original_by, original_value)

        system_prompt = (
            "You are a Selenium self-healing engine. "
            "You receive a broken CSS/XPath selector and a DOM snippet. "
            "You must respond ONLY with a JSON object — no markdown, no explanation — with these exact fields:\n"
            '{"strategy": "css"|"xpath"|"id"|"name"|"class_name"|"tag_name", '
            '"selector": "<valid selector string>", '
            '"reasoning": "<one sentence>"}\n'
            "The selector must target the element the broken one was looking for. "
            "Never invent attributes that don't exist in the DOM. "
            "Prefer CSS selectors unless XPath is clearly better. "
            "If you cannot find a valid selector, return: "
            '{"strategy": "css", "selector": "", "reasoning": "element not present"}'
        )

        user_content = (
            f"Broken selector: by={original_by}, value=\"{original_value}\"\n"
            f"Page URL: {url}\n\n"
            f"DOM snippet:\n```html\n{dom_snippet[:4000]}\n```\n\n"
            "Find the most likely replacement selector for this element."
        )

        payload = json.dumps({
            "model":    LLM_MODEL,
            "max_tokens": 300,
            "system":   system_prompt,
            "messages": [{"role": "user", "content": user_content}]
        }).encode("utf-8")

        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=payload,
            headers={
                "Content-Type":      "application/json",
                "x-api-key":         self.api_key,
                "anthropic-version": "2023-06-01"
            },
            method="POST"
        )

        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = json.loads(resp.read().decode("utf-8"))
                text = body["content"][0]["text"].strip()
                text = text.lstrip("```json").lstrip("```").rstrip("```").strip()
                result = json.loads(text)
                strategy  = result.get("strategy", "css")
                selector  = result.get("selector", "")
                reasoning = result.get("reasoning", "")

                by_map = {
                    "css":        By.CSS_SELECTOR,
                    "xpath":      By.XPATH,
                    "id":         By.ID,
                    "name":       By.NAME,
                    "class_name": By.CLASS_NAME,
                    "tag_name":   By.TAG_NAME
                }
                return by_map.get(strategy, By.CSS_SELECTOR), selector, reasoning

        except Exception as e:
            print(f"  [HEAL] LLM API error: {e} — falling back to heuristics")
            return self._heuristic_repair(original_by, original_value)

    def _heuristic_repair(self, original_by: str, original_value: str):
        """
        Fallback heuristic: scan all interactive elements and score them
        against the original selector value using string similarity.
        """
        try:
            candidates = self.driver.find_elements(
                By.CSS_SELECTOR,
                "input, button, a, [role='button'], [type='submit']"
            )
            best_score  = 0
            best_el_css = ""

            tokens = set(re.split(r'[-_\s]+', original_value.lower()))
            login_keywords = {"login", "signin", "sign", "submit", "btn", "button"}
            is_login_target = bool(tokens & login_keywords)

            for el in candidates:
                score = 0
                el_id   = (el.get_attribute("id")    or "").lower()
                el_name = (el.get_attribute("name")  or "").lower()
                el_cls  = (el.get_attribute("class") or "").lower()
                el_text = (el.text or "").lower()
                el_type = (el.get_attribute("type")  or "").lower()
                el_tag  = el.tag_name.lower()
                el_href = (el.get_attribute("href")  or "").lower()

                for tok in tokens:
                    if tok and tok in el_id:   score += 40
                    if tok and tok in el_name: score += 30
                    if tok and tok in el_cls:  score += 20
                    if tok and tok in el_text: score += 15

                # Strong bonus for actual submit/button on login targets
                if is_login_target and el_type == "submit":
                    score += 50
                if is_login_target and el_tag == "button":
                    score += 30

                # Heavy penalty: social auth links are NOT the login submit button
                if is_login_target and any(
                    s in el_id for s in ["google", "facebook", "social", "twitter"]
                ):
                    score -= 80
                if is_login_target and any(
                    s in el_href for s in ["/auth/google", "/auth/facebook"]
                ):
                    score -= 80

                if score > best_score:
                    best_score = score
                    eid = el.get_attribute("id")
                    if eid:
                        best_el_css = f"#{eid}"
                    else:
                        tag  = el.tag_name
                        cls  = el.get_attribute("class") or ""
                        first_cls = cls.split()[0] if cls else ""
                        best_el_css = f"{tag}.{first_cls}" if first_cls else tag

            if best_score > 0 and best_el_css:
                return By.CSS_SELECTOR, best_el_css, f"Heuristic match (score={best_score})"

        except Exception as e:
            print(f"  [HEAL] Heuristic error: {e}")

        return By.CSS_SELECTOR, "", "No suitable element found"
