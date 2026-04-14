/**
 * Content Script - UI Action Recorder
 * Captures clicks, input events, and navigation with DOM mutation tracking
 */

(function() {
  // Prevent multiple injections
  if (window.flowTraceContentScriptLoaded) return;
  window.flowTraceContentScriptLoaded = true;

  let isRecording = false;
  let actionBuffer = [];
  let domMutationBuffer = [];
  const CORRELATION_WINDOW = 1500; // ms

  // Inject in-page network interception script so fetch/XHR running in page context are captured.
  (function injectInPageInterceptor() {
    if (window.__flowTraceInPageInjected) return;
    window.__flowTraceInPageInjected = true;

    const inpage = `
      (function() {
        if (window.__flowTraceInPageScript) return;
        window.__flowTraceInPageScript = true;

        function sendToContent(apiCall) {
          try {
            window.postMessage({ source: 'flowtrace-inpage', type: 'API_CALL', apiCall: apiCall }, '*');
          } catch (e) {}
        }

        // Wrap fetch
        try {
          const originalFetch = window.fetch.bind(window);
          window.fetch = async function(input, init) {
            const method = (init && init.method) || (typeof input === 'object' && input.method) || 'GET';
            const url = (typeof input === 'string') ? input : (input && input.url) || '';
            const requestBody = init && init.body ? init.body : null;
            try {
              const response = await originalFetch(input, init);
              const clone = response.clone();
              let bodyText = null;
              try { bodyText = await clone.text(); } catch (e) { bodyText = null; }
              sendToContent({ method, url, status: response.status, requestBody, responseBody: bodyText });
              return response;
            } catch (err) {
              sendToContent({ method, url, status: err.status || null, requestBody, responseBody: null, error: err.message });
              throw err;
            }
          };
        } catch (e) {}

        // Wrap XHR
        try {
          const OriginalXHR = window.XMLHttpRequest;
          function FlowTraceXHR() {
            const xhr = new OriginalXHR();
            let method = null; let url = null; let requestBody = null;
            const origOpen = xhr.open;
            xhr.open = function(m, u) { method = m; url = u; return origOpen.apply(xhr, arguments); };
            const origSend = xhr.send;
            xhr.send = function(body) {
              requestBody = body;
              xhr.addEventListener('readystatechange', function() {
                if (xhr.readyState === 4) {
                  let resp = null;
                  try { resp = xhr.responseText; } catch (e) { resp = null; }
                  sendToContent({ method: method || 'GET', url: url || '', status: xhr.status || null, requestBody, responseBody: resp });
                }
              });
              return origSend.apply(xhr, arguments);
            };
            return xhr;
          }
          window.XMLHttpRequest = FlowTraceXHR;
        } catch (e) {}
      })();
    `;

    const script = document.createElement('script');
    script.textContent = inpage;
    (document.head || document.documentElement).appendChild(script);
    script.remove();

    // Listen for messages from in-page script and forward to background
    window.addEventListener('message', (event) => {
      if (!event.data || event.data.source !== 'flowtrace-inpage') return;
      try {
        chrome.runtime.sendMessage({ type: 'API_CALL', apiCall: event.data.apiCall }, () => {});
      } catch (e) {}
    });
  })();

  // Selector utility (inline for content script)
  const SelectorUtils = {
    getStableSelector(element) {
      if (!element) return { selector: null, type: null, xpath: null };

      if (element.id && element.id.trim() !== '') {
        return { selector: `#${element.id}`, type: 'id', xpath: this.getXPath(element) };
      }

      const dataAttr = this.getDataAttribute(element);
      if (dataAttr) {
        return { selector: `[${dataAttr.name}="${dataAttr.value}"]`, type: 'data-attribute', xpath: this.getXPath(element) };
      }

      if (element.name && element.name.trim() !== '') {
        return { selector: `[name="${element.name}"]`, type: 'name', xpath: this.getXPath(element) };
      }

      if (element.className && typeof element.className === 'string' && element.className.trim() !== '') {
        const classes = element.className.trim().split(/\s+/).slice(0, 2);
        return { selector: `${element.tagName.toLowerCase()}.${classes.join('.')}`, type: 'class', xpath: this.getXPath(element) };
      }

      const xpath = this.getXPath(element);
      return { selector: xpath, type: 'xpath', xpath: xpath };
    },

    getDataAttribute(element) {
      if (!element.attributes) return null;
      for (let attr of element.attributes) {
        if (attr.name.startsWith('data-') && attr.value && attr.value.trim() !== '') {
          return { name: attr.name, value: attr.value };
        }
      }
      return null;
    },

    getXPath(element) {
      if (!element) return null;
      const parts = [];
      let current = element;
      while (current && current.nodeType === Node.ELEMENT_NODE) {
        let index = 1;
        let sibling = current.previousSibling;
        while (sibling) {
          if (sibling.nodeType === Node.ELEMENT_NODE && sibling.nodeName === current.nodeName) index++;
          sibling = sibling.previousSibling;
        }
        const tagName = current.nodeName.toLowerCase();
        const position = index > 1 ? `[${index}]` : '';
        parts.unshift(`${tagName}${position}`);
        current = current.parentNode;
      }
      return parts.length ? '/' + parts.join('/') : null;
    }
  };

  /**
   * Record a UI action
   */
  function recordAction(action) {
    if (!isRecording) return;
    
    action.timestamp = Date.now();
    action.url = window.location.href;
    actionBuffer.push(action);
    
    // Send to background immediately (use callback-style to avoid Promise rejection)
    try {
      chrome.runtime.sendMessage({ type: 'UI_ACTION', action: action }, () => {
        const err = chrome.runtime.lastError;
        if (err) {
          // Background may not be ready; ignore
        }
      });
    } catch (e) {
      // Ignore synchronous send errors
    }
  }

  /**
   * Track DOM mutations after actions
   */
  function recordDomMutation(mutations) {
    if (!isRecording) return;
    
    const changes = mutations.map(mutation => ({
      type: mutation.type,
      target: SelectorUtils.getStableSelector(mutation.target),
      addedNodes: mutation.addedNodes.length,
      removedNodes: mutation.removedNodes.length,
      attributeName: mutation.attributeName,
      timestamp: Date.now()
    }));
    
    domMutationBuffer.push({
      timestamp: Date.now(),
      changes: changes
    });
    // Forward mutations to background for correlation
    try {
      chrome.runtime.sendMessage({ type: 'DOM_MUTATION', mutation: { timestamp: Date.now(), changes: changes } }, () => {});
    } catch (e) {}
  }

  // Setup Mutation Observer
  const mutationObserver = new MutationObserver((mutations) => {
    if (isRecording && mutations.length > 0) {
      recordDomMutation(mutations);
    }
  });

  // Listen for explicit flowtrace mutation events dispatched by the page
  window.addEventListener('flowtrace:mutation', (e) => {
    if (!isRecording) return;
    const detail = e && e.detail ? e.detail : { timestamp: Date.now(), eventName: 'unknown' };
    try {
      chrome.runtime.sendMessage({ type: 'DOM_MUTATION', mutation: { timestamp: detail.timestamp || Date.now(), changes: [{ eventName: detail.eventName }] } }, () => {});
    } catch (err) {}
  });

  /**
   * Click event handler
   */
  function handleClick(event) {
    if (!isRecording) return;
    
    const target = event.target;
    const selector = SelectorUtils.getStableSelector(target);
    
    recordAction({
      type: 'click',
      selector: selector.selector,
      selectorType: selector.type,
      xpath: selector.xpath,
      elementTag: target.tagName ? target.tagName.toLowerCase() : 'unknown',
      elementText: target.textContent ? target.textContent.trim().substring(0, 50) : '',
      coordinates: { x: event.clientX, y: event.clientY }
    });
  }

  /**
   * Input event handler
   */
  function handleInput(event) {
    if (!isRecording) return;
    
    const target = event.target;
    const selector = SelectorUtils.getStableSelector(target);
    const tagName = target.tagName ? target.tagName.toLowerCase() : '';
    
    // Skip hidden or non-interactive elements
    if (tagName === 'body' || tagName === 'html') return;
    
    recordAction({
      type: 'input',
      selector: selector.selector,
      selectorType: selector.type,
      xpath: selector.xpath,
      elementTag: tagName,
      elementType: target.type || null,
      elementName: target.name || null,
      inputValue: target.value ? target.value.substring(0, 200) : '',
      placeholder: target.placeholder || null
    });
  }

  /**
   * Focus/Blur tracking for form interactions
   */
  function handleFocus(event) {
    if (!isRecording) return;
    
    const target = event.target;
    const selector = SelectorUtils.getStableSelector(target);
    const tagName = target.tagName ? target.tagName.toLowerCase() : '';
    
    if (['input', 'textarea', 'select'].includes(tagName)) {
      recordAction({
        type: 'focus',
        selector: selector.selector,
        selectorType: selector.type,
        xpath: selector.xpath,
        elementTag: tagName,
        elementType: target.type || null
      });
    }
  }

  /**
   * Track page navigation (beforeunload)
   */
  function handleBeforeUnload(event) {
    if (!isRecording) return;
    
    recordAction({
      type: 'navigation',
      fromUrl: window.location.href,
      timestamp: Date.now()
    });
  }

  /**
   * Track history changes (SPA navigation)
   */
  function trackHistoryChanges() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    
    history.pushState = function(...args) {
      originalPushState.apply(this, args);
      if (isRecording) {
        recordAction({
          type: 'spa_navigation',
          navigationType: 'pushState',
          url: window.location.href,
          timestamp: Date.now()
        });
      }
    };
    
    history.replaceState = function(...args) {
      originalReplaceState.apply(this, args);
      if (isRecording) {
        recordAction({
          type: 'spa_navigation',
          navigationType: 'replaceState',
          url: window.location.href,
          timestamp: Date.now()
        });
      }
    };
    
    window.addEventListener('popstate', () => {
      if (isRecording) {
        recordAction({
          type: 'spa_navigation',
          navigationType: 'popstate',
          url: window.location.href,
          timestamp: Date.now()
        });
      }
    });
  }

  /**
   * Start recording
   */
  function startRecording() {
    isRecording = true;
    actionBuffer = [];
    domMutationBuffer = [];
    
    // Add event listeners
    document.addEventListener('click', handleClick, true);
    document.addEventListener('input', handleInput, true);
    document.addEventListener('focus', handleFocus, true);
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    // Start mutation observer
    mutationObserver.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });
    
    console.log('[FlowTrace] Recording started');
  }

  /**
   * Stop recording
   */
  function stopRecording() {
    isRecording = false;
    
    // Remove event listeners
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('input', handleInput, true);
    document.removeEventListener('focus', handleFocus, true);
    window.removeEventListener('beforeunload', handleBeforeUnload);
    
    // Stop mutation observer
    mutationObserver.disconnect();
    
    console.log('[FlowTrace] Recording stopped');
  }

  /**
   * Get recorded data
   */
  function getRecordedData() {
    return {
      actions: actionBuffer,
      domMutations: domMutationBuffer,
      url: window.location.href,
      timestamp: Date.now()
    };
  }

  /**
   * Clear recorded data
   */
  function clearData() {
    actionBuffer = [];
    domMutationBuffer = [];
  }

  // Message listener for background/panel communication
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'START_RECORDING':
        startRecording();
        sendResponse({ success: true, status: 'recording' });
        break;
      
      case 'STOP_RECORDING':
        stopRecording();
        sendResponse({ success: true, status: 'stopped', data: getRecordedData() });
        break;
      
      case 'GET_DATA':
        sendResponse({ success: true, data: getRecordedData() });
        break;
      
      case 'CLEAR_DATA':
        clearData();
        sendResponse({ success: true });
        break;
      
      case 'IS_RECORDING':
        sendResponse({ success: true, isRecording: isRecording });
        break;
      
      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }
    
    return true; // Keep channel open for async response
  });

  // Initialize history tracking
  trackHistoryChanges();
  
  console.log('[FlowTrace] Content script loaded');
})();
