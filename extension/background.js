/**
 * Background Service Worker
 * Central coordinator for FlowTrace QA extension
 * - Message passing between content script, devtools panel, and network tracking
 * - Manage recording state and flow data
 * - Coordinate correlation and export operations
 */

// Load utility scripts
importScripts('utils/correlation.js', 'utils/exporter.js');

const SESSION_STORAGE_KEY = 'flowTraceSession';

// Recording state
let isRecording = false;
let recordingStartTime = null;
let flowData = {
  uiActions: [],
  apiCalls: [],
  correlations: []
};
let apiCaptureState = {
  dedupeWindowMs: 1200,
  sourcePriority: {
    devtools: 3,
    content: 2,
    unknown: 1
  },
  fingerprintToId: {},
  stats: {
    accepted: 0,
    deduped: 0,
    merged: 0,
    bySource: {}
  }
};

// Correlation engine instance
let correlationEngine = null;
let restoreStatePromise = restorePersistedSession();

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
  persistSession().catch(error => {
    console.debug('Failed to persist reset state on install:', error.message || error);
  });
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
      handleDomMutation(message, sendResponse);
      return true;

    case 'GET_FLOW_DATA':
      handleGetFlowData(sendResponse);
      return true;

    case 'UPDATE_CORRELATION_REVIEW':
      handleUpdateCorrelationReview(message, sendResponse);
      return true;

    case 'CLEAR_FLOW':
      handleClearFlow(sendResponse);
      return true;

    case 'EXPORT_FLOW':
      handleExportFlow(message, sendResponse);
      return true;

    case 'GET_RECORDING_STATE':
      handleGetRecordingState(sendResponse);
      return true;

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
    await ensureSessionLoaded();
    console.log('[FlowTrace] Starting recording...', message);
    
    // Reset state
    resetState();
    initCorrelationEngine();

    // Set recording state
    isRecording = true;
    recordingStartTime = Date.now();
    await persistSession();

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
        recordingStartTime,
        networkCaptureMode: 'devtools-primary'
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
    await ensureSessionLoaded();
    console.log('[FlowTrace] Stopping recording...');
    
    // Set recording state
    isRecording = false;

    // Final correlation pass
    if (correlationEngine) {
      correlationEngine.attemptCorrelation();
    }

    recordingStartTime = null;
    await persistSession();

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

async function handleUpdateCorrelationReview(message, sendResponse) {
  await ensureSessionLoaded();
  if (!correlationEngine) {
    sendResponse({ success: false, error: 'Correlation engine not initialized' });
    return;
  }

  const updated = correlationEngine.updateCorrelationReview(message.correlationId, {
    uiAssertions: message.uiAssertions,
    apiAssertions: message.apiAssertions,
    reviewStatus: message.reviewStatus,
    reviewNotes: message.reviewNotes,
    apiSelections: message.apiSelections
  });

  if (!updated) {
    sendResponse({ success: false, error: 'Correlation not found' });
    return;
  }

  await persistSession();

  notifyDevTools({
    type: 'CORRELATION_REVIEW_UPDATED',
    correlationId: message.correlationId
  });

  sendResponse({
    success: true,
    correlation: updated
  });
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
    syncFlowDataFromEngine();
  }

  persistSession().catch(error => {
    console.debug('Failed to persist UI action:', error.message || error);
  });

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

  const apiCall = normalizeAPICall(message.apiCall, sender);
  const captureResult = upsertAPICall(apiCall);

  if (!captureResult.accepted) {
    return;
  }

  if (captureResult.shouldAddToCorrelation && correlationEngine) {
    correlationEngine.addAPICall(captureResult.apiCall);
    syncFlowDataFromEngine();
  } else if (captureResult.deduped) {
    syncFlowDataFromEngine();
  }

  persistSession().catch(error => {
    console.debug('Failed to persist API call:', error.message || error);
  });

  // Notify devtools panel
  notifyDevTools({
    type: 'API_CALL_RECORDED',
    apiCall: captureResult.apiCall,
    totalAPICalls: flowData.apiCalls.length,
    deduped: captureResult.deduped
  });

  console.log(
    'API Call recorded:',
    captureResult.apiCall.method,
    captureResult.apiCall.url?.substring(0, 50),
    'source:',
    captureResult.apiCall.capture?.source
  );
}

function normalizeAPICall(apiCall, sender) {
  const source = apiCall?.capture?.source || inferCaptureSource(sender);
  const receivedAt = Date.now();

  return {
    ...apiCall,
    tabId: apiCall?.tabId || sender.tab?.id,
    recordedAt: receivedAt,
    capture: {
      ...(apiCall?.capture || {}),
      source,
      receivedAt,
      priority: getSourcePriority(source),
      mode: apiCall?.capture?.mode || 'unknown'
    }
  };
}

function inferCaptureSource(sender) {
  if (sender.tab) return 'content';
  return 'unknown';
}

