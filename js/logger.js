/**
 * In-page log window.
 *
 * Loaded before A-Frame/MindAR so it can capture their console output and any
 * error they throw. Entries are buffered until app.js binds the DOM, so nothing
 * that happens during startup is lost.
 *
 * Public API:  ARLog.info/warn/error/debug(...)  ARLog.bind(dom)  ARLog.text()
 */
(function () {
  'use strict';

  var MAX = 600;                 // raised from AR_CONFIG once it is available
  var entries = [];
  var errorCount = 0;
  var dom = null;                // { list, count, badge, panel, toggle }
  var pendingRender = [];
  var t0 = Date.now();

  // ---------- formatting ----------

  function stringify(value, depth) {
    depth = depth || 0;
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';

    var type = typeof value;
    if (type === 'string') return value;
    if (type === 'number' || type === 'boolean') return String(value);
    if (type === 'function') return '[function ' + (value.name || 'anonymous') + ']';

    if (value instanceof Error) {
      return (value.name || 'Error') + ': ' + value.message +
             (value.stack ? '\n' + trimStack(value.stack) : '');
    }
    if (typeof Element !== 'undefined' && value instanceof Element) {
      return '<' + value.tagName.toLowerCase() + (value.id ? '#' + value.id : '') + '>';
    }
    if (typeof Event !== 'undefined' && value instanceof Event) {
      return '[event ' + value.type + ']';
    }
    if (depth > 2) return '[…]';

    if (Array.isArray(value)) {
      return '[' + value.slice(0, 20).map(function (v) { return stringify(v, depth + 1); }).join(', ') +
             (value.length > 20 ? ', …+' + (value.length - 20) : '') + ']';
    }
    try {
      var seen = [];
      return JSON.stringify(value, function (k, v) {
        if (typeof v === 'object' && v !== null) {
          if (seen.indexOf(v) !== -1) return '[circular]';
          seen.push(v);
        }
        if (v instanceof Error) return v.message;
        return v;
      });
    } catch (e) {
      return String(value);
    }
  }

  function trimStack(stack) {
    return String(stack).split('\n').slice(0, 6).map(function (l) {
      return '    ' + l.trim();
    }).join('\n');
  }

  function stamp() {
    var ms = Date.now() - t0;
    var s = Math.floor(ms / 1000);
    return (s < 10 ? '  ' : s < 100 ? ' ' : '') + s + '.' +
           String(Math.floor(ms % 1000)).padStart(3, '0') + 's';
  }

  // ---------- core ----------

  function push(level, args) {
    var text = Array.prototype.map.call(args, function (a) { return stringify(a); }).join(' ');
    var entry = { t: stamp(), level: level, text: text };

    entries.push(entry);
    if (entries.length > MAX) entries.splice(0, entries.length - MAX);
    if (level === 'error') errorCount++;

    if (dom) render(entry);
    else pendingRender.push(entry);

    return entry;
  }

  function render(entry) {
    var li = document.createElement('li');
    li.className = 'log-entry log-' + entry.level;
    var t = document.createElement('span');
    t.className = 'log-t';
    t.textContent = entry.t;
    var m = document.createElement('span');
    m.className = 'log-m';
    m.textContent = entry.text;
    li.appendChild(t);
    li.appendChild(m);

    var atBottom = dom.list.scrollHeight - dom.list.scrollTop - dom.list.clientHeight < 60;
    dom.list.appendChild(li);
    while (dom.list.children.length > MAX) dom.list.removeChild(dom.list.firstChild);
    if (atBottom) dom.list.scrollTop = dom.list.scrollHeight;

    dom.count.textContent = entries.length;
    if (errorCount > 0) {
      dom.badge.textContent = errorCount;
      dom.badge.classList.remove('hidden');
      dom.toggle.classList.add('has-error');
    }
  }

  // ---------- environment header ----------

  function envLines() {
    var n = navigator;
    var lines = [
      'Web AR Museum Guide — debug log',
      'when      : ' + new Date().toISOString(),
      'url       : ' + location.href,
      'secure ctx: ' + window.isSecureContext + '  (camera needs https or localhost)',
      'userAgent : ' + n.userAgent,
      'platform  : ' + (n.platform || '?') + '  cores:' + (n.hardwareConcurrency || '?') +
                  '  mem:' + (n.deviceMemory || '?') + 'GB',
      'screen    : ' + screen.width + 'x' + screen.height + ' @' + (window.devicePixelRatio || 1) + 'x' +
                  '  window:' + window.innerWidth + 'x' + window.innerHeight,
      'touch     : ' + (('ontouchstart' in window) || n.maxTouchPoints > 0) +
                  '  maxTouchPoints:' + (n.maxTouchPoints || 0),
      'mediaDev  : ' + !!(n.mediaDevices && n.mediaDevices.getUserMedia),
      'lang/tz   : ' + n.language + ' / ' + (Intl.DateTimeFormat().resolvedOptions().timeZone || '?'),
    ];

    try {
      var c = document.createElement('canvas');
      var gl = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl');
      if (gl) {
        var dbg = gl.getExtension('WEBGL_debug_renderer_info');
        lines.push('webgl     : ' + (c.getContext('webgl2') ? 'webgl2' : 'webgl1') +
                   '  ' + (dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)));
        lines.push('maxTexture: ' + gl.getParameter(gl.MAX_TEXTURE_SIZE));
      } else {
        lines.push('webgl     : NOT AVAILABLE  <-- AR cannot run');
      }
    } catch (e) {
      lines.push('webgl     : probe failed — ' + e.message);
    }

    var v = document.createElement('video');
    lines.push('video mp4 : ' + (v.canPlayType('video/mp4; codecs="avc1.42E01E"') || 'no'));
    return lines;
  }

  // ---------- clipboard ----------

  function copyText(text) {
    return new Promise(function (resolve) {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(
          function () { resolve(true); },
          function () { resolve(legacyCopy(text)); }
        );
      } else {
        resolve(legacyCopy(text));
      }
    });
  }

  // execCommand path — still the only thing that works in some iOS WebViews.
  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
    document.body.appendChild(ta);

    var ok = false;
    try {
      ta.contentEditable = 'true';
      ta.readOnly = false;
      var range = document.createRange();
      range.selectNodeContents(ta);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      ta.setSelectionRange(0, text.length);
      ok = document.execCommand('copy');
    } catch (e) { /* reported by the caller's toast */ }
    document.body.removeChild(ta);
    return ok;
  }

  // ---------- public ----------

  var ARLog = {
    log:   function () { push('info', arguments); },
    info:  function () { push('info', arguments); },
    warn:  function () { push('warn', arguments); },
    error: function () { push('error', arguments); },
    debug: function () { push('debug', arguments); },
    ok:    function () { push('ok', arguments); },
    event: function () { push('event', arguments); },

    setMax: function (n) { MAX = n || MAX; },

    bind: function (nodes) {
      dom = nodes;
      pendingRender.forEach(render);
      pendingRender = [];
      dom.list.scrollTop = dom.list.scrollHeight;
    },

    clear: function () {
      entries = [];
      errorCount = 0;
      if (dom) {
        dom.list.innerHTML = '';
        dom.count.textContent = '0';
        dom.badge.classList.add('hidden');
        dom.toggle.classList.remove('has-error');
      }
      push('info', ['log cleared']);
    },

    errorCount: function () { return errorCount; },

    /** The full report, ready to paste. */
    text: function () {
      var head = envLines().join('\n');
      var body = entries.map(function (e) {
        return e.t + ' [' + e.level.toUpperCase() + '] ' + e.text;
      }).join('\n');
      return head + '\n' + '-'.repeat(60) + '\n' + body + '\n';
    },

    copy: function () { return copyText(ARLog.text()); },

    download: function () {
      var blob = new Blob([ARLog.text()], { type: 'text/plain' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'web-ar-log-' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    },

    envLines: envLines,
  };

  window.ARLog = ARLog;

  // ---------- capture everything ----------

  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (name) {
    var original = console[name] ? console[name].bind(console) : function () {};
    console[name] = function () {
      original.apply(null, arguments);
      // A-Frame's banner and MindAR's stats spam would drown the useful lines.
      var first = arguments[0];
      if (typeof first === 'string' && /^%c|^THREE\.WebGLRenderer|A-Frame Version/.test(first)) return;
      push(name === 'log' ? 'info' : name, arguments);
    };
  });

  window.addEventListener('error', function (e) {
    // Resource errors (a missing .mind, a video that will not decode) have no message.
    if (e.target && e.target !== window && e.target.src !== undefined) {
      push('error', ['failed to load resource: <' + e.target.tagName.toLowerCase() + '> ' +
                     (e.target.currentSrc || e.target.src || '(empty src)')]);
      return;
    }
    push('error', ['uncaught: ' + e.message + '  @ ' +
                   (e.filename || '?').split('/').pop() + ':' + e.lineno + ':' + e.colno]);
    if (e.error && e.error.stack) push('error', [trimStack(e.error.stack)]);
  }, true);

  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    push('error', ['unhandled promise rejection: ' + stringify(r)]);
  });

  push('info', ['logger ready']);
})();
