/**
 * Correlation Engine
 * Maps UI actions to API calls within time window (500ms-1500ms)
 * Tracks DOM mutations after API responses
 * Filters noise (analytics, ads, polling)
 */

class CorrelationEngine {
  constructor() {
    this.uiActions = [];
    this.apiCalls = [];
    this.correlations = [];
    // Allow immediate correlations for fast APIs; extend max for slower networks
    this.correlationWindow = { min: 0, max: 3000 }; // ms
    this.noisePatterns = this.initNoisePatterns();
  }

  /**
   * Initialize noise patterns for filtering
   * Analytics, ads, polling, tracking requests
   */
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
      ]
    };
  }

  /**
   * Add UI action to correlation queue
   * @param {Object} action - UI action data
   */
  addUIAction(action) {
    this.uiActions.push({
      ...action,
      timestamp: Date.now(),
      id: this.generateId('ui')
    });
    
    // Try to correlate immediately if we have recent API calls
    this.attemptCorrelation();
    
    // Cleanup old actions (keep last 100)
    if (this.uiActions.length > 100) {
      this.uiActions.shift();
    }
  }

  /**
   * Add API call to correlation queue
   * @param {Object} apiCall - API call data
   */
  addAPICall(apiCall) {
    // Filter noise before storing
    if (this.isNoise(apiCall)) {
      return;
    }

    this.apiCalls.push({
      ...apiCall,
      timestamp: Date.now(),
      id: this.generateId('api'),
      correlated: false
    });

    // Try to correlate immediately if we have recent UI actions
    this.attemptCorrelation();

    // Cleanup old API calls (keep last 200)
    if (this.apiCalls.length > 200) {
      this.apiCalls.shift();
    }
  }

  /**
   * Check if API call matches noise patterns
   * @param {Object} apiCall - API call data
   * @returns {boolean} True if should be filtered
   */
  isNoise(apiCall) {
    const url = apiCall.url || '';
    const lowerUrl = url.toLowerCase();

    // Check domain patterns
    for (const domain of this.noisePatterns.domains) {
      if (lowerUrl.includes(domain)) {
        return true;
      }
    }

    // Check path patterns
    for (const path of this.noisePatterns.paths) {
      if (lowerUrl.includes(path)) {
        return true;
      }
    }

    // Check polling patterns
    for (const poll of this.noisePatterns.polling) {
      if (lowerUrl.includes(poll)) {
        return true;
      }
    }

    // Check if it's a OPTIONS preflight request (not user-initiated)
    if (apiCall.method === 'OPTIONS') {
      return true;
    }

    return false;
  }

  /**
   * Attempt to correlate UI actions with API calls
   * Matches actions within correlation window
   */
  attemptCorrelation() {
    const now = Date.now();

    for (const action of this.uiActions) {
      // Skip already correlated actions
      if (action.correlated) continue;

      // Find matching API calls within time window
      const matchingAPICalls = this.apiCalls.filter(api => {
        if (api.correlated) return false;

        const timeDiff = api.timestamp - action.timestamp;
        return timeDiff >= this.correlationWindow.min && 
               timeDiff <= this.correlationWindow.max;
      });

      // Create correlation if matches found
      if (matchingAPICalls.length > 0) {
        const correlation = {
          id: this.generateId('corr'),
          uiAction: action,
          apiCalls: matchingAPICalls,
          createdAt: now,
          domMutations: []
        };

        this.correlations.push(correlation);

        // Mark as correlated
        action.correlated = true;
        matchingAPICalls.forEach(api => api.correlated = true);

        // Start tracking DOM mutations for this correlation
        this.trackDOMMutations(correlation);
      }
    }
  }

  /**
   * Track DOM mutations after API response
   * @param {Object} correlation - Correlation object
   */
  trackDOMMutations(correlation) {
    // Listen for DOM mutations from content script
    // This will be called when content.js detects mutations
    const mutationHandler = (mutations) => {
      const now = Date.now();
      const timeSinceAPI = now - correlation.apiCalls[0].timestamp;

      // Only track mutations within 2 seconds of API response
      if (timeSinceAPI > 2000) {
        return;
      }

      correlation.domMutations.push({
        timestamp: now,
        mutations: mutations.map(m => ({
          type: m.type,
          target: m.target.tagName,
          addedNodes: m.addedNodes.length,
          removedNodes: m.removedNodes.length,
          attributeName: m.attributeName
        }))
      });
    };

    // Store handler reference for cleanup
    correlation.mutationHandler = mutationHandler;

    return mutationHandler;
  }

  /**
   * Get all correlations
   * @returns {Array} Array of correlations
   */
  getCorrelations() {
    return this.correlations.map(corr => ({
      id: corr.id,
      uiAction: corr.uiAction,
      apiCalls: corr.apiCalls,
      domMutations: corr.domMutations,
      createdAt: corr.createdAt
    }));
  }

  /**
   * Get correlation by UI action ID
   * @param {string} uiActionId - UI action ID
   * @returns {Object|null} Correlation object or null
   */
  getCorrelationByUIAction(uiActionId) {
    return this.correlations.find(c => c.uiAction.id === uiActionId) || null;
  }

  /**
   * Get correlation by API call ID
   * @param {string} apiCallId - API call ID
   * @returns {Object|null} Correlation object or null
   */
  getCorrelationByAPICall(apiCallId) {
    return this.correlations.find(c => 
      c.apiCalls.some(api => api.id === apiCallId)
    ) || null;
  }

  /**
   * Clear all data
   */
  clear() {
    this.uiActions = [];
    this.apiCalls = [];
    this.correlations = [];
  }

  /**
   * Add DOM mutation coming from content script into matching correlation(s)
   * @param {Object} mutation - Mutation object with timestamp and changes
   */
  addDomMutation(mutation) {
    if (!mutation || !mutation.timestamp) return;
    // Find correlations where the mutation is within 2000ms of the first API call
    for (const corr of this.correlations) {
      const apiTs = corr.apiCalls && corr.apiCalls[0] && corr.apiCalls[0].timestamp;
      if (!apiTs) continue;
      const delta = Math.abs(mutation.timestamp - apiTs);
      if (delta <= 2000) {
        corr.domMutations = corr.domMutations || [];
        corr.domMutations.push(mutation);
      }
    }
  }

  /**
   * Generate unique ID
   * @param {string} prefix - ID prefix
   * @returns {string} Unique ID
   */
  generateId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Export correlations for code generation
   * @returns {Object} Structured flow data
   */
  exportFlow() {
    return {
      flow: this.correlations.map(corr => ({
        step: corr.uiAction,
        apiCalls: corr.apiCalls,
        domChanges: corr.domMutations
      })),
      metadata: {
        totalSteps: this.correlations.length,
        exportedAt: new Date().toISOString()
      }
    };
  }

  /**
   * Get statistics
   * @returns {Object} Correlation statistics
   */
  getStats() {
    const totalUIActions = this.uiActions.length;
    const correlatedUIActions = this.uiActions.filter(a => a.correlated).length;
    const totalAPICalls = this.apiCalls.length;
    const correlatedAPICalls = this.apiCalls.filter(a => a.correlated).length;

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
        : '0%'
    };
  }
}

// Export for use in other modules (CommonJS)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CorrelationEngine;
}

// Make available globally for workers, content scripts, and other environments
if (typeof globalThis !== 'undefined') {
  globalThis.CorrelationEngine = CorrelationEngine;
}
