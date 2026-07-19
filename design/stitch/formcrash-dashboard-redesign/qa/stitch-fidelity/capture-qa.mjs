/* global document, fetch, window */

import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

import { chromium } from '../../../../../apps/server/node_modules/playwright/index.mjs';

const dashboardUrl = 'http://localhost:3000';
const serverUrl = 'http://localhost:4100';
const outputDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixtureOrigin = 'http://127.0.0.1:4300';
let fixtureServer = null;

const screens = {
  journey: { width: 2560, height: 2048 },
  expected: { width: 2560, height: 2352 },
  safety: { width: 2560, height: 2048 },
  review: { width: 2560, height: 2048 },
  vulnerability: { width: 2560, height: 2314 },
  notConfigured: { width: 2560, height: 2048 },
  runs: { width: 2560, height: 2048 },
};

const report = {
  generatedAt: new Date().toISOString(),
  screenshots: [],
  data: {},
  checks: { overflow: {}, landmarks: {}, errors: [] },
};

await ensureServices();
await ensureFixture();
const state = await findState();
report.data = {
  projectId: state.project.id,
  journeyId: state.journey.id,
  vulnerableRunId: state.vulnerableRun.runId,
  notConfiguredRunId: state.notConfiguredRun.runId,
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  colorScheme: 'dark',
  reducedMotion: 'reduce',
});
const page = await context.newPage();
page.on('console', (message) => {
  if (message.type() === 'error') report.checks.errors.push(message.text());
});
page.on('pageerror', (error) => report.checks.errors.push(error.message));

try {
  await openJourney(page, state);
  await capture(page, 'journey-detail', screens.journey);

  await page
    .getByLabel('Project workspace views')
    .getByRole('button', { name: 'Configure test' })
    .click();
  await page.locator('.guided-wizard-stage-expected').waitFor();
  const version = page.getByLabel('Guided journey version');
  if ((await version.inputValue()) !== state.journey.id) {
    await version.selectOption(state.journey.id);
  }
  await page
    .getByRole('tab', { name: /Outcome Checks [1-9]\d* saved/u })
    .waitFor();
  await capture(page, 'test-wizard-expected-outcome', screens.expected);

  await page.getByRole('tab', { name: /Critical Action/u }).click();
  await capture(page, 'test-wizard-expected-critical-action', screens.expected);
  await page.getByRole('tab', { name: /Outcome Checks/u }).click();
  await capture(page, 'test-wizard-expected-outcome-checks', screens.expected);

  await page.getByRole('button', { name: 'Continue to Safety & Data' }).click();
  await page.locator('.guided-wizard-stage-safety').waitFor();
  await capture(page, 'test-wizard-safety-data', screens.safety);

  await page.getByRole('button', { name: 'Continue to Review' }).click();
  await page.locator('.guided-wizard-stage-review').waitFor();
  await capture(page, 'test-wizard-review-run', screens.review);

  await page.goto(`${dashboardUrl}/runs`, { waitUntil: 'networkidle' });
  await page.locator('.run-history-table tbody tr').first().waitFor();
  await capture(page, 'runs-list', screens.runs);

  await page.goto(`${dashboardUrl}/runs/${state.vulnerableRun.runId}`, {
    waitUntil: 'networkidle',
  });
  await page.locator('.run-detail-shell').waitFor();
  await capture(page, 'run-result-vulnerability', screens.vulnerability);

  await openExternalResult(page, state.notConfiguredRun);
  await capture(page, 'run-result-not-configured', screens.notConfigured);
} finally {
  await context.close();
  await browser.close();
  if (fixtureServer !== null) {
    await new Promise((resolve) => fixtureServer.close(resolve));
  }
}

if (report.checks.errors.length > 0) {
  throw new Error(`Browser errors: ${report.checks.errors.join(' | ')}`);
}

await writeFile(
  path.join(outputDirectory, 'qa-results.json'),
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8',
);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

