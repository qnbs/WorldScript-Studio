import type { ErrorInfo, ReactNode } from 'react';
import React, { Component } from 'react';
import { Card, CardHeader, CardContent } from './Card';
import { Button } from './Button';
import { ICONS } from '../../constants';
import { logger } from '../../services/logger';

interface ErrorBoundaryProps {
  children?: ReactNode;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
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
      return (
        <div className="flex h-full w-full items-center justify-center p-4">
          <Card className="max-w-lg w-full text-center animate-in">
            <CardHeader className="flex items-center justify-center space-x-2">
              <div className="text-red-500">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-8 h-8"
                >
                  {ICONS.LIGHTNING_BOLT}
                </svg>
              </div>
              <h1 className="text-xl font-bold text-red-500">Something went wrong.</h1>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-[var(--foreground-secondary)]">
                A critical error occurred in this part of the application. Please try reloading the
                view. If the problem persists, the application state might be corrupted. You may
                need to reset the project from the settings menu.
              </p>
              <div className="flex gap-2 justify-center">
                {this.props.onReset && (
                  <Button
                    onClick={() => {
                      this.setState({ hasError: false });
                      this.props.onReset?.();
                    }}
                    variant="primary"
                  >
                    Reset View
                  </Button>
                )}
                <Button onClick={() => window.location.reload()} variant="secondary">
                  Reload Page
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
