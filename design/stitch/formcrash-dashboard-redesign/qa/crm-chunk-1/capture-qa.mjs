/* global document, fetch, getComputedStyle */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

import { chromium } from '../../../../../apps/server/node_modules/playwright/index.mjs';

const dashboardUrl = 'http://localhost:3000';
const serverUrl = 'http://localhost:4100';
const sampleUrl = 'http://localhost:4200';
const outputDirectory = path.dirname(fileURLToPath(import.meta.url));
const viewports = [
  { width: 1440, height: 1000 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
];

const report = {
  generatedAt: new Date().toISOString(),
  services: {},
  realData: {},
  browserVersion: null,
  screenshots: [],
  checks: {},
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

const project = await selectQaProject();
const projectSettings = await fetchJson(
  `${serverUrl}/api/projects/${project.id}/settings`,
);
const secretHookValues = [
  ...Object.values(projectSettings.beforeRunHook?.headers ?? {}),
  ...Object.values(projectSettings.afterRunHook?.headers ?? {}),
].filter((value) => typeof value === 'string' && value.length > 0);

report.realData = {
  project: {
    id: project.id,
    name: project.name,
    environment: project.environment,
    targetUrl: project.targetUrl,
  },
  scenarioCount: project.scenarios.length,
  configurationCount: project.configurations.length,
  runCount: project.runs.length,
};

const surfaces = [
  { key: 'projects', path: '/projects', heading: 'Projects', table: true },
  {
    key: 'overview',
    path: `/projects/${project.id}`,
    heading: 'Overview',
    table: true,
  },
  {
    key: 'scenarios',
    path: `/projects/${project.id}/scenarios`,
    heading: 'Scenarios',
    table: true,
  },
  {
    key: 'runs',
    path: `/projects/${project.id}/runs`,
    heading: 'Runs',
    table: true,
  },
  {
    key: 'settings',
    path: `/projects/${project.id}/settings`,
    heading: 'Settings',
    table: false,
  },
];

const browser = await chromium.launch({ headless: true });
report.browserVersion = browser.version();
const context = await browser.newContext({
  colorScheme: 'dark',
  reducedMotion: 'reduce',
});
const page = await context.newPage();
let activeCapture = 'initialization';

page.on('console', (message) => {
  if (message.type() === 'error') {
    report.consoleErrors.push({ capture: activeCapture, text: message.text() });
  }
});
page.on('pageerror', (error) => {
  report.pageErrors.push({ capture: activeCapture, text: error.message });
});

try {
  for (const surface of surfaces) {
    report.checks[surface.key] = {};
    for (const viewport of viewports) {
      activeCapture = `${surface.key}-${viewport.width}x${viewport.height}`;
      await page.setViewportSize(viewport);
      await gotoStable(page, `${dashboardUrl}${surface.path}`, surface.heading);
      const screenshotName = `${activeCapture}.png`;
      await page.screenshot({
        animations: 'disabled',
        path: path.join(outputDirectory, screenshotName),
      });
      report.screenshots.push(screenshotName);
      report.checks[surface.key][`${viewport.width}x${viewport.height}`] =
        await inspectSurface(page, surface, viewport, secretHookValues);
    }
  }

  await verifyMobileDrawer(page);
} finally {
  await context.close();
  await browser.close();
}

assert(report.screenshots.length === 15, 'Expected exactly 15 screenshots.');
assert(report.consoleErrors.length === 0, 'Console errors were recorded.');
assert(report.pageErrors.length === 0, 'Uncaught page errors were recorded.');

await writeJson(path.join(outputDirectory, 'qa-results.json'), report);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

async function selectQaProject() {
  const projects = (await fetchJson(`${serverUrl}/api/projects`)).items;
  const candidates = [];
  for (const candidate of projects) {
    if (
      candidate.environment === 'production' ||
      candidate.id === 'project-sample-checkout'
    ) {
      continue;
    }
    const [scenarioPayload, configurations, runsPayload] = await Promise.all([
      fetchJson(`${serverUrl}/api/projects/${candidate.id}/journeys`),
      fetchJson(`${serverUrl}/api/projects/${candidate.id}/experiments`),
      fetchJson(
        `${serverUrl}/api/external-runs?projectId=${candidate.id}&limit=100&offset=0`,
      ),
    ]);
    const scenarios = scenarioPayload.items;
    const runs = runsPayload.items;
    if (scenarios.length > 0 && runs.length > 0) {
      candidates.push({
        ...candidate,
        scenarios,
        configurations: configurations.items,
        runs,
      });
    }
  }
  candidates.sort(
    (left, right) =>
      right.runs.length +
      right.scenarios.length -
      (left.runs.length + left.scenarios.length),
  );
  assert(
    candidates.length > 0,
    'No persisted non-production project has both Scenarios and Runs.',
  );
  return candidates[0];
}

async function gotoStable(targetPage, url, heading) {
  await targetPage.goto(url, { waitUntil: 'domcontentloaded' });
  await targetPage
    .getByRole('heading', { name: heading, exact: true })
    .waitFor();
  await targetPage.waitForFunction(() => {
    const loading = [...document.querySelectorAll('[role="status"]')].some(
      (element) => element.textContent?.toLowerCase().includes('loading'),
    );
    return !loading;
  });
  await targetPage.evaluate(() => document.fonts.ready);
}

async function inspectSurface(targetPage, surface, viewport, secretValues) {
  const structure = await targetPage.evaluate(
    ({ surfaceKey, tableExpected, viewportWidth }) => {
      const root = document.documentElement;
      const sidebar = document.querySelector('.app-sidebar');
      const topbar = document.querySelector('.project-context-bar');
      const projectNavigation = document.querySelector('.crm-project-tabs');
      const table = document.querySelector('.crm-table');
      const tableHead = table?.querySelector('thead');
      const tableRow = table?.querySelector('tbody tr');
      const tableCell = tableRow?.querySelector('td');
      const main = document.querySelector('main');
      const focusTarget =
        main?.querySelector('a[href], button:not([disabled]), input, select') ??
        document.querySelector('.app-menu-button');
      focusTarget?.focus();
      const focusStyle = focusTarget ? getComputedStyle(focusTarget) : null;
      const sidebarStyle = sidebar ? getComputedStyle(sidebar) : null;
      const topbarStyle = topbar ? getComputedStyle(topbar) : null;
      const overviewLayout = document.querySelector('.crm-overview-layout');
      const overviewColumns = overviewLayout
        ? getComputedStyle(overviewLayout).gridTemplateColumns
        : null;
      const bodyText = document.body.innerText;
      const fakeTerms = [
        'Security score',
        'Notification center',
        'Export CSV',
        'Scheduled Runs',
        'Reproducibility score',
      ].filter((term) => bodyText.includes(term));
      const headers = table
        ? [...table.querySelectorAll('th')].map((header) => ({
            text: header.textContent?.trim() ?? '',
            scope: header.getAttribute('scope'),
          }))
        : [];
      return {
        surfaceKey,
        viewportWidth,
        mainCount: document.querySelectorAll('main').length,
        horizontalOverflow: root.scrollWidth > root.clientWidth + 1,
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
        sidebar: {
          display: sidebarStyle?.display ?? null,
          position: sidebarStyle?.position ?? null,
          width: sidebarStyle?.width ?? null,
          transform: sidebarStyle?.transform ?? null,
        },
        topbarHeight: topbarStyle?.height ?? null,
        projectNavigationVisible:
          projectNavigation !== null &&
          getComputedStyle(projectNavigation).display !== 'none',
        tableExpected,
        tablePresent: table !== null,
        tableHeaders: headers,
        tableResponsive: {
          headDisplay: tableHead ? getComputedStyle(tableHead).display : null,
          rowDisplay: tableRow ? getComputedStyle(tableRow).display : null,
          cellDisplay: tableCell ? getComputedStyle(tableCell).display : null,
        },
        overviewColumns,
        focusVisible:
          focusStyle !== null &&
          ((focusStyle.outlineStyle !== 'none' &&
            Number.parseFloat(focusStyle.outlineWidth) >= 1) ||
            focusStyle.boxShadow !== 'none'),
        fakeTerms,
        bodyText,
      };
    },
    {
      surfaceKey: surface.key,
      tableExpected: surface.table,
      viewportWidth: viewport.width,
    },
  );

  assert(structure.mainCount === 1, `${activeCapture} must have one main.`);
  assert(
    !structure.horizontalOverflow,
    `${activeCapture} has horizontal page overflow.`,
  );
  assert(
    structure.fakeTerms.length === 0,
    `${activeCapture} contains fake UI.`,
  );
  assert(
    structure.focusVisible,
    `${activeCapture} has no visible focus style.`,
  );
  if (surface.table) {
    assert(structure.tablePresent, `${activeCapture} has no record table.`);
    assert(
      structure.tableHeaders.every((header) => header.scope === 'col'),
      `${activeCapture} has table headers without column scope.`,
    );
    if (viewport.width === 390) {
      assert(
        structure.tableResponsive.headDisplay === 'none',
        `${activeCapture} did not hide its desktop table header.`,
      );
      assert(
        structure.tableResponsive.rowDisplay === 'block',
        `${activeCapture} did not convert rows to cards.`,
      );
    }
  }
  if (viewport.width >= 1024) {
    assert(
      structure.sidebar.position === 'fixed' &&
        structure.sidebar.width === '256px',
      `${activeCapture} does not have a fixed 256px sidebar.`,
    );
  }
  if (surface.key !== 'projects') {
    assert(
      structure.projectNavigationVisible,
      `${activeCapture} is missing project navigation.`,
    );
  }
  if (surface.key === 'overview' && viewport.width === 1440) {
    assert(
      structure.overviewColumns?.split(' ').length >= 2,
      'Desktop Overview is not a two-column composition.',
    );
  }
  for (const secret of secretValues) {
    assert(
      !structure.bodyText.includes(secret),
      `${activeCapture} leaked a configured hook value.`,
    );
  }

  delete structure.bodyText;
  return structure;
}

async function verifyMobileDrawer(targetPage) {
  await targetPage.setViewportSize({ width: 390, height: 844 });
  await gotoStable(targetPage, `${dashboardUrl}/projects`, 'Projects');
  const trigger = targetPage.getByRole('button', { name: 'Open navigation' });
  await trigger.click();
  const sidebar = targetPage.getByLabel('Application sidebar');
  await sidebar.getByRole('link', { name: 'Projects' }).waitFor();
  assert(
    await sidebar
      .getByRole('link', { name: 'Projects' })
      .evaluate((element) => element === document.activeElement),
    'The mobile drawer did not receive focus.',
  );
  await targetPage.keyboard.press('Escape');
  await targetPage.waitForFunction(
    (element) => element === document.activeElement,
    await trigger.elementHandle(),
  );
  assert(
    await trigger.evaluate((element) => element === document.activeElement),
    'The mobile drawer did not restore focus.',
  );
  report.checks.mobileDrawer = {
    opened: true,
    receivedFocus: true,
    escapeClosed: true,
    restoredFocus: true,
  };
}

async function fetchJson(url) {
  const response = await fetch(url);
  assert(response.ok, `${url} returned HTTP ${response.status}.`);
  return response.json();
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
