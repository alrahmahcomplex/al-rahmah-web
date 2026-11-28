// The design system's parts, in the groups and order the Design system page
// shows them (design site, prototype v6). One list for the page, its sidebar
// sections, llms.txt and the MCP server, so they cannot drift apart. A part
// added to the kit gets its entry here and its card on the page
// (DESIGN.md, The Kit First Rule); tests/unit/design-site-catalog.test.ts
// fails when a kit file belongs to no part.

export type PartGroup =
  | "Foundations"
  | "Actions"
  | "Inputs"
  | "Forms and steps"
  | "Layout and lists"
  | "Feedback"
  | "Overlays"
  | "App parts"

export type Part = {
  /** The card's id on the page, and the part's name for the MCP server. */
  id: string
  /** The card's title. */
  title: string
  group: PartGroup
  /** One line on what it is for. */
  summary: string
  /** Its code, from the repository root. */
  files: readonly string[]
  /** The DESIGN.md sections (### headings) that hold its rules. */
  rules: readonly string[]
}

export const PART_GROUPS: readonly PartGroup[] = [
  "Foundations",
  "Actions",
  "Inputs",
  "Forms and steps",
  "Layout and lists",
  "Feedback",
  "Overlays",
  "App parts",
]

const KIT = (name: string) => `components/kit/${name}`
const FORM = (name: string) => `components/guided-form/${name}`

