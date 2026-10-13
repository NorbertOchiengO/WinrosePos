import { useEffect } from 'react';

const CONTROLS = 'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), select, textarea';
let counter = 0;

// TRANSITIONAL helper. Roughly 90 forms across the app use `<div class="field"><label>Text</label>
// <input/></div>` where the label is not tied to its control, so screen readers announce unnamed
// fields (an automated WCAG scan flagged 48 such controls, all "critical"). Rewriting every page
// to <FormField> is the right long-term fix; until each page is migrated this links an orphan
// label to the control that follows it. It never touches a label that already has `for`, or a
// control that already has an accessible name, so migrated <FormField>s are unaffected.
function associateLabels(root: ParentNode) {
  root.querySelectorAll<HTMLLabelElement>('label:not([for])').forEach((label) => {
    if (label.querySelector(CONTROLS)) return; // wrapping label — already associated
    // Only the element immediately after the label belongs to it (or a control nested inside it).
    const next = label.nextElementSibling as HTMLElement | null;
    let control: HTMLElement | null = next ? (next.matches(CONTROLS) ? next : next.querySelector<HTMLElement>(CONTROLS)) : null;
    if (!control) {
      const parent = label.parentElement;
      const inParent = parent?.querySelectorAll<HTMLElement>(CONTROLS);
      if (inParent && inParent.length === 1) control = inParent[0];
    }
    if (!control || control.getAttribute('aria-label') || control.getAttribute('aria-labelledby')) return;
    if (!control.id) control.id = `auto-field-${++counter}`;
    label.htmlFor = control.id;
  });
}

export function useAutoLabelAssociation() {
  useEffect(() => {
    let frame = 0;
    const run = () => {
      frame = 0;
      associateLabels(document);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(run);
    };
    run();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);
}
