/* global Element, document, fetch, getComputedStyle, window */

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
    projectOverview: {},
    runsList: {},
    navigation: {},
    accessibility: {},
  },
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
  report.services[name] = { connected: true, status: response.status };
}

const projectsResponse = await fetch(`${serverUrl}/api/projects`);
const projectsPayload = await projectsResponse.json();
const runsResponse = await fetch(`${serverUrl}/api/runs?limit=12&offset=0`);
const runsPayload = await runsResponse.json();
assert(
  projectsPayload.items.length > 0,
  'No persisted projects are available.',
);
assert(
  runsPayload.items.length > 0,
  'No persisted bundled runs are available.',
);
report.realData = {
  projects: projectsPayload.items.map((project) => ({
    id: project.id,
    name: project.name,
    targetUrl: project.targetUrl,
    environment: project.environment,
  })),
  runs: runsPayload.items.map((run) => ({
    runId: run.runId,
    mode: run.mode,
    status: run.status,
    assertionStatus: run.assertionStatus,
    screenshotCount: run.screenshotCount,
  })),
};

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
  await captureProjectOverview(page, projectsPayload.items);
  await captureRunsList(page, runsPayload.items);
  await checkNavigation(page);
} finally {
  await context.close();
  await browser.close();
}

await writeJson(path.join(outputDirectory, 'qa-results.json'), report);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

