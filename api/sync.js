/* Syncs the app's shared teacher/student items with /api/sync (Neon). */
(function () {
  var API = '/api/sync';
  var COLS = ['posts', 'challenges', 'events', 'attSessions', 'submissions', 'postSubs', 'completions', 'registrations'];
  var FPKEY = 'kz.sync.fp';
  var origSet = Storage.prototype.setItem;
  var fp = {};
  try { fp = JSON.parse(localStorage.getItem(FPKEY) || '{}') || {}; } catch (e) {}
  var timer = null, pulled = false, lastTry = 0;

  function saveFp() { try { origSet.call(localStorage, FPKEY, JSON.stringify(fp)); } catch (e) {} }
  function parse(v) { try { return JSON.parse(v); } catch (e) { return null; } }
  function isDB(o) { return o && typeof o === 'object' && o.shared && typeof o.shared === 'object'; }
  function isBackup(k) { return /\.backup$/.test(k); }
  function key(c, id) { return c + '|' + id; }

  // Items that are new or changed since they were last synced.
  function scan(db) {
    var out = [];
    COLS.forEach(function (c) {
      var arr = db.shared[c];
      if (!Array.isArray(arr)) return;
      arr.forEach(function (it) {
        if (!it || typeof it !== 'object' || typeof it.id !== 'string' || it.demo) return;
        var s = JSON.stringify(it);
        if (fp[key(c, it.id)] !== s) out.push({ c: c, id: it.id, data: it, s: s });
      });
    });
    return out;
  }

  function upload(items) {
    if (!items.length) return;
    var batch = items.slice(0, 50);
    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: batch.map(function (i) { return { c: i.c, id: i.id, data: i.data }; }) })
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || !j.ok) return;
      batch.forEach(function (i) { fp[key(i.c, i.id)] = i.s; });
      saveFp();
      if (items.length > 50) upload(items.slice(50));
    }).catch(function () {});
  }

  function findDB() {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (isBackup(k) || k === FPKEY) continue;
      var db = parse(localStorage.getItem(k));
      if (isDB(db)) return { k: k, db: db };
    }
    return null;
  }

  function pull(attempt) {
    lastTry = Date.now();
    fetch(API, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !Array.isArray(j.items)) return;
        var f = findDB();
        if (!f) { if (attempt < 5) setTimeout(function () { pull(attempt + 1); }, 1500); return; }
        pulled = true;
        var db = f.db, changed = false;
        j.items.forEach(function (s) {
          if (COLS.indexOf(s.c) < 0) return;
          if (!Array.isArray(db.shared[s.c])) db.shared[s.c] = [];
          var arr = db.shared[s.c], str = JSON.stringify(s.data), k2 = key(s.c, s.id), idx = -1;
          for (var n = 0; n < arr.length; n++) { if (arr[n] && arr[n].id === s.id) { idx = n; break; } }
          if (idx < 0) { arr.push(s.data); fp[k2] = str; changed = true; return; }
          var local = JSON.stringify(arr[idx]);
          if (local === str) { fp[k2] = str; return; }
          // differs: take the server copy unless this device edited it since the last sync
          if (fp[k2] === undefined || fp[k2] === local) { arr[idx] = s.data; fp[k2] = str; changed = true; }
        });
        saveFp();
        if (changed) {
          origSet.call(localStorage, f.k, JSON.stringify(db));
          var last = +sessionStorage.getItem('kz.sync.rl') || 0;
          if (Date.now() - last > 15000) { sessionStorage.setItem('kz.sync.rl', String(Date.now())); location.reload(); return; }
        }
        upload(scan(db)); // send anything this device has that the server doesn't
      })
      .catch(function () {});
  }

  // Whenever the app saves its data, upload new or changed items.
  Storage.prototype.setItem = function (k, v) {
    origSet.apply(this, arguments);
    if (this !== window.localStorage || isBackup(k) || k === FPKEY) return;
    var db = parse(v);
    if (!isDB(db)) return;
    clearTimeout(timer);
    timer = setTimeout(function () { upload(scan(db)); }, 700);
    if (!pulled && Date.now() - lastTry > 5000) pull(5); // e.g. just signed in without a reload
  };

  window.addEventListener('load', function () { setTimeout(function () { pull(0); }, 900); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && Date.now() - lastTry > 5000) pull(5);
  });
})();
