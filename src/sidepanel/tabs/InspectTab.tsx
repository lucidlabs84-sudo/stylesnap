import { useState, useCallback } from 'react'
import { Copy, Check, ChevronDown, ChevronRight, Lock } from 'lucide-react'
import { clsx } from 'clsx'
import type { ParsedCSS } from '@/shared/types'
import CodeBlock from '../components/CodeBlock'
import PropertyRow from '../components/PropertyRow'
import { formatCSS } from '@/lib/css-extractor'
import { useI18n } from '@/lib/i18n'

interface HoveredPayload {
  parsedCSS: ParsedCSS
  tagName: string
  id: string
  classList: string[]
  rect: { width: number; height: number; top: number; left: number }
}

interface InspectTabProps {
  currentElement:  HoveredPayload | null
  clickedElement:  (HoveredPayload & { componentHTML?: string; componentCSS?: string }) | null
  currentCSS:      ParsedCSS | null
  isInspecting:    boolean
  isPro:           boolean
  onUpgrade:       () => void
}

export default function InspectTab({
  currentElement,
  clickedElement,
  currentCSS,
  isInspecting,
  isPro,
  onUpgrade,
}: InspectTabProps) {
  const { t } = useI18n()
  const [showRaw, setShowRaw]         = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(['layout', 'typography', 'colors', 'spacing'])
  )
  const [copiedKey, setCopiedKey]     = useState<string | null>(null)

  const element = clickedElement ?? currentElement

  const copyToClipboard = useCallback(async (text: string, key: string) => {
    try { await navigator.clipboard.writeText(text) }
    catch {
      const el = document.createElement('textarea')
      el.value = text
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 1500)
  }, [])

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      next.has(group) ? next.delete(group) : next.add(group)
      return next
    })
  }

  // Empty states
  if (!element && !isInspecting) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center p-6">
        <div className="w-12 h-12 rounded-xl bg-indigo-500/10 flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-indigo-400">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
        </div>
        <p className="text-slate-400 text-sm" dangerouslySetInnerHTML={{ __html: t('emptyInspect1') }}></p>
      </div>
    )
  }

  if (isInspecting && !element) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center p-6">
        <div className="w-10 h-10 rounded-full bg-indigo-500/10 flex items-center justify-center">
          <span className="text-indigo-400 text-lg animate-pulse">◎</span>
        </div>
        <p className="text-slate-400 text-sm">{t('emptyInspect2')}</p>
      </div>
    )
  }

  if (!currentCSS) return null

  const { styles, selector, tailwindClasses = [], tailwindMatchRate = 0 } = currentCSS
  const groups = groupProperties(styles)
  const rawCSS = formatCSS(styles, selector)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Element info bar */}
      <div className="px-3 py-2 border-b border-slate-800 bg-slate-900/50 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-indigo-400 font-mono text-xs">{element?.tagName ?? 'element'}</span>
          {element?.id && (
            <span className="text-slate-400 font-mono text-xs">#{element.id}</span>
          )}
          {(element?.classList ?? []).length > 0 && (
            <span className="text-slate-500 font-mono text-xs truncate max-w-[120px]">
              .{(element!.classList).slice(0, 2).join('.')}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5 text-[10px]">
            <div
              className={clsx(
                'h-1.5 rounded-full',
                tailwindMatchRate > 0.7 ? 'bg-emerald-400' : tailwindMatchRate > 0.4 ? 'bg-amber-400' : 'bg-red-400'
              )}
              style={{ width: `${Math.round(tailwindMatchRate * 40)}px`, minWidth: 4 }}
            />
            <span className="text-slate-500">{Math.round(tailwindMatchRate * 100)}% TW</span>
          </div>
        </div>
        {element?.rect && (
          <div className="text-[10px] text-slate-600 mt-0.5">
            {element.rect.width}×{element.rect.height} px
          </div>
        )}
      </div>

      {/* Mode toggle + copy buttons */}
      <div className="flex px-3 py-1.5 gap-2 border-b border-slate-800 shrink-0 items-center">
        <button
          onClick={() => setShowRaw(false)}
          className={clsx('text-xs px-2 py-0.5 rounded', !showRaw ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-500 hover:text-slate-300')}
        >
          {t('properties')}
        </button>
        <button
          onClick={() => setShowRaw(true)}
          className={clsx('text-xs px-2 py-0.5 rounded', showRaw ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-500 hover:text-slate-300')}
        >
          {t('rawCSS')}
        </button>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => copyToClipboard(rawCSS, 'css')}
            className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200 transition-colors"
          >
            {copiedKey === 'css' ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
            {t('copyCSS')}
          </button>
          <button
            onClick={() => {
              if (!isPro) { onUpgrade(); return }
              copyToClipboard(tailwindClasses.join(' '), 'tw')
            }}
            className={clsx(
              'flex items-center gap-1 text-[10px] transition-colors',
              isPro ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600'
            )}
          >
            {!isPro && <Lock size={10} />}
            {copiedKey === 'tw' ? <Check size={10} className="text-emerald-400" /> : null}
            {t('copyTW')}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {showRaw ? (
          <div className="p-3">
            <CodeBlock language="css" code={rawCSS} />
          </div>
        ) : (
          <div>
            {/* Tailwind classes */}
            {tailwindClasses.length > 0 && (
              <div className="px-3 py-2 border-b border-slate-800/50">
                <div className="text-[10px] text-slate-500 mb-1.5 uppercase tracking-wide">Tailwind</div>
                <div
                  onClick={() => isPro ? copyToClipboard(tailwindClasses.join(' '), 'tw-block') : onUpgrade()}
                  className={clsx(
                    'text-[11px] font-mono leading-relaxed rounded p-2 cursor-pointer transition-colors',
                    isPro
                      ? 'text-sky-400 bg-slate-800/50 hover:bg-slate-800'
                      : 'text-slate-600 bg-slate-800/30'
                  )}
                >
                  {isPro ? (
                    tailwindClasses.join(' ')
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <Lock size={10} /> {t('upgradeToCopyTW')}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Property groups */}
            {Object.entries(groups).map(([group, props]) => {
              if (Object.keys(props).length === 0) return null
              const isExpanded = expandedGroups.has(group)
              return (
                <div key={group} className="border-b border-slate-800/50">
                  <button
                    onClick={() => toggleGroup(group)}
                    className="flex items-center gap-1.5 w-full px-3 py-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider hover:bg-slate-800/30 transition-colors"
                  >
                    {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                    {group}
                    <span className="ml-auto text-[9px] font-normal text-slate-600">
                      {Object.keys(props).length}
                    </span>
                  </button>
                  {isExpanded && (
                    <div>
                      {Object.entries(props).map(([prop, value]) => (
                        <PropertyRow
                          key={prop}
                          property={prop}
                          value={value}
                          onCopy={() => copyToClipboard(`${prop}: ${value}`, prop)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Group CSS properties ─────────────────────────────────────────────────────
function groupProperties(css: Record<string, string>): Record<string, Record<string, string>> {
  const groups: Record<string, Record<string, string>> = {
    layout: {}, spacing: {}, typography: {}, colors: {}, borders: {}, effects: {}, other: {},
  }

  const LAYOUT    = new Set(['display', 'position', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'flex', 'flex-direction', 'flex-wrap', 'align-items', 'justify-content', 'gap', 'grid', 'grid-template-columns', 'grid-template-rows', 'z-index', 'top', 'right', 'bottom', 'left', 'overflow', 'overflow-x', 'overflow-y'])
  const SPACING   = new Set(['margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'row-gap', 'column-gap'])
  const TYPO      = new Set(['font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-decoration', 'text-transform', 'white-space'])
  const COLORS    = new Set(['color', 'background-color', 'background', 'fill', 'stroke', 'border-color'])
  const BORDERS   = new Set(['border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-width', 'border-style', 'border-radius', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius', 'outline'])

  for (const [p, v] of Object.entries(css)) {
    if (LAYOUT.has(p))       groups.layout[p] = v
    else if (SPACING.has(p)) groups.spacing[p] = v
    else if (TYPO.has(p))    groups.typography[p] = v
    else if (COLORS.has(p))  groups.colors[p] = v
    else if (BORDERS.has(p)) groups.borders[p] = v
    else if (['box-shadow', 'opacity', 'transform', 'transition', 'visibility', 'cursor'].includes(p)) groups.effects[p] = v
    else groups.other[p] = v
  }

  return groups
}
