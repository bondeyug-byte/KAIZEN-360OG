import { Component } from 'react'

/**
 * Catches a rendering failure in one part of the app so the rest (navigation, other pages) keeps working.
 * `resetKey` (e.g. the route) clears the error when the user moves somewhere else.
 * The error message is shown only as a short technical line — never data or credentials.
 */
export default class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { console.error('[Campus360] section failed to render:', error?.message, info?.componentStack?.split('\n').slice(0, 3).join(' ')) }
  componentDidUpdate(prev) { if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null }) }
  render() {
    if (!this.state.error) return this.props.children
    const full = this.props.full
    return (
      <div role="alert" className={full ? 'grid min-h-screen place-items-center bg-ground p-6' : 'py-12'}>
        <div className="mx-auto max-w-md rounded-2xl border border-line bg-surface p-6 text-center shadow-sm">
          <h1 className="font-display text-2xl font-bold">{this.props.title || 'This section couldn’t load'}</h1>
          <p className="mt-2 text-[14.5px] text-muted">Something in the saved data for this page looks wrong, so we stopped it here instead of breaking the whole app. Your other pages still work.</p>
          <p className="mt-2 break-words font-mono text-[12px] text-muted">{String(this.state.error?.message || this.state.error).slice(0, 140)}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button type="button" className="min-h-[44px] rounded-full bg-maroon px-5 font-semibold text-white" onClick={() => this.setState({ error: null })}>Try again</button>
            <a href="#/" onClick={() => this.setState({ error: null })} className="inline-flex min-h-[44px] items-center rounded-full border border-line px-5 font-semibold text-maroon">Go to the dashboard</a>
            {full && <button type="button" className="min-h-[44px] rounded-full border border-line px-5 font-semibold" onClick={() => window.location.reload()}>Reload</button>}
          </div>
        </div>
      </div>
    )
  }
}
