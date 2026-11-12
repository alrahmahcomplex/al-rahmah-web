// A field's label on the Fee schedule forms. The visible label can be shorter
// than the accessible one where the group's heading already says the rest.
export function FieldLabel({ htmlFor, label, shortLabel }: { htmlFor: string; label: string; shortLabel?: string }) {
  return (
    <label htmlFor={htmlFor} className="fs-label">
      {shortLabel ? (
        <>
          <span aria-hidden>{shortLabel}</span>
          <span className="sr-only">{label}</span>
        </>
      ) : (
        label
      )}
    </label>
  )
}
