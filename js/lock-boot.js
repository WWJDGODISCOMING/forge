// Runs before anything is drawn (a plain script in <head>, not a module). In the iPhone app with the lock on it marks the page
// locked straight away, so css/lock.css can hide the app before the first paint. js/native/lock.js takes over from there.
(function () {
  try {
    var c = window.Capacitor;
    var native = !!c && (c.isNativePlatform ? c.isNativePlatform() : c.platform && c.platform !== 'web');
    var s = JSON.parse(localStorage.getItem('forge.lock') || 'null');
    if (native && s && s.enabled) document.documentElement.classList.add('app-locked');
  } catch (e) { /* no lock */ }
})();
