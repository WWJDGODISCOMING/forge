// Charts are drawn in a fixed viewBox and scale with their card. On a wide canvas that would blow the axis text up,
// so each chart reports how much it is scaled (--ck = viewBox width / rendered width) and the CSS multiplies the
// text and line size by it, which keeps them at phone size while the plot grows.
let ro = null;

/** The factor that undoes the scaling; 1 when the chart is at or below its drawn width (phones already match). */
export function scaleFor(viewBoxWidth, renderedWidth) {
  if (!(renderedWidth > 0) || !(viewBoxWidth > 0)) return 1;
  return Math.max(1, Math.round((viewBoxWidth / renderedWidth) * 100) / 100);
}

function setScale(svg, w) {
  const vb = svg.viewBox && svg.viewBox.baseVal;
  if (!vb || !vb.width) return;
  const k = scaleFor(vb.width, w);
  if (k === 1) svg.style.removeProperty('--ck');
  else svg.style.setProperty('--ck', String(k));
}

/** Keep axis text and the trend line at phone size on every chart inside `root`. Call after a screen draws. */
export function fitCharts(root) {
  if (typeof ResizeObserver !== 'function') return;
  if (!ro) ro = new ResizeObserver((entries) => { for (const e of entries) setScale(e.target, e.contentRect.width); });
  ro.disconnect(); // the previous screen's charts are gone
  root.querySelectorAll('svg.chart').forEach((svg) => { setScale(svg, svg.getBoundingClientRect().width); ro.observe(svg); });
}
