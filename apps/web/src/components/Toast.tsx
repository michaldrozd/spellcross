import React, { useEffect, useState } from 'react';

export type ToastType = 'error' | 'warning' | 'info' | 'success';

interface ToastMessage {
  id: number;
  message: string;
  type: ToastType;
}

let toastId = 0;
let addToastFn: ((message: string, type?: ToastType) => void) | null = null;
let clearToastsFn: (() => void) | null = null;

export function showToast(message: string, type: ToastType = 'error') {
  if (addToastFn) {
    addToastFn(message, type);
  } else {
    console.warn('[Toast not ready]', message);
  }
}

export function clearToasts() {
  clearToastsFn?.();
}

const toastIcons: Record<ToastType, string> = {
  error: '!',
  warning: '!',
  info: 'i',
  success: '+',
};

export const ToastContainer: React.FC = () => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    addToastFn = (message: string, type: ToastType = 'error') => {
      const id = ++toastId;
      setToasts((prev) => [...prev, { id, message, type }]);

      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, type === 'success' ? 1500 : 2500);
    };
    clearToastsFn = () => setToasts([]);

    return () => {
      addToastFn = null;
      clearToastsFn = null;
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack">
      {toasts.map((toast) => {
        return (
          <div
            key={toast.id}
            className={`toast-message toast-${toast.type}`}
          >
            <span className="toast-icon">{toastIcons[toast.type]}</span>
            <span>{toast.message}</span>
          </div>
        );
      })}
    </div>
  );
};
