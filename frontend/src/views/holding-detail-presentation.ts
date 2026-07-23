export type HoldingDetailRouteQuery = Record<string, string> & { id: string; ids: string };

export function holdingDetailRouteQuery(id: string, ids: string[]): HoldingDetailRouteQuery {
  const ordered = [...new Set(ids)];
  return { id, ids: (ordered.includes(id) ? ordered : [id, ...ordered]).join(",") };
}

export function holdingNavigationTarget(ids: string[], currentId: string, offset: number): string | null {
  const index = ids.indexOf(currentId);
  return index < 0 ? null : ids[index + offset] ?? null;
}
