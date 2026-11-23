import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource-variable/inter';
import '@fontsource-variable/manrope';
import './styles/global.css';
import { Layout } from './components/Layout';
import { EmptyState, LoadingPage } from './components/ui';
import { I18nProvider, useI18n } from './i18n';
import Dashboard from './pages/Dashboard';

const Lab = lazy(() => import('./pages/Lab'));

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true, retryDelay: (n) => Math.min(30_000, 1000 * 2 ** n) } },
});

function NotFound() {
  const { t } = useI18n();
  return (
    <EmptyState title={t('nf.title')} action={<Link to="/" style={{ color: 'var(--accent)' }}>{t('nf.back')}</Link>}>
      <p>{t('nf.text')}</p>
    </EmptyState>
  );
}

function LabRoute() {
  const { t } = useI18n();
  return <Suspense fallback={<LoadingPage label={t('loading.lab')} />}><Lab /></Suspense>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="lab" element={<LabRoute />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </I18nProvider>
  </StrictMode>,
);
