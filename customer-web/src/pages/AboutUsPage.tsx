import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BadgeCheck, Leaf, LifeBuoy, MapPinned, ShieldCheck, Store, Target, Zap } from 'lucide-react';
import { fetchContentPage } from '../api/content';
import Loader from '../components/Loader';

// About Us. The words are the admin-edited "About Us" content page (Admin > Content Pages); this
// page only lays them out. Each heading (h2) starts a section, shown according to what it holds:
//   a list under a "How ..." heading, or a numbered list  -> numbered step cards
//   any other list                                       -> a checklist card
//   a "Get in touch" / "Contact" heading                 -> the closing call-to-action band
//   text only                                            -> side-by-side cards
// so edits in the admin carry straight over, and an unfamiliar heading still gets a plain card.
// Same trust level as components/ContentPageView.tsx: admin-authored HTML, not user input.

type Kind = 'text' | 'steps' | 'checklist' | 'contact';
type Section = { heading: string; html: string; kind: Kind };

const HIGHLIGHTS = [
  { icon: Zap, label: 'Delivery in minutes' },
  { icon: Store, label: 'From your local store' },
  { icon: ShieldCheck, label: 'Secure payments' },
];

function splitSections(content: string): Section[] {
  const doc = new DOMParser().parseFromString(content, 'text/html');
  const groups: { heading: string; body: HTMLElement }[] = [];
  for (const node of Array.from(doc.body.childNodes)) {
    if (node.nodeName === 'H2') {
      groups.push({ heading: node.textContent?.trim() ?? '', body: doc.createElement('div') });
    } else if (node.nodeType === Node.ELEMENT_NODE || node.textContent?.trim()) {
      if (!groups.length) groups.push({ heading: '', body: doc.createElement('div') });
      groups[groups.length - 1].body.appendChild(node);
    }
  }
  return groups
    .filter((g) => g.heading || g.body.childNodes.length)
    .map(({ heading, body }) => {
      const list = body.querySelector('ul, ol');
      let kind: Kind = 'text';
      if (/touch|contact|reach us/i.test(heading)) kind = 'contact';
      else if (list && (/^how\b/i.test(heading) || list.nodeName === 'OL')) kind = 'steps';
      else if (list) kind = 'checklist';
      return { heading, html: body.innerHTML, kind };
    });
}

function textIcon(heading: string) {
  if (/who|about|story/i.test(heading)) return <Store size={20} />;
  if (/mission|vision|believe|goal/i.test(heading)) return <Target size={20} />;
  return <Leaf size={20} />;
}

function IconBadge({ children }: { children: ReactNode }) {
  return <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-100">{children}</div>;
}

const prose = 'text-[15px] leading-7 text-gray-600 [&_p+p]:mt-3 [&_a]:font-semibold [&_a]:text-brand-700 hover:[&_a]:underline [&_strong]:text-gray-800';

