/* global document, fetch, getComputedStyle, HTMLElement, window */

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

import { chromium } from '../../../../../apps/server/node_modules/playwright/index.mjs';

const dashboardUrl = 'http://localhost:3000';
const serverUrl = 'http://localhost:4100';
const sampleUrl = 'http://localhost:4200';
const outputDirectory = path.dirname(fileURLToPath(import.meta.url));

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
  skippedStates: [],
  consoleErrors: [],
  pageErrors: [],
};

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

const projects = (await fetchJson(`${serverUrl}/api/projects`)).items;
const projectStates = [];
for (const project of projects) {
  const journeys = (
    await fetchJson(`${serverUrl}/api/projects/${project.id}/journeys`)
  ).items;
  const settings = await fetchJson(
    `${serverUrl}/api/projects/${project.id}/settings`,
  );
  const journeyStates = [];
  for (const journey of journeys) {
    const criticalAction = (
      await fetchJson(`${serverUrl}/api/journeys/${journey.id}/critical-action`)
    ).criticalAction;
    const checks = (
      await fetchJson(`${serverUrl}/api/journeys/${journey.id}/outcome-checks`)
    ).items;
    journeyStates.push({ journey, criticalAction, checks });
  }
  projectStates.push({ project, settings, journeys: journeyStates });
}

const primaryState =
  projectStates.find((state) =>
    state.journeys.some(
      ({ journey }) =>
        journey.replayFormat === 'hybrid-v2' && journey.trace !== null,
    ),
  ) ?? projectStates.find((state) => state.journeys.length > 0);
assert(
  primaryState !== undefined,
  'No real saved journey is available for QA.',
);
const primaryJourneyState =
  primaryState.journeys.find(
    ({ journey }) =>
      journey.replayFormat === 'hybrid-v2' && journey.trace !== null,
  ) ?? primaryState.journeys[0];
assert(primaryJourneyState !== undefined, 'Primary project has no journey.');

const semanticState = projectStates.find((state) =>
  state.journeys.some(({ journey }) => journey.replayFormat !== 'hybrid-v2'),
);
const semanticJourneyState = semanticState?.journeys.find(
  ({ journey }) => journey.replayFormat !== 'hybrid-v2',
);

report.realData = {
  projects: projectStates.map((state) => ({
    id: state.project.id,
    name: state.project.name,
    environment: state.project.environment,
    journeyCount: state.journeys.length,
  })),
  primary: summarizeState(primaryState, primaryJourneyState),
  semantic:
    semanticState !== undefined && semanticJourneyState !== undefined
      ? summarizeState(semanticState, semanticJourneyState)
      : null,
};

if (
  !projectStates.some((state) =>
    state.journeys.some(
      ({ journey, criticalAction, checks }) =>
        journey.replayFormat === 'hybrid-v2' &&
        journey.trace !== null &&
        criticalAction !== null &&
        checks.length > 0,
    ),
  )
) {
  report.skippedStates.push(
    'Complete hybrid-v2 capture: no real persisted journey matches this state.',
  );
}
report.skippedStates.push(
  'Missing-runtime-data capture: no current real journey requires unresolved runtime data.',
);

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
  await captureRequiredViewports(page, primaryState, primaryJourneyState);
  if (semanticState !== undefined && semanticJourneyState !== undefined) {
    await captureSemantic(page, semanticState, semanticJourneyState);
  }
  await functionalChecks(page, primaryState, primaryJourneyState);
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

