import { expect, test } from '@playwright/test'

test('privacy entry and proof worker load without Node-only imports', async ({
  page,
}) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (
      message.type() === 'error' ||
      /externalized for browser/.test(message.text())
    ) {
      browserErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))

  await page.goto('/test/browser/')
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __privacyResult?: { ok: boolean } })
            .__privacyResult,
      ),
    )
    .toMatchObject({ ok: true })
  const result = await page.evaluate(
    () =>
      (
        window as unknown as {
          __privacyResult: {
            envelopeBytes: number
            framedBytes: number
            hftCalldata: string
            hftBatch: string
          }
        }
      ).__privacyResult,
  )
  expect(result.envelopeBytes).toBe(169)
  expect(result.framedBytes).toBeGreaterThan(32)
  expect(result.hftCalldata.slice(0, 10)).toBe('0x881c51de')
  expect(result.hftBatch).toBe(
    `0x44584132020000000001000005000038${'01'.repeat(16)}${'11'.repeat(32)}00070000`,
  )
  expect(browserErrors).toEqual([])
})
