import { Component, type ErrorInfo, type ReactNode } from 'react'
import type { Screen } from '../types'

type Props = { children: ReactNode }
type State = { error: string | null }

function crashMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err || 'Error')
}

function rememberCrash(err: unknown, info?: ErrorInfo) {
  console.error('REPOSICIÓN crash', err, info?.componentStack)
  try {
    localStorage.setItem(
      'reposicion.lastCrash',
      JSON.stringify({ at: Date.now(), error: crashMessage(err), stack: info?.componentStack || '' }),
    )
  } catch {
    /* quota */
  }
}

/** Si React explota, no dejar la WebView negra y muerta. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(err: unknown): State {
    return { error: crashMessage(err) }
  }

  componentDidCatch(err: unknown, info: ErrorInfo) {
    rememberCrash(err, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="crash-screen">
        <p>Se trabó la pantalla.</p>
        <p className="mini">{this.state.error}</p>
        <button type="button" className="btn primary" onClick={() => window.location.reload()}>
          Recargar
        </button>
      </div>
    )
  }
}

type ScreenProps = { screen: Screen; children: ReactNode }
type ScreenState = { error: string | null; screen: Screen; remountKey: number; retries: number }

/** Un crash en una pantalla no mata toda la app: remonta sola sin pedir Reintentar. */
export class ScreenErrorBoundary extends Component<ScreenProps, ScreenState> {
  state: ScreenState = { error: null, screen: this.props.screen, remountKey: 0, retries: 0 }

  static getDerivedStateFromError(err: unknown): Partial<ScreenState> {
    return { error: crashMessage(err) }
  }

  static getDerivedStateFromProps(props: ScreenProps, state: ScreenState): Partial<ScreenState> | null {
    if (props.screen !== state.screen) {
      return { screen: props.screen, error: null, remountKey: state.remountKey + 1, retries: 0 }
    }
    return null
  }

  componentDidCatch(err: unknown, info: ErrorInfo) {
    rememberCrash(err, info)
    if (this.state.retries >= 2) return
    window.setTimeout(() => {
      this.setState((s) => ({ error: null, remountKey: s.remountKey + 1, retries: s.retries + 1 }))
    }, 0)
  }

  render() {
    if (this.state.error) return null
    return (
      <div key={this.state.remountKey} className="screen-root">
        {this.props.children}
      </div>
    )
  }
}
