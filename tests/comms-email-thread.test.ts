import { describe, expect, test } from 'vitest';
import {
  findEmailAttachments,
  htmlEmailToText,
  replySubject,
  selectReadablePart,
  threadReferences,
} from '@/lib/email-thread';
import type { MessageStructureObject } from 'imapflow';

describe('email thread helpers', () => {
  test('replySubject keeps an existing reply prefix and adds one otherwise', () => {
    expect(replySubject('Quarterly plan')).toBe('Re: Quarterly plan');
    expect(replySubject('RE: Quarterly plan')).toBe('RE: Quarterly plan');
    expect(replySubject('')).toBe('Re: (no subject)');
  });

  test('threadReferences deduplicates the chain and appends the direct parent', () => {
    expect(threadReferences(['<a@x>', '<b@x>', '<a@x>'], '<c@x>')).toEqual(['<a@x>', '<b@x>', '<c@x>']);
    expect(threadReferences([], undefined)).toEqual([]);
  });

  test('converts HTML email to readable text without scripts, styles, or tags', () => {
    const html = '<style>.x{color:red}</style><p>Hello&nbsp;<strong>Dave</strong></p><script>alert(1)</script><div>Line &amp; two</div>';
    expect(htmlEmailToText(html)).toBe('Hello Dave\n\nLine & two');
  });

  test('prefers a text/plain body and exposes attachments separately', () => {
    const structure: MessageStructureObject = {
      type: 'multipart/mixed',
      childNodes: [
        {
          type: 'multipart/alternative',
          childNodes: [
            { type: 'text/html', part: '1.1' },
            { type: 'text/plain', part: '1.2' },
          ],
        },
        {
          type: 'application/pdf',
          part: '2',
          size: 1200,
          disposition: 'attachment',
          dispositionParameters: { filename: 'proposal.pdf' },
        },
      ],
    };

    expect(selectReadablePart(structure)).toEqual({ part: '1.2', html: false });
    expect(findEmailAttachments(structure)).toEqual([
      { part: '2', filename: 'proposal.pdf', contentType: 'application/pdf', size: 1200 },
    ]);
  });
});
