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
      // Build basic apiCall object
      const apiCall = {
        method: request.request.method,
        url: request.request.url,
        status: request.response ? request.response.status : null,
        requestHeaders: request.request.headers || [],
        responseHeaders: request.response ? (request.response.headers || []) : [],
        requestBody: request.request.postData ? request.request.postData.text : null,
        responseBody: null,
        timestamp: Date.now()
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