async function captureProjectOverview(targetPage, projects) {
  const viewports = [
    { width: 1440, height: 1000 },
    { width: 1366, height: 900 },
    { width: 1024, height: 768 },
  ];
  const overflowChecks = {};

  for (const viewport of viewports) {
    await targetPage.setViewportSize(viewport);
    await gotoStable(targetPage, `${dashboardUrl}/projects`, 'h1');
    await targetPage
      .getByRole('heading', { name: 'Project overview' })
      .waitFor();
    await targetPage
      .getByText(projects[0].name, { exact: true })
      .first()
      .waitFor();
    await waitForProjectDetails(targetPage);
    const screenshotName = `project-overview-${viewport.width}.png`;
    await targetPage.screenshot({
      path: path.join(outputDirectory, screenshotName),
      animations: 'disabled',
    });
    report.screenshots.push(screenshotName);
    overflowChecks[viewport.width] = await horizontalOverflow(targetPage);
  }

  const common = await inspectCommonStructure(targetPage);
  const projectText = await targetPage.locator('body').innerText();
  const currentNavigation = await currentNavigationItems(targetPage);
  const primaryAction = targetPage.getByRole('link', {
    name: 'Record a journey',
  });
  const primaryHref = await primaryAction.getAttribute('href');
  const guidedTab = targetPage.getByRole('tab', { name: /Guided Test/ });
  const advancedTab = targetPage.getByRole('tab', { name: /Advanced/ });
  const persistedResultButtons = targetPage.getByRole('button', {
    name: 'View result',
  });
  const projectCodeWidths = await targetPage
    .locator('.project-card-select code')
    .evaluateAll((elements) =>
      elements.map((element) => ({
        text: element.textContent,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        overflow: getComputedStyle(element).overflow,
        textOverflow: getComputedStyle(element).textOverflow,
      })),
    );
  const focusStyle = await focusStyleFor(primaryAction);
  const contrast = {
    title: await contrastSnapshotFor(targetPage.locator('h1')),
    description: await contrastSnapshotFor(
      targetPage.locator('.project-overview-heading .hero-statement'),
    ),
    primaryAction: await contrastSnapshotFor(primaryAction),
    environmentStatus: await contrastSnapshotFor(
      targetPage.locator('.selected-project-overview .status-badge'),
    ),
  };
  const fakeTerms = findFakeTerms(projectText);

  assert(
    currentNavigation.length === 1,
    'Project Overview must have one current navigation item.',
  );
  assert(
    currentNavigation[0] === 'External Projects',
    'External Projects must be current on /projects.',
  );
  assert(
    primaryHref === '#recording-workspace',
    'Project primary action must target the recording workflow.',
  );
  assert(
    await primaryAction.isVisible(),
    'Project primary action is not visible.',
  );
  assert((await guidedTab.count()) === 1, 'Guided Test is not accessible.');
  assert((await advancedTab.count()) === 1, 'Advanced mode is not accessible.');
  assert(
    fakeTerms.length === 0,
    `Fake Stitch content found on Project Overview: ${fakeTerms.join(', ')}`,
  );
  assert(
    Object.values(overflowChecks).every((check) => !check.overflows),
    'Project Overview horizontally overflows.',
  );
  assert(
    common.mainCount === 1 && common.nestedMainCount === 0,
    'Project Overview has invalid main landmarks.',
  );
  assert(
    common.unnamedInteractiveCount === 0,
    'Project Overview has unnamed buttons or links.',
  );
  assert(
    focusStyle.visible,
    'Project primary action has no visible focus indicator.',
  );
  assert(
    Object.values(contrast).every((sample) => sample.ratio >= 4.5),
    'Project Overview key text contrast fell below 4.5:1.',
  );

  const incompleteProjectButton = targetPage
    .locator('.project-card-select')
    .filter({ hasText: 'Outcome Walkthrough Fixture' });
  let incompleteStateCaptured = false;
  if ((await incompleteProjectButton.count()) === 1) {
    await targetPage.setViewportSize({ width: 1440, height: 1000 });
    await incompleteProjectButton.click();
    await targetPage
      .locator('.selected-project-title')
      .filter({ hasText: 'Outcome Walkthrough Fixture' })
      .waitFor();
    await waitForProjectDetails(targetPage);
    await targetPage
      .locator('.selected-project-overview')
      .scrollIntoViewIfNeeded();
    await targetPage.evaluate(() => window.scrollBy(0, -72));
    const incompleteScreenshot = 'project-overview-incomplete-1440.png';
    await targetPage.screenshot({
      path: path.join(outputDirectory, incompleteScreenshot),
      animations: 'disabled',
    });
    report.screenshots.push(incompleteScreenshot);
    incompleteStateCaptured = true;

    const originalProjectButton = targetPage
      .locator('.project-card-select')
      .filter({ hasText: projects[0].name });
    await originalProjectButton.click();
    await targetPage
      .locator('.selected-project-title')
      .filter({ hasText: projects[0].name })
      .waitFor();
    await waitForProjectDetails(targetPage);
  }

  await advancedTab.click();
  await targetPage
    .getByRole('heading', { name: 'Authentication and runtime inputs' })
    .waitFor();
  const advancedPersistedResultCount = await persistedResultButtons.count();

  report.checks.projectOverview = {
    renderedProjectNames: projects
      .map((project) => project.name)
      .filter((name) => projectText.includes(name)),
    currentNavigation,
    primaryAction: { visible: true, href: primaryHref, focusStyle },
    contrast,
    guidedAccessible: (await guidedTab.count()) === 1,
    advancedAccessible: (await advancedTab.count()) === 1,
    persistedResultButtonCount: advancedPersistedResultCount,
    incompleteStateCaptured,
    overflowChecks,
    projectCodeWidths,
    fakeTerms,
    ...common,
  };

  if (advancedPersistedResultCount > 0) {
    await targetPage.setViewportSize({ width: 1440, height: 1000 });
    await persistedResultButtons.first().scrollIntoViewIfNeeded();
    await persistedResultButtons.first().click();
    await targetPage.locator('.external-result').waitFor();
    await targetPage.locator('.external-result').scrollIntoViewIfNeeded();
    await targetPage.evaluate(() => window.scrollBy(0, -72));
    const resultScreenshot = 'project-overview-latest-result-1440.png';
    await targetPage.screenshot({
      path: path.join(outputDirectory, resultScreenshot),
      animations: 'disabled',
    });
    report.screenshots.push(resultScreenshot);
    report.checks.projectOverview.latestPersistedResultLoaded = true;
  }
}

