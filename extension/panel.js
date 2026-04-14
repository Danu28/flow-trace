/**
 * DevTools Panel Logic - UI for FlowTrace QA
 */

(function() {
  let isRecording = false;
  let flowData = {
    uiActions: [],
    apiCalls: [],
    correlations: [],
    stats: {
      correlation: null,
      capture: null
    }
  };

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
    statDeduped: document.getElementById('statDeduped'),
    tabs: document.querySelectorAll('.tab'),
    tabContents: document.querySelectorAll('.tab-content')
  };

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

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

  function updateStats() {
    elements.statActions.textContent = flowData.uiActions.length;
    elements.statApis.textContent = flowData.apiCalls.length;
    elements.statCorrelations.textContent = flowData.correlations.length;
    elements.statDeduped.textContent = flowData.stats?.capture?.deduped || 0;
  }

  function getConfidenceClass(confidence) {
    return (confidence?.level || 'low').toLowerCase();
  }

  function getReviewClass(review) {
    return (review?.status || 'pending') === 'reviewed' ? 'reviewed' : 'pending';
  }

  function renderVariables(variables) {
    const produced = variables?.produced || [];
    const consumed = variables?.consumed || [];

    if (!produced.length && !consumed.length) {
      return '<div class="small-note">No extracted variables yet.</div>';
    }

    const producedHtml = produced.length
      ? `<div class="variable-list"><strong>Produced:</strong> ${produced.map(item => escapeHtml(`${item.name} = ${item.valuePreview || ''}`)).join(', ')}</div>`
      : '';
    const consumedHtml = consumed.length
      ? `<div class="variable-list"><strong>Consumed:</strong> ${consumed.map(item => escapeHtml(item.name)).join(', ')}</div>`
      : '';

    return producedHtml + consumedHtml;
  }

  function renderReasons(reasons) {
    if (!reasons || !reasons.length) {
      return '<div class="small-note">No confidence notes recorded.</div>';
    }

    return `<div class="reason-list">${reasons.map(reason => `• ${escapeHtml(reason)}`).join('<br>')}</div>`;
  }

  function renderApiList(correlation) {
    if (!correlation.apiCalls || !correlation.apiCalls.length) {
      return '<div class="small-note">No correlated APIs for this step.</div>';
    }

    return correlation.apiCalls.map((api, index) => {
      const checked = api.reviewSelection === 'ignored' ? '' : 'checked';
      const ignoredClass = api.reviewSelection === 'ignored' ? 'ignored' : '';
      return `
        <label class="api-item ${ignoredClass}">
          <input type="checkbox" data-role="api-toggle" data-correlation-id="${escapeHtml(correlation.id)}" data-api-id="${escapeHtml(api.id)}" ${checked}>
          <div class="api-body">
            <div><strong>${escapeHtml(api.method || 'GET')}</strong> <span class="badge ${escapeHtml((api.classification || 'business').toLowerCase())}">${escapeHtml(api.classification || 'business')}</span></div>
            <div class="api-url">${escapeHtml(api.url || '')}</div>
            <div>Status: ${escapeHtml(api.status || 'N/A')} | Relevance: ${escapeHtml(api.relevance || 'candidate')} | Score: ${escapeHtml(api.correlationScore || 'n/a')}</div>
          </div>
        </label>
      `;
    }).join('');
  }

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

    if (flowData.correlations.length === 0) {
      elements.flowContainer.innerHTML = `
        <div class="empty-state">
          <p>Actions captured, but no confident correlations yet.</p>
          <p style="margin-top: 8px; font-size: 11px;">Stop recording or keep interacting to collect more evidence.</p>
        </div>
      `;
      return;
    }

    elements.flowContainer.innerHTML = flowData.correlations.map((corr, index) => {
      const uiAssertions = (corr.assertions?.ui || []).join('\n');
      const apiAssertions = (corr.assertions?.api || []).join('\n');
      const reviewNotes = corr.review?.notes || '';
      const selectedApiIds = (corr.apiCalls || [])
        .filter(api => api.reviewSelection !== 'ignored')
        .map(api => api.id);

      return `
        <div class="flow-card">
          <div class="flow-card-header">
            <div class="flow-card-title">Step ${index + 1}: ${escapeHtml(corr.uiAction?.type || 'Unknown action')}</div>
            <div class="badge-row">
              <span class="badge ${getConfidenceClass(corr.confidence)}">${escapeHtml((corr.confidence?.level || 'low').toUpperCase())} confidence</span>
              <span class="badge ${getReviewClass(corr.review)}">${escapeHtml((corr.review?.status || 'pending').toUpperCase())}</span>
            </div>
          </div>

          <div class="flow-meta">
            <div><strong>Selector:</strong> ${escapeHtml(corr.uiAction?.selector || corr.uiAction?.xpath || 'N/A')}</div>
            <div><strong>URL:</strong> ${escapeHtml(corr.uiAction?.url || 'N/A')}</div>
            <div><strong>API count:</strong> ${escapeHtml(corr.apiCalls?.length || 0)}</div>
            <div><strong>Confidence score:</strong> ${escapeHtml(corr.confidence?.score || 0)}</div>
          </div>

          <div class="flow-block">
            <h3>Confidence Notes</h3>
            ${renderReasons(corr.confidence?.reasons)}
          </div>

          <div class="flow-block">
            <h3>API Review</h3>
            ${renderApiList(corr)}
            <div class="small-note">Checked APIs remain relevant for export. Unchecked APIs are kept for traceability but treated as ignored.</div>
          </div>

          <div class="flow-block">
            <h3>Variables</h3>
            ${renderVariables(corr.variables)}
          </div>

          <div class="flow-block">
            <h3>Assertions</h3>
            <div class="assertion-grid">
              <textarea data-role="ui-assertions" data-correlation-id="${escapeHtml(corr.id)}" placeholder="One UI assertion per line">${escapeHtml(uiAssertions)}</textarea>
              <textarea data-role="api-assertions" data-correlation-id="${escapeHtml(corr.id)}" placeholder="One API assertion per line">${escapeHtml(apiAssertions)}</textarea>
            </div>
            <textarea data-role="review-notes" data-correlation-id="${escapeHtml(corr.id)}" placeholder="Review notes">${escapeHtml(reviewNotes)}</textarea>
            <div class="actions-row">
              <select data-role="review-status" data-correlation-id="${escapeHtml(corr.id)}">
                <option value="pending" ${(corr.review?.status || 'pending') === 'pending' ? 'selected' : ''}>Pending review</option>
                <option value="reviewed" ${(corr.review?.status || 'pending') === 'reviewed' ? 'selected' : ''}>Reviewed</option>
              </select>
              <button class="secondary" data-role="save-review" data-correlation-id="${escapeHtml(corr.id)}" data-selected-api-ids="${escapeHtml(selectedApiIds.join(','))}">Save Review</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderJson() {
    elements.jsonOutput.textContent = JSON.stringify(flowData, null, 2);
  }

  async function refreshFlowData() {
    const response = await chrome.runtime.sendMessage({ type: 'GET_FLOW_DATA' });
    if (response && response.flowData) {
      flowData = response.flowData;
      updateStats();
      renderFlow();
      renderJson();
    }
  }

  async function startRecording() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
        throw new Error('Cannot record on browser internal pages. Please open a regular webpage (http/https).');
      }

      const response = await chrome.runtime.sendMessage({
        type: 'START_RECORDING',
        tabId: tab.id,
        tabUrl: tab.url
      });

      if (response && response.success) {
        updateStatus(true);
        flowData = { uiActions: [], apiCalls: [], correlations: [], stats: { correlation: null, capture: null } };
        updateStats();
        renderFlow();
      } else {
        throw new Error(response?.error || 'Failed to start recording');
      }
    } catch (error) {
      console.error('[FlowTrace] Error starting recording:', error);
      alert('Failed to start recording: ' + error.message);
    }
  }

  async function stopRecording() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });

      if (response && response.flowData) {
        flowData = response.flowData;
        updateStats();
        renderFlow();
        renderJson();
      }

      updateStatus(false);
    } catch (error) {
      console.error('[FlowTrace] Error stopping recording:', error);
      updateStatus(false);
    }
  }

  async function clearData() {
    try {
      await chrome.runtime.sendMessage({ type: 'CLEAR_FLOW' });
      flowData = { uiActions: [], apiCalls: [], correlations: [], stats: { correlation: null, capture: null } };
      updateStats();
      renderFlow();
      elements.exportOutput.classList.add('hidden');
      elements.jsonOutput.textContent = '';
    } catch (error) {
      console.error('[FlowTrace] Error clearing data:', error);
    }
  }

  async function exportSelenium() {
    try {
      await refreshFlowData();
      if (flowData.uiActions.length === 0 && flowData.correlations.length === 0) {
        alert('No recorded flow to export. Please record some actions first.');
        return;
      }

      const response = await chrome.runtime.sendMessage({
        type: 'EXPORT_FLOW',
        format: 'selenium'
      });

      if (!response || !response.success) {
        throw new Error(response?.error || 'Export failed');
      }

      alert('Selenium code exported. Check your downloads folder.');
    } catch (error) {
      console.error('[FlowTrace] Export error:', error);
      alert('Export failed: ' + error.message);
    }
  }

  async function exportRestAssured() {
    try {
      await refreshFlowData();
      if (flowData.uiActions.length === 0 && flowData.correlations.length === 0) {
        alert('No recorded flow to export. Please record some actions first.');
        return;
      }

      const response = await chrome.runtime.sendMessage({
        type: 'EXPORT_FLOW',
        format: 'rest-assured'
      });

      if (!response || !response.success) {
        throw new Error(response?.error || 'Export failed');
      }

      alert('Rest Assured code exported. Check your downloads folder.');
    } catch (error) {
      console.error('[FlowTrace] Export error:', error);
      alert('Export failed: ' + error.message);
    }
  }

  function exportJson() {
    refreshFlowData()
      .then(() => {
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
      })
      .catch(error => {
        console.error('[FlowTrace] JSON export refresh error:', error);
        alert('Could not refresh flow data before JSON export.');
      });
  }

  function getCorrelationCard(element) {
    return element.closest('.flow-card');
  }

  async function saveReview(button) {
    const correlationId = button.dataset.correlationId;
    const card = getCorrelationCard(button);
    if (!card) return;

    const uiAssertions = card.querySelector('[data-role="ui-assertions"]').value
      .split('\n')
      .map(item => item.trim())
      .filter(Boolean);
    const apiAssertions = card.querySelector('[data-role="api-assertions"]').value
      .split('\n')
      .map(item => item.trim())
      .filter(Boolean);
    const reviewNotes = card.querySelector('[data-role="review-notes"]').value.trim();
    const reviewStatus = card.querySelector('[data-role="review-status"]').value;
    const apiSelections = Array.from(card.querySelectorAll('[data-role="api-toggle"]:checked')).map(input => input.dataset.apiId);

    const response = await chrome.runtime.sendMessage({
      type: 'UPDATE_CORRELATION_REVIEW',
      correlationId,
      uiAssertions,
      apiAssertions,
      reviewNotes,
      reviewStatus,
      apiSelections
    });

    if (!response || !response.success) {
      alert(response?.error || 'Could not save review changes.');
      return;
    }

    await refreshFlowData();
  }

  elements.btnStart.addEventListener('click', startRecording);
  elements.btnStop.addEventListener('click', stopRecording);
  elements.btnClear.addEventListener('click', clearData);
  elements.btnExportSelenium.addEventListener('click', exportSelenium);
  elements.btnExportRestAssured.addEventListener('click', exportRestAssured);
  elements.btnExportJson.addEventListener('click', exportJson);

  elements.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;

      elements.tabs.forEach(t => t.classList.remove('active'));
      elements.tabContents.forEach(c => c.classList.remove('active'));

      tab.classList.add('active');
      document.getElementById(`tab-${tabName}`).classList.add('active');
    });
  });

  elements.flowContainer.addEventListener('click', (event) => {
    const button = event.target.closest('[data-role="save-review"]');
    if (!button) return;
    saveReview(button).catch(error => {
      console.error('[FlowTrace] Save review error:', error);
      alert('Could not save review: ' + error.message);
    });
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (
      message.type === 'RECORDING_STARTED' ||
      message.type === 'RECORDING_STOPPED' ||
      message.type === 'UI_ACTION_RECORDED' ||
      message.type === 'API_CALL_RECORDED' ||
      message.type === 'DOM_MUTATION_RECORDED' ||
      message.type === 'CORRELATION_REVIEW_UPDATED' ||
      message.type === 'FLOW_CLEARED'
    ) {
      if (message.type === 'RECORDING_STARTED') {
        updateStatus(true);
      } else if (message.type === 'RECORDING_STOPPED') {
        updateStatus(false);
      }

      refreshFlowData().catch(error => {
        console.error('[FlowTrace] Refresh error:', error);
      });
    }

    sendResponse({ success: true });
  });

  updateStatus(false);
  refreshFlowData().catch(() => {});
  console.log('[FlowTrace] Panel initialized');
})();
