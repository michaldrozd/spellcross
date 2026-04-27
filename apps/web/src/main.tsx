import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App.js';

type RuntimeFallbackState = {
  error?: Error;
};

class RuntimeFallback extends React.Component<React.PropsWithChildren, RuntimeFallbackState> {
  override state: RuntimeFallbackState = {};

  static getDerivedStateFromError(error: Error): RuntimeFallbackState {
    return { error };
  }

  override componentDidCatch(error: Error) {
    console.error(error);
  }

  override render() {
    if (!this.state.error) return this.props.children;

    return (
      <div style={{
        minHeight: '100vh',
        background: '#050508',
        color: '#e2e8f0',
        fontFamily: 'monospace',
        padding: 24
      }}>
        <h1 style={{ color: '#d4a520', marginTop: 0 }}>Runtime fault</h1>
        <p>The tactical renderer stopped unexpectedly. Reset local state and reload, then launch the battle again.</p>
        <pre style={{
          whiteSpace: 'pre-wrap',
          background: '#111827',
          border: '1px solid #334155',
          padding: 16,
          maxHeight: 360,
          overflow: 'auto'
        }}>
          {this.state.error.stack ?? this.state.error.message}
        </pre>
        <button
          onClick={() => {
            for (const key of Object.keys(window.localStorage)) {
              if (key.startsWith('spellcross:')) window.localStorage.removeItem(key);
            }
            window.location.reload();
          }}
          style={{
            background: '#d4a520',
            color: '#050508',
            border: '1px solid #f4c520',
            padding: '10px 14px',
            fontWeight: 700,
            cursor: 'pointer'
          }}
        >
          Reset Local State
        </button>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <RuntimeFallback>
    <App />
  </RuntimeFallback>
);
