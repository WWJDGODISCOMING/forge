// Runs before first paint, right after the static cold-start skeleton in index.html: if the route in the URL goes wide
// (two-column or full-width), the skeleton claims that width now, so <main> never jumps from the 560px column to 1000px
// when the real screen draws. Keep WIDE equal to WIDE in js/ui/skeleton.js (a test checks they match).
(function () {
  var WIDE = ['today', 'train', 'body', 'trends', 'weekly', 'score', 'play', 'settings', 'food'];
  var route = (location.hash.replace(/^#\/?/, '').split('?')[0] || 'today').split('/')[0];
  var s = document.querySelector('#main > .skel-screen');
  if (!s || WIDE.indexOf(route) < 0) return;
  s.classList.add('skel-wide');
  if (route === 'play') s.setAttribute('data-play', '');
})();
