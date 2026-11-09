// The brand top bar, its menu and the first-visit language card. See
// components/guided-form/README.md ("Brand top bar"). The server helper
// `languagePromptNeeded` lives in ./language-cookie and is not re-exported
// here, so client code can import this file.
export { BrandMenu, catchMenuButton, type BrandMenuProps } from "./brand-menu"
export { BrandTopBar, type BrandTopBarProps } from "./brand-top-bar"
export { BADGE_TEXT, BRAND_COPY, HOME_URL, LANGUAGE_OPTIONS, LANGUAGE_PROMPT_COPY, LANGUAGE_PROMPT_PICKS, type BadgeVariant, type BrandCopy, type LanguagePromptCopy } from "./copy"
export { LanguagePrompt, type LanguagePromptProps } from "./language-prompt"
