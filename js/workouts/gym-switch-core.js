// Gym chip on Train (v0.16.43), the pure half: what the picker lists and when switching needs a question first.

/** Picker rows: every saved gym, the current one flagged. */
export function gymChoices(locations = [], activeId = null) {
  return locations.map((l) => ({ id: l.id, name: l.name, current: l.id === activeId }));
}

/** Picking the current gym does nothing; picking another while a workout is in progress asks first. */
export function switchAction(activeId, pickedId, inProgress) {
  if (pickedId === activeId) return 'none';
  return inProgress ? 'confirm' : 'switch';
}

export const SWITCH_CONFIRM = {
  title: 'Switch gym?',
  message: 'Your workout in progress keeps its exercises. Forge will plan your next workout for the new gym.',
  confirmLabel: 'Switch gym',
};

export const RESUME_JOINT_NOTE = 'Changes apply to your next plan. To change an exercise now, use Swap in the workout.';
