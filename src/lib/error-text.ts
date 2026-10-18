/** The message to show for a failed request: the Hub's own words when it sent some, else a plain retry. */
export function errorText(error: unknown, fallback = "Please try again."): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
