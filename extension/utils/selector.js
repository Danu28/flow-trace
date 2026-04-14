/**
 * Selector Utility - Generate durable selector candidates for DOM elements
 * Priority favors automation-friendly attributes before brittle fallbacks.
 */

const SelectorUtils = {
  getStableSelector(element) {
    if (!element) {
      return this.buildEmptyResult();
    }

    const candidates = this.getSelectorCandidates(element);
    const primary = candidates[0] || null;
    const xpath = this.getXPath(element);

    return {
      selector: primary ? primary.value : xpath,
      type: primary ? primary.type : 'xpath',
      xpath,
      candidates,
      primary,
      meta: this.getElementMeta(element)
    };
  },

  getSelectorCandidates(element) {
    const candidates = [];
    const seen = new Set();
    const pushCandidate = (type, value, score) => {
      if (!value || seen.has(value)) return;
      seen.add(value);
      candidates.push({ type, value, score });
    };

    if (element.id && this.isStableValue(element.id)) {
      pushCandidate('id', `#${this.escapeCssValue(element.id)}`, 100);
    }

    this.getPreferredDataAttributes(element).forEach((attr, index) => {
      pushCandidate('data-attribute', `[${attr.name}="${this.escapeAttributeValue(attr.value)}"]`, 95 - index);
    });

    const ariaLabel = element.getAttribute && element.getAttribute('aria-label');
    if (ariaLabel && this.isStableText(ariaLabel)) {
      pushCandidate('aria-label', `[aria-label="${this.escapeAttributeValue(ariaLabel)}"]`, 88);
    }

    if (element.name && this.isStableValue(element.name)) {
      pushCandidate('name', `[name="${this.escapeAttributeValue(element.name)}"]`, 85);
    }

    const role = element.getAttribute && element.getAttribute('role');
    if (role && ariaLabel) {
      pushCandidate('role-label', `[role="${this.escapeAttributeValue(role)}"][aria-label="${this.escapeAttributeValue(ariaLabel)}"]`, 82);
    }

    const placeholder = element.getAttribute && element.getAttribute('placeholder');
    if (placeholder && this.isStableText(placeholder)) {
      pushCandidate('placeholder', `[placeholder="${this.escapeAttributeValue(placeholder)}"]`, 78);
    }

    const tagName = element.tagName ? element.tagName.toLowerCase() : '';
    const text = this.getReadableText(element);
    if (tagName && text) {
      pushCandidate('tag-text', `${tagName}:contains("${text}")`, 65);
    }

    const classSelector = this.getClassSelector(element);
    if (classSelector) {
      pushCandidate('class', classSelector, 55);
    }

    const xpath = this.getXPath(element);
    if (xpath) {
      pushCandidate('xpath', xpath, 30);
    }

    return candidates.sort((a, b) => b.score - a.score);
  },

  getPreferredDataAttributes(element) {
    if (!element.attributes) return [];

    const preferredOrder = [
      'data-testid',
      'data-test',
      'data-qa',
      'data-cy',
      'data-test-id',
      'data-automation',
      'data-automation-id'
    ];

    const attrs = Array.from(element.attributes)
      .filter(attr => attr.name.startsWith('data-') && attr.value && this.isStableValue(attr.value))
      .map(attr => ({ name: attr.name, value: attr.value }));

    attrs.sort((a, b) => {
      const aIndex = preferredOrder.indexOf(a.name);
      const bIndex = preferredOrder.indexOf(b.name);
      const aRank = aIndex === -1 ? preferredOrder.length : aIndex;
      const bRank = bIndex === -1 ? preferredOrder.length : bIndex;
      return aRank - bRank;
    });

    return attrs.slice(0, 3);
  },

  getDataAttribute(element) {
    return this.getPreferredDataAttributes(element)[0] || null;
  },

  getClassSelector(element) {
    if (!element.className || typeof element.className !== 'string') return null;

    const classes = element.className
      .trim()
      .split(/\s+/)
      .filter(cls => this.isStableClassName(cls))
      .slice(0, 2);

    if (!classes.length || !element.tagName) return null;
    return `${element.tagName.toLowerCase()}.${classes.map(cls => this.escapeCssValue(cls)).join('.')}`;
  },

  getElementMeta(element) {
    return {
      tagName: element.tagName ? element.tagName.toLowerCase() : 'unknown',
      role: element.getAttribute ? element.getAttribute('role') || null : null,
      name: element.name || null,
      id: element.id || null,
      text: this.getReadableText(element),
      placeholder: element.getAttribute ? element.getAttribute('placeholder') || null : null,
      ariaLabel: element.getAttribute ? element.getAttribute('aria-label') || null : null
    };
  },

  getReadableText(element) {
    const text = (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ');
    return this.isStableText(text) ? text.substring(0, 60) : '';
  },

  isStableValue(value) {
    if (!value || typeof value !== 'string') return false;
    if (value.length > 80) return false;
    return !/(^|[-_])[0-9a-f]{6,}($|[-_])/i.test(value);
  },

  isStableText(value) {
    if (!value || typeof value !== 'string') return false;
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= 60;
  },

  isStableClassName(value) {
    return this.isStableValue(value) && !/^(ng-|css-|jsx-|sc-|Mui|ant-)/.test(value);
  },

  escapeCssValue(value) {
    return String(value).replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
  },

  escapeAttributeValue(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  },

  getXPath(element) {
    if (!element) return null;

    const parts = [];
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let index = 1;
      let sibling = current.previousSibling;

      while (sibling) {
        if (sibling.nodeType === Node.ELEMENT_NODE && sibling.nodeName === current.nodeName) {
          index++;
        }
        sibling = sibling.previousSibling;
      }

      const tagName = current.nodeName.toLowerCase();
      const position = index > 1 ? `[${index}]` : '';
      parts.unshift(`${tagName}${position}`);
      current = current.parentNode;
    }

    return parts.length ? '/' + parts.join('/') : null;
  },

  buildEmptyResult() {
    return {
      selector: null,
      type: null,
      xpath: null,
      candidates: [],
      primary: null,
      meta: null
    };
  },

  getElementDescription(element) {
    if (!element) return 'unknown element';

    const tag = element.tagName ? element.tagName.toLowerCase() : 'unknown';
    const id = element.id ? `#${element.id}` : '';
    const classes = element.className && typeof element.className === 'string'
      ? `.${element.className.trim().split(/\s+/).slice(0, 2).join('.')}`
      : '';
    const text = this.getReadableText(element) ? ` "${this.getReadableText(element)}"` : '';

    return `<${tag}${id}${classes}>${text}`;
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SelectorUtils;
}

if (typeof globalThis !== 'undefined') {
  globalThis.SelectorUtils = SelectorUtils;
}
