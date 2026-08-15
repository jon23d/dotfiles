/**
 * Strips backticks from a value that's about to be interpolated into a
 * backtick-quoted span of a reply. Without this, a value containing its own
 * backtick (e.g. a command name from `help \`x\``, or a session identifier)
 * would produce mismatched/nested backticks that render oddly as Mattermost
 * markdown (review kan3-1 F1). Shared by helpCommand.ts and listCommand.ts
 * so the sanitization rule has one definition to update (review kan4-1 F1).
 */
export function stripBackticks(value: string): string {
  return value.replace(/`/g, '');
}
