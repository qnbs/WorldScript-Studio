import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { logger } from '../../services/logger';
import { Button } from './Button';
import { Card, CardContent, CardHeader } from './Card';
import { Icon } from './Icon';

interface ErrorBoundaryProps {
  children?: ReactNode;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

// QNBS-v3: Functional inner component enables useTranslation inside class-based ErrorBoundary.
function ErrorFallback({ onReset }: { onReset?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full w-full items-center justify-center p-4">
      <Card className="max-w-lg w-full text-center animate-in">
        <CardHeader className="flex items-center justify-center space-x-2">
          <div className="text-[var(--sc-danger-fg)]">
            <Icon name="error" size="xl" aria-hidden />
          </div>
          <h1 className="text-xl font-bold text-[var(--sc-danger-fg)]">
            {t('error.boundary.title')}
          </h1>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-[var(--sc-text-secondary)]">{t('error.boundary.description')}</p>
          <div className="flex flex-wrap gap-2 justify-center">
            {onReset && (
              <Button onClick={onReset} variant="primary">
                {t('error.boundary.reset')}
              </Button>
            )}
            <Button onClick={() => window.location.reload()} variant="secondary">
              {t('error.boundary.reload')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                window.open(
                  'https://github.com/qnbs/WorldScript-Studio/issues/new',
                  '_blank',
                  'noopener,noreferrer',
                )
              }
            >
              {t('error.boundary.report')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  // QNBS-v3: static displayName inside class body — external assignment fails TS2339 on class types.
  static displayName = 'ErrorBoundary';

  public state: ErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError(_: Error): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error('Uncaught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      const handleReset = this.props.onReset
        ? () => {
            this.setState({ hasError: false });
            this.props.onReset?.();
          }
        : undefined;
      return handleReset ? <ErrorFallback onReset={handleReset} /> : <ErrorFallback />;
    }

    return this.props.children;
  }
}
