import React from 'react';
import { AlertTriangle, RefreshCcw } from 'lucide-react';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true };
    }

    componentDidCatch(error, errorInfo) {
        this.setState({ error, errorInfo });
        console.error("ErrorBoundary caught an error", error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-50 dark:bg-zinc-950 p-6 text-center">
                    <div className="bg-white dark:bg-zinc-900 border border-red-200 dark:border-red-900/50 rounded-2xl p-8 max-w-lg shadow-xl">
                        <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
                            <AlertTriangle className="w-8 h-8 text-red-600 dark:text-red-500" />
                        </div>
                        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white mb-2">A apărut o eroare</h1>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
                            Aplicația a întâmpinat o problemă neașteptată la afișarea acestei secțiuni.
                        </p>
                        
                        {this.state.error && (
                            <div className="bg-zinc-100 dark:bg-zinc-950 rounded-lg p-4 mb-6 text-left overflow-x-auto text-xs font-mono text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800">
                                {this.state.error.toString()}
                            </div>
                        )}

                        <button
                            onClick={() => window.location.reload()}
                            className="inline-flex items-center gap-2 px-6 py-2.5 bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 rounded-xl font-medium transition-colors"
                        >
                            <RefreshCcw className="w-4 h-4" />
                            Reîncarcă Aplicația
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
