(function(){
  // Simple key-value storage shim that writes/reads to localStorage with a prefix
  // and exposes a minimal API compatible with the game's platformApi.storage usage.
  var PREFIX = 'ytgame:'; // keep distinct from other storage
  function k(key){
    try {
      var ns = (typeof window.__getActiveUserNamespace === 'function') ? (window.__getActiveUserNamespace() || '') : (window.__USER_PROGRESS_NAMESPACE__ || '');
      if (ns) return PREFIX + ns + ':' + key;
    } catch(_) {}
    return PREFIX + key;
  }

  // YouTube Playables nulls window.localStorage in embeds. Fall back to a same-origin
  // hidden iframe's localStorage when needed.
  var storageHost = null; // window or iframe.contentWindow providing a working localStorage
  function ensureStorageHost() {
    if (storageHost && storageHost.localStorage) return storageHost;
    try {
      if (typeof window.localStorage === 'object' && window.localStorage) {
        // Probe
        var t = PREFIX + '__probe__';
        window.localStorage.setItem(t, '1');
        window.localStorage.removeItem(t);
        storageHost = window;
        return storageHost;
      }
    } catch (_) {}
    // Create a same-origin sandboxed iframe to access its storage
    try {
      var iframe = document.getElementById('__ls_iframe__');
      if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = '__ls_iframe__';
        iframe.style.display = 'none';
        iframe.src = 'about:blank';
        document.documentElement.appendChild(iframe);
      }
      var cw = iframe.contentWindow;
      if (cw && cw.localStorage) {
        // Probe
        var t2 = PREFIX + '__probe__';
        cw.localStorage.setItem(t2, '1');
        cw.localStorage.removeItem(t2);
        storageHost = cw;
        return storageHost;
      }
    } catch (_) {}
    return null;
  }

  function lsGet(key) {
    var host = ensureStorageHost();
    if (!host) return null;
    try {
  var raw = host.localStorage.getItem(k(key));
      return raw == null ? null : JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function lsSet(key, value) {
    var host = ensureStorageHost();
    if (!host) return;
    try {
  var raw = JSON.stringify(value);
  host.localStorage.setItem(k(key), raw);
    } catch (e) {
      // ignore quota or serialization errors
    }
  }

  function lsGetItems(prefix) {
    var host = ensureStorageHost();
    if (!host) return {};
    var out = {};
    try {
      for (var i = 0; i < host.localStorage.length; i++) {
        var fullKey = host.localStorage.key(i);
        if (!fullKey || fullKey.indexOf(PREFIX) !== 0) continue;
        var subKey = fullKey.slice(PREFIX.length);
        // If a namespace is active, trim it from listing to expose logical keys
        try {
          var ns = (typeof window.__getActiveUserNamespace === 'function') ? (window.__getActiveUserNamespace() || '') : (window.__USER_PROGRESS_NAMESPACE__ || '');
          if (ns && subKey.indexOf(ns + ':') === 0) subKey = subKey.slice((ns + ':').length);
          else if (ns) { continue; }
        } catch(_) {}
        if (prefix && subKey.indexOf(prefix) !== 0) continue;
        try {
          out[subKey] = JSON.parse(host.localStorage.getItem(fullKey));
        } catch (e) {}
      }
    } catch (e) {}
    return out;
  }

  // If the game exposes iw.platformApi later, we cannot replace it easily.
  // But Og defaults to iw.platformApi.storage for reads/writes. To ensure it works
  // locally even before the platform initializes, we attach a global fallback
  // storage that the platform can adopt or the Og can reference explicitly.
  window.__LOCAL_PROGRESS_STORAGE__ = {
    init: function(){ /* no-op for localStorage */ },
    getItem: lsGet,
    setItem: lsSet,
    getItems: lsGetItems
  };

  // Patch iw.platformApi.storage after platform init, if possible.
  // We hook early and monitor for platformApi assignment.
  // If iw or iw.platformApi is missing entirely (local dev), create a minimal shell.
  if (!window.iw) window.iw = {};
  if (!window.iw.platformApi) {
    window.iw.platformApi = {
      storage: window.__LOCAL_PROGRESS_STORAGE__,
      init: function(){},
      setLoadingProgress: function(){},
      loadingComplete: function(){},
      gameReady: function(){},
      getLanguage: function(){ return Promise.resolve('en'); }
    };
  }
  function tryAttachToPlatform(){
    try {
      if (window.iw && window.iw.platformApi && window.iw.platformApi.storage) {
        // Wrap existing storage to mirror into localStorage too
        var base = window.iw.platformApi.storage;
        var wrapped = {
          init: function(){ if (base.init) return base.init(); },
          getItem: function(key){
            var v = null;
            try { v = base.getItem(key); } catch(e) {}
            if (v == null) v = lsGet(key);
            return v;
          },
          setItem: function(key, value){
            try { base.setItem(key, value); } catch(e) {}
            lsSet(key, value);
          },
          getItems: function(prefix){
            var fromBase = {};
            try { fromBase = base.getItems ? base.getItems(prefix) : {}; } catch(e) {}
            var fromLs = lsGetItems(prefix);
            // Merge; base wins on conflicts
            var out = Object.assign({}, fromLs, fromBase);
            return out;
          }
        };
        window.iw.platformApi.storage = wrapped;
        return true;
      }
    } catch (e) {}
    return false;
  }

  // If platform not ready yet, attempt a few times. Also expose a manual hook.
  if (!tryAttachToPlatform()) {
    var attempts = 0;
    var timer = setInterval(function(){
      attempts++;
      if (tryAttachToPlatform() || attempts > 40) {
        clearInterval(timer);
      }
    }, 100);
  }

  // If the YouTube SDK is present, mirror its save/load to our local fallback as well.
  // This helps when running embedded where window.localStorage is disabled.
  function tryAttachToYtGame() {
    try {
      var game = window.ytgame && window.ytgame.game;
      if (!game) return false;
      // Wrap saveData
      if (!game.__wrappedForLocalPersist) {
        var origSave = game.saveData && game.saveData.bind(game);
        var origLoad = game.loadData && game.loadData.bind(game);
        if (origSave) {
          game.saveData = function(data) {
            // Mirror to local fallback
            lsSet('__yt_blob__', String(data || ''));
            return origSave(data);
          };
        }
        if (origLoad) {
          game.loadData = function() {
            return Promise.resolve(origLoad()).then(function(remote){
              if (remote && typeof remote === 'string' && remote.length > 0) return remote;
              var local = lsGet('__yt_blob__');
              return typeof local === 'string' ? local : (local != null ? JSON.stringify(local) : '');
            }).catch(function(){
              var local = lsGet('__yt_blob__');
              return typeof local === 'string' ? local : (local != null ? JSON.stringify(local) : '');
            });
          };
        }
        game.__wrappedForLocalPersist = true;
      }
      return true;
    } catch (_) {}
    return false;
  }

  if (!tryAttachToYtGame()) {
    var ytTries = 0;
    var ytTimer = setInterval(function(){
      ytTries++;
      if (tryAttachToYtGame() || ytTries > 40) clearInterval(ytTimer);
    }, 100);
  }

  // Expose a basic import/export utility for manual backups (optional use)
  window.exportProgressToClipboard = function(){
    try {
      var data = lsGetItems(null);
      var json = JSON.stringify(data);
      navigator.clipboard && navigator.clipboard.writeText(json);
      return json;
    } catch (e) { return null; }
  };
  window.importProgressFromJSON = function(json){
    try {
      var data = JSON.parse(json);
      Object.keys(data || {}).forEach(function(k){ lsSet(k, data[k]); });
      return true;
    } catch (e) { return false; }
  };
})();
