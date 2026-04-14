/**
 * Background Service Worker
 * Central coordinator for FlowTrace QA extension
 * - Message passing between content script, devtools panel, and network tracking
 * - Manage recording state and flow data
 * - Coordinate correlation and export operations
 */

// Load utility scripts
importScripts('utils/correlation.js', 'utils/exporter.js');

// Recording state
let isRecording = false;
let recordingStartTime = null;
let flowData = {
  uiActions: [],
  apiCalls: [],
  correlations: []
};

// Correlation engine instance
let correlationEngine = null;

// Initialize correlation engine
function initCorrelationEngine() {
  if (!correlationEngine) {
    correlationEngine = new CorrelationEngine();
  }
}

/**
 * Listen for extension installation
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.log('FlowTrace QA installed:', details.reason);
  resetState();
});

/**
 * Listen for messages from content scripts and devtools panel
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message.type, 'from:', sender.id?.substring(0, 8));

  switch (message.type) {
    case 'START_RECORDING':
      handleStartRecording(message, sendResponse);
      return true; // Keep channel open for async response

    case 'STOP_RECORDING':
      handleStopRecording(message, sendResponse);
      return true;

    case 'UI_ACTION':
      handleUIAction(message, sender);
      sendResponse({ success: true });
      break;

    case 'API_CALL':
      handleAPICall(message, sender);
      sendResponse({ success: true });
      break;

    case 'DOM_MUTATION':
      // Forward DOM mutation to correlation engine
      if (correlationEngine) {
        try {
          correlationEngine.addDomMutation(message.mutation);
        } catch (e) {
          console.debug('Error adding DOM mutation to correlation engine:', e.message || e);
        }
      }
      // Notify devtools panel to refresh view
      notifyDevTools({ type: 'DOM_MUTATION_RECORDED' });
      sendResponse({ success: true });
      break;

    case 'GET_FLOW_DATA':
      sendResponse({ 
        success: true, 
        flowData: getFlowData(),
        stats: correlationEngine?.getStats()
      });
      break;

    case 'CLEAR_FLOW':
      clearFlowData();
      sendResponse({ success: true });
      break;

    case 'EXPORT_FLOW':
      handleExportFlow(message);
      sendResponse({ success: true });
      break;

    case 'GET_RECORDING_STATE':
      sendResponse({ 
        success: true, 
        isRecording, 
        recordingStartTime,
        flowLength: flowData.uiActions.length + flowData.apiCalls.length
      });
      break;

    case 'CORRELATE_NOW':
      if (correlationEngine) {
        correlationEngine.attemptCorrelation();
        sendResponse({ 
          success: true, 
          correlations: correlationEngine.getCorrelations()
        });
      } else {
        sendResponse({ success: false, error: 'Correlation engine not initialized' });
      }
      break;

    default:
      console.warn('Unknown message type:', message.type);
      sendResponse({ success: false, error: 'Unknown message type' });
  }
});

/**
 * Handle start recording request
 */