async function captureRunsList(targetPage, runs) {
  const viewports = [
    { width: 1440, height: 1000 },
    { width: 1366, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ];
  const overflowChecks = {};
  const responsiveStyles = {};

  for (const viewport of viewports) {
    await targetPage.setViewportSize(viewport);
    await gotoStable(
      targetPage,
      `${dashboardUrl}/#history-title`,
      '#history-title',
    );
    await targetPage.locator('.run-history-table tbody tr').first().waitFor();
    await targetPage.locator('.run-history-panel').scrollIntoViewIfNeeded();
    await targetPage.evaluate(() => window.scrollBy(0, -64));
    const screenshotName = `runs-list-${viewport.width}.png`;
    await targetPage.screenshot({
      path: path.join(outputDirectory, screenshotName),
      animations: 'disabled',
    });
    report.screenshots.push(screenshotName);
    overflowChecks[viewport.width] = await horizontalOverflow(targetPage);
    responsiveStyles[viewport.width] = await targetPage.evaluate(() => {
      const table = document.querySelector('.run-history-table');
      const head = table?.querySelector('thead');
      const row = table?.querySelector('tbody tr');
      const cell = row?.querySelector('td');
      return {
        tableDisplay: table ? getComputedStyle(table).display : null,
        theadDisplay: head ? getComputedStyle(head).display : null,
        rowDisplay: row ? getComputedStyle(row).display : null,
        cellDisplay: cell ? getComputedStyle(cell).display : null,
      };
    });
  }

  await targetPage.setViewportSize({ width: 1440, height: 1000 });
  await gotoStable(
    targetPage,
    `${dashboardUrl}/#history-title`,
    '#history-title',
  );
  await targetPage.locator('.run-history-table tbody tr').first().waitFor();
  const common = await inspectCommonStructure(targetPage);
  const rows = targetPage.locator('.run-history-table tbody tr');
  const runLinks = targetPage.locator('.run-history-primary-link');
  const bodyText = await targetPage.locator('body').innerText();
  const firstRunId = runs[0].runId;
  const firstLink = runLinks.first();
  const firstHref = await firstLink.getAttribute('href');
  const statusTexts = await targetPage
    .locator('.run-history-table .status-badge')
    .allInnerTexts();
  const normalizedStatusTexts = statusTexts.map((status) =>
    status.trim().toLowerCase(),
  );
  const runIdStyle = await firstLink.locator('code').evaluate((element) => {
    const style = getComputedStyle(element);
    const heading = element.previousElementSibling;
    const headingStyle = heading ? getComputedStyle(heading) : null;
    return {
      color: style.color,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      headingFontSize: headingStyle?.fontSize ?? null,
      visuallySecondary:
        headingStyle !== null &&
        Number.parseFloat(style.fontSize) <=
          Number.parseFloat(headingStyle.fontSize),
    };
  });
  const focusStyle = await focusStyleFor(firstLink);
  const contrast = {
    title: await contrastSnapshotFor(targetPage.locator('#history-title')),
    tableHeader: await contrastSnapshotFor(
      targetPage.locator('.run-history-table th').first(),
    ),
    outcome: await contrastSnapshotFor(
      targetPage
        .locator('.run-history-table td[data-label="Observed outcome"] strong')
        .first(),
    ),
    failedStatus: await contrastSnapshotFor(
      targetPage.locator('.run-history-table .status-tone-failure').first(),
    ),
    passedStatus: await contrastSnapshotFor(
      targetPage.locator('.run-history-table .status-tone-pass').first(),
    ),
  };
  const fakeTerms = findFakeTerms(bodyText);
  const headers = await targetPage
    .locator('.run-history-table th')
    .evaluateAll((elements) =>
      elements.map((element) => ({
        text: element.textContent?.trim(),
        scope: element.getAttribute('scope'),
      })),
    );

  assert(
    (await rows.count()) === runs.length,
    'Rendered run count does not match the persisted API response.',
  );
  assert(
    firstHref === `/runs/${firstRunId}`,
    'The first result link does not point to its real run route.',
  );
  assert(
    normalizedStatusTexts.includes('failed') &&
      normalizedStatusTexts.includes('passed'),
    'Available failed and passed statuses are not both represented.',
  );
  assert(
    Object.values(overflowChecks).every((check) => !check.overflows),
    'Runs List horizontally overflows.',
  );
  assert(
    responsiveStyles[390].theadDisplay === 'none',
    'Mobile table header was not visually collapsed.',
  );
  assert(
    responsiveStyles[390].rowDisplay === 'block',
    'Mobile runs did not transform into cards.',
  );
  assert(
    responsiveStyles[390].cellDisplay === 'grid',
    'Mobile run fields are not readable key-value rows.',
  );
  assert(
    headers.every((header) => header.scope === 'col'),
    'Run table headers lack column scope.',
  );
  assert(
    fakeTerms.length === 0,
    `Fake Stitch content found on Runs List: ${fakeTerms.join(', ')}`,
  );
  assert(
    common.mainCount === 1 && common.nestedMainCount === 0,
    'Runs List has invalid main landmarks.',
  );
  assert(
    common.unnamedInteractiveCount === 0,
    'Runs List has unnamed buttons or links.',
  );
  assert(focusStyle.visible, 'Run result link has no visible focus indicator.');
  assert(
    Object.values(contrast).every((sample) => sample.ratio >= 4.5),
    'Runs List key text contrast fell below 4.5:1.',
  );

  report.checks.runsList = {
    renderedRunCount: await rows.count(),
    persistedRunCount: runs.length,
    firstRunId,
    firstHref,
    availableStatuses: [...new Set(runs.map((run) => run.status))],
    statusTexts: [...new Set(statusTexts.map((status) => status.trim()))],
    overflowChecks,
    responsiveStyles,
    tableHeaders: headers,
    runIdStyle,
    resultLinkFocusStyle: focusStyle,
    contrast,
    fakeTerms,
    ...common,
  };

  await Promise.all([
    targetPage.waitForURL(new RegExp(`/runs/${firstRunId}$`)),
    firstLink.click(),
  ]);
  await targetPage.locator('main').waitFor();
  report.checks.runsList.realResultRouteOpened = targetPage.url();
}

async function checkNavigation(targetPage) {
  await targetPage.setViewportSize({ width: 1440, height: 1000 });
  await gotoStable(targetPage, dashboardUrl, 'main');
  const states = [];

  const projectsLink = targetPage.getByRole('link', {
    name: 'External Projects',
    exact: true,
  });
  await projectsLink.click();
  await targetPage.waitForURL(`${dashboardUrl}/projects`);
  states.push({
    action: 'External Projects',
    url: targetPage.url(),
    current: await currentNavigationItems(targetPage),
  });

  const sampleLink = targetPage.getByRole('link', {
    name: 'Sample Checkout',
    exact: true,
  });
  await sampleLink.click();
  await targetPage.waitForURL(`${dashboardUrl}/`);
  states.push({
    action: 'Sample Checkout',
    url: targetPage.url(),
    current: await currentNavigationItems(targetPage),
  });

  const runsLink = targetPage.getByRole('link', { name: 'Runs', exact: true });
  await runsLink.click();
  await targetPage.waitForURL(`${dashboardUrl}/#history-title`);
  await targetPage.locator('#history-title').waitFor();
  states.push({
    action: 'Runs',
    url: targetPage.url(),
    current: await currentNavigationItems(targetPage),
  });

  for (const state of states) {
    assert(
      state.current.length === 1,
      `${state.action} navigation produced ${state.current.length} current items.`,
    );
    assert(
      state.current[0] === state.action,
      `${state.action} navigation marked ${state.current[0]} current.`,
    );
  }
  report.checks.navigation = { states };
}

async function gotoStable(targetPage, url, readySelector) {
  await targetPage.goto(url, { waitUntil: 'domcontentloaded' });
  await targetPage.locator(readySelector).first().waitFor({ state: 'visible' });
  await targetPage.waitForLoadState('networkidle');
  await targetPage.evaluate(() => document.fonts.ready);
}

async function waitForProjectDetails(targetPage) {
  await targetPage.waitForFunction(() => {
    const facts = document.querySelector('.selected-project-facts');
    return facts !== null && !facts.textContent?.includes('Checking…');
  });
}

async function inspectCommonStructure(targetPage) {
  return targetPage.evaluate(() => {
    const headings = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')]
      .filter((element) => {
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
      })
      .map((element) => ({
        level: Number(element.tagName.slice(1)),
        text: element.textContent?.trim() ?? '',
      }));
    const skippedHeadingLevels = headings.filter(
      (heading, index) =>
        index > 0 && heading.level > headings[index - 1].level + 1,
    );
    const unnamedInteractive = [
      ...document.querySelectorAll('a, button'),
    ].filter((element) => {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden')
        return false;
      const name =
        element.getAttribute('aria-label') ??
        element.getAttribute('title') ??
        element.textContent?.trim() ??
        '';
      return name.length === 0;
    });
    let reducedMotionPresent = false;
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.cssText.includes('prefers-reduced-motion'))
            reducedMotionPresent = true;
        }
      } catch {
        // All production stylesheets are same-origin; ignore browser-owned sheets.
      }
    }
    const skipLink = document.querySelector('.skip-link');
    return {
      mainCount: document.querySelectorAll('main').length,
      nestedMainCount: document.querySelectorAll('main main').length,
      skipLink: {
        exists: skipLink !== null,
        href: skipLink?.getAttribute('href') ?? null,
        targetExists:
          skipLink?.getAttribute('href') === '#main-content' &&
          document.querySelector('#main-content') !== null,
      },
      headings,
      skippedHeadingLevels,
      unnamedInteractiveCount: unnamedInteractive.length,
      reducedMotionPresent,
    };
  });
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

