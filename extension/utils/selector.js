/**
 * Selector Utility - Generate stable selectors for DOM elements
 * Priority: id > data-* > name > class > xpath
 */

const SelectorUtils = {
  /**
   * Generate the most stable selector for an element
   * @param {HTMLElement} element - Target DOM element
   * @returns {Object} - { selector, type, xpath }
   */
  getStableSelector(element) {
    if (!element) return { selector: null, type: null, xpath: null };

    // Try ID (most stable)
    if (element.id && element.id.trim() !== '') {
      return {
        selector: `#${element.id}`,
        type: 'id',
        xpath: this.getXPath(element)
      };
    }

    // Try data-* attributes (very stable)
    const dataAttr = this.getDataAttribute(element);
    if (dataAttr) {
      return {
        selector: `[${dataAttr.name}="${dataAttr.value}"]`,
        type: 'data-attribute',
        xpath: this.getXPath(element)
      };
    }

    // Try name attribute (forms)
    if (element.name && element.name.trim() !== '') {
      return {
        selector: `[name="${element.name}"]`,
        type: 'name',
        xpath: this.getXPath(element)
      };
    }

    // Try class + tag (moderately stable)
    if (element.className && typeof element.className === 'string' && element.className.trim() !== '') {
      const classes = element.className.trim().split(/\s+/).slice(0, 2);
      return {
        selector: `${element.tagName.toLowerCase()}.${classes.join('.')}`,
        type: 'class',
        xpath: this.getXPath(element)
      };
    }

    // Fallback to XPath (least stable but always works)
    const xpath = this.getXPath(element);
    return {
      selector: xpath,
      type: 'xpath',
      xpath: xpath
    };
  },

  /**
   * Get first available data-* attribute
   * @param {HTMLElement} element
   * @returns {Object|null} - { name, value } or null
   */
  getDataAttribute(element) {
    if (!element.attributes) return null;
    
    for (let attr of element.attributes) {
      if (attr.name.startsWith('data-') && attr.value && attr.value.trim() !== '') {
        return { name: attr.name, value: attr.value };
      }
    }
    return null;
  },

  /**
   * Generate XPath for an element
   * @param {HTMLElement} element
   * @returns {string} - XPath expression
   */
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

  /**
   * Get element description for logging
   * @param {HTMLElement} element
   * @returns {string} - Human-readable description
   */
  getElementDescription(element) {
    if (!element) return 'unknown element';
    
    const tag = element.tagName ? element.tagName.toLowerCase() : 'unknown';
    const id = element.id ? `#${element.id}` : '';
    const classes = element.className && typeof element.className === 'string' 
      ? `.${element.className.trim().split(/\s+/).join('.')}` 
      : '';
    const text = element.textContent ? ` "${element.textContent.trim().substring(0, 30)}"` : '';
    
    return `<${tag}${id}${classes}>${text}`;
  }
};

// Export for use in content script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SelectorUtils;
}
