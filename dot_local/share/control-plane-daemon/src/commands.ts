/**
 * The command registry (KAN-3). Each real command the daemon supports gets
 * one entry here: a name, a one-line summary for the `help` list, and
 * optionally a longer `usage` string for `help <command>`.
 *
 * This is the single source of truth `help` reads from -- adding a command
 * in a follow-up ticket (KAN-4/5/6: `list`, `start`, `stop`) means adding an
 * entry here, and `help` picks it up automatically. Nothing about the help
 * text is hand-maintained anywhere else.
 */
export interface CommandDefinition {
  readonly name: string;
  readonly summary: string;
  readonly usage?: string;
}

export const commandRegistry: readonly CommandDefinition[] = [
  {
    name: 'help',
    summary: 'List available commands, or show detailed usage for one.',
    usage:
      'help [command]\n\n' +
      'With no arguments, lists every available command with a one-line description.\n' +
      'With a command name (e.g. `help help`), shows that command\'s detailed usage.',
  },
  {
    name: 'list',
    summary: 'List known agent sessions on this VM, running ones first.',
    usage:
      'list\n\n' +
      'Shows every agent session the daemon knows about, with running sessions listed above stopped ones. ' +
      'Each entry shows its identifier (`#<n> : <hostName>`, or its renamed ticket identifier) and which ' +
      'harness/folder it is using.\n\n' +
      'Replies with a clear “no sessions” message if none exist yet.',
  },
  {
    name: 'start',
    summary: 'Start a new agent session in a harness and folder, opening its own dedicated chat.',
    usage:
      'start <harness> <folder>\n\n' +
      'Spins up a new agent session using <harness> (currently only `opencode` is implemented; ' +
      '`claude-code` is a recognized but not-yet-supported choice) rooted at <folder>, and opens a new ' +
      'private Mattermost channel dedicated to that session, named `#<n> : <hostName>` where `<n>` ' +
      'increments from the last-used session number.\n\n' +
      'With no arguments (or a missing folder), replies asking for the harness and folder instead of ' +
      'guessing.\n\n' +
      'Example: `start opencode /home/jon/my-project`\n\n' +
      'If the harness or folder is invalid/inaccessible, or the session channel can\'t be created, replies ' +
      'with a clear error and creates nothing.',
  },
];
