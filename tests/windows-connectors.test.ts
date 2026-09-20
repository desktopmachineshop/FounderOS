import { describe, expect, it } from 'vitest';
import { wisprDbPath } from '@/lib/connectors/wispr';
import { whatsappSupported, whatsappUnsupportedDetail } from '@/lib/connectors/whatsapp';

/**
 * These connectors read local application data, and every one of them was
 * written against the previous operator's Mac — hardcoded `~/Library` paths
 * with no override. On the Windows workstation they cannot resolve, and the
 * failure reads as "not installed" rather than "this connector assumes macOS".
 *
 * The fix is not to guess Windows paths for apps whose storage layout is not
 * verified here. It is to make the location configurable, and to be explicit
 * when a connector genuinely does not support the platform.
 */
describe('wisprDbPath', () => {
  it('an explicit WISPR_DB always wins, on any platform', () => {
    expect(wisprDbPath({ WISPR_DB: 'D:\\Wispr\\flow.sqlite' }, 'win32')).toBe('D:\\Wispr\\flow.sqlite');
    expect(wisprDbPath({ WISPR_DB: '/somewhere/flow.sqlite' }, 'darwin')).toBe('/somewhere/flow.sqlite');
  });

  it('falls back to the known macOS location on a Mac', () => {
    const p = wisprDbPath({ HOME: '/Users/dave' }, 'darwin');
    expect(p).toContain('Library');
    expect(p).toContain('Wispr Flow');
    expect(p?.endsWith('flow.sqlite')).toBe(true);
  });

  /**
   * Deliberately null rather than a guessed `%APPDATA%` path: this repo has not
   * verified where Wispr Flow stores its database on Windows, and a wrong
   * default would report "not installed" for an app that is installed.
   */
  it('has no default off macOS — the operator points it at the file', () => {
    expect(wisprDbPath({}, 'win32')).toBeNull();
    expect(wisprDbPath({}, 'linux')).toBeNull();
  });

  it('an empty override is not treated as a path', () => {
    expect(wisprDbPath({ WISPR_DB: '   ' }, 'win32')).toBeNull();
  });
});

describe('whatsapp platform support', () => {
  /**
   * WhatsApp Desktop on Windows does not keep a readable ChatStorage.sqlite in
   * a macOS-style group container. Reporting "not configured" there implies a
   * setup step that does not exist.
   */
  it('is macOS-only', () => {
    expect(whatsappSupported('darwin')).toBe(true);
    expect(whatsappSupported('win32')).toBe(false);
    expect(whatsappSupported('linux')).toBe(false);
  });

  it('says it is the platform, not a missing credential', () => {
    const detail = whatsappUnsupportedDetail('win32');
    expect(detail.toLowerCase()).toContain('macos');
    expect(detail).not.toMatch(/not configured|set .*_KEY/i);
  });
});