async function currentNavigationItems(targetPage) {
  return targetPage
    .locator('.app-navigation-link[aria-current="page"]')
    .allInnerTexts();
}

async function focusStyleFor(locator) {
  await locator.focus();
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

async function contrastSnapshotFor(locator) {
  return locator.evaluate((element) => {
    const parseColor = (value) => {
      const channels = value.match(/[\d.]+/gu)?.map(Number) ?? [];
      return {
        red: channels[0] ?? 0,
        green: channels[1] ?? 0,
        blue: channels[2] ?? 0,
        alpha: channels[3] ?? 1,
      };
    };
    const luminance = (color) => {
      const channels = [color.red, color.green, color.blue].map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const foregroundText = getComputedStyle(element).color;
    let backgroundText = 'rgb(10, 13, 18)';
    let candidate = element;
    while (candidate instanceof Element) {
      const candidateBackground = getComputedStyle(candidate).backgroundColor;
      if (parseColor(candidateBackground).alpha >= 0.95) {
        backgroundText = candidateBackground;
        break;
      }
      candidate = candidate.parentElement;
    }
    const foregroundLuminance = luminance(parseColor(foregroundText));
    const backgroundLuminance = luminance(parseColor(backgroundText));
    const lighter = Math.max(foregroundLuminance, backgroundLuminance);
    const darker = Math.min(foregroundLuminance, backgroundLuminance);
    return {
      foreground: foregroundText,
      background: backgroundText,
      ratio: Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2)),
    };
  });
}

function findFakeTerms(text) {
  const terms = [
    'SQL_INJECTION',
    'CORS_BYPASS',
    'Scheduled',
    'Archived',
    'Trigger Run',
    'Security score',
    'Reproducibility score',
    'Search workbench',
    'Project Switcher',
  ];
  return terms.filter((term) => text.includes(term));
}

async function writeJson(filePath, value) {
  const { writeFile } = await import('node:fs/promises');
  const { format } = await import('prettier');
  const formatted = await format(JSON.stringify(value), { parser: 'json' });
  await writeFile(filePath, formatted, 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
