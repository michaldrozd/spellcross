import React, { useEffect, useState } from 'react';

export type ToastType = 'error' | 'warning' | 'info' | 'success';

interface ToastMessage {
  id: number;
  message: string;
  type: ToastType;
}

let toastId = 0;
let addToastFn: ((message: string, type?: ToastType) => void) | null = null;

// Global function to show toast from anywhere
export function showToast(message: string, type: ToastType = 'error') {
  if (addToastFn) {
    addToastFn(message, type);
  } else {
    // Fallback to console if Toast not mounted yet
    console.warn('[Toast not ready]', message);
  }
}

const typeStyles: Record<ToastType, { bg: string; border: string; icon: string }> = {
  error: { bg: 'rgba(180, 40, 40, 0.92)', border: '#e74c3c', icon: '⚠' },
  warning: { bg: 'rgba(180, 120, 40, 0.92)', border: '#f39c12', icon: '⚡' },
  info: { bg: 'rgba(40, 100, 160, 0.92)', border: '#3498db', icon: 'ℹ' },
  success: { bg: 'rgba(40, 140, 80, 0.92)', border: '#27ae60', icon: '✓' },
};

export const ToastContainer: React.FC = () => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    addToastFn = (message: string, type: ToastType = 'error') => {
      const id = ++toastId;
      setToasts((prev) => [...prev, { id, message, type }]);
      
      // Auto-remove after 2.5 seconds
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 2500);
    };

    return () => {
      addToastFn = null;
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      zIndex: 10000,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      pointerEvents: 'none',
    }}>
      {toasts.map((toast) => {
        const style = typeStyles[toast.type];
        return (
          <div
            key={toast.id}
            style={{
              background: style.bg,
              border: `2px solid ${style.border}`,
              borderRadius: 8,
              padding: '14px 24px',
              color: '#fff',
              fontSize: 15,
              fontWeight: 500,
              fontFamily: "'Orbitron', 'Segoe UI', sans-serif",
              textAlign: 'center',
              boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
              backdropFilter: 'blur(4px)',
              animation: 'toastFadeIn 0.2s ease-out',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              minWidth: 200,
              maxWidth: 400,
            }}
          >
            <span style={{ fontSize: 20 }}>{style.icon}</span>
            <span>{toast.message}</span>
          </div>
        );
      })}
      <style>{`
        @keyframes toastFadeIn {
          from { opacity: 0; transform: scale(0.9); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
};

