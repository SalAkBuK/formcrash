/* global document, fetch, getComputedStyle, HTMLElement, setTimeout, URL, window */

import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

import { chromium } from '../../../../../apps/server/node_modules/playwright/index.mjs';

const dashboardUrl = 'http://localhost:3000';
const serverUrl = 'http://localhost:4100';
const sampleUrl = 'http://localhost:4200';
const fixtureOrigin = 'http://127.0.0.1:4300';
const outputDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixtureHtml = await readFile(
  path.resolve(
    outputDirectory,
    '../../../../../fixtures/external-target/index.html',
  ),
  'utf8',
);
const viewports = [
  { width: 1440, height: 1000 },
  { width: 1366, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
];

const report = {
  generatedAt: new Date().toISOString(),
  playwrightVersion: '1.61.1',
  browserVersion: null,
  services: {},
  realData: {},
  screenshots: [],
  checks: {
    accessibility: {},
    functional: {},
    responsive: {},
    visual: {},
  },
  run: null,
  consoleErrors: [],
  pageErrors: [],
};

let fixtureServer = null;
let createdCount = 0;

try {
  await ensureServices();
  const fixtureStarted = await ensureFixture();
  report.services.fixture = {
    connected: true,
    status: 200,
    startedByHarness: fixtureStarted,
  };

  const state = await findRunnablePersistedState();
  report.realData = summarizeState(state);

  const browser = await chromium.launch({ headless: true });
  report.browserVersion = browser.version();
  const context = await browser.newContext({
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => report.pageErrors.push(error.message));

  try {
    await openWizard(page, state);
    await captureStep(page, 1, 'expected-outcome');
    await verifyExpectedOutcome(page, state);

    await page
      .getByRole('button', { name: 'Continue to Safety & Data' })
      .click();
    await page.getByRole('heading', { name: 'Safety & Data' }).waitFor();
    await captureStep(page, 2, 'safety-data');
    await verifySafety(page, state);
    await verifyBackAndForward(page);

    await page.getByRole('button', { name: 'Continue to Review' }).click();
    await page
      .getByRole('heading', { name: 'Review & Run' })
      .waitFor({ timeout: 60_000 });
    await captureStep(page, 3, 'review-run');
    await verifyReview(page, state);
    await verifyReviewBackAndForward(page);
    await verifyStructureAndFocus(page);
    await runLocalExperiment(page);
    await verifyModeAccess(page);
  } finally {
    await context.close();
    await browser.close();
  }

  assert(
    report.consoleErrors.length === 0,
    `Console errors occurred: ${report.consoleErrors.join(' | ')}`,
  );
  assert(
    report.pageErrors.length === 0,
    `Page errors occurred: ${report.pageErrors.join(' | ')}`,
  );

  await writeFile(
    path.join(outputDirectory, 'qa-results.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  if (fixtureServer !== null) {
    await new Promise((resolve) => fixtureServer.close(resolve));
  }
}

async function ensureServices() {
  for (const [name, url] of Object.entries({
    dashboard: dashboardUrl,
    server: `${serverUrl}/health`,
    sampleCheckout: sampleUrl,
  })) {
    const response = await fetch(url);
    assert(response.ok, `${name} is not healthy: HTTP ${response.status}`);
    report.services[name] = {
      connected: true,
      status: response.status,
      startedByHarness: false,
    };
  }
}

async function ensureFixture() {
  try {
    const response = await fetch(fixtureOrigin);
    if (response.ok) return false;
  } catch {
    // The deterministic repository fixture is started below.
  }

  fixtureServer = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', fixtureOrigin);
      if (
        url.pathname === '/api/reset' &&
        ['POST', 'DELETE'].includes(request.method ?? '')
      ) {
        createdCount = 0;
        await readBody(request);
        return sendJson(response, 200, { reset: true });
      }
      if (url.pathname === '/api/profile' && request.method === 'POST') {
        await readBody(request);
        createdCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 40));
        return sendJson(response, 201, { createdCount });
      }
      if (url.pathname === '/api/profile') {
        return sendJson(response, 200, { createdCount });
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(fixtureHtml);
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : 'fixture failure',
      });
    }
  });
  fixtureServer.listen(4300, '127.0.0.1');
  await once(fixtureServer, 'listening');
  return true;
}

