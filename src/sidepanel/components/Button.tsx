import { clsx } from 'clsx'
import type { ReactNode } from 'react'

type ButtonVariant = 'icon' | 'primary' | 'secondary' | 'text' | 'toggle' | 'tab'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps {
  variant?: ButtonVariant
  size?: ButtonSize
  onClick?: () => void
  onClickCapture?: () => void
  className?: string
  title?: string
  children?: ReactNode
  disabled?: boolean
  active?: boolean
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  icon: 'p-1.5 rounded text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors',
  primary: 'flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all',
  secondary: 'flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded border transition-colors',
  text: 'text-indigo-400 hover:text-indigo-300 transition-colors',
  toggle: 'flex items-center justify-center gap-1 py-1.5 rounded text-[11px] transition-colors relative',
  tab: 'text-xs px-2 py-0.5 rounded',
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
}

const ACTIVE_CLASSES: Record<ButtonVariant, string> = {
  icon: 'bg-slate-800 text-slate-200',
  primary: 'bg-indigo-500 text-white shadow-[0_0_14px_rgba(99,102,241,0.35)]',
  secondary: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  text: 'text-indigo-300',
  toggle: 'bg-indigo-600 text-white shadow',
  tab: 'bg-indigo-500/20 text-indigo-400',
}

export default function Button({
  variant = 'primary',
  size = 'md',
  onClick,
  onClickCapture,
  className = '',
  title,
  children,
  disabled = false,
  active = false,
}: ButtonProps) {
  const baseClasses = VARIANT_CLASSES[variant]
  const sizeClasses = SIZE_CLASSES[size]
  const activeClasses = active ? ACTIVE_CLASSES[variant] : ''
  const disabledClasses = disabled ? 'opacity-50 cursor-not-allowed' : ''

  const allClasses = clsx(baseClasses, sizeClasses, activeClasses, disabledClasses, className)

  return (
    <button
      onClick={onClick}
      onClickCapture={onClickCapture}
      className={allClasses}
      title={title}
      disabled={disabled}
    >
      {children}
    </button>
  )
}
