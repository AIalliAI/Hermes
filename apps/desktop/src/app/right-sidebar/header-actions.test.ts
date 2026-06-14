import { describe, expect, it } from 'vitest'

import { HEADER_ACTION_LABEL_REVEAL } from './header-actions'

describe('HEADER_ACTION_LABEL_REVEAL', () => {
  it('keeps the refresh button visible and interactive on self hover', () => {
    expect(HEADER_ACTION_LABEL_REVEAL).toContain('hover:pointer-events-auto')
    expect(HEADER_ACTION_LABEL_REVEAL).toContain('hover:opacity-100')
    expect(HEADER_ACTION_LABEL_REVEAL).toContain('peer-hover/project-label:pointer-events-auto')
    expect(HEADER_ACTION_LABEL_REVEAL).toContain('peer-hover/project-label:opacity-100')
  })
})
