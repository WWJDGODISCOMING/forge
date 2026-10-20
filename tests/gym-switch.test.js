import { test, eq } from './harness.js';
import { gymChoices, switchAction } from '../js/workouts/gym-switch-core.js';
import { protectPillsHtml, protectedJoints } from '../js/ui/protect-view.js';
import { readFileSync } from 'node:fs';

const locs = [{ id: 'a', name: 'Home gym' }, { id: 'b', name: 'YMCA' }];

test('gym picker lists saved gyms and flags the current one', () => {
  const c = gymChoices(locs, 'b');
  eq(c.map((x) => x.name).join(), 'Home gym,YMCA');
  eq(c.filter((x) => x.current).map((x) => x.id).join(), 'b');
});

test('switching gyms: same gym is a no-op, in-progress asks first', () => {
  eq(switchAction('a', 'a', false), 'none');
  eq(switchAction('a', 'b', false), 'switch');
  eq(switchAction('a', 'b', true), 'confirm');
});

test('switching gyms keeps the joint settings (they live on the profile, not the location)', () => {
  const profile = { protectJoints: ['knee', 'lower_back'] };
  eq(protectedJoints(profile).join(), 'knee,lower_back');
  eq(protectPillsHtml(profile).includes('aria-checked="true"'), true);
});

test('Resume card shows the Knees / Lower back toggles mid-workout, outside the link', () => {
  const src = readFileSync(new URL('../js/screens/train.js', import.meta.url), 'utf8');
  const i = src.indexOf('<div class="card resume">');
  eq(i > 0, true);
  const card = src.slice(i, src.indexOf('</div>`', i));
  eq(card.includes('protectRowHtml()'), true);
  eq(card.includes('RESUME_JOINT_NOTE'), true);
  eq(src.includes('<a class="card resume"'), false, 'buttons must not sit inside the link');
});