async function ensureServices() {
  for (const url of [dashboardUrl, `${serverUrl}/health`]) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  }
}

async function ensureFixture() {
  try {
    const response = await fetch(fixtureOrigin);
    if (response.ok) return;
  } catch {
    // Start the repository's deterministic target below.
  }
  const html = await readFile(
    path.resolve(
      outputDirectory,
      '../../../../../fixtures/external-target/index.html',
    ),
    'utf8',
  );
  fixtureServer = createServer((request, response) => {
    if (request.url?.startsWith('/api/')) {
      response.writeHead(request.url === '/api/profile' ? 200 : 204, {
        'content-type': 'application/json',
      });
      response.end(request.url === '/api/profile' ? '{"createdCount":0}' : '');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  });
  fixtureServer.listen(4300, '127.0.0.1');
  await once(fixtureServer, 'listening');
}

async function findState() {
  const projects = (await fetchJson(`${serverUrl}/api/projects`)).items;
  let configured = null;
  let notConfigured = null;

  for (const project of projects) {
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
      if (configured === null && criticalAction !== null && checks.length > 0) {
        configured = { project, journey };
      }
    }
    const externalRuns = (
      await fetchJson(
        `${serverUrl}/api/external-runs?projectId=${project.id}&limit=20&offset=0`,
      )
    ).items;
    const match = externalRuns.find(
      (run) => run.outcomeAggregate === 'not_configured',
    );
    if (match !== undefined) notConfigured = { project, run: match };
  }

  const runs = (await fetchJson(`${serverUrl}/api/runs`)).items;
  const vulnerableRun = runs.find(
    (run) => run.mode === 'vulnerable' && run.status === 'failed',
  );
  if (configured === null || notConfigured === null || vulnerableRun == null) {
    throw new Error('Required persisted QA states are not available.');
  }
  return {
    ...configured,
    vulnerableRun,
    notConfiguredRun: notConfigured.run,
    notConfiguredProject: notConfigured.project,
  };
}

async function openJourney(targetPage, state) {
  await targetPage.goto(`${dashboardUrl}/projects`, {
    waitUntil: 'networkidle',
  });
  await targetPage.getByRole('button', { name: 'Manage projects' }).click();
  const project = targetPage
    .locator('.project-card-select')
    .filter({ hasText: state.project.name });
  await project.waitFor();
  await project.click();
  await targetPage.getByRole('button', { name: 'Journey detail' }).click();
  await targetPage.locator('.journey-detail-shell').waitFor();
  const version = targetPage.getByLabel('Journey version');
  if ((await version.inputValue()) !== state.journey.id) {
    await version.selectOption(state.journey.id);
  }
  await targetPage
    .getByRole('heading', { name: state.journey.name, exact: true })
    .waitFor();
}

async function openExternalResult(targetPage, run) {
  await targetPage.goto(`${dashboardUrl}/external-runs/${run.runId}`, {
    waitUntil: 'networkidle',
  });
  await targetPage.locator('.external-result-not-configured').waitFor();
}

async function capture(targetPage, name, viewport) {
  await targetPage.setViewportSize(viewport);
  await targetPage.evaluate(() => window.scrollTo(0, 0));
  await targetPage.waitForTimeout(100);
  const file = `${name}.png`;
  await targetPage.screenshot({
    path: path.join(outputDirectory, file),
    animations: 'disabled',
  });
  report.screenshots.push(file);
  const metrics = await targetPage.evaluate(() => ({
    horizontalOverflow:
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 1,
    mainCount: document.querySelectorAll('main').length,
  }));
  report.checks.overflow[name] = !metrics.horizontalOverflow;
  report.checks.landmarks[name] = metrics.mainCount;
  if (metrics.horizontalOverflow) throw new Error(`${name} overflows.`);
  if (metrics.mainCount !== 1) {
    throw new Error(`${name} rendered ${metrics.mainCount} main landmarks.`);
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}
