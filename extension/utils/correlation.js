/**
 * Correlation Engine
 * Builds QA-oriented correlations between UI actions and API calls
 * using timing, request importance, keyword overlap, and DOM evidence.
 */

class CorrelationEngine {
  constructor() {
    this.uiActions = [];
    this.apiCalls = [];
    this.correlations = [];
    this.correlationWindow = { min: 0, max: 5000 };
    this.relevanceThreshold = 45;
    this.secondaryThreshold = 30;
    this.noisePatterns = this.initNoisePatterns();
  }

  initNoisePatterns() {
    return {
      domains: [
        'google-analytics.com',
        'analytics.google.com',
        'doubleclick.net',
        'adsystem.',
        'adservice.',
        'facebook.com/tr',
        'pixel.facebook',
        'linkedin.com/px',
        'twitter.com/i/jot',
        'bat.bing.com',
        'api.segment.io',
        'sentry.io',
        'bugsnag.com',
        'logrocket.com',
        'fullstory.com',
        'hotjar.com',
        'crazyegg.com',
        'optimizely.com',
        'gtm.'
      ],
      paths: [
        '/analytics',
        '/track',
        '/tracking',
        '/pixel',
        '/beacon',
        '/log',
        '/collect',
        '/pageview',
        '/impression',
        '/ad/',
        '/ads/'
      ],
      params: [
        'utm_',
        'fbclid',
        'gclid',
        'tracking',
        'pixel',
        'analytics'
      ],
      polling: [
        '/heartbeat',
        '/ping',
        '/status',
        '/health',
        '/keepalive',
        '/poll',
        '/sync'
      ],
      auth: [
        '/login',
        '/logout',
        '/session',
        '/token',
        '/refresh',
        '/authenticate',
        '/oauth',
        '/authorize'
      ],
      staticAssets: [
        '.css',
        '.js',
        '.png',
        '.jpg',
        '.jpeg',
        '.gif',
        '.svg',
        '.ico',
        '.woff',
        '.woff2',
        '.ttf'
      ]
    };
  }

  addUIAction(action) {
    this.uiActions.push({
      ...action,
      timestamp: action.timestamp || Date.now(),
      id: action.id || this.generateId('ui'),
      correlated: false
    });

    this.attemptCorrelation();

    if (this.uiActions.length > 100) {
      this.uiActions.shift();
    }
  }

  addAPICall(apiCall) {
    const classification = this.classifyAPICall(apiCall);

    this.apiCalls.push({
      ...apiCall,
      timestamp: apiCall.timestamp || Date.now(),
      id: apiCall.id || this.generateId('api'),
      correlated: false,
      classification: classification.type,
      classificationReasons: classification.reasons,
      classificationScore: classification.score
    });

    this.attemptCorrelation();

    if (this.apiCalls.length > 200) {
      this.apiCalls.shift();
    }
  }

  classifyAPICall(apiCall) {
    const url = (apiCall.url || '').toLowerCase();
    const method = (apiCall.method || 'GET').toUpperCase();
    const reasons = [];
    let score = 0;
    let type = 'business';

    if (this.noisePatterns.staticAssets.some(ext => url.includes(ext))) {
      type = 'noise';
      reasons.push('static asset request');
      score -= 50;
    }

    for (const domain of this.noisePatterns.domains) {
      if (url.includes(domain)) {
        type = 'noise';
        reasons.push(`matched telemetry domain ${domain}`);
        score -= 60;
        break;
      }
    }

    for (const path of this.noisePatterns.paths) {
      if (url.includes(path)) {
        type = 'noise';
        reasons.push(`matched telemetry path ${path}`);
        score -= 40;
        break;
      }
    }

    for (const poll of this.noisePatterns.polling) {
      if (url.includes(poll)) {
        type = type === 'noise' ? 'noise' : 'polling';
        reasons.push(`matched polling pattern ${poll}`);
        score -= 25;
        break;
      }
    }

    for (const auth of this.noisePatterns.auth) {
      if (url.includes(auth)) {
        type = type === 'noise' ? 'noise' : 'auth';
        reasons.push(`matched auth/session pattern ${auth}`);
        score -= 10;
        break;
      }
    }

    if (method === 'OPTIONS') {
      type = 'noise';
      reasons.push('preflight request');
      score -= 80;
    }

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      score += 20;
      reasons.push(`state-changing method ${method}`);
    } else if (method === 'GET') {
      score += 5;
    }

    if (apiCall.status >= 400) {
      score += 8;
      reasons.push(`error response ${apiCall.status}`);
    }

