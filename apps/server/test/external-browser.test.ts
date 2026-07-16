import { once } from 'node:events';
import { createServer, type Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';

import {
  buildBrowserRecorderInitScript,
  PlaywrightExternalBrowserOwner,
} from '../src/runner/recording/external-browser.js';

let server: Server;
let targetUrl: string;

beforeAll(async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html>
      <html>
        <body>
          <button id="open">Open form</button>
          <form id="profile" hidden>
            <label for="name">Name</label>
            <input id="name" name="name" />
            <button type="submit">Save</button>
          </form>
          <script>
            document.querySelector('#open').addEventListener('click', () => {
              document.querySelector('#profile').hidden = false;
            });
            document.querySelector('#profile').addEventListener('submit', (event) => {
              event.preventDefault();
            });
          </script>
        </body>
      </html>`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Recorder fixture did not bind.');
  }
  targetUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('external browser recorder injection', () => {
  it('provides the build helper required by tsx-serialized functions', async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.addInitScript({
      content: buildBrowserRecorderInitScript(`function recorder() {
        const result = __name(() => 42, "result");
        globalThis.__recorderHelperResult = result();
      }`),
    });
    const page = await context.newPage();
    await page.goto(targetUrl);

    expect(
      await page.evaluate<number>('globalThis.__recorderHelperResult'),
    ).toBe(42);
    await context.close();
    await browser.close();
  });

  it('captures click, fill, and submit events in a real browser', async () => {
    const events: unknown[] = [];
    const owner = new PlaywrightExternalBrowserOwner(async (page) => {
      await page.locator('#open').click();
      await page.locator('#name').fill('Ada');
      await page.locator('#profile button[type="submit"]').click();
    });
    const session = await owner.launchRecording(
      { targetUrl, headless: true, timeoutMs: 10_000 },
      {
        onEvent: (event) => events.push(event),
        onWarning: () => undefined,
        onNavigation: () => undefined,
      },
    );
    await session.close();

    expect(
      events.map((event) =>
        typeof event === 'object' && event !== null && 'kind' in event
          ? event.kind
          : null,
      ),
    ).toEqual(['click', 'fill', 'submit']);
  });
});
