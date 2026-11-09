import "server-only"

import { EXPORT_CHOICES, EXPORT_PRESETS, holdsTier, tierNeeded, type ExportTier } from "@/lib/services/student-export"

// What the export sheet offers one staff member, as plain data the client
// sheet can hold: the presets their tiers allow, every column choice with its
// tier (the sheet locks the groups they don't hold), and which tiers they
// hold. The route and the database refuse the rest anyway.

export type ExportPresetOption = {
  key: string
  label: string
  description: string
  tier: ExportTier
  // The choices the preset ticks in "Choose columns".
  choices: string[]
  // The CSV's columns; 0 for Choose columns, which counts its ticks.
  columns: number
}

export type ExportChoiceOption = { key: string; label: string; tier: ExportTier; columns: number }

export type ExportOptions = {
  presets: ExportPresetOption[]
  choices: ExportChoiceOption[]
  tiers: Record<ExportTier, boolean>
}

const DESCRIPTIONS: Record<string, string> = {
  class: "Admission Number, student, class, year, day or boarding, status",
  calls: "Class list plus parent name, phone and WhatsApp",
  codes: "Who referred each applicant",
  full: "Every column, payments, results, notes and history included",
  custom: "Tick exactly what you need",
}

export function exportOptions(access: { permissions: readonly string[]; superAdmin: boolean }): ExportOptions {
  const tiers = { view: holdsTier("view", access), contact: holdsTier("contact", access), full: holdsTier("full", access) }
  const presets = EXPORT_PRESETS.map((preset) => {
    const columns: readonly string[] = preset.columns
    return {
      key: preset.key,
      label: preset.label,
      description: DESCRIPTIONS[preset.key],
      tier: tierNeeded(preset.columns),
      choices: EXPORT_CHOICES.filter((choice) => choice.columns.every((column) => columns.includes(column))).map((choice) => choice.key),
      columns: preset.columns.length,
    }
  }).filter((preset) => tiers[preset.tier])
  return {
    presets,
    choices: EXPORT_CHOICES.map((choice) => ({ key: choice.key, label: choice.label, tier: choice.tier, columns: choice.columns.length })),
    tiers,
  }
}
