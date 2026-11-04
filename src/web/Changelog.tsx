import React, {useEffect} from 'react';
import {ArrowLeft, ArrowUpRight} from 'lucide-react';
import changelog from '../shared/changelog.json';
import './changelog.css';

const publishedDate = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
});

export default function Changelog() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'What’s new · Stați';
    return () => { document.title = previousTitle; };
  }, []);

  return <div className="shell changelog-page">
    <header className="changelog-header">
      <a href="/" className="brand"><img src="/brand-icon.png" alt=""/>Stați</a>
      <a href="/" className="changelog-back"><ArrowLeft size={17}/>Back to Stați</a>
    </header>
    <main id="changelog-content">
      <div className="changelog-intro">
        <h1>What’s new</h1>
        <p>Published Stați updates, available even if your app is on an older version.</p>
      </div>
      <div className="changelog-releases">
        {changelog.releases.map((release, index) => <article className="changelog-release" key={release.version} aria-labelledby={'release-' + release.version}>
          <div className="changelog-meta">
            <strong>{release.label}</strong>
            {index === 0 && <span className="changelog-latest">Latest published</span>}
            <time dateTime={release.publishedAt}>{publishedDate.format(new Date(release.publishedAt))}</time>
          </div>
          <h2 id={'release-' + release.version}>{release.title}</h2>
          <p className="changelog-platforms">{release.areas.join(' · ')} <span aria-hidden="true">·</span> {release.version}</p>
          <ul>{release.highlights.map(highlight => <li key={highlight}>{highlight}</li>)}</ul>
          <a className="changelog-notes" href={release.url} target="_blank" rel="noopener noreferrer">Release details<ArrowUpRight size={16}/><span className="sr-only"> for {release.label} (opens in a new tab)</span></a>
        </article>)}
      </div>
      <p className="changelog-preview-note">Windows releases are unsigned previews. Verification on the church PC, iPhone and ProPresenter is still in progress.</p>
    </main>
  </div>;
}
