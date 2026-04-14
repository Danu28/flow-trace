/**
 * DevTools Script - Creates the FlowTrace panel
 */

chrome.devtools.panels.create(
  'FlowTrace QA',
  '',
  'panel.html',
  (panel) => {
    console.log('[FlowTrace] DevTools panel created');
  }
);

// Network capture: send API calls to background when requests finish
if (chrome && chrome.devtools && chrome.devtools.network && chrome.runtime) {
  chrome.devtools.network.onRequestFinished.addListener((request) => {
    try {
      // Normalize status code (304 = cached 200, treat as 200 for QA)
      const rawStatus = request.response ? request.response.status : null;
      const normalizedStatus = rawStatus === 304 ? 200 : rawStatus;

      // Build basic apiCall object
      const apiCall = {
        tabId: chrome.devtools.inspectedWindow.tabId,
        method: request.request.method,
        url: request.request.url,
        status: normalizedStatus,
        rawStatus: rawStatus,
        requestHeaders: request.request.headers || [],
        responseHeaders: request.response ? (request.response.headers || []) : [],
        requestBody: request.request.postData ? request.request.postData.text : null,
        responseBody: null,
        timestamp: Date.now(),
        capture: {
          source: 'devtools',
          mode: 'devtools-primary'
        }
      };

      // Try to get response body (may be large or unavailable)
      request.getContent((body, encoding) => {
        apiCall.responseBody = body || null;

        // Send to background; background will ignore if not recording
        try {
          chrome.runtime.sendMessage({ type: 'API_CALL', apiCall: apiCall });
        } catch (e) {
          console.debug('[FlowTrace] Failed to send API_CALL to background:', e.message);
        }
      });
    } catch (err) {
      console.debug('[FlowTrace] Error processing network request:', err.message);
    }
  });
}
