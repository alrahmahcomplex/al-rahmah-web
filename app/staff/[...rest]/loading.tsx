// An unknown staff address goes straight to the staff 404. Without this, the
// Today skeleton (app/staff/loading.tsx, new look) would flash in the old
// shell first.
export default function Loading() {
  return null
}
