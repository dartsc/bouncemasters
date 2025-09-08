(function(){
  // Lightweight Google Sign-In (GIS) + user-scoped persistence namespace.
  var CLIENT_ID = window.GOOGLE_CLIENT_ID || '419241653418-f0l9gsgfp7njr33cji8hq3shkiblv7e5.apps.googleusercontent.com';
  var gsiLoaded = false;
  var token = null;
  var userProfile = null;
  var nsKey = '__user_ns__';

  // Basic cookie helpers (no Secure flag for local http dev; SameSite=Lax).
  function setCookie(name, value, days){
    try {
      var expires = '';
      if (typeof days === 'number') {
        var d = new Date(); d.setTime(d.getTime() + days*24*60*60*1000);
        expires = '; expires=' + d.toUTCString();
      }
      document.cookie = name + '=' + encodeURIComponent(String(value||'')) + expires + '; path=/; SameSite=Lax';
    } catch(_) {}
  }
  function getCookie(name){
    try {
      var m = document.cookie && document.cookie.match(new RegExp('(?:^|; )'+name.replace(/([.$?*|{}()\[\]\\/+^])/g,'\\$1')+'=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : '';
    } catch(_) { return ''; }
  }
  function clearCookie(name){ setCookie(name, '', -1); }

  function setNamespace(ns){
    // Persist the active namespace in our local storage so saves are per-user.
    try { if (window.__LOCAL_PROGRESS_STORAGE__ && window.__LOCAL_PROGRESS_STORAGE__.setItem) {
      window.__LOCAL_PROGRESS_STORAGE__.setItem(nsKey, ns || '');
    } } catch(_) {}
    window.__USER_PROGRESS_NAMESPACE__ = ns || '';
  }
  function getNamespace(){
    try { if (window.__LOCAL_PROGRESS_STORAGE__ && window.__LOCAL_PROGRESS_STORAGE__.getItem) {
      var n = window.__LOCAL_PROGRESS_STORAGE__.getItem(nsKey);
      if (typeof n === 'string') return n;
    } } catch(_) {}
    return window.__USER_PROGRESS_NAMESPACE__ || '';
  }

  // Expose helpers for the persistence shim
  window.__getActiveUserNamespace = getNamespace;
  window.__setActiveUserNamespace = setNamespace;

  function updateUI(){
    var info = document.getElementById('user_info');
    var btnC = document.getElementById('gsi_button');
    if (!info || !btnC) return;
    if (userProfile){
      info.style.display = 'inline-flex';
      btnC.style.display = 'none';
      var nameEl = document.getElementById('user_name');
      var picEl = document.getElementById('user_pic');
      if (nameEl) nameEl.textContent = userProfile.name || userProfile.email || 'Signed in';
      if (picEl && userProfile.picture) picEl.src = userProfile.picture;
    } else {
      info.style.display = 'none';
      btnC.style.display = '';
    }
  }

  function decodeJwt(jwt){
    try {
      var parts = jwt.split('.');
      var body = parts[1].replace(/-/g,'+').replace(/_/g,'/');
      var json = decodeURIComponent(atob(body).split('').map(function(c){
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      return JSON.parse(json);
    } catch(e){ return null; }
  }

  function onCredentialResponse(resp){
    token = resp && resp.credential || null;
    var claims = token ? decodeJwt(token) : null;
    // Namespace by Google sub (stable user id); fallback to email
    var ns = (claims && (claims.sub || claims.email)) ? String(claims.sub || claims.email) : '';
    setNamespace(ns);
    // Remember via cookies
    if (ns) setCookie('ytg_ns', ns, 365);
    userProfile = claims ? { email: claims.email, name: claims.name, picture: claims.picture } : null;
    if (userProfile){
      if (userProfile.name) setCookie('ytg_name', userProfile.name, 365);
      if (userProfile.picture) setCookie('ytg_pic', userProfile.picture, 365);
      setCookie('ytg_signed_in', '1', 365);
    }
    updateUI();
  }

  function signOut(){
    token = null; userProfile = null;
    setNamespace('');
  // Clear cookies
  clearCookie('ytg_signed_in');
  clearCookie('ytg_ns');
  clearCookie('ytg_name');
  clearCookie('ytg_pic');
    try { google && google.accounts && google.accounts.id && google.accounts.id.disableAutoSelect && google.accounts.id.disableAutoSelect(); } catch(_) {}
    updateUI();
  }

  function ensureGsi(){
    if (gsiLoaded || !CLIENT_ID) return;
    var s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.defer = true;
    s.onload = function(){
      gsiLoaded = true;
      try {
        var auto = getCookie('ytg_signed_in') === '1';
        google.accounts.id.initialize({ client_id: CLIENT_ID, callback: onCredentialResponse, auto_select: auto });
        var container = document.getElementById('gsi_button');
        if (container) {
          google.accounts.id.renderButton(container, { theme: 'outline', size: 'medium', type: 'standard', shape: 'pill' });
        }
        google.accounts.id.prompt();
      } catch(_) {}
    };
    document.head.appendChild(s);
  }

  document.addEventListener('DOMContentLoaded', function(){
    var outBtn = document.getElementById('signout_btn');
    if (outBtn) outBtn.addEventListener('click', signOut);
    // Restore from cookie first if present (then fallback to local storage)
    var cookieNs = getCookie('ytg_ns');
    if (cookieNs) {
      setNamespace(cookieNs);
      userProfile = {
        email: '',
        name: getCookie('ytg_name') || '',
        picture: getCookie('ytg_pic') || ''
      };
    } else {
      // Restore last namespace from local storage
      setNamespace(getNamespace());
    }
    ensureGsi();
    updateUI();
  });
})();