function TextCards({ sections }: { sections: Section[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {sections.map((s, i) => (
        <article
          key={s.heading + i}
          className={`rounded-2xl border border-gray-100 bg-white p-6 shadow-sm transition-shadow hover:shadow-md ${sections.length % 2 && i === sections.length - 1 ? 'md:col-span-2' : ''}`}
        >
          <div className="mb-3 flex items-center gap-3">
            <IconBadge>{textIcon(s.heading)}</IconBadge>
            {s.heading && <h2 className="text-lg font-bold text-gray-900">{s.heading}</h2>}
          </div>
          <div className={prose} dangerouslySetInnerHTML={{ __html: s.html }} />
        </article>
      ))}
    </div>
  );
}

function Steps({ section }: { section: Section }) {
  return (
    <section>
      <div className="mb-5 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
          <MapPinned size={14} /> Step by step
        </span>
        <h2 className="mt-2 text-2xl font-bold text-gray-900">{section.heading}</h2>
      </div>
      <div className="about-steps" dangerouslySetInnerHTML={{ __html: section.html }} />
    </section>
  );
}

function Checklist({ section }: { section: Section }) {
  return (
    <section className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm sm:p-8">
      <div className="mb-5 flex items-center gap-3">
        <IconBadge>
          <BadgeCheck size={20} />
        </IconBadge>
        <h2 className="text-xl font-bold text-gray-900">{section.heading}</h2>
      </div>
      <div className={`about-checklist ${prose}`} dangerouslySetInnerHTML={{ __html: section.html }} />
    </section>
  );
}

function ContactBand({ section }: { section: Section }) {
  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-900 via-brand-800 to-brand-700 px-6 py-8 text-white sm:px-10 sm:py-10">
      <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-brand-400/20 blur-2xl" />
      <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="max-w-xl">
          <h2 className="text-2xl font-bold">{section.heading}</h2>
          <div
            className="mt-2 leading-7 text-brand-100 [&_a]:font-semibold [&_a]:text-white [&_a]:underline [&_a]:decoration-brand-300 [&_a]:underline-offset-4"
            dangerouslySetInnerHTML={{ __html: section.html }}
          />
        </div>
        <div className="flex shrink-0 flex-wrap gap-3">
          <Link to="/help" className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-brand-800 shadow-sm transition hover:bg-brand-50">
            <LifeBuoy size={18} /> Help &amp; Support
          </Link>
          <Link to="/" className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white ring-1 ring-white/40 transition hover:bg-white/10">
            Start shopping <ArrowRight size={18} />
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function AboutUsPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['content-page', 'about-us'],
    queryFn: () => fetchContentPage('about-us'),
  });
  const sections = useMemo(() => (data ? splitSections(data.content) : []), [data]);

  if (isLoading) return <Loader />;

  if (isError || !data) {
    return <p className="text-sm text-gray-500">This page isn't available right now. Please check back later.</p>;
  }

  // Consecutive text-only sections share a row of cards; everything else stands on its own.
  const blocks: ReactNode[] = [];
  let run: Section[] = [];
  const flush = () => {
    if (run.length) blocks.push(<TextCards key={`text-${blocks.length}`} sections={run} />);
    run = [];
  };
  sections.forEach((s, i) => {
    if (s.kind === 'text') return run.push(s);
    flush();
    if (s.kind === 'steps') blocks.push(<Steps key={i} section={s} />);
    else if (s.kind === 'checklist') blocks.push(<Checklist key={i} section={s} />);
    else blocks.push(<ContactBand key={i} section={s} />);
  });
  flush();

  return (
    <div className="mx-auto max-w-5xl space-y-8 sm:space-y-10">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 px-6 py-10 text-white sm:px-10 sm:py-14">
        <div className="pointer-events-none absolute -right-16 -top-20 h-72 w-72 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-24 right-40 h-64 w-64 rounded-full bg-brand-300/30 blur-3xl" />
        <Leaf className="pointer-events-none absolute -bottom-6 right-6 hidden h-48 w-48 rotate-12 text-white/10 sm:block" strokeWidth={1.25} />
        <div className="relative max-w-2xl">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider ring-1 ring-white/25">
            <Leaf size={14} /> {data.title}
          </span>
          <h1 className="mt-4 text-3xl font-extrabold leading-tight sm:text-[2.6rem]">
            Fresh groceries from a store near you, <span className="text-brand-100">at your door in minutes.</span>
          </h1>
          <p className="mt-4 text-base leading-7 text-brand-50/90 sm:text-lg">
            Fruits, vegetables, dairy and household essentials — picked, packed and delivered by real people from your neighbourhood store.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            {HIGHLIGHTS.map(({ icon: Icon, label }) => (
              <span key={label} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-brand-800 shadow-sm">
                <Icon size={14} className="text-brand-600" /> {label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {blocks}

      <p className="text-center text-xs text-gray-400">
        Last updated: {new Date(data.updatedAt).toLocaleDateString('en-IN', { year: 'numeric', month: 'long' })}
      </p>
    </div>
  );
}
