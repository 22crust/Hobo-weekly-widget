import React from "react";
import { PlannerWidget } from "./components/planner/PlannerWidget";

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string | null;
}

class WidgetErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: null };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error("[WidgetErrorBoundary] Caught runtime UI error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-screen p-4 bg-hobo-paperSolid text-hobo-ink flex flex-col justify-center items-start gap-2 border border-hobo-red">
          <div className="text-xs uppercase tracking-widest text-hobo-red font-normal">
            Widget Render Error
          </div>
          <pre className="text-[11px] whitespace-pre-wrap break-all bg-white/70 p-2 border border-hobo-line w-full">
            {this.state.errorMessage}
          </pre>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, errorMessage: null })}
            className="px-2 py-1 text-xs border border-hobo-ink hover:border-hobo-red hover:text-hobo-red"
          >
            Retry Render
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export const App: React.FC = () => {
  return (
    <WidgetErrorBoundary>
      <PlannerWidget />
    </WidgetErrorBoundary>
  );
};

export default App;
