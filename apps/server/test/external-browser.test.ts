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
          <button class="unit-combobox" role="combobox">Search occupied unit...</button>
          <label for="_r_1o_-form-item">Visitor Name</label>
          <input id="_r_1o_-form-item" name="visitorName" />
          <form id="profile" hidden>
            <label for="name">Name</label>
            <input id="name" name="name" />
            <button data-testid="save-profile" type="submit">Save</button>
          </form>
          <section id="complete" class="complete" hidden>Completed</section>
          <script>
            document.querySelector('#open').addEventListener('click', () => {
              document.querySelector('#profile').hidden = false;
            });
            document.querySelector('#profile').addEventListener('submit', (event) => {
              event.preventDefault();
            });
            document.querySelector('.unit-combobox').addEventListener('click', () => {
              window.location.hash = 'unit-combobox-opened';
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

  it('serializes stable action controls and semantic elements in the dev runtime callback shape', async () => {
    const owner = new PlaywrightExternalBrowserOwner();
    const session = await owner.launchReplay({
      targetUrl,
      headless: true,
      timeoutMs: 10_000,
    });
    await session.navigate(targetUrl);

    await expect(
      session.findActionControl?.(
        { strategy: 'id', value: 'profile' },
        'submit',
      ),
    ).resolves.toEqual({
      strategy: 'data-testid',
      value: 'save-profile',
    });
    const semantic = await session.inspectSemanticElements?.();
    expect(
      semantic?.find(
        (item) =>
          item.locator.strategy === 'id' && item.locator.value === 'complete',
      ),
    ).toMatchObject({
      classification: 'success',
      visible: false,
    });
    await session.close();
  });

  it('does not record visible combobox text as a false accessible name', async () => {
    const events: unknown[] = [];
    const owner = new PlaywrightExternalBrowserOwner(async (page) => {
      await page.locator('.unit-combobox').click();
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

    const clickEvent = events.find(
      (event) =>
        typeof event === 'object' &&
        event !== null &&
        'kind' in event &&
        event.kind === 'click',
    );
    expect(clickEvent).toMatchObject({
      kind: 'click',
      locator: {
        strategy: 'text',
        value: 'Search occupied unit...',
      },
      fingerprint: {
        role: 'combobox',
        accessibleName: null,
        text: 'Search occupied unit...',
      },
    });
  });

  it('replays legacy role locators through exact explicit-role text', async () => {
    const owner = new PlaywrightExternalBrowserOwner();
    const session = await owner.launchReplay({
      targetUrl,
      headless: true,
      timeoutMs: 10_000,
    });
    await session.navigate(targetUrl);
    await session.click({
      strategy: 'role',
      role: 'combobox',
      name: 'Search occupied unit...',
    });

    expect(session.currentUrl()).toBe(`${targetUrl}/#unit-combobox-opened`);
    await session.close();
  });

  it('does not record React-generated IDs as stable replay locators', async () => {
    const events: unknown[] = [];
    const owner = new PlaywrightExternalBrowserOwner(async (page) => {
      await page.locator('[name="visitorName"]').fill('Ada');
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

    const fillEvent = events.find(
      (event) =>
        typeof event === 'object' &&
        event !== null &&
        'kind' in event &&
        event.kind === 'fill',
    );
    expect(fillEvent).toMatchObject({
      locator: {
        strategy: 'role',
        role: 'textbox',
        name: 'Visitor Name',
      },
      fingerprint: {
        id: null,
        name: 'visitorName',
      },
    });
  });
});
