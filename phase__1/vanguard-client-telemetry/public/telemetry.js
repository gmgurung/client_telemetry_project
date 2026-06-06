/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CLIENT-SIDE TELEMETRY SDK
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Purpose: Universal JavaScript library for capturing behavioral, system, and 
 * sentiment-adjacent events across all user journeys.
 * 
 * Core Responsibilities:
 *   1. Event Collection: Automatically captures user interactions (clicks, scrolls, 
 *      form activity) without requiring manual instrumentation in business logic.
 *   2. Data Normalization: Enforces consistent schema (camelCase, elementId extraction) 
 *      to enable downstream ML feature engineering.
 *   3. Behavioral Metrics: Implements detection algorithms for friction signals 
 *      (rage clicks, form abandonment, refocus patterns).
 * 
 * Architecture Pattern:
 *   - Singleton design pattern for global state management
 *   - Event-driven architecture using native DOM listeners
 *   - Fire-and-forget transmission (does not block UI thread)
 * 
 * Integration:
 *   - Initialize once per page: Telemetry.init('pageRoute', {...contextOptions})
 *   - Emits events to server via POST /api/telemetry
 *   - Uses sendBeacon() for critical events during page unload
 * ═══════════════════════════════════════════════════════════════════════════
 */
const Telemetry = {
  pageRoute: null,
  baseContext: {},
  _behavioralAttached: false,
  _formInteracted: false,
  _formSubmitted: false,
  _pageStartTime: null,

  /**
   * Initialize or retrieve session ID (guarantees non-null return).
   * @returns {string} Session ID
   */
  _initSession() {
    let sid = sessionStorage.getItem('sessionId');
    if (!sid) {
      sid = `S${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      sessionStorage.setItem('sessionId', sid);
    }
    return sid;
  },

  /**
   * Initialize telemetry for a page.
   * @param {string} pageName - Route identifier (e.g., 'trade', 'login')
   * @param {object} options - Additional context to attach to all events
   */
  init(pageName, options = {}) {
    this.pageRoute = pageName;
    this.baseContext = options;
    this._pageStartTime = performance.now();

    this._initSession();
    if (!sessionStorage.getItem('userId')) {
      sessionStorage.setItem('userId', 'U-guest');
    }

    // U-turn detection (AI metric #7): route history A -> B -> A
    const routeHistoryKey = 'telemetry_route_history';
    let routeHistory = [];
    try {
      const stored = sessionStorage.getItem(routeHistoryKey);
      if (stored) routeHistory = JSON.parse(stored);
    } catch (_) {}
    routeHistory.push(pageName);
    if (routeHistory.length > 5) routeHistory = routeHistory.slice(-5);
    if (routeHistory.length >= 3 && routeHistory[routeHistory.length - 1] === routeHistory[routeHistory.length - 3]) {
      this.emit('u_turn', { path: routeHistory.slice(-3) });
    }
    try {
      sessionStorage.setItem(routeHistoryKey, JSON.stringify(routeHistory));
    } catch (_) {}

    this.attachBehavioralCapture();
    this.emit('page_view', {
      pageRoute: this.pageRoute,
      referrer: document.referrer || null
    });
  },

  /**
   * Data Normalization Engine
   * 
   * Why we enforce this schema:
   *   - Promotes `id` to top-level `elementId` for ML feature engineering
   *   - Ensures consistent camelCase naming (critical for JSON parsing in Python/R)
   *   - Isolates business-specific metadata from universal context fields
   * 
   * Schema Contract:
   *   {
   *     sessionId, userId, pageRoute, eventType, timestamp, url,
   *     elementId? (extracted from metadata.id),
   *     ...baseContext (page-level attrs),
   *     metadata: {...} (event-specific data)
   *   }
   * 
   * Session ID Guarantee:
   *   - Always retrieves from sessionStorage OR generates new session
   *   - Prevents null sessionId in early page_view events (race condition fix)
   */
  _buildEvent(eventType, metadata = {}) {
    const { id, ...restMetadata } = metadata;
    const sid = sessionStorage.getItem('sessionId') || this._initSession();
    return {
      sessionId: sid,
      userId: sessionStorage.getItem('userId') || 'U-guest',
      pageRoute: this.pageRoute,
      eventType,
      timestamp: new Date().toISOString(),
      url: window.location.href,
      ...(id && { elementId: id }),
      ...this.baseContext,
      metadata: restMetadata,
    };
  },

  /**
   * Emit a telemetry event.
   * @param {string} eventType - Event name
   * @param {object} metadata - Event-specific data
   * 
   * Flow Completion Handling:
   *   - When flow_complete is emitted, marks form as "submitted" to prevent
   *     false form_abandonment events for flows that complete with failure status
   */
  emit(eventType, metadata = {}) {
    const evt = this._buildEvent(eventType, metadata);
    console.log('📊 Telemetry:', eventType, metadata);

    // Mark form as submitted when any flow completes (success or failure)
    if (eventType === 'flow_complete') {
      this._formSubmitted = true;
    }

    fetch('/api/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(evt),
    }).catch(() => {});
  },

  sendBeacon(eventType, metadata = {}) {
    const evt = this._buildEvent(eventType, metadata);
    const blob = new Blob([JSON.stringify(evt)], { type: 'application/json' });
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/telemetry', blob);
    } else {
      this.emit(eventType, metadata);
    }
  },

  emitTimeout(operation, metadata = {}) {
    this.emit('timeout', { operation, ...metadata });
  },

  emitRetry(action, attemptNumber, metadata = {}) {
    this.emit('retry_attempt', { action, attemptNumber, ...metadata });
  },

  /**
   * ─────────────────────────────────────────────────────────────────────
   * Metadata Extraction Helper (Noise Reduction)
   * ─────────────────────────────────────────────────────────────────────
   * 
   * Extracts ONLY high-signal metadata from DOM elements.
   * 
   * AI-Relevant Fields:
   *   - id: Element identifier (critical for tracking specific UI components)
   *   - text: Element content (reveals user intent, e.g., "Submit" vs "Cancel")
   *   - value: Form field data (for input analysis)
   * 
   * EXCLUDED Fields (Noise):
   *   - tag: Redundant (AI doesn't care if it's a <div> or <button>)
   *   - textLen: Derived metric (AI can count characters if needed)
   *   - nodeType: Implementation detail (irrelevant to behavior)
   *   - role: Accessibility metadata (not behavior-related)
   */
  _extractMetadata(element, options = {}) {
    const metadata = {};
    
    // Element identifier (highest priority)
    if (element.id) {
      metadata.id = element.id;
    }
    
    // Element text content (reveals user action context)
    if (options.includeText !== false) {
      const text = (element.textContent || '').trim().slice(0, 50);
      if (text) {
        metadata.text = text;
      }
    }
    
    // Form field value (for input analysis)
    if (options.includeValue && element.value !== undefined) {
      metadata.value = element.value;
    }
    
    return metadata;
  },

  /**
   * Attach global behavioral capture for SDD-required metrics.
   * Captures: rage clicks, scroll depth, idle time, refocus, errors, form abandonment.
   */
  attachBehavioralCapture() {
    if (this._behavioralAttached) return;
    this._behavioralAttached = true;

    /**
     * ───────────────────────────────────────────────────────────────────────
     * RAGE CLICK DETECTION: Sliding Window Algorithm
     * ───────────────────────────────────────────────────────────────────────
     * 
     * Business Context:
     *   Rapid clicks on the same element indicate user frustration (broken button,
     *   unresponsive UI, or confusing affordance).
     * 
     * Algorithm:
     *   - Maintains a per-element timestamp history in a Map
     *   - Filters clicks within 800ms window (psychometric research shows <1s = frustration)
     *   - Triggers 'rage_click' event when ≥3 clicks occur in this window
     *   - Resets history after detection to avoid duplicate events
     * 
     * Why 800ms?
     *   Studies show intentional double-clicks occur at 200-400ms intervals.
     *   Frustration manifests as 3+ clicks spaced 100-300ms apart (avg ~200ms).
     *   800ms window captures this pattern while excluding normal UX behaviors.
     */
    const clickHistory = new Map();
    const RAGE_CLICK_THRESHOLD = 3;
    const RAGE_CLICK_WINDOW_MS = 800;

    document.addEventListener(
      'click',
      (e) => {
        const target = e.target;
        const tagName = target.tagName?.toLowerCase();

        // NOISE FILTER: Ignore clicks on form inputs (tracked via field_change instead)
        if (tagName === 'input' || tagName === 'select' || tagName === 'textarea') {
          return;
        }

        const elementKey = this._getElementKey(target);
        const now = performance.now();

        if (!clickHistory.has(elementKey)) {
          clickHistory.set(elementKey, []);
        }
        const timestamps = clickHistory.get(elementKey);
        const recentClicks = timestamps.filter(t => now - t < RAGE_CLICK_WINDOW_MS);
        recentClicks.push(now);
        clickHistory.set(elementKey, recentClicks);

        if (recentClicks.length >= RAGE_CLICK_THRESHOLD) {
          this.emit('rage_click', {
            element: elementKey,
            clickCount: recentClicks.length,
            id: target.id || undefined,
            text: (target.textContent || '').trim().slice(0, 50),
          });
          clickHistory.set(elementKey, []);
        }

        // Dead click: emit after short delay if URL and scroll did not change (AI metric #2)
        const deadClickCheck = () => {
          const urlBefore = window.location.href;
          const scrollBefore = document.documentElement.scrollTop || document.body.scrollTop;
          setTimeout(() => {
            const urlAfter = window.location.href;
            const scrollAfter = document.documentElement.scrollTop || document.body.scrollTop;
            if (urlBefore === urlAfter && Math.abs(scrollBefore - scrollAfter) < 5) {
              this.emit('dead_click', {
                element: elementKey,
                id: target.id || undefined,
                text: (target.textContent || '').trim().slice(0, 50),
              });
            }
          }, 350);
        };
        deadClickCheck();
      },
      true
    );

    window.addEventListener('error', (event) => {
      this.emit('system_error', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        errorType: 'js_error',
      });
    });

    window.addEventListener('unhandledrejection', (event) => {
      this.emit('system_error', {
        message: event.reason?.message || String(event.reason),
        errorType: 'unhandled_promise_rejection',
      });
    });

    const SCROLL_MILESTONES = [0.25, 0.5, 0.75, 1];
    const reachedMilestones = new Set();
    const onScroll = () => {
      const doc = document.documentElement;
      const scrollTop = doc.scrollTop || document.body.scrollTop;
      const scrollHeight = doc.scrollHeight - doc.clientHeight;
      if (scrollHeight <= 0) return;
      const pct = Math.min(1, scrollTop / scrollHeight);
      for (const m of SCROLL_MILESTONES) {
        if (pct >= m && !reachedMilestones.has(m)) {
          reachedMilestones.add(m);
          this.emit('scroll_depth', { pct: m, scrollY: Math.round(scrollTop) });
        }
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    // Erratic scroll: direction flips in short window (AI metric #8)
    const scrollHistory = [];
    const ERRATIC_WINDOW_MS = 2000;
    const ERRATIC_MIN_FLIPS = 3;
    let lastErraticEmit = 0;
    const onScrollErratic = () => {
      const t = Date.now();
      const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
      scrollHistory.push({ t, scrollTop });
      while (scrollHistory.length > 0 && t - scrollHistory[0].t > ERRATIC_WINDOW_MS) {
        scrollHistory.shift();
      }
      if (scrollHistory.length < 4) return;
      let flips = 0;
      for (let i = 1; i < scrollHistory.length - 1; i++) {
        const prev = scrollHistory[i].scrollTop - scrollHistory[i - 1].scrollTop;
        const next = scrollHistory[i + 1].scrollTop - scrollHistory[i].scrollTop;
        if ((prev > 0 && next < 0) || (prev < 0 && next > 0)) flips++;
      }
      if (flips >= ERRATIC_MIN_FLIPS && t - lastErraticEmit > 3000) {
        lastErraticEmit = t;
        this.emit('scroll', { behavior: 'erratic', directionChanges: flips });
      }
    };
    window.addEventListener('scroll', onScrollErratic, { passive: true });

    const IDLE_THRESHOLD_MS = 30000;
    let idleTimer = null;
    let lastActivityTs = performance.now();

    const resetIdleTimer = () => {
      lastActivityTs = performance.now();
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        const idleMs = Math.round(performance.now() - lastActivityTs);
        this.emit('idle_time', { ms: idleMs });
      }, IDLE_THRESHOLD_MS);
    };

    ['click', 'keydown', 'mousemove'].forEach((ev) => {
      document.addEventListener(ev, resetIdleTimer, { passive: true });
    });
    window.addEventListener('scroll', resetIdleTimer, { passive: true });
    resetIdleTimer();

    // Mouse shake / cursor velocity (AI metric #3): rapid direction changes
    const mouseBuffer = [];
    const MOUSE_WINDOW_MS = 500;
    const MOUSE_THROTTLE_MS = 50;
    let lastMouseEmit = 0;
    let lastMouseTs = 0;
    document.addEventListener(
      'mousemove',
      (e) => {
        const now = Date.now();
        if (now - lastMouseTs < MOUSE_THROTTLE_MS) return;
        lastMouseTs = now;
        mouseBuffer.push({ t: now, x: e.clientX, y: e.clientY });
        while (mouseBuffer.length > 0 && now - mouseBuffer[0].t > MOUSE_WINDOW_MS) {
          mouseBuffer.shift();
        }
        if (mouseBuffer.length < 5) return;
        let flips = 0;
        for (let i = 2; i < mouseBuffer.length; i++) {
          const dx1 = mouseBuffer[i - 1].x - mouseBuffer[i - 2].x;
          const dx2 = mouseBuffer[i].x - mouseBuffer[i - 1].x;
          const dy1 = mouseBuffer[i - 1].y - mouseBuffer[i - 2].y;
          const dy2 = mouseBuffer[i].y - mouseBuffer[i - 1].y;
          if ((dx1 !== 0 && dx2 !== 0 && (dx1 > 0) !== (dx2 > 0)) || (dy1 !== 0 && dy2 !== 0 && (dy1 > 0) !== (dy2 > 0))) {
            flips++;
          }
        }
        if (flips >= 3 && now - lastMouseEmit > 2000) {
          lastMouseEmit = now;
          this.emit('mouse_move', { behavior: 'shake', iterations: flips });
        }
      },
      { passive: true }
    );

    let lastFocusedId = null;
    let lastBlurTs = 0;
    const REFOCUS_WINDOW_MS = 5000;

    document.addEventListener(
      'focusin',
      (e) => {
        const id = e.target.id || e.target.name || e.target.getAttribute?.('aria-label') || '';
        if (!id) return;
        const now = performance.now();
        if (lastFocusedId === id && now - lastBlurTs < REFOCUS_WINDOW_MS) {
          this.emit('refocus', { field: id, msSinceBlur: Math.round(now - lastBlurTs) });
        }
        lastFocusedId = id;
      },
      true
    );

    document.addEventListener(
      'focusout',
      (e) => {
        const id = e.target.id || e.target.name || e.target.getAttribute?.('aria-label') || '';
        if (id) {
          lastBlurTs = performance.now();
        }
      },
      true
    );

    window.addEventListener('popstate', () => {
      this.emit('nav_backtrack', { direction: 'back' });
    });

    /**
     * ───────────────────────────────────────────────────────────────────────
     * FORM ABANDONMENT DETECTION
     * ───────────────────────────────────────────────────────────────────────
     * 
     * Business Context:
     *   Users who start filling a form but leave without submitting represent
     *   high-value drop-off points in conversion funnels (login, trade, onboarding).
     * 
     * Detection Logic (Boolean State Machine):
     *   1. _formInteracted: Set to TRUE when user focuses any form field
     *   2. _formSubmitted: Set to TRUE when form submission occurs
     *   3. beforeunload: If (_formInteracted AND NOT _formSubmitted) → ABANDONED
     * 
     * Why use beforeunload?
     *   - Captures ALL exit methods (close tab, navigate away, back button)
     *   - Uses sendBeacon() to ensure event fires even during page termination
     *   - Cannot rely on click handlers alone (users may refresh, or browser crash)
     * 
     * Limitations:
     *   - Does not distinguish between accidental vs. intentional abandonment
     *   - Autofill/password managers may trigger false positives (mitigated by 
     *     requiring actual focus events, not just input changes)
     */
    document.addEventListener('focusin', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
        this._formInteracted = true;
      }
    }, true);

    document.addEventListener('submit', () => {
      this._formSubmitted = true;
    }, true);

    window.addEventListener('beforeunload', () => {
      const dwellMs = Math.round(performance.now() - this._pageStartTime);
      
      this.sendBeacon('page_view_end', { dwellMs });

      if (this._formInteracted && !this._formSubmitted) {
        this.sendBeacon('form_abandonment', {
          pageRoute: this.pageRoute,
          dwellMs,
        });
      }
    });
  },

  _getElementKey(element) {
    if (element.id) return `#${element.id}`;
    if (element.name) return `[name="${element.name}"]`;
    const tag = element.tagName?.toLowerCase() || 'unknown';
    const classList = Array.from(element.classList || []).slice(0, 2).join('.');
    return classList ? `${tag}.${classList}` : tag;
  },
};
