import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { AppProviders } from './providers';
import { applyThemeVariables } from './design-system/theme/applyTheme';
import './styles/base.css';
import './styles/components.css';
import './styles/pages.css';

applyThemeVariables();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </React.StrictMode>,
);