async function findRunnablePersistedState() {
  const projects = (await fetchJson(`${serverUrl}/api/projects`)).items;
  for (const project of projects) {
    if (new URL(project.targetUrl).origin !== fixtureOrigin) continue;
    const settings = await fetchJson(
      `${serverUrl}/api/projects/${project.id}/settings`,
    );
    const journeys = (
      await fetchJson(`${serverUrl}/api/projects/${project.id}/journeys`)
    ).items;
    for (const journey of journeys) {
      const criticalAction = (
        await fetchJson(
          `${serverUrl}/api/journeys/${journey.id}/critical-action`,
        )
      ).criticalAction;
      const checks = (
        await fetchJson(
          `${serverUrl}/api/journeys/${journey.id}/outcome-checks`,
        )
      ).items;
      if (criticalAction !== null && checks.length > 0) {
        return { project, journey, criticalAction, checks, settings };
      }
    }
  }
  throw new Error(
    'No persisted local journey has a Critical Action and Outcome Checks.',
  );
}

async function openWizard(page, state) {
  await page.goto(`${dashboardUrl}/projects`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Project overview' }).waitFor();
  const projectButton = page
    .locator('.project-card-select')
    .filter({ hasText: state.project.name });
  await projectButton.waitFor();
  if (
    (await page.locator('.selected-project-title').innerText()) !==
    state.project.name
  ) {
    await projectButton.click();
  }
  await page
    .getByRole('heading', { name: state.journey.name, exact: true })
    .waitFor();
  const wizardJourney = page.getByLabel('Guided journey version');
  if ((await wizardJourney.inputValue()) !== state.journey.id) {
    await wizardJourney.selectOption(state.journey.id);
  }
  await page
    .getByRole('button', { name: 'Continue to Safety & Data' })
    .waitFor();
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        '#guided-outcome-configuration .outcome-check-list > li',
      ).length > 0,
  );
}

async function captureStep(page, step, slug) {
  const overflow = {};
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await scrollWizardIntoView(page);
    const screenshotName = `step-${step}-${slug}-${viewport.width}.png`;
    await page.screenshot({
      path: path.join(outputDirectory, screenshotName),
      animations: 'disabled',
    });
    report.screenshots.push(screenshotName);
    overflow[viewport.width] = await horizontalOverflow(page);
    assert(
      !overflow[viewport.width].overflows,
      `Step ${step} horizontally overflows at ${viewport.width}px.`,
    );
  }
  report.checks.responsive[`step${step}`] = overflow;
  await page.setViewportSize(viewports[0]);
  await scrollWizardIntoView(page);
}

async function verifyExpectedOutcome(page, state) {
  const wizard = page.locator('.guided-wizard');
  const outcomePanel = page.locator('#guided-outcome-configuration');
  assert(
    (await outcomePanel.locator('.outcome-check-list > li').count()) ===
      state.checks.length,
    'Step 1 does not render every persisted Outcome Check.',
  );
  const text = await outcomePanel.innerText();
  assert(
    text.includes(state.criticalAction.label),
    'Step 1 does not render the persisted Critical Action.',
  );
  assert(
    !/confidence|provenance|generated badge|manual badge/iu.test(text),
    'Unsupported Outcome Check metadata appeared in Step 1.',
  );
  assert(
    (await outcomePanel
      .getByRole('button', { name: 'Start outcome baseline' })
      .count()) === 1,
    'The existing Outcome Check capture entry is missing.',
  );
  assert(
    (await wizard.getByText(state.project.name, { exact: true }).count()) > 0,
    'Real project data is absent from Step 1.',
  );
  report.checks.functional.expectedOutcome = {
    project: state.project.name,
    journey: state.journey.name,
    version: state.journey.version,
    criticalAction: state.criticalAction.label,
    outcomeCheckCount: state.checks.length,
    captureEntryAvailable: true,
    unsupportedMetadataAbsent: true,
  };
}

