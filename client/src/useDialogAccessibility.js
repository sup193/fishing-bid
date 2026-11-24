import { useLayoutEffect, useRef } from 'react';

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

function focusableElements(dialog) {
  return [...dialog.querySelectorAll(focusableSelector)]
    .filter(element => element.getAttribute('aria-hidden') !== 'true' && element.getClientRects().length > 0);
}

function focusInitialElement(dialog) {
  const target = dialog.querySelector('[data-dialog-autofocus]') || focusableElements(dialog)[0] || dialog;
  target.focus();
}

export default function useDialogAccessibility({ open, dialogRef, onClose, focusKey }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    if (!open || !dialogRef.current) return undefined;
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const elements = focusableElements(dialog);
      if (!elements.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];
      const focusIsInside = dialog.contains(document.activeElement);
      if (event.shiftKey && (!focusIsInside || document.activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!focusIsInside || document.activeElement === last)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    focusInitialElement(dialog);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [dialogRef, open]);

  useLayoutEffect(() => {
    if (!open || !dialogRef.current) return undefined;
    focusInitialElement(dialogRef.current);
    return undefined;
  }, [dialogRef, focusKey, open]);
}
