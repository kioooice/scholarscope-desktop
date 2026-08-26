export function isPlaceholderAbstract(value?: string): boolean {
  const normalized = value?.trim().toLowerCase() ?? "";
  return !normalized || normalized.startsWith("no abstract") || normalized.includes("abstract was provided");
}
