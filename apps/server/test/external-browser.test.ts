import { once } from 'node:events';
import { createServer, type Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Page } from 'playwright';
import { recordedInteractionSchema } from '@formcrash/contracts';

import {
  buildBrowserRecorderInitScript,
  buildOutcomeSelectorInitScript,
  PlaywrightExternalBrowserOwner,
} from '../src/runner/recording/external-browser.js';
import { executeRecordedStep } from '../src/runner/external/journey-actions.js';

let server: Server;
let targetUrl: string;

beforeAll(async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html>
      <html>
        <style>
          @keyframes transient-option-shift {
            from { transform: translateX(0); }
            to { transform: translateX(2px); }
          }
          #transient-option-container button {
            animation: transient-option-shift 20ms infinite alternate;
          }
          #overlapped-parking {
            display: block;
            position: absolute;
            top: 550px;
            left: 20px;
            width: 220px;
            height: 40px;
          }
          #overlapping-sign-out {
            position: fixed;
            z-index: 10;
            left: 0;
            bottom: 0;
            width: 280px;
            height: 100px;
          }
          body { min-height: 1400px; }
        </style>
        <body>
          <button id="open">Open form</button>
          <button id="building-switcher" type="button"><span>test building 2</span></button>
          <span class="current-building">test building 2</span>
          <output id="building-switch-count">0</output>
          <button class="unit-combobox" role="combobox">Search occupied unit...</button>
          <div id="transient-option-container"></div>
          <output id="selected-unit"></output>
          <a id="overlapped-parking" href="#parking-opened">Parking</a>
          <button id="overlapping-sign-out" type="button">Sign Out</button>
          <output id="sign-out-clicks">0</output>
          <label for="_r_1o_-form-item">Visitor Name</label>
          <input id="_r_1o_-form-item" name="visitorName" />
          <label for="secret">Password</label>
          <input id="secret" name="password" type="password" />
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
            document.querySelector('#building-switcher').addEventListener('click', () => {
              const output = document.querySelector('#building-switch-count');
              output.textContent = String(Number(output.textContent) + 1);
            });
            document.querySelector('#profile').addEventListener('submit', (event) => {
              event.preventDefault();
            });
            document.querySelector('.unit-combobox').addEventListener('click', () => {
              window.location.hash = 'unit-combobox-opened';
            });
            document.querySelector('#overlapping-sign-out').addEventListener('click', () => {
              const output = document.querySelector('#sign-out-clicks');
              output.textContent = String(Number(output.textContent) + 1);
            });
            const installTransientOption = (button) => {
              button.addEventListener('click', () => {
                document.querySelector('#selected-unit').textContent = 'TT-101';
              });
            };
            const transientOption = document.createElement('button');
            transientOption.type = 'button';
            transientOption.textContent = 'TT-101AvailableFloor 1';
            installTransientOption(transientOption);
            document.querySelector('#transient-option-container').append(transientOption);
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
  it('restores the recorded browser environment during replay', async () => {
    let page: Page | null = null;
    const owner = new PlaywrightExternalBrowserOwner(undefined, (created) => {
      page = created;
    });
    const session = await owner.launchReplay({
      targetUrl,
      headless: true,
      timeoutMs: 10_000,
      environment: {
        viewportWidth: 1234,
        viewportHeight: 777,
        deviceScaleFactor: 1.25,
        locale: 'en-GB',
        timezoneId: 'Asia/Karachi',
        userAgent: 'FormCrash recorded environment test',
        colorScheme: 'dark',
        browserName: 'chromium',
        browserVersion: 'test-version',
      },
    });
    await session.navigate(targetUrl);
    if (page === null) throw new Error('Replay page was not exposed.');

    await expect(
      (page as Page).evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
        scale: window.devicePixelRatio,
        locale: navigator.language,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        userAgent: navigator.userAgent,
        dark: window.matchMedia('(prefers-color-scheme: dark)').matches,
      })),
    ).resolves.toEqual({
      width: 1234,
      height: 777,
      scale: 1.25,
      locale: 'en-GB',
      timezone: 'Asia/Karachi',
      userAgent: 'FormCrash recorded environment test',
      dark: true,
    });
    await session.close();
  });

  it('detects a live human-verification challenge without attempting to solve it', async () => {
    let page: Page | null = null;
    const owner = new PlaywrightExternalBrowserOwner(undefined, (created) => {
      page = created;
    });
    const session = await owner.launchReplay({
      targetUrl,
      headless: true,
      timeoutMs: 10_000,
    });
    await session.navigate(targetUrl);
    if (page === null) throw new Error('Replay page was not exposed.');
    await (page as Page).evaluate(() => {
      const challenge = document.createElement('div');
      challenge.className = 'g-recaptcha';
      challenge.style.width = '300px';
      challenge.style.height = '80px';
      challenge.textContent = 'Verify you are human';
      document.body.append(challenge);
    });

    const detection = await session.detectSecurityChallenge?.();
    expect(detection?.kind).toBe('captcha');
    expect(detection?.message).toContain('will not solve or evade');
    await session.close();
  });

  it('detects a visible same-page session-expired message', async () => {
    let page: Page | null = null;
    const owner = new PlaywrightExternalBrowserOwner(undefined, (created) => {
      page = created;
    });
    const session = await owner.launchReplay({
      targetUrl,
      headless: true,
      timeoutMs: 10_000,
    });
    await session.navigate(targetUrl);
    if (page === null) throw new Error('Replay page was not exposed.');
    await (page as Page).evaluate(() => {
      const alert = document.createElement('div');
      alert.setAttribute('role', 'alert');
      alert.textContent = 'Your session expired. Please sign in again.';
      document.body.append(alert);
    });

    const detection = await session.detectAuthenticationRequired?.();
    expect(detection?.message).toContain('saved session expired');
    await session.close();
  });

  it('checks for a challenge and replays direct navigation without page helpers', async () => {
    const owner = new PlaywrightExternalBrowserOwner();
    const session = await owner.launchReplay({
      targetUrl,
      headless: true,
      timeoutMs: 10_000,
    });
    await session.navigate(targetUrl);

    await expect(
      executeRecordedStep(
        session,
        {
          id: 'navigate-home',
          name: 'Navigate to /',
          type: 'navigate',
          timestamp: Date.now(),
          url: targetUrl,
          locator: null,
          fingerprint: null,
          value: null,
          sensitive: false,
        },
        () => '',
      ),
    ).resolves.toMatchObject({
      stepId: 'navigate-home',
      status: 'verified',
      strategy: 'navigate',
    });
    await session.close();
  });

  it('verifies a generated fill value instead of the literal value captured during recording', async () => {
    let page: Page | null = null;
    const owner = new PlaywrightExternalBrowserOwner(undefined, (created) => {
      page = created;
    });
    const session = await owner.launchReplay({
      targetUrl,
      headless: true,
      timeoutMs: 10_000,
    });
    await session.navigate(targetUrl);
    const interaction = recordedInteractionSchema.parse({
      id: 'generated-name-interaction',
      stepId: 'generated-name-step',
      sequence: 1,
      pageId: 'page-1',
      framePath: [],
      startedAt: Date.now(),
      durationMs: 0,
      intent: 'fill',
      pointerType: 'mouse',
      targetCandidates: [
        {
          locator: { strategy: 'name', value: 'visitorName' },
          source: 'name',
          confidence: 0.86,
        },
      ],
      fingerprint: null,
      geometry: null,
      postconditions: [
        {
          kind: 'control_value',
          value: 'Recorded Visitor',
          target: { strategy: 'name', value: 'visitorName' },
        },
      ],
      retrySafety: 'safe',
    });

    await expect(
      executeRecordedStep(
        session,
        {
          id: 'generated-name-step',
          name: 'Fill visitor name',
          type: 'fill',
          timestamp: Date.now(),
          url: targetUrl,
          locator: { strategy: 'name', value: 'visitorName' },
          fingerprint: null,
          value: { kind: 'safe', value: '{{unique.name}}' },
          sensitive: false,
        },
        () => 'Generated Visitor',
        { interaction, mode: 'adaptive' },
      ),
    ).resolves.toMatchObject({ status: 'verified' });
    if (page === null) throw new Error('Replay page was not exposed.');
    await expect(
      (page as Page).locator('[name="visitorName"]').inputValue(),
    ).resolves.toBe('Generated Visitor');
    await session.close();
  });

  it('uses the recorded element fingerprint when click text also appears elsewhere', async () => {
    let page: Page | null = null;
    const owner = new PlaywrightExternalBrowserOwner(undefined, (created) => {
      page = created;
    });
    const session = await owner.launchReplay({
      targetUrl,
      headless: true,
      timeoutMs: 10_000,
    });
    await session.navigate(targetUrl);

    await expect(
      executeRecordedStep(
        session,
        {
          id: 'switch-building',
          name: 'Switch building',
          type: 'click',
          timestamp: Date.now(),
          url: targetUrl,
          locator: { strategy: 'text', value: 'test building 2' },
          fingerprint: {
            tagName: 'button',
            inputType: null,
            dataFormcrash: null,
            dataTestId: null,
            id: null,
            role: 'combobox',
            accessibleName: null,
            name: null,
            label: null,
            text: 'test building 2',
            cssPath: '#building-switcher',
          },
          value: null,
          sensitive: false,
        },
        () => '',
      ),
    ).resolves.toMatchObject({ status: 'verified' });
    if (page === null) throw new Error('Replay page was not exposed.');
    await expect(
      (page as Page).locator('#building-switch-count').textContent(),
    ).resolves.toBe('1');
    await session.close();
  });

  it('uses a structural trace candidate when a dropdown label matches multiple elements', async () => {
    let page: Page | null = null;
    const owner = new PlaywrightExternalBrowserOwner(undefined, (created) => {
      page = created;
    });
    const session = await owner.launchReplay({
      targetUrl,
      headless: true,
      timeoutMs: 10_000,
    });
    await session.navigate(targetUrl);
    const interaction = recordedInteractionSchema.parse({
      id: 'building-switcher-interaction',
      stepId: 'building-switcher-step',
      sequence: 1,
      pageId: 'page-1',
      framePath: [],
      startedAt: Date.now(),
      durationMs: 0,
      intent: 'click',
      pointerType: 'mouse',
      targetCandidates: [
        {
          locator: { strategy: 'text', value: 'test building 2' },
          source: 'text',
          confidence: 0.72,
        },
        {
          locator: { strategy: 'css', value: '#building-switcher' },
          source: 'structure',
          confidence: 0.45,
        },
      ],
      fingerprint: {
        tagName: 'button',
        inputType: null,
        dataFormcrash: null,
        dataTestId: null,
        id: null,
        role: 'combobox',
        accessibleName: null,
        name: null,
        label: null,
        text: 'test building 2',
        cssPath: '#building-switcher',
      },
      geometry: null,
      postconditions: [
        {
          kind: 'aria_attribute',
          name: 'aria-expanded',
          value: 'false',
          target: { strategy: 'text', value: 'test building 2' },
        },
      ],
      retrySafety: 'side_effect_possible',
    });

    await expect(
      executeRecordedStep(
        session,
        {
          id: 'building-switcher-step',
          name: 'Open building selector',
          type: 'click',
          timestamp: Date.now(),
          url: targetUrl,
          locator: { strategy: 'text', value: 'test building 2' },
          fingerprint: interaction.fingerprint,
          value: null,
          sensitive: false,
        },
        () => '',
        { interaction, mode: 'adaptive' },
      ),
    ).resolves.toMatchObject({
      status: 'recovered',
      strategy: 'css',
    });
    if (page === null) throw new Error('Replay page was not exposed.');
    await expect(
      (page as Page).locator('#building-switch-count').textContent(),
    ).resolves.toBe('1');
    await session.close();
  });

  it('uses the recorded fingerprint when trace candidates are stale or ambiguous', async () => {
    let page: Page | null = null;
    const owner = new PlaywrightExternalBrowserOwner(undefined, (created) => {
      page = created;
    });
    const session = await owner.launchReplay({
      targetUrl,
      headless: true,
      timeoutMs: 10_000,
    });
    await session.navigate(targetUrl);
    const interaction = recordedInteractionSchema.parse({
      id: 'stale-building-switcher-interaction',
      stepId: 'stale-building-switcher-step',
      sequence: 1,
      pageId: 'page-1',
      framePath: [],
      startedAt: Date.now(),
      durationMs: 0,
      intent: 'click',
      pointerType: 'mouse',
      targetCandidates: [
        {
          locator: { strategy: 'text', value: 'test building 2' },
          source: 'text',
          confidence: 0.72,
        },
        {
          locator: { strategy: 'css', value: '#old-building-switcher' },
          source: 'structure',
          confidence: 0.45,
        },
      ],
      fingerprint: {
        tagName: 'button',
        inputType: null,
        dataFormcrash: null,
        dataTestId: null,
        id: null,
        role: 'combobox',
        accessibleName: null,
        name: null,
        label: null,
        text: 'test building 2',
        cssPath: '#old-building-switcher',
      },
      geometry: null,
      postconditions: [],
      retrySafety: 'side_effect_possible',
    });

    await expect(
      executeRecordedStep(
        session,
        {
          id: 'stale-building-switcher-step',
          name: 'Open building selector',
          type: 'click',
          timestamp: Date.now(),
          url: targetUrl,
          locator: { strategy: 'text', value: 'test building 2' },
          fingerprint: interaction.fingerprint,
          value: null,
          sensitive: false,
        },
        () => '',
        { interaction, mode: 'adaptive' },
      ),
    ).resolves.toMatchObject({
      status: 'recovered',
      strategy: 'fingerprint',
    });
    if (page === null) throw new Error('Replay page was not exposed.');
    await expect(
      (page as Page).locator('#building-switch-count').textContent(),
    ).resolves.toBe('1');
    await session.close();
  });

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

  it('provides the build helper required by tsx-serialized Outcome selectors', async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.addInitScript({
      content: buildOutcomeSelectorInitScript(`function selector() {
        const result = __name(() => 42, "result");
        globalThis.__outcomeSelectorHelperResult = result();
      }`),
    });
    const page = await context.newPage();
    await page.goto(targetUrl);

    expect(
      await page.evaluate<number>('globalThis.__outcomeSelectorHelperResult'),
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

  it('skips semantic candidates that disappear during inspection', async () => {
    let page: Page | null = null;
    const owner = new PlaywrightExternalBrowserOwner(undefined, (created) => {
      page = created;
    });
    const session = await owner.launchReplay({
      targetUrl,
      headless: true,
      timeoutMs: 10_000,
    });
    await session.navigate(targetUrl);
    if (page === null) throw new Error('Replay page was not exposed.');
    await (page as Page).evaluate(() => {
      const container = document.createElement('div');
      for (let index = 0; index < 20; index += 1) {
        const item = document.createElement('div');
        item.id = `pending-transient-${index}`;
        item.classList.add('transient-semantic');
        container.append(item);
      }
      document.body.append(container);
      const first = container.firstElementChild;
      if (!(first instanceof HTMLElement)) return;
      Object.defineProperty(first, 'className', {
        configurable: true,
        get() {
          for (const item of document.querySelectorAll('.transient-semantic')) {
            if (item !== first) item.remove();
          }
          return 'loading transient-semantic';
        },
      });
    });

    const startedAt = Date.now();
    const semantic = await session.inspectSemanticElements?.();
    expect(Array.isArray(semantic)).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
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

  it('recovers an exact custom-combobox option that detaches during a trusted click', async () => {
    let page: Page | null = null;
    const owner = new PlaywrightExternalBrowserOwner(undefined, (created) => {
      page = created;
    });
    const session = await owner.launchReplay({
      targetUrl,
      headless: true,
      timeoutMs: 1_000,
    });
    await session.navigate(targetUrl);

    await session.click({
      strategy: 'role',
      role: 'button',
      name: 'TT-101AvailableFloor 1',
    });

    if (page === null) throw new Error('Replay page was not exposed.');
    await expect(
      (page as Page).locator('#selected-unit').textContent(),
    ).resolves.toBe('TT-101');
    await session.close();
  });

  it('repeats a moving custom option 50 times through trusted input and verifies its post-state', async () => {
    let page: Page | null = null;
    const owner = new PlaywrightExternalBrowserOwner(undefined, (created) => {
      page = created;
    });
    const session = await owner.launchReplay({
      targetUrl,
      headless: true,
      timeoutMs: 1_000,
    });
    await session.navigate(targetUrl);
    const interaction = recordedInteractionSchema.parse({
      id: 'moving-option-interaction',
      stepId: 'moving-option-step',
      sequence: 1,
      pageId: 'page-1',
      framePath: [],
      startedAt: Date.now(),
      durationMs: 0,
      intent: 'click',
      pointerType: 'mouse',
      targetCandidates: [
        {
          locator: {
            strategy: 'role',
            role: 'button',
            name: 'TT-101AvailableFloor 1',
          },
          source: 'accessibility',
          confidence: 0.9,
        },
      ],
      fingerprint: null,
      geometry: null,
      postconditions: [
        {
          kind: 'visible_text',
          value: 'TT-101',
          target: { strategy: 'id', value: 'selected-unit' },
        },
      ],
      retrySafety: 'side_effect_possible',
    });
    if (page === null || session.clickInteraction === undefined) {
      throw new Error('Hybrid replay was not exposed.');
    }

    for (let attempt = 0; attempt < 50; attempt += 1) {
      await (page as Page).locator('#selected-unit').evaluate((element) => {
        element.textContent = '';
      });
      await session.clickInteraction(interaction);
      await expect(
        session.verifyInteraction?.(interaction),
      ).resolves.toMatchObject({ passed: true });
    }
    await session.close();
  });

  it('does not click an overlapping control at the recorded pointer coordinates', async () => {
    let page: Page | null = null;
    const owner = new PlaywrightExternalBrowserOwner(undefined, (created) => {
      page = created;
    });
    const session = await owner.launchReplay({
      targetUrl,
      headless: true,
      timeoutMs: 2_000,
      environment: {
        viewportWidth: 800,
        viewportHeight: 600,
        deviceScaleFactor: 1,
        locale: 'en-US',
        timezoneId: 'UTC',
        userAgent: 'FormCrash hit-test regression',
        colorScheme: 'light',
        browserName: 'chromium',
        browserVersion: 'test-version',
      },
    });
    await session.navigate(targetUrl);
    const interaction = recordedInteractionSchema.parse({
      id: 'overlapped-parking-interaction',
      stepId: 'overlapped-parking-step',
      sequence: 1,
      pageId: 'page-1',
      framePath: [],
      startedAt: Date.now(),
      durationMs: 0,
      intent: 'click',
      pointerType: 'mouse',
      targetCandidates: [
        {
          locator: { strategy: 'role', role: 'link', name: 'Parking' },
          source: 'accessibility',
          confidence: 0.9,
        },
      ],
      fingerprint: null,
      geometry: {
        x: 20,
        y: 550,
        width: 220,
        height: 40,
        pointerOffsetX: 88,
        pointerOffsetY: 26,
      },
      postconditions: [],
      retrySafety: 'side_effect_possible',
    });
    const outcome = await session.clickInteraction?.(interaction);

    expect(outcome).toMatchObject({
      strategy: 'role-hit-tested',
      recovered: true,
    });
    expect(session.currentUrl()).toBe(`${targetUrl}/#parking-opened`);
    if (page === null) throw new Error('Replay page was not exposed.');
    await expect(
      (page as Page).locator('#sign-out-clicks').textContent(),
    ).resolves.toBe('0');
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

  it('never preserves printable key values or codes in the raw trace', async () => {
    const traceEvents: unknown[] = [];
    const owner = new PlaywrightExternalBrowserOwner(async (page) => {
      await page.locator('#secret').pressSequentially('NeverPersistThis');
    });
    const session = await owner.launchRecording(
      { targetUrl, headless: true, timeoutMs: 10_000 },
      {
        onEvent: () => undefined,
        onWarning: () => undefined,
        onNavigation: () => undefined,
        onTraceEvent: (event) => traceEvents.push(event),
      },
    );
    await session.close();

    const serialized = JSON.stringify(traceEvents);
    expect(serialized).not.toContain('NeverPersistThis');
    expect(serialized).not.toContain('KeyN');
    expect(serialized).toContain('[REDACTED_CHARACTER]');
    expect(serialized).toContain('[REDACTED_CODE]');
  });
});
