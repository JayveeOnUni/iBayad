import {
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
  XCircle,
} from 'lucide-react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

export type ToastVariant = 'success' | 'danger' | 'error' | 'warning' | 'info'
type NormalizedToastVariant = Exclude<ToastVariant, 'error'>

export interface ToastInput {
  title: string
  description?: string
  variant?: ToastVariant
  durationMs?: number | null
}

interface ToastItem {
  id: string
  title: string
  description?: string
  variant: NormalizedToastVariant
  durationMs: number | null
}

interface ToastContextValue {
  showToast: (toast: ToastInput) => string
  dismissToast: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const defaultDurations: Record<NormalizedToastVariant, number> = {
  success: 4500,
  info: 4500,
  warning: 8000,
  danger: 10000,
}

const variantStyles: Record<NormalizedToastVariant, {
  icon: ReactNode
  frame: string
  iconFrame: string
  close: string
}> = {
  success: {
    icon: <CheckCircle2 size={20} aria-hidden="true" />,
    frame: 'border-success bg-success text-white',
    iconFrame: 'bg-white/15 text-white',
    close: 'text-white/80 hover:bg-white/15 hover:text-white focus-visible:ring-white/60',
  },
  danger: {
    icon: <XCircle size={20} aria-hidden="true" />,
    frame: 'border-danger bg-danger text-white',
    iconFrame: 'bg-white/15 text-white',
    close: 'text-white/80 hover:bg-white/15 hover:text-white focus-visible:ring-white/60',
  },
  warning: {
    icon: <AlertTriangle size={20} aria-hidden="true" />,
    frame: 'border-warning-border bg-warning-muted text-warning',
    iconFrame: 'bg-warning-surface text-warning',
    close: 'text-warning/80 hover:bg-warning-surface hover:text-warning focus-visible:ring-warning-border',
  },
  info: {
    icon: <Info size={20} aria-hidden="true" />,
    frame: 'border-info bg-info text-white',
    iconFrame: 'bg-white/15 text-white',
    close: 'text-white/80 hover:bg-white/15 hover:text-white focus-visible:ring-white/60',
  },
}

function normalizeVariant(variant: ToastVariant = 'info'): NormalizedToastVariant {
  return variant === 'error' ? 'danger' : variant
}

function getToastDuration(variant: NormalizedToastVariant, durationMs?: number | null): number | null {
  if (durationMs !== undefined) return durationMs
  return defaultDurations[variant]
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const idCounter = useRef(0)

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const showToast = useCallback((toast: ToastInput) => {
    const variant = normalizeVariant(toast.variant)
    const id = `toast-${Date.now()}-${idCounter.current}`
    idCounter.current += 1

    setToasts((current) => [
      ...current,
      {
        id,
        title: toast.title,
        description: toast.description,
        variant,
        durationMs: getToastDuration(variant, toast.durationMs),
      },
    ])

    return id
  }, [])

  const value = useMemo(() => ({ showToast, dismissToast }), [showToast, dismissToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return context
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[]
  onDismiss: (id: string) => void
}) {
  if (toasts.length === 0) return null

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-3 px-4 md:bottom-auto md:left-auto md:right-4 md:top-4 md:w-full md:max-w-sm md:items-stretch md:px-0"
      aria-live="polite"
      aria-relevant="additions text"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem
  onDismiss: (id: string) => void
}) {
  const styles = variantStyles[toast.variant]

  useEffect(() => {
    if (toast.durationMs === null) return undefined

    const timeout = window.setTimeout(() => {
      onDismiss(toast.id)
    }, toast.durationMs)

    return () => window.clearTimeout(timeout)
  }, [onDismiss, toast.durationMs, toast.id])

  return (
    <div
      className={[
        'pointer-events-auto grid w-full max-w-sm grid-cols-[auto_1fr_auto] gap-3 rounded-lg border p-4 shadow-elevated',
        styles.frame,
      ].join(' ')}
      role={toast.variant === 'danger' ? 'alert' : 'status'}
    >
      <div className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md ${styles.iconFrame}`}>
        {styles.icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-5">{toast.title}</p>
        {toast.description && (
          <p className="mt-1 text-sm leading-5 opacity-90">{toast.description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className={[
          'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0',
          styles.close,
        ].join(' ')}
        aria-label="Dismiss notification"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  )
}