async function handleStartRecording(message, sendResponse) {
  try {
    console.log('[FlowTrace] Starting recording...', message);
    
    // Reset state
    resetState();
    initCorrelationEngine();

    // Set recording state
    isRecording = true;
    recordingStartTime = Date.now();

    // Use provided tabId or get active tab
    let tab = null;
    if (message.tabId) {
      tab = await chrome.tabs.get(message.tabId);
    } else {
      const [tabResult] = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = tabResult;
    }
    
    if (!tab) {
      sendResponse({ success: false, error: 'No active tab found' });
      return;
    }

    // Validate tab URL
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      sendResponse({ 
        success: false, 
        error: 'Cannot record on browser internal pages. Please open a regular webpage (http/https/file).' 
      });
      return;
    }

    console.log('[FlowTrace] Injecting scripts into tab:', tab.id, 'URL:', tab.url);

    // Inject content script if not already injected
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['utils/selector.js', 'utils/correlation.js', 'content.js']
      });
      console.log('[FlowTrace] Content scripts injected successfully');
    } catch (injectError) {
      console.warn('[FlowTrace] Script injection error (may already be injected):', injectError.message);
    }

    // Wait a bit for content script to initialize
    await new Promise(resolve => setTimeout(resolve, 300));

    // Notify content script about recording start
    try {
      await chrome.tabs.sendMessage(tab.id, { 
        type: 'START_RECORDING',
        recordingStartTime 
      });
      console.log('[FlowTrace] Notified content script');
    } catch (msgError) {
      console.warn('[FlowTrace] Could not notify content script:', msgError.message);
    }

    // Notify devtools panel
    notifyDevTools({
      type: 'RECORDING_STARTED',
      timestamp: recordingStartTime,
      tabId: tab.id,
      tabUrl: tab.url
    });

    console.log('[FlowTrace] Recording started on tab:', tab.id);
    sendResponse({ 
      success: true, 
      tabId: tab.id,
      recordingStartTime,
      message: 'Recording started'
    });

  } catch (error) {
    console.error('[FlowTrace] Error starting recording:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Handle stop recording request
 */
async function handleStopRecording(message, sendResponse) {
  try {
    console.log('[FlowTrace] Stopping recording...');
    
    // Set recording state
    isRecording = false;

    // Final correlation pass
    if (correlationEngine) {
      correlationEngine.attemptCorrelation();
    }

    // Get final flow data
    const finalFlowData = getFlowData();

    console.log('[FlowTrace] Recording stopped. Actions:', finalFlowData.uiActions.length, 'APIs:', finalFlowData.apiCalls.length, 'Correlations:', finalFlowData.correlations.length);

    // Notify devtools panel
    notifyDevTools({
      type: 'RECORDING_STOPPED',
      timestamp: Date.now(),
      flowData: finalFlowData,
      stats: correlationEngine?.getStats()
    });

    // Reset recording state but keep flow data for export
    recordingStartTime = null;

    sendResponse({ 
      success: true, 
      flowData: finalFlowData,
      stats: correlationEngine?.getStats()
    });

  } catch (error) {
    console.error('[FlowTrace] Error stopping recording:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Handle UI action from content script
 */
function handleUIAction(message, sender) {
  if (!isRecording) return;

  const action = {
    ...message.action,
    tabId: sender.tab?.id,
    frameId: sender.frameId,
    recordedAt: Date.now()
  };

  // Store UI action
  flowData.uiActions.push(action);

  // Add to correlation engine
  if (correlationEngine) {
    correlationEngine.addUIAction(action);
  }

  // Notify devtools panel
  notifyDevTools({
    type: 'UI_ACTION_RECORDED',
    action: action,
    totalActions: flowData.uiActions.length
  });

  console.log('UI Action recorded:', action.type);
}

/**
 * Handle API call from devtools/network tracking
 */
function handleAPICall(message, sender) {
  if (!isRecording) return;

  const apiCall = {
    ...message.apiCall,
    tabId: sender.tab?.id,
    recordedAt: Date.now()
  };

  // Store API call
  flowData.apiCalls.push(apiCall);

  // Add to correlation engine
  if (correlationEngine) {
    correlationEngine.addAPICall(apiCall);
  }

  // Notify devtools panel
  notifyDevTools({
    type: 'API_CALL_RECORDED',
    apiCall: apiCall,
    totalAPICalls: flowData.apiCalls.length
  });

  console.log('API Call recorded:', apiCall.method, apiCall.url?.substring(0, 50));
}

/**
 * Handle export flow request
 */
async function handleExportFlow(message) {
  try {
    const { format } = message;
    const flowData = getFlowData();

    // Get correlations from engine
    const correlations = correlationEngine ? correlationEngine.exportFlow() : { flow: [], metadata: {} };

    // Generate code based on format
    let exportedCode = '';
    let fileName = '';

    if (format === 'selenium') {
      const exporter = new CodeExporter();
      exportedCode = exporter.exportSelenium(correlations, 'FlowTraceTest');
      fileName = 'FlowTraceTest.java';
    } else if (format === 'rest-assured') {
      const exporter = new CodeExporter();
      exportedCode = exporter.exportRestAssured(correlations, 'APITest');
      fileName = 'APITest.java';
    } else if (format === 'json') {
      exportedCode = JSON.stringify(flowData, null, 2);
      fileName = 'flow-data.json';
    } else {
      // Combined export
      const exporter = new CodeExporter();
      const combined = exporter.exportCombined(correlations);
      exportedCode = `// Selenium Test\n${combined.selenium}\n\n// Rest Assured Test\n${combined.restAssured}`;
      fileName = 'CombinedTest.java';
    }

    // Download file
    await downloadFile(exportedCode, fileName);

    // Notify devtools panel
    notifyDevTools({
      type: 'FLOW_EXPORTED',
      format: format,
      fileName: fileName
    });

    console.log('Flow exported as:', format);

  } catch (error) {
    console.error('Error exporting flow:', error);
    notifyDevTools({
      type: 'EXPORT_ERROR',
      error: error.message
    });
  }
}

/**
 * Get current flow data
 */
function getFlowData() {
  return {
    uiActions: flowData.uiActions,
    apiCalls: flowData.apiCalls,
    correlations: correlationEngine ? correlationEngine.getCorrelations() : [],
    recordingStartTime: recordingStartTime,
    recordingStopTime: isRecording ? null : Date.now(),
    stats: correlationEngine ? correlationEngine.getStats() : null
  };
}

/**
 * Clear flow data
 */
function clearFlowData() {
  flowData = {
    uiActions: [],
    apiCalls: [],
    correlations: []
  };

  if (correlationEngine) {
    correlationEngine.clear();
  }

  notifyDevTools({
    type: 'FLOW_CLEARED'
  });

  console.log('Flow data cleared');
}

/**
 * Reset all state
 */
function resetState() {
  isRecording = false;
  recordingStartTime = null;
  flowData = {
    uiActions: [],
    apiCalls: [],
    correlations: []
  };
  correlationEngine = null;
}

/**
 * Notify devtools panel about events
 */
function notifyDevTools(message) {
  // Find devtools panel and send message (use callback to avoid assuming Promise API)
  try {
    chrome.runtime.sendMessage(message, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        // Panel may not be open, which is okay
        console.debug('Could not notify devtools panel:', err.message || err);
      }
    });
  } catch (e) {
    console.debug('Could not notify devtools panel (sync error):', e.message || e);
  }
}

/**
 * Download file to user's computer
 */
async function downloadFile(content, fileName) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);

  // Create download
  await chrome.downloads.download({
    url: url,
    filename: fileName,
    saveAs: true
  });

  // Cleanup
  URL.revokeObjectURL(url);
}

/**
 * Listen for tab updates to handle page reloads during recording
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (isRecording && changeInfo.status === 'complete') {
    console.log('Tab updated during recording:', tabId);
    
    // Re-inject content script if needed
    try {
      chrome.tabs.sendMessage(tabId, { type: 'PAGE_RELOADED', recordingStartTime }, () => {
        const err = chrome.runtime.lastError;
        if (err) {
          console.debug('Content script not available after reload:', err.message || err);
        }
      });
    } catch (e) {
      console.debug('Content script not available after reload (sync error):', e.message || e);
    }
  }
});

/**
 * Listen for tab removal to cleanup
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  if (isRecording) {
    console.log('Tab removed during recording:', tabId);
    // Optionally stop recording or notify user
  }
});

/**
 * Cleanup on service worker restart
 */
self.addEventListener('unload', () => {
  console.log('Service worker unloading');
  // State is preserved in chrome.storage if needed
});

// Log service worker startup
console.log('FlowTrace QA Background Service Worker initialized');
