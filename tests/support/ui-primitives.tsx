import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'

const escapeStack: Array<{ readonly dismiss: { current: () => void } }> = []
let escapeListenerInstalled = false

function installEscapeListener(): void {
  if (escapeListenerInstalled) return
  escapeListenerInstalled = true
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return
    escapeStack.at(-1)?.dismiss.current()
  })
}

function useEscapeDismiss(open: boolean, dismiss: () => void): void {
  const dismissRef = useRef(dismiss)
  dismissRef.current = dismiss
  useEffect(() => {
    if (!open) return
    installEscapeListener()
    const entry = { dismiss: dismissRef }
    escapeStack.push(entry)
    return () => {
      const index = escapeStack.indexOf(entry)
      if (index >= 0) escapeStack.splice(index, 1)
    }
  }, [open])
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly icon?: ReactNode
  readonly tooltip?: string
  readonly variant?: string
  readonly size?: string
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { children, icon, tooltip, variant: _variant, size: _size, ...props },
  ref,
) {
  return <button ref={ref} title={tooltip} {...props}>{icon}{children}</button>
})

type ModalProps = {
  readonly open: boolean
  readonly onClose: () => void
  readonly title: ReactNode
  readonly closeLabel?: string
  readonly className?: string
  readonly contentClassName?: string
  readonly footer?: ReactNode
  readonly children?: ReactNode
}

export function Modal({ open, onClose, title, closeLabel, className, contentClassName, footer, children }: ModalProps) {
  useEscapeDismiss(open, onClose)
  if (!open) return null
  return (
    <div role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} className={className}>
      <header><h2>{title}</h2>{closeLabel === undefined ? null : <button type="button" aria-label={closeLabel} onClick={onClose}>×</button>}</header>
      <div className={contentClassName}>{children}</div>
      {footer === undefined ? null : <footer>{footer}</footer>}
    </div>
  )
}

type RiskConfirmationProps = {
  readonly open: boolean
  readonly title: string
  readonly description: string
  readonly acknowledgeLabel: string
  readonly cancelLabel: string
  readonly confirmLabel: string
  readonly acknowledged: boolean
  readonly disabled?: boolean
  readonly onAcknowledgedChange: (acknowledged: boolean) => void
  readonly onCancel: () => void
  readonly onConfirm: () => void
}

export function RiskConfirmation(props: RiskConfirmationProps) {
  useEscapeDismiss(props.open, props.onCancel)
  if (!props.open) return null
  return (
    <div role="dialog" aria-modal="true" aria-label={props.title}>
      <h2>{props.title}</h2>
      <p>{props.description}</p>
      <label>
        <input
          type="checkbox"
          checked={props.acknowledged}
          disabled={props.disabled}
          onChange={event => { props.onAcknowledgedChange(event.currentTarget.checked) }}
        />
        {props.acknowledgeLabel}
      </label>
      <button type="button" disabled={props.disabled} onClick={props.onCancel}>{props.cancelLabel}</button>
      <button type="button" disabled={props.disabled || !props.acknowledged} onClick={props.onConfirm}>{props.confirmLabel}</button>
    </div>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(props, ref) {
  return <input ref={ref} {...props} />
})

export function TerminalBlock({ command, cwd, output, exitCode, signal }: Readonly<Record<string, unknown>>) {
  return (
    <div data-testid="terminal-block">
      <strong>{String(command ?? '')}</strong>
      {cwd === undefined ? null : <span>{String(cwd)}</span>}
      {output === undefined ? null : <pre>{String(output)}</pre>}
      {exitCode === undefined ? null : <span>{String(exitCode)}</span>}
      {signal === undefined ? null : <span>{String(signal)}</span>}
    </div>
  )
}

export function DiffBlock({ diffs }: { readonly diffs?: readonly Readonly<Record<string, unknown>>[] }) {
  return (
    <div data-testid="diff-block">
      {(diffs ?? []).map((diff, index) => (
        <section key={`${String(diff.path)}:${index}`}>
          <strong>{String(diff.path ?? '')}</strong>
          {diff.oldText == null ? null : <pre>{String(diff.oldText)}</pre>}
          {diff.newText == null ? null : <pre>{String(diff.newText)}</pre>}
        </section>
      ))}
    </div>
  )
}

export function JsonTree({ data, label }: { readonly data: unknown; readonly label?: string }) {
  return <pre aria-label={label}>{JSON.stringify(data, null, 2)}</pre>
}

export async function writeClipboard(value: string): Promise<void> {
  await navigator.clipboard.writeText(value)
}

function Icon(props: HTMLAttributes<HTMLSpanElement>) {
  return <span aria-hidden="true" {...props} />
}

export const IconChecklistOutline14 = Icon
export const IconCloseOutline16 = Icon
export const IconRefreshOutline16 = Icon
export const IconAgentPresetOutline16 = Icon
export const IconPlusOutline16 = Icon
export const IconSearchOutline16 = Icon
