import { Input } from "@/components/ui/input"

// The date field, until #358 brings the kit's (see README.md): today's
// native date input, posting YYYY-MM-DD with its form.
export function DateField({ id, name, defaultValue }: { id: string; name: string; defaultValue: string }) {
  return <Input id={id} name={name} type="date" defaultValue={defaultValue} />
}
