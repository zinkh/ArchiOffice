import type { KeyboardEvent } from 'react';

/** One keyboard contract for primary and secondary horizontal tab lists. */
export function navigateTabList(
  event: KeyboardEvent<HTMLElement>, ids: readonly string[], activeId: string,
  onChange: (id: string) => void,
) {
  const index = ids.indexOf(activeId);
  if (index < 0 || !ids.length || event.altKey || event.ctrlKey || event.metaKey) return;
  let next: number;
  switch (event.key) {
    case 'ArrowRight': next = (index + 1) % ids.length; break;
    case 'ArrowLeft': next = (index - 1 + ids.length) % ids.length; break;
    case 'Home': next = 0; break;
    case 'End': next = ids.length - 1; break;
    default: return;
  }
  event.preventDefault();
  onChange(ids[next]);
  event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
}