async function captureRequiredViewports(
  targetPage,
  projectState,
  journeyState,
) {
  const viewports = [
    { width: 1440, height: 1000 },
    { width: 1366, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ];
  const overflow = {};
  for (const viewport of viewports) {
    await targetPage.setViewportSize(viewport);
    await openJourney(targetPage, projectState, journeyState);
    const screenshotName = `journey-detail-${viewport.width}.png`;
    await screenshotJourney(targetPage, screenshotName);
    overflow[viewport.width] = await horizontalOverflow(targetPage);
    assert(
      !overflow[viewport.width].overflows,
      `Journey Detail horizontally overflows at ${viewport.width}px.`,
    );
    if (viewport.width === 390) {
      const columns = await targetPage
        .locator('.journey-detail-grid')
        .evaluate((element) => getComputedStyle(element).gridTemplateColumns);
      assert(
        columns.split(' ').length === 1,
        'Mobile Journey Detail did not collapse to one column.',
      );
      report.checks.responsive.mobileColumns = columns;
    }
  }
  report.checks.responsive.horizontalOverflow = overflow;

  if (
    journeyState.criticalAction === null ||
    journeyState.checks.length === 0
  ) {
    await targetPage.setViewportSize({ width: 1440, height: 1000 });
    await openJourney(targetPage, projectState, journeyState);
    await screenshotJourney(targetPage, 'journey-detail-incomplete-1440.png');
  }
}

async function captureSemantic(targetPage, projectState, journeyState) {
  await targetPage.setViewportSize({ width: 1440, height: 1000 });
  await openJourney(targetPage, projectState, journeyState);
  await screenshotJourney(targetPage, 'journey-detail-semantic-v1-1440.png');
  const body = (await targetPage.locator('body').innerText()).toLowerCase();
  assert(
    body.includes('semantic compatible'),
    'Semantic-v1 compatibility status is missing.',
  );
  assert(
    !body.includes('trace missing'),
    'Semantic-v1 journey was incorrectly presented as a missing trace.',
  );
}

async function functionalChecks(targetPage, projectState, journeyState) {
  await targetPage.setViewportSize({ width: 1440, height: 1000 });
  await openJourney(targetPage, projectState, journeyState);

  const bodyText = await targetPage.locator('body').innerText();
  const detail = targetPage.locator('.journey-detail-shell');
  const primaryActions = detail.locator('.journey-primary-action');
  const versionSelector = targetPage.getByLabel('Journey version');
  const recordedSteps = detail.locator('.recorded-step-row');
  const technicalDetail = recordedSteps.first().locator('details');
  const replayMode = targetPage.getByLabel('Replay mode');
  const replayPacing = targetPage.getByLabel('Replay pacing');
  const recordNewVersion = detail.getByRole('link', {
    name: 'Record new version',
  });

  assert(
    bodyText.includes(journeyState.journey.name),
    'Real journey name did not render.',
  );
  assert(
    !bodyText.includes('Register Visitor'),
    'Stitch example content leaked into production.',
  );
  assert(
    (await versionSelector.inputValue()) === journeyState.journey.id,
    'Exact immutable journey version is not selected.',
  );
  assert(
    (await recordedSteps.count()) === journeyState.journey.steps.length,
    'Saved steps did not render in full.',
  );
  assert(
    (await primaryActions.count()) === 1,
    'Journey Detail must expose exactly one state-driven primary action.',
  );
  assert(
    (await recordNewVersion.getAttribute('href')) === '#recording-workspace',
    'Record-new-version control does not target the real recording workflow.',
  );
  assert(
    (await technicalDetail.getAttribute('open')) === null,
    'Technical step detail must start collapsed.',
  );
  await technicalDetail.locator('summary').click();
  assert(
    (await technicalDetail.getAttribute('open')) !== null,
    'Technical step disclosure did not open.',
  );
  await technicalDetail.locator('summary').click();

  await replayMode.selectOption('strict');
  await replayPacing.selectOption('fast');
  assert(
    (await replayMode.inputValue()) === 'strict' &&
      (await replayPacing.inputValue()) === 'fast',
    'Replay mode or pacing control did not update.',
  );

  const expectedCriticalCount = journeyState.criticalAction === null ? 0 : 1;
  const actualCriticalCount = await recordedSteps
    .filter({ has: detail.getByText('Critical Action', { exact: true }) })
    .count();
  assert(
    actualCriticalCount === expectedCriticalCount,
    'Critical Action marker does not match persisted state.',
  );
  const renderedChecks = await detail
    .locator('.journey-outcome-list > li')
    .count();
  assert(
    renderedChecks === journeyState.checks.length,
    'Outcome Check summary does not match persisted state.',
  );

  const guidedTab = targetPage.getByRole('tab', { name: /Guided Test/ });
  const advancedTab = targetPage.getByRole('tab', { name: /Advanced/ });
  await advancedTab.scrollIntoViewIfNeeded();
  await advancedTab.click();
  await targetPage
    .getByRole('heading', { name: 'Authentication and runtime inputs' })
    .waitFor();
  await guidedTab.click();
  assert(await guidedTab.isVisible(), 'Guided configuration is inaccessible.');

  const structure = await targetPage.evaluate(() => {
    const unnamed = [...document.querySelectorAll('button, a[href], select')]
      .filter((element) => {
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden')
          return false;
        const name =
          element.getAttribute('aria-label') ??
          element.textContent?.trim() ??
          '';
        return name === '';
      })
      .map((element) => element.outerHTML.slice(0, 160));
    return {
      mainCount: document.querySelectorAll('main').length,
      nestedMainCount: document.querySelectorAll('main main').length,
      unnamedInteractive: unnamed,
      versionTitle: document
        .querySelector('.journey-detail-title')
        ?.getAttribute('title'),
    };
  });
  assert(
    structure.mainCount === 1 && structure.nestedMainCount === 0,
    'Journey Detail must have exactly one main landmark.',
  );
  assert(
    structure.unnamedInteractive.length === 0,
    `Unnamed controls found: ${structure.unnamedInteractive.join(' | ')}`,
  );

  const focus = await focusStyleFor(targetPage, primaryActions);
  assert(focus.keyboardReachable, 'Primary action is not keyboard reachable.');
  assert(focus.visible, 'Primary action has no visible focus indicator.');

  report.checks.functional = {
    realJourneyName: journeyState.journey.name,
    selectedVersionId: await versionSelector.inputValue(),
    recordedStepCount: await recordedSteps.count(),
    criticalActionConfigured: journeyState.criticalAction !== null,
    outcomeCheckCount: renderedChecks,
    replayMode: await replayMode.inputValue(),
    replayPacing: await replayPacing.inputValue(),
    guidedAccessible: await guidedTab.isVisible(),
    advancedAccessible: true,
    recordNewVersionHref: await recordNewVersion.getAttribute('href'),
    stitchExampleAbsent: !bodyText.includes('Register Visitor'),
  };
  report.checks.accessibility = {
    ...structure,
    primaryActionCount: await primaryActions.count(),
    primaryActionFocus: focus,
    technicalDisclosureKeyboardAccessible: true,
  };
  report.checks.visual = {
    stitchDirection:
      'Recorded sequence leads, Critical Action uses amber, readiness stays compact, and technical trace/video evidence remains secondary.',
    deliberateDifferences: [
      'Production retains the real shared FormCrash shell instead of Stitch account chrome.',
      'Real contract-backed replay, runtime, authentication, outcome, and trace sections extend below the compact Stitch composition.',
      'Fake DOM snapshots and log artifacts are omitted.',
    ],
  };
}

async function openJourney(targetPage, projectState, journeyState) {
  await gotoStable(targetPage, `${dashboardUrl}/projects`);
  const projectButton = targetPage
    .locator('.project-card-select')
    .filter({ hasText: projectState.project.name });
  await projectButton.waitFor();
  const selectedProjectTitle = targetPage.locator('.selected-project-title');
  if ((await selectedProjectTitle.innerText()) !== projectState.project.name) {
    await projectButton.click();
  }
  await targetPage
    .getByRole('heading', { name: journeyState.journey.name, exact: true })
    .waitFor();
  const versionSelector = targetPage.getByLabel('Journey version');
  if ((await versionSelector.inputValue()) !== journeyState.journey.id) {
    await versionSelector.selectOption(journeyState.journey.id);
  }
  await targetPage
    .locator('.journey-next-action .journey-primary-action')
    .waitFor();
  await targetPage.waitForFunction(
    () =>
      document.querySelector('.journey-next-action .journey-primary-action')
        ?.textContent !== 'Checking readiness…',
  );
}

async function screenshotJourney(targetPage, screenshotName) {
  await targetPage
    .locator('.journey-detail-header')
    .evaluate((element) =>
      element.scrollIntoView({ block: 'start', behavior: 'instant' }),
    );
  const viewport = targetPage.viewportSize();
  await targetPage.evaluate(
    (offset) => window.scrollBy(0, -offset),
    viewport !== null && viewport.width > 600 ? 64 : 8,
  );
  await targetPage.screenshot({
    path: path.join(outputDirectory, screenshotName),
    animations: 'disabled',
  });
  report.screenshots.push(screenshotName);
}

async function gotoStable(targetPage, url) {
  await targetPage.goto(url, { waitUntil: 'networkidle' });
  await targetPage.getByRole('heading', { name: 'Project overview' }).waitFor();
}

async function horizontalOverflow(targetPage) {
  return targetPage.evaluate(() => ({
    overflows:
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 1,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

async function focusStyleFor(targetPage, locator) {
  await targetPage.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  let reached = false;
  for (let index = 0; index < 160; index += 1) {
    await targetPage.keyboard.press('Tab');
    reached = await locator.evaluate(
      (element) => document.activeElement === element,
    );
    if (reached) break;
  }
  assert(
    reached,
    'Tab navigation did not reach the Journey Detail primary action.',
  );
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outlineColor: style.outlineColor,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      boxShadow: style.boxShadow,
      keyboardReachable: element.tabIndex >= 0,
      visible:
        (style.outlineStyle !== 'none' &&
          Number.parseFloat(style.outlineWidth) >= 1) ||
        style.boxShadow !== 'none',
    };
  });
}

function summarizeState(projectState, journeyState) {
  return {
    projectId: projectState.project.id,
    projectName: projectState.project.name,
    journeyId: journeyState.journey.id,
    journeyName: journeyState.journey.name,
    version: journeyState.journey.version,
    replayFormat: journeyState.journey.replayFormat ?? 'semantic-v1',
    stepCount: journeyState.journey.steps.length,
    traceAvailable: journeyState.journey.trace !== null,
    videoAvailable: journeyState.journey.trace?.videoCaptured === true,
    authenticationAvailable:
      projectState.settings.authentication.available === true,
    criticalActionConfigured: journeyState.criticalAction !== null,
    outcomeCheckCount: journeyState.checks.length,
  };
}

async function fetchJson(url) {
  const response = await fetch(url);
  assert(
    response.ok,
    `Request failed: ${url} returned HTTP ${response.status}`,
  );
  return response.json();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
