import { describe, it, expect } from 'vitest'
import { parseCsv } from '../src/lib/sheets.js'
describe('timetable CSV reader', () => {
  it('reads quoted cells, commas, quotes and CRLF', () => {
    expect(parseCsv('Division,Day,Subject\r\nD2A,Monday,"M1, tutorial"\nD2B,"Tue","He said ""hi"""\n')).toEqual([['Division', 'Day', 'Subject'], ['D2A', 'Monday', 'M1, tutorial'], ['D2B', 'Tue', 'He said "hi"']])
  })
  it('strips a byte-order mark and keeps the last row without newline', () => {
    expect(parseCsv('﻿a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']])
  })
})
