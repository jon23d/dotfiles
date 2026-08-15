import { stripBackticks } from './markdown.js';
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
