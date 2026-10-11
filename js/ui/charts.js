// Charts are drawn in a fixed viewBox and scale with their card. On a wide canvas that would blow the axis text up,
// so each chart reports --ck = viewBox width / rendered width (never above 1) and the CSS multiplies the text and
// line size by it, which keeps them at phone size while the plot grows.
let ro = null;

/** The factor that undoes the growth: 1 when the chart is at or below its drawn width (phones already match), vb/rendered when it is wider. */
export function scaleFor(viewBoxWidth, renderedWidth) {
  if (!(renderedWidth > 0) || !(viewBoxWidth > 0)) return 1;
  return Math.min(1, Math.round((viewBoxWidth / renderedWidth) * 1000) / 1000);
}

function setScale(svg, w) {
  const vb = svg.viewBox && svg.viewBox.baseVal;
  if (!vb || !vb.width) return;
  const k = scaleFor(vb.width, w);
  if (k === 1) svg.style.removeProperty('--ck');
  else svg.style.setProperty('--ck', String(k));
}

/** Viewbox width for a chart: the phone's width, or a wider one on a wide canvas so the plot grows sideways instead of taller. */
export function chartWidth(base = 340, wide = 760) {
  return typeof matchMedia === 'function' && matchMedia('(min-width: 840px)').matches ? wide : base;
}

function scan(root) {
  ro.disconnect(); // charts from a previous draw are gone
  root.querySelectorAll('svg.chart').forEach((svg) => { setScale(svg, svg.getBoundingClientRect().width); ro.observe(svg); });
}

let mo = null;
let moRoot = null;

/** Keep axis text and the trend line at phone size on every chart inside `root`, including ones a screen redraws itself (range pickers, "Show all"). */
export function fitCharts(root) {
  if (typeof ResizeObserver !== 'function') return;
  if (!ro) ro = new ResizeObserver((entries) => { for (const e of entries) setScale(e.target, e.contentRect.width); });
  scan(root);
  if (typeof MutationObserver === 'function' && moRoot !== root) {
    if (mo) mo.disconnect();
    moRoot = root;
    mo = new MutationObserver((muts) => { if (muts.some((m) => [...m.addedNodes].some((n) => n.nodeType === 1))) scan(root); });
    mo.observe(root, { childList: true, subtree: true });
  }
}
