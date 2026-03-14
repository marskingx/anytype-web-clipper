/**
 * i18n-helper.js — Chrome i18n helper
 * Works in popup, options page, and service worker contexts.
 * Falls back to key name if translation unavailable.
 */

"use strict";

/**
 * Get translated message by key, with optional substitutions.
 * @param {string} key - Message key from _locales/{locale}/messages.json
 * @param {...string} subs - Substitution values ($1, $2, ...)
 * @returns {string}
 */
function t(key, ...subs) {
  if (!globalThis.chrome || !chrome.i18n || !chrome.i18n.getMessage) return key;
  const msg = chrome.i18n.getMessage(key, subs.length ? subs : undefined);
  return msg || key;
}

/**
 * Apply i18n translations to all elements with data-i18n* attributes.
 * Only call from pages with DOM access (popup, options).
 * @param {Element|Document} root
 */
function applyI18n(root) {
  if (!root) return;
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.getAttribute("data-i18n-placeholder"));
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.getAttribute("data-i18n-title"));
  });
}

// Node.js test support
if (typeof module !== "undefined") module.exports = { t, applyI18n };
