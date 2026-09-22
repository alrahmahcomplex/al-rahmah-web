export type Result<T, E extends string> = { ok: true; data: T } | { ok: false; error: E }
