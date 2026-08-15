import { describe, expect, it } from 'vitest';
import { renderCommandDetail, renderCommandList } from './helpCommand.js';
import type { CommandDefinition } from './commands.js';

const commands: CommandDefinition[] = [
  { name: 'help', summary: 'Lists commands, or shows detailed usage for one.', usage: 'help [command]' },
  { name: 'list', summary: 'Lists running agent sessions.' }, // no `usage` yet -- KAN-4 not implemented
];

describe('renderCommandList', () => {
  it('includes every registered command with its one-line summary', () => {
    const output = renderCommandList(commands);

    expect(output).toContain('`help` - Lists commands, or shows detailed usage for one.');
    expect(output).toContain('`list` - Lists running agent sessions.');
  });

  it('picks up a newly registered command automatically -- the list is not hand-maintained', () => {
    const extended = [...commands, { name: 'stop', summary: 'Stops a running agent session.' }];

    expect(renderCommandList(extended)).toContain('`stop` - Stops a running agent session.');
  });
});

describe('renderCommandDetail', () => {
  it("returns the command's detailed usage when it has one", () => {
    expect(renderCommandDetail(commands, 'help')).toBe('help [command]');
  });

  it('returns a clear note (never an error) when a known command has no detailed usage yet', () => {
    expect(renderCommandDetail(commands, 'list')).toBe('No detailed help available yet for `list`.');
  });

  it('returns a clear note (never an error) for a name not in the registry at all', () => {
    expect(renderCommandDetail(commands, 'bogus')).toBe('No help available for `bogus`.');
  });

  it('strips backticks from an unrecognized command name so it cannot break the reply\'s markdown span', () => {
    expect(renderCommandDetail(commands, 'a`b`c')).toBe('No help available for `abc`.');
  });

  it('strips backticks from the command name in the "no detailed help yet" reply too', () => {
    const commandsWithBacktickInName: CommandDefinition[] = [
      { name: 'li`st', summary: 'Defensive case: a registry name that itself contains a backtick.' },
    ];

    expect(renderCommandDetail(commandsWithBacktickInName, 'li`st')).toBe('No detailed help available yet for `list`.');
  });
});
