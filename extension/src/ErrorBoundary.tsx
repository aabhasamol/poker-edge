/**
 * Keeps a render failure from erasing the tool.
 *
 * React unmounts the entire tree when a render throws and nothing catches it.
 * In a side panel that means a black rectangle over a live table: no message,
 * no clue, and the numbers simply stop while the hand is still being played.
 * That is the worst way for this tool to fail, because it is silent at exactly
 * the moment someone is relying on it.
 *
 * A boundary cannot repair the render, but it can say what happened, keep the
 * panel present, and leave a way back — the next hand usually re-renders from
 * clean state.
 */

import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  readonly children: ReactNode;
}

interface State {
  readonly message: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // The panel has no other log; without this the stack is unrecoverable.
    console.error('[Poker Edge] panel render failed', error, info.componentStack);
  }

  private retry = (): void => {
    this.setState({ message: null });
  };

  override render(): ReactNode {
    if (this.state.message === null) return this.props.children;

    return (
      <div className="panel-app">
        <header className="app-head">
          <h1>Poker Edge</h1>
          <span className="status is-error">panel error</span>
        </header>
        <section className="card">
          <p>
            The panel hit an error while drawing this hand, so it stopped rather than showing
            something wrong.
          </p>
          <p className="player-reasoning">{this.state.message}</p>
          <button type="button" onClick={this.retry}>
            Try drawing it again
          </button>
        </section>
      </div>
    );
  }
}
