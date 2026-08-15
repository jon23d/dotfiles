import { describe, expect, it } from 'vitest';
import { commandRegistry } from './commands.js';

describe('commandRegistry', () => {
  it('registers `help` with a non-empty one-line summary', () => {
    const help = commandRegistry.find((command) => command.name === 'help');

    expect(help).toBeDefined();
    expect(help?.summary.length).toBeGreaterThan(0);
  });

  it('has no duplicate command names', () => {
    const names = commandRegistry.map((command) => command.name);

    expect(new Set(names).size).toBe(names.length);
  });

  it('registers every command name in lowercase, so lookups can rely on a single case', () => {
    for (const command of commandRegistry) {
      expect(command.name).toBe(command.name.toLowerCase());
    }
  });
});
