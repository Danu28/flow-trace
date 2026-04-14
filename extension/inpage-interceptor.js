(function() {
  if (window.__flowTraceInPageScript) return;
  window.__flowTraceInPageScript = true;

  function sendToContent(apiCall) {
    try {
      window.postMessage({ source: 'flowtrace-inpage', type: 'API_CALL', apiCall }, '*');
    } catch (e) {}
  }

  try {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async function(input, init) {
      const method = (init && init.method) || (typeof input === 'object' && input.method) || 'GET';
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const requestBody = init && init.body ? init.body : null;

      try {
        const response = await originalFetch(input, init);
        const clone = response.clone();
        let bodyText = null;
        try {
          bodyText = await clone.text();
        } catch (e) {
          bodyText = null;
        }

        sendToContent({
          method,
          url,
          status: response.status,
          requestBody,
          responseBody: bodyText
        });

        return response;
      } catch (err) {
        sendToContent({
          method,
          url,
          status: err.status || null,
          requestBody,
          responseBody: null,
          error: err.message
        });
        throw err;
      }
    };
  } catch (e) {}

  try {
    const OriginalXHR = window.XMLHttpRequest;
    function FlowTraceXHR() {
      const xhr = new OriginalXHR();
      let method = null;
      let url = null;
      let requestBody = null;

      const origOpen = xhr.open;
      xhr.open = function(m, u) {
        method = m;
        url = u;
        return origOpen.apply(xhr, arguments);
      };

      const origSend = xhr.send;
      xhr.send = function(body) {
        requestBody = body;
        xhr.addEventListener('readystatechange', function() {
          if (xhr.readyState === 4) {
            let resp = null;
            try {
              resp = xhr.responseText;
            } catch (e) {
              resp = null;
            }

            sendToContent({
              method: method || 'GET',
              url: url || '',
              status: xhr.status || null,
              requestBody,
              responseBody: resp
            });
          }
        });

        return origSend.apply(xhr, arguments);
      };

      return xhr;
    }

    window.XMLHttpRequest = FlowTraceXHR;
  } catch (e) {}
})();
