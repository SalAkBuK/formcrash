import { getServerBaseUrl } from '../lib/api-client';

export default function HomePage() {
  return (
    <main>
      <section className="shell">
        <div className="eyebrow">Architecture bootstrap</div>
        <h1>FormCrash Lab</h1>
        <p>
          A local workbench for controlled resilience testing of transactional
          web journeys before release.
        </p>
        <div className="status">
          Control server configured at {getServerBaseUrl()}
        </div>
      </section>
    </main>
  );
}
