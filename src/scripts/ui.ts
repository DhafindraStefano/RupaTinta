// Site dialogs: open/close with the shared fade, Esc and backdrop clicks close, and an in-page confirm() replacement.

const timers = new WeakMap<HTMLDialogElement, ReturnType<typeof setTimeout>>();
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function openDialog(d: HTMLDialogElement) {
  clearTimeout(timers.get(d)); timers.delete(d); // reopened mid-fade: keep it open
  d.classList.remove('closing');
  if (!d.open) d.showModal();
}

export function closeDialog(d: HTMLDialogElement) {
  if (!d.open || timers.has(d)) return;
  if (reducedMotion()) return d.close();
  d.classList.add('closing');
  timers.set(d, setTimeout(() => { timers.delete(d); d.classList.remove('closing'); d.close(); }, 160));
}

/** Esc, a click on the backdrop, or any `[data-close]` inside closes the dialog with the fade. */
export function wireDialog(d: HTMLDialogElement) {
  d.addEventListener('cancel', (e) => { e.preventDefault(); closeDialog(d); });
  d.addEventListener('click', (e) => {
    if (e.target === d || (e.target as Element).closest('[data-close]')) closeDialog(d);
  });
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Resolves true when the visitor presses the confirm button; anything else (cancel, Esc, backdrop) is false. */
export function confirmDialog({ title, text, confirm, cancel = 'Batal' }: { title: string; text: string; confirm: string; cancel?: string }) {
  const d = document.createElement('dialog');
  d.className = 'dlg';
  d.setAttribute('aria-labelledby', 'confirm-h');
  d.innerHTML = `<div class="dlg-body">
    <h3 id="confirm-h">${esc(title)}</h3><p class="hint">${esc(text)}</p>
    <div class="dlg-actions"><button type="button" class="btn btn-quiet" data-close>${esc(cancel)}</button><button type="button" class="btn btn-pri" data-yes>${esc(confirm)}</button></div>
  </div>`;
  document.body.append(d);
  wireDialog(d);
  return new Promise<boolean>((resolve) => {
    let yes = false;
    d.querySelector('[data-yes]')!.addEventListener('click', () => { yes = true; closeDialog(d); });
    d.addEventListener('close', () => { d.remove(); resolve(yes); }, { once: true });
    openDialog(d);
    d.querySelector<HTMLElement>('[data-close]')!.focus(); // destructive actions: the safe choice has focus
  });
}
