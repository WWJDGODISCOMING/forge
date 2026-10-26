// Progress tab: Score | Week | Trends. The weight chart and weigh-ins moved to Body (v0.15.21). Awards, History, the
// Doctor summary and Ask Coach are rows under each part (progressRowsHtml). Each part keeps its own route so links still work.
import { icon } from '../ui/icons.js';

let last = 'score';

const TABS = [['score', 'Score'], ['weekly', 'Week'], ['trends', 'Trends']];

export function progressTabs(active) {
  last = active;
  return `
    <div class="seg progress-seg" role="tablist" aria-label="Progress">
      ${TABS.map(([k, l]) => `<a role="tab" href="#/${k}" class="${active === k ? 'on' : ''}" aria-selected="${active === k}">${l}</a>`).join('')}
    </div>`;
}

const row = (href, ic, title, sub) => `<a class="g-row" href="${href}"><span class="g-ic">${icon(ic)}</span><span class="g-text"><span>${title}</span><small>${sub}</small></span><span class="chev">${icon('chev')}</span></a>`;
/** Entry rows shown at the bottom of every Progress part: awards, history, doctor summary, Ask Coach. */
export const progressRowsHtml = () => `<div class="group" data-progress-rows>
      ${row('#/recaps', 'calendar', 'Weekly recaps', 'Your past weeks')}
      ${row('#/awards', 'trophy', 'Awards', 'Badges and missions')}
      ${row('#/history', 'list', 'History &amp; PRs', 'Workouts and cardio')}
      ${row('#/report', 'heart', 'Doctor summary', 'Share with your doctor')}
      ${row('#/coach', 'help', 'Ask Coach', 'From your own data')}
    </div>`;

export const lastProgressRoute = () => last;
