// Concept C's guided form primitives. See README.md for usage.
export { BottomSheet, trapTab, type BottomSheetProps } from "./bottom-sheet"
export { codeKey, completeCode, filterCodeOptions, sortCodeOptions, type CodeOption } from "./code-list"
export { CodePicker, type CodePickerProps } from "./code-picker"
export { Confetti } from "./confetti"
export {
  ConfirmationNumber,
  type ConfirmationNumberHandle,
  type ConfirmationNumberProps,
  type ConfirmationResult,
} from "./confirmation-number"
export {
  CallOffice,
  ChangeLink,
  ChoiceTiles,
  ContinuePill,
  DefaultTile,
  FieldError,
  FieldInput,
  Hint,
  InfoButton,
  LiveCountPill,
  NoticeBox,
  OfferNote,
  OfferPill,
  PriceAnchor,
  QuestionTitle,
  StepIcon,
  type ChoiceOption,
  type ChoiceTilesProps,
  type ContinuePillProps,
  type FieldInputProps,
  type PriceAnchorProps,
} from "./controls"
export { Icon, type IconName } from "./icons"
export {
  AgentCodeBox,
  CapitalsBox,
  CodeBox,
  FatherNameBoxes,
  FullNameBox,
  LastNameChoice,
  PersonNameBoxes,
  StudentNameBoxes,
  type FatherName,
  type LastNameLabels,
  type NameLabels,
  type PersonName,
  type StudentName,
} from "./names"
export { Reveal, SwitchRow } from "./switch-row"
export { AGENT_CODE_PATTERN, cleanName, formatAgentCode, formatCode, hasTwoNames, typeInNameBox } from "./typing"
export { buzz, foldMs, prefersReducedMotion } from "./motion"
export { ProgressBar, type ProgressBarLabels, type ProgressBarProps, type ProgressGroup } from "./progress-bar"
export { GuidedHead, GuidedNote, GuidedStack, GuidedStep, revealStep, SummaryRow, type GuidedStepProps, type StepState } from "./stack"
export { keepInView, useKeepFocusInView } from "./keep-in-view"
export { TypeAheadField, type TypeAheadFieldProps, type TypeAheadLabels } from "./type-ahead-field"
export { completion, exactly, restOf, search, startsWith, takesCompletion, type TypeAheadOption } from "./type-ahead"
