import React, { createContext, useContext, useState, useEffect } from 'react'
import { detectLang, translations, type Language, type TranslationKey } from './i18n-core'

interface I18nContextType {
  lang: Language
  setLang: (lang: Language) => void
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextType | null>(null)

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Language>('en')

  useEffect(() => {
    detectLang().then(detected => {
      setLangState(detected)
    })
  }, [])

  const setLang = (newLang: Language) => {
    setLangState(newLang)
    chrome.storage.local.set({ language: newLang })
  }

  const t = (key: TranslationKey, params?: Record<string, string | number>) => {
    let str = translations[lang][key] || translations.en[key] || key
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        str = str.replace(`{${k}}`, String(v))
      })
    }
    return str
  }

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export const useI18n = () => {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}
