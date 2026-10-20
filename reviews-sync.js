/* Syncs shared.reviews between this browser's saved app data and /api/reviews */
(function () {
  var API = '/api/reviews';
  var known = {};
  var origSet = Storage.prototype.setItem;

  function parse(v) { try { return JSON.parse(v); } catch (e) { return null; } }
  function isDB(o) { return o && typeof o === 'object' && o.shared && Array.isArray(o.shared.reviews); }
  function isBackup(k) { return /\.backup$/.test(k); }

  function send(r) {
    if (!r || !r.id || r.demo) return;
    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(r),
      keepalive: true
    }).catch(function () {});
  }

  // 1) Whenever the app saves its data, upload any new reviews.
  Storage.prototype.setItem = function (k, v) {
    origSet.apply(this, arguments);
    if (this !== window.localStorage || isBackup(k)) return;
    var db = parse(v);
    if (!isDB(db)) return;
    db.shared.reviews.forEach(function (r) {
      if (r && r.id && !known[r.id]) { known[r.id] = 1; send(r); }
    });
  };

  // 2) On page load, download reviews from the server and merge them in.
  function pull(attempt) {
    fetch(API, { cache: 'no-store' })
      .then(function (res) { return res.json(); })
      .then(function (list) {
        if (!Array.isArray(list)) return;
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (isBackup(k)) continue;
          var db = parse(localStorage.getItem(k));
          if (!isDB(db)) continue;

          var have = {};
          db.shared.reviews.forEach(function (r) { have[r.id] = 1; });
          var added = false;
          list.forEach(function (r) {
            known[r.id] = 1;
            if (!have[r.id]) { db.shared.reviews.push(r); added = true; }
          });
          // upload local reviews the server doesn't have yet
          db.shared.reviews.forEach(function (r) {
            if (r && r.id && !known[r.id]) { known[r.id] = 1; send(r); }
          });
          if (added) {
            origSet.call(localStorage, k, JSON.stringify(db));
            location.reload();
          }
          return;
        }
        if (attempt < 5) setTimeout(function () { pull(attempt + 1); }, 1500);
      })
      .catch(function () {});
  }

  window.addEventListener('load', function () { setTimeout(function () { pull(0); }, 800); });
})();