function getSourcePriority(source) {
  return apiCaptureState.sourcePriority[source] || apiCaptureState.sourcePriority.unknown;
}

function buildAPIFingerprint(apiCall) {
  const method = (apiCall.method || 'GET').toUpperCase();
  const normalizedUrl = normalizeUrlForFingerprint(apiCall.url || '');
  const status = apiCall.status || 'na';
  const tabId = apiCall.tabId || 'na';
  const requestBody = truncateForFingerprint(apiCall.requestBody);

  return [tabId, method, normalizedUrl, status, requestBody].join('|');
}

function normalizeUrlForFingerprint(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';

    const params = Array.from(parsed.searchParams.entries())
      .filter(([key]) => !key.startsWith('_') && key !== 'cacheBust' && key !== 'timestamp')
      .sort(([a], [b]) => a.localeCompare(b));

    parsed.search = '';
    const query = params
      .map(([key, value]) => `${key}=${value}`)
      .join('&');

    return `${parsed.origin}${parsed.pathname}${query ? '?' + query : ''}`;
  } catch (error) {
    return url.split('#')[0];
  }
}

function truncateForFingerprint(value, maxLength = 120) {
  if (value === null || value === undefined) return '';

  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > maxLength ? text.substring(0, maxLength) : text;
}

function upsertAPICall(apiCall) {
  const fingerprint = buildAPIFingerprint(apiCall);
  const existingId = apiCaptureState.fingerprintToId[fingerprint];

  apiCaptureState.stats.bySource[apiCall.capture.source] =
    (apiCaptureState.stats.bySource[apiCall.capture.source] || 0) + 1;

  if (!existingId) {
    const stored = {
      ...apiCall,
      id: `api_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      fingerprint
    };

    flowData.apiCalls.push(stored);
    apiCaptureState.fingerprintToId[fingerprint] = stored.id;
    apiCaptureState.stats.accepted += 1;

    return {
      accepted: true,
      deduped: false,
      shouldAddToCorrelation: true,
      apiCall: stored
    };
  }

  const existing = flowData.apiCalls.find(call => call.id === existingId);
  if (!existing) {
    delete apiCaptureState.fingerprintToId[fingerprint];
    return upsertAPICall(apiCall);
  }

  const withinWindow = Math.abs((apiCall.capture.receivedAt || 0) - (existing.capture?.receivedAt || 0)) <= apiCaptureState.dedupeWindowMs;
  if (!withinWindow) {
    const variantFingerprint = `${fingerprint}|${Date.now()}`;
    const stored = {
      ...apiCall,
      id: `api_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      fingerprint: variantFingerprint
    };

    flowData.apiCalls.push(stored);
    apiCaptureState.fingerprintToId[variantFingerprint] = stored.id;
    apiCaptureState.stats.accepted += 1;

    return {
      accepted: true,
      deduped: false,
      shouldAddToCorrelation: true,
      apiCall: stored
    };
  }

  apiCaptureState.stats.deduped += 1;
  const incomingPriority = apiCall.capture.priority || 0;
  const existingPriority = existing.capture?.priority || 0;

  if (incomingPriority >= existingPriority) {
    mergeAPICall(existing, apiCall);
    apiCaptureState.stats.merged += 1;
  }

  return {
    accepted: true,
    deduped: true,
    shouldAddToCorrelation: false,
    apiCall: existing
  };
}

function mergeAPICall(target, incoming) {
  target.method = incoming.method || target.method;
  target.url = incoming.url || target.url;
  target.status = incoming.status ?? target.status;
  target.requestHeaders = incoming.requestHeaders || target.requestHeaders;
  target.responseHeaders = incoming.responseHeaders || target.responseHeaders;
  target.requestBody = incoming.requestBody ?? target.requestBody;
  target.responseBody = incoming.responseBody ?? target.responseBody;
  target.error = incoming.error ?? target.error;
  target.recordedAt = Math.min(target.recordedAt || Infinity, incoming.recordedAt || Infinity);
  target.capture = {
    ...target.capture,
    ...incoming.capture,
    mergedSources: Array.from(new Set([
      ...(target.capture?.mergedSources || [target.capture?.source].filter(Boolean)),
      incoming.capture?.source
    ].filter(Boolean)))
  };
}

/**
 * Handle export flow request
 */
