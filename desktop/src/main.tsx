import React, { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import { Buffer } from 'buffer';

// Node.js globals polyfills for isomorphic-git in browser/webview environment
(window as any).Buffer = Buffer;
(window as any).process = {
  env: {},
  browser: true,
  version: '',
  versions: {},
  nextTick: (cb: any) => setTimeout(cb, 0)
};

import App from './App';
import './style.css';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#121214',
          color: '#e1e1e6',
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          padding: '20px',
          textAlign: 'center',
          boxSizing: 'border-box'
        }}>
          <h2 style={{ color: '#ef4444', marginBottom: '10px', fontSize: '20px', fontWeight: '700' }}>⚠️ Bir Şeyler Yanlış Gitti</h2>
          <p style={{ color: '#a0a0b2', fontSize: '13px', maxWidth: '420px', marginBottom: '24px', lineHeight: '1.6' }}>
            Uygulama yüklenirken veya çalışırken kritik bir hata oluştu. Ayarları sıfırlayarak kurtarmayı deneyebilirsiniz.
          </p>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button 
              onClick={() => {
                localStorage.clear();
                window.location.reload();
              }}
              style={{
                background: '#ef4444',
                color: '#fff',
                border: 'none',
                padding: '10px 20px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '12px',
                transition: 'all 0.15s ease'
              }}
            >
              Uygulamayı Sıfırla & Yeniden Başlat
            </button>
            <button 
              onClick={() => window.location.reload()}
              style={{
                background: '#2d2d34',
                color: '#fff',
                border: 'none',
                padding: '10px 20px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '12px',
                transition: 'all 0.15s ease'
              }}
            >
              Yeniden Dene
            </button>
          </div>
          {this.state.error && (
            <pre style={{
              marginTop: '32px',
              padding: '14px',
              background: '#1a1a1e',
              border: '1px solid #2d2d34',
              borderRadius: '8px',
              fontSize: '11px',
              fontFamily: 'monospace',
              textAlign: 'left',
              maxWidth: '80vw',
              maxHeight: '200px',
              overflow: 'auto',
              color: '#f43f5e',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all'
            }}>
              {this.state.error.toString() + '\n' + this.state.error.stack}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
