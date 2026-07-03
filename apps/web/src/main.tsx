import React from 'react';
import ReactDOM from 'react-dom/client';

import i18n from './i18n/index.js';
import App from './App.js';

type RuntimeFallbackState = {
  error?: Error;
};

const isPixiStageTeardownError = (error: Error) =>
  error.message.includes("Cannot read properties of null (reading 'stage')") &&
  (error.stack ?? '').includes('Stage2.componentWillUnmount');

class RuntimeFallback extends React.Component<React.PropsWithChildren, RuntimeFallbackState> {
  override state: RuntimeFallbackState = {};

  override componentDidCatch(error: Error) {
    if (isPixiStageTeardownError(error)) {
      console.warn('Ignored Pixi stage teardown warning', error);
      return;
    }
    console.error(error);
    this.setState({ error });
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
        <h1 style={{ color: '#d4a520', marginTop: 0 }}>{i18n.t('common:runtimeFault.title')}</h1>
        <p>{i18n.t('common:runtimeFault.detail')}</p>
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
          {i18n.t('common:resetLocalState')}
        </button>
      </div>
    );
  }
}

// Reuse the root across Vite HMR re-executions of this module; calling createRoot twice on the
// same container mounts a second app instance and floods the console with warnings in dev.
const container = document.getElementById('root') as HTMLElement & { _reactRoot?: ReactDOM.Root };
const root = container._reactRoot ?? (container._reactRoot = ReactDOM.createRoot(container));
root.render(
  <RuntimeFallback>
    <App />
  </RuntimeFallback>
);