    if (!reasons.length) {
      reasons.push('no noise signals matched');
    }

    return { type, reasons, score };
  }

  attemptCorrelation() {
    const now = Date.now();

    for (const action of this.uiActions) {
      if (action.correlated) continue;

      const candidates = this.apiCalls
        .filter(api => !api.correlated && this.isCandidateForAction(action, api))
        .map(api => this.scoreCandidate(action, api))
        .filter(candidate => candidate.score >= this.secondaryThreshold)
        .sort((a, b) => b.score - a.score);

      if (candidates.length === 0) {
        continue;
      }

      const relevant = this.selectRelevantCandidates(candidates);
      if (relevant.length === 0) {
        continue;
      }

      const confidence = this.buildConfidence(relevant);
      const correlation = {
        id: this.generateId('corr'),
        uiAction: action,
        apiCalls: relevant.map(item => ({
          ...item.api,
          correlationScore: item.score,
          correlationReasons: item.reasons,
          relevance: item.relevance
        })),
        createdAt: now,
        domMutations: [],
        confidence,
        classificationSummary: this.buildClassificationSummary(relevant),
        variables: this.extractVariables(action, relevant),
        assertions: { ui: [], api: [] },
        review: { status: 'pending', notes: '' }
      };

      this.correlations.push(correlation);
      action.correlated = true;
      relevant.forEach(item => {
        item.api.correlated = item.relevance === 'primary' || item.relevance === 'secondary';
      });
      this.trackDOMMutations(correlation);
    }
  }

  isCandidateForAction(action, api) {
    const timeDiff = (api.timestamp || 0) - (action.timestamp || 0);
    if (timeDiff < this.correlationWindow.min || timeDiff > this.correlationWindow.max) {
      return false;
    }

    if (api.classification === 'noise') {
      return false;
    }

    if (action.tabId && api.tabId && action.tabId !== api.tabId) {
      return false;
    }

    return true;
  }

  scoreCandidate(action, api) {
    const reasons = [];
    let score = 0;
    const timeDiff = (api.timestamp || 0) - (action.timestamp || 0);

    if (timeDiff <= 400) {
      score += 35;
      reasons.push('API happened immediately after action');
    } else if (timeDiff <= 1200) {
      score += 25;
      reasons.push('API happened soon after action');
    } else if (timeDiff <= 2500) {
      score += 12;
      reasons.push('API happened within extended action window');
    } else {
      score += 4;
      reasons.push('API happened late in the action window');
    }

    const method = (api.method || 'GET').toUpperCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      score += 18;
      reasons.push(`business-heavy method ${method}`);
    } else if (method === 'GET') {
      score += 6;
    }

    const keywordScore = this.scoreKeywordOverlap(action, api);
    score += keywordScore.score;
    reasons.push(...keywordScore.reasons);

    if (api.classification === 'business') {
      score += 10;
      reasons.push('classified as business API');
    } else if (api.classification === 'auth') {
      score -= 8;
      reasons.push('classified as auth/session API');
    } else if (api.classification === 'polling') {
      score -= 18;
      reasons.push('classified as polling API');
    }

    if (action.type === 'navigation' || action.type === 'spa_navigation') {
      if (method === 'GET') {
        score += 8;
        reasons.push('navigation commonly triggers GET APIs');
      }
    }

    if (action.type === 'input' || action.type === 'focus') {
      if (api.classification === 'polling') {
        score -= 8;
      }
    }

    if (api.status >= 500) {
      score += 4;
      reasons.push('server error likely tied to visible step impact');
    }

    return {
      api,
      score,
      reasons,
      relevance: 'candidate',
      timeDiff
    };
  }

  scoreKeywordOverlap(action, api) {
    const reasons = [];
    let score = 0;
    const url = (api.url || '').toLowerCase();
    const tokens = this.extractActionKeywords(action);

    const overlaps = tokens.filter(token => token && url.includes(token));
    if (overlaps.length > 0) {
      score += Math.min(20, overlaps.length * 7);
      reasons.push(`URL matches action keywords: ${overlaps.slice(0, 3).join(', ')}`);
    }

    if ((action.elementTag || '').toLowerCase() === 'button' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes((api.method || '').toUpperCase())) {
      score += 6;
      reasons.push('button action paired with state-changing request');
    }

    return { score, reasons };
  }

  extractActionKeywords(action) {
    const rawParts = [
      action.type,
      action.elementText,
      action.elementName,
      action.elementType,
      action.selector,
      action.placeholder,
      action.navigationType
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return Array.from(new Set(
      rawParts
        .split(/[^a-z0-9]+/)
        .filter(token => token.length >= 3)
        .filter(token => !['button', 'input', 'click', 'focus', 'text', 'form', 'div', 'span'].includes(token))
    ));
  }

  selectRelevantCandidates(candidates) {
    if (!candidates.length) {
      return [];
    }

    const top = candidates[0];
    if (top.score < this.relevanceThreshold) {
      return [];
    }

    return candidates
      .filter(candidate => candidate.score >= this.secondaryThreshold && top.score - candidate.score <= 18)
      .map((candidate, index) => ({
        ...candidate,
        relevance: index === 0 ? 'primary' : 'secondary'
      }));
  }

  buildConfidence(relevant) {
    const averageScore = relevant.reduce((sum, item) => sum + item.score, 0) / relevant.length;
    let level = 'low';

    if (averageScore >= 75) {
      level = 'high';
    } else if (averageScore >= 58) {
      level = 'medium';
    }

    return {
      score: Math.round(Math.min(100, averageScore)),
      level,
      reasons: Array.from(new Set(relevant.flatMap(item => item.reasons))).slice(0, 6)
    };
  }

  buildClassificationSummary(relevant) {
    return relevant.reduce((summary, item) => {
      const key = item.api.classification || 'unknown';
      summary[key] = (summary[key] || 0) + 1;
      return summary;
    }, {});
  }

  trackDOMMutations(correlation) {
    const mutationHandler = (mutations) => {
      const now = Date.now();
      const firstApiTs = correlation.apiCalls[0]?.timestamp;
      const timeSinceAPI = now - firstApiTs;

      if (timeSinceAPI > 2500) {
        return;
      }

      correlation.domMutations.push({
        timestamp: now,
        mutations: mutations.map(m => ({
          type: m.type,
          target: m.target?.tagName,
          addedNodes: m.addedNodes?.length || 0,
          removedNodes: m.removedNodes?.length || 0,
          attributeName: m.attributeName
        }))
      });

      correlation.confidence.score = Math.min(100, correlation.confidence.score + 5);
      correlation.confidence.level = correlation.confidence.score >= 75
        ? 'high'
        : correlation.confidence.score >= 58
          ? 'medium'
          : 'low';

      if (!correlation.confidence.reasons.includes('DOM changed after related API response')) {
        correlation.confidence.reasons.push('DOM changed after related API response');
      }
    };

    correlation.mutationHandler = mutationHandler;
    return mutationHandler;
  }

  getCorrelations() {
    return this.correlations.map(corr => ({
      id: corr.id,
      uiAction: corr.uiAction,
      apiCalls: corr.apiCalls,
      domMutations: corr.domMutations,
      createdAt: corr.createdAt,
      confidence: corr.confidence,
      classificationSummary: corr.classificationSummary,
      variables: corr.variables,
      assertions: corr.assertions || { ui: [], api: [] },
      review: corr.review || { status: 'pending', notes: '' }
    }));
  }

  getCorrelationByUIAction(uiActionId) {
    return this.correlations.find(c => c.uiAction.id === uiActionId) || null;
  }

  getCorrelationByAPICall(apiCallId) {
    return this.correlations.find(c =>
      c.apiCalls.some(api => api.id === apiCallId)
    ) || null;
  }

  updateCorrelationReview(correlationId, updates = {}) {
    const correlation = this.correlations.find(c => c.id === correlationId);
    if (!correlation) {
      return null;
    }

    const currentAssertions = correlation.assertions || { ui: [], api: [] };
    correlation.assertions = {
      ui: Array.isArray(updates.uiAssertions) ? updates.uiAssertions : currentAssertions.ui,
      api: Array.isArray(updates.apiAssertions) ? updates.apiAssertions : currentAssertions.api
    };

    correlation.review = {
      status: updates.reviewStatus || correlation.review?.status || 'pending',
      notes: typeof updates.reviewNotes === 'string' ? updates.reviewNotes : (correlation.review?.notes || '')
    };

    if (Array.isArray(updates.apiSelections)) {
      const selected = new Set(updates.apiSelections);
      correlation.apiCalls = correlation.apiCalls.map(api => ({
        ...api,
        reviewSelection: selected.has(api.id) ? 'relevant' : 'ignored'
      }));
    }

    return correlation;
  }

  clear() {
    this.uiActions = [];
    this.apiCalls = [];
    this.correlations = [];
  }

  addDomMutation(mutation) {
    if (!mutation || !mutation.timestamp) return;

    for (const corr of this.correlations) {
      const apiTs = corr.apiCalls?.[0]?.timestamp;
      if (!apiTs) continue;

      const delta = Math.abs(mutation.timestamp - apiTs);
      if (delta <= 2500) {
        corr.domMutations = corr.domMutations || [];
        corr.domMutations.push(mutation);

        corr.confidence.score = Math.min(100, corr.confidence.score + 5);
        corr.confidence.level = corr.confidence.score >= 75
          ? 'high'
          : corr.confidence.score >= 58
            ? 'medium'
            : 'low';

        if (!corr.confidence.reasons.includes('DOM mutation observed near correlated API')) {
          corr.confidence.reasons.push('DOM mutation observed near correlated API');
        }
      }
    }
  }

  generateId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  exportFlow() {
    return {
      flow: this.correlations.map(corr => ({
        step: corr.uiAction,
        apiCalls: corr.apiCalls,
        domChanges: corr.domMutations,
        confidence: corr.confidence,
        variables: corr.variables,
        assertions: corr.assertions || { ui: [], api: [] },
        review: corr.review || { status: 'pending', notes: '' }
      })),
      metadata: {
        totalSteps: this.correlations.length,
        exportedAt: new Date().toISOString()
      }
    };
  }

  getStats() {
    const totalUIActions = this.uiActions.length;
    const correlatedUIActions = this.uiActions.filter(a => a.correlated).length;
    const totalAPICalls = this.apiCalls.length;
    const correlatedAPICalls = this.apiCalls.filter(a => a.correlated).length;
    const byClassification = this.apiCalls.reduce((summary, api) => {
      const key = api.classification || 'unknown';
      summary[key] = (summary[key] || 0) + 1;
      return summary;
    }, {});

    return {
      totalUIActions,
      correlatedUIActions,
      uncorrelatedUIActions: totalUIActions - correlatedUIActions,
      totalAPICalls,
      correlatedAPICalls,
      uncorrelatedAPICalls: totalAPICalls - correlatedAPICalls,
      totalCorrelations: this.correlations.length,
      correlationRate: totalUIActions > 0
        ? ((correlatedUIActions / totalUIActions) * 100).toFixed(2) + '%'
        : '0%',
      byClassification
    };
  }

  extractVariables(action, relevant) {
    return {
      produced: [
        ...this.extractVariablesFromAction(action),
        ...relevant.flatMap(item => this.extractVariablesFromApi(item.api))
      ],
      consumed: this.extractConsumedVariables(action)
    };
  }

  extractVariablesFromAction(action) {
    const produced = [];

    if (action.type === 'input' && action.inputValue) {
      produced.push({
        name: this.buildVariableName(action.elementName || action.placeholder || action.selector || 'input'),
        source: 'ui',
        kind: 'input',
        valuePreview: this.truncateValue(action.inputValue),
        selector: action.selector
      });
    }

    return produced;
  }

  extractVariablesFromApi(api) {
    const body = this.safeParseResponseBody(api.responseBody);
    if (!body || typeof body !== 'object') {
      return [];
    }

    const variables = [];
    const preferredKeys = ['id', 'name', 'status', 'token', 'code', 'email', 'userId', 'orderId', 'message'];

    preferredKeys.forEach(key => {
      if (body[key] !== undefined && body[key] !== null && body[key] !== '') {
        variables.push({
          name: this.buildVariableName(key),
          source: 'api',
          kind: 'response-field',
          path: key,
          valuePreview: this.truncateValue(body[key]),
          apiUrl: api.url
        });
      }
    });

    return variables;
  }

  extractConsumedVariables(action) {
    const consumed = [];
    const value = action.inputValue || action.elementText || '';
    const matches = String(value).match(/\{\{([^}]+)\}\}/g) || [];

    matches.forEach(match => {
      consumed.push({
        name: match.replace(/[{}]/g, '').trim(),
        source: 'template',
        kind: 'placeholder'
      });
    });

    return consumed;
  }

  safeParseResponseBody(responseBody) {
    if (!responseBody) return null;
    if (typeof responseBody === 'object') return responseBody;

    try {
      return JSON.parse(responseBody);
    } catch (error) {
      return null;
    }
  }

  buildVariableName(input) {
    const cleaned = String(input || 'value')
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .slice(0, 3);

    if (!cleaned.length) {
      return 'value';
    }

    return cleaned
      .map((part, index) => index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
  }

  truncateValue(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > 80 ? text.substring(0, 80) : text;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CorrelationEngine;
}

if (typeof globalThis !== 'undefined') {
  globalThis.CorrelationEngine = CorrelationEngine;
}