async function verifySafety(page, state) {
  const stage = page.locator('.guided-wizard-stage').filter({
    has: page.getByRole('heading', { name: 'Safety & Data' }),
  });
  const text = await stage.innerText();
  assert(text.includes(fixtureOrigin), 'The real target origin is missing.');
  assert(
    text.includes('No saved authentication') &&
      text.includes('may discover during replay'),
    'Authentication requirement is not described truthfully.',
  );
  assert(text.includes('Replay pacing'), 'Replay pacing is missing.');
  assert(text.includes('Before hook'), 'Before-hook status is missing.');
  assert(text.includes('Cleanup hook'), 'Cleanup-hook status is missing.');
  assert(text.includes('CAPTCHA'), 'Known CAPTCHA boundaries are missing.');
  assert(
    !text.includes('recorded@example.test'),
    'A recorded literal leaked into the Safety step.',
  );
  report.checks.functional.safety = {
    targetOrigin: fixtureOrigin,
    environment: state.project.environment,
    authenticationAvailable: state.settings.authentication.available,
    authenticationRequirementPresentedAsUnknown: true,
    runtimeLiteralRedacted: true,
    pacingAvailable: true,
    hooksSummarized: true,
    captchaBoundaryAvailable: true,
  };
}

async function verifyBackAndForward(page) {
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('heading', { name: 'Expected Outcome' }).waitFor();
  await page.getByRole('button', { name: 'Continue to Safety & Data' }).click();
  await page.getByRole('heading', { name: 'Safety & Data' }).waitFor();
  report.checks.functional.expectedSafetyBackForward = true;
}

async function verifyReview(page, state) {
  const stage = page.locator('.guided-wizard-stage').filter({
    has: page.getByRole('heading', { name: 'Review & Run' }),
  });
  const text = await stage.innerText();
  for (const required of [
    state.project.name,
    state.journey.name,
    `v${state.journey.version}`,
    state.criticalAction.label,
    'Replay pacing',
    'Authentication',
    'Production confirmation',
  ]) {
    assert(text.includes(required), `Review is missing: ${required}`);
  }
  assert(
    (await stage.locator('.guided-review-outcomes li').count()) ===
      state.checks.length,
    'Review does not render every saved Outcome Check.',
  );
  const technicalDisclosure = stage.locator('details').filter({
    hasText: 'Advanced technical configuration',
  });
  await technicalDisclosure.locator('summary').click();
  assert(
    (await technicalDisclosure.innerText()).includes(
      'These are not Outcome Checks.',
    ),
    'Technical assertions are not clearly separated from Outcome Checks.',
  );
  await technicalDisclosure.locator('summary').click();
  report.checks.functional.review = {
    everyOutcomeCheckRendered: true,
    immutableVersionRendered: true,
    technicalAssertionsSeparated: true,
    runActionAvailable: await page
      .getByRole('button', { name: 'Run repeated-submission experiment' })
      .isEnabled(),
  };
}

async function verifyReviewBackAndForward(page) {
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('heading', { name: 'Safety & Data' }).waitFor();
  await page.getByRole('button', { name: 'Continue to Review' }).click();
  await page
    .getByRole('heading', { name: 'Review & Run' })
    .waitFor({ timeout: 60_000 });
  report.checks.functional.reviewBackForward = true;
}

async function verifyStructureAndFocus(page) {
  const structure = await page.evaluate(() => ({
    mainCount: document.querySelectorAll('main').length,
    nestedMainCount: document.querySelectorAll('main main').length,
    currentStepCount: document.querySelectorAll('[aria-current="step"]').length,
  }));
  assert(
    structure.mainCount === 1 && structure.nestedMainCount === 0,
    'The page must contain exactly one main landmark.',
  );
  assert(
    structure.currentStepCount === 1,
    'Exactly one wizard step must be current.',
  );

  const runButton = page.getByRole('button', {
    name: 'Run repeated-submission experiment',
  });
  const focus = await focusStyleFor(page, runButton);
  assert(focus.keyboardReachable, 'Run action is not keyboard reachable.');
  assert(focus.visible, 'Run action has no visible keyboard focus style.');
  report.checks.accessibility = { ...structure, runActionFocus: focus };
}

