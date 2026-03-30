import { Component, type ReactNode, type ErrorInfo } from "react";
import { AlertTriangle } from "lucide-react";

class SignalErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode; fallback?: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[SignalCard Error]", error, info);
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-center">
          <AlertTriangle className="h-5 w-5 text-red-400 mx-auto mb-2" />
          <p className="text-xs text-red-300">Card failed to render</p>
          <button onClick={() => this.setState({ hasError: false, error: null })} className="text-[10px] text-red-400 underline mt-1">Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default SignalErrorBoundary;
