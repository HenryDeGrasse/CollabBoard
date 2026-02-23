import React from "react";

interface CanvasErrorBoundaryProps {
  children: React.ReactNode;
  onRetry?: () => void;
}

interface CanvasErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary wrapping the Konva <Stage>.
 *
 * If a Konva rendering error occurs (e.g. corrupted node tree, NaN positions,
 * unsupported shape config) this catches it so the entire app doesn't crash.
 * The user gets a clear recovery option instead of a white screen.
 */
export class CanvasErrorBoundary extends React.Component<
  CanvasErrorBoundaryProps,
  CanvasErrorBoundaryState
> {
  constructor(props: CanvasErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): CanvasErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[CanvasErrorBoundary] Rendering error caught:", error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="absolute inset-0 flex items-center justify-center bg-newsprint-bg z-50">
          <div className="bg-newsprint-bg border-2 border-newsprint-fg sharp-corners shadow-[8px_8px_0px_0px_#111111] p-8 max-w-md w-full text-center">
            <div className="text-4xl mb-6">⚠️</div>
            <h2 className="text-xl font-black font-serif text-newsprint-fg mb-4 uppercase tracking-widest">
              Canvas Error
            </h2>
            <p className="text-newsprint-fg font-body text-sm mb-2 leading-relaxed">
              Something went wrong rendering the canvas. Your data is safe &mdash;
              this is a display issue.
            </p>
            {this.state.error && (
              <p className="text-newsprint-muted font-mono text-xs mb-6 break-words">
                {this.state.error.message}
              </p>
            )}
            <button
              onClick={this.handleRetry}
              className="w-full py-3 sharp-corners text-xs font-mono uppercase tracking-widest font-bold bg-newsprint-fg text-newsprint-bg border border-transparent hover:bg-white hover:text-newsprint-fg hover:border-newsprint-fg transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
