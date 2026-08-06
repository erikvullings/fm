import { describe, expect, it } from 'vitest';

import {
  canApplyRenamePlan,
  EMPTY_MULTI_RENAME_RULES,
  type MultiRenameRules,
  proposeRenames,
  type RenameTarget,
  validateSearchPattern,
} from './multi-rename-rules';

function target(id: string, name: string): RenameTarget {
  return { id, name };
}

function rules(overrides: Partial<MultiRenameRules> = {}): MultiRenameRules {
  return { ...EMPTY_MULTI_RENAME_RULES, ...overrides };
}

describe('validateSearchPattern', () => {
  it('accepts a plain search string regardless of the regex flag', () => {
    expect(validateSearchPattern('abc', false)).toBeUndefined();
    expect(validateSearchPattern('abc', true)).toBeUndefined();
  });

  it('accepts a valid regex pattern', () => {
    expect(validateSearchPattern('^[0-9]+$', true)).toBeUndefined();
  });

  it('reports an error for an invalid regex pattern', () => {
    expect(validateSearchPattern('(unterminated', true)).toBeDefined();
  });

  it('ignores an empty pattern', () => {
    expect(validateSearchPattern('', true)).toBeUndefined();
  });
});

describe('proposeRenames: search & replace', () => {
  it('leaves names unchanged when no rules are active', () => {
    const entries = [target('1', 'alpha.txt'), target('2', 'beta.txt')];
    const proposals = proposeRenames(entries, rules(), new Set());
    expect(proposals.map((p) => p.newName)).toEqual(['alpha.txt', 'beta.txt']);
    expect(proposals.every((p) => !p.changed)).toBe(true);
  });

  it('replaces a plain substring in the stem, preserving the extension', () => {
    const entries = [target('1', 'holiday-photo.jpg')];
    const proposals = proposeRenames(
      entries,
      rules({ search: 'holiday', replace: 'vacation' }),
      new Set(),
    );
    expect(proposals[0]?.newName).toBe('vacation-photo.jpg');
    expect(proposals[0]?.changed).toBe(true);
  });

  it('replaces every occurrence, not just the first', () => {
    const entries = [target('1', 'aa-aa.txt')];
    const proposals = proposeRenames(entries, rules({ search: 'aa', replace: 'b' }), new Set());
    expect(proposals[0]?.newName).toBe('b-b.txt');
  });

  it('supports regex search and replace with capture groups', () => {
    const entries = [target('1', 'img0001.png')];
    const proposals = proposeRenames(
      entries,
      rules({ search: '(\\d+)', replace: '#$1', useRegex: true }),
      new Set(),
    );
    expect(proposals[0]?.newName).toBe('img#0001.png');
  });

  it('treats search text literally (not as regex) when useRegex is false', () => {
    const entries = [target('1', 'a.b.c.txt')];
    const proposals = proposeRenames(entries, rules({ search: '.', replace: '_' }), new Set());
    // A literal '.' should only match literal dots in the stem, not "any character".
    expect(proposals[0]?.newName).toBe('a_b_c.txt');
  });

  it('leaves names unchanged and does not throw for an invalid regex', () => {
    const entries = [target('1', 'alpha.txt')];
    const proposals = proposeRenames(
      entries,
      rules({ search: '(unterminated', replace: 'x', useRegex: true }),
      new Set(),
    );
    expect(proposals[0]?.newName).toBe('alpha.txt');
    expect(proposals[0]?.changed).toBe(false);
  });
});

describe('proposeRenames: prefix & suffix', () => {
  it('adds a prefix before the stem', () => {
    const entries = [target('1', 'report.pdf')];
    const proposals = proposeRenames(entries, rules({ prefix: 'final-' }), new Set());
    expect(proposals[0]?.newName).toBe('final-report.pdf');
  });

  it('adds a suffix after the stem, before the extension', () => {
    const entries = [target('1', 'report.pdf')];
    const proposals = proposeRenames(entries, rules({ suffix: '-v2' }), new Set());
    expect(proposals[0]?.newName).toBe('report-v2.pdf');
  });

  it('combines prefix and suffix', () => {
    const entries = [target('1', 'report.pdf')];
    const proposals = proposeRenames(entries, rules({ prefix: 'a-', suffix: '-b' }), new Set());
    expect(proposals[0]?.newName).toBe('a-report-b.pdf');
  });
});