export const PARTS: readonly Part[] = [
  // Foundations
  { id: "colour", title: "Colour", group: "Foundations", summary: "Rahmah Indigo, Sunrise Orange, the lavenders, slate text and the status tints, as --gf-* tokens.", files: ["app/tokens.css"], rules: ["Primary", "Secondary", "Tertiary", "Neutral", "The page wash", "Named Rules"] },
  { id: "type", title: "Type", group: "Foundations", summary: "Exo, always italic, for headings, questions and actions; Geist for reading text and what people type.", files: ["app/tokens.css", "app/layout.tsx"], rules: ["Hierarchy"] },
  { id: "icons", title: "Icons", group: "Foundations", summary: "Set 1, two lines: indigo at rest, the detail orange in use. Never drawn in a page.", files: ["components/icons/icon.tsx", "components/icons/icons.css", "components/icons/registry.tsx", "components/icons/index.ts"], rules: ["Icons"] },
  { id: "illustrations", title: "Illustrations", group: "Foundations", summary: "Style C line drawings for empty, loading, working and error moments.", files: ["components/illustrations/illustration.tsx", "components/illustrations/illustrations.css", "components/illustrations/index.ts"], rules: ["Illustrations"] },

  // Actions
  { id: "buttons", title: "Buttons", group: "Actions", summary: "Go (the one orange next step), Ghost, Bad, Warn, Round and Text link, in small and wide sizes.", files: [KIT("button.tsx"), KIT("kit.css")], rules: ["Buttons"] },
  { id: "button-states", title: "Button states", group: "Actions", summary: "Pending, disabled and link buttons, round buttons at each size, and text links.", files: [KIT("button.tsx")], rules: ["Buttons"] },
  { id: "chip-buttons", title: "Chip buttons", group: "Actions", summary: "40px pills for many short options; pressed indigo.", files: [KIT("choices.tsx")], rules: ["Choices"] },

  // Inputs
  { id: "fields", title: "Fields", group: "Inputs", summary: "The 52px pill field, with an icon, an error line, and the named field.", files: [KIT("field.tsx"), KIT("kit.css")], rules: ["Inputs"] },
  { id: "compact-fields", title: "Compact and search fields", group: "Inputs", summary: "The 44px compact field and the 40px top-bar search.", files: [KIT("field.tsx")], rules: ["Inputs"] },
  { id: "password-field", title: "Password field", group: "Inputs", summary: "The pill field with the lock icon and a round eye button that shows and hides the password.", files: [KIT("password-field.tsx"), KIT("kit.css")], rules: ["Inputs"] },
  { id: "selectors", title: "Selectors", group: "Inputs", summary: "The default tile, segmented choices and choice rows.", files: [KIT("choices.tsx")], rules: ["Choices"] },
  { id: "class-picker", title: "Class picker", group: "Inputs", summary: "The class sheet's body: the levels on the sliding track, then the level's classes.", files: [KIT("class-picker.tsx")], rules: ["Choices"] },
  { id: "confirmation-number", title: "Confirmation number", group: "Inputs", summary: "Six boxes for an SMS code, with the right and wrong finish marks.", files: [FORM("confirmation-number.tsx"), FORM("confirmation-number.css")], rules: ["Inputs"] },
  { id: "last-name", title: "Last-name choice", group: "Inputs", summary: "Pick a last name from the family, or type another.", files: [FORM("controls.tsx")], rules: ["Guided form"] },
  { id: "type-ahead", title: "Type-ahead list: region and country", group: "Inputs", summary: "A searchable list for a region or a country.", files: [FORM("type-ahead-field.tsx"), FORM("type-ahead.ts")], rules: ["Guided form"] },
  { id: "two-choices", title: "Two big choices", group: "Inputs", summary: "Two large choice tiles side by side.", files: [FORM("controls.tsx")], rules: ["Choices"] },
  { id: "popover-list", title: "Choice list in a popover", group: "Inputs", summary: "A choice list inside a popover, and a plain filter form.", files: [KIT("popover.tsx"), KIT("select.tsx")], rules: ["Menus and popovers"] },
  { id: "names-codes", title: "Names and codes", group: "Inputs", summary: "Name boxes for a person, a student and a full name, and the code box with its hyphen.", files: [FORM("names.tsx")], rules: ["Inputs", "Guided form"] },
  { id: "form-parts", title: "Form parts on the student’s record", group: "Inputs", summary: "Tabs as links, the choice list, date and time fields, the calendar, checkboxes, switches, the text area, the file picker and fold-open sections.", files: [KIT("select.tsx"), KIT("date-field.tsx"), KIT("calendar.tsx"), KIT("dates.ts"), KIT("tick.tsx"), KIT("text-area.tsx"), KIT("file-picker.tsx"), KIT("disclosure.tsx"), KIT("tabs.tsx")], rules: ["Inputs", "Choices"] },

  // Forms and steps
  { id: "guided-form", title: "Guided form", group: "Forms and steps", summary: "One question at a time, answers folding into summary rows, ending on the finish mark.", files: [KIT("guided-task.tsx"), FORM("stack.tsx"), FORM("controls.tsx"), FORM("guided-form.css"), FORM("README.md")], rules: ["Guided form"] },
  { id: "stepper", title: "Stepper: chip bar", group: "Forms and steps", summary: "The progress bar: Back, groups of chips, and the section chip.", files: [FORM("progress-bar.tsx")], rules: ["Guided form"] },
  { id: "stepper-reset", title: "Stepper: Start over on the right", group: "Forms and steps", summary: "The chip bar with Start over at its right end.", files: [FORM("progress-bar.tsx")], rules: ["Guided form"] },
  { id: "answers-change", title: "Answers with Change", group: "Forms and steps", summary: "A key-value list whose rows each take a Change action.", files: [KIT("details.tsx")], rules: ["Lists"] },
  { id: "summary-rows", title: "Summary rows", group: "Forms and steps", summary: "Folded answers: the question small on top, Change on the right, the answer underneath.", files: [FORM("stack.tsx")], rules: ["Guided form"] },
  { id: "step-track", title: "Vertical step track", group: "Forms and steps", summary: "Done steps with a green check, the current step in orange, upcoming steps muted.", files: [KIT("step-track.tsx"), KIT("agents-parts.css")], rules: ["Lists"] },
  { id: "slider", title: "Slider: steps with labels", group: "Forms and steps", summary: "A range in fixed steps with a label under each.", files: [KIT("step-slider.tsx"), KIT("picked.css")], rules: ["Choices"] },
  { id: "sign-up-steps", title: "Sign-up steps", group: "Forms and steps", summary: "The agent sign-up's step discs and words.", files: [FORM("controls.tsx")], rules: ["Guided form"] },

  // Layout and lists
  { id: "page-header", title: "Page header", group: "Layout and lists", summary: "The page title, its subtitle and its actions.", files: [KIT("page-header.tsx"), KIT("page-title.ts")], rules: ["Cards"] },
  { id: "filter-table", title: "Filter pills and table", group: "Layout and lists", summary: "Status filter pills over a table whose rows open a record.", files: [KIT("filter-pills.tsx"), KIT("table.tsx")], rules: ["Lists"] },
  { id: "table", title: "Table", group: "Layout and lists", summary: "14px rows, quiet headings, money right-aligned.", files: [KIT("table.tsx")], rules: ["Lists"] },
  { id: "list-row", title: "List row", group: "Layout and lists", summary: "A row with an optional disc icon, a title over a caption, and a trailing chip or button.", files: [KIT("list-row.tsx")], rules: ["Lists"] },
  { id: "stat-card", title: "Stat card", group: "Layout and lists", summary: "A number card: icon and title, the big number, its trend and the card's graph.", files: [KIT("stat-card.tsx")], rules: ["Cards"] },
  { id: "tabs", title: "Tabs: sliding track", group: "Layout and lists", summary: "Sections of one record, one indigo pill sliding to the chosen tab.", files: [KIT("tabs.tsx"), KIT("picked.css")], rules: ["Choices"] },
  { id: "pagination", title: "Pagination: numbered pills", group: "Layout and lists", summary: "Page links for lists longer than ten rows.", files: [KIT("pagination.tsx"), KIT("picked.css")], rules: ["Lists"] },
  { id: "save-bar", title: "Save bar", group: "Layout and lists", summary: "A filling card whose content scrolls inside, with the save bar as its bottom edge while changes wait.", files: [KIT("save-bar.tsx")], rules: ["Cards"] },
  { id: "cards-chips", title: "Cards and chips", group: "Layout and lists", summary: "The white card with the thin line and soft shadow, with chips and notes inside.", files: [KIT("card.tsx"), KIT("bento.tsx")], rules: ["Cards"] },
  { id: "filter-menu", title: "Filter menu with counts", group: "Layout and lists", summary: "A round filter button opening a radio menu with counts.", files: [KIT("filter-menu.tsx"), KIT("agents-parts.css")], rules: ["Menus and popovers"] },
  { id: "link-rows", title: "Link-row list", group: "Layout and lists", summary: "Whole rows that are links, with a chevron.", files: [KIT("list-row.tsx")], rules: ["Lists"] },
  { id: "sections-kv", title: "Sections and key-value list", group: "Layout and lists", summary: "Sections inside a card or sheet, and the key-value grid.", files: [KIT("details.tsx")], rules: ["Lists"] },
  { id: "accordion", title: "Accordion: separate cards", group: "Layout and lists", summary: "Questions that fold open, each in its own card.", files: [KIT("accordion.tsx"), KIT("picked.css")], rules: ["Lists"] },
  { id: "timeline", title: "Timeline", group: "Layout and lists", summary: "What happened, newest first.", files: [KIT("timeline.tsx"), KIT("timeline.css")], rules: ["Lists"] },
  { id: "code-block", title: "Code block", group: "Layout and lists", summary: "A command or a few lines of settings, with a copy button.", files: [KIT("code-block.tsx"), KIT("kit.css")], rules: ["Cards"] },

  // Feedback
  { id: "chips", title: "Chips", group: "Feedback", summary: "Status chips for a lead's lifecycle, and tags.", files: [KIT("chips.tsx")], rules: ["Chips"] },
  { id: "note", title: "Note", group: "Feedback", summary: "A tinted box that says one thing and what to do about it.", files: [KIT("details.tsx")], rules: ["Notes"] },
  { id: "toast", title: "Toast", group: "Feedback", summary: "One sentence at the bottom after a save or a failure.", files: [KIT("toast.tsx")], rules: ["Toasts"] },
  { id: "tooltips", title: "Tooltips: light", group: "Feedback", summary: "A short name for an icon button, on hover and keyboard focus.", files: [KIT("tooltip.tsx"), KIT("picked.css")], rules: ["Menus and popovers"] },
  { id: "empty-state", title: "Empty state", group: "Feedback", summary: "An illustration, a title and a hint when a list has nothing.", files: [KIT("states.tsx")], rules: ["Empty"] },
  { id: "loading-state", title: "Loading state", group: "Feedback", summary: "A moving illustration while a page or a batch works.", files: [KIT("states.tsx")], rules: ["Loading"] },
  { id: "skeleton", title: "Skeleton", group: "Feedback", summary: "Grey blocks in the page's shape while it loads.", files: [KIT("states.tsx")], rules: ["Loading"] },
  { id: "finish", title: "Finish", group: "Feedback", summary: "The finish mark and its confetti.", files: [KIT("states.tsx"), KIT("confetti.ts")], rules: ["Finished", "Confetti"] },
  { id: "task-finished", title: "Task card and finished state", group: "Feedback", summary: "The one lifted card that holds the task, and how it ends.", files: [KIT("card.tsx"), KIT("states.tsx")], rules: ["Cards", "Finished"] },

  // Overlays
  { id: "sheet", title: "Sheet", group: "Overlays", summary: "A sheet from the bottom or the centre, with its head, body and foot.", files: [KIT("sheet.tsx")], rules: ["Sheets and dialogs"] },
  { id: "side-sheet", title: "Side sheet", group: "Overlays", summary: "A record in a sheet from the right, with inline editors.", files: [KIT("sheet.tsx")], rules: ["Sheets and dialogs"] },
  { id: "popover", title: "Popover", group: "Overlays", summary: "A small panel opening from its button's corner.", files: [KIT("popover.tsx")], rules: ["Menus and popovers"] },
  { id: "profile-row", title: "Menu profile row and profile sheet", group: "Overlays", summary: "The profile row in a menu and the sheet it opens.", files: [KIT("menu-profile-row.tsx"), KIT("agents-parts.css")], rules: ["Menus and popovers"] },

  // App parts
  { id: "shell", title: "Shell: frame, top bar and sidebar", group: "App parts", summary: "Every site's frame: the top bar in the white frame, the sidebar (open, folded to icons, a drawer on a phone) with a page's sections under its row, and the outlined stage holding the page.", files: ["app/staff/_new-shell/new-shell.tsx", "app/staff/_new-shell/new-shell.css", "app/staff/_new-shell/sidebar.tsx", "app/staff/_new-shell/sidebar-sections.tsx", "app/staff/_new-shell/top-bar-parts.tsx"], rules: ["The staff shell (desktop, from 861px)", "The sidebar", "The staff shell on a phone or small tablet (up to 860px)"] },
  { id: "avatars", title: "Avatars: soft tints", group: "App parts", summary: "Initials in soft tints, alone or stacked with a count.", files: [KIT("avatar.tsx"), KIT("picked.css")], rules: ["Top bar parts"] },
  { id: "code-chip", title: "Code chip with copy", group: "App parts", summary: "A Discount code in an outlined pill with a copy button.", files: [KIT("code-chip.tsx"), KIT("agents-parts.css")], rules: ["Chips"] },
  { id: "top-bar-swap", title: "Top bar logo and back swap", group: "App parts", summary: "The round logo on Home, a Back button everywhere else.", files: [KIT("top-bar-home-or-back.tsx")], rules: ["Top bar parts"] },
]

export function partsIn(group: PartGroup): Part[] {
  return PARTS.filter((part) => part.group === group)
}

export function findPart(id: string): Part | undefined {
  const wanted = id.trim().toLowerCase()
  return PARTS.find((part) => part.id === wanted || part.title.toLowerCase() === wanted)
}
