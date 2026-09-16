import Hero from './components/Hero';
import styles from './page.module.css';

/**
 * The marketing landing page.
 *
 * Gate 1 scope is the hero and nothing else. The section below it exists for
 * one reason: the hero's secondary CTA points at #how-it-works, and shipping a
 * link to an id that is not on the page is a broken link, not a placeholder.
 * It is a STUB — the real "how it works" content is not part of this task.
 */
export default function Home() {
  return (
    <main>
      <Hero />

      <section className={styles.stub} id="how-it-works" aria-labelledby="how-it-works-heading">
        <h2 className={styles.stubHeading} id="how-it-works-heading">
          How it works
        </h2>
        <p className={styles.stubBody}>
          Placeholder. This section is the scroll target for the hero&rsquo;s secondary call to
          action and is not part of the hero task.
        </p>
      </section>
    </main>
  );
}