async function handleExportFlow(message, sendResponse) {
  try {
    await ensureSessionLoaded();
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

    if ((flowData.uiActions.length === 0 && flowData.correlations.length === 0) || !exportedCode) {
      sendResponse({ success: false, error: 'No recorded flow available for export' });
      return;
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
    sendResponse({ success: true, fileName });

  } catch (error) {
    console.error('Error exporting flow:', error);
    notifyDevTools({
      type: 'EXPORT_ERROR',
      error: error.message
    });
    sendResponse({ success: false, error: error.message });
  }
}

async function handleDomMutation(message, sendResponse) {
  await ensureSessionLoaded();

  if (correlationEngine) {
    try {
      correlationEngine.addDomMutation(message.mutation);
      await persistSession();
    } catch (e) {
      console.debug('Error adding DOM mutation to correlation engine:', e.message || e);
    }
  }

  notifyDevTools({ type: 'DOM_MUTATION_RECORDED' });
  sendResponse({ success: true });
}

async function handleGetFlowData(sendResponse) {
  await ensureSessionLoaded();
  sendResponse({
    success: true,
    flowData: getFlowData(),
    stats: correlationEngine?.getStats()
  });
}

async function handleClearFlow(sendResponse) {
  await ensureSessionLoaded();
  clearFlowData();
  await persistSession();
  sendResponse({ success: true });
}

async function handleGetRecordingState(sendResponse) {
  await ensureSessionLoaded();
  sendResponse({
    success: true,
    isRecording,
    recordingStartTime,
    flowLength: flowData.uiActions.length + flowData.apiCalls.length
  });
}

/**
 * Get current flow data
 */
function getFlowData() {
  syncFlowDataFromEngine();
  return {
    uiActions: flowData.uiActions,
    apiCalls: flowData.apiCalls,
    correlations: correlationEngine ? correlationEngine.getCorrelations() : [],
    recordingStartTime: recordingStartTime,
    recordingStopTime: isRecording ? null : Date.now(),
    stats: {
      correlation: correlationEngine ? correlationEngine.getStats() : null,
      capture: apiCaptureState.stats
    }
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
    syncFlowDataFromEngine();
  }

  resetAPICaptureState();

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
  resetAPICaptureState();
}

async function ensureSessionLoaded() {
  await restoreStatePromise;
}

async function restorePersistedSession() {
  try {
    const stored = await chrome.storage.local.get(SESSION_STORAGE_KEY);
    const session = stored?.[SESSION_STORAGE_KEY];
    if (!session) {
      return;
    }

    isRecording = Boolean(session.isRecording);
    recordingStartTime = session.recordingStartTime || null;
    flowData = {
      uiActions: session.flowData?.uiActions || [],
      apiCalls: session.flowData?.apiCalls || [],
      correlations: session.flowData?.correlations || []
    };
    apiCaptureState = session.apiCaptureState || apiCaptureState;

    initCorrelationEngine();
    correlationEngine.uiActions = enrichStoredUIActions(
      structuredClone(session.flowData?.uiActions || []),
      structuredClone(session.flowData?.correlations || [])
    );
    correlationEngine.apiCalls = enrichStoredAPICalls(
      structuredClone(session.flowData?.apiCalls || []),
      structuredClone(session.flowData?.correlations || [])
    );
    correlationEngine.correlations = structuredClone(session.flowData?.correlations || []);
    syncFlowDataFromEngine();
  } catch (error) {
    console.debug('Failed to restore persisted session:', error.message || error);
  }
}

async function persistSession() {
  syncFlowDataFromEngine();
  const session = {
    isRecording,
    recordingStartTime,
    flowData: {
      uiActions: flowData.uiActions,
      apiCalls: flowData.apiCalls,
      correlations: correlationEngine ? correlationEngine.getCorrelations() : []
    },
    apiCaptureState
  };

  await chrome.storage.local.set({
    [SESSION_STORAGE_KEY]: session
  });
}

function syncFlowDataFromEngine() {
  if (!correlationEngine) {
    return;
  }

  flowData.uiActions = structuredClone(correlationEngine.uiActions || []);
  flowData.apiCalls = structuredClone(correlationEngine.apiCalls || []);
  flowData.correlations = structuredClone(correlationEngine.getCorrelations() || []);
}

function enrichStoredUIActions(uiActions, correlations) {
  const correlatedIds = new Set(
    correlations
      .map(corr => corr.uiAction?.id)
      .filter(Boolean)
  );

  return uiActions.map(action => ({
    ...action,
    correlated: correlatedIds.has(action.id)
  }));
}

function enrichStoredAPICalls(apiCalls, correlations) {
  const apiById = new Map();
  correlations.forEach(corr => {
    (corr.apiCalls || []).forEach(api => {
      if (api.id) {
        apiById.set(api.id, api);
      }
    });
  });

  return apiCalls.map(api => {
    const correlatedApi = apiById.get(api.id);
    return {
      ...api,
      correlated: Boolean(correlatedApi),
      classification: api.classification || correlatedApi?.classification || 'unknown',
      classificationReasons: api.classificationReasons || correlatedApi?.classificationReasons || [],
      classificationScore: api.classificationScore ?? correlatedApi?.classificationScore ?? 0
    };
  });
}

function resetAPICaptureState() {
  apiCaptureState = {
    dedupeWindowMs: 1200,
    sourcePriority: {
      devtools: 3,
      content: 2,
      unknown: 1
    },
    fingerprintToId: {},
    stats: {
      accepted: 0,
      deduped: 0,
      merged: 0,
      bySource: {}
    }
  };
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