async function verifyModeAccess(page) {
  const advanced = page.getByRole('tab', { name: /Advanced/u });
  const guided = page.getByRole('tab', { name: /Guided Test/u });
  await advanced.click();
  await page
    .getByRole('heading', { name: 'Authentication and runtime inputs' })
    .waitFor();
  await guided.click();
  await page.getByRole('heading', { name: 'Expected Outcome' }).waitFor();
  report.checks.functional.guidedAndAdvancedAccessible = true;
  report.checks.functional.unsavedWizardStateResetsOnModeSwitch = true;
}

async function runLocalExperiment(page) {
  await fetch(`${fixtureOrigin}/api/reset`, { method: 'POST' });
  let createRequests = 0;
  let runRequests = 0;
  page.on('request', (request) => {
    const url = request.url();
    if (
      request.method() === 'POST' &&
      /\/api\/journeys\/[^/]+\/experiments$/u.test(url)
    ) {
      createRequests += 1;
    }
    if (
      request.method() === 'POST' &&
      /\/api\/external-experiments\/[^/]+\/runs$/u.test(url)
    ) {
      runRequests += 1;
    }
  });

  const button = page
    .locator('.guided-wizard-stage:not([hidden])')
    .locator('.guided-wizard-primary');
  assert(
    (await button.innerText()) === 'Run repeated-submission experiment',
    'The real Guided run action is unavailable.',
  );
  await button.click();
  await button.click({ force: true });
  await page
    .getByText(/existing runner returned run/u)
    .waitFor({ timeout: 90_000 });
  assert(
    createRequests === 1,
    `Expected one experiment creation request; observed ${createRequests}.`,
  );
  assert(
    runRequests === 1,
    `Expected one experiment run request; observed ${runRequests}.`,
  );
  report.run = {
    attempted: true,
    target: fixtureOrigin,
    safeLocalFixture: true,
    createRequests,
    runRequests,
    accepted: true,
  };
}

async function scrollWizardIntoView(page) {
  await page
    .locator('.guided-wizard-header')
    .evaluate((element) =>
      element.scrollIntoView({ block: 'start', behavior: 'instant' }),
    );
  const viewport = page.viewportSize();
  await page.evaluate(
    (offset) => window.scrollBy(0, -offset),
    viewport !== null && viewport.width > 600 ? 64 : 8,
  );
}

async function horizontalOverflow(page) {
  return page.evaluate(() => ({
    overflows:
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 1,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

async function focusStyleFor(page, locator) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  });
  for (let index = 0; index < 220; index += 1) {
    await page.keyboard.press('Tab');
    if (
      await locator.evaluate((element) => document.activeElement === element)
    ) {
      break;
    }
  }
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      keyboardReachable: document.activeElement === element,
      outlineColor: style.outlineColor,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      boxShadow: style.boxShadow,
      visible:
        (style.outlineStyle !== 'none' &&
          Number.parseFloat(style.outlineWidth) >= 1) ||
        style.boxShadow !== 'none',
    };
  });
}

function summarizeState(state) {
  return {
    projectId: state.project.id,
    projectName: state.project.name,
    environment: state.project.environment,
    targetUrl: state.project.targetUrl,
    journeyId: state.journey.id,
    journeyName: state.journey.name,
    version: state.journey.version,
    replayFormat: state.journey.replayFormat ?? 'semantic-v1',
    criticalActionId: state.criticalAction.id,
    criticalActionLabel: state.criticalAction.label,
    outcomeCheckIds: state.checks.map((check) => check.id),
    outcomeCheckTypes: state.checks.map((check) => check.type),
    authenticationAvailable: state.settings.authentication.available,
  };
}

async function fetchJson(url) {
  const response = await fetch(url);
  assert(response.ok, `${url} returned HTTP ${response.status}.`);
  return response.json();
}

async function readBody(request) {
  let body = '';
  for await (const chunk of request) body += chunk;
  return body;
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
