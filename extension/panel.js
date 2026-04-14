/**
 * DevTools Panel Logic - UI for FlowTrace QA
 */

(function() {
  let isRecording = false;
  let flowData = {
    uiActions: [],
    apiCalls: [],
    correlations: []
  };

  // DOM Elements
  const elements = {
    statusIndicator: document.getElementById('statusIndicator'),
    btnStart: document.getElementById('btnStart'),
    btnStop: document.getElementById('btnStop'),
    btnClear: document.getElementById('btnClear'),
    btnExportSelenium: document.getElementById('btnExportSelenium'),
    btnExportRestAssured: document.getElementById('btnExportRestAssured'),
    btnExportJson: document.getElementById('btnExportJson'),
    flowContainer: document.getElementById('flowContainer'),
    exportOutput: document.getElementById('exportOutput'),
    jsonOutput: document.getElementById('jsonOutput'),
    statActions: document.getElementById('statActions'),
    statApis: document.getElementById('statApis'),
    statCorrelations: document.getElementById('statCorrelations'),
    tabs: document.querySelectorAll('.tab'),
    tabContents: document.querySelectorAll('.tab-content')
  };

  /**
   * Update UI status
   */
  function updateStatus(recording) {
    isRecording = recording;
    
    if (recording) {
      elements.statusIndicator.textContent = 'Recording';
      elements.statusIndicator.className = 'status recording';
      elements.btnStart.disabled = true;
      elements.btnStop.disabled = false;
    } else {
      elements.statusIndicator.textContent = 'Idle';
      elements.statusIndicator.className = 'status idle';
      elements.btnStart.disabled = false;
      elements.btnStop.disabled = true;
    }
  }

  /**
   * Update statistics
   */
  function updateStats() {
    elements.statActions.textContent = flowData.uiActions.length;
    elements.statApis.textContent = flowData.apiCalls.length;
    elements.statCorrelations.textContent = flowData.correlations.length;
  }

  /**
   * Render flow visualization
   */
  function renderFlow() {
    if (flowData.correlations.length === 0 && flowData.uiActions.length === 0) {
      elements.flowContainer.innerHTML = `
        <div class="empty-state">
          <p>No flow recorded yet</p>
          <p style="margin-top: 8px; font-size: 11px;">Click "Start Recording" to begin capturing UI actions and API calls</p>
        </div>
      `;
      return;
    }

    let html = '';
    
    // Render correlations (primary view)
    flowData.correlations.forEach((corr, index) => {
      html += `
        <div class="flow-step ui-action">
          <div class="step-type">🖱️ UI Action #${index + 1}</div>
          <div class="step-details">
            <strong>Type:</strong> ${corr.uiAction?.type || 'Unknown'}<br>
            <strong>Element:</strong> ${corr.uiAction?.selector?.selector || corr.uiAction?.xpath || 'N/A'}<br>
            <strong>URL:</strong> ${corr.uiAction?.url ? corr.uiAction.url.substring(0, 60) + '...' : 'N/A'}
          </div>
          <div class="step-time">${new Date(corr.uiAction?.timestamp || Date.now()).toLocaleTimeString()}</div>
        </div>
      `;

      if (corr.apiCalls && corr.apiCalls.length > 0) {
        corr.apiCalls.forEach((api, apiIndex) => {
          html += `
            <div class="flow-step api-call" style="margin-left: 16px;">
              <div class="step-type">🌐 API Call #${index + 1}.${apiIndex + 1}</div>
              <div class="step-details">
                <strong>Method:</strong> ${api.method}<br>
                <strong>URL:</strong> ${api.url.substring(0, 60) + (api.url.length > 60 ? '...' : '')}<br>
                <strong>Status:</strong> ${api.status || 'N/A'}
              </div>
              <div class="step-time">${new Date(api.timestamp).toLocaleTimeString()}</div>
            </div>
          `;
        });
      }
    });

    elements.flowContainer.innerHTML = html;
  }

  /**
   * Render JSON output
   */
  function renderJson() {
    elements.jsonOutput.textContent = JSON.stringify(flowData, null, 2);
  }

  /**
   * Start recording
   */
  async function startRecording() {
    try {
      // Get active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
        throw new Error('Cannot record on browser internal pages. Please open a regular webpage (http/https).');
      }

      // Send start message to background script (main coordinator)
      const response = await chrome.runtime.sendMessage({ 
        type: 'START_RECORDING',
        tabId: tab.id,
        tabUrl: tab.url
      });
      
      if (response && response.success) {
        updateStatus(true);
        flowData = { uiActions: [], apiCalls: [], correlations: [] };
        updateStats();
        renderFlow();
        console.log('[FlowTrace] Recording started on tab:', tab.id);
      } else {
        throw new Error(response?.error || 'Failed to start recording');
      }
    } catch (error) {
      console.error('[FlowTrace] Error starting recording:', error);
      alert('Failed to start recording: ' + error.message + '\n\nMake sure:\n1. You are on a regular webpage (http/https)\n2. Not on chrome:// or file:// pages\n3. Page is fully loaded');
    }
  }

  /**
   * Stop recording
   */
  async function stopRecording() {
    try {
      // Get flow data from background
      const response = await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
      
      if (response && response.flowData) {
        flowData = response.flowData;
        updateStats();
        renderFlow();
        renderJson();
        
        if (response.stats) {
          console.log('[FlowTrace] Recording stats:', response.stats);
        }
      }

      updateStatus(false);
      console.log('[FlowTrace] Recording stopped');
    } catch (error) {
      console.error('[FlowTrace] Error stopping recording:', error);
      updateStatus(false);
    }
  }

  /**
   * Clear all data
   */
  async function clearData() {
    try {
      await chrome.runtime.sendMessage({ type: 'CLEAR_FLOW' });
      
      flowData = { uiActions: [], apiCalls: [], correlations: [] };
      updateStats();
      renderFlow();
      elements.exportOutput.classList.add('hidden');
      elements.jsonOutput.textContent = '';
      
      console.log('[FlowTrace] Data cleared');
    } catch (error) {
      console.error('[FlowTrace] Error clearing data:', error);
    }
  }

  /**
   * Export Selenium code
   */
  async function exportSelenium() {
    try {
      if (flowData.uiActions.length === 0 && flowData.correlations.length === 0) {
        alert('No recorded flow to export. Please record some actions first.');
        return;
      }

      await chrome.runtime.sendMessage({ 
        type: 'EXPORT_FLOW', 
        format: 'selenium'
      });
      
      alert('Selenium code exported! Check your downloads folder.');
    } catch (error) {
      console.error('[FlowTrace] Export error:', error);
      alert('Export failed: ' + error.message);
    }
  }

  /**
   * Export Rest Assured code
   */
  async function exportRestAssured() {
    try {
      if (flowData.uiActions.length === 0 && flowData.correlations.length === 0) {
        alert('No recorded flow to export. Please record some actions first.');
        return;
      }

      await chrome.runtime.sendMessage({ 
        type: 'EXPORT_FLOW', 
        format: 'rest-assured'
      });
      
      alert('Rest Assured code exported! Check your downloads folder.');
    } catch (error) {
      console.error('[FlowTrace] Export error:', error);
      alert('Export failed: ' + error.message);
    }
  }

  /**
   * Export JSON
   */
  function exportJson() {
    if (flowData.uiActions.length === 0 && flowData.correlations.length === 0) {
      alert('No recorded flow to export. Please record some actions first.');
      return;
    }

    const blob = new Blob([JSON.stringify(flowData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'flowtrace-data.json';
    a.click();
    URL.revokeObjectURL(url);
    
    console.log('[FlowTrace] JSON exported');
  }

  // Event Listeners
  elements.btnStart.addEventListener('click', startRecording);
  elements.btnStop.addEventListener('click', stopRecording);
  elements.btnClear.addEventListener('click', clearData);
  elements.btnExportSelenium.addEventListener('click', exportSelenium);
  elements.btnExportRestAssured.addEventListener('click', exportRestAssured);
  elements.btnExportJson.addEventListener('click', exportJson);

  // Tab switching
  elements.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      
      elements.tabs.forEach(t => t.classList.remove('active'));
      elements.tabContents.forEach(c => c.classList.remove('active'));
      
      tab.classList.add('active');
      document.getElementById(`tab-${tabName}`).classList.add('active');
    });
  });

  // Listen for real-time updates from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'RECORDING_STARTED') {
      updateStatus(true);
      flowData = { uiActions: [], apiCalls: [], correlations: [] };
      updateStats();
      renderFlow();
    } else if (message.type === 'RECORDING_STOPPED') {
      updateStatus(false);
      if (message.flowData) {
        flowData = message.flowData;
        updateStats();
        renderFlow();
        renderJson();
      }
    } else if (message.type === 'UI_ACTION_RECORDED' || message.type === 'API_CALL_RECORDED' || message.type === 'DOM_MUTATION_RECORDED') {
      // Refresh flow data
      chrome.runtime.sendMessage({ type: 'GET_FLOW_DATA' })
        .then(response => {
          if (response && response.flowData) {
            flowData = response.flowData;
            updateStats();
            renderFlow();
          }
        });
    }
    sendResponse({ success: true });
  });

  // Initialize
  updateStatus(false);
  console.log('[FlowTrace] Panel initialized');
})();
