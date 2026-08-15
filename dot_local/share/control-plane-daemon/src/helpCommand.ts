import type { CommandDefinition } from './commands.js';

/**
 * Renders the full command list for `help` with no arguments: every
 * registered command with its one-line summary. Takes the registry as a
 * parameter (rather than importing it directly) so this stays a pure,
 * easily-tested function -- and so a future registry entry is picked up
 * automatically without touching this file.
 */
export function renderCommandList(commands: readonly CommandDefinition[]): string {
  const lines = commands.map((command) => `\`${command.name}\` - ${command.summary}`);
  return ['Available commands:', ...lines].join('\n');
}

/**
 * Strips backticks from a value that's about to be interpolated into a
 * backtick-quoted span of a reply. Without this, a command name containing
 * its own backtick (e.g. `` `x` ``, from `help \`x\``) would produce
 * mismatched/nested backticks that render oddly as Mattermost markdown
 * (review kan3-1 F1).
 */
function stripBackticks(value: string): string {
  return value.replace(/`/g, '');
}

/**
 * Renders detailed help for `help <command>`. Never throws and never
 * returns an error for bad input -- an unrecognized command name, or a
 * registered command that hasn't documented detailed usage yet, both get a
 * clear plain-English note instead (KAN-3 AC).
 */
export function renderCommandDetail(commands: readonly CommandDefinition[], commandName: string): string {
  const found = commands.find((command) => command.name === commandName);
  const safeName = stripBackticks(commandName);
  if (!found) {
    return `No help available for \`${safeName}\`.`;
  }
  if (!found.usage) {
    return `No detailed help available yet for \`${safeName}\`.`;
  }
  return found.usage;
}
