import React from 'react';
import ReactDOM from 'react-dom/client';
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import App from './App';

// Tell Monaco where to find its workers (Vite ?worker syntax bundles them).
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    switch (label) {
      case 'json': return new jsonWorker();
      case 'css':
      case 'scss':
      case 'less': return new cssWorker();
      case 'html':
      case 'handlebars':
      case 'razor': return new htmlWorker();
      case 'typescript':
      case 'javascript': return new tsWorker();
      default: return new editorWorker();
    }
  },
};

// Tell @monaco-editor/loader to use our local Monaco instead of the jsdelivr CDN.
loader.config({ monaco });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