describe('proposeRenames: sequence numbering', () => {
  it('appends a padded sequence number per entry, in order', () => {
    const entries = [target('1', 'a.txt'), target('2', 'b.txt'), target('3', 'c.txt')];
    const proposals = proposeRenames(
      entries,
      rules({ suffix: '', sequence: { start: 1, step: 1, padding: 3 } }),
      new Set(),
    );
    expect(proposals.map((p) => p.newName)).toEqual(['a001.txt', 'b002.txt', 'c003.txt']);
  });

  it('honors a custom start and step', () => {
    const entries = [target('1', 'a.txt'), target('2', 'b.txt')];
    const proposals = proposeRenames(
      entries,
      rules({ sequence: { start: 10, step: 5, padding: 1 } }),
      new Set(),
    );
    expect(proposals.map((p) => p.newName)).toEqual(['a10.txt', 'b15.txt']);
  });
});

describe('proposeRenames: case transformation', () => {
  it('upper-cases the whole name including extension', () => {
    const entries = [target('1', 'report.pdf')];
    const proposals = proposeRenames(entries, rules({ caseTransform: 'upper' }), new Set());
    expect(proposals[0]?.newName).toBe('REPORT.PDF');
  });

  it('lower-cases the whole name', () => {
    const entries = [target('1', 'REPORT.PDF')];
    const proposals = proposeRenames(entries, rules({ caseTransform: 'lower' }), new Set());
    expect(proposals[0]?.newName).toBe('report.pdf');
  });

  it('title-cases each word', () => {
    const entries = [target('1', 'my holiday photo.jpg')];
    const proposals = proposeRenames(entries, rules({ caseTransform: 'title' }), new Set());
    expect(proposals[0]?.newName).toBe('My Holiday Photo.jpg');
  });
});

describe('proposeRenames: collision detection', () => {
  it('flags two selected entries that would collide with each other', () => {
    const collide = proposeRenames(
      [target('1', 'x1.txt'), target('2', 'x2.txt')],
      rules({ search: 'x[12]', replace: 'same', useRegex: true }),
      new Set(),
    );
    expect(collide[0]?.newName).toBe('same.txt');
    expect(collide[1]?.newName).toBe('same.txt');
    expect(collide[0]?.collision).toBe('plan');
    expect(collide[1]?.collision).toBe('plan');
  });

  it('flags an entry that would collide with an existing sibling file', () => {
    const entries = [target('1', 'a.txt')];
    const proposals = proposeRenames(
      entries,
      rules({ prefix: 'existing-', search: 'a', replace: '' }),
      new Set(['existing-.txt']),
    );
    expect(proposals[0]?.newName).toBe('existing-.txt');
    expect(proposals[0]?.collision).toBe('existing');
  });

  it('does not flag a case-only rename of an entry against its own original name', () => {
    // existingSiblingNames excludes the entries being renamed themselves, so a case-only
    // self-rename must not be treated as a collision.
    const entries = [target('1', 'Report.txt')];
    const proposals = proposeRenames(entries, rules({ caseTransform: 'lower' }), new Set());
    expect(proposals[0]?.newName).toBe('report.txt');
    expect(proposals[0]?.collision).toBeUndefined();
    expect(proposals[0]?.changed).toBe(true);
  });

  it('is case-insensitive when comparing against existing sibling names', () => {
    const entries = [target('1', 'a.txt')];
    const proposals = proposeRenames(
      entries,
      rules({ search: 'a', replace: 'B' }),
      new Set(['b.txt']),
    );
    expect(proposals[0]?.collision).toBe('existing');
  });
});

describe('proposeRenames: invalid name detection', () => {
  it('flags a proposed name that is invalid on the target platform', () => {
    const entries = [target('1', 'a.txt')];
    const proposals = proposeRenames(
      entries,
      rules({ search: 'a', replace: 'bad/name' }),
      new Set(),
    );
    expect(proposals[0]?.newName).toBe('bad/name.txt');
    expect(proposals[0]?.invalidNameReason).toBeDefined();
  });
});

describe('canApplyRenamePlan', () => {
  it('is false when nothing changed', () => {
    const entries = [target('1', 'a.txt')];
    const proposals = proposeRenames(entries, rules(), new Set());
    expect(canApplyRenamePlan(proposals)).toBe(false);
  });

  it('is true when at least one entry changed and nothing is invalid or colliding', () => {
    const entries = [target('1', 'a.txt')];
    const proposals = proposeRenames(entries, rules({ prefix: 'new-' }), new Set());
    expect(canApplyRenamePlan(proposals)).toBe(true);
  });

  it('is false when any changed entry has a collision', () => {
    const collide = proposeRenames(
      [target('1', 'x1.txt'), target('2', 'x2.txt')],
      rules({ search: 'x[12]', replace: 'same', useRegex: true }),
      new Set(),
    );
    expect(canApplyRenamePlan(collide)).toBe(false);
  });

  it('is false when any changed entry has an invalid name', () => {
    const entries = [target('1', 'a.txt')];
    const proposals = proposeRenames(
      entries,
      rules({ search: 'a', replace: 'bad/name' }),
      new Set(),
    );
    expect(canApplyRenamePlan(proposals)).toBe(false);
  });
});
